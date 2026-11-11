import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {simulateV3,createV3Match,positionStrikeRoles,partRecoilFactor,itemCombat,loadV3Rules,loadCatalog,PLANAR_JUDGE_COMBAT_OPTIONS} from '../../sim/v3.js';
const rules={radiusTolerance:.03,recoilBase:.7,recoilLength:.25,outBonus:.12,rangeAttack:.8,rangeHp:.5};
const fighters=[{parts:[{item:'pan-lux3d',orient:'out',mount:'e0'},{item:'pillow',orient:'hug',mount:'e180'}]},{parts:[{item:'broom',orient:'out',mount:'e0'},{item:'slipper',orient:'hug',mount:'e180'}]}];
const sha=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
test('position roles use planar core radius, with a symmetric near-equal clash',()=>{
 const base={attacker:1,clash:false,tipRatios:[.2,.8],normalSpeeds:[1,1]};
 const a=positionStrikeRoles(base,[[1,5,0],[.5,0,0]],.03,.3);
 assert.equal(a.attacker,0);assert.equal(a.clash,false);assert.equal(a.tipMultiplier,1.06);assert.deepEqual(a.positionRadii,[1,.5]);
 const b=positionStrikeRoles(base,[[.5,0,0],[1,5,0]],.03,.3);assert.equal(b.attacker,1);
 const c=positionStrikeRoles(base,[[.5,0,0],[.52,0,0]],.03,.3);assert.equal(c.attacker,null);assert.equal(c.clash,true);
});
test('recoil depends on each contacted part, independently of strike role',async()=>{
 const c=await loadCatalog(),short=c.find(i=>i.id==='slipper'),long=c.find(i=>i.id==='broom');
 const part=(item,orient)=>({item,orient,mount:'e0'});
 assert(partRecoilFactor(part(long,'out'),rules)>partRecoilFactor(part(long,'hug'),rules));
 assert(partRecoilFactor(part(long,'hug'),rules)>partRecoilFactor(part(short,'hug'),rules));
 assert.equal(partRecoilFactor({mount:'core'},rules),1);
});
test('range raises attack and lowers HP only for the enabled rules',async()=>{
 const c=await loadCatalog(),r=await loadV3Rules(),long=c.find(i=>i.id==='broom');
 const before=itemCombat(long,r),after=itemCombat(long,r,rules);
 assert.equal(after.hp,before.hp*.75);assert.equal(after.power,before.power*1.4);assert.equal(after.defense,before.defense);
 const short=c.find(i=>i.id==='scissors');assert(itemCombat(short,r,rules).hp>itemCombat(short,r).hp);
});
for(const mode of ['A','B'])test(`position ${mode} rules freeze in replay and resimulate byte-identically`,async()=>{
 const copy=structuredClone(rules),m=await createV3Match({fighters,mode,seed:904001,combat:'position',combatRules:copy,manual:{sides:['ai','ai']}});
 copy.recoilBase=20;
 while(!m.done)m.advance();const result=m.result();
 assert.deepEqual(result.meta.combatRules,rules);assert.equal(result.meta.feel,'bounce');
 const replay=await simulateV3({fighters,mode:result.meta.mode,seed:result.meta.seed,combat:result.meta.combat,combatRules:result.meta.combatRules,feel:result.meta.feel,feelRules:result.meta.feelRules,manual:result.meta.manual});
 assert.equal(sha(result),sha(replay));
 const contacts=result.events.filter(e=>e.type==='contact');assert(contacts.length>0);
 for(const e of contacts){
  assert.equal(e.positionClash,Math.abs(e.positionRadii[0]-e.positionRadii[1])<=rules.radiusTolerance);
  if(!e.dashOverridesPosition){
   assert.equal(e.attacker,e.positionAttacker);
   assert.equal(e.clash,e.positionClash);
  }else{
   assert.equal(e.clash,false);
   assert.notEqual(e.attacker,e.positionAttacker);
  }
 }
 const hit=result.events.filter(e=>e.type==='hit'||e.type==='weak');
 for(const e of hit)assert.equal(e.roleMultiplier,e.role==='attack'?1:result.meta.rules.recoilDamageFraction);
 assert(result.events.some(e=>e.type==='recoil'&&e.partRecoil.length===2));
});
test('position request rejects missing or invalid frozen parameters',async()=>{
 for(const combatRules of [undefined,{}, {...rules,rangeHp:2},{...rules,rangeAttack:Infinity},{...rules,outBonus:-1}])await assert.rejects(createV3Match({fighters,seed:1,combat:'position',combatRules}));
});

test('oblique chair contact separates further in the plane while older replays keep their rule',async()=>{
 const seed=110212,chair={item:'fanshuo-chair',orient:'out',mount:'e0'};
 const fighters=['pot','cushion'].map(id=>({parts:[chair,{item:'fanshuo-'+id,orient:'hug',mount:'e180'}]}));
 const inputs=[];
 for(let step=60;step<7200;step+=552)inputs.push({step,side:1,action:'dash'});
 for(let step=300;step<7200;step+=624)inputs.push({step,side:1,action:'block'});
 inputs.sort((a,b)=>a.step-b.step);
 const manual={sides:['ai','input'],aiSeeds:[(seed^0xb7e15162)>>>0,(seed^0x243f6a88)>>>0],inputs,
  aiProfiles:[{version:1,id:'chang',think:.05,reactionDelay:.02,reactionJitter:.02,dashRange:[.5,3],blockLead:.15},null]};
 const params={...PLANAR_JUDGE_COMBAT_OPTIONS,fighters,seed,manual};
 const {planeOverlapCorrectionCap,...oldRules}=params.combatRules;
 const old=await simulateV3({...params,combatRules:oldRules});
 const fixed=await simulateV3(params);
 assert(old.meta.diagnostics.maxResidualPenetration>.20);
 assert(fixed.meta.diagnostics.maxResidualPenetration<.05);
 assert(fixed.meta.diagnostics.maxPositionCorrection<=planeOverlapCorrectionCap);
 assert(fixed.frames.every(frame=>frame.fighters.every(fighter=>fighter.pos[1]===0)));
 assert.equal(fixed.meta.combatRules.planeOverlapCorrectionCap,planeOverlapCorrectionCap);
});
