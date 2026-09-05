import { describe, expect, it } from "vitest";
import { parseBridgeEnvelope, parseHelperRequest, PROTOCOL_VERSION } from "./index.js";

describe("helper protocol", () => {
  it("rejects unknown operations", () => expect(() => parseHelperRequest({ protocolVersion: PROTOCOL_VERSION, operation: "shell", requestId: "12345678", projectRoot: "/tmp" })).toThrow("Unknown"));
  it("rejects version mismatches", () => expect(() => parseHelperRequest({ protocolVersion: 99, operation: "status", requestId: "12345678", projectRoot: "/tmp" })).toThrow("not supported"));
  it("validates authenticated file-bridge envelopes", () => {
    const envelope = parseBridgeEnvelope({
      token: "a".repeat(43),
      request: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "status",
        requestId: "request-123",
        projectRoot: "/tmp/design"
      }
    });
    expect(envelope.request.operation).toBe("status");
    expect(() => parseBridgeEnvelope({ token: "short", request: envelope.request })).toThrow(/token/i);
  });
  it("validates bridge deadlines without silently accepting malformed expiry", () => {
    const request = { protocolVersion: 1, operation: "status", requestId: "request-123", projectRoot: "/tmp/project" };
    expect(parseBridgeEnvelope({ token: "a".repeat(43), request, expiresAt: 123456789 })).toHaveProperty("expiresAt", 123456789);
    for (const expiresAt of ["later", -1, NaN, 1.5]) expect(() => parseBridgeEnvelope({ token: "a".repeat(43), request, expiresAt })).toThrow(/expiry/);
  });
  it("requires explicit, bounded document identity and an adoption boolean", () => {
    const base = { protocolVersion: 1, requestId: "request-123", projectRoot: "/tmp/project", operation: "connectDocument" };
    const documentIdentity = { documentId: "doc-1", name: "poster.psd", sourcePath: "/tmp/project/poster.psd" };
    expect(parseHelperRequest({ ...base, documentIdentity, adopt: true })).toMatchObject({ adopt: true });
    expect(() => parseHelperRequest(base)).toThrow(/identity/);
    expect(() => parseHelperRequest({ ...base, documentIdentity, adopt: "yes" })).toThrow(/boolean/);
    expect(() => parseHelperRequest({ ...base, documentIdentity: { ...documentIdentity, sourcePath: "relative.psd" } })).toThrow(/identity/);
    expect(() => parseHelperRequest({ ...base, documentIdentity: { ...documentIdentity, injected: true } })).toThrow(/Unknown/);
  });
  it("restricts history opening to saved version IDs and validates comparison names", () => {
    const base = { protocolVersion: 1, requestId: "request-123", projectRoot: "/tmp/project" };
    expect(parseHelperRequest({ ...base, operation: "openVersion", version: "abcdef123" })).toHaveProperty("version", "abcdef123");
    expect(parseHelperRequest({ ...base, operation: "openVersion", version: "HEAD" })).toHaveProperty("version", "HEAD");
    expect(parseHelperRequest({ ...base, operation: "versionDetails", version: "HEAD" })).toHaveProperty("version", "HEAD");
    for (const version of ["--help", "main", "../file", "abcd\n1234"]) expect(() => parseHelperRequest({ ...base, operation: "versionDetails", version })).toThrow(/version ID/);
    expect(parseHelperRequest({ ...base, operation: "compareBranches", branch: "origin/design", base: "main" })).toHaveProperty("base", "main");
    expect(() => parseHelperRequest({ ...base, operation: "compareBranches", branch: "" })).toThrow(/branch name/);
  });
  it("validates review-tool arguments", () => {
    const base = { protocolVersion: PROTOCOL_VERSION, requestId: "request-123", projectRoot: "/tmp/project" };
    expect(parseHelperRequest({ ...base, operation: "mergeBranch", branch: "feature/review" }).operation).toBe("mergeBranch");
    expect(parseHelperRequest({ ...base, operation: "createTag", tag: "v1.0.0" }).operation).toBe("createTag");
    expect(() => parseHelperRequest({ ...base, operation: "mergeBranch" })).toThrow("branch name");
    expect(() => parseHelperRequest({ ...base, operation: "createTag" })).toThrow("tag name");
  });
  it("keeps request IDs filename-safe for the authenticated bridge", () => {
    const request = { protocolVersion: PROTOCOL_VERSION, operation: "status", requestId: "../../escape", projectRoot: "/tmp/project" };
    expect(() => parseHelperRequest(request)).toThrow("request ID");
    expect(() => parseHelperRequest({ ...request, requestId: "request_123-safe" })).not.toThrow();
  });
  it("rejects undeclared request and envelope fields", () => {
    const request = { protocolVersion: PROTOCOL_VERSION, operation: "status", requestId: "request-123", projectRoot: "/tmp/project" };
    expect(() => parseHelperRequest({ ...request, command: "unexpected" })).toThrow(/Unknown request field/);
    expect(() => parseBridgeEnvelope({ token: "a".repeat(43), request, extra: true })).toThrow(/Unknown bridge request field/);
  });
  it("requires absolute paths and rejects null bytes in commit messages", () => {
    const base = { protocolVersion: PROTOCOL_VERSION, operation: "status", requestId: "request-123" };
    expect(() => parseHelperRequest({ ...base, projectRoot: "relative/project" })).toThrow("project root");
    const capture = {
      document: { documentId: "1", name: "poster.psd", width: 100, height: 100, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null },
      layers: []
    };
    expect(() => parseHelperRequest({ ...base, operation: "capture", projectRoot: "/tmp/project", message: "save\0hidden", capture })).toThrow("one-line");
  });
  it("rejects malformed nested capture data before it reaches Photoshop state serialization", () => {
    const capture = {
      document: { documentId: "1", name: "poster.psd", width: 100, height: 100, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null },
      layers: [{
        photoshopId: 1, parentPhotoshopId: null, childrenPhotoshopIds: [], name: "Poster", kind: "pixel", order: 0,
        appearance: { visible: true, opacity: 999, fillOpacity: 100, blendMode: "normal", clipped: false, locks: { all: false, pixels: false, position: false, transparentPixels: false }, bounds: { left: 0, top: 0, right: 100, bottom: 100 }, boundsWithoutEffects: { left: 0, top: 0, right: 100, bottom: 100 } },
        text: null,
        content: { fingerprint: null, opaque: false, reason: null }
      }]
    };
    expect(() => parseHelperRequest({ protocolVersion: PROTOCOL_VERSION, operation: "refresh", requestId: "request-123", projectRoot: "/tmp/project", capture })).toThrow(/opacity/);
  });
});
