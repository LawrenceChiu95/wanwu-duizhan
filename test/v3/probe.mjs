import {simulateV3} from '../../sim/v3.js';
import {writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
// Battle-top test build: the named item swings out at e0, a hugging second piece sits opposite.
export const definition=item=>({parts:[{item,mount:'e0',orient:'out'},{item:item==='slipper'?'pot':'slipper',mount:'e180',orient:'hug'}]});
export const median=values=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
export function metrics(r){
 const times=[...new Set(r.events.filter(e=>['hit','weak','crit'].includes(e.type)&&e.damage>0).map(e=>e.t))],contacts=r.events.filter(e=>e.type==='contact'&&e.impulse>=r.meta.rules.minimumImpulse).map(e=>e.t),gaps=times.slice(1).map((t,i)=>t-times[i]),cg=contacts.slice(1).map((t,i)=>t-contacts[i]);
 return {duration:r.meta.duration,winner:r.meta.winner,reason:r.meta.reason,first:times[0]??null,medianGap:median(gaps),longestGap:gaps.length?Math.max(...gaps):null,tail:times.length?r.meta.duration-times.at(-1):r.meta.duration,hits:times.length,contactFirst:contacts[0]??null,contactMedianGap:median(cg),contactMaxGap:cg.length?Math.max(...cg):null,breaks:r.events.filter(e=>e.type==='break').length,hp:r.frames.at(-1).fighters.map(f=>f.hp),partsHp:r.frames.at(-1).fighters.map(f=>f.parts.map(p=>p.hp)),residual:r.meta.diagnostics.maxResidualPenetration,scrapeCount:r.meta.diagnostics.scrapeCount,scrapeDuration:r.meta.diagnostics.scrapeDuration,maxScrapeDuration:r.meta.diagnostics.maxScrapeDuration,radialCorrectionSteps:r.meta.diagnostics.radialCorrectionSteps,maxRadialCorrection:r.meta.diagnostics.maxRadialCorrection,maxPositionCorrection:r.meta.diagnostics.maxPositionCorrection,zoneDamage:r.events.filter(e=>e.type==='zone').reduce((s,e)=>s+e.damage,0)};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const rows=[],start=performance.now();
 for(const mode of ['A','B'])for(const [a,b]of [['broom','pot'],['scissors','pillow'],['lamp','slipper']])for(const seed of [1,2,3]){
  const r=await simulateV3({fighters:[definition(a),definition(b)],mode,seed});rows.push({a,b,mode,seed,...metrics(r)});
  if(process.env.SAVE_REPLAYS&&seed===1){await mkdir('test/v3/replays',{recursive:true});await writeFile(`test/v3/replays/${a}-${b}-${mode}.json`,JSON.stringify(r));}
 }
 console.log(JSON.stringify({seconds:(performance.now()-start)/1000,rows}));
}
