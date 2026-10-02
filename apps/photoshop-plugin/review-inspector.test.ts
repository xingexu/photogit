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
    expect(p.container.querySelector(".comparison-status")!.textContent).toContain("Ready to combine");
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
    expect(p.container.textContent).toContain("Sort that out outside PhotoGit");
    expect(p.container.textContent).toContain("doesn’t blend layers");
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
    expect(p.container.textContent).toContain("Select a branch to see what it would bring in");
    p.render({ comparison: comparison({ changes: [], files: [] }), onMerge: undefined });
    expect(p.container.textContent).toContain("Check the changed files and notes");
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

  it("shows a branch waiting to merge as a card whose one button opens it", () => {
    const { document, window } = parseHTML('<html><body><div id="list"></div></body></html>');
    const list = document.getElementById("list")!;
    const toggled: string[] = [];
    const add = (review: Record<string, unknown>, expanded = false) => list.appendChild(view.card(document, review, { expanded, onToggle: (branch: string) => toggled.push(branch) })) as HTMLElement;
    const ready = add({ branch: "cover-b", ahead: 1, changeCount: 27, mergeable: true });
    const blocked = add({ branch: '<img src=x onerror="bad()">', ahead: 3, changeCount: 1, mergeable: false });
    expect(ready.className).toBe("review-card");
    expect(ready.querySelector("strong")!.textContent).toBe("cover-b");
    expect(ready.querySelector(".review-facts")!.textContent).toBe("1 version aheadReady to merge");
    expect(ready.querySelector(".review-toggle")!.textContent).toBe("Review");
    expect(blocked.querySelector(".review-facts")!.textContent).toBe("3 versions aheadConflicts");
    // A conflict is an icon and a word, not a colour.
    expect(blocked.querySelector(".review-state svg")).not.toBeNull();
    expect(blocked.querySelector(".review-toggle")!.textContent).toBe("Resolve");
    expect(blocked.querySelector(".review-toggle")!.getAttribute("aria-label")).toBe('Resolve <img src=x onerror="bad()">');
    expect(list.querySelector("img")).toBeNull();
    // Only the button acts; the card itself is not a control while closed.
    ready.click(); expect(toggled).toEqual([]);
    (ready.querySelector(".review-toggle") as HTMLElement).click();
    const key = new window.Event("keydown", { bubbles: true, cancelable: true }); Object.assign(key, { key: "Enter" });
    blocked.querySelector(".review-toggle")!.dispatchEvent(key);
    expect(toggled).toEqual(["cover-b", '<img src=x onerror="bad()">']);
    document.body.classList.add("is-busy"); (ready.querySelector(".review-toggle") as HTMLElement).click(); document.body.classList.remove("is-busy");
    expect(toggled).toHaveLength(2);
    // Open, the heading closes the card and the state sits in the corner.
    const open = add({ branch: "live-poster", ahead: 3, mergeable: false }, true);
    expect(open.classList.contains("expanded")).toBe(true);
    expect(open.querySelector(".review-toggle")).toBeNull();
    expect(open.querySelector(".review-head")!.getAttribute("aria-expanded")).toBe("true");
    expect(open.querySelector(".review-body")!.textContent).toBe("Reading both branches…");
    (open.querySelector(".review-head") as HTMLElement).click();
    expect(toggled[2]).toBe("live-poster");
  });

  it("lists each conflict by layer and what changed, and keeps Merge unavailable until there are none", () => {
    const { document } = parseHTML('<html><body><div id="body"></div></body></html>');
    const body = document.getElementById("body")!;
    const merge = vi.fn(); const details = vi.fn();
    const blocked = comparison({
      incomingBranch: "live-poster", baseBranch: "film-final", gitMergeable: false,
      changes: [{ layerName: "Headline", layerUuid: "uuid-1", summary: "Headline: Text changed" }, { layerName: "Background", layerUuid: "uuid-2", summary: "Background: Pixels changed" }],
      conflicts: [".photogit/text/uuid-1.json", ".photogit/appearance/uuid-1.json", ".photogit/content/uuid-2.json", ".photogit/content/unknown.json", ".photogit/structure/layers.json", ".photogit/document.json", "snapshot/document.psd", ".photogit/previews/document.png", ".photogit/identities.json"]
    });
    expect(view.resolution(body, blocked, { onMerge: merge, onDetails: details })).toBe(6);
    expect([...body.querySelectorAll(".review-conflict-head")].map(row => [row.querySelector("strong")!.textContent, row.querySelector("span")!.textContent])).toEqual([
      ["Headline", "Text and appearance changed on both"], ["Background", "Pixels changed on both"], ["A layer", "Pixels changed on both"],
      ["Layer stack", "Layer order changed on both"], ["Document", "Canvas settings changed on both"], ["Saved PSD", "The Photoshop file changed on both"]
    ]);
    const button = body.querySelector(".comparison-merge") as HTMLElement;
    expect(button.textContent).toBe("Merge live-poster");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.classList.contains("button-primary")).toBe(false);
    button.click(); expect(merge).not.toHaveBeenCalled();
    expect(body.querySelector(".review-note")!.textContent).toContain("6 conflicts to resolve");
    // PhotoGit cannot apply a chosen side, so it offers no control that pretends to.
    expect(body.textContent).not.toMatch(/Keep |Take /);
    (body.querySelector(".review-details") as HTMLElement).click();
    expect(details).toHaveBeenCalledExactlyOnceWith("live-poster");

    expect(view.resolution(body, comparison({ incomingBranch: "tidy", baseBranch: "main", conflicts: [], gitMergeable: true }), { onMerge: merge })).toBe(0);
    const ready = body.querySelector(".comparison-merge") as HTMLElement;
    expect(ready.getAttribute("aria-disabled")).toBe("false");
    expect(ready.classList.contains("button-primary")).toBe(true);
    expect(body.querySelector(".review-note")!.textContent).toContain("No conflicts");
    ready.click(); expect(merge).toHaveBeenCalledExactlyOnceWith("tidy");
    // A contradictory payload cannot make a known conflict mergeable.
    view.resolution(body, comparison({ conflicts: ["snapshot/document.psd"], gitMergeable: true }), { onMerge: merge });
    expect((body.querySelector(".comparison-merge") as HTMLElement).getAttribute("aria-disabled")).toBe("true");
  });
});
