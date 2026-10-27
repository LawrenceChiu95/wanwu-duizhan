import {simulateV3,loadCatalog,loadV3Rules}from'../../sim/v3.js';
import {simulate}from'../../sim/index.js';
import {definition,metrics,median}from'./probe.mjs';
import {mkdir,writeFile,readFile}from'node:fs/promises';
import {createHash}from'node:crypto';
import {performance}from'node:perf_hooks';
const out=new URL('./batch/',import.meta.url);await mkdir(out,{recursive:true});
const items=await loadCatalog(),rows=[],examples={},start=performance.now();
const hash=s=>createHash('sha256').update(s).digest('hex');
for(const mode of ['A','B'])for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)for(let seed=1;seed<=5;seed++)for(const swap of [false,true]){
 const ids=swap?[items[j].id,items[i].id]:[items[i].id,items[j].id];
 const r=await simulateV3({fighters:ids.map(definition),mode,seed}),m=metrics(r);rows.push({left:ids[0],right:ids[1],mode,seed,...m});
 const weak=r.events.find(e=>e.weak),zeroParts=r.frames.find(fr=>fr.fighters.some(f=>f.parts.every(p=>!p.alive)&&f.core.hp>0));
 const cases={bothPartsBroken:zeroParts,weak,coreKoWithParts:r.meta.reason==='ko'&&r.frames.at(-1).fighters.some(f=>f.hp===0&&f.parts.some(p=>p.alive)),durationFailure:r.meta.duration<20||r.meta.duration>40,longGap:m.longestGap>6,lateFirst:m.first>1.5,longTail:m.tail>6,scrape:m.scrapeCount>0,largeCorrection:m.maxRadialCorrection>.05,maxResidual:r.meta.diagnostics.maxResidualPenetration>.005};
 for(const [key,yes]of Object.entries(cases))if(yes&&!examples[key]){const file=`example-${key}.json`;await writeFile(new URL(file,out),JSON.stringify(r));examples[key]={left:ids[0],right:ids[1],mode,seed,file,metrics:m,sha256:hash(JSON.stringify(r)),at:typeof yes==='object'?yes.t:null};}
}
const summary={rules:await loadV3Rules(),rounds:rows.length,seconds:(performance.now()-start)/1000,examples,modes:{}};
for(const mode of ['A','B']){
 const rs=rows.filter(r=>r.mode===mode),range=(key)=>({min:Math.min(...rs.map(r=>r[key]??Infinity)),median:median(rs.map(r=>r[key]).filter(v=>v!==null)),max:Math.max(...rs.map(r=>r[key]??-Infinity))});
 summary.modes[mode]={rounds:rs.length,duration:range('duration'),first:range('first'),medianGap:range('medianGap'),longestGap:range('longestGap'),tail:range('tail'),contactMaxGap:range('contactMaxGap'),durationPass:rs.filter(r=>r.duration>=20&&r.duration<=40).length,firstPass:rs.filter(r=>r.first!==null&&r.first<=1.5).length,medianGapPass:rs.filter(r=>r.medianGap!==null&&r.medianGap<=3).length,longestGapPass:rs.filter(r=>r.longestGap!==null&&r.longestGap<=6).length,allRhythmPass:rs.filter(r=>r.duration>=20&&r.duration<=40&&r.first!==null&&r.first<=1.5&&r.medianGap!==null&&r.medianGap<=3&&r.longestGap!==null&&r.longestGap<=6).length,draws:rs.filter(r=>r.winner===null).length,timeouts:rs.filter(r=>r.reason==='timeout').length,breaks:rs.reduce((n,r)=>n+r.breaks,0),scrapeCount:rs.reduce((n,r)=>n+r.scrapeCount,0),scrapeDuration:rs.reduce((n,r)=>n+r.scrapeDuration,0),maxScrapeDuration:Math.max(...rs.map(r=>r.maxScrapeDuration)),radialCorrectionSteps:rs.reduce((n,r)=>n+r.radialCorrectionSteps,0),maxRadialCorrection:Math.max(...rs.map(r=>r.maxRadialCorrection)),maxPositionCorrection:Math.max(...rs.map(r=>r.maxPositionCorrection)),maxResidual:Math.max(...rs.map(r=>r.residual)),zoneDamage:rs.reduce((n,r)=>n+r.zoneDamage,0),items:items.map(item=>{const own=rs.filter(r=>r.left===item.id||r.right===item.id),wins=own.filter(r=>r.winner!==null&&(r.winner===0?r.left:r.right)===item.id).length;return {id:item.id,rounds:own.length,wins,winRate:wins/own.length,losses:own.filter(r=>r.winner!==null).length-wins,draws:own.filter(r=>r.winner===null).length};})};
}
await writeFile(new URL('rounds.json',out),JSON.stringify(rows,null,2));await writeFile(new URL('summary.json',out),JSON.stringify(summary,null,2));
// Wren same-seed baseline. Geometry changes are explicit; not a controlled causal comparison.
const comparisons=[];
for(const [left,right]of [['broom','pot'],['scissors','pillow'],['lamp','slipper']])for(const mode of ['A','B']){
 const v1def=item=>({parts:[{item,mount:'core',rot:[0,0,0]}]});
 const before=await simulate({fighters:[v1def(left),v1def(right)],mode,seed:1}),after=await simulateV3({fighters:[definition(left),definition(right)],mode,seed:1});
 const oldTimes=[...new Set(before.events.filter(e=>['hit','crit','weak'].includes(e.type)).map(e=>e.t))],gaps=oldTimes.slice(1).map((t,i)=>t-oldTimes[i]);
 const old={duration:before.meta.duration,first:oldTimes[0],medianGap:median(gaps),longestGap:Math.max(...gaps),tail:before.meta.duration-oldTimes.at(-1),zoneDamage:before.events.filter(e=>e.type==='zone').reduce((n,e)=>n+e.damage,0)};
 for(const [name,r]of [['v1',before],['v3',after]])await writeFile(new URL(`./replays/${name}-${left}-${right}-${mode}.json`,import.meta.url),JSON.stringify(r));
 comparisons.push({left,right,mode,seed:1,before:old,after:metrics(after)});
}
await writeFile(new URL('comparisons.json',out),JSON.stringify(comparisons,null,2));
console.log(JSON.stringify({rounds:summary.rounds,seconds:summary.seconds,modes:summary.modes,examples:summary.examples},null,2));
