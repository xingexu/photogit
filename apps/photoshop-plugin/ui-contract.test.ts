import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pluginFile = (name: string) => readFile(resolve(process.cwd(), "apps/photoshop-plugin", name), "utf8");

describe("PhotoGit panel UI contract", () => {
  it("uses one production logo asset throughout the panel and demonstration", async () => {
    const [html, demo] = await Promise.all([pluginFile("index.html"), pluginFile("demo.html")]);
    expect(html.match(/icons\/photogit-git-mark\.png/g)).toHaveLength(2);
    expect(demo.match(/icons\/photogit-git-mark\.png/g)).toHaveLength(3);
    expect(html).toContain('styles.css?v=8');
    expect(html).not.toContain("<span>P</span><span>g</span>");
    expect(demo).not.toContain("<span>P</span><span>g</span>");
  });

  it("keeps every text entry in the shared accessible field treatment", async () => {
    const html = await pluginFile("index.html");
    expect(html).toContain('<html lang="en">');
    for (const id of ["message", "history-search", "new-branch-name", "tag-name"]) {
      expect(html).toMatch(new RegExp(`class="[^"]*field-shell[^"]*"[\\s\\S]{0,300}<input id="${id}"`));
      expect(html).toMatch(new RegExp(`<input id="${id}"[^>]+aria-label=`));
    }
    expect(html).toContain('id="message" type="text" maxlength="500"');
    expect(html).toContain('id="new-branch-name" type="text" maxlength="200"');
    expect(html).toContain('id="tag-name" type="text" maxlength="100"');
  });

  it("provides complete keyboard-readable section navigation", async () => {
    const html = await pluginFile("index.html");
    for (const section of ["changes", "history", "branches", "reviews", "activity"]) {
      expect(html).toContain(`id="${section}-tab"`);
      expect(html).toContain(`aria-controls="${section}-view"`);
      expect(html).toMatch(new RegExp(`id="${section}-view"[^>]+role="tabpanel"[^>]+aria-labelledby="${section}-tab"`));
    }
    expect(html).toContain('role="tablist"');
    for (const label of ["Changes", "History", "Branches", "Reviews", "Activity"]) expect(html).toContain(`role="tab" tabindex="${label === "Changes" ? "0" : "-1"}" aria-label="${label}"`);
  });

  it("retains explicit names when narrow mode hides visible control labels", async () => {
    const html = await pluginFile("index.html");
    expect(html).toContain('id="rescan" class="button button-quiet button-small" role="button" tabindex="0" aria-label="Scan Photoshop now"');
    expect(html).toContain('id="pull" class="footer-action" role="button" tabindex="0" aria-label="Pull shared changes"');
    expect(html).toContain('id="push" class="footer-action" role="button" tabindex="0" aria-label="Push saved versions"');
    expect(html).toContain('id="show-status" class="footer-action" role="button" tabindex="0" aria-label="Check sync status"');
  });

  it("does not use subminimum pixel text and covers narrow, short, and reduced-motion modes", async () => {
    const css = await pluginFile("styles.css");
    const pixelSizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
    expect(Math.min(...pixelSizes)).toBeGreaterThanOrEqual(11);
    expect(css).toContain("@media (max-width: 270px)");
    expect(css).toContain("@media (max-height: 650px)");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses distinct display typography and one outer scroll instead of nested history scrolling", async () => {
    const css = await pluginFile("styles.css");
    expect(css).toContain("--font-display:");
    expect(css).toMatch(/h1, h2 \{ font-family: var\(--font-display\); \}/);
    expect(css).toMatch(/\.list \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
    expect(css).toContain(".history-meta");
    expect(css).toMatch(/\.section-nav \{[\s\S]*?position: sticky;[\s\S]*?top: 8px;/);
    expect(css).toMatch(/\.sync-panel \{[\s\S]*?position: sticky;[\s\S]*?bottom: 0;/);
    expect(css).toContain("@media (max-height: 420px)");
  });

  it("keeps the visual hierarchy to two primary type treatments and flat editorial lists", async () => {
    const css = await pluginFile("styles.css");
    expect(css).toMatch(/\.eyebrow \{[\s\S]*?font-family: var\(--font-ui\);/);
    expect(css).toMatch(/\.meta-chip \{[\s\S]*?font-family: var\(--font-ui\);/);
    expect(css).toMatch(/\.list-row \{[\s\S]*?border-bottom: 1px solid var\(--stroke\);[\s\S]*?background: transparent;/);
    expect(css).toMatch(/\.review-card \{[\s\S]*?border-bottom: 1px solid var\(--stroke\);[\s\S]*?background: transparent;/);
    expect(css).toContain('.nav-item b[data-empty="true"]');
  });

  it("treats repository tools as a keyboard menu and the tag surface as a modal dialog", async () => {
    const [html, javascript] = await Promise.all([pluginFile("index.html"), pluginFile("index.js")]);
    expect(html).toContain('id="tools-menu" class="tools-menu liquid-card" role="menu"');
    expect(html).toContain('class="tool-item" role="menuitem" tabindex="-1"');
    expect(html).toContain('id="tag-sheet" class="tool-sheet liquid-card" role="dialog" aria-modal="true"');
    expect(html).toContain('id="surface-backdrop"');
    expect(javascript).toContain("handleMenuKeyboard");
    expect(javascript).toContain('event.key === "Tab"');
  });

  it("bounds helper responses and removes timed-out bridge requests", async () => {
    const javascript = await pluginFile("index.js");
    expect(javascript).toContain("MAX_HELPER_IO_BYTES");
    expect(javascript).toContain("utf8ByteLength(requestText) > MAX_HELPER_IO_BYTES");
    expect(javascript).toContain("utf8ByteLength(responseText) > MAX_HELPER_IO_BYTES");
    expect(javascript).toMatch(/if \(!responseFile\) \{[\s\S]*?removeEntry\(requests,[\s\S]*?helper is offline/);
    expect(javascript).toMatch(/if \(!responseFile\) \{[\s\S]*?removeEntry\(responses,/);
    expect(javascript).toContain("setCount(\"activity-count\", 0)");
  });

  it("captures deeply nested documents iteratively and caps visible change rows", async () => {
    const javascript = await pluginFile("index.js");
    expect(javascript).toContain("while (pending.length)");
    expect(javascript).toContain("layers.length >= MAX_CAPTURE_LAYERS");
    expect(javascript).toContain("changes.slice(0, MAX_VISIBLE_CHANGES)");
  });

  it("automatically rescans Photoshop mutations and fingerprints pixel-layer content", async () => {
    const [html, javascript] = await Promise.all([pluginFile("index.html"), pluginFile("index.js")]);
    expect(html).toContain('id="watch-status" class="watch-status ready" role="status" aria-live="polite"');
    expect(html).toContain("PhotoGit is watching Photoshop");
    expect(javascript).toContain('action.addNotificationListener(["all"], onPhotoshopNotification)');
    expect(javascript).toContain("queueAutomaticScan(normalized)");
    expect(javascript).toContain("await captureDocument(app.activeDocument)");
    expect(javascript).toContain("await imaging.getPixels");
    expect(javascript).toContain("pixels-v1:");
    expect(javascript).toContain("content_fingerprint_skipped");
  });

  it("validates helper payload shapes and only opens HTTPS GitHub review links", async () => {
    const javascript = await pluginFile("index.js");
    expect(javascript).toContain("validateHelperResult(operation, body.result)");
    expect(javascript).toContain("requireHelperArray(result.versions");
    expect(javascript).toContain("requireHelperArray(result.reviews");
    expect(javascript).toMatch(/\^https:\\\/\\\/github\\\.com/);
    expect(javascript).toContain("safeInlineText(body.error.message");
  });

  it("keeps IDs and accessibility references internally consistent", async () => {
    const html = await pluginFile("index.html");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const target of [...html.matchAll(/\baria-controls="([^"]+)"/g)].map((match) => match[1])) expect(ids).toContain(target);
    for (const target of [...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((match) => match[1])) expect(ids).toContain(target);
    for (const tag of html.match(/<[^>]+\brole="button"[^>]*>/g) ?? []) expect(tag).toMatch(/\btabindex="0"/);
    const tabs = html.match(/<[^>]+\brole="tab"[^>]*>/g) ?? [];
    expect(tabs.filter((tag) => /\btabindex="0"/.test(tag))).toHaveLength(1);
    for (const tag of tabs) expect(tag).toMatch(/\btabindex="(?:0|-1)"/);
  });

  it("binds every static button and never requests a raw remote URL from the helper", async () => {
    const [html, javascript] = await Promise.all([pluginFile("index.html"), pluginFile("index.js")]);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    for (const target of [...javascript.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1])) expect(ids).toContain(target);
    const bound = new Set([...javascript.matchAll(/\bbind\("([^"]+)"/g)].map((match) => match[1]));
    const buttons = [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]+\brole="button"[^>]*>/g)].map((match) => match[1]);
    for (const id of buttons) expect(bound).toContain(id);
    expect(javascript).toContain("repository.remoteConfigured");
    expect(javascript).not.toContain("repository.remoteUrl");
  });

  it("keeps transient surfaces inside the visible panel at every scroll position", async () => {
    const [css, demo] = await Promise.all([pluginFile("styles.css"), pluginFile("demo.js")]);
    expect(css).toMatch(/\.tools-menu \{[\s\S]*?position: fixed;/);
    expect(css).toMatch(/\.tool-sheet \{[\s\S]*?position: fixed;/);
    expect(css).toMatch(/\.tools-menu \{[\s\S]*?max-height: calc\(100vh - 94px\);[\s\S]*?overflow-y: auto;/);
    expect(css).toMatch(/\.tool-sheet \{[\s\S]*?max-height: calc\(100vh - 94px\);[\s\S]*?overflow-y: auto;/);
    expect(css).toMatch(/\.surface-backdrop \{[\s\S]*?position: fixed;/);
    expect(css).toMatch(/\.toast \{[\s\S]*?max-height: calc\(100vh - 94px\);[\s\S]*?overflow-y: auto;/);
    expect(demo).toContain('menu.classList.toggle("from-header"');
    expect(demo).toContain("handleMenuKeyboard");
    expect(demo).toContain("closeSurface");
  });

  it("keeps the plugin and demonstration palettes strictly neutral", async () => {
    const stylesheets = await Promise.all([pluginFile("styles.css"), pluginFile("demo.css")]);
    for (const css of stylesheets) {
      const colors = [...css.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})(?![0-9a-f])/gi)].map((match) => match[1]);
      for (const color of colors) {
        const normalized = color.length === 3 ? [...color].map((channel) => channel + channel).join("") : color;
        const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
        expect(Math.max(...channels) - Math.min(...channels), color).toBeLessThanOrEqual(10);
      }
      const functionalColors = [...css.matchAll(/rgba?\(\s*([0-9.]+)[, ]+\s*([0-9.]+)[, ]+\s*([0-9.]+)/gi)];
      for (const color of functionalColors) {
        const channels = color.slice(1, 4).map(Number);
        expect(Math.max(...channels) - Math.min(...channels), color[0]).toBeLessThanOrEqual(10);
      }
    }
  });
});
