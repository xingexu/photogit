import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('    })();', 'globalThis.effects = {releaseLeaves, drawSwarm, stopEffects, leaves: () => swarm};\n    })();');
function setup({width = 1440, reduced = false, saveData = false, canvas = true} = {}) {
  let now = 1000;
  const alphas = [];
  const positions = []; const rotations = []; const events = {}; const created = [];
  const media = {matches:reduced, addEventListener(name, callback){events.media = callback}};
  const paint = {setTransform(){}, clearRect(){}, save(){}, restore(){}, translate(x,y){positions.push([x,y])}, rotate(value){rotations.push(value)}, drawImage(){alphas.push(this.globalAlpha)}, fillRect(){}};
  const element = () => ({style:{setProperty(){}}, setAttribute(){}, appendChild(){}, addEventListener(){}, getContext:() => canvas ? paint : null, pause(){}, play(){return Promise.resolve()}});
  const title = {...element(), textContent:'PHOTOGIT', querySelectorAll:() => []};
  const c = {document:{querySelector:s => s === '.title' ? title : element(), querySelectorAll:() => [], createElement:tag => {created.push(tag); return element()}, body:element(), hidden:false, addEventListener(name, callback){events[name] = callback}, documentElement:{classList:{toggle(){}}}}, window:{innerWidth:width, innerHeight:900, addEventListener(name, callback){events[name] = callback}}, navigator:{connection:{saveData}}, localStorage:{getItem(){return null}}, matchMedia:() => media, Image:class{complete=true; naturalWidth=32}, performance:{now:() => now}, setTimeout(){return 1}, clearTimeout(){}, requestAnimationFrame(){return 1}, cancelAnimationFrame(){}};
  vm.runInNewContext(source, c);
  return {...c.effects, alphas, positions, rotations, events, created, media, document:c.document, title, setTime:value => {now = value}};
}
for (const [width, expected] of [[1440,1100],[390,600]]) {
  test(`leaf density, size, fade and cleanup at ${width}px`, () => {
    const fx = setup({width}); fx.releaseLeaves();
    assert.equal(fx.leaves().length, expected);
    assert.ok(fx.leaves().every(leaf => leaf.size >= 6 && leaf.size < 14));
    const leaf = fx.leaves()[0]; leaf.y = .5; leaf.wave = 0; fx.leaves().splice(1);
    fx.drawSwarm(1000 + (leaf.delay + leaf.life * .4) * 1000);
    const early = fx.alphas.at(-1);
    fx.drawSwarm(1000 + (leaf.delay + leaf.life * .9) * 1000);
    assert.ok(fx.alphas.at(-1) < early);
    fx.setTime(2000); fx.releaseLeaves(); assert.equal(fx.leaves().length, expected);
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
  const fx = setup({saveData:true}); fx.releaseLeaves(); assert.equal(fx.leaves().length, 400);
  fx.stopEffects(); assert.equal(fx.leaves().length, 0);
});

test('flowers advance across the viewport', () => { const fx=setup(); fx.releaseLeaves(); const leaf=fx.leaves()[0]; leaf.y=.5; fx.leaves().splice(1); fx.drawSwarm(3000); const x=fx.positions.at(-1)[0]; fx.drawSwarm(6000); assert.ok(fx.positions.at(-1)[0]>x); });

test('a unified flight duration', () => { const fx=setup(); fx.releaseLeaves(); assert.ok(fx.leaves().every(l=>l.life===7)); });

test('a compact launch window', () => { const fx=setup(); fx.releaseLeaves(); assert.ok(fx.leaves().every(l=>l.delay>=0 && l.delay<.65)); });

test('repeat clicks preserve active flowers', () => { const fx=setup(); fx.releaseLeaves(); const first=fx.leaves()[0]; fx.setTime(3000); fx.releaseLeaves(); assert.equal(fx.leaves()[0],first); });

test('sweep replay after completion', () => { const fx=setup(); fx.releaseLeaves(); const first=fx.leaves()[0]; fx.drawSwarm(9000); fx.setTime(10000); fx.releaseLeaves(); assert.ok(fx.leaves().length); assert.notEqual(fx.leaves()[0],first); });
