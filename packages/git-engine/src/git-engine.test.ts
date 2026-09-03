import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { GitRepository, assertBranchName, assertRemoteName, assertSafeRelativePath, assertTagName, isWithinRoot, recoverTransactions, withFilesTransaction, writeFilesTransaction } from "./index.js";

describe("git engine safety", () => {
  it("rejects traversal and invalid branch names", () => {
    expect(() => assertSafeRelativePath("../secret")).toThrow();
    expect(() => assertBranchName("bad branch")).toThrow();
    expect(() => assertBranchName("feature/layers")).not.toThrow();
    expect(() => assertTagName("release/v1.2.0")).not.toThrow();
    expect(() => assertTagName("bad tag")).toThrow();
    expect(() => assertRemoteName("origin; rm -rf")).toThrow();
  });

  it("checks approved root containment", () => {
    expect(isWithinRoot("/tmp/project", "/tmp/project/art/file.psd")).toBe(true);
    expect(isWithinRoot("/tmp/project", "/tmp/project-evil/file.psd")).toBe(false);
  });

  it("atomically replaces domain files and removes stale domains", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-test-"));
    await writeFilesTransaction(root, new Map([[".photogit/text/a.json", "old\n"]]));
    await writeFilesTransaction(root, new Map([[".photogit/text/b.json", "new\n"]]));
    expect(await readFile(join(root, ".photogit/text/b.json"), "utf8")).toBe("new\n");
    expect(await readFile(join(root, ".photogit/text/a.json"), "utf8").catch(() => "missing")).toBe("missing");
    expect(await recoverTransactions(root)).toBe(0);
  });

  it("rolls files back when the enclosing operation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-rollback-"));
    await writeFilesTransaction(root, new Map([[".photogit/document.json", "before\n"]]));
    await expect(withFilesTransaction(root, new Map([[".photogit/document.json", "after\n"]]), new Map(), async () => {
      throw new Error("commit hook failed");
    })).rejects.toThrow("commit hook failed");
    expect(await readFile(join(root, ".photogit/document.json"), "utf8")).toBe("before\n");
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
  });
});
