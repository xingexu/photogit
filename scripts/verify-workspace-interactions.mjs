// Browser-only simulated data. Never connects to Photoshop, a helper or Git.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const cli = process.env.PHOTOGIT_BROWSER_CLI || "agent-browser";
const run = (...args) => execFileSync(cli, ["--session", "photogit-studio-interactions", ...args], { encoding: "utf8" });
const value = expression => JSON.parse(run("eval", expression));
const click = selector => { run("scrollintoview", selector); run("click", selector); };
const settle = () => run("eval", `new Promise((resolve, reject) => {
  const start = Date.now(); const check = () => {
    const fading = Array.from(document.querySelectorAll('.panel-root, .view-panel, .tool-sheet')).some(e => e.style.opacity);
    if (!fading && !document.querySelector(".is-counting") && !document.body.classList.contains('is-busy')) return resolve(true);
    if (Date.now() - start > 3000) return reject(new Error('UI did not settle'));
    setTimeout(check, 16);
  }; check();
})`);
try {
  for (const theme of ["dark", "light"]) {
    run("set", "viewport", "420", "800");
    run("open", `http://127.0.0.1:8766/demo.html?panel&theme=${theme}`);
    run("wait", ".simulation-label"); settle();
    // Resize the live panel with a focused scan control and an unsaved draft.
    // Explicitly disable gap to exercise the native UXP spacing fallback.
    run("fill", "#message", "Draft survives docking");
    run("eval", `document.getElementById('rescan').focus();
      const style = document.createElement('style'); style.id = 'verify-no-gap';
      style.textContent = '* { gap: 0 !important; }'; document.head.appendChild(style)`);
    for (const width of [1180, 900, 899, 420]) {
      run("set", "viewport", String(width), "844");
      const layout = value(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const tiles = [...document.querySelectorAll('.tally-tile')].map(el => el.getBoundingClientRect());
        const scan = rect('.scan-card'), list = rect('.changes-card');
        const save = rect('.capture-panel'), preview = rect('#document-preview');
        return {
          gap: Math.min(tiles[1].left - tiles[0].right, tiles[2].left - tiles[1].right),
          verticalGap: ${width >= 900} ? list.top - scan.bottom : list.top - save.bottom,
          columnGap: preview.left - list.right,
          previewSaveGap: save.top - preview.bottom,
          focused: document.activeElement.id,
          draft: document.getElementById('message').value,
          scanParent: document.querySelector('.scan-panel').parentElement.className,
          previewParent: document.getElementById('document-preview').parentElement.className,
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      })()`);
      assert.ok(layout.gap >= 8, `Tally spacing at ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.verticalGap >= 15, `Card spacing at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.focused, 'rescan');
      assert.equal(layout.draft, 'Draft survives docking');
      assert.equal(layout.overflow, false);
      assert.equal(layout.scanParent, width >= 900 ? 'changes-main' : 'view-panel');
      assert.equal(layout.previewParent, width >= 900 ? 'changes-aside' : 'view-panel');
      if (width >= 900) {
        assert.ok(layout.columnGap >= 15);
        assert.ok(layout.previewSaveGap >= 15);
      }
    }
    run("eval", "document.getElementById('verify-no-gap').remove()");
    run("fill", "#message", "");
    click('[data-change-filter="text"]');
    assert.equal(value('document.querySelectorAll("#changes .change-row:not([hidden])").length'), 1);
    assert.equal(value('document.getElementById("changes-count").textContent'), "3");
    run("fill", "#changes-search", "nonexistent");
    assert.equal(value('document.getElementById("change-filter-empty").hidden'), false);
    click("#reset-change-filters");
    assert.equal(value('document.querySelectorAll("#changes .change-row:not([hidden])").length'), 3);
    assert.equal(value('document.activeElement.id'), "changes-search");
    // Slash stays text inside a search field.
    run("press", "/");
    assert.equal(value('document.getElementById("detail-sheet").hidden'), true);
    run("fill", "#changes-search", "");
    click('[data-destination="branches"]'); settle();
    assert.equal(value('document.getElementById("branches-view").hidden'), false);
    assert.equal(value('document.activeElement.id'), "branches-tab");
    run("press", "/");
    run("fill", "#command-input", "/docs"); run("press", "Enter"); settle();
    assert.equal(value('document.getElementById("docs-view").hidden'), false);
    click("#global-search");
    // A shortcut must not replace an already open dialog.
    run("press", "Control+k");
    assert.equal(value('document.querySelectorAll("#command-input").length'), 1);
    run("press", "Escape"); settle();
    assert.equal(value('document.activeElement.id'), "global-search");
    // Save is still the whole document, even with the display filtered.
    click("#changes-tab"); settle(); click('[data-change-filter="text"]');
    run("fill", "#message", "Studio interaction check"); run("press", "Enter"); settle();
    assert.equal(value('document.getElementById("changes-count").textContent'), "0");
    assert.equal(value('document.getElementById("history-count").textContent'), "4");
    click(".history-row");
    assert.equal(value('document.getElementById("detail-sheet").hidden'), false);
    assert.match(value('document.getElementById("detail-content").textContent'), /Simulated preview only/);
    run("press", "Escape"); settle();
    click("#appearance-toggle"); settle();
    assert.equal(value('document.documentElement.getAttribute("data-theme")'), theme === "dark" ? "light" : "dark");
    assert.equal(value('document.documentElement.scrollWidth > innerWidth'), false);
    assert.equal(run("errors").trim(), "", "Browser reported an unhandled error");
    console.log(`PASS ${theme}: responsive docking, draft/focus retention, spacing without gap, filters, reset/focus, branch shortcut, palette keyboard navigation, simulated save with active filter, version inspection, theme change.`);
  }
} finally { run("close"); }
