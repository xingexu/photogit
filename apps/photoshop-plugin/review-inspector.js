// Read-only comparison presentation. Merge confirmation and revalidation belong to the caller.
(() => {
function text(value, fallback = "") { return typeof value === "string" && value.trim() ? value : fallback; }
function append(document, parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = String(value);
  parent.appendChild(element);
  return element;
}
function facts(document, parent, entries) {
  const list = append(document, parent, "dl", "comparison-facts");
  for (const [label, value] of entries) {
    const row = append(document, list, "div", "comparison-fact");
    append(document, row, "dt", "", label);
    append(document, row, "dd", "", value);
  }
}
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : "Not available"; }

// Same rule as the other preview surfaces: helper-decoded base64 raster only.
function safePreview(src) {
  return typeof src === "string" && src.length < 24_000_000 &&
    /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
}

function render(container, { comparison, onMerge, previews } = {}) {
  const document = container.ownerDocument;
  container.textContent = "";
  container.classList.add("review-inspector");
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Branch comparison");
  container.dataset.mergeable = "false";
  if (!comparison) {
    append(document, container, "h3", "", "Compare design directions");
    append(document, container, "p", "fine-print", "Choose a branch review to inspect the incoming changes and merge safeguards.");
    return container;
  }
  const incoming = text(comparison.incomingBranch);
  const destination = text(comparison.baseBranch);
  const changes = Array.isArray(comparison.changes) ? comparison.changes : [];
  const files = Array.isArray(comparison.files) ? comparison.files : [];
  const conflicts = Array.isArray(comparison.conflicts) ? comparison.conflicts.filter(value => typeof value === "string" && value.trim()) : [];
  const warnings = Array.isArray(comparison.warnings) ? comparison.warnings.filter(value => typeof value === "string" && value.trim()) : [];
  // A contradictory payload cannot make a known conflict actionable.
  const mergeable = comparison.gitMergeable === true && conflicts.length === 0 && incoming && destination && incoming !== destination;
  container.dataset.mergeable = String(Boolean(mergeable));
  const direction = append(document, container, "div", "comparison-direction");
  const source = append(document, direction, "div", "comparison-endpoint");
  append(document, source, "span", "fine-print", "Source");
  append(document, source, "strong", "", incoming || "Unknown branch");
  const arrow = append(document, direction, "span", "comparison-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  const base = append(document, direction, "div", "comparison-endpoint");
  append(document, base, "span", "fine-print", "Destination");
  append(document, base, "strong", "", destination || "Unknown branch");

  // Reference 07: show both branch tips side by side when both previews exist.
  // Never show one alone, which would read as a diff against nothing.
  const previewFor = name => {
    const src = previews && typeof previews === "object" ? previews[name] : undefined;
    return safePreview(src) ? src : null;
  };
  const sourceArt = previewFor(incoming);
  const destinationArt = previewFor(destination);
  if (sourceArt && destinationArt) {
    const compare = append(document, container, "div", "comparison-artwork");
    for (const [branch, src] of [[incoming, sourceArt], [destination, destinationArt]]) {
      const figure = append(document, compare, "figure", "comparison-artwork-side");
      const image = append(document, figure, "img", "");
      image.alt = `Latest saved preview on ${branch}`;
      image.addEventListener("error", () => compare.remove());
      image.src = src;
      append(document, figure, "figcaption", "fine-print", branch);
    }
    append(document, container, "p", "fine-print comparison-artwork-note", "Latest saved preview on each branch. PhotoGit compares saved files, not rendered pixels.");
  }

  const layout = append(document, container, "div", "comparison-layout");
  const summary = append(document, layout, "section", "comparison-summary");
  append(document, summary, "h3", "", "Incoming changes");
  append(document, summary, "p", "fine-print", "Recorded changes from the common ancestor to the source branch.");
  facts(document, summary, [
    ["Source-only commits", count(comparison.ahead)],
    ["Destination-only commits", count(comparison.behind)],
    ["Recorded edits", changes.length],
    ["Changed files", files.length]
  ]);
  const edits = append(document, summary, "section", "comparison-edits");
  append(document, edits, "h3", "", "Recorded edits");
  if (changes.length) {
    const list = append(document, edits, "ul", "comparison-change-list");
    for (const change of changes.slice(0, 100)) {
      const item = append(document, list, "li", "");
      if (text(change?.layerName)) append(document, item, "strong", "", change.layerName);
      append(document, item, "p", "", text(change?.summary, "Edit details not recorded"));
    }
    if (changes.length > 100) append(document, edits, "p", "comparison-limit fine-print", `Showing the first 100 of ${changes.length} recorded edits. The comparison includes all edits, not only this displayed list.`);
  } else append(document, edits, "p", "fine-print", "No semantic differences recorded. Read the file changes and notes before deciding whether to merge.");
  const fileSection = append(document, summary, "section", "comparison-files");
  append(document, fileSection, "h3", "", "Changed files");
  if (files.length) {
    const list = append(document, fileSection, "ul", "comparison-file-list");
    for (const file of files.slice(0, 500)) {
      const item = append(document, list, "li", "");
      append(document, item, "span", "meta-chip", text(file?.status, "—"));
      append(document, item, "code", "", text(file?.path, "Unknown file"));
    }
    if (files.length > 500) append(document, fileSection, "p", "comparison-limit fine-print", `Showing the first 500 of ${files.length} changed files. Use an external Git client to inspect the complete file list.`);
  } else append(document, fileSection, "p", "fine-print", "No incoming file changes recorded.");

  const status = append(document, layout, "aside", `comparison-status${mergeable ? "" : " merge-blocked"}`);
  status.setAttribute("aria-label", "Merge status and safeguards");
  append(document, status, "h3", mergeable ? "ready" : "blocked", mergeable ? "Git merge available" : "Git merge blocked");
  append(document, status, "p", "", mergeable
    ? "Review the changes before continuing. PhotoGit checks the branches again and asks for confirmation before merging."
    : "Resolve conflicting files outside PhotoGit, then refresh this comparison. For PSD conflicts, inspect both documents in Photoshop and save the resolved design.");
  append(document, status, "p", "comparison-safety-note fine-print", "Ordinary Git merge only. PhotoGit does not blend PSD layers or automatically resolve document conflicts.");
  if (conflicts.length) {
    append(document, status, "h3", "", "Conflicts");
    const list = append(document, status, "ul", "comparison-conflicts");
    for (const conflict of conflicts.slice(0, 500)) append(document, list, "li", "", conflict);
    if (conflicts.length > 500) append(document, status, "p", "comparison-limit fine-print", `Showing the first 500 of ${conflicts.length} conflicts. Inspect the complete conflict list in an external Git client; merging remains blocked.`);
  }
  if (warnings.length) {
    append(document, status, "h3", "", "Review notes");
    const list = append(document, status, "ul", "comparison-warnings");
    for (const warning of warnings) append(document, list, "li", "", warning);
  }
  if (mergeable && typeof onMerge === "function") {
    const button = append(document, status, "div", "button button-primary comparison-merge", "Review merge…");
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", `Review merge of ${incoming} into ${destination}`);
    button.tabIndex = 0;
    const activate = () => {
      if (button.getAttribute("aria-disabled") === "true" || button.closest("[hidden]") ||
        document.body.classList.contains("is-busy") || document.body.classList.contains("is-initializing")) return;
      onMerge(incoming);
    };
    button.addEventListener("click", activate);
    button.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); activate();
    });
  }
  return container;
}
if (typeof module !== "undefined") module.exports = { render };
else window.PhotoGitReviewInspector = { render };
})();
