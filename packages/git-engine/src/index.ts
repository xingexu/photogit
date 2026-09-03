import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { ProjectState } from "@photogit/schema";
import { canonicalJson, stateToFiles } from "@photogit/serializer";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 10 * 1024 * 1024;

export class GitCommandError extends Error {
  constructor(public readonly args: readonly string[], public readonly stderr: string) {
    super(stderr.trim() || `Git command failed: git ${args.join(" ")}`);
    this.name = "GitCommandError";
  }
}

export type VersionEntry = { id: string; shortId: string; author: string; date: string; message: string };
export type BranchEntry = { name: string; current: boolean };
export type ReviewEntry = { branch: string; ahead: number; behind: number; changeCount: number; changes: string[]; mergeable: boolean };
export type RepositoryInfo = { remoteUrl: string | null; provider: "github" | "local" | "other"; currentBranch: string; baseBranch: string };

export class GitRepository {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async run(args: readonly string[], options: { allowFailure?: boolean } = {}): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd: this.root,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      return stdout.trimEnd();
    } catch (error) {
      const failed = error as NodeJS.ErrnoException & { stderr?: string };
      if (options.allowFailure) return "";
      throw new GitCommandError(args, failed.stderr ?? failed.message);
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await this.run(["init"]);
    await ensureLine(join(this.root, ".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text");
    await ensureLine(join(this.root, ".gitattributes"), "*.psb filter=lfs diff=lfs merge=lfs -text");
    await ensureLine(join(this.root, ".gitignore"), ".photogit/transactions/");
    await ensureLine(join(this.root, ".gitignore"), ".photogit/project.lock");
    await ensureLine(join(this.root, ".gitignore"), ".photogit/capture.json");
    await ensureLine(join(this.root, ".gitignore"), ".photogit/incoming/");
    await ensureLine(join(this.root, ".gitignore"), ".photogit/helper.json");
    await ensureLine(join(this.root, ".gitignore"), ".photogit/bridge/");
  }

  async assertRepository(): Promise<void> {
    const inside = await this.run(["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
    if (inside !== "true") throw new Error(`${this.root} is not a Git project. Run photogit init first.`);
  }

  async status(): Promise<string[]> {
    await this.assertRepository();
    const output = await this.run(["status", "--porcelain=v1", "--untracked-files=all"]);
    return output ? output.split("\n") : [];
  }

  async currentBranch(): Promise<string> {
    return (await this.run(["branch", "--show-current"])) || "detached";
  }

  async branches(): Promise<BranchEntry[]> {
    await this.assertRepository();
    const [current, output] = await Promise.all([
      this.currentBranch(),
      this.run(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    ]);
    return output.split("\n").filter(Boolean).sort().map((name) => ({ name, current: name === current }));
  }

  async createBranch(name: string): Promise<void> {
    assertBranchName(name);
    await this.assertCleanForCheckout();
    await this.run(["switch", "-c", name]);
  }

  async switchBranch(name: string): Promise<void> {
    assertBranchName(name);
    await this.assertCleanForCheckout();
    await this.run(["switch", name]);
  }

  async fetch(remote = "origin"): Promise<void> {
    assertRemoteName(remote);
    await this.run(["fetch", "--prune", remote]);
  }

  async pull(remote = "origin"): Promise<void> {
    assertRemoteName(remote);
    await this.assertCleanForCheckout();
    await this.run(["pull", "--ff-only", remote]);
  }

  async push(remote = "origin"): Promise<void> {
    assertRemoteName(remote);
    const branch = await this.currentBranch();
    if (branch === "detached") throw new Error("Switch to a branch before sharing changes.");
    await this.run(["push", "--set-upstream", remote, branch]);
  }

  async repositoryInfo(remote = "origin"): Promise<RepositoryInfo> {
    assertRemoteName(remote);
    await this.assertRepository();
    const [remoteUrl, currentBranch, baseBranch] = await Promise.all([
      this.run(["remote", "get-url", remote], { allowFailure: true }),
      this.currentBranch(),
      this.defaultBaseBranch(remote)
    ]);
    return {
      remoteUrl: remoteUrl || null,
      provider: !remoteUrl ? "local" : githubRepositoryUrl(remoteUrl) ? "github" : isLocalRemote(remoteUrl) ? "local" : "other",
      currentBranch,
      baseBranch
    };
  }

  async reviews(limit = 8): Promise<ReviewEntry[]> {
    await this.assertRepository();
    const current = await this.currentBranch();
    const branches = (await this.branches()).filter((branch) => !branch.current).slice(0, Math.max(1, limit));
    const reviews = await Promise.all(branches.map(async ({ name }) => {
      const [aheadText, behindText, changed, mergeTree] = await Promise.all([
        this.run(["rev-list", "--count", `${current}..${name}`], { allowFailure: true }),
        this.run(["rev-list", "--count", `${name}..${current}`], { allowFailure: true }),
        this.run(["diff", "--name-only", `${current}...${name}`], { allowFailure: true }),
        this.run(["merge-tree", "--write-tree", current, name], { allowFailure: true })
      ]);
      const changes = changed.split("\n").filter(Boolean);
      return {
        branch: name,
        ahead: Number.parseInt(aheadText || "0", 10) || 0,
        behind: Number.parseInt(behindText || "0", 10) || 0,
        changeCount: changes.length,
        changes: changes.slice(0, 12),
        mergeable: /^[a-f0-9]{40,64}(?:\n|$)/i.test(mergeTree)
      };
    }));
    return reviews.sort((left, right) => right.ahead - left.ahead || left.branch.localeCompare(right.branch));
  }

  async mergeBranch(name: string): Promise<void> {
    assertBranchName(name);
    await this.assertCleanForCheckout();
    const current = await this.currentBranch();
    if (current === name) throw new Error("Choose another branch to merge into the current design.");
    if (!(await this.branches()).some((branch) => branch.name === name)) throw new Error(`Branch ${name} does not exist in this project.`);
    try {
      await this.run(["merge", "--no-ff", "--no-edit", name]);
    } catch {
      await this.run(["merge", "--abort"], { allowFailure: true });
      throw new Error(`PhotoGit could not merge ${name} automatically. The merge was safely aborted; review its conflicting design changes first.`);
    }
  }

  async conflicts(): Promise<string[]> {
    const changes = await this.status();
    return changes.filter((line) => /^(?:DD|AU|UD|UA|DU|AA|UU)/.test(line)).map((line) => line.slice(3).trim());
  }

  async tags(): Promise<string[]> {
    await this.assertRepository();
    const output = await this.run(["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)", "refs/tags"]);
    return output.split("\n").filter(Boolean);
  }

  async createTag(name: string): Promise<void> {
    assertTagName(name);
    await this.assertRepository();
    await this.run(["tag", name]);
  }

  async pullRequestUrl(base?: string, remote = "origin"): Promise<string> {
    if (base) assertBranchName(base);
    const info = await this.repositoryInfo(remote);
    const repositoryUrl = info.remoteUrl ? githubRepositoryUrl(info.remoteUrl) : null;
    if (!repositoryUrl) throw new Error("Pull requests need a GitHub remote. Add a GitHub origin, then try again.");
    if (info.currentBranch === "detached") throw new Error("Switch to a branch before opening a pull request.");
    const baseBranch = base || info.baseBranch;
    return `${repositoryUrl}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(info.currentBranch)}?expand=1`;
  }

  async history(limit = 30): Promise<VersionEntry[]> {
    await this.assertRepository();
    const format = "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e";
    const output = await this.run(["log", `--max-count=${limit}`, `--format=${format}`], { allowFailure: true });
    return output.split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [id = "", shortId = "", author = "", date = "", message = ""] = entry.split("\x1f");
      return { id, shortId, author, date, message };
    });
  }

  async saveVersion(
    state: ProjectState,
    message: string,
    artifacts: { snapshotPath?: string; previewPath?: string } = {}
  ): Promise<string> {
    if (!message.trim()) throw new Error("A save-version message is required.");
    await this.assertRepository();
    return usingProjectLock(this.root, async () => {
      await recoverTransactions(this.root);
      const files = stateToFiles(state);
      const binaryFiles = new Map<string, string>();
      if (artifacts.snapshotPath) binaryFiles.set("snapshot/document.psd", resolve(artifacts.snapshotPath));
      if (artifacts.previewPath) binaryFiles.set(".photogit/previews/document.png", resolve(artifacts.previewPath));
      for (const source of binaryFiles.values()) await access(source, constants.R_OK);
      const stagePaths = [".photogit", ".gitattributes", ".gitignore"];
      if (artifacts.snapshotPath) stagePaths.push("snapshot/document.psd");
      const alreadyStaged = await this.run(["diff", "--cached", "--name-only"]);
      if (alreadyStaged) throw new Error("The Git index already contains staged files. Commit or unstage them before saving a PhotoGit version.");
      await this.assertAuthorConfigured();
      return withFilesTransaction(this.root, files, binaryFiles, async () => {
        try {
          await this.run(["add", "--", ...stagePaths]);
          const stagedNames = await this.run(["diff", "--cached", "--name-only"]);
          if (!stagedNames) throw new Error("There are no semantic changes to save.");
          await this.run(["commit", "-m", message.trim(), "--", ...stagePaths]);
          const id = await this.run(["rev-parse", "HEAD"]);
          await this.run(["cat-file", "-e", `${id}^{commit}`]);
          return id;
        } catch (error) {
          await this.unstage(stagePaths);
          throw error;
        }
      });
    });
  }

  async showFile(version: string, projectPath: string): Promise<string> {
    assertCommitIdentifier(version);
    assertSafeRelativePath(projectPath);
    return this.run(["show", `${version}:${projectPath}`]);
  }

  private async assertAuthorConfigured(): Promise<void> {
    const [name, email] = await Promise.all([
      this.run(["config", "user.name"], { allowFailure: true }),
      this.run(["config", "user.email"], { allowFailure: true })
    ]);
    if (!name || !email) throw new Error("Git author details are missing. Configure user.name and user.email before saving a version.");
  }

  private async assertCleanForCheckout(): Promise<void> {
    const changes = await this.status();
    const meaningful = changes.filter((line) => !line.endsWith(" .photogit/incoming/document.psd") && !line.endsWith(" .photogit/incoming/document.png"));
    if (meaningful.length) throw new Error("The current design has unsaved project changes. Save a version before switching or getting updates.");
  }

  private async defaultBaseBranch(remote: string): Promise<string> {
    const symbolic = await this.run(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], { allowFailure: true });
    if (symbolic.startsWith(`${remote}/`)) return symbolic.slice(remote.length + 1);
    const names = (await this.branches()).map((branch) => branch.name);
    return names.includes("main") ? "main" : names.includes("master") ? "master" : names[0] || "main";
  }

  private async unstage(paths: string[]): Promise<void> {
    const hasHead = Boolean(await this.run(["rev-parse", "--verify", "HEAD"], { allowFailure: true }));
    if (hasHead) await this.run(["restore", "--staged", "--", ...paths], { allowFailure: true });
    else await this.run(["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths], { allowFailure: true });
  }
}

export async function findProjectRoot(start = process.cwd()): Promise<string> {
  let cursor = resolve(start);
  while (true) {
    try {
      await access(join(cursor, ".photogit", "project.json"), constants.R_OK);
      return cursor;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error("No PhotoGit project found. Run photogit init first.");
      cursor = parent;
    }
  }
}

export async function readProjectState(root: string): Promise<ProjectState> {
  const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(join(root, path), "utf8")) as T;
  const structure = await readJson<ProjectState["structure"]>(".photogit/structure/layers.json");
  const uuids = structure.layers.map((layer) => layer.uuid);
  const appearance = await readDomain<ProjectState["appearance"]>(root, ".photogit/appearance", uuids);
  const text = await readDomain<ProjectState["text"]>(root, ".photogit/text", uuids, true);
  const content = await readDomain<ProjectState["content"]>(root, ".photogit/content", uuids, true);
  return {
    project: await readJson(".photogit/project.json"),
    document: await readJson(".photogit/document.json"),
    identities: await readJson(".photogit/identities.json"),
    structure,
    appearance,
    text,
    content
  };
}

export function assertSafeRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]+/).includes("..")) throw new Error(`Unsafe project path: ${path}`);
}

export function assertBranchName(name: string): void {
  if (!/^(?![-.])(?!.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/.test(name) || name.endsWith("/") || name.endsWith(".")) {
    throw new Error(`Invalid branch name: ${name}`);
  }
}

export function assertRemoteName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) throw new Error(`Invalid shared-project name: ${name}`);
}

export function assertCommitIdentifier(value: string): void {
  if (!/^[A-Fa-f0-9]{4,64}$/.test(value) && !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/.test(value)) throw new Error(`Invalid version ID: ${value}`);
}

export function assertTagName(name: string): void {
  if (!/^(?![-.])(?!.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(name) || name.endsWith("/") || name.endsWith(".")) {
    throw new Error(`Invalid tag name: ${name}`);
  }
}

function githubRepositoryUrl(remoteUrl: string): string | null {
  const ssh = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) {
    const [, owner = "", repository = ""] = ssh;
    return `https://github.com/${owner}/${repository.replace(/\.git$/i, "")}`;
  }
  const https = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (https) {
    const [, owner = "", repository = ""] = https;
    return `https://github.com/${owner}/${repository.replace(/\.git$/i, "")}`;
  }
  return null;
}

function isLocalRemote(remoteUrl: string): boolean {
  return remoteUrl.startsWith("/") || remoteUrl.startsWith("file://") || /^[A-Za-z]:[\\/]/.test(remoteUrl);
}

export async function usingProjectLock<T>(root: string, action: () => Promise<T>, staleAfterMs = 5 * 60_000): Promise<T> {
  const lockPath = join(root, ".photogit", "project.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    const lockStat = await stat(lockPath).catch(() => null);
    if (!lockStat || Date.now() - lockStat.mtimeMs <= staleAfterMs) throw new Error("Another PhotoGit operation is already running for this project.");
    await unlink(lockPath);
    handle = await open(lockPath, "wx");
  }
  try {
    await handle.writeFile(canonicalJson({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

type Journal = { id: string; phase: "prepared" | "applying" | "committing" | "committed"; applied: string[]; stale: string[] };

export async function writeFilesTransaction(root: string, files: Map<string, string>, binaryFiles = new Map<string, string>()): Promise<void> {
  await withFilesTransaction(root, files, binaryFiles, async () => undefined);
}

export async function withFilesTransaction<T>(
  root: string,
  files: Map<string, string>,
  binaryFiles: Map<string, string>,
  action: () => Promise<T>
): Promise<T> {
  const id = randomUUID();
  const transactionRoot = join(root, ".photogit", "transactions", id);
  const payloadRoot = join(transactionRoot, "payload");
  const backupRoot = join(transactionRoot, "backup");
  const journalPath = join(transactionRoot, "journal.json");
  await mkdir(payloadRoot, { recursive: true });
  const journal: Journal = { id, phase: "prepared", applied: [], stale: [] };

  for (const [relativePath, source] of [...files, ...binaryFiles]) {
    assertSafeRelativePath(relativePath);
    const payloadPath = join(payloadRoot, relativePath);
    await mkdir(dirname(payloadPath), { recursive: true });
    if (binaryFiles.has(relativePath)) await copyFile(source, payloadPath);
    else await writeFile(payloadPath, source, { encoding: "utf8", flag: "wx" });
  }
  await writeJournal(journalPath, journal);

  try {
    journal.phase = "applying";
    await writeJournal(journalPath, journal);
    const desiredPaths = new Set([...files.keys(), ...binaryFiles.keys()]);
    const stale = await findStaleDomainFiles(root, desiredPaths);
    for (const relativePath of stale) {
      const destination = join(root, relativePath);
      const backup = join(backupRoot, relativePath);
      await mkdir(dirname(backup), { recursive: true });
      journal.stale.push(relativePath);
      await writeJournal(journalPath, journal);
      await rename(destination, backup);
    }
    for (const relativePath of [...desiredPaths].sort()) {
      const destination = join(root, relativePath);
      const backup = join(backupRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      if (await exists(destination)) {
        await mkdir(dirname(backup), { recursive: true });
        await copyFile(destination, backup);
      }
      journal.applied.push(relativePath);
      await writeJournal(journalPath, journal);
      await rename(join(payloadRoot, relativePath), destination);
    }
    journal.phase = "committing";
    await writeJournal(journalPath, journal);
    const result = await action();
    journal.phase = "committed";
    await writeJournal(journalPath, journal);
    await rm(transactionRoot, { recursive: true, force: true });
    return result;
  } catch (error) {
    await rollback(root, transactionRoot, journal);
    throw error;
  }
}

export async function recoverTransactions(root: string): Promise<number> {
  const directory = join(root, ".photogit", "transactions");
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let recovered = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transactionRoot = join(directory, entry.name);
    const journal = await readFile(join(transactionRoot, "journal.json"), "utf8").then((text) => JSON.parse(text) as Journal).catch(() => null);
    if (!journal || journal.phase === "committed") {
      await rm(transactionRoot, { recursive: true, force: true });
      continue;
    }
    if (journal.phase === "committing" && await pathsMatchHead(root, [...journal.applied, ...journal.stale])) {
      await rm(transactionRoot, { recursive: true, force: true });
      continue;
    }
    await rollback(root, transactionRoot, journal);
    recovered += 1;
  }
  return recovered;
}

async function pathsMatchHead(root: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false;
  try {
    await execFileAsync("git", ["diff", "--quiet", "HEAD", "--", ...paths], { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return true;
  } catch {
    return false;
  }
}

async function rollback(root: string, transactionRoot: string, journal: Journal): Promise<void> {
  const backupRoot = join(transactionRoot, "backup");
  for (const relativePath of [...journal.applied].reverse()) {
    const destination = join(root, relativePath);
    const backup = join(backupRoot, relativePath);
    if (await exists(backup)) await rename(backup, destination);
    else await rm(destination, { force: true });
  }
  for (const relativePath of [...journal.stale].reverse()) {
    const backup = join(backupRoot, relativePath);
    const destination = join(root, relativePath);
    if (await exists(backup)) {
      await mkdir(dirname(destination), { recursive: true });
      await rename(backup, destination);
    }
  }
  await rm(transactionRoot, { recursive: true, force: true });
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, canonicalJson(journal), "utf8");
  await rename(temp, path);
}

async function readDomain<T extends Record<string, unknown>>(root: string, directory: string, uuids: string[], optional = false): Promise<T> {
  const result: Record<string, unknown> = {};
  for (const uuid of uuids) {
    const path = join(root, directory, `${uuid}.json`);
    try { result[uuid] = JSON.parse(await readFile(path, "utf8")); }
    catch (error) {
      if (!optional || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return result as T;
}

async function findStaleDomainFiles(root: string, desired: Set<string>): Promise<string[]> {
  const stale: string[] = [];
  for (const directory of [".photogit/appearance", ".photogit/text", ".photogit/content", ".photogit/masks"]) {
    const entries = await readdir(join(root, directory), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = `${directory}/${entry.name}`;
      if (!desired.has(path)) stale.push(path);
    }
  }
  return stale.sort();
}

async function ensureLine(path: string, line: string): Promise<void> {
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing.split(/\r?\n/).includes(line)) return;
  const suffix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${existing}${suffix}${line}\n`, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
