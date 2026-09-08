import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const checker = resolve("scripts/verify-panel-escaping.mjs");

async function check(directory?: string) {
  try {
    const { stdout } = await run(process.execPath, directory ? [checker, directory] : [checker]);
    return { code: 0, output: stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

// A gate nobody has seen fail is a gate on trust. These fixtures prove it
// actually rejects the two shapes it exists to reject.
describe("Panel escaping gate", () => {
  it("passes on the real panel and reports what it proved", async () => {
    const { code, output } = await check();
    expect(code).toBe(0);
    expect(output).toMatch(/every one escaped or provably constant/);
    expect(output).toMatch(/\d+ interpolations/);
  });

  it("passes a fixture whose interpolations are all escaped or constant", async () => {
    const { code } = await check("scripts/test-fixtures/escaping-safe");
    expect(code).toBe(0);
  });

  it("rejects a single unescaped interpolation and names it", async () => {
    const { code, output } = await check("scripts/test-fixtures/escaping-unsafe");
    expect(code).toBe(1);
    expect(output).toContain("unescaped interpolation");
    expect(output).toContain("item.count");
  });

  it("rejects an escaper that does not escape every character", async () => {
    const { code, output } = await check("scripts/test-fixtures/escaping-weak");
    expect(code).toBe(1);
    expect(output).toMatch(/relies on escapeHtml\(\) but declares it without escaping/);
  });

  it("does not silently pass a directory with no scripts in it", async () => {
    const { code, output } = await check("scripts/test-fixtures");
    expect(code).toBe(1);
    expect(output).toContain("No panel scripts found");
  });
});
