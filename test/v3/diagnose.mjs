import {simulateV3}from'../../sim/v3.js';
import{definition}from'./probe.mjs';import{writeFile}from'node:fs/promises';
const cases=[{left:'lamp',right:'broom',mode:'B',seed:5},{left:'slipper',right:'broom',mode:'A',seed:3},{left:'lamp',right:'scissors',mode:'A',seed:1}];
const rows=[];
for(const c of cases){
 const r=await simulateV3({fighters:[definition(c.left),definition(c.right)],mode:c.mode,seed:c.seed});
 const last=r.events.filter(e=>['hit','weak'].includes(e.type)).at(-1)?.t;
 const samples=r.frames.filter((f,i)=>i%150===0||f.t===r.meta.duration).map(f=>({t:f.t,fighters:f.fighters.map(x=>({pos:x.pos,com:x.centerOfMass,velocity:x.velocity,angular:x.angularVelocity,mass:x.mass,coreHp:x.hp,parts:x.parts.map(p=>({id:p.id,hp:p.hp,pos:p.pos,alive:p.alive}))}))}));
 await writeFile(`test/v3/batch/diagnose-${c.left}-${c.right}-${c.mode}-${c.seed}.json`,JSON.stringify(r));
 rows.push({...c,diagnostics:r.meta.diagnostics,last,breaks:r.events.filter(e=>e.type==='break'),samples});
}
await writeFile('test/v3/batch/diagnoses.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows.map(x=>({left:x.left,right:x.right,diagnostics:x.diagnostics,last:x.last,breaks:x.breaks.map(b=>({t:b.t,massBefore:b.massBefore,massAfter:b.massAfter,oldVelocity:b.oldVelocity,newVelocity:b.newVelocity})),samples:x.samples})),null,2));
