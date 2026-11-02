import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {simulateV3} from '../../sim/v3.js';
import {fixtures,options} from '../v3-top/v13/experiment.mjs';
import {physicsFiles} from './fair-freeze.mjs';

// Declared before the first run; never select seeds by their results. See LONG-TAIL-SPEC.md.
const panel={seedStart:40000,n:100,condition:'timing',mode:'A',blockTime:.25};
const sceneIds=['pan-broom/out-out-e180','pan-broom/hug-hug-e90','scissors-pillow/out-out-e180','scissors-pillow/hug-hug-e90','lamp-slipper/out-out-e180','lamp-slipper/hug-hug-e90'];

test('independent six-scene timing panel meets whole-panel long-tail proportions',async t=>{
 assert.deepEqual(fixtures.map(f=>f.id),sceneIds);
 const sources=Object.fromEntries(await Promise.all(physicsFiles.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../../'+file,import.meta.url))).digest('hex')])));
 const rows=[];
 try{
  for(const scene of fixtures)for(let seed=panel.seedStart;seed<panel.seedStart+panel.n;seed++){
   const r=await simulateV3(options(scene,seed,panel.condition,panel.blockTime,panel.mode));
   rows.push({scene:scene.id,seed,duration:r.meta.duration,reason:r.meta.reason});
   assert.ok(Number.isFinite(r.meta.duration)&&r.meta.duration>0&&r.meta.duration<=60,`${scene.id} seed ${seed}: invalid duration`);
   assert.ok(['ko','double-ko','timeout'].includes(r.meta.reason),`${scene.id} seed ${seed}: invalid ending`);
  }
 }finally{
  // Keep every completed row even if a simulation or an assertion fails.
  t.diagnostic(JSON.stringify({panel,sources,rows}));
 }
 const count=group=>({n:group.length,over45:group.filter(r=>r.duration>45).length,at60:group.filter(r=>r.duration>=60).length});
 const total=count(rows),scenes=sceneIds.map(scene=>({scene,...count(rows.filter(r=>r.scene===scene))}));
 t.diagnostic(JSON.stringify({total,scenes,scope:'Fixed A/timing regression panel; not full balance or mirror acceptance.'}));
 assert.equal(total.n,600);
 assert.ok(total.over45*200<=total.n,`${total.over45}/${total.n} exceed 45s; whole-panel limit is 0.5%`);
 assert.ok(total.at60*10000<=total.n,`${total.at60}/${total.n} reach 60s; whole-panel limit is 0.01%`);
});
