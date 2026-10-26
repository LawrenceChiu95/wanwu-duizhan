import fs from 'node:fs/promises';
const root='/Users/lawrence/Projects/wanwu-duizhan';let source=await fs.readFile(root+'/sim/index.js','utf8');
const helper=`
// Position-level constraint correction complements Rapier's velocity solve.
// Include the base as well as every attachment; preserve pair center of mass.
function correctOverlap(world,fighters){
 let before=0,remaining=0,correction=0;
 for(let iteration=0;iteration<=8;iteration++){
  let deepest=null;
  for(const p of fighters[0].shapes)for(const q of fighters[1].shapes){const hit=p.contactCollider(q,0);if(hit&&hit.distance<0&&(!deepest||hit.distance<deepest.distance))deepest=hit;}
  remaining=deepest?-deepest.distance:0;if(iteration===0)before=remaining;
  if(remaining<=.0005||iteration===8)break;
  const total=fighters[0].mass+fighters[1].mass,delta=scale(arr(deepest.normal1),remaining+.0001);
  fighters.forEach((f,i)=>f.body.setTranslation(vec(add(arr(f.body.translation()),scale(delta,(i===0?-1:1)*fighters[1-i].mass/total))),true));
  correction+=remaining+.0001;world.propagateModifiedBodyPositionsToColliders();
 }
 return {before,remaining,correction};
}
`;
source=source.replace('return {body,parts,maxHp,','return {body,parts,shapes:Array.from({length:body.numColliders()},(_,i)=>body.collider(i)),maxHp,');
source=source.replace('/** Simulate once, then play frames.',helper+'/** Simulate once, then play frames.');
source=source.replace('streak=0;','streak=0,maxGeometricPenetration=0,maxResidualPenetration=0,maxPositionCorrection=0,correctionSteps=0;');
source=source.replace('  if(touching){streak',`  const projection=correctOverlap(world,fighters);maxGeometricPenetration=Math.max(maxGeometricPenetration,projection.before);maxResidualPenetration=Math.max(maxResidualPenetration,projection.remaining);maxPositionCorrection=Math.max(maxPositionCorrection,projection.correction);if(projection.correction>0)correctionSteps++;
  if(touching){streak`);
source=source.replace('maxPenetration,contactFrames,longestContact','maxPenetration,maxGeometricPenetration,maxResidualPenetration,maxPositionCorrection,correctionSteps,contactFrames,longestContact');
await fs.writeFile('sim/index.js',source);
