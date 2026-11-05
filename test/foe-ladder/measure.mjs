// Seed-paired, role-mirrored batches. Tuning and holdout are separate runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {simulateV3} from '../../sim/v3.js';
import {random} from '../../sim/math.js';
const {values:v}=parseArgs({options:{phase:{type:'string'},out:{type:'string'},count:{type:'string'},freeze:{type:'string'},baseline:{type:'boolean'}}});
if(!['tune','holdout'].includes(v.phase)||!path.isAbsolute(v.out??''))throw Error('phase tune|holdout and absolute out required');
const count=+(v.count??(v.phase==='tune'?30:100));
if(!Number.isInteger(count)||count<1||count>(v.phase==='tune'?30:100))throw Error('Bad seed count');
const definitions=[
 ['default',['pan-lux3d','pillow'],['out','hug'],'e180'],
 ['long-wide',['broom','pillow'],['out','out'],'e90'],
 ['pan-shoe',['pan-lux3d','slipper'],['out','out'],'e90'],
 ['guard',['pan-lux3d','pillow'],['hug','hug'],'e180'],
 ['long-guard',['broom','pillow'],['out','hug'],'e180'],
 ['short-sharp',['pan-lux3d','scissors'],['hug','out'],'e90']
];
const builds=definitions.map(([id,items,orients,spread])=>({id,build:{parts:items.map((item,i)=>({item,orient:orients[i],mount:i?spread:'e0'}))}}));
const toBuild=b=>({parts:b.parts.map((p,i)=>({...p,mount:i?b.spread:'e0'}))});
const foes=JSON.parse(await fs.readFile(new URL('../../data/foes.json',import.meta.url))).foes;
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceHash=sha(await fs.readFile(new URL('../../sim/v3.js',import.meta.url)));
let chosen=builds;
if(v.phase==='holdout'){
 if(!path.isAbsolute(v.freeze??''))throw Error('Holdout requires an explicit frozen manifest');
 const frozen=JSON.parse(await fs.readFile(v.freeze,'utf8'));
 if(frozen.simSha!==sourceHash||JSON.stringify(frozen.foes)!==JSON.stringify(foes))throw Error('Frozen AI or sim changed');
 chosen=frozen.playerBuilds.map(id=>builds.find(b=>b.id===id));
 if(chosen.length!==3||chosen.some(b=>!b)||new Set(chosen).size!==3)throw Error('Freeze three distinct known builds');
}
await fs.mkdir(v.out,{recursive:true});
// Never silently replace a prior batch or reuse holdout after tuning against it.
const stream=await fs.open(path.join(v.out,'rounds.jsonl'),'wx');
const startSeed=v.phase==='tune'?860000:861000;
const manifest={phase:v.phase,startSeed,count,simSha:sourceHash,foes,playerBuilds:chosen.map(b=>b.id),baseline:Boolean(v.baseline),started:new Date().toISOString()};
await fs.writeFile(path.join(v.out,'manifest.json'),JSON.stringify(manifest,null,2));
const rows=[];
function inputs(side){const a=[];for(let step=60;step<7200;step+=552)a.push({step,side,action:'dash'});for(let step=300;step<7200;step+=624)a.push({step,side,action:'block'});return a.sort((a,b)=>a.step-b.step);}
const q=(a,p)=>{const s=a.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:null;};
function aiStats(events,side,profile){
 const presses=events.filter(e=>e.type==='press'&&e.side===side),ends=events.filter(e=>e.type==='dash'&&e.phase==='end'&&e.side===side),blocks=events.filter(e=>e.type==='blockResult'&&e.side===side);
 let violations=0,idleDashes=0,lastDash=0,counterUntil=-Infinity;
 for(const e of events){if(e.type==='press'&&e.side===side&&e.action==='dash'){if(e.t>counterUntil){if(profile?.id==='wen'&&e.t-lastDash>=profile.idleDashAfter-1e-8)idleDashes++;else violations++;}lastDash=e.t;}if(e.type==='dash'&&e.phase==='end'&&e.side===1-side)counterUntil=Math.max(counterUntil,e.t+2.4);if(e.type==='blockResult'&&e.side===side&&e.outcome==='perfect')counterUntil=Math.max(counterUntil,e.t+.8);}
 return {presses:presses.length,dashes:presses.filter(e=>e.action==='dash').length,blocks:presses.filter(e=>e.action==='block').length,ends:ends.length,misses:ends.filter(e=>e.outcome==='miss').length,hits:ends.filter(e=>e.outcome==='hit').length,blocked:ends.filter(e=>e.outcome==='blocked').length,perfect:blocks.filter(e=>e.outcome==='perfect').length,empty:blocks.filter(e=>e.outcome==='empty').length,counterViolations:profile?.id==='wen'?violations:null,idleDashes:profile?.id==='wen'?idleDashes:null};
}
try{
 for(const kind of v.baseline?['profile','legacy']:['profile'])for(const f of foes)for(const proxy of ['skilled','mash','none'])for(const b of proxy==='none'?[builds[0]]:chosen)for(let n=0;n<count;n++)for(const mirror of [false,true]){
  if(kind==='legacy'&&b.id!=='default')continue;
  const seed=startSeed+n,playerSide=mirror?1:0,foeSide=1-playerSide;
  const fighters=mirror?[toBuild(f.build),b.build]:[b.build,toBuild(f.build)],aiSeeds=[(seed^0x243f6a88)>>>0,(seed^0xb7e15162)>>>0];if(mirror)aiSeeds.reverse();
  const sides=proxy==='skilled'?['ai','ai']:mirror?['ai','input']:['input','ai'];
  const manual={sides,aiSeeds,inputs:proxy==='mash'?inputs(playerSide):[],...(kind==='profile'&&{aiProfiles:mirror?[f.ai,null]:[null,f.ai]})};
  const r=await simulateV3({fighters,seed,manual});
  const row={kind,foe:f.id,proxy,build:b.id,seed,mirror,winner:r.meta.winner,win:r.meta.winner===playerSide,draw:r.meta.winner===null,duration:r.meta.duration,reason:r.meta.reason,firstContact:r.events.find(e=>e.type==='contact')?.t??null,foeStats:aiStats(r.events,foeSide,kind==='profile'?f.ai:null)};
  rows.push(row);await stream.write(JSON.stringify(row)+'\n');
  if(n===0&&!mirror&&b.id==='default'&&kind==='profile')await fs.writeFile(path.join(v.out,f.id+'-'+proxy+'-sample.json'),JSON.stringify(r));
  if(rows.length%60===0){await fs.writeFile(path.join(v.out,'progress.json'),JSON.stringify({rows:rows.length,last:{kind,foe:f.id,proxy,build:b.id,seed},at:new Date().toISOString()}));console.log(JSON.stringify({rows:rows.length,foe:f.id,proxy,build:b.id}));}
 }
}finally{await stream.close();}
const groups=new Map();for(const row of rows){const key=[row.kind,row.foe,row.proxy,row.build].join('/');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
const summary={...manifest,finished:new Date().toISOString(),rows:rows.length,groups:{}};
for(const [key,rs]of groups){
 const pairs=new Map();for(const r of rs){if(!pairs.has(r.seed))pairs.set(r.seed,[]);pairs.get(r.seed).push(r.win?1:0);}
 const values=[...pairs.values()].map(a=>a.reduce((s,x)=>s+x,0)/a.length),roll=random(862000),samples=[];
 for(let n=0;n<10000;n++){let sum=0;for(let i=0;i<values.length;i++)sum+=values[Math.floor(roll()*values.length)];samples.push(sum/values.length);}
 const sums={};for(const r of rs)for(const [k,x]of Object.entries(r.foeStats))sums[k]=x===null?null:(sums[k]??0)+x;
 summary.groups[key]={games:rs.length,wins:rs.filter(r=>r.win).length,draws:rs.filter(r=>r.draw).length,winRate:rs.filter(r=>r.win).length/rs.length,paired95:[q(samples,.025),q(samples,.975)],duration:{p10:q(rs.map(r=>r.duration),.1),median:q(rs.map(r=>r.duration),.5),p90:q(rs.map(r=>r.duration),.9),max:q(rs.map(r=>r.duration),1)},over40:rs.filter(r=>r.duration>40).length,timeouts:rs.filter(r=>r.reason==='timeout').length,firstMedian:q(rs.map(r=>r.firstContact),.5),stats:sums};
}
await fs.writeFile(path.join(v.out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({finished:true,rows:rows.length,out:v.out}));
