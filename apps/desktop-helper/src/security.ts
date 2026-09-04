import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { PROTOCOL_VERSION } from "@photogit/protocol";

export type HelperConfig = { protocolVersion: 1; token: string; approvedRoots: string[] };
export type PublicRepositoryInfo = { provider: "github" | "local" | "other"; currentBranch: string; baseBranch: string; remoteConfigured: boolean };

export function isLoopbackHost(host: string | undefined, port: number): boolean {
  const normalized = host?.toLowerCase();
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`;
}

export function assertHelperArguments(args: string[]): void {
  let sawPort = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (!["--port", "--approve-root"].includes(option)) throw new Error(`Unknown helper option: ${option}`);
    if (option === "--port" && sawPort) throw new Error("Duplicate helper option: --port");
    if (option === "--port") sawPort = true;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
    index += 1;
  }
}

export function parseHelperConfig(value: unknown): HelperConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid helper configuration.");
  const candidate = value as Partial<HelperConfig>;
  if (Object.keys(candidate).some((key) => !["protocolVersion", "token", "approvedRoots"].includes(key))) throw new Error("Invalid helper configuration.");
  if (candidate.protocolVersion !== PROTOCOL_VERSION || typeof candidate.token !== "string" || !/^[A-Za-z0-9_-]{32,200}$/.test(candidate.token)) throw new Error("Invalid helper configuration.");
  if (!Array.isArray(candidate.approvedRoots) || candidate.approvedRoots.length > 256 || candidate.approvedRoots.some((root) => typeof root !== "string" || !root || root.length > 4_096 || /[\0-\x1f\x7f]/.test(root) || !isAbsolute(root))) throw new Error("Invalid helper configuration.");
  return { protocolVersion: PROTOCOL_VERSION, token: candidate.token, approvedRoots: [...new Set(candidate.approvedRoots.map((root) => resolve(root)))].sort() };
}

export function publicRepositoryInfo(info: { provider: PublicRepositoryInfo["provider"]; currentBranch: string; baseBranch: string; remoteUrl: string | null }): PublicRepositoryInfo {
  return { provider: info.provider, currentBranch: info.currentBranch, baseBranch: info.baseBranch, remoteConfigured: info.remoteUrl !== null };
}

export function safeErrorText(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : "Unexpected helper error.";
  for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
  const safe = message
    .replace(/\b(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[redacted]@")
    .replace(/([?&](?:access_token|token|auth|authorization|password|secret|key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Unexpected helper error.";
  return safe.length > 2_000 ? `${safe.slice(0, 1_997)}…` : safe;
}

export async function secureWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
