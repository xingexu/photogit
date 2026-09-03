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
});
