/* Original teaching ranges based on positional and sizing principles documented in the user guide. */
const PreflopRanges = (() => {
  const version = "1.0.0";
  const ranks = "AKQJT98765432";
  const positions = Object.freeze(["UTG","HJ","CO","BTN","SB","BB"]);
  const postflopOrder = ["SB","BB","UTG","HJ","CO","BTN"];
  const hands = Object.freeze([...ranks].flatMap((rank, row) => [...ranks].map((other, column) =>
    row === column ? rank+other : row < column ? rank+other+"s" : other+rank+"o")));
  const modes = Object.freeze({
    open:Object.freeze(["raise","fold"]),
    vsOpen:Object.freeze(["threeBet","call","fold"]),
    vsThreeBet:Object.freeze(["fourBet","call","fold"])
  });

  // Each opening row is [raise high, raise low]. Fold is the primary action outside raise high.
  const opening = {
    UTG:["55+ A8s+ A5s KTs+ QTs+ JTs T9s 98s AJo+ KQo", "44 A7s A4s K9s J9s 87s ATo"],
    HJ: ["44+ A7s+ A5s A4s K9s+ Q9s+ J9s+ T9s 98s 87s ATo+ KJo+ QJo", "22 33 A6s A3s K8s Q8s T8s 76s KTo JTo"],
    CO: ["22+ A2s+ K7s+ Q8s+ J8s+ T8s+ 98s 97s 87s 86s 76s 65s 54s A8o+ KTo+ QTo+ JTo", "K6s Q7s J7s T7s 75s 64s A7o K9o Q9o J9o T9o"],
    BTN:["22+ A2s+ K2s+ Q5s+ J7s+ T7s+ 97s+ 86s+ 75s+ 65s 64s 54s A2o+ K8o+ Q9o+ J9o+ T9o 98o",
          "Q4s J6s T6s 96s 85s 74s 63s 53s 43s K7o Q8o J8o T8o 87o"],
    SB: ["22+ A2s+ K3s+ Q5s+ J7s+ T7s+ 97s+ 86s+ 75s+ 65s 64s 54s A2o+ K8o+ Q9o+ J9o+ T9o",
          "K2s Q4s J6s T6s 96s 85s 74s 63s 53s 43s K7o Q8o J8o T8o 98o 87o"]
  };
  // Keys are opener / player who can 3-bet. Columns are [3-bet high, call high, 3-bet low, call low].
  const defense = {
    "UTG/HJ": ["QQ+ AKs AKo", "99 JJ TT AQs", "JJ A5s", "88 AJs KQs"],
    "UTG/CO": ["QQ+ AKs AKo", "88+ AJs AQs KQs", "JJ A5s A4s", "77 ATs QJs JTs AQo"],
    "UTG/BTN":["QQ+ AKs AKo", "77+ ATs AJs AQs KQs QJs JTs T9s", "JJ A5s A4s", "55 66 A9s KJs QTs 98s AQo"],
    "UTG/SB": ["QQ+ AKs AKo", "", "TT JJ AQs A5s KQs", ""],
    "UTG/BB": ["QQ+ AKs AKo", "22+ A2s+ K9s+ Q9s+ J9s+ T8s+ 98s 87s 76s 65s AQo AJo KQo",
                "JJ A5s A4s", "K8s Q8s J8s 97s 86s 75s 54s ATo KJo QJo"],
    "HJ/CO":  ["JJ+ AKs AKo", "88+ ATs AJs AQs KQs", "TT A5s KQs", "77 KJs QJs JTs AQo"],
    "HJ/BTN": ["JJ+ AKs AKo AQs", "66+ A9s+ KTs+ QTs+ JTs T9s 98s AQo", "TT A5s A4s KJs", "44 55 A8s Q9s J9s 87s 76s AJo KQo"],
    "HJ/SB":  ["JJ+ AQs AKs AKo", "", "99 TT AJs A5s A4s KQs AQo", ""],
    "HJ/BB":  ["JJ+ AQs AKs AKo", "22+ A2s+ K8s+ Q8s+ J8s+ T8s+ 97s+ 86s+ 75s+ 65s 54s ATo+ KJo+ QJo",
                "TT A5s A4s KQs", "K6s K7s Q7s J7s T7s 64s 53s JTo QTo A9o KTo"],
    "CO/BTN": ["99+ ATs+ KQs AQo+","55+ A7s+ K9s+ Q9s+ J9s+ T8s+ 98s 87s 76s AJo KQo",
               "88 A5s A4s KJs QJs","22 33 44 A6s K8s Q8s J8s 65s 54s KJo QJo"],
    "CO/SB":  ["TT+ AJs+ KQs AQo+", "", "88 99 ATs A5s A4s KJs QJs AJo KQo", ""],
    "CO/BB":  ["TT+ AJs+ KQs AQo+", "22+ A2s+ K5s+ Q7s+ J7s+ T7s+ 96s+ 85s+ 75s+ 65s 64s 54s A8o+ KTo+ QTo+ JTo T9o",
                "99 A5s A4s KJs QJs", "K2s K3s K4s Q6s J6s T6s 74s 63s 53s A7o K9o Q9o J9o 98o"],
    "BTN/SB": ["99+ ATs+ KJs+ QJs AJo+ KQo", "", "77 88 A9s A2s A3s A4s A5s KTs QTs JTs T9s ATo KJo QJo", ""],
    "BTN/BB": ["99+ ATs+ KJs+ QJs AJo+ KQo", "22+ A2s+ K2s+ Q4s+ J6s+ T6s+ 96s+ 85s+ 74s+ 63s+ 53s+ 43s A2o+ K8o+ Q9o+ J9o+ T9o 98o 87o",
                "77 88 A5s A4s K9s KTs QTs JTs T9s", "Q2s Q3s J4s J5s T5s 95s 84s 73s K7o Q8o J8o T8o 76o"],
    "SB/BB":  ["88+ ATs+ KJs+ QJs AJo+ KQo", "22+ A2s+ K2s+ Q5s+ J6s+ T6s+ 96s+ 85s+ 74s+ 63s+ 53s+ 43s A2o+ K8o+ Q9o+ J9o+ T9o 98o",
                "66 77 A5s A4s KTs QTs JTs T9s", "Q3s Q4s J5s T5s 95s 84s K7o Q8o J8o T8o 87o 76o"]
  };
  // Same keys, from the opener's perspective. Columns are [4-bet high, call high, 4-bet low, call low].
  const response = {
    "UTG/HJ": ["KK+", "JJ QQ AQs AKs AKo", "QQ AKs AKo A5s", "99 TT AJs KQs"],
    "UTG/CO": ["KK+", "JJ QQ AQs AKs AKo", "QQ AKs AKo A5s", "99 TT AJs KQs"],
    "UTG/BTN":["KK+", "TT JJ QQ AJs AQs AKs AKo KQs", "QQ AKs AKo A5s", "88 99 ATs QJs AQo"],
    "UTG/SB": ["QQ+ AKs", "TT JJ AJs AQs AKo KQs", "AKo A5s", "77 88 99 ATs QJs JTs AQo"],
    "UTG/BB": ["QQ+ AKs", "TT JJ AJs AQs AKo KQs", "AKo A5s", "77 88 99 ATs QJs JTs AQo"],
    "HJ/CO":  ["KK+", "JJ QQ AQs AKs AKo", "QQ AKs AKo A5s", "99 TT AJs KQs"],
    "HJ/BTN": ["QQ+", "TT JJ AJs AQs AKs AKo KQs", "AKs AKo A5s A4s", "88 99 ATs QJs JTs AQo"],
    "HJ/SB":  ["QQ+ AKs AKo", "99 TT JJ ATs AJs AQs KQs QJs", "A5s A4s", "66 77 88 KJs JTs T9s AQo"],
    "HJ/BB":  ["QQ+ AKs AKo", "99 TT JJ ATs AJs AQs KQs QJs", "A5s A4s", "66 77 88 KJs JTs T9s AQo"],
    "CO/BTN": ["QQ+ AKs AKo", "99 TT JJ AJs AQs KQs", "JJ A5s A4s", "77 88 ATs KJs QJs JTs AQo"],
    "CO/SB":  ["QQ+ AKs AKo", "88+ ATs+ KTs+ QTs+ JTs T9s AQo", "JJ A5s A4s", "55 66 77 A9s AJs J9s 98s 87s AJo KQo"],
    "CO/BB":  ["QQ+ AKs AKo", "88+ A9s+ KTs+ QTs+ JTs T9s 98s AQo", "JJ A5s A4s", "55 66 77 A8s K9s J9s 87s AJo KQo"],
    "BTN/SB": ["JJ+ AKs AKo", "77+ A8s+ KTs+ QTs+ J9s+ T9s 98s AQo AJo KQo", "TT A5s A4s A3s",
                "44 55 66 A7s K9s Q9s T8s 87s 76s ATo KJo QJo"],
    "BTN/BB": ["JJ+ AKs AKo", "77+ A7s+ K9s+ Q9s+ J9s+ T8s+ 98s 87s AQo AJo KQo", "TT A5s A4s A3s",
                "44 55 66 A6s K8s Q8s J8s 76s 65s ATo KJo QJo"],
    "SB/BB":  ["JJ+ AKs AKo", "88+ ATs+ KTs+ QTs+ JTs T9s AQo", "TT A5s A4s",
                "55 66 77 A9s K9s Q9s J9s 98s 87s AJo KQo"]
  };

  function expand(text) {
    const set = new Set();
    for (const token of text.split(/\s+/).filter(Boolean)) {
      const hand = token.replace(/\+$/,"");
      if (!hands.includes(hand)) throw Error("Unknown preflop hand: "+token);
      if (!token.endsWith("+")) set.add(hand);
      else if (hand.length === 2) {
        for (const rank of ranks.slice(0,ranks.indexOf(hand[0])+1)) set.add(rank+rank);
      } else {
        for (const rank of ranks.slice(ranks.indexOf(hand[0])+1,ranks.indexOf(hand[1])+1))
          set.add(hand[0]+rank+hand[2]);
      }
    }
    return set;
  }

  function compile(table) {
    return Object.fromEntries(Object.entries(table).map(([key,columns]) => [key,columns.map(expand)]));
  }
  const openRanges = compile(opening);
  const defenseRanges = compile(defense);
  const responseRanges = compile(response);
  function inPosition(player, opponent) {
    return postflopOrder.indexOf(player) > postflopOrder.indexOf(opponent);
  }
  function openTo(player) {return player === "SB" ? 3 : 2.5;}

  function getSpot(mode, hero, opponent) {
    if (!Object.hasOwn(modes,mode) || !positions.includes(hero)) throw Error("请选择有效局面和位置。");
    if (mode === "open") {
      if (!openRanges[hero]) throw Error("大盲位前面全弃时直接赢得盲注。");
      return {mode,hero,actions:modes[mode],openTo:openTo(hero),raiseTo:openTo(hero)};
    }
    const [opener,raiser] = mode === "vsOpen" ? [opponent,hero] : [hero,opponent];
    if (!positions.includes(opponent) || positions.indexOf(opener) >= positions.indexOf(raiser))
      throw Error("对手位置与此前行动不匹配。");
    const openSize = openTo(opener);
    const threeBetTo = openSize * (inPosition(raiser,opener) ? 3 : 4);
    const raiseTo = mode === "vsOpen" ? threeBetTo :
      Math.round(100 * threeBetTo * (inPosition(opener,raiser) ? 2.2 : 2.5))/100;
    return {mode,hero,opponent,actions:modes[mode],openTo:openSize,threeBetTo,raiseTo,
      inPosition:inPosition(hero,opponent)};
  }

  function recommend(spot, hand) {
    if (!hands.includes(hand)) throw Error("请选择有效的起手牌。");
    const {mode,hero,opponent,actions} = spot;
    const [raise] = actions;
    let primary = "fold";
    let low = [];
    if (mode === "open") {
      const [highRaise,lowRaise] = openRanges[hero];
      if (highRaise.has(hand)) primary = raise;
      if (lowRaise.has(hand)) low = [raise];
    } else {
      if (mode === "vsThreeBet" && !openRanges[hero].some(range => range.has(hand))) return {reachable:false};
      const [highRaise,highCall,lowRaise,lowCall] = mode === "vsOpen"
        ? defenseRanges[opponent+"/"+hero] : responseRanges[hero+"/"+opponent];
      if (highRaise.has(hand)) primary = raise;
      else if (highCall.has(hand)) primary = "call";
      // A broad call range can include value raises. Those remain raise-first,
      // and only explicit mixed entries add a second action.
      if (lowRaise.has(hand) && primary !== raise) low.push(raise);
      if (lowCall.has(hand) && primary !== "call") low.push("call");
    }
    const tiers = Object.fromEntries(actions.map(action => [action,
      action === primary ? "high" : low.includes(action) ? "low" : "avoid"]));
    return {reachable:true,primary,low,tiers};
  }
  return {version,positions,hands,modes,getSpot,recommend};
})();

if (typeof module !== "undefined" && module.exports) module.exports = PreflopRanges;
