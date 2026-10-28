// Test-only contact input: a below-threshold manifold one step before the
// unchanged Rapier collision at step 125. No body pose, velocity or solver is changed.
import RAPIER from '../../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import {simulateWithRules} from '../variant.mjs';

export const thresholdRules={maxDuration:1.3,top:{spinRate:0}};
export async function guardThresholdScenario(simulate){
 const sim=simulate??await simulateWithRules(thresholdRules);
 const originalStep=RAPIER.World.prototype.step,originalPair=RAPIER.World.prototype.contactPair;
 let step=0;const samples=[];
 RAPIER.World.prototype.step=function(...args){step++;return originalStep.apply(this,args);};
 RAPIER.World.prototype.contactPair=function(left,right,callback){
  if(step===124){
   samples.push({step,impulse:.0005,injected:true});
   return callback({numContacts:()=>1,contactDist:()=>.001,contactImpulse:()=>.0005,
    normal:()=>({x:1,y:0,z:0}),localContactPoint1:()=>({x:.14,y:0,z:0}),localContactPoint2:()=>({x:.14,y:0,z:0})},false);
  }
  return originalPair.call(this,left,right,(manifold,flipped)=>{
   if(step===125)samples.push({step,impulse:Array.from({length:manifold.numContacts()},(_,i)=>manifold.contactImpulse(i)).reduce((a,b)=>a+b,0),injected:false});
   return callback(manifold,flipped);
  });
 };
 try{
  const replay=await sim({fighters:[{parts:[]},{parts:[]}],seed:3,
   manual:{sides:['input','input'],blockTime:.25,inputs:[{step:124,side:0,action:'block'}]}});
  return {samples,replay};
 }finally{RAPIER.World.prototype.step=originalStep;RAPIER.World.prototype.contactPair=originalPair;}
}
