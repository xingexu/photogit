import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

// Depth is decorative. These tests hold it to that: it must stay inert when the
// host cannot composite 3D transforms and when the user asked for less motion.
export async function depthFixture(options: { supports3d?: boolean; reduce?: boolean } = {}) {
  const { supports3d = true, reduce = false } = options;
  const root = resolve("apps/photoshop-plugin");
  const { document } = parseHTML(await readFile(resolve(root, "index.html"), "utf8"));
  let now = 0, nextId = 0;
  const timers = new Map<number, { at: number; work: () => void }>();
  const context: Context = createContext({
    document,
    localStorage: { getItem: () => "dark", setItem: vi.fn() },
    Date: { now: () => now },
    matchMedia: () => ({ matches: reduce }),
    getComputedStyle: () => ({ getPropertyValue: () => (reduce ? "0" : "1") }),
    CSS: { supports: (_property: string, value: string) => (/rotate|perspective|translate3d/.test(value) ? supports3d : true) },
    setTimeout: (work: () => void, delay: number) => { const id = ++nextId; timers.set(id, { at: now + delay, work }); return id; },
    clearTimeout: (id: number) => timers.delete(id)
  });
  for (const file of ["motion.js", "depth.js"]) runInContext(await readFile(resolve(root, file), "utf8"), context);
  const advance = (ms: number) => {
    const end = now + ms;
    for (let guard = 0; guard < 1000; guard++) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].work();
    }
    now = end;
  };
  return { document, context, advance, depth: context.PhotoGitDepth };
}

describe("PhotoGit depth · availability", () => {
  it("is available when the host composites 3D transforms and motion is allowed", async () => {
    const { depth } = await depthFixture();
    expect(depth.supports3d()).toBe(true);
    expect(depth.enabled()).toBe(true);
  });

  it("stays off when the host cannot composite 3D transforms", async () => {
    const { depth } = await depthFixture({ supports3d: false });
    expect(depth.supports3d()).toBe(false);
    expect(depth.enabled()).toBe(false);
  });

  it("stays off when the user asked for reduced motion", async () => {
    const { depth } = await depthFixture({ reduce: true });
    expect(depth.enabled()).toBe(false);
  });
});

// linkedom has no layout engine, so a box is supplied explicitly. That is also
// an honest model of a host that has not laid the panel out yet.
function box(element: any, rect = { left: 0, top: 0, width: 200, height: 100 }) {
  element.getBoundingClientRect = () => rect;
  return element;
}

describe("PhotoGit depth · pointer position", () => {
  it("puts the origin at the centre of the surface", async () => {
    const { document, depth } = await depthFixture();
    const surface = box(document.createElement("div"));
    expect(depth.position(surface, { clientX: 100, clientY: 50 })).toEqual({ x: 0, y: 0 });
  });

  it("reaches -1 and 1 at the edges on both axes", async () => {
    const { document, depth } = await depthFixture();
    const surface = box(document.createElement("div"));
    expect(depth.position(surface, { clientX: 0, clientY: 0 })).toEqual({ x: -1, y: -1 });
    expect(depth.position(surface, { clientX: 200, clientY: 100 })).toEqual({ x: 1, y: 1 });
  });

  it("clamps a pointer that has left the surface", async () => {
    const { document, depth } = await depthFixture();
    const surface = box(document.createElement("div"));
    expect(depth.position(surface, { clientX: -400, clientY: 900 })).toEqual({ x: -1, y: 1 });
  });

  it("returns null for a surface the host has not laid out", async () => {
    const { document, depth } = await depthFixture();
    const surface = box(document.createElement("div"), { left: 0, top: 0, width: 0, height: 0 });
    expect(depth.position(surface, { clientX: 5, clientY: 5 })).toBeNull();
  });
});

describe("PhotoGit depth · tilt", () => {
  it("stays within the shallow cap at the extremes", async () => {
    const { depth } = await depthFixture();
    for (const point of [{ x: 1, y: 1 }, { x: -1, y: -1 }]) {
      const tilt = depth.tiltFor(point);
      expect(Math.abs(tilt.rotateX)).toBeLessThanOrEqual(depth.MAX_TILT);
      expect(Math.abs(tilt.rotateY)).toBeLessThanOrEqual(depth.MAX_TILT);
    }
  });

  it("leans away from the pointer on the vertical axis", async () => {
    const { depth } = await depthFixture();
    expect(depth.tiltFor({ x: 0, y: 1 }).rotateX).toBeLessThan(0);
    expect(depth.tiltFor({ x: 0, y: -1 }).rotateX).toBeGreaterThan(0);
  });

  it("is flat at the centre", async () => {
    const { depth } = await depthFixture();
    expect(depth.tiltFor({ x: 0, y: 0 })).toEqual({ rotateX: 0, rotateY: 0 });
  });
});

describe("PhotoGit depth · property writes", () => {
  it("writes tilt and pointer properties the stylesheet can read", async () => {
    const { document, depth } = await depthFixture();
    const surface = document.createElement("div");
    depth.write(surface, { x: 1, y: 0 });
    expect(surface.style.getPropertyValue("--tilt-y")).toBe("2.4deg");
    expect(surface.style.getPropertyValue("--pointer-x")).toBe("100%");
    expect(surface.style.getPropertyValue("--pointer-y")).toBe("50%");
  });

  it("removes every property it wrote when the pointer leaves", async () => {
    const { document, depth } = await depthFixture();
    const surface = document.createElement("div");
    surface.classList.add("is-depth-active");
    depth.write(surface, { x: -1, y: 1 });
    depth.clear(surface);
    for (const name of ["--tilt-x", "--tilt-y", "--pointer-x", "--pointer-y"]) {
      expect(surface.style.getPropertyValue(name)).toBe("");
    }
    expect(surface.classList.contains("is-depth-active")).toBe(false);
  });

  it("never writes a transform or any layout-affecting style", async () => {
    const { document, depth } = await depthFixture();
    const surface = document.createElement("div");
    depth.write(surface, { x: 0.5, y: -0.5 });
    for (const name of ["transform", "width", "height", "margin", "padding", "position", "display"]) {
      expect(surface.style.getPropertyValue(name)).toBe("");
    }
  });
});
