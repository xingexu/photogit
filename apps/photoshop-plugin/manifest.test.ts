import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Photoshop plugin manifest", () => {
  it("uses Manifest v5 with narrowly scoped permissions", async () => {
    const path = resolve(process.cwd(), "apps/photoshop-plugin/manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    expect(manifest.manifestVersion).toBe(5);
    expect(manifest.host).toMatchObject({ app: "PS", minVersion: "24.2.0" });
    expect(manifest.requiredPermissions).toEqual({
      localFileSystem: "request",
      launchProcess: { schemes: ["https"] }
    });
    expect(manifest.entrypoints[0]).toMatchObject({
      type: "panel",
      minimumSize: { width: 230, height: 200 },
      preferredDockedSize: { width: 400, height: 760 },
      preferredFloatingSize: { width: 420, height: 800 }
    });
    expect(manifest.main).toBe("index.html");
  });

  it("keeps development ID visibly distinct from a release package", async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "apps/photoshop-plugin/manifest.json"), "utf8"));
    expect(manifest.id).toBe("com.photogit.development");
    expect(manifest.version).toBe("0.1.6");
  });

  it("ships crisp monochrome panel icons at every declared scale", async () => {
    const pluginRoot = resolve(process.cwd(), "apps/photoshop-plugin");
    const manifest = JSON.parse(await readFile(resolve(pluginRoot, "manifest.json"), "utf8"));
    const icons = new Map(manifest.icons.map((icon: { path: string; width: number; height: number }) => [icon.path, icon]));
    for (const [path, icon] of icons) {
      const base = await readFile(resolve(pluginRoot, path));
      expect(pngDimensions(base), path).toEqual({ width: icon.width, height: icon.height });
      const retinaPath = path.replace(/\.png$/, "@2x.png");
      const retina = await readFile(resolve(pluginRoot, retinaPath));
      expect(pngDimensions(retina), retinaPath).toEqual({ width: icon.width * 2, height: icon.height * 2 });
    }
  });

  it("ships the shared high-resolution PhotoGit identity with transparency", async () => {
    const logo = await readFile(resolve(process.cwd(), "apps/photoshop-plugin/icons/photogit-git-mark.png"));
    expect(pngDimensions(logo)).toEqual({ width: 512, height: 512 });
    expect(pngColorType(logo)).toBe(6);
  });
});

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function pngColorType(buffer: Buffer): number {
  expect(buffer.toString("ascii", 12, 16)).toBe("IHDR");
  return buffer.readUInt8(25);
}
