// Simulated browser UI only. Never opens Photoshop documents or invokes real Git.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cli = process.env.PHOTOGIT_BROWSER_CLI || "agent-browser";
const out = resolve(process.env.PHOTOGIT_REFERENCE_ARTIFACTS || "/tmp/photogit-reference-detail-qa");
mkdirSync(out, { recursive: true });
const session = "photogit-reference-detail-qa";
const run = (...args) => execFileSync(cli, ["--session", session, ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const value = expression => JSON.parse(run("eval", expression));
const snapshot = () => run("snapshot", "-i");
const settle = () => run("eval", `new Promise((resolve, reject) => {
  const start = Date.now(); const check = () => {
    const moving = Array.from(document.querySelectorAll('.view-panel, .tool-sheet, .tools-menu')).some(e => e.style.opacity || e.classList.contains('is-closing'));
    if (!moving && !document.body.classList.contains('is-busy')) return requestAnimationFrame(() => resolve(true));
    if (Date.now() - start > 3000) return reject(new Error('UI failed to settle'));
    setTimeout(check, 16);
  }; check();
})`);
const click = selector => { run("scrollintoview", selector); run("click", selector); snapshot(); };
const closeSheet = () => { run("press", "Escape"); settle(); snapshot(); assert.equal(value('document.getElementById("detail-sheet").hidden'), true); };
const results = [];
const layoutFailures = [];
function open(theme, width = 1280, height = 900) {
  run("set", "viewport", String(width), String(height));
  run("open", `http://127.0.0.1:8766/demo.html?panel&theme=${theme}`);
  run("wait", ".simulation-label"); settle(); snapshot();
  assert.match(value('document.querySelector(".simulation-label").textContent'), /Simulated/);
}
function capture(name) {
  settle();
  run("eval", "window.scrollTo(0,0)");
  const layout = value(`({
    width: innerWidth, height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    activeView: document.querySelector('.view-panel:not([hidden])')?.id,
    titleFont: getComputedStyle(document.querySelector('.app-title h1')).fontFamily,
    fieldFont: getComputedStyle(document.getElementById('message')).fontFamily,
    selectedCount: document.querySelectorAll('[role="tab"][aria-selected="true"]').length,
    overflow: [...document.querySelectorAll('.field-shell, .version-inspector, .comparison-layout, .branch-row')]
      .filter(e => e.getClientRects().length && !e.closest('[hidden]') && e.scrollWidth > e.clientWidth + 2)
      .map(e => ({selector:e.id || e.className, width:e.clientWidth, content:e.scrollWidth}))
  })`);
  if (layout.documentWidth > layout.width) layoutFailures.push({ name, reason: "horizontal page overflow", ...layout });
  assert.equal(layout.titleFont, layout.fieldFont, `${name}: UI field and heading font families differ`);
  assert.equal(layout.selectedCount, 1);
  if (layout.overflow.length) layoutFailures.push({ name, reason: "container overflow", overflow: layout.overflow });
  const errors = run("errors").trim();
  assert.equal(errors, "", `${name}: browser error`);
  const path = `${out}/${name}.png`;
  run("screenshot", path);
  results.push({ name, simulated: true, path, ...layout });
  console.log(`${layout.overflow.length || layout.documentWidth > layout.width ? "LAYOUT ISSUE" : "PASS"} ${name}`);
}

try {
  for (const theme of ["dark", "light"]) {
    open(theme);
    click("#history-tab"); click(".history-row:first-child");
    assert.equal(value('document.getElementById("detail-sheet").hidden'), true);
    assert.match(value('document.getElementById("history-inspector").textContent'), /Refined hero typography/);
    assert.equal(value('document.querySelector(".history-row.selected").getAttribute("aria-pressed")'), "true");
    capture(`demo-${theme}-history-selected-1280x900`);
  }

  open("dark"); click("#branches-tab");
  assert.equal(value('document.querySelectorAll("#branch-list .branch-row.current").length'), 1);
  const currentBranch = value('document.getElementById("branch-name").textContent');
  run("eval", 'document.body.classList.add("is-busy")');
  click("#branch-list .branch-switch");
  assert.equal(value('document.getElementById("branch-name").textContent'), currentBranch, "Busy branch control changed the current branch");
  run("eval", 'document.body.classList.remove("is-busy")');
  capture("demo-dark-branches-1280x900");
  click("#branch-list .branch-switch");
  assert.equal(value('document.getElementById("detail-sheet").hidden'), false);
  assert.match(value('document.getElementById("detail-title").textContent'), /Switch design direction/);
  assert.equal(value('document.getElementById("branch-name").textContent'), currentBranch, "Branch changed before confirmation");
  closeSheet();

  click("#reviews-tab"); click("#reviews .review-card:first-child .compare-action");
  assert.equal(value('document.getElementById("review-inspector").dataset.mergeable'), "true");
  assert.match(value('document.querySelector("#review-inspector .comparison-direction").textContent'), /Sourcecampaign-type-b→Destinationlive-option-b/);
  capture("demo-dark-review-available-1280x900");
  run("eval", 'document.body.classList.add("is-busy")');
  click("#review-inspector .comparison-merge");
  assert.equal(value('document.getElementById("detail-sheet").hidden'), true, "Busy comparison opened merge confirmation");
  run("eval", 'document.body.classList.remove("is-busy")');
  click("#review-inspector .comparison-merge");
  assert.equal(value('document.getElementById("detail-sheet").hidden'), false);
  assert.match(value('document.getElementById("detail-content").textContent'), /confirmation step only/);
  closeSheet();
  click("#reviews .review-card:nth-child(2) .compare-action");
  assert.equal(value('document.getElementById("review-inspector").dataset.mergeable'), "false");
  assert.equal(value('document.querySelector("#review-inspector .comparison-merge") === null'), true);
  assert.match(value('document.getElementById("review-inspector").textContent'), /Resolve conflicting files outside PhotoGit/);
  capture("demo-dark-review-blocked-1280x900");

  click("#activity-tab"); capture("demo-dark-activity-1280x900");
  click("#docs-tab"); capture("demo-dark-docs-1280x900");

  open("dark", 420, 800);
  click("#global-search"); capture("demo-dark-command-palette-420x800");
  run("fill", "#command-input", "/history"); run("press", "Enter"); settle(); snapshot();
  assert.equal(value('document.getElementById("history-view").hidden'), false);
  click(".history-row:first-child");
  assert.equal(value('document.getElementById("detail-sheet").hidden'), false);
  capture("demo-dark-history-detail-420x800"); closeSheet();
  click("#header-menu"); click("#tool-create-tag");
  assert.equal(value('document.getElementById("tag-sheet").hidden'), false);
  capture("demo-dark-tag-dialog-420x800");
  run("press", "Escape"); settle(); snapshot();
  assert.equal(value('document.getElementById("tag-sheet").hidden'), true);

  open("light", 420, 800);
  click("#history-tab"); click(".history-row:first-child");
  capture("demo-light-history-detail-420x800"); closeSheet();

  writeFileSync(`${out}/report.json`, JSON.stringify({ simulated: true, nativeVerified: false, results, layoutFailures }, null, 2));
  assert.deepEqual(layoutFailures, [], "Reference detail layouts have overflow; see local report and screenshots");
  console.log(`PASS: ${results.length} simulated reference-detail screenshots, actual navigation/inspection clicks, guarded branch/merge controls, keyboard palette dispatch and dialog dismissal.`);
} finally { run("close"); }
