const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const controls = require('./card-controls.cjs');

module.exports = function campTests({coldStart,install,installedDigest,until,report,scenario,
  restoreSaved,saveAndStop,release,shell,baselinePath}) {
  const checkpointKey='river-notes.strategy.checkpoint.v1';
  function page(js) {
    const click=selector=>js('document.querySelector('+JSON.stringify(selector)+').click()');
    const fill=(selector,value,event='input')=>js('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');el.value='+
      JSON.stringify(value)+';el.dispatchEvent(new Event('+JSON.stringify(event)+',{bubbles:true}));})()');
    const wait=(test,label,timeout)=>until(()=>js(test),label,timeout);
    const navigate=async(selector,pathname)=>{
      await click(selector);
      await wait('location.pathname==='+JSON.stringify(pathname)+' && document.readyState==="complete"',pathname);
    };
    return {click,fill,wait,navigate};
  }
  async function readCheckpoint(js) {
    return js(`(async()=>{
      const data=localStorage.getItem(${JSON.stringify(checkpointKey)});
      if (!data) return null;
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
      return {iterations:JSON.parse(data).checkpoint.iterations,
        sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
    })()`);
  }
  async function trainingSnapshot(js) {
    const raw=await js("localStorage.getItem(TrainingSession.key)");
    const state=JSON.parse(raw),round=state.round;
    assert.ok(round && round.index<round.questions.length);
    return {sha256:crypto.createHash('sha256').update(raw).digest('hex'),hand:round.questions[round.index],
      index:round.index,answered:round.answers.length,mistakes:state.mistakes.length,
      visible:await js("({progress:document.querySelector('#training-progress').textContent,hand:document.querySelector('#training-question').dataset.hand,feedback:document.querySelector('#training-feedback').dataset.tier})")};
  }
  async function prepare(apk,version=4) {
    const old='v'+version, next='v'+(version+1);
    await scenario('install '+old+' and verify signed baseline bytes',()=>install(apk,version));
    const js=await coldStart(false,version>=5);
    const {click,fill,wait,navigate}=page(js);
    if (version>=5) {
      await scenario('answer a hand in v5 and leave the training round unfinished',async()=>{
        await navigate('#start-training','/training/index.html');
        await wait("!document.querySelector('#training-question').hidden",'active round');
        if (await js("document.querySelector('#training-feedback').hidden")) {
          await js.tap('#training-actions button');
          await wait("!document.querySelector('#training-feedback').hidden",'answer saved in session');
        }
        report.training=await trainingSnapshot(js);
        await navigate('#training-home','/index.html');
      });
      await navigate('#open-equity','/equity.html');
    }
    await scenario('save '+old+' weighted range using the equity editor',async()=>{
      await click('#mode-range');
      await fill('#range-kind','weighted','change');
      const {setCombos}=controls({click,fill,count:s=>js('document.querySelectorAll('+JSON.stringify(s)+').length'),
        readCards:s=>js('Array.from(document.querySelectorAll('+JSON.stringify(s+' [data-slot]')+'),n=>n.dataset.card)')});
      await setCombos(['Kd Kh .75','9c 9d .25']);
      report.rangeName=old+'-upgrade-'+Date.now();
      await fill('#range-name',report.rangeName);
      await click('#save-range');
      assert.match(await js("document.querySelector('#feedback').textContent"),/已保存/);
    });
    await scenario('record resumable '+old+' river solver checkpoint',async()=>{
      if (version>=5) await navigate('a[href$="index.html"]','/index.html');
      await navigate('#open-strategy','/strategy/index.html');
      const prior=await readCheckpoint(js);
      if (!prior || version>=5) {
        await click(prior?'#gto-resume':'#gto-run'); await click('#gto-pause');
        await wait("document.querySelector('#gto-badge').textContent==='已暂停'",old+' worker paused');
      }
      report.checkpoint=await readCheckpoint(js);
      assert.ok(report.checkpoint);
    });
    await scenario('save a '+old+' hand through the app and immediately force-stop',async()=>{
      await navigate('a[href="../index.html"]','/index.html');
      if (version>=5) await navigate('#open-equity','/equity.html');
      await wait("document.querySelector('#job-status').textContent==='计算完成'",'completed '+old+' equity');
      await saveAndStop(js,'before '+next+' upgrade');
    });
  }
  async function verify(apk,version=5) {
    const old='v'+(version-1), next='v'+version;
    const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
    assert.equal(baseline.status,'passed');
    assert.equal(baseline.device.avd,report.device.avd);
    assert.equal(baseline.device.serial,report.device.serial);
    const oldSha=baseline.apks[0].sha256;
    const before=await installedDigest();
    const receipt=path.join(__dirname,'../reports/android-upgrade-'+next+'.json');
    if (before!==oldSha) {
      const prior=JSON.parse(fs.readFileSync(receipt,'utf8'));
      assert.equal(prior.before,oldSha);
      assert.equal(prior.device.avd,report.device.avd);
      assert.equal(prior.device.serial,report.device.serial);
    }
    await scenario('in-place install and verify installed '+next+' bytes',()=>install(apk,version));
    report.upgrade={baseline:oldSha,previouslyInstalled:before,
      ['fromV'+(version-1)]:before===oldSha,range:baseline.rangeName,checkpoint:baseline.checkpoint};
    if (before===oldSha) fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),device:report.device,
      before,after:report.apks[0].installedSha256,install:report.apks[0].installOutput},null,2)+'\n');
    const js=await scenario('open offline '+next+' dashboard',()=>coldStart(false,true));
    const {click,fill,wait,navigate}=page(js);
    if (version>=6) await scenario('restore exact v5 answered question, round and mistakes in v6',async()=>{
      await navigate('#start-training','/training/index.html');
      await wait("!document.querySelector('#training-feedback').hidden",'restored answered hand');
      report.training=await trainingSnapshot(js);
      assert.deepEqual(report.training,baseline.training);
      await navigate('#training-home','/index.html');
    });
    await scenario('reopen exact '+old+' hand and named range from '+next+' equity',async()=>{
      await navigate('a[href$="equity.html"]','/equity.html');
      await wait("document.querySelector('#job-status').textContent==='计算完成'",'completed '+next+' equity');
      assert.equal(await restoreSaved(js,baseline.saves[0]),true);
      await click('#mode-range');await fill('#range-kind','weighted','change');
      await fill('#saved-range',baseline.rangeName,'change');
      assert.equal(await js("document.querySelector('#range-name').value"),baseline.rangeName);
      const cards=await js("Array.from(document.querySelectorAll('#range-list [data-card]'),n=>n.dataset.card)");
      const weights=await js("Array.from(document.querySelectorAll('#range-list input'),n=>Number(n.value))");
      assert.deepEqual(cards,['Kd','Kh','9c','9d']);assert.deepEqual(weights,[.75,.25]);
      if (version>=6) {
        report.upgrade.restoredHand=baseline.saves[0].expected;
        report.upgrade.restoredRange={name:baseline.rangeName,cards,weights};
      }
    });
    await scenario('load the identical '+old+' river checkpoint in the '+next+' solver',async()=>{
      await js("history.back()");
      await wait("location.pathname==='/index.html' && !document.querySelector('#open-strategy')?.hidden",'strategy-enabled home');
      await navigate('#open-strategy','/strategy/index.html');
      assert.deepEqual(await readCheckpoint(js),baseline.checkpoint);
      assert.equal(await js("document.querySelector('#gto-resume').disabled"),false);
      assert.equal(await js("Number(document.querySelector('#gto-iterations').textContent)"),baseline.checkpoint.iterations);
    });
    await release();
    const size=await shell('wm','size');
    const override=size.match(/Override size:\s*(\d+x\d+)/)?.[1];
    const density=await shell('wm','density');
    const dpi=Number((density.match(/Override density:\s*(\d+)/) || density.match(/Physical density:\s*(\d+)/))[1]);
    const setViewport=width=>shell('wm','size',Math.round(width*dpi/160)+'x'+Math.round(800*dpi/160));
    await setViewport(360);
    try {
      if (version>=6) {
        const current=await coldStart(false,true);
        await require('./android-river.cjs')({js:current,p:page(current),scenario,report,setViewport});
      } else await exerciseTraining();
    }
    finally {await shell('wm','size',override || 'reset');}
  }
  async function exerciseTraining() {
    let js=await coldStart(false,true);
    const viewport=await js("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})");
    report.viewport=viewport;
    assert.equal(viewport.width,360);
    await scenario('matrix, position filters and trusted taps at 360 CSS pixels',async()=>{
      js.navigate=page(js).click;
      await require('./preflop-ui.cjs')(js,page(js).wait);
      await page(js).navigate('#open-preflop','/preflop/index.html');
      await js.tap('#preflop-matrix [data-hand="22"]');
      assert.match(await js("document.querySelector('#preflop-summary').textContent"),/22/);
      assert.equal(await js("(()=>{const r=document.querySelector('#preflop-summary').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()"),true);
      await page(js).navigate('#preflop-home','/index.html');
    });
    await scenario('answer ten hands with feedback, chart, Android back and cold resume',async()=>{
      let p=page(js);
      await p.navigate('#start-training','/training/index.html');
      await p.wait("!!document.querySelector('#training-question').dataset.hand",'training question');
      report.trainingDomReadyMs=Math.round(await js("performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd"));
      report.answerPaintMs=[];
      let question=await js("({...document.querySelector('#training-question').dataset})");
      // Replay stays valid after an interrupted test or a prior verification.
      if (!await js("document.querySelector('#training-feedback').hidden")) {
        await p.click('#training-next');
        await until(()=>js("document.querySelector('#training-feedback').hidden || !document.querySelector('#training-summary').hidden"),'advance answered hand');
      }
      if (!await js("document.querySelector('#training-summary').hidden")) {
        await p.click('#training-again');
        await p.wait("!document.querySelector('#training-question').hidden",'another round');
      }
      let checkedReturn=false, requestedError=false;
      while (await js("document.querySelector('#training-summary').hidden")) {
        question=await js("({...document.querySelector('#training-question').dataset})");
        const choices=await js("(()=>{const q=document.querySelector('#training-question').dataset;"+
          "return PreflopRanges.recommend(PreflopRanges.getSpot(q.mode,q.hero,q.opponent),q.hand).tiers})()");
        const entries=Object.entries(choices);
        const [move,tier]=(!requestedError && entries.find(([,t])=>t==='avoid')) || entries.find(([,t])=>t==='low') || entries.find(([,t])=>t==='high');
        if (tier==='avoid') requestedError=true;
        await js(`window.__answerPaint=null;document.querySelector('#training-actions').addEventListener('click',()=>{
          const start=performance.now();
          function painted(){if(document.querySelector('#training-feedback').hidden)requestAnimationFrame(painted);
            else requestAnimationFrame(()=>{window.__answerPaint=performance.now()-start;});}
          requestAnimationFrame(painted);
        },{capture:true,once:true})`);
        await js.tap('#training-actions [data-move="'+move+'"]');
        await p.wait("Number.isFinite(window.__answerPaint)",'feedback visible');
        assert.equal(await js("document.querySelector('#training-feedback').dataset.tier"),tier);
        report.answerPaintMs.push(Math.round(await js('window.__answerPaint')));
        if (!checkedReturn) {
          await p.navigate('#training-chart','/preflop/index.html');
          assert.equal(await js("document.querySelector('#preflop-hand').value"),question.hand);
          await shell('input','keyevent','4');
          await p.wait("location.pathname==='/training/index.html' && document.querySelector('#training-feedback')?.hidden===false",'Android back restores answered question');
          await release();js=await coldStart(false,true);p=page(js);
          await p.navigate('#start-training','/training/index.html');
          await p.wait("document.querySelector('#training-feedback').hidden===false",'resume last answer after force-stop');
          assert.deepEqual(await js("({...document.querySelector('#training-question').dataset})"),question);
          checkedReturn=true;
        }
        const prior=await js("document.querySelector('#training-progress').innerText");
        await p.click('#training-next');
        await p.wait("!document.querySelector('#training-summary').hidden || document.querySelector('#training-progress').innerText!=="+JSON.stringify(prior),'next question or summary');
      }
      assert.equal(await js("Array.from(document.querySelectorAll('#training-scores dd'),e=>Number(e.textContent)).reduce((a,b)=>a+b,0)"),10);
      assert.ok(requestedError);
    });
    await scenario('review mistakes and verify scoped training from the chart',async()=>{
      const p=page(js);
      await p.click('#training-book');
      await p.wait("!document.querySelector('#training-review').hidden",'mistakes');
      assert.ok(await js("document.querySelectorAll('#training-review-list button').length"));
      await p.click('#training-start-review');
      await p.wait("document.querySelector('#training-title').textContent==='错题复练'",'start review');
      const q=await js("({...document.querySelector('#training-question').dataset})");
      const correct=await js("(()=>{const q=document.querySelector('#training-question').dataset;return PreflopRanges.recommend(PreflopRanges.getSpot(q.mode,q.hero,q.opponent),q.hand).primary})()");
      await js.tap('#training-actions [data-move="'+correct+'"]');
      await p.wait("document.querySelector('#training-feedback').dataset.tier==='high'",'correct reattempt');
      await p.navigate('#training-chart','/preflop/index.html');
      assert.equal(await js("document.querySelector('#preflop-hand').value"),q.hand);
      await p.navigate('#preflop-practice','/training/index.html');
      await p.wait("!document.querySelector('#training-switch').hidden",'change training scope');
      await p.click('#training-confirm-switch');
      await p.wait("document.querySelector('#training-title').textContent==='局面专项训练'",'train this spot');
      const fixed=await js("({...document.querySelector('#training-question').dataset})");
      assert.deepEqual([fixed.mode,fixed.hero,fixed.opponent],[q.mode,q.hero,q.opponent]);
    });
  }
  async function timeFirstHand(apk) {
    report.installedSha256=await installedDigest();
    assert.equal(report.installedSha256,crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'));
    const js=await coldStart(false,true), p=page(js);
    await scenario('finish the existing practice round to expose the new round entry',async()=>{
      const resume=await js("document.querySelector('#start-training').textContent.includes('继续')");
      if (!resume) return;
      await p.navigate('#start-training','/training/index.html');
      await p.wait("!document.querySelector('#training-question').hidden",'resumed practice');
      for (let i=0;i<10 && await js("document.querySelector('#training-summary').hidden");i++) {
        if (await js("document.querySelector('#training-feedback').hidden")) {
          const move=await js("(()=>{const q=document.querySelector('#training-question').dataset;return PreflopRanges.recommend(PreflopRanges.getSpot(q.mode,q.hero,q.opponent),q.hand).primary})()");
          await p.click('#training-actions [data-move="'+move+'"]');
          await p.wait("!document.querySelector('#training-feedback').hidden",'answered');
        }
        const progress=await js("document.querySelector('#training-progress').textContent");
        await p.click('#training-next');
        await p.wait("!document.querySelector('#training-summary').hidden || document.querySelector('#training-progress').textContent!=="+JSON.stringify(progress),'advanced');
      }
      await p.navigate('#training-home','/index.html');
    });
    await scenario('measure trusted start tap to two frames after all first-hand controls are visible',async()=>{
      assert.equal((await js("document.querySelector('#start-training').textContent")).trim(),'开始训练');
      const visibleQuestion=`(()=>{
        if(location.pathname!=='/training/index.html')return false;
        const start=Number(sessionStorage.getItem('__campTimingStart'));
        if(!start)return false;
        if(window.__campPaint)return true;
        if(window.__campTimingObserver)return false;
        window.__campTimingObserver=true;
        const visible=el=>{const r=el.getBoundingClientRect();return r.width>0 && r.height>0 &&
          r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;};
        function frame(){
          const q=document.querySelector('#training-question'),hand=document.querySelector('#training-pocket');
          const buttons=[...document.querySelectorAll('#training-actions [data-move]')];
          if(!q?.dataset.hand || !hand || !visible(hand) || buttons.length<2 || !buttons.every(b=>!b.disabled && visible(b))){
            requestAnimationFrame(frame);return;
          }
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            window.__campPaint={elapsedMs:Math.round(performance.timeOrigin+performance.now()-start),
              hand:q.dataset.hand,actions:buttons.map(b=>b.dataset.move),viewport:[innerWidth,innerHeight],
              progress:document.querySelector('#training-progress').textContent};
          }));
        }
        requestAnimationFrame(frame);
        return false;
      })()`;
      await js("document.querySelector('#start-training').addEventListener('click',e=>{if(e.isTrusted)sessionStorage.setItem('__campTimingStart',String(performance.timeOrigin+performance.now()))},{once:true,capture:true})");
      await js.tap('#start-training',visibleQuestion);
      report.startToVisible=await js("window.__campPaint");
      assert.match(report.startToVisible.progress,/第 1 \/ 10 手/);
      report.startToVisible.method='WebView trusted click on 开始训练 to two animation frames after CDP observed the dealt hand and all enabled action buttons inside the viewport; includes observation latency, one new mixed round';
      await js("sessionStorage.removeItem('__campTimingStart')");
    });
  }
  return {prepare,verify,timeFirstHand};
};
