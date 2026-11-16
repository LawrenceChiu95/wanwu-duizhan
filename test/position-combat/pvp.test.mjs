import assert from 'node:assert/strict';
import test from 'node:test';
import {createV3Match, PVP_COMBAT_OPTIONS as rules} from '../../sim/v3.js';

const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const pot = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);
const knife = build([{item: 'fanshuo-knife', orient: 'out'}, {item: 'fanshuo-plate', orient: 'hug'}]);
const pvp = (seed, fighters = [pot, pot], combatRules = rules.combatRules) =>
 createV3Match({...rules, seed, fighters, combatRules, manual: {sides: ['input', 'input']}});

// Presses [step, side, action] and the events of the first few seconds.
async function play(seed, script, fighters) {
 const game = await pvp(seed, fighters);
 try {
  while (!game.done && game.t < 4) {
   for (const [at, side, action] of script) if (game.step === at) game.press(side, action);
   game.advance();
  }
  return game.events;
 } finally { game.free(); }
}
const mirror = script => script.map(([at, side, action]) => [at, 1 - side, action]);
const of = (events, type, side, key = 'side') => events.filter(e => e.type === type && e[key] === side);

// 一机双人 (Elara 1e2c813c): only two people at one phone get it, never a match with the computer.
test('pvp rules need round rules and two people', async () => {
 await assert.rejects(createV3Match({...rules, seed: 1, fighters: [pot, pot], manual: {sides: ['input', 'ai']}}), /pvp needs/);
 await assert.rejects(pvp(1, [pot, pot], {...rules.combatRules, round: undefined}), /pvp needs/);
 for (const charge of [0, .05, 1, NaN]) await assert.rejects(pvp(1, [pot, pot], {...rules.combatRules, pvp: {...rules.combatRules.pvp, charge}}), /pvp needs/);
 await assert.rejects(pvp(1, [pot, pot], {...rules.combatRules, pvp: {...rules.combatRules.pvp, pace: 0}}), /pvp needs/);
});

// Both lunges wind up as long and both are cued, so either person can see the other's coming.
test('either side winds up as long and gets the dash cue', async () => {
 const events = await play(7, [[120, 0, 'dash']]);
 const back = await play(7, [[120, 1, 'dash']]);
 for (const [ev, side] of [[events, 0], [back, 1]]) {
  const charge = of(ev, 'dash', side).find(e => e.phase === 'charge'), go = of(ev, 'dash', side).find(e => e.phase === 'go');
  assert.ok(Math.abs(go.t - charge.t - rules.combatRules.pvp.charge) < .011, `side ${side} wound up ${go.t - charge.t}`);
  assert.equal(of(ev, 'dashCue', side).length, 1, `side ${side} cue`);
 }
});

// The same presses with the sides swapped come out the same way: who struck, who guarded, how the guard went.
test('presses on the same step resolve the same whichever side makes them', async () => {
 let checked = 0;
 for (const seed of [3, 7, 11, 19, 23, 42])
  for (const fighters of [[pot, pot], [knife, knife]])
   for (const script of [[[120, 0, 'dash'], [120, 1, 'dash']], [[120, 0, 'dash'], [120, 1, 'block']], [[120, 0, 'dash'], [150, 1, 'block']], [[120, 0, 'dash'], [160, 1, 'block']]]) {
    const a = await play(seed, script, fighters), b = await play(seed, mirror(script), fighters);
    const sum = (ev, side) => ev.filter(e => e.type === 'dash' && e.phase === 'end' && e.side === side).map(e => e.outcome).join() + '|' +
     ev.filter(e => e.type === 'blockResult' && e.side === side).map(e => e.outcome).join();
    assert.deepEqual([sum(a, 0), sum(a, 1)], [sum(b, 1), sum(b, 0)], `seed ${seed} ${JSON.stringify(script)}`);
    checked++;
   }
 assert.equal(checked, 48);
});

// A guard pressed as the cue shows is too early to be perfect; one pressed a reaction (0.3 s) later, as the lunge comes, is.
test('a perfect guard takes a reaction after the cue, not a press on it', async () => {
 let early = 0, timed = 0;
 for (const seed of [3, 7, 11, 19, 23, 42]) {
  const onCue = await play(seed, [[120, 0, 'dash'], [120, 1, 'block']]);
  if (of(onCue, 'blockResult', 1).some(e => e.outcome === 'perfect')) early++;
  const late = await play(seed, [[120, 0, 'dash'], [156, 1, 'block']]);
  if (of(late, 'blockResult', 1).some(e => e.outcome === 'perfect')) timed++;
 }
 assert.equal(early, 0);
 assert.ok(timed >= 4, `only ${timed} of 6 perfect`);
});
