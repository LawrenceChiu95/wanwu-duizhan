import test from 'node:test';
import assert from 'node:assert/strict';
import {createV3Match,simulateV3,loadV3Rules,topStrikeRoles} from '../../../sim/v3.js';
import {simulateWithRules} from '../variant.mjs';
import {rotate} from '../../../sim/math.js';
import {guardThresholdScenario} from './guard-threshold-fixture.mjs';

const bare=[{parts:[]},{parts:[]}];
const straight=await simulateWithRules({top:{spinRate:0},initialGap:1});
const run=(inputs,blockTime=.25)=>straight({fighters:bare,mode:'A',seed:3,manual:{sides:['input','input'],blockTime,inputs}});
const dash={step:1,side:0,action:'dash'};
// With no spin, the first physical dash contact is step 44. The block changes damage/recoil only.
test('block includes its first/last step, excludes the next step; empty block still consumes full cooldown',async()=>{
 for(const blockTime of [.2,.25,.3]){
  const count=Math.round(blockTime*120);
  for(const press of [44,45-count,44-count]){
   const r=await run([dash,{step:press,side:1,action:'block'},{step:press+1,side:1,action:'block'},{step:press+599,side:1,action:'block'}],blockTime);
   const b=r.events.filter(e=>e.type==='block'&&e.side===1),out=r.events.filter(e=>e.type==='blockResult'&&e.side===1);
   assert.equal(b.length,1);assert.equal(b[0].windowSteps,count);
   assert.equal(out.length,1);assert.equal(out[0].outcome,press===44-count?'empty':'perfect');
   assert.equal(out[0].resolvedStep,44);
   assert.equal(r.events.some(e=>e.type==='parry'),press!==44-count);
  }
 }
});
test('block cooldown accepts exactly 600 steps later, and its replay retains blockTime',async()=>{
 const inputs=[{step:1,side:0,action:'block'},{step:600,side:0,action:'block'},{step:601,side:0,action:'block'}];
 for(const blockTime of [.2,.25,.3]){
  const r=await run(inputs,blockTime),bs=r.events.filter(e=>e.type==='block'&&e.side===0);
  assert.deepEqual(bs.map(e=>e.pressStep),[1,601]);
  assert.equal(r.meta.manual.blockTime,blockTime);
  assert.equal(JSON.stringify(r),JSON.stringify(await run(r.meta.manual.inputs,blockTime)));
 }
});
test('full dash uses pre-impact alignment, a real contact and the post-cap multiplier; shield produces one result',async()=>{
 const r=await run([dash,{step:44,side:1,action:'block'},{step:700,side:0,action:'dash'}]);
 const blocked=r.events.find(e=>e.type==='dash'&&e.quality==='blocked'),full=r.events.find(e=>e.type==='dash'&&e.quality==='full');
 assert.equal(blocked.t,44/120);assert.equal(blocked.alignment,1);assert.ok(full);
 for(const e of r.events.filter(e=>e.damage>0)){
  assert.ok(r.events.some(c=>c.type==='contact'&&c.t===e.t));
  const m=e.shield?.3:e.dash?1.25:1;
  assert.ok(Math.abs(e.damageBeforeHpClamp-Math.min(e.rawDamage,e.damageCap)*e.roleMultiplier*m)<1e-9);
  if(e.dash){assert.ok(e.alignment>=.9);assert.equal(e.dashQuality,'full');}
 }
 const results=r.events.filter(e=>e.type==='blockResult'&&e.side===1);
 assert.equal(results.length,1);assert.equal(results[0].outcome,'perfect');assert.equal(results[0].damageApplied,true);
});
test('a guarded new contact during shared damage cooldown succeeds without damage, once per window',async()=>{
 const sim=await simulateWithRules({maxDuration:1.3,top:{spinRate:0}});
 const inputs=[{step:125,side:0,action:'block'},{step:126,side:0,action:'block'}];
 const r=await sim({fighters:bare,seed:3,manual:{sides:['input','input'],blockTime:.25,inputs}});
 const contact=r.events.find(e=>e.type==='contact'&&e.t===125/120),prior=r.events.find(e=>e.role==='attack'&&e.damage>0);
 assert.equal(contact.attacker,null);assert.equal(contact.clash,true);assert.ok(contact.t-prior.t<r.meta.rules.damageCooldown);
 assert.ok(!r.events.some(e=>e.t===contact.t&&e.damage>0));
 const results=r.events.filter(e=>e.type==='blockResult'&&e.side===0);
 assert.equal(results.length,1);assert.equal(results[0].outcome,'perfect');assert.equal(results[0].damageApplied,false);
 assert.equal(results[0].resolvedStep,125);assert.equal(results[0].attacker,1);assert.deepEqual(results[0].point,contact.point);
 assert.equal(r.events.filter(e=>e.type==='block'&&e.side===0).length,1);
 assert.equal(JSON.stringify(r),JSON.stringify(await sim({fighters:bare,seed:3,manual:{sides:['input','input'],blockTime:.25,inputs:r.meta.manual.inputs}})));
 // A genuinely one-sided aligned lunge does not let its own guard count as receiving a blow.
 const attackerOnly=await run([dash,{step:44,side:0,action:'block'}]);
 assert.equal(attackerOnly.events.find(e=>e.type==='blockResult'&&e.side===0).outcome,'empty');
});
test('a below-threshold touch does not consume the guard before a real impact in the same window',async()=>{
 const {samples,replay:r}=await guardThresholdScenario(),minimum=r.meta.rules.minimumImpulse;
 assert.ok(samples.some(s=>s.step===124&&s.impulse>0&&s.impulse<minimum&&s.injected));
 assert.ok(samples.some(s=>s.step===125&&s.impulse>=minimum&&!s.injected));
 assert.ok(!r.events.some(e=>e.t===124/120&&['contact','recoil','blockResult','hit','weak'].includes(e.type)));
 const results=r.events.filter(e=>e.type==='blockResult'&&e.side===0);
 assert.equal(results.length,1);assert.equal(results[0].outcome,'perfect');
 assert.equal(results[0].pressStep,124);assert.equal(results[0].resolvedStep,125);
 assert.equal(results[0].damageApplied,false);
});
test('dash locks at press and does not turn to follow; a real off-axis hit is a glance without dash bonus',async()=>{
 const r=await simulateV3({fighters:bare,mode:'A',seed:3,manual:{sides:['input','input'],inputs:[dash]}});
 const charge=r.events.find(e=>e.type==='dash'&&e.phase==='charge'),go=r.events.find(e=>e.type==='dash'&&e.phase==='go'),end=r.events.find(e=>e.type==='dash'&&e.phase==='end');
 assert.deepEqual(charge.lockedDir,[1,0,0]);assert.deepEqual(go.dir,charge.lockedDir);
 assert.equal(end.quality,'glance');assert.ok(end.alignment<.9);
 assert.ok(r.events.some(e=>e.type==='contact'&&e.t===end.t));
 const hits=r.events.filter(e=>e.t===end.t&&e.damage>0);
 for(const e of hits){assert.equal(e.dash,false);if(e.dashAttempt)assert.equal(e.dashQuality,'glance');}
});
test('dash timeout is a miss and a zero locked direction never invents a full alignment or NaN',async()=>{
 const distant=await simulateWithRules({maxDuration:1,initialGap:20,attraction:0,thrust:0,top:{spinRate:0}});
 const miss=await distant({fighters:bare,seed:1,manual:{sides:['input','input'],inputs:[dash]}});
 const missed=miss.events.find(e=>e.type==='dash'&&e.phase==='end');assert.equal(missed.quality,'miss');assert.equal(missed.alignment,null);
 const sim=await simulateWithRules({maxDuration:1,initialGap:-.28,top:{spinRate:0},manual:{chargeTime:0}});
 const r=await sim({fighters:bare,mode:'A',seed:1,manual:{sides:['input','input'],inputs:[dash]}});
 const go=r.events.find(e=>e.type==='dash'&&e.phase==='go'),end=r.events.find(e=>e.type==='dash'&&e.phase==='end');
 assert.deepEqual(go.lockedDir,[0,0,0]);assert.equal(end.quality,'glance');assert.equal(end.alignment,null);
 assert.ok(!r.events.some(e=>e.dash));assert.ok(!JSON.stringify(r).includes('NaN'));
});
test('opening is seed-independent, with a half-turn of every same-loadout collider, COM and angular velocity',async()=>{
 const def={parts:[{item:'broom',mount:'e0',orient:'out'},{item:'pan-lux3d',mount:'e90',orient:'hug'}]};
 const a=await createV3Match({fighters:[def,def],mode:'A',seed:1}),b=await createV3Match({fighters:[def,def],mode:'A',seed:101});
 try{
  assert.deepEqual(a.initial,b.initial);
  const [left,right]=a.initial,half=[0,1,0,0],turn=v=>rotate(half,v),close=(x,y)=>assert.ok(x.every((v,i)=>Math.abs(v-y[i])<1e-6),`${x} != ${y}`);
  close(turn(left.pos),right.pos);close(turn(left.centerOfMass),right.centerOfMass);
  close(turn(left.angularVelocity),right.angularVelocity);assert.deepEqual(left.velocity,[0,0,0]);assert.deepEqual(right.velocity,[0,0,0]);
  for(let i=0;i<left.parts.length;i++)close(turn(left.parts[i].pos),right.parts[i].pos);
  assert.deepEqual(left.quat,[0,0,0,1]);assert.deepEqual(right.quat,[0,1,0,0]);
 }finally{a.free();b.free();}
});
test('invalid sensitivity value fails; automatic mode retains no manual state',async()=>{
 await assert.rejects(createV3Match({fighters:bare,seed:1,manual:{sides:['input','ai'],blockTime:.1}}),/blockTime/);
 const r=await simulateV3({fighters:bare,seed:1});
 assert.equal(r.meta.manual,undefined);assert.equal(r.meta.rules.manual,undefined);
 assert.ok(!r.events.some(e=>['press','dash','block','blockResult'].includes(e.type)));
 const rules=await loadV3Rules();assert.equal(rules.manual.blockTime,.25);assert.equal(rules.manual.dashAlignment,.9);
});

test('relative score ties clash on both sides; real advantage and below-speed contacts retain their meaning',()=>{
 const o={normal:[1,0,0],velocities:[[2,0,0],[-2.0000002,0,0]],tipRatios:[0,0],tipBonus:0,seed:3,minimumSpeed:.01};
 const near=topStrikeRoles(o,1e-5);assert.equal(near.clash,true);assert.equal(near.attacker,null);
 const advantage=topStrikeRoles({...o,velocities:[[2,0,0],[-2.02,0,0]]},1e-5);assert.equal(advantage.clash,false);assert.equal(advantage.attacker,1);
 const slow=topStrikeRoles({...o,velocities:[[.001,0,0],[-.001,0,0]]},1e-5);assert.equal(slow.clash,false);assert.equal(slow.attacker,null);
});
test('a real head-on clash deals two capped main blows and both defenders can resolve one guard',async()=>{
 const sim=await simulateWithRules({maxDuration:.6,top:{spinRate:0}});
 const noGuard=await sim({fighters:bare,seed:3});
 const contact=noGuard.events.find(e=>e.type==='contact'&&e.clash),step=Math.round(contact.t/noGuard.meta.rules.dt);
 assert.equal(contact.attacker,null);
 const hits=noGuard.events.filter(e=>e.t===contact.t&&e.damage>0);
 assert.equal(hits.length,2);assert.deepEqual(hits.map(e=>e.target).sort(),[0,1]);
 for(const hit of hits){assert.equal(hit.role,'attack');assert.equal(hit.roleMultiplier,1);assert.equal(hit.strikeAttacker,null);assert.equal(hit.clash,true);assert.ok(hit.damageBeforeHpClamp<=hit.damageCap);}
 const guarded=await sim({fighters:bare,seed:3,manual:{sides:['input','input'],inputs:[0,1].map(side=>({step,side,action:'block'}))}});
 const out=guarded.events.filter(e=>e.type==='blockResult');assert.equal(out.length,2);
 for(const e of out){assert.equal(e.outcome,'perfect');assert.equal(e.clash,true);assert.equal(e.damageApplied,true);assert.equal(e.resolvedStep,step);}
 for(const hit of guarded.events.filter(e=>e.damage>0)){assert.equal(hit.shield,true);assert.ok(hit.damageBeforeHpClamp<=hit.damageCap*guarded.meta.rules.manual.blockDamage);}
});
test('AI reaction delays are seeded, bounded, replayed, and carry with the profile on seat swap',async()=>{
 const fighters=[{parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'broom',mount:'e180',orient:'out'}]},{parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'broom',mount:'e180',orient:'out'}]}];
 const manual={sides:['ai','ai'],blockTime:.25,aiSeeds:[123,456]};
 const a=await simulateV3({fighters,mode:'A',seed:9,manual});
 const presses=a.events.filter(e=>e.type==='press');assert.ok(presses.length>4);assert.ok(presses.some(e=>e.reactionSteps>0));
 for(const e of presses){assert.ok(Number.isInteger(e.reactionSteps)&&e.reactionSteps>=0&&e.reactionSteps<=6);assert.equal(Math.round(e.t/a.meta.rules.dt)-e.decisionStep,e.reactionSteps);}
 const again=await simulateV3({fighters,mode:'A',seed:9,manual:{...a.meta.manual}});assert.equal(JSON.stringify(a),JSON.stringify(again));
 const b=await simulateV3({fighters,mode:'A',seed:9,manual:{...manual,aiSeeds:[456,123]}});
 assert.deepEqual(b.meta.manual.aiSeeds,[456,123]);assert.deepEqual(a.initial,b.initial);
 for(let side=0;side<2;side++)assert.equal(a.events.find(e=>e.type==='press'&&e.side===side).reactionSteps,b.events.find(e=>e.type==='press'&&e.side===1-side).reactionSteps);
 await assert.rejects(createV3Match({fighters,seed:9,manual:{...manual,aiSeeds:[1,-1]}}),/aiSeeds/);
});
