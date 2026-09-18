import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('    })();', 'globalThis.effects = {releaseLeaves, drawSwarm, stopEffects, disperseBirds, jiggleCloud, leaves: () => swarm};\n    })();');
function setup({width = 1440, reduced = false, saveData = false, canvas = true} = {}) {
  let now = 1000;
  const alphas = [];
  const positions = []; const rotations = []; const events = {}; const created = []; const scatter = [];
  const media = {matches:reduced, addEventListener(name, callback){events.media = callback}};
  const paint = {setTransform(){}, clearRect(){}, save(){}, restore(){}, translate(x,y){positions.push([x,y])}, rotate(value){rotations.push(value)}, drawImage(){alphas.push(this.globalAlpha)}, fillRect(){}};
  const element = () => ({animate(frames, options){const a={frames, options, cancelled:false, cancel(){this.cancelled=true}};scatter.push(a);return a}, style:{setProperty(){}}, setAttribute(){}, appendChild(){}, addEventListener(){}, getContext:() => canvas ? paint : null, pause(){}, play(){return Promise.resolve()}});
  const title = {...element(), textContent:'PHOTOGIT', querySelectorAll:() => []};
  const c = {document:{querySelector:s => s === '.title' ? title : element(), querySelectorAll:() => [], createElement:tag => {created.push(tag); return element()}, body:element(), hidden:false, addEventListener(name, callback){events[name] = callback}, documentElement:{classList:{toggle(){}}}}, window:{innerWidth:width, innerHeight:900, addEventListener(name, callback){events[name] = callback}}, navigator:{connection:{saveData}}, localStorage:{getItem(){return null}}, matchMedia:() => media, Image:class{complete=true; naturalWidth=32}, performance:{now:() => now}, setTimeout(){return 1}, clearTimeout(){}, requestAnimationFrame(){return 1}, cancelAnimationFrame(){}};
  vm.runInNewContext(source, c);
  return {...c.effects, alphas, positions, scatter, rotations, events, created, media, document:c.document, title, setTime:value => {now = value}};
}
for (const [width, expected] of [[1440,720],[390,360]]) {
  test(`leaf density, size, fade and cleanup at ${width}px`, () => {
    const fx = setup({width}); fx.releaseLeaves();
    assert.equal(fx.leaves().length, expected);
    assert.ok(fx.leaves().every(leaf => leaf.size >= 12 && leaf.size <= 18));
    const leaf = fx.leaves()[0]; leaf.y = 1; leaf.wave = 0; leaf.offset = 1; fx.leaves().splice(1);
    fx.drawSwarm(1000 + (leaf.delay + leaf.life * .65) * 1000);
    const early = fx.alphas.at(-1);
    fx.drawSwarm(1000 + (leaf.delay + leaf.life * .93) * 1000);
    assert.ok(fx.alphas.at(-1) < early);
    fx.setTime(7500); fx.releaseLeaves(); assert.equal(fx.leaves().length, 1);
    fx.drawSwarm(9000); assert.equal(fx.leaves().length, 0);
    assert.equal(fx.title.textContent, 'PHOTOGIT');
  });
}
test('reduced motion and unavailable canvas keep the title usable', () => {
  for (const options of [{reduced:true}, {canvas:false}]) {
    const fx = setup(options); fx.releaseLeaves(); fx.stopEffects();
    assert.equal(fx.leaves().length, 0); assert.equal(fx.title.textContent, 'PHOTOGIT');
  }
});
test('data saver caps particles and Escape cleanup clears them', () => {
  const fx = setup({saveData:true}); fx.releaseLeaves(); assert.equal(fx.leaves().length, 200);
  fx.stopEffects(); assert.equal(fx.leaves().length, 0);
});

test('flowers fall with only a gentle horizontal flutter', () => { const fx=setup(); fx.releaseLeaves(); const leaf=fx.leaves()[0]; leaf.y=.5; leaf.offset=.5; fx.leaves().splice(1); fx.drawSwarm(3000); const start=fx.positions.at(-1); fx.drawSwarm(6000); const end=fx.positions.at(-1); assert.ok(end[1]>start[1]); assert.ok(Math.abs(end[0]-start[0])<25); });

test('a unified flight duration', () => { const fx=setup(); fx.releaseLeaves(); assert.ok(fx.leaves().every(l=>l.life===7)); });

test('a compact launch window', () => { const fx=setup(); fx.releaseLeaves(); assert.ok(fx.leaves().every(l=>l.delay>=0 && l.delay<.65)); });

test('repeat clicks preserve active flowers', () => { const fx=setup(); fx.releaseLeaves(); const first=fx.leaves()[0]; fx.setTime(3000); fx.releaseLeaves(); assert.equal(fx.leaves()[0],first); });

test('sweep replay after completion', () => { const fx=setup(); fx.releaseLeaves(); const first=fx.leaves()[0]; fx.drawSwarm(9000); fx.setTime(10000); fx.releaseLeaves(); assert.ok(fx.leaves().length); assert.notEqual(fx.leaves()[0],first); });

test('escape clears the sweep', () => { const fx=setup(); fx.releaseLeaves(); fx.events.keydown({key:'Escape'}); assert.equal(fx.leaves().length,0); });

test('other keys preserve the sweep', () => { const fx=setup(); fx.releaseLeaves(); fx.events.keydown({key:'a'}); assert.ok(fx.leaves().length); });

test('page departure clears flowers', () => { const fx=setup(); fx.releaseLeaves(); fx.events.pagehide(); assert.equal(fx.leaves().length,0); });

test('hiding a tab clears flowers', () => { const fx=setup(); fx.releaseLeaves(); fx.document.hidden=true; fx.events.visibilitychange(); assert.equal(fx.leaves().length,0); });

test('hidden tabs cannot launch flowers', () => { const fx=setup(); fx.document.hidden=true; fx.releaseLeaves(); assert.equal(fx.leaves().length,0); });

test('reduced motion cancels an active sweep', () => { const fx=setup(); fx.releaseLeaves(); fx.media.matches=true; fx.events.media({matches:true}); assert.equal(fx.leaves().length,0); });

test('re-enabling motion allows a fresh sweep', () => { const fx=setup(); fx.releaseLeaves(); fx.events.media({matches:true}); fx.setTime(3000); fx.media.matches=false; fx.releaseLeaves(); assert.ok(fx.leaves().length); });

test('activation creates no audio elements', () => { const fx=setup(); fx.releaseLeaves(); assert.ok(!fx.created.includes('audio')); });

test('flowers remain in a gentle vertical band', () => { const fx=setup(); fx.releaseLeaves(); assert.ok(fx.leaves().every(l=>l.y>=.08 && l.y<.92 && l.wave>=4 && l.wave<12)); });

test('mobile data saver particle cap', () => { const fx=setup({width:390,saveData:true}); fx.releaseLeaves(); assert.equal(fx.leaves().length,200); });

test('all ten flower sprites participate', () => { const fx=setup(); fx.releaseLeaves(); assert.equal(new Set(fx.leaves().map(l=>l.sprite)).size,10); });

test('petals remain visible through midflight', () => { const fx=setup(); fx.releaseLeaves(); const leaf=fx.leaves()[0]; leaf.y=.5; leaf.offset=.5; fx.leaves().splice(1); fx.drawSwarm(4500); assert.ok(fx.alphas.at(-1)>.8); });

test('title activation disperses fifteen birds without scaling and returns to formation', () => {
  const fx=setup(); fx.releaseLeaves(); assert.equal(fx.scatter.length,15);
  for (const a of fx.scatter) { assert.equal(a.frames.at(-1).transform,'translate(0, 0)'); assert.ok(a.frames.every(f=>!f.transform.includes('scale'))); }
  assert.equal(new Set(fx.scatter.slice(0,5).map(a=>a.frames[1].transform)).size,5);
});
test('stopping effects also cancels bird dispersal', () => {
  const fx=setup(); fx.releaseLeaves(); fx.stopEffects(); assert.ok(fx.scatter.every(a=>a.cancelled));
});
test('reduced motion never scatters birds', () => {
  const fx=setup({reduced:true}); fx.releaseLeaves(); assert.equal(fx.scatter.length,0);
});

test('repeat title clicks scatter birds while the leaves keep moving', () => {
  const fx=setup(); fx.releaseLeaves(); const leaf=fx.leaves()[0]; fx.setTime(2000); fx.releaseLeaves();
  assert.equal(fx.scatter.length,30); assert.ok(fx.scatter.slice(0,15).every(a=>a.cancelled)); assert.equal(fx.leaves()[0],leaf);
});
test('leaf shower remains spread across the screen', () => {
  const fx=setup(); fx.releaseLeaves(); const a=fx.leaves()[0], b=fx.leaves()[1];
  Object.assign(a,{offset:.1,y:.1,delay:0,wave:0}); Object.assign(b,{offset:.9,y:.9,delay:0,wave:0});
  fx.leaves().splice(2); fx.drawSwarm(4500);
  assert.equal(fx.positions.length,2); assert.ok(Math.abs(fx.positions[0][0]-fx.positions[1][0])>900); assert.ok(Math.abs(fx.positions[0][1]-fx.positions[1][1])>350);
});

test('birds stay close to their formation when startled', () => {
 const fx=setup(); fx.releaseLeaves(); for(const a of fx.scatter) { const [x,y]=a.frames[1].transform.match(/-?\d+(?:\.\d+)?/g).map(Number); assert.ok(Math.abs(x)<=95); assert.ok(Math.abs(y)<=58); }
});
test('cloud jiggle preserves its horizontal drift and cleans up', () => {
 const fx=setup(); let cancelled=false; let frames; fx.jiggleCloud({animate(f){frames=f; return {cancel(){cancelled=true}}}});
 assert.ok(frames.every(f=>!('transform' in f))); assert.equal(frames.at(-1).rotate,'0deg'); fx.stopEffects(); assert.ok(cancelled);
});
