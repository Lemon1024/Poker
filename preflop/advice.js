const PreflopAdvice = (() => {
  "use strict";
  const labels = {raise:"Raise 开池",threeBet:"3-bet",fourBet:"4-bet",call:"Call 跟注",fold:"Fold 弃牌"};
  const tierLabels = {high:"高频",low:"低频",avoid:"不建议"};

  function describeSpot(spot) {
    if (spot.mode === "open") {
      return spot.hero+" 前面全弃 → 可开到 "+spot.openTo+"BB";
    }
    const opener = spot.mode === "vsOpen" ? spot.opponent : spot.hero;
    const opening = opener+" 开到 "+spot.openTo+"BB";
    if (spot.mode === "vsOpen") return opening+" → 轮到 "+spot.hero;
    return opening+" → "+spot.opponent+" 加到 "+spot.threeBetTo+"BB → 轮到 "+spot.hero;
  }

  function explain(spot, card, advice) {
    if (!advice.reachable) return "此牌不在该位置开池范围。";
    if (advice.low.some(move => move === "threeBet" || move === "fourBet") &&
        /^A[2-5]s$/.test(card)) {
      return "同花小 A 阻挡对手的 AA、AK，低频再加注可利用阻挡。";
    }
    if (spot.mode === "open") {
      if (advice.primary === "raise") {
        if (card.length === 2) return "口袋对子有直接的摊牌价值，击中暗三条时也能争取赢下大底池。";
        if (card.endsWith("s")) return "同花底牌有成花潜力，主动开池也能争取直接赢下盲注。";
        return ["CO","BTN","SB"].includes(spot.hero)
          ? "身后待行动人数较少，可以主动争夺盲注。"
          : "两张高牌有机会击中带强踢脚的顶对，可以主动开池。";
      }
      if (advice.low.includes("raise")) return "处于该位置开池范围边缘，默认弃牌，偶尔可加注。";
      return "这手牌在该位置的开池价值较弱，翻后较难实现权益。";
    }
    if (advice.primary === "threeBet" || advice.primary === "fourBet") {
      if (advice.primary === "threeBet" && card.length === 2 && ["CO","BTN","SB"].includes(spot.opponent)) {
        return spot.opponent+" 的开池范围较宽，这个对子可以再加注取值，也能减少让两张高牌便宜看翻牌的机会。";
      }
      return "这手牌适合主动再加注，向对手继续范围里的较弱牌取值。";
    }
    if (advice.primary === "call") {
      if (spot.mode === "vsOpen" && spot.hero === "BB") return "大盲已投入 1BB，补足差额即可防守。";
      if (card.length === 2) return "面对 "+spot.opponent+" 的加注，这个对子跟注可以保留摊牌价值，并控制底池大小。";
      return spot.inPosition ? "翻后有位置，跟注有助于实现这手牌的权益。"
        : "这手牌可跟注防守，翻后需要先行动，优先控制底池。";
    }
    if (advice.low.includes("call")) return "跟注成本与翻后牌力接近临界，默认弃牌，偶尔跟注保留摊牌机会。";
    if (advice.low.length) return "跟注时较难实现权益，偶尔再加注可争取直接拿下底池。";
    return "面对这个位置和尺度，跟注容易遇到更强的牌，再加注价值也不足。";
  }

  function moveText(spot, move) {
    if (move === "call") {
      const total = spot.mode === "vsOpen" ? spot.openTo : spot.threeBetTo;
      return labels.call+" · 跟到 "+total+"BB";
    }
    return labels[move] + (move === spot.actions[0] ? " · 加到 "+spot.raiseTo+"BB" : "");
  }
  return {labels,tierLabels,describeSpot,explain,moveText};
})();
if (typeof module !== "undefined" && module.exports) module.exports = PreflopAdvice;
