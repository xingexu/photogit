const { app, core } = require("photoshop");
const { storage, entrypoints } = require("uxp");

entrypoints.setup({
  panels: {
    photogitPanel: {
      show() {}
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
let activityEntryCount = 0;

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
  bind("activity-tab", "click", () => selectTab("activity"));
  bind("history-search", "input", filterHistory);
  bind("clear-activity", "click", clearActivity);
  await refreshWorkspace();
});

function bind(id, event, handler) {
  const element = document.getElementById(id);
  const invoke = (inputEvent) => {
    if (element.getAttribute("aria-disabled") === "true") return;
    return handler(inputEvent);
  };
  element.addEventListener(event, invoke);
  if (event === "click" && element.getAttribute("role") === "button") {
    element.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
      keyEvent.preventDefault();
      invoke(keyEvent);
    });
  }
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
  const doc = app.documents.length ? app.activeDocument : null;
  document.getElementById("document-name").textContent = doc ? doc.name : "None open";
  document.getElementById("project-status").textContent = projectFolder ? projectFolder.name : "No project selected";
  document.getElementById("onboarding").hidden = Boolean(projectFolder && helperToken);
  document.getElementById("workspace").hidden = !projectFolder;
  if (!projectFolder || !helperToken) {
    setHelper(projectFolder ? "Setup needed" : "Not connected", false);
    return;
  }
  try {
    const status = await callHelper("status", {}, HELPER_HEALTH_TIMEOUT_MS);
    setHelper("Connected", true);
    await loadStatus(status);
    await Promise.all([loadBranches(), loadHistory()]);
  } catch { setHelper("Offline", false); }
}

async function loadStatus(existingResult) {
  const result = existingResult || await callHelper("status");
  document.getElementById("branch-name").textContent = result.branch;
  document.getElementById("branch-name-detail").textContent = result.branch;
  setSyncStatus(result.changeCount ? "Local changes" : "Up to date");
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

function renderHistory(versions) {
  const container = document.getElementById("history");
  const empty = document.getElementById("history-empty");
  container.innerHTML = "";
  empty.hidden = versions.length > 0;
  for (const version of versions) {
    const row = document.createElement("div");
    row.className = "list-row history-row";
    row.innerHTML = `<span class="history-marker" aria-hidden="true">${historyIcon()}</span><span class="row-copy"><strong>${escapeHtml(version.message)}</strong><span>${escapeHtml(version.author)} · ${escapeHtml(version.date.slice(0, 10))}</span></span><span class="commit-id">${escapeHtml(version.shortId)}</span>`;
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
    document.getElementById("message").value = "";
    document.getElementById("history-search").value = "";
    renderChanges([]);
    log(`Saved ${result.shortId}: ${message}`);
    show(`Saved version ${result.shortId}.`, false);
    await Promise.all([loadStatus(), loadBranches(), loadHistory()]);
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
    setSyncStatus("Pulled just now");
    show(`Pulled ${result.branch} successfully.`, false);
  });
}

async function push() {
  if (!ensureReady()) return;
  return run("Sharing versions…", async () => {
    const result = await callHelper("push");
    log(`Shared branch ${result.branch}.`);
    setSyncStatus("Pushed just now");
    show("Changes shared successfully.", false);
  });
}

async function showProjectStatus() {
  if (!ensureReady()) return;
  return run("Checking project…", async () => {
    const result = await callHelper("status");
    log(`${result.branch}: ${result.changeCount ? `${result.changeCount} project file change(s)` : "clean"}.`);
    setSyncStatus(result.changeCount ? "Local changes" : "Up to date");
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
    log(`Created and switched to ${name}.`);
    await loadBranches();
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
    row.innerHTML = `<span class="row-glyph ${domainClass(change.domain)}" aria-hidden="true">${domainIcon(change.domain)}</span><span class="row-copy"><strong>${escapeHtml(change.layerName)}</strong><span>${escapeHtml(change.summary)}</span></span><span class="change-domain">${escapeHtml(change.domain)}</span>`;
    row.addEventListener("click", () => selectPhotoshopLayer(change.photoshopId));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") selectPhotoshopLayer(change.photoshopId);
    });
    container.appendChild(row);
  }
}

async function selectPhotoshopLayer(photoshopId) {
  if (!photoshopId) return;
  try {
    await core.executeAsModal(async () => {
      const layer = app.activeDocument.layers.getById(photoshopId);
      if (layer) await layer.select(false);
    }, { commandName: "Select changed layer" });
  } catch { /* Layer may have been removed. */ }
}

function selectTab(name) {
  for (const section of ["changes", "history", "branches", "activity"]) {
    const active = section === name;
    document.getElementById(`${section}-view`).hidden = !active;
    const tab = document.getElementById(`${section}-tab`);
    tab.className = active ? "active" : "";
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
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

function bounds(value) { return { left: number(value?.left), top: number(value?.top), right: number(value?.right), bottom: number(value?.bottom) }; }
function number(value, fallback = 0) { const candidate = typeof value === "object" && value !== null && "value" in value ? value.value : value; return Number.isFinite(Number(candidate)) ? Number(candidate) : fallback; }
function normalizeEnum(value) { return String(value ?? "unknown").replace(/^.*\./, "").toLowerCase(); }
function textStyleFingerprint(textItem) { try { const style = textItem.characterStyle; return JSON.stringify({ font: style.fontName || null, size: number(style.size), tracking: number(style.tracking) }); } catch { return null; } }
function unsupportedReason(kind) { return ["normal", "pixel", "text", "group"].some((value) => kind.includes(value)) ? null : `Unsupported ${kind} properties are preserved in the PSD snapshot.`; }
function createRequestId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function setHelper(label, ok) { const element = document.getElementById("helper-status"); element.textContent = label; element.className = `connection-state ${ok ? "ok" : "warning"}`; }
function busy(active) {
  busyNow = active;
  document.getElementById("progress").hidden = !active;
  document.querySelector(".capture-panel").classList.toggle("is-busy", active);
  for (const id of ["save-version", "scan", "rescan", "pull", "push", "show-status", "new-branch", "refresh"]) {
    const control = document.getElementById(id);
    control.setAttribute("aria-disabled", active ? "true" : "false");
    control.tabIndex = active ? -1 : 0;
  }
}
function show(message, error) { const result = document.getElementById("result"); result.textContent = message; result.className = error ? "error" : "success"; }
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
function setSyncStatus(label) { document.getElementById("sync-status").textContent = label; }
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
