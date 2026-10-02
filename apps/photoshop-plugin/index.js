const { app, core, action, imaging } = require("photoshop");
const { storage, entrypoints, shell } = require("uxp");
const panelModel = require("./panel-model.js");
const commandDirectory = require("./commands.js");
const workspaceUI = require("./workspace-ui.js");
const versionInspector = require("./version-inspector.js");
const branchView = require("./branch-view.js");
const activityView = require("./activity-view.js");
const layerDetails = require("./layer-details.js");
const reviewInspector = require("./review-inspector.js");
const { encodePreviewPng } = require("./preview-png.js");
const scans = new panelModel.ScanCoordinator();

entrypoints.setup({
  panels: {
    photogitPanel: {
      show() {
        syncDocumentLabel();
        queueAutomaticScan("panel-open", 250);
      }
    }
  }
});

const PROTOCOL_VERSION = 1;
const HELPER_TIMEOUT_MS = 120000;
const HELPER_HEALTH_TIMEOUT_MS = 5000;
const MAX_HELPER_IO_BYTES = 5 * 1024 * 1024;
const MAX_CAPTURE_LAYERS = 50_000;
const MAX_VISIBLE_CHANGES = 500;
const MAX_VISIBLE_CONFLICTS = 500;
const CONTENT_FINGERPRINT_SIZE = 64;
const AUTO_SCAN_DELAY_MS = 700;
const SECTIONS = ["changes", "history", "branches", "reviews", "activity", "docs"];
const IGNORED_PHOTOSHOP_EVENTS = new Set(["select", "deselect", "invokeCommand", "get", "save"]);
let projectFolder = null;
let helperToken = null;
let busyNow = false;
let historyEntries = [];
let historyPreviews = {};
let historyPreviewGeneration = 0;
let selectedVersionId = null;
let newestVersionId = null;
let pressedControl = null;
let pressedAt = 0;
let reviewEntries = [];
let expandedReview = null;
let repositoryDetails = null;
let activityEntryCount = 0;
let resultTimer = null;
let surfaceReturnFocus = null;
let autoScanTimer = null;
let pendingPhotoshopEvent = null;
let changeListenerInstalled = false;
let observedDocumentId = null;
let documentObservationReady = false;
let observedHistoryState = null;
let workspaceGeneration = 0;
let projectStatus = null;
let helperOnline = false;
let suppressNotifications = false;
let detailAction = null;
let lastScanCount = null;
let startupPromise = null;
let startupPending = false;
let historyRefreshPending = false;
const surfaceTimers = new Map();

document.addEventListener("DOMContentLoaded", () => { void initializePanel(); });

function bindPanelEvents() {
  workspaceUI.setup(document, { navigate: selectTab, openCommands: openCommandPalette });
  bind("choose-project", "click", chooseProject);
  bind("setup-toggle", "click", () => {
    const instructions = document.getElementById("setup-instructions");
    instructions.hidden = !instructions.hidden;
    document.getElementById("setup-toggle").setAttribute("aria-expanded", String(!instructions.hidden));
  });
  bind("setup-command-toggle", "click", () => {
    const command = document.getElementById("setup-command-live");
    command.hidden = !command.hidden;
    document.getElementById("setup-command-toggle").setAttribute("aria-expanded", String(!command.hidden));
  });
  bind("change-project", "click", chooseProject);
  bind("tool-change-project", "click", () => { closeToolsMenu(); return chooseProject(); });
  bind("tool-docs", "click", () => { closeToolsMenu(); selectTab("docs"); });
  bind("reconnect-helper", "click", reconnectHelper);
  bind("connect-document", "click", connectDocument);
  bind("open-project-document", "click", () => run("Opening project document…", () => openSnapshot()));
  bind("cancel-scan", "click", cancelScan);
  bind("close-detail", "click", () => closeDetail(false));
  bind("detail-action", "click", () => detailAction?.());
  bind("refresh", "click", refreshAndScan);
  bind("global-search", "click", () => { closeToolsMenu(); openCommandPalette(); });
  bind("docs-tab", "click", () => selectTab("docs"));
  bind("docs-search", "input", renderCommandDocs);
  moveIntoList("docs-search", "#command-directory .command-row");
  renderCommandDocs();
  bind("header-menu", "click", toggleToolsMenu);
  bind("rescan", "click", () => { closeToolsMenu(); return scanChanges({ automatic: false }); });
  bind("save-version", "click", saveVersion);
  bind("pull", "click", () => { closeToolsMenu(); return pull(); });
  bind("push", "click", push);
  bind("show-status", "click", () => { closeToolsMenu(); return showProjectStatus(); });
  bind("new-branch", "click", createBranch);
  bind("changes-tab", "click", () => selectTab("changes"));
  bind("history-tab", "click", () => selectTab("history"));
  bind("branches-tab", "click", () => selectTab("branches"));
  bind("reviews-tab", "click", () => selectTab("reviews"));
  bind("activity-tab", "click", () => selectTab("activity"));
  // A tab is selected as soon as it takes focus. The first click on a panel
  // that Photoshop had taken focus from only focuses what was clicked; with
  // this it still switches. Keyboard users move focus and selection together.
  for (const section of ["changes", "history", "branches", "reviews", "activity"]) {
    document.getElementById(`${section}-tab`).addEventListener("focus", () => {
      if (!startupPending && document.getElementById("workspace").dataset.view !== section) selectTab(section);
    });
  }
  if (typeof window.addEventListener === "function") window.addEventListener("resize", placeTabIndicator);
  bind("history-search", "input", filterHistory);
  moveIntoList("history-search", "#history .history-row");
  bind("clear-activity", "click", clearActivity);
  bind("new-pull-request", "click", openPullRequest);
  bind("tool-new-branch", "click", openNewBranch);
  bind("tool-new-pr", "click", openPullRequest);
  bind("tool-conflicts", "click", openConflicts);
  bind("tool-create-tag", "click", openTagSheet);
  bind("tool-settings", "click", openRepositorySettings);
  bind("close-tag-sheet", "click", () => closeTagSheet(false, true));
  bind("surface-backdrop", "click", () => { closeTagSheet(false, true); closeDetail(false); });
  bind("create-tag", "click", createTag);
  bindInputAction("message", saveVersion);
  bindInputAction("new-branch-name", createBranch);
  bindInputAction("tag-name", createTag);
  document.getElementById("section-nav").addEventListener("keydown", handleTabKeyboard);
  document.getElementById("tools-menu").addEventListener("keydown", handleMenuKeyboard);
  document.addEventListener("keydown", handleGlobalKeyboard);
  document.addEventListener("click", handleOutsideClick);
  // The status line floats over the screen; a press puts it away.
  document.getElementById("result").addEventListener("click", () => {
    clearTimeout(resultTimer);
    const result = document.getElementById("result");
    result.textContent = ""; result.className = "status-message";
    syncToast();
  });
  document.addEventListener("click", (event) => {
    const control = event.target?.closest?.(".button");
    if (control) { pressedControl = control; pressedAt = Date.now(); }
  }, true);
  // The panel reopens on the section it was closed on. An unknown name
  // or unreadable preference storage falls back to Changes.
  let lastSection = null;
  try { lastSection = localStorage.getItem("photogit.section"); } catch { /* Default below. */ }
  selectTab(SECTIONS.includes(lastSection) ? lastSection : "changes", false);
  window.setInterval(syncDocumentLabel, 1000);
  window.setInterval(() => { void refreshHistoryInBackground(); }, 10000);
  document.addEventListener("input", savePanelState);
  document.addEventListener("click", savePanelState);
}

function panelStateKey() {
  return projectFolder ? `photogit.workspace:${projectFolder.nativePath || projectFolder.name}` : null;
}

function savePanelState() {
  const key = panelStateKey();
  if (!key || startupPending) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      message: document.getElementById("message").value.slice(0, 500),
      historySearch: document.getElementById("history-search").value.slice(0, 500),
      selectedVersionId
    }));
  } catch { /* Storage is optional; keep the live draft intact. */ }
}

async function restorePanelState() {
  const key = panelStateKey();
  if (!key) return;
  let saved = {};
  try { const text = localStorage.getItem(key); if (text && text.length < 4096) saved = JSON.parse(text) || {}; } catch { /* Use current defaults. */ }
  if (typeof saved.message === "string") document.getElementById("message").value = saved.message.slice(0, 500);
  if (typeof saved.historySearch === "string") document.getElementById("history-search").value = saved.historySearch.slice(0, 500);
  workspaceUI.refreshChanges(document);
  filterHistory();
  // The selection is restored as the highlighted card; opening its details
  // stays an explicit press.
  if (historyEntries.some(entry => entry.id === saved.selectedVersionId)) { selectedVersionId = saved.selectedVersionId; filterHistory(); }
}

async function refreshHistoryInBackground() {
  if (historyRefreshPending || startupPending || busyNow || scans.running || !helperOnline || !projectFolder || !helperToken) return;
  const folder = projectFolder, generation = workspaceGeneration;
  historyRefreshPending = true;
  try {
    const result = await callHelper("history", {}, HELPER_HEALTH_TIMEOUT_MS);
    if (folder !== projectFolder || generation !== workspaceGeneration || busyNow) return;
    if (JSON.stringify(result.versions) !== JSON.stringify(historyEntries)) await loadHistory(result);
  } catch { /* Background reads leave the current history and draft in place. */ }
  finally { historyRefreshPending = false; }
}

function initializePanel() {
  // Some host lifecycle events can repeat. Bind controls and start polling once.
  if (!startupPromise) startupPromise = startPanel();
  return startupPromise;
}

async function startPanel() {
  setStartup(true);
  try {
    bindPanelEvents();
    let folderToken = null;
    try { folderToken = localStorage.getItem("photogit.projectFolderToken"); } catch { /* Continue with setup if preferences are unavailable. */ }
    if (folderToken) {
      try {
        projectFolder = await startupRead(storage.localFileSystem.getEntryForPersistentToken(folderToken));
        await startupRead(loadPairing());
      } catch {
        try { localStorage.removeItem("photogit.projectFolderToken"); } catch { /* Continue with setup. */ }
        projectFolder = null;
        helperToken = null;
        show("Your saved project connection is unavailable. Connect the project again.", true);
      }
    }
    document.getElementById("startup-message").textContent = projectFolder ? "Checking the helper and loading saved versions." : "Preparing your workspace.";
    // Startup reads are bounded separately from potentially slow Git mutations.
    await refreshWorkspace(false, HELPER_HEALTH_TIMEOUT_MS);
  } catch (error) {
    setHelper("Connection needs attention", false);
    const ready = Boolean(projectFolder && helperToken);
    document.getElementById("onboarding").hidden = ready;
    document.getElementById("workspace").hidden = !ready;
    show("PhotoGit could not finish loading. Reconnect your project to try again.", true);
    log(`Startup failed: ${error.message || String(error)}`);
  } finally {
    setStartup(false);
  }
  await installPhotoshopChangeDetection();
  await restorePanelState();
  if (helperOnline) queueAutomaticScan("initial-load", 150);
}

async function startupRead(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("The saved project connection timed out.")), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

function setStartup(active) {
  startupPending = active;
  document.body.classList.toggle("is-initializing", active);
  document.getElementById("startup-state").hidden = !active;
  document.getElementById("workspace").setAttribute("aria-busy", String(active));
  for (const id of ["global-search", "header-menu"]) document.getElementById(id).setAttribute("aria-disabled", String(active));
}

function bind(id, event, handler) {
  const element = document.getElementById(id);
  const invoke = (inputEvent) => {
    if (startupPending || element.getAttribute("aria-disabled") === "true") return;
    return handler(inputEvent);
  };
  element.addEventListener(event, invoke);
  if (event === "click" && ["button", "tab", "menuitem"].includes(element.getAttribute("role"))) {
    element.addEventListener("keydown", (keyEvent) => {
      if ((keyEvent.key !== "Enter" && keyEvent.key !== " ") || keyEvent.repeat || keyEvent.isComposing) return;
      keyEvent.preventDefault();
      invoke(keyEvent);
    });
  }
}

// Marks a footer action as working for the life of its operation, so its
// icon turns while the helper answers and stops with the result.
async function working(id, operation) {
  const control = document.getElementById(id);
  control.classList.add("is-working");
  try { return await operation(); } finally { control.classList.remove("is-working"); }
}

// Enter or Down from a search field moves into the first row it left
// showing; the rows answer Enter themselves from there. With no rows the
// keys do nothing, so Enter never falls through to a form action.
function moveIntoList(id, selector) {
  document.getElementById(id).addEventListener("keydown", (event) => {
    if (!["Enter", "ArrowDown"].includes(event.key) || event.repeat || event.isComposing) return;
    const first = document.querySelector(selector);
    if (!first) return;
    event.preventDefault();
    first.focus();
  });
}

function bindInputAction(id, handler) {
  document.getElementById(id).addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.repeat || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    handler(event);
  });
}

function handleTabKeyboard(event) {
  // The tab list is a row below 720px and a column from 720px, so both axes
  // move through it; a rail that answered only Left and Right was a dead end
  // for the keys a vertical list is expected to take.
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(document.querySelectorAll(".nav-item")).filter(tab => !tab.hidden);
  const current = Math.max(0, tabs.indexOf(event.target));
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (forward ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  selectTab(tabs[next].id.replace("-tab", ""));
}

function handleGlobalKeyboard(event) {
  const sheet = !document.getElementById("detail-sheet").hidden ? document.getElementById("detail-sheet") : document.getElementById("tag-sheet");
  if (!sheet.hidden && event.key === "Tab") {
    const controls = Array.from(sheet.querySelectorAll('[tabindex="0"], input:not([disabled])')).filter(control => !control.hidden && control.getAttribute("aria-disabled") !== "true");
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
    return sheet.id === "detail-sheet" ? closeDetail(false) : closeTagSheet(false, true);
  }
  const menu = document.getElementById("tools-menu");
  if (!menu.hidden) {
    event.preventDefault();
    event.stopPropagation();
    closeToolsMenu(false, true);
  }
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
  const items = Array.from(document.querySelectorAll("#tools-menu .tool-item")).filter(item => !item.hidden && item.getAttribute("aria-disabled") !== "true");
  const current = Math.max(0, items.indexOf(event.target));
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  items[next].focus();
}

function handleOutsideClick(event) {
  const menu = document.getElementById("tools-menu");
  if (menu.hidden || menu.contains(event.target)) return;
  if (document.getElementById("header-menu").contains(event.target)) return;
  closeToolsMenu();
}

async function chooseProject() {
  if (busyNow) return show("PhotoGit is busy. Try again in a moment.", true);
  const folder = await storage.localFileSystem.getFolder();
  if (!folder) return;
  savePanelState();
  cancelScan();
  workspaceGeneration += 1;
  projectStatus = null;
  lastScanCount = null;
  helperToken = null;
  projectFolder = folder;
  document.getElementById("message").value = "";
  document.getElementById("history-search").value = "";
  branchPreviews = {};
  historyPreviews = {};
  historyPreviewGeneration++;
  branchView.render(document.getElementById("branch-list"));
  selectedVersionId = null;
  expandedReview = null;
  busy(true);
  try {
  const token = await storage.localFileSystem.createPersistentToken(folder);
  localStorage.setItem("photogit.projectFolderToken", token);
  try {
    await loadPairing();
    log(`Opened project ${folder.name}.`);
  } catch (error) {
    helperToken = null;
    show(`${error.message} Run PhotoGit setup for this folder, then choose it again.`, true);
  }
  await refreshWorkspace();
  queueAutomaticScan("project-connected", 150);
  } finally { busy(false); }
  await restorePanelState();
}

async function loadPairing() {
  if (!projectFolder) throw new Error("No project folder selected.");
  const folder = projectFolder;
  const photogit = await folder.getEntry(".photogit");
  const pairingFile = await photogit.getEntry("helper.json");
  const pairingText = await pairingFile.read();
  if (utf8ByteLength(pairingText) > 65_536) throw new Error("The project helper pairing file is too large.");
  const pairing = JSON.parse(pairingText);
  if (!isHelperRecord(pairing) || pairing.protocolVersion !== PROTOCOL_VERSION || typeof pairing.token !== "string" || !/^[A-Za-z0-9_-]{32,200}$/.test(pairing.token)) throw new Error("The project helper pairing is invalid.");
  if (projectFolder !== folder) throw new panelModel.StaleScanError();
  helperToken = pairing.token;
  await Promise.all([
    ensureFolder(folder, ".photogit/bridge/requests"),
    ensureFolder(folder, ".photogit/bridge/responses")
  ]);
}

async function refreshWorkspace(announceErrors = false, readTimeoutMs = HELPER_TIMEOUT_MS) {
  const generation = ++workspaceGeneration;
  const current = () => generation === workspaceGeneration;
  syncDocumentLabel();
  setTextWithFlash(document.getElementById("project-status"), projectFolder ? safeInlineText(projectFolder.name, 1_024) || "Unnamed project" : "No project selected");
  const ready = Boolean(projectFolder && helperToken);
  document.getElementById("onboarding").hidden = ready;
  document.getElementById("workspace").hidden = !ready;
  if (!projectFolder || !helperToken) {
    setHelper(projectFolder ? "Setup needed" : "Not connected", false);
    return;
  }
  try {
    const status = await callHelper("status", {}, HELPER_HEALTH_TIMEOUT_MS);
    if (!current()) return;
    // The helper answering is not the same as fresh data, and neither says
    // anything about a remote. The label names what is known: the project
    // data on screen was read at this time.
    setHelper("Updating…", true);
    await loadStatus(status);
    const [branches, history, reviews] = await Promise.all([callHelper("branches", {}, readTimeoutMs), callHelper("history", {}, readTimeoutMs), callHelper("reviews", {}, readTimeoutMs)]);
    if (!current()) return;
    await Promise.all([loadBranches(branches), loadHistory(history), loadReviews(reviews)]);
    if (!current()) return;
    setHelper(`Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, true);
  } catch (error) {
    if (!current() || error.name === "StaleScanError") return;
    setHelper("Not connected", false);
    document.getElementById("connection-message").textContent = `PhotoGit’s background service isn’t responding. Your saved versions are safe. Start the service for “${safeInlineText(projectFolder.name, 200)}”, then choose Reconnect.`;
    document.getElementById("setup-command-live").textContent = `npm run helper -- --approve-root "${projectFolder.nativePath || projectFolder.name}"`;
    log(`Refresh failed: ${error.message || String(error)}`);
    if (announceErrors) show(error.message || "PhotoGit could not refresh this project.", true);
  }
}

async function refreshAndScan() {
  closeToolsMenu();
  if (!ensureReady() || busyNow) return;
  await cancelScan();
  await refreshWorkspace(true);
  if (app.documents.length) return scanChanges({ automatic: false, eventName: "workspace-refresh" });
  show("Project refreshed. Open a Photoshop document to scan edits.", false);
}

async function loadStatus(existingResult) {
  const result = existingResult || await callHelper("status");
  projectStatus = result;
  setTextWithFlash(document.getElementById("branch-name"), result.branch);
  setSyncStatus(result.changeCount ? "Project files changed" : "Project files clean");
  renderDocumentBinding();
  if (result.changeCount) log(`${result.changeCount} project ${result.changeCount === 1 ? "file has" : "files have"} changed since the last saved version.`);
}

async function loadBranches(existingResult) {
  const folder = projectFolder;
  const result = existingResult || await callHelper("branches");
  if (folder !== projectFolder) return;
  setTextWithFlash(document.getElementById("branch-name"), result.current);
  setCount("branches-count", result.branches.length);
  const onSwitch = branch => {
    if (folder !== projectFolder) return show("The project changed. Refresh the branch list before switching.", true);
    return executeCommand(`switch ${branch}`);
  };
  branchView.render(document.getElementById("branch-list"), { branches: result.branches, current: result.current, previews: branchPreviews, onSwitch });
  // Previews are decorative. Load them in the background so the branch list stays
  // immediately usable and a slow or missing preview never delays switching.
  void loadBranchPreviews(folder, result, onSwitch);
}

async function loadBranchPreviews(folder, result, onSwitch) {
  const pending = result.branches.filter(branch => /^[a-f0-9]{40,64}$/.test(branch.tip || "") && !(branch.name in branchPreviews)).slice(0, MAX_BRANCH_PREVIEWS);
  if (!pending.length) return;
  let loaded = 0;
  for (const branch of pending) {
    const preview = await readVersionPreview(branch.tip);
    if (folder !== projectFolder) return;
    branchPreviews[branch.name] = preview ? preview.src : null;
    if (preview) loaded += 1;
  }
  if (!loaded || folder !== projectFolder) return;
  branchView.render(document.getElementById("branch-list"), { branches: result.branches, current: result.current, previews: branchPreviews, onSwitch });
}

async function loadHistory(existingResult) {
  const result = existingResult || await callHelper("history");
  historyEntries = result.versions;
  setCount("history-count", historyEntries.length);
  const branch = safeInlineText(document.getElementById("branch-name").textContent, 200);
  document.getElementById("history-total").textContent = `${historyEntries.length} ${historyEntries.length === 1 ? "version" : "versions"}${branch && branch !== "—" ? ` on ${branch}` : ""}`;
  // The newest version is selected until another is chosen, and again
  // whenever a newer one arrives.
  const newest = historyEntries.length ? historyEntries[0].id : null;
  if (newest !== newestVersionId || !historyEntries.some(version => version.id === selectedVersionId)) selectedVersionId = newest;
  newestVersionId = newest;
  filterHistory();
  void loadHistoryPreviews(result.versions);
}

async function loadHistoryPreviews(versions) {
  const generation = ++historyPreviewGeneration;
  const folder = projectFolder;
  historyPreviews = {};
  // Bound image memory and helper work. Any selected older version still loads
  // its own preview in the inspector, independently of this thumbnail strip.
  for (const version of versions.slice(0, 8)) {
    const preview = await readVersionPreview(version.id);
    if (folder !== projectFolder || generation !== historyPreviewGeneration) return;
    historyPreviews[version.id] = preview;
    for (const row of document.querySelectorAll(".history-row")) {
      if (row.dataset.version === version.id) versionInspector.historyPreview(row, { preview });
    }
  }
}

async function loadReviews(existingResult) {
  const result = existingResult || await callHelper("reviews");
  repositoryDetails = result.repository;
  for (const id of ["new-pull-request", "tool-new-pr"]) document.getElementById(id).hidden = result.repository.provider !== "github";
  reviewEntries = result.reviews.filter((review) => review.ahead > 0 || review.changeCount > 0);
  // The tab badge counts what needs action: branches that cannot merge yet.
  const blocked = reviewEntries.filter(review => review.mergeable !== true).length;
  setCount("reviews-count", blocked);
  const waiting = reviewEntries.length;
  document.getElementById("reviews-heading").textContent = waiting ? `${waiting} ${waiting === 1 ? "branch" : "branches"} waiting to merge` : "Nothing waiting to merge";
  document.getElementById("review-provider").textContent = `Into ${result.repository.currentBranch}.${!waiting || !blocked ? "" : blocked === waiting ? (waiting === 1 ? " It has conflicts to resolve first." : " Each one has conflicts to resolve first.") : ` ${blocked} ${blocked === 1 ? "has" : "have"} conflicts to resolve first.`}`;
  if (!reviewEntries.some(review => review.branch === expandedReview)) expandedReview = null;
  renderReviews(reviewEntries, result.conflicts || []);
}

function renderReviews(reviews, conflicts) {
  const container = document.getElementById("reviews");
  const empty = document.getElementById("reviews-empty");
  container.innerHTML = "";
  empty.hidden = reviews.length > 0;
  for (const review of reviews) container.appendChild(reviewInspector.card(document, review, { expanded: review.branch === expandedReview, onToggle: toggleReview }));
  const reveal = globalThis.PhotoGitReveal;
  if (reveal && typeof reveal.stagger === "function") reveal.stagger(container.querySelectorAll(".review-card"));
  const conflictPanel = document.getElementById("conflict-panel");
  conflictPanel.hidden = conflicts.length === 0;
  const visibleConflicts = conflicts.slice(0, MAX_VISIBLE_CONFLICTS);
  document.getElementById("conflicts").textContent = conflicts.length
    ? `${visibleConflicts.join("\n")}${conflicts.length > visibleConflicts.length ? `\n… ${conflicts.length - visibleConflicts.length} more conflicts not shown.` : ""}`
    : "";
}

// One review is open at a time. Opening reads both branches again, so the
// card never shows conflicts from an earlier state of either branch.
function toggleReview(branch) {
  const folder = projectFolder;
  expandedReview = expandedReview === branch ? null : branch;
  renderReviews(reviewEntries, []);
  const card = [...document.querySelectorAll("#reviews .review-card")].find(entry => entry.dataset.branch === branch);
  if (!expandedReview) { card?.querySelector(".review-toggle")?.focus(); return; }
  const body = card?.querySelector(".review-body");
  if (body) globalThis.PhotoGitMotion?.expand(body);
  return run("Reading both branches…", async () => {
    let comparison;
    try { comparison = await callHelper("compareBranches", { branch }); }
    catch (error) { if (folder === projectFolder && expandedReview === branch) { expandedReview = null; renderReviews(reviewEntries, []); } throw error; }
    if (folder !== projectFolder || expandedReview !== branch) return;
    const open = [...document.querySelectorAll("#reviews .review-card.expanded")].find(entry => entry.dataset.branch === branch);
    if (!open) return;
    const conflicts = reviewInspector.resolution(open.querySelector(".review-body"), comparison, {
      onMerge: incoming => folder !== projectFolder ? show("The project changed. Review this branch again.", true) : mergeReview(incoming),
      onDetails: compareBranch
    });
    const label = open.querySelector(".review-state-label");
    if (label && conflicts) label.textContent = `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`;
    show(conflicts ? `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"} on ${branch}.` : `${branch} has no conflicts.`, false);
  });
}

function renderHistory(versions) {
  const container = document.getElementById("history");
  const empty = document.getElementById("history-empty");
  container.innerHTML = "";
  empty.hidden = versions.length > 0;
  // The panel is not told who the current user is, so the author is shown
  // only where it carries information: when the history has more than one.
  const severalAuthors = new Set(historyEntries.map(version => version.author)).size > 1;
  const latestId = historyEntries.length ? historyEntries[0].id : null;
  for (const group of groupHistory(versions)) {
    const section = document.createElement("section");
    section.className = "history-group";
    section.innerHTML = `<h3 class="list-section"><span>${escapeHtml(String(group.label).toUpperCase())}</span><span class="history-author">${severalAuthors ? escapeHtml(group.author) : ""}</span></h3><div class="history-group-entries"></div>`;
    const entries = section.querySelector(".history-group-entries");
    for (const version of group.entries) {
      const selected = version.id === selectedVersionId;
      const entry = document.createElement("div");
      entry.className = `history-entry${selected ? " selected" : ""}`;
      const row = document.createElement("div");
      row.className = "list-row history-row";
      row.dataset.version = version.id;
      const message = escapeHtml(version.message);
      const shortId = escapeHtml(version.shortId);
      row.innerHTML = `<span class="history-marker" aria-hidden="true">${historyIcon()}</span><span class="row-copy"><strong>${message}</strong><span class="history-meta"><time datetime="${escapeHtml(version.date)}" title="${escapeHtml(versionInspector.formatDate(version.date))}">${escapeHtml(versionInspector.formatDate(version.date, true))}</time>  ${shortId}</span></span>${selected && version.id === latestId ? '<span class="pill">Latest</span>' : ""}`;
      versionInspector.historyPreview(row, { preview: historyPreviews[version.id] });
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", String(selected));
      row.setAttribute("aria-label", `Select version ${version.shortId}: ${version.message}`);
      row.tabIndex = 0;
      const choose = () => { selectVersion(version.id); document.querySelector("#history .history-entry.selected .history-row")?.focus(); };
      row.addEventListener("click", choose);
      activateOnKeyboard(row, choose);
      entry.appendChild(row);
      if (selected) entry.appendChild(historyActions(version));
      entries.appendChild(entry);
    }
    container.appendChild(section);
  }
  const reveal = globalThis.PhotoGitReveal;
  if (reveal && typeof reveal.stagger === "function") reveal.stagger(container.querySelectorAll(".history-entry"));
}

// The selected version carries its two actions; no version is acted on
// without first being the one that is visibly selected.
function historyActions(version) {
  const actions = document.createElement("div");
  actions.className = "history-actions";
  const button = (label, className, name, handler) => {
    const control = document.createElement("div");
    control.className = `button ${className}`;
    control.textContent = label;
    control.setAttribute("role", "button");
    control.setAttribute("aria-label", name);
    control.tabIndex = 0;
    const invoke = () => { if (control.getAttribute("aria-disabled") !== "true" && !busyNow) handler(); };
    control.addEventListener("click", invoke);
    activateOnKeyboard(control, invoke);
    actions.appendChild(control);
  };
  button("View changes", "button-primary", `View what version ${version.shortId} changed`, () => inspectVersion(version));
  const folder = projectFolder;
  button("Restore", "", `Restore version ${version.shortId} as a separate copy`, () => restoreVersion(version, folder));
  return actions;
}

function groupHistory(versions) {
  return panelModel.groupHistory(versions, historyDateLabel);
}

function historyDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || "Unknown date";
  const now = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = Math.round((today - day) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function filterHistory() {
  const query = document.getElementById("history-search").value.trim().toLowerCase();
  // An empty list means two different things: nothing saved yet, or nothing
  // matching the search. Each gets its own explanation and next step.
  const filtering = Boolean(query) && historyEntries.length > 0;
  document.getElementById("history-empty-title").textContent = filtering ? "No matching versions" : "No saved versions yet";
  document.getElementById("history-empty-copy").textContent = filtering
    ? "Search by message, author, date, or version ID, or clear the search."
    : "Save your first version to start this document’s history.";
  if (!query) return renderHistory(historyEntries);
  renderHistory(historyEntries.filter((version) => [version.message, version.shortId, version.author, version.date].some((value) => String(value).toLowerCase().includes(query))));
}

async function scanChanges({ automatic = false, eventName = "manual" } = {}) {
  if (!projectFolder || !helperToken || !app.documents.length) return;
  if (busyNow) return queueAutomaticScan(eventName, 900);
  if (!documentAllowed()) { renderDocumentBinding(); return; }
  clearTimeout(autoScanTimer);
  autoScanTimer = null;
  return scans.request(async (checkGeneration) => {
    checkGeneration();
    if (!app.documents.length) throw new panelModel.StaleScanError();
    const doc = app.activeDocument;
    const folder = projectFolder;
    const identity = panelModel.documentIdentity(doc);
    const historyState = historyStateId(doc);
    const check = () => {
      checkGeneration();
      if (projectFolder !== folder || !app.documents.length || app.activeDocument.id !== doc.id || historyStateId(doc) !== historyState) throw new panelModel.StaleScanError();
    };
    document.getElementById("cancel-scan").hidden = false;
    try {
      setWatchStatus("Reading layers…", "scanning");
      let capture;
      suppressNotifications = true;
      try {
        capture = await core.executeAsModal(async (executionContext) => captureDocument(doc, {
          check: () => { check(); if (executionContext?.isCancelled) throw new panelModel.StaleScanError(); },
          progress: (done, total) => setWatchStatus(`Reading layer ${done} of ${total}…`, "scanning")
        }), { commandName: "Scan PhotoGit document layers" });
      } finally { suppressNotifications = false; }
      check();
      runtimeLog("info", "scan_capture", { source: automatic ? "automatic" : "manual", eventName, layerCount: capture.layers.length });
      log(`Read ${capture.layers.length} ${capture.layers.length === 1 ? "layer" : "layers"} and compared them with the last saved version.`);
      setWatchStatus(`Comparing ${capture.layers.length} layers…`, "scanning");
      const result = await callHelper("refresh", { capture, documentIdentity: identity }, 15000);
      check();
      renderChanges(result.changes, { baselineMissing: result.baselineMissing === true, changeCount: result.changeCount, warnings: result.comparisonWarnings || [] });
      const firstCheckpoint = result.baselineMissing === true;
      setWatchStatus(firstCheckpoint ? "Ready for first version" : result.changeCount ? `${result.changeCount} edits found` : "Watching Photoshop", firstCheckpoint || result.changeCount ? "changed" : "ready");
      log(firstCheckpoint ? "Ready to save the first version." : `${result.changeCount} unsaved ${result.changeCount === 1 ? "edit" : "edits"} found.`);
      if (!automatic) show(firstCheckpoint ? "Save the first version to start tracking edits." : `${result.changeCount} Photoshop edits found.`, false);
    } catch (error) {
      if (error.name === "StaleScanError") throw error;
      lastScanCount = null;
      setWatchStatus("Scan incomplete · Retry", "error");
      document.getElementById("change-summary").textContent = "Scan needs attention";
      document.getElementById("last-scan").textContent = error.message || String(error);
      runtimeLog("error", "scan_failed", { source: automatic ? "automatic" : "manual", eventName, message: error.message || String(error) });
      show(error.message || String(error), true);
    } finally {
      document.getElementById("cancel-scan").hidden = true;
    }
  });
}

function cancelScan(announce = true) {
  clearTimeout(autoScanTimer);
  autoScanTimer = null;
  scans.cancel();
  if (announce) setWatchStatus("Scan paused · Scan now to resume", "warning");
  return scans.running || Promise.resolve();
}

function historyStateId(doc) { try { return doc.activeHistoryState?.id ?? null; } catch { return null; } }

function documentAllowed() {
  if (!app.documents.length || !projectStatus) return false;
  return projectStatus.baselineMissing && !projectStatus.documentBinding || panelModel.sameDocument(projectStatus.documentBinding, panelModel.documentIdentity(app.activeDocument));
}

// A document that is not the project's takes over the panel below the top
// bar: there is nothing to list, save or review until that is settled.
function renderDocumentBinding() {
  const allowed = documentAllowed();
  document.getElementById("workspace").classList.toggle("is-unlinked", !allowed);
  applyShellState();
  const project = safeInlineText(projectFolder?.name || document.getElementById("project-status").textContent, 200) || "this project";
  const open = app.documents.length > 0;
  const binding = projectStatus?.documentBinding;
  document.getElementById("document-connection-title").textContent = !open
    ? "No document is open"
    : `This document isn’t linked to ${project}`;
  document.getElementById("document-connection-message").textContent = !open
    ? "Open a Photoshop document or open this project’s saved version."
    : binding
      ? `This document is not connected. Project document: ${safeInlineText(binding.name, 200)}. PhotoGit only tracks the project’s own document, so changes here won’t be saved as versions.`
      : "Connect this document before comparing it with the project’s saved versions.";
  document.getElementById("project-document-name").textContent = binding ? safeInlineText(binding.name, 200) : projectStatus && !projectStatus.baselineMissing ? "The saved project version" : "Not chosen yet";
  document.getElementById("connect-document").hidden = !open;
  document.getElementById("open-project-document").hidden = !projectStatus || projectStatus.baselineMissing;
  if (!allowed) {
    lastScanCount = null;
    document.getElementById("changes").innerHTML = "";
    document.getElementById("change-summary").textContent = "Connect a document";
    document.getElementById("last-scan").textContent = "No scan result for this document.";
    // The card says why it is empty rather than standing blank.
    setChangesEmpty("No document connected", "Connect this document to see its edits here.");
    document.getElementById("changes-empty").hidden = false;
    setCount("changes-count", 0);
    // The filter bar describes the list that was just cleared; leaving it up
    // reported the previous document's counts against this one.
    workspaceUI.refreshChanges(document);
  }
}

// Which parts of the shell are showing follows from two facts: the section
// in view and whether the open document is the project's. They are set as
// `hidden` here because the host does not reliably restyle descendants when
// only an ancestor's attribute changes.
// The underline belongs to the strip, not to a tab, so it can travel.
function placeTabIndicator() {
  const indicator = document.getElementById("tab-indicator");
  const active = document.querySelector("#section-nav .nav-item.active:not([hidden])");
  const motion = globalThis.PhotoGitMotion;
  if (!indicator) return;
  if (!active || document.getElementById("section-nav").hidden) { indicator.hidden = true; return; }
  if (motion && typeof motion.slide === "function") motion.slide(indicator, active);
}

function applyShellState() {
  const workspace = document.getElementById("workspace");
  const view = workspace.dataset.view;
  const unlinked = workspace.classList.contains("is-unlinked");
  // Docs stay readable from the menu whatever document is open.
  const takeover = unlinked && view !== "docs";
  const state = document.getElementById("document-connection");
  const changed = state.hidden === takeover;
  state.hidden = !takeover;
  document.getElementById("section-nav").hidden = takeover;
  document.querySelector(".workspace-content").hidden = takeover;
  document.getElementById("push").hidden = unlinked;
  document.querySelector(".capture-panel").hidden = view !== "changes";
  document.getElementById("history-total").hidden = view !== "history";
  // Linked to not linked and back is a change of screen like any other.
  if (changed && !document.body.classList.contains("is-initializing")) globalThis.PhotoGitMotion?.screen(takeover ? state : document.querySelector(".workspace-content"));
}

function connectDocument() {
  if (!ensureReady() || !app.documents.length) return;
  const doc = app.activeDocument;
  const folder = projectFolder;
  openDetail("Connect this document?", `Adopt “${doc.name}” as the document for “${folder.name}”. The next saved version will use this document. Existing versions remain in history.`, "Connect document", () => run("Connecting document…", async () => {
    if (projectFolder !== folder || app.activeDocument?.id !== doc.id) throw new Error("The active document or project changed. Connect again.");
    await callHelper("connectDocument", { documentIdentity: panelModel.documentIdentity(doc), adopt: true });
    closeDetail();
    await refreshWorkspace();
    queueAutomaticScan("document-connected", 100);
    show(`Connected document “${safeInlineText(doc.name, 200)}”. Scanning for changes.`, false);
  }));
}

async function reconnectHelper() {
  if (busyNow) return show("PhotoGit is busy. Try again in a moment.", false);
  if (!projectFolder) return chooseProject();
  // The header dot breathes while the reconnect is in flight.
  const status = document.getElementById("helper-status");
  status.classList.add("is-reconnecting");
  try { await loadPairing(); await refreshWorkspace(true); if (helperOnline) { show("Connected.", false); queueAutomaticScan("reconnected", 100); } }
  catch (error) { show(`${error.message} Finish setup for this project, then choose Reconnect.`, true); }
  finally { status.classList.remove("is-reconnecting"); }
}

async function saveVersion() {
  const message = document.getElementById("message").value.trim();
  if (!ensureReady()) return;
  if (!app.documents.length) return show("Open a Photoshop document first.", true);
  if (!message) { document.getElementById("message").focus(); return show("Describe what changed before saving this version.", true); }
  if (!documentAllowed()) { renderDocumentBinding(); return show("Connect the correct document before saving a version.", true); }
  const doc = app.activeDocument;
  const folder = projectFolder;
  const identity = panelModel.documentIdentity(doc);
  const assertSaveTarget = () => {
    if (projectFolder !== folder || app.activeDocument?.id !== doc.id || !documentAllowed()) {
      throw new Error("The document or project changed. No version was written. Select the intended document and save again.");
    }
  };

  return run("Saving exact PSD and preview…", async () => {
    assertSaveTarget();
    const incoming = await ensureFolder(folder, ".photogit/incoming");
    const snapshot = await incoming.createFile("document.psd", { overwrite: true });
    const preview = await incoming.createFile("document.png", { overwrite: true });
    assertSaveTarget();
    let capture;
    suppressNotifications = true;
    try {
    await core.executeAsModal(async (executionContext) => {
      assertSaveTarget();
      const check = () => { assertSaveTarget(); if (executionContext?.isCancelled) throw new Error("Version capture cancelled. No version was written."); };
      // Capture and PSD export share the same modal lock: they describe one state.
      capture = await captureDocument(doc, { check, progress: (done, total) => setWatchStatus(`Saving · reading ${done} of ${total}…`, "scanning") });
      await doc.saveAs.psd(snapshot, { embedColorProfile: true }, true);
      check();
      await saveVersionPreview(doc, preview, check);
    }, { commandName: "Save PhotoGit version artifacts" });
    } finally { suppressNotifications = false; }
    if (projectFolder !== folder || app.activeDocument?.id !== doc.id) throw new Error("Document changed before save completed. No version was written.");
    const result = await callHelper("capture", {
      message,
      snapshotPath: snapshot.nativePath,
      previewPath: preview.nativePath,
      capture,
      documentIdentity: identity
    });
    document.getElementById("message").value = "";
    savePanelState();
    renderChanges([]);
    setWatchStatus("Watching Photoshop", "ready");
    log(`Saved ${result.shortId}: ${message}`);
    show(`Saved version ${result.shortId}.`, false);
    await Promise.all([loadStatus(), loadBranches(), loadHistory(), loadReviews()]);
    // The version just saved heads History; it glows once as the section
    // opens so the eye lands on it.
    document.querySelector("#history .history-row")?.classList.add("is-new");
    selectTab("history");
  });
}

async function saveVersionPreview(doc, destination, check) {
  let imageData;
  try {
    const width = number(doc.width), height = number(doc.height);
    const targetSize = width >= height ? { width: Math.min(768, width) } : { height: Math.min(768, height) };
    const pixels = await imaging.getPixels({ documentID: doc.id, sourceBounds: { left: 0, top: 0, right: width, bottom: height }, targetSize, componentSize: 8, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1", applyAlpha: false });
    imageData = pixels.imageData;
    check();
    const data = await imageData.getData({ chunky: true });
    const png = encodePreviewPng(imageData.width, imageData.height, imageData.components, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    await destination.write(png.buffer, { format: storage.formats.binary });
    check();
  } finally { try { imageData?.dispose(); } catch { /* Already released by Photoshop. */ } }
}

async function pull() {
  if (!ensureReady()) return;
  return working("pull", () => run("Getting shared changes…", async () => {
    const result = await callHelper("pull");
    if (!await openAfterGit(`Pulled ${result.branch}`)) return;
    log(`Pulled ${result.branch} and opened its saved PSD version.`);
    await refreshWorkspace();
    setSyncStatus("Pulled shared changes");
    show(`Pulled ${result.branch} successfully.`, false);
  }));
}

async function push() {
  if (!ensureReady()) return;
  return working("push", () => run("Sharing versions…", async () => {
    const result = await callHelper("push");
    log(`Shared branch ${result.branch}.`);
    setSyncStatus("Pushed saved versions");
    await loadReviews();
    show("Changes shared successfully.", false);
  }));
}

async function showProjectStatus() {
  if (!ensureReady()) return;
  return working("show-status", () => run("Checking project…", async () => {
    const result = await callHelper("status");
    log(`${result.branch}: ${result.changeCount ? `${result.changeCount} project ${result.changeCount === 1 ? "file" : "files"} changed since the last saved version` : "nothing changed since the last saved version"}.`);
    setSyncStatus(result.changeCount ? "Project files changed" : "Project files clean");
    show(result.changeCount ? "Project files have unsaved changes." : "Project is clean.", result.changeCount > 0);
  }));
}

async function createBranch() {
  if (!ensureReady()) return;
  const input = document.getElementById("new-branch-name");
  const name = input.value.trim();
  if (!name) { input.focus(); return show("Enter a branch name, such as hero-option-b.", true); }
  return run("Creating branch…", async () => {
    await callHelper("createBranch", { branch: name });
    input.value = "";
    log(`Created and switched to ${name}.`);
    await Promise.all([loadBranches(), loadReviews()]);
    show(`Created branch ${name}.`, false);
  });
}

async function mergeReview(branch) {
  if (!ensureReady()) return;
  return run("Reviewing merge…", async () => {
    const comparison = await callHelper("compareBranches", { branch });
    const summary = comparison.changes.slice(0, 100).map(change => change.summary).join("\n") || "No layer changes recorded.";
    openDetail(comparison.gitMergeable ? "Combine this branch?" : "Can’t combine yet", `Into: ${comparison.baseBranch}\nFrom: ${comparison.incomingBranch}\n\n${summary}\n\n${fileSummary(comparison.files)}\n\n${comparison.conflicts.join("\n")}\n${comparison.warnings.join("\n")}\n\nCombining keeps every saved version from both branches. It doesn’t blend layers, so review the result in Photoshop. Your open document stays open.`, comparison.gitMergeable ? "Combine branch" : "", comparison.gitMergeable ? () => {
      closeDetail();
      return performMerge(branch, comparison.baseBranch);
    } : null);
  });
}

async function performMerge(branch, expectedBase = null) {
  return run(`Merging ${branch}…`, async () => {
    if (expectedBase) {
      const status = await callHelper("status");
      if (status.branch !== expectedBase) { await refreshWorkspace(); throw new Error("The base branch changed. Review the comparison again before merging."); }
    }
    await callHelper("mergeBranch", { branch });
    if (!await openAfterGit(`Merged ${branch}`)) return;
    log(`Merged ${branch} into ${document.getElementById("branch-name").textContent}.`);
    await refreshWorkspace();
    selectTab("history");
    show(`Merged ${branch} and opened the resulting PSD version.`, false);
  });
}

async function openPullRequest() {
  closeToolsMenu();
  if (!ensureReady()) return;
  return run("Preparing GitHub comparison…", async () => {
    const result = await callHelper("pullRequestLink", { base: repositoryDetails?.baseBranch });
    const error = await shell.openExternal(result.url, "PhotoGit is opening GitHub so you can review and submit this pull request.");
    if (error) throw new Error(error);
    log(`Opened a GitHub comparison from ${repositoryDetails?.currentBranch || "the current branch"}.`);
    show("Opened GitHub comparison. Submit a pull request there when ready.", false);
  });
}

function openHistorySearch() {
  selectTab("history");
  document.getElementById("history-search").focus();
}

function toggleToolsMenu(event) {
  const menu = document.getElementById("tools-menu");
  if (menu.hidden || menu.classList.contains("is-closing")) {
    closeSurface(document.getElementById("tag-sheet"), true);
    closeBackdrop(true);
    surfaceReturnFocus = event?.currentTarget || document.activeElement;
    menu.classList.toggle("from-header", event?.currentTarget?.id === "header-menu");
    openSurface(menu);
    // The items step in behind the menu's own rise; the first one takes
    // focus on the next tick regardless of where the stagger is.
    const reveal = globalThis.PhotoGitReveal;
    if (reveal && typeof reveal.stagger === "function") reveal.stagger(menu.querySelectorAll(".tool-item:not([hidden])"));
    document.body.classList.add("has-surface");
    setToolsExpanded(true);
    setTimeout(() => menu.querySelector(".tool-item")?.focus(), 0);
  } else {
    closeToolsMenu(false, true);
  }
}

function closeToolsMenu(immediate = false, returnFocus = false) {
  closeSurface(document.getElementById("tools-menu"), immediate);
  document.body.classList.remove("has-surface");
  setToolsExpanded(false);
  if (returnFocus && surfaceReturnFocus?.focus) surfaceReturnFocus.focus();
}

function openNewBranch() {
  closeToolsMenu();
  selectTab("branches");
  document.getElementById("new-branch-name").focus();
}

async function openConflicts() {
  closeToolsMenu();
  selectTab("reviews");
  if (!ensureReady()) return;
  return run("Checking conflicts…", async () => {
    await loadReviews();
    const panel = document.getElementById("conflict-panel");
    show(panel.hidden ? "No unresolved merge conflicts." : "Review the conflicting project files below.", !panel.hidden);
  });
}

function openTagSheet() {
  closeToolsMenu();
  openBackdrop();
  openSurface(document.getElementById("tag-sheet"));
  document.getElementById("tag-name").focus();
}

function closeTagSheet(immediate = false, returnFocus = false) {
  closeSurface(document.getElementById("tag-sheet"), immediate);
  closeBackdrop(immediate);
  if (returnFocus && surfaceReturnFocus?.focus) surfaceReturnFocus.focus();
}

function openBackdrop() {
  document.body.classList.add("has-surface");
  const backdrop = document.getElementById("surface-backdrop");
  clearTimeout(surfaceTimers.get(backdrop));
  globalThis.PhotoGitMotion?.cancel(backdrop);
  backdrop.hidden = false;
  backdrop.classList.remove("is-open");
  void backdrop.offsetWidth;
  backdrop.classList.add("is-open");
}

function closeBackdrop(immediate = false) {
  const backdrop = document.getElementById("surface-backdrop");
  clearTimeout(surfaceTimers.get(backdrop));
  backdrop.classList.remove("is-open");
  globalThis.PhotoGitMotion?.cancel(backdrop);
  const finish = () => { backdrop.hidden = true; document.body.classList.remove("has-surface"); };
  if (immediate || !globalThis.PhotoGitMotion?.exit) finish();
  else globalThis.PhotoGitMotion.exit(backdrop, finish);
}

function setToolsExpanded(expanded) {
  document.getElementById("header-menu").setAttribute("aria-expanded", expanded ? "true" : "false");
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
  const finish = () => {
    element.classList.remove("is-closing");
    element.hidden = true;
  };
  if (globalThis.PhotoGitMotion?.exit) globalThis.PhotoGitMotion.exit(element, finish);
  else finish();
}

async function createTag() {
  const input = document.getElementById("tag-name");
  const tag = input.value.trim();
  if (!tag) { input.focus(); return show("Enter a tag such as v1.0.0.", true); }
  return run(`Creating ${tag}…`, async () => {
    await callHelper("createTag", { tag });
    input.value = "";
    closeTagSheet(false, true);
    await loadReviews();
    log(`Created repository tag ${tag}.`);
    show(`Created tag ${tag}.`, false);
  });
}

function openRepositorySettings() {
  closeToolsMenu();
  const provider = repositoryDetails?.provider || "unknown";
  const remote = repositoryDetails?.remoteConfigured ? "Remote configured" : "No remote configured";
  openDetail("Project information", `Project: ${projectFolder?.nativePath || "Not connected"}\nBackground service: ${helperOnline ? "Connected" : "Not connected"}\nSharing: ${provider}\n${remote}\n\nFirst-time setup (run once in Terminal, from the PhotoGit folder):\nnpm run photogit -- init "/path/to/project"\nnpm run helper -- --approve-root "/path/to/project"\n\nTo keep PhotoGit docked, drag its panel tab next to Photoshop’s toolbar and let go when a highlight appears.`, "Choose project", () => { closeDetail(); return chooseProject(); });
}

async function openSnapshot(version = "HEAD", rebind = true) {
  const result = await callHelper("openVersion", { version });
  const snapshot = await projectFolder.getEntry(result.snapshotPath);
  let doc;
  suppressNotifications = true;
  try { doc = await core.executeAsModal(() => app.open(snapshot), { commandName: "Open PhotoGit version copy" }); }
  finally { suppressNotifications = false; }
  if (rebind) await callHelper("connectDocument", { documentIdentity: panelModel.documentIdentity(doc || app.activeDocument), adopt: true });
  await refreshWorkspace();
  queueAutomaticScan("version-opened", 150);
}

async function openAfterGit(description) {
  try { await openSnapshot(); return true; }
  catch (error) {
    await refreshWorkspace();
    log(`${description}; Git completed, but Photoshop could not open the saved PSD: ${error.message}`);
    openDetail("Git updated; document not opened", `${description}. Your repository has changed, but Photoshop did not open its PSD. Your previous document is still open. Do not repeat the Git operation.\n\n${error.message}`, "Retry opening PSD", () => run("Opening saved PSD…", async () => { await openSnapshot(); closeDetail(); }));
    return false;
  }
}

function openDetail(title, content, actionLabel = "", action = null) {
  closeToolsMenu(true);
  surfaceReturnFocus = document.activeElement;
  document.getElementById("detail-title").textContent = title;
  const details = document.getElementById("detail-content");
  details.textContent = content; details.className = "detail-content";
  for (const attribute of ["role", "aria-label", "aria-busy", "data-state", "data-mergeable"]) details.removeAttribute(attribute);
  const button = document.getElementById("detail-action");
  button.hidden = !action;
  button.textContent = actionLabel;
  detailAction = action;
  openBackdrop();
  openSurface(document.getElementById("detail-sheet"));
  document.getElementById("close-detail").focus();
}

function closeDetail(immediate = true) {
  closeSurface(document.getElementById("detail-sheet"), immediate);
  closeBackdrop(immediate);
  detailAction = null;
  surfaceReturnFocus?.focus?.();
}

// Version details always open in the dialog: the panel is one column, so a
// version is read on its own rather than beside the list.
function inspectVersion(version) {
  return run("Loading version…", async () => {
    const folder = projectFolder;
    const details = await callHelper("versionDetails", { version: version.id });
    if (folder !== projectFolder) return;
    // A missing or unreadable preview must never block the version details.
    const [preview, previousPreview] = await Promise.all([
      readVersionPreview(version.id),
      details.parentVersionId ? readVersionPreview(details.parentVersionId) : Promise.resolve(null)
    ]);
    if (folder !== projectFolder) return;
    selectVersion(version.id);
    openDetail(`Version ${version.shortId || version.id.slice(0, 8)}`, "", details.snapshotAvailable ? "Open version copy" : "", details.snapshotAvailable ? () => restoreVersion(version, folder) : null);
    versionInspector.render(document.getElementById("detail-content"), { details, version, preview, previousPreview });
  });
}

// "Restore" never overwrites the open document: it opens the saved PSD as a
// separate copy, which can then be saved as a new version.
// `folder` is the project the version was shown for: an action left on screen
// from one project must not open a file in another.
function restoreVersion(version, folder) {
  return run("Opening version copy…", async () => {
    if (folder !== projectFolder) throw new Error("The project changed. Select this version again.");
    await openSnapshot(version.id, false);
    closeDetail();
    show("Opened a version copy. Connect it explicitly to save it as a new version.", false);
  });
}

function selectVersion(versionId) {
  if (selectedVersionId === versionId) return;
  selectedVersionId = versionId;
  savePanelState();
  filterHistory();
  // The selected card's actions ease into place; its height is not animated.
  const actions = document.querySelector("#history .history-entry.selected .history-actions");
  if (actions) globalThis.PhotoGitMotion?.expand(actions);
}

// Saved previews are optional: older versions predate them and a project may not
// commit one. Any failure degrades to the metadata inspector rather than an error.
const MAX_BRANCH_PREVIEWS = 12;
let branchPreviews = {};

async function readVersionPreview(versionId) {
  try {
    const result = await callHelper("versionPreview", { version: versionId });
    if (!result || result.available !== true || typeof result.png !== "string") return null;
    return { src: `data:${result.contentType === "image/jpeg" ? "image/jpeg" : "image/png"};base64,${result.png}` };
  } catch { return null; }
}

// The full comparison (every incoming edit and file) opens in the dialog.
function compareBranch(branch) {
  return run("Comparing branches…", async () => {
    const folder = projectFolder;
    const result = await callHelper("compareBranches", { branch });
    if (folder !== projectFolder) return;
    const review = incoming => {
      if (folder !== projectFolder) return show("The project changed. Compare this branch again.", true);
      return mergeReview(incoming);
    };
    openDetail("Compare branches", "");
    reviewInspector.render(document.getElementById("detail-content"), { comparison: result, onMerge: review, previews: branchPreviews });
  });
}

function fileSummary(files) { return files.map(file => `${file.status} ${file.path}`).join("\n"); }

async function callHelper(operation, fields = {}, timeoutMs = HELPER_TIMEOUT_MS) {
  if (!helperToken) throw new Error("This project is not paired with the PhotoGit helper.");
  if (!projectFolder?.nativePath) throw new Error("PhotoGit cannot resolve the selected project folder on this computer.");
  const requestId = createRequestId();
  const folder = projectFolder;
  const token = helperToken;
  const requests = await ensureFolder(folder, ".photogit/bridge/requests");
  const responses = await ensureFolder(folder, ".photogit/bridge/responses");
  const request = { protocolVersion: PROTOCOL_VERSION, operation, requestId, projectRoot: folder.nativePath, ...fields };
  const requestText = `${JSON.stringify({ token, expiresAt: Date.now() + timeoutMs, request })}\n`;
  if (utf8ByteLength(requestText) > MAX_HELPER_IO_BYTES) throw new Error("This document’s layer metadata is too large for the 5 MB bridge limit. Reduce the layer count or unusually large text content and try again. No version was saved.");
  const requestFile = await requests.createFile(`${requestId}.json`, { overwrite: true });
  await requestFile.write(requestText);
  const readyFile = await requests.createFile(`${requestId}.ready`, { overwrite: true });
  await readyFile.write("ready\n");

  const deadline = Date.now() + timeoutMs;
  let responseFile = null;
  while (Date.now() < deadline) {
    try {
      await responses.getEntry(`${requestId}.ready`);
      responseFile = await responses.getEntry(`${requestId}.json`);
      break;
    } catch {
      await delay(125);
    }
  }
  if (!responseFile) {
    await Promise.all([
      removeEntry(requests, `${requestId}.ready`),
      removeEntry(requests, `${requestId}.json`),
      removeEntry(responses, `${requestId}.ready`),
      removeEntry(responses, `${requestId}.json`)
    ]);
    const error = new Error("The PhotoGit helper is offline or did not answer in time.");
    if (["capture", "switchBranch", "createBranch", "pull", "push", "mergeBranch", "createTag", "connectDocument"].includes(operation)) {
      error.details = { outcome: "recovery_required", outcomeUnknown: true, operation };
      error.message = `No response to ${operation}. The operation may already have completed. Reconnect and inspect the branch and history before retrying.`;
    }
    throw error;
  }
  let responseText;
  try {
    responseText = await responseFile.read();
    if (utf8ByteLength(responseText) > MAX_HELPER_IO_BYTES) throw new Error("The PhotoGit helper response exceeded the safe size limit.");
  } finally {
    await Promise.all([removeEntry(responses, `${requestId}.ready`), removeEntry(responses, `${requestId}.json`)]);
  }
  const body = JSON.parse(responseText);
  if (projectFolder !== folder || helperToken !== token) throw new panelModel.StaleScanError();
  if (!isHelperRecord(body) || body.protocolVersion !== PROTOCOL_VERSION || body.requestId !== requestId || typeof body.ok !== "boolean") throw new Error("The PhotoGit helper returned an invalid response.");
  if (!body.ok) {
    const message = isHelperRecord(body.error) && typeof body.error.message === "string" && body.error.message.length <= 2_000
      ? safeInlineText(body.error.message, 2_000) || "The PhotoGit helper request failed."
      : "The PhotoGit helper request failed.";
    const error = new Error(message);
    error.code = body.error?.code;
    error.details = body.error;
    throw error;
  }
  return validateHelperResult(operation, body.result);
}

function validateHelperResult(operation, value) {
  const result = requireHelperRecord(value, operation);
  if (operation === "status") {
    requireHelperText(result.branch, "status.branch", 200);
    requireHelperCount(result.changeCount, "status.changeCount");
  } else if (operation === "history") {
    requireHelperArray(result.versions, "history.versions", 100).forEach((version, index) => {
      const entry = requireHelperRecord(version, `history.versions[${index}]`);
      requireHelperText(entry.id, `history.versions[${index}].id`, 64);
      requireHelperText(entry.shortId, `history.versions[${index}].shortId`, 64);
      requireHelperText(entry.author, `history.versions[${index}].author`, 200, true);
      requireHelperText(entry.date, `history.versions[${index}].date`, 64, true);
      requireHelperText(entry.message, `history.versions[${index}].message`, 500, true);
    });
  } else if (operation === "branches") {
    requireHelperText(result.current, "branches.current", 200);
    requireHelperArray(result.branches, "branches.branches", 1_000).forEach((branch, index) => {
      const entry = requireHelperRecord(branch, `branches.branches[${index}]`);
      requireHelperText(entry.name, `branches.branches[${index}].name`, 200);
      if (typeof entry.current !== "boolean") throw invalidHelperData(`branches.branches[${index}].current`);
      if (entry.tip !== undefined && (typeof entry.tip !== "string" || (entry.tip !== "" && !/^[a-f0-9]{40,64}$/.test(entry.tip)))) throw invalidHelperData(`branches.branches[${index}].tip`);
    });
  } else if (operation === "refresh") {
    if (result.baselineMissing !== undefined && typeof result.baselineMissing !== "boolean") throw invalidHelperData("refresh.baselineMissing");
    if (result.comparisonWarnings !== undefined) requireHelperTextArray(result.comparisonWarnings, "refresh.comparisonWarnings", 100, 2000);
    requireHelperArray(result.changes, "refresh.changes", 50_000).forEach((change, index) => {
      const entry = requireHelperRecord(change, `refresh.changes[${index}]`);
      if (!["document", "structure", "appearance", "text", "content"].includes(entry.domain)) throw invalidHelperData(`refresh.changes[${index}].domain`);
      requireHelperText(entry.layerName, `refresh.changes[${index}].layerName`, 1_024, true);
      requireHelperText(entry.summary, `refresh.changes[${index}].summary`, 1_000, true);
      if (entry.photoshopId !== null && (!Number.isSafeInteger(entry.photoshopId) || entry.photoshopId <= 0)) throw invalidHelperData(`refresh.changes[${index}].photoshopId`);
    });
  } else if (operation === "reviews") {
    const repository = requireHelperRecord(result.repository, "reviews.repository");
    if (!["github", "local", "other"].includes(repository.provider)) throw invalidHelperData("reviews.repository.provider");
    requireHelperText(repository.currentBranch, "reviews.repository.currentBranch", 200);
    requireHelperText(repository.baseBranch, "reviews.repository.baseBranch", 200);
    if (typeof repository.remoteConfigured !== "boolean") throw invalidHelperData("reviews.repository.remoteConfigured");
    requireHelperTextArray(result.conflicts, "reviews.conflicts", 10_000, 4_096);
    requireHelperTextArray(result.tags, "reviews.tags", 1_000, 100);
    requireHelperArray(result.reviews, "reviews.reviews", 1_000).forEach((review, index) => {
      const entry = requireHelperRecord(review, `reviews.reviews[${index}]`);
      requireHelperText(entry.branch, `reviews.reviews[${index}].branch`, 200);
      requireHelperCount(entry.ahead, `reviews.reviews[${index}].ahead`);
      requireHelperCount(entry.behind, `reviews.reviews[${index}].behind`);
      requireHelperCount(entry.changeCount, `reviews.reviews[${index}].changeCount`);
      requireHelperTextArray(entry.changes, `reviews.reviews[${index}].changes`, 10_000, 4_096);
      if (typeof entry.mergeable !== "boolean") throw invalidHelperData(`reviews.reviews[${index}].mergeable`);
    });
  } else if (["createBranch", "switchBranch", "pull", "push", "mergeBranch"].includes(operation)) {
    requireHelperText(result.branch, `${operation}.branch`, 200);
  } else if (operation === "capture") {
    requireHelperText(result.versionId, "capture.versionId", 64);
    requireHelperText(result.shortId, "capture.shortId", 64);
    requireHelperCount(result.warningCount, "capture.warningCount");
  } else if (operation === "createTag") {
    requireHelperText(result.tag, "createTag.tag", 100);
  } else if (operation === "pullRequestLink") {
    const url = requireHelperText(result.url, "pullRequestLink.url", 4_096);
    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/compare\//i.test(url)) throw invalidHelperData("pullRequestLink.url");
  } else if (operation === "connectDocument") {
    requireHelperRecord(result.binding || result.documentBinding, "document binding");
  } else if (operation === "openVersion") {
    const path = requireHelperText(result.snapshotPath, "openVersion.snapshotPath", 4096);
    if (!/^\.photogit\/recovered\/[A-Za-z0-9._-]+\.psd$/.test(path)) throw invalidHelperData("version path");
  } else if (["versionDetails", "compareBranches"].includes(operation)) {
    if (operation === "versionDetails" && result.parentVersionId != null && (typeof result.parentVersionId !== "string" || !/^[a-f0-9]{40,64}$/.test(result.parentVersionId))) throw invalidHelperData("parent version ID");
    requireHelperArray(result.files, "version files", 10000).forEach(file => {
      requireHelperRecord(file, "version file");
      requireHelperText(file.path, "version file path", 4096);
      requireHelperText(file.status, "version file status", 10);
    });
    requireHelperArray(result.changes, "version changes", 50000).forEach(change => requireHelperText(change.summary, "change summary", 2000, true));
    if (operation === "compareBranches") {
      for (const key of ["baseBranch", "incomingBranch"]) requireHelperText(result[key], key, 200);
      for (const key of ["ahead", "behind"]) requireHelperCount(result[key], key);
      requireHelperTextArray(result.conflicts, "conflicts", 10000, 4096);
      requireHelperTextArray(result.warnings, "warnings", 1000, 4096);
      if (typeof result.gitMergeable !== "boolean") throw invalidHelperData("gitMergeable");
    } else if (typeof result.snapshotAvailable !== "boolean") throw invalidHelperData("snapshotAvailable");
  } else if (operation === "versionPreview") {
    if (typeof result.available !== "boolean") throw invalidHelperData("versionPreview.available");
    if (result.available) {
      if (result.contentType !== "image/png") throw invalidHelperData("versionPreview.contentType");
      requireHelperCount(result.bytes, "versionPreview.bytes");
      // Strict base64 only; the panel builds the image URL itself and never
      // interpolates helper text into markup.
      if (typeof result.png !== "string" || result.png.length < 8 || result.png.length > MAX_HELPER_IO_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.png)) throw invalidHelperData("versionPreview.png");
    }
  } else {
    throw new Error("The PhotoGit helper returned data for an unknown operation.");
  }
  return result;
}

function isHelperRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireHelperRecord(value, label) {
  if (!isHelperRecord(value)) throw invalidHelperData(label);
  return value;
}
function requireHelperArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw invalidHelperData(label);
  return value;
}
function requireHelperText(value, label, maximum, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)) throw invalidHelperData(label);
  return value;
}
function requireHelperCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw invalidHelperData(label);
  return value;
}
function requireHelperTextArray(value, label, maximumEntries, maximumLength) {
  return requireHelperArray(value, label, maximumEntries).map((entry, index) => requireHelperText(entry, `${label}[${index}]`, maximumLength, true));
}
function invalidHelperData(label) { return new Error(`The PhotoGit helper returned invalid ${label} data.`); }

async function captureDocument(doc, { check = () => {}, progress = () => {} } = {}) {
  const layers = [];
  const fingerprintTargets = [];
  const detailTargets = [];
  const pending = Array.from(doc.layers).map((layer, order) => ({ layer, order, parentPhotoshopId: null })).reverse();
  while (pending.length) {
    check();
    if (layers.length >= MAX_CAPTURE_LAYERS) throw new Error(`PhotoGit supports up to ${MAX_CAPTURE_LAYERS} layers in one document.`);
    const { layer, order, parentPhotoshopId } = pending.pop();
    const children = Array.from(layer.layers || []);
    const childIds = children.map((child) => child.id);
    const kind = normalizeEnum(layer.kind);
    const capturedLayer = {
      photoshopId: layer.id, parentPhotoshopId, childrenPhotoshopIds: childIds, name: layer.name, kind, order,
      appearance: {
        visible: Boolean(layer.visible), opacity: number(layer.opacity), fillOpacity: number(layer.fillOpacity, 100), blendMode: normalizeEnum(layer.blendMode), clipped: Boolean(layer.isClippingMask),
        locks: { all: Boolean(layer.allLocked), pixels: Boolean(layer.pixelsLocked), position: Boolean(layer.positionLocked), transparentPixels: Boolean(layer.transparentPixelsLocked) },
        bounds: bounds(layer.bounds), boundsWithoutEffects: bounds(layer.boundsNoEffects || layer.bounds)
      },
      text: kind.includes("text") && layer.textItem ? { contents: layer.textItem.contents || "", styleFingerprint: textStyleFingerprint(layer.textItem) } : null,
      content: { fingerprint: null, opaque: !["normal", "pixel", "text", "group"].some((value) => kind.includes(value)), reason: unsupportedReason(kind) }
    };
    layers.push(capturedLayer);
    // A rendered fingerprint catches paint, masks, effects, shape fills, smart
    // object updates, and text styling that the smaller semantic fields miss.
    // Photoshop refuses direct imaging reads of groups. The document composite
    // below detects their rendered masks/effects without inventing per-layer data.
    if (!kind.includes("group")) fingerprintTargets.push({ layer, capturedLayer });
    detailTargets.push({ layer, capturedLayer });
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) pending.push({ layer: children[childIndex], order: childIndex, parentPhotoshopId: layer.id });
  }
  await panelModel.inBatches(fingerprintTargets, async target => {
    try { target.capturedLayer.content.fingerprint = await fingerprintLayerPixels(doc, target.layer, check); }
    catch (error) {
      if (!target.capturedLayer.content.opaque || !/unsupported layer type/i.test(error.message)) throw error;
      target.capturedLayer.content.reason = "Rendered changes are compared at document level; exact layer data is preserved in the PSD.";
    }
  }, { check, progress, batchSize: 4, yieldTask: () => delay(0) });
  check();
  await captureLayerDetails(doc, detailTargets, check);
  check();
  const renderedFingerprint = await fingerprintLayerPixels(doc, undefined, check);
  check();
  return { document: { documentId: String(doc.id), name: doc.name, width: number(doc.width), height: number(doc.height), resolution: number(doc.resolution), mode: normalizeEnum(doc.mode), bitDepth: number(doc.bitsPerChannel, 8), colorProfile: doc.colorProfileName || null, renderedFingerprint }, layers };
}

// Effects, masks, adjustment settings and smart filters are read from each
// layer's descriptor so an edit to them can be named. This is optional detail:
// when Photoshop refuses the read, the scan still compares everything else.
async function captureLayerDetails(doc, targets, check) {
  for (let offset = 0; offset < targets.length; offset += 200) {
    check();
    const batch = targets.slice(offset, offset + 200);
    let descriptors;
    try {
      descriptors = await action.batchPlay(batch.map(target => ({ _obj: "get", _target: [{ _ref: "layer", _id: target.layer.id }, { _ref: "document", _id: doc.id }], _options: { dialogOptions: "dontDisplay" } })), {});
    } catch (error) {
      runtimeLog("warn", "layer_details_skipped", { message: error.message || String(error) });
      return;
    }
    for (let index = 0; index < batch.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || typeof descriptor !== "object" || descriptor._obj === "error") continue;
      const details = layerDetails.extract(descriptor);
      if (details["mask.present"] === true) {
        check();
        try { details["mask.pixels"] = (await fullResolutionFingerprint(doc, batch[index].layer, { left: 0, top: 0, right: number(doc.width), bottom: number(doc.height) }, check, "mask")).absolute; }
        catch (error) {
          if (error.name === "StaleScanError") throw error;
          runtimeLog("warn", "mask_fingerprint_skipped", { layerId: batch[index].layer.id, message: error.message || String(error) });
        }
      }
      batch[index].capturedLayer.content.details = details;
    }
  }
}

async function fingerprintLayerPixels(doc, layer, check = () => {}) {
  const pixelBounds = layer ? bounds(layer.boundsNoEffects || layer.bounds) : { left: 0, top: 0, right: number(doc.width), bottom: number(doc.height) };
  if (pixelBounds.right <= pixelBounds.left || pixelBounds.bottom <= pixelBounds.top) return "pixels-v1:empty";
  let imageData = null;
  try {
    const pixels = await imaging.getPixels({
      documentID: doc.id,
      ...(layer ? { layerID: layer.id } : {}),
      sourceBounds: pixelBounds,
      targetSize: { width: CONTENT_FINGERPRINT_SIZE, height: CONTENT_FINGERPRINT_SIZE },
      componentSize: 8,
      // Preserve alpha; applyAlpha:true mattes on white and can hide transparency edits.
      applyAlpha: false
    });
    imageData = pixels.imageData;
    const data = await imageData.getData({ chunky: true });
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let hash = 0x811c9dc5;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    const dimensions = `${number(imageData.width)}x${number(imageData.height)}x${number(imageData.components)}`;
    const sampled = `pixels-v1:${dimensions}:${hash.toString(16).padStart(8, "0")}`;
    imageData.dispose(); imageData = null;
    // Keep the old thumbnail digest for comparisons with older saved versions.
    // New versions also compare every source pixel, without thumbnail scaling.
    const full = await fullResolutionFingerprint(doc, layer, pixelBounds, check);
    // The document composite has no position of its own to leave out.
    return layer ? `${sampled}|full-v2:${full.absolute}|rel-v1:${full.relative}` : `${sampled}|full-v2:${full.absolute}`;
  } catch (error) {
    if (error.name === "StaleScanError") throw error;
    runtimeLog("warn", "content_fingerprint_skipped", { layerId: layer?.id || null, kind: layer ? normalizeEnum(layer.kind) : "document", message: error.message || String(error) });
    throw new Error(`Could not read pixels for “${layer?.name || doc.name}”. Scan incomplete: ${error.message || String(error)}`);
  } finally {
    try { imageData?.dispose(); } catch { /* Photoshop already released this thumbnail. */ }
  }
}

// Hashes every source pixel in 512-pixel tiles. "absolute" is the hash older
// versions saved. "relative" leaves the layer's position out, so a layer that
// only moved still matches and a move is not mistaken for a pixel edit.
async function fullResolutionFingerprint(doc, layer, source, check, channel = "pixels") {
  const region = { left: Math.floor(source.left), top: Math.floor(source.top), right: Math.ceil(source.right), bottom: Math.ceil(source.bottom) };
  const tileSize = 512;
  const tiles = Math.ceil((region.right - region.left) / tileSize) * Math.ceil((region.bottom - region.top) / tileSize);
  if (tiles > 16384) throw new Error("This layer is too large for a full-resolution scan.");
  let first = 0x811c9dc5, second = 0x9e3779b9, third = 0x811c9dc5, fourth = 0x9e3779b9, completed = 0;
  const absolute = value => { for (const char of JSON.stringify(value)) { const code = char.charCodeAt(0); first = Math.imul(first ^ code, 0x01000193) >>> 0; second = Math.imul(second ^ code, 0x85ebca6b) >>> 0; } };
  const relative = value => { for (const char of JSON.stringify(value)) { const code = char.charCodeAt(0); third = Math.imul(third ^ code, 0x01000193) >>> 0; fourth = Math.imul(fourth ^ code, 0x85ebca6b) >>> 0; } };
  const shifted = box => ({ left: box.left - region.left, top: box.top - region.top, right: box.right - region.left, bottom: box.bottom - region.top });
  absolute(region);
  relative(shifted(region));
  for (let top = region.top; top < region.bottom; top += tileSize) {
    for (let left = region.left; left < region.right; left += tileSize) {
      check();
      const sourceBounds = { left, top, right: Math.min(left + tileSize, region.right), bottom: Math.min(top + tileSize, region.bottom) };
      let imageData;
      try {
        const pixels = channel === "mask"
          ? await imaging.getLayerMask({ documentID: doc.id, layerID: layer.id, kind: "user", sourceBounds })
          : await imaging.getPixels({ documentID: doc.id, ...(layer ? { layerID: layer.id } : {}), sourceBounds, componentSize: -1, applyAlpha: false });
        imageData = pixels.imageData;
        check();
        if (pixels.level != null && pixels.level !== 0) throw new Error("Photoshop returned a reduced-resolution pixel buffer.");
        const data = await imageData.getData({ chunky: true });
        check();
        const returned = pixels.sourceBounds || sourceBounds;
        const shape = [imageData.width, imageData.height, imageData.components, imageData.componentSize];
        absolute([sourceBounds, returned, ...shape]);
        relative([shifted(sourceBounds), shifted(returned), ...shape]);
        for (const byte of new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) {
          first = Math.imul(first ^ byte, 0x01000193) >>> 0; second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
          third = Math.imul(third ^ byte, 0x01000193) >>> 0; fourth = Math.imul(fourth ^ byte, 0x85ebca6b) >>> 0;
        }
      } finally { try { imageData?.dispose(); } catch { /* Already released by Photoshop. */ } }
      if (++completed % 4 === 0) { await delay(0); check(); }
    }
  }
  const hex = (high, low) => high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
  return { absolute: hex(first, second), relative: hex(third, fourth) };
}

function renderChanges(changes, { baselineMissing = false, changeCount = changes.length, warnings = [] } = {}) {
  const changesDocumentId = app.documents.length ? app.activeDocument.id : null;
  const container = document.getElementById("changes");
  const empty = document.getElementById("changes-empty");
  container.innerHTML = "";
  lastScanCount = changeCount;
  setCount("changes-count", changeCount);
  restartAnimation(document.getElementById("change-summary"));
  document.getElementById("change-summary").textContent = baselineMissing
    ? "Ready for your first version"
    : changeCount
      ? `${changeCount} unsaved ${changeCount === 1 ? "edit" : "edits"}`
      : warnings.length ? "No layer changes · Review scan limits" : "No detected changes";
  restartAnimation(document.getElementById("last-scan"));
  document.getElementById("last-scan").textContent = `Scanned ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Updates automatically${warnings.length ? `\n${warnings.join("\n")}` : ""}`;
  empty.hidden = changes.length > 0;
  setChangesEmpty(baselineMissing ? "Nothing saved yet" : "No unsaved edits", baselineMissing ? "Save a first version to start tracking edits." : "This document matches the last saved version. Edits appear here as you make them.");
  // Document-wide edits come first under their own header, then the layers,
  // top of the stack first. The counts beside the headers are filled in by
  // the filter, which knows how many rows are showing.
  const listed = changes.slice(0, MAX_VISIBLE_CHANGES);
  for (const group of ["document", "layers"]) {
    const rows = listed.filter(change => (change.domain === "document") === (group === "document"));
    if (!rows.length) continue;
    const header = document.createElement("div");
    header.className = "list-section change-section";
    header.dataset.group = group;
    header.innerHTML = group === "document" ? '<span>DOCUMENT</span><span class="section-count"></span>' : '<span>LAYERS</span><span class="section-count"></span>';
    container.appendChild(header);
    for (const change of rows) container.appendChild(changeRow(change, group, changesDocumentId));
  }
  // Decoration over a list that is already complete and already interactive.
  // Absent module, absent stagger, identical list.
  const reveal = globalThis.PhotoGitReveal;
  if (reveal && typeof reveal.stagger === "function") reveal.stagger(container.querySelectorAll(".change-row"));
  if (changeCount > Math.min(changes.length, MAX_VISIBLE_CHANGES)) {
    const note = document.createElement("p");
    note.className = "list-limit-note";
    note.textContent = `Showing ${Math.min(changes.length, MAX_VISIBLE_CHANGES)} of ${changeCount} changes. All layers are included when saving a version.`;
    container.appendChild(note);
  }
  workspaceUI.refreshChanges(document);
}

// One edit: a marker tile, the layer (or document setting), what changed,
// and either the before → after value or the kind of edit.
function changeRow(change, group, changesDocumentId) {
  const container = document.getElementById("changes");
  const row = document.createElement("div");
  row.dataset.domain = change.domain;
  row.dataset.group = group;
  // Rows for one layer follow each other; the layer is named on the first
  // and the rows after it read as that layer's list of edits.
  row.dataset.layer = group === "document" ? `document:${change.propertyPath || ""}` : String(change.photoshopId || change.layerName);
  const selectable = Boolean(change.photoshopId) && group !== "document" && change.category !== "removed";
  // Written as ternaries over literals rather than a lookup, so the values
  // that land in markup are constants by inspection and not merely
  // constants in practice.
  const category = change.category === "added" ? "added" : change.category === "removed" ? "removed" : "edited";
  const sign = category === "added" ? "+" : category === "removed" ? "−" : "~";
  const area = change.domain === "structure" ? "Structure" : change.domain === "text" ? "Text" : "Visual";
  row.className = `list-row change-row${category === "removed" ? " is-removed" : ""}`;
  const fact = documentFact(change);
  const kind = safeInlineText(change.layerKind || "layer", 80);
  const name = fact ? fact.name : change.layerName;
  const detail = fact ? "" : category === "added" ? `${kind.charAt(0).toUpperCase()}${kind.slice(1)} added` : category === "removed" ? `${kind.charAt(0).toUpperCase()}${kind.slice(1)} removed` : changeSummary(change);
  row.innerHTML = `<span class="marker ${category}" aria-hidden="true">${sign}</span><span class="row-copy"><strong class="change-name">${escapeHtml(name)}</strong><span class="change-detail">${escapeHtml(detail)}</span></span>${fact ? `<span class="change-value">${escapeHtml(fact.value)}</span>` : `<span class="change-kind">${area}</span>`}`;
  if (!detail) row.querySelector(".change-detail").remove();
  const identity = group === "document" ? "" : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${change.photoshopId ? ` #${change.photoshopId}` : ""}`;
  if (identity) row.setAttribute("title", identity);
  if (selectable) {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", "false");
    row.setAttribute("aria-label", `Select changed layer ${change.layerName}, Photoshop layer ${change.photoshopId}. ${changeSummary(change)}`);
  }
  const select = () => {
    if (!selectable) return;
    if (!app.documents.length || app.activeDocument.id !== changesDocumentId) return show("The active document changed. Scan it before selecting a layer.", true);
    container.querySelectorAll(".change-row.selected").forEach((entry) => {
      entry.classList.remove("selected");
      entry.setAttribute("aria-pressed", "false");
    });
    row.classList.add("selected");
    row.setAttribute("aria-pressed", "true");
    selectPhotoshopLayer(change.photoshopId);
  };
  row.addEventListener("click", select);
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select();
  });
  return row;
}

// A document setting reads as its name and a before → after value.
function documentFact(change) {
  if (change.domain !== "document") return null;
  const pair = (before, after, unit) => `${before} → ${after}${unit}`;
  const whole = value => Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(2))) : safeInlineText(value ?? "none", 60);
  if (change.propertyPath === "width") return { name: "Canvas width", value: pair(whole(change.baseValue), whole(change.currentValue), " px") };
  if (change.propertyPath === "height") return { name: "Canvas height", value: pair(whole(change.baseValue), whole(change.currentValue), " px") };
  if (change.propertyPath === "resolution") return { name: "Resolution", value: pair(whole(change.baseValue), whole(change.currentValue), " ppi") };
  if (change.propertyPath === "bitDepth") return { name: "Bit depth", value: pair(whole(change.baseValue), whole(change.currentValue), "-bit") };
  if (change.propertyPath === "mode") return { name: "Color mode", value: pair(colorModeLabel(change.baseValue), colorModeLabel(change.currentValue), "") };
  if (change.propertyPath === "colorProfile") return { name: "Color profile", value: pair(whole(change.baseValue), whole(change.currentValue), "") };
  return null;
}

// Photoshop names the mode "rgbColorMode"; a designer calls it RGB.
function colorModeLabel(mode) {
  const key = String(mode ?? "").toLowerCase().replace(/(?:color)?mode$/, "");
  const known = { rgb: "RGB", cmyk: "CMYK", lab: "Lab", grayscale: "Grayscale", bitmap: "Bitmap", indexedcolor: "Indexed Color", multichannel: "Multichannel", duotone: "Duotone" };
  return known[key] || safeInlineText(mode, 40);
}

function setChangesEmpty(title, copy) {
  const empty = document.getElementById("changes-empty");
  empty.querySelector("strong").textContent = title;
  empty.querySelector("p").textContent = copy;
}

function changeSummary(change) {
  if (change.domain === "content" && /painted pixels/i.test(change.summary || "")) return "Rendered appearance changed";
  const summary = String(change.summary || "Changed");
  const prefix = `${String(change.layerName || "").trim()}:`;
  return prefix && summary.toLowerCase().startsWith(prefix.toLowerCase())
    ? summary.slice(prefix.length).trim()
    : summary;
}

async function selectPhotoshopLayer(photoshopId) {
  if (!photoshopId) return;
  try {
    await core.executeAsModal(async () => {
      const layerId = Number(photoshopId);
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: layerId }],
        makeVisible: false,
        layerID: [layerId],
        _options: { dialogOptions: "dontDisplay" }
      }], {});
    }, { commandName: "Select changed layer" });
  } catch { /* Layer may have been removed. */ }
}

function commandRow(command, activate) {
  return workspaceUI.commandRow(document, command, activate);
}
function noMatches(document, advice) {
  return workspaceUI.noMatches(document, advice);
}

function renderCommandDocs() {
  const list = document.getElementById("command-directory");
  list.innerHTML = "";
  const matches = commandDirectory.search(document.getElementById("docs-search").value || "");
  for (const command of matches) list.appendChild(commandRow(command, () => openCommandPalette(command.id + " ")));
  if (!matches.length) list.appendChild(noMatches(document, "Try save, branch, or history."));
  const reveal = globalThis.PhotoGitReveal;
  if (reveal && typeof reveal.stagger === "function") reveal.stagger(list.querySelectorAll(".command-row"));
}

function openCommandPalette(initial = "") {
  if (startupPending) return;
  if (busyNow) return show("PhotoGit is busy. Try again in a moment.", false);
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
  // The palette's field wears the same shell and magnifier as the three
  // search fields, so the one field that opens in a dialog is not also
  // the one field that looks different.
  const shell = document.createElement("div"); shell.className = "field-shell search-field";
  const glyph = document.createElement("span"); glyph.className = "search-glyph"; glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></svg>';
  shell.appendChild(glyph); shell.appendChild(field);
  content.appendChild(shell); content.appendChild(hint); content.appendChild(error); content.appendChild(results);
  const render = () => {
    error.textContent = ""; results.innerHTML = "";
    const parsed = commandDirectory.parse(field.value);
    const matches = parsed ? [parsed.command] : commandDirectory.search(field.value);
    for (const command of matches) results.appendChild(commandRow(command, () => {
      if (["save", "branch", "switch", "compare", "merge"].includes(command.id)) {
        field.value = command.id + " "; field.focus(); render();
      } else void executeCommand(command.id);
    }));
    if (!matches.length) results.appendChild(noMatches(document, "Nothing will be run."));
    // The rows step in on the shared stagger once they are all rendered.
    const reveal = globalThis.PhotoGitReveal;
    if (reveal && typeof reveal.stagger === "function") reveal.stagger(results.querySelectorAll(".command-row"));
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

async function executeCommand(input) {
  if (startupPending) return;
  const parsed = commandDirectory.parse(input);
  const fail = message => {
    const error = document.getElementById("command-error");
    if (error) error.textContent = message; else show(message, true);
  };
  if (!parsed) return fail("Unknown command. Choose a command from the directory.");
  if (busyNow) return fail("Another operation is running. Please wait.");
  const { command, argument } = parsed;
  const needsArgument = ["save", "branch", "switch", "compare", "merge"].includes(command.id);
  if (needsArgument && !argument) return fail(`Usage: /${command.example}`);
  if (!needsArgument && argument) return fail(`/${command.id} does not take an argument.`);
  if ((command.id === "save" && argument.length > 500) || (needsArgument && command.id !== "save" && argument.length > 200)) return fail("The command argument is too long.");
  closeDetail();
  if (["changes", "history", "branches", "reviews", "activity", "docs"].includes(command.id)) {
    selectTab(command.id); if (command.id === "history") document.getElementById("history-search").focus(); return;
  }
  if (command.id === "connect") return chooseProject();
  if (command.id === "reconnect") return reconnectHelper();
  if (command.id === "status") return openRepositorySettings();
  if (!ensureReady()) return;
  if (command.id === "scan") return scanChanges({ automatic: false });
  if (command.id === "save") { document.getElementById("message").value = argument; return saveVersion(); }
  if (command.id === "branch") { document.getElementById("new-branch-name").value = argument; return createBranch(); }
  if (command.id === "compare") return compareBranch(argument);
  if (command.id === "merge") return mergeReview(argument);
  if (command.id === "tag") return openTagSheet();
  if (command.id === "conflicts") return openConflicts();
  const folder = projectFolder;
  if (["switch", "pull", "push"].includes(command.id)) {
    openDetail(`${command.label}?`, `${command.id === "switch" ? `Switch to “${argument}”. ` : ""}${command.description}. Save work you want to keep first. Your current document stays open.`, command.label, async () => {
      if (projectFolder !== folder) return show("The project changed. Run the command again.", true);
      closeDetail();
      if (command.id === "pull") return pull();
      if (command.id === "push") return push();
      return run(`Switching to ${argument}…`, async () => {
        await callHelper("switchBranch", { branch: argument });
        if (await openAfterGit(`Switched to ${argument}`)) { await refreshWorkspace(); show(`Switched to ${argument}.`, false); }
      });
    });
  }
}

function selectTab(name, animate = true) {
  closeToolsMenu();
  // A press both focuses a tab and clicks it; the screen it is already
  // showing does not arrive a second time.
  if (animate && document.getElementById("workspace").dataset.view === name && !document.getElementById(`${name}-view`)?.hidden) animate = false;
  if (!projectFolder || !helperToken) {
    document.getElementById("workspace").hidden = name !== "docs";
    document.getElementById("onboarding").hidden = name === "docs";
  }
  let target = null;
  const motion = animate ? globalThis.PhotoGitMotion : null;
  const choose = () => {
    for (const section of SECTIONS) {
      const active = section === name;
      const view = document.getElementById(`${section}-view`);
      view.hidden = !active;
      if (active) target = view;
      const tab = document.getElementById(`${section}-tab`);
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    }
  };
  // The old screen goes at once; the tabs ease between their two states.
  if (motion && typeof motion.recolour === "function") motion.recolour(document.querySelectorAll("#section-nav .nav-item:not([hidden])"), choose);
  else choose();
  try { localStorage.setItem("photogit.section", name); } catch { /* Session only. */ }
  // The stylesheet uses the active section to decide which pane scrolls.
  document.getElementById("workspace").dataset.view = name;
  applyShellState();
  placeTabIndicator();
  if (!animate || !target) return;
  const scroller = document.getElementById("view-scroll");
  if (scroller && scroller.scrollTop) scroller.scrollTop = 0;
  globalThis.PhotoGitMotion?.screen(target);
}

async function run(label, action) {
  if (busyNow) return show("PhotoGit is busy. Try again in a moment.", false);
  const resumeScanning = Boolean(scans.running || autoScanTimer);
  busy(true);
  workspaceGeneration += 1;
  try {
    await cancelScan(false);
    show(label, false);
    await action();
  }
  catch (error) {
    log(`Error: ${error.message || String(error)}`);
    show(error.message || String(error), true);
    if (error.details?.gitChanged || error.details?.outcomeUnknown) {
      await refreshWorkspace();
      openDetail("Repository recovery needed", `${error.message}\n${error.details.outcomeUnknown ? "The final state is not confirmed." : "The Git operation changed the repository."} Check project information and history before retrying.`, "View history", () => { closeDetail(); selectTab("history"); });
    }
  }
  finally {
    busy(false);
    if (resumeScanning) queueAutomaticScan("operation-finished", 250);
  }
}

function ensureReady() {
  if (startupPending) { show("PhotoGit is still opening your project. Please wait.", false); return false; }
  if (!projectFolder) { show("Choose a PhotoGit project folder first.", true); return false; }
  if (!helperToken) { show("Finish first-time setup for this project, then choose the folder again.", true); return false; }
  return true;
}

async function ensureFolder(root, path) {
  let cursor = root;
  for (const segment of path.split("/")) {
    try { cursor = await cursor.getEntry(segment); }
    catch { cursor = await cursor.createFolder(segment); }
  }
  return cursor;
}

async function removeEntry(folder, name) {
  try { await (await folder.getEntry(name)).delete(); }
  catch { /* Already consumed or cleaned up. */ }
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}

async function installPhotoshopChangeDetection() {
  if (changeListenerInstalled) return;
  try {
    await action.addNotificationListener(["all"], onPhotoshopNotification);
    changeListenerInstalled = true;
    setWatchStatus(app.documents.length ? "Watching Photoshop" : "Open a Photoshop document", app.documents.length ? "ready" : "warning");
    log("Automatic Photoshop change detection is active.");
    runtimeLog("info", "change_listener_ready", { events: "all", debounceMs: AUTO_SCAN_DELAY_MS });
  } catch (error) {
    setWatchStatus("Use Scan now", "warning");
    log(`Automatic detection is unavailable: ${error.message || String(error)}. Use Scan now after editing.`);
    runtimeLog("error", "change_listener_failed", { message: error.message || String(error) });
  }
}

function onPhotoshopNotification(eventName) {
  if (suppressNotifications) return;
  const normalized = String(eventName || "unknown");
  if (IGNORED_PHOTOSHOP_EVENTS.has(normalized)) return;
  scans.invalidate();
  queueAutomaticScan(normalized);
}

function queueAutomaticScan(eventName, delayMs = AUTO_SCAN_DELAY_MS) {
  if (startupPending || !projectFolder || !helperToken || !app.documents.length) return;
  pendingPhotoshopEvent = safeInlineText(eventName, 100) || "photoshop-change";
  clearTimeout(autoScanTimer);
  setWatchStatus("Change noticed…", "pending");
  autoScanTimer = setTimeout(() => {
    autoScanTimer = null;
    if (busyNow) return queueAutomaticScan(pendingPhotoshopEvent, 900);
    const observedEvent = pendingPhotoshopEvent;
    pendingPhotoshopEvent = null;
    void scanChanges({ automatic: true, eventName: observedEvent });
  }, Math.max(0, number(delayMs, AUTO_SCAN_DELAY_MS)));
}

function setWatchStatus(label, state = "ready") {
  const status = document.getElementById("watch-status");
  if (!status) return;
  status.className = `watch-status ${state}`;
  // The Scan now icon turns while layers are being read; the state ends it.
  document.body.classList.toggle("is-scanning", state === "scanning");
  const text = status.querySelector("span");
  if (text) text.textContent = safeInlineText(label, 100) || "Watching Photoshop";
}

function runtimeLog(level, event, details = {}) {
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  writer.call(console, `[PhotoGit] ${event}`, details);
}

function syncDocumentLabel() {
  const label = document.getElementById("document-name");
  if (!label) return;
  const doc = app.documents.length ? app.activeDocument : null;
  setTextWithFlash(label, doc ? safeInlineText(doc.name, 1_024) || "Untitled document" : "None open");
  label.setAttribute("title", doc ? safeInlineText(doc.name, 1_024) : "No Photoshop document open");
  const nextDocumentId = doc ? String(doc.id) : null;
  if (!documentObservationReady) {
    observedDocumentId = nextDocumentId;
    documentObservationReady = true;
    renderDocumentBinding();
    return;
  }
  const historyState = doc ? historyStateId(doc) : null;
  if (nextDocumentId === observedDocumentId) {
    if (historyState !== observedHistoryState) {
      observedHistoryState = historyState;
      if (!suppressNotifications) { scans.invalidate(); queueAutomaticScan("history-state-changed"); }
    }
    return;
  }
  scans.cancel();
  clearTimeout(autoScanTimer);
  observedDocumentId = nextDocumentId;
  observedHistoryState = historyState;
  renderDocumentBinding();
  if (doc) queueAutomaticScan("active-document-changed", 200);
  else {
    renderChanges([]);
    document.getElementById("change-summary").textContent = "Open a document";
    document.getElementById("last-scan").textContent = "PhotoGit will scan when a Photoshop document opens.";
    setWatchStatus("Waiting for Photoshop", "warning");
  }
}

function activateOnKeyboard(element, handler) {
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (element.getAttribute("aria-disabled") !== "true") handler(event);
  });
}

function bounds(value) { return { left: number(value?.left), top: number(value?.top), right: number(value?.right), bottom: number(value?.bottom) }; }
function number(value, fallback = 0) { const candidate = typeof value === "object" && value !== null && "value" in value ? value.value : value; return Number.isFinite(Number(candidate)) ? Number(candidate) : fallback; }
function normalizeEnum(value) { return String(value ?? "unknown").replace(/^.*\./, "").toLowerCase(); }
function textStyleFingerprint(textItem) {
  try {
    const character = textItem.characterStyle;
    const paragraph = textItem.paragraphStyle;
    const warp = textItem.warpStyle;
    const color = readTextColor(character);
    return JSON.stringify({
      character: {
        font: readStyleValue(character, "fontName"),
        fontStyle: readStyleValue(character, "fontStyle"),
        size: readStyleNumber(character, "size"),
        tracking: readStyleNumber(character, "tracking"),
        leading: readStyleNumber(character, "leading"),
        baselineShift: readStyleNumber(character, "baselineShift"),
        horizontalScale: readStyleNumber(character, "horizontalScale"),
        verticalScale: readStyleNumber(character, "verticalScale"),
        antiAlias: readStyleValue(character, "antiAliasMethod"),
        capitalization: readStyleValue(character, "capitalization"),
        underline: readStyleValue(character, "underline"),
        strikeThrough: readStyleValue(character, "strikeThrough"),
        ligatures: readStyleBoolean(character, "ligatures"),
        color
      },
      paragraph: {
        alignment: readStyleValue(paragraph, "justification"),
        direction: readStyleValue(paragraph, "direction"),
        firstLineIndent: readStyleNumber(paragraph, "firstLineIndent"),
        leftIndent: readStyleNumber(paragraph, "leftIndent"),
        rightIndent: readStyleNumber(paragraph, "rightIndent"),
        spaceBefore: readStyleNumber(paragraph, "spaceBefore"),
        spaceAfter: readStyleNumber(paragraph, "spaceAfter"),
        hyphenation: readStyleBoolean(paragraph, "hyphenation")
      },
      warp: {
        style: readStyleValue(warp, "style"),
        bend: readStyleNumber(warp, "bend"),
        horizontalDistortion: readStyleNumber(warp, "horizontalDistortion"),
        verticalDistortion: readStyleNumber(warp, "verticalDistortion")
      }
    });
  } catch {
    return null;
  }
}
function readStyleValue(source, key) { try { const value = source?.[key]; return value === undefined || value === null ? null : normalizeEnum(value); } catch { return null; } }
function readStyleNumber(source, key) { try { const value = source?.[key]; return value === undefined || value === null ? null : number(value); } catch { return null; } }
function readStyleBoolean(source, key) { try { const value = source?.[key]; return value === undefined || value === null ? null : Boolean(value); } catch { return null; } }
function readTextColor(character) {
  try {
    const color = character?.color;
    const rgb = color?.rgb;
    if (rgb) return { red: number(rgb.red), green: number(rgb.green), blue: number(rgb.blue) };
    const lab = color?.lab;
    if (lab) return { lightness: number(lab.lightness), a: number(lab.a), b: number(lab.b) };
    return null;
  } catch { return null; }
}
function unsupportedReason(kind) { return ["normal", "pixel", "text", "group"].some((value) => kind.includes(value)) ? null : `Unsupported ${kind} properties are preserved in the saved PSD version.`; }
function createRequestId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function setHelper(label, ok) {
  helperOnline = ok;
  // A "helper offline" error is out of date the moment the helper answers;
  // it clears here rather than waiting for the next message to replace it.
  if (ok) {
    const result = document.getElementById("result");
    if (result.classList.contains("error") && /helper|background service|not responding|connection lost/i.test(result.textContent)) { result.textContent = ""; result.className = "status-message"; syncToast(); }
  }
  const notice = document.getElementById("connection-notice");
  notice.hidden = ok || !projectFolder;
  // Only a lost connection earns the warning treatment; setup states stay calm.
  notice.classList.toggle("is-warning", !ok && Boolean(projectFolder));
  const element = document.getElementById("helper-status");
  element.className = `repo-state ${ok ? "ok" : "warning"}`;
  // Below 360px only the dot is visible; the title carries the label there.
  element.setAttribute("title", label);
  document.getElementById("repo-sync-status").textContent = label;
}
function busy(active) {
  busyNow = active;
  document.body.classList.toggle("is-busy", active);
  document.getElementById("workspace").setAttribute("aria-busy", active ? "true" : "false");
  document.getElementById("progress").hidden = !active;
  document.querySelector(".capture-panel").classList.toggle("is-busy", active);
  // The control that started the work shows it at once, and until it ends.
  for (const control of document.querySelectorAll(".is-working")) { control.classList.remove("is-working"); control.removeAttribute("aria-busy"); }
  // The host moves focus a moment after the press, so the press itself is
  // what identifies the control.
  const origin = active && pressedControl && Date.now() - pressedAt < 1500 && pressedControl.isConnected !== false ? pressedControl : null;
  if (origin) { origin.classList.add("is-working"); origin.setAttribute("aria-busy", "true"); }
  for (const id of ["save-version", "push", "new-branch", "new-pull-request", "create-tag", "header-menu"]) {
    const control = document.getElementById(id);
    control.setAttribute("aria-disabled", active ? "true" : "false");
    control.tabIndex = active ? -1 : 0;
  }
  // A menu item keeps its roving tabindex; only its availability changes.
  for (const id of ["refresh", "rescan", "pull", "show-status"]) document.getElementById(id).setAttribute("aria-disabled", active ? "true" : "false");
  for (const id of ["message", "new-branch-name", "tag-name"]) document.getElementById(id).disabled = active;
  for (const control of document.querySelectorAll("[data-message-preset],.branch-row.is-switchable,.history-actions .button,.review-toggle")) {
    control.setAttribute("aria-disabled", String(active)); control.tabIndex = active ? -1 : 0;
  }
  // A merge that conflicts stand in the way of stays unavailable when the
  // panel stops being busy.
  for (const control of document.querySelectorAll(".comparison-merge")) {
    const disabled = active || control.dataset.mergeable === "false";
    control.setAttribute("aria-disabled", disabled ? "true" : "false");
    control.tabIndex = disabled ? -1 : 0;
  }
}
// Photoshop draws a text field above anything laid over it, so while the
// status line is up the search field beneath it is not drawn.
function syncToast() {
  document.body.classList.toggle("has-toast", document.getElementById("result").textContent !== "");
}
function show(message, error) {
  const safeMessage = safeInlineText(message, 800) || (error ? "PhotoGit could not complete that action." : "Done.");
  const result = document.getElementById("result");
  restartAnimation(result);
  result.textContent = safeMessage;
  result.className = error ? "status-message error" : "status-message success";
  syncToast();
  // The result of a press arrives the way a screen does.
  globalThis.PhotoGitMotion?.enter(result);
  // An error interrupts; a success waits its turn.
  result.setAttribute("role", error ? "alert" : "status");
  // A success message clears itself once read; an error stays until replaced.
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    if (error || busyNow || result.textContent !== safeMessage) return;
    // A success fades out, then clears; an error stays.
    const clear = () => { if (result.textContent === safeMessage) result.textContent = ""; syncToast(); };
    const motion = globalThis.PhotoGitMotion;
    if (motion && typeof motion.exit === "function") motion.exit(result, clear); else clear();
  }, error ? 5200 : 3200);
}
// Replays an element's CSS animation so a value replacing another reads as
// a new event. The reflow is one element wide and only runs on a change.
// Sets a label's text and, when the words actually change, replays its
// entrance so the new value is seen to arrive.
function setTextWithFlash(element, text) {
  if (!element) return;
  if (element.textContent !== text) restartAnimation(element);
  element.textContent = text;
}
function restartAnimation(element) {
  if (!element) return;
  element.style.animation = "none";
  void element.offsetWidth;
  element.style.animation = "";
}
function log(message) {
  const text = safeInlineText(message, 2_000);
  const entry = activityView.log(document.getElementById("activity"), text);
  document.getElementById("clear-activity").setAttribute("aria-disabled", "false");
  // A new event eases up into the top of the feed; the rows below hold.
  const reveal = globalThis.PhotoGitReveal;
  if (!activityView.isScanEvent(text) && reveal && typeof reveal.stagger === "function") reveal.stagger([entry]);
  activityEntryCount += 1;
  setCount("activity-count", activityEntryCount);
}
function clearActivity() {
  activityView.clear(document.getElementById("activity"));
  document.getElementById("clear-activity").setAttribute("aria-disabled", "true");
  activityEntryCount = 0;
  setCount("activity-count", 0);
}
function setCount(id, value) {
  const count = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const element = document.getElementById(id);
  // The pill settles onto its number the way the tally tiles do; the
  // counter carries the real value in data-value from the first frame and
  // is skipped under reduced motion. Without the module, plain text.
  const counter = globalThis.PhotoGitCounter;
  if (counter && typeof counter.set === "function") counter.set(element, count);
  else element.textContent = String(count);
  element.dataset.empty = count === 0 ? "true" : "false";
}
function setSyncStatus(label) {
  document.getElementById("sync-status").textContent = "Status";
  document.getElementById("show-status").setAttribute("title", `Check project status · ${safeInlineText(label, 100)}`);
}
function safeInlineText(value, maximum) {
  const safe = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return safe.length <= maximum ? safe : `${safe.slice(0, maximum - 1)}…`;
}
function historyIcon() {
  return '<svg viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4m-16 4 8 4 8-4"/></svg>';
}
