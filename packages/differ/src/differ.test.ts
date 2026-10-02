import { describe, expect, it } from "vitest";
import type { ProjectState } from "@photogit/schema";
import { diffStates } from "./index.js";

const base = {
  project: { schemaVersion: 1, projectId: "p", displayName: "P", createdWith: "test" },
  document: { schemaVersion: 1, documentId: "d", name: "x.psd", width: 10, height: 10, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null, compatibility: "supported", warnings: [] },
  identities: { schemaVersion: 1, records: [] }, structure: { schemaVersion: 1, roots: [], layers: [] }, appearance: {}, text: {}, content: {}
} satisfies ProjectState;

describe("diffStates", () => {
  it("detects a one-pixel edit even when the thumbnail has not changed", () => {
    const before = pixelState("pixels-v1:64x64x4:11111111|full-v2:0000000000000001");
    const after = pixelState("pixels-v1:64x64x4:11111111|full-v2:0000000000000002");
    expect(diffStates(before, after)).toMatchObject([{ domain: "content", category: "modified", propertyPath: "fingerprint" }]);
    expect(diffStates(after, before)).toHaveLength(1);
  });

  it("does not invent edits when adding full-resolution coverage to an old saved version", () => {
    const legacy = pixelState("pixels-v1:64x64x4:11111111");
    const current = pixelState("pixels-v1:64x64x4:11111111|full-v2:0000000000000001");
    expect(diffStates(legacy, current)).toEqual([]);
    expect(diffStates(current, legacy)).toEqual([]);
    const edited = pixelState("pixels-v1:64x64x4:22222222|full-v2:0000000000000002");
    expect(diffStates(legacy, edited)).toHaveLength(1);
    const samePixels = pixelState("pixels-v1:64x64x4:33333333|full-v2:0000000000000001");
    expect(diffStates(current, samePixels)).toEqual([]);
  });
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
      baseValue: "rendered-v1:before", currentValue: "rendered-v1:after", mergeability: "unsupported"
    }]);
    expect(diffStates(before, after)[0]!.summary).toMatch(/no tracked layer setting changed/);
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
    expect(diffStates(before, after)[0]?.summary).toBe("New Layer: Pixels changed (painted, erased, filled, transformed or filtered)");
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
    expect(changes).toMatchObject([{ domain: "appearance", propertyPath: "opacity", baseValue: 63.137255, currentValue: 50.19607843137255, summary: "New Layer: Opacity changed from 63% to 50%" }]);
    expect(scanned.appearance["layer-1"]!.opacity).toBe(50.19607843137255);
  });

  it("preserves changes at the saved precision while avoiding identical rounded values in user copy", () => {
    const saved = pixelState("same-render"); saved.appearance["layer-1"]!.opacity = 63.137255;
    const scanned = structuredClone(saved); scanned.appearance["layer-1"]!.opacity = 63.137256;
    expect(diffStates(saved, scanned)).toMatchObject([{ baseValue: 63.137255, currentValue: 63.137256, summary: "New Layer: Opacity changed by less than 0.001%" }]);
  });

  it("detects transform bounds and text contents independently of rendered fingerprints", () => {
    const before = pixelState("same-render");
    before.structure.layers[0]!.kind = "text";
    before.text["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", contents: "Before", styleFingerprint: "font-1" };
    const after = structuredClone(before);
    after.text["layer-1"]!.contents = "After";
    // Same size, new place: a move is its own edit even beside a text edit.
    for (const box of [after.appearance["layer-1"]!.bounds, after.appearance["layer-1"]!.boundsWithoutEffects]) { box.left = 5; box.right = 15; }
    const changes = diffStates(before, after);
    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual(expect.objectContaining({ domain: "appearance", propertyPath: "bounds", summary: "New Layer: Moved 5 px right" }));
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
    // Swapping two layers moves one of them; the other only changed index.
    expect(diffStates(before, after)).toMatchObject([{ category: "reordered", propertyPath: "order" }]);
    expect(diffStates(before, after)[0]!.summary).toMatch(/in the layer stack, now (at the top|below “)/);
  });

  it.each([
    ["curves", "Rendered appearance changed"], ["smartobject", "Smart object contents changed"], ["solidcolor", "Fill or shape changed"],
    ["pixel", "Pixels changed (painted, erased, filled, transformed or filtered)"]
  ])("describes a %s fingerprint change by what could have caused it, without naming one operation", (kind, detail) => {
    const before = pixelState("rendered-before"); before.structure.layers[0]!.kind = kind;
    const after = structuredClone(before); after.content["layer-1"]!.fingerprint = "rendered-after";
    expect(diffStates(before, after)[0]).toMatchObject({ domain: "content", summary: `New Layer: ${detail}`, mergeability: "unsupported" });
  });

  it("states a move in pixels and does not also call it a pixel edit", () => {
    const before = pixelState("pixels-v1:64x64x4:11111111|full-v2:00000000000000a1|rel-v1:00000000000000ff");
    const after = structuredClone(before);
    for (const box of [after.appearance["layer-1"]!.bounds, after.appearance["layer-1"]!.boundsWithoutEffects]) { box.left += 12; box.right += 12; box.top -= 9; box.bottom -= 9; }
    after.content["layer-1"]!.fingerprint = "pixels-v1:64x64x4:11111111|full-v2:00000000000000b2|rel-v1:00000000000000ff";
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Moved 12 px right and 9 px up"]);
  });

  it("reports one geometry edit for a layer rather than one per edge", () => {
    const before = pixelState("same-render");
    const after = structuredClone(before);
    after.appearance["layer-1"]!.bounds = { left: 2, top: 3, right: 22, bottom: 33 };
    after.appearance["layer-1"]!.boundsWithoutEffects = { left: 2, top: 3, right: 22, bottom: 33 };
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Size changed from 10 × 10 px to 20 × 30 px, now at x 2, y 3"]);
  });

  it("does not report the siblings a new layer pushed down as reordered", () => {
    const before = pixelState("same-render");
    const after = structuredClone(before);
    after.structure.layers[0]!.order = 1;
    after.structure.layers.unshift({ uuid: "layer-new", photoshopId: 77, parentUuid: null, name: "Fresh", kind: "text", order: 0, children: [] });
    after.structure.roots = ["layer-new", "layer-1"];
    after.identities.records.push({ uuid: "layer-new", photoshopId: 77, parentUuid: null, signature: "text|Fresh|root|0|0|10|10", confidence: "confirmed" });
    after.appearance["layer-new"] = { ...after.appearance["layer-1"]!, layerUuid: "layer-new" };
    after.content["layer-new"] = { ...after.content["layer-1"]!, layerUuid: "layer-new" };
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["Added text layer “Fresh”"]);
  });

  it("names the group a layer moved into or out of", () => {
    const before = pixelState("same-render");
    before.structure.layers.push({ uuid: "group-1", photoshopId: 50, parentUuid: null, name: "Header", kind: "group", order: 1, children: [] });
    before.structure.roots.push("group-1");
    before.identities.records.push({ uuid: "group-1", photoshopId: 50, parentUuid: null, signature: "group|Header|root|0|0|10|10", confidence: "exact" });
    before.appearance["group-1"] = { ...before.appearance["layer-1"]!, layerUuid: "group-1" };
    before.content["group-1"] = { ...before.content["layer-1"]!, layerUuid: "group-1" };
    const after = structuredClone(before);
    after.structure.roots = ["group-1"];
    after.structure.layers = [{ ...after.structure.layers[1]!, order: 0, children: ["layer-1"] }, { ...after.structure.layers[0]!, parentUuid: "group-1" }];
    after.identities.records[0]!.parentUuid = "group-1";
    expect(diffStates(before, after).map((change) => change.summary)).toContain("New Layer: Moved into group “Header”");
    expect(diffStates(after, before).map((change) => change.summary)).toContain("New Layer: Moved out of group “Header” to the top level");
  });

  it.each([
    ["visible", false, "Hidden (was visible)"], ["blendMode", "colordodge", "Blend mode changed from Normal to Color Dodge"],
    ["clipped", true, "Clipped to the layer below"], ["fillOpacity", 25, "Fill changed from 100% to 25%"]
  ] as const)("words a %s edit the way Photoshop names it", (property, value, detail) => {
    const before = pixelState("same-render");
    const after = structuredClone(before);
    Object.assign(after.appearance["layer-1"]!, { [property]: value });
    expect(diffStates(before, after).map((change) => change.summary)).toEqual([`New Layer: ${detail}`]);
  });

  it("lists each text style property that changed instead of two opaque fingerprints", () => {
    const style = (size: number, red: number) => JSON.stringify({ character: { font: "helvetica", size, color: { red, green: 0, blue: 0 } }, paragraph: { alignment: "left" }, warp: { style: "none" } });
    const before = pixelState("render-a"); before.structure.layers[0]!.kind = "text";
    before.text["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", contents: "Hello", styleFingerprint: style(24, 0) };
    const after = structuredClone(before);
    after.text["layer-1"]!.styleFingerprint = style(32, 255);
    after.content["layer-1"]!.fingerprint = "render-b";
    // The re-rendered pixels follow from the style edit and are not a second edit.
    expect(diffStates(before, after).map((change) => change.summary)).toEqual([
      "New Layer: Text color changed from #000000 to #FF0000",
      "New Layer: Font size changed from 24 to 32"
    ]);
  });

  it("names layer effects, masks and adjustment settings from captured details", () => {
    const before = pixelState("same-render");
    before.content["layer-1"]!.details = { "mask.present": false, "effects.dropShadow.enabled": true, "effects.dropShadow.opacity": "35%", "adjustment.type": "curves", "label.color": "none" };
    const after = structuredClone(before);
    after.content["layer-1"]!.details = { "mask.present": true, "mask.enabled": true, "mask.density": "100%", "effects.dropShadow.enabled": false, "effects.dropShadow.opacity": "50%", "effects.innerGlow.enabled": true, "adjustment.type": "curves", "label.color": "red" };
    expect(diffStates(before, after).map((change) => change.summary)).toEqual([
      "New Layer: Drop shadow turned off",
      "New Layer: Inner glow added",
      "New Layer: Label color changed from none to red",
      "New Layer: Layer mask added"
    ]);
    expect(diffStates(after, before).map((change) => change.summary)).toEqual(expect.arrayContaining(["New Layer: Layer mask removed", "New Layer: Drop shadow turned on", "New Layer: Inner glow removed"]));
    const edited = structuredClone(before);
    edited.content["layer-1"]!.details = { ...before.content["layer-1"]!.details, "effects.dropShadow.opacity": "50%", "adjustment.brightness": 40, "adjustment.type": "brightnessEvent" };
    before.content["layer-1"]!.details!["adjustment.type"] = "brightnessEvent"; before.content["layer-1"]!.details!["adjustment.brightness"] = 0;
    expect(diffStates(before, edited).map((change) => change.summary)).toEqual([
      "New Layer: Brightness changed from 0 to 40",
      "New Layer: Drop shadow opacity changed from 35% to 50%"
    ]);
  });

  it("does not report the switched-off effects Photoshop lists beside a new one, or a painted mask that merely moved", () => {
    const before = pixelState("same-render");
    before.content["layer-1"]!.details = { "mask.present": true, "mask.enabled": true, "mask.pixels": "aaaa" };
    const after = structuredClone(before);
    after.content["layer-1"]!.details = { "mask.present": true, "mask.enabled": true, "mask.pixels": "bbbb", "effects.visible": true, "effects.dropShadow.enabled": true, "effects.dropShadow.opacity": "35%", "effects.frameFX.enabled": false, "effects.solidFill.enabled": false };
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Drop shadow added", "New Layer: Layer mask was repainted"]);
    for (const box of [after.appearance["layer-1"]!.bounds, after.appearance["layer-1"]!.boundsWithoutEffects]) { box.left += 5; box.right += 5; }
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Moved 5 px right", "New Layer: Drop shadow added"]);
  });

  it("reports a canvas resize once, not as a move of every layer it shifted", () => {
    const before = pixelState("pixels-v1:64x64x4:11111111|full-v2:00000000000000a1|rel-v1:00000000000000ff");
    before.structure.layers.push({ uuid: "layer-2", photoshopId: 43, parentUuid: null, name: "Backdrop", kind: "solidcolor", order: 1, children: [] });
    before.structure.roots.push("layer-2");
    before.identities.records.push({ uuid: "layer-2", photoshopId: 43, parentUuid: null, signature: "solidcolor|Backdrop|root|0|0|10|10", confidence: "exact" });
    before.appearance["layer-2"] = { ...structuredClone(before.appearance["layer-1"]!), layerUuid: "layer-2" };
    before.content["layer-2"] = { schemaVersion: 1, layerUuid: "layer-2", fingerprint: "fill-a", opaque: true, reason: null };
    before.appearance["layer-1"]!.bounds = { left: 2, top: 2, right: 6, bottom: 6 }; before.appearance["layer-1"]!.boundsWithoutEffects = { left: 2, top: 2, right: 6, bottom: 6 };
    const after = structuredClone(before);
    after.document.width = 20; after.document.height = 14;
    after.appearance["layer-1"]!.bounds = { left: 7, top: 4, right: 11, bottom: 8 }; after.appearance["layer-1"]!.boundsWithoutEffects = { left: 7, top: 4, right: 11, bottom: 8 };
    after.content["layer-1"]!.fingerprint = "pixels-v1:64x64x4:11111111|full-v2:00000000000000b2|rel-v1:00000000000000ff";
    after.appearance["layer-2"]!.bounds = { left: 0, top: 0, right: 20, bottom: 14 }; after.appearance["layer-2"]!.boundsWithoutEffects = { left: 0, top: 0, right: 20, bottom: 14 };
    after.content["layer-2"]!.fingerprint = "fill-b";
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["Canvas width changed from 10 px to 20 px", "Canvas height changed from 10 px to 14 px"]);
  });

  it("mentions the area effects cover only when the effects themselves cannot be named", () => {
    const before = pixelState("same-render");
    const after = structuredClone(before);
    after.appearance["layer-1"]!.bounds = { left: -4, top: -4, right: 14, bottom: 14 };
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Layer effects now cover 18 × 18 px (was 10 × 10 px)"]);
    before.content["layer-1"]!.details = { "mask.present": false };
    after.content["layer-1"]!.details = { "mask.present": false, "effects.dropShadow.enabled": true };
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Drop shadow added"]);
  });

  it("reports a layer Photoshop replaced in place as a conversion, not a deletion and an addition", () => {
    const before = pixelState("same-render");
    const after = structuredClone(before);
    after.structure.layers[0] = { ...after.structure.layers[0]!, uuid: "layer-so", photoshopId: 99, kind: "smartobject" };
    after.structure.roots = ["layer-so"];
    after.identities.records = [{ uuid: "layer-so", photoshopId: 99, parentUuid: null, signature: "smartobject|New Layer|root|0|0|10|10", confidence: "confirmed" }];
    after.appearance = { "layer-so": { ...before.appearance["layer-1"]!, layerUuid: "layer-so" } };
    after.content = { "layer-so": { ...before.content["layer-1"]!, layerUuid: "layer-so" } };
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Converted from a pixel layer to a smart object"]);
  });

  it("treats the new size of retyped text as part of the text edit and ignores settings Photoshop could not read", () => {
    const style = (alignment: string | null, indent: number | null) => JSON.stringify({ character: { size: 24 }, paragraph: { alignment, leftIndent: indent }, warp: {} });
    const before = pixelState("render-a"); before.structure.layers[0]!.kind = "text";
    before.text["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", contents: "Hello", styleFingerprint: style(null, 0) };
    const after = structuredClone(before);
    after.text["layer-1"] = { ...after.text["layer-1"]!, contents: "Hello there", styleFingerprint: style("center", null) };
    after.appearance["layer-1"]!.bounds.right = 30; after.appearance["layer-1"]!.boundsWithoutEffects.right = 30;
    expect(diffStates(before, after).map((change) => change.summary)).toEqual(["New Layer: Text changed from “Hello” to “Hello there”"]);
    after.text["layer-1"]!.styleFingerprint = style("center", 0);
    before.text["layer-1"]!.styleFingerprint = style("left", 0);
    expect(diffStates(before, after).map((change) => change.summary)).toContain("New Layer: Alignment changed from “left” to “center”");
  });

  it("does not invent edits when a version saved before details were captured is compared", () => {
    const before = pixelState("same-render");
    const after = structuredClone(before);
    after.content["layer-1"]!.details = { "mask.present": true, "effects.dropShadow.enabled": true };
    expect(diffStates(before, after)).toEqual([]);
    expect(diffStates(after, before)).toEqual([]);
  });

  it("keeps the document composite as a fallback only when no layer edit explains it", () => {
    const before = pixelState("same-render"); before.document.renderedFingerprint = "rendered-v1:before";
    const after = structuredClone(before); after.document.renderedFingerprint = "rendered-v1:after";
    expect(diffStates(before, after)).toMatchObject([{ domain: "document", propertyPath: "renderedFingerprint" }]);
    after.appearance["layer-1"]!.opacity = 40;
    expect(diffStates(before, after).map((change) => change.propertyPath)).toEqual(["opacity"]);
    // A rename does not change the picture, so it explains nothing.
    after.appearance["layer-1"]!.opacity = 100; after.structure.layers[0]!.name = "Renamed";
    expect(diffStates(before, after).map((change) => change.propertyPath)).toEqual(["renderedFingerprint", "name"]);
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
