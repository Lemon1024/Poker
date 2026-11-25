const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const equal = require('../poker_mobile_codex_plan/fixtures/gto_river_small_v1.json');
const weighted = require('../poker_mobile_codex_plan/fixtures/gto_river_weighted_v1.json');
const createSolver = require('../strategy/solver.js');
const evaluate = require('../strategy/evaluate.js');
const {createRiverRun} = require('../strategy/runner.js');
const createPokerEngine = require('../web/equity.js');

const ranks = 'AKQJT98765432', suits = 'shcd', symbols = '♠♥♣♦';
const near = (actual,expected,precision,label) => assert.ok(Math.abs(actual-expected)<=precision,
  label+' expected '+expected+', got '+actual);

function measuredDeck(deck) {
  const centers = [...deck.querySelectorAll('button[data-card]')].map(button => {
    const r = button.getBoundingClientRect();
    return {card:button.dataset.card, face:button.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,
      x:(r.left+r.right)/2,y:(r.top+r.bottom)/2};
  });
  const d = deck.closest('dialog');
  return {centers,viewport:innerWidth,dialogWidth:d.clientWidth,dialogScrollWidth:d.scrollWidth,
    deckWidth:deck.clientWidth,deckScrollWidth:deck.scrollWidth,documentWidth:document.documentElement.scrollWidth};
}

function checkGrid(g) {
  assert.equal(g.centers.length,52);
  assert.ok(g.dialogScrollWidth<=g.dialogWidth+1 && g.deckScrollWidth<=g.deckWidth+1 &&
    g.documentWidth<=g.viewport+1,'no horizontal scrolling in deck, dialog or document');
  for (const [i,c] of g.centers.entries()) {
    const row = Math.floor(i/13), col = i%13;
    assert.equal(c.card,ranks[col]+suits[row]);
    assert.equal(c.face.replace(/\s/g,''),(ranks[col]==='T'?'10':ranks[col])+symbols[row]);
    near(c.y,g.centers[row*13].y,0.6,'same suit is a single row');
    near(c.x,g.centers[col].x,0.6,'same rank is a single column');
    assert.ok(c.right>c.left && c.top<c.bottom && c.left>=0 && c.right<=g.viewport+0.5);
    if (col) assert.ok(c.left>=g.centers[i-1].right-0.1,'touch targets in adjacent columns do not overlap');
    if (row) assert.ok(c.top>=g.centers[i-13].bottom-0.1,'adjacent rows do not overlap');
  }
}

function solve(model) {
  const run = createRiverRun(model,{},createSolver,evaluate);
  let result;
  do {result=run.advance();} while(!result);
  assert.equal(result.status,'converged');
  return result;
}

// At the root the only opponent-conditioning factors are card removal and range weights.
function rootResponses(result,ownHand,bet) {
  const response = {};
  let mass = 0;
  for (const [hand,policy] of Object.entries(result.policy[bet])) {
    const cards = hand.split(' ');
    if (cards.some(c=>ownHand.split(' ').includes(c))) continue;
    const weight = result.model.ip_range.find(row=>row.cards.every(c=>cards.includes(c))).weight;
    mass += weight;
    for (const [action,p] of Object.entries(policy)) response[action]=(response[action] || 0)+weight*p;
  }
  return Object.fromEntries(Object.entries(response).map(([action,total])=>[action,total/mass]));
}

function equityFacingBetAfterCheck(result,ownHand,bet) {
  const engine=createPokerEngine(), ids=cards=>cards.map(c=>engine.cards.indexOf(c));
  const hero=ownHand.split(' '), board=ids(result.model.board), heroScore=engine.score(ids(hero),board);
  const outcomes={win:0,tie:0,loss:0};
  for (const [hand,policy] of Object.entries(result.policy.check)) {
    const other=hand.split(' ');
    if (other.some(c=>hero.includes(c))) continue;
    const opponentScore=engine.score(ids(other),board);
    const given=result.model.ip_range.find(row=>row.cards.every(c=>other.includes(c)));
    outcomes[heroScore>opponentScore?'win':heroScore===opponentScore?'tie':'loss']+=given.weight*policy[bet];
  }
  const mass=outcomes.win+outcomes.tie+outcomes.loss;
  for (const key of Object.keys(outcomes)) outcomes[key]*=100/mass;
  outcomes.equity=outcomes.win+outcomes.tie/2;
  return outcomes;
}

module.exports = async function riverBrowser({page,entry,scenario,report,reportFile}) {
  const $ = selector => page.locator(selector);
  const gto = id => $('#gto-'+id);
  const record = report.v6 = {decks:[],solves:[],showdowns:[],responses:[],potOdds:[]};
  async function openFromHome(selector) {
    await page.goto(entry);
    await $(selector).tap();
  }
  async function tapAtCenter(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box=await locator.boundingBox();
    assert.ok(box,'card can receive a touch');
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  }
  async function captureSection(locator,name) {
    await locator.scrollIntoViewIfNeeded();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await locator.screenshot({path:reportFile(name),animations:'disabled'});
  }

  for (const picker of ['equity','river']) {
    await scenario(picker+' card picker has four suit rows and thirteen rank columns at 320, 360, 375 and desktop',async () => {
      const river=picker==='river';
      await openFromHome(river?'#open-strategy':'#open-equity');
      const deck=river?gto('deck'):$('#deck');
      const slot=river?$('#gto-board [data-card]').first():$('#hero-preview [data-slot="0"]');
      const button=c=>deck.locator('[data-card="'+c+'"]');
      if (river) {
        // Free the lower end of the spade row before checking all four corners.
        await $('#gto-board [data-card="2s"]').tap();
        await button('5d').tap();
        await gto('picker-apply').tap();
      }
      for (const width of [320,360,375,1280]) {
        await page.setViewportSize({width,height:width===1280?900:800});
        await slot.tap();
        const grid=await deck.evaluate(measuredDeck);
        checkGrid(grid);
        if (river) {
          const positions=await gto('picker-slots').locator('button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
          assert.equal(positions.length,5);
          assert.ok(positions.every(y=>Math.abs(y-positions[0])<1),'all five board slots fit one row');
        }
        if (width===320) await page.screenshot({path:reportFile('-'+picker+'-320.png')});
        assert.ok(await button(river?'8s':'Ah').isDisabled(),'occupied card cannot be selected');
        for (const [index,c] of ['As','2s','Ad','2d','8h','Th'].entries()) {
          if (index) await slot.tap();
          await tapAtCenter(button(c));
          if (river) await gto('picker-apply').tap();
          await page.waitForFunction(({selector,card})=>document.querySelector(selector)?.dataset.card===card,
            {selector:river?'#gto-board [data-card]':'#hero-preview [data-slot="0"]',card:c});
        }
        record.decks.push({picker,width,rows:suits.length,columns:ranks.length,
          columnCenters:grid.centers.slice(0,13).map(c=>Math.round(c.x)),
          rowCenters:[0,13,26,39].map(i=>Math.round(grid.centers[i].y)),touches:['As','2s','Ad','2d','8h','Th']});
      }
      if (!river) {
        await slot.tap(); await $('#clear-slot').tap();
        assert.ok(!(await slot.getAttribute('data-card')),'removed card leaves an empty slot');
        await slot.tap(); await button('Th').tap();
        assert.equal(await slot.getAttribute('data-card'),'Th');
      } else {
        await $('#range-editor summary').tap(); await gto('oop-pick').tap();
        assert.ok(await button('Th').isDisabled(),'board cards block a new range combination');
        await button('4d').tap(); assert.ok(await button('4d').isDisabled());
        await button('5h').tap(); await gto('picker-apply').tap();
        const added=$('#gto-oop [data-hand="4d 5h"]');
        await added.tap(); await gto('delete-row').tap();
        assert.equal(await added.count(),0);
      }
    });
  }

  const ready=()=>page.waitForFunction(()=>document.querySelector('#gto-badge')?.textContent==='已达标' &&
    document.querySelector('#gto-readout')?.dataset.state==='ready',null,{timeout:90000});
  async function run(which) {
    await gto('preset').selectOption(which);
    const began=performance.now();
    await gto('run').tap(); await ready();
    record.solves.push({preset:which,elapsedMs:Math.round(performance.now()-began),
      iterations:await gto('iterations').innerText(),exploitability:await gto('error').innerText()});
    assert.ok(await gto('recommendation').isVisible());
  }
  const percent = text => {
    const n=text.match(/(-?\d+(?:\.\d+)?)\s*%/);
    assert.ok(n,'expected percentage in '+text);
    return Number(n[1]);
  };
  async function stats(expected) {
    const actual={};
    for (const [key,value] of Object.entries(expected)) {
      const text=await gto('equity-breakdown').locator('[data-stat="'+key+'"] dd').innerText();
      actual[key]=percent(text);
      near(actual[key],value,0.06,key);
    }
    record.showdowns.push({path:await gto('history').inputValue(),hand:await gto('hand').inputValue(),actual});
  }
  async function responses(result,hand,bet) {
    await gto('response-size').selectOption(bet);
    const expected=rootResponses(result,hand,bet);
    const panel=gto('responses');
    assert.equal(await panel.locator('[data-response]').count(),Object.keys(expected).length);
    const values={};
    for (const [reply,mass] of Object.entries(expected)) {
      const row=panel.locator('[data-response="'+reply+'"]');
      values[reply]=percent(await row.locator('.response-frequency').innerText());
      near(values[reply],100*mass,0.06,'opponent '+reply+' to '+bet);
    }
    record.responses.push({preset:result.model.benchmark_id,hand,bet,values});
    return values;
  }
  async function odds(path,due,threshold) {
    await gto('history').selectOption(path);
    const text=await gto('pot-odds').innerText();
    assert.match(text,new RegExp('补\\s*'+due+'\\D'),'incremental call amount in '+text);
    assert.ok([...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].some(m=>Math.abs(Number(m[1])-threshold)<0.07),
      'call threshold '+threshold+' in '+text);
    record.potOdds.push({path,due,threshold,text});
  }

  await scenario('converged river analysis links the selected hand, bet size, response range and incremental pot odds',async () => {
    await openFromHome('#open-strategy');
    await gto('board').locator('[data-card]').first().waitFor();
    await page.setViewportSize({width:360,height:800});
    await run('equal');
    assert.equal(await gto('advanced').getAttribute('open'),null,'advanced figures initially collapsed');
    await gto('matrix').locator('[data-class="AQs"]').tap();
    await gto('hand').selectOption('Qs As');
    await stats({win:62.5,tie:12.5,loss:25,equity:68.75});
    const equalResult=solve(equal), own=equalResult.policy.root['Qs As'];
    const ev=equalResult.evaluation.infos.root['Qs As'].action_ev;
    const best=Math.max(...Object.values(ev));
    for (const move of Object.keys(own)) {
      const card=gto('size-comparison').locator('[data-action="'+move+'"]');
      near(percent(await card.locator('.size-frequency').innerText()),100*own[move],0.06,move);
      const gapText=await card.locator('.size-gap').innerText();
      if (ev[move]===best) assert.match(gapText,/最高/);
      else {
        const gap=gapText.match(/-?\d+(?:\.\d+)?/);
        assert.ok(gap,'EV difference for '+move);
        near(Number(gap[0]),best-ev[move],0.011,'EV difference for '+move);
      }
      if (move.startsWith('bet:')) assert.ok((await card.locator('.size-amount').innerText()).includes(move.slice(4)));
      const expected=Object.entries(equalResult.policy.root).reduce((sum,[h,policy])=>
        sum+equalResult.evaluation.infos.root[h].reach*policy[move],0);
      const row=gto('range-mix').locator('[data-action="'+move+'"]');
      near(percent(await row.innerText()),100*expected,0.06,'root range '+move);
    }
    const little=await responses(equalResult,'Qs As','bet:50');
    const big=await responses(equalResult,'Qs As','bet:100');
    assert.notDeepEqual(little,big);
    const details=gto('responses').locator('[data-response="call"]');
    await details.locator('summary').tap();
    // With Qs As on this preset, a set and two pair beat us; Ad Qc splits the pot.
    const relativeHands=[['2c 2d','7s 8h'],['Qc Ad'],['Qh Kh','Kh Ah','Tc Jc','6d 9d','Js Ks']];
    const calls=relativeHands.map(group=>group.reduce((sum,h)=>sum+equalResult.policy['bet:100'][h].call,0));
    const allCalls=calls.reduce((a,b)=>a+b,0);
    const labels=details.locator('.response-group strong');
    assert.equal(await labels.count(),3);
    for (const [i,mass] of calls.entries()) {
      near(percent(await labels.nth(i).innerText()),100*mass/allCalls,0.06,'strength among calling hands');
    }
    await captureSection(gto('response-panel'),'-river-responses-360.png');
    await gto('hand').selectOption('Qh Ah');
    await stats({win:50,tie:100/6,loss:100/3,equity:100*3.5/6});
    await captureSection(gto('readout'),'-river-hand-360.png');
    await odds('bet:50',50,25);
    await odds('check/bet:50',50,25);
    await gto('matrix').locator('[data-class="AQs"]').tap();
    await gto('hand').selectOption('Qs As');
    await stats(equityFacingBetAfterCheck(equalResult,'Qs As','bet:50'));
    await odds('bet:100',100,100/3);
    await odds('bet:50/raise:100',50,100/6);
    await odds('check/bet:50/raise:100',50,100/6);
    await run('weighted');
    await gto('matrix').locator('[data-class="AQs"]').tap();
    await gto('hand').selectOption('Qs As');
    await responses(solve(weighted),'Qs As','bet:50');
    await page.setViewportSize({width:320,height:820});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'river readout fits at 320px');
  });

  await scenario('a listed hand blocked by every opponent has no recommendation or showdown percentages',async () => {
    await gto('preset').selectOption('equal');
    if (!await gto('ip').isVisible()) await $('#range-editor summary').tap();
    const others=$('#gto-ip [data-hand]:not([data-hand="Ah Kh"])');
    assert.equal(await others.count(),7);
    for (let i=0;i<7;i++) {
      await others.first().tap();
      await gto('delete-row').tap();
    }
    assert.equal(await gto('ip').locator('[data-hand]').count(),1);
    await gto('run').tap(); await ready();
    await gto('hand').selectOption('Qh Ah');
    assert.equal(await gto('readout').getAttribute('data-state'),'unreachable');
    assert.equal(await gto('recommendation').isVisible(),false);
    assert.deepEqual(await gto('equity-breakdown').locator('dd').allTextContents(),['—','—','—','—']);
    assert.match(await gto('interpretation-note').innerText(),/没有可达|无法到达/);
    await gto('hand').selectOption('Qs As');
    assert.equal(await gto('readout').getAttribute('data-state'),'ready');
    await stats({win:100,tie:0,loss:0,equity:100});
  });

  await scenario('editing, pausing, or reaching the iteration limit cannot show a settled recommendation',async () => {
    await gto('pot').fill('101');
    assert.equal(await gto('recommendation').isVisible(),false);
    await gto('preset').selectOption('equal');
    await gto('run').tap();
    await gto('pause').tap();
    await page.waitForFunction(()=>document.querySelector('#gto-badge').textContent==='已暂停');
    assert.equal(await gto('recommendation').isVisible(),false);
    if (!await gto('limit').isVisible()) await $('#budget-editor summary').tap();
    await gto('limit').fill('1');
    await gto('run').tap();
    await page.waitForFunction(()=>document.querySelector('#gto-badge').textContent==='迭代未达标');
    assert.equal(await gto('recommendation').isVisible(),false);
    assert.equal(await gto('readout').getAttribute('data-state'),'approximate');
  });
};

Object.assign(module.exports,{measuredDeck,checkGrid,solve,rootResponses});
