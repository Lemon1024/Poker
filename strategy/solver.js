/* Full-tree, simultaneous CFR for two-player zero-sum river games. */
function createRiverSolver(model, checkpoint) {
  const algorithm = "simultaneous-cfr-v1";
  function requireGame(condition, message) {
    if (!condition) throw new Error(message);
  }
  requireGame(model && typeof model === "object", "求解模型无效。");
  const kuhn = model.kind === "kuhn";
  requireGame(kuhn || model.kind === undefined || model.kind === "river", "不支持该博弈类型。");
  const pot = kuhn ? 2 : model.root_pot;
  const stack = kuhn ? 1 : model.remaining_stacks?.oop;
  const integer = Number.isSafeInteger;
  requireGame(integer(pot) && pot > 0 && integer(stack) && stack > 0 &&
    integer(pot + 2 * stack) && (kuhn || stack === model.remaining_stacks?.ip),
    "底池与双方相同的有效筹码必须为正整数。");

  const betting = kuhn ? {open_bets:[1]} : model.betting_model;
  requireGame(betting && typeof betting === "object", "缺少下注模型。");
  for (const [field,expected] of Object.entries({first_player:"oop", check_check:"showdown",
    uncalled_amounts:"returned", rake:0})) {
    requireGame(betting[field] === undefined || betting[field] === expected, "不支持下注规则 " + field);
  }
  if (betting.facing_all_in !== undefined) {
    requireGame(Array.isArray(betting.facing_all_in) && betting.facing_all_in.length === 2 &&
      betting.facing_all_in.includes("fold") && betting.facing_all_in.includes("call"), "全下后只能弃牌或跟注。");
  }
  const opens = betting.open_bets;
  requireGame(Array.isArray(opens) && opens.length >= 1 && opens.length <= 2 &&
    opens.every(x => integer(x) && x > 0 && x <= stack) &&
    new Set(opens).size === opens.length, "需要一或两个合法且不重复的开注金额。");
  const raisesAllowed = betting.max_raises_per_path ?? 1;
  requireGame(raisesAllowed === 0 || raisesAllowed === 1, "每条路径最多加注一次。");
  const legacy = betting.raise_to_after_bet_50 !== undefined;
  requireGame(!(legacy && betting.raise_to_after_open !== undefined), "请仅使用一种加注配置格式。");
  const raises = legacy ? {"50":betting.raise_to_after_bet_50} : (betting.raise_to_after_open ?? {});
  requireGame(typeof raises === "object" && !Array.isArray(raises), "加注配置无效。");
  for (const [key, values] of Object.entries(raises)) {
    const open = Number(key);
    requireGame(String(open) === key && opens.includes(open) && Array.isArray(values) &&
      values.length <= 1 && (!values.length || raisesAllowed === 1) &&
      values.every(to => integer(to) && to > open && to <= stack && (to >= 2 * open || to === stack)),
      "加到金额必须符合最小加注或全下，且每种开注最多一个加注尺寸。");
  }
  const betSizes = opens.slice().sort((a,b) => a-b);

  let hands;
  let boardKey;
  if (kuhn) {
    hands = [0,1].map(() => ["J","Q","K"].map((key,i) => ({key,ids:[i],rank:i,weight:1})));
    boardKey = "kuhn";
  } else {
    // Browser workers inject the same classic-script factory as the equity page.
    const engine = typeof createPokerEngine === "function" ? createPokerEngine() : require("../web/equity.js")();
    function parseCards(input, len) {
      requireGame(Array.isArray(input) && input.length === len, "牌张数量有误。");
      const ids = Array.from(input, card => engine.cards.indexOf(card)).sort((a,b) => a-b);
      requireGame(!ids.includes(-1) && new Set(ids).size === ids.length, "牌张无效或重复。");
      return ids;
    }
    const board = parseCards(model.board,5);
    boardKey = board.map(i => engine.cards[i]).join(" ");
    hands = [model.oop_range,model.ip_range].map(range => {
      requireGame(Array.isArray(range) && range.length <= 1326, "每方最多可输入 1326 个具体组合。");
      const unique = new Set();
      const active = [];
      for (const row of range) {
        const ids = parseCards(row?.cards,2);
        const key = ids.map(id => engine.cards[id]).join(" ");
        requireGame(!unique.has(key), "范围中有重复组合。");
        unique.add(key);
        requireGame(Number.isFinite(row.weight) && row.weight >= 0 && row.weight <= 1, "权重应在 0 到 1 之间。");
        if (row.weight > 0 && !ids.some(id => board.includes(id))) {
          active.push({key,ids,weight:row.weight,rank:engine.score(ids,board)});
        }
      }
      requireGame(active.length > 0, "EMPTY_EFFECTIVE_RANGE");
      requireGame(active.length <= 64, "每方最多支持 64 个未被阻挡的正权重组合，请缩小范围。");
      return active.sort((a,b) => a.ids[0]-b.ids[0] || a.ids[1]-b.ids[1]);
    });
  }

  const deals = [];
  let maxLogWeight = -Infinity;
  for (const [oop,first] of hands[0].entries()) {
    for (const [ip,second] of hands[1].entries()) {
      if (first.ids.some(id => second.ids.includes(id))) continue;
      const logWeight = Math.log(first.weight) + Math.log(second.weight);
      maxLogWeight = Math.max(maxLogWeight,logWeight);
      deals.push({oop,ip,outcome:Math.sign(first.rank-second.rank),logWeight,probability:0});
    }
  }
  requireGame(deals.length > 0, "EMPTY_JOINT_RANGE");
  let normalizer = 0;
  for (const deal of deals) {
    deal.probability = Math.exp(deal.logWeight-maxLogWeight);
    normalizer += deal.probability;
  }
  for (const deal of deals) deal.probability /= normalizer;

  // A decision node stores only the acting player's private hand and public actions.
  const nodes = [];
  let slots = 0;
  function build(history, player, own, other, raised) {
    const facing = other > own;
    let actions;
    if (facing) actions = ["fold","call",...(raised ? [] : (raises[other] || [])).map(n => "raise:"+n)];
    else actions = ["check",...betSizes.map(n => "bet:"+n)];
    const node = {history,player,actions,offset:slots,children:[],values:new Float64Array(actions.length)};
    nodes.push(node);
    slots += hands[player].length * actions.length;
    for (const action of actions) {
      // A fold returns all uncalled chips to the bettor. The winner gains half
      // the root pot plus the folding player's matched contribution in zero-sum units.
      if (action === "fold") node.children.push({fixed:(player === 0 ? -1 : 1)*(pot/2 + own)});
      else if (action === "call" || (action === "check" && history !== "root")) {
        node.children.push({stake:pot/2 + other});
      } else {
        const nextHistory = history === "root" ? action : history + "/" + action;
        const contribution = action === "check" ? own : Number(action.split(":")[1]);
        node.children.push(build(nextHistory,1-player,other,contribution,action.startsWith("raise:")));
      }
    }
    return node;
  }
  const root = build("root",0,0,0,false);
  const signature = JSON.stringify([boardKey,pot,stack,hands.map(side => side.map(h => [h.key,h.weight])),
    nodes.map(node => [node.history,node.actions])]);
  const regrets = new Float64Array(slots);
  const average = new Float64Array(slots);
  const profile = new Float64Array(slots);
  let iterations = 0;
  if (checkpoint !== undefined && checkpoint !== null) {
    requireGame(checkpoint.algorithm === algorithm && checkpoint.signature === signature &&
      integer(checkpoint.iterations) && checkpoint.iterations >= 0, "检查点算法、模型或迭代数不匹配。");
    iterations = checkpoint.iterations;
    const bound = (pot + 2*stack) * iterations * (1+1e-8);
    for (const [field,target] of [["regrets",regrets],["average",average]]) {
      const values = checkpoint[field];
      requireGame(Array.isArray(values) && values.length === slots, "检查点数组长度有误。");
      for (let i=0; i<slots; i++) {
        const x = values[i];
        requireGame(Number.isFinite(x) && (field === "average" ?
          x >= 0 && x <= iterations*(1+1e-8) : Math.abs(x) <= bound), "检查点含无效累计值。");
        target[i] = x;
      }
    }
  }

  function freezeProfile() {
    for (const node of nodes) {
      const count = node.actions.length;
      for (let i=0; i<hands[node.player].length; i++) {
        const start = node.offset + count*i;
        let sum = 0;
        for (let a=0; a<count; a++) sum += Math.max(0,regrets[start+a]);
        for (let a=0; a<count; a++) profile[start+a] = sum ? Math.max(0,regrets[start+a])/sum : 1/count;
      }
    }
  }

  // Returns the value for player 0. The strategy used by BOTH players is frozen
  // for the entire iteration, so regrets may be accumulated in place.
  function traverse(node,deal,reach0,reach1) {
    if (node.fixed !== undefined) return node.fixed;
    if (node.stake !== undefined) return node.stake*deal.outcome;
    const oop = node.player === 0;
    const count = node.actions.length;
    const start = node.offset + (oop ? deal.oop : deal.ip)*count;
    let expected = 0;
    for (let a=0; a<count; a++) {
      const prob = profile[start+a];
      const value = traverse(node.children[a],deal,oop ? reach0*prob : reach0,oop ? reach1 : reach1*prob);
      node.values[a] = value;
      expected += prob*value;
    }
    const regretReach = deal.probability * (oop ? reach1 : -reach0);
    const strategyReach = deal.probability * (oop ? reach0 : reach1);
    for (let a=0; a<count; a++) {
      regrets[start+a] += regretReach*(node.values[a]-expected);
      average[start+a] += strategyReach*profile[start+a];
    }
    return expected;
  }
  function iterate(n) {
    requireGame(integer(n) && n >= 0 && integer(iterations+n), "迭代次数应为非负安全整数。");
    for (let i=0; i<n; i++) {
      freezeProfile();
      for (const deal of deals) traverse(root,deal,1,1);
      iterations++;
    }
  }
  function policy() {
    const result = {};
    for (const node of nodes) {
      const rows = result[node.history] = {};
      const count = node.actions.length;
      for (const [i,hand] of hands[node.player].entries()) {
        const start = node.offset + count*i;
        const sum = average.subarray(start,start+count).reduce((a,b) => a+b,0);
        // A full policy is required for BR evaluation, including off-path actions.
        const row = rows[hand.key] = {};
        node.actions.forEach((action,a) => { row[action] = sum ? average[start+a]/sum : 1/count; });
      }
    }
    return result;
  }
  return {algorithm,iterate,policy,get iterations() { return iterations; },
    checkpoint() { return {algorithm,signature,iterations,regrets:Array.from(regrets),average:Array.from(average)}; }};
}
if (typeof module !== "undefined" && module.exports) module.exports = createRiverSolver;
