// Simulated visual matrix. Does not exercise Photoshop or Git operations.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const cli = process.env.PHOTOGIT_BROWSER_CLI || "agent-browser";
const out = resolve(process.env.PHOTOGIT_DESIGN_ARTIFACTS || "artifacts/startup-ui-20260905");
mkdirSync(out, { recursive: true });
const run = (...args) => {
  // At the 200px minimum height a partly visible target can have its center
  // outside the viewport. Scroll it fully into view before the real click.
  if (args[0] === "click") execFileSync(cli, ["--session", "photogit-design", "scrollintoview", args[1]], { encoding: "utf8" });
  return execFileSync(cli, ["--session", "photogit-design", ...args], { encoding: "utf8" });
};
const results = [];
const settle = () => run("eval", "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
for (const theme of ["dark", "light"]) {
  for (const [width, height] of [[230, 200], [320, 600], [420, 800], [900, 800]]) {
    run("set", "viewport", String(width), String(height));
    run("open", `http://127.0.0.1:8766/demo.html?panel&theme=${theme}`);
    run("wait", ".simulation-label");
    settle();
    const check = JSON.parse(run("eval", `({ width:innerWidth,height:innerHeight,theme:document.documentElement.getAttribute('data-theme'),overflow:document.documentElement.scrollWidth>innerWidth, tabs:document.querySelectorAll('[role=tab]').length, simulated:!!document.querySelector('.simulation-label') })`));
    if (check.overflow || check.tabs !== 6 || !check.simulated) throw new Error(JSON.stringify(check));
    run("screenshot", `${out}/demo-${theme}-${width}x${height}.png`);
    results.push(check);
    for (const view of ["history", "branches", "reviews", "activity", "docs"]) {
      run("click", `#${view}-tab`);
      settle();
      const state = JSON.parse(run("eval", `({overflow:document.documentElement.scrollWidth>innerWidth,active:!document.getElementById('${view}-view').hidden})`));
      if (state.overflow || !state.active) throw new Error(`${theme} ${width} ${view}: ${JSON.stringify(state)}`);
      if (width === 420) {
        run("eval", "window.scrollTo(0, 0)");
        settle();
        run("screenshot", `${out}/demo-${theme}-${view}-420x800.png`);
      }
    }
  }
}
run("set", "viewport", "320", "600");
for (const theme of ["dark", "light"]) {
  for (const state of ["empty", "long", "error", "setup", "loading"]) {
    run("open", `http://127.0.0.1:8766/demo.html?panel&theme=${theme}&state=${state}`);
    run("wait", ".simulation-label");
    settle();
    const overflow = JSON.parse(run("eval", "document.documentElement.scrollWidth>innerWidth"));
    if (overflow) throw new Error(`${theme} ${state} overflow`);
    run("screenshot", `${out}/demo-${theme}-${state}-320x600.png`);
  }
}
run("open", "http://127.0.0.1:8766/demo.html?panel");
run("wait", ".simulation-label");
if (!run("eval", 'document.documentElement.getAttribute("data-theme")').includes('light')) run("click", "#appearance-toggle");
run("reload"); run("wait", ".simulation-label");
if (!run("eval", 'document.documentElement.getAttribute("data-theme")').includes('light')) throw new Error("Theme did not persist");
run("click", "#global-search");
run("fill", "#command-input", "/docs"); run("press", "Enter");
if (JSON.parse(run("eval", 'document.getElementById("docs-view").hidden'))) throw new Error("Palette navigation failed");
run("click", "#global-search"); run("press", "Escape");
if (!JSON.parse(run("eval", 'document.getElementById("detail-sheet").hidden'))) throw new Error("Escape did not dismiss palette");
if (!run("eval", 'document.activeElement.id').includes("global-search")) throw new Error("Focus not restored");
writeFileSync(`${out}/demo-matrix.json`, JSON.stringify({ simulated: true, results, destinationsPerViewport: 6, statesAt320: ["empty", "long (500 rows)", "error", "setup", "loading"], persistence: true, paletteNavigation: true, dismissalAndFocus: true }, null, 2));
console.log("PASS: eight simulated viewports/themes, six destinations each, stress states, theme persistence, palette navigation and focus return.");
