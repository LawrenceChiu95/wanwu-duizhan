import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {fairFreezeChecks} from './fair-freeze.mjs';
const out=new URL(process.env.MVP_OUT??'./results-pilot/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',out)));
let raw;
try{raw=await readFile(new URL('rounds.ndjson',out),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;raw=gunzipSync(await readFile(new URL('rounds.ndjson.gz',out))).toString('utf8');}
const rows=raw.trim().split('\n').filter(Boolean).map(JSON.parse);
const median=xs=>{const a=xs.toSorted((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null;},mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const summary={stage:manifest.stage,planned:manifest.planned,completed:rows.length,complete:rows.length===manifest.planned};
// A sweep circle is a conservative opening audit, not a measured hull/wall intersection.
summary.opening=[...new Set(rows.map(r=>r.plan.radius))].map(radius=>{
 const group=rows.filter(r=>r.plan.radius===radius),known=group.filter(r=>Array.isArray(r.initialOuter)&&r.initialOuter.length===2&&r.initialOuter.every(Number.isFinite));
 return {radius,n:group.length,checked:known.length,missing:group.length-known.length,initialOutside:known.filter(r=>r.initialOuter.some(x=>x>radius)).length,maxInitialOuter:known.length?Math.max(...known.flatMap(r=>r.initialOuter)):null,measure:'initial center distance + fixed sweep radius; conservative circle envelope'};
});
summary.walls={checked:rows.filter(r=>r.wall).length,missing:rows.filter(r=>!r.wall).length,maxSampledPartExcess:rows.some(r=>r.wall)?Math.max(...rows.filter(r=>r.wall).map(r=>r.wall.maxPartExcess)):null,measure:'live hull vertices against 64 wall inner planes at recorded frames; not a continuous-step bound'};
if(['pilot','primary'].includes(manifest.stage)){
 summary.groups=[];for(const radius of new Set(rows.map(r=>r.plan.radius)))for(const condition of ['autoA','autoB','manual','timing','idle']){
  const group=rows.filter(r=>r.plan.radius===radius&&r.plan.condition===condition);if(!group.length)continue;
  const durations=group.map(r=>r.duration),first=group.map(r=>r.firstDamage??Infinity),durationMedian=median(durations),over45Pct=100*mean(durations.map(t=>t>45?1:0));
  summary.groups.push({radius,condition,n:group.length,durationMedian,over45Pct,firstDamageMedian:median(first),firstDamageWorst:Math.max(...first),noDamage:group.filter(r=>r.firstDamage===null).length,over1Second:group.filter(r=>r.firstDamage===null||r.firstDamage>1).length,initialOutside:group.filter(r=>r.initialOuter?.some(x=>x>radius)).length,maxCoreOuter:Math.max(...group.map(r=>r.maxCoreRadius)),durationPass:durationMedian>=25&&durationMedian<=35&&over45Pct<=5,firstDamagePass:first.every(t=>t<=1)});
 }
 summary.timing=manifest.fixtures.map(f=>{const timing=rows.filter(r=>r.plan.scene===f.id&&r.plan.condition==='timing'),mash=rows.filter(r=>r.plan.scene===f.id&&r.plan.condition==='manual');return {scene:f.id,byRadius:[...new Set(timing.map(r=>r.plan.radius))].map(radius=>({radius,deltaPoints:100*(mean(timing.filter(r=>r.plan.radius===radius).map(r=>r.score))-mean(mash.filter(r=>r.plan.radius===radius).map(r=>r.score)))}))};});
 summary.timingSummary=[...new Set(rows.map(r=>r.plan.radius))].map(radius=>{
  const scenes=manifest.fixtures.map(f=>{
   const a=rows.filter(r=>r.plan.radius===radius&&r.plan.scene===f.id&&r.plan.condition==='timing'),b=rows.filter(r=>r.plan.radius===radius&&r.plan.scene===f.id&&r.plan.condition==='manual');
   const seeds=a.map(r=>r.plan.seed).toSorted((x,y)=>x-y),other=b.map(r=>r.plan.seed).toSorted((x,y)=>x-y);
   const paired=seeds.length===manifest.n&&new Set(seeds).size===manifest.n&&JSON.stringify(seeds)===JSON.stringify(other);
   return {scene:f.id,pairedSeeds:paired?seeds.length:0,deltaPoints:paired?100*(a.reduce((sum,r)=>sum+r.score,0)-b.reduce((sum,r)=>sum+r.score,0))/a.length:null};
  });
  const complete=summary.complete&&scenes.length===6&&new Set(scenes.map(s=>s.scene)).size===6&&scenes.every(s=>s.pairedSeeds===manifest.n&&Number.isFinite(s.deltaPoints)),medianDeltaPoints=median(scenes.map(s=>s.deltaPoints).filter(Number.isFinite));
  return {radius,scenes,medianDeltaPoints,complete,pass:complete&&medianDeltaPoints>=15,scope:manifest.stage==='pilot'?'pilot signal only; not formal balance acceptance':'primary paired-seed comparison'};
 });
}
if(manifest.stage==='fair'){
 const freeze=process.env.MVP_FREEZE?JSON.parse(await readFile(new URL(process.env.MVP_FREEZE))):null;
 summary.freeze=fairFreezeChecks(manifest,freeze);
 summary.scenes=manifest.fixtures.map(f=>{
 const a=rows.filter(r=>r.plan.scene===f.id),scorePct=100*mean(a.map(r=>r.score)),seeds=new Set(a.map(r=>r.plan.seed));
 const paired=Array.from({length:manifest.n},(_,i)=>manifest.seedStart+i).every(seed=>{
  const pair=a.filter(r=>r.plan.seed===seed);return pair.length===2&&pair.some(r=>r.plan.swap===false)&&pair.some(r=>r.plan.swap===true);
 });
 const complete=summary.complete&&manifest.fixtures.length===6&&new Set(manifest.fixtures.map(f=>f.id)).size===6&&summary.freeze.pass&&a.length===2*manifest.n&&seeds.size===manifest.n&&paired&&a.every(r=>[0,.5,1].includes(r.score));
 return {scene:f.id,n:a.length,pairedSeeds:seeds.size,seedStart:manifest.seedStart,scorePct,complete,pass:complete&&scorePct>=45&&scorePct<=55};
});
 summary.pass=summary.freeze.pass&&summary.scenes.length===6&&summary.scenes.every(s=>s.pass);
 summary.scope='Mirror score acceptance only; declared prior seed ranges and frozen physics. Does not certify duration, timing, walls or mobile rendering.';
}
if(manifest.stage==='layout'){
 summary.contrasts=manifest.fixtures.flatMap(f=>{const a=rows.filter(r=>r.plan.scene===f.id),base=mean(a.filter(r=>r.plan.change==='original').map(r=>r.score));return ['orient-first','orient-second','spread'].map(change=>({scene:f.id,change,n:a.filter(r=>r.plan.change===change).length,deltaPoints:100*(mean(a.filter(r=>r.plan.change===change).map(r=>r.score))-base)}));});summary.medianAbsoluteDelta=median(summary.contrasts.map(r=>Math.abs(r.deltaPoints)));summary.pass=summary.medianAbsoluteDelta>=5;
}
// Resample complete seed clusters; opponents and paired seats are not independent samples.
// This interval describes seed uncertainty only, not coverage of all possible loadouts/strategies.
function interval(group){
 const seeds=[...new Set(group.map(r=>r.plan.seed))],scores=seeds.map(seed=>mean(group.filter(r=>r.plan.seed===seed).map(r=>r.score)));
 let state=11235813;const roll=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const samples=Array.from({length:2000},()=>100*mean(scores.map(()=>scores[Math.floor(roll()*scores.length)]))).toSorted((a,b)=>a-b);
 return {seedClusters:seeds.length,lower95:samples[50],upper95:samples[1949],method:'percentile bootstrap, 2000 resamples of whole seed clusters; fixed opponent pool'};
}
if(['combos','combo-check'].includes(manifest.stage)){
 const ids=[...new Set(rows.map(r=>r.plan.combo.join('|')))];
 summary.combos=ids.map(id=>{
  const group=rows.filter(r=>r.plan.combo.join('|')===id),layouts=[...new Set(group.map(r=>JSON.stringify({leftOrient:r.plan.leftOrient,rightOrient:r.plan.rightOrient,spread:r.plan.spread})))];
  const choices=layouts.map(layout=>{const l=JSON.parse(layout),a=group.filter(r=>r.plan.leftOrient===l.leftOrient&&r.plan.rightOrient===l.rightOrient&&r.plan.spread===l.spread);return {layout:l,n:a.length,scorePct:100*mean(a.map(r=>r.score)),interval:interval(a)};}).toSorted((a,b)=>b.scorePct-a.scorePct);
  return {combo:id.split('|'),best:choices[0],choices,flag:choices[0].scorePct>65,selectionOnly:manifest.stage==='combos',holdout:manifest.stage==='combo-check'};
 });
 summary.scope=manifest.stage==='combos'?'Choose among eight mount layouts on seeds 0..n-1; flags are provisional until disjoint-seed check.':'Evaluate the previously selected layout on disjoint seeds 1000..; small sample warning applies.';
}
if(manifest.stage==='strength'){
 // Count both seats even for self-pairs. Each opponent then contributes equally,
 // rather than giving a category a different weight because it appears on the left.
 const directed=rows.flatMap(r=>[{item:r.plan.left,orient:r.plan.leftOrient,foe:r.plan.right,seed:r.plan.seed,score:r.score},{item:r.plan.right,orient:r.plan.rightOrient,foe:r.plan.left,seed:r.plan.seed,score:1-r.score}]);
 summary.items=manifest.defaultItems.map(item=>{
  const own=directed.filter(r=>r.item===item),vs=manifest.defaultItems.map(foe=>({foe,orient:['out','hug'].map(orient=>({orient,scorePct:100*mean(own.filter(r=>r.foe===foe&&r.orient===orient).map(r=>r.score))}))}));
  const orientations=['out','hug'].map(orient=>({orient,scorePct:mean(vs.map(v=>v.orient.find(o=>o.orient===orient).scorePct))})),best=orientations.toSorted((a,b)=>b.scorePct-a.scorePct)[0];
  // Collapse to equal-opponent scores per seed before bootstrapping whole seeds.
  const selected=[...new Set(own.map(r=>r.seed))].map(seed=>({plan:{seed},score:mean(manifest.defaultItems.map(foe=>mean(own.filter(r=>r.seed===seed&&r.foe===foe&&r.orient===best.orient).map(r=>r.score))))}));
  return {item,vs,orientations,best,interval:interval(selected),pass:best.scorePct<=65};
 });
}
await writeFile(new URL('summary.json',out),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
