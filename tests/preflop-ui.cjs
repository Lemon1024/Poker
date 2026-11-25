const assert = require('node:assert/strict');

// Shared assertions for the standalone file and the installed Android WebView.
module.exports = async function exercisePreflop(js, waitFor) {
  const $ = locator => 'document.querySelector('+JSON.stringify(locator)+')';
  const text = locator => js($(locator)+'.textContent');
  const cell = hand => '#preflop-matrix [data-hand='+JSON.stringify(hand)+']';
  const select = async (id,value) => {
    const selector='#preflop-'+id;
    if (js.select) return js.select(selector,value);
    await js(`(()=>{const el=${$(selector)};el.value=${JSON.stringify(value)};
      el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const options = id => js(`Array.from(${$('#preflop-'+id)}.options,option=>option.value)`);
  const tier = move => js($('#preflop-tiers [data-action='+move+']')+'.dataset.tier');
  const mark = hand => js($(cell(hand))+'.dataset.mark');
  const navigate = js.navigate || js.tap;

  await navigate('#open-preflop');
  await waitFor("document.querySelectorAll('.preflop-cell').length===169",'169 hand classes');
  assert.ok(await js('window.innerWidth<window.innerHeight'),'portrait viewport');
  assert.ok(await js('document.documentElement.scrollWidth<=window.innerWidth'),'matrix fits portrait viewport');
  assert.equal(await text('#preflop-version'),'1.0.0');
  assert.deepEqual(await options('hero'),['UTG','HJ','CO','BTN','SB']);
  await select('hero','UTG');
  await select('action','raise');
  await select('frequency','low');
  assert.equal(await mark('AA'),'unmatched');
  assert.equal(await mark('A7s'),'low');
  await js.tap(cell('A7s'));
  assert.equal(await tier('raise'),'low');
  assert.equal(await tier('fold'),'high');

  await select('mode','vsOpen');
  await select('hero','BTN');
  await select('opponent','UTG');
  assert.deepEqual(await options('opponent'),['UTG','HJ','CO']);
  await js.tap(cell('99'));
  assert.equal(await tier('call'),'high');
  await select('opponent','CO');
  assert.equal(await js($('#preflop-hand')+'.value'),'99');
  assert.equal(await tier('threeBet'),'high');
  assert.match(await text('#preflop-tiers'),/3-bet · 加到 7.5BB/);
  await select('frequency','high');
  assert.equal(await mark('99'),'high');
  assert.equal(await mark('A5s'),'unmatched');
  await select('frequency','low');
  assert.equal(await mark('99'),'unmatched');
  assert.equal(await mark('A5s'),'low');
  await js.tap(cell('A5s'));
  assert.equal(await tier('threeBet'),'low');
  assert.match(await text('#preflop-reason'),/阻挡/);

  await select('mode','vsThreeBet');
  await select('opponent','BB');
  assert.match(await text('#preflop-line'),/BTN 开到 2.5BB → BB 加到 10BB → 轮到 BTN/);
  await select('hand','AA');
  assert.equal(await tier('fourBet'),'high');
  assert.match(await text('#preflop-tiers'),/4-bet · 加到 22BB/);
  await select('hero','UTG');
  await js.tap(cell('72o'));
  assert.equal(await mark('72o'),'outside');
  assert.equal(await text('#preflop-reason'),'此牌不在该位置开池范围。');
  assert.equal(await text('#preflop-tiers'),'');
  await select('hero','SB');
  assert.deepEqual(await options('opponent'),['BB']);
  assert.match(await text('#preflop-line'),/SB 开到 3BB → BB 加到 9BB/);
  await select('mode','vsOpen');
  await select('hero','BB');
  await select('opponent','SB');
  await js.tap(cell('AA'));
  assert.match(await text('#preflop-tiers'),/3-bet · 加到 9BB/);

  await navigate('#preflop-home');
  await waitFor("!!document.querySelector('#start-training') || document.querySelector('#job-status')?.textContent==='计算完成'",'return to home');
};
