import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const site = new URL('../site/', import.meta.url);
const html = fs.readFileSync(new URL('index.html', site), 'utf8');
test('all referenced local image and sound assets exist', () => {
  const assets = [...html.matchAll(/(?:src=\"|url\(')([^'\"]+\.(?:png|wav))/g)].map(match => match[1]);
  assets.push('audio/leaf-whoosh.wav');
  for (let i = 1; i <= 10; i++) assets.push(`artwork/petals/petal-${i}.png`);
  for (const asset of assets) assert.ok(fs.statSync(new URL(asset, site)).size > 0, asset);
});
test('whoosh is a non-silent mono 16-bit PCM WAV', () => {
  const wav = fs.readFileSync(new URL('audio/leaf-whoosh.wav', site));
  assert.equal(wav.toString('ascii',0,4),'RIFF'); assert.equal(wav.toString('ascii',8,12),'WAVE');
  assert.equal(wav.readUInt16LE(20),1); assert.equal(wav.readUInt16LE(22),1);
  assert.equal(wav.readUInt16LE(34),16); assert.equal(wav.readUInt32LE(24),44100);
  let peak = 0; for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(peak > 1000 && peak < 32767);
});
