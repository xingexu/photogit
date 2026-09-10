// PhotoGit counter · settles a number into place instead of snapping to it.
//
// The value is authoritative from the first frame: the element's text may be
// mid-count, but `data-value` always carries the real number, and the count is
// skipped entirely under reduced motion. Nothing here can report a wrong total
// to the user for longer than the animation, and no caller waits on it.
(function () {
  const DURATION = 520;
  const running = new Map();

  function reduced() {
    const motion = globalThis.PhotoGitMotion;
    if (motion && typeof motion.reduced === "function") return motion.reduced();
    return true;
  }

  function stop(element) {
    const timer = running.get(element);
    if (timer !== undefined) { clearTimeout(timer); running.delete(element); }
  }

  // Integers only. A count-up that renders 12.4 changed layers is a lie about
  // what the panel measured, however briefly.
  function set(element, value) {
    if (!element) return;
    const target = Number(value);
    if (!Number.isFinite(target)) return;
    const whole = Math.round(target);
    stop(element);
    element.classList.remove("is-counting");
    element.dataset.value = String(whole);
    const from = Math.round(Number(element.dataset.shown ?? element.textContent) || 0);
    if (reduced() || from === whole) {
      element.textContent = String(whole);
      element.dataset.shown = String(whole);
      return;
    }
    const start = Date.now();
    element.classList.add("is-counting");
    const step = () => {
      const progress = Math.min(1, (Date.now() - start) / DURATION);
      const eased = 1 - Math.pow(1 - progress, 3);
      const shown = Math.round(from + (whole - from) * eased);
      element.textContent = String(shown);
      element.dataset.shown = String(shown);
      if (progress >= 1) { stop(element); element.classList.remove("is-counting"); element.textContent = String(whole); element.dataset.shown = String(whole); }
      else running.set(element, setTimeout(step, 16));
    };
    step();
  }

  globalThis.PhotoGitCounter = { set, stop, DURATION };
})();
