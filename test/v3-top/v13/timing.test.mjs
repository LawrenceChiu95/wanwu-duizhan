import test from 'node:test';
import assert from 'node:assert/strict';
import {createV3Match,simulateV3,loadV3Rules} from '../../../sim/v3.js';
import {simulateWithRules} from '../variant.mjs';
import {rotate} from '../../../sim/math.js';

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
 assert.equal(results.length,1);assert.equal(results[0].outcome,'perfect');
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
