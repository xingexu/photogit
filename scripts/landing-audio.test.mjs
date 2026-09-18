import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('      function playChirp()'), html.indexOf('      var cloudAnimations'));
function setup() { let calls=0; let now=1000; const c={chirpPlayer:{currentTime:5,play(){calls++;return Promise.resolve()}},chirpMuted:false,lastChirp:-Infinity,document:{hidden:false},performance:{now:()=>now}};vm.runInNewContext(source,c);return {c,calls:()=>calls,setTime:v=>now=v}; }
test('chirps start only when invoked and rapid clicks cannot stack sounds',()=>{const f=setup();assert.equal(f.calls(),0);f.c.playChirp();f.c.playChirp();assert.equal(f.calls(),1);assert.equal(f.c.chirpPlayer.currentTime,0);f.setTime(2000);f.c.playChirp();assert.equal(f.calls(),2)});
test('mute and hidden documents suppress chirps',()=>{const f=setup();f.c.chirpMuted=true;f.c.playChirp();f.c.chirpMuted=false;f.c.document.hidden=true;f.c.playChirp();assert.equal(f.calls(),0)});
test('unavailable playback does not break interaction',async()=>{const f=setup();f.c.chirpPlayer.play=()=>Promise.reject(new Error('blocked'));f.c.playChirp();await Promise.resolve();f.setTime(2000);f.c.chirpPlayer=null;assert.doesNotThrow(()=>f.c.playChirp())});
test('chirp asset is a short low-amplitude PCM sound',()=>{const wav=fs.readFileSync(new URL('../site/audio/bird-chirp.wav',import.meta.url));assert.equal(wav.toString('ascii',0,4),'RIFF');assert.ok(wav.length<24000);let peak=0;for(let i=44;i<wav.length;i+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(i)));assert.ok(peak>1000&&peak<8000)});

test('soft swoosh respects mute and handles rejected playback', async () => {
 let calls=0;const c={swooshPlayer:{currentTime:3,play(){calls++;return Promise.reject(new Error('blocked'))}},chirpMuted:false,document:{hidden:false}};
 vm.runInNewContext(source,c);c.playSwoosh();await Promise.resolve();assert.equal(calls,1);assert.equal(c.swooshPlayer.currentTime,0);c.chirpMuted=true;c.playSwoosh();assert.equal(calls,1);
});
