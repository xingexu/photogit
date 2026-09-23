// Timer-driven fades also work in hosts without CSS animation support.
// Cancellation restores the resting style and never completes a stale dismissal.
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
  function unavailable(element) {
    return !element || !!element.closest("[hidden]") || element.getAttribute("aria-disabled") === "true";
  }
  function animate(element, from, duration, leaving = false, complete = () => {}, delay = 0) {
    const previous = running.get(element);
    const current = previous ? Number(element.style.opacity) : null;
    cancel(element);
    if (unavailable(element) || reduced()) { complete(); return; }
    for (const other of [...running.keys()]) {
      if (other.contains(element)) { if (!leaving) return; cancel(other); }
      if (element.contains(other)) cancel(other);
    }
    const state = { original: element.style.opacity || "", timer: null };
    const resting = state.original === "" ? 1 : Number(state.original);
    const target = leaving ? 0 : resting;
    const initial = current ?? from * resting;
    let lastFrame = Date.now(), elapsed = -delay;
    running.set(element, state);
    const step = () => {
      if (running.get(element) !== state) return;
      if (unavailable(element) || reduced()) {
        cancel(element); complete(); return;
      }
      const now = Date.now();
      // A native layout or artwork scan can hold the UI thread for a whole
      // fade. Preserve intermediate frames instead of jumping to the end.
      elapsed += Math.min(48, Math.max(0, now - lastFrame));
      lastFrame = now;
      const progress = Math.max(0, Math.min(1, elapsed / duration));
      // Smootherstep has zero velocity and acceleration at both ends.
      const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
      element.style.opacity = String(initial + (target - initial) * eased);
      if (progress === 1) { cancel(element); complete(); }
      else state.timer = setTimeout(step, 16);
    };
    step();
  }
  function enter(element) { animate(element, 0, 768); }
  function reveal(element, delay = 0) { animate(element, 0, 768, false, undefined, delay); }
  function exit(element, complete) { animate(element, 1, 384, true, complete); }
  document.addEventListener("click", event => {
    const control = event.target.closest?.('[role="button"], [role="tab"], [role="menuitem"]');
    if (unavailable(control)) return;
    animate(control, 0.84, 240);
  });
  globalThis.PhotoGitMotion = { enter, reveal, exit, cancel, reduced };
})();
