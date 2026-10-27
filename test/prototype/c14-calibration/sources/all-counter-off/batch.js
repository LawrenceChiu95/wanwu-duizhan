import {simulate,loadCatalog,loadRules} from './index.js';
export const single=item=>({parts:[{item,mount:'core',rot:[0,0,0]}]});
export function summarize(r,label={}){
 const hits=r.events.filter(e=>['hit','crit','weak'].includes(e.type));
 return {...label,seed:r.meta.seed,mode:r.meta.mode,winner:r.meta.winner,reason:r.meta.reason,simultaneousKo:r.meta.simultaneousKo,resolvedByAttacker:r.meta.resolvedByAttacker,finishType:r.decisive.finishType,duration:r.meta.duration,impacts:hits.length/2,crit:hits.filter(e=>e.type==='crit'||e.type==='weak').length,weak:hits.filter(e=>e.type==='weak').length,zoneDamage:r.events.filter(e=>e.type==='zone').reduce((s,e)=>s+e.damage,0),decisive:r.decisive.caption,decisiveEvent:r.events[r.decisive.eventIndex]?.type??null,maxPenetration:r.meta.diagnostics.maxPenetration,maxResidualPenetration:r.meta.diagnostics.maxResidualPenetration,maxPositionCorrection:r.meta.diagnostics.maxPositionCorrection,correctionSteps:r.meta.diagnostics.correctionSteps,longestContact:r.meta.diagnostics.longestContact};
}
export function outcomeStats(rows){
 const ds=rows.map(r=>r.duration).sort((a,b)=>a-b),n=rows.length;
 const finishes=rows.reduce((counts,r)=>(counts[r.finishType]=(counts[r.finishType]??0)+1,counts),{});
 return {rounds:n,finishes,draws:rows.filter(r=>r.winner===null).length,simultaneousKOs:rows.filter(r=>r.simultaneousKo).length,resolvedByAttacker:rows.filter(r=>r.resolvedByAttacker).length,timeouts:rows.filter(r=>r.reason==='timeout').length,under20:ds.filter(t=>t<20).length,under8:ds.filter(t=>t<8).length,min:ds[0],q1:ds[Math.floor(n/4)],median:ds[Math.floor(n/2)],q3:ds[Math.floor(n*3/4)],max:ds.at(-1)};
}
export function combatGoals(stats){return {contact:(stats.finishes.contact??0)+(stats.finishes.ringout??0)>=stats.rounds*.6,zone:(stats.finishes.zone??0)<=stats.rounds*.3,duration:stats.median>=25&&stats.median<=45,short:stats.under20<=stats.rounds*.1&&stats.under8===0,draws:stats.draws<=stats.rounds*.1,timeouts:stats.timeouts<=stats.rounds*.1,simultaneous:stats.simultaneousKOs<stats.rounds*.05};}
export function singleGoals(rows){
 const stats=outcomeStats(rows),pairs=new Map();for(const r of rows){const key=r.left+'|'+r.right;if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(r);}
 const favoredPairs=[...pairs.values()].filter(rs=>Math.max(...[0,1].map(side=>rs.filter(r=>r.winner===side).length))/rs.length>=.65).length;
 const ids=[...new Set(rows.flatMap(r=>[r.left,r.right]))],records=ids.map(id=>{const rs=rows.filter(r=>r.left===id||r.right===id);return {item:id,rounds:rs.length,wins:rs.filter(r=>r.winner===(r.left===id?0:1)).length,losses:rs.filter(r=>r.winner!==null&&r.winner!==(r.left===id?0:1)).length};});
 const undefeatedAll=records.filter(r=>r.wins===r.rounds||r.losses===r.rounds).map(r=>r.item);
 const matchups=records.map(record=>{const opponents=ids.filter(id=>id!==record.item).map(opponent=>{const rs=rows.filter(r=>(r.left===record.item&&r.right===opponent)||(r.right===record.item&&r.left===opponent));const wins=rs.filter(r=>r.winner===(r.left===record.item?0:1)).length;return {opponent,wins,rounds:rs.length,rate:wins/rs.length};});return {...record,rate:record.wins/record.rounds,opponents,hasWinnableOpponent:opponents.some(p=>p.rate>=.5)};});
 const checks={...combatGoals(stats),matchupDifference:favoredPairs>=pairs.size/3,noAllWinOrLoss:undefeatedAll.length===0,noOver80:matchups.every(r=>r.rate<=.8)};
 return {stats,favoredPairs,totalPairs:pairs.size,undefeatedAll,records:matchups,reported:{eachHasWinnableOpponent:matchups.every(r=>r.hasWinnableOpponent)},checks,passed:Object.values(checks).every(Boolean)};
}
export async function runBatch({seeds=[1,2,3,4,5],includeGenerated=false,onResult=()=>{}}={}){
 const items=(await loadCatalog()).filter(i=>includeGenerated||!i.comparisonBase),rows=[];
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)for(const mode of ['A','B'])for(const seed of seeds){const start=performance.now();const replay=await simulate({fighters:[single(items[i].id),single(items[j].id)],mode,seed});const row=summarize(replay,{left:items[i].id,right:items[j].id,computeMs:performance.now()-start});rows.push(row);await onResult(row,replay);}
 return rows;
}
/** Replace one mesh at the same left/right position against the same five opponents. */
export async function runGeneratedComparison(baseline){
 const items=await loadCatalog(),rows=[];
 for(const variant of items.filter(i=>i.comparisonBase)){
  const originals=baseline.filter(r=>r.left===variant.comparisonBase||r.right===variant.comparisonBase);
  for(const original of originals){
   const left=original.left===variant.comparisonBase?variant.id:original.left;
   const right=original.right===variant.comparisonBase?variant.id:original.right;
   const start=performance.now(),replay=await simulate({fighters:[single(left),single(right)],mode:original.mode,seed:original.seed});
   rows.push(summarize(replay,{left,right,variant:variant.id,base:variant.comparisonBase,originalWinner:original.winner,originalDuration:original.duration,computeMs:performance.now()-start}));
  }
 }
 const summary=items.filter(i=>i.comparisonBase).flatMap(variant=>['A','B'].map(mode=>{
  const rs=rows.filter(r=>r.variant===variant.id&&r.mode===mode);
  const wins=rs.filter(r=>r.winner===(r.left===variant.id?0:1)).length;
  const originalWins=rs.filter(r=>r.originalWinner===(r.left===variant.id?0:1)).length;
  const duration=rs.reduce((s,r)=>s+r.duration,0)/rs.length,originalDuration=rs.reduce((s,r)=>s+r.originalDuration,0)/rs.length;
  return {variant:variant.id,base:variant.comparisonBase,mode,rounds:rs.length,originalWins,wins,originalWinRate:originalWins/rs.length,winRate:wins/rs.length,winRateDifference:(wins-originalWins)/rs.length,originalDuration,averageDuration:duration,durationDifference:duration-originalDuration};
 }));
 return {rows,summary};
}
export function winMatrix(rows,ids,mode){return ids.map(left=>({item:left,...Object.fromEntries(ids.map(right=>{if(left===right)return[right,'—'];const rs=rows.filter(r=>r.mode===mode&&((r.left===left&&r.right===right)||(r.left===right&&r.right===left)));return[right,`${rs.filter(r=>r.winner===(r.left===left?0:1)).length}/${rs.length}`];}))}));}
export function counterOutcomes(rows,catalog){
 const result=[];
 for(let i=0;i<catalog.items.length;i++)for(const b of catalog.items.slice(i+1)){
  const a=catalog.items[i],forward=(catalog.matchups[a.tag]?.[b.tag]??1)>1,reverse=(catalog.matchups[b.tag]?.[a.tag]??1)>1;if(!forward&&!reverse)continue;
  const favored=forward?a:b,countered=forward?b:a;
  for(const mode of ['A','B']){const rs=rows.filter(r=>r.mode===mode&&((r.left===a.id&&r.right===b.id)||(r.left===b.id&&r.right===a.id)));if(!rs.length)continue;
   const wins=rs.filter(r=>r.winner===(r.left===countered.id?0:1)).length;result.push({mode,favored:favored.id,countered:countered.id,wins,rounds:rs.length,rate:wins/rs.length,inTarget:wins/rs.length>=.1&&wins/rs.length<=.4});
  }
 }
 return result;
}
if(typeof process!=='undefined'&&process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 const fs=await import('node:fs/promises');const out=process.argv[2]??'test/prototype/batch';await fs.mkdir(out,{recursive:true});const start=performance.now();let rowsCount=0;
 const mechanics={weakContacts:0,weakTriggered:0,criticalOverNormalCap:0,critical:null,missed:null,counterRoleChange:null};
 const rows=await runBatch({includeGenerated:true,onResult:async(row,replay)=>{
  if(row.seed===1&&[['broom','pot'],['scissors','pillow'],['lamp','slipper']].some(([a,b])=>row.left===a&&row.right===b))await fs.writeFile(`${out}/replay-${row.left}-${row.right}-${row.mode}.json`,JSON.stringify(replay));
  for(const e of replay.events.filter(e=>e.item)){
   if(e.weakContact)mechanics.weakContacts++;if(e.weak)mechanics.weakTriggered++;
   const receipt={left:row.left,right:row.right,mode:row.mode,seed:row.seed,event:e};
   if(e.role==='attack'&&e.weak&&e.damage>replay.meta.initial[e.target].maxHp*.3){mechanics.criticalOverNormalCap++;mechanics.critical??=receipt;}
   if(e.role==='attack'&&e.weakContact&&!e.weak)mechanics.missed??=receipt;
   const rawScores=e.attackScores.map((v,i)=>v/e.matchupMultipliers[i]);
   const originalAttacker=Math.abs(rawScores[0]-rawScores[1])>1e-8?(rawScores[0]>rawScores[1]?0:1):(row.seed&1);
   if(originalAttacker!==e.strikeAttacker)mechanics.counterRoleChange??={...receipt,withoutCounter:{rawScores,attacker:originalAttacker}};
  }
  if(rowsCount++%10===0)console.log('completed',rowsCount,row.left,row.right,row.mode);
 }});
 const items=await loadCatalog(),ids=items.map(i=>i.id),originalIds=items.filter(i=>!i.comparisonBase).map(i=>i.id),originals=rows.filter(r=>originalIds.includes(r.left)&&originalIds.includes(r.right));
 const summarizeModes=(data,list)=>Object.fromEntries(['A','B'].map(mode=>{const rs=data.filter(r=>r.mode===mode);return[mode,{averageDuration:rs.reduce((s,r)=>s+r.duration,0)/rs.length,goals:singleGoals(rs),matrix:winMatrix(data,list,mode)}];}));
 const summary={rounds:rows.length,wallSeconds:(performance.now()-start)/1000,modes:summarizeModes(rows,ids),originals:{rounds:originals.length,modes:summarizeModes(originals,originalIds)},counterOutcomes:counterOutcomes(rows,await loadRules())};
 await fs.writeFile(`${out}/rounds.json`,JSON.stringify(rows,null,2)+'\n');await fs.writeFile(`${out}/summary.json`,JSON.stringify(summary,null,2)+'\n');
 await fs.writeFile(`${out}/mechanics-evidence.json`,JSON.stringify(mechanics,null,2)+'\n');
 const keys=Object.keys(rows[0]),csv=v=>`"${String(v??'').replaceAll('"','""')}"`;await fs.writeFile(`${out}/rounds.csv`,[keys.join(','),...rows.map(r=>keys.map(k=>csv(r[k])).join(','))].join('\n')+'\n');console.log(JSON.stringify(summary,null,2));
 const comparison=await runGeneratedComparison(originals);await fs.writeFile(`${out}/lux3d-comparison.json`,JSON.stringify(comparison,null,2)+'\n');
 const ck=Object.keys(comparison.summary[0]);await fs.writeFile(`${out}/lux3d-comparison.csv`,[ck.join(','),...comparison.summary.map(r=>ck.map(k=>csv(r[k])).join(','))].join('\n')+'\n');
}
