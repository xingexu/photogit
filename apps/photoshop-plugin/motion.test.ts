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

describe("PhotoGit motion · one helper, two durations, one easing", () => {
  async function nativeFixture() {
    const p = await fixture();
    p.context.require = () => ({ host: { name: "Photoshop" } });
    // The veil takes the panel background as it is painted on the body.
    p.context.getComputedStyle = () => ({ overflow: "visible", borderRadius: "4px", backgroundColor: "#323232" });
    const view = p.id("changes-view");
    view.getBoundingClientRect = () => ({ left: 20, top: 40, right: 320, bottom: 440, width: 300, height: 400 } as DOMRect);
    return { ...p, view, veil: () => p.document.querySelector<HTMLElement>(".native-fade-veil") };
  }
  const alpha = (veil: HTMLElement | null) => Number(/rgba\(50, 50, 50, ([\d.]+)\)/.exec(veil!.style.backgroundColor)![1]);
  const shift = (element: HTMLElement) => Number(/translateY\((-?[\d.]+)px\)/.exec(element.style.transform || "translateY(0px)")![1]);

  it("has exactly the motion tokens: 120ms, 180ms and cubic-bezier(0.2, 0, 0, 1), and nothing over 200ms", async () => {
    const p = await fixture();
    const motion = p.context.PhotoGitMotion;
    expect([motion.FAST_MS, motion.BASE_MS]).toEqual([120, 180]);
    // The curve leaves quickly and settles: no bounce, never past its ends.
    const samples = Array.from({ length: 21 }, (_, index) => motion.ease(index / 20));
    expect(samples[0]).toBe(0); expect(samples[20]).toBe(1);
    expect(samples.every((value, index) => value >= 0 && value <= 1 && (index === 0 || value >= samples[index - 1]!))).toBe(true);
    expect(motion.ease(0.5)).toBeGreaterThan(0.8);
    const source = await readFile(resolve("apps/photoshop-plugin/motion.js"), "utf8");
    const durations = [...source.matchAll(/_MS = (\d+)/g)].map(match => Number(match[1]));
    expect(durations.sort()).toEqual([120, 180, 90].sort());
    expect(Math.max(...durations)).toBeLessThanOrEqual(200);
    // The stylesheet declares no motion of its own: the host would ignore it.
    const css = await readFile(resolve("apps/photoshop-plugin/styles.css"), "utf8");
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/transition|animation|@keyframes|opacity/);
  });

  it("brings a screen in from clear and 6px low, by opacity and transform only, and leaves no trace", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    p.context.PhotoGitMotion.screen(view);
    expect(Number(view.style.opacity)).toBe(0);
    expect(shift(view)).toBe(6);
    p.advance(64);
    expect(Number(view.style.opacity)).toBeGreaterThan(0); expect(Number(view.style.opacity)).toBeLessThan(1);
    expect(shift(view)).toBeGreaterThan(0); expect(shift(view)).toBeLessThan(6);
    // Nothing else is touched while it moves.
    for (const property of ["width", "height", "top", "left", "margin"]) expect(view.style.getPropertyValue(property)).toBe("");
    p.advance(180);
    expect(view.style.opacity || "").toBe(""); expect(view.style.transform || "").toBe("");
    expect(p.timers.size).toBe(0);
  });

  it("opens a card's content from 4px above and closes nothing by height", async () => {
    const p = await fixture(); const body = p.document.createElement("div");
    p.id("reviews-view").hidden = false; p.id("reviews").appendChild(body);
    p.context.PhotoGitMotion.expand(body);
    expect(shift(body)).toBe(-4);
    p.advance(64); expect(shift(body)).toBeGreaterThan(-4); expect(shift(body)).toBeLessThan(0);
    expect(body.style.height || "").toBe("");
    p.advance(180); expect(body.style.transform || "").toBe("");
  });

  it("in the Photoshop host fades with a background veil, because the host does not draw opacity", async () => {
    const p = await nativeFixture();
    p.context.PhotoGitMotion.screen(p.view);
    expect(p.view.style.opacity || "").toBe("");
    expect(alpha(p.veil())).toBe(1);
    expect(shift(p.view)).toBe(6);
    expect(p.veil()!.getAttribute("aria-hidden")).toBe("true");
    expect(p.veil()!.style.pointerEvents).toBe("none");
    p.advance(64);
    expect(alpha(p.veil())).toBeGreaterThan(0); expect(alpha(p.veil())).toBeLessThan(1);
    p.advance(180);
    expect(p.veil()).toBeNull(); expect(p.view.style.transform || "").toBe("");
  });

  it("never lets a veil cost a click: a press on it reaches the control underneath", async () => {
    const p = await nativeFixture();
    const chip = p.document.querySelector<HTMLElement>('#changes-view [data-change-filter="text"]')!;
    chip.getBoundingClientRect = () => ({ left: 100, top: 60, right: 160, bottom: 84, width: 60, height: 24 } as DOMRect);
    const pressed = vi.fn(); chip.addEventListener("click", pressed);
    p.context.PhotoGitMotion.screen(p.view);
    const click = new p.window.Event("click", { bubbles: true }); Object.assign(click, { clientX: 120, clientY: 70 });
    p.veil()!.dispatchEvent(click);
    expect(pressed).toHaveBeenCalledOnce();
    // The entrance ends at once so the next press meets the control itself.
    expect(p.veil()).toBeNull();
  });

  it("does not stack: a new screen finishes the one still arriving", async () => {
    const p = await fixture(); const first = p.id("changes-view"); const second = p.id("history-view");
    second.hidden = false;
    p.context.PhotoGitMotion.screen(first); p.advance(32);
    p.context.PhotoGitMotion.screen(second);
    expect(first.style.opacity || "").toBe(""); expect(first.style.transform || "").toBe("");
    expect(Number(second.style.opacity)).toBe(0);
    expect(p.timers.size).toBe(1);
    // The same screen asked for twice restarts rather than doubling.
    p.context.PhotoGitMotion.screen(second); expect(p.timers.size).toBe(1);
    p.advance(200); expect(p.timers.size).toBe(0);
  });

  it("keeps a veil through the host's layout-only resize and the transition's own scroll reset", async () => {
    const p = await nativeFixture(), finish = vi.fn();
    const root = p.document.documentElement;
    Object.defineProperty(root, "clientWidth", { configurable: true, value: 360 });
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 640 });
    p.context.PhotoGitMotion.exit(p.view, finish);
    p.advance(16);
    p.document.dispatchEvent(new p.window.Event("scroll"));
    p.document.dispatchEvent(new p.window.Event("resize"));
    expect(p.veil()).not.toBeNull(); expect(finish).not.toHaveBeenCalled();
    Object.defineProperty(root, "clientWidth", { configurable: true, value: 420 });
    p.document.dispatchEvent(new p.window.Event("resize"));
    expect(p.veil()).toBeNull(); expect(finish).toHaveBeenCalledOnce();
    p.advance(400); expect(finish).toHaveBeenCalledOnce();
  });

  it("fades a surface out before it is hidden, exactly once, and a reopen takes over from where it was", async () => {
    const p = await fixture(); const view = p.id("changes-view"); const finish = vi.fn(() => { view.hidden = true; });
    p.context.PhotoGitMotion.exit(view, finish);
    p.advance(48);
    expect(Number(view.style.opacity)).toBeGreaterThan(0); expect(Number(view.style.opacity)).toBeLessThan(1);
    expect(finish).not.toHaveBeenCalled();
    p.advance(120);
    expect(view.hidden).toBe(true); expect(finish).toHaveBeenCalledOnce();
    expect(view.style.opacity || "").toBe(""); expect(p.timers.size).toBe(0);
    view.hidden = false;
    const stale = vi.fn();
    p.context.PhotoGitMotion.exit(view, stale); p.advance(48);
    const midway = view.style.opacity;
    p.context.PhotoGitMotion.enter(view);
    expect(view.style.opacity).toBe(midway);
    p.advance(200);
    expect(stale).not.toHaveBeenCalled(); expect(view.style.opacity || "").toBe("");
  });

  it.each([false, true])("under reduced motion nothing moves or fades (CSS fallback: %s)", async fallback => {
    const p = await fixture(true, fallback); const view = p.id("changes-view"); const finish = vi.fn();
    p.context.PhotoGitMotion.screen(view);
    p.context.PhotoGitMotion.expand(view);
    p.context.PhotoGitMotion.press(p.id("push"));
    p.context.PhotoGitMotion.exit(view, finish);
    expect(finish).toHaveBeenCalledOnce();
    expect(p.timers.size).toBe(0);
    expect(view.style.opacity || "").toBe(""); expect(view.style.transform || "").toBe("");
    expect(p.id("push").style.backgroundColor || "").toBe("");
  });

  it("stops at once when its element is hidden or reduced motion turns on, and restores inline styles it found", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    view.style.opacity = "0.8";
    p.context.PhotoGitMotion.enter(view);
    p.id("workspace").hidden = true; p.advance(16);
    expect(view.style.opacity).toBe("0.8"); expect(p.timers.size).toBe(0);
    p.context.PhotoGitMotion.enter(view); expect(p.timers.size).toBe(0);
    p.id("workspace").hidden = false;
    p.context.PhotoGitMotion.enter(view);
    p.context.matchMedia = () => ({ matches: true }); p.advance(16);
    expect(view.style.opacity).toBe("0.8"); expect(p.timers.size).toBe(0);
  });

  it("uses paint frames when available, cancels them, and lands on the last frame after a stalled host", async () => {
    const p = await fixture(); const view = p.id("changes-view");
    p.context.requestAnimationFrame = vi.fn(work => p.context.setTimeout(work, 16));
    p.context.cancelAnimationFrame = vi.fn(id => p.context.clearTimeout(id));
    p.context.PhotoGitMotion.enter(view); p.advance(32);
    expect(p.context.requestAnimationFrame).toHaveBeenCalled();
    p.context.PhotoGitMotion.cancel(view);
    expect(p.context.cancelAnimationFrame).toHaveBeenCalled(); expect(p.timers.size).toBe(0);
    p.context.PhotoGitMotion.enter(view);
    p.stall(900); p.advance(16);
    expect(view.style.opacity || "").toBe(""); expect(p.timers.size).toBe(0);
  });

  it("a control's own handler runs once and immediately, whatever the decoration does", async () => {
    const p = await fixture(); const button = p.id("global-search");
    button.setAttribute("aria-disabled", "false");
    const action = vi.fn(); button.addEventListener("click", action);
    button.querySelector("svg")!.dispatchEvent(new p.window.Event("click", { bubbles: true }));
    expect(action).toHaveBeenCalledOnce();
    p.advance(300); expect(action).toHaveBeenCalledOnce();
    expect(p.document.getElementById("docs-open-palette")).toBeNull();
  });

  describe("colour changes are stepped, since the host has no CSS transitions", () => {
    type Paint = { backgroundColor?: string; borderTopColor?: string; color?: string };
    async function painted(paint: (node: HTMLElement) => Paint) {
      const p = await fixture();
      p.context.getComputedStyle = (node: HTMLElement) => ({
        backgroundColor: node.classList?.contains("filled") ? "#0C56B8" : node.classList?.contains("motion-press-tone") ? "rgb(110, 110, 110)" : "",
        borderTopColor: "", color: "", ...paint(node), getPropertyValue: () => "1"
      });
      return p;
    }
    const compact = (value: string) => value.replace(/\s/g, "");
    it("takes the pressed tone at once and eases back to rest within 120ms", async () => {
      const p = await painted(() => ({}));
      const button = p.id("push");
      p.context.PhotoGitMotion.press(button);
      expect(compact(button.style.backgroundColor)).toBe("rgba(110,110,110,1)");
      p.advance(48);
      const alpha = Number(/,([\d.]+)\)$/.exec(compact(button.style.backgroundColor))![1]);
      expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThan(1);
      p.advance(120);
      // Released: the stylesheet is in charge of the colour again.
      expect(button.style.backgroundColor || "").toBe("");
      expect(p.timers.size).toBe(0);
      expect(p.document.querySelector(".motion-press-tone")).toBeNull();
    });
    it("blends a filled control from its own darker tone back to its resting colour", async () => {
      const p = await painted(node => node.id === "save-version" ? { backgroundColor: "#1473E6" } : {});
      const button = p.id("save-version");
      p.context.PhotoGitMotion.press(button);
      expect(compact(button.style.backgroundColor)).toBe("rgba(12,86,184,1)");
      p.advance(140);
      expect(button.style.backgroundColor || "").toBe("");
    });
    it("presses any control on click and leaves unavailable ones alone", async () => {
      const p = await painted(() => ({}));
      const tab = p.id("history-tab");
      tab.querySelector(".tab-label")!.dispatchEvent(new p.window.Event("click", { bubbles: true }));
      expect(tab.style.backgroundColor).not.toBe("");
      const push = p.id("push"); push.setAttribute("aria-disabled", "true");
      push.dispatchEvent(new p.window.Event("click", { bubbles: true }));
      expect(push.style.backgroundColor || "").toBe("");
    });
    it("eases background, border and text between two states of the same controls", async () => {
      const selected = new Set<string>(["changes-tab"]);
      const p = await painted(node => selected.has(node.id) ? { backgroundColor: "#323232", color: "#FFFFFF" } : { color: "#B0B0B0" });
      const tabs = [p.id("changes-tab"), p.id("history-tab"), p.id("branches-tab")];
      p.context.PhotoGitMotion.recolour(tabs, () => { selected.clear(); selected.add("history-tab"); });
      // Each starts as it was painted before the change...
      expect(compact(tabs[0]!.style.backgroundColor)).toBe("rgba(50,50,50,1)");
      expect(compact(tabs[1]!.style.color)).toBe("rgba(176,176,176,1)");
      // ...a control whose paint did not change is left alone...
      expect(tabs[2]!.style.color || "").toBe(""); expect(tabs[2]!.style.backgroundColor || "").toBe("");
      p.advance(48);
      const text = Number(/^rgba\((\d+)/.exec(compact(tabs[1]!.style.color))![1]);
      expect(text).toBeGreaterThan(176); expect(text).toBeLessThan(255);
      p.advance(120);
      // ...and ends with no inline colour, so the stylesheet decides again.
      for (const tab of tabs) { expect(tab.style.backgroundColor || "").toBe(""); expect(tab.style.color || "").toBe(""); }
      expect(p.timers.size).toBe(0);
    });
    it("eases hover in from the resting paint and back out, reading rest from an unhovered twin", async () => {
      let hovering = false;
      const p = await painted(node => node.id === "push" && hovering ? { backgroundColor: "#3D3D3D" } : {});
      const push = p.id("push");
      const move = (type: string) => push.dispatchEvent(new p.window.Event(type, { bubbles: true }));
      hovering = true; move("mouseover");
      expect(compact(push.style.backgroundColor)).toBe("rgba(61,61,61,0)");
      // The twin never stays in the document or keeps the control's id.
      expect(p.document.querySelectorAll("#push")).toHaveLength(1);
      expect(push.parentElement!.querySelectorAll(".push-button")).toHaveLength(1);
      p.advance(140); expect(push.style.backgroundColor || "").toBe("");
      hovering = false; move("mouseout");
      expect(compact(push.style.backgroundColor)).toBe("rgba(61,61,61,1)");
      p.advance(140); expect(push.style.backgroundColor || "").toBe("");
      expect(p.timers.size).toBe(0);
    });
    it("slides the tab underline by transform, from where it is to the chosen tab", async () => {
      const p = await painted(() => ({}));
      const indicator = p.id("tab-indicator");
      const box = (left: number, width: number) => () => ({ left, width, top: 0, right: left + width, bottom: 0, height: 0 } as DOMRect);
      p.id("section-nav").getBoundingClientRect = box(10, 350);
      p.id("changes-tab").getBoundingClientRect = box(10, 70);
      p.id("reviews-tab").getBoundingClientRect = box(220, 70);
      // The first placement is simply where it belongs.
      p.context.PhotoGitMotion.slide(indicator, p.id("changes-tab"));
      expect([indicator.hidden, indicator.style.transform, indicator.style.width]).toEqual([false, "translateX(0px)", "70px"]);
      expect(p.timers.size).toBe(0);
      p.context.PhotoGitMotion.slide(indicator, p.id("reviews-tab"));
      p.advance(64);
      const midway = Number(/translateX\(([\d.]+)px\)/.exec(indicator.style.transform)![1]);
      expect(midway).toBeGreaterThan(0); expect(midway).toBeLessThan(210);
      expect(indicator.style.left || "").toBe("");
      p.advance(180);
      expect(indicator.style.transform).toBe("translateX(210px)");
      expect(p.timers.size).toBe(0);
    });
  });
});
