/* Shared by a classic browser script, its offline worker, and Node tests. */
function createPokerEngine() {
  const ranks = "23456789TJQKA";
  const suits = "cdhs";
  const cards = Object.freeze(Array.from({length: 52}, (_, i) => ranks[i >> 2] + suits[i % 4]));
  const top = Array.from({length: 6}, () => new Uint16Array(8192));
  const size = new Uint8Array(8192);
  const straight = new Uint8Array(8192);
  for (let mask = 1; mask < 8192; mask++) {
    const high = 1 << (31 - Math.clz32(mask));
    const rest = mask ^ high;
    size[mask] = size[rest] + 1;
    for (let n = 1; n <= 5; n++) top[n][mask] = high | top[n - 1][rest];
    for (let j = 8; j >= 0; j--) {
      if ((mask & (31 << j)) === (31 << j)) { straight[mask] = j + 5; break; }
    }
    const wheel = (1 << 12) | 15; // Ace plus ranks 2, 3, 4, 5.
    if (!straight[mask] && (mask & wheel) === wheel) straight[mask] = 4;
  }

  // A category occupies the upper bits. Rank masks break ties lexicographically.
  const category = 8192 * 8192;
  const masks = new Uint16Array(4);
  function score(hand, board) {
    masks.fill(0);
    for (const card of hand) masks[card % 4] |= 1 << (card >> 2);
    for (const card of board) masks[card % 4] |= 1 << (card >> 2);
    const [a,b,c,d] = masks;
    const all = a | b | c | d;
    const pairs = (a & b) | (c & d) | ((a | b) & (c | d));
    const trips = ((a & b) & (c | d)) | ((c & d) & (a | b));
    const quad = a & b & c & d;
    const flush = masks.find(mask => size[mask] >= 5) || 0;
    if (flush && straight[flush]) return 8 * category + straight[flush];
    if (quad) return 7 * category + quad * 8192 + top[1][all ^ quad];
    const three = top[1][trips];
    if (three && (pairs ^ three)) return 6 * category + three * 8192 + top[1][pairs ^ three];
    if (flush) return 5 * category + top[5][flush];
    if (straight[all]) return 4 * category + straight[all];
    if (three) return 3 * category + three * 8192 + top[2][all ^ three];
    if (size[pairs] >= 2) {
      const two = top[2][pairs];
      return 2 * category + two * 8192 + top[1][all ^ two];
    }
    if (pairs) return category + pairs * 8192 + top[3][all ^ pairs];
    return top[5][all];
  }

  function readCards(values, length) {
    if (!Array.isArray(values) || values.length !== length) throw Error("请补全手牌和公共牌。");
    const ids = Array.from(values, value => cards.indexOf(value));
    if (ids.includes(-1)) throw Error("请补全手牌和公共牌。");
    if (new Set(ids).size !== ids.length) throw Error("同一张牌只能出现一次。");
    return ids;
  }

  function readRange(rangeText) {
    const result = [];
    const seen = new Set();
    if (typeof rangeText !== "string") throw Error("请输入具体组合及权重。");
    const lines = rangeText.split(/\r?\n/);
    for (const [i,line] of lines.entries()) {
      const entry = line.trim();
      if (!entry) continue;
      const match = /^(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(entry);
      if (!match) throw Error("范围第 " + (i + 1) + " 行格式有误，请使用「As Ks 0.5」。");
      const hand = readCards([match[1], match[2]], 2).sort((a,b) => a-b);
      const key = hand.join(",");
      if (seen.has(key)) throw Error("范围中有重复组合，包含牌序相反的重复项。");
      seen.add(key);
      const weight = Number(match[3] ?? 1);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw Error("范围权重应在 0 到 1 之间。");
      result.push({hand,weight});
    }
    return result;
  }

  function opponents(request, deck, blocked) {
    if (request.mode === "fixed") {
      const hand = readCards(request.villain, 2);
      if (hand.some(id => blocked.has(id))) throw Error("双方底牌不能重复。");
      return [{hand,weight:1}];
    }
    let result = [];
    if (request.range === "uniform") {
      for (let i = 0; i < deck.length; i++) {
        for (let j = i + 1; j < deck.length; j++) result.push({hand:[deck[i], deck[j]], weight:1});
      }
    } else if (request.range === "weighted") {
      result = readRange(request.rangeText).filter(({hand,weight}) => weight && !hand.some(id => blocked.has(id)));
    } else throw Error("请选择对手范围。");
    if (!result.length) throw Error("范围中没有可用组合，请检查权重和已用牌。");
    return result;
  }

  function prepare(request) {
    if (!["fixed","range"].includes(request?.mode)) throw Error("未知分析模式。");
    const fixed = request.mode === "fixed";
    if (!fixed && ![3,4,5].includes(request.board?.length)) throw Error("公共牌应有 3、4 或 5 张。");
    const hero = readCards(request.hero, 2);
    const board = readCards(request.board, fixed ? 0 : request.board.length);
    const blocked = new Set([...hero,...board]);
    if (blocked.size !== hero.length + board.length) throw Error("手牌与公共牌重复。");
    const deck = cards.map((_,i) => i).filter(i => !blocked.has(i));
    const range = opponents(request, deck, blocked);
    const position = board.length >= 4
      ? [hero,board].map(group => group.slice().sort((a,b) => a-b).join(",")).join("/") : null;
    return {fixed,hero,board,deck,range,position};
  }

  function* batches({fixed,hero,board,deck,range}, random = Math.random, cached = new Map()) {
    const river = board.length === 5;
    const turn = board.length === 4;
    const samples = Math.max(2048, Math.ceil(100000 / range.length));
    let heroNow;
    const heroRivers = new Map();
    const rows = [];
    const totals = {win:0, tie:0, loss:0};
    const currentCounts = {winning:0,tied:0,losing:0};
    const currentShares = {winning:0,tied:0,losing:0};
    const maxWeight = range.reduce((max, x) => Math.max(max,x.weight),0);
    let weightSum = 0;
    for (const [index,{hand,weight}] of range.entries()) {
      const names = hand.map(id => cards[id]);
      const hit = (turn || river) && cached.get(names.join(" "));
      let current = null, wins = 0, ties = 0, total = 0;
      if (hit) {
        ({current,wins,ties,total} = hit);
      } else if (!fixed) {
        heroNow ??= score(hero,board);
        current = Math.sign(heroNow - score(hand,board));
      }
      if (!hit && river) { total = 1; wins = Number(current > 0); ties = Number(current === 0); }
      if (!hit && turn) {
        const runout = board.slice();
        for (const card of deck) {
          if (hand.includes(card)) continue;
          total++;
          runout[4] = card;
          if (!heroRivers.has(card)) heroRivers.set(card,score(hero,runout));
          const diff = heroRivers.get(card) - score(hand,runout);
          if (diff > 0) wins++;
          if (diff === 0) ties++;
        }
      }
      if (!turn && !river) {
        const remaining = deck.filter(id => !hand.includes(id));
        const runout = board.slice();
        const missing = 5 - board.length;
        total = samples;
        for (let n = 0; n < samples; n++) {
          // Each draw starts from a permutation of the same legal deck. A fresh
          // partial Fisher-Yates is uniform from any such starting permutation.
          for (let i = 0; i < missing; i++) {
            const j = i + Math.floor(random() * (remaining.length-i));
            [remaining[i],remaining[j]] = [remaining[j],remaining[i]];
            runout[board.length+i] = remaining[i];
          }
          const diff = score(hero,runout) - score(hand,runout);
          if (diff > 0) wins++;
          if (diff === 0) ties++;
          if ((n & 1023) === 1023) yield Math.floor(100*(index+(n+1)/samples)/range.length);
        }
      }
      const row = {cards:names, weight, current, win:wins/total,
        tie:ties/total, loss:(total-wins-ties)/total, equity:(wins+ties/2)/total};
      if (turn || river) Object.assign(row,{wins,ties,losses:total-wins-ties,total});
      const relative = weight/maxWeight;
      if (!fixed) {
        rows.push(row);
        const relation = current > 0 ? "winning" : current < 0 ? "losing" : "tied";
        currentCounts[relation]++;
        currentShares[relation] += relative;
      }
      for (const key of Object.keys(totals)) totals[key] += relative * row[key];
      weightSum += relative;
      if ((index+1)%16 === 0) yield Math.floor(100*(index+1)/range.length);
    }
    for (const key of Object.keys(totals)) totals[key] /= weightSum;
    for (const key of Object.keys(currentShares)) currentShares[key] /= weightSum;
    return {method:river ? "showdown" : turn ? "exact_turn" : "monte_carlo",
      ...(!fixed && {currentCounts,currentShares}),
      ...totals, equity:totals.win+totals.tie/2, rows};
  }
  function analyze(request, random = Math.random, progress = () => {}) {
    const job = batches(prepare(request),random);
    let lastProgress = 0;
    for (let step = job.next(); ; step = job.next()) {
      if (step.done) return step.value;
      if (step.value > lastProgress) {progress(step.value); lastProgress = step.value;}
    }
  }
  return {analyze, prepare, batches, readRange, cards, score};
}
if (typeof module !== "undefined" && module.exports) module.exports = createPokerEngine;
