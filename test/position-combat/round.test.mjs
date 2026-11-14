import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createV3Match, ROUND_JUDGE_COMBAT_OPTIONS as rules} from '../../sim/v3.js';

const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const mine = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);

// A perfect guard flings the foe free and brakes it only once we counter (Elara ad7297c3); the counter must still land
// every time, the grazing case of 老龟 111323 (Sol 11-15) included. A player who guards on the flash and counters at once.
test('every counter after a perfect guard lands in full', async () => {
 const {foes, judgeBuilds} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
 let counters = 0;
 for (const [id, seed] of [['wen', 111323], ['wen', 111306], ['chang', 111307], ['chang', 111308]]) {
  const foe = foes.find(f => f.id === id), tuned = judgeBuilds.position[id];
  const game = await createV3Match({...rules, seed, fighters: [mine, build(tuned.parts, tuned.spread)],
   combatRules: {...rules.combatRules, ceramicShards: true},
   manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...tuned.ai, ...tuned.impactAi}]}});
  let seen = 0, blockAt = Infinity, dashAt = Infinity;
  const pressed = new Set();
  try {
   while (!game.done) {
    for (; seen < game.events.length; seen++) {
     const e = game.events[seen];
     if (e.type === 'dashCue' && e.side === 1) blockAt = e.t + .25;
     if (e.type === 'blockResult' && e.side === 0 && e.deflected) dashAt = e.t + .05;
     if (e.type === 'dash' && e.phase === 'charge' && e.side === 0 && e.t >= dashAt - 1e-9) { pressed.add(e.pressStep); dashAt = Infinity; }
    }
    const {blockIn, dashIn, stunIn} = game.control(0);
    if (game.t >= blockAt - 1e-9 && !blockIn && !stunIn) { game.press(0, 'block'); blockAt = Infinity; }
    if (game.t >= dashAt - 1e-9 && !dashIn && !stunIn) game.press(0, 'dash');
    game.advance();
   }
   for (const e of game.events) if (e.type === 'dash' && e.phase === 'end' && e.side === 0 && pressed.has(e.pressStep)) {
    counters++;
    assert.deepEqual([e.outcome, e.quality], ['hit', 'full'], `${id} ${seed} counter pressed at step ${e.pressStep}`);
   }
  } finally { game.free(); }
 }
 assert.ok(counters >= 20, `only ${counters} counters`);
});

test('per-foe dash damage and cooldown must be finite and positive when given', async () => {
 const core = {parts: []};
 const setup = round => ({...rules, seed: 1, fighters: [core, core], manual: {sides: ['input', 'input']},
  combatRules: {...rules.combatRules, round: {...rules.combatRules.round, ...round}}});
 await createV3Match(setup({mangAiDamage: 3}));
 for (const bad of [{mangAiDamage: 0}, {wenAiCooldown: -1}, {changAiDamage: Infinity}])
  await assert.rejects(createV3Match(setup(bad)), /Invalid round separation rules/);
});
