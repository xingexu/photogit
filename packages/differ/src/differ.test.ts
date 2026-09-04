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
