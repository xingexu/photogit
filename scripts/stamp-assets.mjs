// Stamp every ?v= asset reference in the panel and demo with one shared build id,
// so the two documents can never drift apart and serve stale CSS or scripts.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["apps/photoshop-plugin/index.html", "apps/photoshop-plugin/demo.html"];
const explicit = process.argv[2];
if (explicit !== undefined && !/^\d+$/.test(explicit)) throw new Error("Pass a numeric build id, or none to take the next one.");

let highest = 0;
const sources = [];
for (const file of files) {
  const text = await readFile(join(root, file), "utf8");
  sources.push([file, text]);
  for (const match of text.matchAll(/\?v=(\d+)/g)) highest = Math.max(highest, Number(match[1]));
}
const next = explicit ?? String(highest + 1);
for (const [file, text] of sources) {
  const stamped = text.replace(/\?v=\d+/g, `?v=${next}`);
  if (stamped !== text) await writeFile(join(root, file), stamped);
}
console.log(`Stamped panel and demo assets at v=${next}.`);
