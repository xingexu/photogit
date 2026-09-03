#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { GitRepository, isWithinRoot } from "@photogit/git-engine";
import { readProjectState } from "@photogit/git-engine";
import { DEFAULT_HELPER_PORT, MAX_REQUEST_BYTES, parseBridgeEnvelope, parseHelperRequest, PROTOCOL_VERSION, type HelperRequest, type HelperResponse } from "@photogit/protocol";
import type { ProjectMetadata, ProjectState } from "@photogit/schema";
import { canonicalJson, stateFromCapture } from "@photogit/serializer";
import { diffStates } from "@photogit/differ";

type HelperConfig = { protocolVersion: 1; token: string; approvedRoots: string[] };

class SlidingWindowLimiter {
  private readonly requests = new Map<string, number[]>();
  constructor(private readonly maximum: number, private readonly windowMs: number) {}
  allow(key: string): boolean {
    const threshold = Date.now() - this.windowMs;
    const recent = (this.requests.get(key) ?? []).filter((time) => time >= threshold);
    if (recent.length >= this.maximum) return false;
    recent.push(Date.now());
    this.requests.set(key, recent);
    return true;
  }
}

const args = process.argv.slice(2);
const configPath = resolve(process.env.PHOTOGIT_HELPER_CONFIG ?? join(homedir(), ".photogit", "helper.json"));
const port = numericOption("--port", DEFAULT_HELPER_PORT);
const approvedFromArgs = repeatedOption("--approve-root").map((path) => resolve(path));
const config = await loadOrCreateConfig(configPath, approvedFromArgs);
await writePairingFiles(config);
const limiter = new SlidingWindowLimiter(60, 60_000);
startFileBridge(config);

const server = createServer(async (request, response) => {
  setCors(response);
  if (request.method === "OPTIONS") return send(response, 204, undefined);
  if (request.method === "GET" && request.url === "/v1/health") {
    return send(response, 200, { protocolVersion: PROTOCOL_VERSION, ok: true, service: "photogit-helper" });
  }
  if (request.method !== "POST" || request.url !== "/v1/request") return sendError(response, 404, "NOT_FOUND", "Unknown helper endpoint.", "unknown");
  if (!limiter.allow(request.socket.remoteAddress ?? "unknown")) return sendError(response, 429, "RATE_LIMITED", "Too many helper requests. Try again shortly.", "unknown");
  if (!authorized(request, config.token)) return sendError(response, 401, "UNAUTHORIZED", "The helper token is missing or invalid.", "unknown");

  let requestId = "unknown";
  try {
    const payload = parseHelperRequest(JSON.parse(await readBody(request)));
    requestId = payload.requestId;
    return sendOk(response, requestId, await executeRequest(payload, config));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 422;
    const code = isCoded(error) ? error.code : error instanceof SyntaxError ? "INVALID_JSON" : "REQUEST_FAILED";
    log("error", { requestId, code, message: safeMessage(error) });
    return sendError(response, status, code, safeMessage(error), requestId);
  }
});

async function executeRequest(payload: HelperRequest, helperConfig: HelperConfig): Promise<unknown> {
  const projectRoot = resolve(payload.projectRoot);
  if (!helperConfig.approvedRoots.some((root) => isWithinRoot(root, projectRoot))) throw coded("ROOT_NOT_APPROVED", "This project folder has not been approved in the PhotoGit helper.");
  const repository = new GitRepository(projectRoot);
  if (payload.operation === "status") {
    const [branch, changes] = await Promise.all([repository.currentBranch(), repository.status()]);
    return { branch, changeCount: changes.length, changes };
  }
  if (payload.operation === "history") return { versions: await repository.history(40) };
  if (payload.operation === "branches") return { branches: await repository.branches(), current: await repository.currentBranch() };
  if (payload.operation === "refresh") {
    const base = await readProjectState(projectRoot);
    const current = stateFromCapture(payload.capture!, base.project, randomUUID, base.identities.records);
    return { changes: diffStates(base, current) };
  }
  if (payload.operation === "createBranch") {
    await repository.createBranch(payload.branch!);
    return { branch: payload.branch, snapshotPath: join(projectRoot, "snapshot", "document.psd") };
  }
  if (payload.operation === "switchBranch") {
    await repository.switchBranch(payload.branch!);
    return { branch: payload.branch, snapshotPath: join(projectRoot, "snapshot", "document.psd") };
  }
  if (payload.operation === "pull") {
    await repository.pull();
    return { branch: await repository.currentBranch(), snapshotPath: join(projectRoot, "snapshot", "document.psd") };
  }
  if (payload.operation === "push") {
    await repository.push();
    return { branch: await repository.currentBranch() };
  }
  if (payload.operation !== "capture") throw coded("UNKNOWN_OPERATION", "Unknown helper operation.");

  for (const path of [payload.snapshotPath, payload.previewPath]) {
    if (path && !isWithinRoot(projectRoot, path)) throw coded("UNSAFE_ARTIFACT_PATH", "Snapshot and preview files must be inside the approved project folder.");
  }
  const project = JSON.parse(await readFile(join(projectRoot, ".photogit", "project.json"), "utf8")) as ProjectMetadata;
  const identities = await readFile(join(projectRoot, ".photogit", "identities.json"), "utf8")
    .then((text) => (JSON.parse(text) as ProjectState["identities"]).records)
    .catch(() => []);
  const state = stateFromCapture(payload.capture, project, randomUUID, identities);
  const versionId = await repository.saveVersion(state, payload.message, {
    ...(payload.snapshotPath ? { snapshotPath: payload.snapshotPath } : {}),
    ...(payload.previewPath ? { previewPath: payload.previewPath } : {})
  });
  return { versionId, shortId: versionId.slice(0, 8), warningCount: state.document.warnings.length };
}

function startFileBridge(helperConfig: HelperConfig): void {
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      for (const root of helperConfig.approvedRoots) await drainBridgeRoot(root, helperConfig);
    } catch (error) {
      log("error", { event: "bridge_poll_failed", message: safeMessage(error) });
    } finally {
      draining = false;
    }
  };
  void drain();
  setInterval(() => void drain(), 150);
}

async function drainBridgeRoot(root: string, helperConfig: HelperConfig): Promise<void> {
  const requests = join(root, ".photogit", "bridge", "requests");
  const responses = join(root, ".photogit", "bridge", "responses");
  await Promise.all([mkdir(requests, { recursive: true, mode: 0o700 }), mkdir(responses, { recursive: true, mode: 0o700 })]);
  const entries = await readdir(requests);
  const readyNames = entries.filter((name) => /^[A-Za-z0-9_-]{8,100}\.ready$/.test(name)).sort();
  for (const readyName of readyNames) {
    const requestId = readyName.slice(0, -".ready".length);
    await processBridgeRequest(root, requestId, helperConfig);
  }
}

async function processBridgeRequest(root: string, requestId: string, helperConfig: HelperConfig): Promise<void> {
  const requests = join(root, ".photogit", "bridge", "requests");
  const responses = join(root, ".photogit", "bridge", "responses");
  const requestPath = join(requests, `${requestId}.json`);
  const readyPath = join(requests, `${requestId}.ready`);
  let response: HelperResponse;
  try {
    const envelope = parseBridgeEnvelope(JSON.parse(await readFile(requestPath, "utf8")));
    if (!tokensMatch(envelope.token, helperConfig.token)) throw coded("UNAUTHORIZED", "The helper token is missing or invalid.");
    if (envelope.request.requestId !== requestId) throw coded("REQUEST_ID_MISMATCH", "The bridge filename does not match the request ID.");
    if (resolve(envelope.request.projectRoot) !== resolve(root)) throw coded("ROOT_MISMATCH", "The bridge request does not match its project folder.");
    response = { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result: await executeRequest(envelope.request, helperConfig) };
  } catch (error) {
    const code = isCoded(error) ? error.code : error instanceof SyntaxError ? "INVALID_JSON" : "REQUEST_FAILED";
    response = { protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error: { code, message: safeMessage(error) } };
    log("error", { event: "bridge_request_failed", requestId, code, message: safeMessage(error) });
  }
  const tempPath = join(responses, `${requestId}.json.tmp`);
  const responsePath = join(responses, `${requestId}.json`);
  await writeFile(tempPath, canonicalJson(response), { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, responsePath);
  await writeFile(join(responses, `${requestId}.ready`), "ready\n", { encoding: "utf8", mode: 0o600 });
  await Promise.all([unlink(requestPath).catch(() => undefined), unlink(readyPath).catch(() => undefined)]);
}

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, "127.0.0.1", () => {
  log("info", { event: "helper_started", host: "127.0.0.1", port, approvedRootCount: config.approvedRoots.length, configPath });
  process.stdout.write(`PhotoGit helper is listening at http://127.0.0.1:${port}\nConfiguration: ${configPath}\nApproved project roots: ${config.approvedRoots.length}\n`);
});

async function loadOrCreateConfig(path: string, approvedRoots: string[]): Promise<HelperConfig> {
  try {
    const existing = JSON.parse(await readFile(path, "utf8")) as HelperConfig;
    if (existing.protocolVersion !== PROTOCOL_VERSION || typeof existing.token !== "string" || !Array.isArray(existing.approvedRoots)) throw new Error("Invalid helper configuration.");
    const additions = approvedRoots.filter((root) => !existing.approvedRoots.includes(root));
    if (additions.length) {
      existing.approvedRoots.push(...additions);
      existing.approvedRoots.sort();
      await secureWrite(path, canonicalJson(existing));
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const created: HelperConfig = { protocolVersion: PROTOCOL_VERSION, token: randomBytes(32).toString("base64url"), approvedRoots: [...new Set(approvedRoots)].sort() };
    await secureWrite(path, canonicalJson(created));
    return created;
  }
}

async function writePairingFiles(helperConfig: HelperConfig): Promise<void> {
  for (const root of helperConfig.approvedRoots) {
    const directory = join(root, ".photogit");
    try {
      await mkdir(directory, { recursive: true });
      await secureWrite(join(directory, "helper.json"), canonicalJson({ protocolVersion: PROTOCOL_VERSION, token: helperConfig.token }));
    } catch (error) {
      log("error", { event: "pairing_file_failed", root, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function secureWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > MAX_REQUEST_BYTES) throw coded("REQUEST_TOO_LARGE", "Helper request exceeds the 5 MB limit.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw coded("REQUEST_TOO_LARGE", "Helper request exceeds the 5 MB limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  return tokensMatch(supplied, token);
}

function tokensMatch(supplied: string, expected: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function setCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendOk(response: ServerResponse, requestId: string, result: unknown): void {
  const body: HelperResponse = { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result };
  send(response, 200, body);
}

function sendError(response: ServerResponse, status: number, code: string, message: string, requestId: string): void {
  const body: HelperResponse = { protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error: { code, message } };
  send(response, status, body);
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  if (value === undefined) return void response.end();
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function repeatedOption(name: string): string[] {
  return args.flatMap((arg, index) => arg === name && args[index + 1] ? [args[index + 1] as string] : []);
}

function numericOption(name: string, fallback: number): number {
  const value = repeatedOption(name)[0];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error(`${name} must be a port from 1024 to 65535.`);
  return parsed;
}

type CodedError = Error & { code: string };
function coded(code: string, message: string): CodedError { return Object.assign(new Error(message), { code }); }
function isCoded(value: unknown): value is CodedError { return value instanceof Error && "code" in value && typeof (value as CodedError).code === "string"; }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message.replaceAll(config.token, "[redacted]") : "Unexpected helper error."; }
function log(level: "info" | "error", fields: Record<string, unknown>): void { process.stderr.write(`${canonicalJson({ level, time: new Date().toISOString(), ...fields })}`); }
