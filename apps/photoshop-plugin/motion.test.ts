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
      now = Math.max(now, next[1].at); timers.delete(next[0]); next[1].work();
    }
    now = end;
  };
  const id = (name: string) => document.getElementById(name)!;
  id("startup-state").hidden = true;
  id("workspace").hidden = false;
  return { document, window, context, advance, stall: (ms: number) => { now += ms; }, id, timers, storage, panel: document.querySelector<HTMLElement>(".panel-root")! };
}

describe("Shared native-compatible PhotoGit motion", () => {
  it("visibly fades entrances and restores their final frame", async () => {
    const p = await fixture();
    const view = p.id("changes-view");
    p.context.PhotoGitMotion.enter(view);
    expect(Number(view.style.opacity)).toBe(0);
    p.advance(384);
    expect(Number(view.style.opacity)).toBeCloseTo(0.5, 3);
    p.advance(384);
    expect(view.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
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
    p.advance(768);
    expect(descendants).not.toHaveBeenCalled();
    expect(p.context.getComputedStyle).not.toHaveBeenCalled();
    expect(button.style.color).toBe("#cccccc");
    expect(button.style.backgroundColor).toBe("#252525");
    expect(button.style.borderColor).toBe("#707070");
    expect(view.style.transform || "").toBe("");
    expect(view.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it.each([false, true])("respects reduced motion (CSS fallback: %s)", async fallback => {
    const p = await fixture(true, fallback);
    p.context.PhotoGitMotion.enter(p.id("changes-view"));
    expect(p.timers.size).toBe(0);
    expect(p.panel.style.opacity || "").toBe("");
  });
  it("button feedback never delays or duplicates an action and skips disabled controls", async () => {
    const p = await fixture(); const button = p.id("global-search");
    button.setAttribute("aria-disabled", "false");
    const action = vi.fn(); button.addEventListener("click", action);
    button.querySelector("svg")!.dispatchEvent(new p.window.Event("click", { bubbles: true }));
    expect(action).toHaveBeenCalledOnce();
    expect(Number(button.style.opacity)).toBeLessThan(1);
    p.advance(300); expect(action).toHaveBeenCalledOnce();
    button.setAttribute("aria-disabled", "true");
    button.click();
    expect(button.style.opacity || "").toBe("");
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
    expect(Number(view.style.opacity)).toBeCloseTo(0.8 * 0);
    p.context.PhotoGitMotion.cancel(view);
    expect(view.style.opacity).toBe("0.8");
    p.context.PhotoGitMotion.enter(view);
    p.advance(768);
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
    p.advance(768);
    expect(p.timers.size).toBe(0);
  });
  it("fades out before dismissal and completes exactly once", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    const finish = vi.fn(() => { view.hidden = true; });
    p.context.PhotoGitMotion.exit(view, finish);
    p.advance(192);
    expect(Number(view.style.opacity)).toBeCloseTo(0.5, 3);
    expect(view.hidden).toBe(false); expect(finish).not.toHaveBeenCalled();
    p.advance(192);
    expect(view.hidden).toBe(true); expect(finish).toHaveBeenCalledOnce();
    expect(view.style.opacity || "").toBe(""); expect(p.timers.size).toBe(0);
  });
  it("reopening a fading surface cancels its old dismissal", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    const finish = vi.fn();
    p.context.PhotoGitMotion.exit(view, finish); p.advance(64);
    const midway = view.style.opacity;
    p.context.PhotoGitMotion.enter(view);
    expect(view.style.opacity).toBe(midway);
    p.advance(800);
    expect(finish).not.toHaveBeenCalled(); expect(view.hidden).toBe(false);
    expect(view.style.opacity || "").toBe(""); expect(p.timers.size).toBe(0);
  });
  it("dismisses immediately under reduced motion", async () => {
    const p = await fixture(true); const finish = vi.fn();
    p.context.PhotoGitMotion.exit(p.id("changes-view"), finish);
    expect(finish).toHaveBeenCalledOnce(); expect(p.timers.size).toBe(0);
  });
  it("staggers history content without CSS animation support", async () => {
    const p = await fixture();
    const first = p.document.createElement("div"), second = p.document.createElement("div");
    p.id("changes-view").append(first, second);
    p.context.PhotoGitMotion.reveal(first, 0);
    p.context.PhotoGitMotion.reveal(second, 208);
    p.advance(160);
    expect(Number(first.style.opacity)).toBeGreaterThan(0);
    expect(Number(second.style.opacity)).toBe(0);
    p.advance(240);
    expect(Number(first.style.opacity)).toBeGreaterThan(Number(second.style.opacity));
    p.advance(640);
    expect(first.style.opacity || "").toBe("");
    expect(second.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("preserves visible fade frames after a busy Photoshop render", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    p.context.PhotoGitMotion.enter(view);
    p.stall(900); p.advance(0);
    expect(Number(view.style.opacity)).toBeGreaterThan(0);
    expect(Number(view.style.opacity)).toBeLessThan(0.2);
    p.advance(768);
    expect(view.style.opacity || "").toBe("");
    expect(p.timers.size).toBe(0);
  });
  it("keeps Docs directly browsable without the duplicate palette button", async () => {
    const p = await fixture();
    expect(p.document.getElementById("docs-open-palette")).toBeNull();
    expect(p.id("command-directory")).toBeTruthy();
    expect(p.id("global-search")).toBeTruthy();
  });
});
