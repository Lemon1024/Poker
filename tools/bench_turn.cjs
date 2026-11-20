// Run in a fresh Node process. RSS is the high-water mark of the entire process.
const engine = require('../web/equity.js')();
const request = {mode:'range',hero:['As','Kh'],board:['2s','3s','4s','9d'],range:'uniform'};
const start=performance.now();
const job=engine.batches(engine.prepare(request));
const chunks=[];
let step;
do {
  const before=performance.now();
  step=job.next();
  chunks.push(performance.now()-before);
} while (!step.done);
const elapsedMs=performance.now()-start;
const rows=step.value.rows;
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,
  rows:rows.length,outcomes:rows.reduce((n,r)=>n+r.total,0),elapsedMs,
  maxEngineChunkMs:Math.max(...chunks),chunks:chunks.length,processMaxRssKiB:process.resourceUsage().maxRSS}));
