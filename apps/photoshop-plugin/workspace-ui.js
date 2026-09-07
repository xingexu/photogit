// Shared presentation controls only: never writes PSDs, stages files or calls Git.
function refreshChanges(document) {
  const rows = Array.from(document.querySelectorAll("#changes .change-row"));
  const search = document.getElementById("changes-search");
  const chips = Array.from(document.querySelectorAll("[data-change-filter]"));
  if (!rows.length) {
    search.value = "";
    for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.changeFilter === "all"));
  }
  const query = String(search.value || "").trim().toLowerCase();
  const type = chips.find(chip => chip.getAttribute("aria-pressed") === "true")?.dataset.changeFilter || "all";
  let visible = 0;
  for (const row of rows) {
    const domain = row.dataset.domain;
    const matchesType = type === "all" || (type === "visual" ? !["text", "structure"].includes(domain) : domain === type);
    row.hidden = !matchesType || !row.textContent.toLowerCase().includes(query);
    if (!row.hidden) visible++;
  }
  document.getElementById("change-filters").hidden = rows.length === 0;
  document.getElementById("change-filter-empty").hidden = rows.length === 0 || visible > 0;
  const count = document.getElementById("change-filter-count");
  count.hidden = rows.length === 0 || (!query && type === "all");
  count.textContent = `${visible} of ${rows.length} listed edits · display filter only`;
  return visible;
}

const initialized = new WeakMap();
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
      if (!["Enter", " "].includes(event.key) || event.repeat) return;
      event.preventDefault(); event.stopPropagation(); invoke();
    });
  }
  for (const chip of document.querySelectorAll("[data-change-filter]")) {
    activate(chip, () => {
      for (const other of document.querySelectorAll("[data-change-filter]")) other.setAttribute("aria-pressed", String(other === chip));
      refreshChanges(document);
    });
  }
  const search = document.getElementById("changes-search");
  search.addEventListener("input", () => refreshChanges(document));
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
if (typeof module !== "undefined") module.exports = { setup, refreshChanges };
else window.PhotoGitWorkspace = { setup, refreshChanges };
