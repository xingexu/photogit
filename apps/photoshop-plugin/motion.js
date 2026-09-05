// Small timer-driven fades also work in hosts that ignore CSS animations.
// Feedback never delays button actions or controls visibility/focus.
(function () {
  const running = new Map();
  function reduced() {
    try {
      if (typeof matchMedia === "function") return matchMedia("(prefers-reduced-motion: reduce)").matches;
      return typeof getComputedStyle === "function" && getComputedStyle(document.documentElement).getPropertyValue("--motion-enabled").trim() === "0";
    } catch { return true; }
  }
  function cancel(element) {
    const state = running.get(element);
    if (!state) return;
    clearTimeout(state.timer);
    element.style.opacity = state.original;
    running.delete(element);
  }
  function animate(element, from, to, duration, complete) {
    cancel(element);
    if (!element || reduced()) { complete?.(); return; }
    const state = { original: element.style.opacity || "", timer: null };
    const start = Date.now();
    running.set(element, state);
    const step = () => {
      if (running.get(element) !== state) return;
      if (element.hidden || element.getAttribute("aria-disabled") === "true" || reduced()) {
        cancel(element); complete?.(); return;
      }
      const progress = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.style.opacity = String(from + (to - from) * eased);
      if (progress === 1) { cancel(element); complete?.(); }
      else state.timer = setTimeout(step, 16);
    };
    step();
  }
  function enter(element) { animate(element, 0.78, 1, 160); }
  function theme(change) {
    const panel = document.querySelector(".panel-root");
    if (!panel || reduced()) { cancel(panel); change(); return; }
    // A new toggle cancels the previous pending change; the caller owns intent.
    animate(panel, 1, 0.55, 80, () => { change(); animate(panel, 0.55, 1, 160); });
  }
  document.addEventListener("click", event => {
    const control = event.target.closest('[role="button"], [role="tab"], [role="menuitem"]');
    if (!control || control.getAttribute("aria-disabled") === "true" || control.closest('[hidden]')) return;
    animate(control, 0.86, 1, 140);
  });
  globalThis.PhotoGitMotion = { enter, theme, cancel, reduced };
})();
