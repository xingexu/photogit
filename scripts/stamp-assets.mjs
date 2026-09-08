// Stamp every ?v= asset reference in the panel and demo with one shared build id,
// so the two documents can never drift apart and serve stale CSS or scripts.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["apps/photoshop-plugin/index.html", "apps/photoshop-plugin/demo.html"];
const verify = process.argv.includes("--verify");
const explicit = verify ? undefined : process.argv[2];
if (explicit !== undefined && !/^\d+$/.test(explicit)) throw new Error("Pass a numeric build id, or none to take the next one.");

let highest = 0;
const sources = [];
for (const file of files) {
  const text = await readFile(join(root, file), "utf8");
  sources.push([file, text]);
  for (const match of text.matchAll(/\?v=(\d+)/g)) highest = Math.max(highest, Number(match[1]));
}
if (verify) {
  // Every reference in both documents must carry the same build id. When they
  // drift, one document keeps requesting an old asset and the browser serves it
  // from cache, so changes appear not to have been applied.
  const stamps = new Map();
  for (const [file, text] of sources) {
    for (const match of text.matchAll(/([\w.-]+)\?v=(\d+)/g)) {
      const key = `${file} -> ${match[1]}`;
      stamps.set(key, match[2]);
    }
  }
  const ids = new Set(stamps.values());
  if (ids.size > 1) {
    console.error("Panel and demo asset versions have drifted:");
    for (const [where, id] of stamps) console.error(`  v=${id}  ${where}`);
    console.error("Run `node scripts/stamp-assets.mjs` to bring them back into step.");
    process.exit(1);
  }
  console.log(`Asset versions verified: ${stamps.size} references, all at v=${[...ids][0] ?? "none"}.`);
} else {
  const next = explicit ?? String(highest + 1);
  for (const [file, text] of sources) {
    const stamped = text.replace(/\?v=\d+/g, `?v=${next}`);
    if (stamped !== text) await writeFile(join(root, file), stamped);
  }
  console.log(`Stamped panel and demo assets at v=${next}.`);
}
