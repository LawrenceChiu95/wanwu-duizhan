// Initialisation only: verify real hull transforms and inertia under the specified half turn; no match/batch.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {rotate,add} from '../../../sim/math.js';
import {root,fixtures,sha} from './experiment.mjs';
const original=await readFile(new URL('sim/v3.js',root),'utf8');
let source=original.replace('rules:r,initial,frames,events,',`rules:r,initial,frames,events,geometry:fs.map(f=>({spin:f.spin,inertia:f.inertia,principal:arr(f.body.principalInertia()),localFrame:qarr(f.body.principalInertiaLocalFrame()),worldInv:(()=>{const m=f.body.effectiveWorldInvInertia();return [m.m11,m.m12,m.m13,m.m22,m.m23,m.m33];})(),hulls:f.parts.map(p=>p.item.hull.map(v=>add(arr(p.collider.translation()),rotate(qarr(p.collider.rotation()),v))))})),`);
assert.notEqual(source,original);
source=source.replaceAll("'@dimforge/rapier3d-compat'",JSON.stringify(new URL('sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root).href));
for(const file of ['index.js','math.js'])source=source.replaceAll(`'./${file}'`,JSON.stringify(new URL(`sim/${file}`,root).href));
source=source.replace("new URL('./v3-rules.json',import.meta.url)",`new URL(${JSON.stringify(new URL('sim/v3-rules.json',root).href)})`);
const {createV3Match}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const turn=v=>[-v[0],v[1],-v[2]],err=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i]))),rows=[];
for(const f of fixtures){
 const m=await createV3Match({fighters:[f.definition,f.definition],mode:'A',seed:0});
 try{
  const [a,b]=m.initial,[ga,gb]=m.geometry;
  const signs=[1,-1,1,1,-1,1],invTurn=ga.worldInv.map((x,i)=>x*signs[i]);
  const hullError=Math.max(...ga.hulls.flatMap((h,j)=>h.map((v,i)=>err(turn(v),gb.hulls[j][i]))));
  const row={fixture:f.id,massError:Math.abs(a.mass-b.mass),corePositionError:err(turn(a.pos),b.pos),comError:err(turn(a.centerOfMass),b.centerOfMass),angularError:err(turn(a.angularVelocity),b.angularVelocity),hullError,spinError:Math.abs(ga.spin-gb.spin),spinInertiaError:Math.abs(ga.inertia-gb.inertia),worldInvInertiaError:err(invTurn,gb.worldInv),worldInvInertiaRelativeError:err(invTurn,gb.worldInv)/Math.max(...ga.worldInv.map(Math.abs)),initial:[a,b],geometry:[ga,gb]};
  assert.equal(row.massError,0);assert.equal(row.corePositionError,0);assert.equal(row.comError,0);assert.equal(row.angularError,0);assert.equal(row.spinError,0);assert.equal(row.spinInertiaError,0);
  assert.ok(row.hullError<1e-6);assert.ok(row.worldInvInertiaRelativeError<1e-6);rows.push(row);
 }finally{m.free();}
}
assert.equal(sha(original),sha(await readFile(new URL('sim/v3.js',root),'utf8')));
const out=new URL('./fairness-diagnostic-r2/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('geometry.json',out),JSON.stringify({sourceSha:sha(original),scope:'Real Rapier initial collider point transforms, sweep/core/COM/spin and inertia; no dynamics advanced. Tolerance 1 micrometre for transformed points, 1e-6 relative for Float32 inertia.',rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(({initial,geometry,...r})=>r)));
