import { createRequire } from "node:module";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const view = require("./branch-view.js");
const branches = [{ name: "alternate", current: false }, { name: "main", current: true }, { name: "typography", current: false }];
function fixture() {
  const { document, window } = parseHTML('<html><body><div id="branches"></div></body></html>');
  const container = document.getElementById("branches")!;
  const onSwitch = vi.fn();
  const render = (options = {}) => view.render(container, { branches, current: "main", onSwitch, ...options });
  const key = (element: Element, value: string, extra = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: value, ...extra }); element.dispatchEvent(event);
  };
  return { document, container, onSwitch, render, key };
}

describe("branch design directions", () => {
  it("pins the actual current branch first without mutating or embellishing source records", () => {
    const original = JSON.stringify(branches);
    const p = fixture(); p.render();
    const rows = Array.from(p.container.querySelectorAll(".branch-row"));
    expect(rows.map(row => row.querySelector("strong")!.textContent)).toEqual(["main", "alternate", "typography"]);
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
    expect(rows[0]!.querySelector(".branch-current-label")!.textContent).toBe("Current");
    expect(rows[0]!.querySelector(".branch-switch")).toBeNull();
    expect(p.container.querySelectorAll(".branch-switch")).toHaveLength(2);
    expect(JSON.stringify(branches)).toBe(original);
    expect(p.container.querySelector("img")).toBeNull();
    expect(p.container.textContent).not.toMatch(/Updated|ago|commit|remote|synced/i);
    expect(p.onSwitch).not.toHaveBeenCalled();
  });

  it("uses explicit current context rather than stale branch flags", () => {
    const p = fixture(); p.render({ current: "typography" });
    expect(p.container.querySelector(".current strong")!.textContent).toBe("typography");
    expect(p.container.querySelectorAll(".current")).toHaveLength(1);
    p.render({ current: undefined });
    expect(p.container.querySelector(".current strong")!.textContent).toBe("main");
    p.render({ current: "detached" });
    expect(p.container.querySelector(".current")).toBeNull();
    expect(p.container.querySelectorAll(".branch-switch")).toHaveLength(3);
  });

  it("keeps markup and long branch names as text while preserving the exact name for the caller", () => {
    const name = 'design/<img src=x onerror="bad()">/' + "long-name-".repeat(18);
    const p = fixture(); p.render({ branches: [{ name, current: false }] });
    expect(p.container.querySelector("strong")!.textContent).toBe(name);
    expect(p.container.querySelector("img, script")).toBeNull();
    const button = p.container.querySelector(".branch-switch")! as HTMLElement;
    expect(button.getAttribute("aria-label")).toBe(`Switch to ${name}`);
    button.click(); expect(p.onSwitch).toHaveBeenCalledExactlyOnceWith(name);
  });

  it("only delegates switching through explicit click or keyboard activation", () => {
    const p = fixture(); p.render();
    const row = p.container.querySelectorAll(".branch-row")[1]! as HTMLElement;
    row.click(); expect(p.onSwitch).not.toHaveBeenCalled();
    const button = row.querySelector(".branch-switch")! as HTMLElement;
    button.click(); p.key(button, "Enter"); p.key(button, " ");
    expect(p.onSwitch).toHaveBeenCalledTimes(3);
    expect(p.onSwitch).toHaveBeenLastCalledWith("alternate");
    p.key(button, "Escape"); p.key(button, "Enter", { repeat: true }); p.key(button, " ", { isComposing: true });
    expect(p.onSwitch).toHaveBeenCalledTimes(3);
  });

  it("respects operation locking, hidden ancestors and explicit disabled state", () => {
    const p = fixture(); p.render(); const button = p.container.querySelector(".branch-switch")! as HTMLElement;
    p.document.body.classList.add("is-busy"); button.click(); p.key(button, "Enter"); p.document.body.classList.remove("is-busy");
    p.document.body.classList.add("is-initializing"); button.click(); p.document.body.classList.remove("is-initializing");
    p.container.hidden = true; button.click(); p.container.hidden = false;
    button.setAttribute("aria-disabled", "true"); button.click(); p.key(button, " ");
    expect(p.onSwitch).not.toHaveBeenCalled();
    button.removeAttribute("aria-disabled"); button.click(); expect(p.onSwitch).toHaveBeenCalledOnce();
  });

  it("replaces rows on refresh without duplicating actions or changing local branch data", () => {
    const p = fixture(); p.render(); p.render({ current: "alternate" });
    expect(p.container.querySelectorAll(".branch-row")).toHaveLength(3);
    expect(p.container.querySelector(".current strong")!.textContent).toBe("alternate");
    (p.container.querySelector(".branch-switch")! as HTMLElement).click();
    expect(p.onSwitch).toHaveBeenCalledExactlyOnceWith("main");
    expect(branches[1]!.current).toBe(true);
  });

  it("renders a useful empty state and supports read-only use without switch callbacks", () => {
    const p = fixture(); p.render({ branches: [] });
    expect(p.container.querySelector('[role="status"]')!.textContent).toContain("Save your first version");
    expect(p.container.querySelector(".branch-row")).toBeNull();
    p.render({ onSwitch: undefined }); expect(p.container.querySelector(".branch-switch")).toBeNull();
    expect(p.container.querySelectorAll(".branch-row")).toHaveLength(3);
  });

  it("accepts local demo artwork only through the demo channel", () => {
    const p = fixture();
    p.render({ branches: [{ name: "main", current: true }], current: "main", demoPreviews: { main: "assets/poster-main.jpg" } });
    expect(p.container.querySelector(".branch-row-preview img")!.getAttribute("src")).toBe("assets/poster-main.jpg");
  });

  it.each(["https://example.invalid/a.png", "assets/a.svg", "../a.png", "data:image/png;base64,iVBORw0KGgo="])("rejects unsafe demo artwork %s", src => {
    const p = fixture();
    p.render({ branches: [{ name: "main", current: true }], current: "main", demoPreviews: { main: src } });
    expect(p.container.querySelector(".branch-row-preview")).toBeNull();
  });

  it("prefers a real saved preview over demo artwork", () => {
    const p = fixture();
    p.render({ branches: [{ name: "main", current: true }], current: "main",
      previews: { main: "data:image/png;base64,iVBORw0KGgo=" }, demoPreviews: { main: "assets/poster-main.jpg" } });
    expect(p.container.querySelector(".branch-row-preview img")!.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});
