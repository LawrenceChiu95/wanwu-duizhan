// Small factorial diagnosis only; restores shield duration / dash steering in memory, never shipping files.
// Dash quality remains the current press-direction criterion, so the steering factor tests motion, not the full old rules.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fixtures,options,root,sha,median} from './experiment.mjs';
import {measure} from './measure.mjs';
const original=await readFile(new URL('sim/v3.js',root),'utf8'),rules=JSON.parse(await readFile(new URL('sim/v3-rules.json',root),'utf8'));
const sourceSha=sha(original),out=new URL('./feel-diagnostic-r2/',import.meta.url);await mkdir(out,{recursive:true});
function replaceOnce(source,from,to){assert.equal(source.split(from).length,2,from);return source.replace(from,to);}
async function variant(window,steering){
 let source=original;
 if(steering==='follow-motion'){
  source=replaceOnce(source,'const dir=f.ctl.lockedDir,v=arr(f.body.linvel());','const dir=flat(arr(f.body.worldCom()),arr(fs[1-i].body.worldCom())),v=arr(f.body.linvel());');
  source=replaceOnce(source,'const dir=f.ctl.lockedDir,sideways=','const dir=flat(p,arr(fs[1-i].body.worldCom())),sideways=');
 }
 const r=structuredClone(rules);r.manual.blockTime=window;
 source=replaceOnce(source,"new URL('./v3-rules.json',import.meta.url)",`new URL('data:application/json;base64,${Buffer.from(JSON.stringify(r)).toString('base64')}')`);
 source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
 for(const file of ['index.js','math.js'])source=source.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
 return {simulate:(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).simulateV3,variantSha:sha(source)};
}
const rows=[];
for(const window of [.25,1])for(const steering of ['locked','follow-motion']){
 const {simulate,variantSha}=await variant(window,steering);
 for(const f of fixtures)for(let seed=0;seed<20;seed++){
  const o=options(f,seed,'timing');delete o.manual.blockTime;
  const {row}=await measure(()=>simulate(o));rows.push({fixture:f.id,seed,window,steering,variantSha,...row});
 }
}
assert.equal(sourceSha,sha(await readFile(new URL('sim/v3.js',root),'utf8')));
const summary=[];
for(const f of fixtures)for(const window of [.25,1])for(const steering of ['locked','follow-motion']){
 const rs=rows.filter(x=>x.fixture===f.id&&x.window===window&&x.steering===steering);
 summary.push({fixture:f.id,window,steering,n:rs.length,duration:median(rs.map(x=>x.duration)),pacePass:rs.filter(x=>x.pacePass).length,approach:median(rs.map(x=>x.approachMedian)),separation:median(rs.map(x=>x.separationMedian))});
}
await writeFile(new URL('proof.json',out),JSON.stringify({sourceSha,ruleSha:sha(rules),scope:'Four controlled variants, 20 fixed seeds per scene; current dash hit-quality and AI remain. Automatic B has no block/steering code path.',rows,summary},null,2)+'\n');console.log(JSON.stringify(summary));
