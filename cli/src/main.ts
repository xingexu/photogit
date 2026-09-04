#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, stat, statfs, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { diffStates } from "@photogit/differ";
import { findProjectRoot, GitRepository, isWithinRealRoot, readProjectState, recoverTransactions } from "@photogit/git-engine";
import { SCHEMA_VERSION, validateDocumentCapture, validateProjectMetadata, validateProjectState, type DocumentCapture, type ProjectMetadata, type ProjectState } from "@photogit/schema";
import { canonicalJson, stateFromCapture } from "@photogit/serializer";

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const [, , command = "help", ...args] = process.argv;

try {
  switch (command) {
    case "init": await initCommand(args); break;
    case "doctor": await doctorCommand(args); break;
    case "status": await statusCommand(args); break;
    case "save": await saveCommand(args); break;
    case "diff": await diffCommand(args); break;
    case "log": await logCommand(args); break;
    case "help": case "--help": case "-h": printHelp(); break;
    default: throw new Error(`Unknown command “${command}”. Run photogit help.`);
  }
} catch (error) {
  process.stderr.write(`PhotoGit: ${terminalText(error instanceof Error ? error.message : String(error), 2_000)}\n`);
  process.exitCode = 1;
}

async function initCommand(args: string[]): Promise<void> {
  assertArguments(args, [], 1);
  const requested = args.find((arg) => !arg.startsWith("-")) ?? ".";
  const root = resolve(requested);
  const repository = new GitRepository(root);
  await repository.initialize();
  const metadataRoot = join(root, ".photogit");
  await mkdir(metadataRoot, { recursive: true });
  if (!await isWithinRealRoot(root, metadataRoot)) throw new Error("The PhotoGit metadata folder resolves outside the project.");
  const transactionsRoot = join(metadataRoot, "transactions");
  await mkdir(transactionsRoot, { recursive: true });
  if (!await isWithinRealRoot(root, transactionsRoot)) throw new Error("The PhotoGit transaction folder resolves outside the project.");
  const projectPath = join(metadataRoot, "project.json");
  const projectStat = await lstat(projectPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (projectStat?.isSymbolicLink() || (projectStat && !projectStat.isFile())) throw new Error("The PhotoGit project metadata file is unsafe.");
  if (!projectStat) {
    const project: ProjectMetadata = { schemaVersion: SCHEMA_VERSION, projectId: randomUUID(), displayName: basename(root), createdWith: "photogit/0.1.0" };
    await writeFile(projectPath, canonicalJson(project), { encoding: "utf8", flag: "wx" });
  } else {
    validateProjectMetadata(await readBoundedJson<ProjectMetadata>(projectPath));
  }
  process.stdout.write(`Started PhotoGit project “${terminalText(basename(root), 1_024)}”.\nNext: capture a document from the Photoshop panel, or run photogit save --capture capture.json -m "First version".\n`);
}

async function statusCommand(args: string[]): Promise<void> {
  assertArguments(args, [], 0);
  const root = await findProjectRoot();
  const repository = new GitRepository(root);
  const recovered = await recoverTransactions(root);
  const [branch, changes] = await Promise.all([repository.currentBranch(), repository.status()]);
  process.stdout.write(`Project: ${terminalText(basename(root), 1_024)}\nBranch: ${terminalText(branch, 200)}\n`);
  if (recovered) process.stdout.write(`Recovered ${recovered} interrupted transaction(s).\n`);
  process.stdout.write(changes.length ? `Current design has ${changes.length} file change(s):\n${changes.map((line) => `  ${terminalText(line, 4_096)}`).join("\n")}\n` : "Current design matches the latest saved version.\n");
}

async function saveCommand(args: string[]): Promise<void> {
  assertArguments(args, ["-m", "--message", "--capture", "--snapshot"], 0);
  const message = option(args, "-m", "--message");
  const capturePath = option(args, "--capture") ?? ".photogit/capture.json";
  const snapshotPath = option(args, "--snapshot");
  if (!message) throw new Error('Save a version with -m "What changed".');
  const root = await findProjectRoot();
  const capture = await readBoundedJson<DocumentCapture>(resolve(root, capturePath));
  validateDocumentCapture(capture);
  const project = await readBoundedJson<ProjectMetadata>(join(root, ".photogit", "project.json"));
  validateProjectMetadata(project);
  const previousIdentities = await readBoundedJson<ProjectState["identities"]>(join(root, ".photogit", "identities.json"))
    .then((identities) => identities.records)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
  const state = stateFromCapture(capture, project, randomUUID, previousIdentities);
  const id = await new GitRepository(root).saveVersion(state, message, snapshotPath ? { snapshotPath: resolve(root, snapshotPath) } : {});
  process.stdout.write(`Saved version ${id.slice(0, 8)} — ${terminalText(message, 500)}\n`);
}

async function diffCommand(args: string[]): Promise<void> {
  assertArguments(args, ["--capture"], 0);
  const capturePath = option(args, "--capture");
  if (!capturePath) {
    const root = await findProjectRoot();
    const changes = await new GitRepository(root).status();
    process.stdout.write(changes.length ? `${changes.map((line) => terminalText(line, 4_096)).join("\n")}\n` : "No changes in the current design. Use --capture to compare a fresh Photoshop scan.\n");
    return;
  }
  const root = await findProjectRoot();
  const base = await readProjectState(root);
  validateProjectState(base);
  const capture = await readBoundedJson<DocumentCapture>(resolve(root, capturePath));
  validateDocumentCapture(capture);
  const current = stateFromCapture(capture, base.project, randomUUID, base.identities.records);
  const changes = diffStates(base, current);
  process.stdout.write(changes.length ? `${changes.map((change) => `- ${change.summary}`).join("\n")}\n` : "No layer changes detected.\n");
}

async function logCommand(args: string[]): Promise<void> {
  assertArguments(args, ["-n", "--limit"], 0);
  const root = await findProjectRoot();
  const limitText = option(args, "-n", "--limit");
  const limit = limitText ? Number.parseInt(limitText, 10) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("History limit must be between 1 and 500.");
  const versions = await new GitRepository(root).history(limit);
  process.stdout.write(versions.length ? `${versions.map((version) => `${terminalText(version.shortId, 64)}  ${terminalText(version.date.slice(0, 10), 10)}  ${terminalText(version.author, 120)}  ${terminalText(version.message, 500)}`).join("\n")}\n` : "No saved versions yet.\n");
}

async function doctorCommand(args: string[]): Promise<void> {
  assertArguments(args, [], 1);
  const requested = args.find((arg) => !arg.startsWith("-"));
  const checks: Array<[string, boolean, string]> = [];
  const git = await commandVersion("git", ["--version"]); checks.push(["Git", git.ok, git.detail]);
  const lfs = await commandVersion("git", ["lfs", "version"]); checks.push(["Git LFS", lfs.ok, lfs.detail || "not installed (required before sharing PSD snapshots)"]);
  const photoshopCandidates = [join(homedir(), "Applications", "Adobe Photoshop 2026"), "/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app", "/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app"];
  const photoshop = await firstExisting(photoshopCandidates); checks.push(["Photoshop", Boolean(photoshop), photoshop ?? "Photoshop 2025/2026 not found in standard macOS locations"]);
  const developerTool = await firstExisting([
    "/Applications/Adobe UXP Developer Tools/Adobe UXP Developer Tools.app",
    "/Applications/UXP Developer Tool.app",
    join(homedir(), "Applications", "Adobe UXP Developer Tools.app"),
    join(homedir(), "Applications", "UXP Developer Tool.app")
  ]);
  checks.push(["UXP Developer Tools", Boolean(developerTool), developerTool ?? "not found; install it before loading the panel"]);
  const helper = await helperHealth();
  checks.push(["Helper", helper.ok, helper.detail]);
  if (requested || await findProjectRoot().then(() => true).catch(() => false)) {
    const root = requested ? resolve(requested) : await findProjectRoot();
    const repository = new GitRepository(root);
    const valid = await repository.assertRepository().then(() => true).catch(() => false);
    checks.push(["Project", valid, valid ? root : "not a valid Git-backed PhotoGit project"]);
    const disk = await stat(root); checks.push(["Permissions", Boolean(disk.mode & 0o200), Boolean(disk.mode & 0o200) ? "project root is writable" : "project root is not writable"]);
    const fileSystem = await statfs(root);
    const freeBytes = fileSystem.bavail * fileSystem.bsize;
    checks.push(["Disk space", freeBytes >= 5 * 1024 ** 3, `${(freeBytes / 1024 ** 3).toFixed(1)} GB available${freeBytes < 5 * 1024 ** 3 ? "; at least 5 GB recommended" : ""}`]);
    const remotes = valid ? await repository.run(["remote"]) : "";
    checks.push(["Shared project", true, remotes ? `configured remote(s): ${remotes.split("\n").join(", ")}` : "no remote configured"]);
  }
  for (const [name, ok, detail] of checks) process.stdout.write(`${ok ? "✓" : "!"} ${terminalText(name, 120)}: ${terminalText(detail, 4_096)}\n`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

function printHelp(): void {
  process.stdout.write(`PhotoGit — semantic version control for Photoshop\n\nCommands:\n  init [directory]          Start tracking a project\n  doctor [directory]        Diagnose the local setup\n  status                    Show current project status\n  save -m MESSAGE [--capture FILE] [--snapshot PSD]\n  diff [--capture FILE]     Show semantic layer changes\n  log [-n COUNT]            Show saved versions\n`);
}

function option(args: string[], ...names: string[]): string | undefined {
  const matches = names.map((name) => ({ name, index: args.indexOf(name) })).filter(({ index }) => index >= 0);
  if (matches.length > 1) throw new Error(`Use only one of ${names.join(" or ")}.`);
  const match = matches[0];
  if (match) {
    const value = args[match.index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${match.name} requires a value.`);
    return value;
  }
  return undefined;
}

function assertArguments(args: string[], valueOptions: string[], maximumPositionals: number): void {
  let positionals = 0;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("-")) {
      positionals += 1;
      if (positionals > maximumPositionals) throw new Error(`Unexpected argument: ${argument}`);
      continue;
    }
    if (!valueOptions.includes(argument)) throw new Error(`Unknown option: ${argument}`);
    if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`);
    seen.add(argument);
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${argument} requires a value.`);
    index += 1;
  }
}

async function commandVersion(command: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  try { const { stdout } = await execFileAsync(command, args, { encoding: "utf8" }); return { ok: true, detail: stdout.trim() }; }
  catch { return { ok: false, detail: "" }; }
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) if (await exists(path)) return path;
  return null;
}

async function helperHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch("http://127.0.0.1:54738/v1/health", { signal: AbortSignal.timeout(1_000) });
    const body = await response.json() as { protocolVersion?: number };
    if (!response.ok) return { ok: false, detail: `responded with HTTP ${response.status}` };
    if (body.protocolVersion !== 1) return { ok: false, detail: `protocol mismatch: helper=${String(body.protocolVersion)}, CLI=1` };
    return { ok: true, detail: "connected on 127.0.0.1:54738 (protocol 1)" };
  } catch {
    return { ok: false, detail: "offline; run npm run helper -- --approve-root /path/to/project" };
  }
}

async function readBoundedJson<T>(path: string): Promise<T> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_INPUT_BYTES) throw new Error(`Input file is invalid or exceeds ${MAX_INPUT_BYTES / 1024 / 1024} MB: ${path}`);
    return JSON.parse(await handle.readFile({ encoding: "utf8" })) as T;
  } finally {
    await handle.close();
  }
}

function terminalText(value: string, maximum: number): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return sanitized.length <= maximum ? sanitized : `${sanitized.slice(0, maximum - 1)}…`;
}

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
