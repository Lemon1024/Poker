/* Independent reference evaluator. Its only inputs are the model and the exported policy. */
function evaluateRiverPolicy(model, policy) {
  const fail = (code, detail) => { const e = new Error(code + ': ' + detail); e.code = code; throw e; };
  const invalid = why => fail('INVALID_REQUEST', why);
  const ranks = '23456789TJQKA', suits = 'cdhs';
  const id = c => ranks.indexOf(c[0])*4 + suits.indexOf(c[1]);
  const validCard = c => typeof c === 'string' && /^[2-9TJQKA][cdhs]$/.test(c);
  const pairKey = cards => cards.slice().sort((a,b) => id(a)-id(b)).join(' ');
  const kuhn = model?.kind === 'kuhn';
  if (!model || typeof model !== 'object') invalid('model required');
  if (!kuhn && model.kind !== undefined && model.kind !== 'river') invalid('unknown model');
  function validateCards(cards, n) {
    if (!Array.isArray(cards) || cards.length !== n || !cards.every(validCard) || new Set(cards).size !== n) {
      invalid('invalid or repeated cards');
    }
  }
  // Evaluate exactly five cards from a histogram and sorted kickers. Choose the
  // strongest of the 21 five-card subsets on a completed board.
  function five(cards) {
    const values = cards.map(c=>ranks.indexOf(c[0])+2).sort((a,b)=>b-a);
    const histogram = new Map();
    for (const v of values) histogram.set(v,(histogram.get(v)||0)+1);
    const groups = [...histogram].sort((a,b)=>b[1]-a[1] || b[0]-a[0]);
    const sameSuit=cards.every(c=>c[1]===cards[0][1]);
    let straight=0;
    if (groups.length===5) {
      if (values[0]-values[4]===4) straight=values[0];
      else if (values.join(',')==='14,5,4,3,2') straight=5;
    }
    let category=0;
    if (straight && sameSuit) category=8;
    else if (groups[0][1]===4) category=7;
    else if (groups[0][1]===3 && groups[1][1]===2) category=6;
    else if (sameSuit) category=5;
    else if (straight) category=4;
    else if (groups[0][1]===3) category=3;
    else if (groups[1][1]===2) category=2;
    else if (groups[0][1]===2) category=1;
    const kickers=straight ? [straight] : groups.map(g=>g[0]);
    let packed=category;
    for (let i=0;i<5;i++) packed=packed*15+(kickers[i]||0);
    return packed;
  }
  function showdownScore(cards) {
    const seven=[...model.board,...cards];
    let score=-1;
    for (let omit1=0;omit1<6;omit1++) for (let omit2=omit1+1;omit2<7;omit2++) {
      score=Math.max(score,five(seven.filter((_,i)=>i!==omit1 && i!==omit2)));
    }
    return score;
  }
  function range(entries) {
    if (!Array.isArray(entries) || entries.length > 1326) invalid('invalid range');
    const seen=new Set(), included=[];
    for (const entry of entries) {
      validateCards(entry?.cards,2);
      const key=pairKey(entry.cards), weight=entry.weight;
      if (seen.has(key) || !Number.isFinite(weight) || weight<0 || weight>1) invalid('duplicate combo or invalid weight');
      seen.add(key);
      if (weight && !entry.cards.some(c=>model.board.includes(c))) {
        included.push({key, weight, cards:entry.cards, score:showdownScore(entry.cards)});
      }
    }
    if (!included.length) fail('EMPTY_EFFECTIVE_RANGE','no unblocked positive hand');
    if (included.length > 64) invalid('too many effective hands');
    return included;
  }
  if (!kuhn) validateCards(model.board,5);
  const kuhnCards=['J','Q','K'].map((key,score)=>({key,weight:1,score,cards:[key]}));
  const players=kuhn ? [kuhnCards,kuhnCards] : [range(model.oop_range),range(model.ip_range)];
  const pot=kuhn ? 2 : model.root_pot;
  const stacks=kuhn ? [1,1] : [model.remaining_stacks?.oop,model.remaining_stacks?.ip];
  const stack=Math.min(...stacks);
  if (![pot,...stacks].every(x=>Number.isSafeInteger(x) && x>0) ||
      stacks[0]!==stacks[1] || !Number.isSafeInteger(pot+2*stack)) invalid('pot or stacks');
  const betting=kuhn ? {open_bets:[1],max_raises_per_path:0} : model.betting_model;
  const opens=betting?.open_bets;
  if (!Array.isArray(opens) || opens.length<1 || opens.length>2 || new Set(opens).size!==opens.length ||
      opens.some(x=>!Number.isSafeInteger(x) || x<=0 || x>stack)) invalid('invalid bet sizes');
  const maxRaises=betting.max_raises_per_path ?? 1;
  if (betting.first_player!==undefined && betting.first_player!=='oop' ||
      betting.rake!==undefined && betting.rake!==0 ||
      betting.check_check!==undefined && betting.check_check!=='showdown' ||
      betting.uncalled_amounts!==undefined && betting.uncalled_amounts!=='returned' ||
      betting.facing_all_in!==undefined && !(Array.isArray(betting.facing_all_in) && betting.facing_all_in.length===2 &&
         betting.facing_all_in.includes('call') && betting.facing_all_in.includes('fold')) ||
      ![0,1].includes(maxRaises)) invalid('unsupported betting model');
  if (betting.raise_to_after_open!==undefined && betting.raise_to_after_bet_50!==undefined) invalid('ambiguous raises');
  const raises=betting.raise_to_after_open ?? (betting.raise_to_after_bet_50 ? {'50':betting.raise_to_after_bet_50} : {});
  if (!raises || typeof raises!=='object' || Array.isArray(raises)) invalid('raise mapping');
  for (const [open,targets] of Object.entries(raises)) {
    if (!opens.includes(Number(open)) || String(Number(open))!==open || !Array.isArray(targets) || targets.length>1 ||
        (targets.length && !maxRaises)) invalid('raise branch');
    for (const target of targets) {
      if (!Number.isSafeInteger(target) || target<=Number(open) || target>stack || (target<2*Number(open) && target!==stack)) invalid('raise amount');
    }
  }
  const deals=[];
  let weightSum=0;
  for (let a=0;a<players[0].length;a++) for (let b=0;b<players[1].length;b++) {
    const h=players[0][a], k=players[1][b];
    if (h.cards.some(c=>k.cards.includes(c))) continue;
    const weight=h.weight*k.weight;
    deals.push({hands:[a,b], weight, logWeight:Math.log(h.weight)+Math.log(k.weight), result:Math.sign(h.score-k.score)});
    weightSum+=weight;
  }
  if (!deals.length) fail('EMPTY_JOINT_RANGE','no compatible private hands');
  // Rare subnormal weights can underflow in their product. Normalize relatively
  // to preserve posterior probabilities even when the unscaled sum rounds to zero.
  let rootReach;
  if (deals.every(d=>d.weight>0)) rootReach=Float64Array.from(deals,d=>d.weight/weightSum);
  else {
    const max=deals.reduce((m,d)=>Math.max(m,d.logWeight),-Infinity);
    const scaled=deals.map(d=>Math.exp(d.logWeight-max));
    const sum=scaled.reduce((x,y)=>x+y);
    rootReach=Float64Array.from(scaled,p=>p/sum);
  }

  // Enumerate legal public histories explicitly. At a terminal, 'winner' is
  // either a known folding outcome or -1 for a private-card showdown.
  const terminal=(contributions,winner=-1)=>({contributions,winner});
  const infos={};
  function choice(path,actor,actions) {
    const table=policy?.[path];
    if (!table || typeof table!=='object') fail('INVALID_POLICY','missing history '+path);
    const names=Object.keys(actions);
    const probabilities=players[actor].map(hand=>{
      const row=table[hand.key];
      if (!row || typeof row!=='object' || Object.keys(row).length!==names.length ||
          !names.every(k=>Object.prototype.hasOwnProperty.call(row,k) && Number.isFinite(row[k]) && row[k]>=0 && row[k]<=1))
        fail('INVALID_POLICY','invalid actions for '+path+' '+hand.key);
      const total=names.reduce((n,k)=>n+row[k],0);
      if (Math.abs(total-1)>1e-8) fail('INVALID_POLICY','frequencies must sum to 1');
      return names.map(k=>row[k]/total);
    });
    return {path,actor,names,children:Object.values(actions),probabilities};
  }
  function opening(prefix,actor) {
    const next=action=>prefix ? prefix+'/'+action : action;
    const actions={check:prefix ? terminal([0,0]) : opening('check',1)};
    for (const size of opens) {
      const name='bet:'+size, history=next(name);
      const paid=[0,0]; paid[actor]=size;
      const responses={fold:terminal(paid,actor),call:terminal([size,size])};
      for (const target of raises[size] || []) {
        const total=[...paid]; total[1-actor]=target;
        const raiseName='raise:'+target;
        responses[raiseName]=choice(history+'/'+raiseName,actor,{
          fold:terminal(total,1-actor),call:terminal([target,target])
        });
      }
      actions[name]=choice(history,1-actor,responses);
    }
    return choice(prefix || 'root',actor,actions);
  }
  const tree=opening('',0);
  // Each traversal returns a continuation value *per hidden deal*. A BR's action
  // is chosen once per own-hand information set after summing over possible
  // opposing hands. Its own earlier action probabilities are removed from reach.
  function walk(node,reach,responding) {
    if (node.contributions) {
      const [a,b]=node.contributions, total=pot+a+b;
      return Float64Array.from(deals,deal=>{
        const share=node.winner<0 ? (deal.result+1)/2 : Number(node.winner===0);
        return total*share-a;
      });
    }
    const {actor,path,names,children,probabilities}=node;
    const choosing=actor===responding;
    const n=players[actor].length;
    const weighted=Array.from({length:n},()=>new Float64Array(names.length));
    const reachByHand=new Float64Array(n);
    for (let i=0;i<deals.length;i++) reachByHand[deals[i].hands[actor]]+=reach[i];
    const values=children.map((child,action)=>{
      const next=choosing ? reach : Float64Array.from(reach,(p,i)=>p*probabilities[deals[i].hands[actor]][action]);
      const result=walk(child,next,responding);
      for (let i=0;i<deals.length;i++) {
        const own=deals[i].hands[actor];
        weighted[own][action]+=reach[i]*(actor===0 ? result[i] : pot-result[i]);
      }
      return result;
    });
    if (responding===null) {
      infos[path]={};
      players[actor].forEach((hand,h)=>{
        const ev={};
        names.forEach((name,a)=>{ev[name]=reachByHand[h] ? weighted[h][a]/reachByHand[h] : null;});
        infos[path][hand.key]={reach:reachByHand[h],action_ev:ev};
      });
    }
    if (choosing) {
      const picks=weighted.map(row=>row.indexOf(Math.max(...row)));
      return Float64Array.from(deals,(deal,i)=>values[picks[deal.hands[actor]]][i]);
    }
    return Float64Array.from(deals,(deal,i)=>probabilities[deal.hands[actor]].reduce((sum,p,a)=>sum+p*values[a][i],0));
  }
  function firstSeatValue(responding) {
    const values=walk(tree,rootReach,responding);
    let ev=0;
    for (let i=0;i<deals.length;i++) ev+=rootReach[i]*values[i];
    return ev;
  }
  const v=firstSeatValue(null), root_ev=[v,pot-v];
  const best_response_ev=[firstSeatValue(0),pot-firstSeatValue(1)];
  const gains=best_response_ev.map((value,i)=>Math.max(0,value-root_ev[i]));
  const nash_conv=gains[0]+gains[1], exploitability=nash_conv/2;
  return {root_ev,best_response_ev,gains,nash_conv,exploitability,pot_fraction:exploitability/pot,
    infos,compatible_pairs:deals.length,weight_sum:weightSum};
}
if (typeof module!=='undefined' && module.exports) module.exports=evaluateRiverPolicy;
