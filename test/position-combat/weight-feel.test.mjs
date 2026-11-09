import assert from 'node:assert/strict';
import test from 'node:test';
import {
 itemCombat, loadCatalog, loadV3Rules, simulateV3,
 JUDGE_POSITION_COMBAT_RULES, POSITION_COMBAT_RULES
} from '../../sim/v3.js';

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
