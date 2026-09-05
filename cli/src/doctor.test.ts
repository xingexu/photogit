import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { inspectProject } from "./doctor.js";

const execute = promisify(execFile);
const entry = resolve("cli/dist/main.js");
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "photogit-doctor-"));
  await execute(process.execPath, [entry, "init", root]);
  return root;
}

describe("doctor project validation", () => {
  it("rejects an ordinary Git repository with nonzero CLI exit and never labels it a valid project", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-ordinary-"));
    await execute("git", ["init", root]);
    expect(await inspectProject(root)).toMatchObject([{ name: "Project", status: "fail" }]);
    const failed = await execute(process.execPath, [entry, "doctor", root]).catch((error) => error);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain("! Project:");
    expect(failed.stdout).not.toContain("✓ Project:");
  });

  it("accepts a fresh valid project and clearly distinguishes pending pairing from corruption", async () => {
    const root = await fixture();
    const checks = await inspectProject(root);
    expect(checks.filter(({ status }) => status === "fail")).toEqual([]);
    expect(checks).toContainEqual(expect.objectContaining({ name: "Pairing", status: "notice" }));
    expect(checks).toContainEqual(expect.objectContaining({ name: "Writable access", status: "pass" }));
    expect(checks).toContainEqual(expect.objectContaining({ name: "Disk space", status: "pass" }));
    expect((await readdir(root)).filter((name) => name.startsWith(".photogit-doctor-"))).toEqual([]);
    expect((await readdir(join(root, ".photogit"))).filter((name) => name.startsWith(".photogit-doctor-"))).toEqual([]);
    const lfsInstalled = await execute("git", ["lfs", "version"]).then(() => true).catch(() => false);
    if (lfsInstalled) {
      const { stdout } = await execute(process.execPath, [entry, "doctor", root]);
      expect(stdout).toContain("✓ Project:");
      expect(stdout).toContain("i Pairing:");
    }
  });

  it("rejects malformed project metadata and partial saved state", async () => {
    const root = await fixture();
    const projectPath = join(root, ".photogit/project.json");
    const metadata = await readFile(projectPath, "utf8");
    await writeFile(projectPath, "{}");
    expect(await inspectProject(root)).toMatchObject([{ name: "Project", status: "fail" }]);
    await writeFile(projectPath, metadata);
    await writeFile(join(root, ".photogit/document.json"), "{}");
    expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Project schemas", status: "fail" }));
  });

  it("checks pairing shape, private permissions and bridge availability without printing the token", async () => {
    const root = await fixture();
    const token = randomBytes(32).toString("base64url");
    expect(token).toHaveLength(43);
    const pairing = join(root, ".photogit/helper.json");
    await writeFile(pairing, JSON.stringify({ token, protocolVersion: 1 }), { mode: 0o600 });
    await mkdir(join(root, ".photogit/bridge"));
    expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Pairing", status: "pass" }));
    await chmod(pairing, 0o644);
    expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Pairing", status: "fail" }));
    await chmod(pairing, 0o600);
    await writeFile(pairing, JSON.stringify({ token, protocolVersion: 999 }));
    const checks = await inspectProject(root);
    expect(checks).toContainEqual(expect.objectContaining({ name: "Pairing", status: "fail" }));
    expect(JSON.stringify(checks)).not.toContain(token);
  });

  it("accepts base64url punctuation and rejects malformed token shapes without echoing credentials", async () => {
    const root = await fixture();
    const pairing = join(root, ".photogit/helper.json");
    await mkdir(join(root, ".photogit/bridge"));
    const token = Buffer.alloc(32, 251).toString("base64url");
    expect(token).toMatch(/[-_]/);
    await writeFile(pairing, JSON.stringify({ token, protocolVersion: 1 }), { mode: 0o600 });
    expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Pairing", status: "pass" }));
    for (const invalid of ["x".repeat(31), "x".repeat(201), `${token}=`, `${token}/`, `${token}\n`]) {
      await writeFile(pairing, JSON.stringify({ token: invalid, protocolVersion: 1 }));
      const checks = await inspectProject(root);
      expect(checks).toContainEqual(expect.objectContaining({ name: "Pairing", status: "fail" }));
      expect(JSON.stringify(checks)).not.toContain(token);
    }
    await writeFile(pairing, `${token} invalid JSON`);
    const checks = await inspectProject(root);
    expect(checks).toContainEqual(expect.objectContaining({ name: "Pairing", status: "fail" }));
    expect(JSON.stringify(checks)).not.toContain(token);
  });

  it("detects negated ignore rules, tracked credentials, and missing effective LFS rules", async () => {
    const root = await fixture();
    const ignorePath = join(root, ".gitignore");
    const original = await readFile(ignorePath, "utf8");
    await writeFile(ignorePath, original + "\n!.photogit/helper.json\n");
    expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Ignore rules", status: "fail" }));
    await writeFile(ignorePath, original);
    await writeFile(join(root, ".photogit/helper.json"), "{}");
    await execute("git", ["add", "-f", ".photogit/helper.json"], { cwd: root });
    expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Ignore rules", status: "fail", detail: expect.stringContaining("tracked by Git") }));
    await writeFile(join(root, ".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text\n");
    expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Git LFS rules", status: "fail" }));
  });

  it("rejects symlinked project metadata and a nested directory mistaken for the project root", async () => {
    const root = await fixture();
    const nested = join(root, "nested"); await mkdir(nested);
    expect(await inspectProject(nested)).toMatchObject([{ name: "Project", status: "fail", detail: expect.stringContaining("project root") }]);
    const outside = await mkdtemp(join(tmpdir(), "photogit-doctor-outside-"));
    const other = await mkdtemp(join(tmpdir(), "photogit-doctor-linked-"));
    await execute("git", ["init", other]);
    await symlink(outside, join(other, ".photogit"));
    expect(await inspectProject(other)).toMatchObject([{ name: "Project", status: "fail" }]);
  });

  it.skipIf(process.getuid?.() === 0)("checks effective writable access rather than trusting owner mode bits", async () => {
    const root = await fixture();
    const metadata = join(root, ".photogit");
    await chmod(metadata, 0o500);
    try { expect(await inspectProject(root)).toContainEqual(expect.objectContaining({ name: "Writable access", status: "fail" })); }
    finally { await chmod(metadata, 0o700); }
  });
});
