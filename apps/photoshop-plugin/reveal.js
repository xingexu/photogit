// PhotoGit reveal · lists appear at once.
//
// Rows used to step in on a 26ms stagger. A stagger only adds delay before a
// row is readable, and it replayed on every re-render, so it is gone: rows are
// in the DOM, visible and clickable in the frame they are rendered. The
// function stays so callers keep one hook if a future list needs an entrance,
// and it clears any marker a previous build left on a row.
(function () {
  function stagger(rows) {
    const list = rows ? [...rows] : [];
    for (const row of list) {
      row.classList?.remove("is-revealing");
      row.style?.removeProperty("--reveal-delay");
    }
    return 0;
  }
  globalThis.PhotoGitReveal = { stagger };
})();
