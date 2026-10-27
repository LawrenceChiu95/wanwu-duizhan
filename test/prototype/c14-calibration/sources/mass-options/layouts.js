import {simulate,loadCatalog} from './index.js';
import {summarize,outcomeStats,combatGoals} from './batch.js';
export const orientations=[{name:'forward',rot:[0,0,0]},{name:'horizontal',rot:[0,Math.PI/2,0]},{name:'vertical',rot:[-Math.PI/2,0,0]}];
const mounts=['front','top','side'];
function permutations(xs){return xs.length===0?[[]]:xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>j!==i)).map(rest=>[x,...rest]));}
/** Exactly 3! * 3^3 = 162 layouts for three distinct items. */
export function enumerateLayouts(items){
 if(items.length!==3||new Set(items).size!==3)throw Error('Select three distinct items');
 return permutations(items).flatMap(order=>orientations.flatMap(a=>orientations.flatMap(b=>orientations.map(c=>{
  const os=[a,b,c];return {id:order.map((item,i)=>`${mounts[i]}:${item}:${os[i].name}`).join('|'),fighter:{parts:order.map((item,i)=>({item,mount:mounts[i],rot:os[i].rot}))}};
 }))));
}
export async function runLayouts({items,seeds=[1,2,3],opponent,onResult=()=>{}}){
 const catalog=await loadCatalog();for(const id of items)if(!catalog.some(i=>i.id===id))throw Error(`Unknown item ${id}`);
 const layouts=enumerateLayouts(items),fixed=opponent??layouts[0].fighter,rows=[];
 for(const mode of ['A','B'])for(const seed of seeds)for(const layout of layouts){const start=performance.now(),r=await simulate({fighters:[layout.fighter,fixed],mode,seed});const row=summarize(r,{layout:layout.id,computeMs:performance.now()-start,mass:r.meta.initial[0].mass,centerOfMass:r.meta.initial[0].centerOfMass});rows.push(row);await onResult(row,r,layout,fixed);}
 return {rows,opponent:fixed,layouts};
}
export function findReversal(rows){
 // Prefer two contact finishes for an inspectable example; never change outcomes.
 for(const contactOnly of [true,false])for(const mode of ['A','B'])for(const seed of [...new Set(rows.map(r=>r.seed))]){
  const rs=rows.filter(r=>r.mode===mode&&r.seed===seed&&(!contactOnly||(r.finishType==='contact'&&!r.simultaneousKo))&&r.duration>=20);
  const win=rs.find(r=>r.winner===0),loss=rs.find(r=>r.winner===1);if(win&&loss)return {mode,seed,win,loss};
 }
 return null;
}
if(typeof process!=='undefined'&&process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 const fs=await import('node:fs/promises');const items=process.argv[2]?.split(',');if(!items)throw Error('Usage: node sim/layouts.js item1,item2,item3 [output-directory]');
 const out=process.argv[3]??'test/prototype/layouts';await fs.mkdir(out,{recursive:true});const start=performance.now();let count=0;
 const {rows,opponent,layouts}=await runLayouts({items,onResult:()=>{if(++count%50===0)console.log('completed',count);}}),reversal=findReversal(rows);
 const summary={items,opponent,layouts:layouts.length,rounds:rows.length,wallSeconds:(performance.now()-start)/1000,modes:Object.fromEntries(['A','B'].map(mode=>{const r=rows.filter(x=>x.mode===mode),outcomes=outcomeStats(r),rates=layouts.map(l=>{const rs=r.filter(x=>x.layout===l.id);return {layout:l.id,wins:rs.filter(x=>x.winner===0).length,rounds:rs.length,rate:rs.filter(x=>x.winner===0).length/rs.length};}).sort((a,b)=>a.rate-b.rate),spread=rates.at(-1).rate-rates[0].rate,checks={...combatGoals(outcomes),layoutDifference:spread>=.4};return[mode,{outcomes,goals:{checks,passed:Object.values(checks).every(Boolean)},bestLayout:rates.at(-1),worstLayout:rates[0],layoutWinRateSpread:spread,wins:r.filter(x=>x.winner===0).length,losses:r.filter(x=>x.winner===1).length,draws:r.filter(x=>x.winner===null).length,averageDuration:r.reduce((s,x)=>s+x.duration,0)/r.length,timeouts:r.filter(x=>x.reason==='timeout').length,maxContact:Math.max(...r.map(x=>x.longestContact))}];})),reversal};
 await fs.writeFile(`${out}/rounds.json`,JSON.stringify(rows,null,2)+'\n');await fs.writeFile(`${out}/summary.json`,JSON.stringify(summary,null,2)+'\n');
 const keys=Object.keys(rows[0]),quote=v=>`"${String(typeof v==='object'?JSON.stringify(v):v??'').replaceAll('"','""')}"`;await fs.writeFile(`${out}/rounds.csv`,[keys.join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\n')+'\n');
 if(reversal)for(const kind of ['win','loss']){const selected=layouts.find(l=>l.id===reversal[kind].layout);const replay=await simulate({fighters:[selected.fighter,opponent],mode:reversal.mode,seed:reversal.seed});await fs.writeFile(`${out}/reversal-${kind}.json`,JSON.stringify(replay));}
 console.log(JSON.stringify(summary,null,2));
}
