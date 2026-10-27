// Quick look at a few top matches. Usage: node test/v3-top/probe.mjs [mode]
import {simulateV3} from '../../sim/v3.js';
import {metrics} from '../v3/probe.mjs';
import {performance} from 'node:perf_hooks';
export const top=(a,pa,b,pb,spread='e180')=>({parts:[{item:a,mount:'e0',orient:pa},{item:b,mount:spread,orient:pb}]});
if(process.argv[1]===new URL(import.meta.url).pathname){
 const mode=process.argv[2]??'A';
 const cases=[[top('broom','out','pan-lux3d','hug'),top('lamp-lux3d','out','pillow','hug')],[top('scissors','out','slipper','out'),top('pan-lux3d','out','broom','hug')],[top('pillow','hug','pan-lux3d','hug'),top('broom','out','scissors','out')]];
 for(const [a,b] of cases)for(const seed of [1,2,3]){
  const t0=performance.now(),r=await simulateV3({fighters:[a,b],mode,seed}),ms=performance.now()-t0,m=metrics(r);
  const contacts=r.events.filter(e=>e.type==='contact'),cs=contacts.map(e=>e.closingSpeed).sort((x,y)=>x-y);
  console.log(JSON.stringify({seed,ms:Math.round(ms),dur:+m.duration.toFixed(2),win:m.winner,first:m.first,med:m.medianGap&&+m.medianGap.toFixed(2),max:m.longestGap&&+m.longestGap.toFixed(2),tail:+m.tail.toFixed(2),hits:m.hits,breaks:m.breaks,contacts:contacts.length,closeMed:cs.length?+cs[cs.length>>1].toFixed(2):null,scrape:m.scrapeCount,maxCorr:+r.meta.diagnostics.maxPositionCorrection.toFixed(3),maxPen:+r.meta.diagnostics.maxGeometricPenetration.toFixed(3)}));
 }
}
