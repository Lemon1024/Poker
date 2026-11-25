const test = require("node:test");
const assert = require("node:assert/strict");
const training = require("../training/session.js");
const chart = require("../preflop/ranges.js");

const nextRandom = () => {
  let seed=173;
  return () => {seed=(seed*16807)%2147483647;return seed/2147483647;};
};
const memoryStore = () => {
  const values = new Map();
  return {getItem:key=>values.get(key) || null,setItem:(key,value)=>values.set(key,value)};
};

test("35 × 169 training decisions use the chart tiers and upstream reachability", () => {
  const spots = Object.values(training.spots).flat();
  assert.equal(spots.length,35);
  let visited = 0;
  for (const spec of spots) {
    const spot = chart.getSpot(spec.mode,spec.hero,spec.opponent);
    for (const hand of chart.hands) {
      const q = {...spec,hand};
      const advice = chart.recommend(spot,hand);
      for (const move of spot.actions) {
        const expected = !advice.reachable ? undefined :
          move === advice.primary ? "high" : advice.low.includes(move) ? "low" : "avoid";
        assert.equal(training.grade(q,move),expected);
      }
      visited++;
    }
  }
  assert.equal(visited,5915);
});

test("each fixed spot and the mixed round deal ten distinct reachable questions, including mixed decisions", () => {
  const state = training.fresh(), rng=nextRandom();
  for (const spec of Object.values(training.spots).flat()) {
    assert.equal(training.start(state,"fixed",spec,null,rng),true);
    const questions = state.round.questions;
    assert.equal(questions.length,10);
    assert.equal(new Set(questions.map(training.questionKey)).size,10);
    assert.ok(questions.every(q=>training.sameSpot(q,spec) && chart.recommend(training.getSpot(q),q.hand).reachable));
    assert.ok(questions.some(q=>chart.recommend(training.getSpot(q),q.hand).low.length));
  }
  training.start(state,"mixed",null,null,rng);
  assert.deepEqual([...new Set(state.round.questions.map(q=>q.mode))].sort(),["open","vsOpen","vsThreeBet"]);
  assert.equal(new Set(state.round.questions.map(training.questionKey)).size,10);
  assert.equal(training.start(state,"fixed",{mode:"vsOpen",hero:"UTG",opponent:"BTN"}),false);
});

test("duplicate answers and premature next do not advance or score; mixed actions and review are graded separately", () => {
  const state = training.fresh(), storage=memoryStore();
  assert.equal(training.resumeLabel(storage),"开始训练");
  const q = {mode:"vsOpen",hero:"BTN",opponent:"CO",hand:"A5s"};
  const moves = chart.recommend(training.getSpot(q),q.hand);
  state.round={type:"fixed",questions:[q,q,q],index:0,answers:[]};
  assert.equal(training.next(state),false);
  assert.equal(training.submit(state,"fourBet"),false);
  assert.equal(training.submit(state,moves.low[0]),true);
  assert.equal(training.submit(state,moves.primary),false);
  assert.equal(state.mistakes.length,0);
  assert.equal(training.next(state),true);
  const wrong = Object.keys(moves.tiers).find(move=>moves.tiers[move]==="avoid");
  assert.equal(training.submit(state,wrong),true);
  training.write(state,storage);
  assert.deepEqual(training.read(storage),state);
  assert.equal(training.resumeLabel(storage),"继续训练 · 第 2 手");
  training.next(state);
  training.submit(state,wrong);
  assert.equal(state.mistakes.length,1);
  training.next(state);
  assert.equal(training.ongoing(state.round),false);
  assert.equal(training.next(state),false);
  assert.equal(training.submit(state,wrong),false);
  training.write(state,storage);
  assert.equal(training.resumeLabel(storage),"开始训练");
  assert.equal(training.start(state,"review"),true);
  assert.deepEqual(state.round.questions,[q]);
  training.submit(state,wrong);
  assert.deepEqual(state.mistakes,[q]);
  training.next(state);
  training.start(state,"review");
  training.submit(state,moves.low[0]);
  assert.equal(state.mistakes.length,0);
  assert.equal(training.start(state,"review"),false);
});

test("review deals up to ten distinct mistakes, keeps the selected question first and persists feedback", () => {
  const state = training.fresh(), store=memoryStore(), rng=nextRandom();
  state.mistakes = chart.hands.slice(0,15).map(hand=>({mode:"open",hero:"BTN",hand}));
  const first = state.mistakes[14];
  training.start(state,"review",null,first,rng);
  assert.equal(state.round.questions.length,10);
  assert.deepEqual(state.round.questions[0],first);
  assert.equal(new Set(state.round.questions.map(training.questionKey)).size,10);
  for (const q of state.round.questions) {
    const primary = chart.recommend(training.getSpot(q),q.hand).primary;
    assert.ok(training.submit(state,primary));
    assert.ok(training.write(state,store));
    assert.deepEqual(training.read(store),state);
    assert.ok(training.next(state));
  }
  assert.equal(state.mistakes.length,5);
  assert.equal(training.ongoing(state.round),false);
});

test("filtered review keeps the exact mode and both seats throughout a saved round", () => {
  const state = training.fresh(), store=memoryStore(), rng=nextRandom();
  const spec={mode:"vsOpen",hero:"BTN",opponent:"CO"};
  const only=chart.hands.slice(0,14).map(hand=>({...spec,hand}));
  const other=[{...only[0],opponent:"UTG"},{...only[0],hero:"SB"},{mode:"open",hero:"BTN",hand:"AA"}];
  state.mistakes=[...other,...only];
  assert.ok(training.start(state,"review",spec,only[12],rng));
  assert.deepEqual(state.round.reviewSpot,spec);
  assert.equal(state.round.questions.length,10);
  assert.deepEqual(state.round.questions[0],only[12]);
  for (const q of state.round.questions) {
    assert.ok(training.sameSpot(q,spec));
    training.submit(state,chart.recommend(training.getSpot(q),q.hand).primary);
    training.next(state);
  }
  training.write(state,store);
  assert.deepEqual(training.read(store),state);
  assert.deepEqual(state.mistakes.slice(0,3),other);
  assert.equal(state.mistakes.length,7);
  assert.ok(training.start(state,"review",other[0],null,rng));
  assert.deepEqual(state.round.questions,[other[0]]);
  assert.equal(training.start(state,"review",{mode:"vsOpen",hero:"BB",opponent:"UTG"}),false);
});

test("invalid local progress is isolated from valid mistakes", () => {
  const store = memoryStore(), q={mode:"vsOpen",hero:"BTN",opponent:"CO",hand:"99"};
  store.setItem(training.key,"{");
  assert.deepEqual(training.read(store),training.fresh());
  const state=training.fresh();
  state.mistakes=[q,q,{...q,hand:"bad"}];
  state.round={index:NaN};
  training.write(state,store);
  assert.deepEqual(training.read(store),{...training.fresh(),mistakes:[q]});
  const unavailable={getItem:()=>{throw Error("denied");},setItem:()=>{throw Error("denied");}};
  assert.equal(training.write(state,unavailable),false);
  assert.deepEqual(training.read(unavailable),training.fresh());
});
