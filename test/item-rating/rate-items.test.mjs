import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,unlink,rmdir,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rateItems} from '../../tools/rate-items.mjs';
import {withLock} from '../../tools/import-item/state.mjs';
import {rateItem} from '../../sim/item-rating.js';

test('rating rewrite shares importer lock and preserves a newly added item',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wanwu-rating-'));
 await mkdir(path.join(root,'data'));await mkdir(path.join(root,'.aholo'));
 const file=path.join(root,'data','catalog.json'),designFile=path.join(root,'data','default-item-designs.json');
 t.after(async()=>{await unlink(file);await unlink(designFile);await rmdir(path.join(root,'data'));await rmdir(path.join(root,'.aholo'));await rmdir(root);});
 const source=JSON.parse(await readFile(new URL('../../data/catalog.json',import.meta.url),'utf8'));
 const designs=await readFile(new URL('../../data/default-item-designs.json',import.meta.url),'utf8');
 const original=JSON.stringify(source);await writeFile(file,original);await writeFile(designFile,designs);
 const added={...source.items.find(i=>i.id==='pan-lux3d'),id:'new-import',generated:true,name:'new import'};
 await withLock(path.join(root,'.aholo','catalog-lock'),async()=>{
  await assert.rejects(rateItems({repoRoot:root,log:()=>{}}),/Lock already exists/);
  assert.equal(await readFile(file,'utf8'),original);
  source.items.push(added);await writeFile(file,JSON.stringify(source));
 });
 const rows=[];await rateItems({repoRoot:root,log:r=>rows.push(...r)});
 const after=JSON.parse(await readFile(file,'utf8'));
 assert.equal(after.items.length,source.items.length);
 assert.deepEqual(after.items.map(i=>i.id),source.items.map(i=>i.id));
 assert.deepEqual(after.items.find(i=>i.id===added.id),{...added,rating:rateItem(added,source.materials)});
 assert.deepEqual(rows.map(i=>i.id),JSON.parse(designs).items.map(i=>i.id));
 assert.equal(rows.length,9);assert.ok(!rows.some(i=>i.id===added.id));
 for(const item of source.items)assert.deepEqual(after.items.find(i=>i.id===item.id),{...item,rating:rateItem(item,source.materials)});
 assert.deepEqual(await readdir(path.join(root,'data')),['catalog.json','default-item-designs.json']);
 assert.deepEqual(await readdir(path.join(root,'.aholo')),[]);
});
