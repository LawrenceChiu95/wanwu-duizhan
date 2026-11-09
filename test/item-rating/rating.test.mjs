import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gradeFor,rateItem} from '../../sim/item-rating.js';
const catalog=JSON.parse(await readFile(new URL('../../data/catalog.json',import.meta.url),'utf8'));
const {items:designs}=JSON.parse(await readFile(new URL('../../data/default-item-designs.json',import.meta.url),'utf8'));
const defaults=designs.map(d=>{const item=catalog.items.find(i=>i.id===d.id);assert.ok(item,`Missing default: ${d.id}`);return item;});
test('grade boundaries use the unrounded arithmetic mean',()=>{
 for(const [n,g]of [[0,'D'],[29.999,'D'],[30,'C'],[44.999,'C'],[45,'B'],[59.999,'B'],[60,'A'],[74.999,'A'],[75,'S'],[100,'S']])assert.equal(gradeFor(n),g);
 for(const bad of [-1,101,NaN,Infinity])assert.throws(()=>gradeFor(bad));
});
test('catalog matches deterministic per-object scores, all five tiers and only two or three S defaults',()=>{
 assert.equal(defaults.length,9);
 for(const item of catalog.items){assert.deepEqual(item.rating,rateItem(item,catalog.materials));assert.equal(item.rating.grade,gradeFor(Object.values(item.rating.scores).reduce((a,b)=>a+b,0)/3));}
 assert.deepEqual([...new Set(defaults.map(i=>i.rating.grade))].sort(),['A','B','C','D','S']);
 assert.ok([2,3].includes(defaults.filter(i=>i.rating.grade==='S').length));
});
test('rating uses the object, not its category or cosmetic rust; unknown condition stays neutral',()=>{
 const item=catalog.items.find(i=>i.id==='pan-lux3d'),rate=i=>rateItem(i,catalog.materials);
 assert.deepEqual(rate({...item,name:'new name',glb:'other.glb'}),rate(item));
 assert.deepEqual(rate({...item,condition:'unknown'}),rate(item));
 const damaged=rate({...item,condition:'damaged'});
 assert.notEqual(damaged.grade,rate(item).grade);assert.ok(damaged.scores.attack<rate(item).scores.attack);assert.ok(damaged.scores.durability<rate(item).scores.durability);
 assert.notEqual(damaged.version,rate(item).version);assert.throws(()=>rate({...item,condition:'rusty-art'}));
});

test('design IDs match the selectable authored catalog defaults, not later imports',()=>{
 const ids=designs.map(d=>d.id),authored=catalog.items.filter(i=>i.massBasis==='designed-default').map(i=>i.id);
 const replaced=new Set(catalog.items.map(i=>i.comparisonBase).filter(Boolean));
 assert.equal(new Set(ids).size,ids.length);assert.equal(new Set(authored).size,authored.length);
 assert.deepEqual([...ids].sort(),authored.sort());
 assert.ok(ids.every(id=>!replaced.has(id)),'every authored default is selectable');
});

test('authored defaults have distinct scores and means, with pot and long broom S specialties',async()=>{
 const items=designs.map(d=>{const it=catalog.items.find(i=>i.id===d.id);assert.ok(it);assert.equal(it.mass,d.massKg);assert.equal(it.material,d.material);assert.equal(it.condition,d.condition);assert.equal(it.massBasis,'designed-default');assert.ok(Math.abs(Math.max(...it.bounds.max.map((v,k)=>v-it.bounds.min[k]))-d.lengthMeters)<1e-6);return it;});
 assert.equal(items.length,9);assert.equal(new Set(items.map(i=>Object.values(i.rating.scores).join(','))).size,9);assert.equal(new Set(items.map(i=>Object.values(i.rating.scores).reduce((a,b)=>a+b,0))).size,9);
 const s=items.filter(i=>i.rating.grade==='S');assert.deepEqual(s.map(i=>i.id).sort(),['pan-lux3d','wasteland-broom']);
 const [pot,broom]=['pan-lux3d','wasteland-broom'].map(id=>items.find(i=>i.id===id).rating.scores);
 assert.ok(pot.attack>broom.attack&&pot.durability>broom.durability&&pot.range<broom.range);
});

test('condition alone changes attack and durability, never range',()=>{
 const item=catalog.items.find(i=>i.id==='pan-lux3d');
 const scores=condition=>rateItem({...item,condition},catalog.materials).scores;
 assert.deepEqual(scores('unknown'),scores('intact'));
 const intact=scores('intact'),worn=scores('worn'),damaged=scores('damaged');
 assert.deepEqual([intact.attack,worn.attack,damaged.attack],[89,85,54]);
 assert.deepEqual([intact.durability,worn.durability,damaged.durability],[95,85,47]);
 assert.equal(worn.range,intact.range);assert.equal(damaged.range,intact.range);
});

test('photo contact scores weigh heavy coated objects, sharp edges, soft materials and fragility',()=>{
 const rate=(mass,material,materialName,hardness,impactHardness,hasBladeOrPoint=false)=>{
  const item={id:'photo',bounds:{min:[0,0,0],max:[.25,.1,.08]},mass,material,materialName,condition:'intact',
   photoPhysics:{hardness,impactHardness,hasBladeOrPoint}};
  return rateItem(item,catalog.materials);
 };
 const coated=rate(2,'rubber','橡胶',.45,.45);
 assert.equal(coated.grade,'A');
 assert.equal(coated.letters.durability,'S');
 const solid=rate(2,'metal','金属',1.2,1.2);
 const pillow=rate(2,'cloth','织物',.15,.15);
 assert.ok(pillow.scores.attack<solid.scores.attack);
 assert.equal(pillow.letters.durability,'A');
 const base=rate(.6,'metal','金属',.9,.9);
 assert.equal(base.letters.durability,'A');
 assert.equal(rate(.6,'cloth','织物',.15,.15).scores.durability,base.scores.durability+3);
 for(const name of ['陶瓷','玻璃']){
  const fragile=rate(.6,'metal',name,.9,.9);
  assert.equal(fragile.letters.durability,'B');
  assert.ok(fragile.scores.durability<=base.scores.durability-10);
 }
 const blade=rate(.25,'metal','不锈钢',1.2,1.2,true);
 assert.equal(blade.letters.attack,'B');
 assert.ok(blade.scores.durability<60);
 assert.ok(blade.scores.attack>rate(.25,'metal','不锈钢',1.2,1.2).scores.attack);
});
