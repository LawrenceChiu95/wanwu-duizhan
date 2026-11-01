import test from 'node:test';
import {simulateHistorical} from './historical-sim.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import {simulate,loadCatalog,loadRules,contactDamage,zoneRadius,zoneDamageRate,strikeRoles,simultaneousWinner,weakCritical} from '../../sim/index.js';
import {enumerateLayouts,findReversal} from '../../sim/layouts.js';
import {summarize} from '../../sim/batch.js';
import {random} from '../../sim/math.js';
const f=item=>({parts:[{item,mount:'core',rot:[0,0,0]}]});
const digest=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const c=await loadRules();
test('six licensed GLBs plus two Lux3D variants: measured geometry, hashes and category mass',async()=>{
 const all=await loadCatalog(),items=all.filter(i=>!i.generated);const original=JSON.parse(await readFile(new URL('./original-catalog-items.json',import.meta.url)));assert.deepEqual(items.filter(i=>i.id!=='broom'),original.filter(i=>i.id!=='broom'));const broom=items.find(i=>i.id==='broom'),oldBroom=original.find(i=>i.id==='broom');assert.equal(broom.standardLongSide,.8);assert.equal(broom.mass,oldBroom.mass);assert.deepEqual(broom.hull,oldBroom.hull.map(v=>v.map(x=>x*(.8/1.2000000000000002))));assert.equal(items.length,8);assert.equal(items.filter(i=>!i.comparisonBase).length,6);
 for(const i of items){assert.ok(i.hull.length>=4&&i.hull.length<=64);assert.ok(i.hull.flat().every(Number.isFinite));assert.equal(i.massBasis,'category');assert.equal(i.mass,c.itemStandards[i.category].massKg);assert.ok(i.mass>0);assert.equal(i.standardLongSide,c.itemStandards[i.category].longSideMeters);assert.ok(Math.abs(Math.max(...i.bounds.max.map((v,k)=>v-i.bounds.min[k]))-i.standardLongSide)<1e-6);const glb=await readFile(new URL('../../'+i.glb,import.meta.url));assert.equal(glb.readUInt32LE(0),0x46546c67);assert.equal(crypto.createHash('sha256').update(glb).digest('hex'),i.source.normalizedSha256);if(!i.comparisonBase)assert.ok(['CC0-1.0','CC-BY-3.0'].includes(i.source.license));else{const base=items.find(b=>b.id===i.comparisonBase);assert.deepEqual(i.stats,base.stats);assert.equal(i.tag,base.tag);assert.equal(i.material,base.material);assert.notDeepEqual(i.hull,base.hull);}}
 const classes={scissors:'sharp',lamp:'blunt',broom:'rod',pot:'blunt',slipper:'soft',pillow:'soft'};for(const [id,tag] of Object.entries(classes))assert.equal(items.find(i=>i.id===id).tag,tag);
 for(const tag of Object.values(classes))assert.ok(Object.values(c.matchups).some(targets=>targets[tag]>1),'every class has a counter');
 items[0].name='mutated';assert.notEqual((await loadCatalog())[0].name,'mutated');
});
test('A impulse/hardness; B material and defense; weak point exactly doubles',()=>{
 const attacker=c.items.find(i=>i.tag==='sharp'),target=c.items.find(i=>i.tag==='soft');
 const args={attacker,target,materials:c.materials,matchups:c.matchups,impulse:3,weak:false};
 const a=contactDamage({...args,mode:'A'}),b=contactDamage({...args,mode:'B'});
 assert.equal(a.damage,3*Math.sqrt(c.materials[attacker.material].hardness/c.materials[target.material].hardness));assert.equal(b.damage,attacker.stats.attack*1.5-target.stats.defense);
 assert.equal(contactDamage({...args,mode:'B',weak:true}).damage,b.damage*2);
 assert.equal(zoneRadius(0,c.arena),c.arena.zoneStartRadius);assert.equal(zoneRadius(60,c.arena),c.arena.zoneEndRadius);
 assert.equal(zoneDamageRate(19,150,c.arena),0);assert.equal(zoneDamageRate(20,150,c.arena),0);assert.ok(zoneDamageRate(40,150,c.arena)<zoneDamageRate(60,150,c.arena));assert.equal(zoneDamageRate(40,300,c.arena),2*zoneDamageRate(40,150,c.arena));
});
test('real simulations: deterministic replay, A/B initial state, physical separation and HP accounting',async()=>{
 const args={fighters:[f('broom'),f('pot')],mode:'A',seed:1};
 const a=await simulate(args),again=await simulate(args),b=await simulate({...args,mode:'B'});
 assert.equal(digest(a),digest(again));assert.deepEqual(a.meta.initial,b.meta.initial);assert.notEqual(digest(a),digest(b));
 for(const r of [a,b]){
  assert.ok(r.events.some(e=>['hit','crit','weak'].includes(e.type)));assert.ok([...r.events,r.decisive].every(e=>[...e.caption].length<=20&&!/冲量|硬度修正|攻守判定|百分比|扣掉|[0-9]/.test(e.caption)&&typeof e.detail==='string'));assert.ok(r.meta.initial.every(f=>f.maxHp===c.arena.fighterHp));assert.ok(r.meta.duration>0&&r.meta.duration<=60);assert.ok(r.meta.diagnostics.longestContact<1);assert.ok(r.meta.diagnostics.maxResidualPenetration<=.00051);
  assert.equal(r.frames[0].t,0);assert.equal(r.frames.at(-1).t,r.meta.duration);assert.ok(r.decisive.t1-r.decisive.t0<=2.500001);
  assert.ok(r.frames.every(fr=>fr.fighters.every(v=>[...v.pos,...v.quat,v.hp,...v.parts.flatMap(p=>[...p.pos,...p.quat])].every(Number.isFinite))));
  for(let i=0;i<2;i++){const total=r.events.filter(e=>e.target===i).reduce((s,e)=>s+e.damage,0);assert.ok(Math.abs(Math.max(0,r.meta.initial[i].maxHp-total)-r.frames.at(-1).fighters[i].hp)<.13);}
  for(const e of r.events.filter(e=>e.item)){assert.ok(e.impulse>0);assert.equal(e.multiplier,e.weak?2:1);const target=c.items.find(x=>x.id===e.targetItem);const distance=Math.hypot(...e.targetLocalPoint.map((v,k)=>v-target.weakPoint.pos[k]));assert.ok(Math.abs(distance-e.weakDistance)<1e-9);assert.equal(e.weakContact,distance<=target.weakPoint.radius);assert.equal(e.weak,e.role==='attack'&&e.weakContact&&e.criticalRoll<e.criticalChance);assert.equal(e.criticalRoll===null,!(e.role==='attack'&&e.weakContact));const raw=r.meta.mode==='A'?e.impulse*c.arena.impulseToDamage*e.hardness*e.multiplier:Math.max(0,c.items.find(x=>x.id===e.item).stats.attack*e.matchup-target.stats.defense)*e.multiplier*c.arena.statDamageScale*e.hardness;assert.ok(Math.abs(e.rawDamage-raw*e.tipMultiplier)<1e-8);assert.equal(e.damageCap,r.meta.initial[e.target].maxHp*(e.weak?c.arena.weakCritMaxFraction:c.arena.maxHitFraction));assert.ok(Math.abs(e.damage-Math.min(raw*e.tipMultiplier,e.damageCap)*e.roleMultiplier)<1e-8);assert.equal(e.role,e.attacker===e.strikeAttacker?'attack':'recoil');assert.equal(e.roleMultiplier,e.role==='attack'?1:c.arena.recoilDamageFraction);assert.ok(e.damage<=r.meta.initial[e.target].maxHp*.4);assert.ok(e.t>=3);for(let k=0;k<2;k++)assert.ok(Math.abs(e.attackScores[k]-e.normalSpeeds[k]*e.masses[k]**e.massPower*e.matchupMultipliers[k]*(1+c.arena.tipBonus*e.tipRatios[k]))<1e-8);}
  const end=r.events[r.decisive.finishEventIndex];if(r.meta.reason==='ko'){assert.ok(end.damage>0);assert.equal(r.decisive.finishType,end.type==='zone'?'zone':'contact');}assert.ok(r.events.filter(e=>e.t<=20&&e.type==='zone').every(e=>e.damage===0));
 }
});
test('162 unique layouts, same-seed contact reversal and timeout percentage decision',async()=>{
 const layouts=enumerateLayouts(['broom','pot','pillow']);assert.equal(layouts.length,162);assert.equal(new Set(layouts.map(l=>l.id)).size,162);
 const rows=JSON.parse(await readFile(new URL('./layouts/rounds.json',import.meta.url)));
 const reversal=findReversal(rows);assert.ok(reversal);assert.equal(reversal.win.winner,0);assert.equal(reversal.loss.winner,1);assert.notEqual(reversal.win.layout,reversal.loss.layout);
 const timeout=rows.find(r=>r.reason==='timeout');
 if(timeout){const layout=layouts.find(l=>l.id===timeout.layout),r=await simulateHistorical({fighters:[layout.fighter,layouts[0].fighter],mode:timeout.mode,seed:timeout.seed});assert.equal(r.meta.reason,'timeout');{const hp=r.frames.at(-1).fighters.map(x=>x.hp/x.maxHp);assert.equal(r.meta.winner,hp[0]===hp[1]?null:hp[0]>hp[1]?0:1);assert.match(r.decisive.caption,/时间到/);}}
});
test('compound COM follows layout; world part transforms and per-part hit identity',async()=>{
 const a={parts:[{item:'broom',mount:'front',rot:[0,0,0]},{item:'pot',mount:'top',rot:[0,0,0]},{item:'pillow',mount:'side',rot:[0,0,0]}]};
 const b={parts:[{...a.parts[1],mount:'front'},{...a.parts[2],mount:'top'},{...a.parts[0],mount:'side'}]};
 const ra=await simulate({fighters:[a,b],mode:'B',seed:7}),rb=await simulate({fighters:[b,b],mode:'B',seed:7});
 assert.notDeepEqual(ra.meta.initial[0].centerOfMass,rb.meta.initial[0].centerOfMass);assert.ok(Math.abs(ra.meta.initial[0].mass-rb.meta.initial[0].mass)<.0001);
 assert.ok(ra.frames.every(fr=>fr.fighters.every(v=>v.parts.length===3)));assert.ok(ra.events.some(e=>e.item&&e.mount!=='core'));for(const r of [ra,rb]){const hits=r.events.filter(e=>e.item);const times=[...new Set(hits.map(e=>e.t))];assert.ok(hits.every(e=>e.t>=3&&e.damage<=r.meta.initial[e.target].maxHp*.4));for(let k=1;k<times.length;k++)assert.ok(times[k]-times[k-1]>=c.arena.damageCooldown-1e-8);for(const t of times)assert.equal(hits.filter(e=>e.t===t).length,2);assert.ok(r.frames.filter(fr=>fr.t<3).every(fr=>fr.fighters.every(f=>f.hp===f.maxHp)));}
});
test('invalid input fails explicitly',async()=>{
 await assert.rejects(simulate({fighters:[f('missing'),f('pot')],mode:'A',seed:1}),/Unknown item/);await assert.rejects(simulate({fighters:[f('pot'),f('pot')],mode:'C',seed:1}),/mode/);await assert.rejects(simulate({fighters:[f('pot'),f('pot')],mode:'A',seed:NaN}),/seed/);
});

test('attack role uses pre-impact normal speed and tip; simultaneous KO explicitly favors that attacker',()=>{
 const base={normal:[1,0,0],tipRatios:[0,0],tipBonus:.3,seed:1};
 assert.equal(strikeRoles({...base,velocities:[[2,0,0],[-1,0,0]]}).attacker,0);
 assert.equal(strikeRoles({...base,velocities:[[.5,10,0],[-1,0,0]]}).attacker,1);
 assert.equal(strikeRoles({...base,velocities:[[1,0,0],[-1,0,0]],tipRatios:[1,0]}).attacker,0);
 const collision={...base,velocities:[[1.4,0,0],[-1,0,0]]};
 assert.equal(strikeRoles(collision).attacker,0);assert.equal(strikeRoles({...collision,masses:[1,2]}).attacker,1);assert.equal(strikeRoles({...collision,masses:[1,4],massPower:0.5}).attacker,1);assert.equal(strikeRoles({...collision,matchupMultipliers:[1,1.5]}).attacker,1);
 assert.deepEqual(simultaneousWinner({fallen:[[0,'ko'],[1,'ko']],hp:[0,-1],lastStrike:{t:10,attacker:1},t:10,deathCauses:[{t:10,type:'hit'},{t:10,type:'hit'}]}),{winner:1,simultaneousKo:true,resolvedByAttacker:true});
 assert.equal(simultaneousWinner({fallen:[[0,'ko'],[1,'ko']],hp:[0,-1],lastStrike:{t:10,attacker:1},t:10,deathCauses:[{t:10,type:'hit'},{t:10,type:'zone'}]}).winner,null);
 assert.equal(simultaneousWinner({fallen:[[0,'ko'],[1,'ko']],hp:[0,-1],lastStrike:{t:9,attacker:1},t:10,deathCauses:[{t:10,type:'zone'},{t:10,type:'zone'}]}).winner,null);
});

test('weakpoint chance is gated by physical contact, with an exact deterministic threshold',()=>{
 assert.equal(weakCritical({contact:false,roll:0,chance:1}),false);
 assert.equal(weakCritical({contact:true,roll:0,chance:0}),false);
 assert.equal(weakCritical({contact:true,roll:.49,chance:.5}),true);
 assert.equal(weakCritical({contact:true,roll:.5,chance:.5}),false);
});

test('recorded real impacts: critical exceeds ordinary cap, missed weakpoint stays ordinary, counter changes attacker',async()=>{
 const proof=JSON.parse(await readFile(new URL('./batch/mechanics-evidence.json',import.meta.url)));
 assert.ok(proof.criticalOverNormalCap>0);assert.ok(proof.weakContacts>proof.weakTriggered);
 for(const [kind,example] of [['critical',proof.critical],['missed',proof.missed],['counter',proof.counterRoleChange]]){
  const r=await simulateHistorical({fighters:[f(example.left),f(example.right)],mode:example.mode,seed:example.seed});
  const event=r.events.find(e=>e.t===example.event.t&&e.attacker===example.event.attacker);assert.deepEqual(event,example.event);
  if(kind==='critical'){assert.ok(event.damage>c.arena.maxHitFraction*c.arena.fighterHp);assert.ok(event.damage<=.4*c.arena.fighterHp);assert.equal(event.type,'weak');}
  if(kind==='missed'){assert.equal(event.weakContact,true);assert.equal(event.weak,false);assert.ok(event.criticalRoll>=event.criticalChance);assert.ok(event.damage<=c.arena.maxHitFraction*c.arena.fighterHp);}
  if(kind==='counter')assert.notEqual(event.strikeAttacker,example.withoutCounter.attacker);
 }
});


test('near-static normal approach never chooses an attacker from seed parity',()=>{
 for(const seed of [0,1,2,3]){
  const base={normal:[1,0,0],tipRatios:[0,0],tipBonus:.3,seed};
  assert.equal(strikeRoles({...base,velocities:[[0,20,0],[0,-20,0]]}).attacker,null);
  assert.equal(strikeRoles({...base,velocities:[[.009,0,0],[-.009,0,0]],masses:[100,1]}).attacker,null);
  assert.equal(strikeRoles({...base,velocities:[[.01,0,0],[0,0,0]]}).attacker,0);
 }
});

test('review regressions: timeout highlights, simultaneous decision, zone ordering and critical captions',async()=>{
 const proof=JSON.parse(await readFile(new URL('./batch/mechanics-evidence.json',import.meta.url)));
 for(const key of ['timeout','simultaneous','speed','zone']){
  const example=proof.review[key];assert.ok(example,'missing actual '+key+' example');
  const r=await simulateHistorical({fighters:[f(example.left),f(example.right)],mode:example.mode,seed:example.seed});
  const hits=r.events.filter(e=>e.item),main=hits.filter(e=>e.role==='attack'),criticalRng=random(example.seed^0x9e3779b9);
  assert.equal(summarize(r).crit,main.filter(e=>e.weak).length);
  for(const e of hits){
   if(e.role==='attack'&&e.weakContact)assert.equal(e.criticalRoll,criticalRng(),'only eligible main attacks consume RNG');
   else assert.equal(e.criticalRoll,null);
   assert.ok(Math.max(...e.normalSpeeds)>=.01);
   if(e.role==='recoil'){assert.equal(e.weak,false);assert.equal(e.criticalRoll,null);assert.notEqual(e.type,'weak');}
   if(e.weak){assert.equal(e.role,'attack');assert.match(e.caption,/弱点/);}
   if(e.caption.includes('冲得更快')){
    const a=e.strikeAttacker,b=1-a;assert.ok(e.normalSpeeds[a]>e.normalSpeeds[b]);
    const factor=i=>e.masses[i]**e.massPower*e.matchupMultipliers[i]*(1+c.arena.tipBonus*e.tipRatios[i]);
    assert.ok(factor(a)<=factor(b)+1e-8);
   }
  }
  const koIndex=r.events.findIndex(e=>e.type==='ko');
  if(koIndex>=0)assert.ok(r.events.slice(koIndex).every(e=>e.type==='ko'),'events after KO must be terminal only');
  for(const e of r.events.filter(e=>e.type==='zone'))assert.match(e.caption,/在圈外掉血/);
  if(key==='timeout'){
   assert.equal(r.meta.reason,'timeout');assert.match(r.decisive.caption,/时间到/);assert.equal(r.decisive.finishEventIndex,null);
   const chosen=r.events[r.decisive.eventIndex];assert.equal(chosen.role,'attack');
   const winners=main.filter(e=>e.attacker===r.meta.winner),preferred=winners.length?winners:main,criticals=preferred.filter(e=>e.weak),eligible=criticals.length?criticals:preferred;
   assert.ok(eligible.includes(chosen));assert.equal(chosen.damage,Math.max(...eligible.map(e=>e.damage)));
   assert.ok(chosen.t>=r.decisive.t0&&chosen.t<=r.decisive.t1);
  }
  if(key==='simultaneous'){assert.equal(r.meta.resolvedByAttacker,true);assert.match(r.decisive.caption,/同时倒下/);assert.match(r.decisive.caption,/先撞.*判赢/);}
 }
});
