// PhotoGit motion · the one helper every transition in the panel goes through.
//
// Photoshop's panel host runs no CSS transitions and no @keyframes, and it
// accepts `opacity` without drawing it. What it does draw is `transform:
// translate` and translucent backgrounds, on 60fps animation frames. So:
//   - movement is a translate stepped per frame;
//   - a fade is a veil in the panel's background colour laid over the element
//     and stepped from opaque to clear (in a browser, real opacity is used);
//   - a colour change is the colour itself stepped between two painted states.
//
// Motion tokens. The host does not expose CSS custom properties to script and
// CSS cannot use them (no transitions), so they are defined here, once, and
// nothing in the panel uses any other duration or easing:
//   fast 120ms  hover, press, pill and tab state
//   base 180ms  switching screens, opening cards, the tab underline
//   ease cubic-bezier(0.2, 0, 0, 1)
//
// Rules this file keeps: nothing moves except by transform; nothing runs
// longer than `base`; a new transition cancels the one it replaces; nothing
// here ever stands between a click and its control; under reduced motion
// nothing moves or fades at all.
(function () {
  const FAST_MS = 120;
  const BASE_MS = 180;
  const SCREEN_SHIFT = 6;
  const CARD_SHIFT = -4;
  const CONTROLS = '[role="button"], [role="tab"], [role="menuitem"]';

  // cubic-bezier(0.2, 0, 0, 1): solve the curve's x for t, return its y.
  const X1 = 0.2, Y1 = 0, X2 = 0, Y2 = 1;
  const bezier = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  function ease(progress) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0, high = 1, t = progress;
    for (let step = 0; step < 20; step += 1) {
      const x = bezier(t, X1, X2);
      if (Math.abs(x - progress) < 0.0005) break;
      if (x < progress) low = t; else high = t;
      t = (low + high) / 2;
    }
    return bezier(t, Y1, Y2);
  }

  function nativeHost() {
    try { return typeof require === "function" && require("uxp").host.name === "Photoshop"; }
    catch { return false; }
  }
  function reduced() {
    try {
      if (typeof matchMedia === "function") return matchMedia("(prefers-reduced-motion: reduce)").matches;
      return typeof getComputedStyle === "function" && getComputedStyle(document.documentElement).getPropertyValue("--motion-enabled").trim() === "0";
    } catch { return true; }
  }
  function unavailable(element) {
    return !element || !!element.closest("[hidden]") || element.getAttribute("aria-disabled") === "true";
  }
  function viewport() {
    const root = document.documentElement;
    return `${root ? root.clientWidth : 0}x${root ? root.clientHeight : 0}`;
  }

  // Colours come from the page, never from here: each is read as the colour
  // the stylesheet has already painted on an element.
  function parseColour(value) {
    const text = String(value || "").trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(text);
    if (hex) { const number = parseInt(hex[1], 16); return [number >> 16, (number >> 8) & 255, number & 255, 1]; }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
    if (!rgb) return null;
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return alpha > 0 ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha] : null;
  }
  function painted(element, property = "backgroundColor") {
    try { return parseColour(getComputedStyle(element)[property]); } catch { return null; }
  }
  let veilRgb = null;
  function veilColour() {
    if (!veilRgb) { const colour = painted(document.body) || [0, 0, 0, 1]; veilRgb = `${colour[0]}, ${colour[1]}, ${colour[2]}`; }
    return veilRgb;
  }

  // One clock for everything. `paint` receives eased progress from 0 to 1 on
  // the real clock, so a stalled UI thread lands on the final frame instead
  // of stretching, and starting anything on a key stops what that key was
  // already doing: rapid clicks never stack.
  const running = new Map();
  function stop(key, finished = false) {
    const state = running.get(key);
    if (!state) return;
    if (state.frame) cancelAnimationFrame(state.timer); else clearTimeout(state.timer);
    running.delete(key);
    state.restore();
    if (finished) state.complete();
  }
  function tween(key, duration, paint, restore = () => {}, complete = () => {}) {
    stop(key);
    const state = { timer: null, frame: false, restore, complete, started: Date.now(), viewport: viewport() };
    running.set(key, state);
    const schedule = step => {
      state.frame = typeof requestAnimationFrame === "function";
      state.timer = state.frame ? requestAnimationFrame(step) : setTimeout(step, 16);
    };
    const step = () => {
      if (running.get(key) !== state) return;
      const progress = Math.max(0, Math.min(1, (Date.now() - state.started) / duration));
      if (progress === 1 || (state.guard && state.guard())) { stop(key, true); return; }
      paint(ease(progress));
      schedule(step);
    };
    // The first frame is painted with the action that caused it.
    paint(0);
    schedule(step);
    return state;
  }

  // A veil sits over what it fades. If the host does not honour
  // pointer-events: none, a press on the veil is passed to the control
  // underneath, so an entrance never costs a click.
  function forward(event) {
    const veil = event.currentTarget;
    const owner = veil.__owner;
    if (!owner) return;
    const hit = [...owner.querySelectorAll(`${CONTROLS}, input`)].reverse().find(control => {
      if (control.closest("[hidden]")) return false;
      const box = control.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    });
    stop(owner, true);
    if (hit) { if (typeof hit.focus === "function") hit.focus(); if (hit.nodeName !== "INPUT") hit.click(); }
  }
  function veilFor(element) {
    if (!nativeHost()) return null;
    const rect = element.getBoundingClientRect();
    let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    // Keep the veil inside every clipping ancestor, including partially
    // visible content in a scrolled view.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden/.test(style.overflowX || style.overflow)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      if (/auto|scroll|hidden/.test(style.overflowY || style.overflow)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
    const veil = document.createElement("div");
    veil.setAttribute("aria-hidden", "true");
    veil.className = "native-fade-veil";
    veil.__owner = element;
    Object.assign(veil.style, {
      position: "fixed", left: `${left}px`, top: `${top}px`,
      width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px`,
      borderRadius: getComputedStyle(element).borderRadius,
      pointerEvents: "none", zIndex: "50"
    });
    veil.addEventListener("click", forward);
    document.body.appendChild(veil);
    return veil;
  }

  // Fade and move. `shift` is where the element starts, in pixels: positive
  // starts below and rises, negative starts above and settles down.
  function animate(element, { duration, shift = 0, leaving = false, complete = () => {} }) {
    const previous = running.get(element);
    // A reversal starts from what is on screen now, not from the resting value.
    const current = previous && typeof previous.value === "number" ? previous.value : null;
    stop(element);
    if (unavailable(element) || reduced()) { complete(); return; }
    // A surface inside a view that is already entering rides along with it.
    for (const other of [...running.keys()]) {
      if (!other || !other.contains) continue;
      if (other.contains(element) && other !== element) { if (!leaving) { complete(); return; } stop(other, true); }
      else if (element.contains(other) && other !== element) stop(other, true);
    }
    const style = element.style;
    const original = { opacity: style.opacity || "", transform: style.transform || "" };
    const resting = original.opacity === "" ? 1 : Number(original.opacity);
    const veil = veilFor(element);
    const from = current ?? (leaving ? resting : 0);
    const target = leaving ? 0 : resting;
    const state = tween(element, duration, progress => {
      const value = from + (target - from) * progress;
      state_value(value);
      if (veil) veil.style.backgroundColor = `rgba(${veilColour()}, ${resting > 0 ? Number((1 - value / resting).toFixed(3)) : 0})`;
      else style.opacity = String(Number(value.toFixed(3)));
      if (shift) style.transform = `translateY(${Number((shift * (leaving ? progress : 1 - progress)).toFixed(2))}px)`;
    }, () => {
      veil?.remove();
      style.opacity = original.opacity;
      style.transform = original.transform;
    }, complete);
    function state_value(value) { const live = running.get(element); if (live) live.value = value; }
    state.veil = veil;
    state.value = from;
    state.guard = () => unavailable(element) || reduced();
  }

  // 1 and 4 · a new screen or state: fades in and rises 6px. Whatever was
  // still arriving is finished at once, so the newest request always wins.
  function screen(element) {
    for (const [key, state] of [...running]) if (state.veil !== undefined && key !== element) stop(key, true);
    animate(element, { duration: BASE_MS, shift: SCREEN_SHIFT });
  }
  // A surface (menu, dialog, status line) arriving: the same fade and rise.
  function enter(element) { animate(element, { duration: BASE_MS, shift: SCREEN_SHIFT }); }
  // 3 · a card's content opening: fades in and settles down 4px. Height is
  // never animated; the content is simply there, then eased into place.
  function expand(element) { animate(element, { duration: BASE_MS, shift: CARD_SHIFT }); }
  // A surface leaving: a short fade, then the caller hides it.
  function exit(element, complete) { animate(element, { duration: FAST_MS, leaving: true, complete }); }
  function cancel(element) { stop(element); }

  // 2 · colour. The element is painted in one state, then in the next, and
  // the three colours that tell states apart are stepped between the two.
  const TINTS = [["backgroundColor", "backgroundColor"], ["borderTopColor", "borderColor"], ["color", "color"]];
  function snapshot(element) {
    let style = null;
    try { style = getComputedStyle(element); } catch { /* Not painted: nothing to step. */ }
    return TINTS.map(([read]) => style ? parseColour(style[read]) : null);
  }
  function blend(element, before, after) {
    if (!element || !element.style || reduced()) return;
    const key = `tint:${tintId(element)}`;
    stop(key);
    const pairs = TINTS.map(([, write], index) => ({ write, from: before[index], to: after[index] }))
      // A colour that appears from nothing or fades to nothing keeps its hue.
      .filter(pair => (pair.from || pair.to) && String(pair.from) !== String(pair.to));
    if (!pairs.length) return;
    const original = pairs.map(pair => element.style[pair.write] || "");
    tween(key, FAST_MS, progress => {
      for (const { write, from, to } of pairs) {
        const start = from || [to[0], to[1], to[2], 0], end = to || [from[0], from[1], from[2], 0];
        const mix = index => start[index] + (end[index] - start[index]) * progress;
        element.style[write] = `rgba(${Math.round(mix(0))}, ${Math.round(mix(1))}, ${Math.round(mix(2))}, ${Number(mix(3).toFixed(3))})`;
      }
    }, () => { pairs.forEach((pair, index) => { element.style[pair.write] = original[index]; }); });
  }
  const tintIds = new WeakMap();
  let nextTint = 0;
  function tintId(element) {
    if (!tintIds.has(element)) tintIds.set(element, ++nextTint);
    return tintIds.get(element);
  }
  // Selected, pressed-in, switched: run `change`, then ease each element from
  // how it was painted before to how the stylesheet paints it now.
  function recolour(elements, change) {
    const list = [...elements].filter(Boolean);
    const before = list.map(snapshot);
    change();
    list.forEach((element, index) => blend(element, before[index], snapshot(element)));
  }
  // Press: the control takes its pressed tone at once and eases back to rest.
  // The tones are two swatches the stylesheet paints and nobody sees.
  let tones = null;
  function swatch(className) {
    const probe = document.createElement("i");
    probe.className = className; probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
    const colour = painted(probe);
    probe.remove();
    return colour;
  }
  function press(element) {
    if (!element || !element.style || element.getAttribute("aria-disabled") === "true" || reduced()) return;
    tones = tones || { plain: swatch("motion-press-tone"), filled: swatch("motion-press-tone filled") };
    const tone = element.classList.contains("button-primary") ? tones.filled : tones.plain;
    if (!tone) return;
    stop(`tint:${tintId(element)}`);
    const rest = snapshot(element);
    blend(element, [tone, rest[1], rest[2]], rest);
  }
  // Hover: the stylesheet's :hover colour arrives in one frame, so on the way
  // in the control is eased from its resting paint (read from an unhovered
  // twin) to the hover paint, and eased back on the way out.
  function resting(element) {
    const twin = element.cloneNode(false);
    twin.removeAttribute("id");
    twin.setAttribute("aria-hidden", "true");
    Object.assign(twin.style, { position: "fixed", width: "0", height: "0", overflow: "hidden", backgroundColor: "", borderColor: "", color: "" });
    element.parentNode.appendChild(twin);
    const colours = snapshot(twin);
    twin.remove();
    return colours;
  }
  const hovered = new WeakMap();
  function control(event) {
    const target = event.target && event.target.closest ? event.target.closest(CONTROLS) : null;
    return target && !target.closest("[hidden]") && target.getAttribute("aria-disabled") !== "true" ? target : null;
  }
  document.addEventListener("mouseover", event => {
    const element = control(event);
    if (!element || hovered.has(element) || reduced() || !element.parentNode) return;
    if (event.relatedTarget && element.contains(event.relatedTarget)) return;
    const rest = resting(element);
    hovered.set(element, snapshot(element));
    blend(element, rest, snapshot(element));
  }, true);
  document.addEventListener("mouseout", event => {
    const element = control(event);
    if (!element || !hovered.has(element)) return;
    if (event.relatedTarget && element.contains(event.relatedTarget)) return;
    const hover = hovered.get(element);
    hovered.delete(element);
    if (element.parentNode) blend(element, hover, resting(element));
  }, true);
  // One listener gives every control the same press, including controls a
  // list renders later. It only decorates: the control's own handler runs
  // whether or not this does.
  document.addEventListener("click", event => { const element = control(event); if (element) press(element); }, true);

  const positions = new WeakMap();
  const destinations = new WeakMap();
  // The selected-tab underline belongs to the strip and travels by transform.
  function slide(indicator, target) {
    if (!indicator || !target || typeof target.getBoundingClientRect !== "function") return;
    const strip = indicator.parentElement.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const to = box.left - strip.left;
    if (!(box.width > 0)) { stop(indicator); indicator.hidden = true; return; }
    // Where it is now is remembered here, not read back from the style: the
    // host rewrites a transform it is given ("translateX( 150px)").
    const from = !indicator.hidden && positions.has(indicator) ? positions.get(indicator) : to;
    // Asked again for where it is already going (the host reports a resize
    // after every layout change): keep travelling, do not start over.
    if (running.has(indicator) && destinations.get(indicator) === to) return;
    destinations.set(indicator, to);
    indicator.hidden = false;
    indicator.style.width = `${Number(box.width.toFixed(2))}px`;
    const move = value => { positions.set(indicator, value); indicator.style.transform = `translateX(${Number(value.toFixed(2))}px)`; };
    if (reduced() || from === to) { stop(indicator); move(to); return; }
    tween(indicator, BASE_MS, progress => move(from + (to - from) * progress), () => move(to));
  }

  // Fixed veils must never remain over a scrolled or resized workspace. A
  // section change resets the view's scroll and makes the host report a
  // "resize" for the layout change; those are the transition's own, so only
  // a later scroll or a panel whose size really changed ends a veil early.
  const SETTLE_MS = 90;
  for (const type of ["scroll", "resize"]) document.addEventListener(type, () => {
    for (const [key, state] of [...running]) {
      if (!state.veil) continue;
      if (type === "resize" ? viewport() === state.viewport : Date.now() - state.started <= SETTLE_MS) continue;
      stop(key, true);
    }
  }, true);

  globalThis.PhotoGitMotion = { screen, enter, expand, exit, cancel, press, recolour, slide, reduced, ease, FAST_MS, BASE_MS };
})();
