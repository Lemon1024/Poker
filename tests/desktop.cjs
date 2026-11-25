// Run with Playwright available via NODE_PATH, or set POKER_PLAYWRIGHT.
// A private profile lets the test close and restart the browser to verify persistence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {performance} = require('node:perf_hooks');
const {once} = require('node:events');

const root = path.resolve(__dirname,'..');
const entryPath = path.resolve(process.env.POKER_ENTRY || path.join(root,'index.html'));
const entry = pathToFileURL(entryPath).href;
const scratch = path.join(root,'.work','desktop-test');
fs.mkdirSync(scratch,{recursive:true});
// Playwright and Chromium each allocate transient files before the profile is ready.
// Only the current test process and its children inherit these paths.
process.env.TEMP = process.env.TMP = process.env.TMPDIR = scratch;
const {chromium} = require(process.env.POKER_PLAYWRIGHT || 'playwright');
const profile = fs.mkdtempSync(path.join(scratch,'profile-'));
const fields = ['win','tie','loss','equity'];
const report = {startedAt:new Date().toISOString(), entryProtocol:'file:', entryPath:path.relative(root,entryPath), scenarios:[],
  externalRequests:[], consoleProblems:[], pageErrors:[], localRequestFailures:[]};
let context, page;
const {setHand,setCombos} = require('./card-controls.cjs')({
  click:selector => page.locator(selector).click(),
  count:selector => page.locator(selector).count(),
  fill:(selector,value) => page.locator(selector).fill(value),
  readCards:holder => page.locator(holder+' [data-slot]').evaluateAll(nodes => nodes.map(n => n.dataset.card))
});

function reportFile(name) {
  return path.join(process.env.POKER_REPORT_DIR || path.join(root,'reports','v6-browser'),'desktop-test' + (process.env.POKER_TEST_EDGE ? '-edge' : '') + name);
}
function connect(page) {
  page.on('console',message => {
    if (['warning','error'].includes(message.type())) report.consoleProblems.push(message.type()+' '+message.text());
  });
  page.on('pageerror',error => report.pageErrors.push(error.message));
}
async function launch() {
  const executablePath = process.env.POKER_BROWSER;
  context = await chromium.launchPersistentContext(profile,{
    channel:executablePath ? undefined : 'chrome',executablePath,headless:true,
    args:['--disable-breakpad','--disable-crash-reporter'],offline:true,
    env:{...process.env,TEMP:scratch,TMP:scratch,TMPDIR:scratch},
    viewport:{width:1280,height:900},hasTouch:true
  });
  context.setDefaultTimeout(12000);
  context.setDefaultNavigationTimeout(90000);
  context.on('request',request => {
    if (/^(https?|wss?):/.test(request.url())) report.externalRequests.push(request.url());
  });
  context.on('requestfailed',request => {
    if (request.url().startsWith('file:')) report.localRequestFailures.push(request.url());
  });
  context.on('page',connect);
  page = context.pages()[0]; connect(page);
  const cdp = await context.newCDPSession(page);
  report.browser = (await cdp.send('Browser.getVersion')).product;
  await cdp.detach();
  await page.goto(entry);
  assert.equal(await page.evaluate(() => window.location.protocol),'file:');
  assert.equal(await page.evaluate(() => navigator.onLine),false);
  await page.locator('#open-equity').waitFor();
  assert.equal(await page.locator('#run, script[src$="equity.js"]').count(),0,'home does not load the equity calculator');
  assert.match(await page.title(),/GTO训练营/);
  await page.locator('#open-equity').click();
}
async function complete() {
  await page.waitForFunction(() => !document.querySelector('#save').disabled);
  await page.waitForFunction(() => document.querySelector('[data-prob=win]').textContent.includes('%'));
}
async function summary() {
  return Promise.all(fields.map(k => page.locator('[data-prob='+k+']').innerText()));
}
async function closeTo(expected, delta) {
  const actual = (await summary()).map(x => Number.parseFloat(x));
  expected.forEach((x,i) => assert.ok(Math.abs(x-actual[i])<=delta,fields[i]+': expected '+x+', observed '+actual[i]));
}
async function inputs(hero,board,range,combos) {
  await setHand('#hero-preview',hero);
  await setHand('#board-preview',board);
  await page.locator('#range-kind').selectOption(range);
  if (range === 'weighted') await setCombos(combos);
}
async function execute() {
  await page.locator('#run').click();
  await complete();
}
async function scenario(name, run) {
  const start = performance.now();
  try {
    await run();
    report.scenarios.push({name,status:'passed',elapsedMs:Math.round(performance.now()-start)});
  } catch (error) {
    report.scenarios.push({name,status:'failed',elapsedMs:Math.round(performance.now()-start),error:error.message});
    throw error;
  }
}

async function main() {
  await scenario('fresh offline browser opens file and compares fixed hole cards',async () => {
    await launch();
    await complete();
    await closeTo([82.3648,0.5436,17.0916,82.6366],1);
    assert.match(await page.locator('#method').innerText(),/模拟/);
    assert.equal(await page.locator('#combos').isVisible(),false);
    assert.doesNotMatch(await page.locator('main').innerText(),/枚举次数|模拟次数|胜场|负场/);
    await page.screenshot({path:reportFile('-desktop.png')});
  });
  await scenario('mouse replaces selected hero and opponent slots immediately; close leaves the deal intact',async () => {
    assert.equal(await page.locator('.config input[type=text]:visible, .config input:not([type]):visible, .config textarea:visible').count(),0);
    const heroSlot = page.locator('#hero-preview [data-slot="1"]');
    await heroSlot.click();
    assert.equal(await page.locator('#deck [data-card=As]').isDisabled(),true);
    assert.equal(await page.locator('#deck [data-card=Ks]').isDisabled(),true);
    await page.screenshot({path:reportFile('-picker.png')});
    await page.locator('#deck [data-card=Qh]').click();
    assert.equal(await page.locator('#picker').isVisible(),false);
    assert.equal(await heroSlot.getAttribute('data-card'),'Qh');
    assert.equal(await page.locator('#save').isDisabled(),true);
    const opponent = page.locator('#villain-preview [data-slot="0"]');
    await opponent.click();
    assert.equal(await page.locator('#deck [data-card=Qh]').isDisabled(),true);
    await page.locator('#deck [data-card=Ah]').click();
    assert.equal(await opponent.getAttribute('data-card'),'Ah');
    await opponent.click(); await page.locator('#picker-close').click();
    assert.equal(await opponent.getAttribute('data-card'),'Ah');
    await setHand('#villain-preview','Ks Kh');
    await setHand('#hero-preview','As Ah');
  });
  await scenario('flop and turn report probabilities and current hand relation',async () => {
    await page.locator('#mode-range').click();
    await inputs('As Ks','2s 7s Td','weighted',['9c 9d 1']);
    await execute();
    await closeTo([55.0505,0,44.9495,55.0505],1);
    assert.equal(await page.locator('#rows tr[data-combo]').count(),1);
    assert.match(await page.locator('#rows tr').innerText(),/落后/);
    await setHand('#board-preview','2s 7s Td 3h');
    await execute();
    await closeTo([15/44*100,0,29/44*100,15/44*100],1);
  });
  await scenario('river uniform aggregate, pagination, filters and unchanged aggregate',async () => {
    await inputs('As Qs','Qd 8s 2s 7h 3c','uniform');
    await execute();
    await closeTo([884/990*100,6/990*100,100/990*100,887/990*100],0.06);
    assert.match(await page.locator('#method').innerText(),/河牌/);
    assert.match(await page.locator('#count').innerText(),/990/);
    const cards = () => page.locator('#rows tr[data-combo]').first().getAttribute('data-combo');
    const first = await cards();
    await page.locator('#next-page').click();
    assert.notEqual(await cards(),first);
    const before = await summary();
    await page.locator('#relation-filter').selectOption('0');
    assert.equal(await page.locator('#rows tr[data-combo]').count(),6);
    await page.locator('#equity-filter').fill('51');
    assert.equal(await page.locator('#rows tr[data-combo]').count(),0);
    assert.deepEqual(await summary(),before);
    await page.locator('#relation-filter').selectOption('all');
    await page.locator('#equity-filter').fill('');
  });
  await scenario('weighted input omits blockers and zero weights, rejects duplicates',async () => {
    await page.locator('#range-kind').selectOption('weighted');
    await setCombos(['Kc Kd','Qc Kd','Ac Qh .5','2c 2d 0']);
    const first = page.locator('#range-list .range-row').first();
    await first.locator('[data-slot="0"]').click();
    assert.equal(await page.locator('#deck [data-card="As"]').isDisabled(),true);
    assert.equal(await page.locator('#deck [data-card="Qc"]').isDisabled(),true);
    await page.locator('#picker-close').click();
    await execute();
    assert.equal(await page.locator('#rows tr[data-combo]').count(),3);
    await closeTo([40,20,40,50],0.01);
    await first.locator('[data-slot="0"]').click();
    await page.locator('#deck [data-card="Jc"]').click();
    await execute(); await closeTo([80,20,0,90],0.01);
    await page.locator('#save').click();
    await page.locator('#mode-fixed').click();
    await page.locator('#history-open').click();
    await page.locator('[data-history-open]').first().click();
    assert.equal(await first.locator('[data-slot="0"]').getAttribute('data-card'),'Jc');
    assert.equal(await page.locator('#range-list input').nth(2).inputValue(),'.5');
    await closeTo([80,20,0,90],0.01);
  });
  await scenario('full flop and turn complete offline and publish every legal opponent',async () => {
    for (const [board,total] of [['2s 7s Td',1081],['2s 7s Td 3h',1035]]) {
      await inputs('As Ks',board,'uniform');
      const started = performance.now();
      await execute();
      assert.match(await page.locator('#count').innerText(),new RegExp(String(total)));
      report.scenarios.push({name:'full board '+board,status:'passed',elapsedMs:Math.round(performance.now()-started)});
      const values = (await summary()).map(parseFloat);
      assert.ok(Math.abs(values[0]+values[1]+values[2]-100)<0.03);
      assert.ok(Math.abs(values[0]+values[1]/2-values[3])<0.03);
    }
  });
  await scenario('cancel a running full-range flop worker and supersede another by editing input',async () => {
    await inputs('As Ks','2s 7s Td','uniform');
    let workerPromise = page.waitForEvent('worker');
    await page.locator('#run').click();
    let worker = await workerPromise;
    let closed = once(worker,'close',{signal:AbortSignal.timeout(12000)});
    await page.locator('#cancel').click();
    await closed;
    assert.equal(await page.locator('#save').isDisabled(),true);
    assert.doesNotMatch((await summary()).join(' '),/%/);
    workerPromise = page.waitForEvent('worker');
    await page.locator('#run').click();
    worker = await workerPromise;
    closed = once(worker,'close',{signal:AbortSignal.timeout(12000)});
    await page.locator('#hero-preview [data-slot="0"]').click();
    await page.locator('#deck [data-card="2c"]').click();
    await closed;
    await setHand('#hero-preview','2c 3d');
    await setHand('#board-preview','As Ks Qs Js Ts');
    await execute();
    await closeTo([0,100,0,50],0);
    assert.match(await page.locator('#method').innerText(),/河牌/);
  });
  let savedSummary;
  await scenario('saved completed result survives full browser restart',async () => {
    // Save a random estimate: identical displayed values after restore alone cannot
    // prove exactness for a deterministic river, so additionally watch for new workers.
    await page.locator('#mode-fixed').click();
    await page.locator('#swap').click();
    await execute();
    savedSummary = await summary();
    await page.locator('#save').click();
    await context.close(); context = null;
    await launch();
    await complete();
    let restoreWorkers = 0;
    page.on('worker',() => restoreWorkers++);
    await page.locator('#history-open').click();
    await page.locator('[data-history-open]').first().click();
    await page.waitForFunction(() => document.querySelector('#job-status').textContent.includes('已恢复'));
    assert.deepEqual(await summary(),savedSummary);
    assert.deepEqual(await page.locator('#hero-preview [data-slot]').evaluateAll(nodes => nodes.map(n => n.dataset.card)),['Ks','Kh']);
    assert.equal(restoreWorkers,0);
  });
  await scenario('narrow display and enlarged text keep controls reachable',async () => {
    await page.setViewportSize({width:375,height:800});
    await page.addStyleTag({content:'html { font-size:125% !important }'});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth+1));
    await page.locator('#hero-preview button').first().click();
    assert.equal(await page.locator('#picker').isVisible(),true);
    assert.equal(await page.locator('#deck button').count(),52);
    await page.locator('#picker-close').click();
    await page.locator('#history-open').click();
    assert.equal(await page.locator('#history-dialog').isVisible(),true);
    await page.locator('#history-close').click();
  });
  await scenario('R1 exact turn, row reuse, cancellation, filtering and named range persistence',async () => {
    const js = expression => page.evaluate(expression);
    js.tap = selector => page.locator(selector).click();
    await require('./r1-ui.cjs')(js,report,async () => {
      await context.close();context=null;await launch();await complete();return js;
    });
  });
  await scenario('offline preflop chart, mixed actions and portrait navigation',async () => {
    await page.setViewportSize({width:360,height:800});
    const js=expression=>page.evaluate(expression);
    js.tap=selector=>page.locator(selector).tap();
    js.select=(selector,value)=>page.locator(selector).selectOption(value);
    await require('./preflop-ui.cjs')(js, expression=>page.waitForFunction(expression));
  });
  await require('./training-browser.cjs')({page,scenario,report,reportFile});
  await scenario('river strategy opens from home and publishes engine frequencies and EV',async () => {
    await page.locator('#open-strategy').tap();
    await page.waitForFunction(() => document.querySelectorAll('#gto-board [data-card]').length===5);
    await page.locator('#gto-run').tap();
    await page.waitForFunction(() => document.querySelector('#gto-badge').textContent==='已达标',null,{timeout:90000});
    assert.equal(await page.locator('#gto-matrix button').count(),169);
    assert.ok(parseFloat(await page.locator('#gto-error').innerText())<=0.1);
    if (!await page.locator('#gto-actions').isVisible()) await page.locator('#gto-advanced summary').tap();
    await page.locator('#gto-history').selectOption('check/bet:50');
    assert.match(await page.locator('#gto-actions').innerText(),/弃牌/);
    assert.match(await page.locator('#gto-actions td').last().innerText(),/\d/);
  });
  await require('./river-v6-browser.cjs')({page,entry,scenario,report,reportFile});
  await scenario('storage denial is visible without disabling computation',async () => {
    await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('test quota','QuotaExceededError'); }; });
    await page.goto(entry);
    await page.locator('#open-equity').click(); await complete();
    await page.locator('#save').click();
    await page.waitForFunction(() => /存储|空间|保存失败|无法保存/.test(
      document.querySelector('#feedback').innerText + document.querySelector('#job-status').innerText));
    assert.ok((await summary()).every(x => x.includes('%')));
  });
  assert.deepEqual(report.consoleProblems,[]);
  assert.deepEqual(report.pageErrors,[]);
  assert.deepEqual(report.externalRequests,[]);
  assert.deepEqual(report.localRequestFailures,[]);
}

fs.mkdirSync(path.dirname(reportFile('.json')),{recursive:true});
main().then(() => { report.status = 'passed'; }).catch(error => {
  report.status = 'failed'; report.error = error.message;
  console.error(error.stack); process.exitCode = 1;
}).finally(async () => {
  if (context) await context.close();
  fs.writeFileSync(reportFile('.json'),JSON.stringify(report,null,2)+'\n');
  console.log(report.status,report.browser,report.scenarios.map(s => s.name+' '+s.status+' '+s.elapsedMs+'ms'));
  if (path.dirname(fs.realpathSync(profile)) === fs.realpathSync(scratch)) {
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
