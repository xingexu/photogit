import { describe, expect, it } from "vitest";
import { parseBridgeEnvelope, parseHelperRequest, PROTOCOL_VERSION } from "./index.js";

describe("helper protocol", () => {
  it("rejects unknown operations", () => expect(() => parseHelperRequest({ protocolVersion: PROTOCOL_VERSION, operation: "shell", requestId: "12345678", projectRoot: "/tmp" })).toThrow("Unknown"));
  it("rejects version mismatches", () => expect(() => parseHelperRequest({ protocolVersion: 99, operation: "status", requestId: "12345678", projectRoot: "/tmp" })).toThrow("not supported"));
  it("validates authenticated file-bridge envelopes", () => {
    const envelope = parseBridgeEnvelope({
      token: "a-secure-project-token-value",
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
});
