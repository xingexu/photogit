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
