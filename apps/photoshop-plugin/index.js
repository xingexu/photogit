const { app, core, action } = require("photoshop");
const { storage, entrypoints, shell } = require("uxp");

entrypoints.setup({
  panels: {
    photogitPanel: {
      show() { syncDocumentLabel(); }
    }
  }
});

const PROTOCOL_VERSION = 1;
const HELPER_TIMEOUT_MS = 120000;
const HELPER_HEALTH_TIMEOUT_MS = 5000;
let projectFolder = null;
let helperToken = null;
let busyNow = false;
let historyEntries = [];
let reviewEntries = [];
let repositoryDetails = null;
let activityEntryCount = 0;
let toastTimer = null;
let toastHideTimer = null;
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
  bind("refresh", "click", refreshWorkspace);
  bind("global-search", "click", openHistorySearch);
  bind("header-menu", "click", toggleToolsMenu);
  bind("scan", "click", scanChanges);
  bind("rescan", "click", scanChanges);
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
  bind("close-tag-sheet", "click", closeTagSheet);
  bind("create-tag", "click", createTag);
  bindInputAction("message", saveVersion);
  bindInputAction("new-branch-name", createBranch);
  bindInputAction("tag-name", createTag);
  ["message", "history-search", "new-branch-name", "tag-name"].forEach(bindFieldState);
  document.querySelector(".section-nav").addEventListener("keydown", handleTabKeyboard);
  document.addEventListener("keydown", handleGlobalKeyboard);
  document.addEventListener("click", handleOutsideClick);
  selectTab("changes", false);
  window.setInterval(syncDocumentLabel, 1000);
  await refreshWorkspace();
});

function bind(id, event, handler) {
  const element = document.getElementById(id);
  const invoke = (inputEvent) => {
    if (element.getAttribute("aria-disabled") === "true") return;
    return handler(inputEvent);
  };
  element.addEventListener(event, invoke);
  if (event === "click" && ["button", "tab"].includes(element.getAttribute("role"))) {
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
  if (event.key !== "Escape") return;
  closeToolsMenu();
  closeTagSheet();
}

function handleOutsideClick(event) {
  const menu = document.getElementById("tools-menu");
  if (menu.hidden || menu.contains(event.target)) return;
  if (document.getElementById("tools-toggle").contains(event.target) || document.getElementById("header-menu").contains(event.target)) return;
  closeToolsMenu();
}

async function chooseProject() {
  const folder = await storage.localFileSystem.getFolder();
  if (!folder) return;
  projectFolder = folder;
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
}

async function loadPairing() {
  if (!projectFolder) throw new Error("No project folder selected.");
  const photogit = await projectFolder.getEntry(".photogit");
  const pairingFile = await photogit.getEntry("helper.json");
  const pairing = JSON.parse(await pairingFile.read());
  if (pairing.protocolVersion !== PROTOCOL_VERSION || typeof pairing.token !== "string") throw new Error("The project helper pairing is invalid.");
  helperToken = pairing.token;
  await Promise.all([
    ensureFolder(projectFolder, ".photogit/bridge/requests"),
    ensureFolder(projectFolder, ".photogit/bridge/responses")
  ]);
}

async function refreshWorkspace() {
  syncDocumentLabel();
  document.getElementById("project-status").textContent = projectFolder ? projectFolder.name : "No project selected";
  document.getElementById("onboarding").hidden = Boolean(projectFolder && helperToken);
  document.getElementById("workspace").hidden = !projectFolder;
  if (!projectFolder || !helperToken) {
    setHelper(projectFolder ? "Setup needed" : "Not connected", false);
    return;
  }
  try {
    const status = await callHelper("status", {}, HELPER_HEALTH_TIMEOUT_MS);
    setHelper("Synced", true);
    await loadStatus(status);
    await Promise.all([loadBranches(), loadHistory(), loadReviews()]);
  } catch { setHelper("Offline", false); }
}

async function loadStatus(existingResult) {
  const result = existingResult || await callHelper("status");
  document.getElementById("branch-name").textContent = result.branch;
  document.getElementById("branch-name-detail").textContent = result.branch;
  setSyncStatus(result.changeCount ? "Changes" : "Synced");
  if (result.changeCount) log(`${result.changeCount} project file change(s) detected.`);
}

async function loadBranches(existingResult) {
  const result = existingResult || await callHelper("branches");
  const picker = document.getElementById("branch-picker");
  const menu = document.getElementById("branch-menu");
  menu.innerHTML = "";
  result.branches.forEach((branch, index) => {
    const item = document.createElement("sp-menu-item");
    item.dataset.branch = branch.name;
    item.textContent = branch.current ? `${branch.name} •` : branch.name;
    if (branch.current) { item.selected = true; picker.selectedIndex = index; }
    menu.appendChild(item);
  });
  document.getElementById("branch-name").textContent = result.current;
  document.getElementById("branch-name-detail").textContent = result.current;
  document.getElementById("branches-count").textContent = String(result.branches.length);
}

async function loadHistory(existingResult) {
  const result = existingResult || await callHelper("history");
  historyEntries = result.versions;
  document.getElementById("history-count").textContent = String(historyEntries.length);
  document.getElementById("history-total").textContent = `${historyEntries.length} ${historyEntries.length === 1 ? "version" : "versions"}`;
  filterHistory();
}

async function loadReviews(existingResult) {
  const result = existingResult || await callHelper("reviews");
  repositoryDetails = result.repository;
  reviewEntries = result.reviews.filter((review) => review.ahead > 0 || review.changeCount > 0);
  document.getElementById("reviews-count").textContent = String(reviewEntries.length);
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
  document.getElementById("conflicts").textContent = conflicts.length ? conflicts.join("\n") : "";
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
  const statusLabel = review.mergeable ? "Ready to merge" : "Review conflicts";
  const mergeClass = review.mergeable ? "button-primary" : "button-disabled";
  const mergeLabel = review.mergeable ? "Merge" : "Blocked";
  const changes = review.changes.length ? review.changes.join("\n") : "No file-level differences.";
  card.innerHTML = `<div class="review-title"><strong>${escapeHtml(review.branch)}</strong><span>${review.ahead} ahead</span></div><div class="review-meta"><span class="${statusClass}">${statusLabel}</span><span>·</span><span>${review.changeCount} ${review.changeCount === 1 ? "file" : "files"}</span></div><div class="review-files" aria-hidden="true">${escapeHtml(changes)}</div><div class="review-actions"><div class="button button-quiet button-small compare-action" role="button" tabindex="0" aria-expanded="false">Compare</div><div class="button ${mergeClass} button-small merge-action" role="button" tabindex="0" data-mergeable="${review.mergeable ? "true" : "false"}" ${review.mergeable ? "" : "aria-disabled=\"true\""}>${mergeLabel}</div></div>`;
  const details = card.querySelector(".review-files");
  const compareAction = card.querySelector(".compare-action");
  const mergeAction = card.querySelector(".merge-action");
  const compare = () => {
    const expanded = card.classList.toggle("details-open");
    details.setAttribute("aria-hidden", expanded ? "false" : "true");
    compareAction.setAttribute("aria-expanded", expanded ? "true" : "false");
    compareAction.textContent = expanded ? "Hide details" : "Compare";
  };
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
  for (const version of versions) {
    const row = document.createElement("div");
    row.className = "list-row history-row";
    const message = escapeHtml(version.message);
    const author = escapeHtml(version.author);
    const date = escapeHtml(version.date.slice(0, 10));
    const shortId = escapeHtml(version.shortId);
    row.innerHTML = `<span class="history-marker" aria-hidden="true">${historyIcon()}</span><span class="row-copy"><strong title="${message}">${message}</strong><span class="history-meta"><span>${author}</span><i aria-hidden="true"></i><time>${date}</time></span></span><span class="commit-id" title="Checkpoint ${shortId}">${shortId}</span>`;
    container.appendChild(row);
  }
}

function filterHistory() {
  const query = document.getElementById("history-search").value.trim().toLowerCase();
  if (!query) return renderHistory(historyEntries);
  renderHistory(historyEntries.filter((version) => [version.message, version.shortId, version.author, version.date].some((value) => String(value).toLowerCase().includes(query))));
}

async function scanChanges() {
  if (!ensureReady()) return;
  if (!app.documents.length) return show("Open a Photoshop document first.", true);
  return run("Scanning layers…", async () => {
    const result = await callHelper("refresh", { capture: captureDocument(app.activeDocument) });
    renderChanges(result.changes);
    log(result.changes.length ? `Found ${result.changes.length} layer change(s).` : "Current design matches the latest version.");
    show(result.changes.length ? `Found ${result.changes.length} layer change(s).` : "No layer changes found.", false);
  });
}

async function saveVersion() {
  const message = document.getElementById("message").value.trim();
  if (!ensureReady()) return;
  if (!app.documents.length) return show("Open a Photoshop document first.", true);
  if (!message) return show("Describe what changed before saving this version.", true);

  return run("Saving exact PSD and preview…", async () => {
    const incoming = await ensureFolder(projectFolder, ".photogit/incoming");
    const snapshot = await incoming.createFile("document.psd", { overwrite: true });
    const preview = await incoming.createFile("document.png", { overwrite: true });
    const doc = app.activeDocument;
    await core.executeAsModal(async () => {
      await doc.saveAs.psd(snapshot, { embedColorProfile: true }, true);
      await doc.saveAs.png(preview, {}, true);
    }, { commandName: "Save PhotoGit version artifacts" });
    const result = await callHelper("capture", {
      message,
      snapshotPath: snapshot.nativePath,
      previewPath: preview.nativePath,
      capture: captureDocument(doc)
    });
    for (const id of ["message", "history-search"]) {
      const input = document.getElementById(id);
      input.value = "";
      input.closest(".field-shell")?.classList.remove("has-value");
    }
    renderChanges([]);
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
    await openSnapshot();
    log(`Pulled ${result.branch} and opened its PSD snapshot.`);
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
    await openSnapshot();
    log(`Switched to ${branch} and opened its PSD snapshot.`);
    await refreshWorkspace();
    show(`Switched to ${branch}.`, false);
  });
}

async function mergeReview(branch) {
  if (!ensureReady()) return;
  return run(`Merging ${branch}…`, async () => {
    await callHelper("mergeBranch", { branch });
    await openSnapshot();
    log(`Merged ${branch} into ${document.getElementById("branch-name").textContent}.`);
    await refreshWorkspace();
    selectTab("history");
    show(`Merged ${branch} and opened the resulting PSD snapshot.`, false);
  });
}

async function openPullRequest() {
  closeToolsMenu();
  if (!ensureReady()) return;
  return run("Preparing pull request…", async () => {
    const result = await callHelper("pullRequestLink", { base: repositoryDetails?.baseBranch });
    const error = await shell.openExternal(result.url, "PhotoGit is opening GitHub so you can review and submit this pull request.");
    if (error) throw new Error(error);
    log(`Opened a GitHub pull request from ${repositoryDetails?.currentBranch || "the current branch"}.`);
    show("Opened the pull-request review in GitHub.", false);
  });
}

function openHistorySearch() {
  selectTab("history");
  document.getElementById("history-search").focus();
}

function toggleToolsMenu() {
  const menu = document.getElementById("tools-menu");
  if (menu.hidden || menu.classList.contains("is-closing")) {
    closeSurface(document.getElementById("tag-sheet"), true);
    openSurface(menu);
    setToolsExpanded(true);
  } else {
    closeToolsMenu();
  }
}

function closeToolsMenu(immediate = false) {
  closeSurface(document.getElementById("tools-menu"), immediate);
  setToolsExpanded(false);
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
  openSurface(document.getElementById("tag-sheet"));
  document.getElementById("tag-name").focus();
}

function closeTagSheet(immediate = false) { closeSurface(document.getElementById("tag-sheet"), immediate); }

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
    closeTagSheet();
    await loadReviews();
    log(`Created repository tag ${tag}.`);
    show(`Created tag ${tag}.`, false);
  });
}

function openRepositorySettings() {
  closeToolsMenu();
  selectTab("activity");
  const provider = repositoryDetails?.provider || "unknown";
  const remote = repositoryDetails?.remoteUrl || "No remote configured";
  log(`Repository provider: ${provider}. Remote: ${remote}.`);
  showProjectStatus();
}

async function openSnapshot() {
  const snapshotFolder = await projectFolder.getEntry("snapshot");
  const snapshot = await snapshotFolder.getEntry("document.psd");
  await core.executeAsModal(() => app.open(snapshot), { commandName: "Open PhotoGit branch snapshot" });
}

async function callHelper(operation, fields = {}, timeoutMs = HELPER_TIMEOUT_MS) {
  if (!helperToken) throw new Error("This project is not paired with the PhotoGit helper.");
  if (!projectFolder?.nativePath) throw new Error("PhotoGit cannot resolve the selected project folder on this computer.");
  const requestId = createRequestId();
  const requests = await ensureFolder(projectFolder, ".photogit/bridge/requests");
  const responses = await ensureFolder(projectFolder, ".photogit/bridge/responses");
  const request = { protocolVersion: PROTOCOL_VERSION, operation, requestId, projectRoot: projectFolder.nativePath, ...fields };
  const requestFile = await requests.createFile(`${requestId}.json`, { overwrite: true });
  await requestFile.write(`${JSON.stringify({ token: helperToken, request })}\n`);
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
  if (!responseFile) throw new Error("The PhotoGit helper is offline or did not answer in time.");
  const body = JSON.parse(await responseFile.read());
  await Promise.all([
    removeEntry(responses, `${requestId}.ready`),
    removeEntry(responses, `${requestId}.json`)
  ]);
  if (body.protocolVersion !== PROTOCOL_VERSION || body.requestId !== requestId) throw new Error("The PhotoGit helper returned an invalid response.");
  if (!body.ok) throw new Error(body.error?.message || "The PhotoGit helper request failed.");
  return body.result;
}

function captureDocument(doc) {
  const layers = [];
  const walk = (collection, parentPhotoshopId) => {
    Array.from(collection).forEach((layer, order) => {
      const childIds = Array.from(layer.layers || []).map((child) => child.id);
      const kind = normalizeEnum(layer.kind);
      layers.push({
        photoshopId: layer.id, parentPhotoshopId, childrenPhotoshopIds: childIds, name: layer.name, kind, order,
        appearance: {
          visible: Boolean(layer.visible), opacity: number(layer.opacity), fillOpacity: number(layer.fillOpacity, 100), blendMode: normalizeEnum(layer.blendMode), clipped: Boolean(layer.isClippingMask),
          locks: { all: Boolean(layer.allLocked), pixels: Boolean(layer.pixelsLocked), position: Boolean(layer.positionLocked), transparentPixels: Boolean(layer.transparentPixelsLocked) },
          bounds: bounds(layer.bounds), boundsWithoutEffects: bounds(layer.boundsNoEffects || layer.bounds)
        },
        text: kind.includes("text") && layer.textItem ? { contents: layer.textItem.contents || "", styleFingerprint: textStyleFingerprint(layer.textItem) } : null,
        content: { fingerprint: null, opaque: !["normal", "pixel", "text", "group"].some((value) => kind.includes(value)), reason: unsupportedReason(kind) }
      });
      if (childIds.length) walk(layer.layers, layer.id);
    });
  };
  walk(doc.layers, null);
  return { document: { documentId: String(doc.id), name: doc.name, width: number(doc.width), height: number(doc.height), resolution: number(doc.resolution), mode: normalizeEnum(doc.mode), bitDepth: number(doc.bitsPerChannel, 8), colorProfile: doc.colorProfileName || null }, layers };
}

function renderChanges(changes) {
  const container = document.getElementById("changes");
  const empty = document.getElementById("changes-empty");
  container.innerHTML = "";
  document.getElementById("changes-count").textContent = String(changes.length);
  document.getElementById("changes-total").textContent = String(changes.length);
  empty.hidden = changes.length > 0;
  for (const change of changes) {
    const row = document.createElement("div");
    row.className = "list-row change-row";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Select changed layer ${change.layerName}`);
    row.innerHTML = `<span class="row-glyph ${domainClass(change.domain)}" aria-hidden="true">${domainIcon(change.domain)}</span><span class="row-copy"><strong>${escapeHtml(change.layerName)}</strong><span>${escapeHtml(changeSummary(change))}</span></span><span class="change-domain">${escapeHtml(change.domain)}</span>`;
    const select = () => {
      container.querySelectorAll(".change-row.selected").forEach((entry) => entry.classList.remove("selected"));
      row.classList.add("selected");
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
}

function changeSummary(change) {
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
  if (busyNow) return;
  busy(true);
  show(label, false);
  try { await action(); }
  catch (error) { log(`Error: ${error.message || String(error)}`); show(error.message || String(error), true); }
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

function syncDocumentLabel() {
  const label = document.getElementById("document-name");
  if (!label) return;
  const doc = app.documents.length ? app.activeDocument : null;
  label.textContent = doc ? doc.name : "None open";
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
function textStyleFingerprint(textItem) { try { const style = textItem.characterStyle; return JSON.stringify({ font: style.fontName || null, size: number(style.size), tracking: number(style.tracking) }); } catch { return null; } }
function unsupportedReason(kind) { return ["normal", "pixel", "text", "group"].some((value) => kind.includes(value)) ? null : `Unsupported ${kind} properties are preserved in the PSD snapshot.`; }
function createRequestId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function setHelper(label, ok) {
  const element = document.getElementById("helper-status");
  element.className = `repo-state ${ok ? "ok" : "warning"}`;
  document.getElementById("repo-sync-status").textContent = label;
}
function busy(active) {
  busyNow = active;
  document.body.classList.toggle("is-busy", active);
  document.getElementById("progress").hidden = !active;
  document.querySelector(".capture-panel").classList.toggle("is-busy", active);
  for (const id of ["save-version", "scan", "rescan", "pull", "push", "show-status", "new-branch", "refresh", "new-pull-request", "create-tag", "tools-toggle", "header-menu"]) {
    const control = document.getElementById(id);
    control.setAttribute("aria-disabled", active ? "true" : "false");
    control.tabIndex = active ? -1 : 0;
  }
  for (const control of document.querySelectorAll(".merge-action")) control.setAttribute("aria-disabled", active || control.dataset.mergeable !== "true" ? "true" : "false");
}
function show(message, error) {
  const result = document.getElementById("result");
  result.textContent = message;
  result.className = error ? "error" : "success";
  const toast = document.getElementById("toast");
  toast.textContent = message;
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
  activity.textContent = `[${stamp}] ${message}\n${activity.textContent === "Ready." ? "" : activity.textContent}`.slice(0, 4000);
  activityEntryCount += 1;
  document.getElementById("activity-count").textContent = String(activityEntryCount);
}
function clearActivity() {
  document.getElementById("activity").textContent = "Ready.";
  activityEntryCount = 0;
  document.getElementById("activity-count").textContent = "0";
}
function setSyncStatus(label) { document.getElementById("repo-sync-status").textContent = label; }
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
