// Offline, single-process measurement. Start only in a currently approved resource window, with nice -n 20.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {simulateV3,loadCatalog} from '../../sim/v3.js';
import {measureWalls} from './walls.mjs';
const catalog=await loadCatalog();
import {simulateWithRules} from '../v3-top/variant.mjs';
import {fixtures,foe,options} from '../v3-top/v13/experiment.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),root=new URL('../../',import.meta.url);
const stage=process.env.MVP_STAGE??'pilot',n=Number(process.env.MVP_SEEDS??(stage==='pilot'?5:stage==='fair'?1000:stage==='combos'?5:stage==='combo-check'?20:100));
assert.ok(['pilot','primary','fair','layout','strength','combos','combo-check'].includes(stage));assert.ok(Number.isInteger(n)&&n>0);
const seedStart=stage==='fair'?Number(process.env.MVP_SEED_START??30000):0;
assert.ok(Number.isInteger(seedStart)&&seedStart>=0&&seedStart+n<=0x100000000,'seed range must not wrap');
const out=new URL(process.env.MVP_OUT??`./results-${stage}/`,import.meta.url);await mkdir(out,{recursive:true});
const files=['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','sim/item-rating.js','data/catalog.json','data/default-item-designs.json','data/item-standards.json','test/v3-top/v13/experiment.mjs','test/v3-top/variant.mjs','test/mvp/batch.mjs','test/mvp/analyze.mjs','test/mvp/walls.mjs'];
const sources=Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(new URL(f,root)))])));
const plan=[];
const baseRadius=JSON.parse(await readFile(new URL('sim/v3-rules.json',root))).arenaRadius;
if(stage==='pilot'||stage==='primary')for(const radius of stage==='pilot'?[2.4,2.2,2]:[baseRadius])for(const f of fixtures)for(let seed=0;seed<n;seed++)for(const condition of ['autoA','autoB','manual','timing','idle'])plan.push({stage,radius,scene:f.id,seed,condition});
if(stage==='fair')for(const f of fixtures)for(let seed=seedStart;seed<seedStart+n;seed++)for(const swap of [false,true])plan.push({stage,radius:baseRadius,scene:f.id,seed,swap});
if(stage==='layout')for(const f of fixtures)for(let seed=0;seed<n;seed++)for(const change of ['original','orient-first','orient-second','spread'])plan.push({stage,radius:baseRadius,scene:f.id,seed,change});
const defaultItems=['scissors','lamp-lux3d','broom','pan-lux3d','slipper','pillow'];
if(stage==='strength')for(let a=0;a<defaultItems.length;a++)for(let b=a;b<defaultItems.length;b++)for(const leftOrient of ['out','hug'])for(const rightOrient of ['out','hug'])for(let seed=0;seed<n;seed++)for(const swap of [false,true])plan.push({stage,radius:baseRadius,left:defaultItems[a],right:defaultItems[b],leftOrient,rightOrient,seed,swap});
let selection=null;
if(stage==='combos')for(let a=0;a<defaultItems.length;a++)for(let b=a+1;b<defaultItems.length;b++)for(const leftOrient of ['out','hug'])for(const rightOrient of ['out','hug'])for(const spread of ['e180','e90'])for(const opponent of fixtures)for(let seed=0;seed<n;seed++)plan.push({stage,radius:baseRadius,combo:[defaultItems[a],defaultItems[b]],leftOrient,rightOrient,spread,opponent:opponent.id,seed});
if(stage==='combo-check'){
 assert.ok(process.env.MVP_SELECTION,'MVP_SELECTION must name a completed combos summary.json');
 selection=JSON.parse(await readFile(new URL(process.env.MVP_SELECTION,import.meta.url)));assert.equal(selection.complete,true);
 for(const best of selection.combos)for(const opponent of fixtures)for(let seed=1000;seed<1000+n;seed++)plan.push({stage,radius:baseRadius,combo:best.combo,...best.best.layout,opponent:opponent.id,seed});
}
const manifest={stage,n,...(stage==='fair'&&{seedStart}),sources,fixtures,foe,defaultItems,selection,r8Protocol:'one attachment per top; out/hug; equal weight opponents and their two orientations; paired AI streams swapped; report per-own-orient average and take maximum',planned:plan.length};
const fingerprint=hash(JSON.stringify(manifest)),manifestFile=new URL('manifest.json',out),recordFile=new URL('rounds.ndjson',out);
let previous=[];
try{assert.equal(JSON.parse(await readFile(manifestFile)).fingerprint,fingerprint,'sources/input changed: use new evidence directory');previous=(await readFile(recordFile,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(manifestFile,JSON.stringify({...manifest,fingerprint},null,2)+'\n');await writeFile(recordFile,'');}
const key=p=>JSON.stringify(p),done=new Set(previous.map(r=>key(r.plan)));assert.equal(done.size,previous.length);
const simulators=new Map();for(const radius of new Set(plan.map(p=>p.radius)))simulators.set(radius,radius===baseRadius?simulateV3:await simulateWithRules({arenaRadius:radius}));
let count=previous.length;const started=Date.now();
for(const p of plan){
 if(done.has(key(p)))continue;
 const f=fixtures.find(f=>f.id===p.scene);let o;
 if(stage==='pilot'||stage==='primary')o=options(f,p.seed,p.condition==='manual'?'mash':p.condition==='timing'?'timing':p.condition==='idle'?'idle':'auto',.25,p.condition==='autoB'?'B':'A');
 if(stage==='fair')o={fighters:[f.definition,f.definition],seed:p.seed,manual:{sides:['ai','ai']}};
 if(stage==='layout'){
  const def=structuredClone(f.definition);
  if(p.change==='orient-first')def.parts[0].orient=def.parts[0].orient==='out'?'hug':'out';
  if(p.change==='orient-second')def.parts[1].orient=def.parts[1].orient==='out'?'hug':'out';
  if(p.change==='spread')def.parts[1].mount=def.parts[1].mount==='e180'?'e90':'e180';
  o={fighters:[def,foe],seed:p.seed,manual:{sides:['ai','ai']}};
 }
 if(stage==='strength')o={fighters:[{parts:[{item:p.left,mount:'e0',orient:p.leftOrient}]},{parts:[{item:p.right,mount:'e0',orient:p.rightOrient}]}],seed:p.seed,manual:{sides:['ai','ai']}};
 if(stage==='combos'||stage==='combo-check')o={fighters:[{parts:[{item:p.combo[0],mount:'e0',orient:p.leftOrient},{item:p.combo[1],mount:p.spread,orient:p.rightOrient}]},fixtures.find(f=>f.id===p.opponent).definition],seed:p.seed,manual:{sides:['ai','ai']}};
 if(p.swap!==undefined){const profiles=[(p.seed^0x243f6a88)>>>0,(p.seed^0xb7e15162)>>>0];o.manual.aiSeeds=p.swap?profiles.reverse():profiles;}
 const begin=performance.now(),r=await simulators.get(p.radius)(o),damage=r.events.filter(e=>e.damage>0),score=r.meta.winner===0?1:r.meta.winner===null?.5:0;
 const row={plan:p,score,winner:r.meta.winner,reason:r.meta.reason,duration:r.meta.duration,firstDamage:damage[0]?.t??null,hits:damage.length,replaySha256:hash(JSON.stringify(r)),initialOuter:r.meta.initial.map(f=>Math.hypot(f.pos[0],f.pos[2])+f.sweepRadius),maxCoreRadius:Math.max(...r.frames.flatMap(fr=>fr.fighters.map(f=>Math.hypot(f.pos[0],f.pos[2])+r.meta.rules.core.radius))),wall:measureWalls(r,catalog),penetration:r.meta.diagnostics.maxResidualPenetration,scrape:r.meta.diagnostics.scrapeDuration,wallMs:performance.now()-begin};
 await appendFile(recordFile,JSON.stringify(row)+'\n');count++;
 if(count%25===0){await writeFile(new URL('progress.json',out),JSON.stringify({status:'running',count,total:plan.length,at:new Date().toISOString(),wallSeconds:(Date.now()-started)/1000},null,2)+'\n');console.log(`${stage} ${count}/${plan.length}`);}
}
for(const [f,sha]of Object.entries(sources))assert.equal(hash(await readFile(new URL(f,root))),sha,`source changed during measurement: ${f}`);
await writeFile(new URL('progress.json',out),JSON.stringify({status:'complete',count,total:plan.length,at:new Date().toISOString(),wallSeconds:(Date.now()-started)/1000},null,2)+'\n');console.log(`COMPLETE ${stage} ${count}/${plan.length}`);
