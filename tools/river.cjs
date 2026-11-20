/* Usage: node tools/river.cjs MODEL.json [--output result.json] [--resume state.json] */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {parseArgs} = require('node:util');
const {createRiverRun} = require('../strategy/runner.js');
const help = 'node tools/river.cjs <model.json | kuhn> [--target 0.001] [--max-iterations 100000] [--time-limit seconds] [--resume state.json] [--checkpoint-out state.json] [--output result.json]';

function save(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data)+'\n', {flag:'wx'});
  try {fs.renameSync(tmp,file);} finally {if (fs.existsSync(tmp)) fs.unlinkSync(tmp);}
}
function main() {
  const {positionals,values} = parseArgs({allowPositionals:true,options:{
    help:{type:'boolean'},target:{type:'string'},'max-iterations':{type:'string'},
    'time-limit':{type:'string'},resume:{type:'string'},'checkpoint-out':{type:'string'},output:{type:'string'}}});
  if (values.help) {console.log(help);return;}
  if (positionals.length !== 1) throw Error(help);
  const createSolver = require('../strategy/solver.js');
  const evaluate = require('../strategy/evaluate.js');
  const input = positionals[0];
  const read = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const model = input === 'kuhn' ? {kind:'kuhn'} : read(input);
  const options = {target:Number(values.target ?? '0.001'), maxIterations:Number(values['max-iterations'] ?? '100000')};
  if (values.resume) options.checkpoint=read(values.resume);
  const paths = [values.output,values['checkpoint-out']].filter(Boolean).map(p => path.resolve(p));
  if (new Set(paths).size !== paths.length || (input !== 'kuhn' && paths.includes(path.resolve(input)))) throw Error('模型、结果、检查点应使用不同文件。');
  const seconds = values['time-limit'] === undefined ? Infinity : Number(values['time-limit']);
  if (!(seconds>0) || (values['time-limit'] !== undefined && !Number.isFinite(seconds))) throw Error('时间上限必须为正的有限秒数。');
  const started = performance.now(), run = createRiverRun(model,options,createSolver,evaluate);
  let result;
  while (!result) {
    result = run.advance();
    if (!result && performance.now()-started >= seconds*1000) result=run.measure('time_limit');
  }
  result.performance = {elapsed_ms:Math.round(performance.now()-started),max_rss_kib:process.resourceUsage().maxRSS,
    platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,node:process.version};
  if (values['checkpoint-out']) save(values['checkpoint-out'],run.checkpoint());
  if (values.output) save(values.output,result); else console.log(JSON.stringify(result));
  if (result.status !== 'converged') process.exitCode=2;
}
try {main();} catch(error) {console.error(error.message);process.exitCode=1;}
