// PhotoGit reveal · staggers a freshly rendered list into view.
//
// The stagger is expressed as one custom property per row and consumed by the
// stylesheet. Rows are never hidden by this module: they are in the DOM, in
// order, readable by assistive technology and clickable from the first frame,
// whatever the animation is doing. A capped stagger keeps a long list from
// taking longer to settle than it takes to read.
(function () {
  const STEP = 26;   // milliseconds between rows
  const CAP = 8;     // rows after which every row shares the last delay

  function reduced() {
    const motion = globalThis.PhotoGitMotion;
    if (motion && typeof motion.reduced === "function") return motion.reduced();
    return true;
  }

  function delayFor(index) {
    const position = Math.min(Math.max(0, Math.floor(index)), CAP);
    return position * STEP;
  }

  // Marks rows for the stylesheet. Returns the number of rows it marked so a
  // caller can tell a no-op from a run.
  function stagger(rows) {
    const list = rows ? [...rows] : [];
    if (!list.length) return 0;
    if (reduced()) {
      for (const row of list) { row.style.removeProperty("--reveal-delay"); row.classList.remove("is-revealing"); }
      return 0;
    }
    list.forEach((row, index) => {
      row.style.setProperty("--reveal-delay", `${delayFor(index)}ms`);
      row.classList.add("is-revealing");
    });
    return list.length;
  }

  globalThis.PhotoGitReveal = { stagger, delayFor, STEP, CAP };
})();
