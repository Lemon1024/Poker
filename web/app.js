(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const ranks = "AKQJT98765432";
  const symbols = {s:"♠",h:"♥",c:"♣",d:"♦"};
  const labels = {hero:"我的手牌",villain:"对手手牌",board:"公共牌"};
  const relations = {"1":"领先","0":"持平","-1":"落后"};
  const drafts = {
    fixed:{hero:["As","Ah"],villain:["Ks","Kh"]},
    range:{hero:["As","Qs"],board:["Qd","8s","2s","7h","3c"],range:"uniform",combos:[]}
  };
  const storageKey = "river-notes.history.v1";
  const pageSize = 25;
  let mode = "fixed";
  let active = null;
  let completed = null;
  let completedRequest = null;
  let lastComplete = null;
  let pageIndex = 0;
  let picking = null;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function showNote(message = "", info = false) {
    $("feedback").textContent = message;
    $("feedback").hidden = !message;
    $("feedback").classList.toggle("info",info);
  }
  const percent = number => (number*100).toFixed(2) + "%";
  const rankFace = card => card[0] === "T" ? "10" : card[0];
  const glyph = card => rankFace(card)+symbols[card[1]];
  function cardButton(card, name, handler) {
    const button = element("button",undefined,"card");
    button.type = "button";
    button.setAttribute("aria-label",name);
    if (card) {
      button.append(element("b",rankFace(card)),element("span",symbols[card[1]]));
      button.classList.toggle("red",card[1] === "h" || card[1] === "d");
    } else {
      button.textContent = "+";
      button.classList.add("blank");
    }
    button.addEventListener("click",handler);
    return button;
  }
  function paintSlots(holder, group, rowIndex) {
    const cards = group === "combo" ? drafts.range.combos[rowIndex].cards : drafts[mode][group];
    const label = group === "combo" ? "组合 "+(rowIndex+1) : labels[group];
    holder.replaceChildren();
    const slots = group === "board" ? 5 : 2;
    for (let i=0; i<slots; i++) {
      const card = cards[i];
      const name = label+"第 "+(i+1)+" 张";
      const button = cardButton(card,name+(card ? " "+glyph(card)+"，点击替换" : "，点击选牌"),() => {
        openPicker({cards,index:i,group,label:name,buttonId:button.id});
      });
      button.id = group+"-"+(rowIndex ?? "slot")+"-"+i;
      button.dataset.slot = String(i);
      button.dataset.card = card || "";
      button.title = card ? "替换 "+glyph(card) : "选择一张牌";
      button.setAttribute("aria-haspopup","dialog");
      holder.append(button);
    }
  }
  function paintCombos() {
    const container = $("range-list");
    container.replaceChildren();
    const known = [...drafts.range.hero,...drafts.range.board].filter(Boolean);
    drafts.range.combos.forEach((combo,i) => {
      const row = element("div",undefined,"range-row");
      const holder = element("div",undefined,"cards-preview");
      paintSlots(holder,"combo",i);
      const label = element("label","权重");
      const weight = element("input");
      weight.type="number"; weight.min="0"; weight.max="1"; weight.step="any";
      weight.value=combo.weight;
      weight.setAttribute("aria-label","组合 "+(i+1)+" 权重");
      weight.oninput = () => {combo.weight=weight.value; clearResult("范围已变更");};
      label.append(weight);
      const remove = element("button","删除","secondary");
      remove.type="button"; remove.dataset.removeCombo="";
      remove.setAttribute("aria-label","删除组合 "+(i+1));
      remove.onclick=() => {drafts.range.combos.splice(i,1);paintCombos();clearResult("范围已变更");};
      row.append(holder,label,remove);
      if (combo.cards.some(c => known.includes(c))) row.append(element("small","与已用牌冲突，计算时略过。","hint"));
      container.append(row);
    });
  }
  function requestFromForm() {
    const draft = drafts[mode];
    const hero = draft.hero.filter(Boolean);
    if (mode === "fixed") return {mode,hero,villain:draft.villain.filter(Boolean),board:[]};
    const request = {mode,hero,board:draft.board.filter(Boolean),range:draft.range};
    if (draft.range === "weighted") {
      request.rangeName = $("range-name").value.trim();
      request.rangeText = rangeTextFromEditor();
    }
    return request;
  }
  function rangeTextFromEditor() {
    return drafts.range.combos.map(({cards,weight},i) => {
      if (!cards[0] || !cards[1]) throw Error("请为组合 "+(i+1)+" 选齐两张牌，或将该组合删除。");
      if (weight === "" || !Number.isFinite(Number(weight)) || Number(weight)<0 || Number(weight)>1)
        throw Error("组合 "+(i+1)+" 的权重应在 0 至 1 之间。");
      return cards.join(" ")+" "+weight;
    }).join("\n");
  }
  function loadRangeText(text) {
    drafts.range.combos = text.split(/\r?\n/).filter(line => line.trim()).map(line => {
      const [first,second,weight="1"] = line.trim().split(/\s+/);
      return {cards:[first,second],weight};
    });
  }
  const rangesKey = "river-notes.ranges.v1";
  function readRanges() {
    const raw = window.RiverHistory ? window.RiverHistory.readRanges() : localStorage.getItem(rangesKey);
    return new Map(Object.entries(JSON.parse(raw || "{}")));
  }
  function listRanges() {
    const select = $("saved-range");
    select.replaceChildren(new Option("选择范围",""));
    try {
      for (const name of readRanges().keys()) select.add(new Option(name,name));
    } catch {showNote("无法读取已保存的范围。");}
  }
  function saveRange() {
    try {
      const name = $("range-name").value.trim();
      if (!name) throw Error("请填写范围名称。");
      const text = rangeTextFromEditor();
      if (!pokerEngine.readRange(text).some(row => row.weight > 0)) throw Error("范围至少需要一个正权重组合。");
      if (window.RiverHistory) {
        if (!window.RiverHistory.saveRange(name,text)) throw Error("范围写入失败。");
      } else {
        const saved = readRanges();
        saved.set(name,text);
        localStorage.setItem(rangesKey,JSON.stringify(Object.fromEntries(saved)));
      }
      listRanges();
      showNote("范围「"+name+"」已保存。",true);
    } catch (error) {showNote("保存失败："+error.message);}
  }
  function showInputs() {
    const fixed = mode === "fixed";
    const draft = drafts[mode];
    $("mode-fixed").setAttribute("aria-pressed",String(fixed));
    $("mode-range").setAttribute("aria-pressed",String(!fixed));
    $("villain-field").hidden = !fixed;
    $("board-field").hidden = fixed;
    $("range-field").hidden = fixed;
    $("swap").hidden = !fixed;
    paintSlots($("hero-preview"),"hero");
    if (fixed) {
      paintSlots($("villain-preview"),"villain");
    } else {
      paintSlots($("board-preview"),"board");
      $("range-kind").value = draft.range;
      $("weighted-field").hidden = draft.range !== "weighted";
      if (draft.range === "weighted") paintCombos();
    }
  }
  function setBusy(busy) {
    $("run").disabled = busy;
    $("cancel").hidden = !busy;
  }
  function clearResult(message = "准备就绪") {
    const previous = active;
    active = null;
    if (previous) previous.cancel();
    completed = null;
    completedRequest = null;
    setBusy(false);
    $("save").disabled = true;
    $("job-status").textContent = message;
    $("method").textContent = "等待计算";
    $("win-hero").textContent = "—";
    document.querySelectorAll("[data-prob]").forEach(node => { node.textContent = "—"; });
    $("donut").style.background = "";
    $("combos").hidden = true;
    $("rows").replaceChildren();
    $("range-summary").hidden = true;
    showNote();
  }
  function paintResult(result,request,status) {
    completed = result;
    completedRequest = request;
    $("method").textContent = result.method === "showdown" ? "河牌已确定" :
      result.method === "exact_turn" ? "转牌精确枚举" : "模拟估计";
    for (const key of ["win","tie","loss","equity"]) {
      document.querySelector('[data-prob="'+key+'"]').textContent = percent(result[key]);
    }
    $("win-hero").textContent = percent(result.win);
    const win = (result.win*100)+"%";
    const tied = ((result.win+result.tie)*100)+"%";
    $("donut").style.background = "conic-gradient(var(--win) 0 "+win+",var(--tie) "+win+" "+tied+",var(--loss) "+tied+" 100%)";
    $("job-status").textContent = status;
    $("save").disabled = false;
    $("combos").hidden = request.mode !== "range";
    pageIndex = 0;
    if (request.mode === "range") {
      const label = request.range === "uniform" ? "全部合法组合等概率" : request.rangeName || "自定义加权范围";
      let summary = label+" · "+result.rows.length+" 个有效组合";
      if (result.currentCounts) {
        summary += "｜当前关系（组合数 / 权重占比） ";
        summary += [["winning","领先"],["tied","持平"],["losing","落后"]].map(([key,title]) =>
          title+" "+result.currentCounts[key]+" / "+percent(result.currentShares[key])).join("，");
      }
      $("range-summary").textContent = summary;
      $("range-summary").hidden = false;
      $("counts-heading").hidden = !result.rows[0]?.total;
      paintRows();
    }
  }
  function run() {
    clearResult("正在计算…");
    setBusy(true);
    $("method").textContent = "计算中";
    try {
      const request = requestFromForm();
      active = PokerRunner.start(request,message => {
        if (!active || message.requestId !== active.requestId) return;
        if (message.type === "progress") {
          $("job-status").textContent = "正在计算 "+message.percent+"%";
          return;
        }
        active = null;
        setBusy(false);
        if (message.type === "result") {
          lastComplete = {request,result:message.result,time:new Date().toISOString()};
          paintResult(message.result,request,"计算完成");
        }
        else if (message.type === "error") {
          clearResult("输入待检查");
          showNote(message.message);
        } else clearResult("已取消计算");
      });
    } catch (error) {
      clearResult("输入待检查");
      showNote(error.message);
    }
  }
  function paintRows() {
    if (!completed) return;
    const relation = $("relation-filter").value;
    const lower = Number($("equity-filter").value)/100;
    const valid = $("equity-filter").validity.valid;
    const filtered = valid ? completed.rows.filter(row =>
      (relation === "all" || String(row.current) === relation) && row.equity >= lower
    ) : [];
    const pages = Math.ceil(filtered.length/pageSize);
    pageIndex = Math.min(pageIndex,Math.max(0,pages-1));
    const visible = filtered.slice(pageIndex*pageSize,(pageIndex+1)*pageSize);
    const fragment = document.createDocumentFragment();
    for (const row of visible) {
      const tr = element("tr");
      tr.dataset.combo = row.cards.join(" ");
      const hand = element("td");
      for (const card of row.cards) {
        const node = element("span",glyph(card),"inline-card");
        if ("hd".includes(card[1])) node.classList.add("red");
        hand.append(node);
      }
      tr.append(hand,element("td",relations[row.current]));
      for (const key of ["win","tie","loss","equity"]) tr.append(element("td",percent(row[key])));
      tr.append(element("td",String(row.weight)));
      if (row.total) {
        const cell = element("td");
        const detail = element("details");
        detail.append(element("summary",row.total+" 个终局"),
          element("span","赢 "+row.wins+" · 平 "+row.ties+" · 输 "+row.losses));
        cell.append(detail);
        tr.append(cell);
      }
      fragment.append(tr);
    }
    $("rows").replaceChildren(fragment);
    $("count").textContent = "显示 "+filtered.length+" / "+completed.rows.length+" 个组合";
    $("no-rows").hidden = !!filtered.length;
    $("no-rows").textContent = valid ? "没有符合筛选条件的组合。" : "最低权益应在 0 至 100 之间。";
    $("pagination").hidden = pages <= 1;
    $("prev-page").disabled = pageIndex === 0;
    $("next-page").disabled = pageIndex+1 >= pages;
    $("page-number").textContent = (pageIndex+1)+" / "+pages;
  }
  function resetFilters() {
    $("relation-filter").value = "all";
    $("equity-filter").value = "";
    pageIndex = 0;
  }
  function changeMode(next) {
    if (mode === next) return;
    clearResult();
    mode = next;
    resetFilters();
    showInputs();
  }
  function openPicker(slot) {
    picking = slot;
    const {group,cards,index,label} = slot;
    const otherGroups = mode === "fixed" ? ["hero","villain"] : ["hero","board"];
    const blocked = new Set(otherGroups.filter(g => g !== group).flatMap(g => drafts[mode][g]));
    cards.forEach((card,i) => {if (i !== index) blocked.add(card);});
    if (group === "combo") {
      const partner = cards[1-index];
      for (const combo of drafts.range.combos) {
        if (partner && combo.cards !== cards && combo.cards.includes(partner))
          combo.cards.forEach(card => blocked.add(card));
      }
    }
    $("picker-title").textContent = (cards[index] ? "替换" : "选择")+label;
    const fragment = document.createDocumentFragment();
    for (const suit of ["s","h","c","d"]) {
      for (const rank of ranks) {
        const card = rank+suit;
        const button = cardButton(card,glyph(card),() => chooseCard(card));
        button.dataset.card = card;
        button.disabled = blocked.has(card);
        button.setAttribute("aria-pressed",String(card === cards[index]));
        fragment.append(button);
      }
    }
    $("deck").replaceChildren(fragment);
    $("clear-slot").hidden = !cards[index];
    $("picker").showModal();
  }
  function chooseCard(value) {
    const {cards,index,group,buttonId} = picking;
    $("picker").close();
    if (cards[index] !== value) {
      cards[index] = value;
      clearResult(group === "combo" ? "范围已变更" : "牌局已变更");
      showInputs();
    }
    $(buttonId).focus();
  }

  function parseHistory(value) {
    if (value === null) return [];
    const records = JSON.parse(value);
    if (!Array.isArray(records) || records.some(record => !record || !record.request || !record.result ||
      !Array.isArray(record.result.rows) || !["fixed","range"].includes(record.request.mode)))
      throw Error("历史数据格式异常");
    return records;
  }
  function readHistory() {
    const legacy = parseHistory(localStorage.getItem(storageKey));
    // Existing WebView records stay readable after an in-place Android upgrade.
    return window.RiverHistory ? parseHistory(window.RiverHistory.read()).concat(legacy) : legacy;
  }
  function save() {
    if (!completed) return;
    try {
      const record = {time:new Date().toISOString(),request:completedRequest,result:completed};
      if (window.RiverHistory) {
        if (!window.RiverHistory.append(JSON.stringify(record))) throw Error("历史记录写入失败");
      } else {
        const records = readHistory();
        records.unshift(record);
        localStorage.setItem(storageKey,JSON.stringify(records));
      }
      $("save").disabled = true;
      showNote("局面已保存，可在历史记录中重新打开。",true);
    } catch (error) {showNote("保存失败，请检查本地存储权限或可用空间。");}
  }
  function restore(record, saved = true) {
    clearResult();
    const request = record.request;
    mode = request.mode;
    const draft = drafts[mode];
    draft.hero = request.hero.slice();
    if (mode === "fixed") draft.villain = request.villain.slice();
    else {
      draft.board = request.board.slice();
      draft.range = request.range;
      $("range-name").value = request.rangeName || "";
      loadRangeText(request.rangeText || "");
    }
    resetFilters();
    showInputs();
    paintResult(record.result,request,saved ? "已恢复保存结果" : "已恢复上次完成的局面");
    $("save").disabled = saved;
    $("history-dialog").close();
  }
  function openHistory() {
    const list = $("history-list");
    list.replaceChildren();
    try {
      const records = readHistory();
      $("history-note").textContent = records.length ? (window.RiverHistory ? "记录保存在本机应用中。" : "记录保存在当前浏览器中。") : "尚无记录。计算完成后可保存局面。";
      for (const record of records) {
        const button = element("button",undefined,"history-entry");
        button.type = "button";
        button.dataset.historyOpen = "";
        const request = record.request;
        const body = element("span");
        const desc = request.mode === "fixed" ? " 对 "+request.villain.join(" ") : " · "+request.board.join(" ");
        body.append(element("strong",request.hero.join(" ")+desc),element("small",new Date(record.time).toLocaleString("zh-CN")));
        button.append(body,element("span","权益 "+percent(record.result.equity)));
        button.addEventListener("click",() => restore(record));
        list.append(button);
      }
      if (lastComplete && lastComplete.result !== completed) {
        const button = element("button","恢复本次打开时最近完成的局面","history-entry");
        button.onclick = () => restore(lastComplete,false);
        list.append(button);
      }
    } catch (error) { $("history-note").textContent = "无法读取历史记录，请检查本地存储权限及数据。"; }
    $("history-dialog").showModal();
  }

  $("mode-fixed").onclick = () => changeMode("fixed");
  $("mode-range").onclick = () => changeMode("range");
  $("range-kind").onchange = () => {
    drafts.range.range = $("range-kind").value;
    $("weighted-field").hidden = drafts.range.range !== "weighted";
    if (drafts.range.range === "weighted") {
      if (drafts.range.combos.length === 0) drafts.range.combos.push({cards:[null,null],weight:"1"});
      paintCombos();
    }
    clearResult("范围已变更");
  };
  $("add-combo").onclick = () => {
    drafts.range.combos.push({cards:[null,null],weight:"1"});
    paintCombos();
    clearResult("范围已变更");
    $("range-list").lastElementChild.querySelector("[data-slot]").focus();
  };
  $("range-name").oninput = () => clearResult("范围名称已变更");
  $("save-range").onclick = saveRange;
  $("saved-range").onchange = () => {
    const name = $("saved-range").value;
    if (!name) return;
    try {
      const text = readRanges().get(name);
      if (text === undefined) throw Error();
      clearResult("已载入范围");
      loadRangeText(text);
      $("range-name").value = name;
      paintCombos();
    } catch {showNote("无法载入该范围。");}
    $("saved-range").value = "";
  };
  $("swap").onclick = () => {
    const fixed = drafts.fixed;
    [fixed.hero,fixed.villain] = [fixed.villain,fixed.hero];
    showInputs();
    clearResult("手牌已交换");
  };
  $("run").onclick = run;
  $("cancel").onclick = () => clearResult("已取消计算");
  document.addEventListener("visibilitychange",() => {
    if (document.hidden && active) clearResult("切入后台，已取消计算");
  });
  $("save").onclick = save;
  $("relation-filter").onchange = $("equity-filter").oninput = () => {pageIndex=0;paintRows();};
  $("prev-page").onclick = () => {pageIndex--;paintRows();};
  $("next-page").onclick = () => {pageIndex++;paintRows();};
  $("clear-slot").onclick = () => chooseCard(null);
  $("picker-close").onclick = () => $("picker").close();
  $("history-open").onclick = openHistory;
  $("history-close").onclick = () => $("history-dialog").close();
  listRanges();
  showInputs();
  run();
})();
