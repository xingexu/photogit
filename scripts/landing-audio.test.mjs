import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
test('landing activation has no audio player or playback', () => {
  assert.doesNotMatch(html, /whoosh|natureSound|new Audio|createElement\(['"]audio|\.play\(/);
});
test('landing has no obsolete sound controls', () => {
  assert.doesNotMatch(html, /sound-toggle|sound-status|sound-muted|birdsong/);
});
