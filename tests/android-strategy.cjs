const assert = require('node:assert/strict');

// Operates the installed WebView using the existing CDP page's DOM controls.
module.exports = async function exerciseStrategy(js, until, report) {
  await until(()=>js("!!document.querySelector('#open-strategy')"),'native strategy navigation');
  await js("document.querySelector('#open-strategy').click()");
  await until(()=>js("location.pathname==='/strategy/index.html' && !!document.querySelector('#gto-preset')"),'strategy page');
  const read=id=>js('document.getElementById('+JSON.stringify('gto-'+id)+').textContent');
  const click=id=>js('document.getElementById('+JSON.stringify('gto-'+id)+').click()');
  const fill=(id,value,event)=>js('(()=>{const e=document.getElementById('+JSON.stringify('gto-'+id)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event('+JSON.stringify(event)+',{bubbles:true}));})()');
  const state=(states,ms=30000)=>until(async()=>states.includes(await read('badge')),'GTO '+states.join('/'),ms);
  await click('board-pick');
  await js.tap('#gto-deck [data-card=Qh]');
  await click('picker-apply');
  assert.equal(await js("document.querySelector('#gto-board [data-card]')?.dataset.card ?? document.querySelector('#gto-board').value?.split(' ')[0]"),'Qh');
  report.strategy=[];
  for (const preset of ['equal','weighted']) {
    await fill('preset',preset,'change');
    const attempt={preset,budgetSeconds:600};report.strategy.push(attempt);
    await fill('seconds',String(attempt.budgetSeconds),'input');
    const start=performance.now();
    await click('run');
    if (preset==='weighted') {
      await click('pause');await state(['已暂停'],60000);
      attempt.checkpointIteration=await read('iterations');
      await js('location.reload()');
      await until(()=>js("!!document.querySelector('#gto-resume') && !document.querySelector('#gto-resume').hidden && !document.querySelector('#gto-resume').disabled"),'persisted checkpoint',60000);
      assert.equal(await read('iterations'),attempt.checkpointIteration);
      await click('resume');
    }
    await state(['已达标','迭代未达标','超时未达标'],(attempt.budgetSeconds+90)*1000);
    attempt.status=await read('badge');attempt.iterations=await read('iterations');attempt.errorPercent=await read('error');
    attempt.elapsedMs=Math.round(performance.now()-start);
    assert.equal(attempt.status,'已达标','Android benchmark '+preset+' '+JSON.stringify(attempt));
    assert.ok(parseFloat(attempt.errorPercent)<=0.1);
    assert.equal(await js("document.querySelectorAll('#gto-matrix button').length"),169);
    await fill('history','check/bet:50','change');assert.match(await read('actions'),/弃牌/);
  }
  await js("document.querySelector('a[href=\"../index.html\"]').click()");
  await until(()=>js("location.pathname==='/index.html' && document.querySelector('#job-status')?.textContent==='计算完成'"),'return to equity',60000);
};
