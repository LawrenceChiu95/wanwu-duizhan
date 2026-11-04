import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import RAPIER from '../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import {simulateV3,createV3Match,loadV3Rules,loadCatalog,mountTransform,itemAxes,detachPart,tierDamage,damageRamp,doubleKoWinner} from '../../sim/v3.js';
import {loadRules,strikeRoles}from'../../sim/index.js';
import{vec,arr,add,sub,rotate,euler,length,random}from'../../sim/math.js';
import{definition}from'./probe.mjs';
const digest=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const c=await loadRules(),rules=await loadV3Rules(),catalog=await loadCatalog();
const designs=JSON.parse(await readFile(new URL('../../data/default-item-designs.json',import.meta.url),'utf8')).items;
const simulations=[];
for(const mode of ['A','B'])for(const [left,right]of [['broom','pot'],['scissors','pillow'],['lamp-lux3d','pan-lux3d']])simulations.push(await simulateV3({fighters:[definition(left),definition(right)],mode,seed:1}));
test('explicit new schema, deterministic full replay, A/B identical initial geometry',async()=>{
 const a=simulations[0],again=await simulateV3({fighters:a.meta.initial.map(f=>f.definition),mode:'A',seed:1});
 assert.equal(digest(a),digest(again));assert.equal(a.meta.schemaVersion,3);assert.deepEqual(a.meta.initial,simulations[3].meta.initial);
 for(const r of simulations){assert.equal(r.frames[0].t,0);assert.equal(r.frames.at(-1).t,r.meta.duration);assert.ok(r.frames.every(fr=>fr.fighters.every(f=>[...f.pos,...f.quat,...f.velocity,...f.angularVelocity,...f.centerOfMass,f.hp,f.mass,...f.parts.flatMap(p=>[p.hp,...p.pos,...p.quat])].every(Number.isFinite))));assert.ok(r.decisive.t1-r.decisive.t0<=2.5+1e-8);}
});
test('authored wasteland broom and pot finish with finite physics in both modes',async()=>{
 for(const mode of ['A','B']){
  const r=await simulateV3({fighters:[definition('wasteland-broom'),definition('wasteland-pot')],mode,seed:1});
  assert.ok(['ko','double-ko','timeout'].includes(r.meta.reason));
  assert.ok(r.meta.duration>0&&r.meta.duration<=rules.maxDuration);
  assert.equal(r.frames.at(-1).t,r.meta.duration);
  for(const frame of r.frames)for(const f of frame.fighters){
   assert.ok([...f.pos,...f.quat,...f.velocity,...f.angularVelocity,...f.centerOfMass,f.hp,f.mass,...f.parts.flatMap(p=>[p.hp,...p.pos,...p.quat])].every(Number.isFinite));
  }
  for(const [side,id]of ['wasteland-broom','wasteland-pot'].entries()){
   assert.equal(r.meta.initial[side].parts[0].item,id);
   assert.equal(r.meta.initial[side].definition.parts[0].item,id);
   const expectedMass=rules.core.mass+r.meta.initial[side].definition.parts.reduce((sum,p)=>sum+catalog.find(item=>item.id===p.item).mass,0);
   assert.ok(Math.abs(r.frames[0].fighters[side].mass-expectedMass)<1e-5,`${mode} ${id}: rigid-body mass must include the core and both authored attachments`);
  }
 }
});
test('equator slots and orientations, standard dimensions, inner end sunk into the core',()=>{
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),unit=k=>[0,1,2].map(i=>i===k?1:0);
 assert.ok(Object.keys(rules.top.slots).length>=4);assert.deepEqual(rules.top.orients,['out','hug']);
 for(const item of catalog){assert.equal(item.mass,designs.find(d=>d.id===item.id)?.massKg??c.itemStandards[item.category].massKg);const span=Math.max(...item.bounds.max.map((v,i)=>v-item.bounds.min[i]));assert.ok(Math.abs(span-c.itemStandards[item.category].longSideMeters)<1e-6);
  const {long,thin}=itemAxes(item);
  for(const mount of Object.keys(rules.top.slots))for(const orient of rules.top.orients){
   const {offset,quat:q,direction:d}=mountTransform(item,mount,orient,rules),points=item.hull.map(v=>add(offset,rotate(q,v)));
   assert.ok(Math.abs(d[1])<1e-12&&Math.abs(length(d)-1)<1e-12);
   assert.ok(Math.abs(Math.min(...points.map(v=>dot(v,d)))-(rules.core.radius-rules.top.embed))<1e-7);
   const L=rotate(q,unit(long)),T=rotate(q,unit(thin));
   if(orient==='out'){assert.ok(Math.abs(dot(L,d)*(rules.top.outEnd[item.id]??1)-1)<1e-6);assert.ok(Math.abs(Math.abs(T[1])-1)<1e-6);assert.ok(dot(offset,d)>rules.core.radius*.5);}
   else{assert.ok(Math.abs(Math.abs(L[1])-1)<1e-6);assert.ok(Math.abs(dot(T,d)-1)<1e-6);}
  }
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
 for(const parts of [[],[{item:'pot',mount:'e90',orient:'out'}]]){
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
test('damage ramp is piecewise linear and never applies without a hit',()=>{
 const pts=[[0,.75],[15,.9],[30,1.3],[40,1.8]];assert.equal(damageRamp(0,pts),.75);assert.equal(damageRamp(-1,pts),.75);assert.ok(Math.abs(damageRamp(22.5,pts)-1.1)<1e-12);assert.equal(damageRamp(60,pts),1.8);assert.equal(damageRamp(10,undefined),1);
 const item=c.items[0],target=c.items.find(i=>i.id==='pillow'),base={mode:'A',impulse:1,attacker:item,target,materials:c.materials,matchups:c.matchups,maxHp:55,rules};
 assert.ok(tierDamage({...base,ramp:1.5}).damage<=55*rules.maxHitFraction+1e-9);
});
test('damage tiers and weak cap; near-static approach never gains damage from seed',()=>{
 // Use the designed heavy pot so both modes actually exceed the cap; low-attack scissors need not.
 const item=c.items.find(i=>i.id==='pan-lux3d'),target=c.items.find(i=>i.id==='pillow'),args={attacker:item,target,materials:c.materials,matchups:c.matchups,maxHp:70,rules};
 for(const mode of ['A','B']){const d=tierDamage({...args,mode,impulse:100,weak:true});assert.ok(d.damage<=28);assert.ok(d.rawDamage>d.damageCap);assert.equal(d.damageCap,28);}
 for(const seed of [0,1])assert.equal(strikeRoles({normal:[1,0,0],velocities:[[0,20,0],[0,-20,0]],tipRatios:[1,1],tipBonus:.3,seed,minimumSpeed:rules.minimumClosingSpeed}).attacker,null);
});
test('invalid user selection fails before simulation',async()=>{
 const f=definition('pot');await assert.rejects(simulateV3({fighters:[{parts:[f.parts[0],{...f.parts[0],mount:'back'}]},f],seed:1}),/Duplicate/);await assert.rejects(simulateV3({fighters:[f,f],seed:-1}),/seed/);await assert.rejects(simulateV3({fighters:[{parts:[...f.parts,...f.parts]},f],seed:1}),/zero, one or two/);await assert.rejects(simulateV3({fighters:[{parts:[f.parts[0],{...f.parts[1],mount:f.parts[0].mount}]},f],seed:1}),/unique/);await assert.rejects(simulateV3({fighters:[definition('missing'),f],seed:1}),/Unknown/);await assert.rejects(simulateV3({fighters:[f,f],mode:'C',seed:1}),/mode/);await assert.rejects(simulateV3({fighters:[{parts:[{item:'pot',mount:'e0',orient:'sideways'}]},f],seed:1}),/orient/);await assert.rejects(simulateV3({fighters:[{parts:[{item:'pot',mount:'front',orient:'out'}]},f],seed:1}),/slot/);
});

test('sustained real surface contact is reported and repeated rubbing is not a new attack',async()=>{
 const {simulateWithRules}=await import('../v3-top/variant.mjs');
 const controlled=await simulateWithRules({maxDuration:2,initialGap:0,top:{spinRate:0},recoilSpeed:0,thrust:0});
 const r=await controlled({fighters:[{parts:[]},{parts:[]}],mode:'A',seed:1});
 assert.ok(r.meta.diagnostics.scrapeCount>0);
 for(const ep of r.meta.diagnostics.scrapeEpisodes)assert.ok(!r.events.some(e=>e.damage>0&&e.t>ep.start+.1+1e-8&&e.t<=ep.end+1e-8));
 await(await import('node:fs/promises')).writeFile(new URL('./contact-proof.json',import.meta.url),JSON.stringify({rules:r.meta.rules,diagnostics:r.meta.diagnostics,events:r.events},null,2)+'\n');
});
test('same-step double break: less overkill wins, exact tie is a draw; reason keeps the decided loser and its broken parts',async()=>{
 assert.equal(doubleKoWinner([3,5]),0);assert.equal(doubleKoWinner([5,3]),1);assert.equal(doubleKoWinner([4,4]),null);assert.equal(doubleKoWinner([0,0]),null);
 // v13 intentionally changed the opening, so old batch seed 228 is no longer a double KO.
 // Keep both regressions: a controlled real same-step double KO, then a normal-rules KO after two detachments.
 const {simulateWithRules}=await import('../v3-top/variant.mjs');
 const double=await simulateWithRules({core:{hp:1},attachmentHp:.01,maxHitFraction:100000,recoilDamageFraction:.5});
 const r=await double({fighters:[{parts:[{item:'broom',mount:'e0',orient:'out'},{item:'scissors',mount:'e90',orient:'hug'}]},{parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'lamp-lux3d',mount:'e180',orient:'hug'}]}],mode:'A',seed:0});
 const ko=r.events.find(e=>e.type==='ko');
 assert.equal(r.meta.reason,'double-ko');assert.deepEqual(ko.targets,[0,1]);
 const over=[0,1].map(i=>r.events.filter(e=>e.t===ko.t&&e.target===i&&e.targetPart==='core'&&e.damage>0).reduce((n,e)=>n+e.damageBeforeHpClamp-e.damage,0));
 assert.deepEqual(ko.overkill,over);assert.ok(over[0]<over[1]);
 assert.equal(r.meta.winner,0);assert.equal(ko.winner,0);assert.equal(ko.target,1);
 const why=r.decisive.why;
 assert.equal(why.target,1);assert.equal(why.attacker,0);
 assert.equal(r.decisive.eventIndex,r.events.indexOf(r.events.findLast(e=>e.t===ko.t&&e.target===1&&e.targetPart==='core'&&e.hpAfter===0)));
 // MVP shortens broom geometry and changes category/orient damage, so normal seed 2 no longer
 // loses after two detachments. A controlled high-core/low-part-HP fight keeps the same real
 // collision -> break -> later core KO -> loser-facts regression without asserting an old balance outcome.
 // Use the shipping arena and derive the loser from the real outcome.
 const afterBreaks=await simulateWithRules({core:{hp:500},attachmentHp:1});
 const detached=await afterBreaks({fighters:[{parts:[{item:'pan-lux3d',mount:'e90',orient:'out'},{item:'broom',mount:'e270',orient:'out'}]},{parts:[{item:'pan-lux3d',mount:'e90',orient:'out'},{item:'lamp-lux3d',mount:'e270',orient:'hug'}]}],mode:'A',seed:2,manual:{sides:['ai','ai']}});
 assert.equal(detached.meta.reason,'ko');assert.ok([0,1].includes(detached.meta.winner));
 const loser=1-detached.meta.winner,broken=detached.events.filter(e=>e.type==='break'&&e.target===loser),whyBroken=detached.decisive.why,koBroken=detached.events.find(e=>e.type==='ko');
 assert.equal(whyBroken.target,loser);assert.equal(whyBroken.attacker,detached.meta.winner);assert.equal(broken.length,2);assert.ok(broken.every(e=>e.t<koBroken.t));assert.equal(whyBroken.loserPartsLeft,0);
 assert.deepEqual(whyBroken.loserBroken.map(b=>b.item).sort(),detached.meta.initial[loser].parts.map(p=>p.item).sort());
 assert.equal(detached.decisive.eventIndex,detached.events.indexOf(detached.events.findLast(e=>e.t===koBroken.t&&e.target===loser&&e.targetPart==='core'&&e.hpAfter===0)));
});
test('manual mode: presses taken per fixed step and recorded; replaying the same presses is byte-identical',async()=>{
 const fighters=[{parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'pillow',mount:'e180',orient:'hug'}]},{parts:[{item:'pan-lux3d',mount:'e0',orient:'out'},{item:'lamp-lux3d',mount:'e180',orient:'hug'}]}];
 // Live: step one at a time like the page does, pressing at uneven moments (some on cooldown and ignored).
 const m=await createV3Match({fighters,mode:'A',seed:5,manual:{sides:['input','ai']}}),pick=random(99);let next=20,tries=0;
 while(!m.done){if(m.step>=next){m.press(0,pick()<.5?'dash':'block');tries++;next=m.step+1+Math.floor(pick()*90);}m.advance();}
 const live=m.result(),inputs=live.meta.manual.inputs;
 assert.ok(inputs.length>=4&&inputs.length<tries,`${inputs.length} of ${tries} presses taken`);
 assert.deepEqual(live.events.filter(e=>e.type==='press'&&e.side===0).map(e=>[e.t,e.action]),inputs.map(x=>[x.step*live.meta.rules.dt,x.action]));
 assert.ok(live.events.some(e=>e.type==='dash'&&e.phase==='go'&&e.side===1)&&live.events.some(e=>e.type==='block'&&e.side===1),'the computer dashes and blocks');
 const again=await simulateV3({fighters,mode:'A',seed:5,manual:{sides:['input','ai'],inputs}});
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(again)).digest('hex'),crypto.createHash('sha256').update(JSON.stringify(live)).digest('hex'));
 // Computer on both sides: fixed by the seed.
 const ai=()=>simulateV3({fighters,mode:'A',seed:11,manual:{sides:['ai','ai']}});
 assert.equal(JSON.stringify(await ai()),JSON.stringify(await ai()));
 // Auto replays carry no manual rules or events.
 const auto=await simulateV3({fighters,mode:'A',seed:5});
 assert.equal(auto.meta.rules.manual,undefined);assert.equal(auto.meta.manual,undefined);assert.ok(!auto.events.some(e=>['press','dash','block','parry'].includes(e.type)));
});
test('manual mode: a lunge into a raised shield is bounced (parry); a landed lunge hits harder, ×1.25 after the single-hit cap',async()=>{
 // The old AI seed 3 no longer parries after the opening/window changed. Keep every damage/recoil
 // assertion, using explicit presses and zero spin so the timing fixture has a straight real impact.
 const {simulateWithRules}=await import('../v3-top/variant.mjs');
 const simulate=await simulateWithRules({top:{spinRate:0},initialGap:1});
 const fighters=[{parts:[]},{parts:[]}],r=await simulate({fighters,mode:'A',seed:3,manual:{sides:['input','input'],inputs:[{step:1,side:0,action:'dash'},{step:44,side:1,action:'block'},{step:700,side:0,action:'dash'}]}}),M=r.meta.rules.manual;
 const parry=r.events.find(e=>e.type==='parry'),landed=r.events.find(e=>(e.type==='hit'||e.type==='weak')&&e.dash&&!e.shield&&e.role==='attack');
 assert.ok(parry,'a parry');assert.ok(landed,'a landed lunge');
 assert.ok(r.events.some(e=>e.type==='dash'&&e.phase==='end'&&e.outcome==='blocked'&&e.side===parry.attacker&&e.t===parry.t));
 // Deliberate (Elara, after Sol d75073bd): the 30% / 40% single-hit cap is for ordinary impacts; a landed lunge
 // multiplies by dashDamage (1.25) AFTER the cap, so one hit can take up to 37.5% / 50% (a full core still needs two).
 assert.ok(landed.damageBeforeHpClamp>=Math.min(landed.rawDamage,landed.damageCap)*M.dashDamage-1e-9);
 // The lunger bounces hard; the shield holder barely moves (unless it was lunging itself in the same instant).
 for(const p of r.events.filter(e=>e.type==='parry')){
  const recoil=r.events.find(e=>e.type==='recoil'&&e.t===p.t),both=r.events.some(e=>e.type==='dash'&&e.phase==='end'&&e.t===p.t&&e.side===p.target);
  assert.equal(recoil.recoilScale[p.attacker],M.bounceRecoil);if(!both)assert.equal(recoil.recoilScale[p.target],M.blockRecoil);
 }
 for(const e of r.events.filter(e=>(e.type==='hit'||e.type==='weak')&&e.shield))assert.ok(e.damageBeforeHpClamp<=e.rawDamage*M.blockDamage+1e-9);
});
