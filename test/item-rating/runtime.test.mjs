import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadCatalog, loadRules, registerItems} from '../../sim/index.js';
import {rateItem, photoMassLimit, currentItemRating} from '../../sim/item-rating.js';
import {simulateV3, mountTransform, loadV3Rules, tierDamage} from '../../sim/v3.js';
const exec = promisify(execFile), root = fileURLToPath(new URL('../../', import.meta.url));
const base = await loadRules();
const mountRules = await loadV3Rules();
const sample = () => { const item = structuredClone(base.items.find(i => i.id === 'pan-lux3d')); item.id = 'runtime-pot-test'; item.name = '运行时锅'; item.outEnd = mountRules.top.outEnd['pan-lux3d']; delete item.comparisonBase; item.rating = rateItem(item, base.materials); return item; };

const photo = (hardness = .4) => {
 const item = sample(); Object.assign(item, {id:'runtime-photo-cup', name:'保温杯', category:'保温杯', materialName:'不锈钢和硅胶', photoPhysics:{hardness}, tag:'photo', generated:true, massBasis:'photo-estimate'});
 item.rating = rateItem(item, base.materials); return item;
};
test('unrestricted photo identity registers, fights, and validates its individual physical inputs', async () => {
 const item = photo();
 for (const edit of [i=>i.photoPhysics.hardness=0, i=>i.photoPhysics.hardness=1.21, i=>i.photoPhysics.extra=1, i=>delete i.materialName, i=>i.name='x\n', i=>i.category='pot', i=>i.tag='sharp', i=>i.mass=101, i=>i.generated=false, i=>i.bounds.max[0]=i.bounds.min[0]+.81]) {
  const invalid=structuredClone(item); edit(invalid); await assert.rejects(registerItems([invalid]));
 }
 await registerItems([item]);
 const loaded=(await loadCatalog()).find(i=>i.id===item.id);
 assert.deepEqual(loaded,item);
 await registerItems([{...loaded,currentRating:currentItemRating(item)}]);
 const replay=await simulateV3({mode:'A',seed:41671,fighters:[{parts:[{item:item.id,mount:'e0',orient:'out'}]},{parts:[{item:'broom',mount:'e0',orient:'out'}]}]});
 assert.ok(replay.frames.length>10); assert.equal(replay.frames[0].fighters[0].parts[0].item,item.id);
});
test('photo combat cap excludes replaced historical catalog objects and rejects overweight items even with recalculated ratings', async () => {
 assert.equal(photoMassLimit(base),2);
 const item=photo(); item.mass=2.001; item.rating=rateItem(item,base.materials);
 await assert.rejects(registerItems([item]),/Invalid runtime item/);
});

test('longest/heaviest and shortest/lightest photo items finish full matches in all three modes', async () => {
 const finiteTree=value=>{
  if(typeof value==='number')assert.ok(Number.isFinite(value));
  else if(value&&typeof value==='object')for(const v of Object.values(value))finiteTree(v);
 };
 for(const [id,length,mass] of [['max',.8,2],['min',.01,.001]]) {
  const item=photo(); item.id='runtime-photo-boundary-'+id; item.mass=mass;
  const extent=Math.max(...item.bounds.max.map((v,i)=>v-item.bounds.min[i])),scale=length/extent;
  item.bounds={min:item.bounds.min.map(v=>v*scale),max:item.bounds.max.map(v=>v*scale)};
  item.hull=item.hull.map(p=>p.map(v=>v*scale)); item.volume*=scale**3;
  item.weakPoint={pos:item.weakPoint.pos.map(v=>v*scale),radius:length*.06};
  item.rating=rateItem(item,base.materials); await registerItems([item]);
  for(const mode of ['A','B','manual']) {
   const replay=await simulateV3({mode:mode==='manual'?'A':mode,...(mode==='manual'?{manual:{sides:['ai','ai']}}:{}),seed:41671,
    fighters:[{parts:[{item:item.id,mount:'e0',orient:'out'}]},{parts:[{item:'broom',mount:'e0',orient:'out'}]}]});
   assert.ok(['ko','double-ko','timeout'].includes(replay.meta.reason),`${id}/${mode}: ${replay.meta.reason}`);
   assert.ok(replay.meta.duration>0&&replay.meta.duration<=60.1); assert.ok(replay.frames.length>10); finiteTree(replay);
  }
 }
});

test('a photo hardness estimate changes its score and actual hit, without a category multiplier', () => {
 const soft=photo(.1),hard=photo(1.2);
 assert.ok(hard.rating.scores.attack>soft.rating.scores.attack);
 assert.ok(soft.rating.scores.durability>hard.rating.scores.durability);
 assert.equal(soft.rating.scores.range,hard.rating.scores.range);
 const hit=attacker=>tierDamage({mode:'A',impulse:1,attacker,target:sample(),materials:base.materials,matchups:base.matchups,maxHp:1000,rules:mountRules});
 assert.ok(hit(hard).score>hit(soft).score); assert.ok(hit(hard).damage>hit(soft).damage);
 const renamed={...hard,name:'玻璃杯',category:'玻璃杯'};
 assert.deepEqual(rateItem(renamed,base.materials),hard.rating); assert.deepEqual(hit(renamed),hit(hard));
});

test('runtime registration validates whole batch, rejects collisions/tampered grades and keeps data isolated', async () => {
 const item = sample();
 for (const edit of [i => delete i.outEnd, i => i.outEnd = 0, i => i.outEnd = '-1', i => delete i.condition, i => delete i.category, i => i.material = 'unknown', i => i.mass = NaN, i => i.rating.scores.attack = 1, i => i.rating.grade = 'D', i => i.hull = [[0,0,0],[1,0,0],[0,1,0],[1,1,0]], i => delete i.weakPoint]) {
  const invalid = sample(); invalid.id += '-invalid'; edit(invalid); await assert.rejects(registerItems([item, invalid]));
  assert.ok(!(await loadCatalog()).some(i => i.id === item.id));
 }
 await assert.rejects(registerItems([{...sample(), id: 'pan-lux3d'}]), /built-in/);
 const result = await registerItems([item]); result[0].mass = 999;
 await registerItems([Object.fromEntries(Object.entries(item).reverse())]);
 const changed = structuredClone(item); changed.name += '不同'; await assert.rejects(registerItems([changed]), /different data/);
 assert.equal((await loadCatalog()).find(i => i.id === item.id).mass, item.mass);
});

test('a new id preserves its sample orientation in every slot and both mount modes', async () => {
 for (const original of base.items) {
  const item = {...structuredClone(original), id: 'runtime-orientation-' + original.id, outEnd: mountRules.top.outEnd[original.id] ?? 1};
  for (const slot of Object.keys(mountRules.top.slots)) for (const orient of mountRules.top.orients) {
   assert.deepEqual(mountTransform(item, slot, orient, mountRules), mountTransform(original, slot, orient, mountRules), `${original.id}/${slot}/${orient}`);
  }
 }
 const original = base.items.find(i => i.id === 'pan-lux3d'), item = {...structuredClone(original), id: 'runtime-orientation-pan-lux3d', outEnd: -1};
 await registerItems([item]);
 assert.notDeepEqual(mountTransform({...item, outEnd: 1}, 'e0', 'out', mountRules), mountTransform(original, 'e0', 'out', mountRules));
 for (const orient of ['out', 'hug']) {
  const options = {mode: 'A', seed: 41671, fighters: [{parts: [{item: original.id, mount: 'e0', orient}, {item: 'pillow', mount: 'e180', orient: 'hug'}]}, {parts: [{item: 'broom', mount: 'e0', orient: 'out'}, {item: 'slipper', mount: 'e90', orient: 'out'}]}]};
  const builtin = await simulateV3(options);
  options.fighters[0].parts[0].item = item.id;
  const runtime = await simulateV3(options);
  assert.ok(runtime.frames.some(f => f.fighters[0].parts.some(p => p.item === item.id)));
  assert.ok(!JSON.stringify(builtin).includes(item.id));
  assert.equal(JSON.stringify(runtime).replaceAll(item.id, original.id), JSON.stringify(builtin));
 }
});

test('same item in static catalog and registered at runtime produces byte-identical replay', async () => {
 const item = sample(); await registerItems([item]);
 const fighters = [{parts: [{item: item.id, mount: 'e0', orient: 'out'}, {item: 'pillow', mount: 'e180', orient: 'hug'}]}, {parts: [{item: 'broom', mount: 'e0', orient: 'out'}, {item: 'slipper', mount: 'e90', orient: 'out'}]}];
 const options = {fighters, mode: 'A', seed: 41671};
 const runtime = await simulateV3(options);
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-static-runtime-'));
 await fs.mkdir(path.join(dir, 'sim')); await fs.mkdir(path.join(dir, 'data'));
 for (const file of ['index.js','runtime-items.js','v3.js','math.js','item-rating.js','v3-rules.json','package.json']) await fs.copyFile(path.join(root, 'sim', file), path.join(dir, 'sim', file));
 await fs.symlink(path.join(root, 'sim/node_modules'), path.join(dir, 'sim/node_modules'), 'junction');
 await fs.writeFile(path.join(dir, 'data/catalog.json'), JSON.stringify({...base, items: [...base.items, item]}));
 const source = `import {simulateV3} from ${JSON.stringify(new URL('file://' + path.join(dir, 'sim/v3.js')).href)};console.log(JSON.stringify(await simulateV3(${JSON.stringify(options)})));`;
 const {stdout} = await exec(process.execPath, ['--input-type=module', '-e', source], {maxBuffer: 64 * 1024 * 1024});
 assert.equal(JSON.stringify(runtime), stdout.trim());
 assert.ok(runtime.frames.length > 10); assert.ok(runtime.frames[0].fighters[0].parts.some(p => p.item === item.id));
});
