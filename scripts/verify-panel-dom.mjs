// The panel renders values that originate outside it — layer names, commit
// messages, branch names, helper errors. It builds every one of them with
// createElement and textContent. This check fails the build if any panel
// script reaches for an API that would interpret those values as markup or as
// code, so the property is enforced rather than merely observed in review.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const panel = "apps/photoshop-plugin";

const banned = [
  ["innerHTML", /\.innerHTML\s*=/],
  ["outerHTML", /\.outerHTML\s*=/],
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
  console.error("Panel scripts must build the DOM from createElement and textContent only:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(`Panel DOM safety verified: ${scripts.length} scripts, no markup, code-evaluation, or remote-URL APIs.`);
