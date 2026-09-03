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
      localFileSystem: "request"
    });
    expect(manifest.main).toBe("index.html");
  });

  it("keeps development ID visibly distinct from a release package", async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "apps/photoshop-plugin/manifest.json"), "utf8"));
    expect(manifest.id).toBe("com.photogit.development");
  });
});
