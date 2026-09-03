#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat, statfs, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { diffStates } from "@photogit/differ";
import { findProjectRoot, GitRepository, readProjectState, recoverTransactions } from "@photogit/git-engine";
import { SCHEMA_VERSION, validateProjectState, type DocumentCapture, type ProjectMetadata, type ProjectState } from "@photogit/schema";
import { canonicalJson, stateFromCapture } from "@photogit/serializer";

const execFileAsync = promisify(execFile);
const [, , command = "help", ...args] = process.argv;

try {
  switch (command) {
    case "init": await initCommand(args); break;
    case "doctor": await doctorCommand(args); break;
    case "status": await statusCommand(); break;
    case "save": await saveCommand(args); break;
    case "diff": await diffCommand(args); break;
    case "log": await logCommand(args); break;
    case "help": case "--help": case "-h": printHelp(); break;
    default: throw new Error(`Unknown command “${command}”. Run photogit help.`);
  }
} catch (error) {
  process.stderr.write(`PhotoGit: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function initCommand(args: string[]): Promise<void> {
  const requested = args.find((arg) => !arg.startsWith("-")) ?? ".";
  const root = resolve(requested);
  const repository = new GitRepository(root);
  await repository.initialize();
  await mkdir(join(root, ".photogit", "transactions"), { recursive: true });
  const projectPath = join(root, ".photogit", "project.json");
  if (!(await exists(projectPath))) {
    const project: ProjectMetadata = { schemaVersion: SCHEMA_VERSION, projectId: randomUUID(), displayName: basename(root), createdWith: "photogit/0.1.0" };
    await writeFile(projectPath, canonicalJson(project), { encoding: "utf8", flag: "wx" });
  }
  process.stdout.write(`Started PhotoGit project “${basename(root)}”.\nNext: capture a document from the Photoshop panel, or run photogit save --capture capture.json -m "First version".\n`);
}

async function statusCommand(): Promise<void> {
  const root = await findProjectRoot();
  const repository = new GitRepository(root);
  const recovered = await recoverTransactions(root);
  const [branch, changes] = await Promise.all([repository.currentBranch(), repository.status()]);
  process.stdout.write(`Project: ${basename(root)}\nBranch: ${branch}\n`);
  if (recovered) process.stdout.write(`Recovered ${recovered} interrupted transaction(s).\n`);
  process.stdout.write(changes.length ? `Current design has ${changes.length} file change(s):\n${changes.map((line) => `  ${line}`).join("\n")}\n` : "Current design matches the latest saved version.\n");
}

async function saveCommand(args: string[]): Promise<void> {
  const message = option(args, "-m", "--message");
  const capturePath = option(args, "--capture") ?? ".photogit/capture.json";
  const snapshotPath = option(args, "--snapshot");
  if (!message) throw new Error('Save a version with -m "What changed".');
  const root = await findProjectRoot();
  const capture = JSON.parse(await readFile(resolve(root, capturePath), "utf8")) as DocumentCapture;
  const project = JSON.parse(await readFile(join(root, ".photogit", "project.json"), "utf8")) as ProjectMetadata;
  const previousIdentities = await readFile(join(root, ".photogit", "identities.json"), "utf8").then((text) => (JSON.parse(text) as ProjectState["identities"]).records).catch(() => []);
  const state = stateFromCapture(capture, project, randomUUID, previousIdentities);
  const id = await new GitRepository(root).saveVersion(state, message, snapshotPath ? { snapshotPath: resolve(root, snapshotPath) } : {});
  process.stdout.write(`Saved version ${id.slice(0, 8)} — ${message}\n`);
}

async function diffCommand(args: string[]): Promise<void> {
  const capturePath = option(args, "--capture");
  if (!capturePath) {
    const root = await findProjectRoot();
    const changes = await new GitRepository(root).status();
    process.stdout.write(changes.length ? `${changes.join("\n")}\n` : "No changes in the current design. Use --capture to compare a fresh Photoshop scan.\n");
    return;
  }
  const root = await findProjectRoot();
  const base = await readProjectState(root);
  validateProjectState(base);
  const capture = JSON.parse(await readFile(resolve(root, capturePath), "utf8")) as DocumentCapture;
  const current = stateFromCapture(capture, base.project, randomUUID, base.identities.records);
  const changes = diffStates(base, current);
  process.stdout.write(changes.length ? `${changes.map((change) => `- ${change.summary}`).join("\n")}\n` : "No layer changes detected.\n");
}

async function logCommand(args: string[]): Promise<void> {
  const root = await findProjectRoot();
  const limitText = option(args, "-n", "--limit");
  const limit = limitText ? Number.parseInt(limitText, 10) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("History limit must be between 1 and 500.");
  const versions = await new GitRepository(root).history(limit);
  process.stdout.write(versions.length ? `${versions.map((version) => `${version.shortId}  ${version.date.slice(0, 10)}  ${version.author}  ${version.message}`).join("\n")}\n` : "No saved versions yet.\n");
}

async function doctorCommand(args: string[]): Promise<void> {
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
  for (const [name, ok, detail] of checks) process.stdout.write(`${ok ? "✓" : "!"} ${name}: ${detail}\n`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

function printHelp(): void {
  process.stdout.write(`PhotoGit — semantic version control for Photoshop\n\nCommands:\n  init [directory]          Start tracking a project\n  doctor [directory]        Diagnose the local setup\n  status                    Show current project status\n  save -m MESSAGE [--capture FILE] [--snapshot PSD]\n  diff [--capture FILE]     Show semantic layer changes\n  log [-n COUNT]            Show saved versions\n`);
}

function option(args: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index >= 0) {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`${name} requires a value.`);
      return value;
    }
  }
  return undefined;
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

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
