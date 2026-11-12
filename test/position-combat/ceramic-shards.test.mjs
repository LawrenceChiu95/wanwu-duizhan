import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRules,registerItems} from '../../sim/index.js';
import {rateItem} from '../../sim/item-rating.js';
import {PLANAR_JUDGE_COMBAT_OPTIONS as rules,simulateV3} from '../../sim/v3.js';

const plateAndCushion={parts:[
 {item:'fanshuo-plate',mount:'e0',orient:'out'},
 {item:'fanshuo-cushion',mount:'e180',orient:'hug'}
]};
const shardEvents=match=>match.events.filter(event=>event.type==='archetype'&&event.archetype==='brittle');
const run=(opponent,combatRules=rules.combatRules,player=plateAndCushion)=>simulateV3({
 ...rules,combatRules,fighters:[player,opponent],seed:110304,manual:{sides:['ai','ai']}
});
const enabled={...rules.combatRules,ceramicShards:true};

test('ceramic shards are off by default',async()=>{
 assert.deepEqual(shardEvents(await run(plateAndCushion)),[]);
});

test('a strong unblocked hit to the player ceramic damages one opponent attachment once',async()=>{
 const match=await run(plateAndCushion,enabled);
 const shards=shardEvents(match);
 assert.equal(shards.length,1);
 const [event]=shards;
 const [player,opponent]=match.meta.initial;
 assert.equal(event.side,0);
 assert.equal(event.part,'part-0');
 assert.equal(event.target,1);
 assert.equal(event.targetPart,'part-1');
 assert(match.events.some(hit=>hit.t===event.t&&hit.target===0&&hit.targetPart===event.part&&
  hit.role==='attack'&&!hit.shield&&hit.damage>=player.parts[0].maxHp*.20));
 assert(event.damage>0&&event.damage<=14&&event.damage<=opponent.parts[1].maxHp*.30);
 assert(event.distance<=.75);
 assert.equal(event.point.length,3);
});

test('a ceramic can release shards without hitting the opponent core',async()=>{
 const shards=shardEvents(await run({parts:[]},enabled));
 assert.equal(shards.length,1);
 assert.equal(shards[0].targetPart,null);
 assert.equal(shards[0].damage,0);
 assert.equal(shards[0].hpAfter,null);
});

test('ceramic material names trigger shards under the same impact rules as a plain plate',async(t)=>{
 const {items,materials}=await loadRules();
 const plate=items.find(item=>item.id==='fanshuo-plate');
 for(const [index,[materialName,expected]] of [
  ['陶瓷和布',1],['陶瓷和织物',1],['瓷器和木',1],['瓷质釉面',1],['瓷',1],['搪瓷',0],['玻璃',0]
 ].entries()){
  await t.test(materialName,async()=>{
   const item={...plate,id:`ceramic-test-${index}`,materialName,generated:true,massBasis:'photo-estimate'};
   item.rating=rateItem(item,materials);
   await registerItems([item]);
   const player={parts:[{...plateAndCushion.parts[0],item:item.id},plateAndCushion.parts[1]]};
   const match=await run(plateAndCushion,enabled,player);
   const part=match.meta.initial[0].parts[0];
   assert(match.events.some(hit=>hit.target===0&&hit.targetPart===part.id&&
    hit.role==='attack'&&!hit.shield&&hit.damage>=part.maxHp*.20));
   assert.equal(shardEvents(match).length,expected);
  });
 }
});
