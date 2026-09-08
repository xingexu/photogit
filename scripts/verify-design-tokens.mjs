// Fails when a design token is declared but never referenced, so the token
// block stays an accurate description of the system rather than a wish list.
// Declarations share lines in the token block, so the scan must not anchor.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const stylesheet = "apps/photoshop-plugin/styles.css";
const consumers = [
  stylesheet, "apps/photoshop-plugin/demo.css", "apps/photoshop-plugin/index.js",
  "apps/photoshop-plugin/motion.js", "apps/photoshop-plugin/depth.js", "apps/photoshop-plugin/counter.js", "apps/photoshop-plugin/reveal.js", "apps/photoshop-plugin/demo.js", "apps/photoshop-plugin/appearance.js",
  "apps/photoshop-plugin/branch-view.js", "apps/photoshop-plugin/version-inspector.js",
  "apps/photoshop-plugin/review-inspector.js"
];

const css = await readFile(join(root, stylesheet), "utf8");
const declared = new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((match) => match[1]));

const referenced = new Set();
for (const file of consumers) {
  const text = await readFile(join(root, file), "utf8");
  for (const match of text.matchAll(/var\(\s*--([a-z0-9-]+)/g)) referenced.add(match[1]);
  // Tokens can also be read through getPropertyValue in the panel scripts.
  if (file.endsWith(".js")) for (const match of text.matchAll(/["'`]--([a-z0-9-]+)["'`]/g)) referenced.add(match[1]);
}

const unused = [...declared].filter((token) => !referenced.has(token)).sort();
if (unused.length) {
  console.error(`Unused design tokens: ${unused.join(", ")}`);
  console.error("Use them or remove them; a declared token should describe the system.");
  process.exit(1);
}
console.log(`Design tokens verified: ${declared.size} declared, all referenced.`);
