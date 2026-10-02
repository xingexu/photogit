// Shared activity feed presentation. Rows follow the same pattern as the
// change, history and branch lists: a glyph, the event, and its time. The
// caller owns counting and what gets logged; nothing here calls Photoshop.
(() => {
const MAX_ROWS = 50;
const MAX_SCAN_EVENTS = 50;
const SUMMARY_LENGTH = 160;

function isScanEvent(text) {
  return /^(Read \d+ layers? and compared|\d+ unsaved edits? found|Ready to save the first version|\d+ project files? ha(?:s|ve) changed)/.test(text);
}
function isErrorEvent(text) { return /error|failed|timed out|blocked|unavailable|offline|could not/i.test(text); }
function timeLabel(now) { return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function glyph(document, kind) {
  const node = element(document, "span", `row-glyph activity-glyph ${kind}`);
  node.setAttribute("aria-hidden", "true");
  // Whole literals rather than a lookup, so no markup here is assembled at
  // runtime and the build check can prove it by inspection.
  node.innerHTML = kind === "scan" ? '<svg viewBox="0 0 24 24"><path d="M20 6v5h-5"/><path d="M18.2 15.4A7 7 0 1 1 18.5 8L20 11"/></svg>'
    : kind === "error" ? '<svg viewBox="0 0 24 24"><path d="M12 8v5m0 3v.01"/><circle cx="12" cy="12" r="8"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg>';
  return node;
}

function stamp(document, now) {
  const time = element(document, "time", "activity-time", timeLabel(now));
  time.setAttribute("datetime", now.toISOString());
  time.setAttribute("title", now.toLocaleString());
  return time;
}

// A row with more to say is itself the control that opens it.
function expandable(row, details) {
  row.classList.add("is-expandable");
  row.setAttribute("role", "button");
  row.setAttribute("aria-expanded", "false");
  row.tabIndex = 0;
  const chevron = element(row.ownerDocument, "span", "activity-chevron");
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = '<svg class="disclosure-chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
  row.appendChild(chevron);
  const toggle = () => {
    details.hidden = !details.hidden;
    row.setAttribute("aria-expanded", String(!details.hidden));
  };
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing) return;
    event.preventDefault(); toggle();
  });
}

function clear(feed) {
  const document = feed.ownerDocument;
  feed.textContent = "";
  feed.classList.add("list", "activity");
  const empty = element(document, "section", "empty-state activity-empty");
  empty.appendChild(element(document, "strong", "", "No activity yet"));
  empty.appendChild(element(document, "p", "", "Scans, saved versions and branch changes appear here."));
  feed.appendChild(empty);
}

// Returns the row that was added or updated, so the caller can animate it.
function log(feed, message, { now = new Date() } = {}) {
  const document = feed.ownerDocument;
  const text = String(message ?? "");
  feed.classList.add("list", "activity");
  feed.querySelector(".activity-empty")?.remove();
  // Scans happen every time Photoshop changes. They share one row at the top
  // of the feed, with the individual scans one press away.
  if (isScanEvent(text)) {
    let entry = feed.firstElementChild;
    if (!entry || !entry.classList.contains("activity-scan")) {
      entry = element(document, "div", "activity-entry activity-scan");
      const row = element(document, "div", "list-row activity-row");
      row.appendChild(glyph(document, "scan"));
      const copy = element(document, "span", "row-copy");
      copy.appendChild(element(document, "strong", "", "Change detection"));
      copy.appendChild(element(document, "span", "activity-meta"));
      row.appendChild(copy);
      row.appendChild(element(document, "span", "activity-time-slot"));
      const details = element(document, "ol", "activity-details");
      details.hidden = true;
      expandable(row, details);
      entry.appendChild(row); entry.appendChild(details);
      feed.insertBefore(entry, feed.firstChild);
    }
    const details = entry.querySelector(".activity-details");
    const line = element(document, "li", "");
    line.appendChild(stamp(document, now));
    line.appendChild(element(document, "span", "", text));
    details.insertBefore(line, details.firstChild);
    while (details.children.length > MAX_SCAN_EVENTS) details.lastElementChild.remove();
    const events = details.children.length;
    entry.querySelector(".activity-meta").textContent = events === 1 ? text : `${text} · ${events} recent events`;
    const slot = entry.querySelector(".activity-time-slot");
    slot.textContent = ""; slot.appendChild(stamp(document, now));
    while (feed.children.length > MAX_ROWS) feed.lastElementChild.remove();
    return entry;
  }
  const failed = isErrorEvent(text);
  const entry = element(document, "div", "activity-entry");
  const row = element(document, "div", `list-row activity-row${failed ? " is-error" : ""}`);
  row.appendChild(glyph(document, failed ? "error" : "event"));
  const copy = element(document, "span", "row-copy");
  const long = text.length > SUMMARY_LENGTH;
  copy.appendChild(element(document, "span", "activity-copy", long ? `${text.slice(0, SUMMARY_LENGTH)}…` : text));
  row.appendChild(copy);
  row.appendChild(stamp(document, now));
  entry.appendChild(row);
  if (long) {
    const details = element(document, "p", "activity-details", text);
    details.hidden = true;
    expandable(row, details);
    entry.appendChild(details);
  }
  feed.insertBefore(entry, feed.firstChild);
  while (feed.children.length > MAX_ROWS) feed.lastElementChild.remove();
  return entry;
}

if (typeof module !== "undefined") module.exports = { log, clear, isScanEvent };
else window.PhotoGitActivity = { log, clear, isScanEvent };
})();
