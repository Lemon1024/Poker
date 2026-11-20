// Drive the same visible card slots with Playwright mouse clicks or a WebView CDP session.
module.exports = function cardControls({click,readCards,count,fill}) {
  async function setHand(holder, target) {
    const wanted = target.trim() ? target.trim().split(/\s+/) : [];
    const existing = await readCards(holder);
    for (const [i,card] of existing.entries()) {
      if (card && card !== wanted[i]) {
        await click(holder+' [data-slot="'+i+'"]');
        await click('#clear-slot');
      }
    }
    for (const [i,card] of wanted.entries()) {
      if (card !== existing[i]) {
        await click(holder+' [data-slot="'+i+'"]');
        await click('#deck [data-card="'+card+'"]');
      }
    }
  }
  async function setCombos(lines) {
    let rows = await count('#range-list .range-row');
    while (rows-- > 0) await click('#range-list .range-row:last-child [data-remove-combo]');
    for (const line of lines) {
      const [a,b,weight='1'] = line.split(' ');
      await click('#add-combo');
      const row = '#range-list .range-row:last-child';
      await setHand(row,a+' '+b);
      await fill(row+' input',weight);
    }
  }
  return {setHand,setCombos};
};
