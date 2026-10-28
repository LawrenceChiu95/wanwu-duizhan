// Fixed 2x2 intervention: engine body creation order x global half turn. No production file is edited.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {root,fixtures,options,sha} from './experiment.mjs';
const original=await readFile(new URL('sim/v3.js',root),'utf8'),out=new URL('./fairness-diagnostic-r2/',import.meta.url);
await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile(new URL('./results-r2/manifest.json',import.meta.url),'utf8'));
assert.equal(sha(original),manifest.sources['sim/v3.js'],'diagnosis must use the frozen r2 rules');
const records=(await readFile(new URL('./results-r2/rounds.ndjson',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
const fixed=new Map(records.filter(x=>x.stage==='fair').map(x=>[[x.fixture,x.seed,x.condition].join('|'),x]));
assert.equal(fixed.size,2400,'finish the six full fixed-order fairness scenes first');
function replaceOnce(s,from,to){assert.equal(s.split(from).length,2,from);return s.replace(from,to);}
async function variant(reverse,turned){
 let source=original;
 if(reverse)source=replaceOnce(source,'fs=definitions.map((d,i)=>buildFighter(world,d,i,c,r))','fs=[1,0].map(i=>({i,f:buildFighter(world,definitions[i],i,c,r)})).sort((a,b)=>a.i-b.i).map(x=>x.f)');
 if(turned){
  source=replaceOnce(source,'const q=index===0?[0,0,0,1]:[0,1,0,0]','const q=index===1?[0,0,0,1]:[0,1,0,0]');
  source=replaceOnce(source,'x:(i===0?-1:1)*distance/2','x:(i===0?1:-1)*distance/2');
 }
 const variantSha=sha(source);
 source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
 for(const f of ['index.js','math.js'])source=source.replaceAll(`'./${f}'`,JSON.stringify(new URL(`sim/${f}`,root).href));
 source=replaceOnce(source,"new URL('./v3-rules.json',import.meta.url)",`new URL(${JSON.stringify(new URL('sim/v3-rules.json',root).href)})`);
 return {simulate:(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).simulateV3,variantSha};
}
const rows=[],started=Date.now();
for(const reverse of [false,true])for(const turned of [false,true]){
 const {simulate,variantSha}=await variant(reverse,turned);
 for(const f of fixtures)for(let seed=0;seed<20;seed++)for(const condition of ['ai-left','ai-right']){
  assert.ok(Date.now()<Date.parse('2026-10-28T23:00:00Z'),'07:00 resource boundary');
  const o=options(f,seed);o.fighters=[f.definition,f.definition];
  const profiles=[(seed^0x243f6a88)>>>0,(seed^0xb7e15162)>>>0];o.manual.aiSeeds=condition==='ai-left'?profiles:profiles.reverse();
  const r=await simulate(o),hash=sha(r),contact=r.events.find(e=>e.type==='contact');
  if(!reverse&&!turned)assert.equal(hash,fixed.get([f.id,seed,condition].join('|')).replaySha256,'original source no longer reproduces batch row');
  rows.push({fixture:f.id,seed,condition,reverse,turned,variantSha,winner:r.meta.winner,duration:r.meta.duration,replaySha256:hash,
   firstContact:contact&&{t:contact.t,parts:contact.parts,impulse:contact.impulse,attacker:contact.attacker,scores:contact.attackScores},
   initial:r.meta.initial.map(x=>({mass:x.mass,pos:x.pos,centerOfMass:x.centerOfMass,angularVelocity:x.angularVelocity,quat:x.quat})),
   firstFrame:r.frames[1],firstPress:r.events.filter(e=>e.type==='press').slice(0,4)});
  if(seed===0&&condition==='ai-left')await writeFile(new URL(`order-${fixtures.indexOf(f)}-${+reverse}-${+turned}.json.gz`,out),gzipSync(JSON.stringify(r)));
 }
 console.log(`${reverse?'reverse':'fixed'} creation, ${turned?'half-turn':'original'} orientation: ${rows.length}/960`);
}
assert.equal(sha(original),sha(await readFile(new URL('sim/v3.js',root),'utf8')));
const summary=[];
for(const f of fixtures)for(const reverse of [false,true])for(const turned of [false,true]){
 const rs=rows.filter(x=>x.fixture===f.id&&x.reverse===reverse&&x.turned===turned),ref=rows.filter(x=>x.fixture===f.id&&!x.reverse&&!x.turned);
 summary.push({fixture:f.id,reverse,turned,n:rs.length,index0ScorePercent:100*rs.reduce((s,x)=>s+(x.winner===null?.5:x.winner===0?1:0),0)/rs.length,
  winnerChangedFromOriginal:rs.filter(x=>ref.find(y=>y.seed===x.seed&&y.condition===x.condition).winner!==x.winner).length});
}
await writeFile(new URL('order-proof.json',out),JSON.stringify({scope:'20 fixed seeds x swapped AI profiles x 6 scenes x 2 creation orders x 2 global orientations. No source/rule/geometry/AI/damage tuning; global half turn keeps the fighter and AI profile identities.',sourceSha256:sha(original),manifestFingerprint:manifest.fingerprint,wallSeconds:(Date.now()-started)/1000,rows,summary},null,2)+'\n');
console.log(JSON.stringify(summary));
