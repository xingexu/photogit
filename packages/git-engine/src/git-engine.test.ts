import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { assertBranchName, assertRemoteName, assertSafeRelativePath, isWithinRoot, recoverTransactions, withFilesTransaction, writeFilesTransaction } from "./index.js";

describe("git engine safety", () => {
  it("rejects traversal and invalid branch names", () => {
    expect(() => assertSafeRelativePath("../secret")).toThrow();
    expect(() => assertBranchName("bad branch")).toThrow();
    expect(() => assertBranchName("feature/layers")).not.toThrow();
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
});
