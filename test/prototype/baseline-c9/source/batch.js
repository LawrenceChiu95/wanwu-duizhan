import {simulate,loadCatalog} from './index.js';
export const single=item=>({parts:[{item,mount:'core',rot:[0,0,0]}]});
export function summarize(r,label={}){
 const hits=r.events.filter(e=>['hit','crit','weak'].includes(e.type));
 return {...label,seed:r.meta.seed,mode:r.meta.mode,winner:r.meta.winner,reason:r.meta.reason,finishType:r.decisive.finishType,duration:r.meta.duration,impacts:hits.length/2,crit:hits.filter(e=>e.type==='crit'||e.type==='weak').length,weak:hits.filter(e=>e.type==='weak').length,zoneDamage:r.events.filter(e=>e.type==='zone').reduce((s,e)=>s+e.damage,0),decisive:r.decisive.caption,decisiveEvent:r.events[r.decisive.eventIndex]?.type??null,maxPenetration:r.meta.diagnostics.maxPenetration,longestContact:r.meta.diagnostics.longestContact};
}
export async function runBatch({seeds=[1,2,3,4,5],onResult=()=>{}}={}){
 const items=(await loadCatalog()).filter(i=>!i.comparisonBase),rows=[];
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
if(typeof process!=='undefined'&&process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 const fs=await import('node:fs/promises');const out=process.argv[2]??'test/prototype/batch';await fs.mkdir(out,{recursive:true});const start=performance.now();let rowsCount=0;
 const rows=await runBatch({onResult:async(row,replay)=>{if(row.seed===1&&[['broom','pot'],['scissors','pillow'],['lamp','slipper']].some(([a,b])=>row.left===a&&row.right===b))await fs.writeFile(`${out}/replay-${row.left}-${row.right}-${row.mode}.json`,JSON.stringify(replay));if(rowsCount++%10===0)console.log('completed',rowsCount,row.left,row.right,row.mode);}});
 const ids=(await loadCatalog()).filter(i=>!i.comparisonBase).map(i=>i.id),summary={rounds:rows.length,wallSeconds:(performance.now()-start)/1000,modes:Object.fromEntries(['A','B'].map(mode=>{const rs=rows.filter(r=>r.mode===mode);return[mode,{averageDuration:rs.reduce((s,r)=>s+r.duration,0)/rs.length,under20:rs.filter(r=>r.duration<20).length,timeouts:rs.filter(r=>r.reason==='timeout').length,ringouts:rs.filter(r=>r.reason==='ringout').length,matrix:winMatrix(rows,ids,mode),records:ids.map(item=>{const all=rs.filter(r=>r.left===item||r.right===item);return {item,wins:all.filter(r=>r.winner===(r.left===item?0:1)).length,losses:all.filter(r=>r.winner!==null&&r.winner!==(r.left===item?0:1)).length,draws:all.filter(r=>r.winner===null).length};})}];}))};
 await fs.writeFile(`${out}/rounds.json`,JSON.stringify(rows,null,2)+'\n');await fs.writeFile(`${out}/summary.json`,JSON.stringify(summary,null,2)+'\n');
 const keys=Object.keys(rows[0]),csv=v=>`"${String(v??'').replaceAll('"','""')}"`;await fs.writeFile(`${out}/rounds.csv`,[keys.join(','),...rows.map(r=>keys.map(k=>csv(r[k])).join(','))].join('\n')+'\n');console.log(JSON.stringify(summary,null,2));
 const comparison=await runGeneratedComparison(rows);await fs.writeFile(`${out}/lux3d-comparison.json`,JSON.stringify(comparison,null,2)+'\n');
 const ck=Object.keys(comparison.summary[0]);await fs.writeFile(`${out}/lux3d-comparison.csv`,[ck.join(','),...comparison.summary.map(r=>ck.map(k=>csv(r[k])).join(','))].join('\n')+'\n');
}
