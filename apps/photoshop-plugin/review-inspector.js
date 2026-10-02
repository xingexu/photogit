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
// The layer is named beside the edit, so the edit does not repeat it.
function editText(change) {
  const summary = text(change?.summary, "Edit details not recorded");
  const prefix = `${text(change?.layerName).trim()}:`;
  return prefix.length > 1 && summary.toLowerCase().startsWith(prefix.toLowerCase()) ? summary.slice(prefix.length).trim() || summary : summary;
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
    append(document, container, "h3", "", "Compare branches");
    append(document, container, "p", "fine-print", "Select a branch to see what it would bring in.");
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
      append(document, item, "p", "", editText(change));
    }
    if (changes.length > 100) append(document, edits, "p", "comparison-limit fine-print", `Showing the first 100 of ${changes.length} recorded edits. The comparison includes all edits, not only this displayed list.`);
  } else append(document, edits, "p", "fine-print", "No layer changes were recorded. Check the changed files and notes before combining.");
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
  append(document, status, "h3", mergeable ? "ready" : "blocked", mergeable ? "Ready to combine" : "Can’t combine yet");
  append(document, status, "p", "", mergeable
    ? "Review the changes before continuing. PhotoGit checks both branches again and asks for confirmation before combining."
    : "Both branches changed the same file. Sort that out outside PhotoGit, then refresh this comparison. For a PSD, open both documents in Photoshop and save the design you want to keep.");
  append(document, status, "p", "comparison-safety-note fine-print", "Combining keeps every saved version from both branches. It doesn’t blend layers or pick between two edits of the same file — review the result in Photoshop.");
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
  const reveal = globalThis.PhotoGitReveal;
  if (reveal && typeof reveal.stagger === "function") reveal.stagger(container.querySelectorAll(".comparison-direction, .comparison-artwork, .comparison-summary, .comparison-status"));
  return container;
}
// One branch waiting to merge, as a card. Collapsed, it states how far ahead
// the branch is and whether anything stands in the way; its one button opens
// it. Open, the caller fills the body with `resolution` once the comparison
// has been read. A warning is an icon and words, never a colour.
function card(document, review, { expanded = false, onToggle } = {}) {
  const branch = text(review?.branch, "Unknown branch");
  const mergeable = review?.mergeable === true;
  const element = document.createElement("article");
  element.className = `review-card${expanded ? " expanded" : ""}`;
  element.dataset.branch = branch;
  element.dataset.mergeable = String(mergeable);
  const head = append(document, element, "div", "review-head");
  const title = append(document, head, "div", "review-title");
  append(document, title, "strong", "", branch);
  const facts = append(document, title, "span", "review-facts");
  const ahead = count(review?.ahead);
  append(document, facts, "span", "", typeof ahead === "number" ? `${ahead} ${ahead === 1 ? "version" : "versions"} ahead` : "Ahead of this branch");
  const state = document.createElement("span");
  state.className = `review-state ${mergeable ? "ready" : "blocked"}`;
  if (!mergeable) state.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v5m0 3v.01"/><path d="m3.5 20 8.5-16 8.5 16z"/></svg>';
  append(document, state, "span", "review-state-label", mergeable ? "Ready to merge" : "Conflicts");
  const toggle = () => {
    if (element.closest("[hidden]") || document.body.classList.contains("is-busy") || document.body.classList.contains("is-initializing")) return;
    if (typeof onToggle === "function") onToggle(branch);
  };
  const activate = control => {
    control.addEventListener("click", () => { if (control.getAttribute("aria-disabled") !== "true") toggle(); });
    control.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing || control.getAttribute("aria-disabled") === "true") return;
      event.preventDefault(); event.stopPropagation(); toggle();
    });
  };
  if (expanded) {
    // Open: the state moves to the corner and the heading closes the card.
    head.appendChild(state);
    head.setAttribute("role", "button");
    head.setAttribute("aria-expanded", "true");
    head.setAttribute("aria-label", `${branch}. Close`);
    head.tabIndex = 0;
    activate(head);
    const body = append(document, element, "div", "review-body");
    append(document, body, "p", "review-note", "Reading both branches…");
  } else {
    facts.appendChild(state);
    const button = append(document, head, "div", "button button-small review-toggle", mergeable ? "Review" : "Resolve");
    button.setAttribute("role", "button");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `${mergeable ? "Review" : "Resolve"} ${branch}`);
    button.tabIndex = 0;
    activate(button);
  }
  return element;
}

// Photoshop layers are stored one file per layer and domain; a conflict is a
// file both branches changed. Each is described by the layer it belongs to
// and what about it changed, using the names the comparison already carries.
function conflictEntries(comparison) {
  const conflicts = Array.isArray(comparison?.conflicts) ? comparison.conflicts.filter(value => typeof value === "string" && value.trim()) : [];
  const changes = Array.isArray(comparison?.changes) ? comparison.changes : [];
  const entries = new Map();
  const add = (name, what) => entries.set(name, [...(entries.get(name) || []), what]);
  const supporting = [];
  for (const path of conflicts) {
    const layerFile = /^\.photogit\/(appearance|text|content)\/([^/]+)\.json$/.exec(path);
    if (layerFile) {
      const named = changes.find(change => change?.layerUuid === layerFile[2] && text(change?.layerName));
      add(named ? named.layerName : "A layer", layerFile[1] === "text" ? "text" : layerFile[1] === "content" ? "pixels" : "appearance");
    } else if (path === ".photogit/structure/layers.json") add("Layer stack", "layer order");
    else if (path === ".photogit/document.json") add("Document", "canvas settings");
    else if (/\.psd$/i.test(path)) add("Saved PSD", "the Photoshop file");
    // Previews and identity records follow from the edits above.
    else supporting.push(path);
  }
  if (!entries.size) for (const path of supporting) add(path, "this file");
  return [...entries].map(([name, parts]) => {
    const unique = [...new Set(parts)];
    const list = unique.length > 1 ? `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}` : unique[0];
    return { name, what: `${list.charAt(0).toUpperCase()}${list.slice(1)} changed on both` };
  });
}

// Fills an open card. Returns how many conflicts it listed.
function resolution(body, comparison, { onMerge, onDetails } = {}) {
  const document = body.ownerDocument;
  body.textContent = "";
  const incoming = text(comparison?.incomingBranch, "this branch");
  const destination = text(comparison?.baseBranch, "the current branch");
  const entries = conflictEntries(comparison);
  const mergeable = comparison?.gitMergeable === true && entries.length === 0 && incoming !== destination;
  for (const entry of entries.slice(0, 50)) {
    const row = append(document, body, "div", "review-conflict");
    const head = append(document, row, "div", "review-conflict-head");
    append(document, head, "strong", "", entry.name);
    append(document, head, "span", "", entry.what);
  }
  if (entries.length > 50) append(document, body, "p", "review-note", `Showing the first 50 of ${entries.length} conflicts.`);
  const button = append(document, body, "div", `button button-wide comparison-merge ${mergeable ? "button-primary" : "button-disabled"}`, `Merge ${incoming}`);
  button.setAttribute("role", "button");
  button.setAttribute("aria-disabled", String(!mergeable));
  button.dataset.mergeable = String(mergeable);
  button.tabIndex = mergeable ? 0 : -1;
  const merge = () => {
    if (!mergeable || button.getAttribute("aria-disabled") === "true" || button.closest("[hidden]") ||
      document.body.classList.contains("is-busy") || document.body.classList.contains("is-initializing")) return;
    if (typeof onMerge === "function") onMerge(incoming);
  };
  button.addEventListener("click", merge);
  button.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing) return;
    event.preventDefault(); event.stopPropagation(); merge();
  });
  const changes = Array.isArray(comparison?.changes) ? comparison.changes.length : 0;
  append(document, body, "p", "review-note", mergeable
    ? `No conflicts. ${changes} recorded ${changes === 1 ? "edit" : "edits"} would come into ${destination}; you confirm before anything is combined.`
    : entries.length
      ? `${entries.length} ${entries.length === 1 ? "conflict" : "conflicts"} to resolve. PhotoGit can’t pick a side for you: open both branches in Photoshop, save the result you want to keep, then refresh.`
      : "This branch can’t be combined yet. Refresh the project, then review it again.");
  if (typeof onDetails === "function") {
    const link = append(document, body, "div", "text-link review-details", "See every incoming change");
    link.setAttribute("role", "button");
    link.tabIndex = 0;
    const open = () => { if (!document.body.classList.contains("is-busy")) onDetails(incoming); };
    link.addEventListener("click", open);
    link.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key) && !event.repeat) { event.preventDefault(); open(); } });
  }
  return entries.length;
}
if (typeof module !== "undefined") module.exports = { render, card, resolution };
else window.PhotoGitReviewInspector = { render, card, resolution };
})();
