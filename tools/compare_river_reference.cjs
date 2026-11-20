// Compare the two fixed river fixtures to b-inary's separately implemented Rust/WASM solver.
// Download its two pinned artifacts into .work/river-oracle; see reports/RIVER_REFERENCE.md.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const {createRiverRun} = require('../strategy/runner.js');
const createSolver = require('../strategy/solver.js');
const evaluate = require('../strategy/evaluate.js');

const root = path.resolve(__dirname, '..');
const assets = [
  {name:'solver-single.js', url:'https://wasm-postflop.pages.dev/7a023623e45ca364f00b.js', sha256:'f0564d649d26dc91b327592fbccd27c899581a4dc82ff4b3a5025b065c604060'},
  {name:'solver-single.wasm', url:'https://wasm-postflop.pages.dev/7e7987ad18d75b6fce10.wasm', sha256:'4d360a1217bd30a1830497239a9df9951dc20c742d3c3335ceef7cd415a50b2e'}
];
const ranks = '23456789TJQKA', suits = 'cdhs';
const cardId = code => 4*ranks.indexOf(code[0])+suits.indexOf(code[1]);
const cardCode = id => ranks[id>>2]+suits[id%4];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const empty = new Uint32Array();

function loadExternal(directory) {
  const [glue, wasm] = assets.map(asset => {
    const bytes = fs.readFileSync(path.join(directory, asset.name));
    assert.equal(hash(bytes),asset.sha256,'Pinned asset hash: '+asset.name);
    return bytes;
  });
  // Register the single-thread chunk, then supply only the Webpack export helpers it uses.
  const scope = {};
  new Function('self',glue.toString('utf8'))(scope);
  const bindings = {};
  scope.webpackChunkwasm_postflop[0][1][1825]({},bindings,{
    r() {}, d(target, getters) {
      for (const [key,get] of Object.entries(getters)) Object.defineProperty(target,key,{get});
    }
  });
  bindings.initSync(wasm);
  return bindings.GameManager;
}

function packRange(entries) {
  const weights = new Float32Array(1326);
  for (const entry of entries) {
    const [a,b] = entry.cards.map(cardId).sort((x,y)=>x-y);
    // Lexicographic order of pairs (a,b), 0 <= a < b < 52.
    weights[a*(101-a)/2+b-1] = entry.weight;
  }
  return weights;
}
function unpackPrivate(game,seat,expected) {
  const keys = Array.from(game.private_cards(seat),packed =>
    cardCode(packed & 255)+' '+cardCode(packed >> 8));
  const wanted = expected.map(row => row.cards.slice().sort((a,b)=>cardId(a)-cardId(b)).join(' '));
  assert.deepEqual(keys.slice().sort(),wanted.sort(),'External private hands differ');
  return keys;
}

function externalSolve(Manager, model) {
  const game = Manager.new();
  try {
    // These are specifically the two baseline fixtures. Reject changed templates.
    assert.equal(model.root_pot,100);
    assert.deepEqual(model.remaining_stacks,{oop:100,ip:100});
    assert.deepEqual(model.betting_model.open_bets,[50,100]);
    assert.deepEqual(model.betting_model.raise_to_after_bet_50,[100]);
    const error = game.init(packRange(model.oop_range),packRange(model.ip_range),Uint8Array.from(model.board,cardId),
      model.root_pot,model.remaining_stacks.oop,0,0,false,
      '','','','','','50%,a','a','','','','','','50%,a','a',0,0,0,'','');
    assert.equal(error,undefined);
    const hands = [unpackPrivate(game,0,model.oop_range),unpackPrivate(game,1,model.ip_range)];
    game.allocate_memory(false);
    const iterations = 4096;
    for (let i=0; i<iterations; i++) game.solve_step(i);
    const exploitability = game.exploitability();
    game.finalize();

    const policy = {}, actionEV = {};
    let rootEV;
    function walk(indices, actionsSoFar) {
      game.apply_history(Uint32Array.from(indices));
      const actor = game.current_player();
      if (actor==='terminal') return;
      assert(['oop','ip'].includes(actor),'Unexpected chance node');
      const seat = Number(actor==='ip');
      assert.equal(seat, indices.length%2, 'Unexpected player at '+actionsSoFar.join('/'));
      const pathKey = actionsSoFar.join('/') || 'root';
      const facing = actionsSoFar.some(a=>a.startsWith('bet:'));
      const actions = game.actions_after(empty).split('/').map(raw=>{
        const [name,amount] = raw.toLowerCase().split(':');
        if (name==='allin') return (facing?'raise:':'bet:')+amount;
        return ['fold','check','call'].includes(name) ? name : name+':'+amount;
      });
      const snapshot = game.get_results();
      const nHands = hands[0].length+hands[1].length;
      const actorHands = hands[seat], entries = actions.length*actorHands.length;
      const emptyRange = snapshot[2]!==0;
      // get_results returns pots + empty flag, two ranges, their normalizers,
      // and, for nonempty ranges, equities, per-hand EVs and equity realizations.
      const strategyStart = 3 + nHands * (emptyRange ? 2 : 5);
      assert.equal(snapshot.length,strategyStart+entries*(emptyRange?1:2),'External buffer layout changed');
      if (!indices.length) {
        assert(!emptyRange);
        const rootRanges=[model.oop_range,model.ip_range];
        rootEV=hands.map((keys,player)=>{
          const offset = player===0?0:hands[0].length;
          const expectedWeights=new Map(rootRanges[player].map(row=>[
            row.cards.slice().sort((a,b)=>cardId(a)-cardId(b)).join(' '),row.weight]));
          let weighted = 0, sum = 0;
          for (let h=0; h<keys.length; h++) {
            assert.equal(snapshot[3+offset+h],expectedWeights.get(keys[h]),'External root weight mismatch');
            const w=snapshot[3+nHands+offset+h];
            weighted+=w*snapshot[3+3*nHands+offset+h]; sum+=w;
          }
          return weighted/sum;
        });
      }
      const paid = game.total_bet_amount(empty)[seat];
      policy[pathKey]={}; actionEV[pathKey]={};
      actorHands.forEach((hand,h)=>{
        const frequencies={}, values={};
        let sum=0;
        actions.forEach((name,a)=>{
          const index = strategyStart+a*actorHands.length+h;
          frequencies[name]=snapshot[index]; sum+=frequencies[name];
          // External EV is relative to this node (fold = 0). Our EV starts at the river root.
          values[name] = emptyRange ? null : snapshot[index+entries]-paid;
        });
        assert(Math.abs(sum-1)<=0.000002,'Exported rounded strategy does not sum to one');
        for (const action of actions) frequencies[action]/=sum;
        policy[pathKey][hand]=frequencies; actionEV[pathKey][hand]=values;
      });
      actions.forEach((action,a)=>walk([...indices,a],[...actionsSoFar,action]));
    }
    walk([],[]);
    return {policy,actionEV,rootEV,exploitability,iterations};
  } finally { game.free(); }
}

function errorStats(rows) {
  assert(rows.length);
  rows.sort((a,b)=>a.delta-b.delta);
  return {actions:rows.length,mean_absolute_chips:rows.reduce((v,r)=>v+r.delta,0)/rows.length,
    maximum_absolute_chips:rows.at(-1).delta,worst:rows.at(-1)};
}

function compare(Manager, fixture) {
  const bytes=fs.readFileSync(path.join(root,'poker_mobile_codex_plan','fixtures',fixture));
  const model=JSON.parse(bytes.toString('utf8'));
  const external=externalSolve(Manager,model);
  const replay=evaluate(model,external.policy);
  const run=createRiverRun(model,{target:.001,maxIterations:100000},createSolver,evaluate);
  let ours;
  while (!ours) ours=run.advance();
  assert.equal(ours.status,'converged');
  assert.deepEqual(Object.keys(ours.policy).sort(),Object.keys(external.policy).sort());
  const samePolicy=[],crossPolicy=[];
  let actionSlots = 0;
  for (const [history,hands] of Object.entries(external.policy)) {
    for (const [hand,probs] of Object.entries(hands)) {
      const refInfo=replay.infos[history][hand], localInfo=ours.evaluation.infos[history][hand];
      assert.deepEqual(Object.keys(probs).sort(), Object.keys(ours.policy[history][hand]).sort());
      for (const [action,p] of Object.entries(probs)) {
        actionSlots++;
        const frequency=refInfo.reach*p, localFrequency=localInfo.reach*ours.policy[history][hand][action];
        const externalEV=external.actionEV[history][hand][action];
        if (frequency>=.01) {
          assert(Number.isFinite(externalEV) && Number.isFinite(refInfo.action_ev[action]));
          samePolicy.push({history,hand,action,external_reach:frequency,external_ev:externalEV,
            replay_ev:refInfo.action_ev[action],delta:Math.abs(externalEV-refInfo.action_ev[action])});
        }
        if (Math.min(frequency,localFrequency)>=.01) {
          crossPolicy.push({history,hand,action,external_reach:frequency,local_reach:localFrequency,
            external_ev:externalEV,local_ev:localInfo.action_ev[action],delta:Math.abs(externalEV-localInfo.action_ev[action])});
        }
      }
    }
  }
  const same=errorStats(samePolicy), cross=errorStats(crossPolicy);
  // Compare values computed on identical strategies more tightly than two approximate equilibria.
  assert(same.maximum_absolute_chips<=.01,'Action value mismatch on replay: '+JSON.stringify(same.worst));
  for (const seat of [0,1]) assert(Math.abs(external.rootEV[seat]-replay.root_ev[seat])<=.001);
  assert(Math.abs(external.exploitability-replay.exploitability)<=.001);
  assert(replay.pot_fraction<=.001,'Independent BR rejects external strategy');
  const interval=e=>[e.root_ev[0]-e.gains[1],e.root_ev[0]+e.gains[0]];
  const localInterval=interval(ours.evaluation), externalInterval=interval(replay);
  assert(Math.max(localInterval[0],externalInterval[0]) <= Math.min(localInterval[1],externalInterval[1])+.001,
    'The two certified root game-value intervals do not overlap');
  return {fixture,fixture_sha256:hash(bytes),histories:Object.keys(external.policy).length,action_slots:actionSlots,
    local:{iterations:ours.iterations,root_ev:ours.evaluation.root_ev,exploitability:ours.evaluation.exploitability,
      oop_game_value_interval:localInterval},
    external:{iterations:external.iterations,root_ev:external.rootEV,exploitability:external.exploitability},
    replay_external_policy:{root_ev:replay.root_ev,exploitability:replay.exploitability,pot_fraction:replay.pot_fraction,
      oop_game_value_interval:externalInterval,high_reach_action_evs:same},
    cross_solver:{root_ev_abs_delta_chips:Math.abs(ours.evaluation.root_ev[0]-external.rootEV[0]),high_reach_action_evs:cross}};
}

const {values}=parseArgs({options:{assets:{type:'string'},output:{type:'string'}}});
const Manager=loadExternal(values.assets || path.join(root,'.work','river-oracle'));
const report={status:'passed',reference:'b-inary/wasm-postflop (upstream Rust postflop-solver)',
  source:'https://github.com/b-inary/wasm-postflop',published_assets:assets,node:process.version,
  units:'All EVs and exploitability in chips; pot_fraction normalized by root pot.',
  high_reach:'Unconditional information-set reach times action probability >= 0.01. Cross-profile sample requires this under both profiles.',
  checks:['identical root hand weights, private hands, and action sets at every public history','independent best response of exported external policy',
    'same-policy EV tolerances: 0.001 chips at root, 0.01 on high-reach actions','overlap of independent root game-value intervals'],
  benchmarks:['gto_river_small_v1.json','gto_river_weighted_v1.json'].map(fixture=>compare(Manager,fixture))};
const output=JSON.stringify(report,null,2)+'\n';
if (values.output) fs.writeFileSync(values.output,output); else process.stdout.write(output);
