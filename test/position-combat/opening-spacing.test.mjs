import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createV3Match, OPENING_JUDGE_COMBAT_OPTIONS as rules, simulateV3} from '../../sim/v3.js';

const {foes, judgeBuilds} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const mine = item => build([{item: `fanshuo-${item}`, orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);
function setup(id, seed, item = 'pot') {
 const foe = foes.find(f => f.id === id);
 const {parts, spread, ai, impactAi} = judgeBuilds.position[id];
 return {...rules, seed, fighters: [mine(item), build(parts, spread)],
  combatRules: {...rules.combatRules, ceramicShards: true},
  manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...ai, ...impactAi}]}};
}

test('the live ladder gives idle players 0.8–1 s to see the opening', async () => {
 for (const [id, item] of [['mang', 'pot'], ['wen', 'pot'], ['chang', 'pot'], ['chang', 'chair']]) {
  for (const seed of [111900, 111901, 111902]) {
   const game = await createV3Match(setup(id, seed, item));
   try {
    const outerEdge = Math.max(...game.initial.map(f => Math.abs(f.pos[0]) + f.sweepRadius));
    assert(outerEdge < game.rules.arenaRadius, `${id} / ${item} starts inside the wall`);
    while (game.t < 1 && !game.events.some(e => e.type === 'contact')) game.advance();
    const first = game.events.find(e => e.type === 'contact');
    assert(first && first.t >= .8 && first.t <= 1, `${id} / ${item} / ${seed}: first contact ${first?.t}`);
   } finally { game.free(); }
  }
 }
});

test('opening accepts a first-step dash and replays from the recorded rules', async () => {
 const options = setup('mang', 111900);
 const original = await simulateV3({...options, manual: {...options.manual, inputs: [{step: 1, side: 0, action: 'dash'}]}});
 const {meta} = original;
 const go = original.events.find(e => e.type === 'dash' && e.phase === 'go' && e.side === 0);
 assert.equal(go.t, 10 * meta.rules.dt);
 assert.deepEqual(meta.combatRules.opening, rules.combatRules.opening);
 const replayed = await simulateV3({...options, combatRules: meta.combatRules, feelRules: meta.feelRules, manual: meta.manual});
 assert.equal(JSON.stringify(replayed), JSON.stringify(original));
});
