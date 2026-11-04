// One process, sequential matches. Resume only against exactly the same code, inputs and measurement tools.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {simulateV3} from '../../../sim/v3.js';
import {fixtures,options,baseline,root,sha,mash} from './experiment.mjs';
import {measure} from './measure.mjs';
const out=new URL(process.env.V13_RESULTS??'./results/',import.meta.url);await mkdir(out,{recursive:true});
const files=['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','sim/package-lock.json','data/catalog.json','test/v3-top/impact-probe.mjs','test/v3-top/v13/experiment.mjs','test/v3-top/v13/measure.mjs','test/v3-top/v13/run.mjs'];
const sources=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(new URL(p,root)))])));
const manifest={schema:3,node:process.version,fairProtocol:'200 seeds x two swapped AI reaction profiles; each seed fixes one global half-turn; score is identity 0, physical-left score reported separately',base:'bbaaeb7',sources,fixtures,mash,primarySeeds:100,sensitivitySeeds:100,fairSeeds:200,swapSeeds:20,feelSeeds:50,causalSeeds:10};
const fingerprint=sha(manifest),old=await baseline(),plan=[];
for(const f of fixtures){
 for(let seed=0;seed<100;seed++)for(const condition of ['timing','mash','idle'])plan.push({stage:'primary',fixture:f.id,seed,condition,window:.25,mode:'A',version:'v13'});
 for(const window of [.2,.3])for(let seed=0;seed<100;seed++)for(const condition of ['timing','mash'])plan.push({stage:'sensitivity',fixture:f.id,seed,condition,window,mode:'A',version:'v13'});
 for(let seed=0;seed<200;seed++)for(const condition of ['ai-left','ai-right'])plan.push({stage:'fair',fixture:f.id,seed,condition,window:.25,mode:'A',version:'v13'});
 for(let seed=0;seed<20;seed++)for(const condition of ['flow-left','flow-right'])plan.push({stage:'swap',fixture:f.id,seed,condition,window:.25,mode:'A',version:'v13'});
 for(const mode of ['A','B'])for(let seed=0;seed<50;seed++)for(const version of ['v12','v13'])plan.push({stage:'feel',fixture:f.id,seed,condition:'auto',window:.25,mode,version});
 for(let seed=0;seed<100;seed++)plan.push({stage:'old-ai',fixture:f.id,seed,condition:'timing',window:1,mode:'A',version:'v12'});
 for(let seed=0;seed<10;seed++)plan.push({stage:'causal',fixture:f.id,seed,condition:'delay',window:.25,mode:'A',version:'v13'});
}
// Run one stage at a time across all scenes, rather than allowing one scene to monopolise a resource window.
const order=['fair','primary','sensitivity','feel','swap','old-ai','causal'];plan.sort((a,b)=>order.indexOf(a.stage)-order.indexOf(b.stage));
const recordFile=new URL('rounds.ndjson',out),manifestFile=new URL('manifest.json',out),progressFile=new URL('progress.json',out);
let existing=[];
try{const previous=JSON.parse(await readFile(manifestFile,'utf8'));assert.equal(previous.fingerprint,fingerprint,'source/input changed: use a fresh evidence directory');existing=(await readFile(recordFile,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(manifestFile,JSON.stringify({...manifest,fingerprint,planned:plan.length},null,2)+'\n');await writeFile(recordFile,'');}
const key=p=>[p.stage,p.fixture,p.seed,p.condition,p.window,p.mode,p.version].join('|'),done=new Set(existing.map(key));
assert.equal(done.size,existing.length,'duplicate evidence rows');
const stop=Date.parse(process.env.STOP_AT??'2026-10-28T23:00:00Z');assert(Number.isFinite(stop));
const started=Date.now();let count=existing.length,baselineChecked=false;
async function causal(f,p){
 const exact=await simulateV3(options(f,p.seed,'timing',p.window));
 const inputs=exact.events.filter(e=>e.type==='press'&&e.side===0).map(e=>({step:Math.round(e.t/exact.meta.rules.dt),side:0,action:e.action}));
 const replay=await simulateV3({...options(f,p.seed,'idle',p.window),manual:{sides:['input','ai'],blockTime:p.window,inputs}});
 assert.equal(sha(replay.frames),sha(exact.frames),'replaying accepted AI presses changes physics');assert.equal(replay.meta.winner,exact.meta.winner);
 const delayed=inputs.map(x=>({...x,step:x.step+30}));
 const {row}=await measure(()=>simulateV3({...options(f,p.seed,'idle',p.window),manual:{sides:['input','ai'],blockTime:p.window,inputs:delayed}}));
 const accepted=row.actions[0].press;
 return {...row,exactScore:exact.meta.winner===0?1:exact.meta.winner===null?.5:0,requested:inputs.length,exactAccepted:replay.meta.manual.inputs.length,delayedAccepted:accepted,countComparable:accepted===inputs.length,inputsSha256:sha(inputs),delaySteps:30};
}
for(const p of plan){
 if(done.has(key(p)))continue;
 if(Date.now()>=stop){await writeFile(progressFile,JSON.stringify({status:'paused-at-resource-deadline',count,total:plan.length,last:p,at:new Date().toISOString()},null,2)+'\n');console.log(`PAUSED ${count}/${plan.length}`);process.exit(0);}
 const f=fixtures.find(f=>f.id===p.fixture),begin=performance.now();let row;
 if(p.stage==='causal')row=await causal(f,p);
 else{
  const o=options(f,p.seed,p.condition,p.window,p.mode);if(p.stage==='fair'){o.fighters=[f.definition,f.definition];o.manual.sides=['ai','ai'];const profiles=[(p.seed^0x243f6a88)>>>0,(p.seed^0xb7e15162)>>>0];o.manual.aiSeeds=p.condition==='ai-left'?profiles:profiles.reverse();}
  if(p.stage==='swap'){
   o.fighters=[f.definition,f.definition];
   const inputs=[...mash,...mash.map(x=>({...x,side:1,step:x.step+30}))].sort((a,b)=>a.step-b.step||a.side-b.side);
   o.manual={sides:['input','input'],blockTime:.25,inputs:p.condition==='flow-left'?inputs:inputs.map(x=>({...x,side:1-x.side}))};
  }
  const run=p.version==='v12'?old.simulateV3:simulateV3;
  const measured=await measure(()=>run(o));row=measured.row;
  if(p.stage==='feel'&&p.version==='v12'&&p.mode==='A'&&p.seed===1&&!baselineChecked){
   const lines=(await readFile('/Users/lawrence/Projects/wanwu-duizhan/test/v3-top/loadout-compare/results/rounds.ndjson','utf8')).trim().split('\n').map(JSON.parse);
   const [pair,layout]=p.fixture.split('/');
   const historical=lines.find(x=>x.pair===pair&&x.layout===layout&&x.seed===p.seed&&x.condition==='auto');
   assert(historical,'historical baseline row missing');assert.equal(row.replaySha256,historical.replaySha256,'frozen baseline fails its historical full SHA');baselineChecked=true;
  }
 }
 await appendFile(recordFile,JSON.stringify({...p,...row,wallMs:performance.now()-begin})+'\n');done.add(key(p));count++;
 if(count%25===0){await writeFile(progressFile,JSON.stringify({status:'running',count,total:plan.length,stage:p.stage,at:new Date().toISOString(),wallSeconds:(Date.now()-started)/1000},null,2)+'\n');console.log(`${count}/${plan.length} ${p.stage}`);}
}
for(const [p,hash]of Object.entries(sources))assert.equal(sha(await readFile(new URL(p,root))),hash,`source changed while running: ${p}`);
await writeFile(progressFile,JSON.stringify({status:'complete',count,total:plan.length,at:new Date().toISOString(),wallSeconds:(Date.now()-started)/1000},null,2)+'\n');console.log(`COMPLETE ${count}/${plan.length}`);
