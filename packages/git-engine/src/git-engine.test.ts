import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type ProjectState } from "@photogit/schema";
import { GitRepository, assertBranchName, assertManagedProjectPath, assertRemoteName, assertSafeRelativePath, assertTagName, isWithinRealRoot, isWithinRoot, readProjectState, recoverTransactions, usingProjectLock, withFilesTransaction, writeFilesTransaction } from "./index.js";

function minimalState(): ProjectState {
  return {
    project: { schemaVersion: SCHEMA_VERSION, projectId: "project-1", displayName: "Poster", createdWith: "test" },
    document: { schemaVersion: SCHEMA_VERSION, documentId: "doc-1", name: "poster.psd", width: 100, height: 100, resolution: 72, mode: "rgb", bitDepth: 8, colorProfile: null, compatibility: "supported", warnings: [] },
    identities: { schemaVersion: SCHEMA_VERSION, records: [] },
    structure: { schemaVersion: SCHEMA_VERSION, roots: [], layers: [] },
    appearance: {}, text: {}, content: {}
  };
}

describe("git engine safety", () => {
  it("rejects traversal and invalid branch names", () => {
    expect(() => assertSafeRelativePath("../secret")).toThrow();
    expect(() => assertSafeRelativePath("safe//file.json")).toThrow();
    expect(() => assertSafeRelativePath("safe/line\nfeed.json")).toThrow();
    expect(() => assertSafeRelativePath(`safe/${"x".repeat(4_100)}.json`)).toThrow();
    expect(() => assertBranchName("bad branch")).toThrow();
    expect(() => assertBranchName("feature/layers")).not.toThrow();
    expect(() => assertTagName("release/v1.2.0")).not.toThrow();
    expect(() => assertTagName("bad tag")).toThrow();
    expect(() => assertRemoteName("origin; rm -rf")).toThrow();
    expect(() => assertManagedProjectPath(".photogit/document.json")).not.toThrow();
    expect(() => assertManagedProjectPath(".git/config")).toThrow(/unmanaged project path/);
    expect(() => assertManagedProjectPath(".photogit/helper.json")).toThrow(/unmanaged project path/);
  });

  it("checks approved root containment", () => {
    expect(isWithinRoot("/tmp/project", "/tmp/project/art/file.psd")).toBe(true);
    expect(isWithinRoot("/tmp/project", "/tmp/project-evil/file.psd")).toBe(false);
  });

  it("resolves symlinks before approving filesystem access", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-roots-"));
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    await Promise.all([mkdir(root), mkdir(outside)]);
    const linked = join(root, "linked");
    await symlink(outside, linked);
    expect(isWithinRoot(root, linked)).toBe(true);
    expect(await isWithinRealRoot(root, linked)).toBe(false);
  });

  it("atomically replaces domain files and removes stale domains", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-test-"));
    await writeFilesTransaction(root, new Map([[".photogit/text/a.json", "old\n"]]));
    await writeFilesTransaction(root, new Map([[".photogit/text/b.json", "new\n"]]));
    expect(await readFile(join(root, ".photogit/text/b.json"), "utf8")).toBe("new\n");
    expect(await readFile(join(root, ".photogit/text/a.json"), "utf8").catch(() => "missing")).toBe("missing");
    expect(await recoverTransactions(root)).toBe(0);
  });

  it("does not steal an old lock from a still-running PhotoGit process", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-live-lock-"));
    const lockPath = join(root, ".photogit", "project.lock");
    await mkdir(join(root, ".photogit"));
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: "2000-01-01T00:00:00.000Z" }));
    await utimes(lockPath, new Date(0), new Date(0));
    await expect(usingProjectLock(root, async () => "should not run", 0)).rejects.toThrow(/already running/);
    await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, createdAt: "2000-01-01T00:00:00.000Z" }));
    await utimes(lockPath, new Date(0), new Date(0));
    await expect(usingProjectLock(root, async () => "recovered", 0)).resolves.toBe("recovered");
  });

  it("rolls files back when the enclosing operation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-rollback-"));
    await writeFilesTransaction(root, new Map([[".photogit/document.json", "before\n"]]));
    await expect(withFilesTransaction(root, new Map([[".photogit/document.json", "after\n"]]), new Map(), async () => {
      throw new Error("commit hook failed");
    })).rejects.toThrow("commit hook failed");
    expect(await readFile(join(root, ".photogit/document.json"), "utf8")).toBe("before\n");
  });

  it("rolls newly-created untracked state back after a failed save", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-untracked-rollback-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    await repository.run(["config", "user.name", "PhotoGit Test"]);
    await repository.run(["config", "user.email", "test@photogit.local"]);
    await repository.run(["add", ".gitattributes", ".gitignore"]);
    await repository.run(["commit", "-m", "Baseline"]);
    await expect(withFilesTransaction(root, new Map([[".photogit/document.json", "new\n"]]), new Map(), async () => {
      throw new Error("save failed");
    })).rejects.toThrow("save failed");
    await expect(readFile(join(root, ".photogit/document.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not roll committed files backward if post-commit verification fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-postcommit-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    await repository.run(["config", "user.name", "PhotoGit Test"]);
    await repository.run(["config", "user.email", "test@photogit.local"]);
    await writeFilesTransaction(root, new Map([[".photogit/document.json", "before\n"]]));
    await repository.run(["add", ".photogit", ".gitattributes", ".gitignore"]);
    await repository.run(["commit", "-m", "Before"]);
    await expect(withFilesTransaction(root, new Map([[".photogit/document.json", "after\n"]]), new Map(), async () => {
      await repository.run(["add", ".photogit"]);
      await repository.run(["commit", "-m", "After"]);
      throw new Error("verification failed after commit");
    })).rejects.toThrow("verification failed after commit");
    expect(await readFile(join(root, ".photogit/document.json"), "utf8")).toBe("after\n");
    expect(await repository.showFile("HEAD", ".photogit/document.json")).toBe("after");
  });

  it("never stages helper credentials when saving semantic state", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-token-stage-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    await repository.run(["config", "user.name", "PhotoGit Test"]);
    await repository.run(["config", "user.email", "test@photogit.local"]);
    await mkdir(join(root, ".photogit"), { recursive: true });
    const helperPath = join(root, ".photogit", "helper.json");
    await writeFile(helperPath, "old-token\n");
    await repository.run(["add", "-f", ".photogit/helper.json", ".gitattributes", ".gitignore"]);
    await repository.run(["commit", "-m", "Tracked legacy helper"]);
    await writeFile(helperPath, "new-private-token\n");
    const state = minimalState();

    await repository.saveVersion(state, "Safe semantic save");
    expect(await repository.showFile("HEAD", ".photogit/helper.json")).toBe("old-token");
    expect(await readFile(helperPath, "utf8")).toBe("new-private-token\n");
    expect(await readdir(join(root, ".photogit", "transactions"))).toEqual([]);
  });

  it("unstages exact paths and rolls back a first save rejected by a commit hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-first-save-hook-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    await repository.run(["config", "user.name", "PhotoGit Test"]);
    await repository.run(["config", "user.email", "test@photogit.local"]);
    const hook = join(root, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o700);

    await expect(repository.saveVersion(minimalState(), "Rejected first save")).rejects.toThrow();
    expect(await repository.run(["diff", "--cached", "--name-only"])).toBe("");
    await expect(readFile(join(root, ".photogit", "document.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(root, ".photogit", "transactions"))).toEqual([]);
  });

  it("discards a forged transaction journal without touching paths outside the project", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-journal-"));
    const root = join(parent, "project");
    const victim = join(parent, "victim.txt");
    const id = "00000000-0000-4000-8000-000000000000";
    const transaction = join(root, ".photogit", "transactions", id);
    await mkdir(transaction, { recursive: true });
    await writeFile(victim, "keep me\n");
    await writeFile(join(transaction, "journal.json"), JSON.stringify({ id, phase: "applying", applied: ["../victim.txt"], stale: [] }));
    expect(await recoverTransactions(root)).toBe(0);
    expect(await readFile(victim, "utf8")).toBe("keep me\n");
  });

  it("discards recovery journals that target Git metadata or helper credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-managed-journal-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    const gitConfig = join(root, ".git", "config");
    const configBefore = await readFile(gitConfig, "utf8");
    const id = "00000000-0000-4000-8000-000000000000";
    const transaction = join(root, ".photogit", "transactions", id);
    await mkdir(transaction, { recursive: true });
    await writeFile(join(transaction, "journal.json"), JSON.stringify({ id, phase: "applying", applied: [".git/config"], stale: [".photogit/helper.json"] }));

    expect(await recoverTransactions(root)).toBe(0);
    expect(await readFile(gitConfig, "utf8")).toBe(configBefore);
  });

  it("refuses to copy through a managed destination symlink", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-destination-symlink-"));
    const root = join(parent, "project");
    const victim = join(parent, "victim.txt");
    await mkdir(join(root, ".photogit"), { recursive: true });
    await writeFile(victim, "private\n");
    await symlink(victim, join(root, ".photogit", "document.json"));

    await expect(writeFilesTransaction(root, new Map([[".photogit/document.json", "replacement\n"]]))).rejects.toThrow(/unsafe project entry/);
    expect(await readFile(victim, "utf8")).toBe("private\n");
  });

  it("refuses symlinked artifact sources before creating a transaction", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-artifact-symlink-"));
    const root = join(parent, "project");
    const source = join(parent, "source.psd");
    const linked = join(parent, "linked.psd");
    await mkdir(root);
    await writeFile(source, "not really a PSD\n");
    await symlink(source, linked);

    await expect(withFilesTransaction(root, new Map(), new Map([["snapshot/document.psd", linked]]), async () => undefined)).rejects.toThrow(/regular files/);
    expect(await readdir(join(root, ".photogit", "transactions")).catch(() => [])).toEqual([]);
  });

  it("does not follow state-file or transaction-directory symlinks outside the project", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-symlink-"));
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    await Promise.all([mkdir(join(root, ".photogit", "structure"), { recursive: true }), mkdir(outside)]);
    const externalState = join(outside, "layers.json");
    await writeFile(externalState, JSON.stringify({ schemaVersion: 1, roots: [], layers: [] }));
    await symlink(externalState, join(root, ".photogit", "structure", "layers.json"));
    await expect(readProjectState(root)).rejects.toThrow();

    await symlink(outside, join(root, ".photogit", "transactions"));
    await expect(writeFilesTransaction(root, new Map([[".photogit/document.json", "safe\n"]]))).rejects.toThrow(/transaction folder resolves outside/);
    expect(await readdir(outside)).toEqual(["layers.json"]);
  });

  it("does not follow repository metadata symlinks during initialization", async () => {
    const parent = await mkdtemp(join(tmpdir(), "photogit-init-symlink-"));
    const root = join(parent, "project");
    const victim = join(parent, "victim.txt");
    await mkdir(root);
    await writeFile(victim, "keep me\n");
    await symlink(victim, join(root, ".gitattributes"));
    await expect(new GitRepository(root).initialize()).rejects.toThrow(/unsafe repository metadata/);
    expect(await readFile(victim, "utf8")).toBe("keep me\n");
  });

  it("parses externally-authored history without trusting printable control delimiters", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-history-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    await repository.run(["config", "user.name", "PhotoGit Test"]);
    await repository.run(["config", "user.email", "test@photogit.local"]);
    await repository.run(["commit", "--allow-empty", "-m", "Refine\u001fposter\u001ewith safe history"]);

    const history = await repository.history();
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(expect.objectContaining({ author: "PhotoGit Test", message: "Refine poster with safe history" }));
  });

  it("keeps newline filenames and renames as single status entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-status-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    await repository.run(["config", "user.name", "PhotoGit Test"]);
    await repository.run(["config", "user.email", "test@photogit.local"]);
    await writeFile(join(root, "before.txt"), "version one\n");
    await repository.run(["add", "--all"]);
    await repository.run(["commit", "-m", "Baseline"]);
    await repository.run(["mv", "before.txt", "after\nline.txt"]);

    const status = await repository.status();
    expect(status).toHaveLength(1);
    expect(status[0]).toContain("after\nline.txt");
  });

  it("reviews, merges, tags, and creates a GitHub pull-request link", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-review-"));
    const repository = new GitRepository(root);
    await repository.initialize();
    await repository.run(["config", "user.name", "PhotoGit Test"]);
    await repository.run(["config", "user.email", "test@photogit.local"]);
    await writeFile(join(root, "design.txt"), "baseline\n");
    await repository.run(["add", "--all"]);
    await repository.run(["commit", "-m", "Baseline"]);
    const base = await repository.currentBranch();
    await repository.createBranch("feature/review-tools");
    await writeFile(join(root, "design.txt"), "refined\n");
    await repository.run(["add", "design.txt"]);
    await repository.run(["commit", "-m", "Refine design"]);
    await repository.switchBranch(base);

    const reviews = await repository.reviews();
    expect(reviews).toContainEqual(expect.objectContaining({ branch: "feature/review-tools", ahead: 1, changeCount: 1, mergeable: true }));
    await repository.mergeBranch("feature/review-tools");
    expect(await readFile(join(root, "design.txt"), "utf8")).toBe("refined\n");
    await repository.createTag("reviewed/v1");
    expect(await repository.tags()).toContain("reviewed/v1");
    await repository.run(["remote", "add", "origin", "git@github.com:xingexu/photogit.git"]);
    expect(await repository.pullRequestUrl(base)).toBe(`https://github.com/xingexu/photogit/compare/${encodeURIComponent(base)}...${encodeURIComponent(base)}?expand=1`);
    await repository.run(["remote", "set-url", "origin", "ssh://git@github.com/xingexu/photogit.git"]);
    expect(await repository.pullRequestUrl(base)).toContain("https://github.com/xingexu/photogit/compare/");
    await repository.run(["checkout", "--detach", "HEAD"]);
    await expect(repository.reviews()).rejects.toThrow(/Switch to a branch/);
    await expect(repository.mergeBranch("feature/review-tools")).rejects.toThrow(/Switch to a branch/);
  });
});
