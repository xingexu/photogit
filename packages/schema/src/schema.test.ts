import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, SchemaValidationError, validateDocumentCapture, validateProjectMetadata, validateProjectState, type DocumentCapture, type ProjectState } from "./index.js";

function validState(): ProjectState {
  return {
    project: { schemaVersion: SCHEMA_VERSION, projectId: "project-1", displayName: "Poster", createdWith: "test" },
    document: { schemaVersion: SCHEMA_VERSION, documentId: "doc-1", name: "poster.psd", width: 100, height: 100, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null, compatibility: "supported", warnings: [] },
    identities: { schemaVersion: SCHEMA_VERSION, records: [] },
    structure: { schemaVersion: SCHEMA_VERSION, roots: [], layers: [] },
    appearance: {}, text: {}, content: {}
  };
}

describe("validateProjectState", () => {
  it("accepts a minimal valid state", () => expect(() => validateProjectState(validState())).not.toThrow());

  it("accepts optional composite fingerprints in legacy captures and saved states", () => {
    for (const fingerprint of [undefined, null, "rendered-v1:64x64x4:abc123", "x".repeat(10_000)]) {
      const state = validState();
      if (fingerprint !== undefined) state.document.renderedFingerprint = fingerprint;
      const { schemaVersion: _schemaVersion, compatibility: _compatibility, warnings: _warnings, ...document } = state.document;
      expect(() => validateProjectState(state)).not.toThrow();
      expect(() => validateDocumentCapture({ document, layers: [] })).not.toThrow();
    }
  });

  it("rejects oversized, malformed, or null-byte document composite fingerprints", () => {
    for (const fingerprint of [123, {}, [], "x".repeat(10_001), "rendered\0value"]) {
      const state = validState();
      Object.assign(state.document, { renderedFingerprint: fingerprint });
      const { schemaVersion: _schemaVersion, compatibility: _compatibility, warnings: _warnings, ...document } = state.document;
      expect(() => validateProjectState(state)).toThrow(/document.renderedFingerprint/);
      expect(() => validateDocumentCapture({ document, layers: [] })).toThrow(/capture.document.renderedFingerprint/);
    }
  });

  it("validates standalone project metadata before helper approval", () => {
    expect(() => validateProjectMetadata(validState().project)).not.toThrow();
    expect(() => validateProjectMetadata({ ...validState().project, token: "must-not-be-here" })).toThrow(/not a recognized field/);
  });

  it("rejects unknown schema versions", () => {
    const state = validState() as unknown as Record<string, unknown>;
    (state.document as Record<string, unknown>).schemaVersion = 99;
    expect(() => validateProjectState(state)).toThrow(SchemaValidationError);
  });

  it("rejects unknown nested fields instead of carrying untrusted structures into diffing", () => {
    const state = validState() as unknown as Record<string, unknown>;
    (state.document as Record<string, unknown>).unexpected = { deeply: { nested: true } };
    expect(() => validateProjectState(state)).toThrow(/document\.unexpected is not a recognized field/);
  });

  it("bounds validation diagnostics for highly malformed captures", () => {
    const invalid = {
      document: {},
      layers: Array.from({ length: 250 }, () => ({}))
    };
    try {
      validateDocumentCapture(invalid);
      throw new Error("Expected capture validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError);
      expect((error as SchemaValidationError).issues.length).toBeLessThanOrEqual(101);
      expect((error as Error).message).toMatch(/additional validation issue\(s\) omitted/);
    }
  });

  it("rejects filename-unsafe UUIDs before they can become domain paths", () => {
    const state = validState();
    state.structure.roots = ["../outside"];
    state.structure.layers = [{ uuid: "../outside", photoshopId: 1, parentUuid: null, name: "Unsafe", kind: "pixel", order: 0, children: [] }];
    state.identities.records = [{ uuid: "../outside", photoshopId: 1, parentUuid: null, signature: "unsafe", confidence: "exact" }];
    state.appearance["../outside"] = { schemaVersion: 1, layerUuid: "../outside", visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 1, bottom: 1 }, boundsWithoutEffects: { left: 0, top: 0, right: 1, bottom: 1 } };
    state.content["../outside"] = { schemaVersion: 1, layerUuid: "../outside", fingerprint: null, opaque: false, reason: null };
    expect(() => validateProjectState(state)).toThrow(/filename-safe layer UUID/);
  });

  it("validates nested Photoshop capture values and relationships", () => {
    const capture: DocumentCapture = {
      document: { documentId: "1", name: "poster.psd", width: 100, height: 100, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null },
      layers: [{
        photoshopId: 1, parentPhotoshopId: null, childrenPhotoshopIds: [], name: "Poster", kind: "pixel", order: 0,
        appearance: { visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 100, bottom: 100 }, boundsWithoutEffects: { left: 0, top: 0, right: 100, bottom: 100 } },
        text: null,
        content: { fingerprint: null, opaque: false, reason: null }
      }]
    };
    expect(() => validateDocumentCapture(capture)).not.toThrow();
    capture.layers[0]!.appearance.opacity = 101;
    expect(() => validateDocumentCapture(capture)).toThrow(/opacity/);
    capture.layers[0]!.appearance.opacity = 100;
    const duplicateOrder = structuredClone(capture.layers[0]!);
    duplicateOrder.photoshopId = 2;
    duplicateOrder.name = "Second root";
    capture.layers.push(duplicateOrder);
    expect(() => validateDocumentCapture(capture)).toThrow(/non-contiguous sibling order/);
  });

  it("rejects cyclic state that is disconnected from document roots", () => {
    const state = validState();
    state.structure.layers = [
      { uuid: "a", photoshopId: 1, parentUuid: "b", name: "A", kind: "group", order: 0, children: ["b"] },
      { uuid: "b", photoshopId: 2, parentUuid: "a", name: "B", kind: "group", order: 0, children: ["a"] }
    ];
    state.identities.records = [
      { uuid: "a", photoshopId: 1, parentUuid: "b", signature: "a", confidence: "exact" },
      { uuid: "b", photoshopId: 2, parentUuid: "a", signature: "b", confidence: "exact" }
    ];
    for (const uuid of ["a", "b"]) {
      state.appearance[uuid] = { schemaVersion: 1, layerUuid: uuid, visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 1, bottom: 1 }, boundsWithoutEffects: { left: 0, top: 0, right: 1, bottom: 1 } };
      state.content[uuid] = { schemaVersion: 1, layerUuid: uuid, fingerprint: null, opaque: false, reason: null };
    }
    expect(() => validateProjectState(state)).toThrow(/not reachable from a document root/);
  });
});
