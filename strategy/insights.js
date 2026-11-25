/* Conditional reads of one measured river policy. Chip amounts use the solver's river origin. */
function createRiverInsights(result) {
  const {model,policy,evaluation}=result;
  const engine=typeof createPokerEngine==="function"?createPokerEngine():require("../web/equity.js")();
  const board=model.board.map(c=>engine.cards.indexOf(c));
  const players=[model.oop_range,model.ip_range].map(range=>{
    const hands=new Map();
    for (const {cards,weight} of range) {
      const ids=cards.map(c=>engine.cards.indexOf(c)).sort((a,b)=>a-b);
      if (!weight || ids.some(id=>board.includes(id))) continue;
      const key=ids.map(id=>engine.cards[id]).join(" ");
      hands.set(key,{key,ids,weight,score:engine.score(ids,board)});
    }
    return hands;
  });
  const nodes=new Map();
  function getNode(history) {
    if (nodes.has(history)) return nodes.get(history);
    const paid=[0,0], line=[];
    let seat=0, path="root";
    for (const action of history==="root"?[]:history.split("/")) {
      line.push({path,seat,action});
      if (action.includes(":")) paid[seat]=Number(action.split(":")[1]);
      path=path==="root"?action:path+"/"+action;
      seat=1-seat;
    }
    const pot=model.root_pot+paid[0]+paid[1], toCall=paid[1-seat]-paid[seat];
    const infos=evaluation.infos[history], rows=policy[history];
    const rangeReach=Object.values(infos).reduce((s,row)=>s+row.reach,0);
    const moves=Object.keys(Object.values(rows)[0]);
    const rangeMix={};
    for (const move of moves) {
      let mass=0;
      for (const [hand,row] of Object.entries(rows)) mass+=infos[hand].reach*row[move];
      rangeMix[move]=rangeReach?mass/rangeReach:null;
    }
    // For a fixed hero hand, the hero's prior choices have the same probability
    // for every opponent. Only the opponent's own prior choices affect this ratio.
    const opponents=[];
    for (const hand of players[1-seat].values()) {
      let logWeight=Math.log(hand.weight);
      for (const step of line) if (step.seat!==seat)
        logWeight+=Math.log(policy[step.path][hand.key][step.action]);
      if (Number.isFinite(logWeight)) opponents.push({hand,logWeight});
    }
    const context={seat,paid,pot,toCall,rangeReach,rangeMix,moves,opponents};
    nodes.set(history,context);
    return context;
  }
  function repliesFor(path,opponents,total,reached) {
    if (!reached) return {reachable:false,replies:[]};
    const rows=policy[path];
    const replies=Object.keys(Object.values(rows)[0]).map(action=>{
      const groups={stronger:{fraction:0,top:[]},tie:{fraction:0,top:[]},weaker:{fraction:0,top:[]}};
      let mass=0;
      for (const {key,relation,weight} of opponents) {
        const part=weight*rows[key][action];
        mass+=part;
        if (part>0 && action!=="fold") {
          const group=groups[relation];
          group.fraction+=part;
          group.top.push({hand:key,share:part});
        }
      }
      for (const group of Object.values(groups)) {
        group.fraction=mass?group.fraction/mass:null;
        group.top.sort((a,b)=>b.share-a.share || a.hand.localeCompare(b.hand));
        group.top=group.top.slice(0,3).map(item=>({hand:item.hand,share:item.share/mass}));
      }
      return {action,frequency:mass/total,groups};
    });
    return {reachable:true,replies};
  }
  return function query(history,hand) {
    const n=getNode(history), hero=players[n.seat].get(hand);
    const info=evaluation.infos[history][hand], strategy=policy[history][hand];
    const reachable=info.reach>0, responses={}, actions=[];
    const compatible=n.opponents.filter(({hand:h})=>!h.ids.some(id=>hero.ids.includes(id)));
    const maxLog=compatible.reduce((max,x)=>Math.max(max,x.logWeight),-Infinity);
    const opponents=compatible.map(({hand:h,logWeight})=>({
      key:h.key,relation:h.score>hero.score?"stronger":h.score===hero.score?"tie":"weaker",
      weight:Math.exp(logWeight-maxLog)
    }));
    const mass={stronger:0,tie:0,weaker:0};
    for (const {weight,relation} of opponents) mass[relation]+=weight;
    const total=mass.stronger+mass.tie+mass.weaker;
    const showdown=reachable && total?{win:mass.weaker/total,tie:mass.tie/total,loss:mass.stronger/total,
      equity:(mass.weaker+mass.tie/2)/total}:null;
    const best=reachable?Math.max(...Object.values(info.action_ev)):null;
    for (const action of n.moves) {
      const aggressive=action.includes(":");
      const amount=aggressive?Number(action.split(":")[1])-n.paid[n.seat]:action==="call"?n.toCall:0;
      actions.push({action,amount,potFraction:amount/n.pot,frequency:reachable?strategy[action]:null,
        ev:info.action_ev[action],gap:reachable?best-info.action_ev[action]:null});
      if (aggressive) {
        const child=history==="root"?action:history+"/"+action;
        responses[action]=repliesFor(child,opponents,total,reachable && total>0 && strategy[action]>0);
      }
    }
    const blocked=!reachable && !Array.from(players[1-n.seat].values()).some(h=>!h.ids.some(id=>hero.ids.includes(id)));
    return {actor:n.seat===0?"oop":"ip",reachable,blocked,pot:n.pot,toCall:n.toCall,finalPot:n.pot+n.toCall,
      threshold:n.toCall?n.toCall/(n.pot+n.toCall):null,showdown,actions,
      rangeReach:n.rangeReach,rangeMix:n.rangeMix,responses};
  };
}
if (typeof module!=="undefined" && module.exports) module.exports=createRiverInsights;
