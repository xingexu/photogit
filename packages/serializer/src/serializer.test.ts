import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type DocumentCapture } from "@photogit/schema";
import { AmbiguousLayerIdentityError, canonicalJson, stateFromCapture, stateToFiles } from "./index.js";

const capture: DocumentCapture = {
  document: { documentId: "10", name: "poster.psd", width: 1920.12345678, height: 1080, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null },
  layers: [{
    photoshopId: 2, parentPhotoshopId: null, childrenPhotoshopIds: [], name: "Title", kind: "text", order: 0,
    appearance: { visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 1, top: 2, right: 3, bottom: 4 }, boundsWithoutEffects: { left: 1, top: 2, right: 3, bottom: 4 } },
    text: { contents: "Hello", styleFingerprint: null },
    content: { fingerprint: null, opaque: false, reason: null }
  }]
};

describe("canonical serialization", () => {
  it("sorts keys and normalizes precision", () => expect(canonicalJson({ z: 1, a: 1.123456789 })).toBe('{\n  "a": 1.123457,\n  "z": 1\n}\n'));

  it("splits a capture into deterministic domain files", () => {
    const state = stateFromCapture(capture, { schemaVersion: SCHEMA_VERSION, projectId: "p", displayName: "Poster", createdWith: "test" }, () => "layer-a");
    const files = stateToFiles(state);
    expect([...files.keys()]).toContain(".photogit/text/layer-a.json");
    expect(files.get(".photogit/document.json")).toContain('"width": 1920.123457');
  });

  it("retains identity after Photoshop changes a layer ID", () => {
    const initial = stateFromCapture(capture, { schemaVersion: SCHEMA_VERSION, projectId: "p", displayName: "Poster", createdWith: "test" }, () => "layer-a");
    const reopened = structuredClone(capture);
    reopened.layers[0]!.photoshopId = 99;
    const result = stateFromCapture(reopened, initial.project, () => "layer-b", initial.identities.records);
    expect(result.structure.layers[0]?.uuid).toBe("layer-a");
  });

  it("serializes deeply nested layers in deterministic parent-before-child order", () => {
    const nested = structuredClone(capture);
    nested.layers = [
      { ...structuredClone(capture.layers[0]!), photoshopId: 1, parentPhotoshopId: null, childrenPhotoshopIds: [2], name: "Root", kind: "group", text: null },
      { ...structuredClone(capture.layers[0]!), photoshopId: 2, parentPhotoshopId: 1, childrenPhotoshopIds: [3], name: "Child", kind: "group", text: null },
      { ...structuredClone(capture.layers[0]!), photoshopId: 3, parentPhotoshopId: 2, childrenPhotoshopIds: [4], name: "Grandchild", kind: "group", text: null },
      { ...structuredClone(capture.layers[0]!), photoshopId: 4, parentPhotoshopId: 3, childrenPhotoshopIds: [], name: "Leaf" }
    ];
    const uuids = ["root-z", "child-z", "grand-z", "deep-a"];
    const state = stateFromCapture(nested, { schemaVersion: SCHEMA_VERSION, projectId: "p", displayName: "Poster", createdWith: "test" }, () => uuids.shift()!);
    expect(state.structure.layers.map((layer) => layer.name)).toEqual(["Root", "Child", "Grandchild", "Leaf"]);
  });

  it("refuses ambiguous identity matches", () => {
    const signature = "text|Title|root|1|2|3|4";
    expect(() => stateFromCapture(capture, { schemaVersion: SCHEMA_VERSION, projectId: "p", displayName: "Poster", createdWith: "test" }, () => "new", [
      { uuid: "a", photoshopId: 8, parentUuid: null, signature },
      { uuid: "b", photoshopId: 9, parentUuid: null, signature }
    ])).toThrow(AmbiguousLayerIdentityError);
  });
});
