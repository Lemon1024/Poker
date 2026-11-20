/* A blob worker can start from a local HTML file without a server or CORS exceptions. */
const pokerEngine = createPokerEngine();
const PokerRunner = (() => {
  let nextId = 1;
  // Only completed exact rows for the most recent exact position, in this page's engine version.
  let cachePosition = null;
  const cache = new Map();
  function workerMain() {
    self.onmessage = ({data: {requestId, prepared, cached}}) => {
      const send = (type, fields) => self.postMessage({requestId,type,...fields});
      const job = createPokerEngine().batches(prepared, Math.random, cached);
      function advance() {
        try {
          const start = performance.now();
          let step;
          let chunks = 0;
          do {
            step = job.next();
            if (step.done) {send("result",{result:step.value}); return;}
            chunks++;
          } while (chunks < 8 && performance.now()-start < 8);
          send("progress",{percent:step.value});
          setTimeout(advance,0);
        } catch (error) {
          send("error",{message: error.message || "计算失败。"});
        }
      }
      advance();
    };
  }
  function start(request, onMessage) {
    const requestId = nextId++;
    let worker, url, finished = false;
    function finish(message) {
      if (finished) return;
      finished = true;
      if (worker) worker.terminate();
      if (url) URL.revokeObjectURL(url);
      queueMicrotask(() => onMessage(message));
    }
    try {
      const prepared = pokerEngine.prepare(request);
      const cached = new Map();
      if (prepared.position && prepared.position === cachePosition) {
        for (const {hand} of prepared.range) {
          const key = hand.map(id => pokerEngine.cards[id]).join(" ");
          if (cache.has(key)) cached.set(key,cache.get(key));
        }
      }
      const source = createPokerEngine.toString() + "\n(" + workerMain.toString() + ")();";
      url = URL.createObjectURL(new Blob([source], {type:"application/javascript"}));
      worker = new Worker(url);
      worker.onmessage = ({data}) => {
        if (finished || data.requestId !== requestId) return;
        if (data.type === "progress") onMessage(data);
        else {
          if (data.type === "result" && prepared.position) {
            if (cachePosition !== prepared.position) cache.clear();
            cachePosition = prepared.position;
            for (const row of data.result.rows) cache.set(row.cards.join(" "),row);
          }
          finish(data);
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        finish({requestId,type:"error",message:"无法运行后台计算：" + event.message});
      };
      worker.onmessageerror = () => finish({requestId,type:"error",message:"无法读取后台计算结果。"});
      worker.postMessage({requestId,prepared,cached});
    } catch (error) {
      finish({requestId,type:"error",message:"无法启动后台计算：" + error.message});
    }
    return {requestId,cancel: () => finish({requestId,type:"cancelled"})};
  }
  return {start};
})();
