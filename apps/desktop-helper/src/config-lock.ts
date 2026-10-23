import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function acquireConfigLock(configPath: string): Promise<() => Promise<void>> {
  const directory = `${configPath}.lock`;
  const ownerPath = join(directory, "owner.json");
  const nonce = randomUUID();
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(directory, { mode: 0o700 });
      await writeFile(ownerPath, JSON.stringify({ pid: process.pid, nonce }), { flag: "wx", mode: 0o600 });
      return async () => {
        const owner = await readOwner(ownerPath);
        if (owner?.nonce !== nonce) return;
        await unlink(ownerPath).catch(() => undefined);
        await rmdir(directory).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readOwner(ownerPath);
      if (owner && !helperProcessExists(owner.pid)) {
        // Only one contender can recover the dead owner's directory.
        const recoveryPath = join(directory, "recovering");
        try {
          await writeFile(recoveryPath, nonce, { flag: "wx", mode: 0o600 });
          const current = await readOwner(ownerPath);
          if (current?.nonce === owner.nonce && !helperProcessExists(current.pid)) await unlink(ownerPath);
          await unlink(recoveryPath);
          await rmdir(directory);
          continue;
        } catch { /* A concurrent starter owns recovery; report its lock. */ }
      }
      throw Object.assign(new Error(`PhotoGit helper is already running or starting for this configuration${owner ? ` (process ${owner.pid})` : ""}. Use the existing helper, or stop it before restarting. Configuration: ${configPath}`), { code: "HELPER_ALREADY_RUNNING" });
    }
  }
  throw new Error("PhotoGit could not acquire its helper configuration lock. Try starting it again.");
}

async function readOwner(path: string): Promise<{ pid: number; nonce: string } | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return Number.isInteger(value.pid) && value.pid > 0 && typeof value.nonce === "string" ? value : null;
  } catch { return null; }
}

// After a crash or restart the recorded PID can belong to an unrelated
// process. Only a live Node process still counts as the lock's owner.
function helperProcessExists(pid: number): boolean {
  if (!processExists(pid)) return false;
  if (pid === process.pid) return true;
  try {
    // The full command line, not comm: Node 24 on Linux renames its main
    // thread, so comm no longer says "node".
    const command = execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8", timeout: 2000 }).trim();
    return command === "" || /node/i.test(command);
  } catch { return true; }
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
