import { validateDocumentCapture, type DocumentCapture } from "@photogit/schema";
import { isAbsolute } from "node:path";

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_HELPER_PORT = 54738;
export const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
export const BRIDGE_REQUEST_TIMEOUT_MS = 120_000;
export const BRIDGE_FILE_RETENTION_MS = 5 * 60_000;
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
  documentIdentity?: DocumentIdentity;
};

export type StatusRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  operation: "status";
  requestId: string;
  projectRoot: string;
};

export type ProjectActionRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  operation: "history" | "branches" | "refresh" | "createBranch" | "switchBranch" | "pull" | "push" | "reviews" | "mergeBranch" | "createTag" | "pullRequestLink" | "connectDocument" | "versionDetails" | "openVersion" | "compareBranches";
  requestId: string;
  projectRoot: string;
  capture?: DocumentCapture;
  branch?: string;
  tag?: string;
  base?: string;
  version?: string;
  documentIdentity?: DocumentIdentity;
  adopt?: boolean;
};

export type DocumentIdentity = { documentId: string; name: string; sourcePath: string | null };
export type OperationOutcome = "success" | "failure" | "snapshot_open_failed" | "recovery_required";
export type OperationContext = { outcome: OperationOutcome; branch?: string; previousBranch?: string; gitChanged?: boolean; outcomeUnknown?: boolean; snapshotPath?: string };
export type SaveVersionResult = { outcome: "success"; versionId: string; shortId: string; warningCount: number };
export type BranchOperationResult = { outcome: "success"; branch: string; previousBranch: string; gitChanged: boolean; snapshotPath: string };
export type SnapshotOpenFailure = { outcome: "snapshot_open_failed"; gitChanged: boolean; branch: string; snapshotPath: string; message: string };
export type OperationFailure = { outcome: "failure" | "recovery_required"; code: string; message: string; branch?: string; previousBranch?: string; gitChanged?: boolean; outcomeUnknown?: boolean };

export type HelperResponse<T = unknown> = {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string } & Partial<OperationContext>;
};

export type BridgeEnvelope = {
  token: string;
  request: HelperRequest;
  expiresAt?: number;
};

export function parseHelperRequest(value: unknown): HelperRequest {
  if (!isRecord(value)) throw new Error("Request body must be an object.");
  if (value.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Protocol version ${String(value.protocolVersion)} is not supported.`);
  const operations = ["capture", "status", "history", "branches", "refresh", "createBranch", "switchBranch", "pull", "push", "reviews", "mergeBranch", "createTag", "pullRequestLink", "connectDocument", "versionDetails", "openVersion", "compareBranches"];
  if (typeof value.operation !== "string" || !operations.includes(value.operation)) throw new Error("Unknown helper operation.");
  if (typeof value.requestId !== "string" || !SAFE_REQUEST_ID.test(value.requestId)) throw new Error("Invalid request ID.");
  if (!isSafePathString(value.projectRoot)) throw new Error("A valid project root is required.");
  const operationFields: Record<string, string[]> = {
    capture: ["message", "capture", "snapshotPath", "previewPath", "documentIdentity"],
    refresh: ["capture", "documentIdentity"],
    connectDocument: ["documentIdentity", "adopt"],
    versionDetails: ["version"],
    openVersion: ["version"],
    compareBranches: ["branch", "base"],
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
  if (value.documentIdentity !== undefined) validateDocumentIdentity(value.documentIdentity);
  if (value.operation === "connectDocument") {
    validateDocumentIdentity(value.documentIdentity);
    if (value.adopt !== undefined && typeof value.adopt !== "boolean") throw new Error("The document adoption choice must be a boolean.");
  }
  if (["versionDetails", "openVersion"].includes(value.operation) && (typeof value.version !== "string" || (value.version !== "HEAD" && !/^[a-fA-F0-9]{7,64}$/.test(value.version)))) throw new Error("A saved version ID or HEAD is required.");
  if (["createBranch", "switchBranch", "mergeBranch", "compareBranches"].includes(value.operation) && !isBoundedString(value.branch, 200)) throw new Error("This operation requires a branch name of at most 200 characters.");
  if (value.operation === "createTag" && !isBoundedString(value.tag, 100)) throw new Error("This operation requires a tag name of at most 100 characters.");
  if (["pullRequestLink", "compareBranches"].includes(value.operation) && value.base !== undefined && !isBoundedString(value.base, 200)) throw new Error("The comparison base branch is invalid.");
  return value as HelperRequest;
}

export function parseBridgeEnvelope(value: unknown): BridgeEnvelope {
  if (!isRecord(value)) throw new Error("Bridge request must be an object.");
  assertAllowedKeys(value, ["token", "request", "expiresAt"], "bridge request");
  if (typeof value.token !== "string" || !SAFE_HELPER_TOKEN.test(value.token)) throw new Error("The helper token is missing or invalid.");
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0)) throw new Error("The bridge request expiry is invalid.");
  return { token: value.token, request: parseHelperRequest(value.request), ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt as number } : {}) };
}

export function validateDocumentIdentity(value: unknown): asserts value is DocumentIdentity {
  if (!isRecord(value)) throw new Error("A document identity is required.");
  assertAllowedKeys(value, ["documentId", "name", "sourcePath"], "document identity");
  if (!isBoundedString(value.documentId, 500) || !isBoundedString(value.name, 1_024) || (value.sourcePath !== null && !isSafePathString(value.sourcePath))) throw new Error("The document identity is invalid.");
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
