const test=require('node:test');
const assert=require('node:assert/strict');
const solve=require('../strategy/solver');
const evaluate=require('../strategy/evaluate');
const insights=require('../strategy/insights');
const base=require('../poker_mobile_codex_plan/fixtures/gto_river_small_v1.json');
const entry=(cards,weight=1)=>({cards:cards.split(' '),weight});
const rootModel={...base,board:['2c','3d','7h','9s','Jc'],
  oop_range:[entry('As Ad')],
  ip_range:[entry('Qh Qd',.5),entry('9d 9h',.25),entry('Ac Ah',.25),entry('As Kh'),entry('Jc Jh'),entry('Ks Kc',0)]};
const hero='Ad As';

function customRun() {
  const policy=solve(rootModel).policy();
  policy.root[hero]={check:.5,'bet:50':.5,'bet:100':0};
  for (const [hand,bet] of [['Qd Qh',.25],['9d 9h',1],['Ac Ah',.5]]) {
    policy.check[hand]={check:1-bet,'bet:50':bet,'bet:100':0};
  }
  policy['bet:50']['Qd Qh']={fold:.5,call:.5,'raise:100':0};
  policy['bet:50']['9d 9h']={fold:0,call:0,'raise:100':1};
  policy['bet:50']['Ac Ah']={fold:0,call:1,'raise:100':0};
  const result={model:rootModel,policy,evaluation:evaluate(rootModel,policy)};
  return insights(result);
}
const near=(value,expected)=>assert.ok(Math.abs(value-expected)<1e-10,value+' differs from '+expected);

test('hand calculation: range weights, cards removed, conditional calling hands and a zero-probability bet',()=>{
  const current=customRun()('root',hero);
  assert.deepEqual(current.showdown,{win:.5,tie:.25,loss:.25,equity:.625});
  const reactions=current.responses['bet:50'].replies;
  const freq=Object.fromEntries(reactions.map(r=>[r.action,r.frequency]));
  assert.deepEqual(freq,{fold:.25,call:.5,'raise:100':.25});
  const groups=reactions.find(r=>r.action==='call').groups;
  assert.deepEqual(groups.stronger,{fraction:0,top:[]});
  assert.deepEqual(groups.tie.top,[{hand:'Ac Ah',share:.5}]);
  assert.deepEqual(groups.weaker.top,[{hand:'Qd Qh',share:.5}]);
  assert.deepEqual(current.responses['bet:100'],{reachable:false,replies:[]});
});

test('hand calculation: opponent bets update the posterior, and a raise charges only the outstanding amount',()=>{
  const query=customRun(), afterCheck=query('check/bet:50',hero);
  assert.equal(afterCheck.toCall,50);assert.equal(afterCheck.finalPot,200);near(afterCheck.threshold,.25);
  const sd=afterCheck.showdown;
  near(sd.win,.25);near(sd.tie,.25);near(sd.loss,.5);near(sd.equity,.375);
  const afterRaise=query('bet:50/raise:100',hero);
  assert.equal(afterRaise.pot,250);assert.equal(afterRaise.toCall,50);near(afterRaise.threshold,1/6);
  assert.equal(afterRaise.showdown.loss,1);
  const [fold,call]=afterRaise.actions;
  near(fold.ev,-50);near(call.ev,-100);near(fold.gap,0);near(call.gap,50);
});

test('unreached lines and hands have blank rates, with separate card-removal and policy reasons',()=>{
  const query=customRun();
  const blocked=query('bet:50','Kh As');
  assert.equal(blocked.reachable,false);assert.equal(blocked.blocked,true);
  assert.equal(blocked.showdown,null);assert.ok(blocked.rangeReach>0);
  const unused=query('bet:100','Qd Qh');
  assert.equal(unused.reachable,false);assert.equal(unused.blocked,false);
  assert.equal(unused.rangeReach,0);assert.equal(unused.rangeMix.call,null);
  for (const action of unused.actions) assert.ok(action.frequency===null && action.ev===null && action.gap===null);
});

test('a one-size tree weights the whole acting range by previous actions as well as starting weights',()=>{
  const model={...rootModel,oop_range:[entry('As Ad'),entry('8d 8s',.5)],ip_range:[entry('Qd Qh')],
    betting_model:{open_bets:[50],raise_to_after_open:{}}};
  const policy=solve(model).policy();
  policy.root[hero]={check:1,'bet:50':0};
  policy.root['8d 8s']={check:.25,'bet:50':.75};
  policy.check['Qd Qh']={check:0,'bet:50':1};
  policy['check/bet:50'][hero]={fold:0,call:1};
  policy['check/bet:50']['8d 8s']={fold:1,call:0};
  const query=insights({model,policy,evaluation:evaluate(model,policy)});
  assert.deepEqual(query('root',hero).actions.map(x=>x.action),['check','bet:50']);
  const view=query('check/bet:50','8d 8s');
  near(view.rangeReach,.75);near(view.rangeMix.call,8/9);near(view.rangeMix.fold,1/9);
  assert.equal(view.actions.find(x=>x.action==='fold').frequency,1);
});

test('each calling strength lists its three largest contributors as shares of all calls',()=>{
  const calls={'9c 9d':1,'9c 9h':.75,'9d 9h':.5,'7d 7s':.25,
    'Ac Ah':.5,'Kc Kd':.875,'Qd Qh':.625,'Th Ts':.375,'8c 8s':.125};
  const model={...rootModel,ip_range:Object.keys(calls).map(hand=>entry(hand)),
    betting_model:{open_bets:[50],raise_to_after_open:{}}};
  const policy=solve(model).policy();
  policy.root[hero]={check:0,'bet:50':1};
  for (const [hand,p] of Object.entries(calls)) policy['bet:50'][hand]={fold:1-p,call:p};
  const view=insights({model,policy,evaluation:evaluate(model,policy)})('root',hero);
  const call=view.responses['bet:50'].replies.find(reply=>reply.action==='call');
  near(call.frequency,5/9);
  for (const [group,hands,fraction] of [
    ['stronger',['9c 9d','9c 9h','9d 9h'],.5],
    ['tie',['Ac Ah'],.1],
    ['weaker',['Kc Kd','Qd Qh','Th Ts'],.4]
  ]) {
    near(call.groups[group].fraction,fraction);
    assert.deepEqual(call.groups[group].top.map(item=>item.hand),hands);
    for (const item of call.groups[group].top) near(item.share,calls[item.hand]/5);
  }
});

test('tiny joint range weights retain hand odds, conditional answers and opponent history',()=>{
  const model={...rootModel,oop_range:[entry('Ad As',1e-240)],
    ip_range:[entry('Qd Qh',1e-240),entry('Ac Ah',2e-240),entry('9d 9h',3e-240)],
    betting_model:{open_bets:[50],raise_to_after_open:{}}};
  const policy=solve(model).policy();
  policy.root[hero]={check:.5,'bet:50':.5};
  for (const [hand,p] of [['Qd Qh',.2],['Ac Ah',.4],['9d 9h',.8]]) {
    policy.check[hand]={check:1-p,'bet:50':p};
    policy['bet:50'][hand]={fold:1-p,call:p};
  }
  const query=insights({model,policy,evaluation:evaluate(model,policy)});
  const root=query('root',hero);
  near(root.showdown.equity,1/3);
  const call=root.responses['bet:50'].replies.find(reply=>reply.action==='call');
  near(call.frequency,17/30);
  near(call.groups.weaker.fraction,1/17);near(call.groups.tie.fraction,4/17);
  const checked=query('check/bet:50',hero);
  near(checked.showdown.win,1/17);near(checked.showdown.tie,4/17);
  near(checked.showdown.loss,12/17);near(checked.showdown.equity,3/17);
});

test('a common subnormal call probability preserves conditional group proportions',()=>{
  const model={...rootModel,ip_range:[entry('Qd Qh',.25),entry('Ac Ah',.5),entry('9d 9h')],
    betting_model:{open_bets:[50],raise_to_after_open:{}}};
  const policy=solve(model).policy();
  policy.root[hero]={check:0,'bet:50':1};
  for (const hand of Object.keys(policy['bet:50'])) {
    policy['bet:50'][hand]={fold:1,call:Number.MIN_VALUE};
  }
  const query=insights({model,policy,evaluation:evaluate(model,policy)});
  const call=query('root',hero).responses['bet:50'].replies.find(reply=>reply.action==='call');
  assert.equal(call.frequency,Number.MIN_VALUE);
  near(call.groups.weaker.fraction,1/7);near(call.groups.tie.fraction,2/7);near(call.groups.stronger.fraction,4/7);
});
