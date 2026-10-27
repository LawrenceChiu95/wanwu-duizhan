// 手感对照：v1 球形版（单件在核心位）和陀螺版，同物品对、同种子。
// 量两样：撞击瞬间接触点相对速度（有伤害的撞击，两边沿法线的迎击速度之和），
// 撞后两边分开的速度（撞后 0.05–0.25 秒质心距离的变化率）。
// Usage: nice -n 20 node test/v3-top/feel.mjs [mode] [seeds]
import {simulate} from '../../sim/index.js';
import {simulateV3} from '../../sim/v3.js';
import {simulateWithRules} from './variant.mjs';
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
function feel(r,v){
 const hits=r.events.filter(e=>['hit','crit','weak'].includes(e.type)&&e.role==='attack');
 return hits.map(e=>({t:e.t,closing:e.normalSpeeds[0]+e.normalSpeeds[1],separation:separation(r,e.t,v)}));
}
const rows=[],all={v1:{closing:[],separation:[]},top:{closing:[],separation:[]}};
for(const [a,b] of pairs)for(let seed=1;seed<=seeds;seed++){
 const before=await simulate({fighters:[v1Def(a),v1Def(b)],mode,seed}),after=await sim({fighters:[topDef(a),topDef(b)],mode,seed});
 const f1=feel(before,'v1'),f2=feel(after,'top');
 for(const [k,f] of [['v1',f1],['top',f2]]){all[k].closing.push(...f.map(x=>x.closing));all[k].separation.push(...f.map(x=>x.separation).filter(x=>x!==null));}
 const s=f=>({hits:f.length,closingMedian:median(f.map(x=>x.closing)),separationMedian:median(f.map(x=>x.separation).filter(x=>x!==null))});
 rows.push({a,b,seed,v1:s(f1),top:s(f2)});
}
const q=(xs,p)=>{const s=[...xs].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:null;};
const summary=Object.fromEntries(Object.entries(all).map(([k,v])=>[k,{hits:v.closing.length,closing:{p25:q(v.closing,.25),median:q(v.closing,.5),p75:q(v.closing,.75)},separation:{p25:q(v.separation,.25),median:q(v.separation,.5),p75:q(v.separation,.75)}}]));
const out={mode,seeds,pairs,guard:'out item at e0, pillow (or pan-lux3d) hugging at e180',summary,rows};
if(process.env.SAVE)await writeFile(new URL(`./feel-${mode}.json`,import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(summary,null,1));
