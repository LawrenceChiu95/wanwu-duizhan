import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createV3Match, ROUND_JUDGE_COMBAT_OPTIONS as rules} from '../../sim/v3.js';

const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const mine = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);

// A perfect guard flings the foe free and brakes it only once we counter (Elara ad7297c3); the counter must still land
// every time, the grazing case of 铁壁 111323 (Sol 11-15) included. A player who guards on the flash and counters at once.
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

// Stages 2 and 3 got a pace and 断风 a guard share (Elara 2720a2dc). Rules saved before then still replay, and no stage's
// tight guard may let through more than half of the blow.
test('round rules without a stage pace still play; a guard share over half is refused', async () => {
 const {foes, judgeBuilds} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
 const foe = foes.find(f => f.id === 'chang'), tuned = judgeBuilds.position.chang;
 const setup = round => ({...rules, seed: 1, fighters: [mine, build(tuned.parts, tuned.spread)],
  combatRules: {...rules.combatRules, round},
  manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...tuned.ai, ...tuned.impactAi}]}});
 const {wenPace, changPace, changGuard, ...older} = rules.combatRules.round;
 (await createV3Match(setup(older))).free();
 await assert.rejects(createV3Match(setup({...rules.combatRules.round, changGuard: .6})), /Invalid round separation rules/);
});

// 铁壁 came on a fixed beat (远夏 11-14, Elara 29b5b9b2): its lunges now come unevenly, never while the player's 挡 has more
// than wenBlockWait to cool down. A player who guards on the flash and lunges whenever 冲 is ready.
test('铁壁 lunges on an uneven beat and waits for the player\'s guard', async () => {
 const {foes, judgeBuilds} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
 const foe = foes.find(f => f.id === 'wen'), tuned = judgeBuilds.position.wen;
 const play = async (round, seed) => {
  const game = await createV3Match({...rules, seed, fighters: [mine, build(tuned.parts, tuned.spread)],
   combatRules: {...rules.combatRules, round, ceramicShards: true},
   manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...tuned.ai, ...tuned.impactAi}]}});
  let seen = 0, blockAt = Infinity;
  try {
   while (!game.done && game.t < 40) {
    for (; seen < game.events.length; seen++) if (game.events[seen].type === 'dashCue' && game.events[seen].side === 1) blockAt = game.events[seen].t + .25;
    const {blockIn, dashIn, stunIn} = game.control(0);
    if (game.t >= blockAt - 1e-9 && !blockIn && !stunIn) { game.press(0, 'block'); blockAt = Infinity; }
    else if (!dashIn && !stunIn && blockAt === Infinity) game.press(0, 'dash');
    game.advance();
   }
   return game.events.filter(e => e.type === 'dash' && e.side === 1 && e.phase === 'charge');
  } finally { game.free(); }
 };
 const spread = charges => { const gaps = charges.slice(1).map((e, i) => e.t - charges[i].t); return Math.max(...gaps) - Math.min(...gaps); };
 const {wenAiCooldown, wenDashJitter, wenBlockWait, ...older} = {...rules.combatRules.round, wenIdleDashAfter: 3.75, wenPace: 1.3};
 for (const seed of [111300, 111301]) {
  const now = await play(rules.combatRules.round, seed);
  assert.ok(spread(now) > .6, `seed ${seed}: beat spread ${spread(now).toFixed(2)} s`);
  for (const e of now) assert.ok(e.blockReadyIn <= rules.combatRules.round.wenBlockWait + 1e-9, `seed ${seed}: wound up at ${e.t.toFixed(2)} with 挡 ${e.blockReadyIn.toFixed(2)} s off`);
  assert.ok(spread(await play(older, seed)) > 0, 'rules saved before still play');
 }
});
