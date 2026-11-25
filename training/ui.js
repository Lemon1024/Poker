(() => {
  "use strict";
  const session = TrainingSession, advice = PreflopAdvice;
  const $ = id => document.getElementById("training-"+id);
  const modeNames = {open:"无人开池",vsOpen:"面对开池",vsThreeBet:"开池后遇到 3-bet"};
  const verdict = {high:"高频首选",low:"低频可选",avoid:"不建议这样行动"};
  const spotKey = q => [q.mode,q.hero,q.opponent || ""].join("/");
  function storedValue() {
    try {return localStorage.getItem(session.key);} catch {return undefined;}
  }
  let stored = storedValue();
  let state = session.read({getItem:()=>stored});
  let pending, busy=false;
  let filter="";

  function selectView(view) {
    for (const name of ["question","summary","review","switch"]) $(name).hidden = name !== view;
    $("count").textContent = String(state.mistakes.length);
  }
  function refresh() {
    const latest = storedValue();
    if (latest === undefined || latest === stored) return false;
    stored = latest;
    state = session.read({getItem:()=>latest});
    pending = null;
    if (location.hash === "#review") displayReview();
    else if (session.ongoing(state.round)) {markRoute("play");displayQuestion();}
    else if (state.round) {markRoute("summary");displaySummary();}
    else route();
    return true;
  }
  function commit(edit,paint) {
    if (busy) return;
    const expected = stored, shown = state;
    function apply() {
      // A pending tap in an older tab must not answer its replacement round.
      if (refresh() || stored !== expected || state !== shown || !edit()) return;
      const saved = session.write(state);
      if (saved) stored = JSON.stringify(state);
      $("storage-note").hidden = saved;
      paint();
    }
    if (!navigator.locks) {apply();return;}
    busy=true;
    let entered=false;
    navigator.locks.request(session.key,()=>{entered=true;apply();}).catch(error=>{
      if (!entered) apply();
      else console.error(error);
    }).finally(()=>{busy=false;});
  }
  function markRoute(route) {
    // The hash makes returning from the chart restore the same answered hand.
    history.replaceState(null,"","#"+route);
  }
  function spotName(q) { return q.hero+" · "+modeNames[q.mode]+(q.opponent?" · 对手 "+q.opponent:""); }
  function spotParams(q) {
    const params = new URLSearchParams({mode:q.mode,hero:q.hero});
    if (q.opponent) params.set("opponent",q.opponent);
    return params;
  }
  function displayQuestion(focus=false) {
    const r = state.round, q = r.questions[r.index], spot = session.getSpot(q);
    const answered = r.answers.length > r.index;
    const chosen = r.answers[r.index];
    selectView("question");
    Object.assign($("question").dataset,{mode:q.mode,hero:q.hero,opponent:q.opponent || "",hand:q.hand});
    $("title").textContent = {mixed:"翻前混合训练",fixed:"局面专项训练",review:"错题复练"}[r.type];
    $("progress").textContent = "第 "+(r.index+1)+" / "+r.questions.length+" 手";
    $("meter").max = r.questions.length;
    $("meter").value = r.index+1;
    const heroIndex = PreflopRanges.positions.indexOf(q.hero);
    $("seats").replaceChildren(...PreflopRanges.positions.map((position,index)=>{
      const seat = document.createElement("li");
      seat.dataset.seat = (index-heroIndex+6)%6;
      const isHero = position === q.hero, isOpponent = position === q.opponent;
      const tag = document.createElement("small");
      const role = isHero ? "我" : isOpponent ? (q.mode === "vsOpen" ? "开池" : "3-bet") :
        q.mode === "vsThreeBet" || index < heroIndex ? "已弃" : "待行动";
      tag.textContent = role;
      seat.dataset.role = isHero ? "hero" : isOpponent ? "opponent" : "other";
      seat.append(position,tag);
      return seat;
    }));
    // The teaching chart treats each suit combination in a class identically.
    const suited = q.hand.endsWith("s");
    for (const [index,id] of ["card-one","card-two"].entries()) {
      const card = $(id), red = index === 1 && !suited;
      const rank = document.createElement("b"), suit = document.createElement("i");
      rank.textContent = q.hand[index];
      suit.textContent = red ? "♥" : "♠";
      card.classList.toggle("red",red);
      card.replaceChildren(rank,suit);
    }
    $("pocket").setAttribute("aria-label","我的手牌 "+q.hand);
    $("hand-name").textContent = q.hand;
    $("context").textContent = modeNames[q.mode]+" · 我在 "+q.hero;
    $("situation").textContent = advice.describeSpot(spot);
    $("actions").replaceChildren(...spot.actions.map(move=>{
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.move = move;
      button.textContent = advice.moveText(spot,move);
      button.disabled = answered;
      if (chosen === move) button.className = "chosen";
      button.onclick = () => commit(()=>state.round === r && r.questions[r.index] === q && session.submit(state,move),()=>{
        displayQuestion();
        $("verdict").focus({preventScroll:true});
      });
      return button;
    }));
    $("feedback").hidden = !answered;
    if (answered) {
      const result = PreflopRanges.recommend(spot,q.hand);
      const tier = result.tiers[chosen];
      $("feedback").dataset.tier = tier;
      $("verdict").textContent = verdict[tier]+" · "+advice.labels[chosen];
      const best = advice.moveText(spot,result.primary);
      const low = result.low.map(move=>advice.moveText(spot,move));
      $("recommended").textContent = "首选 "+best+(low.length ? "。低频备选 "+low.join("、")+"。" : "。");
      $("reason").textContent = advice.explain(spot,q.hand,result);
      $("next").textContent = r.index === r.questions.length-1 ? "查看本轮总结" : "下一手";
      const params = spotParams(q);
      params.set("hand",q.hand);
      params.set("from","training");
      $("chart").href = "../preflop/index.html#"+params.toString();
    } else {
      delete $("feedback").dataset.tier;
      if (focus) $("actions").querySelector("button").focus({preventScroll:true});
    }
  }
  function displaySummary() {
    selectView("summary");
    const r = state.round;
    const totals = {high:0,low:0,avoid:0};
    r.answers.forEach((move,i)=>totals[session.grade(r.questions[i],move)]++);
    for (const [tier,count] of Object.entries(totals)) $("score-"+tier).textContent = count;
    $("summary-count").textContent = "已完成 "+r.questions.length+" 手"+(r.type === "fixed"?" · "+spotName(r.questions[0]):"");
    $("again").textContent = r.type === "fixed" ? "再练这个局面" : "再练一轮";
  }
  function displayReview() {
    selectView("review");
    const choices = new Map(state.mistakes.map(q=>[spotKey(q),q]));
    if (!choices.has(filter)) filter="";
    const items = state.mistakes.filter(q=>!filter || filter === spotKey(q));
    $("filter-field").hidden = !choices.size;
    $("filter").replaceChildren(new Option("全部局面",""),...Array.from(choices,([key,q])=>new Option(spotName(q),key)));
    $("filter").value = filter;
    $("review-note").textContent = items.length ? "共 "+items.length+" 手。复练时选中首选或低频备选，即可移出错题本。" : "还没有错题。训练中选择了不建议的行动，会收录在这里。";
    $("start-review").disabled = !items.length;
    $("return").textContent = session.ongoing(state.round) ? "继续当前训练" : "开始混练";
    $("review-list").replaceChildren(...items.map(q=>{
      const li = document.createElement("li"), button = document.createElement("button");
      const hand = document.createElement("b"), info = document.createElement("span");
      Object.assign(button.dataset,{mode:q.mode,hero:q.hero,opponent:q.opponent || "",hand:q.hand});
      button.type = "button";
      hand.textContent = q.hand;
      info.textContent = spotName(q);
      button.append(hand,info);
      button.onclick = () => requestRound("review",choices.get(filter),q);
      li.append(button);
      return li;
    }));
  }
  function begin(type,spot,first) {
    commit(()=>session.start(state,type,spot,first),()=>{
      markRoute("play");
      displayQuestion();
    });
  }
  function requestRound(type,spot,first) {
    const r = state.round;
    if (!session.ongoing(r)) {begin(type,spot,first);return;}
    const sameScope = type === "review" ? (spot && r.reviewSpot ? session.sameSpot(spot,r.reviewSpot) : !spot && !r.reviewSpot)
      : !spot || session.sameSpot(r.questions[0],spot);
    if (r.type === type && sameScope &&
        (!first || session.questionKey(r.questions[r.index]) === session.questionKey(first))) {
      markRoute("play");
      displayQuestion();
      return;
    }
    pending = {type,spot,first};
    selectView("switch");
    const target = type === "fixed" ? spotName(spot) : "错题复练"+(spot ? " · "+spotName(spot) : "");
    $("switch-info").textContent = "当前在第 "+(r.index+1)+" / "+r.questions.length+" 手。切换到「"+target+"」会结束本轮，已收录的错题会保留。";
  }
  function route() {
    pending = null;
    const hash = location.hash.slice(1), params = new URLSearchParams(hash);
    if (hash === "review") {displayReview();return;}
    if (Object.hasOwn(session.spots,params.get("mode"))) {
      const spec = session.spots[params.get("mode")].find(s=>s.hero === params.get("hero") && (s.opponent || null) === params.get("opponent"));
      if (spec) {requestRound("fixed",spec);return;}
    }
    if (session.ongoing(state.round)) {displayQuestion();return;}
    if ((hash === "summary" || hash === "play") && state.round) {displaySummary();return;}
    begin("mixed");
  }
  $("next").onclick = () => commit(()=>session.next(state),()=>{
    if (session.ongoing(state.round)) displayQuestion(true);
    else {markRoute("summary");displaySummary();}
    window.scrollTo(0,0);
  });
  $("again").onclick = () => {
    const r = state.round;
    if (r.type === "fixed") {
      const q = r.questions[0];
      begin("fixed",session.spots[q.mode].find(s=>session.sameSpot(s,q)));
    } else if (r.type === "review" && state.mistakes.some(q=>!r.reviewSpot || session.sameSpot(q,r.reviewSpot))) begin("review",r.reviewSpot);
    else begin("mixed");
  };
  $("filter").onchange = () => {filter=$("filter").value;displayReview();};
  $("start-review").onclick = () => requestRound("review",state.mistakes.find(q=>spotKey(q)===filter));
  $("keep").onclick = () => {pending=null;markRoute("play");displayQuestion();};
  $("confirm-switch").onclick = () => {
    if (!pending) return;
    const {type,spot,first} = pending;
    pending = null;
    begin(type,spot,first);
  };
  window.addEventListener("hashchange",route);
  window.addEventListener("storage",event=>{
    if (event.key === session.key || event.key === null) refresh();
  });
  window.addEventListener("pageshow",event=>{
    if (event.persisted) refresh();
  });
  $("storage-note").textContent = "本机存储暂不可用，本次训练可继续，离开后可能无法恢复。";
  $("verdict").tabIndex = -1;
  $("version").textContent = PreflopRanges.version;
  route();
})();
