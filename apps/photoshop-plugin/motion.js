// Shallow, local opacity feedback. Hosts without composited opacity keep the
// opaque CSS surface; never emulate a fade by repainting descendant colours.
// Feedback never delays actions or controls visibility, layout, or focus.
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
  function animate(element, from, duration) {
    const previous = running.get(element);
    const current = previous ? Number(element.style.opacity) : null;
    cancel(element);
    if (unavailable(element) || reduced()) return;
    for (const other of [...running.keys()]) {
      if (other.contains(element)) return;
      if (element.contains(other)) cancel(other);
    }
    const state = { original: element.style.opacity || "", timer: null };
    const target = state.original === "" ? 1 : Number(state.original);
    const initial = current ?? from * target;
    const start = Date.now();
    running.set(element, state);
    const step = () => {
      if (running.get(element) !== state) return;
      if (unavailable(element) || reduced()) {
        cancel(element); return;
      }
      const progress = Math.min(1, (Date.now() - start) / duration);
      // Smootherstep has zero velocity and acceleration at both ends.
      const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
      element.style.opacity = String(initial + (target - initial) * eased);
      if (progress === 1) cancel(element);
      else state.timer = setTimeout(step, 16);
    };
    step();
  }
  // A view should settle into place, never flash or obscure the Photoshop work.
  // This is intentionally a gentle opacity cue only; colour and layout are CSS.
  function enter(element) { animate(element, 0.94, 288); }
  function theme(change) {
    // Commit preference and theme immediately, even during rapid repeated input.
    // Only the foreground surface settles; header and navigation never fade.
    change();
    const selectors = [".tool-sheet", ".tools-menu", ".view-panel", "#onboarding", "#startup-state"];
    for (const selector of selectors) {
      const surface = [...document.querySelectorAll(selector)].find(element => !unavailable(element));
      if (surface) { animate(surface, 0.97, 280); return; }
    }
  }
  document.addEventListener("click", event => {
    const control = event.target.closest?.('[role="button"], [role="tab"], [role="menuitem"]');
    if (unavailable(control)) return;
    animate(control, 0.96, 200);
  });
  globalThis.PhotoGitMotion = { enter, theme, cancel, reduced };
})();
