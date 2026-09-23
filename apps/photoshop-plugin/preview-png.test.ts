import { createRequire } from "node:module";
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
const { encodePreviewPng } = createRequire(import.meta.url)("./preview-png.js");

describe("bounded saved preview PNG", () => {
  it.each([3, 4])("encodes %s-channel pixels with valid PNG checksums, scanlines and lossless alpha", components => {
    const width = 129, height = 130;
    const pixels = Uint8Array.from({ length: width * height * components }, (_, index) => index % 256);
    const png = Buffer.from(encodePreviewPng(width, height, components, pixels));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    let offset = 8; const types = []; const data: Buffer[] = [];
    while (offset < png.length) {
      const size = png.readUInt32BE(offset); const type = png.toString("ascii", offset + 4, offset + 8);
      expect(png.readUInt32BE(offset + 8 + size)).toBe(crc32(png.subarray(offset + 4, offset + 8 + size)));
      if (type === "IHDR") {
        expect(png.readUInt32BE(offset + 8)).toBe(width); expect(png.readUInt32BE(offset + 12)).toBe(height);
        expect(png[offset + 17]).toBe(components === 4 ? 6 : 2);
      }
      if (type === "IDAT") data.push(png.subarray(offset + 8, offset + 8 + size));
      types.push(type); offset += 12 + size;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
    const raw = inflateSync(Buffer.concat(data));
    const stride = width * components;
    expect(raw.length).toBe((stride + 1) * height);
    for (let row = 0; row < height; row++) {
      expect(raw[row * (stride + 1)]).toBe(0);
      expect(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1))).toEqual(Buffer.from(pixels.subarray(row * stride, (row + 1) * stride)));
    }
  });
  it("stays below the helper's preview limit at maximum dimensions and rejects unbounded buffers", () => {
    expect(encodePreviewPng(768, 768, 4, new Uint8Array(768 * 768 * 4)).length).toBeLessThan(3 * 1024 * 1024);
    for (const [w, h, c, pixels] of [[769, 1, 4, new Uint8Array(3076)], [1, 1, 4, new Uint8Array(3)], [0, 1, 4, new Uint8Array()], [1, 1, 1, new Uint8Array(1)]]) {
      expect(() => encodePreviewPng(w, h, c, pixels)).toThrow("Invalid preview");
    }
  });
});
