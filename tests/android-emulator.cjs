// Node 22+, Android SDK platform-tools. Only an explicitly named, offline project AVD.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {setTimeout:delay} = require('node:timers/promises');
const assert = require('node:assert/strict');
const run = promisify(execFile);
const root = path.resolve(__dirname,'..');
const PACKAGE = 'org.rivernotes.poker';
const ENTRY = 'https://appassets.androidplatform.net/index.html';
const help = [
  'Inspect prerequisites (does not install, attach to devices, or alter a prior runtime report):',
  '  node tests/android-emulator.cjs --probe [--adb <path>] [--apk <file>]',
  'Run against an already-offline, dedicated Android Virtual Device and debug APK:',
  '  node tests/android-emulator.cjs --serial emulator-5554 --avd <exact_AVD_name> --apk <equity-v1.apk> [--upgrade <strategy-v2.apk>] [--legacy-report <baseline.json>] [--adb <path>]',
  '  For the R1 v3 release, pass --r1 with its --apk, --serial, --avd and --adb. On a fresh AVD, --baseline <v2.apk> also checks an in-place upgrade.',
  '  To reproduce and prepare a migration record on the original v2, use --apk <old-v2.apk> --legacy-repro on the same dedicated AVD.',
  '  --legacy-report checks the original v2 first, upgrades directly to patched v2, then uses adb install -r -d for the v1 test on that AVD.',
  'The script verifies the emulator name, QEMU flag and disconnected default network first.',
  'It installs with adb install -r, restarts only org.rivernotes.poker, and records reports/android-test.json.'
].join('\n');
const options = {};
for (let i=2;i<process.argv.length;i++) {
  const key = process.argv[i];
  if (key==='--help' || key==='-h') { console.log(help); process.exit(0); }
  if (key==='--probe') { options.probe=true; continue; }
  if (key==='--legacy-repro') { options.legacyRepro=true; continue; }
  if (key==='--r1') { options.r1=true; continue; }
  if (!['--apk','--upgrade','--baseline','--adb','--serial','--avd','--legacy-report'].includes(key) || !process.argv[i+1] || process.argv[i+1].startsWith('--')) {
    console.error(help); process.exit(2);
  }
  options[key.slice(2)] = process.argv[++i];
}
const reportPath = path.join(root,'reports',options.r1?'android-r1.json':options.legacyRepro?'android-test-legacy-v2.json':'android-test.json');
if (!options.probe && (!/^emulator-[0-9]+$/.test(options.serial || '') || !options.avd || !options.apk)) {
  console.error(help); process.exit(2);
}
const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const adb = options.adb || (sdk && fs.existsSync(path.join(sdk,'platform-tools',adbName))
  ? path.join(sdk,'platform-tools',adbName) : adbName);
const report = {status:'not_run', startedAt:new Date().toISOString(),host:{platform:os.platform(),release:os.release(),arch:os.arch()},
  package:PACKAGE,scenarios:[],commands:[],externalRequests:[],exceptions:[]};
const blocked = message => Object.assign(new Error(message),{blocked:true});
async function command(args, withSerial=true) {
  const argv = withSerial ? ['-s',options.serial,...args] : args;
  const record = {argv:['adb',...argv]}; report.commands.push(record);
  try {
    const {stdout,stderr} = await run(adb,argv,{windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
    record.status=0;
    return (stdout || stderr || '').trim();
  } catch (error) {
    record.status=String(error.code); throw Error('adb '+argv.join(' ')+' failed: '+(error.stderr || error.message).trim());
  }
}
const shell = (...args) => command(['shell',...args]);
async function probe() {
  const evidence = {mode:'prerequisites_only',node:process.version,adb:null,apk:null,emulatorRuntime:'not_attempted'};
  try { evidence.adb=await command(['version'],false); }
  catch (error) { evidence.adbError=error.message; }
  if (options.apk) evidence.apk=fs.existsSync(options.apk) ? path.resolve(options.apk) : null;
  if (options.probe) { console.log(JSON.stringify(evidence,null,2)); return false; }
  if (!evidence.adb || !evidence.apk || typeof WebSocket!=='function') throw blocked('Need adb, an existing debug APK and Node 22+. '+JSON.stringify(evidence));
  if (options.upgrade && !fs.existsSync(options.upgrade)) throw blocked('Upgrade APK unavailable: '+options.upgrade);
  report.adb=evidence.adb;
  return true;
}
async function offline() {
  const dump = await shell('dumpsys','connectivity');
  const line = dump.match(/^\s*Active default network:\s*(.*)$/mi);
  if (!line || !/^(none|null|-1)\s*$/i.test(line[1])) {
    throw blocked('Dedicated emulator must already have no active default network. Observed: '+(line?.[0]?.trim() || 'unrecognized connectivity dump'));
  }
  return line[0].trim();
}
async function identify() {
  let state;
  try { state=await command(['get-state']); }
  catch (error) { throw blocked('Android runtime unavailable. '+error.message); }
  if (state!=='device') throw blocked('Dedicated emulator state: '+state);
  const qemu = [await shell('getprop','ro.kernel.qemu'),await shell('getprop','ro.boot.qemu')];
  const avd = (await command(['emu','avd','name'])).split(/\r?\n/)[0].trim();
  if (!qemu.includes('1') || avd!==options.avd) throw blocked('Serial is not the specified QEMU AVD.');
  report.device={serial:options.serial,avd,qemu,api:await shell('getprop','ro.build.version.sdk'),
    android:await shell('getprop','ro.build.version.release'),abi:await shell('getprop','ro.product.cpu.abilist'),
    offlineBeforeInstall:await offline()};
}
async function installedDigest() {
  const installed=(await shell('pm','path',PACKAGE)).split(/\r?\n/).find(s=>s.endsWith('/base.apk'));
  assert.ok(installed && installed.startsWith('package:/data/app/'),'Installed package path missing');
  return (await shell('sha256sum',installed.slice(8))).split(/\s+/)[0];
}
async function install(file,version,downgrade=false) {
  const artifact={file:path.basename(file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  (report.apks ||= []).push(artifact);
  const output=await command(['install','-r',...(downgrade?['-d']:[]),path.resolve(file)]);
  assert.match(output,/\bSuccess\b/); artifact.installOutput=output;
  const digest=await installedDigest();
  assert.equal(digest,artifact.sha256,'Installed APK differs from input artifact');
  const manifest=await shell('dumpsys','package',PACKAGE);
  assert.doesNotMatch(manifest,/\bandroid\.permission\.INTERNET\b/);
  artifact.installedSha256=digest;
  artifact.versionCode=Number(manifest.match(/\bversionCode=(\d+)/)?.[1]);
  assert.equal(artifact.versionCode,version);
}
let socket,forwardPort;
async function release() {
  if (socket) { socket.close(); socket=null; }
  if (forwardPort) {
    const port=forwardPort; forwardPort=null;
    await command(['forward','--remove','tcp:'+port]);
  }
}
async function scenario(name,fn) {
  const item={name}; report.scenarios.push(item); const start=performance.now();
  try { const value=await fn(); item.status='passed'; return value; }
  catch (error) {item.status=error.blocked ? 'blocked' : 'failed'; item.reason=error.message; throw error;}
  finally {item.elapsedMs=Math.round(performance.now()-start);}
}

// Connect specifically to the WebView page of this process; WebView also supports
// page-level CDP on versions that do not expose a browser-level websocket endpoint.
async function attach(pid) {
  forwardPort=await command(['forward','tcp:0','localabstract:webview_devtools_remote_'+pid]);
  assert.match(forwardPort,/^\d+$/);
  const base='http://127.0.0.1:'+forwardPort;
  let page;
  const attachDeadline=Date.now()+(options.r1?90000:15000);
  while (Date.now()<attachDeadline && !page) {
    try {
      const tabs=await (await fetch(base+'/json/list',{signal:AbortSignal.timeout(1000)})).json();
      page=tabs.find(t=>t.type==='page' && t.url===ENTRY && t.title.includes('权益复盘'));
    } catch { /* WebView may not have opened its socket yet. */ }
    if (!page) await delay(200);
  }
  if (!page) throw Error('Expected the app-local page on its debug WebView. Confirm debug APK and fixed origin.');
  const wsPath=new URL(page.webSocketDebuggerUrl).pathname;
  assert.ok(wsPath.startsWith('/devtools/page/'));
  socket=new WebSocket('ws://127.0.0.1:'+forwardPort+wsPath);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('CDP websocket timeout')),5000);
    socket.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('CDP websocket unavailable'));},{once:true});
  });
  const pending=new Map(); let id=0;
  socket.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const done=pending.get(msg.id); pending.delete(msg.id); done(msg);
    } else if (msg.method==='Network.requestWillBeSent') {
      const url=new URL(msg.params.request.url);
      if (['http:','https:','ws:','wss:'].includes(url.protocol) && url.origin!==new URL(ENTRY).origin) report.externalRequests.push(url.origin);
    } else if (msg.method==='Runtime.exceptionThrown') {
      report.exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method==='Runtime.consoleAPICalled' && msg.params.type==='error') {
      report.exceptions.push('console.error');
    }
  });
  function send(method,params={}) {
    const key=++id;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method+' '+(params.expression || '').slice(0,100)));},
        options.r1 && method==='Network.enable' ? 120000 : 30000);
      pending.set(key,msg=>{ clearTimeout(timeout); msg.error ? reject(Error(msg.error.message)) : resolve(msg.result); });
      socket.send(JSON.stringify({id:key,method,params}));
    });
  }
  await send('Network.enable'); await send('Runtime.enable');
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  evaluate.tap=async selector=>{
    const point=await evaluate('(async()=>{const el=document.querySelector('+JSON.stringify(selector)+');'+
      'el.scrollIntoView({block:"center",inline:"center"});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));'+
      'const box=el.getBoundingClientRect();window.__pokerTrustedTap=false;el.addEventListener("click",e=>{window.__pokerTrustedTap=e.isTrusted;},{once:true});'+
      'return {x:box.x+box.width/2,y:box.y+box.height/2};})()');
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await until(()=>evaluate('window.__pokerTrustedTap===true'),'trusted card touch');
    (report.touches ||= []).push({selector,cssPixels:point,trusted:true,method:'CDP Input.dispatchTouchEvent'});
  };
  return evaluate;
}
async function until(check,label,timeout=30000) {
  const stop=Date.now()+timeout;
  do {
    try {if (await check()) return;}
    catch (error) {
      if (!/Execution context was destroyed|Cannot find context with specified id/i.test(error.message)) throw error;
    }
    await delay(100);
  } while(Date.now()<stop);
  throw Error('Timed out: '+label);
}
async function coldStart(alreadyStopped=false) {
  const offlineBeforeStart=await offline();
  if (!alreadyStopped) await shell('am','force-stop',PACKAGE);
  const launch=await shell('am','start','-W','-n',PACKAGE+'/.MainActivity');
  // First WebView initialization can outlive Activity Manager's fixed -W timeout.
  // In that case verify the resumed Activity and still require its page and completed Worker below.
  if (options.r1 && /Status:\s*timeout/i.test(launch)) {
    await until(async()=>/topResumedActivity=.*org\.rivernotes\.poker\/\.MainActivity/.test(
      await shell('dumpsys','activity','activities')),'resumed R1 acceptance Activity',60000);
  } else assert.match(launch,/Status:\s*ok/i);
  let pid;
  await until(async()=>{try{pid=await shell('pidof',PACKAGE);return /^\d+$/.test(pid);}catch{return false;}},'app PID');
  const js=await attach(pid);
  await until(()=>js("document.querySelector('#job-status')?.textContent==='计算完成'"),'cold start first Worker');
  const state=await js("({url:location.href,online:navigator.onLine,webview:navigator.userAgent,method:document.querySelector('#method').textContent})");
  // navigator.onLine is a WebView hint. The OS default-network check above
  // proves disconnection even when WebView lacks permission to observe changes.
  assert.equal(state.url,ENTRY); assert.match(state.method,/模拟/);
  (report.starts ||= []).push({pid,launch,offlineBeforeStart,...state});
  return js;
}
async function operate(js) {
  const click=id=>js('document.getElementById('+JSON.stringify(id)+').click()');
  const fill=(id,value,event='input')=>js('(()=>{const n=document.getElementById('+JSON.stringify(id)+');n.value='+JSON.stringify(value)+';n.dispatchEvent(new Event('+JSON.stringify(event)+',{bubbles:true}));})()');
  const {setHand,setCombos}=require('./card-controls.cjs')({
    click:s=>js('document.querySelector('+JSON.stringify(s)+').click()'),
    count:s=>js('document.querySelectorAll('+JSON.stringify(s)+').length'),
    readCards:s=>js('Array.from(document.querySelectorAll('+JSON.stringify(s+' [data-slot]')+'),n=>n.dataset.card)'),
    fill:(s,v)=>js('(()=>{const n=document.querySelector('+JSON.stringify(s)+');n.value='+JSON.stringify(v)+';n.dispatchEvent(new Event("input",{bubbles:true}));})()')
  });
  const read=()=>js("Array.from(document.querySelectorAll('[data-prob]'), n=>Number.parseFloat(n.textContent))");
  const runAndWait=async()=>{await click('run');await until(()=>js("document.querySelector('#job-status').textContent==='计算完成'"),'completed simulation',90000);};
  const near=(values,expected,delta)=>expected.forEach((x,i)=>assert.ok(Math.abs(values[i]-x)<=delta,values+' vs '+expected));
  near(await read(),[82.365,.544,17.092,82.637],1);
  await click('mode-range'); await setHand('#hero-preview','As Ks'); await setHand('#board-preview','2s 7s Td');
  await fill('range-kind','weighted','change'); await setCombos(['9c 9d 1']);
  await runAndWait(); near(await read(),[55.05,0,44.95,55.05],1);
  assert.match(await js("document.querySelector('#rows').innerText"),/落后/);
  await setHand('#board-preview','2s 7s Td 3h');await runAndWait();
  near(await read(),[15/44*100,0,29/44*100,15/44*100],1);
  await setHand('#hero-preview','As Qs');await setHand('#board-preview','Qd 8s 2s 7h 3c');await fill('range-kind','uniform','change');
  await runAndWait();near(await read(),[884/990*100,6/990*100,100/990*100,887/990*100],.01);
  await fill('relation-filter','0','change');
  assert.equal(await js("document.querySelectorAll('#rows tr[data-combo]').length"),6);
  await fill('relation-filter','all','change');
  await fill('range-kind','weighted','change');
  await setCombos(['Kc Kd','Qc Kd','Ac Qh .5','2c 2d 0']);
  await runAndWait();near(await read(),[40,20,40,50],0);
  await fill('range-kind','uniform','change'); await setHand('#board-preview','Qd 8s 2s');
  // Observe termination on the actual dedicated Worker without changing implementation.
  await js("window.__terminated=0; const nativeTerminate=Worker.prototype.terminate; Worker.prototype.terminate=function(){window.__terminated++;return nativeTerminate.call(this)}");
  await js("document.querySelector('#run').click(); document.querySelector('#cancel').click()");
  assert.equal(await js('window.__terminated'),1);
  assert.match(await js("document.querySelector('#job-status').textContent"),/取消/);
  // Save a fresh Monte Carlo result to make stale or recomputed history detectable.
  await click('mode-fixed');await click('swap');await runAndWait();
}
const displayedHand = async () => {
  const cards=selector=>Array.from(document.querySelectorAll(selector+' [data-slot]'),n=>n.dataset.card);
  const snapshot={hero:cards('#hero-preview'),probabilities:Array.from(document.querySelectorAll('[data-prob]'),n=>n.textContent)};
  if (document.getElementById('mode-fixed').getAttribute('aria-pressed')==='true') {
    snapshot.villain=cards('#villain-preview');return snapshot;
  }
  snapshot.board=cards('#board-preview');
  snapshot.range=document.getElementById('range-kind').value;
  const previous=document.getElementById('prev-page');
  const next=document.getElementById('next-page');
  while (!previous.disabled) previous.click();
  const rows=[];
  for (;;) {
    rows.push(...Array.from(document.querySelectorAll('#rows [data-combo]'),tr=>[tr.dataset.combo,...Array.from(tr.cells,td=>td.textContent)]));
    if (next.disabled) break;
    next.click();
  }
  snapshot.rows=rows.length;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)));
  snapshot.rowHash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  return snapshot;
};
async function saveAndStop(js,label,settleMs=0) {
  const expected=await js('('+displayedHand+')()');
  assert.equal(expected.probabilities.length,4);
  const acknowledgement=await js(`(()=>{
    const button=document.querySelector('#save');
    if (button.disabled) throw Error('Save disabled');
    const before=new Date().toLocaleString('zh-CN');
    button.click();
    const feedback=document.querySelector('#feedback').textContent;
    if (!feedback.includes('已保存') || !button.disabled) throw Error('Save acknowledgement missing: '+feedback);
    return {feedback,dates:[before,new Date().toLocaleString('zh-CN')]};
  })()`);
  const ackAt=performance.now();
  if (settleMs) await delay(settleMs);
  const dispatchAt=performance.now();
  await shell('am','force-stop',PACKAGE);
  const sample={label,expected,...acknowledgement,settleMs,ackToDispatchMs:+(dispatchAt-ackAt).toFixed(3),ackToStopCompletedMs:Math.round(performance.now()-ackAt)};
  (report.saves ||= []).push(sample);
  await release();
  return sample;
}
async function restoreSaved(js,sample) {
  await js("document.querySelector('#history-open').click()");
  const {hero,villain,board}=sample.expected;
  const title=hero.join(' ')+(villain?' 对 '+villain.join(' '):' · '+board.join(' '));
  const selected=await js(`(()=>{
    const items=Array.from(document.querySelectorAll('[data-history-open]'));
    const hit=items.find(b=>b.querySelector('strong').textContent===${JSON.stringify(title)} && ${JSON.stringify(sample.dates)}.includes(b.querySelector('small').textContent));
    if (!hit){document.querySelector('#history-close').click(); return false;}
    hit.click(); return true;
  })()`);
  if (!selected) return false;
  await until(()=>js("document.querySelector('#job-status').textContent==='已恢复保存结果'"),'visible saved record');
  assert.deepEqual(await js('('+displayedHand+')()'),sample.expected);
  return true;
}
async function legacyRun() {
  await scenario('install original v2 without clearing previous history',()=>install(options.apk,2));
  let js=await coldStart();
  assert.equal(await js("typeof window.RiverHistory"),'undefined');
  const legacyKeys=()=>js("JSON.parse(localStorage.getItem('river-notes.history.v1') || '[]').map(r=>r.time)");
  report.previousLegacyRecordTimes=await legacyKeys();
  const immediate=await saveAndStop(js,'original v2 immediate stop');
  js=await coldStart(true);
  report.immediateLegacyRecordRestored=await restoreSaved(js,immediate);
  // This deliberately settled legacy fixture is used to test migration separately from the old write-loss bug.
  await js("document.querySelector('#run').click()");
  await until(()=>js("document.querySelector('#job-status').textContent==='计算完成'"),'legacy fixture calculation');
  report.legacySample=await saveAndStop(js,'original v2 settled migration fixture',8000);
  js=await coldStart(true);
  assert.equal(await restoreSaved(js,report.legacySample),true,'stable legacy fixture missing after restart');
  report.legacyRecordTimes=await legacyKeys();
}
async function main() {
  if (!(await probe())) return;
  await scenario('identify named offline emulator',identify);
  if (options.r1) {
    let previousHand;
    if (options.baseline) {
      await scenario('save a hand with the previous v2 APK',async()=>{
        await install(options.baseline,2);
        previousHand=await saveAndStop(await coldStart(),'pre-R1 v2');
      });
    }
    await scenario('install R1 preserving app data and verify installed digest',()=>install(options.apk,3));
    const js=await scenario('cold start offline R1 WebView',coldStart);
    if (previousHand) await scenario('restore v2 history after upgrading to v3',async()=>{
      assert.equal(await restoreSaved(js,previousHand),true);
    });
    await scenario('exact turn, weights, cache coverage, cancel, Android background and named range restart',()=>
      require('./r1-ui.cjs')(js,report,async()=>{
        const pid=await shell('pidof',PACKAGE);
        try {
          const status=await shell('run-as',PACKAGE,'cat','/proc/'+pid+'/status');
          report.appProcessPeakRssKiB=Number(status.match(/^VmHWM:\s*(\d+) kB/m)?.[1]) || null;
        } catch { report.appProcessPeakRssKiB=null; }
        await release();return coldStart();
      },async()=>{
        await shell('input','keyevent','KEYCODE_HOME');
        await until(()=>js('document.hidden'),'WebView hidden');
        await shell('am','start','-W','--activity-single-top','--activity-reorder-to-front','-n',PACKAGE+'/.MainActivity');
        await until(()=>js('!document.hidden'),'WebView visible');
      }));
    assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.exceptions,[]);
    report.offlineAfterRun=await offline();
    report.status='passed';return;
  }
  if (options.legacyRepro) {
    await scenario('original v2 immediate-stop observation and stable legacy fixture',legacyRun);
    report.status='passed';return;
  }
  let legacy;
  if (options['legacy-report']) {
    legacy=JSON.parse(fs.readFileSync(options['legacy-report'],'utf8'));
    assert.ok(options.upgrade && legacy.legacySample && legacy.device.avd===report.device.avd);
    await scenario('verify original v2 still installed on same AVD',async()=>assert.equal(await installedDigest(),legacy.apks[0].installedSha256));
    await scenario('upgrade original v2 directly to fixed v2 preserving data',()=>install(options.upgrade,2));
    const migrated=await coldStart();
    await scenario('open original v2 localStorage hand from patched history list',async()=>{
      assert.equal(await restoreSaved(migrated,legacy.legacySample),true);
      const times=await migrated("JSON.parse(localStorage.getItem('river-notes.history.v1') || '[]').map(r=>r.time)");
      for (const time of legacy.legacyRecordTimes) assert.ok(times.includes(time),'lost legacy record '+time);
      report.legacyMigration={expected:legacy.legacySample.expected,dates:legacy.legacySample.dates,recordCount:times.length};
    });
    await release();
  }
  await scenario('install v1 APK and verify installed digest + permissions',()=>install(options.apk,1,Boolean(legacy)));
  const js=await scenario('offline cold start from packaged HTTPS origin',coldStart);
  await scenario('Worker probabilities, each street, weighting, filtering and cancel',()=>operate(js));
  const saved=await scenario('v1 save confirmation then immediate am force-stop',()=>saveAndStop(js,'patched v1'));
  const reopened=await scenario('offline cold restart of stopped v1',()=>coldStart(true));
  await scenario('restore exact v1 hand and probabilities',async()=>assert.equal(await restoreSaved(reopened,saved),true));
  if (options.upgrade) {
    await release();
    await scenario('in-place upgrade without clearing app data',()=>install(options.upgrade,2));
    let v2=await scenario('offline cold launch of upgraded APK',coldStart);
    await scenario('restore v1 equity record after upgrade',async()=>assert.equal(await restoreSaved(v2,saved),true));
    await v2("document.querySelector('#mode-range').click();document.querySelector('#run').click()");
    await until(()=>v2("document.querySelector('#job-status').textContent==='计算完成'"),'v2 calculation');
    const savedV2=await scenario('v2 save confirmation then immediate am force-stop',()=>saveAndStop(v2,'patched v2'));
    assert.equal(savedV2.expected.rows,990);assert.equal(savedV2.expected.range,'uniform');
    v2=await coldStart(true);
    await scenario('restore exact v2 hand and probabilities after force-stop',async()=>assert.equal(await restoreSaved(v2,savedV2),true));
    if (legacy) await scenario('original v2 hand still opens alongside native records',async()=>assert.equal(await restoreSaved(v2,legacy.legacySample),true));
    await scenario('strategy models, information sets, card picker, checkpoint and return',
      ()=>require('./android-strategy.cjs')(v2,until,report));
  }
  assert.deepEqual(report.externalRequests,[]); assert.deepEqual(report.exceptions,[]);
  report.offlineAfterRun=await offline();
  report.status='passed';
}
main().catch(error=>{report.status=error.blocked?'blocked':'failed';report.reason=error.message;console.error(error.message);process.exitCode=1;})
  .finally(async()=>{
    try {await release();} catch(error){report.cleanupError=error.message; report.status='failed';process.exitCode=1;}
    if (!options.probe) {
      fs.mkdirSync(path.dirname(reportPath),{recursive:true});
      fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
      console.log(report.status,reportPath);
    }
  });
