import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import RAPIER from '../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import {simulateV3,loadV3Rules,loadCatalog,ANCHORS,attachmentOffset,detachPart,tierDamage} from '../../sim/v3.js';
import {loadRules,strikeRoles}from'../../sim/index.js';
import{vec,arr,add,sub,rotate,euler,length}from'../../sim/math.js';
import{definition}from'./probe.mjs';
const digest=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const c=await loadRules(),rules=await loadV3Rules(),catalog=await loadCatalog();
const simulations=[];
for(const mode of ['A','B'])for(const [left,right]of [['broom','pot'],['scissors','pillow'],['lamp-lux3d','pan-lux3d']])simulations.push(await simulateV3({fighters:[definition(left),definition(right)],mode,seed:1}));
test('explicit new schema, deterministic full replay, A/B identical initial geometry',async()=>{
 const a=simulations[0],again=await simulateV3({fighters:a.meta.initial.map(f=>f.definition),mode:'A',seed:1});
 assert.equal(digest(a),digest(again));assert.equal(a.meta.schemaVersion,3);assert.deepEqual(a.meta.initial,simulations[3].meta.initial);
 for(const r of simulations){assert.equal(r.frames[0].t,0);assert.equal(r.frames.at(-1).t,r.meta.duration);assert.ok(r.frames.every(fr=>fr.fighters.every(f=>[...f.pos,...f.quat,...f.velocity,...f.angularVelocity,...f.centerOfMass,f.hp,f.mass,...f.parts.flatMap(p=>[p.hp,...p.pos,...p.quat])].every(Number.isFinite))));assert.ok(r.decisive.t1-r.decisive.t0<=2.5+1e-8);}
});
test('six anchors, standard dimensions and actual rotated face outside core',()=>{
 assert.equal(Object.keys(ANCHORS).length,6);assert.ok(Object.isFrozen(ANCHORS.front));
 for(const item of catalog){assert.equal(item.mass,c.itemStandards[item.category].massKg);const span=Math.max(...item.bounds.max.map((v,i)=>v-item.bounds.min[i]));assert.ok(Math.abs(span-c.itemStandards[item.category].longSideMeters)<1e-6);
  for(const mount of Object.keys(ANCHORS))for(const rot of [[0,0,0],[.4,1.2,-.7]]){const offset=attachmentOffset(item,mount,rot,rules),points=item.hull.map(v=>add(offset,rotate(euler(rot),v))),d=ANCHORS[mount];const nearest=Math.min(...points.map(v=>v.reduce((s,n,i)=>s+n*d[i],0)));assert.ok(Math.abs(nearest-rules.core.radius-rules.anchorGap)<1e-7);}
 }
});
test('HP belongs to real contacted collider; strongest pair once per episode; no zone or time damage',()=>{
 let shieldProof=false,coreWhilePartAlive=false;
 for(const r of simulations){
  const hp=r.meta.initial.map(f=>Object.fromEntries([f.core,...f.parts].map(p=>[p.id,p.hp]))),lastBreak=new Map(),hitTimes=new Map();
  for(const e of r.events){
   assert.ok(!['zone','ringout'].includes(e.type));
   if(e.damage>0){const contacts=r.events.filter(c=>c.type==='contact'&&c.t===e.t);assert.equal(contacts.length,1);const ct=contacts[0];assert.ok(ct.impulse>=rules.minimumImpulse);assert.equal(ct.parts[e.target],e.targetPart);assert.equal(ct.parts[e.attacker],e.part);assert.ok(Math.max(...e.normalSpeeds)>=rules.minimumClosingSpeed);assert.ok(!lastBreak.has(`${e.target}:${e.targetPart}`));assert.ok(e.damage<=e.damageCap*e.roleMultiplier+1e-9);assert.ok(e.damage<=hp[e.target][e.targetPart]+1e-9);
    const beforeCore=hp[e.target].core;hp[e.target][e.targetPart]-=e.damage;assert.ok(Math.abs(hp[e.target][e.targetPart]-e.hpAfter)<1e-8);if(e.targetPart!=='core'){assert.equal(hp[e.target].core,beforeCore);shieldProof=true;}
    else if(e.hpAfter===0&&Object.entries(hp[e.target]).some(([id,n])=>id!=='core'&&n>0))coreWhilePartAlive=true;
    const key=String(e.t);hitTimes.set(key,(hitTimes.get(key)??0)+1);
    assert.equal(e.weak,e.role==='attack'&&e.weakContact&&e.criticalRoll<rules.weakCritChance);if(e.role==='recoil')assert.equal(e.criticalRoll,null);if(e.weak)assert.match(e.caption,/弱点/);
   }
   if(e.type==='break'){assert.equal(hp[e.target][e.targetPart],0);assert.ok(!lastBreak.has(`${e.target}:${e.targetPart}`));lastBreak.set(`${e.target}:${e.targetPart}`,e.t);assert.ok(e.massAfter<e.massBefore);}
  }
  assert.ok([...hitTimes.values()].every(n=>n===2));
  for(let i=0;i<2;i++)for(const p of [r.frames.at(-1).fighters[i].core,...r.frames.at(-1).fighters[i].parts])assert.ok(Math.abs(p.hp-hp[i][p.id])<1e-8);
  if(r.meta.reason!=='timeout'){assert.ok(r.frames.at(-1).fighters.some(f=>f.core.hp===0&&!f.core.alive));assert.equal(r.decisive.finishType,'contact');}
  assert.equal(r.meta.diagnostics.zoneDamage,0);for(const ep of r.meta.diagnostics.scrapeEpisodes){assert.ok(ep.duration>=.1-1e-8);assert.ok(r.events.filter(e=>e.damage>0&&e.t>ep.start+.1+1e-8&&e.t<=ep.end+1e-8).length===0);}assert.ok(r.meta.diagnostics.scrapeDuration<=r.meta.duration+1e-8);
 }
 assert.ok(shieldProof);assert.ok(coreWhilePartAlive);
});
test('one attachment and bare core still rotate, collide and can win; losing all parts is not KO',async()=>{
 for(const parts of [[],[{item:'pot',mount:'right',rot:[0,0,0]}]]){
  const r=await simulateV3({fighters:[{parts},{parts}],mode:'A',seed:2});assert.ok(r.events.some(e=>e.damage>0&&e.targetPart==='core'));assert.ok(r.frames.some(fr=>fr.t>1&&fr.fighters.every(f=>length(f.angularVelocity)>0)));assert.ok(r.frames[0].fighters.every(f=>f.parts.length===parts.length));
 }
});
test('detachment removes collider, preserves surviving point velocity and rotation without kick',()=>{
 const world=new RAPIER.World({x:0,y:0,z:0});try{
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1,2,3));
  world.createCollider(RAPIER.ColliderDesc.ball(.14).setMass(.75),body);
  const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(.2,.05,.1).setTranslation(0,0,.5).setMass(2),body);
  body.recomputeMassPropertiesFromColliders();body.setLinvel({x:2,y:3,z:4},true);body.setAngvel({x:1,y:2,z:3},true);
  const f={body,mass:body.mass()},p={collider,alive:true,hp:0};
  const point=[1.1,2.2,3.1],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],velocity=()=>add(arr(body.linvel()),cross(arr(body.angvel()),sub(point,arr(body.worldCom()))));
  const before=velocity(),rotation=arr(body.angvel()),event=detachPart(world,f,p),after=velocity();
  assert.equal(body.numColliders(),1);assert.equal(p.alive,false);assert.ok(Math.abs(f.mass-.75)<1e-6);assert.deepEqual(arr(body.angvel()),rotation);assert.ok(length(sub(before,after))<1e-5);assert.ok(length(sub(event.velocity,event.oldVelocity))>0);assert.ok(event.massBefore>event.massAfter);
 }finally{world.free();}
});
test('damage tiers and weak cap; near-static approach never gains damage from seed',()=>{
 const item=c.items[0],target=c.items.find(i=>i.id==='pillow'),args={attacker:item,target,materials:c.materials,matchups:c.matchups,maxHp:70,rules};
 for(const mode of ['A','B']){const d=tierDamage({...args,mode,impulse:100,weak:true});assert.ok(d.damage<=28);assert.ok(d.rawDamage>d.damageCap);assert.equal(d.damageCap,28);}
 for(const seed of [0,1])assert.equal(strikeRoles({normal:[1,0,0],velocities:[[0,20,0],[0,-20,0]],tipRatios:[1,1],tipBonus:.3,seed,minimumSpeed:rules.minimumClosingSpeed}).attacker,null);
});
test('invalid user selection fails before simulation',async()=>{
 const f=definition('pot');await assert.rejects(simulateV3({fighters:[{parts:[f.parts[0],{...f.parts[0],mount:'back'}]},f],seed:1}),/Duplicate/);await assert.rejects(simulateV3({fighters:[f,f],seed:-1}),/seed/);await assert.rejects(simulateV3({fighters:[{parts:[...f.parts,...f.parts]},f],seed:1}),/zero, one or two/);await assert.rejects(simulateV3({fighters:[{parts:[f.parts[0],{...f.parts[1],mount:f.parts[0].mount}]},f],seed:1}),/unique/);await assert.rejects(simulateV3({fighters:[definition('missing'),f],seed:1}),/Unknown/);await assert.rejects(simulateV3({fighters:[f,f],mode:'C',seed:1}),/mode/);await assert.rejects(simulateV3({fighters:[{parts:[{item:'pot',mount:'front',rot:[NaN,0,0]}]},f],seed:1}),/finite/);
});

test('sustained real surface contact is reported and repeated rubbing is not a new attack',async()=>{
 const {simulateWithRules}=await import('./rules-variant.mjs');
 const controlled=await simulateWithRules({maxDuration:2,initialGap:0,initialSpin:0,spinTorque:0,recoilSpeed:0,thrust:0});
 const r=await controlled({fighters:[{parts:[]},{parts:[]}],mode:'A',seed:1});
 assert.ok(r.meta.diagnostics.scrapeCount>0);
 for(const ep of r.meta.diagnostics.scrapeEpisodes)assert.ok(!r.events.some(e=>e.damage>0&&e.t>ep.start+.1+1e-8&&e.t<=ep.end+1e-8));
 await(await import('node:fs/promises')).writeFile(new URL('./contact-proof.json',import.meta.url),JSON.stringify({rules:r.meta.rules,diagnostics:r.meta.diagnostics,events:r.events},null,2)+'\n');
});
