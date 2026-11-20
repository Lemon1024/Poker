/* Shared stopping rule for the host CLI and the WebView worker. */
function createRiverRun(model, options, createSolver, evaluate) {
  const target = options.target ?? 0.001;
  const limit = options.maxIterations ?? 100000;
  if (!Number.isFinite(target) || target <= 0 || target > 1) throw Error("目标误差须大于 0 且不超过 1。");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000000) throw Error("迭代上限须为 1 至 10000000 的整数。");
  const solver = createSolver(model, options.checkpoint);
  if (solver.iterations > limit) throw Error("迭代上限低于检查点的已完成轮数。");
  let last = null;
  let nextCheck = options.checkpoint ? solver.iterations : Math.min(64, limit);
  function measure(status) {
    if (!last || last.iterations !== solver.iterations) {
      const policy = solver.policy();
      last = {model, algorithm:solver.algorithm, iterations:solver.iterations, target, policy,
              evaluation:evaluate(model, policy)};
    }
    return {...last, status:last.evaluation.pot_fraction <= target ? "converged" : status};
  }
  function advance() {
    const start = performance.now();
    while (solver.iterations < nextCheck && performance.now() - start < 16) {
      solver.iterate(1);
    }
    if (solver.iterations >= nextCheck) {
      const result = measure("iteration_limit");
      if (result.status === "converged" || solver.iterations >= limit) return result;
      nextCheck = Math.min(limit, solver.iterations + Math.min(4096, Math.max(64,solver.iterations)));
    }
    return null;
  }
  return {advance,measure,checkpoint:() => solver.checkpoint(),
    progress:() => ({iterations:solver.iterations, measuredIterations:last?.iterations ?? null,
                     pot_fraction:last?.evaluation.pot_fraction ?? null})};
}

const RiverRunner = (() => {
  let serial = 0;
  function workerMain() {
    let run, id, finished = false, nextProgress = 0;
    function send(type, data) { self.postMessage({requestId:id,type,...data}); }
    function step() {
      if (finished) return;
      try {
        const result = run.advance();
        if (result) {
          finished = true;
          send("result",{result});
        } else {
          if (performance.now() >= nextProgress) {
            send("progress",run.progress());
            nextProgress = performance.now()+150;
          }
          setTimeout(step,0);
        }
      } catch (error) {finished = true; send("error",{message:error.message});}
    }
    self.onmessage = ({data}) => {
      if (finished) return;
      try {
        if (data.type === "start") {
          id = data.requestId;
          run = createRiverRun(data.model,data.options,createRiverSolver,evaluateRiverPolicy);
          step();
        } else if (data.type === "pause" && run && id === data.requestId) {
          finished = true;
          const result = run.measure("paused");
          if (result.status === "converged") send("result",{result});
          else send("paused",{result,checkpoint:run.checkpoint()});
        }
      } catch (error) {finished = true; send("error",{message:error.message});}
    };
  }
  function start(model, options, onMessage) {
    const requestId = ++serial;
    let worker, url, finished = false;
    function finish(msg) {
      if (finished) return;
      finished = true;
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      queueMicrotask(() => onMessage(msg));
    }
    try {
      const source = [createPokerEngine,createRiverSolver,evaluateRiverPolicy,createRiverRun]
        .map(fn => fn.toString()).join("\n") + "\n(" + workerMain.toString() + ")();";
      url = URL.createObjectURL(new Blob([source],{type:"application/javascript"}));
      worker = new Worker(url);
      worker.onmessage = ({data}) => {
        if (finished || data.requestId !== requestId) return;
        if (data.type === "progress") onMessage(data);
        else finish(data);
      };
      worker.onerror = e => {
        e.preventDefault();
        finish({type:"error",requestId,message:e.message || "策略计算失败。"});
      };
      worker.onmessageerror = () => finish({type:"error",requestId,message:"无法读取策略计算消息。"});
      worker.postMessage({type:"start",requestId,model,options});
    } catch (error) {finish({type:"error",requestId,message:error.message});}
    return {requestId,
      pause() {if (!finished) worker.postMessage({type:"pause",requestId});},
      cancel() {finish({type:"cancelled",requestId});}};
  }
  return {start};
})();
if (typeof module !== "undefined" && module.exports) module.exports = {createRiverRun};
