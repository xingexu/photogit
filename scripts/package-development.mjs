import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const plugin = join(root, "apps/photoshop-plugin");
const parse = async (path) => JSON.parse(await readFile(path, "utf8"));
const product = await parse(join(root, "package.json"));
const lock = await parse(join(root, "package-lock.json"));
const manifest = await parse(join(plugin, "manifest.json"));
assert.match(product.version, /^\d+\.\d+\.\d+$/, "The development product version must be numeric for UXP.");
assert.equal(lock.version, product.version, "Lockfile root version mismatch");
assert.equal(manifest.version, product.version, "Manifest version mismatch");
assert.equal(manifest.id, "com.photogit.development", "This command produces development packages only.");
assert.equal(manifest.manifestVersion, 5);
assert.equal(manifest.host.app, "PS");
assert.equal(manifest.requiredPermissions.localFileSystem, "request");
assert.equal(manifest.requiredPermissions.network, undefined, "The panel must use the authenticated filesystem bridge.");
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path.startsWith("node_modules/")) continue;
  const pkg = await parse(join(root, path, "package.json"));
  assert.equal(pkg.version, product.version, `${path || "root"}: package version mismatch`);
  assert.equal(entry.version, product.version, `${path || "root"}: lockfile version mismatch`);
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (name.startsWith("@photogit/")) {
      assert.equal(version, product.version, `${path}: workspace dependency ${name} has a different version`);
      assert.equal(entry.dependencies?.[name], version, `${path}: lockfile dependency ${name} is stale`);
    }
  }
}

const files = new Set();
const pluginReal = await realpath(plugin);
async function include(path) {
  const local = relative(plugin, resolve(plugin, path));
  assert(local && local !== ".." && !local.startsWith(`..${sep}`) && !local.startsWith(sep), `Asset escapes plugin: ${path}`);
  const target = join(plugin, local);
  const actual = await realpath(target);
  const stat = await lstat(target);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Asset is not a regular file: ${local}`);
  assert(actual.startsWith(pluginReal + sep), `Asset resolves outside plugin: ${local}`);
  if (files.has(local)) return;
  files.add(local);
  if (![".js", ".css", ".html"].includes(extname(local))) return;
  const contents = await readFile(target, "utf8");
  const references = [];
  for (const match of contents.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) references.push(match[1]);
  for (const match of contents.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) references.push(match[1]);
  for (const match of contents.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) references.push(match[1]);
  for (const ref of references) {
    if (/^(?:https?:|data:|#|\$|\{)/.test(ref)) continue;
    assert(!ref.startsWith("/"), `Plugin asset must be relative: ${ref}`);
    let dependency = join(dirname(local), ref.split(/[?#]/)[0]);
    if (!extname(dependency)) dependency += ".js";
    await include(dependency);
  }
}
await include("manifest.json");
await include("package.json");
await include(manifest.main);
for (const icon of [...(manifest.icons ?? []), ...manifest.entrypoints.flatMap((entry) => entry.icons ?? [])]) {
  await include(icon.path);
  const extension = extname(icon.path);
  for (const scale of icon.scale ?? [1]) {
    const variant = `${icon.path.slice(0, -extension.length)}@${scale}x${extension}`;
    await include(variant);
  }
}
const ordered = [...files].sort();
assert(ordered.some((file) => file.endsWith(".js")), "No panel runtime was included");
assert(ordered.some((file) => file.endsWith(".css")), "No panel stylesheet was included");
assert(ordered.every((file) => !/(?:^|\/)(?:demo(?:\.|\/)|\.photogit|\.env)|\.test\.|node_modules|\.psd$/i.test(file)), "Development package contains data, tests, or demo files");
const archive = join(root, "release", `photogit-${product.version}-development.zip`);

if (!process.argv.includes("--verify")) {
  const staging = await mkdtemp(join(tmpdir(), "photogit-package-"));
  try {
    for (const file of ordered) {
      await mkdir(join(staging, dirname(file)), { recursive: true });
      await copyFile(join(plugin, file), join(staging, file));
    }
    const temporaryArchive = join(staging, "development.zip");
    execFileSync("zip", ["-X", "-q", temporaryArchive, "--", ...ordered], { cwd: staging });
    await mkdir(dirname(archive), { recursive: true });
    await copyFile(temporaryArchive, archive);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const listed = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n").sort();
assert.deepEqual(listed, ordered, "Archive has missing, extra, or duplicate files");
for (const file of ordered) {
  const archived = execFileSync("unzip", ["-p", archive, file], { maxBuffer: 30 * 1024 * 1024 });
  assert(archived.equals(await readFile(join(plugin, file))), `Packaged bytes differ: ${file}`);
  if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", join(plugin, file)]);
}
for (const path of ["cli/dist/main.js", "apps/desktop-helper/dist/main.js"]) {
  assert((await lstat(join(root, path))).isFile(), `Build missing: ${path}`);
  execFileSync(process.execPath, ["--check", join(root, path)]);
}
execFileSync(process.execPath, [join(root, "cli/dist/main.js"), "--help"], { cwd: root, stdio: "pipe" });
const sha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
console.log(`${basename(archive)} verified: ${ordered.length} files, matching source bytes, one product version (${product.version}), valid runtime syntax, and CLI build present.\nSHA-256 ${sha256}\nDevelopment source bundle only; this is not a signed or installable CCX release.`);
