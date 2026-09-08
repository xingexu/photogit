// PhotoGit depth · pointer-driven lighting and tilt for glass surfaces.
//
// Strictly decorative. Depth never gates input, never changes layout, never
// delays a click handler, and never moves focus. Every effect is a transform
// or a custom property read by the stylesheet, so a host that cannot composite
// them simply renders the flat surface it renders today.
//
// It is disabled entirely when the host reports reduced motion, and when the
// host cannot prove it supports 3D transforms. UXP hosts vary here, so support
// is detected rather than assumed.
(function () {
  const supports = (property, value) => {
    try {
      return typeof CSS === "object" && typeof CSS.supports === "function" && CSS.supports(property, value);
    } catch { return false; }
  };

  // Pointer maths is rounded before it reaches the DOM so a jittery pointer
  // cannot produce a stream of imperceptibly different style writes.
  const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
  const round = (value, places = 3) => Number(value.toFixed(places));

  function reduced() {
    const motion = globalThis.PhotoGitMotion;
    if (motion && typeof motion.reduced === "function") return motion.reduced();
    return true;
  }

  const has3d = supports("transform", "perspective(600px) rotateX(1deg)");

  function enabled() {
    return has3d && !reduced();
  }

  // Normalised pointer position within an element, as -1..1 on both axes with
  // the origin at the centre. Returns null when the element has no box yet,
  // which is the case in every host that has not laid the panel out.
  function position(element, event) {
    const box = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
    if (!box || !box.width || !box.height) return null;
    const x = clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1, 1);
    const y = clamp(((event.clientY - box.top) / box.height) * 2 - 1, -1, 1);
    return { x: round(x), y: round(y) };
  }

  // The tilt is deliberately shallow. A card that leans more than a couple of
  // degrees reads as a toy next to Photoshop's own chrome, and a steep lean
  // shears the text it carries.
  const MAX_TILT = 2.4;

  function tiltFor(point) {
    return { rotateX: round(-point.y * MAX_TILT, 2), rotateY: round(point.x * MAX_TILT, 2) };
  }

  // Written as custom properties rather than an inline transform so the
  // stylesheet keeps full authority over how — and whether — depth is drawn.
  function write(element, point) {
    const tilt = tiltFor(point);
    element.style.setProperty("--tilt-x", `${tilt.rotateX}deg`);
    element.style.setProperty("--tilt-y", `${tilt.rotateY}deg`);
    element.style.setProperty("--pointer-x", `${round((point.x + 1) * 50, 1)}%`);
    element.style.setProperty("--pointer-y", `${round((point.y + 1) * 50, 1)}%`);
  }

  function clear(element) {
    for (const name of ["--tilt-x", "--tilt-y", "--pointer-x", "--pointer-y"]) element.style.removeProperty(name);
    element.classList.remove("is-depth-active");
  }

  // One delegated pointer listener for the whole panel. Per-element listeners
  // would have to be attached and detached as views re-render; delegation
  // survives every re-render for free.
  function bind(root) {
    const host = root || document;
    const track = event => {
      const surface = event.target && event.target.closest ? event.target.closest("[data-depth]") : null;
      if (!surface) return;
      if (!enabled()) { clear(surface); return; }
      const point = position(surface, event);
      if (!point) return;
      surface.classList.add("is-depth-active");
      write(surface, point);
    };
    host.addEventListener("pointermove", track);
    host.addEventListener("pointerdown", track);
    host.addEventListener("pointerout", event => {
      const surface = event.target && event.target.closest ? event.target.closest("[data-depth]") : null;
      if (surface) clear(surface);
    });
    return host;
  }

  globalThis.PhotoGitDepth = { enabled, supports3d: () => has3d, position, tiltFor, write, clear, bind, MAX_TILT };
})();
