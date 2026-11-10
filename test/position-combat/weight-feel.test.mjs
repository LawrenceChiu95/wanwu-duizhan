import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {
 itemCombat, loadCatalog, loadV3Rules, simulateV3, tierDamage,
 HEAVY_JUDGE_COMBAT_OPTIONS, JUDGE_POSITION_COMBAT_RULES, POSITION_COMBAT_RULES
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
 assert.equal(stats('chair',POSITION_COMBAT_RULES).hp,stats('chair').hp*.6);
 assert(stats('chair',JUDGE_POSITION_COMBAT_RULES).hp>stats('mouse',JUDGE_POSITION_COMBAT_RULES).hp);
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
 const {coreLoadout,coreFinishMultiplier,broadHeavyResistance,bareCoreReceive,...combatRules}=JUDGE_POSITION_COMBAT_RULES;
 const matchup={...scenario,fighters:[gear('chair'),gear('knife')]};
 const result=await simulateV3({...matchup,mode:'B',combat:'position',combatRules});
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
 assert.deepEqual(await simulateV3({...matchup,mode:'B',combat,combatRules:saved,manual}),result);
 const reduced=await simulateV3({...matchup,mode:'B',combat,combatRules:{...saved,coreDamageScale:.65},manual});
 assert.deepEqual(reduced.events.find(e=>e.type==='contact'),result.events.find(e=>e.type==='contact'));
 assert.deepEqual(await simulateV3({...matchup,mode:'B',combat,combatRules:reduced.meta.combatRules,manual}),reduced);
 await assert.rejects(simulateV3({...matchup,combat:'position',combatRules:{...combatRules,coreMassImpact:-1}}),/coreMassImpact/);
 for(const coreDamageScale of [0,1.01,NaN]){
  await assert.rejects(simulateV3({...matchup,combat:'position',combatRules:{...combatRules,coreDamageScale}}),/coreDamageScale/);
 }
});

test('core loadout uses primary attack and opposing durability without changing attachment hits, with a bounded core bonus',async()=>{
 const rules=await loadV3Rules(),{materials,matchups,items}=await loadCatalogRules();
 const core={id:'__core',tag:'core',material:rules.core.material};
 const knife=items.find(item=>item.id==='fanshuo-knife');
 const hit={mode:'B',impulse:2,attacker:core,target:core,materials,matchups,maxHp:rules.core.hp,rules,ramp:.5};
 const base=tierDamage(hit);
 assert.equal(tierDamage({...hit,coreLoadout:{attack:.6,defense:1.2}}).damage,base.damage*.5);
 assert(tierDamage({...hit,coreLoadout:{attack:1.4,defense:.8}}).damage>base.damage);
 const strong=tierDamage({...hit,coreLoadout:{attack:2,defense:.5},ramp:100});
 assert.equal(strong.damageCap,base.damageCap*1.25);
 assert.equal(strong.damage,strong.damageCap);
 for(const pair of [{attacker:knife},{target:knife},{attacker:knife,target:knife}]){
  assert.deepEqual(tierDamage({...hit,...pair,coreLoadout:{attack:.6,defense:1.2}}),tierDamage({...hit,...pair}));
 }
});

test('starting loadout weights follow orientation and persist after breaks, with deterministic replay',async()=>{
 const mixed=(out,hug)=>({parts:[...gear(out).parts,{item:'fanshuo-'+hug,orient:'hug',mount:'e180'}]});
 const fighters=[mixed('knife','cushion'),mixed('mouse','cushion')];
 const config={mainShare:.8,attackGain:1.65,durabilityGain:.8};
 const combatRules={...JUDGE_POSITION_COMBAT_RULES,coreLoadout:config};
 const params={...scenario,fighters,mode:'B',combat:'position'};
 const base=await simulateV3({...params,combatRules:JUDGE_POSITION_COMBAT_RULES});
 const result=await simulateV3({...params,combatRules});
 for(const type of ['contact','recoil']){
  assert.deepEqual(result.events.find(e=>e.type===type),base.events.find(e=>e.type===type));
 }
 const {items}=await loadCatalogRules();
 const score=(suffix,key)=>items.find(item=>item.id==='fanshuo-'+suffix).rating.scores[key];
 const weighted=(suffix,key)=>score(suffix,key)*.8+score('cushion',key)*(1-.8);
 const attacks=['knife','mouse'].map(item=>Math.max(.15,1+(weighted(item,'attack')-15)/50*1.65));
 const defenses=['knife','mouse'].map(item=>Math.max(.35,1+(weighted(item,'durability')-62)/50*.8));
 const coreHits=result.events.filter(e=>e.loadoutImpact!==undefined);
 assert(coreHits.length>1);
 assert(result.events.some(e=>e.type==='break'&&coreHits.some(hit=>hit.t>e.t)));
 for(const e of coreHits){
  assert.equal(e.part,'core');
  assert.equal(e.targetPart,'core');
  assert.equal(e.loadoutImpact,attacks[e.attacker]/defenses[e.target]);
 }
 assert.deepEqual(await simulateV3({...params,manual:result.meta.manual,combatRules:result.meta.combatRules}),result);
 await assert.rejects(simulateV3({...params,combatRules:{...combatRules,coreLoadout:{...config,mainShare:.5}}}),/Invalid position core loadout/);
});

test('judge late damage only increases actual core hits, with a frozen multiplier',async()=>{
 const {coreFinishMultiplier,...baselineRules}=JUDGE_POSITION_COMBAT_RULES;
 const part=(suffix,mount,orient)=>({item:'fanshuo-'+suffix,mount,orient});
 const fighters=[
  {parts:[part('cushion','e0','hug'),part('knife','e180','hug')]},
  {parts:[part('pot','e0','out'),part('cushion','e180','hug')]}
 ];
 const seed=196102,aiSeeds=[(seed^0xb7e15162)>>>0,(seed^0x243f6a88)>>>0];
 const {foes}=JSON.parse(await readFile(new URL('../../data/foes.json',import.meta.url),'utf8'));
 const params={fighters,seed,combat:'position',manual:{sides:['ai','ai'],aiSeeds,aiProfiles:[foes[1].ai,null]}};
 const baseline=await simulateV3({...params,combatRules:baselineRules});
 const result=await simulateV3({...params,combatRules:JUDGE_POSITION_COMBAT_RULES});
 assert.deepEqual(result.events.filter(e=>e.t<=34),baseline.events.filter(e=>e.t<=34));
 const hit=result.events.find(e=>e.targetPart==='core'&&e.t>34&&e.damageBeforeHpClamp>0);
 assert(hit);
 const before=baseline.events.find(e=>e.type===hit.type&&e.t===hit.t&&e.attacker===hit.attacker&&e.targetPart==='core');
 assert(before);
 assert(hit.damageCap>before.damageCap);
 assert(hit.damageBeforeHpClamp>before.damageBeforeHpClamp);
 assert(result.meta.duration<=baseline.meta.duration);
 assert.equal(result.meta.combatRules.coreFinishMultiplier,coreFinishMultiplier);
 assert.deepEqual(await simulateV3({...params,manual:result.meta.manual,combatRules:result.meta.combatRules}),result);
 await assert.rejects(simulateV3({...params,combatRules:{...baselineRules,coreFinishMultiplier:2.1}}),/coreFinishMultiplier/);
});


test('weak hits do less damage to broad heavy parts without raising their starting HP',async()=>{
 const {broadHeavyResistance,...beforeRules}=JUDGE_POSITION_COMBAT_RULES;
 const params={...scenario,mode:'B',combat:'position'};
 const before=await simulateV3({...params,combatRules:beforeRules});
 const after=await simulateV3({...params,combatRules:JUDGE_POSITION_COMBAT_RULES});
 assert.deepEqual(after.frames[0],before.frames[0]);
 const hit=after.events.find(e=>e.weakHitResistance!==undefined);
 assert(hit);
 assert.equal(hit.targetItem,'fanshuo-chair');
 const original=before.events.find(e=>e.t===hit.t&&e.attacker===hit.attacker&&e.targetPart===hit.targetPart&&e.damage>0);
 assert(original);
 assert(hit.damageBeforeHpClamp<original.damageBeforeHpClamp);
 assert.equal(hit.damageBeforeHpClamp,original.damageBeforeHpClamp*hit.weakHitResistance);
 assert(after.events.filter(e=>e.weakHitResistance!==undefined).every(e=>e.targetItem==='fanshuo-chair'));
 assert.deepEqual(await simulateV3({...params,manual:after.meta.manual,combatRules:after.meta.combatRules}),after);
});

test('candidate pacing adjustment applies only to automatic B and is reproducible',async()=>{
 const {autoBDamageScale,...baselineRules}=JUDGE_POSITION_COMBAT_RULES;
 const {fighters,seed,manual}=scenario;
 const run=(mode,combatRules,controls=null)=>
  simulateV3({fighters,seed,mode,manual:controls,combat:'position',combatRules});
 for(const [mode,controls] of [['A',null],['B',manual]]){
  const baseline=await run(mode,baselineRules,controls);
  const candidate=await run(mode,JUDGE_POSITION_COMBAT_RULES,controls);
  assert.deepEqual(candidate.events,baseline.events);
  assert.deepEqual(candidate.frames,baseline.frames);
 }
 const baseline=await run('B',baselineRules);
 const candidate=await run('B',JUDGE_POSITION_COMBAT_RULES);
 assert.equal(candidate.meta.rules.damageScale.B,baseline.meta.rules.damageScale.B*autoBDamageScale);
 assert.notDeepEqual(candidate.events,baseline.events);
 assert.deepEqual(await run('B',candidate.meta.combatRules),candidate);
});

test('a disarmed top takes more damage while the opponent keeps both attachments',async()=>{
 const {combatRules,...options}=HEAVY_JUDGE_COMBAT_OPTIONS;
 const {bareCoreReceive,bareCoreByPartsOnly,...baselineRules}=combatRules;
 const {foes,judgeBuilds}=JSON.parse(await readFile(new URL('../../data/foes.json',import.meta.url),'utf8'));
 const foe=foes.find(f=>f.id==='chang');
 const judgeBuild=judgeBuilds.position[foe.id];
 const fighters=[
  {parts:[{item:'fanshuo-pot',mount:'e0',orient:'out'},{item:'fanshuo-cushion',mount:'e180',orient:'hug'}]},
  {parts:judgeBuild.parts.map((part,index)=>({...part,mount:index?judgeBuild.spread:'e0'}))}
 ];
 const dashSteps=[60,612,1164,1716,2268,2820,3372,3924,4476,5028,5580,6132];
 const blockSteps=[492,1116,1740,2364];
 const inputsWithBlocks=blocks=>[...dashSteps.map(step=>({step,side:0,action:'dash'})),
  ...blocks.map(step=>({step,side:0,action:'block'}))].sort((a,b)=>a.step-b.step);
 const manual={sides:['input','ai'],aiSeeds:[607157222,3085844492],
  inputs:inputsWithBlocks([...blockSteps,3032]),aiProfiles:[null,{...foe.ai,...judgeBuild.ai}]};
 const params={...options,fighters,seed:987502,manual};
 const baseline=await simulateV3({...params,combatRules:baselineRules});
 const candidate=await simulateV3({...params,combatRules});
 const playerBreaks=candidate.events.filter(e=>e.type==='break'&&e.target===0);
 assert.equal(playerBreaks.length,2);
 const disarmed=playerBreaks[1];
 assert.deepEqual(candidate.events.filter(e=>e.t<=disarmed.t),baseline.events.filter(e=>e.t<=disarmed.t));
 const hits=candidate.events.filter(e=>e.bareCoreReceive!==undefined);
 assert(hits.some(e=>e.shield));
 assert(hits.every(e=>e.t>disarmed.t&&e.target===0&&e.targetPart==='core'));
 assert.equal(candidate.meta.winner,baseline.meta.winner);
 assert(candidate.meta.duration-disarmed.t<=8);
 assert.deepEqual(await simulateV3({...params,manual:candidate.meta.manual,combatRules:candidate.meta.combatRules}),candidate);
 await assert.rejects(simulateV3({...params,combatRules:{...combatRules,bareCoreReceive:3}}),/Bare core damage/);

 // Keep the same battle but use a later block cadence so the bare core lands a counter.
 const counterInputs=inputsWithBlocks([...blockSteps,2988,3612,4236,4860,5484,6108]);
 const counterParams={...params,manual:{...manual,inputs:counterInputs}};
 const old=await simulateV3({...counterParams,combatRules:{...baselineRules,bareCoreReceive:2.2}});
 const revised=await simulateV3({...counterParams,combatRules});
 const lastBreak=revised.events.filter(e=>e.type==='break'&&e.target===0).at(-1);
 assert(lastBreak);
 const threshold=revised.meta.initial[1].maxHp*.75;
 const counter=revised.events.find(e=>e.attacker===0&&e.targetPart==='core'&&
  e.t>lastBreak.t&&e.damage>0&&e.hpAfter<threshold);
 assert(counter);
 assert(revised.events.some(e=>e.t>counter.t&&e.target===0&&e.bareCoreReceive===bareCoreReceive));
 assert(!old.events.some(e=>e.t>counter.t&&e.bareCoreReceive!==undefined));
 assert(revised.meta.duration-lastBreak.t<=8);
 assert.equal(revised.meta.winner,old.meta.winner);
});
