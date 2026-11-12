import assert from 'node:assert/strict';
import test from 'node:test';
import {PLANAR_JUDGE_COMBAT_OPTIONS as rules,simulateV3} from '../../sim/v3.js';

const plateAndCushion={parts:[
 {item:'fanshuo-plate',mount:'e0',orient:'out'},
 {item:'fanshuo-cushion',mount:'e180',orient:'hug'}
]};
const shardEvents=match=>match.events.filter(event=>event.type==='archetype'&&event.archetype==='brittle');
const run=(opponent,combatRules=rules.combatRules)=>simulateV3({
 ...rules,combatRules,fighters:[plateAndCushion,opponent],seed:110304,manual:{sides:['ai','ai']}
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
