const assert = require('node:assert/strict');
const {measuredDeck,checkGrid,solve,rootResponses} = require('./river-v6-browser.cjs');
const equal = require('../poker_mobile_codex_plan/fixtures/gto_river_small_v1.json');
const weighted = require('../poker_mobile_codex_plan/fixtures/gto_river_weighted_v1.json');

// The CSS boxes and touch events come from the installed Android WebView.
module.exports = async function verifyRiver({js,p,scenario,report,setViewport}) {
  const {click,fill,wait,navigate}=p;
  const read=selector=>js('document.querySelector('+JSON.stringify(selector)+').textContent.trim()');
  const select=(selector,value)=>fill(selector,value,'change');
  const optionValues=selector=>js('Array.from(document.querySelector('+JSON.stringify(selector)+').options,o=>o.value)');
  const evidence=report.river={decks:[],solves:[],odds:[],responses:[]};
  for (const area of ['equity','strategy']) {
    await scenario(area+' picker shows four suit rows and thirteen ranks at 320, 360 and 375px',async()=>{
      const river=area==='strategy';
      await navigate(river?'#open-strategy':'#open-equity',river?'/strategy/index.html':'/equity.html');
      const deck=river?'#gto-deck':'#deck',dialog=river?'#gto-picker':'#picker';
      const slot=river?'#gto-board [data-card]:first-child':'#hero-preview [data-slot="0"]';
      if (river) {
        await click('#gto-board [data-card="2s"]');
        await js.tap(deck+' [data-card="5d"]');
        await click('#gto-picker-apply');
      }
      for (const width of [320,360,375]) {
        await setViewport(width);await wait('innerWidth==='+width,'resize Android to '+width);
        await click(slot);
        await wait('document.querySelector('+JSON.stringify(dialog)+').open','open picker');
        const grid=await js('('+measuredDeck+')(document.querySelector('+JSON.stringify(deck)+'))');
        checkGrid(grid);
        evidence.decks.push({area,width,rows:[...new Set(grid.centers.map(c=>+c.y.toFixed(1)))],
          columns:grid.centers.slice(0,13).map(c=>+c.x.toFixed(1))});
        assert.ok(await js('document.querySelector('+JSON.stringify(deck+' [data-card="'+(river?'8s':'Ah')+'"]')+').disabled'));
        for (const [i,card] of ['As','2s','Ad','2d','Th'].entries()) {
          if (i) await click(slot);
          await js.tap(deck+' [data-card="'+card+'"]');
          if (river) await click('#gto-picker-apply');
          assert.equal(await js('document.querySelector('+JSON.stringify(slot)+').dataset.card'),card);
        }
      }
      await navigate(river?'a[href="../index.html"]':'a[href="index.html"]','/index.html');
    });
  }
  async function run(which) {
    await select('#gto-preset',which);
    const start=performance.now();
    await click('#gto-run');
    await wait("document.querySelector('#gto-badge').textContent==='已达标'",which+' converges',180000);
    assert.equal(await js("document.querySelector('#gto-readout').dataset.state"),'ready');
    assert.equal(await js("document.querySelector('#gto-recommendation').hidden"),false);
    evidence.solves.push({preset:which,elapsedMs:Math.round(performance.now()-start),
      iterations:await read('#gto-iterations'),exploitability:await read('#gto-error')});
  }
  function percent(text) {
    const match=text.match(/([\d.]+)\s*%/);
    assert.ok(match,'percentage absent in '+text); return Number(match[1]);
  }
  function near(actual,expected) {
    assert.ok(Math.abs(actual-expected)<.061,'observed '+actual+', expected '+expected);
  }
  async function showdown(expected) {
    for (const [stat,value] of Object.entries(expected)) {
      near(percent(await read('#gto-equity-breakdown [data-stat="'+stat+'"] dd')),value);
    }
  }
  async function responses(result,hand,move) {
    await select('#gto-response-size',move);
    const expected=rootResponses(result,hand,move);
    const rows=await js("Array.from(document.querySelectorAll('#gto-responses [data-response]'),"+
      "e=>[e.dataset.response,e.querySelector('.response-frequency').textContent])");
    assert.deepEqual(rows.map(([action])=>action).sort(),Object.keys(expected).sort());
    for (const [action,text] of rows) near(percent(text),expected[action]*100);
    evidence.responses.push({hand,move,frequencies:Object.fromEntries(rows)});
  }
  await scenario('river final readout links hand, sizes, opponent reactions and pot odds',async()=>{
    await setViewport(360);await wait('innerWidth===360','360px river display');
    await navigate('#open-strategy','/strategy/index.html');
    await run('equal');
    assert.equal(await js("document.querySelector('#gto-advanced').open"),false);
    assert.equal((await optionValues('#gto-hand')).length,8);
    await js.tap('#gto-matrix [data-class="AQs"]');
    await select('#gto-hand','Qs As');
    await showdown({win:62.5,tie:12.5,loss:25,equity:68.75});
    const result=solve(equal);
    for (const [move,frequency] of Object.entries(result.policy.root['Qs As'])) {
      near(percent(await read('#gto-size-comparison [data-action="'+move+'"] .size-frequency')),frequency*100);
      const aggregate=Object.entries(result.policy.root).reduce((sum,[h,a])=>sum+result.evaluation.infos.root[h].reach*a[move],0);
      near(percent(await read('#gto-range-mix [data-action="'+move+'"]')),aggregate*100);
    }
    await responses(result,'Qs As','bet:50');await responses(result,'Qs As','bet:100');
    await js.tap('#gto-responses details summary');
    assert.equal(await js("document.querySelector('#gto-responses details').open"),true);
    await select('#gto-hand','Qh Ah');
    await showdown({win:50,tie:100/6,loss:100/3,equity:100*3.5/6});
    for (const [history,call,needed] of [['bet:50',50,25],['bet:100',100,100/3],['bet:50/raise:100',50,100/6]]) {
      await select('#gto-history',history);
      const odds=await read('#gto-pot-odds');
      assert.ok(odds.includes(String(call)));
      near(percent(odds),needed);
      evidence.odds.push({history,call,odds});
    }
    await run('weighted');
    await select('#gto-hand','Qs As');await responses(solve(weighted),'Qs As','bet:50');
    await js.tap('#gto-advanced summary');
    assert.equal(await js("document.querySelector('#gto-advanced').open"),true);
    assert.ok((await read('#gto-actions')).length);
  });
  await scenario('a blocked hand has no recommendation even in a converged game',async()=>{
    await select('#gto-preset','equal');
    await js.tap('#range-editor summary');
    const remove='#gto-ip [data-hand]:not([data-hand="Ah Kh"])';
    while(await js('!!document.querySelector('+JSON.stringify(remove)+')')) {
      await click(remove);await click('#gto-delete-row');
    }
    assert.deepEqual(await js("Array.from(document.querySelectorAll('#gto-ip [data-hand]'),b=>b.dataset.hand)"),['Ah Kh']);
    await click('#gto-run');
    await wait("document.querySelector('#gto-badge').textContent==='已达标'",'custom model converges',180000);
    await select('#gto-hand','Qh Ah');
    assert.equal(await js("document.querySelector('#gto-readout').dataset.state"),'unreachable');
    assert.equal(await js("document.querySelector('#gto-recommendation').getClientRects().length"),0);
    assert.equal(await read('#gto-equity-breakdown [data-stat="equity"] dd'),'—');
  });
  await scenario('edits and incomplete iterations hide settled river recommendations',async()=>{
    await fill('#gto-pot','101');
    assert.equal(await js("document.querySelector('#gto-recommendation').getClientRects().length"),0);
    await select('#gto-preset','equal');await fill('#gto-limit','1');await click('#gto-run');
    await wait("document.querySelector('#gto-badge').textContent==='迭代未达标'",'incomplete result');
    assert.equal(await js("document.querySelector('#gto-readout').dataset.state"),'approximate');
    assert.equal(await js("document.querySelector('#gto-recommendation').getClientRects().length"),0);
  });
};
