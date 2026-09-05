import { describe, expect, it } from "vitest";
import type { ProjectState } from "@photogit/schema";
import { diffStates } from "./index.js";

const base = {
  project: { schemaVersion: 1, projectId: "p", displayName: "P", createdWith: "test" },
  document: { schemaVersion: 1, documentId: "d", name: "x.psd", width: 10, height: 10, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null, compatibility: "supported", warnings: [] },
  identities: { schemaVersion: 1, records: [] }, structure: { schemaVersion: 1, roots: [], layers: [] }, appearance: {}, text: {}, content: {}
} satisfies ProjectState;

describe("diffStates", () => {
  it("reports a document property with a human summary", () => {
    const current = structuredClone(base);
    current.document.width = 20;
    expect(diffStates(base, current)).toMatchObject([{ domain: "document", propertyPath: "width", baseValue: 10, currentValue: 20 }]);
  });

  it("treats object key order as semantic noise", () => {
    const current = structuredClone(base) as ProjectState;
    current.document = Object.fromEntries(Object.entries(current.document).reverse()) as ProjectState["document"];
    expect(diffStates(base, current)).toEqual([]);
  });

  it("does not invent a design edit when Photoshop gives a reopened recovery copy a new name and session ID", () => {
    const reopened = structuredClone(base); reopened.document.documentId = "new-session-id"; reopened.document.name = "version-deadbeef-recovered.psd";
    expect(diffStates(base, reopened)).toEqual([]);
  });

  it("reports a changed document composite without claiming which unsupported layer feature changed", () => {
    const before = structuredClone(base) as ProjectState; before.document.renderedFingerprint = "rendered-v1:before";
    const after = structuredClone(before); after.document.renderedFingerprint = "rendered-v1:after";
    expect(diffStates(before, after)).toMatchObject([{
      domain: "document", propertyPath: "renderedFingerprint", layerUuid: null, photoshopId: null,
      baseValue: "rendered-v1:before", currentValue: "rendered-v1:after", summary: "Document rendered appearance changed", mergeability: "unsupported"
    }]);
    expect(diffStates(before, structuredClone(before))).toEqual([]);
  });

  it("does not label gaining or losing composite comparison coverage as a design edit", () => {
    const legacy = structuredClone(base) as ProjectState;
    const supported = structuredClone(legacy); supported.document.renderedFingerprint = "rendered-v1:current";
    const unavailable = structuredClone(legacy); unavailable.document.renderedFingerprint = null;
    for (const [before, after] of [[legacy, supported], [supported, legacy], [unavailable, supported], [supported, unavailable], [legacy, unavailable]]) {
      expect(diffStates(before!, after!)).toEqual([]);
    }
  });

  it("detects a newly created Photoshop layer", () => {
    const current = pixelState("pixels-v1:empty");
    expect(diffStates(base, current)).toContainEqual(expect.objectContaining({
      domain: "structure",
      category: "added",
      photoshopId: 42,
      layerName: "New Layer"
    }));
  });

  it("detects painting inside an existing pixel layer", () => {
    const before = pixelState("pixels-v1:64x64x4:11111111");
    const after = pixelState("pixels-v1:64x64x4:22222222");
    expect(diffStates(before, after)).toContainEqual(expect.objectContaining({
      domain: "content",
      category: "modified",
      photoshopId: 42,
      propertyPath: "fingerprint"
    }));
    expect(diffStates(before, after)[0]?.summary).toBe("New Layer: Rendered appearance changed");
  });

  it("makes bidi controls in Photoshop layer names harmless to the panel", () => {
    const current = structuredClone(base) as ProjectState;
    current.structure.roots = ["layer-1"];
    current.structure.layers = [{ uuid: "layer-1", photoshopId: 1, parentUuid: null, name: "Hero\u202eexe", kind: "pixel", order: 0, children: [] }];
    current.identities.records = [{ uuid: "layer-1", photoshopId: 1, parentUuid: null, signature: "pixel|Hero|root|0|0|10|10", confidence: "exact" }];
    current.appearance["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 10, bottom: 10 }, boundsWithoutEffects: { left: 0, top: 0, right: 10, bottom: 10 } };
    current.content["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", fingerprint: null, opaque: false, reason: null };

    const [change] = diffStates(base, current);
    expect(change?.layerName).toBe("Hero exe");
    expect(change?.summary).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
  });

  it("detects deletion and keeps stable layer identity when renaming", () => {
    const before = pixelState("rendered-before");
    expect(diffStates(before, base)).toMatchObject([{ category: "removed", photoshopId: 42, propertyPath: "layer" }]);
    const after = structuredClone(before);
    after.structure.layers[0]!.name = "Renamed layer";
    expect(diffStates(before, after)).toMatchObject([{ category: "modified", photoshopId: 42, propertyPath: "name", currentValue: "Renamed layer" }]);
  });

  it.each([
    ["visible", false], ["opacity", 50], ["fillOpacity", 25], ["blendMode", "multiply"]
  ] as const)("detects an isolated %s edit", (property, value) => {
    const before = pixelState("same-render");
    const after = structuredClone(before);
    Object.assign(after.appearance["layer-1"]!, { [property]: value });
    expect(diffStates(before, after)).toMatchObject([{ domain: "appearance", propertyPath: property, currentValue: value }]);
  });

  it("compares saved six-decimal numbers with full-precision Photoshop values without inventing edits", () => {
    const saved = pixelState("same-render");
    saved.appearance["layer-1"]!.opacity = 63.137255;
    saved.appearance["layer-1"]!.bounds.left = 1.123457;
    saved.document.resolution = 72.123457;
    const scanned = structuredClone(saved);
    scanned.appearance["layer-1"]!.opacity = 63.13725490196079;
    scanned.appearance["layer-1"]!.bounds.left = 1.123456789;
    scanned.document.resolution = 72.123456789;
    expect(diffStates(saved, scanned)).toEqual([]);
  });

  it("still detects real numeric edits and rounds copy without changing raw values", () => {
    const saved = pixelState("same-render"); saved.appearance["layer-1"]!.opacity = 63.137255;
    const scanned = structuredClone(saved); scanned.appearance["layer-1"]!.opacity = 50.19607843137255;
    const changes = diffStates(saved, scanned);
    expect(changes).toMatchObject([{ domain: "appearance", propertyPath: "opacity", baseValue: 63.137255, currentValue: 50.19607843137255, summary: "New Layer: opacity changed from 63.137 to 50.196" }]);
    expect(scanned.appearance["layer-1"]!.opacity).toBe(50.19607843137255);
  });

  it("preserves changes at the saved precision while avoiding identical rounded values in user copy", () => {
    const saved = pixelState("same-render"); saved.appearance["layer-1"]!.opacity = 63.137255;
    const scanned = structuredClone(saved); scanned.appearance["layer-1"]!.opacity = 63.137256;
    expect(diffStates(saved, scanned)).toMatchObject([{ baseValue: 63.137255, currentValue: 63.137256, summary: "New Layer: opacity changed by less than 0.001" }]);
  });

  it("detects transform bounds and text contents independently of rendered fingerprints", () => {
    const before = pixelState("same-render");
    before.structure.layers[0]!.kind = "text";
    before.text["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", contents: "Before", styleFingerprint: "font-1" };
    const after = structuredClone(before);
    after.text["layer-1"]!.contents = "After";
    after.appearance["layer-1"]!.bounds.left = 5;
    const changes = diffStates(before, after);
    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual(expect.objectContaining({ domain: "appearance", propertyPath: "bounds.left", baseValue: 0, currentValue: 5 }));
    expect(changes).toContainEqual(expect.objectContaining({ domain: "text", propertyPath: "contents", baseValue: "Before", currentValue: "After" }));
  });

  it("detects reordered siblings without treating them as added or removed", () => {
    const before = pixelState("same-render");
    before.structure.layers.push({ ...before.structure.layers[0]!, uuid: "layer-2", photoshopId: 43, name: "Second", order: 1 });
    before.structure.roots.push("layer-2");
    before.identities.records.push({ ...before.identities.records[0]!, uuid: "layer-2", photoshopId: 43 });
    before.appearance["layer-2"] = { ...before.appearance["layer-1"]!, layerUuid: "layer-2" };
    before.content["layer-2"] = { ...before.content["layer-1"]!, layerUuid: "layer-2" };
    const after = structuredClone(before);
    after.structure.layers[0]!.order = 1; after.structure.layers[1]!.order = 0;
    after.structure.layers.reverse(); after.structure.roots.reverse();
    expect(diffStates(before, after)).toMatchObject([{ category: "reordered", propertyPath: "order" }, { category: "reordered", propertyPath: "order" }]);
  });

  it.each(["shape", "smartObject", "pixel", "text"])("describes %s fingerprints as appearance changes without inventing a paint operation", (kind) => {
    const before = pixelState("rendered-before"); before.structure.layers[0]!.kind = kind;
    const after = structuredClone(before); after.content["layer-1"]!.fingerprint = "rendered-after";
    expect(diffStates(before, after)[0]).toMatchObject({ domain: "content", summary: "New Layer: Rendered appearance changed", mergeability: "unsupported" });
  });
});

function pixelState(fingerprint: string): ProjectState {
  const state = structuredClone(base) as ProjectState;
  state.structure.roots = ["layer-1"];
  state.structure.layers = [{ uuid: "layer-1", photoshopId: 42, parentUuid: null, name: "New Layer", kind: "pixel", order: 0, children: [] }];
  state.identities.records = [{ uuid: "layer-1", photoshopId: 42, parentUuid: null, signature: "pixel|New Layer|root|0|0|10|10", confidence: "exact" }];
  state.appearance["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 10, bottom: 10 }, boundsWithoutEffects: { left: 0, top: 0, right: 10, bottom: 10 } };
  state.content["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", fingerprint, opaque: false, reason: null };
  return state;
}
