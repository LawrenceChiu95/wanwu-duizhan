// In-memory creation-order probes only. Never replaces the frozen production source.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {simulateV3} from '../../../sim/v3.js';
import {root,fixtures,options,sha} from './experiment.mjs';
const original=await readFile(new URL('sim/v3.js',root),'utf8');
async function variant(edit){
 let s=edit(original);
 s=s.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
 for(const f of ['index.js','math.js'])s=s.replaceAll(`'./${f}'`,JSON.stringify(new URL(`sim/${f}`,root).href));
 s=s.replace("new URL('./v3-rules.json',import.meta.url)",`new URL(${JSON.stringify(new URL('sim/v3-rules.json',root).href)})`);
 return (await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'))).simulateV3;
}
const from='fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r))';assert(original.includes(from));
const reverse=await variant(s=>s.replace(from,'fs=[1,0].map(i=>({i,f:buildFighter(world,definitions[i],i,c,r)})).sort((a,b)=>a.i-b.i).map(x=>x.f)'));
const turned=await variant(s=>s.replace('const q=index===0?[0,0,0,1]:[0,1,0,0]','const q=index===1?[0,0,0,1]:[0,1,0,0]').replace('x:(i===0?-1:1)*distance/2','x:(i===0?1:-1)*distance/2'));
const rows=[];
for(const f of fixtures)for(const seed of [0,1]){
 const o=options(f,seed);o.fighters=[f.definition,f.definition];
 const row={fixture:f.id,seed};
 for(const [k,run] of [['original',simulateV3],['reversedBodyCreation',reverse],['globalHalfTurn',turned]]){
  const r=await run(o),contact=r.events.find(x=>x.type==='contact');
  row[k]={winner:r.meta.winner,duration:r.meta.duration,replaySha256:sha(r),firstContact:contact&&{t:contact.t,parts:contact.parts,impulse:contact.impulse,attacker:contact.attacker,scores:contact.attackScores},firstAngular:r.frames[1].fighters.map(x=>x.angularVelocity)};
 }
 rows.push(row);
}
assert.equal(sha(await readFile(new URL('sim/v3.js',root),'utf8')),sha(original));
await writeFile(new URL('fairness-diagnostic/order-proof.json',import.meta.url),JSON.stringify({scope:'12 same-loadout fixed matches, each original / body creation reversed / whole scene half-turned; in-memory modules only.',sourceSha256:sha(original),rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(x=>({fixture:x.fixture,seed:x.seed,winners:[x.original.winner,x.reversedBodyCreation.winner,x.globalHalfTurn.winner],firstTimes:[x.original.firstContact?.t,x.reversedBodyCreation.firstContact?.t,x.globalHalfTurn.firstContact?.t]})),null,2));
