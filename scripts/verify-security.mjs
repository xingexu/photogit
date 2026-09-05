import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Deliberately print locations and rule names only, never matching values.
const root = fileURLToPath(new URL("../", import.meta.url));
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))];
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["credential URL", /https?:\/\/[^\s/@"'<>:]+:[^\s/@"'<>]+@[^\s/"'<>]+/g]
];
const findings = [];
let scanned = 0;
let binary = 0;
for (const file of files) {
  const path = resolve(root, file);
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  if (!stat.isFile()) continue;
  if (/(^|\/)(?:\.env(?:\.[^/]+)?|[^/]+\.(?:pem|p12|pfx))$/.test(file) && !file.endsWith(".example")) {
    findings.push(`${file}: sensitive file must not be included`);
  }
  if (/(^|\/)\.photogit\/(?:helper\.json|bridge\/|incoming\/)/.test(file) || file === ".demo-helper.json") {
    findings.push(`${file}: local PhotoGit pairing or working data must not be included`);
  }
  const data = await readFile(path);
  if (data.includes(0)) { binary++; continue; }
  const text = data.toString("utf8");
  scanned++;
  for (const [name, pattern] of rules) {
    // Synthetic attack URLs exercise credential redaction; never whitelist tokens or keys.
    if (name === "credential URL" && /(?:\.test\.[cm]?[jt]s|\/test-fixtures\/)/.test(file)) continue;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line}: ${name}`);
    }
  }
}
if (findings.length) {
  console.error(`Security inventory found ${findings.length} potential issue(s):\n${findings.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Security inventory passed: ${scanned} text files checked; ${binary} binary files excluded. No values printed. Git history and unknown secret formats are not scanned.`);
}
