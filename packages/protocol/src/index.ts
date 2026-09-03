import type { DocumentCapture } from "@photogit/schema";

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_HELPER_PORT = 54738;
export const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

export type HelperRequest = CaptureRequest | StatusRequest | ProjectActionRequest;

export type CaptureRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  operation: "capture";
  requestId: string;
  projectRoot: string;
  message: string;
  capture: DocumentCapture;
  snapshotPath?: string;
  previewPath?: string;
};

export type StatusRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  operation: "status";
  requestId: string;
  projectRoot: string;
};

export type ProjectActionRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  operation: "history" | "branches" | "refresh" | "createBranch" | "switchBranch" | "pull" | "push" | "reviews" | "mergeBranch" | "createTag" | "pullRequestLink";
  requestId: string;
  projectRoot: string;
  capture?: DocumentCapture;
  branch?: string;
  tag?: string;
  base?: string;
};

export type HelperResponse<T = unknown> = {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
};

export type BridgeEnvelope = {
  token: string;
  request: HelperRequest;
};

export function parseHelperRequest(value: unknown): HelperRequest {
  if (!isRecord(value)) throw new Error("Request body must be an object.");
  if (value.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Protocol version ${String(value.protocolVersion)} is not supported.`);
  const operations = ["capture", "status", "history", "branches", "refresh", "createBranch", "switchBranch", "pull", "push", "reviews", "mergeBranch", "createTag", "pullRequestLink"];
  if (typeof value.operation !== "string" || !operations.includes(value.operation)) throw new Error("Unknown helper operation.");
  if (typeof value.requestId !== "string" || value.requestId.length < 8 || value.requestId.length > 100) throw new Error("Invalid request ID.");
  if (typeof value.projectRoot !== "string" || value.projectRoot.length === 0) throw new Error("A project root is required.");
  if (value.operation === "capture") {
    if (typeof value.message !== "string" || value.message.trim().length === 0 || value.message.length > 500) throw new Error("A save-version message between 1 and 500 characters is required.");
    if (!isRecord(value.capture) || !isRecord(value.capture.document) || !Array.isArray(value.capture.layers)) throw new Error("Invalid Photoshop capture payload.");
  }
  if (value.operation === "refresh" && (!isRecord(value.capture) || !isRecord(value.capture.document) || !Array.isArray(value.capture.layers))) throw new Error("Refresh requires a Photoshop capture payload.");
  if (["createBranch", "switchBranch", "mergeBranch"].includes(value.operation) && (typeof value.branch !== "string" || value.branch.length === 0)) throw new Error("This operation requires a branch name.");
  if (value.operation === "createTag" && (typeof value.tag !== "string" || value.tag.length === 0)) throw new Error("This operation requires a tag name.");
  if (value.operation === "pullRequestLink" && value.base !== undefined && (typeof value.base !== "string" || value.base.length === 0)) throw new Error("The pull-request base branch is invalid.");
  return value as HelperRequest;
}

export function parseBridgeEnvelope(value: unknown): BridgeEnvelope {
  if (!isRecord(value)) throw new Error("Bridge request must be an object.");
  if (typeof value.token !== "string" || value.token.length < 20 || value.token.length > 200) throw new Error("The helper token is missing or invalid.");
  return { token: value.token, request: parseHelperRequest(value.request) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
