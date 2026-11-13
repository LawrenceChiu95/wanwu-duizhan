import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createV3Match, IMPACT_JUDGE_COMBAT_OPTIONS as rules, simulateV3} from '../../sim/v3.js';

const {refinedImpact, mangHpScale, ...previousImpactRules} = rules.combatRules;
const core = {parts: []};
const options = { ...rules, mode: 'B', seed: 6, fighters: [core, core] };
const sides = ['input', 'input'];
const input = (step, side, action) => ({step, side, action});
const match = async (t, inputs = [], fighters = options.fighters, combatRules = rules.combatRules) => {
 const game = await createV3Match({...options, fighters, combatRules, manual: {sides, inputs}});
 t.after(() => game.free());
 return game;
};
const advanceTo = (game, step) => {
 while (!game.done && game.step < step) game.advance();
};
const rebound = (event, side) => event.velocityAfter[side].reduce((sum, v, axis) =>
 sum + v * event.normal[axis] * (side === 0 ? -1 : 1), 0);
const chair = {parts: [
 {item: 'fanshuo-chair', mount: 'e0', orient: 'out'},
 {item: 'fanshuo-cushion', mount: 'e180', orient: 'hug'}
]};

const chairAgainstMang = async (t, seed, inputs, combatRules = rules.combatRules) => {
 const {foes, judgeBuilds} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
 const foe = foes.find(f => f.id === 'mang');
 const build = judgeBuilds.position.mang;
 const opponent = {parts: build.parts.map((part, i) => ({...part, mount: i ? build.spread : 'e0'}))};
 const game = await createV3Match({...rules, seed, fighters: [chair, opponent],
  combatRules: {...combatRules, ceramicShards: true},
  manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...build.ai, ...build.impactAi}], inputs}});
 t.after(() => game.free());
 return game;
};

test('a wide chair can strike off the core axis when the dash closes on the contact surface', async t => {
 const inputs = [input(1, 0, 'dash')];
 const current = await chairAgainstMang(t, 111300, inputs);
 const saved = await chairAgainstMang(t, 111300, inputs, {...previousImpactRules, impactDashContacts: false});
 for (const game of [current, saved]) advanceTo(game, 32);
 const landing = game => game.events.find(e => e.type === 'dash' && e.side === 0 && e.phase === 'end');
 const damage = game => game.events.find(e => e.type === 'hit' && e.attacker === 0);
 assert(landing(current).alignment < .9);
 assert.equal(landing(saved).quality, 'glance');
 assert.equal(landing(current).quality, 'full');
 assert(damage(current).damage >= 2 * damage(saved).damage);
 assert(rebound(current.events.find(e => e.type === 'recoil'), 1) > 2);
});

test('a glancing dash in the passive damage cooldown still deals ordinary damage', async t => {
 const inputs = [input(1, 0, 'dash'), input(40, 0, 'block'), input(81, 0, 'dash'),
  input(637, 0, 'dash'), input(1181, 0, 'block'), input(1203, 0, 'dash'), input(1849, 0, 'dash')];
 const game = await chairAgainstMang(t, 111301, inputs, previousImpactRules);
 advanceTo(game, 1881);
 const glance = game.events.find(e => e.type === 'dash' && e.side === 0 && e.quality === 'glance');
 const prior = game.events.findLast(e => e.t < glance.t && e.damage > 0);
 const hit = game.events.find(e => e.t === glance.t && e.type === 'hit' && e.attacker === 0);
 assert(glance.contactClosing > .75);
 assert(glance.t - prior.t < 1);
 assert.equal(hit.dashQuality, 'glance');
 assert.equal(hit.dash, false);
 assert(hit.damage > 0);
});

test('a head-on clash between two dashes plays a full hit on both sides', async t => {
 const inputs = [input(1, 0, 'dash'), input(33, 0, 'block'), input(56, 0, 'dash'), input(637, 0, 'dash')];
 const game = await chairAgainstMang(t, 111300, inputs);
 advanceTo(game, 650);
 const dash = game.events.find(e => e.type === 'dash' && e.side === 0 && e.pressStep === 637 && e.phase === 'end');
 const hits = game.events.filter(e => e.t === dash.t && ['hit','weak'].includes(e.type) && e.dash && e.damage > 0);
 assert.deepEqual(hits.map(e => e.attacker), [0, 1]);
});

test('a dash contact ends the receiving dash without a miss or recovery stun', async t => {
 const plate = {parts: [
  {item: 'fanshuo-plate', mount: 'e0', orient: 'out'},
  {item: 'fanshuo-cushion', mount: 'e180', orient: 'hug'}
 ]};
 const manual = {sides, inputs: [
  input(1, 0, 'dash'), input(1, 1, 'dash'), input(40, 0, 'block'),
  input(81, 0, 'dash'), input(636, 1, 'dash'), input(664, 0, 'dash')
 ]};
 const {resolveMutualDashContact, ...previousRules} = previousImpactRules;
 const setup = {...options, fighters: [chair, plate], seed: 111301, manual};
 const previous = await createV3Match({...setup, combatRules: previousRules});
 const current = await createV3Match({...setup, combatRules: previousImpactRules});
 t.after(() => { previous.free(); current.free(); });
 for (const game of [previous, current]) advanceTo(game, 673);
 const end = (game, side) => game.events.find(e => e.type === 'dash' && e.phase === 'end'
  && e.side === side && e.pressStep === (side === 0 ? 664 : 636));
 const hit = end(previous, 0);
 assert.equal(hit.quality, 'full');
 assert.deepEqual(end(current, 0), hit);
 const hurt = game => game.events.filter(e => e.t === hit.t && e.damage > 0);
 assert.deepEqual(hurt(current), hurt(previous));
 assert.equal(previous.control(1).dashing, true);
 assert.equal(current.control(1).dashing, false);
 assert.equal(end(current, 1).outcome, 'interrupted');
 assert.equal(end(current, 1).t, hit.t);
 for (const game of [previous, current]) advanceTo(game, 726);
 assert.equal(end(previous, 1).outcome, 'miss');
 assert(previous.control(1).stunIn > 0);
 assert.equal(current.control(1).stunIn, 0);
 assert.equal(current.events.filter(e => e.type === 'dash' && e.phase === 'end' && e.pressStep === 636).length, 1);
});

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

test('saved impact rules still deflect passive contact in damage cooldown', async t => {
 const game = await match(t, [input(100, 0, 'block'), input(121, 1, 'dash'), input(121, 0, 'dash')], options.fighters, previousImpactRules);
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

test('either shield takes ordinary damage at 30% and stays up to parry a later dash', async t => {
 const launchSpeeds = [];
 for (const [defender, parryStep] of [[0, 79], [1, 47]]) {
  const attacker = 1 - defender;
  const game = await match(t, [input(36, attacker, 'dash'), input(38, defender, 'block')]);
  advanceTo(game, 40);
  const bump = game.events.find(e => e.type === 'hit' && e.target === defender);
  const ordinary = game.events.find(e => e.type === 'hit' && e.target === attacker);
  assert.equal(bump.damage, ordinary.damage * .3);
  assert.equal(bump.shield, true);
  assert.equal(game.control(defender).shield, true);
  assert.equal(game.control(attacker).stunIn, 0);
  assert.equal(game.events.some(e => e.type === 'blockResult'), false);
  assert(rebound(game.events.find(e => e.type === 'recoil' && e.t === bump.t), attacker) <= 1.000001);

  advanceTo(game, parryStep);
  const deflection = game.events.find(e => e.type === 'blockResult' && e.deflected);
  assert.equal(deflection.resolvedStep, parryStep);
  assert.equal(deflection.perfect, true);
  assert.equal(game.control(attacker).stunIn, .5);
  assert(game.events.some(e => e.type === 'dash' && e.side === attacker && e.outcome === 'blocked'));
  launchSpeeds.push(rebound(game.events.find(e => e.type === 'recoil' && e.t === deflection.t), attacker));
  game.press(defender, 'dash');
  game.advance();
  assert.equal(game.control(defender).shield, false);
  assert.equal(game.control(defender).charging, true);
 }
 assert(launchSpeeds.every(speed => speed >= 2.25 && speed <= 3.500001));
 assert(launchSpeeds[0] > launchSpeeds[1], 'faster approach produces a stronger launch');
});

test('an empty guard does not prevent a dash on the next step', async t => {
 const game = await match(t, [input(60, 0, 'block'), input(106, 0, 'dash')]);
 advanceTo(game, 106);
 const empty = game.events.find(e => e.type === 'blockResult' && e.outcome === 'empty');
 assert.equal(empty.resolvedStep, 105);
 assert.equal(empty.dashLockedUntil, undefined);
 assert.equal(game.control(0).dashLockIn, 0);
 assert.equal(game.control(0).charging, true);
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

test('saved impact rules still lock the next dash after an empty guard', async t => {
 const game = await match(t, [input(60, 0, 'block')], options.fighters, previousImpactRules);
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

test('only the first opponent gets the additional durability', async t => {
 const top = {parts: [{item: 'fanshuo-pot', mount: 'e0', orient: 'out'}]};
 const {foes} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
 const get = async id => {
  const profile = foes.find(foe => foe.id === id).ai;
  const game = await createV3Match({...options, fighters: [top, top], manual: {sides: ['input', 'ai'], aiProfiles: [null, profile]}});
  t.after(() => game.free());
  return game.initial;
 };
 const [player, first] = await get('mang');
 const [,second] = await get('wen');
 assert(Math.abs(first.core.maxHp / player.core.maxHp - 1.15) < 1e-9);
 assert(Math.abs(first.parts[0].maxHp / player.parts[0].maxHp - 1.15) < 1e-9);
 assert.equal(second.core.maxHp, player.core.maxHp);
 assert.equal(second.parts[0].maxHp, player.parts[0].maxHp);
});

test('a heavy assembly uses full dash reach and cannot block on the first missed-dash recovery step', async t => {
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
