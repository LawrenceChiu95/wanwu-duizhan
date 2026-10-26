// Query fresh hulls at the actual playback poses, independently of solver manifolds.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import RAPIER from '../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import {simulate,loadCatalog,loadRules} from '../../sim/index.js';import {single} from '../../sim/batch.js';import {enumerateLayouts} from '../../sim/layouts.js';
const catalog=await loadCatalog(),rules=await loadRules(),layouts=enumerateLayouts(['broom','pot','pillow']),cases=new Map();
function add(type,row,source){const key=[type,row.mode,row.seed,row.layout??row.left+'|'+row.right].join(':');if(!cases.has(key))cases.set(key,{type,row,source});}
add('batch',{mode:'B',seed:2,left:'pot',right:'slipper'},'original 5.35cm failure');
add('layouts',{mode:'B',seed:1,layout:'front:pillow:forward|top:broom:vertical|side:pot:horizontal'},'original 7.15cm failure');
for(const type of ['batch','layouts']){const rows=JSON.parse(await fs.readFile(new URL(`./${type}/rounds.json`,import.meta.url),'utf8'));for(const mode of ['A','B'])for(const key of ['maxPenetration','maxResidualPenetration'])add(type,rows.filter(r=>r.mode===mode).sort((a,b)=>b[key]-a[key])[0],'current worst '+key);}
const results=[];
for(const {type,row,source} of cases.values()){
 const fighters=type==='batch'?[single(row.left),single(row.right)]:[layouts.find(l=>l.id===row.layout).fighter,layouts[0].fighter];
 const replay=await simulate({fighters,mode:row.mode,seed:row.seed}),world=new RAPIER.World({x:0,y:0,z:0});
 try{
  const colliders=fighters.map(f=>{const cs=f.parts.map(p=>world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(catalog.find(i=>i.id===p.item).hull.flat()))));if(f.parts.length===3)cs.push(world.createCollider(RAPIER.ColliderDesc.cuboid(...rules.arena.base.halfExtents)));return cs;});
  let maximum=0,at=0,over1mm=0;
  for(const frame of replay.frames){
   for(let side=0;side<2;side++){const f=frame.fighters[side],poses=f.parts.length===3?[...f.parts,f]:f.parts;poses.forEach((p,i)=>{colliders[side][i].setTranslation({x:p.pos[0],y:p.pos[1],z:p.pos[2]});colliders[side][i].setRotation({x:p.quat[0],y:p.quat[1],z:p.quat[2],w:p.quat[3]});});}
   let depth=0;for(const a of colliders[0])for(const b of colliders[1])depth=Math.max(depth,-(a.contactCollider(b,0)?.distance??0));
   if(depth>maximum){maximum=depth;at=frame.t;}if(depth>.001)over1mm++;
  }
  results.push({type,source,mode:row.mode,seed:row.seed,layout:row.layout,left:row.left,right:row.right,diagnostics:replay.meta.diagnostics,renderedFrameMaximum:maximum,at,over1mmFrames:over1mm,frames:replay.frames.length});
 }finally{world.free();}
}
await fs.writeFile(new URL('./penetration-check.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.renderedFrameMaximum<=.005),'Regression: playback hull overlap exceeds 5mm (all residual values are reported)');
