// Offline replay measurement only. Mirrors the 64 tangent planes in buildArena.
import {rotate} from '../../sim/math.js';
const normals=[];
for(let i=0,x=1,z=0;i<64;i++){
 normals.push([x,z]);const nx=x*.9951847266721969-z*.0980171403295606;z=z*.9951847266721969+x*.0980171403295606;x=nx;
}
export function measureWalls(replay,items){
 const byId=new Map(items.map(i=>[i.id,i])),radius=replay.meta.rules.arenaRadius;
 let maxPartSupport=0,liveVertices=0;
 for(const fr of replay.frames)for(const f of fr.fighters)for(const p of f.parts){
  if(!p.alive)continue;
  const item=byId.get(p.item);if(!item)throw new Error(`Missing hull for ${p.item}`);
  for(const v of item.hull){
   const q=rotate(p.quat,v),x=p.pos[0]+q[0],z=p.pos[2]+q[2];liveVertices++;
   for(const [nx,nz] of normals)maxPartSupport=Math.max(maxPartSupport,x*nx+z*nz);
  }
 }
 return {frames:replay.frames.length,frameStride:replay.meta.rules.frameStride,dt:replay.meta.rules.dt,liveVertices,maxPartSupport,maxPartExcess:Math.max(0,maxPartSupport-radius),measure:'sampled live convex-hull vertices against 64 wall inner planes; intermediate physics steps not observed'};
}
