import assert from 'node:assert/strict';
import test from 'node:test';
import {createV3Match, IMPACT_JUDGE_COMBAT_OPTIONS as rules, simulateV3} from '../../sim/v3.js';

const core = {parts: []};
const options = { ...rules, mode: 'B', seed: 6, fighters: [core, core] };
const sides = ['input', 'input'];
const input = (step, side, action) => ({step, side, action});
const match = async (t, inputs = [], fighters = options.fighters) => {
 const game = await createV3Match({...options, fighters, manual: {sides, inputs}});
 t.after(() => game.free());
 return game;
};
const advanceTo = (game, step) => {
 while (!game.done && game.step < step) game.advance();
};
const rebound = (event, side) => event.velocityAfter[side].reduce((sum, v, axis) =>
 sum + v * event.normal[axis] * (side === 0 ? -1 : 1), 0);

test('player launches in 9 steps and a dash hits and rebounds harder than the same passive core contact', async t => {
 const passive = await match(t);
 const active = await match(t, [input(1, 0, 'dash')]);
 for (const game of [passive, active]) advanceTo(game, 40);
 const go = active.events.find(e => e.type === 'dash' && e.phase === 'go');
 assert(Math.abs(go.t - .008333333333333333 - .075) < 1e-9);
 const blow = game => game.events.find(e => e.type === 'hit' && e.role === 'attack' && e.attacker === 0);
 const bounce = game => game.events.find(e => e.type === 'recoil');
 assert.equal(blow(active).tier, blow(passive).tier);
 assert(blow(active).damageBeforeHpClamp >= 2 * blow(passive).damageBeforeHpClamp);
 assert(rebound(bounce(active), 1) >= 2 * rebound(bounce(passive), 1));
 assert.equal(blow(active).dash, true);
});

test('a passive contact in the damage cooldown still deflects, stuns and resets the dash', async t => {
 const game = await match(t, [input(100, 0, 'block'), input(121, 1, 'dash'), input(121, 0, 'dash')]);
 advanceTo(game, 121);
 const block = game.events.find(e => e.type === 'block');
 const guard = game.events.find(e => e.type === 'blockResult' && e.deflected);
 assert.equal(block.windowSteps, 45);
 assert.equal(guard.t, 1);
 assert.equal(guard.perfect, false);
 assert.equal(guard.dashLockedUntil, undefined);
 assert.equal(guard.damageApplied, false);
 assert.equal(guard.stunUntil, 1.5);
 const lastDamage = game.events.findLast(e => e.type === 'hit');
 assert(lastDamage.t < guard.t && guard.t - lastDamage.t < 1);
 assert(rebound(game.events.find(e => e.type === 'recoil' && e.t === guard.t), 1) >= 2);
 assert(game.events.some(e => e.type === 'press' && e.side === 0 && e.action === 'dash'));
 assert(!game.events.some(e => e.type === 'press' && e.side === 1));
 assert(game.control(1).stunIn > 0);
 assert.equal(game.control(0).dashLockIn, 0);
});

test('the opponent keeps its 36-step charge and a frontal dash into the shield is perfect', async t => {
 const game = await match(t, [input(1, 0, 'block'), input(1, 1, 'dash')]);
 advanceTo(game, 50);
 const go = game.events.find(e => e.type === 'dash' && e.phase === 'go');
 const guard = game.events.find(e => e.type === 'blockResult' && e.deflected);
 assert(Math.abs(go.t - .008333333333333333 - .3) < 1e-9);
 assert.equal(guard.perfect, true);
 assert(game.events.some(e => e.t === guard.t && e.type === 'parry' && e.attacker === 1));
 assert(game.events.some(e => e.t === guard.t && e.type === 'dash' && e.quality === 'blocked'));
 assert(!game.events.some(e => e.t === guard.t && e.type === 'hit' && e.attacker === 1 && !e.shield));
});

test('impact replays preserve the rule set and the recorded presses', async () => {
 const result = await simulateV3({...options, manual: {sides, inputs: [input(1, 0, 'dash'), input(88, 0, 'block')]}});
 const {manual, combat, combatRules, feel, feelRules} = result.meta;
 const replay = await simulateV3({...options, manual, combat, combatRules, feel, feelRules});
 assert.deepEqual(replay, result);
});

test('an empty guard locks the next dash for 54 steps, discarding presses during the lock', async t => {
 const game = await match(t, [input(60, 0, 'block')]);
 advanceTo(game, 105);
 const empty = game.events.find(e => e.type === 'blockResult' && e.outcome === 'empty');
 assert.equal(empty.resolvedStep, 105);
 assert(Math.abs(empty.dashLockedUntil - empty.t - .45) < 1e-9);
 assert(Math.abs(game.control(0).dashLockIn - .45) < 1e-9);
 game.press(0, 'dash');
 advanceTo(game, 157);
 game.press(0, 'dash');
 advanceTo(game, 160);
 assert.equal(game.control(0).dashLockIn, 0);
 assert(!game.events.some(e => e.type === 'press' && e.side === 0 && e.action === 'dash'));
 game.press(0, 'dash');
 game.advance();
 assert(game.events.some(e => e.type === 'press' && e.side === 0 && e.action === 'dash'));
});

test('the durability multiplier increases both sides’ core and part HP without increasing opening damage', async t => {
 const top = {parts: [{item: 'fanshuo-pot', mount: 'e0', orient: 'out'}]};
 const unscaled = await createV3Match({...options, combatRules: {...rules.combatRules, hpScale: 1}, fighters: [top, top], manual: {sides}});
 t.after(() => unscaled.free());
 const scaled = await match(t, [], [top, top]);
 for (const i of [0, 1]) {
  assert.equal(scaled.initial[i].core.maxHp, unscaled.initial[i].core.maxHp * 1.37);
  assert.equal(scaled.initial[i].parts[0].maxHp, unscaled.initial[i].parts[0].maxHp * 1.37);
 }
 for (const game of [unscaled, scaled]) advanceTo(game, 65);
 const damage = game => game.events.filter(e => e.type === 'hit' || e.type === 'weak').map(e => e.damageBeforeHpClamp);
 assert(damage(scaled).length > 0);
 assert.deepEqual(damage(scaled), damage(unscaled));
});

test('a heavy assembly uses full dash reach and cannot block on the first missed-dash recovery step', async t => {
 const chair = {parts: [
  {item: 'fanshuo-chair', mount: 'e0', orient: 'out'},
  {item: 'fanshuo-cushion', mount: 'e180', orient: 'hug'}
 ]};
 const light = await createV3Match({...options, mode: 'A', seed: 111300, manual: {sides, inputs: [input(100, 0, 'dash')]}});
 t.after(() => light.free());
 const heavy = await createV3Match({...options, mode: 'A', seed: 111300, fighters: [chair, chair],
  manual: {sides, inputs: [input(100, 0, 'dash'), input(163, 0, 'block')]}});
 t.after(() => heavy.free());
 advanceTo(light, 100);
 advanceTo(heavy, 163);
 const reach = game => game.events.find(e => e.type === 'dash' && e.phase === 'charge').reach;
 assert(reach(light) > 0);
 assert.equal(reach(heavy), reach(light));
 assert(heavy.events.some(e => e.type === 'dash' && e.side === 0 && e.outcome === 'miss'));
 assert.equal(heavy.control(0).stunIn, .25);
 assert(!heavy.events.some(e => e.type === 'press' && e.action === 'block'));
});
