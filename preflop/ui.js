(() => {
  "use strict";
  const {version,positions,hands,modes,getSpot,recommend} = PreflopRanges;
  const $ = id => document.getElementById("preflop-"+id);
  const {labels,tierLabels,describeSpot,explain,moveText} = PreflopAdvice;
  const mode = $("mode"), hero = $("hero"), opponent = $("opponent");
  const action = $("action"), frequency = $("frequency"), hand = $("hand");
  const compare = $("compare-opponent");
  const route = new URLSearchParams(location.hash.slice(1));
  const saved = history.state?.campChart || {};
  let spot;
  let range;

  function setOptions(select, values, fallback) {
    const previous = select.value;
    select.replaceChildren(...values.map(([value,label]) => new Option(label,value)));
    if (values.some(([value]) => value === previous)) select.value = previous;
    else if (values.some(([value]) => value === fallback)) select.value = fallback;
  }

  function remember() {
    const campChart = {
      mode:mode.value,hero:hero.value,opponent:opponent.value,compare:compare.value,
      hand:hand.value,action:action.value,frequency:frequency.value,search:$("search").value
    };
    history.replaceState({...history.state,campChart},"");
  }

  const cells = hands.map(card => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preflop-cell";
    button.dataset.hand = card;
    const name = document.createElement("span");
    name.textContent = card;
    const marker = document.createElement("b");
    marker.setAttribute("aria-hidden","true");
    button.append(name,marker);
    button.onclick = () => {hand.value = card;$("search").value = "";selectHand();remember();};
    $("matrix").append(button);
    return button;
  });

  function selectHand() {
    const index = hands.indexOf(hand.value);
    const advice = range[index];
    for (const button of cells) button.setAttribute("aria-pressed",String(button.dataset.hand === hand.value));
    $("reason").textContent = explain(spot,hand.value,advice);
    $("tiers").replaceChildren();
    const summary = $("summary");
    summary.firstElementChild.textContent = hand.value;
    summary.lastElementChild.textContent = advice.reachable
      ? ["首选 "+moveText(spot,advice.primary),...advice.low.map(move=>"低频 "+moveText(spot,move))].join("　")
      : $("reason").textContent;
    renderComparison();
    if (!advice.reachable) return;
    for (const move of [advice.primary,...advice.low,...spot.actions.filter(move => advice.tiers[move] === "avoid")]) {
      const tier = advice.tiers[move];
      const item = document.createElement("li");
      item.dataset.action = move;
      item.dataset.tier = tier;
      item.textContent = tierLabels[tier]+" "+(tier === "avoid" ? labels[move] : moveText(spot,move));
      $("tiers").append(item);
    }
  }

  function trainingLink(selected) {
    const params = new URLSearchParams({mode:selected.mode,hero:selected.hero});
    if (selected.opponent) params.set("opponent",selected.opponent);
    return "../training/index.html#"+params;
  }

  function renderComparison() {
    const cards = $("compare-cards");
    cards.replaceChildren();
    if ($("compare").hidden) return;
    const other = getSpot(spot.mode,spot.hero,compare.value);
    for (const side of [spot,other]) {
      const advice = recommend(side,hand.value);
      const card = document.createElement("article");
      const title = document.createElement("h3");
      const line = document.createElement("p");
      const move = document.createElement("strong");
      const reason = document.createElement("p");
      const link = document.createElement("a");
      title.textContent = hand.value+" · 对 "+side.opponent;
      line.className = "compare-line";
      line.textContent = describeSpot(side);
      move.textContent = advice.reachable ? moveText(side,advice.primary) : "未开池";
      reason.textContent = explain(side,hand.value,advice);
      link.href = trainingLink(side);
      link.textContent = "练对 "+side.opponent+" →";
      card.append(title,line,move,reason,link);
      cards.append(card);
    }
  }

  function paintMatrix() {
    const move = action.value;
    const all = move === "all";
    frequency.disabled = all;
    $("key").textContent = all ? "加＝加注优先 · 跟＝跟注优先 · 弃＝弃牌优先 · —＝未开池"
      : "● 高频首选 · ◐ 低频备选 · — 未开池";
    for (const [index,button] of cells.entries()) {
      const advice = range[index];
      let mark = "unmatched", symbol = "";
      if (!advice.reachable) {
        mark = "outside";
        symbol = "—";
      } else if (all) {
        mark = advice.primary === spot.actions[0] ? "raise" : advice.primary;
        symbol = {raise:"加",call:"跟",fold:"弃"}[mark];
      } else {
        const tier = advice.tiers[move];
        if (tier !== "avoid" && (frequency.value === "both" || frequency.value === tier)) {
          mark = tier;
          symbol = tier === "high" ? "●" : "◐";
        }
      }
      button.dataset.mark = mark;
      button.lastElementChild.textContent = symbol;
      const description = advice.reachable
        ? "高频"+labels[advice.primary]+advice.low.map(low => "，低频"+labels[low]).join("")
        : "此牌不在该位置开池范围";
      button.setAttribute("aria-label",hands[index]+" "+description);
    }
  }

  function changeSpot(initial = false) {
    const playingOpen = mode.value === "open";
    const facingOpen = mode.value === "vsOpen";
    const heroOptions = facingOpen ? positions.slice(1) : positions.slice(0,-1);
    setOptions(hero,heroOptions.map(position=>[position,position]),"BTN");
    const wantedHero = saved.hero || route.get("hero");
    if (initial === true && heroOptions.includes(wantedHero)) hero.value = wantedHero;
    const index = positions.indexOf(hero.value);
    const rivals = facingOpen ? positions.slice(0,index) : positions.slice(index+1);
    setOptions(opponent,rivals.map(position=>[position,position]),facingOpen?"UTG":"BB");
    const wantedOpponent = saved.opponent || route.get("opponent");
    if (initial === true && rivals.includes(wantedOpponent)) opponent.value = wantedOpponent;
    $("opponent-field").hidden = playingOpen;
    $("opponent-label").textContent = facingOpen ? "开池者位置" : "3-bet 者位置";
    const previousRaise = spot?.actions[0];
    spot = getSpot(mode.value,hero.value,opponent.value);
    $("practice").href = trainingLink(spot);
    const alternatives = rivals.filter(position=>position !== opponent.value);
    $("compare").hidden = playingOpen || alternatives.length === 0;
    setOptions(compare,alternatives.map(position=>[position,position]),alternatives[alternatives.length-1]);
    if (initial === true && alternatives.includes(saved.compare)) compare.value = saved.compare;
    const keepRaiseFilter = action.value === previousRaise;
    setOptions(action,[["all","全部首选"],...modes[mode.value].map(move=>[move,labels[move]])],
      keepRaiseFilter ? spot.actions[0] : "all");
    if (initial === true && ["all",...spot.actions].includes(saved.action)) action.value = saved.action;
    range = hands.map(card=>recommend(spot,card));
    $("line").textContent = describeSpot(spot);
    paintMatrix();
    selectHand();
  }

  hand.replaceChildren(...hands.map(card=>new Option(card,card)));
  const wantedHand = saved.hand || route.get("hand"), wantedMode = saved.mode || route.get("mode");
  hand.value = hands.includes(wantedHand) ? wantedHand : "99";
  if (Object.hasOwn(modes,wantedMode)) mode.value = wantedMode;
  if (["both","high","low"].includes(saved.frequency)) frequency.value = saved.frequency;
  $("search").value = saved.search || "";
  if (route.get("from") === "training") {
    const back = $("home");
    back.textContent = "返回训练";
    back.href = "../training/index.html";
    if (document.referrer.split("#")[0] === new URL(back.href).href) {
      back.onclick = event => {event.preventDefault();history.back();};
    }
  }
  $("version").textContent = version;
  mode.onchange = hero.onchange = opponent.onchange = () => {changeSpot();remember();};
  action.onchange = frequency.onchange = () => {paintMatrix();remember();};
  hand.onchange = () => {$("search").value = "";selectHand();remember();};
  compare.onchange = () => {renderComparison();remember();};
  $("search").oninput = event => {
    const input = event.target.value.trim().toUpperCase();
    const card = hands.find(value=>value.toUpperCase() === input);
    event.target.setAttribute("aria-invalid",String(!!input && !hands.some(value=>value.toUpperCase().startsWith(input))));
    if (card) {hand.value = card;selectHand();remember();}
  };
  changeSpot(true);
})();
