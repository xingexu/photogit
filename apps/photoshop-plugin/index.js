const { app, core, action, imaging } = require("photoshop");
const { storage, entrypoints, shell } = require("uxp");
const panelModel = require("./panel-model.js");
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
const IGNORED_PHOTOSHOP_EVENTS = new Set(["select", "deselect", "invokeCommand", "get", "save"]);
let projectFolder = null;
let helperToken = null;
let busyNow = false;
let historyEntries = [];
let reviewEntries = [];
let repositoryDetails = null;
let activityEntryCount = 0;
let toastTimer = null;
let toastHideTimer = null;
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
const surfaceTimers = new Map();

document.addEventListener("DOMContentLoaded", async () => {
  const folderToken = localStorage.getItem("photogit.projectFolderToken");
  if (folderToken) {
    try {
      projectFolder = await storage.localFileSystem.getEntryForPersistentToken(folderToken);
      await loadPairing();
    } catch {
      localStorage.removeItem("photogit.projectFolderToken");
      projectFolder = null;
    }
  }
  bind("choose-project", "click", chooseProject);
  bind("change-project", "click", chooseProject);
  bind("reconnect-helper", "click", reconnectHelper);
  bind("connect-document", "click", connectDocument);
  bind("open-project-document", "click", () => run("Opening project document…", () => openSnapshot()));
  bind("cancel-scan", "click", cancelScan);
  bind("close-detail", "click", closeDetail);
  bind("detail-action", "click", () => detailAction?.());
  bind("refresh", "click", refreshAndScan);
  bind("global-search", "click", openHistorySearch);
  bind("header-menu", "click", toggleToolsMenu);
  bind("scan", "click", () => scanChanges({ automatic: false }));
  bind("rescan", "click", () => scanChanges({ automatic: false }));
  bind("save-version", "click", saveVersion);
  bind("pull", "click", pull);
  bind("push", "click", push);
  bind("show-status", "click", showProjectStatus);
  bind("new-branch", "click", createBranch);
  bind("branch-picker", "change", switchBranch);
  bind("changes-tab", "click", () => selectTab("changes"));
  bind("history-tab", "click", () => selectTab("history"));
  bind("branches-tab", "click", () => selectTab("branches"));
  bind("reviews-tab", "click", () => selectTab("reviews"));
  bind("activity-tab", "click", () => selectTab("activity"));
  bind("history-search", "input", filterHistory);
  bind("clear-activity", "click", clearActivity);
  bind("open-reviews", "click", () => selectTab("reviews"));
  bind("new-pull-request", "click", openPullRequest);
  bind("tools-toggle", "click", toggleToolsMenu);
  bind("tool-new-branch", "click", openNewBranch);
  bind("tool-new-pr", "click", openPullRequest);
  bind("tool-conflicts", "click", openConflicts);
  bind("tool-create-tag", "click", openTagSheet);
  bind("tool-settings", "click", openRepositorySettings);
  bind("close-tag-sheet", "click", () => closeTagSheet(false, true));
  bind("surface-backdrop", "click", () => { closeTagSheet(false, true); closeDetail(); });
  bind("create-tag", "click", createTag);
  bindInputAction("message", saveVersion);
  bindInputAction("new-branch-name", createBranch);
  bindInputAction("tag-name", createTag);
  ["message", "history-search", "new-branch-name", "tag-name"].forEach(bindFieldState);
  document.querySelector(".section-nav").addEventListener("keydown", handleTabKeyboard);
  document.getElementById("tools-menu").addEventListener("keydown", handleMenuKeyboard);
  document.addEventListener("keydown", handleGlobalKeyboard);
  document.addEventListener("click", handleOutsideClick);
  selectTab("changes", false);
  window.setInterval(syncDocumentLabel, 1000);
  await refreshWorkspace();
  await installPhotoshopChangeDetection();
  queueAutomaticScan("initial-load", 150);
});

function bind(id, event, handler) {
  const element = document.getElementById(id);
  const invoke = (inputEvent) => {
    if (element.getAttribute("aria-disabled") === "true") return;
    return handler(inputEvent);
  };
  element.addEventListener(event, invoke);
  if (event === "click" && ["button", "tab", "menuitem"].includes(element.getAttribute("role"))) {
    element.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
      keyEvent.preventDefault();
      invoke(keyEvent);
    });
  }
}

function bindInputAction(id, handler) {
  document.getElementById(id).addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handler(event);
  });
}

function bindFieldState(id) {
  const input = document.getElementById(id);
  const sync = () => input.closest(".field-shell")?.classList.toggle("has-value", Boolean(input.value));
  input.addEventListener("input", sync);
  sync();
}

function handleTabKeyboard(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(document.querySelectorAll(".nav-item"));
  const current = Math.max(0, tabs.indexOf(event.target));
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
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
    return sheet.id === "detail-sheet" ? closeDetail() : closeTagSheet(false, true);
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
  if (document.getElementById("tools-toggle").contains(event.target) || document.getElementById("header-menu").contains(event.target)) return;
  closeToolsMenu();
}

async function chooseProject() {
  if (busyNow) return show("Wait for the current operation before changing projects.", true);
  const folder = await storage.localFileSystem.getFolder();
  if (!folder) return;
  cancelScan();
  workspaceGeneration += 1;
  projectStatus = null;
  lastScanCount = null;
  helperToken = null;
  projectFolder = folder;
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

async function refreshWorkspace(announceErrors = false) {
  const generation = ++workspaceGeneration;
  const current = () => generation === workspaceGeneration;
  syncDocumentLabel();
  document.getElementById("project-status").textContent = projectFolder ? safeInlineText(projectFolder.name, 1_024) || "Unnamed project" : "No project selected";
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
    setHelper("Helper online", true);
    await loadStatus(status);
    const [branches, history, reviews] = await Promise.all([callHelper("branches"), callHelper("history"), callHelper("reviews")]);
    if (!current()) return;
    await Promise.all([loadBranches(branches), loadHistory(history), loadReviews(reviews)]);
  } catch (error) {
    if (!current() || error.name === "StaleScanError") return;
    setHelper("Helper offline", false);
    document.getElementById("connection-message").textContent = `The helper is not answering. In the PhotoGit source folder run: npm run helper -- --approve-root "${projectFolder.name}" (use its full folder path). Then Reconnect. Your saved versions are unchanged.`;
    log(`Refresh failed: ${error.message || String(error)}`);
    if (announceErrors) show(error.message || "PhotoGit could not refresh this project.", true);
  }
}

async function refreshAndScan() {
  if (!ensureReady() || busyNow) return;
  await cancelScan();
  await refreshWorkspace(true);
  if (app.documents.length) return scanChanges({ automatic: false, eventName: "workspace-refresh" });
  show("Project refreshed. Open a Photoshop document to scan edits.", false);
}

async function loadStatus(existingResult) {
  const result = existingResult || await callHelper("status");
  projectStatus = result;
  document.getElementById("branch-name").textContent = result.branch;
  document.getElementById("branch-name-detail").textContent = result.branch;
  document.getElementById("sync-status").textContent = result.changeCount ? "Files changed" : "File status";
  renderDocumentBinding();
  if (result.changeCount) log(`${result.changeCount} project file change(s) detected.`);
}

async function loadBranches(existingResult) {
  const result = existingResult || await callHelper("branches");
  const picker = document.getElementById("branch-picker");
  const menu = document.getElementById("branch-menu");
  menu.innerHTML = "";
  picker.selectedIndex = -1;
  result.branches.forEach((branch, index) => {
    const item = document.createElement("sp-menu-item");
    item.dataset.branch = branch.name;
    item.textContent = branch.current ? `${branch.name} •` : branch.name;
    if (branch.current) { item.selected = true; picker.selectedIndex = index; }
    menu.appendChild(item);
  });
  document.getElementById("branch-name").textContent = result.current;
  document.getElementById("branch-name-detail").textContent = result.current;
  setCount("branches-count", result.branches.length);
}

async function loadHistory(existingResult) {
  const result = existingResult || await callHelper("history");
  historyEntries = result.versions;
  setCount("history-count", historyEntries.length);
  document.getElementById("history-total").textContent = `${historyEntries.length} ${historyEntries.length === 1 ? "version" : "versions"}`;
  filterHistory();
}

async function loadReviews(existingResult) {
  const result = existingResult || await callHelper("reviews");
  repositoryDetails = result.repository;
  for (const id of ["new-pull-request", "tool-new-pr"]) document.getElementById(id).hidden = result.repository.provider !== "github";
  reviewEntries = result.reviews.filter((review) => review.ahead > 0 || review.changeCount > 0);
  setCount("reviews-count", reviewEntries.length);
  document.getElementById("review-provider").textContent = result.repository.provider === "github"
    ? `GitHub · ${result.repository.baseBranch} ← ${result.repository.currentBranch}`
    : `Local reviews · merging into ${result.repository.currentBranch}`;
  renderReviews(reviewEntries, result.conflicts || []);
  renderReviewPreview(reviewEntries[0] || null);
}

function renderReviews(reviews, conflicts) {
  const container = document.getElementById("reviews");
  const empty = document.getElementById("reviews-empty");
  container.innerHTML = "";
  empty.hidden = reviews.length > 0;
  for (const review of reviews) container.appendChild(createReviewCard(review, false));
  const conflictPanel = document.getElementById("conflict-panel");
  conflictPanel.hidden = conflicts.length === 0;
  const visibleConflicts = conflicts.slice(0, MAX_VISIBLE_CONFLICTS);
  document.getElementById("conflicts").textContent = conflicts.length
    ? `${visibleConflicts.join("\n")}${conflicts.length > visibleConflicts.length ? `\n… ${conflicts.length - visibleConflicts.length} more conflicts not shown.` : ""}`
    : "";
}

function renderReviewPreview(review) {
  const section = document.getElementById("review-preview");
  const container = document.getElementById("review-preview-content");
  container.innerHTML = "";
  section.hidden = !review;
  if (review) container.appendChild(createReviewCard(review, true));
}

function createReviewCard(review, compact) {
  const card = document.createElement("article");
  card.className = "review-card";
  const statusClass = review.mergeable ? "ready" : "blocked";
  const statusLabel = review.mergeable ? "Git merge available" : "Git merge blocked";
  const mergeClass = review.mergeable ? "button-primary" : "button-disabled";
  const mergeLabel = review.mergeable ? "Merge" : "Blocked";
  const changes = review.changes.length ? review.changes.join("\n") : "No file-level differences.";
  card.innerHTML = `<div class="review-title"><strong>${escapeHtml(review.branch)}</strong><span>${review.ahead} ahead</span></div><div class="review-meta"><span class="${statusClass}">${statusLabel}</span><span>·</span><span>${review.changeCount} ${review.changeCount === 1 ? "file" : "files"}</span></div><div class="review-files" aria-hidden="true">${escapeHtml(changes)}</div><div class="review-actions"><div class="button button-quiet button-small compare-action" role="button" tabindex="0" aria-expanded="false">Compare</div><div class="button ${mergeClass} button-small merge-action" role="button" tabindex="${review.mergeable ? "0" : "-1"}" data-mergeable="${review.mergeable ? "true" : "false"}" ${review.mergeable ? "" : "aria-disabled=\"true\""}>${mergeLabel}</div></div>`;
  const details = card.querySelector(".review-files");
  const compareAction = card.querySelector(".compare-action");
  const mergeAction = card.querySelector(".merge-action");
  const compare = () => compareBranch(review.branch);
  const merge = () => {
    if (review.mergeable) mergeReview(review.branch);
  };
  compareAction.addEventListener("click", compare);
  mergeAction.addEventListener("click", merge);
  activateOnKeyboard(compareAction, compare);
  activateOnKeyboard(mergeAction, merge);
  if (compact) card.classList.add("review-card-compact");
  return card;
}

function renderHistory(versions) {
  const container = document.getElementById("history");
  const empty = document.getElementById("history-empty");
  container.innerHTML = "";
  empty.hidden = versions.length > 0;
  for (const group of groupHistory(versions)) {
    const section = document.createElement("section");
    section.className = "history-group";
    section.innerHTML = `<div class="history-group-heading"><strong>${escapeHtml(group.label)}</strong><span>By ${escapeHtml(group.author)}</span></div><div class="history-group-entries"></div>`;
    const entries = section.querySelector(".history-group-entries");
    for (const version of group.entries) {
      const row = document.createElement("div");
      row.className = "list-row history-row";
      const message = escapeHtml(version.message);
      const shortId = escapeHtml(version.shortId);
      row.innerHTML = `<span class="history-marker" aria-hidden="true">${historyIcon()}</span><span class="row-copy"><strong title="${message}">${message}</strong><span>Inspect version</span></span><span class="commit-id" title="Version ${shortId}">${shortId}</span>`;
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.addEventListener("click", () => inspectVersion(version));
      activateOnKeyboard(row, () => inspectVersion(version));
      entries.appendChild(row);
    }
    container.appendChild(section);
  }
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
      log(`Captured ${capture.layers.length} Photoshop layer(s); comparing with the latest version.`);
      setWatchStatus(`Comparing ${capture.layers.length} layers…`, "scanning");
      const result = await callHelper("refresh", { capture, documentIdentity: identity }, 15000);
      check();
      renderChanges(result.changes, { baselineMissing: result.baselineMissing === true, changeCount: result.changeCount, warnings: result.comparisonWarnings || [] });
      const firstCheckpoint = result.baselineMissing === true;
      setWatchStatus(firstCheckpoint ? "Ready for first version" : result.changeCount ? `${result.changeCount} edits found` : "Watching Photoshop", firstCheckpoint || result.changeCount ? "changed" : "ready");
      log(firstCheckpoint ? "Ready to save the first version." : `${result.changeCount} semantic edits found.`);
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

function cancelScan() {
  clearTimeout(autoScanTimer);
  autoScanTimer = null;
  scans.cancel();
  setWatchStatus("Scan paused · Scan now to resume", "warning");
  return scans.running || Promise.resolve();
}

function historyStateId(doc) { try { return doc.activeHistoryState?.id ?? null; } catch { return null; } }

function documentAllowed() {
  if (!app.documents.length || !projectStatus) return false;
  return projectStatus.baselineMissing && !projectStatus.documentBinding || panelModel.sameDocument(projectStatus.documentBinding, panelModel.documentIdentity(app.activeDocument));
}

function renderDocumentBinding() {
  const allowed = documentAllowed();
  const banner = document.getElementById("document-connection");
  banner.hidden = allowed;
  document.getElementById("document-connection-message").textContent = !app.documents.length
    ? "Open a Photoshop document or open this project’s saved version."
    : projectStatus?.documentBinding
      ? `This document is not connected. Project document: ${safeInlineText(projectStatus.documentBinding.name, 200)}. Open it, or explicitly adopt the active document.`
      : "Connect this document before comparing it with the project’s saved versions.";
  document.getElementById("connect-document").hidden = !app.documents.length;
  document.getElementById("open-project-document").hidden = !projectStatus || projectStatus.baselineMissing;
  if (!allowed) {
    lastScanCount = null;
    document.getElementById("changes").innerHTML = "";
    document.getElementById("change-summary").textContent = "Connect a document";
    document.getElementById("last-scan").textContent = "No scan result for this document.";
    document.getElementById("changes-empty").hidden = true;
    setCount("changes-count", 0);
    document.getElementById("changes-total").textContent = "—";
  }
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
  if (busyNow) return show("Wait for the current operation before reconnecting.", false);
  if (!projectFolder) return chooseProject();
  try { await loadPairing(); await refreshWorkspace(true); if (helperOnline) queueAutomaticScan("reconnected", 100); }
  catch (error) { show(`${error.message} Run setup for this project, then Reconnect.`, true); }
}

async function saveVersion() {
  const message = document.getElementById("message").value.trim();
  if (!ensureReady()) return;
  if (!app.documents.length) return show("Open a Photoshop document first.", true);
  if (!message) return show("Describe what changed before saving this version.", true);
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
    await core.executeAsModal(async () => {
      assertSaveTarget();
      // Capture and PSD export share the same modal lock: they describe one state.
      capture = await captureDocument(doc, { progress: (done, total) => setWatchStatus(`Saving · reading ${done} of ${total}…`, "scanning") });
      await doc.saveAs.psd(snapshot, { embedColorProfile: true }, true);
      await doc.saveAs.png(preview, {}, true);
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
    for (const id of ["message", "history-search"]) {
      const input = document.getElementById(id);
      input.value = "";
      input.closest(".field-shell")?.classList.remove("has-value");
    }
    renderChanges([]);
    setWatchStatus("Watching Photoshop", "ready");
    log(`Saved ${result.shortId}: ${message}`);
    show(`Saved version ${result.shortId}.`, false);
    await Promise.all([loadStatus(), loadBranches(), loadHistory(), loadReviews()]);
    selectTab("history");
  });
}

async function pull() {
  if (!ensureReady()) return;
  return run("Getting shared changes…", async () => {
    const result = await callHelper("pull");
    if (!await openAfterGit(`Pulled ${result.branch}`)) return;
    log(`Pulled ${result.branch} and opened its saved PSD version.`);
    await refreshWorkspace();
    setSyncStatus("Synced");
    show(`Pulled ${result.branch} successfully.`, false);
  });
}

async function push() {
  if (!ensureReady()) return;
  return run("Sharing versions…", async () => {
    const result = await callHelper("push");
    log(`Shared branch ${result.branch}.`);
    setSyncStatus("Synced");
    await loadReviews();
    show("Changes shared successfully.", false);
  });
}

async function showProjectStatus() {
  if (!ensureReady()) return;
  return run("Checking project…", async () => {
    const result = await callHelper("status");
    log(`${result.branch}: ${result.changeCount ? `${result.changeCount} project file change(s)` : "clean"}.`);
    setSyncStatus(result.changeCount ? "Changes" : "Synced");
    show(result.changeCount ? "Project files have unsaved changes." : "Project is clean.", result.changeCount > 0);
  });
}

async function createBranch() {
  if (!ensureReady()) return;
  const input = document.getElementById("new-branch-name");
  const name = input.value.trim();
  if (!name) return show("Enter a branch name, such as hero-option-b.", true);
  return run("Creating branch…", async () => {
    await callHelper("createBranch", { branch: name });
    input.value = "";
    input.closest(".field-shell")?.classList.remove("has-value");
    log(`Created and switched to ${name}.`);
    await Promise.all([loadBranches(), loadReviews()]);
    show(`Created branch ${name}.`, false);
  });
}

async function switchBranch(event) {
  const item = document.getElementById("branch-menu").children[event.target.selectedIndex];
  const branch = item?.dataset?.branch;
  if (!branch || branch === document.getElementById("branch-name").textContent || busyNow) return;
  return run(`Switching to ${branch}…`, async () => {
    await callHelper("switchBranch", { branch });
    if (!await openAfterGit(`Switched to ${branch}`)) return;
    log(`Switched to ${branch} and opened its saved PSD version.`);
    await refreshWorkspace();
    show(`Switched to ${branch}.`, false);
  });
}

async function mergeReview(branch) {
  if (!ensureReady()) return;
  return run("Reviewing merge…", async () => {
    const comparison = await callHelper("compareBranches", { branch });
    const summary = comparison.changes.slice(0, 100).map(change => change.summary).join("\n") || "No semantic changes.";
    openDetail(comparison.gitMergeable ? "Merge this branch?" : "Git merge blocked", `Base: ${comparison.baseBranch}\nIncoming: ${comparison.incomingBranch}\n\n${summary}\n\n${fileSummary(comparison.files)}\n\n${comparison.conflicts.join("\n")}\n${comparison.warnings.join("\n")}\n\nThis uses ordinary Git. PhotoGit does not blend PSD layers. Your open document stays open.`, comparison.gitMergeable ? "Merge branch" : "", comparison.gitMergeable ? () => {
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
    setToolsExpanded(true);
    setTimeout(() => menu.querySelector(".tool-item")?.focus(), 0);
  } else {
    closeToolsMenu(false, true);
  }
}

function closeToolsMenu(immediate = false, returnFocus = false) {
  closeSurface(document.getElementById("tools-menu"), immediate);
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
  const backdrop = document.getElementById("surface-backdrop");
  clearTimeout(surfaceTimers.get(backdrop));
  backdrop.hidden = false;
  backdrop.classList.remove("is-open");
  void backdrop.offsetWidth;
  backdrop.classList.add("is-open");
}

function closeBackdrop(immediate = false) {
  const backdrop = document.getElementById("surface-backdrop");
  clearTimeout(surfaceTimers.get(backdrop));
  backdrop.classList.remove("is-open");
  if (immediate) return void (backdrop.hidden = true);
  surfaceTimers.set(backdrop, setTimeout(() => { backdrop.hidden = true; }, 160));
}

function setToolsExpanded(expanded) {
  const value = expanded ? "true" : "false";
  document.getElementById("tools-toggle").setAttribute("aria-expanded", value);
  document.getElementById("header-menu").setAttribute("aria-expanded", value);
}

function openSurface(element) {
  clearTimeout(surfaceTimers.get(element));
  element.hidden = false;
  element.classList.remove("is-closing", "is-open");
  void element.offsetWidth;
  element.classList.add("is-open");
}

function closeSurface(element, immediate = false) {
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

async function createTag() {
  const input = document.getElementById("tag-name");
  const tag = input.value.trim();
  if (!tag) return show("Enter a tag such as v1.0.0.", true);
  return run(`Creating ${tag}…`, async () => {
    await callHelper("createTag", { tag });
    input.value = "";
    input.closest(".field-shell")?.classList.remove("has-value");
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
  openDetail("Project information", `Project: ${projectFolder?.nativePath || "Not connected"}\nHelper: ${helperOnline ? "Online" : "Offline"}\nProvider: ${provider}\n${remote}\n\nSetup from the PhotoGit source folder:\nnpm run photogit -- init "/path/to/project"\nnpm run helper -- --approve-root "/path/to/project"\n\nDocking: open Plugins → PhotoGit. Drag PhotoGit’s native panel tab beside the left toolbar. Wait for Photoshop’s docking highlight, then release. Photoshop controls panel placement.`, "Choose project", () => { closeDetail(); return chooseProject(); });
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
  document.getElementById("detail-content").textContent = content;
  const button = document.getElementById("detail-action");
  button.hidden = !action;
  button.textContent = actionLabel;
  detailAction = action;
  openBackdrop();
  openSurface(document.getElementById("detail-sheet"));
  document.getElementById("close-detail").focus();
}

function closeDetail() {
  closeSurface(document.getElementById("detail-sheet"), true);
  closeBackdrop(true);
  detailAction = null;
  surfaceReturnFocus?.focus?.();
}

function inspectVersion(version) {
  return run("Loading version…", async () => {
    const details = await callHelper("versionDetails", { version: version.id });
    const changes = details.changes.map(change => change.summary).join("\n") || "No semantic differences recorded.";
    openDetail(version.message, `${version.shortId} · ${version.author}\n${version.date}\n\n${changes}\n\nFiles\n${fileSummary(details.files)}\n\nOpen an independent PSD copy. The current document and branch stay unchanged. To restore this design, connect the opened copy and save a new version.`, details.snapshotAvailable ? "Open version copy" : "", details.snapshotAvailable ? () => run("Opening version copy…", async () => { await openSnapshot(version.id, false); closeDetail(); show("Opened a version copy. Connect it explicitly to save it as a new version.", false); }) : null);
  });
}

function compareBranch(branch) {
  return run("Comparing branches…", async () => {
    const result = await callHelper("compareBranches", { branch });
    const summary = result.changes.map(change => change.summary).join("\n") || "No semantic changes.";
    openDetail("Compare branches", `${result.baseBranch} ← ${result.incomingBranch}\n${result.ahead} ahead · ${result.behind} behind\n\n${summary}\n\nFiles\n${fileSummary(result.files)}\n\n${result.gitMergeable ? "Ordinary Git merge is available." : "Git merge blocked. Conflicting files must be resolved outside PhotoGit."}\n${result.conflicts.join("\n")}\n${result.warnings.join("\n")}\n\nLayer-level PSD merging is not available in this build.`);
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
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) pending.push({ layer: children[childIndex], order: childIndex, parentPhotoshopId: layer.id });
  }
  await panelModel.inBatches(fingerprintTargets, async target => {
    try { target.capturedLayer.content.fingerprint = await fingerprintLayerPixels(doc, target.layer); }
    catch (error) {
      if (!target.capturedLayer.content.opaque || !/unsupported layer type/i.test(error.message)) throw error;
      target.capturedLayer.content.reason = "Rendered changes are compared at document level; exact layer data is preserved in the PSD.";
    }
  }, { check, progress, batchSize: 4, yieldTask: () => delay(0) });
  check();
  const renderedFingerprint = await fingerprintLayerPixels(doc);
  check();
  return { document: { documentId: String(doc.id), name: doc.name, width: number(doc.width), height: number(doc.height), resolution: number(doc.resolution), mode: normalizeEnum(doc.mode), bitDepth: number(doc.bitsPerChannel, 8), colorProfile: doc.colorProfileName || null, renderedFingerprint }, layers };
}

async function fingerprintLayerPixels(doc, layer) {
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
    return `pixels-v1:${dimensions}:${hash.toString(16).padStart(8, "0")}`;
  } catch (error) {
    runtimeLog("warn", "content_fingerprint_skipped", { layerId: layer?.id || null, kind: layer ? normalizeEnum(layer.kind) : "document", message: error.message || String(error) });
    throw new Error(`Could not read pixels for “${layer?.name || doc.name}”. Scan incomplete: ${error.message || String(error)}`);
  } finally {
    try { imageData?.dispose(); } catch { /* Photoshop already released this thumbnail. */ }
  }
}

function renderChanges(changes, { baselineMissing = false, changeCount = changes.length, warnings = [] } = {}) {
  const changesDocumentId = app.documents.length ? app.activeDocument.id : null;
  const container = document.getElementById("changes");
  const empty = document.getElementById("changes-empty");
  container.innerHTML = "";
  lastScanCount = changeCount;
  setCount("changes-count", changeCount);
  document.getElementById("changes-total").textContent = String(changeCount);
  document.getElementById("change-summary").textContent = baselineMissing
    ? "Ready for your first version"
    : changeCount
      ? `${changeCount} unsaved ${changeCount === 1 ? "edit" : "edits"}`
      : warnings.length ? "No layer changes · Review scan limits" : "No detected changes";
  document.getElementById("last-scan").textContent = `Scanned ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Updates automatically${warnings.length ? `\n${warnings.join("\n")}` : ""}`;
  empty.hidden = changes.length > 0;
  for (const change of changes.slice(0, MAX_VISIBLE_CHANGES)) {
    const row = document.createElement("div");
    row.className = "list-row change-row";
    const selectable = Boolean(change.photoshopId) && change.domain !== "document" && change.category !== "removed";
    if (selectable) {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", "false");
      row.setAttribute("aria-label", `Select changed layer ${change.layerName}, Photoshop layer ${change.photoshopId}. ${changeSummary(change)}`);
    }
    const identityLabel = change.domain === "document" ? "Whole document" : `Photoshop layer ${change.photoshopId ? `#${change.photoshopId}` : "ID unavailable"}`;
    row.innerHTML = `<span class="row-glyph ${domainClass(change.domain)}" aria-hidden="true">${domainIcon(change.domain)}</span><span class="row-copy"><strong>${escapeHtml(change.layerName)}</strong><span class="layer-identity">${escapeHtml(identityLabel)}</span><span class="change-detail">${escapeHtml(changeSummary(change))}</span></span><span class="change-domain">${escapeHtml(change.domain)}</span>`;
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
    container.appendChild(row);
  }
  if (changeCount > Math.min(changes.length, MAX_VISIBLE_CHANGES)) {
    const note = document.createElement("p");
    note.className = "list-limit-note";
    note.textContent = `Showing ${Math.min(changes.length, MAX_VISIBLE_CHANGES)} of ${changeCount} changes. All layers are included when saving a version.`;
    container.appendChild(note);
  }
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

function selectTab(name, animate = true) {
  closeToolsMenu();
  let target = null;
  for (const section of ["changes", "history", "branches", "reviews", "activity"]) {
    const active = section === name;
    const view = document.getElementById(`${section}-view`);
    view.hidden = !active;
    if (active) target = view;
    const tab = document.getElementById(`${section}-tab`);
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  }
  if (!animate || !target) return;
  target.classList.remove("view-enter");
  void target.offsetWidth;
  target.classList.add("view-enter");
}

async function run(label, action) {
  if (busyNow) return show("Another operation is running. Please wait.", false);
  busy(true);
  workspaceGeneration += 1;
  try {
    await cancelScan();
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
  finally { busy(false); }
}

function ensureReady() {
  if (!projectFolder) { show("Choose a PhotoGit project folder first.", true); return false; }
  if (!helperToken) { show("Start the helper for this project, then choose the folder again.", true); return false; }
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
  if (!projectFolder || !helperToken || !app.documents.length) return;
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
  label.textContent = doc ? safeInlineText(doc.name, 1_024) || "Untitled document" : "None open";
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
        alignment: readStyleValue(paragraph, "alignment"),
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
  document.getElementById("connection-notice").hidden = ok || !projectFolder;
  const element = document.getElementById("helper-status");
  element.className = `repo-state ${ok ? "ok" : "warning"}`;
  document.getElementById("repo-sync-status").textContent = label;
}
function busy(active) {
  busyNow = active;
  document.body.classList.toggle("is-busy", active);
  document.getElementById("workspace").setAttribute("aria-busy", active ? "true" : "false");
  document.getElementById("progress").hidden = !active;
  document.querySelector(".capture-panel").classList.toggle("is-busy", active);
  for (const id of ["save-version", "scan", "rescan", "pull", "push", "show-status", "new-branch", "refresh", "new-pull-request", "create-tag", "tools-toggle", "header-menu"]) {
    const control = document.getElementById(id);
    control.setAttribute("aria-disabled", active ? "true" : "false");
    control.tabIndex = active ? -1 : 0;
  }
  for (const id of ["message", "new-branch-name", "tag-name", "branch-picker"]) document.getElementById(id).disabled = active;
  for (const control of document.querySelectorAll(".merge-action")) {
    const disabled = active || control.dataset.mergeable !== "true";
    control.setAttribute("aria-disabled", disabled ? "true" : "false");
    control.tabIndex = disabled ? -1 : 0;
  }
}
function show(message, error) {
  const safeMessage = safeInlineText(message, 800) || (error ? "PhotoGit could not complete that action." : "Done.");
  const result = document.getElementById("result");
  result.textContent = safeMessage;
  result.className = error ? "error" : "success";
  const toast = document.getElementById("toast");
  toast.textContent = safeMessage;
  toast.className = error ? "toast error" : "toast";
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  if (toastHideTimer) clearTimeout(toastHideTimer);
  requestAnimationFrame(() => toast.classList.add("visible"));
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    toastHideTimer = setTimeout(() => { toast.hidden = true; }, 180);
  }, error ? 5200 : 3200);
}
function log(message) {
  const activity = document.getElementById("activity");
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  activity.textContent = `[${stamp}] ${safeInlineText(message, 2_000)}\n${activity.textContent === "Ready." ? "" : activity.textContent}`.slice(0, 4000);
  activityEntryCount += 1;
  setCount("activity-count", activityEntryCount);
}
function clearActivity() {
  document.getElementById("activity").textContent = "Ready.";
  activityEntryCount = 0;
  setCount("activity-count", 0);
}
function setCount(id, value) {
  const count = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const element = document.getElementById(id);
  element.textContent = String(count);
  element.dataset.empty = count === 0 ? "true" : "false";
}
function setSyncStatus(label) { document.getElementById("sync-status").textContent = label; }
function safeInlineText(value, maximum) {
  const safe = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return safe.length <= maximum ? safe : `${safe.slice(0, maximum - 1)}…`;
}
function domainClass(domain) {
  const value = String(domain || "").toLowerCase();
  if (value.includes("text")) return "text";
  if (value.includes("appearance") || value.includes("style")) return "appearance";
  if (value.includes("structure") || value.includes("layer")) return "structure";
  return "content";
}
function domainIcon(domain) {
  const type = domainClass(domain);
  if (type === "text") return '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13m-4 0h8"/></svg>';
  if (type === "appearance") return '<svg viewBox="0 0 24 24"><path d="M12 4c4.4 0 8 3.1 8 7 0 3-2.2 4-4 4h-1.2c-.9 0-1.4 1-.9 1.8.8 1.3-.2 3.2-2.3 3.2C7.4 20 4 16.4 4 12s3.6-8 8-8Z"/><circle cx="8" cy="10" r=".8"/><circle cx="11" cy="7.5" r=".8"/><circle cx="15" cy="8.5" r=".8"/></svg>';
  if (type === "structure") return '<svg viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4m-16 4 8 4 8-4"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path d="m4 15 4-4 3 3 3-3 6 5"/></svg>';
}
function historyIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/></svg>';
}
