import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const entry = resolve(process.cwd(), "cli/dist/main.js");
const fixture = resolve(process.cwd(), "packages/test-fixtures/captures/basic-document.json");

describe("CLI vertical workflow", () => {
  it("initializes, saves, reports status, and displays history", async () => {
    const root = await mkdtemp(join(tmpdir(), "photogit-cli-"));
    await run(["init", root]);
    await execute("git", ["config", "user.name", "PhotoGit Test"], { cwd: root });
    await execute("git", ["config", "user.email", "test@photogit.invalid"], { cwd: root });
    await copyFile(fixture, join(root, ".photogit", "capture.json"));

    const saved = await run(["save", "-m", "First design"], root);
    expect(saved).toContain("Saved version");
    expect(await readFile(join(root, ".photogit", "structure", "layers.json"), "utf8")).toContain("Launch day");

    const status = await run(["status"], root);
    expect(status).toContain("Current design matches the latest saved version");
    const history = await run(["log"], root);
    expect(history).toContain("First design");
    const diff = await run(["diff", "--capture", ".photogit/capture.json"], root);
    expect(diff).toContain("No layer changes detected");
  });
});

async function run(args: string[], cwd = process.cwd()): Promise<string> {
  const { stdout } = await execute(process.execPath, [entry, ...args], { cwd, encoding: "utf8" });
  return stdout;
}
