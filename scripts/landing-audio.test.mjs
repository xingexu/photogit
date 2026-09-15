import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('      function natureSound()'), html.indexOf('      function releaseLeaves()'));
test('audio restarts one player directly on activation and respects mute', () => {
  const calls = []; const status = {textContent:''};
  const c = {soundMuted:false, whoosh:{currentTime:2, pause(){calls.push('pause')}, play(){calls.push('play'); return Promise.resolve()}}, document:{querySelector:() => status}};
  vm.runInNewContext(source, c); c.natureSound();
  assert.deepEqual(calls, ['pause','play']); assert.equal(c.whoosh.currentTime, 0);
  c.soundMuted = true; c.natureSound(); assert.equal(calls.length, 2);
});
test('blocked audio announces failure without throwing', async () => {
  const status = {textContent:''};
  const c = {soundMuted:false, whoosh:{pause(){}, play(){return Promise.reject(new Error('blocked'))}}, document:{querySelector:() => status}};
  vm.runInNewContext(source, c); c.natureSound(); await Promise.resolve();
  assert.match(status.textContent, /unavailable/);
});
