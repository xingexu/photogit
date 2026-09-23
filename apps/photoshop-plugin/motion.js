// Browser opacity and a native alpha veil share the same frame clock.
// Photoshop 27.10 accepts fractional opacity without compositing the pixels.
// Cancellation restores the resting style and never completes a stale dismissal.
(function () {
  const running = new Map();
  function nativeHost() {
    try { return typeof require === "function" && require("uxp").host.name === "Photoshop"; }
    catch { return false; }
  }
  function veilFor(element) {
    if (!nativeHost()) return null;
    const rect = element.getBoundingClientRect();
    let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    // Keep row fades inside their scroll viewport, including partially visible rows.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden/.test(style.overflowX || style.overflow)) {
        left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
      }
      if (/auto|scroll|hidden/.test(style.overflowY || style.overflow)) {
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
    }
    const veil = document.createElement("div");
    veil.setAttribute("aria-hidden", "true");
    veil.className = "native-fade-veil";
    Object.assign(veil.style, {
      position: "fixed", left: `${left}px`, top: `${top}px`,
      width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px`,
      borderRadius: getComputedStyle(element).borderRadius,
      pointerEvents: "none", zIndex: "1000"
    });
    document.body.appendChild(veil);
    return veil;
  }
  function schedule(state, step) {
    state.frame = typeof requestAnimationFrame === "function";
    state.timer = state.frame ? requestAnimationFrame(step) : setTimeout(step, 16);
  }
  function reduced() {
    try {
      if (typeof matchMedia === "function") return matchMedia("(prefers-reduced-motion: reduce)").matches;
      return typeof getComputedStyle === "function" && getComputedStyle(document.documentElement).getPropertyValue("--motion-enabled").trim() === "0";
    } catch { return true; }
  }
  function cancel(element) {
    const state = running.get(element);
    if (!state) return;
    if (state.frame) cancelAnimationFrame(state.timer);
    else clearTimeout(state.timer);
    state.veil?.remove();
    element.style.opacity = state.original;
    running.delete(element);
  }
  function unavailable(element) {
    return !element || !!element.closest("[hidden]") || element.getAttribute("aria-disabled") === "true";
  }
  function animate(element, from, duration, leaving = false, complete = () => {}, delay = 0) {
    const previous = running.get(element);
    const current = previous ? previous.value : null;
    cancel(element);
    if (unavailable(element) || reduced()) { complete(); return; }
    for (const other of [...running.keys()]) {
      if (other.contains(element)) { if (!leaving) return; cancel(other); }
      if (element.contains(other)) cancel(other);
    }
    const state = { original: element.style.opacity || "", timer: null, frame: false, veil: veilFor(element), value: 1, complete };
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
      // Linear opacity starts visibly changing on the first painted frame.
      state.value = initial + (target - initial) * progress;
      if (state.veil) state.veil.style.backgroundColor = `rgba(6, 15, 31, ${resting > 0 ? 1 - state.value / resting : 0})`;
      else element.style.opacity = String(state.value);
      if (progress === 1) { cancel(element); complete(); }
      else schedule(state, step);
    };
    step();
  }
  function enter(element) { animate(element, 0, 768); }
  function reveal(element, delay = 0) { animate(element, 0, 768, false, undefined, delay); }
  function exit(element, complete) { animate(element, 1, 384, true, complete); }
  // Fixed native veils must never remain over a scrolled or resized workspace.
  for (const event of ["scroll", "resize"]) document.addEventListener(event, () => {
    for (const [element, state] of running) if (state.veil) { cancel(element); state.complete(); }
  }, true);
  document.addEventListener("click", event => {
    const control = event.target.closest?.('[role="button"], [role="tab"], [role="menuitem"]');
    if (unavailable(control)) return;
    animate(control, 0.84, 240);
  });
  globalThis.PhotoGitMotion = { enter, reveal, exit, cancel, reduced };
})();
