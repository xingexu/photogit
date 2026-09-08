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

  globalThis.PhotoGitDepth = { enabled, supports3d: () => has3d, position };
})();
