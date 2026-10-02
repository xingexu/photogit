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
  it("renders every row at once: no per-row delay and no scheduled work", async () => {
    const { reveal, rows } = await revealFixture();
    const list = rows(4);
    expect(reveal.stagger(list)).toBe(0);
    for (const row of list) {
      expect(row.classList.contains("is-revealing")).toBe(false);
      expect(row.style.getPropertyValue("--reveal-delay")).toBe("");
      expect(row.style.opacity || "").toBe("");
    }
  });

  it("clears a marker left by a previous build", async () => {
    const { reveal, rows } = await revealFixture();
    const [row] = rows(1);
    row.classList.add("is-revealing"); row.style.setProperty("--reveal-delay", "52ms");
    reveal.stagger([row]);
    expect(row.classList.contains("is-revealing")).toBe(false);
    expect(row.style.getPropertyValue("--reveal-delay")).toBe("");
  });

  it("never hides a row or removes it from the document", async () => {
    const { document, reveal, rows } = await revealFixture();
    const list = rows(5);
    reveal.stagger(list);
    expect(document.getElementById("list")!.children.length).toBe(5);
    for (const row of list) {
      expect(row.hidden).toBeFalsy();
      expect(row.style.getPropertyValue("display")).toBe("");
      expect(row.getAttribute("aria-hidden")).toBeNull();
    }
  });

  it("treats an empty or missing list as a no-op", async () => {
    const { reveal } = await revealFixture();
    expect(reveal.stagger([])).toBe(0);
    expect(reveal.stagger(null)).toBe(0);
  });
});
