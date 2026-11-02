import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadCatalog, loadRules, registerItems} from '../../sim/index.js';
import {rateItem} from '../../sim/item-rating.js';
import {simulateV3} from '../../sim/v3.js';
const exec = promisify(execFile), root = fileURLToPath(new URL('../../', import.meta.url));
const base = await loadRules();
const sample = () => { const item = structuredClone(base.items.find(i => i.id === 'pan-lux3d')); item.id = 'runtime-pot-test'; item.name = '运行时锅'; delete item.comparisonBase; item.rating = rateItem(item, base.materials); return item; };

test('runtime registration validates whole batch, rejects collisions/tampered grades and keeps data isolated', async () => {
 const item = sample();
 for (const edit of [i => delete i.condition, i => delete i.category, i => i.material = 'unknown', i => i.mass = NaN, i => i.rating.scores.attack = 1, i => i.rating.grade = 'D', i => i.hull = [[0,0,0],[1,0,0],[0,1,0],[1,1,0]], i => delete i.weakPoint]) {
  const invalid = sample(); invalid.id += '-invalid'; edit(invalid); await assert.rejects(registerItems([item, invalid]));
  assert.ok(!(await loadCatalog()).some(i => i.id === item.id));
 }
 await assert.rejects(registerItems([structuredClone(base.items[0])]), /built-in/);
 const result = await registerItems([item]); result[0].mass = 999;
 await registerItems([Object.fromEntries(Object.entries(item).reverse())]);
 const changed = structuredClone(item); changed.name += '不同'; await assert.rejects(registerItems([changed]), /different data/);
 assert.equal((await loadCatalog()).find(i => i.id === item.id).mass, item.mass);
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
