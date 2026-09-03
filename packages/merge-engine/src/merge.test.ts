import { describe, expect, it } from "vitest";
import type { ProjectState } from "@photogit/schema";
import { planMerge } from "./index.js";

const base = {
  project: { schemaVersion: 1, projectId: "p", displayName: "P", createdWith: "test" },
  document: { schemaVersion: 1, documentId: "d", name: "x.psd", width: 10, height: 10, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null, compatibility: "supported", warnings: [] },
  identities: { schemaVersion: 1, records: [] }, structure: { schemaVersion: 1, roots: [], layers: [] }, appearance: {}, text: {}, content: {}
} satisfies ProjectState;

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
});
