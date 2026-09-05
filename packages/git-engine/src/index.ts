import { execFile, spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { isSafeLayerUuid, validateProjectState, type ProjectState } from "@photogit/schema";
import { canonicalJson, stateToFiles } from "@photogit/serializer";
import { diffStates, type SemanticChange } from "@photogit/differ";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 10 * 1024 * 1024;
const MAX_STATE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TRANSACTION_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_REPOSITORY_METADATA_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_LOCK_BYTES = 8 * 1024;
const GIT_TIMEOUT_MS = 60_000;
const MAX_STATE_BYTES = 64 * 1024 * 1024;

export class GitCommandError extends Error {
  constructor(public readonly args: readonly string[], public readonly stderr: string) {
    super(stderr.trim() || `Git command failed: git ${args.join(" ")}`);
    this.name = "GitCommandError";
  }
}

export type VersionEntry = { id: string; shortId: string; author: string; date: string; message: string };
export type BranchEntry = { name: string; current: boolean };
export type ReviewEntry = { branch: string; baseBranch: string; ahead: number; behind: number; changeCount: number; changes: string[]; mergeable: boolean; mergeKind: "git" };
export type RepositoryInfo = { remoteUrl: string | null; provider: "github" | "local" | "other"; currentBranch: string; baseBranch: string };
export type FileChange = { path: string; status: string };
export type BranchComparison = { baseBranch: string; incomingBranch: string; mergeBase: string; ahead: number; behind: number; files: FileChange[]; changes: SemanticChange[]; gitMergeable: boolean; conflicts: string[]; warnings: string[] };
export type VersionDetails = { version: VersionEntry; files: FileChange[]; changes: SemanticChange[]; snapshotAvailable: boolean; warnings: string[] };

export class GitRepository {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async run(args: readonly string[], options: { allowFailure?: boolean; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd: this.root,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT,
        timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
        killSignal: "SIGKILL",
        signal: options.signal,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      return stdout.trimEnd();
    } catch (error) {
      const failed = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
      if (options.allowFailure) return "";
      if (failed.killed || failed.name === "AbortError") throw new GitCommandError(args, "Git operation timed out or was cancelled. Refresh project status before retrying.");
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
    await ensureLine(join(this.root, ".gitignore"), ".photogit/recovered/");
  }

  async assertRepository(): Promise<void> {
    const inside = await this.run(["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
    if (inside !== "true") throw new Error(`${this.root} is not a Git project. Run photogit init first.`);
  }

  async status(): Promise<string[]> {
    await this.assertRepository();
    const output = await this.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    if (!output) return [];
    const fields = output.split("\0").filter(Boolean);
    const entries: string[] = [];
    for (let index = 0; index < fields.length; index += 1) {
      const entry = fields[index]!;
      entries.push(entry);
      if (/^[RC]/.test(entry) || /^.[RC]/.test(entry)) index += 1;
    }
    return entries;
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
    if (await this.currentBranch() === "detached") throw new Error("Switch to a branch before getting shared changes.");
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
    if (current === "detached") throw new Error("Switch to a branch before reviewing design directions.");
    const count = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.trunc(limit))) : 8;
    const branches = (await this.reviewBranches()).filter((branch) => branch.name !== current).slice(0, count);
    const reviews = await Promise.all(branches.map(async ({ name }) => {
      const comparison = await this.compareBranches(name, current);
      const changes = comparison.files.map(({ path }) => path);
      return {
        branch: name,
        baseBranch: current,
        ahead: comparison.ahead,
        behind: comparison.behind,
        changeCount: changes.length,
        changes: changes.slice(0, 12),
        mergeable: comparison.gitMergeable,
        mergeKind: "git" as const
      };
    }));
    return reviews.sort((left, right) => right.ahead - left.ahead || left.branch.localeCompare(right.branch));
  }

  async mergeBranch(name: string): Promise<void> {
    assertBranchName(name);
    await this.assertCleanForCheckout();
    const current = await this.currentBranch();
    if (current === "detached") throw new Error("Switch to a branch before merging a design direction.");
    if (current === name) throw new Error("Choose another branch to merge into the current design.");
    if (!(await this.reviewBranches()).some((branch) => branch.name === name)) throw new Error(`Branch ${name} does not exist in this project.`);
    const comparison = await this.compareBranches(name, current);
    if (!comparison.gitMergeable) throw new Error(`Git merge cannot proceed: ${comparison.conflicts.join(", ") || "changes require manual resolution"}. No project files were changed.`);
    try {
      await this.run(["merge", "--no-ff", "--no-edit", name]);
    } catch (error) {
      const activeMerge = await this.run(["rev-parse", "--verify", "MERGE_HEAD"], { allowFailure: true });
      if (activeMerge) {
        try { await this.run(["merge", "--abort"]); }
        catch { throw new Error("Git merge failed and could not be aborted. Recovery required: inspect project conflicts and finish or abort the merge in Git before continuing."); }
      }
      throw new Error(`Git merge failed: ${error instanceof Error ? error.message : String(error)}. Refresh project status before retrying.`);
    }
  }

  async conflicts(): Promise<string[]> {
    const changes = await this.status();
    return changes.filter((line) => /^(?:DD|AU|UD|UA|DU|AA|UU)/.test(line)).map((line) => safeDisplayText(line.slice(3).trim(), 4_096));
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
    const count = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.trunc(limit))) : 30;
    const format = "%H%x00%h%x00%an%x00%aI%x00%s";
    const output = await this.run(["log", "-z", `--max-count=${count}`, `--format=${format}`], { allowFailure: true });
    if (!output) return [];
    const fields = output.split("\0");
    if (fields.at(-1) === "") fields.pop();
    const versions: VersionEntry[] = [];
    for (let index = 0; index + 4 < fields.length; index += 5) {
      const [id = "", shortId = "", author = "", date = "", message = ""] = fields.slice(index, index + 5);
      if (!/^[a-f0-9]{40,64}$/i.test(id) || !/^[a-f0-9]{4,64}$/i.test(shortId)) continue;
      versions.push({
        id,
        shortId,
        author: safeDisplayText(author, 200),
        date: safeDisplayText(date, 64),
        message: safeDisplayText(message, 500) || "Untitled version"
      });
    }
    return versions;
  }

  async saveVersion(
    state: ProjectState,
    message: string,
    artifacts: { snapshotPath?: string; previewPath?: string } = {}
  ): Promise<string> {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || normalizedMessage.length > 500 || /[\0-\x1f\x7f]/.test(normalizedMessage)) throw new Error("A save-version message must be one line between 1 and 500 characters.");
    await this.assertRepository();
    return usingProjectLock(this.root, async () => {
      await recoverTransactions(this.root);
      const files = stateToFiles(state);
      const binaryFiles = new Map<string, string>();
      if (artifacts.snapshotPath) binaryFiles.set("snapshot/document.psd", resolve(artifacts.snapshotPath));
      if (artifacts.previewPath) binaryFiles.set(".photogit/previews/document.png", resolve(artifacts.previewPath));
      for (const source of binaryFiles.values()) {
        const sourceStat = await lstat(source);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > MAX_ARTIFACT_BYTES) throw new Error(`PhotoGit artifacts must be regular files no larger than 8 GB: ${source}`);
        await access(source, constants.R_OK);
      }
      if (artifacts.snapshotPath) {
        const source = resolve(artifacts.snapshotPath);
        assertPsdHeader(await readFileHeader(source), (await lstat(source)).size);
      }
      const alreadyStaged = await this.run(["diff", "--cached", "--name-only"]);
      if (alreadyStaged) throw new Error("The Git index already contains staged files. Commit or unstage them before saving a PhotoGit version.");
      await this.assertAuthorConfigured();
      return withFilesTransaction(this.root, files, binaryFiles, async (transactionPaths) => {
        const stagePaths = [...new Set([...transactionPaths, ".gitattributes", ".gitignore"])].sort();
        try {
          await this.runWithPathspec(["add"], stagePaths);
          const stagedNames = await this.run(["diff", "--cached", "--name-only"]);
          if (!stagedNames) throw new Error("There are no semantic changes to save.");
          await this.runWithPathspec(["commit", "-m", normalizedMessage], stagePaths);
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

  /** Read the immutable commit tree. Never use working metadata as a saved baseline. */
  async readStateAt(version = "HEAD"): Promise<ProjectState | null> {
    assertCommitIdentifier(version);
    const id = await this.run(["rev-parse", "--verify", `${version}^{commit}`], { allowFailure: true });
    if (!id) {
      if (version === "HEAD" && !(await this.history(1)).length) return null;
      throw new Error(`Version ${version} does not exist.`);
    }
    const tree = await this.run(["ls-tree", "-r", "-l", "-z", id, "--", ".photogit"]);
    const files = new Map<string, { id: string; bytes: number }>();
    let totalBytes = 0;
    for (const entry of tree.split("\0").filter(Boolean)) {
      const match = /^(\d+) blob ([a-f0-9]+)\s+(\d+)\t(.+)$/s.exec(entry);
      if (!match) continue;
      const path = match[4]!;
      if (!/^\.photogit\/(?:project\.json|document\.json|identities\.json|structure\/layers\.json|(?:appearance|text|content)\/[^/]+\.json)$/.test(path)) continue;
      assertManagedProjectPath(path);
      const bytes = Number(match[3]);
      if (match[1] !== "100644" && match[1] !== "100755") throw new Error(`Saved state contains an unsafe file: ${path}`);
      totalBytes += bytes;
      if (bytes > MAX_STATE_FILE_BYTES || totalBytes > MAX_STATE_BYTES) throw new Error("Saved PhotoGit metadata exceeds the supported size limit.");
      files.set(path, { id: match[2]!, bytes });
    }
    if (!files.has(".photogit/structure/layers.json")) {
      if (files.has(".photogit/document.json") || files.has(".photogit/identities.json")) throw new Error("Saved PhotoGit state is incomplete: structure is missing.");
      return null;
    }
    const values = await readGitJsonBatch(this.root, files);
    const required = <T>(path: string): T => {
      if (!values.has(path)) throw new Error(`Saved PhotoGit state is incomplete: ${path}`);
      return values.get(path) as T;
    };
    const state: ProjectState = {
      project: required(".photogit/project.json"), document: required(".photogit/document.json"),
      identities: required(".photogit/identities.json"), structure: required(".photogit/structure/layers.json"),
      appearance: {}, text: {}, content: {}
    };
    for (const [path, value] of values) {
      const domain = /^\.photogit\/(appearance|text|content)\/([^/]+)\.json$/.exec(path);
      if (domain) (state[domain[1] as "appearance" | "text" | "content"] as Record<string, unknown>)[domain[2]!] = value;
    }
    validateProjectState(state);
    return state;
  }

  async compareBranches(incoming: string, base?: string): Promise<BranchComparison> {
    assertBranchName(incoming);
    const baseBranch = base ?? await this.currentBranch();
    assertBranchName(baseBranch);
    const [baseId, incomingId] = await Promise.all([this.resolveVersion(baseBranch), this.resolveVersion(incoming)]);
    const mergeBase = await this.run(["merge-base", baseId, incomingId]);
    const [ahead, behind, files, merged] = await Promise.all([
      this.run(["rev-list", "--count", `${baseId}..${incomingId}`]),
      this.run(["rev-list", "--count", `${incomingId}..${baseId}`]),
      this.changedFiles(mergeBase, incomingId),
      this.previewGitMerge(baseId, incomingId)
    ]);
    const warnings = ["This is an ordinary Git merge. PhotoGit does not combine Photoshop layer edits into a new PSD."];
    let changes: SemanticChange[] = [];
    try {
      const [before, after] = await Promise.all([this.readStateAt(mergeBase), this.readStateAt(incomingId)]);
      if (before && after) changes = diffStates(before, after);
      else warnings.push("Semantic state is unavailable for one side of this comparison.");
    } catch { warnings.push("Saved layer metadata could not be read; inspect the file changes before proceeding."); }
    let gitMergeable = merged.clean;
    const baseFiles = await this.changedFiles(mergeBase, baseId);
    const incomingSnapshot = files.some((file) => file.path === "snapshot/document.psd");
    const baseSnapshot = baseFiles.some((file) => file.path === "snapshot/document.psd");
    const conflicts: string[] = [...merged.conflicts];
    if (incomingSnapshot && baseSnapshot) {
      const identical = !(await this.run(["diff", "--name-only", baseId, incomingId, "--", "snapshot/document.psd"]));
      if (!identical) { gitMergeable = false; conflicts.push("snapshot/document.psd"); warnings.push("Both branches changed the PSD. Resolve the document in Photoshop before merging."); }
    }
    const designPath = (path: string) => path === "snapshot/document.psd" || /^\.photogit\/(?:document\.json|identities\.json|structure\/|appearance\/|text\/|content\/)/.test(path);
    if (files.some(({ path }) => designPath(path)) && baseFiles.some(({ path }) => designPath(path))) {
      const differentDesign = await this.run(["diff", "--name-only", baseId, incomingId, "--", "snapshot/document.psd", ".photogit/document.json", ".photogit/identities.json", ".photogit/structure", ".photogit/appearance", ".photogit/text", ".photogit/content"]);
      if (differentDesign) {
        gitMergeable = false;
        if (!conflicts.length) conflicts.push("Both branches changed the Photoshop design");
        warnings.push("Combining independently edited layer metadata would not update the PSD. Open both documents in Photoshop and save the resolved design before using Git merge.");
      }
    }
    if (!gitMergeable && !conflicts.length) conflicts.push("Git reports overlapping or unsupported changes; inspect both branches in an external Git client.");
    return { baseBranch, incomingBranch: incoming, mergeBase, ahead: Number(ahead), behind: Number(behind), files, changes, gitMergeable, conflicts: [...new Set(conflicts)], warnings };
  }

  async versionDetails(version: string): Promise<VersionDetails> {
    const id = await this.resolveVersion(version);
    const [description, parent] = await Promise.all([
      this.run(["show", "-s", "--format=%H%x00%h%x00%an%x00%aI%x00%s", id]),
      this.run(["rev-list", "--parents", "-n", "1", id])
    ]);
    const [fullId = id, shortId = id.slice(0, 8), author = "", date = "", message = ""] = description.split("\0");
    const previous = parent.split(" ")[1];
    const files = await this.changedFiles(previous ?? null, id);
    const warnings: string[] = [];
    let changes: SemanticChange[] = [];
    try {
      const [before, after] = await Promise.all([previous ? this.readStateAt(previous) : Promise.resolve(null), this.readStateAt(id)]);
      if (before && after) changes = diffStates(before, after);
      else if (after) warnings.push(`First saved layer state: ${after.structure.layers.length} layers.`);
    } catch { warnings.push("Saved layer details are unavailable for this version."); }
    const snapshotAvailable = await this.validateSnapshotAt(id).then(() => true).catch(() => false);
    if (!snapshotAvailable) warnings.push("This version has no locally available valid PSD snapshot.");
    return { version: { id: fullId, shortId, author: safeDisplayText(author, 200), date: safeDisplayText(date, 64), message: safeDisplayText(message, 500) }, files, changes, snapshotAvailable, warnings };
  }

  async validateSnapshotAt(version: string): Promise<{ version: string; bytes: number }> {
    const source = await this.snapshotSource(version);
    const header = source.path ? await readFileHeader(source.path) : await readGitBlobPrefix(this.root, source.objectId!);
    assertPsdHeader(header, source.bytes);
    return { version: source.version, bytes: source.bytes };
  }

  /** Open recovery as a new copy. Never replace the working PSD or change HEAD. */
  async exportVersionSnapshot(version: string): Promise<string> {
    const source = await this.snapshotSource(version);
    const header = source.path ? await readFileHeader(source.path) : await readGitBlobPrefix(this.root, source.objectId!);
    assertPsdHeader(header, source.bytes);
    await ensureLine(join(this.root, ".gitignore"), ".photogit/recovered/");
    const directory = join(this.root, ".photogit", "recovered");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!await isWithinRealRoot(this.root, directory)) throw new Error("Recovery folder resolves outside the project.");
    const destination = join(directory, `version-${source.version.slice(0, 12)}-${randomUUID()}.psd`);
    const handle = await open(destination, "wx", 0o600);
    try {
      if (source.path) {
        const sourceHandle = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await handle.writeFile(createReadStream(source.path, { fd: sourceHandle.fd, autoClose: false })); }
        finally { await sourceHandle.close(); }
      } else {
        await spawnGitToFile(this.root, ["cat-file", "blob", source.objectId!], handle.fd);
      }
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    } finally { await handle.close().catch(() => undefined); }
    return destination;
  }

  private async snapshotSource(version: string): Promise<{ version: string; bytes: number; path?: string; objectId?: string }> {
    const id = await this.resolveVersion(version);
    const entry = await this.run(["ls-tree", "-l", id, "--", "snapshot/document.psd"]);
    const match = /^100(?:644|755) blob ([a-f0-9]+)\s+(\d+)\tsnapshot\/document.psd$/.exec(entry);
    if (!match) throw new Error("This version has no regular PSD snapshot. Choose a version saved with its document.");
    const objectId = match[1]!;
    const bytes = Number(match[2]);
    if (bytes > MAX_ARTIFACT_BYTES || bytes < 26) throw new Error("Snapshot size is invalid or exceeds 8 GB.");
    if (bytes <= 1024) {
      const blob = await this.run(["cat-file", "blob", objectId]);
      if (blob.startsWith("version https://git-lfs.github.com/spec/v1")) {
        const pointer = /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)$/.exec(blob);
        if (!pointer || Number(pointer[2]) > MAX_ARTIFACT_BYTES) throw new Error("Saved Git LFS pointer is invalid.");
        const oid = pointer[1]!;
        const gitDirectory = resolve(this.root, await this.run(["rev-parse", "--git-common-dir"]));
        const lfsDirectory = join(gitDirectory, "lfs", "objects");
        const path = join(lfsDirectory, oid.slice(0, 2), oid.slice(2, 4), oid);
        if (!await isWithinRealRoot(gitDirectory, path)) throw new Error("The PSD is not available locally. Run git lfs pull for this version and retry.");
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== Number(pointer[2])) throw new Error("Local Git LFS snapshot is missing or invalid.");
        const digest = createHash("sha256");
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { for await (const chunk of createReadStream(path, { fd: handle.fd, autoClose: false })) digest.update(chunk); }
        finally { await handle.close(); }
        if (digest.digest("hex") !== oid) throw new Error("Local Git LFS snapshot failed its integrity check.");
        return { version: id, bytes: metadata.size, path };
      }
    }
    return { version: id, bytes, objectId };
  }

  private async resolveVersion(version: string): Promise<string> {
    assertCommitIdentifier(version);
    return this.run(["rev-parse", "--verify", `${version}^{commit}`]);
  }

  private async previewGitMerge(base: string, incoming: string): Promise<{ clean: boolean; conflicts: string[] }> {
    try {
      await execFileAsync("git", ["merge-tree", "--write-tree", "--name-only", "-z", base, incoming], {
        cwd: this.root, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT, timeout: GIT_TIMEOUT_MS, killSignal: "SIGKILL", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      return { clean: true, conflicts: [] };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string };
      if (failed.code !== 1 || !failed.stdout) return { clean: false, conflicts: ["Git could not determine whether these branches merge cleanly"] };
      const fields = failed.stdout.split("\0");
      const conflicts: string[] = [];
      // With --name-only -z the first field is a tree ID, followed by conflict paths,
      // an empty separator, then diagnostic records (which are not filenames).
      for (const path of fields.slice(1)) { if (!path) break; conflicts.push(safeDisplayText(path, 4096)); }
      return { clean: false, conflicts };
    }
  }

  private async changedFiles(before: string | null, after: string): Promise<FileChange[]> {
    const output = before ? await this.run(["diff", "--no-renames", "--name-status", "-z", before, after, "--"]) : await this.run(["diff-tree", "--root", "--no-commit-id", "-r", "--no-renames", "--name-status", "-z", after]);
    const fields = output.split("\0").filter(Boolean);
    const files: FileChange[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) files.push({ status: fields[index]!, path: safeDisplayText(fields[index + 1]!, 4096) });
    return files;
  }

  private async reviewBranches(): Promise<BranchEntry[]> {
    const local = await this.branches();
    const names = new Set(local.map(({ name }) => name));
    const remote = await this.run(["for-each-ref", "--format=%(refname:short)", "refs/remotes"]);
    return [...local, ...remote.split("\n").filter((name) => name && !name.endsWith("/HEAD") && !names.has(name.slice(name.indexOf("/") + 1))).map((name) => ({ name, current: false }))];
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
    if (changes.length) throw new Error("The current design has unsaved project changes. Save a version before switching or getting updates.");
  }

  private async defaultBaseBranch(remote: string): Promise<string> {
    const configured = await this.run(["config", "photogit.baseBranch"], { allowFailure: true });
    if (configured) { assertBranchName(configured); await this.resolveVersion(configured); return configured; }
    const symbolic = await this.run(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], { allowFailure: true });
    if (symbolic.startsWith(`${remote}/`)) return symbolic.slice(remote.length + 1);
    const names = (await this.reviewBranches()).map((branch) => branch.name.startsWith(`${remote}/`) ? branch.name.slice(remote.length + 1) : branch.name);
    return names.includes("main") ? "main" : names.includes("master") ? "master" : names[0] || "main";
  }

  private async unstage(paths: string[]): Promise<void> {
    const hasHead = Boolean(await this.run(["rev-parse", "--verify", "HEAD"], { allowFailure: true }));
    if (hasHead) await this.runWithPathspec(["restore", "--staged"], paths, { allowFailure: true });
    else await this.runWithPathspec(["rm", "--cached", "-r", "--ignore-unmatch"], paths, { allowFailure: true });
  }

  private async runWithPathspec(args: readonly string[], paths: string[], options: { allowFailure?: boolean } = {}): Promise<string> {
    if (paths.length === 0) return this.run(args, options);
    for (const path of paths) assertSafeRelativePath(path);
    const pathspecRoot = join(this.root, ".photogit", "transactions");
    await mkdir(pathspecRoot, { recursive: true, mode: 0o700 });
    if (!await isWithinRealRoot(this.root, pathspecRoot)) throw new Error("The PhotoGit pathspec folder resolves outside the project.");
    await chmod(pathspecRoot, 0o700);
    const pathspecPath = join(pathspecRoot, `${randomUUID()}.pathspec`);
    try {
      await writeFile(pathspecPath, `${paths.join("\0")}\0`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return await this.run([...args, `--pathspec-from-file=${pathspecPath}`, "--pathspec-file-nul"], options);
    } finally {
      await unlink(pathspecPath).catch(() => undefined);
    }
  }
}

async function readGitJsonBatch(root: string, files: Map<string, { id: string; bytes: number }>): Promise<Map<string, unknown>> {
  const expected = [...files];
  const input = expected.map(([, file]) => file.id).join("\n") + "\n";
  const output = await new Promise<Buffer>((resolveOutput, reject) => {
    const process = spawn("git", ["cat-file", "--batch"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    const timer = setTimeout(() => { process.kill("SIGKILL"); reject(new Error("Reading saved layer state timed out.")); }, GIT_TIMEOUT_MS);
    process.on("error", (error) => { clearTimeout(timer); reject(error); });
    process.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_STATE_BYTES + expected.length * 100) { process.kill("SIGKILL"); reject(new Error("Saved layer state exceeds its size limit.")); }
      else chunks.push(chunk);
    });
    process.stderr.resume();
    process.on("close", (code) => { clearTimeout(timer); code === 0 ? resolveOutput(Buffer.concat(chunks)) : reject(new Error("Git could not read saved layer state.")); });
    process.stdin.on("error", () => undefined);
    process.stdin.end(input);
  });
  const values = new Map<string, unknown>();
  let offset = 0;
  for (const [path, file] of expected) {
    const end = output.indexOf(10, offset);
    if (end < offset || output.subarray(offset, end).toString() !== `${file.id} blob ${file.bytes}`) throw new Error("Saved state blob is missing or invalid.");
    offset = end + 1;
    values.set(path, JSON.parse(output.subarray(offset, offset + file.bytes).toString("utf8")));
    offset += file.bytes + 1;
  }
  return values;
}

async function readFileHeader(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const header = Buffer.alloc(26); await handle.read(header, 0, 26, 0); return header; }
  finally { await handle.close(); }
}

function assertPsdHeader(header: Buffer, bytes: number): void {
  const version = header.length >= 26 ? header.readUInt16BE(4) : 0;
  if (header.length < 26 || bytes < 26 || header.subarray(0, 4).toString() !== "8BPS" || ![1, 2].includes(version)
    || header.subarray(6, 12).some((value) => value !== 0) || header.readUInt16BE(12) < 1 || header.readUInt16BE(12) > 56
    || header.readUInt32BE(14) < 1 || header.readUInt32BE(18) < 1 || ![1, 8, 16, 32].includes(header.readUInt16BE(22))
    || header.readUInt16BE(24) > 9) throw new Error("The saved snapshot does not have a valid Photoshop PSD/PSB header. No branch changes were made.");
}

async function readGitBlobPrefix(root: string, id: string): Promise<Buffer> {
  return new Promise((resolvePrefix, reject) => {
    const child = spawn("git", ["cat-file", "blob", id], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Reading the snapshot timed out.")); }, GIT_TIMEOUT_MS);
    let prefix = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer) => {
      prefix = Buffer.concat([prefix, chunk.subarray(0, 26 - prefix.length)]);
      if (prefix.length === 26) { child.kill(); clearTimeout(timer); resolvePrefix(prefix); }
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", () => { clearTimeout(timer); resolvePrefix(prefix); });
  });
}

async function spawnGitToFile(root: string, args: string[], fd: number): Promise<void> {
  await new Promise<void>((resolveExport, reject) => {
    const child = spawn("git", args, { cwd: root, stdio: ["ignore", fd, "ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Exporting the saved PSD timed out; no working document was changed.")); }, GIT_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolveExport() : reject(new Error("Git could not export the saved PSD.")); });
  });

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
  const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readProjectFile(root, path)) as T;
  const structure = await readJson<ProjectState["structure"]>(".photogit/structure/layers.json");
  const rawLayers = (structure as unknown as { layers?: unknown }).layers;
  if (!Array.isArray(rawLayers)) throw new Error("Invalid PhotoGit structure: layers must be an array.");
  const uuids = rawLayers.map((layer) => {
    const uuid = layer && typeof layer === "object" && !Array.isArray(layer) ? (layer as { uuid?: unknown }).uuid : undefined;
    if (!isSafeLayerUuid(uuid)) throw new Error(`Unsafe layer UUID in project state: ${String(uuid)}`);
    return uuid;
  });
  const appearance = await readDomain<ProjectState["appearance"]>(root, ".photogit/appearance", uuids);
  const text = await readDomain<ProjectState["text"]>(root, ".photogit/text", uuids, true);
  const content = await readDomain<ProjectState["content"]>(root, ".photogit/content", uuids, true);
  const state: ProjectState = {
    project: await readJson(".photogit/project.json"),
    document: await readJson(".photogit/document.json"),
    identities: await readJson(".photogit/identities.json"),
    structure,
    appearance,
    text,
    content
  };
  validateProjectState(state);
  return state;
}

export function assertSafeRelativePath(path: string): void {
  const segments = path.split(/[\\/]+/);
  if (!path || path.length > 4_096 || isAbsolute(path) || /[\0-\x1f\x7f]/.test(path) || /[\\/]{2,}/.test(path) || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Unsafe project path: ${path}`);
  }
}

export function assertManagedProjectPath(path: string): void {
  assertSafeRelativePath(path);
  const exact = new Set([
    ".photogit/project.json",
    ".photogit/document.json",
    ".photogit/identities.json",
    ".photogit/structure/layers.json",
    ".photogit/previews/document.png",
    "snapshot/document.psd"
  ]);
  const domainFile = path.match(/^\.photogit\/(appearance|text|content|masks)\/([^/]+)\.json$/);
  if (exact.has(path) || (domainFile && isSafeLayerUuid(domainFile[2]))) return;
  throw new Error(`PhotoGit transactions cannot modify unmanaged project path: ${path}`);
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

function safeDisplayText(value: string, maximum: number): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length <= maximum ? sanitized : `${sanitized.slice(0, maximum - 1)}…`;
}

export function assertTagName(name: string): void {
  if (!/^(?![-.])(?!.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(name) || name.endsWith("/") || name.endsWith(".")) {
    throw new Error(`Invalid tag name: ${name}`);
  }
}

function githubRepositoryUrl(remoteUrl: string): string | null {
  const match = remoteUrl.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i)
    ?? remoteUrl.match(/^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i)
    ?? remoteUrl.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/i);
  if (match) {
    const [, owner = "", repository = ""] = match;
    return `https://github.com/${owner}/${repository.replace(/\.git$/i, "")}`;
  }
  return null;
}

function isLocalRemote(remoteUrl: string): boolean {
  return remoteUrl.startsWith("/") || remoteUrl.startsWith("file://") || /^[A-Za-z]:[\\/]/.test(remoteUrl);
}

export async function usingProjectLock<T>(root: string, action: () => Promise<T>, staleAfterMs = 5 * 60_000): Promise<T> {
  const metadataRoot = join(root, ".photogit");
  const lockPath = join(metadataRoot, "project.lock");
  await mkdir(metadataRoot, { recursive: true });
  if (!await isWithinRealRoot(root, metadataRoot)) throw new Error("The PhotoGit metadata folder resolves outside the project.");
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    const lockStat = await lstat(lockPath).catch(() => null);
    const recent = lockStat && Date.now() - lockStat.mtimeMs <= staleAfterMs;
    if (!lockStat || !lockStat.isFile() || lockStat.isSymbolicLink() || recent || await lockOwnerIsAlive(lockPath)) throw new Error("Another PhotoGit operation is already running for this project.");
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

async function lockOwnerIsAlive(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFileNoFollow(path, MAX_LOCK_BYTES)) as { pid?: unknown };
    if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0) return false;
    try {
      process.kill(value.pid as number, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  } catch {
    return false;
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
  action: (transactionPaths: string[]) => Promise<T>
): Promise<T> {
  for (const relativePath of [...files.keys(), ...binaryFiles.keys()]) assertManagedProjectPath(relativePath);
  for (const source of binaryFiles.values()) {
    const sourceStat = await lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > MAX_ARTIFACT_BYTES) throw new Error(`PhotoGit artifacts must be regular files no larger than 8 GB: ${source}`);
    await access(source, constants.R_OK);
  }
  const id = randomUUID();
  const metadataRoot = join(root, ".photogit");
  await mkdir(metadataRoot, { recursive: true });
  if (!await isWithinRealRoot(root, metadataRoot)) throw new Error("The PhotoGit metadata folder resolves outside the project.");
  const transactionsRoot = join(metadataRoot, "transactions");
  await mkdir(transactionsRoot, { recursive: true, mode: 0o700 });
  if (!await isWithinRealRoot(root, transactionsRoot)) throw new Error("The PhotoGit transaction folder resolves outside the project.");
  await chmod(transactionsRoot, 0o700);
  const transactionRoot = join(transactionsRoot, id);
  const payloadRoot = join(transactionRoot, "payload");
  const backupRoot = join(transactionRoot, "backup");
  const journalPath = join(transactionRoot, "journal.json");
  await mkdir(payloadRoot, { recursive: true, mode: 0o700 });
  await chmod(transactionRoot, 0o700);
  const journal: Journal = { id, phase: "prepared", applied: [], stale: [] };

  try {
    for (const [relativePath, source] of [...files, ...binaryFiles]) {
      const payloadPath = join(payloadRoot, relativePath);
      await mkdir(dirname(payloadPath), { recursive: true, mode: 0o700 });
      if (!await isWithinRealRoot(root, dirname(payloadPath))) throw new Error(`Unsafe transaction path: ${relativePath}`);
      if (binaryFiles.has(relativePath)) await copyFile(source, payloadPath, constants.COPYFILE_FICLONE);
      else await writeFile(payloadPath, source, { encoding: "utf8", flag: "wx" });
      await chmod(payloadPath, 0o600);
    }
    await writeJournal(journalPath, journal);
  } catch (error) {
    await rm(transactionRoot, { recursive: true, force: true });
    throw error;
  }

  try {
    journal.phase = "applying";
    await writeJournal(journalPath, journal);
    const desiredPaths = new Set([...files.keys(), ...binaryFiles.keys()]);
    const stale = await findStaleDomainFiles(root, desiredPaths);
    for (const relativePath of stale) {
      const destination = join(root, relativePath);
      const backup = join(backupRoot, relativePath);
      await mkdir(dirname(backup), { recursive: true });
      if (!await isWithinRealRoot(root, dirname(backup))) throw new Error(`Unsafe transaction backup path: ${relativePath}`);
      journal.stale.push(relativePath);
      await writeJournal(journalPath, journal);
      await rename(destination, backup);
    }
    for (const relativePath of [...desiredPaths].sort()) {
      const destination = join(root, relativePath);
      const backup = join(backupRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      if (!await isWithinRealRoot(root, dirname(destination))) throw new Error(`Unsafe project destination: ${relativePath}`);
      if (await exists(destination)) {
        const destinationStat = await lstat(destination);
        if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) throw new Error(`Refusing to replace unsafe project entry: ${relativePath}`);
        await mkdir(dirname(backup), { recursive: true });
        await copyFile(destination, backup, constants.COPYFILE_FICLONE);
        await chmod(backup, 0o600);
      }
      journal.applied.push(relativePath);
      await writeJournal(journalPath, journal);
      await rename(join(payloadRoot, relativePath), destination);
    }
    journal.phase = "committing";
    await writeJournal(journalPath, journal);
    const result = await action([...new Set([...desiredPaths, ...stale])].sort());
    journal.phase = "committed";
    await writeJournal(journalPath, journal);
    await rm(transactionRoot, { recursive: true, force: true });
    return result;
  } catch (error) {
    if (["committing", "committed"].includes(journal.phase) && await pathsMatchHead(root, [...journal.applied, ...journal.stale])) {
      journal.phase = "committed";
      await writeJournal(journalPath, journal).catch(() => undefined);
      await rm(transactionRoot, { recursive: true, force: true });
      throw error;
    }
    await rollback(root, transactionRoot, journal);
    throw error;
  }
}

export async function recoverTransactions(root: string): Promise<number> {
  const directory = join(root, ".photogit", "transactions");
  if (!await exists(directory)) return 0;
  if (!await isWithinRealRoot(root, directory)) throw new Error("The PhotoGit transaction folder resolves outside the project.");
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let recovered = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transactionRoot = join(directory, entry.name);
    const journal = await readFileNoFollow(join(transactionRoot, "journal.json"), MAX_TRANSACTION_JOURNAL_BYTES)
      .then((text) => parseJournal(JSON.parse(text), entry.name))
      .catch(() => null);
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

function parseJournal(value: unknown, directoryName: string): Journal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const journal = value as Partial<Journal>;
  if (journal.id !== directoryName || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(directoryName)) return null;
  if (!["prepared", "applying", "committing", "committed"].includes(String(journal.phase))) return null;
  if (!Array.isArray(journal.applied) || !Array.isArray(journal.stale)) return null;
  if (journal.applied.length + journal.stale.length > 250_000) return null;
  try {
    const seen = new Set<string>();
    for (const path of [...journal.applied, ...journal.stale]) {
      if (typeof path !== "string") return null;
      assertManagedProjectPath(path);
      if (seen.has(path)) return null;
      seen.add(path);
    }
  } catch {
    return null;
  }
  return journal as Journal;
}

async function pathsMatchHead(root: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false;
  try {
    for (let index = 0; index < paths.length; index += 500) {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...paths.slice(index, index + 500)], { cwd: root, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      if (stdout.length > 0) return false;
    }
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
    if (!await isWithinRealRoot(root, dirname(destination))) throw new Error(`Unsafe rollback destination: ${relativePath}`);
    if (await exists(backup)) await rename(backup, destination);
    else await rm(destination, { force: true });
  }
  for (const relativePath of [...journal.stale].reverse()) {
    const backup = join(backupRoot, relativePath);
    const destination = join(root, relativePath);
    if (await exists(backup)) {
      await mkdir(dirname(destination), { recursive: true });
      if (!await isWithinRealRoot(root, dirname(destination))) throw new Error(`Unsafe rollback destination: ${relativePath}`);
      await rename(backup, destination);
    }
  }
  await rm(transactionRoot, { recursive: true, force: true });
}

async function writeJournal(path: string, journal: Journal): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, canonicalJson(journal), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

async function readDomain<T extends Record<string, unknown>>(root: string, directory: string, uuids: string[], optional = false): Promise<T> {
  const result: Record<string, unknown> = {};
  for (const uuid of uuids) {
    try { result[uuid] = JSON.parse(await readProjectFile(root, `${directory}/${uuid}.json`)); }
    catch (error) {
      if (!optional || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return result as T;
}

async function readProjectFile(root: string, relativePath: string): Promise<string> {
  assertSafeRelativePath(relativePath);
  const path = join(root, relativePath);
  if (!await isWithinRealRoot(root, dirname(path))) throw new Error(`Unsafe project directory for ${relativePath}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > MAX_STATE_FILE_BYTES) throw new Error(`PhotoGit state file is invalid or too large: ${relativePath}`);
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

async function readFileNoFollow(path: string, maximum: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > maximum) throw new Error(`File is invalid or too large: ${path}`);
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

async function findStaleDomainFiles(root: string, desired: Set<string>): Promise<string[]> {
  const stale: string[] = [];
  for (const directory of [".photogit/appearance", ".photogit/text", ".photogit/content", ".photogit/masks"]) {
    const domainPath = join(root, directory);
    if (!await exists(domainPath)) continue;
    if (!await isWithinRealRoot(root, domainPath)) throw new Error(`Unsafe PhotoGit domain folder: ${directory}`);
    const entries = await readdir(domainPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = `${directory}/${entry.name}`;
      if (!desired.has(path)) stale.push(path);
    }
  }
  return stale.sort();
}

async function ensureLine(path: string, line: string): Promise<void> {
  const destinationStat = await lstat(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (destinationStat?.isSymbolicLink() || (destinationStat && !destinationStat.isFile())) throw new Error(`Refusing to update unsafe repository metadata file: ${path}`);
  if (destinationStat && destinationStat.size > MAX_REPOSITORY_METADATA_BYTES) throw new Error(`Repository metadata file is too large: ${path}`);
  const existing = destinationStat ? await readFileNoFollow(path, MAX_REPOSITORY_METADATA_BYTES) : "";
  if (existing.split(/\r?\n/).includes(line)) return;
  const suffix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${existing}${suffix}${line}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export async function isWithinRealRoot(root: string, candidate: string): Promise<boolean> {
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    return isWithinRoot(realRoot, realCandidate);
  } catch {
    return false;
  }
}
