import { constants } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isWithinRealRoot } from "@photogit/git-engine";
import { BRIDGE_FILE_RETENTION_MS, BRIDGE_REQUEST_TIMEOUT_MS, MAX_REQUEST_BYTES, PROTOCOL_VERSION, parseBridgeEnvelope, type HelperRequest, type HelperResponse } from "@photogit/protocol";
import { safeErrorText, type HelperConfig } from "./security.js";

type BridgeOptions = {
  execute: (request: HelperRequest, stillWaiting: () => Promise<boolean>) => Promise<unknown>;
  onError?: (error: unknown) => void;
  // Test hooks run at the real publication boundaries, without replacing filesystem I/O.
  beforePublish?: () => Promise<void>;
  afterPublish?: () => Promise<void>;
};

export async function readBoundedText(path: string, maximum = MAX_REQUEST_BYTES): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximum) throw coded("REQUEST_TOO_LARGE", "Helper file exceeds the safe size limit.");
    const buffer = Buffer.alloc(Math.min(metadata.size + 1, maximum + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maximum || bytesRead > metadata.size) throw coded("REQUEST_TOO_LARGE", "Helper file changed while being read.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await handle.close(); }
}

export function boundedResponseJson(response: HelperResponse): string {
  const body = JSON.stringify(response);
  if (Buffer.byteLength(body, "utf8") <= MAX_REQUEST_BYTES) return body;
  return JSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId: response.requestId, ok: false, error: { code: "RESPONSE_TOO_LARGE", message: "The helper response exceeded the safe size limit." } } satisfies HelperResponse);
}

export function tokensMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function ensureBridgeFolders(root: string): Promise<{ requests: string; responses: string }> {
  const requests = join(root, ".photogit", "bridge", "requests");
  const responses = join(root, ".photogit", "bridge", "responses");
  // Check containment before mkdir as well as afterwards: a metadata symlink must
  // never cause us to create or chmod folders outside the approved project.
  for (const directory of [join(root, ".photogit"), join(root, ".photogit", "bridge"), requests, responses]) {
    const existing = await lstat(directory).catch((error) => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || !await isWithinRealRoot(root, directory))) throw coded("UNSAFE_BRIDGE_PATH", "The PhotoGit bridge folders must stay inside the approved project.");
    await mkdir(directory, { mode: 0o700 }).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
    if (!await isWithinRealRoot(root, directory)) throw coded("UNSAFE_BRIDGE_PATH", "The PhotoGit bridge folders must stay inside the approved project.");
    if (directory !== join(root, ".photogit")) await chmod(directory, 0o700);
  }
  return { requests, responses };
}

export async function cleanupBridge(root: string, now = Date.now()): Promise<void> {
  const folders = await ensureBridgeFolders(root);
  for (const directory of [folders.requests, folders.responses]) {
    for (const name of await readdir(directory)) {
      if (!/^[A-Za-z0-9_-]{8,100}\.(?:json(?:\.tmp)?|ready|claim)$/.test(name)) continue;
      const path = join(directory, name);
      const metadata = await lstat(path).catch(() => null);
      // Never follow links, remove directories, or clean arbitrary project files.
      if (!metadata?.isFile() || metadata.isSymbolicLink() || now - metadata.mtimeMs < BRIDGE_FILE_RETENTION_MS) continue;
      await unlink(path).catch(() => undefined);
    }
  }
}

export async function drainBridgeRoot(root: string, config: HelperConfig, options: BridgeOptions): Promise<void> {
  const metadata = await lstat(root).catch(() => null);
  if (!metadata) return;
  if (!metadata.isDirectory()) throw coded("INVALID_APPROVED_ROOT", "An approved PhotoGit root is no longer a folder.");
  const { requests } = await ensureBridgeFolders(root);
  await cleanupBridge(root);
  const readyNames = (await readdir(requests)).filter((name) => /^[A-Za-z0-9_-]{8,100}\.ready$/.test(name)).sort().slice(0, 100);
  for (const name of readyNames) await processBridgeRequest(root, name.slice(0, -6), config, options).catch((error) => options.onError?.(error));
}

export async function processBridgeRequest(root: string, requestId: string, config: HelperConfig, options: BridgeOptions): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new Error("Invalid bridge request ID.");
  const { requests, responses } = await ensureBridgeFolders(root);
  const requestPath = join(requests, `${requestId}.json`);
  const readyPath = join(requests, `${requestId}.ready`);
  const claimPath = join(requests, `${requestId}.claim`);
  const responsePath = join(responses, `${requestId}.json`);
  const responseReadyPath = join(responses, `${requestId}.ready`);
  const tempPath = join(responses, `${requestId}.json.tmp`);
  const initialReady = await lstat(readyPath).catch(() => null);
  if (!initialReady?.isFile() || initialReady.isSymbolicLink()) return false;
  // Exclusive creation is the cross-process claim. The ready marker stays in
  // place so panel timeout/cancellation can withdraw interest while Git runs.
  let claim;
  try { claim = await open(claimPath, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  await claim.close();
  let expiresAt = Date.now() + BRIDGE_REQUEST_TIMEOUT_MS;
  const waiting = async () => {
    const metadata = await lstat(readyPath).catch(() => null);
    return Boolean(metadata?.isFile() && !metadata.isSymbolicLink() && Date.now() < expiresAt);
  };
  const clearResponse = async () => { await Promise.all([tempPath, responsePath, responseReadyPath].map((path) => unlink(path).catch(() => undefined))); };
  try {
    if (!await waiting()) return false;
    let response: HelperResponse;
    try {
      const envelope = parseBridgeEnvelope(JSON.parse(await readBoundedText(requestPath)));
      if (!tokensMatch(envelope.token, config.token)) throw coded("UNAUTHORIZED", "The helper token is missing or invalid.");
      if (envelope.request.requestId !== requestId) throw coded("REQUEST_ID_MISMATCH", "The bridge filename does not match the request ID.");
      if (resolve(envelope.request.projectRoot) !== resolve(root)) throw coded("ROOT_MISMATCH", "The bridge request does not match its project folder.");
      const ready = await lstat(readyPath);
      expiresAt = Math.min(envelope.expiresAt ?? Infinity, ready.mtimeMs + BRIDGE_REQUEST_TIMEOUT_MS);
      if (!await waiting()) return false;
      response = { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result: await options.execute(envelope.request, waiting) };
    } catch (error) {
      const candidate = error as Error & { code?: string; outcome?: string; branch?: string; previousBranch?: string; gitChanged?: boolean; outcomeUnknown?: boolean };
      response = { protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error: { code: candidate.code ?? (error instanceof SyntaxError ? "INVALID_JSON" : "REQUEST_FAILED"), message: safeErrorText(error, [config.token]), outcome: candidate.outcome === "recovery_required" ? "recovery_required" : "failure", ...(candidate.branch ? { branch: candidate.branch } : {}), ...(candidate.previousBranch ? { previousBranch: candidate.previousBranch } : {}), ...(candidate.gitChanged !== undefined ? { gitChanged: candidate.gitChanged } : {}), ...(candidate.outcomeUnknown ? { outcomeUnknown: true } : {}) } };
      options.onError?.(error);
    }
    if (!await waiting()) return true;
    await options.beforePublish?.();
    if (!await waiting()) return true;
    await writeFile(tempPath, boundedResponseJson(response), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, responsePath);
    await writeFile(responseReadyPath, "ready\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await options.afterPublish?.();
    // Close the timeout race between checking the marker and publishing a reply.
    if (!await waiting()) await clearResponse();
    return true;
  } finally {
    await Promise.all([requestPath, readyPath, claimPath, tempPath].map((path) => unlink(path).catch(() => undefined)));
  }
}

function coded(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
