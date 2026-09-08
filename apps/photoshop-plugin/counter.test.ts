import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

async function counterFixture(reduce = false) {
  const root = resolve("apps/photoshop-plugin");
  const { document } = parseHTML("<!doctype html><body><dd id='n'>0</dd></body>");
  let now = 0, nextId = 0;
  const timers = new Map<number, { at: number; work: () => void }>();
  const context: Context = createContext({
    document,
    localStorage: { getItem: () => "dark", setItem: vi.fn() },
    Date: { now: () => now },
    matchMedia: () => ({ matches: reduce }),
    getComputedStyle: () => ({ getPropertyValue: () => (reduce ? "0" : "1") }),
    CSS: { supports: () => true },
    setTimeout: (work: () => void, delay: number) => { const id = ++nextId; timers.set(id, { at: now + delay, work }); return id; },
    clearTimeout: (id: number) => timers.delete(id)
  });
  for (const file of ["motion.js", "counter.js"]) runInContext(await readFile(resolve(root, file), "utf8"), context);
  const advance = (ms: number) => {
    const end = now + ms;
    for (let guard = 0; guard < 2000; guard++) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].work();
    }
    now = end;
  };
  return { document, advance, counter: context.PhotoGitCounter, node: document.getElementById("n")! as any, timers };
}

describe("PhotoGit counter", () => {
  it("carries the authoritative value from the very first frame", async () => {
    const { counter, node } = await counterFixture();
    counter.set(node, 56);
    expect(node.dataset.value).toBe("56");
  });

  it("arrives exactly on the target", async () => {
    const { counter, node, advance } = await counterFixture();
    counter.set(node, 37);
    advance(counter.DURATION + 32);
    expect(node.textContent).toBe("37");
  });

  it("only ever renders whole numbers", async () => {
    const { counter, node, advance } = await counterFixture();
    counter.set(node, 19);
    for (let step = 0; step < 40; step++) {
      expect(node.textContent).toMatch(/^-?\d+$/);
      advance(16);
    }
  });

  it("skips straight to the total under reduced motion", async () => {
    const { counter, node, timers } = await counterFixture(true);
    counter.set(node, 240);
    expect(node.textContent).toBe("240");
    expect(timers.size).toBe(0);
  });

  it("abandons a count in flight when a newer value arrives", async () => {
    const { counter, node, advance } = await counterFixture();
    counter.set(node, 500);
    advance(100);
    counter.set(node, 3);
    advance(counter.DURATION + 32);
    expect(node.textContent).toBe("3");
    expect(node.dataset.value).toBe("3");
  });

  it("ignores a value that is not a finite number", async () => {
    const { counter, node } = await counterFixture();
    node.textContent = "12";
    counter.set(node, Number.NaN);
    expect(node.textContent).toBe("12");
  });

  it("counts down as readily as up", async () => {
    const { counter, node, advance } = await counterFixture();
    counter.set(node, 90);
    advance(counter.DURATION + 32);
    counter.set(node, 4);
    advance(counter.DURATION + 32);
    expect(node.textContent).toBe("4");
  });
});
