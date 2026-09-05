import { constants } from "node:fs";
import { access, lstat, open, realpath, statfs, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { GitRepository, isWithinRealRoot, readProjectState } from "@photogit/git-engine";
import { validateProjectMetadata } from "@photogit/schema";

export type DoctorCheck = { name: string; status: "pass" | "fail" | "notice"; detail: string };
const PRIVATE_PATHS = [".photogit/helper.json", ".photogit/project.lock", ".photogit/capture.json", ".photogit/incoming/probe", ".photogit/transactions/probe", ".photogit/bridge/probe", ".photogit/recovered/probe"];

/** Project validity is separate from installation readiness and helper uptime. */
export async function inspectProject(root: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const check = async (name: string, action: () => Promise<string>) => {
    try { checks.push({ name, status: "pass", detail: await action() }); }
    catch (error) { checks.push({ name, status: "fail", detail: error instanceof Error ? error.message : "Check failed" }); }
  };
  const repository = new GitRepository(root);
  await check("Project", async () => {
    await repository.assertRepository();
    const actualRoot = await repository.run(["rev-parse", "--show-toplevel"]);
    if (await realpath(root) !== await realpath(actualRoot)) throw new Error("Choose the Git project root, not a nested folder.");
    await requireDirectory(root, ".photogit");
    validateProjectMetadata(await readJson(root, ".photogit/project.json"));
    return "Valid Git-backed PhotoGit project and project.json schema";
  });
  if (checks[0]?.status === "fail") return checks;
  await check("Project schemas", async () => {
    const statePaths = [".photogit/document.json", ".photogit/identities.json", ".photogit/structure/layers.json"];
    const present = await Promise.all(statePaths.map((path) => lstat(join(root, path)).then(() => true).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    })));
    if (present.some(Boolean)) { await readProjectState(root); return "All saved document, identity, layer, and domain schemas are valid"; }
    return "New project: no document version has been saved yet";
  });
  await check("Required directories", async () => {
    await requireDirectory(root, ".photogit/transactions");
    const snapshot = await lstat(join(root, "snapshot")).catch(() => null);
    if (snapshot) await requireDirectory(root, "snapshot");
    return "Metadata and transaction directories are safe; snapshot directory is checked when present";
  });
  const pairingExists = await lstat(join(root, ".photogit/helper.json")).catch(() => null);
  if (!pairingExists) checks.push({ name: "Pairing", status: "notice", detail: "Not paired yet; start the helper with --approve-root for this project" });
  else await check("Pairing", async () => {
    // Keep this wire-format rule aligned with helper config and bridge validation.
    // Never forward JSON parse diagnostics: they can contain pairing-file bytes.
    const invalidPairing = () => new Error("Pairing configuration is invalid; restart the helper to pair again");
    const pairing = await readJson(root, ".photogit/helper.json").catch(() => { throw invalidPairing(); }) as Record<string, unknown>;
    if (!pairing || typeof pairing !== "object" || pairing.protocolVersion !== 1 || typeof pairing.token !== "string" || !/^[A-Za-z0-9_-]{32,200}$/.test(pairing.token)) throw invalidPairing();
    if (pairingExists.mode & 0o077) throw new Error("Pairing file permissions expose credentials; require mode 0600");
    await requireDirectory(root, ".photogit/bridge");
    return "Protocol and token format are valid; pairing credentials are private";
  });
  await check("Ignore rules", async () => {
    const ignored = await repository.run(["check-ignore", "--no-index", ...PRIVATE_PATHS], { allowFailure: true });
    const missing = PRIVATE_PATHS.filter((path) => !ignored.split("\n").includes(path));
    const tracked = await repository.run(["ls-files", "--", ...PRIVATE_PATHS.filter((path) => !path.endsWith("/probe")), ".photogit/bridge", ".photogit/incoming", ".photogit/transactions", ".photogit/recovered"]);
    if (tracked) throw new Error("Private pairing or temporary PhotoGit files are tracked by Git; remove them from the Git index and rotate any exposed helper token");
    if (missing.length) throw new Error(`Missing effective ignore rules: ${missing.map((path) => path.replace(/\/probe$/, "/")).join(", ")}; rerun photogit init`);
    return "Pairing, bridge, captures, locks, transactions, and recovered copies are ignored and untracked";
  });
  await check("Git LFS rules", async () => {
    const output = await repository.run(["check-attr", "-z", "filter", "diff", "merge", "text", "--", "snapshot/document.psd", "snapshot/document.psb"]);
    const fields = output.split("\0");
    const expected: Record<string, string> = { filter: "lfs", diff: "lfs", merge: "lfs", text: "unset" };
    for (let index = 0; index + 2 < fields.length; index += 3) {
      if (fields[index + 2] !== expected[fields[index + 1]!]) throw new Error("PSD and PSB files require effective Git LFS filter/diff/merge rules and -text; rerun photogit init");
    }
    return "PSD and PSB snapshots have effective LFS and binary attributes";
  });
  await check("Writable access", async () => {
    for (const directory of [root, join(root, ".photogit"), join(root, ".photogit/transactions")]) {
      await access(directory, constants.W_OK);
      const path = join(directory, `.photogit-doctor-${randomUUID()}`);
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile("PhotoGit writable access probe\n"); await handle.sync(); }
      finally { await handle.close(); await unlink(path); }
    }
    return "Created, synced, and removed private test files in the project, metadata, and transaction directories";
  });
  await check("Disk space", async () => {
    const filesystem = await statfs(root);
    const available = filesystem.bavail * filesystem.bsize;
    const snapshot = await lstat(join(root, "snapshot/document.psd")).catch(() => null);
    const required = Math.max(1024 ** 3, (snapshot?.size ?? 0) * 3);
    if (available < required) throw new Error(`${(available / 1024 ** 3).toFixed(1)} GB free; at least ${(required / 1024 ** 3).toFixed(1)} GB required for save and recovery copies`);
    return `${(available / 1024 ** 3).toFixed(1)} GB free; ${(required / 1024 ** 3).toFixed(1)} GB required`;
  });
  return checks;
}

async function requireDirectory(root: string, path: string): Promise<void> {
  const directory = resolve(root, path);
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !await isWithinRealRoot(root, directory)) throw new Error(`Missing or unsafe required directory: ${path}`);
}

async function readJson(root: string, path: string): Promise<unknown> {
  const absolute = join(root, path);
  if (!await isWithinRealRoot(root, absolute)) throw new Error(`Missing or unsafe project file: ${path}`);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 1024 * 1024) throw new Error(`Invalid or oversized project file: ${path}`);
    return JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}
