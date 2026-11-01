// Offline R8 screen: change broom power only; no shipping rule writes. Full acceptance follows selection.
import {readFile, writeFile, mkdir, appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {simulateWithRules} from '../v3-top/variant.mjs';
const root=new URL('../../',import.meta.url),out=new URL('./results-broom-tune/',import.meta.url);
const files=['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','data/catalog.json','test/v3-top/variant.mjs','test/mvp/tune-broom.mjs'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const sources=Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(new URL(f,root)))])));
const items=['scissors','lamp-lux3d','broom','pan-lux3d','slipper','pillow'],powers=[.8,.7,.6],n=20;
await mkdir(out,{recursive:true});
const record=new URL('rounds.ndjson',out);
try { await readFile(record); throw Error('Use a new evidence directory; existing rows are not overwritten'); } catch(e) { if(e.code!=='ENOENT')throw e; }
await writeFile(new URL('manifest.json',out),JSON.stringify({sources,items,powers,n,planned:powers.length*items.length*4*n*2,scope:'Screen only: broom on left, six opponents, both orientations, paired AI seed swaps; no full R8 or mirror acceptance'},null,2)+'\n');
const rows=[],started=Date.now();
for(const power of powers){
 const sim=await simulateWithRules({top:{itemPower:{broom:power}}});
 for(const foe of items)for(const orient of ['out','hug'])for(const foeOrient of ['out','hug'])for(let seed=0;seed<n;seed++)for(const swap of [false,true]){
  const aiSeeds=[(seed^0x243f6a88)>>>0,(seed^0xb7e15162)>>>0];if(swap)aiSeeds.reverse();
  const r=await sim({fighters:[{parts:[{item:'broom',mount:'e0',orient}]},{parts:[{item:foe,mount:'e0',orient:foeOrient}]}],seed,manual:{sides:['ai','ai'],aiSeeds}});
  const row={power,foe,orient,foeOrient,seed,swap,score:r.meta.winner===0?1:r.meta.winner===null?.5:0,duration:r.meta.duration,replaySha256:hash(JSON.stringify(r))};
  rows.push(row);await appendFile(record,JSON.stringify(row)+'\n');
  if(rows.length%25===0)await writeFile(new URL('progress.json',out),JSON.stringify({count:rows.length,total:2880,at:new Date().toISOString(),wallSeconds:(Date.now()-started)/1000})+'\n');
 }
}
for(const[f,sha]of Object.entries(sources))if(hash(await readFile(new URL(f,root)))!==sha)throw Error('Source changed: '+f);
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const summary=powers.map(power=>({power,orientations:['out','hug'].map(orient=>({orient,scorePct:100*mean(rows.filter(r=>r.power===power&&r.orient===orient).map(r=>r.score)),vs:items.map(foe=>({foe,scorePct:100*mean(rows.filter(r=>r.power===power&&r.orient===orient&&r.foe===foe).map(r=>r.score))}))}))}));
await writeFile(new URL('summary.json',out),JSON.stringify({complete:true,count:rows.length,wallSeconds:(Date.now()-started)/1000,screenOnly:true,summary},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
