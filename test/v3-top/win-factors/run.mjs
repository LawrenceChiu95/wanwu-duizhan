import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,open,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {simulateV3 as production} from '../../../sim/v3.js';
import {PAIRS,LAYOUTS,options,sha256} from '../loadout-compare/compare.mjs';
import {loadExperiment} from './experiment.mjs';
const root=new URL('../../../',import.meta.url),dir=new URL('./results/',import.meta.url);
const old=JSON.parse(await readFile(new URL('../loadout-compare/results/inputs.json',import.meta.url)));
for(const [file,sha] of Object.entries(old.sources).filter(([p])=>/^(sim|data)\//.test(p)))assert.equal(sha256(await readFile(new URL(file,root))),sha,file);
const rows=(await readFile(new URL('../loadout-compare/results/rounds.ndjson',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
const fixtures=PAIRS.flatMap(pair=>[LAYOUTS[0],LAYOUTS[7]].map(layout=>({id:`${pair.id}/${layout.id}`,pair,layout})));
const modules=Object.fromEntries(await Promise.all(['baseline','initial','critical','ai-random','right-yaw'].map(async k=>[k,await loadExperiment(k)])));
const oldRow=(f,seed)=>{const rs=rows.filter(r=>r.condition==='ai-ai'&&r.pair===f.pair.id&&r.layout===f.layout.id&&r.seed===seed);assert.equal(rs.length,1);return rs[0];};
const checks=[];
for(const f of fixtures){
 const o=options(f.pair,f.layout,'ai-ai',1),a=await production(o),b=await modules.baseline.simulateV3(o);
 assert.equal(sha256(a),sha256(b));assert.equal(sha256(a),oldRow(f,1).replaySha256);
 const initials={};
 for(const k of ['initial','critical','ai-random','right-yaw']){
  const m=await modules[k].createV3Match(o);try{initials[k]=structuredClone(m.initial);}finally{m.free();}
 }
 assert.notDeepEqual(initials.initial,a.meta.initial);
 for(const k of ['critical','ai-random'])assert.deepEqual(initials[k],a.meta.initial);
 assert.deepEqual(initials['right-yaw'][0],a.meta.initial[0]);
 assert.deepEqual(initials['right-yaw'][1].pos,a.meta.initial[1].pos);
 const va=initials['right-yaw'][1].angularVelocity,vb=a.meta.initial[1].angularVelocity;
 assert(va.every((x,i)=>Math.abs(x-vb[i])<1e-9));
 checks.push({fixture:f.id,baselineSha256:sha256(a),initialInvariants:true});
}
await mkdir(dir,{recursive:true});
const file=await open(new URL('rounds.ndjson',dir),'wx');
const nice=execFileSync('ps',['-o','nice=','-p',String(process.pid)],{encoding:'utf8'}).trim();assert.equal(nice,'20');
const mash=[];for(let k=60;k<7200;k+=552)mash.push({step:k,side:0,action:'dash'});for(let k=300;k<7200;k+=624)mash.push({step:k,side:0,action:'block'});mash.sort((a,b)=>a.step-b.step);
const conditions=['idle','mash','initial','critical','ai-random','right-yaw'];
const inputs={base:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),encoding:'utf8'}).trim(),oldInputSha256:old.inputSha256,fixtures,conditions,seeds:100,checks,node:process.version,nice,started:new Date().toISOString(),sources:{}};
for(const f of ['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs','test/v3-top/win-factors/run.mjs','test/v3-top/win-factors/experiment.mjs'])inputs.sources[f]=sha256(await readFile(new URL(f,root)));
await writeFile(new URL('inputs.json',dir),JSON.stringify(inputs,null,2)+'\n');
const t0=performance.now();let complete=0;
try{
 for(const condition of conditions)for(const f of fixtures){
  for(let seed=1;seed<=100;seed++){
   const opts=options(f.pair,f.layout,'ai-ai',seed);
   if(['idle','mash'].includes(condition))opts.manual={sides:['input','ai'],inputs:condition==='mash'?mash:[]};
   const t=performance.now(),r=await (modules[condition]?.simulateV3??production)(opts),baseline=oldRow(f,seed);
   const row={fixture:f.id,pair:f.pair.id,layout:f.layout.id,condition,seed,winner:r.meta.winner,reason:r.meta.reason,duration:r.meta.duration,computeMs:performance.now()-t,
    baselineWinner:baseline.winner,baselineSha256:baseline.replaySha256,replaySha256:sha256(r),weak:r.events.filter(e=>e.type==='weak').length,
    criticalTrials:r.events.filter(e=>e.criticalRoll!==null&&e.criticalRoll!==undefined).length,
    actions:[0,1].map(i=>({dash:r.events.filter(e=>e.type==='dash'&&e.phase==='go'&&e.side===i).length,block:r.events.filter(e=>e.type==='block'&&e.side===i).length}))};
   await file.write(JSON.stringify(row)+'\n');complete++;
  }
  const progress={pid:process.pid,complete,total:conditions.length*fixtures.length*100,condition,fixture:f.id,seconds:(performance.now()-t0)/1000};
  await writeFile(new URL('progress.json',dir),JSON.stringify(progress,null,2)+'\n');console.log(JSON.stringify(progress));
 }
}finally{await file.close();}
await writeFile(new URL('complete.json',dir),JSON.stringify({complete,seconds:(performance.now()-t0)/1000,finished:new Date().toISOString()},null,2)+'\n');
