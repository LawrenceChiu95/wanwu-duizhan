// Same assembly, seeds, damage, recoil pulse and damping; only old motion settings.
import{simulateWithRules}from'./rules-variant.mjs';
const before=await simulateWithRules({attraction:.65,thrust:.75,initialSpin:.6,spinTorque:.004,recoilPause:.6});
import {simulateV3 as after}from'../../sim/v3.js';
import{definition,metrics}from'./probe.mjs';
import{writeFile}from'node:fs/promises';
const rows=[];
for(const [a,b]of[['broom','pot'],['scissors','pillow'],['lamp','slipper']])for(const mode of ['A','B']){
 const args={fighters:[definition(a),definition(b)],mode,seed:1},old=await before(args),newer=await after(args);
 const impulse=r=>r.events.filter(e=>e.type==='recoil').map(e=>({t:e.t,normal:e.normal,deltas:e.velocityAfter.map((v,i)=>v.map((n,j)=>n-e.velocityBefore[i][j])),magnitude:e.velocityAfter.map((v,i)=>Math.hypot(...v.map((n,j)=>n-e.velocityBefore[i][j])))}));
 const spin=r=>r.frames.map(fr=>({t:fr.t,speeds:fr.fighters.map(f=>Math.hypot(...f.angularVelocity))}));
 rows.push({a,b,mode,seed:1,before:metrics(old),after:metrics(newer),recoilBefore:impulse(old),recoilAfter:impulse(newer),spinBefore:spin(old),spinAfter:spin(newer)});
 await writeFile(`test/v3/replays/motion-before-${a}-${b}-${mode}.json`,JSON.stringify(old));
}
await writeFile('test/v3/batch/motion-ablation.json',JSON.stringify(rows));
console.log(JSON.stringify(rows.map(r=>({pair:r.a+'/'+r.b,mode:r.mode,before:r.before,after:r.after})),null,2));
