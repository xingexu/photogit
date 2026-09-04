import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertHelperArguments, isLoopbackHost, parseHelperConfig, publicRepositoryInfo, safeErrorText, secureWrite } from "./security.js";

describe("desktop helper security", () => {
  it("accepts only explicit loopback Host headers", () => {
    expect(isLoopbackHost("127.0.0.1:54738", 54738)).toBe(true);
    expect(isLoopbackHost("LOCALHOST:54738", 54738)).toBe(true);
    expect(isLoopbackHost("untrusted.example:54738", 54738)).toBe(false);
    expect(isLoopbackHost(undefined, 54738)).toBe(false);
  });

  it("normalizes approved roots and rejects malformed persisted tokens", () => {
    const token = "a".repeat(43);
    expect(parseHelperConfig({ protocolVersion: 1, token, approvedRoots: ["/tmp/project", "/tmp/project"] })).toMatchObject({ approvedRoots: ["/tmp/project"] });
    expect(() => parseHelperConfig({ protocolVersion: 1, token: "short", approvedRoots: [] })).toThrow("Invalid helper configuration");
    expect(() => parseHelperConfig({ protocolVersion: 1, token, approvedRoots: ["bad\0root"] })).toThrow("Invalid helper configuration");
    expect(() => parseHelperConfig({ protocolVersion: 1, token, approvedRoots: ["relative/project"] })).toThrow("Invalid helper configuration");
    expect(() => parseHelperConfig({ protocolVersion: 1, token, approvedRoots: ["/tmp/project"], command: "unexpected" })).toThrow("Invalid helper configuration");
    expect(() => parseHelperConfig({ protocolVersion: 1, token, approvedRoots: Array.from({ length: 257 }, (_, index) => `/tmp/project-${index}`) })).toThrow("Invalid helper configuration");
  });

  it("rejects unknown, incomplete, and duplicate helper options", () => {
    expect(() => assertHelperArguments(["--approve-root", "/tmp/project", "--port", "54738"])).not.toThrow();
    expect(() => assertHelperArguments(["--verbose"])).toThrow(/Unknown helper option/);
    expect(() => assertHelperArguments(["--approve-root"])).toThrow(/requires a value/);
    expect(() => assertHelperArguments(["--port", "54738", "--port", "54739"])).toThrow(/Duplicate helper option/);
  });

  it("writes mode-0600 files atomically without following an existing symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-secure-write-"));
    const victim = join(root, "victim.json");
    const destination = join(root, "helper.json");
    await writeFile(victim, "unchanged\n");
    await symlink(victim, destination);
    await secureWrite(destination, "private\n");
    expect(await readFile(victim, "utf8")).toBe("unchanged\n");
    expect(await readFile(destination, "utf8")).toBe("private\n");
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
  });

  it("never exposes remote credentials to the Photoshop bridge", () => {
    const info = publicRepositoryInfo({ provider: "github", currentBranch: "feature", baseBranch: "main", remoteUrl: "https://user:secret@github.com/acme/design.git" });
    expect(info).toEqual({ provider: "github", currentBranch: "feature", baseBranch: "main", remoteConfigured: true });
    expect(JSON.stringify(info)).not.toContain("secret");
  });

  it("redacts helper tokens and credentials embedded in error URLs", () => {
    const safe = safeErrorText(new Error("failed https://alice:hunter2@example.com/repo?access_token=abc123 token-value"), ["token-value"]);
    expect(safe).toBe("failed https://[redacted]@example.com/repo?access_token=[redacted] [redacted]");
  });
});
