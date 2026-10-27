// Independent geometry replay of a real long-tail failure. No new simulation.
import RAPIER from'../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import{readFile,writeFile}from'node:fs/promises';import{loadCatalog}from'../../sim/v3.js';
const source=process.argv[2]??'test/v3/batch/example-longTail.json';
await RAPIER.init();const catalog=await loadCatalog(),r=JSON.parse(await readFile(source,'utf8')),world=new RAPIER.World({x:0,y:0,z:0});
const lastDamage=Math.max(...r.events.filter(e=>e.damage>0).map(e=>e.t)),sampleFrom=Math.ceil(lastDamage);
const vec=([x,y,z])=>({x,y,z}),quat=([x,y,z,w])=>({x,y,z,w}),rows=[];
try{
 for(const fr of r.frames.filter(f=>f.t>=sampleFrom&&Math.abs(f.t-Math.round(f.t))<1e-8)){
  const shapes=fr.fighters.map(f=>[f.core,...f.parts.filter(p=>p.alive)].map(p=>{const item=catalog.find(i=>i.id===p.item),desc=p.mount==='core'?RAPIER.ColliderDesc.ball(r.meta.rules.core.radius):RAPIER.ColliderDesc.convexHull(new Float32Array(item.hull.flat()));return world.createCollider(desc.setTranslation(...p.pos).setRotation(quat(p.quat)));}));
  let gap=Infinity;for(const a of shapes[0])for(const b of shapes[1]){const contact=a.contactCollider(b,10);if(contact)gap=Math.min(gap,contact.distance);}
  const a=fr.fighters[0],b=fr.fighters[1],delta=a.centerOfMass.map((x,i)=>b.centerOfMass[i]-x),v=a.velocity.map((x,i)=>b.velocity[i]-x),distance=Math.hypot(...delta),radial=v.reduce((n,x,i)=>n+x*delta[i]/distance,0),tangential=Math.sqrt(Math.max(0,v.reduce((n,x)=>n+x*x,0)-radial*radial));
  rows.push({t:fr.t,closestSurfaceGap:gap,centerDistance:distance,relativeRadialVelocity:radial,relativeTangentialSpeed:tangential});
  shapes.flat().forEach(c=>world.removeCollider(c,false));
 }
}finally{world.free();}
const result={source,case:{fighters:r.meta.initial.map(f=>f.definition),mode:r.meta.mode,seed:r.meta.seed},lastDamage,method:'Recreate real active ball/convex colliders from replay world transforms at each whole second after the last damage; positive gap means no touch. Full-rate replay events remain authoritative.',minSampledGap:Math.min(...rows.map(r=>r.closestSurfaceGap)),rows};await writeFile('test/v3/batch/surface-proof.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({minSampledGap:result.minSampledGap,samples:rows.length}));
