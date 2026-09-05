import { mkdtemp, mkdir, readFile, readdir, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { BRIDGE_FILE_RETENTION_MS, MAX_REQUEST_BYTES, type HelperResponse } from "@photogit/protocol";
import { cleanupBridge, ensureBridgeFolders, processBridgeRequest } from "./bridge.js";
import { acquireConfigLock } from "./config-lock.js";

async function fixture(requestId = "request-fixture") {
  const root = await mkdtemp(join(tmpdir(), "photogit-bridge-"));
  const folders = await ensureBridgeFolders(root);
  const config = { protocolVersion: 1 as const, token: "a".repeat(43), approvedRoots: [root] };
  const envelope = { token: config.token, expiresAt: Date.now() + 120_000, request: { protocolVersion: 1, requestId, projectRoot: root, operation: "status" } };
  const requestPath = join(folders.requests, `${requestId}.json`), readyPath = join(folders.requests, `${requestId}.ready`);
  const publish = async (data: unknown = envelope) => { await writeFile(requestPath, JSON.stringify(data)); await writeFile(readyPath, "ready\n"); };
  const reply = async () => JSON.parse(await readFile(join(folders.responses, `${requestId}.json`), "utf8")) as HelperResponse;
  return { root, ...folders, config, envelope, requestId, requestPath, readyPath, publish, reply };
}

describe("authenticated filesystem bridge", () => {
  it("does not execute a request until the panel publishes its ready marker", async () => {
    const f = await fixture();
    await writeFile(f.requestPath, JSON.stringify(f.envelope));
    let executed = 0;
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => ++executed });
    expect(executed).toBe(0);
    expect(await readdir(f.responses)).toEqual([]);
  });

  it("claims a ready request atomically across concurrent consumers, publishes mode-0600 response, and cleans inputs", async () => {
    const f = await fixture(); await f.publish();
    let executed = 0;
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const first = processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => { executed++; await blocked; return { branch: "main" }; } });
    await eventually(async () => expect(await readdir(f.requests)).toContain(`${f.requestId}.claim`));
    expect(await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => ++executed })).toBe(false);
    unblock(); await first;
    expect(executed).toBe(1);
    expect(await f.reply()).toMatchObject({ ok: true, requestId: f.requestId, result: { branch: "main" } });
    expect(await readdir(f.requests)).toEqual([]);
    expect(await readFile(join(f.responses, `${f.requestId}.ready`), "utf8")).toBe("ready\n");
    expect((await stat(join(f.responses, `${f.requestId}.json`))).mode & 0o777).toBe(0o600);
  });

  it.each(["before", "after"])("cleans a panel timeout racing %s response publication", async (when) => {
    const f = await fixture(); await f.publish();
    const timeout = async () => { await unlink(f.readyPath); await unlink(f.requestPath); };
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => ({ done: true }), ...(when === "before" ? { beforePublish: timeout } : { afterPublish: timeout }) });
    expect(await readdir(f.requests)).toEqual([]);
    expect(await readdir(f.responses)).toEqual([]);
  });

  it("does not run expired requests and suppresses late replies after a panel cancellation", async () => {
    const f = await fixture(); await f.publish({ ...f.envelope, expiresAt: Date.now() - 1 });
    let executed = 0;
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => ++executed });
    expect(executed).toBe(0);
    expect(await readdir(f.responses)).toEqual([]);
    await f.publish();
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => { await unlink(f.readyPath); return ++executed; } });
    expect(executed).toBe(1);
    expect(await readdir(f.responses)).toEqual([]);
  });

  it.each([
    ["wrong token", (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.envelope, token: "b".repeat(43) }), "UNAUTHORIZED"],
    ["filename mismatch", (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.envelope, request: { ...f.envelope.request, requestId: "another-request" } }), "REQUEST_ID_MISMATCH"],
    ["root mismatch", (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.envelope, request: { ...f.envelope.request, projectRoot: "/tmp/another-project" } }), "ROOT_MISMATCH"],
    ["unknown fields", (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.envelope, command: "arbitrary" }), "REQUEST_FAILED"]
  ] as const)("rejects %s without executing work", async (_name, payload, code) => {
    const f = await fixture(); await f.publish(payload(f)); let called = false;
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => { called = true; } });
    expect(called).toBe(false); expect(await f.reply()).toMatchObject({ ok: false, error: { code } });
  });

  it("rejects malformed, oversize and symlink request files", async () => {
    const f = await fixture();
    for (const contents of ["{", "x".repeat(MAX_REQUEST_BYTES + 1)]) {
      await writeFile(f.requestPath, contents); await writeFile(f.readyPath, "ready");
      await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => { throw new Error("must not run"); } });
      expect(await f.reply()).toMatchObject({ ok: false });
      await Promise.all((await readdir(f.responses)).map((name) => unlink(join(f.responses, name))));
    }
    const target = join(f.root, "secret.txt"); await writeFile(target, "untouched");
    await symlink(target, f.requestPath); await writeFile(f.readyPath, "ready");
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => { throw new Error("must not run"); } });
    expect(await f.reply()).toMatchObject({ ok: false }); expect(await readFile(target, "utf8")).toBe("untouched");
  });

  it("bounds response bytes and redacts token-bearing failures", async () => {
    const f = await fixture(); await f.publish();
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => "x".repeat(MAX_REQUEST_BYTES + 1) });
    expect(await f.reply()).toMatchObject({ ok: false, error: { code: "RESPONSE_TOO_LARGE" } });
    await Promise.all((await readdir(f.responses)).map((name) => unlink(join(f.responses, name))));
    await f.publish();
    await processBridgeRequest(f.root, f.requestId, f.config, { execute: async () => { throw new Error(`failure ${f.config.token} https://user:secret@example.com/repo`); } });
    const reply = JSON.stringify(await f.reply()); expect(reply).not.toContain(f.config.token); expect(reply).not.toContain("user:secret");
  });

  it("cleans only expired bridge files and leaves unrelated files and symlink targets untouched", async () => {
    const f = await fixture();
    const old = new Date(Date.now() - BRIDGE_FILE_RETENTION_MS - 1_000);
    for (const directory of [f.requests, f.responses]) for (const name of ["stale-123.json", "stale-123.ready", "stale-123.claim", "stale-123.json.tmp", "unrelated.txt", "recent-123.json"]) {
      const path = join(directory, name); await writeFile(path, "data"); if (!name.startsWith("recent")) await utimes(path, old, old);
    }
    const target = join(f.root, "target"); await writeFile(target, "safe"); await symlink(target, join(f.responses, "symlink-123.json"));
    await cleanupBridge(f.root);
    expect(await readdir(f.requests)).toEqual(["recent-123.json", "unrelated.txt"]);
    expect(await readdir(f.responses)).toEqual(["recent-123.json", "symlink-123.json", "unrelated.txt"]);
    expect(await readFile(target, "utf8")).toBe("safe");
  });

  it("rejects a bridge-directory symlink before creating folders outside the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-bridge-containment-"));
    const outside = await mkdtemp(join(tmpdir(), "photogit-outside-"));
    await symlink(outside, join(root, ".photogit"));
    await expect(ensureBridgeFolders(root)).rejects.toThrow(/inside the approved project/);
    expect(await readdir(outside)).toEqual([]);
  });
});

describe("helper configuration lock", () => {
  it("rejects a concurrent helper, releases on shutdown and recovers a dead owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-config-lock-")); const config = join(root, "helper.json");
    const release = await acquireConfigLock(config);
    await expect(acquireConfigLock(config)).rejects.toThrow(/already running/);
    await release();
    const second = await acquireConfigLock(config); await second();
    await mkdir(`${config}.lock`); await writeFile(join(`${config}.lock`, "owner.json"), JSON.stringify({ pid: 2147483647, nonce: "dead-owner" }));
    const recovered = await acquireConfigLock(config); await recovered();
    expect(await readdir(root)).toEqual([]);
  });
});

async function eventually(check: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) { try { await check(); return; } catch (error) { if (attempt === 99) throw error; await new Promise((resolve) => setTimeout(resolve, 5)); } }
}
