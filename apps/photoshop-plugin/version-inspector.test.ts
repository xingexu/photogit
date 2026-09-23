import { createRequire } from "node:module";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const inspector = require("./version-inspector.js");
const version = { id: "a".repeat(40), shortId: "aaaaaaa", author: "Test Author", date: "2026-09-07T10:30:00-04:00", message: "Refine typography" };
function details(extra = {}) {
  return { version, snapshotAvailable: true, files: [{ path: "snapshot/document.psd", status: "M" }], changes: [
    { layerUuid: "same-layer", layerName: "Title", domain: "text", category: "modified", summary: "Font size changed" },
    { layerUuid: "same-layer", layerName: "Title", domain: "appearance", category: "modified", summary: "Opacity changed" },
    { layerUuid: null, layerName: "Document", domain: "document", category: "modified", summary: "Width changed" }
  ], warnings: [], ...extra };
}
function fixture() {
  const { document, window } = parseHTML('<html><body><aside id="inspector"></aside></body></html>');
  const container = document.getElementById("inspector")!;
  const render = (options = {}) => inspector.render(container, options);
  const key = (target: Element, value: string, extra = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: value, ...extra }); target.dispatchEvent(event);
  };
  return { document, window, container, render, key };
}

describe("version date formatting", () => {
  it.each(["2026-09-07T10:30:00-04:00", "2026-09-07T23:15:20.000Z"])("formats ISO timestamp %s in the host locale and timezone", value => {
    const expected = new Date(value).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    expect(inspector.formatDate(value)).toBe(expected);
    expect(inspector.formatDate(value)).not.toContain(value);
  });
  it("uses only localized hours and minutes for compact history metadata", () => {
    const expected = new Date(version.date).toLocaleString([], { hour: "2-digit", minute: "2-digit" });
    expect(inspector.formatDate(version.date, true)).toBe(expected);
    expect(inspector.formatDate(version.date, true)).not.toContain("2026");
  });
  it.each(["2026-99-07T25:61:00Z", "2026-09-07", "Yesterday, 2:30 PM", "<img src=x>"])("keeps invalid or non-ISO date %s literal in both display modes", value => {
    expect(inspector.formatDate(value)).toBe(value);
    expect(inspector.formatDate(value, true)).toBe(value);
  });
  it.each([null, undefined, "", "   ", 0])("reports a missing or non-string date %s without inventing one", value => {
    expect(inspector.formatDate(value)).toBe("Not recorded");
    expect(inspector.formatDate(value, true)).toBe("Not recorded");
  });
  it("uses the same formatted timestamp in the inspector summary and Saved fact", () => {
    const p = fixture(); p.render({ details: details() });
    const displayed = inspector.formatDate(version.date);
    expect(p.container.querySelector(".version-inspector-title .version-inspector-meta")!.textContent).toContain(displayed);
    const saved = [...p.container.querySelectorAll(".version-inspector-fact")].find(row => row.querySelector("dt")!.textContent === "Saved")!;
    expect(saved.querySelector("dd")!.textContent).toBe(displayed);
    expect(p.container.textContent).not.toContain(version.date);
  });
});

describe("version inspector presentation", () => {
  it("renders empty, loading and recoverable error states without retaining stale version data", () => {
    const p = fixture(); p.render({ details: details() });
    p.render({ state: "loading" });
    expect(p.container.getAttribute("aria-busy")).toBe("true");
    expect(p.container.textContent).toContain("Loading version");
    expect(p.container.textContent).not.toContain(version.message);
    p.render({ state: "error", error: "Helper disconnected" });
    expect(p.container.getAttribute("aria-busy")).toBe("false");
    expect(p.container.querySelector('[role="alert"]')!.textContent).toBe("Helper disconnected");
    p.render(); expect(p.container.textContent).toContain("Select a saved version");
  });

  it("uses real metadata and edit counts without fabricating dimensions, artwork, or total layers", () => {
    const p = fixture(); p.render({ details: details(), currentVersionId: version.id });
    expect(p.container.textContent).toContain(version.message);
    const facts = Array.from(p.container.querySelectorAll(".version-inspector-fact")).map(row => row.textContent);
    expect(facts).toContain("Version ID" + version.id);
    expect(facts).toContain("Recorded edits3");
    expect(facts).toContain("Text edits1");
    expect(facts).toContain("Appearance edits1");
    expect(facts).toContain("Document edits1");
    expect(facts).not.toContain("Layers3");
    expect(p.container.querySelector(".version-inspector-current")!.textContent).toBe("Current branch tip");
    expect(p.container.querySelector("img")).toBeNull();
    expect(p.container.textContent).toContain("Preview unavailable");
    expect(p.container.textContent).not.toMatch(/RGB|ppi|Dimensions|3000|4096/);
  });

  it("treats every untrusted string as text and never imports helper preview paths", () => {
    const attack = '<img src=x onerror="fetch(1)"><script>bad()</script>';
    const p = fixture(); p.render({ details: details({
      version: { ...version, message: attack, author: attack, date: attack },
      changes: [{ layerName: attack, summary: attack }], files: [{ path: attack, status: attack }], warnings: [attack],
      previewPath: "https://example.invalid/track", preview: { src: "assets/injected.png" }
    }) });
    expect(p.container.textContent).toContain(attack);
    expect(p.container.querySelector("img, script")).toBeNull();
    p.render({ state: "error", error: attack }); expect(p.container.querySelector("img, script")).toBeNull();
  });

  it("only delegates opening after explicit activation and respects busy, hidden and disabled controls", () => {
    const p = fixture(); const onOpen = vi.fn(); p.render({ details: details(), onOpen });
    const button = p.container.querySelector(".version-inspector-open")! as HTMLElement;
    expect(onOpen).not.toHaveBeenCalled();
    button.click(); p.key(button, "Enter"); p.key(button, " "); expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onOpen).toHaveBeenLastCalledWith(version.id);
    p.key(button, "Enter", { repeat: true }); p.key(button, "Enter", { isComposing: true });
    button.setAttribute("aria-disabled", "true"); button.click(); button.removeAttribute("aria-disabled");
    p.document.body.classList.add("is-busy"); button.click(); p.document.body.classList.remove("is-busy");
    p.container.hidden = true; button.click(); expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("does not offer opening for missing snapshots or without an explicit caller callback", () => {
    const p = fixture(); p.render({ details: details({ snapshotAvailable: false }), onOpen: vi.fn() });
    expect(p.container.querySelector(".version-inspector-open")).toBeNull();
    expect(p.container.textContent).toContain("Saved file unavailable");
    p.render({ details: details() }); expect(p.container.querySelector(".version-inspector-open")).toBeNull();
  });

  it("does not label zero semantic edits as proof that the version has no changes", () => {
    const p = fixture(); p.render({ details: details({ changes: [], warnings: ["First saved layer state: 42 layers."] }) });
    expect(p.container.textContent).toContain("First saved layer state: 42 layers.");
    expect(p.container.textContent).toContain("No recorded layer changes.");
    expect(p.container.textContent).not.toContain("No changes in this version");
  });

  it("only shows caller-authorized local demo artwork and labels it as illustrative", () => {
    const p = fixture(); p.render({ details: details(), demoPreview: { demo: true, src: "assets/concepts/demo-poster.png", alt: "Illustrative mountains" } });
    const img = p.container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("assets/concepts/demo-poster.png");
    expect(img.getAttribute("alt")).toBe("Illustrative mountains");
    expect(p.container.querySelector("figcaption")!.textContent).toContain("Demo artwork");
    img.dispatchEvent(new p.window.Event("error"));
    expect(p.container.querySelector("img")).toBeNull();
    expect(p.container.textContent).toContain("Preview unavailable");
  });

  it.each(["https://example.invalid/a.png", "file:///private/artwork.png", "../a.png", "assets/../a.png", "assets/a.svg", "assets/a.png?secret=1", "data:image/png;base64,YQ==", "assets/%2e%2e/a.png", "/assets/a.png"])("rejects unsafe or unsupported demo preview %s", src => {
    const p = fixture(); p.render({ details: details(), demoPreview: { demo: true, src } });
    expect(p.container.querySelector("img")).toBeNull();
  });

  it("renders a saved version preview and labels it as the version's own preview", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const p = fixture(); p.render({ details: details(), preview: { src } });
    const img = p.container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(src);
    expect(p.container.querySelector("img")!.getAttribute("alt")).toBe("Preview saved with this version");
    expect(p.container.textContent).not.toContain("Demo artwork");
    img.dispatchEvent(new p.window.Event("error"));
    expect(p.container.querySelector("img")).toBeNull();
    expect(p.container.textContent).toContain("Preview unavailable");
  });

  it("prefers a real saved preview over demo artwork", () => {
    const p = fixture();
    p.render({ details: details(), preview: { src: "data:image/png;base64,iVBORw0KGgo=" }, demoPreview: { demo: true, src: "assets/demo.png" } });
    expect(p.container.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(p.container.querySelector("img")!.getAttribute("alt")).toBe("Preview saved with this version");
  });

  it.each([
    "https://example.invalid/a.png",
    "file:///private/artwork.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PGI+aGk8L2I+",
    "data:image/png;base64,not base64!",
    "assets/demo.png"
  ])("rejects unsafe saved preview %s", src => {
    const p = fixture(); p.render({ details: details(), preview: { src } });
    expect(p.container.querySelector("img")).toBeNull();
  });

  it("requires explicit demo mode even for an otherwise valid asset", () => {
    const p = fixture(); p.render({ details: details(), demoPreview: { src: "assets/demo.png" } });
    expect(p.container.querySelector("img")).toBeNull();
  });

  it("keeps large version histories bounded on first paint and exposes more records on demand", () => {
    const changes = Array.from({ length: 93 }, (_, i) => ({ layerName: `Layer ${i}`, summary: `Recorded edit ${i}`, domain: "text" }));
    const p = fixture(); p.render({ details: details({ changes }) });
    expect(p.container.querySelectorAll(".version-inspector-changes li")).toHaveLength(40);
    const more = Array.from(p.container.querySelectorAll(".version-inspector-more")).find(el => el.textContent === "Show more edits")! as HTMLElement;
    more.click(); expect(p.container.querySelectorAll(".version-inspector-changes li")).toHaveLength(80);
    more.click(); expect(p.container.querySelectorAll(".version-inspector-changes li")).toHaveLength(93);
    expect(more.hidden).toBe(true);
    expect(p.container.textContent).toContain("93 of 93 edits");
  });
});

describe("visual version history", () => {
  it("counts unique layers, marks lifecycle changes, and displays safe before/after values", () => {
    const changes = [...details().changes,
      { layerUuid: "new", layerName: "Highlights", domain: "structure", category: "added", summary: "Added layer" },
      { layerUuid: "old", layerName: "Sketch", domain: "structure", category: "removed", summary: "Removed layer" },
      { layerUuid: "same-layer", layerName: "Title", domain: "text", category: "modified", propertyPath: "contents", baseValue: "Old <b>title</b>", currentValue: "New title", summary: "Text changed" }
    ];
    const p = fixture(); p.render({ details: details({ changes }) });
    expect(inspector.changeTotals(changes)).toEqual({ added: 1, removed: 1, modified: 1, documentEdits: 1 });
    expect(p.container.querySelector(".version-change-stat.modified")!.textContent).toBe("1Edited layers");
    expect(p.container.querySelector(".version-edit-badge.removed")!.textContent).toBe("Deleted");
    expect(p.container.querySelector(".version-edit-values")!.textContent).toContain("Before: Old <b>title</b>");
    expect(p.container.querySelector(".version-edit-values b")).toBeNull();
  });

  it("compares the caller-provided parent preview with the selected version without opening either", () => {
    const p = fixture(); const onOpen = vi.fn();
    p.render({ details: details({ parentVersionId: "b".repeat(40) }), previousPreview: { src: "data:image/png;base64,YmVmb3Jl" }, preview: { src: "data:image/png;base64,YWZ0ZXI=" }, onOpen });
    expect([...p.container.querySelectorAll(".version-preview-pair img")].map(image => image.getAttribute("src"))).toEqual(["data:image/png;base64,YmVmb3Jl", "data:image/png;base64,YWZ0ZXI="]);
    expect(p.container.querySelector(".version-before")!.textContent).toContain("Before");
    expect(p.container.querySelector(".version-inspector-preview")!.textContent).toContain("After");
    expect(onOpen).not.toHaveBeenCalled();
    p.container.querySelector(".version-before img")!.dispatchEvent(new p.window.Event("error"));
    expect(p.container.querySelector(".version-before")!.textContent).toBe("Previous preview unavailable");
    expect(p.container.querySelector(".version-inspector-preview img")).not.toBeNull();
  });

  it("rejects unsafe parent previews and thumbnails and preserves useful metadata", () => {
    const p = fixture(); const row = p.document.createElement("div"); row.textContent = "Saved version";
    inspector.historyPreview(row, { preview: { src: "https://example.invalid/track.png" } });
    expect(row.querySelector("img")).toBeNull();
    p.render({ details: details({ parentVersionId: "b".repeat(40) }), previousPreview: { src: "data:image/svg+xml;base64,YQ==" } });
    expect(p.container.querySelector("img")).toBeNull();
    expect(p.container.textContent).toContain("Previous preview unavailable");
    inspector.historyPreview(row, { preview: { src: "data:image/png;base64,YWZ0ZXI=" } });
    expect(row.querySelector("img")).not.toBeNull();
    row.querySelector("img")!.dispatchEvent(new p.window.Event("error"));
    expect(row.textContent).toBe("Saved version");
    expect(row.classList.contains("has-thumbnail")).toBe(false);
  });
});
