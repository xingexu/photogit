import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

async function fixture(reduce = false, cssFallback = false) {
  const root = resolve("apps/photoshop-plugin");
  const { document, window } = parseHTML(await readFile(resolve(root, "index.html"), "utf8"));
  let now = 0, nextId = 0;
  const timers = new Map<number, { at: number; work: () => void }>();
  const storage = { getItem: () => "dark", setItem: vi.fn() };
  const context = createContext({ document, localStorage: storage, Date: { now: () => now },
    matchMedia: cssFallback ? undefined : () => ({ matches: reduce }),
    getComputedStyle: () => ({ getPropertyValue: () => reduce ? "0" : "1" }),
    setTimeout: (work: () => void, delay: number) => { const id = ++nextId; timers.set(id, { at: now + delay, work }); return id; },
    clearTimeout: (id: number) => timers.delete(id)
  });
  for (const file of ["motion.js", "appearance.js"]) runInContext(await readFile(resolve(root, file), "utf8"), context);
  const advance = (ms: number) => {
    const end = now + ms;
    for (let guard = 0; guard < 1000; guard++) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].work();
    }
    now = end;
  };
  const id = (name: string) => document.getElementById(name)!;
  return { document, window, context, advance, id, timers, storage, panel: document.querySelector<HTMLElement>(".panel-root")! };
}

describe("Shared native-compatible PhotoGit motion", () => {
  it("fades theme out/in, persists intent before the midpoint, and restores opacity", async () => {
    const p = await fixture();
    p.id("appearance-toggle").click();
    expect(p.storage.setItem).toHaveBeenCalledWith("photogit.appearance", "light");
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("dark");
    p.advance(48); expect(Number(p.panel.style.opacity)).toBeLessThan(1);
    p.advance(48); expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    p.advance(200); expect(p.panel.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("rapid toggles settle on the last intended theme without stale callbacks", async () => {
    const p = await fixture();
    p.id("appearance-toggle").click(); p.advance(32);
    p.id("appearance-toggle").click(); p.advance(16);
    p.id("appearance-toggle").click(); p.advance(300);
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(p.id("appearance-toggle").getAttribute("aria-label")).toBe("Switch to Dark mode");
    expect(p.timers.size).toBe(0);
    expect(p.panel.style.opacity || "").toBe("");
  });
  it.each([false, true])("respects reduced motion (CSS fallback: %s)", async fallback => {
    const p = await fixture(true, fallback);
    p.id("appearance-toggle").click();
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(p.timers.size).toBe(0);
    expect(p.panel.style.opacity || "").toBe("");
  });
  it("button feedback never delays or duplicates an action and skips disabled controls", async () => {
    const p = await fixture(); const button = p.id("appearance-toggle");
    const action = vi.fn(); button.addEventListener("click", action);
    button.querySelector("svg")!.dispatchEvent(new p.window.Event("click", { bubbles: true }));
    expect(action).toHaveBeenCalledOnce();
    expect(Number(button.style.opacity)).toBeLessThan(1);
    p.advance(300); expect(action).toHaveBeenCalledOnce();
    button.setAttribute("aria-disabled", "true");
    // Test a non-theme disabled control; appearance itself intentionally remains enabled.
    const disabled = p.id("global-search"); disabled.click();
    expect(disabled.style.opacity || "").toBe("");
  });
  it("cancels a hidden view's fade without leaving it translucent when reopened", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    p.context.PhotoGitMotion.enter(view); view.hidden = true; p.advance(32);
    view.hidden = false;
    expect(view.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("still changes theme after a storage failure and reports the session-only preference", async () => {
    const p = await fixture(); p.storage.setItem.mockImplementation(() => { throw new Error("Unavailable"); });
    p.id("appearance-toggle").click(); p.advance(300);
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(p.id("appearance-note").hidden).toBe(false);
    expect(p.panel.style.opacity || "").toBe("");
  });
  it("keeps Docs directly browsable without the duplicate palette button", async () => {
    const p = await fixture();
    expect(p.document.getElementById("docs-open-palette")).toBeNull();
    expect(p.id("command-directory")).toBeTruthy();
    expect(p.id("global-search")).toBeTruthy();
  });
});
