import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const site = new URL('../site/', import.meta.url);
const html = fs.readFileSync(new URL('index.html', site), 'utf8');
test('all referenced local landing assets exist', () => {
  const background = fs.readFileSync(new URL('ascii-background.js', site), 'utf8');
  const markupAssets = html.matchAll(/(?:src="|href="|url\(')([^'"]+\.(?:css|js|png|wav|webp|woff2))(?=["'])/g);
  const photoAssets = background.matchAll(/'(photos\/[^']+\.webp)'/g);
  const assets = [...markupAssets, ...photoAssets]
    .map(match => match[1])
    .filter(asset => !/^https?:/.test(asset));
  for (const asset of assets) assert.ok(fs.statSync(new URL(asset, site)).size > 0, asset);
});

test('the social preview points to an image shipped with the site', () => {
  const image = html.match(/<meta property="og:image" content="([^"]+)">/);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/);
  assert.ok(image && canonical);
  const socialUrl = new URL(image[1]);
  assert.equal(socialUrl.origin, new URL(canonical[1]).origin);
  assert.ok(fs.statSync(new URL(socialUrl.pathname.slice(1), site)).size > 0);
});
