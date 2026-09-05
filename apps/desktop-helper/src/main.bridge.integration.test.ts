import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentCapture } from "@photogit/schema";
import type { HelperResponse } from "@photogit/protocol";

const execute = promisify(execFile);
const cliEntry = resolve("cli/dist/main.js"), helperEntry = resolve("apps/desktop-helper/dist/main.js");
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((done) => setTimeout(done, 1_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

async function fixture(injectGitVerificationFailure = false) {
  const directory = await mkdtemp(join(tmpdir(), "photogit-helper-bridge-flow-"));
  const root = join(directory, "project"), config = join(directory, "helper.json");
  await execute(process.execPath, [cliEntry, "init", root]);
  await execute("git", ["config", "user.name", "Bridge Test"], { cwd: root });
  await execute("git", ["config", "user.email", "bridge@photogit.invalid"], { cwd: root });
  const helperEnvironment: NodeJS.ProcessEnv = { ...process.env, PHOTOGIT_HELPER_CONFIG: config };
  if (injectGitVerificationFailure) {
    const bin = join(directory, "test-bin"); await mkdir(bin);
    const realGit = (await execute("which", ["git"])).stdout.trim();
    // Delegate all Git work to the real binary and fail only the verification
    // command after a real save has committed. No production failure switch.
    await writeFile(join(bin, "git"), `#!/bin/sh\nif [ "$1" = "cat-file" ] && [ "$2" = "-e" ] && [ -f .photogit/bridge/fail-verification ]; then\n  touch .photogit/bridge/verification-failed\n  echo "Injected post-save verification failure" >&2\n  exit 1\nfi\nif [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ] && [ -f .photogit/bridge/unknown-head ] && [ -f .photogit/bridge/verification-failed ]; then\n  echo "Injected HEAD read failure" >&2\n  exit 1\nfi\nexec '${realGit.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 });
    helperEnvironment.PATH = `${bin}:${process.env.PATH ?? ""}`;
  }
  const start = () => {
    const child = spawn(process.execPath, [helperEntry, "--bridge-only", "--approve-root", root], { env: helperEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child); return child;
  };
  const child = start(); await waitForOutput(child, "filesystem bridge is running");
  const token = JSON.parse(await readFile(config, "utf8")).token as string;
  const capture = JSON.parse(await readFile(resolve("packages/test-fixtures/captures/basic-document.json"), "utf8")) as DocumentCapture;
  const identity = { documentId: capture.document.documentId, name: capture.document.name, sourcePath: join(root, "source.psd") };
  const requests = join(root, ".photogit", "bridge", "requests"), responses = join(root, ".photogit", "bridge", "responses");
  const request = async (operation: string, fields: Record<string, unknown> = {}) => {
    const requestId = randomUUID();
    await writeFile(join(requests, `${requestId}.json`), JSON.stringify({ token, expiresAt: Date.now() + 10_000, request: { protocolVersion: 1, requestId, projectRoot: root, operation, ...fields } }));
    await writeFile(join(requests, `${requestId}.ready`), "ready\n");
    // Exactly the panel's handshake: observe response ready, then read body.
    for (let attempt = 0; attempt < 500; attempt++) {
      if ((await readdir(responses)).includes(`${requestId}.ready`)) {
        const response = JSON.parse(await readFile(join(responses, `${requestId}.json`), "utf8")) as HelperResponse<any>;
        expect(response.requestId).toBe(requestId);
        await Promise.all([join(responses, `${requestId}.ready`), join(responses, `${requestId}.json`)].map((path) => unlink(path)));
        return response;
      }
      await new Promise((done) => setTimeout(done, 10));
    }
    await Promise.all([join(requests, `${requestId}.ready`), join(requests, `${requestId}.json`)].map((path) => unlink(path).catch(() => undefined)));
    throw new Error(`Bridge response timed out: ${operation}`);
  };
  return { root, config, child, start, capture, identity, request, requests, responses };
}

describe("real helper process filesystem bridge", () => {
  it("reports an ordinary save failure without mutation and preserves unrelated staged work", async () => {
    const f = await fixture();
    expect(await f.request("capture", { capture: f.capture, documentIdentity: f.identity, message: "Before staged work" })).toMatchObject({ ok: true });
    const before = (await execute("git", ["rev-parse", "HEAD"], { cwd: f.root })).stdout.trim();
    await writeFile(join(f.root, "unrelated.txt"), "user staged work");
    await execute("git", ["add", "--", "unrelated.txt"], { cwd: f.root });
    const edited = structuredClone(f.capture); edited.layers[0]!.name = "Unsaved edit";
    const result = await f.request("capture", { capture: edited, documentIdentity: f.identity, message: "Must not replace staged work" });
    expect(result).toMatchObject({ ok: false, error: { outcome: "failure", gitChanged: false } });
    expect((await execute("git", ["rev-parse", "HEAD"], { cwd: f.root })).stdout.trim()).toBe(before);
    expect((await execute("git", ["diff", "--cached", "--name-only"], { cwd: f.root })).stdout.trim()).toBe("unrelated.txt");
  }, 15_000);

  it.each(["changed", "unknown"] as const)("reports save recovery when post-save verification fails and HEAD is %s", async (headState) => {
    const f = await fixture(true);
    expect(await f.request("capture", { capture: f.capture, documentIdentity: f.identity, message: "Before verification failure" })).toMatchObject({ ok: true });
    const before = (await execute("git", ["rev-parse", "HEAD"], { cwd: f.root })).stdout.trim();
    await writeFile(join(f.root, ".photogit", "bridge", "fail-verification"), "enabled");
    if (headState === "unknown") await writeFile(join(f.root, ".photogit", "bridge", "unknown-head"), "enabled");
    const edited = structuredClone(f.capture); edited.layers[0]!.name = "Saved despite verification failure";
    const result = await f.request("capture", { capture: edited, documentIdentity: f.identity, message: "Saved before verification failed" });
    expect(result).toMatchObject({ ok: false, error: { code: "RECOVERY_REQUIRED", outcome: "recovery_required" } });
    if (headState === "changed") expect(result.error).toMatchObject({ gitChanged: true });
    else { expect(result.error).not.toHaveProperty("gitChanged"); expect(result.error).toMatchObject({ outcomeUnknown: true }); }
    const after = (await execute("git", ["rev-parse", "HEAD"], { cwd: f.root })).stdout.trim();
    expect(after).not.toBe(before);
    expect((await execute("git", ["log", "-1", "--format=%s"], { cwd: f.root })).stdout.trim()).toBe("Saved before verification failed");
  }, 15_000);

  it.each(["omitted", "null"] as const)("warns when the current scan has a missing (%s) document rendering fingerprint", async (missing) => {
    const f = await fixture();
    f.capture.document.renderedFingerprint = "pixels-v1:64x64x4:aaaaaaaa";
    expect(await f.request("capture", { capture: f.capture, documentIdentity: f.identity, message: "Rendered baseline" })).toMatchObject({ ok: true });
    const current = structuredClone(f.capture);
    if (missing === "omitted") delete current.document.renderedFingerprint;
    else current.document.renderedFingerprint = null;
    const comparison = await f.request("refresh", { capture: current, documentIdentity: f.identity });
    expect(comparison).toMatchObject({ ok: true, result: { changeCount: 0, changes: [], comparisonWarnings: ["This scan did not include document-wide rendered comparison. Update or reload the PhotoGit panel, then scan again to compare group effects and masks."] } });
    expect(await f.request("refresh", { capture: f.capture, documentIdentity: f.identity })).toMatchObject({ ok: true, result: { changeCount: 0, comparisonWarnings: [] } });
  }, 15_000);

  it("warns when a legacy version lacks a document-wide rendering baseline without inventing an edit", async () => {
    const f = await fixture();
    expect(await f.request("capture", { capture: f.capture, documentIdentity: f.identity, message: "Legacy rendering baseline" })).toMatchObject({ ok: true });
    const upgraded = structuredClone(f.capture);
    upgraded.document.renderedFingerprint = "pixels-v1:64x64x4:aaaaaaaa";
    const comparison = await f.request("refresh", { capture: upgraded, documentIdentity: f.identity });
    expect(comparison).toMatchObject({ ok: true, result: { changeCount: 0, comparisonWarnings: ["This version predates document-wide rendered comparison. Save a version to enable group effects and mask comparison."] } });
    expect(await f.request("capture", { capture: upgraded, documentIdentity: f.identity, message: "Enable document-wide comparison" })).toMatchObject({ ok: true });
    expect(await f.request("refresh", { capture: upgraded, documentIdentity: f.identity })).toMatchObject({ ok: true, result: { changeCount: 0, comparisonWarnings: [] } });
    upgraded.document.renderedFingerprint = "pixels-v1:64x64x4:bbbbbbbb";
    const edited = await f.request("refresh", { capture: upgraded, documentIdentity: f.identity });
    expect(edited).toMatchObject({ ok: true, result: { changeCount: 1, comparisonWarnings: [] } });
    expect(edited.result.changes).toEqual([expect.objectContaining({ domain: "document", propertyPath: "renderedFingerprint", summary: "Document rendered appearance changed" })]);
  }, 15_000);

  it("tracks first version, layer edits, saved baseline reset, immutable HEAD, and project-document identity", async () => {
    const f = await fixture();
    const first = await f.request("refresh", { capture: f.capture, documentIdentity: f.identity });
    expect(first).toMatchObject({ ok: true, result: { baselineMissing: true, baseline: "HEAD" } });
    expect(first.result.changeCount).toBe(f.capture.layers.length);
    expect(await f.request("capture", { capture: f.capture, documentIdentity: f.identity, message: "First version" })).toMatchObject({ ok: true, result: { outcome: "success" } });
    expect(await f.request("refresh", { capture: f.capture, documentIdentity: f.identity })).toMatchObject({ ok: true, result: { changeCount: 0, baselineMissing: false } });
    const edited = structuredClone(f.capture); edited.layers[0]!.name = "Edited layer"; edited.layers[0]!.appearance.opacity = 45;
    const changes = await f.request("refresh", { capture: edited, documentIdentity: f.identity });
    expect(changes.result.changes).toEqual(expect.arrayContaining([expect.objectContaining({ propertyPath: "name" }), expect.objectContaining({ propertyPath: "opacity" })]));
    expect(await f.request("capture", { capture: edited, documentIdentity: f.identity, message: "Second version" })).toMatchObject({ ok: true });
    expect(await f.request("refresh", { capture: edited, documentIdentity: f.identity })).toMatchObject({ ok: true, result: { changeCount: 0 } });
    // External edits of the metadata must never redefine the comparison baseline.
    await writeFile(join(f.root, ".photogit", "structure", "layers.json"), "corrupt external edit");
    const unchanged = await f.request("refresh", { capture: edited, documentIdentity: f.identity });
    expect(unchanged).toMatchObject({ ok: true, result: { changeCount: 0, baseline: "HEAD" } });
    const otherIdentity = { ...f.identity, documentId: "other-document", sourcePath: join(f.root, "other.psd") };
    const otherCapture = structuredClone(f.capture); otherCapture.document.documentId = "other-document";
    expect(await f.request("refresh", { capture: otherCapture, documentIdentity: otherIdentity })).toMatchObject({ ok: false, error: { code: "DOCUMENT_MISMATCH" } });
    expect(await f.request("capture", { capture: otherCapture, documentIdentity: otherIdentity, message: "Must reject" })).toMatchObject({ ok: false, error: { code: "DOCUMENT_MISMATCH" } });
    expect(await f.request("connectDocument", { documentIdentity: otherIdentity })).toMatchObject({ ok: false, error: { code: "DOCUMENT_MISMATCH" } });
    expect(await f.request("connectDocument", { documentIdentity: otherIdentity, adopt: true })).toMatchObject({ ok: true });
    expect(await f.request("status")).toMatchObject({ ok: true, result: { documentBinding: otherIdentity } });
    expect(await f.request("refresh", { capture: otherCapture })).toMatchObject({ ok: false, error: { code: "DOCUMENT_MISMATCH" } });
    await unlink(join(f.root, ".photogit", "bridge", "document-binding.json"));
    expect(await f.request("refresh", { capture: edited, documentIdentity: f.identity })).toMatchObject({ ok: false, error: { code: "DOCUMENT_CONNECTION_REQUIRED" } });
    expect(await f.request("connectDocument", { documentIdentity: f.identity })).toMatchObject({ ok: true });
    expect(await readdir(f.requests)).toEqual([]); expect(await readdir(f.responses)).toEqual([]);
  }, 15_000);

  it("bounds a first-version response for a large layer list and reports its full count", async () => {
    const f = await fixture();
    const original = { ...f.capture.layers[0]!, kind: "pixel", text: null };
    f.capture.layers = Array.from({ length: 2_000 }, (_, index) => ({ ...structuredClone(original), photoshopId: index + 100, parentPhotoshopId: null, childrenPhotoshopIds: [], name: `Layer ${index} ${"name".repeat(50)}`, order: index }));
    const response = await f.request("refresh", { capture: f.capture, documentIdentity: f.identity });
    expect(response, JSON.stringify(response.error)).toMatchObject({ ok: true, result: { changeCount: 2_000, truncated: true, baselineMissing: true } });
    expect(response.result.changes.length).toBeLessThan(2_000);
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(5 * 1024 * 1024);
  }, 15_000);

  it("rejects duplicate helper startup and reconnects after a clean restart", async () => {
    const f = await fixture();
    const duplicate = f.start();
    await expect(waitForOutput(duplicate, "filesystem bridge is running")).rejects.toThrow(/already running/);
    expect(await f.request("status")).toMatchObject({ ok: true });
    f.child.kill("SIGTERM"); await once(f.child, "exit");
    const restarted = f.start(); await waitForOutput(restarted, "filesystem bridge is running");
    expect(await f.request("status")).toMatchObject({ ok: true });
  }, 15_000);

  it("reports a missing snapshot as failure before switching Git", async () => {
    const f = await fixture();
    await f.request("capture", { capture: f.capture, documentIdentity: f.identity, message: "Metadata version" });
    const before = (await f.request("status")).result.branch;
    const result = await f.request("createBranch", { branch: "must-not-switch" });
    expect(result).toMatchObject({ ok: false, error: { outcome: "failure", gitChanged: false, previousBranch: before } });
    expect((await f.request("status")).result.branch).toBe(before);
  }, 15_000);

  it("reports recovery required when Git changes branch before a checkout hook fails", async () => {
    const f = await fixture();
    const snapshotPath = join(f.root, ".photogit", "bridge", "fixture.psd");
    await writeFile(snapshotPath, psdHeaderFixture());
    expect(await f.request("capture", { capture: f.capture, documentIdentity: f.identity, snapshotPath, message: "Snapshot version" })).toMatchObject({ ok: true });
    const previousBranch = (await f.request("status")).result.branch;
    await execute("git", ["branch", "alternate"], { cwd: f.root });
    await writeFile(join(f.root, ".git", "hooks", "post-checkout"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    const result = await f.request("switchBranch", { branch: "alternate" });
    expect(result).toMatchObject({ ok: false, error: { code: "RECOVERY_REQUIRED", outcome: "recovery_required", previousBranch, branch: "alternate", gitChanged: true } });
    expect((await f.request("status")).result.branch).toBe("alternate");
  }, 15_000);

  it("exposes saved version details, unique recovery copies, comparisons, and a successful branch switch", async () => {
    const f = await fixture();
    const snapshotPath = join(f.root, ".photogit", "bridge", "fixture.psd");
    const bytes = psdHeaderFixture(); await writeFile(snapshotPath, bytes);
    const saved = await f.request("capture", { capture: f.capture, documentIdentity: f.identity, snapshotPath, message: "Inspectable version" });
    expect(saved).toMatchObject({ ok: true });
    const version = saved.result.versionId;
    const details = await f.request("versionDetails", { version });
    expect(details).toMatchObject({ ok: true, result: { version: { id: version }, snapshotAvailable: true } });
    const recovered = await f.request("openVersion", { version });
    expect(recovered).toMatchObject({ ok: true, result: { outcome: "success" } });
    expect(recovered.result.snapshotPath).toMatch(/^\.photogit\/recovered\/version-/);
    expect(await readFile(join(f.root, recovered.result.snapshotPath))).toEqual(bytes);
    const second = await f.request("openVersion", { version: "HEAD" });
    expect(second.result.snapshotPath).not.toBe(recovered.result.snapshotPath);
    expect(await f.request("createBranch", { branch: "design-option" })).toMatchObject({ ok: true, result: { outcome: "success", branch: "design-option", snapshotPath: "snapshot/document.psd" } });
    const reopened = structuredClone(f.capture); reopened.document.name = "document.psd"; reopened.document.documentId = "new-photoshop-session";
    const reopenedIdentity = { documentId: reopened.document.documentId, name: reopened.document.name, sourcePath: join(f.root, "snapshot", "document.psd") };
    expect(await f.request("connectDocument", { documentIdentity: reopenedIdentity, adopt: true })).toMatchObject({ ok: true });
    expect(await f.request("refresh", { capture: reopened, documentIdentity: reopenedIdentity })).toMatchObject({ ok: true, result: { changeCount: 0 } });
    const copyIdentity = { ...reopenedIdentity, name: second.result.snapshotPath.split("/").pop(), sourcePath: join(f.root, second.result.snapshotPath) };
    reopened.document.name = copyIdentity.name;
    expect(await f.request("connectDocument", { documentIdentity: copyIdentity, adopt: true })).toMatchObject({ ok: true });
    expect(await f.request("refresh", { capture: reopened, documentIdentity: copyIdentity })).toMatchObject({ ok: true, result: { changeCount: 0 } });
    expect(await f.request("compareBranches", { branch: "design-option" })).toMatchObject({ ok: true, result: { incomingBranch: "design-option", gitMergeable: true } });
  }, 15_000);

  it("suppresses a late response when the panel times out during an already-started Git operation", async () => {
    const f = await fixture();
    const snapshotPath = join(f.root, ".photogit", "bridge", "fixture.psd"); await writeFile(snapshotPath, psdHeaderFixture());
    expect(await f.request("capture", { capture: f.capture, documentIdentity: f.identity, snapshotPath, message: "Before timeout" })).toMatchObject({ ok: true });
    await execute("git", ["branch", "late-result"], { cwd: f.root });
    await writeFile(join(f.root, ".git", "hooks", "post-checkout"), "#!/bin/sh\ntouch .photogit/bridge/checkout-started\nsleep 0.3\n", { mode: 0o700 });
    const requestId = randomUUID();
    const token = JSON.parse(await readFile(f.config, "utf8")).token;
    const requestPath = join(f.requests, `${requestId}.json`), readyPath = join(f.requests, `${requestId}.ready`);
    await writeFile(requestPath, JSON.stringify({ token, expiresAt: Date.now() + 5_000, request: { protocolVersion: 1, requestId, projectRoot: f.root, operation: "switchBranch", branch: "late-result" } }));
    await writeFile(readyPath, "ready\n");
    let entered = false;
    for (let attempt = 0; attempt < 300; attempt++) {
      if ((await readdir(join(f.root, ".photogit", "bridge"))).includes("checkout-started")) { entered = true; break; }
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(entered).toBe(true);
    // This is exactly the panel's timeout cleanup while the helper is in Git.
    await Promise.all([unlink(readyPath), unlink(requestPath)]);
    expect(await f.request("status")).toMatchObject({ ok: true, result: { branch: "late-result" } });
    expect(await readdir(f.responses)).toEqual([]);
    expect(await readdir(f.requests)).toEqual([]);
  }, 15_000);
});

// Header-valid synthetic test data verifies storage/transport only, never a claim
// that Photoshop can open this fixture or that a live PSD round trip passed.
function psdHeaderFixture(): Buffer {
  const bytes = Buffer.alloc(40); bytes.write("8BPS"); bytes.writeUInt16BE(1, 4); bytes.writeUInt16BE(3, 12); bytes.writeUInt32BE(20, 14); bytes.writeUInt32BE(20, 18); bytes.writeUInt16BE(8, 22); bytes.writeUInt16BE(3, 24); return bytes;
}

function waitForOutput(child: ChildProcess, target: string): Promise<void> {
  return new Promise((ready, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Helper startup timed out: ${output}`)), 5_000);
    const onData = (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.includes(target)) { clearTimeout(timeout); ready(); } };
    child.stdout?.on("data", onData); child.stderr?.on("data", onData);
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Helper exited (${code}): ${output}`)); });
  });
}
