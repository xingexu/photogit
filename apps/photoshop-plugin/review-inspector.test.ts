import { createRequire } from "node:module";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const view = require("./review-inspector.js");
function comparison(extra = {}) {
  return { baseBranch: "main", incomingBranch: "alternate", ahead: 2, behind: 1, mergeBase: "a".repeat(40),
    files: [{ status: "M", path: "snapshot/document.psd" }],
    changes: [{ layerName: "Title", summary: "Font size changed" }],
    conflicts: [], warnings: ["The PSD will not be blended."], gitMergeable: true, ...extra };
}
function fixture() {
  const { document, window } = parseHTML('<html><body><section id="review"></section></body></html>');
  const container = document.getElementById("review")!;
  const onMerge = vi.fn();
  const render = (options = {}) => view.render(container, { comparison: comparison(), onMerge, ...options });
  const key = (element: Element, value: string, extra = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: value, ...extra }); element.dispatchEvent(event);
  };
  return { document, container, onMerge, render, key };
}

describe("review comparison inspector", () => {
  it("shows the actual source to destination direction and accurate incoming change counts", () => {
    const p = fixture(); const data = comparison(); const before = JSON.stringify(data);
    p.render({ comparison: data });
    expect(p.container.querySelector(".comparison-direction")!.textContent).toBe("Sourcealternate→Destinationmain");
    const facts = Array.from(p.container.querySelectorAll(".comparison-fact")).map(row => row.textContent);
    expect(facts).toEqual(["Source-only commits2", "Destination-only commits1", "Recorded edits1", "Changed files1"]);
    expect(p.container.textContent).toContain("from the common ancestor to the source branch");
    expect(p.container.querySelector(".comparison-status")!.textContent).toContain("Git merge available");
    expect(p.container.querySelector(".comparison-merge")!.textContent).toBe("Review merge…");
    expect(p.container.querySelector("img")).toBeNull();
    expect(JSON.stringify(data)).toBe(before); expect(p.onMerge).not.toHaveBeenCalled();
  });

  it("keeps blocked merges inert and preserves every safety warning and the recovery path", () => {
    const warnings = Array.from({ length: 120 }, (_, i) => `Safety warning ${i}`);
    const p = fixture(); p.render({ comparison: comparison({ gitMergeable: false, conflicts: ["snapshot/document.psd", "Both branches changed the Photoshop design"], warnings }) });
    expect(p.container.querySelector(".comparison-merge")).toBeNull();
    expect(p.container.querySelector(".merge-blocked")).not.toBeNull();
    expect(p.container.querySelectorAll(".comparison-warnings li")).toHaveLength(120);
    expect(p.container.textContent).toContain("Resolve conflicting files outside PhotoGit");
    expect(p.container.textContent).toContain("does not blend PSD layers");
    expect(p.container.textContent).toContain("Both branches changed the Photoshop design");
    (p.container.querySelector(".comparison-status")! as HTMLElement).click(); expect(p.onMerge).not.toHaveBeenCalled();
  });

  it.each([
    { gitMergeable: true, conflicts: ["known conflict"] },
    { gitMergeable: "true" },
    { incomingBranch: "main" },
    { incomingBranch: "" },
    { baseBranch: "" }
  ])("fails closed when readiness is missing or contradictory: %o", override => {
    const p = fixture(); p.render({ comparison: comparison(override) });
    expect(p.container.querySelector(".comparison-merge")).toBeNull();
    expect(p.container.dataset.mergeable).toBe("false");
  });

  it("delegates only an explicit eligible activation to the caller's confirmation flow", () => {
    const p = fixture(); p.render(); const button = p.container.querySelector(".comparison-merge")! as HTMLElement;
    button.click(); p.key(button, "Enter"); p.key(button, " ");
    expect(p.onMerge).toHaveBeenCalledTimes(3); expect(p.onMerge).toHaveBeenLastCalledWith("alternate");
    p.key(button, "Escape"); p.key(button, "Enter", { repeat: true }); p.key(button, " ", { isComposing: true });
    expect(p.onMerge).toHaveBeenCalledTimes(3);
  });

  it("respects operation locking, hidden surfaces and explicitly disabled actions", () => {
    const p = fixture(); p.render(); const button = p.container.querySelector(".comparison-merge")! as HTMLElement;
    p.document.body.classList.add("is-busy"); button.click(); p.key(button, "Enter"); p.document.body.classList.remove("is-busy");
    p.document.body.classList.add("is-initializing"); button.click(); p.document.body.classList.remove("is-initializing");
    p.container.hidden = true; button.click(); p.container.hidden = false;
    button.setAttribute("aria-disabled", "true"); button.click(); p.key(button, " ");
    expect(p.onMerge).not.toHaveBeenCalled();
    button.removeAttribute("aria-disabled"); button.click(); expect(p.onMerge).toHaveBeenCalledOnce();
  });

  it("escapes every repository field and never treats metadata as markup or images", () => {
    const attack = '<img src=x onerror="bad()"><script>bad()</script>';
    const p = fixture(); p.render({ comparison: comparison({ baseBranch: attack, incomingBranch: attack + "other", warnings: [attack], conflicts: [attack], files: [{ status: attack, path: attack }], changes: [{ layerName: attack, summary: attack }] }) });
    expect(p.container.textContent).toContain(attack);
    expect(p.container.querySelector("img, script")).toBeNull();
    expect(p.onMerge).not.toHaveBeenCalled();
  });

  it("bounds long lists while retaining true totals, truncation notices and merge safety", () => {
    const p = fixture(); p.render({ comparison: comparison({
      changes: Array.from({ length: 133 }, (_, i) => ({ summary: `Edit ${i}` })),
      files: Array.from({ length: 520 }, (_, i) => ({ status: "M", path: `file-${i}.json` })),
      conflicts: Array.from({ length: 510 }, (_, i) => `Conflict ${i}`), gitMergeable: false
    }) });
    expect(p.container.querySelectorAll(".comparison-change-list li")).toHaveLength(100);
    expect(p.container.querySelectorAll(".comparison-file-list li")).toHaveLength(500);
    expect(p.container.querySelectorAll(".comparison-conflicts li")).toHaveLength(500);
    expect(p.container.textContent).toContain("first 100 of 133 recorded edits");
    expect(p.container.textContent).toContain("first 500 of 520 changed files");
    expect(p.container.textContent).toContain("first 500 of 510 conflicts");
    expect(p.container.querySelector(".comparison-merge")).toBeNull();
  });

  it("supports absent comparison, no semantic data and callback-less read-only use", () => {
    const p = fixture(); p.render({ comparison: undefined });
    expect(p.container.textContent).toContain("Choose a branch review");
    p.render({ comparison: comparison({ changes: [], files: [] }), onMerge: undefined });
    expect(p.container.textContent).toContain("Read the file changes and notes");
    expect(p.container.textContent).toContain("No incoming file changes recorded");
    expect(p.container.querySelector(".comparison-merge")).toBeNull();
  });

  it("shows paired branch previews only when both sides have one", () => {
    const art = "data:image/png;base64,iVBORw0KGgo=";
    const both = fixture();
    both.render({ comparison: comparison(), previews: { alternate: art, main: art } });
    expect(both.container.querySelectorAll(".comparison-artwork-side img")).toHaveLength(2);
    expect(both.container.textContent).toContain("not rendered pixels");

    const one = fixture();
    one.render({ comparison: comparison(), previews: { alternate: art } });
    expect(one.container.querySelector(".comparison-artwork")).toBeNull();

    const none = fixture();
    none.render({ comparison: comparison() });
    expect(none.container.querySelector(".comparison-artwork")).toBeNull();
  });

  it.each(["https://example.invalid/a.png", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "assets/a.png"])("rejects unsafe comparison preview %s", src => {
    const p = fixture();
    p.render({ comparison: comparison(), previews: { alternate: src, main: src } });
    expect(p.container.querySelector(".comparison-artwork")).toBeNull();
  });
});
