// Frozen S-pool selection and disjoint-seed verification. Single process, nice -n 20.
import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {simulateV3,loadCatalog} from '../../sim/v3.js';
const stage=process.env.S_STAGE??'select',n=Number(process.env.S_SEEDS??(stage==='select'?5:100));
assert.ok(['select','verify'].includes(stage));assert.ok(Number.isInteger(n)&&n>0);if(stage==='verify')assert.ok(n>=100,'formal holdout needs at least 100 independent seeds');
const root=new URL('../../',import.meta.url),out=new URL(process.env.S_OUT),hash=x=>createHash('sha256').update(x).digest('hex');
await mkdir(out,{recursive:true});
const catalog=await loadCatalog(),designs=JSON.parse(await readFile(new URL('data/default-item-designs.json',root))),ids=designs.items.map(i=>i.id),s=ids.filter(id=>catalog.find(i=>i.id===id).rating.grade==='S');
assert.equal(new Set(ids).size,9);assert.equal(s.length,2,'this fixture explicitly covers two S items and one unique pair');
const modes=['autoA','autoB','manual'],orients=['out','hug'],layouts=orients.flatMap(a=>orients.flatMap(b=>['e180','e90'].map(spread=>({a,b,spread}))));
const single=(id,orient)=>({parts:[{item:id,mount:'e0',orient}]}),double=(pair,l)=>({parts:[{item:pair[0],mount:'e0',orient:l.a},{item:pair[1],mount:l.spread,orient:l.b}]}),plan=[];
const selection=stage==='verify'?JSON.parse(await readFile(new URL(process.env.S_SELECTION))):null;
if(selection){assert.equal(selection.complete,true);assert.deepEqual(selection.s,s);assert.equal(selection.stage,'select');assert.ok(selection.sources);}
const sources=Object.fromEntries(await Promise.all(['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','data/catalog.json','data/default-item-designs.json','test/item-rating/s-pool.mjs'].map(async f=>[f,hash(await readFile(new URL(f,root)))])));
if(selection)assert.deepEqual(selection.sources,sources,'selection must use the same frozen simulator, catalog and protocol');
for(const mode of modes){
 const chosen=selection?.modes.find(m=>m.mode===mode);
 for(const id of s)for(const orient of stage==='select'?orients:[chosen.single.find(x=>x.id===id).orient])for(const foe of s.filter(x=>x!==id))for(const foeOrient of orients)for(let i=0;i<n;i++)for(const swap of [false,true])plan.push({kind:'single',mode,id,orient,foe,foeOrient,seed:(stage==='select'?0:1000)+i,swap});
 for(const layout of stage==='select'?layouts:[chosen.double.layout])for(const foeLayout of layouts)for(let i=0;i<n;i++)for(const swap of [false,true])plan.push({kind:'double',mode,layout,foeLayout,seed:(stage==='select'?0:1000)+i,swap});
 if(stage==='verify'){
  for(const id of s)for(const foe of ids)for(const foeOrient of orients)for(let i=0;i<Math.min(n,10);i++)for(const swap of [false,true])plan.push({kind:'single-context',mode,id,orient:chosen.single.find(x=>x.id===id).orient,foe,foeOrient,seed:1000+i,swap});
  for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)for(let i=0;i<Math.min(n,10);i++)for(const swap of [false,true])plan.push({kind:'double-context',mode,pair:[ids[a],ids[b]],layout:chosen.double.layout,seed:1000+i,swap});
 }
}
const manifest={stage,n,ids,s,sources,selection,planned:plan.length,seedScope:stage==='select'?`0..${n-1} selection only`:`1000..${999+n} held out; first 10 contextual only`,doubleCoverage:'one unique pair; no claim about multiple distinct S pairs'};
const fingerprint=hash(JSON.stringify(manifest)),mf=new URL('manifest.json',out),rf=new URL('rounds.ndjson',out);let rows=[];
try{assert.equal(JSON.parse(await readFile(mf)).fingerprint,fingerprint);rows=(await readFile(rf,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(mf,JSON.stringify({...manifest,fingerprint},null,2)+'\n');await writeFile(rf,'');}
const done=new Set(rows.map(r=>JSON.stringify(r.plan)));assert.equal(done.size,rows.length);const started=Date.now();
for(const p of plan){
 if(done.has(JSON.stringify(p)))continue;
 let defs=p.kind.startsWith('single')?[single(p.id,p.orient),single(p.foe,p.foeOrient)]:[double(s,p.layout),double(p.kind==='double'?s:p.pair,p.kind==='double'?p.foeLayout:{a:'out',b:'out',spread:'e180'})];
 const profiles=[(p.seed^0x243f6a88)>>>0,(p.seed^0xb7e15162)>>>0];if(p.swap){defs.reverse();profiles.reverse();}
 const r=await simulateV3({fighters:defs,seed:p.seed,mode:p.mode==='autoB'?'B':'A',manual:p.mode==='manual'?{sides:['ai','ai'],aiSeeds:profiles}:null});
 assert.ok(Number.isFinite(r.meta.duration)&&r.frames.every(fr=>fr.fighters.every(f=>[f.hp,f.mass,...f.pos,...f.velocity].every(Number.isFinite))));
 const winner=r.meta.winner,score=winner===null?.5:winner===(p.swap?1:0)?1:0,ts=[...new Set(r.events.filter(e=>e.damage>0).map(e=>e.t))];
 const row={plan:p,score,duration:r.meta.duration,reason:r.meta.reason,firstDamage:ts[0]??null,hits:ts.length,replaySha:hash(JSON.stringify(r))};rows.push(row);await appendFile(rf,JSON.stringify(row)+'\n');
 if(rows.length%50===0){await writeFile(new URL('progress.json',out),JSON.stringify({status:'running',count:rows.length,total:plan.length,seconds:(Date.now()-started)/1000})+'\n');console.log(rows.length,plan.length);}
}
for(const [f,sha]of Object.entries(sources))assert.equal(hash(await readFile(new URL(f,root))),sha,`source changed during run: ${f}`);
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
function stats(a){
 if(!a.length)return {n:0};
 const seeds=[...new Set(a.map(r=>r.plan.seed))],clusters=seeds.map(seed=>mean(a.filter(r=>r.plan.seed===seed).map(r=>r.score)));let state=11235813;
 const roll=()=>((state=(Math.imul(1664525,state)+1013904223)>>>0)/4294967296),bs=Array.from({length:2000},()=>100*mean(clusters.map(()=>clusters[Math.floor(roll()*clusters.length)]))).sort((a,b)=>a-b);
 return {n:a.length,seedClusters:seeds.length,scorePct:100*mean(a.map(r=>r.score)),lower95:bs[50],upper95:bs[1949],method:'2000 percentile resamples of complete paired seed clusters'};
}
const summary={stage,complete:rows.length===plan.length,s,sources,modes:modes.map(mode=>{
 const a=rows.filter(r=>r.plan.mode===mode),singleStats=s.map(id=>{const choices=[...new Set(a.filter(r=>r.plan.kind==='single'&&r.plan.id===id).map(r=>r.plan.orient))].map(orient=>({id,orient,...stats(a.filter(r=>r.plan.kind==='single'&&r.plan.id===id&&r.plan.orient===orient))})).sort((a,b)=>b.scorePct-a.scorePct);return {...choices[0],choices};});
 const doubles=[...new Set(a.filter(r=>r.plan.kind==='double').map(r=>JSON.stringify(r.plan.layout)))].map(l=>({layout:JSON.parse(l),...stats(a.filter(r=>r.plan.kind==='double'&&JSON.stringify(r.plan.layout)===l))})).sort((a,b)=>b.scorePct-a.scorePct);
 return {mode,single:singleStats,double:doubles[0],doubleChoices:doubles,singleContext:s.flatMap(id=>ids.map(foe=>({id,foe,...stats(a.filter(r=>r.plan.kind==='single-context'&&r.plan.id===id&&r.plan.foe===foe))}))).filter(x=>x.n),doubleContext:[...new Set(a.filter(r=>r.plan.kind==='double-context').map(r=>r.plan.pair.join('|')))].map(pair=>({pair:pair.split('|'),...stats(a.filter(r=>r.plan.kind==='double-context'&&r.plan.pair.join('|')===pair))}))};
})};
summary.overpowered=summary.modes.flatMap(m=>[...m.single.map(x=>({mode:m.mode,kind:'single',id:x.id,lower95:x.lower95})),{mode:m.mode,kind:'double',pair:s,lower95:m.double.lower95}]).filter(x=>x.lower95>65);
summary.pass=stage==='verify'&&summary.complete&&summary.overpowered.length===0;
summary.scope='Frozen default S pool only; two S items give one unique pair. Context rows do not establish arbitrary-shape or all-pair balance.';
await writeFile(new URL('summary.json',out),JSON.stringify(summary,null,2)+'\n');await writeFile(new URL('progress.json',out),JSON.stringify({status:'complete',count:rows.length,total:plan.length,seconds:(Date.now()-started)/1000})+'\n');console.log('COMPLETE',stage,rows.length);
