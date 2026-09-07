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
  id("startup-state").hidden = true;
  id("workspace").hidden = false;
  return { document, window, context, advance, id, timers, storage, panel: document.querySelector<HTMLElement>(".panel-root")! };
}

describe("Shared native-compatible PhotoGit motion", () => {
  it("keeps entrances readable and gently settles their final frame", async () => {
    const p = await fixture();
    const view = p.id("changes-view");
    p.context.PhotoGitMotion.enter(view);
    expect(Number(view.style.opacity)).toBe(0.94);
    p.advance(144);
    expect(Number(view.style.opacity)).toBeCloseTo(0.97, 3);
    p.advance(144);
    expect(view.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("applies and persists the theme immediately with only shallow foreground feedback", async () => {
    const p = await fixture();
    p.id("appearance-toggle").click();
    expect(p.storage.setItem).toHaveBeenCalledWith("photogit.appearance", "light");
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(Number(p.id("changes-view").style.opacity)).toBe(0.97);
    for (const element of [p.panel, p.document.querySelector<HTMLElement>(".app-header")!, p.document.querySelector<HTMLElement>(".section-nav")!]) {
      expect(element.style.opacity || "").toBe("");
    }
    p.advance(288);
    expect(p.id("changes-view").style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("rapid toggles settle on the last intended theme without stale callbacks", async () => {
    const p = await fixture();
    p.id("appearance-toggle").click(); p.advance(32);
    p.id("appearance-toggle").click(); p.advance(16);
    p.id("appearance-toggle").click(); p.advance(800);
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(p.id("appearance-toggle").getAttribute("aria-label")).toBe("Switch to Dark mode");
    expect(p.timers.size).toBe(0);
    expect(p.panel.style.opacity || "").toBe("");
  });
  it("restarts local feedback from its current opacity without delaying the next theme", async () => {
    const p = await fixture();
    p.id("appearance-toggle").click(); p.advance(96);
    const view = p.id("changes-view");
    const midway = view.style.opacity;
    expect(Number(midway)).toBeGreaterThan(0.97);
    expect(Number(midway)).toBeLessThan(1);
    p.id("appearance-toggle").click();
    expect(view.style.opacity).toBe(midway);
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("dark");
    p.advance(800);
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(p.panel.style.opacity || "").toBe("");
  });
  it("never inspects or repaints descendant colours, borders, or layout in the native host", async () => {
    const p = await fixture();
    p.context.require = () => ({});
    p.context.getComputedStyle = vi.fn((node: HTMLElement) => ({
      color: "#FFFFFF", backgroundColor: node === p.document.body ? "#1B1B1B" : "#272727", borderColor: "#505050"
    }));
    const button = p.id("save-version"); const view = p.id("changes-view");
    button.style.color = "#cccccc";
    button.style.backgroundColor = "#252525";
    button.style.borderColor = "#707070";
    const descendants = vi.spyOn(view, "querySelectorAll");
    p.context.PhotoGitMotion.enter(button);
    p.context.PhotoGitMotion.enter(view);
    expect(button.style.opacity || "").toBe("");
    p.advance(320);
    expect(descendants).not.toHaveBeenCalled();
    expect(p.context.getComputedStyle).not.toHaveBeenCalled();
    expect(button.style.color).toBe("#cccccc");
    expect(button.style.backgroundColor).toBe("#252525");
    expect(button.style.borderColor).toBe("#707070");
    expect(view.style.transform || "").toBe("");
    expect(view.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("prioritizes a visible dialog during a theme change without fading its background view", async () => {
    const p = await fixture(); const dialog = p.id("detail-sheet");
    dialog.hidden = false;
    const change = vi.fn();
    p.context.PhotoGitMotion.theme(change);
    expect(change).toHaveBeenCalledOnce();
    expect(Number(dialog.style.opacity)).toBe(0.97);
    expect(p.id("changes-view").style.opacity || "").toBe("");
    expect(p.panel.style.opacity || "").toBe("");
    p.advance(288);
    expect(p.timers.size).toBe(0);
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
  it("skips hidden ancestors and cancels pending motion when an ancestor becomes hidden", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    p.context.PhotoGitMotion.enter(view);
    p.id("workspace").hidden = true;
    p.advance(16);
    expect(view.style.opacity || "").toBe("");
    p.context.PhotoGitMotion.enter(view);
    expect(p.timers.size).toBe(0);
  });
  it("cancels a running transition when reduced motion becomes enabled", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    p.context.PhotoGitMotion.enter(view);
    p.context.matchMedia = () => ({ matches: true });
    p.advance(16);
    expect(view.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("restores an element's original inline opacity on cancellation and completion", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    view.style.opacity = "0.8";
    p.context.PhotoGitMotion.enter(view);
    expect(Number(view.style.opacity)).toBeCloseTo(0.8 * 0.94);
    p.context.PhotoGitMotion.cancel(view);
    expect(view.style.opacity).toBe("0.8");
    p.context.PhotoGitMotion.enter(view);
    p.advance(288);
    expect(view.style.opacity).toBe("0.8");
    expect(p.timers.size).toBe(0);
  });
  it("keeps nested click feedback from competing with its parent view's entrance", async () => {
    const p = await fixture(); const view = p.id("changes-view"); const button = p.id("save-version");
    button.setAttribute("aria-disabled", "false");
    p.context.PhotoGitMotion.enter(view);
    const action = vi.fn(); button.addEventListener("click", action);
    button.click();
    expect(action).toHaveBeenCalledOnce();
    expect(button.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(1);
    p.advance(288);
    expect(p.timers.size).toBe(0);
  });
  it("still changes theme synchronously when no foreground surface is available", async () => {
    const p = await fixture();
    p.id("workspace").hidden = true;
    const change = vi.fn();
    p.context.PhotoGitMotion.theme(change);
    expect(change).toHaveBeenCalledOnce();
    expect(p.timers.size).toBe(0);
    expect(p.panel.style.opacity || "").toBe("");
  });
  it("still changes theme after a storage failure and reports the session-only preference", async () => {
    const p = await fixture(); p.storage.setItem.mockImplementation(() => { throw new Error("Unavailable"); });
    p.id("appearance-toggle").click(); p.advance(600);
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
