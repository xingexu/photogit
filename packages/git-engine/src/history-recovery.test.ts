import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ProjectState } from "@photogit/schema";
import { GitRepository } from "./index.js";

function state(): ProjectState {
  return {
    project: { schemaVersion: 1, projectId: "p", displayName: "Poster", createdWith: "test" },
    document: { schemaVersion: 1, documentId: "d", name: "poster.psd", width: 20, height: 20, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null, compatibility: "supported", warnings: [] },
    identities: { schemaVersion: 1, records: [] }, structure: { schemaVersion: 1, roots: [], layers: [] }, appearance: {}, text: {}, content: {}
  };
}

function psd(): Buffer {
  const bytes = Buffer.alloc(40);
  bytes.write("8BPS"); bytes.writeUInt16BE(1, 4); bytes.writeUInt16BE(3, 12);
  bytes.writeUInt32BE(20, 14); bytes.writeUInt32BE(20, 18); bytes.writeUInt16BE(8, 22); bytes.writeUInt16BE(3, 24);
  return bytes;
}

async function fixture(): Promise<GitRepository> {
  const root = await mkdtemp(join(tmpdir(), "photogit-history-recovery-"));
  const repository = new GitRepository(root);
  await repository.initialize();
  await mkdir(join(root, ".photogit"), { recursive: true });
  await writeFile(join(root, ".git/info/exclude"), ".photogit/capture.psd\n");
  await repository.run(["config", "user.name", "PhotoGit Test"]);
  await repository.run(["config", "user.email", "test@photogit.invalid"]);
  // Tests cover raw blobs and explicitly constructed LFS pointers independently of installed filters.
  await writeFile(join(root, ".gitattributes"), "*.psd -filter -diff -merge -text\n");
  return repository;
}

describe("immutable history, recovery, and Git comparison", () => {
  it("reads HEAD metadata in a bounded batch even when working metadata is externally corrupted", async () => {
    const repo = await fixture();
    expect(await repo.readStateAt()).toBeNull();
    await repo.saveVersion(state(), "Initial state");
    await writeFile(join(repo.root, ".photogit/document.json"), "invalid JSON");
    expect((await repo.readStateAt())?.document.width).toBe(20);
    await repo.run(["add", ".photogit/document.json"]);
    await repo.run(["commit", "-m", "Corrupted externally"]);
    await expect(repo.readStateAt()).rejects.toThrow();
    await expect(repo.readStateAt("missing-version")).rejects.toThrow(/does not exist/);
  });

  it("inspects version details and exports prior PSD bytes without changing HEAD or current files", async () => {
    const repo = await fixture();
    const source = join(repo.root, ".photogit/capture.psd");
    const first = psd();
    await writeFile(source, first);
    const id = await repo.saveVersion(state(), "First version", { snapshotPath: source });
    const changed = state(); changed.document.width = 40;
    const second = psd(); second.writeUInt32BE(40, 18);
    await writeFile(source, second);
    const currentId = await repo.saveVersion(changed, "Resize", { snapshotPath: source });
    const details = await repo.versionDetails(currentId);
    expect(details.version.message).toBe("Resize");
    expect(details.changes).toContainEqual(expect.objectContaining({ domain: "document", propertyPath: "width", baseValue: 20, currentValue: 40 }));
    expect(details.files).toContainEqual({ path: "snapshot/document.psd", status: "M" });
    expect(details.snapshotAvailable).toBe(true);
    const exported = await repo.exportVersionSnapshot(id);
    expect(exported).toContain(".photogit/recovered/version-");
    expect(await readFile(exported)).toEqual(first);
    expect(await readFile(join(repo.root, "snapshot/document.psd"))).toEqual(second);
    expect(await repo.run(["rev-parse", "HEAD"])).toBe(currentId);
    expect(await repo.run(["check-ignore", exported])).toBe(exported);
    expect(await repo.exportVersionSnapshot(id)).not.toBe(exported);
  });

  it("rejects missing snapshots, invalid headers, and unsafe recovery directories", async () => {
    const repo = await fixture();
    await repo.saveVersion(state(), "Without snapshot");
    await expect(repo.validateSnapshotAt("HEAD")).rejects.toThrow(/no regular PSD/);
    await mkdir(join(repo.root, "snapshot"));
    await writeFile(join(repo.root, "snapshot/document.psd"), Buffer.alloc(40));
    await repo.run(["add", "snapshot/document.psd"]); await repo.run(["commit", "-m", "Invalid snapshot"]);
    const previous = await repo.run(["rev-parse", "HEAD"]);
    await expect(repo.exportVersionSnapshot("HEAD")).rejects.toThrow(/valid Photoshop/);
    expect(await repo.run(["rev-parse", "HEAD"])).toBe(previous);
    await writeFile(join(repo.root, "snapshot/document.psd"), psd());
    await repo.run(["add", "snapshot/document.psd"]); await repo.run(["commit", "-m", "Valid snapshot"]);
    const outside = await mkdtemp(join(tmpdir(), "photogit-recovery-outside-"));
    await symlink(outside, join(repo.root, ".photogit/recovered"));
    await expect(repo.exportVersionSnapshot("HEAD")).rejects.toThrow(/outside the project/);
  });

  it("resolves only verified locally available LFS objects and rejects missing or tampered blobs", async () => {
    const repo = await fixture();
    await repo.saveVersion(state(), "Initial metadata");
    const bytes = psd();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const objectRoot = join(repo.root, ".git/lfs/objects", hash.slice(0, 2), hash.slice(2, 4));
    const objectPath = join(objectRoot, hash);
    await mkdir(join(repo.root, "snapshot"));
    await writeFile(join(repo.root, "snapshot/document.psd"), `version https://git-lfs.github.com/spec/v1\noid sha256:${hash}\nsize ${bytes.length}\n`);
    await repo.run(["add", "snapshot/document.psd"]); await repo.run(["commit", "-m", "LFS snapshot"]);
    await expect(repo.validateSnapshotAt("HEAD")).rejects.toThrow(/not available locally/);
    await mkdir(objectRoot, { recursive: true }); await writeFile(objectPath, bytes);
    expect(await readFile(await repo.exportVersionSnapshot("HEAD"))).toEqual(bytes);
    await writeFile(objectPath, Buffer.alloc(bytes.length));
    await expect(repo.validateSnapshotAt("HEAD")).rejects.toThrow(/integrity check/);
  });

  it("reviews remote-only branches against the current base and honors configured default bases", async () => {
    const repo = await fixture();
    await repo.saveVersion(state(), "Initial version");
    await repo.run(["branch", "-M", "main"]);
    await repo.createBranch("design");
    const changed = state(); changed.document.width = 30;
    const incoming = await repo.saveVersion(changed, "Widen design");
    await repo.switchBranch("main");
    await repo.run(["update-ref", "refs/remotes/origin/remote-design", incoming]);
    const review = (await repo.reviews()).find(({ branch }) => branch === "origin/remote-design");
    expect(review).toMatchObject({ baseBranch: "main", ahead: 1, mergeKind: "git", mergeable: true });
    const comparison = await repo.compareBranches("origin/remote-design");
    expect(comparison.changes).toContainEqual(expect.objectContaining({ propertyPath: "width", currentValue: 30 }));
    expect(comparison.files).toContainEqual({ status: "M", path: ".photogit/document.json" });
    await repo.run(["config", "photogit.baseBranch", "design"]);
    expect((await repo.repositoryInfo()).baseBranch).toBe("design");
    await repo.mergeBranch("origin/remote-design");
    expect((await repo.readStateAt())?.document.width).toBe(30);
  });

  it("blocks divergent PSD changes before ordinary Git merge touches the project", async () => {
    const repo = await fixture();
    const source = join(repo.root, ".photogit/capture.psd"); await writeFile(source, psd());
    await repo.saveVersion(state(), "Base", { snapshotPath: source });
    const base = await repo.currentBranch();
    // Keep the source ignored while testing the clean-worktree gate.
    await repo.run(["config", "core.excludesFile", "/dev/null"]);
    await writeFile(join(repo.root, ".git/info/exclude"), ".photogit/capture.psd\n");
    await repo.createBranch("incoming");
    const theirs = psd(); theirs.writeUInt32BE(30, 18); await writeFile(source, theirs);
    await repo.saveVersion(state(), "Their edit", { snapshotPath: source });
    await repo.switchBranch(base);
    const ours = psd(); ours.writeUInt32BE(40, 18); await writeFile(source, ours);
    await repo.saveVersion(state(), "Our edit", { snapshotPath: source });
    const head = await repo.run(["rev-parse", "HEAD"]);
    const comparison = await repo.compareBranches("incoming");
    expect(comparison.gitMergeable).toBe(false);
    expect(comparison.conflicts).toContain("snapshot/document.psd");
    await expect(repo.mergeBranch("incoming")).rejects.toThrow(/No project files were changed/);
    expect(await repo.run(["rev-parse", "HEAD"])).toBe(head);
    expect(await repo.run(["rev-parse", "--verify", "MERGE_HEAD"], { allowFailure: true })).toBe("");
    expect(await repo.status()).toEqual([]);
  });

  it("times out Git subprocesses and reports cancellation explicitly", async () => {
    const repo = await fixture();
    await expect(repo.run(["-c", "alias.slow=!sleep 2", "slow"], { timeoutMs: 10 })).rejects.toThrow(/timed out/);
    const controller = new AbortController(); controller.abort();
    await expect(repo.run(["status"], { signal: controller.signal })).rejects.toThrow(/cancelled/);
  });

  it("rejects malformed PSD input before saving any version or semantic files", async () => {
    const repo = await fixture();
    const source = join(repo.root, ".photogit/capture.psd");
    await writeFile(source, Buffer.alloc(40));
    await expect(repo.saveVersion(state(), "Invalid save", { snapshotPath: source })).rejects.toThrow(/valid Photoshop/);
    expect(await repo.history()).toEqual([]);
    await expect(readFile(join(repo.root, ".photogit/document.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await repo.run(["diff", "--cached", "--name-only"])).toBe("");
  });

  it("reports actual conflicting filenames and keeps an ordinary Git conflict preview out of the worktree", async () => {
    const repo = await fixture();
    await writeFile(join(repo.root, "notes.txt"), "base\n");
    await repo.run(["add", "--all"]); await repo.run(["commit", "-m", "Base"]);
    const base = await repo.currentBranch();
    await repo.createBranch("incoming");
    await writeFile(join(repo.root, "notes.txt"), "theirs\n"); await repo.run(["commit", "-am", "Theirs"]);
    await repo.switchBranch(base);
    await writeFile(join(repo.root, "notes.txt"), "ours\n"); await repo.run(["commit", "-am", "Ours"]);
    const result = await repo.compareBranches("incoming");
    expect(result.gitMergeable).toBe(false); expect(result.conflicts).toContain("notes.txt");
    await expect(repo.mergeBranch("incoming")).rejects.toThrow(/notes\.txt/);
    expect(await readFile(join(repo.root, "notes.txt"), "utf8")).toBe("ours\n");
    expect(await repo.status()).toEqual([]);
  });

  it("blocks independent semantic edits that Git could merge but would not apply to the PSD", async () => {
    const repo = await fixture(); await repo.saveVersion(state(), "Base");
    const base = await repo.currentBranch();
    await repo.createBranch("incoming");
    const incoming = state(); incoming.document.width = 30; await repo.saveVersion(incoming, "Wider");
    await repo.switchBranch(base);
    const current = state(); current.document.resolution = 144; await repo.saveVersion(current, "Higher resolution");
    const comparison = await repo.compareBranches("incoming");
    expect(comparison.gitMergeable).toBe(false);
    expect(comparison.warnings.join(" ")).toContain("would not update the PSD");
    await expect(repo.mergeBranch("incoming")).rejects.toThrow(/No project files were changed/);
  });
});
