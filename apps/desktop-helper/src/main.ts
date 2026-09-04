#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { GitRepository, isWithinRealRoot } from "@photogit/git-engine";
import { readProjectState } from "@photogit/git-engine";
import { DEFAULT_HELPER_PORT, MAX_REQUEST_BYTES, parseBridgeEnvelope, parseHelperRequest, PROTOCOL_VERSION, type HelperRequest, type HelperResponse } from "@photogit/protocol";
import { validateProjectMetadata, type ProjectMetadata, type ProjectState } from "@photogit/schema";
import { canonicalJson, stateFromCapture } from "@photogit/serializer";
import { diffStates } from "@photogit/differ";
import { assertHelperArguments, isLoopbackHost, parseHelperConfig, publicRepositoryInfo, safeErrorText, secureWrite, type HelperConfig } from "./security.js";

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
assertHelperArguments(args);
const configPath = resolve(process.env.PHOTOGIT_HELPER_CONFIG ?? join(homedir(), ".photogit", "helper.json"));
const port = numericOption("--port", DEFAULT_HELPER_PORT);
const approvedFromArgs = repeatedOption("--approve-root").map((path) => resolve(path));
const config = await loadOrCreateConfig(configPath, approvedFromArgs);
await writePairingFiles(config);
const limiter = new SlidingWindowLimiter(60, 60_000);
startFileBridge(config);

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  if (!isLoopbackHost(request.headers.host, port)) return sendError(response, 403, "INVALID_HOST", "The helper only accepts loopback requests.", "unknown");
  if (request.method === "OPTIONS") return send(response, 204, undefined);
  if (request.method === "GET" && request.url === "/v1/health") {
    return send(response, 200, { protocolVersion: PROTOCOL_VERSION, ok: true, service: "photogit-helper" });
  }
  if (request.method !== "POST" || request.url !== "/v1/request") return sendError(response, 404, "NOT_FOUND", "Unknown helper endpoint.", "unknown");
  if (request.headers.origin) return sendError(response, 403, "BROWSER_ORIGIN_REJECTED", "Browser-origin helper requests are not allowed.", "unknown");
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
  const approved = await Promise.all(helperConfig.approvedRoots.map((root) => isWithinRealRoot(root, projectRoot)));
  if (!approved.some(Boolean)) throw coded("ROOT_NOT_APPROVED", "This project folder has not been approved in the PhotoGit helper.");
  const repository = new GitRepository(projectRoot);
  if (payload.operation === "status") {
    const [branch, changes] = await Promise.all([repository.currentBranch(), repository.status()]);
    return { branch, changeCount: changes.length };
  }
  if (payload.operation === "history") return { versions: await repository.history(40) };
  if (payload.operation === "branches") return { branches: await repository.branches(), current: await repository.currentBranch() };
  if (payload.operation === "refresh") {
    const base = await readProjectState(projectRoot);
    const current = stateFromCapture(payload.capture!, base.project, randomUUID, base.identities.records);
    const changes = diffStates(base, current);
    log("info", { event: "refresh_complete", requestId: payload.requestId, capturedLayerCount: payload.capture!.layers.length, changeCount: changes.length });
    return { changes };
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
  if (payload.operation === "reviews") {
    const [reviews, conflicts, repositoryInfo, tags] = await Promise.all([
      repository.reviews(),
      repository.conflicts(),
      repository.repositoryInfo(),
      repository.tags()
    ]);
    return { reviews, conflicts, repository: publicRepositoryInfo(repositoryInfo), tags };
  }
  if (payload.operation === "mergeBranch") {
    await repository.mergeBranch(payload.branch!);
    return { branch: await repository.currentBranch(), snapshotPath: join(projectRoot, "snapshot", "document.psd") };
  }
  if (payload.operation === "createTag") {
    await repository.createTag(payload.tag!);
    return { tag: payload.tag };
  }
  if (payload.operation === "pullRequestLink") return { url: await repository.pullRequestUrl(payload.base) };
  if (payload.operation !== "capture") throw coded("UNKNOWN_OPERATION", "Unknown helper operation.");

  for (const path of [payload.snapshotPath, payload.previewPath]) {
    if (path && !await isWithinRealRoot(projectRoot, path)) throw coded("UNSAFE_ARTIFACT_PATH", "Snapshot and preview files must be inside the approved project folder.");
  }
  const project = JSON.parse(await readBoundedText(join(projectRoot, ".photogit", "project.json"))) as ProjectMetadata;
  validateProjectMetadata(project);
  const identities = await readBoundedText(join(projectRoot, ".photogit", "identities.json"))
    .then((text) => (JSON.parse(text) as ProjectState["identities"]).records)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
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
  const rootStat = await stat(root).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!rootStat) return;
  if (!rootStat.isDirectory()) throw coded("INVALID_APPROVED_ROOT", "An approved PhotoGit root is no longer a folder.");
  const requests = join(root, ".photogit", "bridge", "requests");
  const responses = join(root, ".photogit", "bridge", "responses");
  await Promise.all([mkdir(requests, { recursive: true, mode: 0o700 }), mkdir(responses, { recursive: true, mode: 0o700 })]);
  if (!await isWithinRealRoot(root, requests) || !await isWithinRealRoot(root, responses)) throw coded("UNSAFE_BRIDGE_PATH", "The PhotoGit bridge folders must stay inside the approved project.");
  await Promise.all([chmod(requests, 0o700), chmod(responses, 0o700)]);
  const entries = await readdir(requests);
  const readyNames = entries.filter((name) => /^[A-Za-z0-9_-]{8,100}\.ready$/.test(name)).sort().slice(0, 100);
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
    const requestStat = await lstat(requestPath);
    const readyStat = await lstat(readyPath);
    if (!requestStat.isFile() || requestStat.isSymbolicLink() || !readyStat.isFile() || readyStat.isSymbolicLink()) throw coded("UNSAFE_BRIDGE_ENTRY", "Bridge requests must be regular files.");
    const envelope = parseBridgeEnvelope(JSON.parse(await readBoundedText(requestPath)));
    if (!tokensMatch(envelope.token, helperConfig.token)) throw coded("UNAUTHORIZED", "The helper token is missing or invalid.");
    if (envelope.request.requestId !== requestId) throw coded("REQUEST_ID_MISMATCH", "The bridge filename does not match the request ID.");
    if (resolve(envelope.request.projectRoot) !== resolve(root)) throw coded("ROOT_MISMATCH", "The bridge request does not match its project folder.");
    response = { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result: await executeRequest(envelope.request, helperConfig) };
  } catch (error) {
    const code = isCoded(error) ? error.code : error instanceof SyntaxError ? "INVALID_JSON" : "REQUEST_FAILED";
    response = { protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error: { code, message: safeMessage(error) } };
    log("error", { event: "bridge_request_failed", requestId, code, message: safeMessage(error) });
  }
  const waitingStat = await lstat(readyPath).catch(() => null);
  if (!waitingStat?.isFile() || waitingStat.isSymbolicLink()) {
    await Promise.all([unlink(requestPath).catch(() => undefined), unlink(readyPath).catch(() => undefined)]);
    return;
  }
  const tempPath = join(responses, `${requestId}.json.tmp`);
  const responsePath = join(responses, `${requestId}.json`);
  await unlink(tempPath).catch(() => undefined);
  await writeFile(tempPath, boundedResponseJson(response), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(tempPath, responsePath);
  const responseReadyPath = join(responses, `${requestId}.ready`);
  await unlink(responseReadyPath).catch(() => undefined);
  await writeFile(responseReadyPath, "ready\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  await Promise.all([unlink(requestPath).catch(() => undefined), unlink(readyPath).catch(() => undefined)]);
}

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(port, "127.0.0.1", () => {
  log("info", { event: "helper_started", host: "127.0.0.1", port, approvedRootCount: config.approvedRoots.length, configPath });
  process.stdout.write(`PhotoGit helper is listening at http://127.0.0.1:${port}\nConfiguration: ${configPath}\nApproved project roots: ${config.approvedRoots.length}\n`);
});

async function loadOrCreateConfig(path: string, approvedRoots: string[]): Promise<HelperConfig> {
  for (const root of approvedRoots) await assertApprovableRoot(root);
  try {
    const existing = parseHelperConfig(JSON.parse(await readBoundedText(path, 1024 * 1024)));
    const updated = parseHelperConfig({ ...existing, approvedRoots: [...new Set([...existing.approvedRoots, ...approvedRoots])] });
    await secureWrite(path, canonicalJson(updated));
    return updated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const created = parseHelperConfig({ protocolVersion: PROTOCOL_VERSION, token: randomBytes(32).toString("base64url"), approvedRoots });
    await secureWrite(path, canonicalJson(created));
    return created;
  }
}

async function writePairingFiles(helperConfig: HelperConfig): Promise<void> {
  for (const root of helperConfig.approvedRoots) {
    const directory = join(root, ".photogit");
    try {
      const rootStat = await stat(root).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (!rootStat) {
        log("error", { event: "pairing_root_missing", root });
        continue;
      }
      if (!rootStat.isDirectory()) throw coded("INVALID_APPROVED_ROOT", "An approved PhotoGit root is no longer a folder.");
      await assertApprovableRoot(root);
      const repository = new GitRepository(root);
      const trackedPairing = await repository.run(["ls-files", "--error-unmatch", "--", ".photogit/helper.json"], { allowFailure: true });
      if (trackedPairing) throw coded("PAIRING_FILE_TRACKED", "Refusing to replace .photogit/helper.json because Git already tracks it. Remove it from the Git index before starting the helper.");
      await mkdir(directory, { recursive: true });
      if (!await isWithinRealRoot(root, directory)) throw coded("UNSAFE_PAIRING_PATH", "The PhotoGit metadata folder must stay inside its approved project.");
      const requests = join(directory, "bridge", "requests");
      const responses = join(directory, "bridge", "responses");
      await Promise.all([mkdir(requests, { recursive: true, mode: 0o700 }), mkdir(responses, { recursive: true, mode: 0o700 })]);
      if (!await isWithinRealRoot(root, requests) || !await isWithinRealRoot(root, responses)) throw coded("UNSAFE_BRIDGE_PATH", "The PhotoGit bridge folders must stay inside the approved project.");
      await Promise.all([chmod(requests, 0o700), chmod(responses, 0o700)]);
      await secureWrite(join(directory, "helper.json"), canonicalJson({ protocolVersion: PROTOCOL_VERSION, token: helperConfig.token }));
    } catch (error) {
      log("error", { event: "pairing_file_failed", root, message: safeMessage(error) });
    }
  }
}

async function assertApprovableRoot(root: string): Promise<void> {
  const metadata = await stat(root).catch(() => null);
  if (!metadata?.isDirectory()) throw new Error(`Approved PhotoGit roots must be existing folders: ${root}`);
  const repository = new GitRepository(root);
  await repository.assertRepository();
  const project = JSON.parse(await readBoundedText(join(root, ".photogit", "project.json")));
  validateProjectMetadata(project);
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

async function readBoundedText(path: string, maximum = MAX_REQUEST_BYTES): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > maximum) throw coded("REQUEST_TOO_LARGE", "Helper file exceeds the safe size limit.");
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
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

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
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
  let body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    response.statusCode = 500;
    body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId: "unknown", ok: false, error: { code: "RESPONSE_TOO_LARGE", message: "The helper response exceeded the safe size limit." } } satisfies HelperResponse);
  }
  response.end(body);
}

function boundedResponseJson(response: HelperResponse): string {
  const body = canonicalJson(response);
  if (Buffer.byteLength(body, "utf8") <= MAX_REQUEST_BYTES) return body;
  return canonicalJson({
    protocolVersion: PROTOCOL_VERSION,
    requestId: response.requestId,
    ok: false,
    error: { code: "RESPONSE_TOO_LARGE", message: "The helper response exceeded the safe size limit." }
  } satisfies HelperResponse);
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
function safeMessage(error: unknown): string {
  return safeErrorText(error, [config.token]);
}
function log(level: "info" | "error", fields: Record<string, unknown>): void { process.stderr.write(`${canonicalJson({ level, time: new Date().toISOString(), ...fields })}`); }
