import { describe, expect, it } from "vitest";
import type { ProjectState } from "@photogit/schema";
import { planMerge } from "./index.js";

const base = {
  project: { schemaVersion: 1, projectId: "p", displayName: "P", createdWith: "test" },
  document: { schemaVersion: 1, documentId: "d", name: "x.psd", width: 10, height: 10, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null, compatibility: "supported", warnings: [] },
  identities: { schemaVersion: 1, records: [] }, structure: { schemaVersion: 1, roots: [], layers: [] }, appearance: {}, text: {}, content: {}
} satisfies ProjectState;

function twoLayerState(): ProjectState {
  const state = structuredClone(base) as ProjectState;
  state.structure.roots = ["layer-a", "layer-b"];
  state.structure.layers = [
    { uuid: "layer-a", photoshopId: 1, parentUuid: null, name: "Headline", kind: "text", order: 0, children: [] },
    { uuid: "layer-b", photoshopId: 2, parentUuid: null, name: "Artwork", kind: "pixel", order: 1, children: [] }
  ];
  state.identities.records = [
    { uuid: "layer-a", photoshopId: 1, parentUuid: null, signature: "text|Headline|root|0|0|10|10", confidence: "exact" },
    { uuid: "layer-b", photoshopId: 2, parentUuid: null, signature: "pixel|Artwork|root|0|0|10|10", confidence: "exact" }
  ];
  for (const uuid of state.structure.roots) {
    state.appearance[uuid] = { schemaVersion: 1, layerUuid: uuid, visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 10, bottom: 10 }, boundsWithoutEffects: { left: 0, top: 0, right: 10, bottom: 10 } };
    state.content[uuid] = { schemaVersion: 1, layerUuid: uuid, fingerprint: null, opaque: false, reason: null };
  }
  state.text["layer-a"] = { schemaVersion: 1, layerUuid: "layer-a", contents: "Headline", styleFingerprint: null };
  return state;
}

describe("planMerge", () => {
  it("combines independent properties", () => {
    const current = structuredClone(base); current.document.width = 20;
    const incoming = structuredClone(base); incoming.document.height = 30;
    const plan = planMerge(base, current, incoming);
    expect(plan.conflicts).toEqual([]);
    expect(plan.result?.document).toMatchObject({ width: 20, height: 30 });
  });

  it("flags different changes to the same property", () => {
    const current = structuredClone(base); current.document.width = 20;
    const incoming = structuredClone(base); incoming.document.width = 30;
    expect(planMerge(base, current, incoming).conflicts[0]).toMatchObject({ propertyPath: "document.width", reason: "same-property" });
  });

  it("treats object key order as semantic noise inside array-valued structure data", () => {
    const layered: ProjectState = structuredClone(base);
    layered.structure.roots = ["layer-1"];
    layered.structure.layers = [{ uuid: "layer-1", photoshopId: 1, parentUuid: null, name: "Hero", kind: "pixel", order: 0, children: [] }];
    layered.identities.records = [{ uuid: "layer-1", photoshopId: 1, parentUuid: null, signature: "pixel|Hero|root|0|0|10|10", confidence: "exact" }];
    layered.appearance["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 10, bottom: 10 }, boundsWithoutEffects: { left: 0, top: 0, right: 10, bottom: 10 } };
    layered.content["layer-1"] = { schemaVersion: 1, layerUuid: "layer-1", fingerprint: null, opaque: false, reason: null };
    const current = structuredClone(layered);
    current.structure.layers[0] = Object.fromEntries(Object.entries(current.structure.layers[0]!).reverse()) as typeof current.structure.layers[number];
    const incoming = structuredClone(layered);
    incoming.structure.layers[0]!.name = "Hero refined";

    const plan = planMerge(layered, current, incoming);
    expect(plan.conflicts).toEqual([]);
    expect(plan.result?.structure.layers[0]?.name).toBe("Hero refined");
  });

  it("combines independent edits to separate layer records", () => {
    const layered = twoLayerState();
    const current = structuredClone(layered);
    current.structure.layers[0]!.name = "Headline revised";
    const incoming = structuredClone(layered);
    incoming.structure.layers[1]!.name = "Artwork revised";

    const plan = planMerge(layered, current, incoming);
    expect(plan.conflicts).toEqual([]);
    expect(plan.result?.structure.layers.map((layer) => layer.name)).toEqual(["Headline revised", "Artwork revised"]);
  });

  it("reports the exact layer when both sides rename it differently", () => {
    const layered = twoLayerState();
    const current = structuredClone(layered);
    current.structure.layers[0]!.name = "Headline A";
    const incoming = structuredClone(layered);
    incoming.structure.layers[0]!.name = "Headline B";

    expect(planMerge(layered, current, incoming).conflicts[0]).toMatchObject({
      layerUuid: "layer-a",
      propertyPath: "structure.layers.layer-a.name",
      reason: "same-property"
    });
  });
});
