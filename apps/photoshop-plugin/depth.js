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

  function reduced() {
    const motion = globalThis.PhotoGitMotion;
    if (motion && typeof motion.reduced === "function") return motion.reduced();
    return true;
  }

  const has3d = supports("transform", "perspective(600px) rotateX(1deg)");

  function enabled() {
    return has3d && !reduced();
  }

  globalThis.PhotoGitDepth = { enabled, supports3d: () => has3d };
})();
