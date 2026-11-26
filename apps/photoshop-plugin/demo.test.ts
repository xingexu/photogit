import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";

it("opens the browser simulation against the current production panel markup", async () => {
  const root = resolve("apps/photoshop-plugin");
  const load = (file: string) => readFile(resolve(root, file), "utf8");
  const [demoHtml, panelHtml, source] = await Promise.all([load("demo.html"), load("index.html"), load("demo.js")]);
  const { document, window } = parseHTML(demoHtml);
  const requirePlugin = createRequire(resolve(root, "demo.js"));
  const modules = {
    PhotoGitCommands: requirePlugin("./commands.js"),
    PhotoGitWorkspace: requirePlugin("./workspace-ui.js"),
    PhotoGitBranches: requirePlugin("./branch-view.js"),
    PhotoGitVersionInspector: requirePlugin("./version-inspector.js"),
    PhotoGitReviewInspector: requirePlugin("./review-inspector.js"),
    PhotoGitActivity: requirePlugin("./activity-view.js")
  };
  const context = createContext({
    window: modules, document, DOMParser: window.DOMParser, URLSearchParams,
    location: { search: "?panel" }, fetch: async () => ({ text: async () => panelHtml }),
    setTimeout, clearTimeout
  });
  runInContext(source.replace("boot();", "globalThis.demoReady = boot();"), context, { filename: "demo.js" });
  await context.demoReady;
  expect(document.querySelector(".simulation-label")?.textContent).toContain("no Photoshop or Git");
  expect(document.getElementById("history-total")!.hidden).toBe(true);
  expect(document.querySelectorAll("#changes .change-row")).toHaveLength(3);
  expect(document.querySelectorAll("#reviews .review-card")).toHaveLength(2);
  document.getElementById("history-tab")!.click();
  expect(document.getElementById("history-view")!.hidden).toBe(false);
  expect(document.getElementById("changes-view")!.hidden).toBe(true);
});
