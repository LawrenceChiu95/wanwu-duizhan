import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import {simulate,loadCatalog,loadRules,contactDamage,zoneRadius} from '../../sim/index.js';
const f=item=>({parts:[{item,mount:'core',rot:[0,0,0]}]});
const digest=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const c=await loadRules();
test('six normalized licensed GLBs, hull <=64, finite and mass = density*volume',async()=>{
 const items=await loadCatalog();assert.equal(items.length,6);
 for(const i of items){assert.ok(i.hull.length>=4&&i.hull.length<=64);assert.ok(i.hull.flat().every(Number.isFinite));assert.ok(Math.abs(i.mass-i.volume*c.materials[i.material].density)<i.mass*1e-5);assert.ok(i.mass>0);const glb=await readFile(new URL('../../'+i.glb,import.meta.url));assert.equal(glb.readUInt32LE(0),0x46546c67);assert.equal(crypto.createHash('sha256').update(glb).digest('hex'),i.source.normalizedSha256);assert.ok(['CC0-1.0','CC-BY-3.0'].includes(i.source.license));}
 items[0].name='mutated';assert.notEqual((await loadCatalog())[0].name,'mutated');
});
test('A impulse/hardness; B material and defense; weak point exactly doubles',()=>{
 const attacker=c.items.find(i=>i.tag==='sharp'),target=c.items.find(i=>i.tag==='soft');
 const args={attacker,target,materials:c.materials,matchups:c.matchups,impulse:3,weak:false};
 const a=contactDamage({...args,mode:'A'}),b=contactDamage({...args,mode:'B'});
 assert.equal(a.damage,3*Math.sqrt(c.materials[attacker.material].hardness/c.materials[target.material].hardness));assert.equal(b.damage,attacker.stats.attack*1.5-target.stats.defense);
 assert.equal(contactDamage({...args,mode:'B',weak:true}).damage,b.damage*2);
 assert.equal(zoneRadius(0,c.arena),c.arena.zoneStartRadius);assert.equal(zoneRadius(60,c.arena),c.arena.zoneEndRadius);
});
test('real simulations: deterministic replay, A/B initial state, physical separation and HP accounting',async()=>{
 const args={fighters:[f('broom'),f('pot')],mode:'A',seed:1};
 const a=await simulate(args),again=await simulate(args),b=await simulate({...args,mode:'B'});
 assert.equal(digest(a),digest(again));assert.deepEqual(a.meta.initial,b.meta.initial);assert.notEqual(digest(a),digest(b));
 for(const r of [a,b]){
  assert.ok(r.events.some(e=>['hit','crit','weak'].includes(e.type)));assert.ok(r.meta.duration>0&&r.meta.duration<=60);assert.ok(r.meta.diagnostics.longestContact<1);assert.ok(r.meta.diagnostics.maxPenetration<.05);
  assert.equal(r.frames[0].t,0);assert.equal(r.frames.at(-1).t,r.meta.duration);assert.ok(r.decisive.t1-r.decisive.t0<=2.500001);
  assert.ok(r.frames.every(fr=>fr.fighters.every(v=>[...v.pos,...v.quat,v.hp,...v.parts.flatMap(p=>[...p.pos,...p.quat])].every(Number.isFinite))));
  for(let i=0;i<2;i++){const total=r.events.filter(e=>e.target===i).reduce((s,e)=>s+e.damage,0);assert.ok(Math.abs(Math.max(0,r.meta.initial[i].maxHp-total)-r.frames.at(-1).fighters[i].hp)<.13);}
  for(const e of r.events.filter(e=>e.item)){assert.ok(e.impulse>0);assert.equal(e.multiplier,e.weak?2:1);if(r.meta.mode==='A')assert.ok(Math.abs(e.damage-e.impulse*c.arena.impulseToDamage*e.hardness*e.multiplier)<1e-8);else assert.ok(Math.abs(e.damage-Math.max(0,c.items.find(x=>x.id===e.item).stats.attack*e.matchup-c.items.find(x=>x.id===e.targetItem).stats.defense)*e.multiplier)<1e-8);}
 }
});
test('compound COM follows layout; world part transforms and per-part hit identity',async()=>{
 const a={parts:[{item:'broom',mount:'front',rot:[0,0,0]},{item:'pot',mount:'top',rot:[0,0,0]},{item:'pillow',mount:'side',rot:[0,0,0]}]};
 const b={parts:[{...a.parts[1],mount:'front'},{...a.parts[2],mount:'top'},{...a.parts[0],mount:'side'}]};
 const ra=await simulate({fighters:[a,b],mode:'B',seed:7}),rb=await simulate({fighters:[b,b],mode:'B',seed:7});
 assert.notDeepEqual(ra.meta.initial[0].centerOfMass,rb.meta.initial[0].centerOfMass);assert.ok(Math.abs(ra.meta.initial[0].mass-rb.meta.initial[0].mass)<.0001);
 assert.ok(ra.frames.every(fr=>fr.fighters.every(v=>v.parts.length===3)));assert.ok(ra.events.some(e=>e.item&&e.mount!=='core'));
});
test('invalid input fails explicitly',async()=>{
 await assert.rejects(simulate({fighters:[f('missing'),f('pot')],mode:'A',seed:1}),/Unknown item/);await assert.rejects(simulate({fighters:[f('pot'),f('pot')],mode:'C',seed:1}),/mode/);await assert.rejects(simulate({fighters:[f('pot'),f('pot')],mode:'A',seed:NaN}),/seed/);
});
