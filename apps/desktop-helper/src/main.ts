#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { GitRepository, isWithinRealRoot } from "@photogit/git-engine";
import { DEFAULT_HELPER_PORT, MAX_REQUEST_BYTES, parseHelperRequest, PROTOCOL_VERSION, validateDocumentIdentity, type BranchOperationResult, type SaveVersionResult, type DocumentIdentity, type HelperRequest, type HelperResponse } from "@photogit/protocol";
import { validateProjectMetadata, type DocumentCapture, type ProjectMetadata, type ProjectState } from "@photogit/schema";
import { canonicalJson, stateFromCapture } from "@photogit/serializer";
import { diffStates, type SemanticChange } from "@photogit/differ";
import { assertHelperArguments, isLoopbackHost, parseHelperConfig, publicRepositoryInfo, safeErrorText, secureWrite, type HelperConfig } from "./security.js";
import { acquireConfigLock } from "./config-lock.js";
import { drainBridgeRoot, ensureBridgeFolders, readBoundedText, tokensMatch } from "./bridge.js";

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
const releaseLock = await acquireConfigLock(configPath);
let exiting = false;
async function shutdown(code: number): Promise<void> {
  if (exiting) return;
  exiting = true;
  await releaseLock();
  process.exit(code);
}
process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));
const config = await loadOrCreateConfig(configPath, approvedFromArgs).catch(async (error) => { await releaseLock(); throw error; });
const limiter = new SlidingWindowLimiter(60, 60_000);
const projectQueues = new Map<string, Promise<unknown>>();

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
    return sendOk(response, requestId, await queueRequest(payload, config));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 422;
    const code = isCoded(error) ? error.code : error instanceof SyntaxError ? "INVALID_JSON" : "REQUEST_FAILED";
    log("error", { requestId, code, message: safeMessage(error) });
    return sendError(response, status, code, safeMessage(error), requestId, error);
  }
});

function queueRequest(payload: HelperRequest, helperConfig: HelperConfig, stillWaiting?: () => Promise<boolean>): Promise<unknown> {
  const root = resolve(payload.projectRoot);
  const previous = projectQueues.get(root) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    if (stillWaiting && !await stillWaiting()) throw coded("REQUEST_EXPIRED", "The panel stopped waiting before this operation started. Refresh the project before retrying.");
    return executeRequest(payload, helperConfig);
  });
  projectQueues.set(root, pending);
  void pending.finally(() => { if (projectQueues.get(root) === pending) projectQueues.delete(root); }).catch(() => undefined);
  return pending;
}

async function executeRequest(payload: HelperRequest, helperConfig: HelperConfig): Promise<unknown> {
  const projectRoot = resolve(payload.projectRoot);
  const approved = await Promise.all(helperConfig.approvedRoots.map((root) => isWithinRealRoot(root, projectRoot)));
  if (!approved.some(Boolean)) throw coded("ROOT_NOT_APPROVED", "This project folder has not been approved in the PhotoGit helper.");
  const repository = new GitRepository(projectRoot);
  if (payload.operation === "status") {
    const [branch, changes] = await Promise.all([repository.currentBranch(), repository.status()]);
    return { branch, changeCount: changes.length, documentBinding: await readDocumentBinding(projectRoot), baselineMissing: await repository.readStateAt() === null };
  }
  if (payload.operation === "history") return { versions: await repository.history(40) };
  if (payload.operation === "versionDetails") return boundedComparison(await repository.versionDetails(payload.version!));
  if (payload.operation === "openVersion") return { outcome: "success", snapshotPath: relative(projectRoot, await repository.exportVersionSnapshot(payload.version!)), version: payload.version };
  if (payload.operation === "compareBranches") return boundedComparison(await repository.compareBranches(payload.branch!, payload.base));
  if (payload.operation === "branches") return { branches: await repository.branches(), current: await repository.currentBranch() };
  if (payload.operation === "connectDocument") {
    const identity = payload.documentIdentity!;
    const binding = await readDocumentBinding(projectRoot);
    const baseline = await repository.readStateAt();
    if (!payload.adopt && binding && !sameDocument(binding, identity)) throw coded("DOCUMENT_MISMATCH", `This project is connected to ${binding.name}. Open that document or explicitly adopt this document.`);
    if (!payload.adopt && !binding && baseline && baseline.document.name !== identity.name && resolve(identity.sourcePath ?? "") !== join(projectRoot, "snapshot", "document.psd")) throw coded("DOCUMENT_MISMATCH", `This project contains ${baseline.document.name}. Explicitly adopt this document to change its connection.`);
    await saveDocumentBinding(projectRoot, identity);
    return { outcome: "success", documentBinding: identity, binding: identity };
  }
  if (payload.operation === "refresh") {
    const base = await repository.readStateAt();
    await assertDocumentConnection(projectRoot, payload.documentIdentity, payload.capture!.document, base, false);
    const project = base?.project ?? JSON.parse(await readBoundedText(join(projectRoot, ".photogit", "project.json"))) as ProjectMetadata;
    validateProjectMetadata(project);
    const current = stateFromCapture(projectCapture(payload.capture!, payload.documentIdentity, base, projectRoot), project, randomUUID, base?.identities.records ?? []);
    const changes = base ? diffStates(base, current) : firstCheckpointChanges(current);
    const comparisonWarnings: string[] = [];
    if (base && !current.document.renderedFingerprint) comparisonWarnings.push("This scan did not include document-wide rendered comparison. Update or reload the PhotoGit panel, then scan again to compare group effects and masks.");
    else if (base && !base.document.renderedFingerprint) comparisonWarnings.push("This version predates document-wide rendered comparison. Save a version to enable group effects and mask comparison.");
    log("info", { event: "refresh_complete", requestId: payload.requestId, capturedLayerCount: payload.capture!.layers.length, changeCount: changes.length });
    return { ...boundedChanges(changes), baselineMissing: base === null, baseline: "HEAD", comparisonWarnings };
  }
  if (payload.operation === "createBranch" || payload.operation === "switchBranch" || payload.operation === "pull" || payload.operation === "mergeBranch") return changeBranchOperation(repository, payload);
  if (payload.operation === "push") {
    await repository.push();
    return { outcome: "success", branch: await repository.currentBranch() };
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
  if (payload.operation === "createTag") {
    await repository.createTag(payload.tag!);
    return { tag: payload.tag };
  }
  if (payload.operation === "pullRequestLink") return { url: await repository.pullRequestUrl(payload.base) };
  if (payload.operation !== "capture") throw coded("UNKNOWN_OPERATION", "Unknown helper operation.");

  for (const path of [payload.snapshotPath, payload.previewPath]) {
    if (path && !await isWithinRealRoot(projectRoot, path)) throw coded("UNSAFE_ARTIFACT_PATH", "Snapshot and preview files must be inside the approved project folder.");
  }
  const base = await repository.readStateAt();
  const project = base?.project ?? JSON.parse(await readBoundedText(join(projectRoot, ".photogit", "project.json"))) as ProjectMetadata;
  validateProjectMetadata(project);
  await assertDocumentConnection(projectRoot, payload.documentIdentity, payload.capture.document, base, true);
  const identities = base?.identities.records ?? [];
  const state = stateFromCapture(projectCapture(payload.capture, payload.documentIdentity, base, projectRoot), project, randomUUID, identities);
  const previousBranch = await repository.currentBranch();
  const previousHead = await readRepositoryHead(repository);
  let versionId: string;
  try {
    versionId = await repository.saveVersion(state, payload.message, {
      ...(payload.snapshotPath ? { snapshotPath: payload.snapshotPath } : {}),
      ...(payload.previewPath ? { previewPath: payload.previewPath } : {})
    });
  } catch (error) {
    let headKnown = true;
    const head = await readRepositoryHead(repository).catch(() => { headKnown = false; return null; });
    const branch = await repository.currentBranch().catch(() => previousBranch);
    const gitChanged = branch !== previousBranch || (headKnown && head !== previousHead);
    const recoveryRequired = gitChanged || !headKnown;
    const recoveryMessage = gitChanged
      ? "Git history changed before the save finished reporting its result. Refresh history before trying Save version again."
      : "PhotoGit could not verify whether Git history changed. Refresh history before trying Save version again.";
    throw Object.assign(coded(recoveryRequired ? "RECOVERY_REQUIRED" : "OPERATION_FAILED", `${safeMessage(error)}${recoveryRequired ? ` ${recoveryMessage}` : ""}`), {
      outcome: recoveryRequired ? "recovery_required" : "failure", branch, previousBranch,
      // An unreadable HEAD is unknown, never proof that no version was saved.
      ...(headKnown || gitChanged ? { gitChanged } : {}), ...(!headKnown ? { outcomeUnknown: true } : {})
    });
  }
  return { outcome: "success", versionId, shortId: versionId.slice(0, 8), warningCount: state.document.warnings.length } satisfies SaveVersionResult;
}

async function readRepositoryHead(repository: GitRepository): Promise<string | null> {
  try {
    const head = await repository.run(["rev-parse", "--verify", "HEAD"]);
    if (!/^[a-f0-9]{40,64}$/i.test(head)) throw coded("INVALID_HEAD", "Git returned an invalid current version ID.");
    return head;
  } catch (error) {
    // A new/orphan branch may legitimately have no version. Confirm that its
    // symbolic reference is absent instead of treating every Git error as unborn.
    const reference = await repository.run(["symbolic-ref", "--quiet", "HEAD"]);
    const references = await repository.run(["for-each-ref", "--format=%(refname)", "--", reference]);
    if (!references.split("\n").includes(reference)) return null;
    throw error;
  }
}

function firstCheckpointChanges(state: ProjectState): SemanticChange[] {
  return state.structure.layers.map((layer) => {
    const layerName = inlineText(layer.name, 1_024) || "Unnamed layer";
    return {
      domain: "structure",
      category: "added",
      layerUuid: layer.uuid,
      photoshopId: layer.photoshopId,
      layerName,
      propertyPath: "layer",
      baseValue: null,
      currentValue: { name: layerName, kind: layer.kind },
      summary: inlineText(`Ready to track ${JSON.stringify(layerName)}`, 1_000),
      mergeability: "automatic",
      confidence: 1,
      warnings: []
    };
  });
}

function boundedChanges(changes: SemanticChange[]): { changes: SemanticChange[]; changeCount: number; truncated: boolean } {
  const result: SemanticChange[] = [];
  let bytes = 0;
  for (const change of changes.slice(0, 1_500)) {
    const compact = { ...change, layerName: change.layerName ? inlineText(change.layerName, 1_024) : change.layerName, summary: inlineText(change.summary, 1_000), baseValue: boundedValue(change.baseValue), currentValue: boundedValue(change.currentValue) };
    const size = Buffer.byteLength(JSON.stringify(compact), "utf8");
    if (bytes + size > 2 * 1024 * 1024) break;
    result.push(compact);
    bytes += size;
  }
  return { changes: result, changeCount: changes.length, truncated: result.length < changes.length };
}

function boundedValue(value: unknown): unknown {
  if (typeof value === "string") return inlineText(value, 1_024);
  const json = JSON.stringify(value);
  return json && json.length > 4_096 ? { summary: "Large value omitted from the panel response", bytes: Buffer.byteLength(json, "utf8") } : value;
}

function boundedComparison<T extends { changes: SemanticChange[] }>(comparison: T): T & { changeCount: number; truncated: boolean } {
  return { ...comparison, ...boundedChanges(comparison.changes) };
}

async function readDocumentBinding(root: string): Promise<DocumentIdentity | null> {
  const path = join(root, ".photogit", "bridge", "document-binding.json");
  if (!await isWithinRealRoot(root, dirname(path))) throw coded("UNSAFE_BINDING_PATH", "The document connection must stay inside the project.");
  const text = await readBoundedText(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return null;
  const binding: unknown = JSON.parse(text);
  validateDocumentIdentity(binding);
  return binding;
}

async function saveDocumentBinding(root: string, identity: DocumentIdentity): Promise<void> {
  const path = join(root, ".photogit", "bridge", "document-binding.json");
  if (!await isWithinRealRoot(root, dirname(path))) throw coded("UNSAFE_BINDING_PATH", "The document connection must stay inside the project.");
  await secureWrite(path, canonicalJson(identity));
}

function sameDocument(a: DocumentIdentity, b: DocumentIdentity): boolean {
  if (a.sourcePath && b.sourcePath) return resolve(a.sourcePath) === resolve(b.sourcePath);
  return a.sourcePath === b.sourcePath && a.documentId === b.documentId;
}

function projectCapture(capture: DocumentCapture, identity: DocumentIdentity | undefined, baseline: ProjectState | null, root: string): DocumentCapture {
  // Photoshop renames a reopened managed snapshot to document.psd. That is a
  // storage filename, not a user edit to the project's document name.
  const source = identity?.sourcePath ? relative(root, resolve(identity.sourcePath)).replaceAll("\\", "/") : "";
  if (baseline && (source === "snapshot/document.psd" || /^\.photogit\/recovered\/version-[A-Za-z0-9-]+\.psd$/.test(source))) return { ...capture, document: { ...capture.document, name: baseline.document.name } };
  return capture;
}

async function assertDocumentConnection(root: string, supplied: DocumentIdentity | undefined, document: { documentId: string; name: string }, baseline: ProjectState | null, saving: boolean): Promise<void> {
  if (supplied && supplied.documentId !== document.documentId) throw coded("DOCUMENT_MISMATCH", "The captured Photoshop document does not match the connected document identity. Scan the active document again.");
  const binding = await readDocumentBinding(root);
  if (binding && (!supplied || !sameDocument(binding, supplied))) throw coded("DOCUMENT_MISMATCH", `This project is connected to ${binding.name}. Open that document, reconnect it, or explicitly adopt this document.`);
  if (!binding && baseline) throw coded("DOCUMENT_CONNECTION_REQUIRED", `Connect this project to its Photoshop document (${baseline.document.name}) before scanning or saving.`);
  if (!binding && saving) {
    if (!supplied) throw coded("DOCUMENT_CONNECTION_REQUIRED", "Connect the active Photoshop document before saving its first version.");
    await saveDocumentBinding(root, supplied);
  }
}

async function changeBranchOperation(repository: GitRepository, payload: Exclude<HelperRequest, { operation: "capture" }>): Promise<BranchOperationResult> {
  const previousBranch = await repository.currentBranch();
  const previousHead = await repository.run(["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  try {
    await repository.validateSnapshotAt(payload.operation === "switchBranch" ? payload.branch! : "HEAD");
    if (payload.operation === "mergeBranch") await repository.validateSnapshotAt(payload.branch!);
    if (payload.operation === "createBranch") await repository.createBranch(payload.branch!);
    else if (payload.operation === "switchBranch") await repository.switchBranch(payload.branch!);
    else if (payload.operation === "pull") await repository.pull();
    else if (payload.operation === "mergeBranch") await repository.mergeBranch(payload.branch!);
    await repository.validateSnapshotAt("HEAD");
    const branch = await repository.currentBranch();
    const head = await repository.run(["rev-parse", "--verify", "HEAD"]);
    return { outcome: "success", branch, previousBranch, snapshotPath: "snapshot/document.psd", gitChanged: branch !== previousBranch || head !== previousHead };
  } catch (error) {
    const branch = await repository.currentBranch().catch(() => previousBranch);
    const head = await repository.run(["rev-parse", "--verify", "HEAD"], { allowFailure: true }).catch(() => previousHead);
    const conflicts = await repository.conflicts().catch(() => []);
    const gitChanged = branch !== previousBranch || head !== previousHead || conflicts.length > 0;
    const message = gitChanged ? `${safeMessage(error)} Git state changed. Refresh the project and review its branch and conflicts before continuing. Your Photoshop document may still show the earlier version.` : safeMessage(error);
    throw Object.assign(coded(gitChanged ? "RECOVERY_REQUIRED" : "OPERATION_FAILED", message), { outcome: gitChanged ? "recovery_required" : "failure", branch, previousBranch, gitChanged });
  }
}

function inlineText(value: string, maximum: number): string {
  const safe = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return safe.length <= maximum ? safe : `${safe.slice(0, maximum - 1)}…`;
}

function startFileBridge(helperConfig: HelperConfig): void {
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      for (const root of helperConfig.approvedRoots) {
        try { await drainBridgeRoot(root, helperConfig, { execute: (request, stillWaiting) => queueRequest(request, helperConfig, stillWaiting), onError: (error) => log("error", { event: "bridge_request_failed", message: safeMessage(error) }) }); }
        catch (error) { log("error", { event: "bridge_root_failed", message: safeMessage(error) }); }
      }
    } catch (error) {
      log("error", { event: "bridge_poll_failed", message: safeMessage(error) });
    } finally {
      draining = false;
    }
  };
  void drain();
  setInterval(() => void drain(), 150);
}


server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.on("error", (error: NodeJS.ErrnoException) => {
  const message = error.code === "EADDRINUSE"
    ? `PhotoGit could not start: port ${port} is already in use. Stop the existing helper, choose --port <unused-port>, or use --bridge-only for the Photoshop filesystem bridge.`
    : `PhotoGit helper could not start: ${safeMessage(error)}`;
  process.stderr.write(`${message}\n`);
  void shutdown(1);
});
if (args.includes("--bridge-only")) {
  await writePairingFiles(config);
  startFileBridge(config);
  process.stdout.write(`PhotoGit helper filesystem bridge is running\nConfiguration: ${configPath}\nApproved project roots: ${config.approvedRoots.length}\n`);
} else {
  server.listen(port, "127.0.0.1", async () => {
    await writePairingFiles(config);
    startFileBridge(config);
    log("info", { event: "helper_started", host: "127.0.0.1", port, approvedRootCount: config.approvedRoots.length, configPath });
    process.stdout.write(`PhotoGit helper is listening at http://127.0.0.1:${port}\nConfiguration: ${configPath}\nApproved project roots: ${config.approvedRoots.length}\n`);
  });
}

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
      await ensureBridgeFolders(root);
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


function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  return tokensMatch(supplied, token);
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

function sendError(response: ServerResponse, status: number, code: string, message: string, requestId: string, error?: unknown): void {
  const context = error as Partial<{ outcome: "recovery_required"; branch: string; previousBranch: string; gitChanged: boolean; outcomeUnknown: boolean }> | undefined;
  const body: HelperResponse = { protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error: { code, message, outcome: context?.outcome ?? "failure", ...(context?.branch ? { branch: context.branch } : {}), ...(context?.previousBranch ? { previousBranch: context.previousBranch } : {}), ...(context?.gitChanged !== undefined ? { gitChanged: context.gitChanged } : {}), ...(context?.outcomeUnknown ? { outcomeUnknown: true } : {}) } };
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


function repeatedOption(name: string): string[] {
  return args.flatMap((arg, index) => arg === name && args[index + 1] ? [args[index + 1] as string] : []);
}

function numericOption(name: string, fallback: number): number {
  const value = repeatedOption(name)[0];
  if (!value) return fallback;
  const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
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
