import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createV3Match, ROUND_JUDGE_COMBAT_OPTIONS as rules} from '../../sim/v3.js';

const input = (step, side, action) => ({step, side, action});
const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const mine = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);

test('a counter launched while the stunned foe still grazes us lands in full', async () => {
 // 老龟 111323 (Sol 11-15): right after a perfect guard the two tops kept touching, so the counter
 // at step 1474 met the foe mid-episode and was zeroed as a plain bump.
 const {foes, judgeBuilds} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
 const foe = foes.find(f => f.id === 'wen'), tuned = judgeBuilds.position.wen;
 const inputs = [[1, 'dash'], [348, 'block'], [542, 'dash'], [883, 'block'], [1083, 'dash'], [1449, 'block'], [1474, 'dash']]
  .map(([step, action]) => input(step, 0, action));
 const game = await createV3Match({...rules, seed: 111323, fighters: [mine, build(tuned.parts, tuned.spread)],
  combatRules: {...rules.combatRules, ceramicShards: true},
  manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...tuned.ai, ...tuned.impactAi}], inputs}});
 while (!game.done && !game.events.some(e => e.type === 'dash' && e.phase === 'end' && e.side === 0 && e.pressStep === 1474)) game.advance();
 assert.ok(game.events.some(e => e.type === 'blockResult' && e.side === 0 && e.deflected && e.pressStep === 1449));
 const counter = game.events.find(e => e.type === 'dash' && e.phase === 'end' && e.side === 0 && e.pressStep === 1474);
 assert.equal(counter?.outcome, 'hit');
 assert.equal(counter?.quality, 'full');
});
