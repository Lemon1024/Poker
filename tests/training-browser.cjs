const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const {getSpot,recommend} = require('../preflop/ranges.js');

module.exports = async function trainingBrowser({page,scenario,report,reportFile}) {
  const $ = selector => page.locator(selector);
  const home = page.url();
  const feedback = $('#training-feedback');
  const next = $('#training-next');
  const question = $('#training-question');
  const deal = async () => {
    await question.waitFor({state:'visible'});
    const q = await question.evaluate(n => ({
      mode:n.dataset.mode,hero:n.dataset.hero,opponent:n.dataset.opponent || '',hand:n.dataset.hand
    }));
    const spot = getSpot(q.mode,q.hero,q.opponent);
    const advice = recommend(spot,q.hand);
    assert.equal(advice.reachable,true,'a deal must be reachable along this action line');
    return {q,spot,advice};
  };
  const painted = () => page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  async function approveSwitch() {
    const confirm = $('#training-confirm-switch');
    if (await confirm.isVisible()) await confirm.tap();
  }

  const missed = [];
  const spotKey = q => [q.mode,q.hero,q.opponent].join('/');
  await scenario('ten offline hands: legal moves, instant grading, chart round-trip and resume',async () => {
    await page.setViewportSize({width:360,height:800});
    await page.screenshot({path:reportFile('-home.png')});
    const began = performance.now();
    await $('#start-training').tap();
    await deal(); await painted();
    const timings = report.training = {
      firstQuestionMs:Math.round(performance.now()-began), feedbackMs:[],
      measurement:'Playwright tap to visible content and two animation frames, 360x800, offline'
    };
    const seen = new Set(), modes = new Set(), totals = {high:0,low:0,avoid:0};
    for (let i=0;i<10;i++) {
      await page.waitForFunction(index => document.querySelector('#training-meter')?.value===index,i+1);
      const {q,spot,advice} = await deal();
      const key = JSON.stringify(q);
      assert.ok(!seen.has(key),'duplicate hand and spot in the same round');
      seen.add(key); modes.add(q.mode);
      const moves = await $('#training-actions [data-move]').evaluateAll(ns=>ns.map(n=>n.dataset.move));
      assert.deepEqual(moves.slice().sort(),spot.actions.slice().sort());
      assert.equal(await feedback.isVisible(),false,'unanswered hand conceals feedback');
      const avoid = spot.actions.find(move => advice.tiers[move] === 'avoid');
      const addMistake = avoid && !advice.low.length && missed.length<2 &&
        missed.every(previous => spotKey(previous)!==spotKey(q));
      const move = addMistake ? avoid : advice.low[0] || advice.primary;
      const tier = advice.tiers[move];
      if (tier === 'avoid') missed.push(q);
      totals[tier]++;
      const start = performance.now();
      await $('#training-actions [data-move="'+move+'"]').tap();
      await feedback.waitFor({state:'visible'}); await painted();
      timings.feedbackMs.push(Math.round(performance.now()-start));
      assert.equal(await feedback.getAttribute('data-tier'),tier);
      if (i === 0) {
        await page.screenshot({path:reportFile('-training-feedback.png')});
        await $('#training-chart').tap();
        assert.equal(await $('#preflop-hand').inputValue(),q.hand);
        assert.equal(await $('#preflop-mode').inputValue(),q.mode);
        assert.equal(await $('#preflop-hero').inputValue(),q.hero);
        if (q.opponent) assert.equal(await $('#preflop-opponent').inputValue(),q.opponent);
        await page.goBack();
        assert.deepEqual((await deal()).q,q);
        assert.equal(await feedback.getAttribute('data-tier'),tier);
      }
      if (i === 2) {
        await page.goto(home);
        assert.match(await $('#start-training').innerText(),/继续.*3/);
        await $('#start-training').tap();
        assert.deepEqual((await deal()).q,q);
        assert.equal(await feedback.getAttribute('data-tier'),tier);
        await page.reload();
        assert.equal(await feedback.getAttribute('data-tier'),tier);
      }
      await next.tap();
    }
    await $('#training-summary').waitFor({state:'visible'});
    assert.equal(seen.size,10);
    assert.deepEqual([...modes].sort(),['open','vsOpen','vsThreeBet']);
    assert.equal(totals.avoid,2);
    assert.ok(totals.low>0 && totals.high>0,'mixed round exercises all grading tiers');
    for (const [tier,count] of Object.entries(totals)) {
      assert.equal(Number(await $('#training-score-'+tier).innerText()),count);
    }
    Object.assign(timings,{counts:totals,coveredModes:[...modes]});
  });

  await scenario('review filters two spots and removes only the corrected answer',async () => {
    await page.goto(home);
    await $('a[href$="#review"]').tap();
    await $('#training-review').waitFor({state:'visible'});
    const mistakes = $('#training-review-list [data-hand]');
    assert.equal(await mistakes.count(),2);
    for (const [index,expected] of missed.entries()) {
      await $('#training-filter').selectOption(spotKey(expected));
      assert.equal(await mistakes.count(),1);
      assert.equal(await mistakes.getAttribute('data-hand'),expected.hand);
      await $('#training-start-review').tap();
      const {q,advice} = await deal();
      assert.deepEqual(q,expected);
      assert.match(await $('#training-progress').innerText(),/1\s*\/\s*1/);
      await $('#training-actions [data-move="'+advice.primary+'"]').tap();
      await feedback.waitFor({state:'visible'});
      assert.equal(await feedback.getAttribute('data-tier'),'high');
      await next.tap();
      await $('#training-summary').waitFor({state:'visible'});
      await page.goto(home); await $('a[href$="#review"]').tap();
      await $('#training-review').waitFor({state:'visible'});
      assert.equal(await mistakes.count(),1-index);
    }
    await page.goto(home);
  });

  await scenario('touch the last matrix row, compare BTN 99 and practice either opener',async () => {
    const chart = $('#open-preflop');
    await chart.tap();
    const cell = name => $('#preflop-matrix [data-hand="'+name+'"]');
    await cell('22').tap();
    assert.equal(await $('#preflop-hand').inputValue(),'22');
    assert.match(await $('#preflop-summary').innerText(),/22/);
    assert.ok(await $('#preflop-summary').evaluate(n=>{
      const r=n.getBoundingClientRect();
      return r.top>=0 && r.bottom<=innerHeight+1 && n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
    }),'selected hand summary is readable without scrolling back up');
    await $('#preflop-mode').selectOption('vsOpen');
    await $('#preflop-hero').selectOption('BTN');
    await $('#preflop-opponent').selectOption('UTG');
    await $('#preflop-search').fill('99'); await $('#preflop-search').press('Enter');
    await $('#preflop-compare-opponent').selectOption('CO');
    assert.equal(await $('#preflop-hand').inputValue(),'99');
    const panel = $('#preflop-compare');
    const sides = panel.locator('article');
    assert.equal(await sides.count(),2);
    assert.match(await sides.first().locator('h3').innerText(),/99.*UTG/);
    assert.match(await sides.first().locator('strong').innerText(),/Call.*2\.5BB/i);
    assert.match(await sides.last().locator('h3').innerText(),/99.*CO/);
    assert.match(await sides.last().locator('strong').innerText(),/3-bet.*7\.5BB/i);
    await panel.screenshot({path:reportFile('-comparison.png')});
    // Browser Back returns to the same comparison; both links must deal their own position.
    for (const opener of ['UTG','CO']) {
      await panel.locator('a[href*="opponent='+opener+'"]').tap();
      await $('#training-home').waitFor({state:'visible'});
      await approveSwitch();
      const {q} = await deal();
      assert.equal(q.mode,'vsOpen'); assert.equal(q.hero,'BTN'); assert.equal(q.opponent,opener);
      await page.goBack();
      assert.equal(await $('#preflop-hand').inputValue(),'99');
      assert.equal(await $('#preflop-compare-opponent').inputValue(),'CO');
    }
    await $('#preflop-home').tap();
  });
};
