import { validateDocumentCapture, type DocumentCapture } from "@photogit/schema";
import { isAbsolute } from "node:path";

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_HELPER_PORT = 54738;
export const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const SAFE_HELPER_TOKEN = /^[A-Za-z0-9_-]{32,200}$/;
const MAX_PATH_LENGTH = 4_096;

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
  if (typeof value.requestId !== "string" || !SAFE_REQUEST_ID.test(value.requestId)) throw new Error("Invalid request ID.");
  if (!isSafePathString(value.projectRoot)) throw new Error("A valid project root is required.");
  const operationFields: Record<string, string[]> = {
    capture: ["message", "capture", "snapshotPath", "previewPath"],
    refresh: ["capture"],
    createBranch: ["branch"],
    switchBranch: ["branch"],
    mergeBranch: ["branch"],
    createTag: ["tag"],
    pullRequestLink: ["base"]
  };
  assertAllowedKeys(value, ["protocolVersion", "operation", "requestId", "projectRoot", ...(operationFields[value.operation] ?? [])], "request");
  if (value.operation === "capture") {
    if (typeof value.message !== "string" || value.message.trim().length === 0 || value.message.length > 500 || /[\0-\x1f\x7f]/.test(value.message)) throw new Error("A one-line save-version message between 1 and 500 characters is required.");
    validateDocumentCapture(value.capture);
    if (value.snapshotPath !== undefined && !isSafePathString(value.snapshotPath)) throw new Error("The snapshot path is invalid.");
    if (value.previewPath !== undefined && !isSafePathString(value.previewPath)) throw new Error("The preview path is invalid.");
  }
  if (value.operation === "refresh") validateDocumentCapture(value.capture);
  if (["createBranch", "switchBranch", "mergeBranch"].includes(value.operation) && !isBoundedString(value.branch, 200)) throw new Error("This operation requires a branch name of at most 200 characters.");
  if (value.operation === "createTag" && !isBoundedString(value.tag, 100)) throw new Error("This operation requires a tag name of at most 100 characters.");
  if (value.operation === "pullRequestLink" && value.base !== undefined && !isBoundedString(value.base, 200)) throw new Error("The pull-request base branch is invalid.");
  return value as HelperRequest;
}

export function parseBridgeEnvelope(value: unknown): BridgeEnvelope {
  if (!isRecord(value)) throw new Error("Bridge request must be an object.");
  assertAllowedKeys(value, ["token", "request"], "bridge request");
  if (typeof value.token !== "string" || !SAFE_HELPER_TOKEN.test(value.token)) throw new Error("The helper token is missing or invalid.");
  return { token: value.token, request: parseHelperRequest(value.request) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\0-\x1f\x7f]/.test(value);
}

function isSafePathString(value: unknown): value is string {
  return isBoundedString(value, MAX_PATH_LENGTH) && !/[\x01-\x1f\x7f]/.test(value) && isAbsolute(value);
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const expected = new Set(allowed);
  const extra = Object.keys(value).find((key) => !expected.has(key));
  if (extra) throw new Error(`Unknown ${label} field: ${extra}.`);
}
