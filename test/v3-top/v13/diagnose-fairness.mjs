// Read-only diagnostic of fixed rules: no solver/rule/parameter replacement.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {simulateV3} from '../../../sim/v3.js';
import {fixtures,options,sha} from './experiment.mjs';
const out=new URL('./fairness-diagnostic/',import.meta.url);await mkdir(out,{recursive:true});
const turn=v=>[-v[0],v[1],-v[2]],error=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
const rows=[];
for(const f of fixtures){
 const o=options(f,0);o.fighters=[f.definition,f.definition];
 const r=await simulateV3(o),contacts=r.events.filter(e=>e.type==='contact');
 const firstDelta=r.frames.map(x=>({t:x.t,core:error(x.fighters[1].pos,turn(x.fighters[0].pos)),com:error(x.fighters[1].centerOfMass,turn(x.fighters[0].centerOfMass)),velocity:error(x.fighters[1].velocity,turn(x.fighters[0].velocity)),angular:error(x.fighters[1].angularVelocity,turn(x.fighters[0].angularVelocity))})).find(x=>Math.max(x.core,x.com,x.velocity,x.angular)>1e-7);
 const snapshot=contacts.slice(0,6).map(e=>({t:e.t,parts:e.parts,impulse:e.impulse,attacker:e.attacker,normalSpeeds:e.closingSpeeds,scores:e.attackScores,normal:e.normal}));
 const row={fixture:f.id,seed:0,replaySha256:sha(r),winner:r.meta.winner,duration:r.meta.duration,initial:{positionError:error(r.meta.initial[1].pos,turn(r.meta.initial[0].pos)),comError:error(r.meta.initial[1].centerOfMass,turn(r.meta.initial[0].centerOfMass)),angularError:error(r.meta.initial[1].angularVelocity,turn(r.meta.initial[0].angularVelocity)),masses:r.meta.initial.map(x=>x.mass)},firstDelta,firstContacts:snapshot,roleAttacks:[0,1].map(i=>contacts.filter(e=>e.attacker===i).length),damageToCore:[0,1].map(i=>r.events.filter(e=>e.target===i&&e.targetPart==='core'&&e.damage>0).reduce((n,e)=>n+e.damage,0)),inputs:[0,1].map(i=>r.events.filter(e=>e.type==='press'&&e.side===i).map(({t,action})=>({t,action})))};
 assert.equal(row.initial.positionError,0);assert.equal(row.initial.comError,0);assert.equal(row.initial.angularError,0);assert.equal(row.initial.masses[0],row.initial.masses[1]);
 await writeFile(new URL(f.id.replaceAll('/','_')+'-seed0.json.gz',out),gzipSync(JSON.stringify(r)));rows.push(row);
}
await writeFile(new URL('proof.json',out),JSON.stringify({scope:'Six fixed same-loadout seed-0 matches. First recorded frame is sampled every 4 physics steps; this locates divergence but does not identify its causal component.',rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({fixture,winner,firstDelta,firstContacts,roleAttacks})=>({fixture,winner,firstDelta,firstContacts:firstContacts.slice(0,2),roleAttacks})),null,2));
