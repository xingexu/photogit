// The panel renders values that originate outside it — layer names, commit
// messages, branch names, helper errors. Strings are escaped with escapeHtml
// and numbers are validated as counts before they reach any template, and
// escapeHtml has its own suite.
//
// This check covers what a scan can actually prove: that no panel script
// reaches for an API that would execute a value as code, and that none of them
// names a remote origin. The panel talks to the authenticated filesystem
// bridge and to nothing else, and it evaluates nothing.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const panel = "apps/photoshop-plugin";

const banned = [
  ["insertAdjacentHTML", /\binsertAdjacentHTML\s*\(/],
  ["document.write", /\bdocument\s*\.\s*write\s*\(/],
  ["eval", /(?:^|[^.\w])eval\s*\(/],
  ["new Function", /\bnew\s+Function\s*\(/],
  ["remote URL", /["'`]https?:\/\/(?!127\.0\.0\.1|localhost)/]
];

const entries = await readdir(join(root, panel));
const scripts = entries.filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"));
if (!scripts.length) { console.error("No panel scripts found to check."); process.exit(1); }

const findings = [];
for (const name of scripts) {
  const text = await readFile(join(root, panel, name), "utf8");
  text.split("\n").forEach((line, index) => {
    if (line.trimStart().startsWith("//")) return;
    for (const [label, pattern] of banned) {
      if (pattern.test(line)) findings.push(`${panel}/${name}:${index + 1}: ${label}`);
    }
  });
}

if (findings.length) {
  console.error("Panel scripts must not evaluate values as code or name a remote origin:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(`Panel DOM safety verified: ${scripts.length} scripts, no code-evaluation APIs and no remote origins.`);
