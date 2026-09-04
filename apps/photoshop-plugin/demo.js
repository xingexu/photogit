const mount = document.getElementById("plugin-panel");
const demoParams = new URLSearchParams(location.search);
const timeScale = Math.max(1, Number(demoParams.get("timeScale")) || 1);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds * timeScale));
if (demoParams.has("panel")) document.body.classList.add("panel-only");
if (timeScale > 1) document.body.classList.add("recording");

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
let activityEntries = 0;
const demoReviews = [
  { branch: "campaign-type-b", ahead: 3, changeCount: 8, mergeable: true },
  { branch: "homepage-experiment", ahead: 2, changeCount: 5, mergeable: false }
];

boot();

async function boot() {
  const html = await fetch("index.html").then((response) => response.text());
  const parsed = new DOMParser().parseFromString(html, "text/html");
  mount.innerHTML = "";
  mount.appendChild(document.importNode(parsed.querySelector(".panel-root"), true));
  setupDemoPanel();
  if (demoParams.has("panel")) openPhotoGit();
  if (demoParams.has("autoplay")) autoplay();
  else document.querySelector(".demo-caption").classList.add("visible");
}

function setupDemoPanel() {
  byId("onboarding").hidden = true;
  byId("workspace").hidden = false;
  byId("project-status").textContent = "photogit-demo";
  byId("document-name").textContent = "document.psd";
  byId("branch-name").textContent = "live-option-b";
  byId("branch-name-detail").textContent = "live-option-b";
  byId("helper-status").className = "repo-state ok";
  byId("repo-sync-status").textContent = "Synced";
  byId("sync-status").textContent = "Sync";
  replaceDemoDropdown();
  renderChanges();
  renderHistory();
  renderReviews();
  byId("branches-count").textContent = "3";
  bind("changes-tab", () => selectTab("changes"));
  bind("history-tab", () => selectTab("history"));
  bind("branches-tab", () => selectTab("branches"));
  bind("reviews-tab", () => selectTab("reviews"));
  bind("activity-tab", () => selectTab("activity"));
  bind("scan", scan);
  bind("rescan", scan);
  bind("save-version", saveVersion);
  bind("pull", () => sync("Pulled live-option-b successfully.", "Pulled just now"));
  bind("push", () => sync("Changes shared successfully.", "Pushed just now"));
  bind("show-status", () => flashResult(changes.length ? `${changes.length} semantic changes ready to save.` : "Project is clean."));
  bind("refresh", () => flashResult("Workspace refreshed."));
  bind("new-branch", createBranch);
  bind("clear-activity", clearActivity);
  bind("global-search", () => { selectTab("history"); byId("history-search").focus(); });
  bind("header-menu", toggleToolsMenu);
  bind("tools-toggle", toggleToolsMenu);
  bind("tool-new-branch", () => { closeToolsMenu(); selectTab("branches"); byId("new-branch-name").focus(); });
  bind("tool-new-pr", () => { closeToolsMenu(); selectTab("reviews"); });
  bind("tool-conflicts", () => { closeToolsMenu(); selectTab("reviews"); flashResult("Review the conflicting files before merging.", true); });
  bind("tool-create-tag", openTagSheet);
  bind("tool-settings", () => { closeToolsMenu(); selectTab("activity"); addActivity("Repository settings inspected."); });
  bind("close-tag-sheet", closeTagSheet);
  bind("create-tag", createTag);
  bind("open-reviews", () => selectTab("reviews"));
  bind("new-pull-request", () => flashResult("Pull-request review opened in GitHub."));
  byId("branch-picker").addEventListener("change", switchBranch);
  byId("history-search").addEventListener("input", renderHistory);
  ["message", "history-search", "new-branch-name", "tag-name"].forEach(bindFieldState);
  document.getElementById("plugins-menu-trigger").addEventListener("click", togglePluginsMenu);
  document.getElementById("open-photogit").addEventListener("click", openPhotoGit);
  document.getElementById("pg-dock-tab").addEventListener("click", openPhotoGit);
}

function bindFieldState(id) {
  const field = byId(id);
  const sync = () => field.closest(".field-shell")?.classList.toggle("has-value", Boolean(field.value));
  field.addEventListener("input", sync);
  sync();
}

function toggleToolsMenu() {
  const menu = byId("tools-menu");
  const opening = menu.hidden;
  menu.hidden = !opening;
  menu.classList.toggle("is-open", opening);
  byId("header-menu").setAttribute("aria-expanded", opening ? "true" : "false");
  byId("tools-toggle").setAttribute("aria-expanded", opening ? "true" : "false");
}

function closeToolsMenu() {
  byId("tools-menu").hidden = true;
  byId("tools-menu").classList.remove("is-open");
  byId("header-menu").setAttribute("aria-expanded", "false");
  byId("tools-toggle").setAttribute("aria-expanded", "false");
}

function openTagSheet() {
  closeToolsMenu();
  byId("tag-sheet").hidden = false;
  byId("tag-sheet").classList.add("is-open");
  byId("tag-name").focus();
}

function closeTagSheet() {
  byId("tag-sheet").hidden = true;
  byId("tag-sheet").classList.remove("is-open");
}

function createTag() {
  const input = byId("tag-name");
  const tag = input.value.trim();
  if (!tag) return flashResult("Enter a tag such as v1.0.0.", true);
  input.value = "";
  input.closest(".field-shell")?.classList.remove("has-value");
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

function renderChanges() {
  const container = byId("changes");
  container.innerHTML = "";
  byId("changes-count").textContent = String(changes.length);
  byId("changes-total").textContent = String(changes.length);
  byId("changes-empty").hidden = changes.length > 0;
  changes.forEach((change, index) => {
    const row = document.createElement("div");
    row.className = "list-row change-row";
    row.tabIndex = 0;
    row.innerHTML = `<span class="row-glyph" aria-hidden="true">${domainIcon(change.domain)}</span><span class="row-copy"><strong>${change.layerName}</strong><span>${change.summary}</span></span><span class="change-domain">${change.domain}</span>`;
    row.addEventListener("click", () => {
      document.querySelectorAll(".layer").forEach((layer) => layer.classList.remove("active"));
      document.querySelectorAll(".layer")[index]?.classList.add("active");
      container.querySelectorAll(".change-row").forEach((entry) => entry.classList.remove("selected-change"));
      row.classList.add("selected-change");
      flashResult(`Selected “${change.layerName}” in Photoshop.`);
    });
    container.appendChild(row);
  });
}

function renderHistory() {
  const query = byId("history-search").value.trim().toLowerCase();
  const matching = versions.filter((version) => !query || [version.message, version.shortId, version.author, version.date].some((value) => value.toLowerCase().includes(query)));
  const container = byId("history");
  container.innerHTML = "";
  byId("history-count").textContent = String(versions.length);
  byId("history-total").textContent = `${versions.length} versions`;
  byId("history-empty").hidden = matching.length > 0;
  matching.forEach((version) => {
    const row = document.createElement("div");
    row.className = "list-row history-row";
    row.innerHTML = `<span class="history-marker" aria-hidden="true">${historyIcon()}</span><span class="row-copy"><strong>${version.message}</strong><span>${version.author} · ${version.date}</span></span><span class="commit-id">${version.shortId}</span>`;
    container.appendChild(row);
  });
}

function renderReviews() {
  const container = byId("reviews");
  container.innerHTML = "";
  byId("reviews-count").textContent = String(demoReviews.length);
  byId("review-provider").textContent = "GitHub · main ← live-option-b";
  for (const review of demoReviews) container.appendChild(createDemoReviewCard(review));
  byId("reviews-empty").hidden = demoReviews.length > 0;
  const preview = byId("review-preview");
  preview.hidden = false;
  const previewContent = byId("review-preview-content");
  previewContent.innerHTML = "";
  previewContent.appendChild(createDemoReviewCard(demoReviews[0]));
}

function createDemoReviewCard(review) {
  const card = document.createElement("article");
  card.className = "review-card";
  card.innerHTML = `<div class="review-title"><strong>${review.branch}</strong><span>${review.ahead} ahead</span></div><div class="review-meta"><span class="${review.mergeable ? "ready" : "blocked"}">${review.mergeable ? "Ready to merge" : "Review conflicts"}</span><span>·</span><span>${review.changeCount} files</span></div><div class="review-files" aria-hidden="true">document.psd\npreview.png</div><div class="review-actions"><div class="button button-quiet button-small compare-action" role="button" tabindex="0" aria-expanded="false">Compare</div><div class="button ${review.mergeable ? "button-primary" : "button-disabled"} button-small merge-action" role="button" tabindex="0" ${review.mergeable ? "" : "aria-disabled=\"true\""}>${review.mergeable ? "Merge" : "Blocked"}</div></div>`;
  card.querySelector(".compare-action").addEventListener("click", (event) => {
    const expanded = card.classList.toggle("details-open");
    card.querySelector(".review-files").setAttribute("aria-hidden", expanded ? "false" : "true");
    event.currentTarget.setAttribute("aria-expanded", expanded ? "true" : "false");
    event.currentTarget.textContent = expanded ? "Hide details" : "Compare";
  });
  if (review.mergeable) card.querySelector(".merge-action").addEventListener("click", () => {
    addActivity(`Merged ${review.branch} into live-option-b.`);
    flashResult(`Merged ${review.branch}.`);
  });
  return card;
}

async function scan() {
  await simulateBusy("Reviewing Photoshop layers…", 420);
  renderChanges();
  addActivity(`Found ${changes.length} semantic layer changes.`);
  flashResult(`Found ${changes.length} semantic layer changes.`);
}

async function saveVersion() {
  const message = byId("message").value.trim();
  if (!message) return flashResult("Describe what changed before saving.", true);
  await simulateBusy("Saving exact PSD, preview, and semantic data…", 620);
  versions.unshift({ message, author: "Zach", date: "Just now", shortId: "c84f2a7" });
  changes = [];
  byId("message").value = "";
  byId("history-search").value = "";
  byId("message").closest(".field-shell")?.classList.remove("has-value");
  byId("history-search").closest(".field-shell")?.classList.remove("has-value");
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
  byId("branches-count").textContent = String(byId("branch-picker").options.length);
  input.value = "";
  input.closest(".field-shell")?.classList.remove("has-value");
  addActivity(`Created and switched to ${name}.`);
  flashResult(`Created branch ${name}.`);
}

function switchBranch(event) {
  byId("branch-name").textContent = event.target.value;
  byId("branch-name-detail").textContent = event.target.value;
  addActivity(`Switched to ${event.target.value}.`);
  flashResult(`Switched to ${event.target.value}.`);
}

function sync(message, status) {
  byId("sync-status").textContent = status;
  addActivity(message);
  flashResult(message);
}

async function simulateBusy(label, duration) {
  const card = mount.querySelector(".capture-panel");
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

function addActivity(message) {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  byId("activity").textContent = `[${stamp}] ${message}\n${byId("activity").textContent === "Ready." ? "" : byId("activity").textContent}`;
  activityEntries += 1;
  byId("activity-count").textContent = String(activityEntries);
}

function clearActivity() {
  byId("activity").textContent = "Ready.";
  activityEntries = 0;
  byId("activity-count").textContent = "0";
}

function selectTab(name) {
  ["changes", "history", "branches", "reviews", "activity"].forEach((section) => {
    const active = section === name;
    byId(`${section}-view`).hidden = !active;
    byId(`${section}-tab`).classList.toggle("active", active);
    byId(`${section}-tab`).setAttribute("aria-selected", active ? "true" : "false");
    byId(`${section}-tab`).tabIndex = active ? 0 : -1;
  });
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
  await clickWithCursor(byId("scan"));
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

function bind(id, handler) { byId(id).addEventListener("click", handler); }
function byId(id) { return mount.querySelector(`#${id}`); }
function domainIcon(domain) {
  if (domain === "text") return '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13m-4 0h8"/></svg>';
  if (domain === "appearance") return '<svg viewBox="0 0 24 24"><path d="M12 4c4.4 0 8 3.1 8 7 0 3-2.2 4-4 4h-1.2c-.9 0-1.4 1-.9 1.8.8 1.3-.2 3.2-2.3 3.2C7.4 20 4 16.4 4 12s3.6-8 8-8Z"/><circle cx="8" cy="10" r=".8"/><circle cx="11" cy="7.5" r=".8"/><circle cx="15" cy="8.5" r=".8"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4m-16 4 8 4 8-4"/></svg>';
}
function historyIcon() { return '<svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/></svg>'; }
