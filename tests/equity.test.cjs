const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const engine = require('../web/equity.js')();

const ranks = '23456789TJQKA';
const deck = [...ranks].flatMap(rank => [...'cdhs'].map(suit => rank + suit));
const river = {mode:'range',hero:['As','Qs'],board:['Qd','8s','2s','7h','3c'],range:'uniform'};
const fixed = {mode:'fixed',hero:['As','Ah'],villain:['Ks','Kh'],board:[]};
const flop = {mode:'range',hero:['As','Ks'],board:['2s','7s','Td'],range:'weighted',rangeText:'9c 9d 1'};
const turn = {...flop,board:[...flop.board,'3h']};
const fields = ['win','tie','loss'];
const fixture = name => JSON.parse(readFileSync(path.join(__dirname,'../poker_mobile_codex_plan/fixtures',name),'utf8'));

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

// Reference implementation: enumerate all five-card subsets, count repeated ranks,
// compare category followed by ordered kicker values. It never calls the app evaluator.
function* combinations(cards, n, offset = 0, chosen = []) {
  if (!n) { yield chosen.slice(); return; }
  for (let i = offset; i <= cards.length - n; i++) {
    chosen.push(cards[i]);
    yield* combinations(cards,n-1,i+1,chosen);
    chosen.pop();
  }
}

function five(cards) {
  const values = cards.map(c => ranks.indexOf(c[0])+2).sort((a,b) => b-a);
  const counts = new Map();
  for (const value of values) counts.set(value,(counts.get(value) || 0)+1);
  const groups = [...counts].sort((a,b) => b[1]-a[1] || b[0]-a[0]);
  const flush = cards.every(c => c[1] === cards[0][1]);
  const straight = counts.size === 5 && (values[0]-values[4] === 4 ? values[0]
    : values.join(',') === '14,5,4,3,2' ? 5 : 0);
  let category;
  if (flush && straight) category = 8;
  else if (groups[0][1] === 4) category = 7;
  else if (groups[0][1] === 3 && groups[1][1] === 2) category = 6;
  else if (flush) category = 5;
  else if (straight) category = 4;
  else if (groups[0][1] === 3) category = 3;
  else if (groups[1][1] === 2) category = 2;
  else if (groups[0][1] === 2) category = 1;
  else category = 0;
  const kickers = straight ? [straight] : groups.map(group => group[0]);
  let value = category;
  for (let i = 0; i < 5; i++) value = value*15 + (kickers[i] || 0);
  return value;
}

function best(cards) {
  let result = -1;
  for (const fiveCards of combinations(cards,5)) result = Math.max(result,five(fiveCards));
  return result;
}

function exact(hero, villain, board) {
  const used = new Set([...hero,...villain,...board]);
  const counts = {win:0,tie:0,loss:0};
  let total = 0;
  for (const rest of combinations(deck.filter(c => !used.has(c)),5-board.length)) {
    const difference = best([...hero,...board,...rest]) - best([...villain,...board,...rest]);
    counts[difference > 0 ? 'win' : difference < 0 ? 'loss' : 'tie']++;
    total++;
  }
  return {counts,total};
}

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual-expected) <= tolerance, actual+' vs '+expected+' (tolerance '+tolerance+')');
}

function validProbabilities(item) {
  for (const key of [...fields,'equity']) assert.ok(item[key] >= 0 && item[key] <= 1);
  close(item.win+item.tie+item.loss,1);
  close(item.equity,item.win+item.tie/2);
}

function checkSimulated(result, counts, total) {
  assert.equal(result.method,'monte_carlo');
  validProbabilities(result);
  for (const field of fields) {
    const p = counts[field]/total;
    if (p === 0 || p === 1) assert.equal(result[field],p);
    else close(result[field],p,Math.max(1/100000,5*Math.sqrt(p*(1-p)/100000)));
  }
}

test('independent five-card oracle handles category and kicker boundaries', () => {
  const order = ['Ac 3c Ks 8d 4h','Ah Ac 9c 3d 4s','Ac Ad 2c 2h 5c','3s 3c 3d 2s 7d',
    'As 2s 3h 4s 5c','2s 3s 5s 8s Js','2d 2h 2c 3h 3d','2d 2h 2c 2s 3h','As 2s 3s 4s 5s'];
  const pairs = order.slice(1).map((x,i) => [x,order[i]]);
  pairs.push(['2d 3h 4c 5s 6d','Ad 2h 3s 4d 5c'],['Ac As 8d 7c 3h','Ac As 8d 7c 2h'],
    ['Ks Kh Kd As Ah 6h 6s','Ks Kh Kd 6h 6s 3c 4c'],
    ['As Ah Kd Kh 9c 9h 8c','As Ah Kd Kh 8c 8h 7c'],
    ['Qc Qd Qh Qs Ah 5c 3c','Qc Qd Qh Qs Kh 5c 3c'],
    ['As Js 9s 6s 4s 3s 2s','As Js 9s 6s 3s 2s Ac']);
  const production = cards => {
    const ids = cards.map(card => engine.cards.indexOf(card));
    return engine.score(ids.slice(0,2),ids.slice(2));
  };
  for (const [winner,loser] of pairs) {
    const a = winner.split(' '), b = loser.split(' ');
    assert.ok(best(a) > best(b), winner);
    assert.ok(production(a) > production(b), winner);
  }
  const random = seeded(31337);
  for (let iteration=0; iteration<600; iteration++) {
    const shuffled=deck.slice();
    for (let i=0; i<9; i++) {
      const j = i+Math.floor(random()*(shuffled.length-i));
      [shuffled[i],shuffled[j]] = [shuffled[j],shuffled[i]];
    }
    const board = shuffled.slice(4,7+(iteration%3));
    const a = [...shuffled.slice(0,2),...board], b = [...shuffled.slice(2,4),...board];
    assert.equal(Math.sign(production(a)-production(b)),Math.sign(best(a)-best(b)), shuffled.slice(0,9).join(' '));
  }
});

test('three locked seeds satisfy preflop and flop sampling; turn matches every independent count', () => {
  const oracle = fixture('preflop_asah_kskh.json').expected_result.hero;
  const opponent = ['9c','9d'];
  const flopExact = exact(flop.hero,opponent,flop.board);
  const turnExact = exact(turn.hero,opponent,turn.board);
  assert.deepEqual(flopExact,{counts:{win:545,tie:0,loss:445},total:990});
  assert.equal(turnExact.total,44);
  for (const seed of [1,42,2026]) {
    const pre = engine.analyze(fixed,seeded(seed));
    checkSimulated(pre,{win:oracle.wins,tie:oracle.ties,loss:oracle.losses},oracle.total);
    assert.deepEqual(pre.rows,[]);
    for (const [request,reference] of [[flop,flopExact],[turn,turnExact]]) {
      const result = engine.analyze(request,seeded(seed));
      if (request === turn) {
        assert.equal(result.method,'exact_turn');
        for (const field of fields) assert.equal(result[field],reference.counts[field]/44);
      } else checkSimulated(result,reference.counts,reference.total);
      assert.equal(result.rows.length,1);
      assert.equal(result.rows[0].current,-1);
      validProbabilities(result.rows[0]);
      for (const outcome of fields) assert.equal(result[outcome],result.rows[0][outcome]);
    }
  }
});

test('every uniform river row matches an independently scored legal opponent', () => {
  const result = engine.analyze(river,() => { throw Error('River used randomness'); });
  const heroScore = best([...river.hero,...river.board]);
  const used = new Set([...river.hero,...river.board]);
  const legal = deck.filter(card => !used.has(card));
  const byCards = new Map(result.rows.map(row => [row.cards.slice().sort().join(' '),row]));
  assert.equal(result.method,'showdown');
  assert.equal(result.rows.length,990);
  assert.equal(byCards.size,990);
  for (const opponent of combinations(legal,2)) {
    const row = byCards.get(opponent.slice().sort().join(' '));
    const comparison = Math.sign(heroScore-best([...opponent,...river.board]));
    assert.equal(row.current,comparison);
    for (const [i,outcome] of ['loss','tie','win'].entries()) assert.equal(row[outcome],Number(i===comparison+1));
    validProbabilities(row);
  }
  close(result.win,884/990); close(result.tie,6/990); close(result.loss,100/990);
  const royal = engine.analyze({...river,hero:['2c','3d'],board:['As','Ks','Qs','Js','Ts']});
  assert.equal(royal.tie,1); assert.equal(royal.equity,0.5);
});

test('weights, blockers and zero-weight hand filtering match fixture and individual rows', () => {
  const example = fixture('river_weighted_filtering.json');
  const text = example.request.range.combos.map(x => [...x.cards,x.weight].join(' ')).join('\n');
  const result = engine.analyze({...river,range:'weighted',rangeText:text});
  assert.equal(result.rows.length,3);
  for (const k of fields) close(result[k],example.expected_result.aggregate[k+'_probability']);
  for (const k of [...fields,'equity']) {
    close(result[k],result.rows.reduce((n,r) => n+r[k]*r.weight,0)/2.5);
  }
  const extreme = engine.analyze({...river,range:'weighted',rangeText:'Kc Kd 5e-324\nQc Kd 5e-324'});
  close(extreme.win,0.5); close(extreme.loss,0.5);
});

test('structurally and semantically invalid input raises an error before simulation', () => {
  const bad = [
    {...fixed,villain:['Ks','As']},{...fixed,hero:['As','As']},{...fixed,board:['2h']},
    {...fixed,hero:['10s','Ah']},{...river,board:['Qd','3c']},
    {...river,board:['As','7d','3h']},{...river,range:'unknown'},
    ...['As Ah 1','Kh Kd 0','As Ah 0\nAh As 1','Kh Kd 1\nKd Kh 0.5','',
        'Kh Kh 1','Kh Kd -0.1','Kh Kd 1.01','Kh Kd NaN','Kh Kd Infinity','Kh Kd 0.2 extra']
      .map(rangeText => ({...river,range:'weighted',rangeText}))
  ];
  for (const request of bad) {
    let draws = 0;
    assert.throws(() => engine.analyze(request,() => {draws++; return 0.5;}));
    assert.equal(draws,0);
  }
});

test('flop and turn full ranges cover all legal combos; summaries match row means', () => {
  for (const [request,expected] of [[flop,1081],[turn,1035]]) {
    const result = engine.analyze({...request,range:'uniform'},seeded(42));
    assert.equal(result.rows.length,expected);
    const keys = new Set(result.rows.map(x => x.cards.slice().sort().join(' ')));
    assert.equal(keys.size,expected);
    for (const hand of combinations(deck.filter(c => ![...request.hero,...request.board].includes(c)),2)) {
      assert.ok(keys.has(hand.sort().join(' ')));
    }
    result.rows.forEach(validProbabilities);
    for (const key of [...fields,'equity']) close(result[key],result.rows.reduce((sum,r)=>sum+r[key],0)/expected);
  }
});
