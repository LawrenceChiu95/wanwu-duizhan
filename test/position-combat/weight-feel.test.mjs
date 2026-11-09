import assert from 'node:assert/strict';
import test from 'node:test';
import {
 itemCombat, loadCatalog, loadV3Rules, simulateV3, tierDamage,
 JUDGE_POSITION_COMBAT_RULES, POSITION_COMBAT_RULES
} from '../../sim/v3.js';

import {loadRules as loadCatalogRules} from '../../sim/index.js';

const gear=id=>({parts:[{item:'fanshuo-'+id,orient:'out',mount:'e0'}]});
const scenario={fighters:[gear('chair'),gear('mouse')],seed:984000,
 manual:{sides:['input','input'],inputs:[{step:1,side:0,action:'dash'},{step:600,side:0,action:'dash'}]}};

test('judge candidate distinguishes long thin gear from wide or compact gear',async()=>{
 const catalog=await loadCatalog(),rules=await loadV3Rules();
 const stats=(id,config)=>itemCombat(catalog.find(item=>item.id==='fanshuo-'+id),rules,config);
 for(const id of ['chair','pot','cushion','mouse']){
  assert.deepEqual(stats(id,JUDGE_POSITION_COMBAT_RULES),stats(id));
 }
 assert.equal(stats('chair',POSITION_COMBAT_RULES).hp,50.4);
 assert.equal(stats('chair',JUDGE_POSITION_COMBAT_RULES).hp,84);
 for(const id of ['knife','feather']){
  assert(stats(id,JUDGE_POSITION_COMBAT_RULES).hp<stats(id).hp);
  assert(stats(id,JUDGE_POSITION_COMBAT_RULES).power>stats(id).power);
 }
});

test('weight feel keeps the first contact and survives the replay round trip',async()=>{
 const run=combatRules=>simulateV3({...scenario,combat:'position',combatRules});
 const [before,after]=await Promise.all([run(POSITION_COMBAT_RULES),run(JUDGE_POSITION_COMBAT_RULES)]);
 const contact=match=>match.events.find(e=>e.type==='contact');
 assert.deepEqual(contact(after),contact(before));
 assert.equal(after.meta.initial[0].mass-after.meta.rules.core.mass,2);
 assert.deepEqual(after.meta.combatRules,JUDGE_POSITION_COMBAT_RULES);

 const noDashPenalty=structuredClone(JUDGE_POSITION_COMBAT_RULES);
 noDashPenalty.weightFeel.dashLoss=0;
 delete noDashPenalty.weightFeel.recenterBoost;
 const comparator=await run(noDashPenalty);
 const rebound=match=>match.events.find(e=>e.type==='recoil');
 assert.deepEqual(rebound(after),rebound(comparator));
 const speedAtLaunch=(match,step)=>{
  const dash=match.events.find(e=>e.type==='dash'&&e.phase==='go'&&e.pressStep===step);
  assert(dash);
  const frame=match.frames.find(f=>f.t>=dash.t);
  assert.equal(frame.fighters[0].mass,after.meta.initial[0].mass);
  return Math.hypot(...frame.fighters[0].velocity);
 };
 assert.equal(speedAtLaunch(after,1),speedAtLaunch(comparator,1));
 assert(speedAtLaunch(after,600)<speedAtLaunch(comparator,600));

 const {fighters,seed}=scenario;
 const replayed=await simulateV3({fighters,seed,combat:after.meta.combat,
  combatRules:after.meta.combatRules,manual:after.meta.manual});
 assert.deepEqual(replayed,after);
});

test('invalid weight feel settings fail before simulation',async()=>{
 for(const field of ['dashLoss','recenterBoost']){
  const combatRules=structuredClone(JUDGE_POSITION_COMBAT_RULES);
  combatRules.weightFeel[field]=1;
  await assert.rejects(simulateV3({...scenario,combat:'position',combatRules}),/Invalid position weight feel/);
 }
});

test('assembly weight changes only core-on-core damage, before the existing cap',async()=>{
 const rules=await loadV3Rules(),{materials,matchups,items}=await loadCatalogRules();
 const core={id:'__core',tag:'core',material:rules.core.material};
 const knife=items.find(item=>item.id==='fanshuo-knife');
 const hit={mode:'B',impulse:2,attacker:core,target:core,materials,matchups,maxHp:rules.core.hp,rules};
 const base=tierDamage(hit);
 const positionRules={...JUDGE_POSITION_COMBAT_RULES,coreMassImpact:1.5};
 const weighted=(from,to,overrides={})=>tierDamage({...hit,positionRules,coreMasses:[from,to],...overrides});
 const equal=weighted(1,1);
 assert.equal(equal.massImpact,1);
 assert.equal(equal.damage,base.damage);
 assert.equal(weighted(2,1).massImpact,2.5);
 assert.equal(weighted(1,2).massImpact,.4);
 assert(weighted(1,2).damage<base.damage);
 assert(weighted(2,1,{ramp:.5}).damage>tierDamage({...hit,ramp:.5}).damage);
 assert.equal(weighted(2,1,{ramp:100}).damage,base.damageCap);
 const reduced={...positionRules,coreDamageScale:.65};
 assert.equal(weighted(2,1,{ramp:100,positionRules:reduced}).damage,base.damageCap*.65);
 for(const overrides of [{attacker:knife},{target:knife},{attacker:knife,target:knife}]){
  assert.deepEqual(weighted(2,1,overrides),tierDamage({...hit,positionRules:JUDGE_POSITION_COMBAT_RULES,...overrides}));
  assert.deepEqual(weighted(2,1,{...overrides,positionRules:reduced}),weighted(2,1,overrides));
 }
});

test('weight damage uses the live masses and resimulates with the frozen combat rules',async()=>{
 const combatRules={...JUDGE_POSITION_COMBAT_RULES,coreMassImpact:1.5};
 const result=await simulateV3({...scenario,mode:'B',combat:'position',combatRules});
 assert(result.events.some(e=>e.massImpact>1&&e.masses[e.attacker]>e.masses[e.target]));
 assert(result.events.some(e=>e.massImpact<1&&e.masses[e.attacker]<e.masses[e.target]));
 for(const event of result.events.filter(e=>e.massImpact!==undefined)){
  assert.equal(event.part,'core');
  assert.equal(event.targetPart,'core');
  const from=event.masses[event.attacker],to=event.masses[event.target];
  const factor=Math.min(3,1+1.5*(Math.max(from,to)/Math.min(from,to)-1));
  assert.equal(event.massImpact,from>=to?factor:1/factor);
 }
 const {combat,combatRules:saved,manual}=result.meta;
 assert.deepEqual(await simulateV3({...scenario,mode:'B',combat,combatRules:saved,manual}),result);
 const reduced=await simulateV3({...scenario,mode:'B',combat,combatRules:{...saved,coreDamageScale:.65},manual});
 assert.deepEqual(reduced.events.find(e=>e.type==='contact'),result.events.find(e=>e.type==='contact'));
 assert.deepEqual(await simulateV3({...scenario,mode:'B',combat,combatRules:reduced.meta.combatRules,manual}),reduced);
 await assert.rejects(simulateV3({...scenario,combat:'position',combatRules:{...combatRules,coreMassImpact:-1}}),/coreMassImpact/);
 for(const coreDamageScale of [0,1.01,NaN]){
  await assert.rejects(simulateV3({...scenario,combat:'position',combatRules:{...combatRules,coreDamageScale}}),/coreDamageScale/);
 }
});
