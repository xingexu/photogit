const mount = document.getElementById("plugin-panel");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
if (new URLSearchParams(location.search).has("panel")) document.body.classList.add("panel-only");
let versions = [
  { message: "Refined hero typography", author: "Zach", date: "Today", shortId: "90511bb" },
  { message: "Established campaign direction", author: "Zach", date: "Today", shortId: "e3889c1" },
  { message: "Initial Photoshop document", author: "Zach", date: "Yesterday", shortId: "74b21fe" }
];
let changes = [
  { domain: "text", layerName: "Hero typography", summary: "Text content and type styling changed" },
  { domain: "appearance", layerName: "Gradient sphere", summary: "Opacity changed from 82% to 100%" },
  { domain: "structure", layerName: "CTA group", summary: "Layer moved above Supporting copy" }
];

boot();

async function boot() {
  const html = await fetch("index.html").then((response) => response.text());
  const parsed = new DOMParser().parseFromString(html, "text/html");
  mount.innerHTML = "";
  mount.appendChild(document.importNode(parsed.querySelector(".panel-root"), true));
  setupDemoPanel();
  if (new URLSearchParams(location.search).has("autoplay")) autoplay();
  else document.querySelector(".demo-caption").classList.add("visible");
}

function setupDemoPanel() {
  byId("onboarding").hidden = true;
  byId("workspace").hidden = false;
  byId("project-status").textContent = "photogit-demo";
  byId("document-name").textContent = "document.psd";
  byId("branch-name").textContent = "live-option-b";
  byId("helper-status").textContent = "Connected";
  byId("helper-status").className = "status-pill ok";
  replaceDemoDropdown();
  renderChanges();
  renderHistory();
  bind("changes-tab", () => selectTab("changes"));
  bind("history-tab", () => selectTab("history"));
  bind("scan", scan);
  bind("save-version", saveVersion);
  bind("pull", () => flashResult("Pulled live-option-b successfully."));
  bind("push", () => flashResult("Changes shared successfully."));
  bind("show-status", () => flashResult(changes.length ? `${changes.length} semantic changes ready to save.` : "Project is clean."));
  bind("refresh", () => flashResult("Workspace refreshed."));
  bind("new-branch", createBranch);
  byId("branch-picker").addEventListener("change", switchBranch);
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

function renderChanges() {
  const container = byId("changes");
  container.innerHTML = "";
  byId("changes-count").textContent = String(changes.length);
  byId("changes-empty").hidden = changes.length > 0;
  changes.forEach((change) => {
    const row = document.createElement("div");
    row.className = "list-row change-row";
    row.tabIndex = 0;
    row.innerHTML = `<span class="row-glyph ${domainClass(change.domain)}" aria-hidden="true">${domainIcon(change.domain)}</span><span class="row-copy"><strong>${change.layerName}</strong><span>${change.summary}</span></span><span class="change-domain">${change.domain}</span>`;
    row.addEventListener("click", () => {
      document.querySelectorAll(".layer").forEach((layer) => layer.classList.remove("active"));
      document.querySelector(".layer").classList.add("active");
      flashResult(`Selected “${change.layerName}” in Photoshop.`);
    });
    container.appendChild(row);
  });
}

function renderHistory() {
  const container = byId("history");
  container.innerHTML = "";
  byId("history-count").textContent = String(versions.length);
  versions.forEach((version) => {
    const row = document.createElement("div");
    row.className = "list-row history-row";
    row.innerHTML = `<span class="history-dot" aria-hidden="true">${historyIcon()}</span><span class="row-copy"><strong>${version.message}</strong><span>${version.author} · ${version.date}</span></span><span class="commit-id">${version.shortId}</span>`;
    container.appendChild(row);
  });
}

async function scan() {
  await simulateBusy("Scanning Photoshop layers…", 650);
  renderChanges();
  flashResult(`Found ${changes.length} semantic layer changes.`);
}

async function saveVersion() {
  const message = byId("message").value.trim();
  if (!message) return flashResult("Describe what changed before saving.", true);
  await simulateBusy("Saving exact PSD and preview…", 900);
  versions.unshift({ message, author: "Zach", date: "Just now", shortId: "c84f2a7" });
  changes = [];
  byId("message").value = "";
  renderChanges();
  renderHistory();
  byId("activity").textContent = `[Now] Saved c84f2a7: ${message}\n[Now] Captured exact PSD snapshot and preview.\n${byId("activity").textContent}`;
  flashResult("Saved version c84f2a7.");
}

function createBranch() {
  const input = byId("new-branch-name");
  if (!input.value.trim()) return flashResult("Enter a new branch name.", true);
  const option = document.createElement("option");
  option.value = input.value.trim();
  option.textContent = input.value.trim();
  byId("branch-picker").appendChild(option);
  byId("branch-picker").value = option.value;
  byId("branch-name").textContent = option.value;
  input.value = "";
  flashResult(`Created branch ${option.value}.`);
}

function switchBranch(event) {
  byId("branch-name").textContent = event.target.value;
  flashResult(`Switched to ${event.target.value}.`);
}

async function simulateBusy(label, duration) {
  const card = mount.querySelector(".commit-card");
  card.classList.add("is-busy");
  byId("result").textContent = label;
  byId("result").className = "";
  await wait(duration);
  card.classList.remove("is-busy");
}

function flashResult(message, error = false) {
  byId("result").textContent = message;
  byId("result").className = error ? "error" : "success";
}

function selectTab(name) {
  const showingChanges = name === "changes";
  byId("changes-view").hidden = !showingChanges;
  byId("history-view").hidden = showingChanges;
  byId("changes-tab").className = showingChanges ? "active" : "";
  byId("history-tab").className = showingChanges ? "" : "active";
}

function setCaption(step, heading, copy) {
  document.getElementById("demo-step").textContent = step;
  document.getElementById("demo-heading").textContent = heading;
  document.getElementById("demo-copy").textContent = copy;
  document.querySelector(".demo-caption").classList.add("visible");
}

async function moveCursor(target) {
  const cursor = document.getElementById("demo-cursor");
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  await wait(520);
  const rect = target.getBoundingClientRect();
  cursor.style.left = `${rect.left + rect.width * 0.62}px`;
  cursor.style.top = `${rect.top + rect.height * 0.55}px`;
  cursor.style.opacity = "1";
  await wait(760);
}

async function clickWithCursor(target) {
  await moveCursor(target);
  const cursor = document.getElementById("demo-cursor");
  cursor.classList.remove("click");
  void cursor.offsetWidth;
  cursor.classList.add("click");
  target.click();
  await wait(500);
}

async function typeMessage(value) {
  const field = byId("message");
  await moveCursor(field);
  field.focus();
  field.value = "";
  for (const character of value) {
    field.value += character;
    await wait(42);
  }
}

async function autoplay() {
  const caption = document.querySelector(".demo-caption");
  await wait(500);
  caption.classList.add("visible");
  await wait(1450);

  setCaption("01", "See what changed", "PhotoGit translates Photoshop edits into clear, semantic updates.");
  await clickWithCursor(byId("scan"));
  await wait(1200);

  setCaption("02", "Name the idea, not the file", "One checkpoint stores the exact PSD, a preview, and its intent.");
  await typeMessage("Polished campaign hero");
  await wait(350);
  await clickWithCursor(byId("save-version"));
  await wait(1550);

  setCaption("03", "A history designers can read", "Every visual direction stays named, dated, and recoverable.");
  await clickWithCursor(byId("history-tab"));
  await wait(1550);

  setCaption("04", "Branch without breaking flow", "Explore another direction, then return to any exact Photoshop state.");
  const select = byId("branch-picker");
  await moveCursor(select);
  select.value = "homepage-experiment";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  document.getElementById("demo-cursor").classList.add("click");
  await wait(1250);

  setCaption("05", "Share when it is ready", "Push the complete design history to your team.");
  await clickWithCursor(byId("push"));
  await wait(1700);

  document.querySelector(".demo-caption").classList.remove("visible");
  document.getElementById("demo-cursor").style.opacity = "0";
  const finale = document.getElementById("demo-finale");
  finale.hidden = false;
  await wait(80);
  finale.classList.add("visible");
}

function bind(id, handler) { byId(id).addEventListener("click", handler); }
function byId(id) { return mount.querySelector(`#${id}`); }
function domainClass(domain) { return domain; }
function domainIcon(domain) {
  if (domain === "text") return '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13m-4 0h8"/></svg>';
  if (domain === "appearance") return '<svg viewBox="0 0 24 24"><path d="M12 4c4.4 0 8 3.1 8 7 0 3-2.2 4-4 4h-1.2c-.9 0-1.4 1-.9 1.8.8 1.3-.2 3.2-2.3 3.2C7.4 20 4 16.4 4 12s3.6-8 8-8Z"/><circle cx="8" cy="10" r=".8"/><circle cx="11" cy="7.5" r=".8"/><circle cx="15" cy="8.5" r=".8"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4m-16 4 8 4 8-4"/></svg>';
}
function historyIcon() { return '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/></svg>'; }
