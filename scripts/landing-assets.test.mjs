import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const site = new URL('../site/', import.meta.url);
const html = fs.readFileSync(new URL('index.html', site), 'utf8');
test('all referenced local landing assets exist', () => {
  const assets = [...html.matchAll(/(?:src="|href="|url\(')([^'"]+\.(?:css|js|png|wav|webp))(?=["'])/g)]
    .map(match => match[1])
    .filter(asset => !/^https?:/.test(asset));
  for (const asset of assets) assert.ok(fs.statSync(new URL(asset, site)).size > 0, asset);
});
