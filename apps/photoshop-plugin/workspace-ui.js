// Shared presentation controls only: never writes PSDs, stages files or calls Git.
function refreshChanges(document) {
  updateMessageCount(document);
  const rows = Array.from(document.querySelectorAll("#changes .change-row"));
  const search = document.getElementById("changes-search");
  const chips = Array.from(document.querySelectorAll("[data-change-filter]"));
  if (!rows.length) {
    search.value = "";
    for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.changeFilter === "all"));
  }
  const query = String(search.value || "").trim().toLowerCase();
  const type = chips.find(chip => chip.getAttribute("aria-pressed") === "true")?.dataset.changeFilter || "all";
  const typeMatches = (domain, wanted) => wanted === "all" || (wanted === "visual" ? !["text", "structure"].includes(domain) : domain === wanted);
  // Each chip counts the rows it would show, within the current search, so
  // the row of chips reads as a breakdown before any of them is chosen.
  for (const chip of chips) {
    const count = chip.querySelector(".chip-count");
    if (!count) continue;
    count.textContent = String(rows.filter(row => typeMatches(row.dataset.domain, chip.dataset.changeFilter) && row.textContent.toLowerCase().includes(query)).length);
    count.hidden = rows.length === 0;
  }
  let visible = 0;
  const changed = [];
  for (const row of rows) {
    const domain = row.dataset.domain;
    const matchesType = typeMatches(domain, type);
    const hide = !matchesType || !row.textContent.toLowerCase().includes(query);
    if (row.hidden !== hide) changed.push(row);
    row.hidden = hide;
    if (!row.hidden) visible++;
  }
  // When a filter changes which rows are shown, the rows now showing step in
  // on the stagger; rows already showing hold still. Filtering never hides a
  // row the stagger is decorating, so this is decoration over a settled list.
  const reveal = globalThis.PhotoGitReveal;
  if (changed.length && reveal && typeof reveal.stagger === "function") reveal.stagger(rows.filter(row => !row.hidden));
  document.getElementById("change-filters").hidden = rows.length === 0;
  document.getElementById("change-filter-empty").hidden = rows.length === 0 || visible > 0;
  const count = document.getElementById("change-filter-count");
  count.hidden = rows.length === 0 || (!query && type === "all");
  count.textContent = `${visible} of ${rows.length} listed edits · display filter only`;
  return visible;
}

// Left and Right (plus Home and End) move through a row of related
// controls the way a toolbar does. Every control stays a Tab stop, so
// nothing that was reachable stops being reachable; the arrows are the
// shorter route between neighbours.
function arrowRow(container) {
  if (!container) return;
  container.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || event.isComposing) return;
    const items = [...container.querySelectorAll('[role="button"]')].filter(item => !item.hidden && item.getAttribute("aria-disabled") !== "true");
    const index = items.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  });
}

const initialized = new WeakMap();
const MESSAGE_LIMIT = 500;
// The counter is silent while typing — announcing every keystroke's count is
// noise — and speaks only when it carries a limit note, which is the one
// change worth hearing. `note` is that message; omit it to clear it.
function updateMessageCount(document, note = "") {
  const field = document.getElementById("message");
  const count = document.getElementById("message-count");
  if (!field || !count) return;
  const length = field.value.length;
  count.textContent = note ? `${length}/${MESSAGE_LIMIT} · ${note}` : `${length}/${MESSAGE_LIMIT}`;
  count.dataset.limit = length >= MESSAGE_LIMIT ? "full" : length >= MESSAGE_LIMIT - 50 ? "near" : "";
  count.setAttribute("aria-live", note ? "polite" : "off");
}
function setup(document, { navigate, openCommands }) {
  if (initialized.has(document)) return initialized.get(document);
  const blocked = () => document.body.classList.contains("is-initializing") || document.body.classList.contains("is-busy") ||
    ["detail-sheet", "tag-sheet", "tools-menu"].some(id => !document.getElementById(id).hidden);
  function activate(element, action) {
    const invoke = () => {
      if (blocked() || element.closest("[hidden]") || element.getAttribute("aria-disabled") === "true") return;
      action();
    };
    element.addEventListener("click", invoke);
    element.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing) return;
      event.preventDefault(); event.stopPropagation(); invoke();
    });
  }
  const message = document.getElementById("message");
  message.addEventListener("input", () => updateMessageCount(document));
  activate(document.getElementById("jump-save"), () => {
    message.focus(); message.scrollIntoView?.({ block: "center" });
    // The field flashes once so the eye finds it after the scroll.
    const shell = message.closest(".field-shell");
    if (shell) { shell.classList.remove("is-updated"); void shell.offsetWidth; shell.classList.add("is-updated"); }
  });
  for (const preset of document.querySelectorAll("[data-message-preset]")) {
    activate(preset, () => {
      const draft = message.value;
      const addition = preset.dataset.messagePreset;
      const next = draft ? `${draft} · ${addition}` : addition;
      // Suggestions never truncate or replace an existing draft. When one does
      // not fit, the counter says so rather than the click doing nothing.
      const fits = next.length <= MESSAGE_LIMIT;
      if (fits) message.value = next;
      updateMessageCount(document, fits ? "" : "No room for this suggestion"); message.focus();
      // The words moved from the chip to the field; a brief highlight on the
      // field shows where they went. Restarted per click; a class only.
      const shell = message.closest(".field-shell");
      if (fits && shell) { shell.classList.remove("is-updated"); void shell.offsetWidth; shell.classList.add("is-updated"); }
    });
  }
  for (const chip of document.querySelectorAll("[data-change-filter]")) {
    activate(chip, () => {
      for (const other of document.querySelectorAll("[data-change-filter]")) other.setAttribute("aria-pressed", String(other === chip));
      refreshChanges(document);
    });
  }
  arrowRow(document.querySelector(".filter-bar"));
  // Enter or Down from the search moves into the first row it left showing
  // that can be selected; a row that only reports has nothing to focus.
  document.getElementById("changes-search").addEventListener("keydown", event => {
    if (!["Enter", "ArrowDown"].includes(event.key) || event.repeat || event.isComposing) return;
    const first = [...document.querySelectorAll("#changes .change-row")].find(row => !row.hidden && row.getAttribute("role") === "button");
    if (!first) return;
    event.preventDefault(); first.focus();
  });
  arrowRow(document.querySelector(".message-presets"));
  arrowRow(document.querySelector(".sync-panel"));
  const search = document.getElementById("changes-search");
  search.addEventListener("input", () => refreshChanges(document));
  // Escape in a search field that has text clears it and re-runs the
  // filter, the way a native search field does. An empty field lets the
  // key through, so it still closes whatever surface is open.
  for (const field of document.querySelectorAll('input[type="search"]')) {
    field.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !field.value) return;
      event.preventDefault(); event.stopPropagation();
      field.value = "";
      const EventType = (field.ownerDocument.defaultView && field.ownerDocument.defaultView.Event) || globalThis.Event;
      field.dispatchEvent(new EventType("input", { bubbles: true }));
    });
  }
  activate(document.getElementById("reset-change-filters"), () => {
    search.value = "";
    for (const chip of document.querySelectorAll("[data-change-filter]")) chip.setAttribute("aria-pressed", String(chip.dataset.changeFilter === "all"));
    refreshChanges(document); search.focus();
  });
  for (const link of document.querySelectorAll("[data-destination]")) {
    activate(link, () => {
      const destination = link.dataset.destination;
      navigate(destination);
      document.getElementById(`${destination}-tab`).focus();
    });
  }
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.repeat || event.isComposing || blocked()) return;
    const editing = event.target.closest?.('input, textarea, select, sp-dropdown, [contenteditable="true"]');
    const slash = event.key === "/" && !editing && !event.metaKey && !event.ctrlKey && !event.altKey;
    const commandK = String(event.key).toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
    if (!slash && !commandK) return;
    event.preventDefault(); openCommands();
  });
  const controls = { refreshChanges: () => refreshChanges(document) };
  initialized.set(document, controls);
  controls.refreshChanges();
  return controls;
}
function commandRow(document, command, activate) {
  const row = document.createElement("div"); row.className = "command-row";
  row.setAttribute("role", "button"); row.tabIndex = 0;
  const glyph = document.createElement("div"); glyph.className = "command-glyph"; glyph.setAttribute("aria-hidden", "true");
  // Whole literals rather than an interpolated fragment, so no markup here is
  // assembled at runtime and the build check can prove it by inspection.
  const markup = ["branch", "branches", "switch", "merge", "compare"].includes(command.id)
    ? '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m2-2c6 0 8-2 8-6"/></svg>'
    : ["history", "activity"].includes(command.id) ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20H6z"/><path d="M14 3.5V8h4M9 12h6m-6 4h6"/></svg>';
  glyph.innerHTML = markup;
  const copy = document.createElement("div"); copy.className = "command-copy";
  const title = document.createElement("strong"); title.textContent = command.label;
  const syntax = document.createElement("code"); syntax.textContent = `/${command.example}`;
  const description = document.createElement("span"); description.textContent = command.description;
  copy.appendChild(title); copy.appendChild(syntax); copy.appendChild(description);
  row.appendChild(glyph); row.appendChild(copy);
  const invoke = () => {
    if (row.getAttribute("aria-disabled") === "true" || row.closest("[hidden]") ||
      document.body.classList.contains("is-busy") || document.body.classList.contains("is-initializing")) return;
    activate();
  };
  row.addEventListener("click", invoke);
  row.addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key) && !event.repeat && !event.isComposing) { event.preventDefault(); event.stopPropagation(); invoke(); }
  });
  return row;
}
// The same empty state the lists use, so an empty command search reads as a
// result and not as a stray line of text under the field.
function noMatches(document, advice) {
  const empty = document.createElement("section"); empty.className = "empty-state command-empty";
  empty.setAttribute("role", "status");
  const title = document.createElement("strong"); title.textContent = "No matching commands";
  const copy = document.createElement("p"); copy.textContent = advice;
  empty.appendChild(title); empty.appendChild(copy);
  return empty;
}
if (typeof module !== "undefined") module.exports = { setup, refreshChanges, commandRow, noMatches };
else window.PhotoGitWorkspace = { setup, refreshChanges, commandRow, noMatches };
