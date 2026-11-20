const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createPokerEngine = require('../web/equity.js');
const engine = createPokerEngine();
const noDraw = () => assert.fail('exact enumeration drew a random card');
const keys = {win:'win_probability',tie:'tie_probability',loss:'loss_probability',equity:'equity'};
const close = (actual,wanted) => assert.ok(Math.abs(actual-wanted)<1e-12,actual+' vs '+wanted);
const fixture = name => require('../poker_next_iteration/fixtures/'+name+'.json');
function request({request:{hero,board,range}}) {
  return {mode:'range',hero,board,range:'weighted',
    rangeText:range.combos.map(c => [...c.cards,c.weight].join(' ')).join('\n')};
}
const turn = request(fixture('turn_weighted_blocker_v1'));
for (const name of ['turn_weighted_blocker_v1','turn_current_tie_v1']) {
  test(name+' through the production engine', () => {
    const sample = fixture(name);
    const result = engine.analyze(request(sample),noDraw);
    assert.equal(result.method,'exact_turn');
    assert.equal(result.rows.length,sample.expected.rows.length);
    const check = (actual,expected) => {
      for (const [key,jsonKey] of Object.entries(keys)) {
        close(actual[key],expected[jsonKey].numerator/expected[jsonKey].denominator);
      }
    };
    check(result,sample.expected.aggregate);
    for (const expected of sample.expected.rows) {
      const row = result.rows.find(r => expected.cards.every(card=>r.cards.includes(card)));
      assert.equal(row.current,{winning:1,tied:0,losing:-1}[expected.current_relation]);
      for (const key of ['weight','wins','ties','losses','total']) assert.equal(row[key],expected[key]);
      check(row,expected);
    }
  });
}

test('1035 turn rows equal all 44 individual river showdowns; explicit equal weights match uniform', () => {
  const result = engine.analyze({...turn,range:'uniform'},noDraw);
  const counts = new Map();
  for (const river of engine.cards.filter(c => ![...turn.hero,...turn.board].includes(c))) {
    const final = engine.analyze({...turn,board:[...turn.board,river],range:'uniform'},noDraw);
    for (const row of final.rows) {
      const key = row.cards.join();
      if (!counts.has(key)) counts.set(key,[0,0,0]);
      counts.get(key)[1-row.current]++;
    }
  }
  assert.equal(result.rows.length,1035);
  assert.equal(counts.size,1035);
  for (const row of result.rows) {
    assert.deepEqual([row.wins,row.ties,row.losses],counts.get(row.cards.join()));
    assert.equal(row.total,44);
    assert.equal(row.wins+row.ties+row.losses,44);
    close(row.win,row.wins/44);close(row.tie,row.ties/44);close(row.loss,row.losses/44);
    close(row.equity,(row.wins+row.ties/2)/44);
  }
  const explicit = engine.analyze({...turn,rangeText:result.rows.map(row=>row.cards.join(' ')+' 0.25').join('\n')},noDraw);
  for (const key of Object.keys(keys)) close(result[key],explicit[key]);
});

test('blockers, zero weights and positive rescaling preserve effective turn range', () => {
  const a = engine.analyze(turn,noDraw);
  const b = engine.analyze({...turn,rangeText:'Kh Kd .375\nQd Qc .125\nAh 8d 1\nKc 8d 1\n8h 9h 0'},noDraw);
  assert.equal(b.rows.length,2);
  assert.deepEqual(b.currentCounts,{winning:1,tied:0,losing:1});
  assert.deepEqual(b.currentShares,{winning:.25,tied:0,losing:.75});
  for (const key of Object.keys(keys)) close(a[key],b[key]);
  assert.throws(()=>engine.prepare({...turn,rangeText:'Ah 8d 0\n8d Ah 1'}),/重复/);
  assert.throws(()=>engine.prepare({...turn,rangeText:'Kc 8d 1\nQd Qc 0'}),/没有可用组合/);
});

test('runner reuses complete rows, rejects late callbacks and leaves aborted work out of cache', async () => {
  const workers = [], messages = [];
  class Worker {
    constructor() {workers.push(this);}
    terminate() {this.stopped=true;}
    postMessage(data) {this.input=data;}
    emit(type,extra={}) {this.onmessage({data:{requestId:this.input.requestId,type,...extra}});}
    finish() {
      const job=engine.batches(this.input.prepared,noDraw,this.input.cached);
      let step=job.next();
      while (!step.done) step=job.next();
      this.emit('result',{result:step.value});
    }
  }
  const context=vm.createContext({createPokerEngine,Worker,Blob,URL,queueMicrotask});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/runner.js'),'utf8'),context);
  const runner=vm.runInContext('PokerRunner',context);
  const start=(extra={})=>runner.start({...turn,...extra},m=>messages.push(m));
  start({rangeText:'Ah Ad 1'});
  await Promise.resolve();
  assert.equal(workers.length,0);
  assert.equal(messages.pop().type,'error');
  const one=start({rangeText:'Kd Kh .5'});
  workers[0].finish(); await Promise.resolve();
  assert.equal(messages.pop().requestId,one.requestId);
  const cancelled=start();
  assert.equal(workers[1].input.cached.size,1);
  workers[1].emit('progress',{percent:50});
  assert.deepEqual(Object.keys(messages.pop()).sort(),['percent','requestId','type']);
  cancelled.cancel();
  const replacement=start();
  workers[1].finish(); // Even a queued terminal event from the old generation is ignored.
  assert.equal(workers[1].stopped,true);
  assert.equal(workers[2].input.cached.size,1);
  workers[2].finish(); await Promise.resolve();
  assert.deepEqual(messages.splice(0).map(m=>[m.type,m.requestId]),[['cancelled',cancelled.requestId],['result',replacement.requestId]]);
  start({rangeText:'Qd Qc .5\nKh Kd .5'});
  assert.equal(workers[3].input.cached.size,2);
  workers[3].finish(); await Promise.resolve();
  close(messages.pop().result.equity,.5);
  start({board:['Kc','7d','2h','4s']});
  assert.equal(workers[4].input.cached.size,0);
  workers[4].emit('error',{message:'test failure'});
  start({board:['Kc','7d','2h','4s']});
  assert.equal(workers[5].input.cached.size,0);
});
