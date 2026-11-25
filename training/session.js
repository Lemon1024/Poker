/* Shared by the offline training page and its home-screen resume link. */
const TrainingSession = (() => {
  "use strict";
  const chart = typeof module !== "undefined" && module.exports ? require("../preflop/ranges.js") : PreflopRanges;
  const key = "river-notes.training.v1";
  const modes = Object.keys(chart.modes);
  const spots = {open:[],vsOpen:[],vsThreeBet:[]};
  chart.positions.slice(0,-1).forEach((opener, index) => {
    spots.open.push({mode:"open",hero:opener});
    for (const other of chart.positions.slice(index+1)) {
      spots.vsOpen.push({mode:"vsOpen",hero:other,opponent:opener});
      spots.vsThreeBet.push({mode:"vsThreeBet",hero:opener,opponent:other});
    }
  });

  const questionKey = q => [q.mode,q.hero,q.opponent || "",q.hand].join("/");
  const sameSpot = (a,b) => a.mode === b.mode && a.hero === b.hero && a.opponent === b.opponent;
  const getSpot = q => chart.getSpot(q.mode,q.hero,q.opponent);
  const grade = (q, move) => chart.recommend(getSpot(q),q.hand).tiers?.[move];
  const fresh = () => ({rangeVersion:chart.version,round:null,mistakes:[]});
  const pick = (items, random) => items[Math.floor(random()*items.length)];

  function shuffle(items, random) {
    const shuffled = [...items];
    for (let i=shuffled.length-1;i>0;i--) {
      const j = Math.floor(random()*(i+1));
      [shuffled[i],shuffled[j]] = [shuffled[j],shuffled[i]];
    }
    return shuffled;
  }

  function deal(type, spot, random) {
    const questions = [];
    const used = new Set();
    const cycle = shuffle(modes,random);
    const categories = shuffle(["mixed","raise","call","fold"],random);
    for (let i=0;i<10;i++) {
      const spec = type === "fixed" ? spot : pick(spots[cycle[i%cycle.length]],random);
      const actual = getSpot(spec);
      const available = [], preferred = [];
      for (const hand of chart.hands) {
        const q = {...spec,hand};
        if (used.has(questionKey(q))) continue;
        const advice = chart.recommend(actual,hand);
        if (!advice.reachable) continue;
        available.push(q);
        const category = advice.low.length ? "mixed" :
          advice.primary === actual.actions[0] ? "raise" : advice.primary;
        if (category === categories[i%categories.length]) preferred.push(q);
      }
      const q = pick(preferred.length ? preferred : available,random);
      used.add(questionKey(q));
      questions.push(q);
    }
    return questions;
  }

  function start(state, type, spot, first, random=Math.random) {
    let questions;
    if (type === "review") {
      const available = spot ? state.mistakes.filter(q=>sameSpot(q,spot)) : state.mistakes;
      if (!available.length) return false;
      questions = shuffle(available,random);
      if (first) {
        const index = questions.findIndex(q=>questionKey(q)===questionKey(first));
        if (index >= 0) questions.unshift(questions.splice(index,1)[0]);
      }
      questions = questions.slice(0,10);
    } else {
      if (type !== "mixed" && (type !== "fixed" || !spot || !Object.hasOwn(spots,spot.mode) ||
          !spots[spot.mode].some(s=>sameSpot(s,spot)))) return false;
      questions = deal(type,spot,random);
    }
    state.round = {type,questions,answers:[],index:0};
    if (type === "review" && spot) {
      state.round.reviewSpot = {mode:spot.mode,hero:spot.hero};
      if (spot.opponent) state.round.reviewSpot.opponent = spot.opponent;
    }
    return true;
  }

  function submit(state, move) {
    const r = state.round;
    if (!r || r.index >= r.questions.length || r.answers.length !== r.index) return false;
    const q = r.questions[r.index];
    const tier = grade(q,move);
    if (!["high","low","avoid"].includes(tier)) return false;
    r.answers.push(move);
    const i = state.mistakes.findIndex(item=>questionKey(item) === questionKey(q));
    if (tier === "avoid" && i < 0) state.mistakes.push(q);
    if (tier !== "avoid" && r.type === "review" && i >= 0) state.mistakes.splice(i,1);
    return true;
  }

  function next(state) {
    const r = state.round;
    if (!r || r.index >= r.questions.length || r.answers.length !== r.index+1) return false;
    r.index++;
    return true;
  }

  function validQuestion(q) {
    return !!q && Object.hasOwn(spots,q.mode) && chart.hands.includes(q.hand) &&
      spots[q.mode].some(s=>sameSpot(s,q)) && chart.recommend(getSpot(q),q.hand).reachable;
  }

  function read(storage) {
    try {
      const raw = (storage || window.localStorage).getItem(key);
      if (!raw) return fresh();
      const state = JSON.parse(raw);
      if (state.rangeVersion !== chart.version || !Array.isArray(state.mistakes)) return fresh();
      const unique = new Map();
      for (const q of state.mistakes) if (validQuestion(q)) unique.set(questionKey(q),q);
      state.mistakes = [...unique.values()];
      const r = state.round;
      if (r && !(["mixed","fixed","review"].includes(r.type) && Array.isArray(r.questions) &&
        r.questions.length >= 1 && r.questions.length <= 10 && r.questions.every(validQuestion) &&
        Number.isInteger(r.index) && r.index >= 0 && r.index <= r.questions.length &&
        Array.isArray(r.answers) && r.answers.length >= r.index &&
        r.answers.length <= Math.min(r.questions.length,r.index+1) &&
        r.answers.every((move,i)=>getSpot(r.questions[i]).actions.includes(move)))) state.round = null;
      return state;
    } catch {return fresh();}
  }

  function write(state, storage) {
    try {
      (storage || window.localStorage).setItem(key,JSON.stringify(state));
      return true;
    } catch {return false;}
  }

  function ongoing(r) { return !!r && r.index < r.questions.length; }
  function resumeLabel(storage) {
    const r = read(storage).round;
    return ongoing(r) ? "继续训练 · 第 "+(r.index+1)+" 手" : "开始训练";
  }

  return {key,spots,questionKey,sameSpot,getSpot,grade,fresh,start,submit,next,read,write,ongoing,resumeLabel};
})();
if (typeof module !== "undefined" && module.exports) module.exports = TrainingSession;
