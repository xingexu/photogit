import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentCapture } from "@photogit/schema";

const execute = promisify(execFile);
const cliEntry = resolve(process.cwd(), "cli/dist/main.js");
const helperEntry = resolve(process.cwd(), "apps/desktop-helper/dist/main.js");
const fixturePath = resolve(process.cwd(), "packages/test-fixtures/captures/basic-document.json");
const children: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 1_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }));
});

describe("desktop helper Photoshop refresh flow", () => {
  it("reports an occupied port without starting a second bridge or changing project pairing", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-helper-port-"));
    const projectRoot = join(parent, "project"), helperConfig = join(parent, "helper.json");
    await execute(process.execPath, [cliEntry, "init", projectRoot]);
    const occupied = createServer(); occupied.listen(0, "127.0.0.1"); await once(occupied, "listening");
    const address = occupied.address(); if (!address || typeof address === "string") throw new Error("Expected a local port.");
    const helper = spawn(process.execPath, [helperEntry, "--port", String(address.port), "--approve-root", projectRoot], { env: { ...process.env, PHOTOGIT_HELPER_CONFIG: helperConfig }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(helper);
    try {
      await expect(waitForOutput(helper, "PhotoGit helper is listening")).rejects.toThrow(/port .*already in use.*--bridge-only/);
      await expect(readFile(join(projectRoot, ".photogit", "helper.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally { occupied.close(); await once(occupied, "close"); }
  }, 15_000);

  it("shows a first checkpoint and then returns real edits against the saved baseline", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-helper-flow-"));
    const projectRoot = join(parent, "project");
    const helperConfig = join(parent, "helper.json");
    await execute(process.execPath, [cliEntry, "init", projectRoot]);
    await execute("git", ["config", "user.name", "PhotoGit Test"], { cwd: projectRoot });
    await execute("git", ["config", "user.email", "test@photogit.invalid"], { cwd: projectRoot });

    const port = await freePort();
    const helper = spawn(process.execPath, [helperEntry, "--port", String(port), "--approve-root", projectRoot], {
      env: { ...process.env, PHOTOGIT_HELPER_CONFIG: helperConfig },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(helper);
    await waitForOutput(helper, "PhotoGit helper is listening");
    const token = (JSON.parse(await readFile(helperConfig, "utf8")) as { token: string }).token;
    const capture = JSON.parse(await readFile(fixturePath, "utf8")) as DocumentCapture;
    expect(await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json()).toMatchObject({ ok: true, service: "photogit-helper" });
    const unauthenticated = await fetch(`http://127.0.0.1:${port}/v1/request`, { method: "POST", body: "{}" });
    expect(unauthenticated.status).toBe(401);
    const originRequest = await fetch(`http://127.0.0.1:${port}/v1/request`, { method: "POST", headers: { authorization: `Bearer ${token}`, origin: "https://untrusted.example" }, body: "{}" });
    expect(originRequest.status).toBe(403);

    const first = await request(port, token, projectRoot, "refresh", { capture });
    expect(first).toMatchObject({ ok: true, result: { baselineMissing: true } });
    expect(first.result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "added", layerName: "Hero" })
    ]));

    const capturePath = join(projectRoot, ".photogit", "capture.json");
    await writeFile(capturePath, JSON.stringify(capture));
    await execute(process.execPath, [cliEntry, "save", "--capture", capturePath, "-m", "Baseline"], { cwd: projectRoot });
    const documentIdentity = { documentId: capture.document.documentId, name: capture.document.name, sourcePath: null };
    await request(port, token, projectRoot, "connectDocument", { documentIdentity });

    const edited = structuredClone(capture);
    const hero = edited.layers.find((layer) => layer.name === "Launch day");
    expect(hero).toBeDefined();
    hero!.name = "Hero revised";
    hero!.appearance.opacity = 72;
    if (hero!.text) hero!.text.contents = "A clearer headline";
    hero!.content.fingerprint = "pixels-v1:64x64x4:feedbabe";

    const refreshed = await request(port, token, projectRoot, "refresh", { capture: edited, documentIdentity });
    expect(refreshed).toMatchObject({ ok: true, result: { baselineMissing: false } });
    expect(refreshed.result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "structure", layerName: "Hero revised", propertyPath: "name" }),
      expect.objectContaining({ domain: "appearance", layerName: "Hero revised", propertyPath: "opacity", currentValue: 72 }),
      expect.objectContaining({ domain: "text", layerName: "Hero revised", propertyPath: "contents", currentValue: "A clearer headline" }),
      expect.objectContaining({ domain: "content", layerName: "Hero revised", propertyPath: "fingerprint" })
    ]));
  }, 15_000);
});

async function request(port: number, token: string, projectRoot: string, operation: string, fields: Record<string, unknown>) {
  const requestId = `test-${Date.now().toString(36)}`;
  const response = await fetch(`http://127.0.0.1:${port}/v1/request`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, requestId, operation, projectRoot, ...fields })
  });
  const body = await response.json() as { ok: boolean; result: { baselineMissing: boolean; changes: Array<Record<string, unknown>> }; error?: { message?: string } };
  expect(response.status, body.error?.message ?? JSON.stringify(body)).toBe(200);
  return body;
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a helper test port.");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

function waitForOutput(child: ChildProcess, text: string): Promise<void> {
  return new Promise((resolveReady, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for helper startup. Output: ${output}`)), 5_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (!output.includes(text)) return;
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      resolveReady();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Helper exited before startup with code ${String(code)}. Output: ${output}`));
    });
  });
}
