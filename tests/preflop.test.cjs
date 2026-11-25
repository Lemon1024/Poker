const {test} = require('node:test');
const assert = require('node:assert/strict');
const {version,positions,hands,modes,getSpot,recommend} = require('../preflop/ranges.js');

test('35 legal spots each expose a complete and consistent 169-class range', () => {
  assert.equal(version,'1.0.0');
  assert.equal(hands.length,169);
  assert.equal(new Set(hands).size,169);
  assert.deepEqual([hands[0],hands[1],hands[13],hands[14],hands[168]],['AA','AKs','AKo','KK','22']);
  let spots=0;
  for (const [mode, actions] of Object.entries(modes)) {
    for (const [index,hero] of positions.entries()) {
      const opponents = mode === 'open' ? (hero === 'BB' ? [] : [undefined]) :
        mode === 'vsOpen' ? positions.slice(0,index) : positions.slice(index+1);
      for (const opponent of opponents) {
        const spot = getSpot(mode,hero,opponent);
        spots++;
        const used = new Set();
        for (const hand of hands) {
          const advice = recommend(spot,hand);
          if (mode === 'vsThreeBet') {
            assert.equal(advice.reachable,recommend(getSpot('open',hero),hand).tiers.raise !== 'avoid');
          } else assert.equal(advice.reachable,true);
          if (!advice.reachable) continue;
          assert.deepEqual(Object.keys(advice.tiers),actions);
          assert.deepEqual(actions.filter(a => advice.tiers[a] === 'high'),[advice.primary]);
          assert.deepEqual(actions.filter(a => advice.tiers[a] === 'low'),advice.low);
          assert.ok(Object.values(advice.tiers).every(tier => ['high','low','avoid'].includes(tier)));
          used.add(advice.primary);
        }
        assert.ok(used.has(actions[0]) && used.has('fold'),JSON.stringify(spot));
        assert.equal(used.has('call'),mode === 'vsThreeBet' || (mode === 'vsOpen' && hero !== 'SB'));
        assert.equal(spot.openTo,(mode === 'vsOpen' ? opponent : hero) === 'SB' ? 3 : 2.5);
        if (mode === 'open') assert.equal(spot.raiseTo,spot.openTo);
        else {
          const raiser = mode === 'vsOpen' ? hero : opponent;
          assert.equal(spot.threeBetTo,spot.openTo*(raiser !== 'SB' && (raiser !== 'BB' || (mode === 'vsOpen' ? opponent : hero) === 'SB') ? 3 : 4));
          assert.equal(spot.raiseTo,mode === 'vsOpen' ? spot.threeBetTo : spot.threeBetTo*(spot.inPosition ? 2.2 : 2.5));
        }
      }
    }
  }
  assert.equal(spots,35);
  assert.throws(() => getSpot('open','BB'));
  assert.throws(() => getSpot('vsOpen','UTG','BTN'));
  assert.throws(() => getSpot('vsThreeBet','BTN','CO'));
  assert.throws(() => getSpot('vsOpen','BB','BB'));
  assert.throws(() => getSpot('unknown','BTN'));
  assert.throws(() => recommend(getSpot('open','BTN'),'1Qs'));
});

test('representative position, blocker, defense and sizing recommendations', () => {
  const expect = (mode,hero,opponent,hand,primary,low=[]) => {
    const actual = recommend(getSpot(mode,hero,opponent),hand);
    assert.equal(actual.primary,primary);
    assert.deepEqual(actual.low,low);
  };
  expect('open','UTG',undefined,'72o','fold');
  expect('open','UTG',undefined,'A7s','fold',['raise']);
  expect('open','BTN',undefined,'A7s','raise');
  expect('vsOpen','BTN','UTG','99','call');
  expect('vsOpen','BTN','CO','99','threeBet');
  expect('vsOpen','BTN','CO','A5s','fold',['threeBet']);
  expect('vsOpen','BB','BTN','A5s','call',['threeBet']);
  expect('vsOpen','SB','BTN','AQo','threeBet');
  expect('vsThreeBet','BTN','BB','AA','fourBet');
  expect('vsThreeBet','UTG','HJ','AKs','call',['fourBet']);
  expect('vsThreeBet','CO','BTN','A5s','fold',['fourBet']);
  assert.deepEqual(recommend(getSpot('vsThreeBet','UTG','HJ'),'72o'),{reachable:false});
  assert.equal(recommend(getSpot('vsThreeBet','UTG','HJ'),'A7s').primary,'fold');
  const bigBlind = getSpot('vsOpen','BB','SB');
  assert.equal(bigBlind.inPosition,true);
  assert.equal(bigBlind.raiseTo,9);
  assert.equal(getSpot('vsThreeBet','SB','BB').raiseTo,22.5);
  assert.equal(getSpot('vsThreeBet','HJ','CO').raiseTo,18.75);
  assert.equal(getSpot('vsThreeBet','BTN','BB').raiseTo,22);
});
