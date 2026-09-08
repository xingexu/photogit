import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

async function revealFixture(reduce = false) {
  const root = resolve("apps/photoshop-plugin");
  const { document } = parseHTML("<!doctype html><body><div id='list'></div></body>");
  const context: Context = createContext({
    document,
    localStorage: { getItem: () => "dark", setItem: vi.fn() },
    Date: { now: () => 0 },
    matchMedia: () => ({ matches: reduce }),
    getComputedStyle: () => ({ getPropertyValue: () => (reduce ? "0" : "1") }),
    CSS: { supports: () => true },
    setTimeout: vi.fn(), clearTimeout: vi.fn()
  });
  for (const file of ["motion.js", "reveal.js"]) runInContext(await readFile(resolve(root, file), "utf8"), context);
  const rows = (count: number) => Array.from({ length: count }, () => {
    const row = document.createElement("div");
    document.getElementById("list")!.appendChild(row);
    return row as any;
  });
  return { document, rows, reveal: context.PhotoGitReveal };
}

describe("PhotoGit reveal", () => {
  it("gives each row a later delay than the one above it", async () => {
    const { reveal } = await revealFixture();
    expect(reveal.delayFor(0)).toBe(0);
    expect(reveal.delayFor(1)).toBe(reveal.STEP);
    expect(reveal.delayFor(3)).toBe(reveal.STEP * 3);
  });

  it("caps the delay so a long list still settles promptly", async () => {
    const { reveal } = await revealFixture();
    const ceiling = reveal.STEP * reveal.CAP;
    expect(reveal.delayFor(reveal.CAP)).toBe(ceiling);
    expect(reveal.delayFor(500)).toBe(ceiling);
  });

  it("marks every row it is given", async () => {
    const { reveal, rows } = await revealFixture();
    const list = rows(4);
    expect(reveal.stagger(list)).toBe(4);
    expect(list.every((row: any) => row.classList.contains("is-revealing"))).toBe(true);
    expect(list[2].style.getPropertyValue("--reveal-delay")).toBe(`${reveal.STEP * 2}ms`);
  });

  it("leaves rows untouched and unmarked under reduced motion", async () => {
    const { reveal, rows } = await revealFixture(true);
    const list = rows(3);
    expect(reveal.stagger(list)).toBe(0);
    expect(list.some((row: any) => row.classList.contains("is-revealing"))).toBe(false);
    expect(list[1].style.getPropertyValue("--reveal-delay")).toBe("");
  });
});
