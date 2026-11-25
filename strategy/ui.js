(() => {
  "use strict";
  const $ = name => document.getElementById("gto-"+name);
  const ranks = "AKQJT98765432", suits = {s:"♠",h:"♥",c:"♣",d:"♦"};
  const oop = ["As Qs","Ah Qh","Qc Jc","8c 8d","7c 7d","Kc Jd","Ac Kd","6c 5c"];
  const ip = ["Kh Qh","Ad Qc","8h 7s","2c 2d","Ah Kh","Jc Tc","9d 6d","Ks Js"];
  const key = "river-notes.strategy.checkpoint.v1", target = .001;
  let job = null, timer = null, pausing = "", saved = null, result = null, editing = null;
  let queryInsights = null, currentInsight = null;
  let selection = {board:[],oop:[],ip:[]};
  function node(tag,text) {const n=document.createElement(tag);n.textContent=text;return n;}
  function tokens(value) {return value.trim().split(/[\s,，、]+/u).filter(Boolean);}
  function card(value) {
    if (!/^[2-9TJQKA][cdhs]$/i.test(value)) throw Error("牌码格式有误，请使用 As、Td 等两字符记法。");
    return value[0].toUpperCase()+value[1].toLowerCase();
  }
  function number(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
    const n=Number(value);
    if (!value.trim() || !Number.isSafeInteger(n) || n<minimum || n>maximum) throw Error(label+"超出合法整数范围。");
    return n;
  }
  function weightOf(value) {
    const n=Number(value);
    if (!String(value).trim() || !Number.isFinite(n) || n<0 || n>1) throw Error("权重应为 0 至 1 的数值。");
    return n;
  }
  function copyRange(rows) {
    return rows.map(row=>({cards:row.cards.map(card),weight:weightOf(row.weight)}));
  }
  function modelFromForm() {
    const board=selection.board.slice();
    if (board.length!==5 || new Set(board).size!==5) throw Error("河牌需要五张各不相同的公共牌。");
    const pot=number($("pot").value,"底池",1), stack=number($("stack").value,"筹码",1);
    const opens=tokens($("opens").value).map(x=>number(x,"首注",1,stack));
    const raises={};
    for (const entry of tokens($("raises").value)) {
      const pair=entry.split(/[:：]/);
      if (pair.length!==2) throw Error("加注格式应为「首注:加到」。");
      const from=number(pair[0],"首注",1,stack), to=number(pair[1],"加到金额",1,stack);
      if (Object.prototype.hasOwnProperty.call(raises,from)) throw Error("每种首注只允许一个加到金额。");
      raises[from]=[to];
    }
    return {board,root_pot:pot,remaining_stacks:{oop:stack,ip:stack},
      oop_range:copyRange(selection.oop),ip_range:copyRange(selection.ip),
      betting_model:{first_player:"oop",open_bets:opens,raise_to_after_open:raises,
        max_raises_per_path:1,check_check:"showdown",facing_all_in:["fold","call"],
        uncalled_amounts:"returned",rake:0}};
  }
  function setModel(model) {
    selection={board:model.board.map(card),oop:copyRange(model.oop_range),ip:copyRange(model.ip_range)};
    paintSelection();
    $("pot").value=model.root_pot;$("stack").value=model.remaining_stacks.oop;
    const bets=model.betting_model;
    $("opens").value=bets.open_bets.join(" ");
    $("raises").value=Object.entries(bets.raise_to_after_open || {}).flatMap(([open,values])=>values.map(to=>open+":"+to)).join(" ");
  }
  function loadPreset(which) {
    const weighted=which==="weighted";
    const range=(source,first)=>source.map((hand,i)=>({cards:hand.split(" "),weight:i===0&&weighted?first:1}));
    setModel({board:["Qd","8s","2s","7h","3c"],root_pot:100,remaining_stacks:{oop:100,ip:100},
      oop_range:range(oop,.25),ip_range:range(ip,.5),betting_model:{open_bets:[50,100],raise_to_after_open:{50:[100]}}});
    $("preset").value=which;
  }
  function note(text="") { $("feedback").textContent=text;$("feedback").hidden=!text; }
  const pct = n=>Number.isFinite(n)?(n*100).toFixed(4)+"%":"—";
  const chips = n=>Number.isFinite(n)?n.toFixed(4):"—";
  function message(status,badge) { $("status").textContent=status;$("badge").textContent=badge; }
  function sameModel() {
    if (!saved) return false;
    try {return JSON.stringify(saved.model)===JSON.stringify(modelFromForm());} catch {return false;}
  }
  function controls() {
    const running=!!job, matches=sameModel();
    $("run").disabled=running;$("pause").hidden=!running;$("pause").disabled=!!pausing;
    $("cancel").hidden=!running;$("resume").hidden=running || !matches;
    $("load").hidden=running || !saved || matches;
  }
  function stop() {
    const previous=job;job=null;pausing="";clearTimeout(timer);
    if (previous) previous.cancel();
  }
  function clearResult(text="选择基准或编辑局面后开始求解。") {
    stop();result=null;queryInsights=null;currentInsight=null;$("results").hidden=true;
    $("hand").replaceChildren();$("recommendation").hidden=true;
    $("responses").replaceChildren();$("response-size").replaceChildren();
    $("readout").removeAttribute("data-state");
    for (const name of ["error","chips","algorithm","iterations","root-ev"]) $(name).textContent="—";
    message(text,"待求解");note();controls();
  }
  function edited() {$("preset").value="custom";clearResult("局面已变更，请重新求解。");}
  function actionText(action) {
    const [kind,amount]=action.split(":");
    const labels={check:"过牌",fold:"弃牌",call:"跟注",bet:"下注",raise:"加到"};
    return (labels[kind] || kind)+(amount===undefined?"":" "+amount);
  }
  function historyText(history) {
    if (history==="root") return "河牌开始 · 先行动方先表态";
    return history.split("/").map((move,i)=>(i%2?"后行动方":"先行动方")+actionText(move)).join(" → ");
  }
  function classFor(hand) {
    const [a,b]=hand.split(" "), x=a[0],y=b[0];
    if (x===y) return x+y;
    return (ranks.indexOf(x)<ranks.indexOf(y)?x+y:y+x)+(a[1]===b[1]?"s":"o");
  }
  const rankFace = c => c[0] === "T" ? "10" : c[0];
  function prettyHand(hand) {return hand.split(" ").map(c=>rankFace(c)+suits[c[1]]).join(" ");}
  const compactNumber=new Intl.NumberFormat("zh-CN",{maximumFractionDigits:2});
  function quantity(n) {
    if (!Number.isFinite(n)) return "—";
    return n>0 && n<.005?"<0.01":compactNumber.format(n);
  }
  function percent(n) {return Number.isFinite(n)?quantity(n*100)+"%":"—";}
  function paragraph(text,style) {
    const p=node("p",text);
    p.className=style;
    return p;
  }
  function paintEquities(stats) {
    const labels={win:"独赢",tie:"平局",loss:"输牌",equity:"底池权益"};
    $("equity-breakdown").replaceChildren(...Object.entries(labels).map(([key,label])=>{
      const item=document.createElement("div");
      item.dataset.stat=key;item.append(node("dt",label),node("dd",percent(stats?.[key])));
      return item;
    }));
  }
  function actionCard(move) {
    const card=document.createElement("article");
    card.dataset.action=move.action;
    card.append(node("h4",actionText(move.action)),
      paragraph("本次投入 "+quantity(move.amount)+" 筹码，占当前底池 "+percent(move.potFraction),"size-amount"),
      paragraph("采用 "+percent(move.frequency),"size-frequency"),
      paragraph(move.gap===null?"平均收益差 —":move.gap===0?"平均收益最高":"平均少拿 "+quantity(move.gap)+" 筹码","size-gap"));
    return card;
  }
  function recommendation(moves) {
    const ranked=moves.slice().sort((a,b)=>b.frequency-a.frequency);
    const [first,second]=ranked;
    if (second && second.frequency>=.1)
      return "模型常用"+actionText(first.action)+"（"+percent(first.frequency)+"）和"+actionText(second.action)+
        "（"+percent(second.frequency)+"），两者的平均收益相差 "+quantity(Math.abs(first.ev-second.ev))+" 筹码。";
    return "模型最常选"+actionText(first.action)+"，采用频率为 "+percent(first.frequency)+"。";
  }
  function responseGroup(label,fraction,contributors) {
    const group=document.createElement("div");
    group.className="response-group";
    group.append(node("strong",label+"  "+percent(fraction)));
    if (contributors?.length) {
      const hands=contributors.map(item=>prettyHand(item.hand)+" "+percent(item.share)).join("、");
      group.append(node("small","占这次回应的比重："+hands));
    }
    return group;
  }
  function paintReplies() {
    const size=$("response-size").value;
    const branch=currentInsight.responses[size];
    const panel=$("responses");
    panel.replaceChildren();
    if (!branch) return;
    if (!branch.reachable) {
      panel.append(paragraph("这手牌按当前策略不会走到这条下注分支，无法统计对手的回应。","hint"));
      return;
    }
    for (const reply of branch.replies) {
      const continues=reply.action!=="fold";
      const row=document.createElement(continues?"details":"div");
      row.dataset.response=reply.action;
      row.className="response-row";
      const label=node(continues?"summary":"span",actionText(reply.action));
      const frequency=node("span",percent(reply.frequency));
      frequency.className="response-frequency";label.append(frequency);row.append(label);
      if (continues) {
        if (!reply.frequency) row.append(paragraph("这个回应的概率为零，没有可统计的对手组合。","hint"));
        else for (const [key,title] of Object.entries({stronger:"比你强",tie:"与你打平",weaker:"比你弱"})) {
          const group=reply.groups[key];
          row.append(responseGroup(title,group.fraction,group.top));
        }
      }
      panel.append(row);
    }
  }
  function paintReadout(view) {
    const final=result.status==="converged" && result.evaluation.pot_fraction<=result.target;
    const ready=final && view.reachable;
    $("readout").dataset.state=view.reachable?(final?"ready":"approximate"):"unreachable";
    $("actor").textContent=(view.actor==="oop"?"先行动方（OOP）":"后行动方（IP）")+"行动 · "+prettyHand($("hand").value);
    $("recommendation").hidden=!ready;
    $("recommendation").textContent=ready?recommendation(view.actions):"";
    const notices=[];
    if (!final) notices.push("当前是阶段估计，实测模型误差为起始底池的 "+pct(result.evaluation.pot_fraction)+"，目标为 "+percent(result.target)+"。");
    if (!view.reachable) notices.push(view.blocked?
      "这手牌没有可达的对手组合。排除与公共牌、这手牌冲突的牌后，对手范围里没有剩余组合。":
      "这手牌无法到达当前节点。此前行动中至少有一步，使这手牌与所有相容对手组合走到这里的概率为零。");
    $("interpretation-note").textContent=notices.join(" ");
    $("interpretation-note").hidden=!notices.length;
    $("decision-context").textContent="当前底池有 "+quantity(view.pot)+" 筹码。"+
      (view.toCall?"":"你可以免费过牌。");
    $("pot-odds").textContent=view.toCall?
      "跟注还需补 "+quantity(view.toCall)+"，跟注后底池共 "+quantity(view.finalPot)+"。打平需要 "+
      percent(view.threshold)+" 权益（"+quantity(view.toCall)+" ÷ "+quantity(view.finalPot)+"）。":"";
    paintEquities(view.showdown);
    $("size-comparison").replaceChildren(...view.actions.map(actionCard));
    const mix=$("range-mix");mix.replaceChildren();
    if (!view.rangeReach) mix.textContent="双方范围都走不到这个节点，无法统计行动频率。";
    else for (const [action,frequency] of Object.entries(view.rangeMix)) {
      const item=node("span",actionText(action)+" "+percent(frequency));
      item.dataset.action=action;mix.append(item);
    }
    const choose=$("response-size"), previous=choose.value, sizes=Object.keys(view.responses);
    choose.replaceChildren(...sizes.map(a=>new Option(actionText(a),a)));
    if (sizes.includes(previous)) choose.value=previous;
    $("response-panel").hidden=sizes.length===0;
    paintReplies();
  }
  function paintActions() {
    const history=$("history").value, hand=$("hand").value;
    for (const button of $("matrix").children) button.setAttribute("aria-pressed",String(button.dataset.class===classFor(hand)));
    currentInsight=queryInsights(history,hand);
    paintReadout(currentInsight);
    const info=result.evaluation.infos[history]?.[hand];
    const actions=result.policy[history]?.[hand] || {};
    const weights=info && info.reach>0;
    $("reach").textContent=weights?"该信息集到达概率 "+pct(info.reach):"该信息集的到达概率为零，行动值未定义。";
    $("actions").replaceChildren(...Object.entries(actions).map(([action,frequency])=>{
      const row=document.createElement("tr");
      row.dataset.action=action;
      row.append(node("td",actionText(action)),node("td",weights?pct(frequency):"—"),
        node("td",weights?chips(info.action_ev[action]):"—"));
      return row;
    }));
  }
  function paintHistory() {
    const history=$("history").value;
    const previous=$("hand").value;
    const hands=Object.keys(result.policy[history]);
    const reached=hand=>result.evaluation.infos[history][hand].reach>0;
    $("hand").replaceChildren(...hands.map(hand=>new Option(prettyHand(hand),hand)));
    $("hand").value=hands.includes(previous)?previous:(hands.find(reached)||hands[0]);
    const classes=new Map();
    for (const hand of hands) {const c=classFor(hand);classes.set(c,(classes.get(c)||0)+1);}
    const cells=document.createDocumentFragment();
    for (const [i,x] of Array.from(ranks).entries()) {
      for (const [j,y] of Array.from(ranks).entries()) {
        const c=i===j?x+y:i<j?x+y+"s":y+x+"o";
        const b=node("button",c);b.type="button";b.dataset.class=c;b.disabled=!classes.has(c);
        b.setAttribute("aria-label",c+" · "+(classes.get(c)||0)+" 个组合");
        b.onclick=()=>{
          if (classFor($("hand").value)!==c) {
            const matches=hands.filter(h=>classFor(h)===c);
            $("hand").value=matches.find(reached)||matches[0];
          }
          paintActions();
        };cells.append(b);
      }
    }
    $("matrix").replaceChildren(cells);paintActions();
  }
  function display(value, status, badge) {
    result=value;queryInsights=createRiverInsights(value);
    const evaluation=value.evaluation;
    $("error").textContent=pct(evaluation.pot_fraction);$("chips").textContent=chips(evaluation.exploitability)+" 筹码";
    $("algorithm").textContent=value.algorithm;$("iterations").textContent=value.iterations.toLocaleString("zh-CN");
    $("root-ev").textContent=evaluation.root_ev.map(chips).join(" / ");
    const paths=Object.keys(value.policy).sort((a,b)=>{
      const depth=x=>x==="root"?0:x.split("/").length;
      return depth(a)-depth(b) || a.localeCompare(b);
    });
    $("history").replaceChildren(...paths.map(path=>new Option(historyText(path),path)));
    $("history").value="root";$("results").hidden=false;paintHistory();message(status,badge);
  }
  function pause(reason) {
    if (!job || pausing) return;
    pausing=reason;clearTimeout(timer);controls();message("正在记录当前迭代与独立误差…","保存中");job.pause();
  }
  function discardSavedIfMatched() {
    if (!sameModel()) return;
    saved=null;
    try {localStorage.removeItem(key);} catch {note("浏览器未允许移除已完成局面的旧检查点。");}
  }
  function start(resume) {
    let model,limit,time;
    try {
      model=modelFromForm();
      limit=number($("limit").value,"迭代上限",1,10000000);time=number($("seconds").value,"时限（秒）",1,86400);
      if (resume && !sameModel()) throw Error("请先载入对应的暂停局面。");
    } catch (e) {note(e.message);return;}
    clearResult();
    message(resume?"从已保存迭代继续。":"开始构建河牌行动树。","求解中");
    try {
      job=RiverRunner.start(model,{target,maxIterations:limit,checkpoint:resume?saved.checkpoint:undefined},msg=>{
        if (!job || msg.requestId!==job.requestId) return;
        if (msg.type==="progress") {
          $("iterations").textContent=msg.iterations.toLocaleString("zh-CN");
          $("error").textContent=pct(msg.pot_fraction);
          if (!pausing) message(msg.measuredIterations!=null?"上次独立验算于第 "+msg.measuredIterations+" 轮。":"正在等待首次独立验算。","求解中");
          return;
        }
        const reason=pausing;job=null;pausing="";clearTimeout(timer);
        if (msg.type==="paused") {
          saved={model,checkpoint:msg.checkpoint,maxIterations:limit,seconds:time,preset:$("preset").value};
          let persisted=true;
          try {localStorage.setItem(key,JSON.stringify(saved));} catch {persisted=false;}
          const timed=reason==="timeout";
          display(msg.result,timed?"达到时限，当前策略尚未达标。":"已暂停，可从当前迭代继续。",timed?"超时未达标":"已暂停");
          if (!persisted) note("浏览器未能保存检查点；本次页面仍可继续，关闭后将丢失。");
        } else if (msg.type==="result") {
          const converged=msg.result.status==="converged";
          display(msg.result,converged?"独立最佳响应已验证目标误差。":"达到迭代上限，当前策略尚未达标。",converged?"已达标":"迭代未达标");
          if (converged) discardSavedIfMatched();
        } else if (msg.type==="error") {
          const messages={EMPTY_JOINT_RANGE:"双方没有互不冲突的有效手牌配对。",EMPTY_EFFECTIVE_RANGE:"至少一方没有可用的正权重组合。"};
          message("求解失败，请检查输入。","失败");note(messages[msg.message]||msg.message);
        } else message("已取消本次求解。","已取消");
        controls();
      });
      timer=setTimeout(()=>pause("timeout"),time*1000);controls();
    } catch(e) {clearResult();message("无法启动本地求解。","失败");note(e.message);}
  }

  function loadCheckpoint() {
    if (!saved) return;
    setModel(saved.model);$("preset").value=saved.preset;
    $("limit").value=saved.maxIterations;$("seconds").value=saved.seconds;
    clearResult("已载入检查点，可继续上次求解。");$("iterations").textContent=String(saved.checkpoint.iterations);
  }
  function cardButton(c, label, handler) {
    const b=node("button","");b.type="button";b.className="card";
    if(c) {b.append(node("b",rankFace(c)),node("span",suits[c[1]]));if ("hd".includes(c[1])) b.classList.add("red");}
    else {b.textContent="+";b.classList.add("blank");}
    b.setAttribute("aria-label",label);b.onclick=handler;return b;
  }
  function paintSelection() {
    $("board").replaceChildren(...selection.board.map((c,i)=>{
      const button=cardButton(c,"更换第 "+(i+1)+" 张公共牌 "+c,()=>edit("board",i));
      button.dataset.card=c;
      if (i===0) button.id="gto-board-pick";
      return button;
    }));
    for (const side of ["oop","ip"]) {
      const buttons=selection[side].map((row,i)=>{
        const hand=row.cards.join(" ");
        const button=node("button","");button.type="button";button.className="hand-chip";
        button.dataset.hand=hand;button.dataset.weight=row.weight;
        row.cards.forEach(c=>{
          const face=node("span",rankFace(c)+suits[c[1]]);
          if ("hd".includes(c[1])) face.className="red";
          button.append(face);
        });
        const blocked=row.cards.some(c=>selection.board.includes(c));
        button.append(node("small",blocked?"已阻挡":"×"+row.weight));
        button.setAttribute("aria-label","编辑 "+side.toUpperCase()+" "+prettyHand(hand)+"，权重 "+row.weight+(blocked?"，已阻挡":""));
        button.onclick=()=>edit(side,i);
        return button;
      });
      $(side).replaceChildren(...buttons);
    }
  }
  function paintEditor() {
    const e=editing;
    const slots=document.createDocumentFragment();
    for (let i=0;i<e.limit;i++) {
      const b=cardButton(e.cards[i],"编辑第 "+(i+1)+" 张",()=>{e.slot=i;paintEditor();});
      b.disabled=i>e.cards.length;b.setAttribute("aria-pressed",String(i===e.slot));slots.append(b);
    }
    $("picker-slots").replaceChildren(slots);
    const deck=document.createDocumentFragment();
    for(const s of Object.keys(suits)) for(const r of ranks) {
      const c=r+s,b=cardButton(c,prettyHand(c),()=>{e.cards[e.slot]=c;e.slot=Math.min(e.slot+1,e.limit-1);paintEditor();});
      b.dataset.card=c;b.disabled=e.cards.includes(c)||e.blocked.has(c);
      b.setAttribute("aria-pressed",String(c===e.cards[e.slot]));deck.append(b);
    }
    $("deck").replaceChildren(deck);$("delete-row").hidden=e.group==="board"||e.row<0;
  }
  function selectEditorRow() {
    const e=editing;e.row=Number($("edit-row").value);e.slot=0;
    e.cards=e.row<0?[]:e.rows[e.row].cards.slice();$("edit-weight").value=e.row<0?1:e.rows[e.row].weight;
    paintEditor();
  }
  function edit(group,index=-1) {
    const board=group==="board";
    try {
      const cards=selection.board;
      editing={group,row:-1,slot:board?index:0,cards:board?cards.slice():[],limit:board?5:2,blocked:new Set(board?[]:cards)};
      if (!board) {
        editing.rows=copyRange(selection[group]);
        $("edit-row").replaceChildren(new Option("新增组合","-1"),...editing.rows.map((x,i)=>new Option(prettyHand(x.cards.join(" ")),i)));
        $("edit-row").value=String(index);
        selectEditorRow();
      }
      $("picker-title").textContent=board?"选择河牌公共牌":"编辑 "+group.toUpperCase()+" 范围";
      $("picker-range").hidden=board;$("picker-error").textContent="";paintEditor();$("picker").showModal();
    } catch(e) {note(e.message);}
  }
  function applyEdit(remove=false) {
    const e=editing;
    try {
      if (remove) e.rows.splice(e.row,1);
      else {
        if (e.cards.length!==e.limit) throw Error("请补全选中的牌。");
        if (e.group==="board") selection.board=e.cards.slice();
        else {
          const next={cards:e.cards.slice(),weight:weightOf($("edit-weight").value)};
          if (e.rows.some((row,i)=>i!==e.row && next.cards.every(c=>row.cards.includes(c)))) throw Error("范围中已有这个组合。");
          if (e.row<0) e.rows.push(next);
          else e.rows[e.row]=next;
        }
      }
      if (e.group!=="board") selection[e.group]=e.rows;
      $("picker").close();paintSelection();edited();
      const next=e.group==="board"?$("board").children[e.slot]:$(e.group).children[Math.min(e.row, e.rows.length-1)];
      (next||$(e.group+"-pick")).focus();
    } catch(error) {$("picker-error").textContent=error.message;}
  }

  $("form").onsubmit=event=>{event.preventDefault();start(false);};
  for (const name of ["pot","stack","opens","raises"]) $(name).oninput=edited;
  $("preset").onchange=()=>{loadPreset($("preset").value);clearResult();};
  $("limit").oninput=$("seconds").oninput=()=>clearResult("求解预算已变更。");
  $("pause").onclick=()=>pause("manual");
  $("cancel").onclick=()=>{clearResult();message("已取消本次求解。","已取消");};
  $("resume").onclick=()=>start(true);$("load").onclick=loadCheckpoint;
  $("history").onchange=paintHistory;$("hand").onchange=paintActions;
  $("response-size").onchange=paintReplies;
  for (const group of ["oop","ip"]) $(group+"-pick").onclick=()=>edit(group);
  for (const w of [0,.25,.5,.75,1]) {
    const button=node("button",w*100+"%");button.type="button";button.className="secondary";
    button.onclick=()=>{$("edit-weight").value=w;};
    $("weights").append(button);
  }
  $("edit-row").onchange=selectEditorRow;$("picker-close").onclick=()=>$("picker").close();
  $("picker-apply").onclick=()=>applyEdit();$("delete-row").onclick=()=>applyEdit(true);
  loadPreset("equal");
  try {
    const text=localStorage.getItem(key);
    if (text) {
      const entry=JSON.parse(text);
      if (!entry || !entry.model || !entry.checkpoint || !Number.isSafeInteger(entry.checkpoint.iterations)) throw Error();
      saved=entry;loadCheckpoint();
    }
  } catch {saved=null;loadPreset("equal");note("未能读取本机检查点，当前仍可开始新求解。");}
  controls();
})();
