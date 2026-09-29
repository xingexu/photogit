// PhotoGit motion · short, immediately visible transitions for views and surfaces.
//
// Timing: entrances start at half strength (never a blank first frame) and
// ease out over 160ms, so most of the change lands in the first two frames.
// Exits take 110ms. Progress follows the real clock: if Photoshop stalls the
// UI thread past the duration, the next frame is the final state rather than
// a stretched fade.
//
// Photoshop 27.10 accepts fractional opacity without compositing the pixels,
// so in the native host a navy veil (the panel's --bg colour) fades out over
// the element instead. It never starts fully opaque, never takes pointer
// events, is clipped to the element's scroll viewport, and is removed on
// completion, cancellation, scroll and resize.
//
// Lists do not animate. Only a changed view or an opened surface moves.
(function () {
  const ENTER_MS = 160;
  const EXIT_MS = 110;
  const ENTER_FROM = 0.5;
  // Mirrors --bg in styles.css (#0b1220). Read as a constant so the browser
  // path never calls getComputedStyle.
  const VEIL_RGB = "11, 18, 32";
  const running = new Map();

  function nativeHost() {
    try { return typeof require === "function" && require("uxp").host.name === "Photoshop"; }
    catch { return false; }
  }
  function veilFor(element) {
    if (!nativeHost()) return null;
    const rect = element.getBoundingClientRect();
    let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    // Keep the veil inside every clipping ancestor, including partially
    // visible content in a scrolled view.
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
  const easeOut = progress => 1 - Math.pow(1 - progress, 3);

  function animate(element, from, duration, leaving = false, complete = () => {}) {
    const previous = running.get(element);
    // A reversal starts from what is on screen now, not from the resting value.
    const current = previous ? previous.value : null;
    cancel(element);
    if (unavailable(element) || reduced()) { complete(); return; }
    // A surface inside a view that is already entering rides along with it.
    for (const other of [...running.keys()]) {
      if (other.contains(element)) { if (!leaving) { complete(); return; } cancel(other); }
      if (element.contains(other)) cancel(other);
    }
    const state = { original: element.style.opacity || "", timer: null, frame: false, veil: veilFor(element), value: 1, complete };
    const resting = state.original === "" ? 1 : Number(state.original);
    const target = leaving ? 0 : resting;
    const initial = current ?? from * resting;
    const start = Date.now();
    running.set(element, state);
    const paint = value => {
      state.value = value;
      if (state.veil) state.veil.style.backgroundColor = `rgba(${VEIL_RGB}, ${resting > 0 ? Number((1 - value / resting).toFixed(3)) : 0})`;
      else element.style.opacity = String(Number(value.toFixed(3)));
    };
    const step = () => {
      if (running.get(element) !== state) return;
      if (unavailable(element) || reduced()) { cancel(element); complete(); return; }
      const progress = Math.max(0, Math.min(1, (Date.now() - start) / duration));
      if (progress === 1) { cancel(element); complete(); return; }
      paint(initial + (target - initial) * easeOut(progress));
      schedule(state, step);
    };
    // The first frame is painted synchronously with the action that caused it.
    paint(initial);
    schedule(state, step);
  }
  function enter(element) { animate(element, ENTER_FROM, ENTER_MS); }
  // Kept for callers of the previous API; there is no per-row delay any more.
  function reveal(element) { animate(element, ENTER_FROM, ENTER_MS); }
  function exit(element, complete) { animate(element, 1, EXIT_MS, true, complete); }
  // Fixed native veils must never remain over a scrolled or resized workspace.
  for (const event of ["scroll", "resize"]) document.addEventListener(event, () => {
    for (const [element, state] of running) if (state.veil) { cancel(element); state.complete(); }
  }, true);
  globalThis.PhotoGitMotion = { enter, reveal, exit, cancel, reduced, ENTER_MS, EXIT_MS, ENTER_FROM };
})();
