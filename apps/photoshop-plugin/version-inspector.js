// Shared presentation only. Reading snapshots and opening documents remain with the caller.
// A saved preview arrives as `preview` (helper-decoded base64 from the committed
// preview blob). VersionDetails still carries no dimensions, color mode or layer total.
(() => {
function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function append(document, parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  parent.appendChild(element);
  return element;
}

function action(document, parent, label, className, callback) {
  const button = append(document, parent, "div", `button ${className}`, label);
  button.setAttribute("role", "button");
  button.tabIndex = 0;
  const invoke = () => {
    if (button.getAttribute("aria-disabled") === "true" || button.closest("[hidden]") ||
      document.body.classList.contains("is-busy") || document.body.classList.contains("is-initializing")) return;
    callback();
  };
  button.addEventListener("click", invoke);
  button.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing) return;
    event.preventDefault(); event.stopPropagation(); invoke();
  });
  return button;
}

function facts(document, parent, entries) {
  const list = append(document, parent, "dl", "version-inspector-facts");
  for (const [label, value] of entries) {
    const row = append(document, list, "div", "version-inspector-fact");
    append(document, row, "dt", "", label);
    const detail = append(document, row, "dd", label === "Version ID" ? "version-inspector-commit" : "");
    // A fact that is a moment keeps its exact timestamp on a time element
    // behind the localised reading.
    if (value && typeof value === "object" && typeof value.datetime === "string") {
      const time = append(document, detail, "time", "", value.text);
      time.setAttribute("datetime", value.datetime);
    } else detail.textContent = String(value);
  }
  return list;
}

function section(document, parent, title) {
  const element = append(document, parent, "section", "version-inspector-section");
  append(document, element, "h3", "", title);
  return element;
}

function pagedList(document, parent, entries, className, label, renderEntry) {
  const list = append(document, parent, "ul", className);
  let shown = 0;
  const more = action(document, parent, `Show more ${label}`, "button-quiet button-small version-inspector-more", showNext);
  const count = append(document, parent, "p", "version-inspector-list-count fine-print");
  function showNext() {
    const end = Math.min(shown + 40, entries.length);
    for (; shown < end; shown++) {
      const item = append(document, list, "li", "");
      renderEntry(item, entries[shown]);
    }
    more.hidden = shown === entries.length;
    count.hidden = entries.length <= 40;
    count.textContent = `${shown} of ${entries.length} ${label}`;
  }
  showNext();
}

function safeVersionPreview(preview) {
  // Only base64 PNG/JPEG produced by the helper from a committed preview blob.
  // No remote URLs, no SVG, no arbitrary helper paths.
  return typeof preview?.src === "string" && preview.src.length <= 8_000_000 &&
    /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(preview.src);
}

function changeKind(change) {
  if (change?.category === "added") return ["added", "Added"];
  if (change?.category === "removed") return ["removed", "Deleted"];
  if (change?.category === "moved") return ["modified", "Moved"];
  if (change?.category === "reordered") return ["modified", "Reordered"];
  return ["modified", "Edited"];
}

function changeTotals(changes) {
  const groups = { added: new Set(), removed: new Set(), modified: new Set() };
  let documentEdits = 0;
  for (const change of changes) {
    if (change?.domain === "document") { documentEdits++; continue; }
    const key = change?.layerUuid || change?.photoshopId || change?.layerName;
    if (key) groups[changeKind(change)[0]].add(key);
  }
  return { added: groups.added.size, removed: groups.removed.size, modified: groups.modified.size, documentEdits };
}

function historyPreview(row, options = {}) {
  row.querySelector(".history-thumbnail")?.remove();
  row.classList.remove("has-thumbnail");
  const real = safeVersionPreview(options.preview);
  const demo = safeDemoPreview(options.demoPreview);
  if (!real && !demo) return;
  const image = row.ownerDocument.createElement("img");
  image.className = "history-thumbnail";
  image.alt = real ? "Saved version preview" : "Illustrative demo preview";
  image.addEventListener("error", () => { image.remove(); row.classList.remove("has-thumbnail"); });
  image.src = real ? options.preview.src : options.demoPreview.src;
  row.insertBefore(image, row.firstChild);
  row.classList.add("has-thumbnail");
}

function safeDemoPreview(preview) {
  // Deliberately excludes arbitrary helper paths, remote URLs, data URIs and SVG.
  return preview?.demo === true && typeof preview.src === "string" &&
    /^(?:\.\/)?assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(preview.src);
}

function formatDate(value, timeOnly = false) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return text(value, "Not recorded");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString([], timeOnly
    ? { hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function render(container, options = {}) {
  const document = container.ownerDocument;
  const state = options.state || (options.details ? "ready" : "empty");
  container.textContent = "";
  container.classList.add("version-inspector");
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Version details");
  container.setAttribute("aria-busy", String(state === "loading"));
  container.dataset.state = state;
  if (state !== "ready" || !options.details) {
    const titles = { empty: "Version details", loading: "Loading version…", error: "Could not load this version" };
    const messages = {
      empty: "Select a saved version.",
      loading: "Reading saved files…",
      error: text(options.error, "Check the connection and retry.")
    };
    append(document, container, "h3", "version-inspector-heading", titles[state] || titles.empty);
    const message = append(document, container, "p", "version-inspector-meta", messages[state] || messages.empty);
    message.setAttribute("role", state === "error" ? "alert" : "status");
    // While a version loads, three pulsing bars stand where its sections
    // will be, so a slow helper looks like waiting rather than like nothing.
    if (state === "loading") {
      const skeleton = append(document, container, "div", "inspector-skeleton");
      skeleton.setAttribute("aria-hidden", "true");
      for (let bar = 0; bar < 3; bar += 1) append(document, skeleton, "span", "");
    }
    return container;
  }

  const details = options.details;
  const version = details.version || options.version || {};
  const changes = Array.isArray(details.changes) ? details.changes : [];
  const files = Array.isArray(details.files) ? details.files : [];
  const warnings = Array.isArray(details.warnings) ? details.warnings.filter(value => typeof value === "string" && value.trim()) : [];
  const id = text(version.id);
  const snapshotAvailable = details.snapshotAvailable === true;
  const header = append(document, container, "div", "version-inspector-header");
  const heading = append(document, header, "div", "version-inspector-title");
  append(document, heading, "h2", "version-inspector-heading", text(version.message, "Saved version"));
  append(document, heading, "p", "version-inspector-meta", [text(version.shortId, id.slice(0, 8)), text(version.author), formatDate(version.date)].filter(Boolean).join(" · "));
  if (id && id === options.currentVersionId) append(document, heading, "span", "meta-chip version-inspector-current", "Current branch tip");
  if (snapshotAvailable && id && typeof options.onOpen === "function") {
    action(document, header, "Open version copy", "button-primary version-inspector-open", () => options.onOpen(id));
  }

  const grid = append(document, container, "div", "version-inspector-grid");
  const visual = append(document, grid, "div", "version-inspector-visual");
  const pair = append(document, visual, "div", "version-preview-pair");
  const comparing = safeVersionPreview(options.previousPreview) || safeDemoPreview(options.demoPreviousPreview);
  if (comparing) {
    pair.classList.add("has-before");
    const before = append(document, pair, "figure", "version-before");
    append(document, before, "figcaption", "version-preview-label", "Before");
    const image = append(document, before, "img", "");
    image.alt = "Previous saved version";
    image.addEventListener("error", () => { before.textContent = "Previous preview unavailable"; });
    image.src = safeVersionPreview(options.previousPreview) ? options.previousPreview.src : options.demoPreviousPreview.src;
  }
  const preview = append(document, pair, "div", "version-inspector-preview");
  if (comparing) append(document, preview, "p", "version-preview-label", "After");
  function fallback() {
    grid.classList.add("metadata-only");
    preview.textContent = "";
    preview.classList.add("version-inspector-fallback");
    append(document, preview, "span", "version-inspector-document-mark", "PSD");
    append(document, preview, "strong", "", snapshotAvailable ? "Saved Photoshop file" : "Saved file unavailable");
    append(document, preview, "p", "version-inspector-meta", snapshotAvailable
      ? "Preview unavailable. Open a version copy to inspect it."
      : "PSD unavailable on this computer.");
  }
  if (safeVersionPreview(options.preview)) {
    const figure = append(document, preview, "figure", "version-inspector-artwork");
    const image = append(document, figure, "img", "");
    image.alt = "Preview saved with this version";
    image.addEventListener("error", fallback);
    image.src = options.preview.src;
  } else if (safeDemoPreview(options.demoPreview)) {
    const figure = append(document, preview, "figure", "version-inspector-artwork");
    const image = append(document, figure, "img", "");
    image.alt = text(options.demoPreview.alt, "Representative demo artwork");
    image.addEventListener("error", fallback);
    image.src = options.demoPreview.src;
    append(document, figure, "figcaption", "fine-print", "Demo artwork");
  } else fallback();
  if (!comparing && details.parentVersionId) append(document, visual, "p", "fine-print", "Previous preview unavailable.");
  if (!snapshotAvailable) append(document, visual, "p", "version-inspector-notice fine-print", "Saved file unavailable on this computer.");

  const information = append(document, grid, "div", "version-inspector-information");
  facts(document, section(document, information, "Version details"), [
    ["Saved", /^\d{4}-\d{2}-\d{2}T/.test(String(version.date)) ? { text: formatDate(version.date), datetime: version.date } : formatDate(version.date)],
    ["Author", text(version.author, "Not recorded")],
    ["Version ID", id || text(version.shortId, "Not recorded")],
    ["Saved file", snapshotAvailable ? "On this computer" : "Not on this computer"]
  ]);
  const summary = section(document, information, "Changes in this version");
  const totals = changeTotals(changes);
  const tally = append(document, summary, "div", "version-change-tally");
  for (const [key, label] of [["added", "Added layers"], ["removed", "Deleted layers"], ["modified", "Edited layers"]]) {
    const tile = append(document, tally, "div", `version-change-stat ${key}`);
    append(document, tile, "strong", "", String(totals[key]));
    append(document, tile, "span", "", label);
  }
  if (totals.documentEdits) append(document, summary, "p", "fine-print", `${totals.documentEdits} document-wide ${totals.documentEdits === 1 ? "edit" : "edits"}`);
  if (details.truncated) append(document, summary, "p", "fine-print", `Showing ${changes.length} of ${details.changeCount} recorded edits. Layer totals cover the displayed entries.`);
  const domains = [
    ["document", "Document edits"], ["structure", "Structure edits"], ["appearance", "Appearance edits"],
    ["text", "Text edits"], ["content", "Content edits"]
  ];
  const counts = [["Recorded edits", changes.length], ["Changed files", files.length]];
  for (const [domain, label] of domains) {
    const count = changes.filter(change => change?.domain === domain).length;
    if (count) counts.push([label, count]);
  }
  facts(document, summary, counts);

  if (warnings.length) {
    const notices = section(document, container, "Version notes");
    pagedList(document, notices, warnings, "version-inspector-warnings", "notes", (item, warning) => { item.textContent = warning; });
  }
  const recorded = section(document, container, "Recorded edits");
  if (changes.length) {
    pagedList(document, recorded, changes, "version-inspector-changes", "edits", (item, change) => {
      const [kind, label] = changeKind(change);
      item.classList.add(`version-edit-${kind}`);
      append(document, item, "span", `version-edit-badge ${kind}`, label);
      if (text(change?.layerName)) append(document, item, "strong", "", change.layerName);
      append(document, item, "p", "", text(change?.summary, "Edit details not recorded"));
      const readable = value => typeof value === "string" ? value.slice(0, 240) : ["number", "boolean"].includes(typeof value) ? String(value) : null;
      const before = readable(change?.baseValue), after = readable(change?.currentValue);
      if (!/fingerprint/i.test(change?.propertyPath || "") && before !== null && after !== null && before !== after) {
        const values = append(document, item, "div", "version-edit-values");
        append(document, values, "span", "", `Before: ${before}`);
        append(document, values, "span", "", `After: ${after}`);
      }
    });
  } else append(document, recorded, "p", "version-inspector-meta", "No recorded layer changes.");
  if (files.length) {
    pagedList(document, section(document, container, "Changed files"), files, "version-inspector-files", "files", (item, file) => {
      append(document, item, "span", "meta-chip", text(file?.status, "—"));
      append(document, item, "code", "", text(file?.path, "Unknown file"));
    });
  }
  // The inspector is complete and its Open control live; the header, the
  // preview and each section now step in on the shared stagger.
  const reveal = globalThis.PhotoGitReveal;
  if (reveal && typeof reveal.stagger === "function") reveal.stagger(container.querySelectorAll(".version-inspector-header, .version-inspector-visual, .version-inspector-section"));
  return container;
}

if (typeof module !== "undefined") module.exports = { render, formatDate, historyPreview, changeTotals };
else window.PhotoGitVersionInspector = { render, formatDate, historyPreview, changeTotals };
})();
