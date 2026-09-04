import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pluginFile = (name: string) => readFile(resolve(process.cwd(), "apps/photoshop-plugin", name), "utf8");

describe("PhotoGit panel UI contract", () => {
  it("keeps every text entry in the shared accessible field treatment", async () => {
    const html = await pluginFile("index.html");
    expect(html).toContain('<html lang="en">');
    for (const id of ["message", "history-search", "new-branch-name", "tag-name"]) {
      expect(html).toMatch(new RegExp(`class="[^"]*field-shell[^"]*"[\\s\\S]{0,300}<input id="${id}"`));
      expect(html).toMatch(new RegExp(`<input id="${id}"[^>]+aria-label=`));
    }
  });

  it("provides complete keyboard-readable section navigation", async () => {
    const html = await pluginFile("index.html");
    for (const section of ["changes", "history", "branches", "reviews", "activity"]) {
      expect(html).toContain(`id="${section}-tab"`);
      expect(html).toContain(`aria-controls="${section}-view"`);
    }
    expect(html).toContain('role="tablist"');
  });

  it("does not use subminimum pixel text and covers narrow, short, and reduced-motion modes", async () => {
    const css = await pluginFile("styles.css");
    const pixelSizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
    expect(Math.min(...pixelSizes)).toBeGreaterThanOrEqual(10);
    expect(css).toContain("@media (max-width: 270px)");
    expect(css).toContain("@media (max-height: 650px)");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
