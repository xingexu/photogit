import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, SchemaValidationError, validateProjectState, type ProjectState } from "./index.js";

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

  it("rejects unknown schema versions", () => {
    const state = validState() as unknown as Record<string, unknown>;
    (state.document as Record<string, unknown>).schemaVersion = 99;
    expect(() => validateProjectState(state)).toThrow(SchemaValidationError);
  });
});
