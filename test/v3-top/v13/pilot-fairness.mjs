// Fixed small diagnosis before the full paired run. No parameter search or winner-dependent scene selection.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {simulateV3} from '../../../sim/v3.js';
import {fixtures,sha,options} from './experiment.mjs';
const out=new URL('./results-r2/',import.meta.url);await mkdir(out,{recursive:true});
const source=sha(await readFile(new URL('../../../sim/v3.js',import.meta.url))),rows=[];
for(const f of fixtures){
 for(let seed=0;seed<20;seed++)for(const swapped of [false,true]){
  const aiSeeds=[(seed^0x243f6a88)>>>0,(seed^0xb7e15162)>>>0];if(swapped)aiSeeds.reverse();
  const o=options(f,seed,'timing');o.fighters=[f.definition,f.definition];o.manual.aiSeeds=aiSeeds;
  const r=await simulateV3(o);rows.push({fixture:f.id,seed,swapped,aiSeeds,winner:r.meta.winner,duration:r.meta.duration,sha256:sha(r)});
 }
}
assert.equal(source,sha(await readFile(new URL('../../../sim/v3.js',import.meta.url))));
const summary=fixtures.map(f=>{const rs=rows.filter(x=>x.fixture===f.id),pairs=rs.filter(x=>!x.swapped).map(x=>[x.winner,rs.find(y=>y.seed===x.seed&&y.swapped).winner]);return {fixture:f.id,score:rs.reduce((n,x)=>n+(x.winner===0?1:x.winner===null?.5:0),0)/rs.length,follow:pairs.filter(([a,b])=>a!==null&&b!==null&&a===1-b).length,pairs:pairs.length};});
await writeFile(new URL('pilot.json',out),JSON.stringify({source,rows,summary},null,2)+'\n');console.log(JSON.stringify(summary));
