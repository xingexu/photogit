// Small timer-driven fades also work in hosts that ignore CSS animations.
// Feedback never delays button actions or controls visibility/focus.
(function () {
  const running = new Map();
  function rgb(value) {
    const hex = /^#([\da-f]{6})$/i.exec(value || "");
    if (hex) return hex[1].match(/../g).map(part => parseInt(part, 16));
    const decimal = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value || "");
    if (decimal && (decimal[4] === undefined || Number(decimal[4]) === 1)) return decimal.slice(1, 4).map(Number);
    return null;
  }
  function paintFrames(element) {
    // UXP may report container opacity without compositing its descendants.
    // Blend actual paint colours in the native host; browsers use opacity.
    if (typeof require !== "function" || typeof getComputedStyle !== "function") return null;
    const canvas = rgb(getComputedStyle(document.body).backgroundColor);
    if (!canvas) return null;
    const entries = [];
    let captured = 0;
    const nodes = [element, ...element.querySelectorAll("h1,h2,p,span,strong,small,label,input,svg,[role=button],[role=tab],[role=menuitem],.content-card,.scan-card,.section-nav,.list-row,.field-shell,.sync-panel")];
    for (const node of nodes) {
      if (node.hidden || node.closest("[hidden]")) continue;
      if (captured++ >= 180) break; // Bound style reads and work per frame.
      const computed = getComputedStyle(node);
      for (const property of ["color", "backgroundColor", "borderColor"]) {
        const color = rgb(computed[property]);
        if (color) entries.push({ node, property, color, original: node.style[property] || "" });
      }
    }
    return { canvas, entries };
  }
  function paint(state, amount) {
    if (!state.paint) return;
    for (const entry of state.paint.entries) {
      const channels = entry.color.map((channel, i) => Math.round(state.paint.canvas[i] + (channel - state.paint.canvas[i]) * amount));
      entry.node.style[entry.property] = `rgb(${channels.join(",")})`;
    }
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
    clearTimeout(state.timer);
    element.style.opacity = state.original;
    if (state.paint) for (const entry of state.paint.entries) {
      if (entry.original) entry.node.style[entry.property] = entry.original;
      else entry.node.style.removeProperty(entry.property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`));
    }
    running.delete(element);
  }
  function animate(element, from, to, duration, complete) {
    cancel(element);
    if (!element || reduced()) { complete?.(); return; }
    for (const other of [...running.keys()]) {
      if (other.contains(element)) { complete?.(); return; }
      if (element.contains(other)) cancel(other);
    }
    const state = { original: element.style.opacity || "", timer: null, paint: paintFrames(element) };
    const start = Date.now();
    running.set(element, state);
    const step = () => {
      if (running.get(element) !== state) return;
      if (element.hidden || element.getAttribute("aria-disabled") === "true" || reduced()) {
        cancel(element); complete?.(); return;
      }
      const progress = Math.min(1, (Date.now() - start) / duration);
      // Smoothstep keeps both ends gentle without rushing through the visible fade.
      const eased = progress * progress * (3 - 2 * progress);
      element.style.opacity = String(from + (to - from) * eased);
      paint(state, from + (to - from) * eased);
      if (progress === 1) { cancel(element); complete?.(); }
      else state.timer = setTimeout(step, 16);
    };
    step();
  }
  function enter(element) { animate(element, 0.28, 1, 300); }
  function theme(change) {
    const panel = document.querySelector(".panel-root");
    if (!panel || reduced()) { cancel(panel); change(); return; }
    // A new toggle cancels the previous pending change; the caller owns intent.
    const current = Number(panel.style.opacity || 1);
    animate(panel, current, 0.18, 170, () => { change(); animate(panel, 0.18, 1, 280); });
  }
  document.addEventListener("click", event => {
    const control = event.target.closest('[role="button"], [role="tab"], [role="menuitem"]');
    if (!control || control.getAttribute("aria-disabled") === "true" || control.closest('[hidden]')) return;
    // Avoid competing paint snapshots while the containing theme/view is fading.
    if ([...running.keys()].some(parent => parent !== control && parent.contains(control))) return;
    animate(control, 0.65, 1, 240);
  });
  globalThis.PhotoGitMotion = { enter, theme, cancel, reduced };
})();
