// 手感对照：v1 球形版（单件在核心位）和陀螺版，同物品对、同种子。
// 量两样，两版用同一套读法：
// - 撞前迎击速度（R2，10-27 晚统一）：每次有伤害的撞击，找到它所在那段接触的第一步，用这一步之前两台的速度
//   算接触点沿法线的相对速度（impact-probe.mjs，从外面看 Rapier，两个 sim 都不改）。接触已经持续超过 0.1 秒的算刮蹭、不计。
//   原来直接取各自 hit 事件里的读数：陀螺版本来就是撞前，v1 常在冲量已经吃掉一步之后才读，两边不可比。
// - 撞后两边分开的速度（撞后 0.05–0.25 秒质心距离的变化率）。
// Usage: nice -n 20 node test/v3-top/feel.mjs [mode] [seeds]
import {simulate} from '../../sim/index.js';
import {simulateV3} from '../../sim/v3.js';
import {simulateWithRules} from './variant.mjs';
import {probe, impactSpeeds} from './impact-probe.mjs';
import {median} from '../v3/probe.mjs';
import {writeFile} from 'node:fs/promises';
const mode=process.argv[2]??'A',seeds=Number(process.argv[3]??3),sim=process.env.RULES?await simulateWithRules(JSON.parse(process.env.RULES)):simulateV3;
const pairs=[['broom','pan-lux3d'],['scissors','pillow'],['lamp-lux3d','slipper'],['pot','broom'],['pillow','lamp'],['slipper','scissors']];
// Second piece for the top version: the first item swings out, a hugging guard sits opposite.
const guard=x=>x==='pillow'?'pan-lux3d':'pillow';
const topDef=x=>({parts:[{item:x,mount:'e0',orient:'out'},{item:guard(x),mount:'e180',orient:'hug'}]});
const v1Def=x=>({parts:[{item:x,mount:'core',rot:[0,0,0]}]});
const center=(f,v)=>v==='v1'?f.pos:f.centerOfMass;
function separation(r,t,v){
 const at=x=>{const f=r.frames.find(fr=>fr.t>=x-1e-9)??r.frames.at(-1);return Math.hypot(...center(f.fighters[0],v).map((p,i)=>p-center(f.fighters[1],v)[i]));};
 if(t+.25>r.meta.duration)return null;return (at(t+.25)-at(t+.05))/.2;
}
const V1_DT=1/60;
function feel({result:r,steps},v){
 const hits=r.events.filter(e=>['hit','crit','weak'].includes(e.type)&&e.role==='attack');
 const {impacts,rubs}=impactSpeeds(r,steps,v==='v1'?V1_DT:r.meta.rules.dt);
 return {hits:hits.length,rubs,approach:impacts.map(x=>x.approach),separation:hits.map(e=>separation(r,e.t,v)).filter(x=>x!==null)};
}
const rows=[],all={v1:{approach:[],separation:[],hits:0,rubs:0},top:{approach:[],separation:[],hits:0,rubs:0}};
for(const [a,b] of pairs)for(let seed=1;seed<=seeds;seed++){
 const f1=feel(await probe(()=>simulate({fighters:[v1Def(a),v1Def(b)],mode,seed})),'v1'),f2=feel(await probe(()=>sim({fighters:[topDef(a),topDef(b)],mode,seed})),'top');
 for(const [k,f] of [['v1',f1],['top',f2]]){all[k].approach.push(...f.approach);all[k].separation.push(...f.separation);all[k].hits+=f.hits;all[k].rubs+=f.rubs;}
 const s=f=>({hits:f.hits,rubs:f.rubs,approachMedian:median(f.approach),separationMedian:median(f.separation)});
 rows.push({a,b,seed,v1:s(f1),top:s(f2)});
}
const q=(xs,p)=>{const s=[...xs].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:null;};
const summary=Object.fromEntries(Object.entries(all).map(([k,v])=>[k,{hits:v.hits,impacts:v.approach.length,rubs:v.rubs,approach:{p25:q(v.approach,.25),median:q(v.approach,.5),p75:q(v.approach,.75)},separation:{p25:q(v.separation,.25),median:q(v.separation,.5),p75:q(v.separation,.75)}}]));
// Game by game: is the top version's median at least v1's?
const notLower=key=>rows.filter(r=>r.v1[key]!==null&&r.top[key]!==null&&r.top[key]>=r.v1[key]).length,compared=key=>rows.filter(r=>r.v1[key]!==null&&r.top[key]!==null).length;
summary.byGame={approach:{notLower:notLower('approachMedian'),of:compared('approachMedian')},separation:{notLower:notLower('separationMedian'),of:compared('separationMedian')}};
const out={mode,seeds,pairs,guard:'out item at e0, pillow (or pan-lux3d) hugging at e180',method:{approach:'pre-impact approach speed along the contact normal at the first solver-impulse step of the contact run (impact-probe.mjs); runs older than 0.1 s are rubs, left out',separation:'d|COM0-COM1|/dt over 0.05-0.25 s after the hit'},summary,rows};
if(process.env.SAVE)await writeFile(new URL(`./feel-${mode}.json`,import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(summary,null,1));
