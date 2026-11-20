const test = require('node:test');
const assert = require('node:assert/strict');
const createSolver = require('../strategy/solver.js');
const evaluate = require('../strategy/evaluate.js');
const {createRiverRun} = require('../strategy/runner.js');
const small = require('../poker_mobile_codex_plan/fixtures/gto_river_small_v1.json');
const weighted = require('../poker_mobile_codex_plan/fixtures/gto_river_weighted_v1.json');

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
}

function solve(model, options = {}) {
  const run = createRiverRun(model, options, createSolver, evaluate);
  let result;
  do { result = run.advance(); } while (!result);
  return result;
}

test('Kuhn analytical equilibrium has zero information-set BR gains', () => {
  const model = {kind:'kuhn'};
  const policy = createSolver(model).policy();
  const opening = p => ({check:1-p, 'bet:1':p});
  const facing = p => ({fold:1-p, call:p});
  policy.root = {J:opening(1/3), Q:opening(0), K:opening(1)};
  policy.check = {J:opening(1/3), Q:opening(0), K:opening(1)};
  policy['bet:1'] = {J:facing(0), Q:facing(1/3), K:facing(1)};
  policy['check/bet:1'] = {J:facing(0), Q:facing(2/3), K:facing(1)};
  const result = evaluate(model, policy);
  close(result.root_ev[0] - 1, -1/18);
  result.gains.forEach(gain => close(gain, 0));
  assert.equal(result.infos['check/bet:1'].K.reach, 0);
  assert.deepEqual(result.infos['check/bet:1'].K.action_ev, {fold:null, call:null});
  const cfr = solve(model);
  close(cfr.evaluation.root_ev[0] - 1, -1/18, 0.001);
  assert.equal(cfr.status, 'converged');
});

for (const fixture of [small, weighted]) {
  test(fixture.benchmark_id + ' converges under independent BR on both sides', () => {
    const result = solve(fixture);
    assert.equal(result.status, 'converged');
    const report = evaluate(fixture, result.policy);
    assert.deepEqual(result.evaluation, report);
    assert.equal(report.compatible_pairs, 60);
    close(report.weight_sum, fixture === small ? 60 : 407/8);
    if (fixture === weighted) {
      const oop = fixture.oop_range[0], ip = fixture.ip_range[0];
      close(oop.weight * ip.weight / report.weight_sum, 1/407);
      const compatible = fixture.ip_range.filter(h => h.cards.every(card => !oop.cards.includes(card)));
      close(report.infos.root['Qs As'].reach,
        compatible.reduce((sum,h) => sum + h.weight*oop.weight, 0) / report.weight_sum);
    }
    close(report.root_ev[0]+report.root_ev[1], fixture.root_pot);
    close(report.exploitability, report.nash_conv/2);
    assert.ok(report.pot_fraction <= 0.001);
    for (const [i,gain] of report.gains.entries()) close(gain, report.best_response_ev[i] - report.root_ev[i]);
    for (const rows of Object.values(result.policy)) {
      assert.equal(Object.keys(rows).length, 8);
      for (const row of Object.values(rows)) close(Object.values(row).reduce((a,b) => a+b), 1);
    }
  });
}

test('checkpoint continues the same iterations and rejects model changes', () => {
  const first = createSolver(weighted);
  first.iterate(37);
  const checkpoint = JSON.parse(JSON.stringify(first.checkpoint()));
  const resumed = createSolver(weighted, checkpoint);
  resumed.iterate(75);
  first.iterate(75);
  assert.deepEqual(resumed.checkpoint(), first.checkpoint());
  assert.throws(() => createSolver(small, checkpoint));
  const result = solve(weighted, {checkpoint, maxIterations:38, target:1e-9});
  assert.equal(result.iterations, 38);
  assert.equal(result.status, 'iteration_limit');
});

test('amount scaling and global suit permutation preserve game value', () => {
  const renamed = structuredClone(weighted);
  const rotate = card => card[0] + 'dhsc'['cdhs'.indexOf(card[1])];
  renamed.board = renamed.board.map(rotate);
  for (const hand of [...renamed.oop_range,...renamed.ip_range]) hand.cards = hand.cards.map(rotate);
  renamed.root_pot *= 2;
  renamed.remaining_stacks = {oop:200,ip:200};
  renamed.betting_model = {open_bets:[100,200],raise_to_after_open:{100:[200]}};
  function uniform(model) {return evaluate(model,createSolver(model).policy());}
  const base = uniform(weighted), scaled = uniform(renamed);
  close(base.weight_sum, scaled.weight_sum);
  for (const seat of [0,1]) {
    close(base.root_ev[seat]*2, scaled.root_ev[seat]);
    close(base.best_response_ev[seat]*2, scaled.best_response_ev[seat]);
  }
  close(base.pot_fraction, scaled.pot_fraction);
});

test('solver and independent evaluator reject inconsistent models and empty joint deals', () => {
  const badModels = [
    {...small,...small.invalid_joint_range_case},
    {...small,kind:'turn'},
    {...small,remaining_stacks:{oop:100,ip:90}},
    {...small,oop_range:[{cards:small.board.slice(0,2),weight:1}]},
    {...small,betting_model:{open_bets:[]}},
    {...small,betting_model:{open_bets:[50,100],raise_to_after_open:{50:[70]}}}
  ];
  for (const model of badModels) {
    assert.throws(() => createSolver(model));
    assert.throws(() => evaluate(model, {}), err => err.code !== 'INVALID_POLICY');
  }
  const policy = createSolver(small).policy();
  Object.values(policy.root)[0].check = -0.1;
  assert.throws(() => evaluate(small, policy), {code:'INVALID_POLICY'});
});
