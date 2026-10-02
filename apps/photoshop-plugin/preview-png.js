// Bounded PNG encoding for Photoshop's small RGB/RGBA preview buffer.
// Stored DEFLATE blocks avoid a dependency on compression APIs absent in UXP.
// This thumbnail is for display only; the PSD and full-resolution hashes are separate.
function encodePreviewPng(width, height, components, pixels) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 768 || height > 768 || ![3, 4].includes(components) || !(pixels instanceof Uint8Array) || pixels.length !== width * height * components) throw new Error("Invalid preview pixel buffer.");
  const stride = width * components;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const compressed = new Uint8Array(2 + raw.length + Math.ceil(raw.length / 65535) * 5 + 4);
  compressed.set([0x78, 0x01]);
  let offset = 2, a = 1, b = 0;
  for (let start = 0; start < raw.length; start += 65535) {
    const length = Math.min(65535, raw.length - start);
    compressed[offset++] = start + length === raw.length ? 1 : 0;
    compressed[offset++] = length & 255; compressed[offset++] = length >>> 8;
    compressed[offset++] = (~length) & 255; compressed[offset++] = ((~length) >>> 8) & 255;
    compressed.set(raw.subarray(start, start + length), offset); offset += length;
    for (let index = start; index < start + length; index++) { a = (a + raw[index]) % 65521; b = (b + a) % 65521; }
  }
  new DataView(compressed.buffer).setUint32(offset, ((b << 16) | a) >>> 0);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = components === 4 ? 6 : 2;
  const chunks = [chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())];
  const result = new Uint8Array(8 + chunks.reduce((size, value) => size + value.length, 0));
  result.set([137, 80, 78, 71, 13, 10, 26, 10]); offset = 8;
  for (const value of chunks) { result.set(value, offset); offset += value.length; }
  return result;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  crcTable[index] = crc >>> 0;
}
function chunk(type, data) {
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer); view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) result[4 + index] = type.charCodeAt(index);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < result.length - 4; index++) crc = crcTable[(crc ^ result[index]) & 255] ^ (crc >>> 8);
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}
module.exports = { encodePreviewPng };
