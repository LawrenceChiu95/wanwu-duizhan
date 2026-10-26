import fs from 'node:fs/promises';
const root='/Users/lawrence/Projects/wanwu-duizhan',source=await fs.readFile(root+'/sim/index.js','utf8');
const correction=`
  // Resolve geometric overlap after the velocity solve; inverse-mass weighting
  // preserves the pair's center of mass and does not award damage or impulse.
  for(let iteration=0;iteration<8;iteration++){
   let deepest=null;
   for(const p of fighters[0].parts)for(const q of fighters[1].parts){const hit=p.collider.contactCollider(q.collider,0);if(hit&&hit.distance<-.0005&&(!deepest||hit.distance<deepest.distance))deepest=hit;}
   if(!deepest)break;
   const total=fighters[0].mass+fighters[1].mass,delta=scale(arr(deepest.normal1),-deepest.distance+.0001);
   fighters.forEach((f,i)=>f.body.setTranslation(vec(add(arr(f.body.translation()),scale(delta,(i===0?-1:1)*fighters[1-i].mass/total))),true));
   world.propagateModifiedBodyPositionsToColliders();
  }
`;
await fs.writeFile('sim/index.js',source.replace('  if(touching){streak',correction+'  if(touching){streak'));
await fs.copyFile(root+'/data/catalog.json','data/catalog.json');
