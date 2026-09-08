const mount = document.getElementById("plugin-panel");
const commandDirectory = window.PhotoGitCommands;
const demoParams = new URLSearchParams(location.search);
const timeScale = Math.max(1, Number(demoParams.get("timeScale")) || 1);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds * timeScale));
if (demoParams.has("panel")) document.body.classList.add("panel-only");
if (timeScale > 1) document.body.classList.add("recording");

let versions = [
  { message: "Refined hero typography", author: "You", date: "Today", shortId: "90511bb" },
  { message: "Established campaign direction", author: "You", date: "Today", shortId: "e3889c1" },
  { message: "Initial Photoshop document", author: "You", date: "Yesterday", shortId: "74b21fe" }
];
let changes = [
  { domain: "text", layerName: "Hero typography", photoshopId: 12, summary: "Text content and type styling changed" },
  { domain: "content", layerName: "Gradient sphere", photoshopId: 18, summary: "Painted pixels changed" },
  { domain: "structure", layerName: "CTA group", photoshopId: 21, summary: "Layer moved above Supporting copy" }
];
let activityEntries = 0;
let surfaceReturnFocus = null;
let selectedDemoVersion = null;
const surfaceTimers = new Map();
const demoReviews = [
  { branch: "campaign-type-b", ahead: 3, changeCount: 8, mergeable: true },
  { branch: "homepage-experiment", ahead: 2, changeCount: 5, mergeable: false }
];

boot();

async function boot() {
  const html = await fetch("index.html?v=10", { cache: "no-store" }).then((response) => response.text());
  const parsed = new DOMParser().parseFromString(html, "text/html");
  mount.innerHTML = "";
  mount.appendChild(document.importNode(parsed.querySelector(".panel-root"), true));
  setupDemoPanel();
  const theme = demoParams.get("theme");
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  const themeLabel = document.documentElement.getAttribute("data-theme") === "light" ? "Switch to Dark mode" : "Switch to Light mode";
  byId("appearance-toggle").setAttribute("aria-label", themeLabel);
  byId("appearance-toggle").setAttribute("title", themeLabel);
  const badge = document.createElement("p"); badge.className = "simulation-label"; badge.textContent = "Simulated preview · no Photoshop or Git operations";
  mount.prepend(badge);
  if (demoParams.get("state") === "empty") { changes = []; renderChanges(); }
  if (demoParams.get("state") === "long") { changes = Array.from({ length: 500 }, (_, i) => ({ domain: "content", layerName: "Campaign-direction-with-a-very-long-layer-name-".repeat(3) + i, photoshopId: i + 1, summary: "Rendered appearance changed" })); renderChanges(); }
  if (demoParams.get("state") === "error") flashResult("The helper is disconnected. Reconnect before saving a version.", true);
  if (demoParams.get("state") === "setup") { byId("workspace").hidden = true; byId("onboarding").hidden = false; }
  if (demoParams.get("state") === "loading") {
    byId("workspace").hidden = true; byId("onboarding").hidden = true; byId("startup-state").hidden = false;
    for (const id of ["global-search", "header-menu"]) byId(id).setAttribute("aria-disabled", "true");
  }
  if (demoParams.has("view")) selectTab(demoParams.get("view"));
  if (demoParams.has("panel")) openPhotoGit();
  if (demoParams.has("autoplay")) autoplay();
  else document.querySelector(".demo-caption").classList.add("visible");
}

function setupDemoPanel() {
  window.PhotoGitWorkspace.setup(document, { navigate: selectTab, openCommands: openCommandPalette });
  byId("startup-state").hidden = true;
  for (const id of ["global-search", "header-menu"]) byId(id).setAttribute("aria-disabled", "false");
  byId("onboarding").hidden = true;
  byId("workspace").hidden = false;
  byId("project-status").textContent = "photogit-demo";
  byId("document-name").textContent = "document.psd";
  byId("branch-name").textContent = "live-option-b";
  byId("branch-name-detail").textContent = "live-option-b";
  byId("helper-status").className = "repo-state ok";
  byId("helper-status").setAttribute("title", "Synced");
  byId("repo-sync-status").textContent = "Synced";
  const railLabel = byId("rail-sync-label");
  if (railLabel) { railLabel.textContent = "Synced"; byId("rail-sync").className = "rail-sync ok"; }
  renderDemoDocumentPreview();
  renderDemoTally();
  byId("sync-status").textContent = "Status";
  replaceDemoDropdown();
  renderDemoBranches();
  renderChanges();
  renderHistory();
  renderReviews();
  addActivity("Simulation: helper connected. Ready to inspect this example workspace.");
  addActivity("Simulation: background scan completed. Three recorded edits found.");
  setCount("branches-count", 3);
  bind("changes-tab", () => selectTab("changes"));
  bind("history-tab", () => selectTab("history"));
  bind("branches-tab", () => selectTab("branches"));
  bind("reviews-tab", () => selectTab("reviews"));
  bind("activity-tab", () => selectTab("activity"));
  bind("docs-tab", () => selectTab("docs"));
  bind("close-detail", closeDetail);
  byId("docs-search").addEventListener("input", renderCommandDocs);
  renderCommandDocs();
  bind("setup-toggle", () => { byId("setup-instructions").hidden = !byId("setup-instructions").hidden; byId("setup-toggle").setAttribute("aria-expanded", String(!byId("setup-instructions").hidden)); });
  bind("rescan", scan);
  bind("save-version", saveVersion);
  bind("pull", () => sync("Pulled live-option-b successfully.", "Pulled just now"));
  bind("push", () => sync("Changes shared successfully.", "Pushed just now"));
  bind("show-status", () => flashResult(changes.length ? `${changes.length} semantic changes ready to save.` : "Project is clean."));
  bind("refresh", () => { closeToolsMenu(); flashResult("Simulation: workspace refreshed."); });
  bind("new-branch", createBranch);
  bind("clear-activity", clearActivity);
  bind("global-search", () => openCommandPalette());
  bind("header-menu", toggleToolsMenu);
  bind("tools-toggle", toggleToolsMenu);
  bind("tool-new-branch", () => { closeToolsMenu(); selectTab("branches"); byId("new-branch-name").focus(); });
  bind("tool-new-pr", () => { closeToolsMenu(); selectTab("reviews"); });
  bind("tool-conflicts", () => { closeToolsMenu(); selectTab("reviews"); flashResult("Review the conflicting files before merging.", true); });
  bind("tool-create-tag", openTagSheet);
  bind("tool-settings", () => { closeToolsMenu(); selectTab("activity"); addActivity("Repository settings inspected."); });
  bind("close-tag-sheet", () => closeTagSheet(false, true));
  bind("surface-backdrop", () => { closeTagSheet(false, true); closeDetail(); });
  bind("create-tag", createTag);
  bind("new-pull-request", () => flashResult("Pull-request review opened in GitHub."));
  byId("branch-picker").addEventListener("change", switchBranch);
  byId("history-search").addEventListener("input", renderHistory);
  byId("tools-menu").addEventListener("keydown", handleMenuKeyboard);
  byId("section-nav").addEventListener("keydown", handleTabKeyboard);
  document.addEventListener("keydown", handleGlobalKeyboard);
  for (const [id, submit] of [["message", saveVersion], ["new-branch-name", createBranch], ["tag-name", createTag]]) {
    byId(id).addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.repeat || event.isComposing || busyNow) return;
      event.preventDefault(); event.stopPropagation(); submit();
    });
  }
  document.getElementById("plugins-menu-trigger").addEventListener("click", togglePluginsMenu);
  document.getElementById("open-photogit").addEventListener("click", openPhotoGit);
  document.getElementById("pg-dock-tab").addEventListener("click", openPhotoGit);
}

// Palette presentation mirrors production; dispatch below is explicitly simulation-only.
let busyNow = false;
function openDetail(title) {
  byId("detail-content").className = "detail-content";
  for (const attribute of ["role", "aria-label", "aria-busy", "data-state", "data-mergeable"]) byId("detail-content").removeAttribute(attribute);
  surfaceReturnFocus = document.activeElement;
  byId("detail-title").textContent = title;
  byId("detail-content").innerHTML = "";
  openBackdrop(); openSurface(byId("detail-sheet"));
}
function closeDetail() {
  closeSurface(byId("detail-sheet"), true); closeBackdrop(true);
  surfaceReturnFocus?.focus();
}
function show(message) { flashResult(message, true); }
async function executeCommand(input) {
  const parsed = commandDirectory.parse(input);
  if (!parsed) { byId("command-error").textContent = "Unknown command. Nothing was run."; return; }
  const { command, argument } = parsed;
  if (["save", "branch", "switch", "compare", "merge"].includes(command.id) && !argument) { byId("command-error").textContent = "Usage: /" + command.example; return; }
  closeDetail();
  if (["changes", "history", "branches", "reviews", "activity", "docs"].includes(command.id)) return selectTab(command.id);
  if (command.id === "save") { byId("message").value = argument; return saveVersion(); }
  if (command.id === "scan") return scan();
  if (command.id === "tag") return openTagSheet();
  flashResult("Simulation only: /" + command.id + " — no Photoshop or Git operation performed.");
}
function commandRow(command, activate) {
  return window.PhotoGitWorkspace.commandRow(document, command, activate);
}

function renderCommandDocs() {
  const list = document.getElementById("command-directory");
  list.innerHTML = "";
  const matches = commandDirectory.search(document.getElementById("docs-search").value || "");
  for (const command of matches) list.appendChild(commandRow(command, () => openCommandPalette(command.id + " ")));
  if (!matches.length) list.textContent = "No matching commands. Try save, branch, or history.";
}

function openCommandPalette(initial = "") {
  if (busyNow) return show("Wait for the current operation before running a command.", false);
  openDetail("Go to or run a command", "");
  const content = document.getElementById("detail-content");
  const field = document.createElement("input");
  field.id = "command-input"; field.type = "text"; field.maxLength = 600;
  field.setAttribute("aria-label", "PhotoGit command");
  field.setAttribute("placeholder", "Search, or type /save Your message");
  field.setAttribute("uxp-quiet", "true"); field.value = initial;
  const hint = document.createElement("p"); hint.className = "command-hint";
  hint.textContent = "Enter to run. Arrow keys to browse. Escape to close.";
  const error = document.createElement("p"); error.id = "command-error"; error.setAttribute("role", "status");
  const results = document.createElement("div"); results.id = "command-results";
  content.appendChild(field); content.appendChild(hint); content.appendChild(error); content.appendChild(results);
  const render = () => {
    error.textContent = ""; results.innerHTML = "";
    const parsed = commandDirectory.parse(field.value);
    const matches = parsed ? [parsed.command] : commandDirectory.search(field.value);
    for (const command of matches) results.appendChild(commandRow(command, () => {
      if (["save", "branch", "switch", "compare", "merge"].includes(command.id)) {
        field.value = command.id + " "; field.focus(); render();
      } else void executeCommand(command.id);
    }));
    if (!matches.length) results.textContent = "No matching commands. Nothing will be run.";
  };
  field.addEventListener("input", render);
  field.addEventListener("keydown", event => {
    if (event.repeat || event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void executeCommand(field.value); }
    if (event.key === "ArrowDown") { event.preventDefault(); results.firstElementChild?.focus(); }
  });
  results.addEventListener("keydown", event => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(results.children); const index = rows.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) field.focus(); else rows[Math.min(next, rows.length - 1)]?.focus();
  });
  render(); field.focus();
}

function handleTabKeyboard(event) {
  // The tab list is a row below 720px and a column from 720px, so both axes
  // move through it; a rail that answered only Left and Right was a dead end
  // for the keys a vertical list is expected to take.
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(byId("section-nav").querySelectorAll('[role="tab"]'));
  const current = Math.max(0, tabs.indexOf(event.target));
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (forward ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  selectTab(tabs[next]?.id.replace("-tab", ""));
}

function toggleToolsMenu(event) {
  const menu = byId("tools-menu");
  const opening = menu.hidden;
  if (opening) {
    surfaceReturnFocus = event?.currentTarget || document.activeElement;
    menu.classList.toggle("from-header", event?.currentTarget?.id === "header-menu");
    openSurface(menu);
    setTimeout(() => menu.querySelector(".tool-item")?.focus(), 0);
  } else closeToolsMenu(false, true);
  byId("header-menu").setAttribute("aria-expanded", opening ? "true" : "false");
  byId("tools-toggle").setAttribute("aria-expanded", opening ? "true" : "false");
}

function closeToolsMenu(immediate = false, returnFocus = false) {
  closeSurface(byId("tools-menu"), immediate);
  byId("header-menu").setAttribute("aria-expanded", "false");
  byId("tools-toggle").setAttribute("aria-expanded", "false");
  if (returnFocus && surfaceReturnFocus?.focus) surfaceReturnFocus.focus();
}

function openTagSheet() {
  closeToolsMenu();
  openBackdrop();
  openSurface(byId("tag-sheet"));
  byId("tag-name").focus();
}

function closeTagSheet(immediate = false, returnFocus = false) {
  closeSurface(byId("tag-sheet"), immediate);
  closeBackdrop(immediate);
  if (returnFocus && surfaceReturnFocus?.focus) surfaceReturnFocus.focus();
}

function openBackdrop() {
  const backdrop = byId("surface-backdrop");
  clearTimeout(surfaceTimers.get(backdrop));
  backdrop.hidden = false;
  backdrop.classList.remove("is-open");
  void backdrop.offsetWidth;
  backdrop.classList.add("is-open");
}

function closeBackdrop(immediate = false) {
  const backdrop = byId("surface-backdrop");
  clearTimeout(surfaceTimers.get(backdrop));
  backdrop.classList.remove("is-open");
  if (immediate) return void (backdrop.hidden = true);
  surfaceTimers.set(backdrop, setTimeout(() => { backdrop.hidden = true; }, 160));
}

function openSurface(element) {
  clearTimeout(surfaceTimers.get(element));
  element.hidden = false;
  element.classList.remove("is-closing", "is-open");
  void element.offsetWidth;
  element.classList.add("is-open");
  globalThis.PhotoGitMotion?.enter(element);
}

function closeSurface(element, immediate = false) {
  globalThis.PhotoGitMotion?.cancel(element);
  clearTimeout(surfaceTimers.get(element));
  if (element.hidden) return;
  element.classList.remove("is-open");
  if (immediate) {
    element.classList.remove("is-closing");
    element.hidden = true;
    return;
  }
  element.classList.add("is-closing");
  surfaceTimers.set(element, setTimeout(() => {
    element.classList.remove("is-closing");
    element.hidden = true;
  }, 150));
}

function handleMenuKeyboard(event) {
  if (event.key === "Tab") {
    closeToolsMenu(true);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    return closeToolsMenu(false, true);
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const items = Array.from(byId("tools-menu").querySelectorAll(".tool-item"));
  const current = Math.max(0, items.indexOf(event.target));
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  items[next]?.focus();
}

function handleGlobalKeyboard(event) {
  const sheet = !byId("detail-sheet").hidden ? byId("detail-sheet") : byId("tag-sheet");
  if (!sheet.hidden && event.key === "Tab") {
    const controls = Array.from(sheet.querySelectorAll('[tabindex="0"], input:not([disabled])'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  if (event.key !== "Escape") return;
  if (!sheet.hidden) {
    event.preventDefault();
    event.stopPropagation();
    return sheet.id === "detail-sheet" ? closeDetail() : closeTagSheet(false, true);
  }
  const menu = byId("tools-menu");
  if (!menu.hidden) {
    event.preventDefault();
    event.stopPropagation();
    closeToolsMenu(false, true);
  }
}

function createTag() {
  const input = byId("tag-name");
  const tag = input.value.trim();
  if (!tag) return flashResult("Enter a tag such as v1.0.0.", true);
  input.value = "";
  closeTagSheet();
  addActivity(`Created repository tag ${tag}.`);
  flashResult(`Created tag ${tag}.`);
}

function togglePluginsMenu() {
  const trigger = document.getElementById("plugins-menu-trigger");
  const menu = document.getElementById("plugins-menu");
  const opening = menu.hidden;
  menu.hidden = !opening;
  trigger.classList.toggle("active", opening);
  trigger.setAttribute("aria-expanded", opening ? "true" : "false");
}

function openPhotoGit() {
  document.getElementById("plugins-menu").hidden = true;
  document.getElementById("plugins-menu-trigger").classList.remove("active");
  document.getElementById("plugins-menu-trigger").setAttribute("aria-expanded", "false");
  document.getElementById("right-rail").classList.remove("panel-closed");
}

function replaceDemoDropdown() {
  const original = byId("branch-picker");
  const select = document.createElement("select");
  select.id = "branch-picker";
  select.className = "demo-select";
  ["live-option-b", "master", "homepage-experiment"].forEach((branch) => {
    const option = document.createElement("option");
    option.value = branch;
    option.textContent = branch;
    select.appendChild(option);
  });
  original.replaceWith(select);
}

function renderDemoBranches() {
  const picker = byId("branch-picker");
  window.PhotoGitBranches.render(byId("branch-list"), {
    branches: Array.from(picker.options, option => ({ name: option.value })), current: picker.value,
    // Representative artwork for the labelled prototype; production reads each
    // branch tip's committed preview.
    demoPreviews: Object.fromEntries(Array.from(picker.options, (option, index) => [option.value, DEMO_POSTERS[index % DEMO_POSTERS.length]])),
    onSwitch: name => {
      openDetail("Switch design direction?");
      const description = document.createElement("p");
      description.textContent = `Simulation: switch to ${name}. In Photoshop, PhotoGit checks for unsaved work before switching.`;
      const confirm = document.createElement("div");
      confirm.className = "button button-primary"; confirm.setAttribute("role", "button"); confirm.tabIndex = 0;
      confirm.textContent = "Switch branch";
      confirm.addEventListener("click", () => { picker.value = name; switchBranch({ target: picker }); closeDetail(); });
      confirm.addEventListener("keydown", activateOnKeyboard);
      byId("detail-content").append(description, confirm); confirm.focus();
    }
  });
}

function renderChanges() {
  const container = byId("changes");
  container.innerHTML = "";
  setCount("changes-count", changes.length);
  byId("change-summary").textContent = changes.length ? `${changes.length} unsaved ${changes.length === 1 ? "edit" : "edits"}` : "Your canvas is clean";
  byId("last-scan").textContent = "Scanned just now · Updates automatically";
  byId("changes-empty").hidden = changes.length > 0;
  changes.forEach((change, index) => {
    const row = document.createElement("div");
    row.className = "list-row change-row";
    row.dataset.domain = change.domain;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", "false");
    row.setAttribute("aria-label", `Select changed layer ${change.layerName}, Photoshop layer ${change.photoshopId}. ${change.summary}`);
    row.innerHTML = `<span class="row-glyph" aria-hidden="true">${domainIcon(change.domain)}</span><span class="row-copy"><strong>${escapeHtml(change.layerName)}</strong><span class="layer-identity">Layer #${escapeHtml(change.photoshopId)}</span><span class="change-detail">${escapeHtml(change.summary)}</span></span><span class="change-domain"><span class="change-state">Modified</span><span class="change-kind">${escapeHtml(change.domain)}</span></span>`;
    const select = () => {
      document.querySelectorAll(".layer").forEach((layer) => layer.classList.remove("active"));
      document.querySelectorAll(".layer")[index]?.classList.add("active");
      container.querySelectorAll(".change-row").forEach((entry) => {
        entry.classList.remove("selected");
        entry.setAttribute("aria-pressed", "false");
      });
      row.classList.add("selected");
      row.setAttribute("aria-pressed", "true");
      flashResult(`Simulation: selected “${change.layerName}”. No Photoshop document was changed.`);
    };
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      select();
    });
    container.appendChild(row);
  });
  window.PhotoGitWorkspace.refreshChanges(document);
}

function renderHistory() {
  const query = byId("history-search").value.trim().toLowerCase();
  const matching = versions.filter((version) => !query || [version.message, version.shortId, version.author, version.date].some((value) => value.toLowerCase().includes(query)));
  const container = byId("history");
  container.innerHTML = "";
  setCount("history-count", versions.length);
  byId("history-total").textContent = `${versions.length} versions`;
  byId("history-empty").hidden = matching.length > 0;
  byId("history-empty-title").textContent = query && versions.length ? "No matching versions" : "No saved versions yet";
  byId("history-empty-copy").textContent = query && versions.length ? "Search by message, author, date, or version ID, or clear the search." : "Save your first version to start this document’s history.";
  for (const group of groupHistory(matching)) {
    const section = document.createElement("section");
    section.className = "history-group";
    section.innerHTML = `<div class="history-group-heading"><strong>${escapeHtml(group.label)}</strong><span>Committed by ${escapeHtml(group.author)}</span></div><div class="history-group-entries"></div>`;
    const entries = section.querySelector(".history-group-entries");
    group.entries.forEach((version) => {
      const row = document.createElement("div");
      row.className = "list-row history-row";
      row.dataset.version = version.shortId;
      row.classList.toggle("selected", selectedDemoVersion === version.shortId);
      const message = escapeHtml(version.message);
      const shortId = escapeHtml(version.shortId);
      row.innerHTML = `<span class="history-marker" aria-hidden="true">${historyIcon()}</span><span class="row-copy"><strong title="${message}">${message}</strong><span>${escapeHtml(version.author)} · ${escapeHtml(version.date)}</span></span><span class="commit-id" title="Checkpoint ${shortId}">${shortId}</span>`;
      row.setAttribute("role", "button"); row.tabIndex = 0;
      row.setAttribute("aria-pressed", String(selectedDemoVersion === version.shortId));
      row.setAttribute("aria-label", `Inspect version ${version.shortId}: ${version.message}`);
      row.addEventListener("click", () => {
        selectedDemoVersion = version.shortId;
        for (const entry of container.querySelectorAll(".history-row")) { entry.classList.toggle("selected", entry.dataset.version === version.shortId); entry.setAttribute("aria-pressed", String(entry.dataset.version === version.shortId)); }
        if (matchMedia("(min-width: 900px)").matches) renderDemoVersion(byId("history-inspector"), version);
        else { openDetail(`Version ${version.shortId}`); renderDemoVersion(byId("detail-content"), version); }
      });
      row.addEventListener("keydown", activateOnKeyboard);
      entries.appendChild(row);
    });
    container.appendChild(section);
  }
}

// Representative artwork for the simulated prototype only. Production has no
// version preview channel, so the inspector falls back to metadata there.
const DEMO_POSTERS = ["assets/poster-main.jpg", "assets/poster-type.jpg", "assets/poster-home.jpg"];

function demoPosterFor(version) {
  const key = String(version?.shortId || version?.message || "");
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return { demo: true, src: DEMO_POSTERS[hash % DEMO_POSTERS.length], alt: "Representative demo poster artwork" };
}

// Simulated document facts and artwork for the labelled prototype only.
// Production fills these from the real scan and the newest saved version.
// Simulated tallies for the labelled prototype; production counts the real
// categories reported by the scan.
function renderDemoTally() {
  const tally = byId("change-tally");
  if (!tally) return;
  const counts = { "tally-changed": changes.filter(c => !["added", "removed"].includes(c.category)).length,
                   "tally-added": changes.filter(c => c.category === "added").length,
                   "tally-removed": changes.filter(c => c.category === "removed").length };
  for (const [id, value] of Object.entries(counts)) { const el = byId(id); if (el) el.textContent = String(value); }
  tally.hidden = changes.length === 0;
}

function renderDemoDocumentPreview() {
  const section = byId("document-preview");
  const list = byId("document-facts");
  if (!section || !list) return;
  list.textContent = "";
  for (const [label, value] of [["Size", "3456 × 5184 px"], ["Resolution", "300 ppi"], ["Mode", "RGB"], ["Depth", "16 bpc"], ["Document", "document.psd"]]) {
    const row = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = value;
    row.append(term, detail); list.appendChild(row);
  }
  section.hidden = false;
  const figure = byId("document-preview-figure");
  const image = byId("document-preview-image");
  if (!figure || !image) return;
  image.addEventListener("error", () => { figure.hidden = true; }, { once: true });
  figure.hidden = false;
  image.src = DEMO_POSTERS[0];
}

function renderDemoVersion(container, version) {
  window.PhotoGitVersionInspector.render(container, {
    demoPreview: demoPosterFor(version),
    details: {
      version: { ...version, id: version.shortId }, snapshotAvailable: true,
      changes: [{ domain: "text", layerName: "Hero typography", summary: "Refined the title spacing and hierarchy." }, { domain: "appearance", layerName: "Color grade", summary: "Adjusted contrast and color balance." }],
      files: [{ status: "M", path: "snapshot/document.psd" }, { status: "M", path: ".photogit/document.json" }],
      warnings: ["Simulated preview only. No Photoshop or Git operations occur here."]
    },
    onOpen: () => flashResult("Simulation only: a separate version copy would open. No file was opened.")
  });
}

function groupHistory(entries) {
  const groups = new Map();
  entries.forEach((version) => {
    const label = version.date;
    const key = `${label}\u0000${version.author}`;
    if (!groups.has(key)) groups.set(key, { label, author: version.author, entries: [] });
    groups.get(key).entries.push(version);
  });
  return [...groups.values()];
}

function renderReviews() {
  const container = byId("reviews");
  container.innerHTML = "";
  setCount("reviews-count", demoReviews.length);
  byId("review-provider").textContent = `Simulated local reviews · merging into ${byId("branch-name").textContent}`;
  for (const review of demoReviews) container.appendChild(createDemoReviewCard(review));
  byId("reviews-empty").hidden = demoReviews.length > 0;
}

function createDemoReviewCard(review) {
  const card = document.createElement("article");
  card.className = "review-card";
  card.innerHTML = `<div class="review-title"><strong>${escapeHtml(review.branch)}</strong><span>${escapeHtml(review.ahead)} ahead</span></div><p class="review-direction muted">${escapeHtml(review.branch)} → ${escapeHtml(byId("branch-name").textContent)}</p><div class="review-meta"><span class="${review.mergeable ? "ready" : "blocked"}">${review.mergeable ? "Git merge available" : "Git merge blocked"}</span><span>·</span><span>2 files</span></div><div class="review-actions"><div class="button button-quiet button-small compare-action" role="button" tabindex="0" aria-label="Compare ${escapeHtml(review.branch)} with the current branch">Compare</div><div class="button ${review.mergeable ? "button-primary" : "button-disabled"} button-small merge-action" role="button" tabindex="${review.mergeable ? "0" : "-1"}" ${review.mergeable ? "" : "aria-disabled=\"true\""}>${review.mergeable ? "Merge" : "Blocked"}</div></div>`;
  if (!review.mergeable) {
    const unavailable = card.querySelector(".merge-action");
    unavailable.textContent = "Resolve conflicts to merge";
    unavailable.setAttribute("role", "note"); unavailable.removeAttribute("tabindex");
  }
  card.querySelector(".compare-action").addEventListener("click", () => showDemoComparison(review));
  card.querySelector(".compare-action").addEventListener("keydown", activateOnKeyboard);
  if (review.mergeable) card.querySelector(".merge-action").addEventListener("click", () => confirmDemoMerge(review));
  card.querySelector(".merge-action").addEventListener("keydown", activateOnKeyboard);
  return card;
}

function showDemoComparison(review) {
  let container;
  if (matchMedia("(min-width: 900px)").matches) { selectTab("reviews"); container = byId("review-inspector"); }
  else { openDetail("Compare branches"); container = byId("detail-content"); }
  window.PhotoGitReviewInspector.render(container, {
    comparison: {
      incomingBranch: review.branch, baseBranch: byId("branch-name").textContent,
      ahead: review.ahead, behind: 1, gitMergeable: review.mergeable,
      changes: [{ layerName: "Hero typography", summary: "Adjusted title spacing and scale." }, { layerName: "Color grade", summary: "Updated the recorded contrast settings." }],
      files: [{ status: "M", path: "snapshot/document.psd" }, { status: "M", path: ".photogit/document.json" }],
      conflicts: review.mergeable ? [] : ["snapshot/document.psd"],
      warnings: ["Simulation only. No branches or files will be changed."]
    }, onMerge: () => confirmDemoMerge(review)
  });
}

function confirmDemoMerge(review) {
  if (!review.mergeable || busyNow) return;
  openDetail("Review merge");
  const description = document.createElement("p");
  description.textContent = `Simulation: ${review.branch} → ${byId("branch-name").textContent}. This demonstrates the confirmation step only. PhotoGit uses ordinary Git merge; it does not blend PSD layers.`;
  const confirm = document.createElement("div");
  confirm.className = "button button-primary"; confirm.setAttribute("role", "button"); confirm.tabIndex = 0;
  confirm.textContent = "Simulate merge";
  confirm.addEventListener("click", () => { addActivity(`Simulation: merged ${review.branch}. No Git operation occurred.`); closeDetail(); flashResult("Simulation complete. No branches or files were changed."); });
  confirm.addEventListener("keydown", activateOnKeyboard);
  byId("detail-content").append(description, confirm); confirm.focus();
}

async function scan() {
  if (busyNow) return;
  await simulateBusy("Reviewing Photoshop layers…", 420);
  renderChanges();
  addActivity(`Found ${changes.length} semantic layer changes.`);
  flashResult(`Found ${changes.length} semantic layer changes.`);
}

async function saveVersion() {
  if (busyNow) return;
  const message = byId("message").value.trim();
  if (!message) return flashResult("Describe what changed before saving.", true);
  await simulateBusy("Saving exact PSD, preview, and semantic data…", 620);
  versions.unshift({ message, author: "You", date: "Today", shortId: "c84f2a7" });
  changes = [];
  byId("message").value = "";
  byId("history-search").value = "";
  renderChanges();
  renderHistory();
  addActivity(`Saved c84f2a7: ${message}`);
  flashResult("Saved version c84f2a7.");
  selectTab("history");
}

function createBranch() {
  const input = byId("new-branch-name");
  const name = input.value.trim();
  if (!name) return flashResult("Enter a new branch name.", true);
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  byId("branch-picker").appendChild(option);
  byId("branch-picker").value = name;
  byId("branch-name").textContent = name;
  byId("branch-name-detail").textContent = name;
  renderDemoBranches();
  renderReviews();
  setCount("branches-count", byId("branch-picker").options.length);
  input.value = "";
  addActivity(`Created and switched to ${name}.`);
  flashResult(`Created branch ${name}.`);
}

function switchBranch(event) {
  byId("branch-name").textContent = event.target.value;
  byId("branch-name-detail").textContent = event.target.value;
  renderDemoBranches();
  renderReviews();
  window.PhotoGitReviewInspector.render(byId("review-inspector"));
  addActivity(`Switched to ${event.target.value}.`);
  flashResult(`Switched to ${event.target.value}.`);
}

function sync(message, status) {
  byId("show-status").setAttribute("title", `Check project status · ${status}`);
  addActivity(message);
  flashResult(message);
}

async function simulateBusy(label, duration) {
  busyNow = true;
  document.body.classList.add("is-busy");
  const card = mount.querySelector(".capture-panel");
  card.classList.add("is-busy");
  byId("result").textContent = label;
  byId("result").className = "";
  byId("save-version").setAttribute("aria-disabled", "true");
  byId("progress").hidden = false;
  try { await wait(duration); }
  finally {
    busyNow = false;
    document.body.classList.remove("is-busy");
    card.classList.remove("is-busy");
    byId("save-version").setAttribute("aria-disabled", "false");
    byId("progress").hidden = true;
  }
}

function flashResult(message, error = false) {
  byId("result").textContent = message;
  byId("result").className = error ? "error" : "success";
}

function addActivity(message) {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const feed = byId("activity");
  if (feed.textContent === "Ready.") feed.textContent = "";
  const row = document.createElement("div"); row.className = "activity-row";
  const summary = document.createElement("div"); summary.className = "activity-summary";
  const icon = document.createElement("span"); icon.className = "activity-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = "✓";
  const time = document.createElement("span"); time.className = "activity-time"; time.textContent = stamp;
  const copy = document.createElement("span"); copy.className = "activity-copy"; copy.textContent = message;
  summary.append(icon, time, copy); row.appendChild(summary); feed.prepend(row);
  activityEntries += 1;
  setCount("activity-count", activityEntries);
}

function clearActivity() {
  byId("activity").textContent = "Ready.";
  activityEntries = 0;
  setCount("activity-count", 0);
}

function setCount(id, value) {
  const count = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const element = byId(id);
  element.textContent = String(count);
  element.dataset.empty = count === 0 ? "true" : "false";
}

function selectTab(name) {
  ["changes", "history", "branches", "reviews", "activity", "docs"].forEach((section) => {
    const active = section === name;
    byId(`${section}-view`).hidden = !active;
    byId(`${section}-tab`).classList.toggle("active", active);
    byId(`${section}-tab`).setAttribute("aria-selected", active ? "true" : "false");
    byId(`${section}-tab`).tabIndex = active ? 0 : -1;
  });
  globalThis.PhotoGitMotion?.enter(byId(`${name}-view`));
}

function setCaption(step, heading, copy) {
  document.getElementById("demo-step").textContent = step;
  document.getElementById("demo-heading").textContent = `Simulated prototype · ${heading}`;
  document.getElementById("demo-copy").textContent = `${copy} No real Photoshop or Git operations occur.`;
  document.querySelector(".demo-caption").classList.add("visible");
}

async function moveCursor(target) {
  const cursor = document.getElementById("demo-cursor");
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  await wait(260);
  const rect = target.getBoundingClientRect();
  cursor.style.left = `${rect.left + rect.width * 0.62}px`;
  cursor.style.top = `${rect.top + rect.height * 0.55}px`;
  cursor.style.opacity = "1";
  await wait(420);
}

async function clickWithCursor(target) {
  await moveCursor(target);
  const cursor = document.getElementById("demo-cursor");
  cursor.classList.remove("click");
  void cursor.offsetWidth;
  cursor.classList.add("click");
  target.click();
  await wait(320);
}

async function typeInto(field, value) {
  await moveCursor(field);
  field.focus();
  field.value = "";
  for (const character of value) {
    field.value += character;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(24);
  }
}

async function autoplay() {
  const caption = document.querySelector(".demo-caption");
  await wait(450);
  caption.classList.add("visible");
  await wait(700);

  setCaption("00", "Open PhotoGit in Photoshop", "Plugins → PhotoGit opens the dockable sidebar beside the document.");
  await clickWithCursor(document.getElementById("plugins-menu-trigger"));
  await wait(420);
  document.getElementById("open-photogit").classList.add("hovered");
  await clickWithCursor(document.getElementById("open-photogit"));
  await wait(850);

  setCaption("01", "Review live layer changes", "Readable content, appearance, and structure edits map back to Photoshop layers.");
  await clickWithCursor(mount.querySelector(".change-row"));
  await wait(450);
  await clickWithCursor(byId("rescan"));
  await wait(650);

  setCaption("02", "Save a complete checkpoint", "One version stores the PSD, preview, semantic data, and design intent.");
  await typeInto(byId("message"), "Polished campaign hero");
  await clickWithCursor(byId("save-version"));
  await wait(750);

  setCaption("03", "Search the full history", "Find an earlier decision by message, author, date, or checkpoint ID.");
  await moveCursor(byId("history-search"));
  await typeInto(byId("history-search"), "hero");
  await wait(700);

  setCaption("04", "Branch without duplicating files", "Create and switch design directions from the same docked panel.");
  await clickWithCursor(byId("branches-tab"));
  await typeInto(byId("new-branch-name"), "campaign-type-b");
  await clickWithCursor(byId("new-branch"));
  await wait(450);
  const select = byId("branch-picker");
  await moveCursor(select);
  select.value = "homepage-experiment";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(600);

  setCaption("05", "Sync with the remote", "Check status, pull shared work, and push the current branch without leaving Photoshop.");
  await clickWithCursor(byId("show-status"));
  await clickWithCursor(byId("pull"));
  await clickWithCursor(byId("push"));
  await wait(500);

  setCaption("06", "See every operation", "Activity keeps saves, branch switches, and sync actions transparent.");
  await clickWithCursor(byId("activity-tab"));
  await wait(1000);

  document.querySelector(".demo-caption").classList.remove("visible");
  document.getElementById("demo-cursor").style.opacity = "0";
  const finale = document.getElementById("demo-finale");
  finale.hidden = false;
  await wait(60);
  finale.classList.add("visible");
}

function bind(id, handler) {
  const element = byId(id);
  element.addEventListener("click", event => { if (element.getAttribute("aria-disabled") !== "true") handler(event); });
  if (["button", "tab", "menuitem"].includes(element.getAttribute("role"))) element.addEventListener("keydown", activateOnKeyboard);
}
function activateOnKeyboard(event) {
  if ((event.key !== "Enter" && event.key !== " ") || event.repeat || event.isComposing) return;
  event.preventDefault();
  event.currentTarget.click();
}
function byId(id) { return mount.querySelector(`#${id}`); }
function domainIcon(domain) {
  if (domain === "text") return '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13m-4 0h8"/></svg>';
  if (domain === "appearance") return '<svg viewBox="0 0 24 24"><path d="M12 4c4.4 0 8 3.1 8 7 0 3-2.2 4-4 4h-1.2c-.9 0-1.4 1-.9 1.8.8 1.3-.2 3.2-2.3 3.2C7.4 20 4 16.4 4 12s3.6-8 8-8Z"/><circle cx="8" cy="10" r=".8"/><circle cx="11" cy="7.5" r=".8"/><circle cx="15" cy="8.5" r=".8"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4m-16 4 8 4 8-4"/></svg>';
}
function historyIcon() { return '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/></svg>'; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
