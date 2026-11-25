(() => {
  "use strict";
  const start = document.getElementById("start-training");
  function refresh() {
    start.textContent = TrainingSession.resumeLabel();
    if (!window.RiverHistory) document.getElementById("open-strategy").hidden = false;
  }
  refresh();
  window.addEventListener("pageshow", refresh);
  window.addEventListener("storage", refresh);
})();
