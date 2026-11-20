const assert = require('node:assert/strict');
const controls = require('./card-controls.cjs');

// Both hosts drive the shipped form and real Blob Worker. Observe messages without changing their results.
module.exports = async function r1UI(js, report, reopen, background) {
  const click = selector => js('document.querySelector('+JSON.stringify(selector)+').click()');
  const text = selector => js('document.querySelector('+JSON.stringify(selector)+').textContent');
  const fill = (s,v,event='input') => js('(()=>{const n=document.querySelector('+JSON.stringify(s)+');n.value='+
    JSON.stringify(v)+';n.dispatchEvent(new Event('+JSON.stringify(event)+',{bubbles:true}));})()');
  const {setHand,setCombos} = controls({click,fill,
    count:s=>js('document.querySelectorAll('+JSON.stringify(s)+').length'),
    readCards:s=>js('Array.from(document.querySelectorAll('+JSON.stringify(s+' [data-slot]')+'),n=>n.dataset.card)')});
  const summary = () => js("Array.from(document.querySelectorAll('[data-prob]'),n=>n.textContent)");
  const kind = value => fill('#range-kind',value,'change');
  const rangeName = 'R1-'+Date.now();
  await js.tap('#mode-range');
  await setHand('#hero-preview','As Ah');
  await setHand('#board-preview','Kc 7d 2h 3s');
  await kind('weighted');
  await setCombos(['Kd Kh .75','Qc Qd .25']);
  await fill('#range-name',rangeName);
  await js.tap('#save-range');
  assert.match(await text('#feedback'),/已保存/);

  await js(`(()=>{
    window.r1Jobs=[];
    const post=Worker.prototype.postMessage, stop=Worker.prototype.terminate;
    Worker.prototype.postMessage=function(input,...rest){
      const sample={rows:input.prepared.range.length,hits:input.cached.size,progress:0,partial:false};
      this.sample=sample;r1Jobs.push(sample);
      this.addEventListener('message',({data})=>{
        if(data.type!=='progress') return;
        sample.progress++;
        sample.partial ||= Array.from(document.querySelectorAll('[data-prob]')).some(n=>n.textContent.includes('%'))
          || !document.querySelector('#combos').hidden || 'result' in data;
        if(window.r1Cancel){
          window.r1Cancel=false;
          const at=performance.now();
          document.querySelector('#cancel').click();
          sample.cancelMs=performance.now()-at;
        }
      });
      return post.call(this,input,...rest);
    };
    Worker.prototype.terminate=function(){if(this.sample)this.sample.terminated=true;return stop.call(this);};
  })()`);
  const run = async (name,cancel=false) => {
    const sample = await js(`new Promise((resolve,reject)=>{
      const status=document.querySelector('#job-status'),start=performance.now();
      let lastFrame=start,frames=0,maxFrameGap=0,frame;
      function tick(t){maxFrameGap=Math.max(maxFrameGap,t-lastFrame);lastFrame=t;frames++;frame=requestAnimationFrame(tick);}
      frame=requestAnimationFrame(tick);
      const timeout=setTimeout(()=>{observer.disconnect();cancelAnimationFrame(frame);reject(Error(status.textContent));},60000);
      const observer=new MutationObserver(()=>{
        if(!/计算完成|已取消|输入待检查/.test(status.textContent))return;
        observer.disconnect();clearTimeout(timeout);cancelAnimationFrame(frame);
        const end=performance.now();
        resolve({...r1Jobs[r1Jobs.length-1],status:status.textContent,elapsedMs:end-start,frames,
          maxFrameGapMs:Math.max(maxFrameGap,end-lastFrame)});
      });
      observer.observe(status,{childList:true});
      window.r1Cancel=${cancel};
      document.querySelector('#run').click();
    })`);
    assert.equal(sample.status,cancel?'已取消计算':'计算完成');
    assert.equal(sample.terminated,true);assert.equal(sample.partial,false);
    (report.r1Runs ||= []).push({name,...sample});
    return sample;
  };
  assert.equal((await run('weighted cold')).hits,0);
  assert.deepEqual(await summary(),['27.27%','0.00%','72.73%','27.27%']);
  assert.ok((await text('#range-summary')).includes(rangeName));
  await fill('#relation-filter','1','change');
  assert.equal(await js("document.querySelectorAll('#rows tr').length"),1);
  assert.equal((await summary())[3],'27.27%');
  await fill('#relation-filter','all','change');
  await fill('#range-list input','.25');
  assert.equal((await run('weights only')).hits,2);
  assert.equal((await summary())[3],'50.00%');
  await kind('uniform');
  assert.equal((await run('expand to uniform')).hits,2);
  assert.match(await text('#count'),/1035/);
  await setHand('#hero-preview','As Kh');
  await setHand('#board-preview','2s 3s 4s 9d');
  const aborted=await run('cancel after exact progress',true);
  assert.equal(aborted.hits,0);assert.ok(aborted.progress>0);
  assert.deepEqual(await summary(),['—','—','—','—']);
  assert.equal((await run('uniform cold')).hits,0);
  assert.match(await text('#method'),/精确/);
  await kind('weighted');
  await setCombos(['Ac Kd 1']);
  assert.equal((await run('current tie')).hits,1);
  assert.deepEqual(await summary(),['20.45%','79.55%','0.00%','60.23%']);
  assert.match(await text('#rows'),/持平/);
  await js.tap('#rows summary');
  assert.match(await text('#rows details[open]'),/赢 9 · 平 35 · 输 0/);
  if (background) {
    // A full flop uses the same controller and stays active long enough for a real Activity transition.
    await kind('uniform');await setHand('#board-preview','2s 3s 4s');
    await click('#run');
    await background();
    assert.match(await text('#job-status'),/取消/);
    assert.deepEqual(await summary(),['—','—','—','—']);
    assert.deepEqual(await js("Array.from(document.querySelectorAll('#board-preview [data-card]'),n=>n.dataset.card).filter(Boolean)"),['2s','3s','4s']);
    await click('#history-open');await click('#history-list button:last-child');
    assert.equal((await summary())[3],'60.23%');
    await run('recompute after foreground');
  }
  js=await reopen();
  await js.tap('#mode-range');await kind('weighted');
  await fill('#saved-range',rangeName,'change');
  assert.equal(await js("document.querySelector('#range-name').value"),rangeName);
  assert.deepEqual(await js("Array.from(document.querySelectorAll('#range-list input'),n=>Number(n.value))"),[.75,.25]);
  assert.deepEqual(await js("Array.from(document.querySelectorAll('#range-list [data-card]'),n=>n.dataset.card)"),['Kd','Kh','Qc','Qd']);
};
