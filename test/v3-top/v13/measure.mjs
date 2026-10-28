import assert from 'node:assert/strict';
import {probe,impactSpeeds} from '../impact-probe.mjs';
import {sha,median} from './experiment.mjs';
const distance=fs=>Math.hypot(...fs[0].centerOfMass.map((x,i)=>x-fs[1].centerOfMass[i]));
export async function measure(run){
 const {result:r,steps}=await probe(run),{events,meta}=r;
 const damage=events.filter(e=>e.damage>0),attack=damage.filter(e=>e.role==='attack'),times=[...new Set(attack.map(e=>e.t))],gaps=times.slice(1).map((t,i)=>t-times[i]);
 const {impacts,rubs}=impactSpeeds(r,steps,meta.rules.dt);
 const at=t=>distance((r.frames.find(f=>f.t>=t-1e-9)??r.frames.at(-1)).fighters);
 const separation=times.filter(t=>t+.25<=meta.duration).map(t=>(at(t+.25)-at(t+.05))/.2);
 for(const e of damage){assert(events.some(c=>c.type==='contact'&&c.t===e.t));assert(e.damage<=e.damageCap*e.roleMultiplier*(e.dash?1.25:1)+1e-8);}
 for(const ep of meta.diagnostics.scrapeEpisodes)assert(!damage.some(e=>e.t>ep.start+.1+1e-8&&e.t<=ep.end+1e-8));
 const actions=[0,1].map(side=>({
  press:events.filter(e=>e.type==='press'&&e.side===side).length,
  dash:events.filter(e=>e.type==='dash'&&e.phase==='go'&&e.side===side).length,
  dashEnd:Object.fromEntries(['full','glance','miss','blocked'].map(k=>[k,events.filter(e=>e.type==='dash'&&e.phase==='end'&&e.side===side&&e.quality===k).length])),
  block:events.filter(e=>e.type==='block'&&e.side===side).length,
  perfect:events.filter(e=>e.type==='blockResult'&&e.side===side&&e.outcome==='perfect').length,
  contactOnly:events.filter(e=>e.type==='blockResult'&&e.side===side&&e.outcome==='perfect'&&e.damageApplied===false).length,
  empty:events.filter(e=>e.type==='blockResult'&&e.side===side&&e.outcome==='empty').length
 }));
 const first=times[0]??null,medianGap=median(gaps),maxGap=gaps.length?Math.max(...gaps):null;
 return {replay:r,row:{winner:meta.winner,reason:meta.reason,duration:meta.duration,score:meta.winner===0?1:meta.winner===null?.5:0,
  first,medianGap,maxGap,hits:times.length,pacePass:meta.duration>=20&&meta.duration<=40&&first!==null&&first<=1.5&&medianGap!==null&&medianGap<=3&&maxGap<=6,
  approachMedian:median(impacts.map(x=>x.approach)),separationMedian:median(separation),rubs,
  scrapeCount:meta.diagnostics.scrapeCount,scrapeDuration:meta.diagnostics.scrapeDuration,maxScrapeDuration:meta.diagnostics.maxScrapeDuration,
  residual:meta.diagnostics.maxResidualPenetration,actions,aiSeeds:meta.manual?.aiSeeds??null,aiPressSha256:meta.manual?[0,1].map(side=>sha(events.filter(e=>e.type==='press'&&e.side===side).map(e=>({step:Math.round(e.t/meta.rules.dt),action:e.action})))):null,replaySha256:sha(r)}};
}
