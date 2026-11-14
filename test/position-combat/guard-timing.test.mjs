import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createV3Match, GUARD_TIMING_JUDGE_COMBAT_OPTIONS as rules, simulateV3} from '../../sim/v3.js';

const core = {parts: []};
const bare = { ...rules, seed: 6, fighters: [core, core] };
const input = (step, side, action) => ({step, side, action});
const advanceTo = (game, step) => {
 while (!game.done && game.step < step) game.advance();
};

test('21 ticks before contact is perfect; 22 ticks is tight for either defender', async t => {
 for (const [attacker, step] of [[0, 61], [1, 82]]) {
  const defender = 1 - attacker;
  const setup = { ...bare, manual: {sides: ['input', 'input'], inputs: [input(36, attacker, 'dash')]} };
  const unguarded = await createV3Match(setup);
  t.after(() => unguarded.free());
  advanceTo(unguarded, step);
  const strike = game => game.events.find(e => e.t === step * game.rules.dt && e.attacker === attacker && e.role === 'attack');
  assert.equal(strike(unguarded).dash, true);
  for (const [lead, outcome] of [[21, 'perfect'], [22, 'tight']]) {
   const game = await createV3Match({ ...setup, manual: {...setup.manual, inputs: [...setup.manual.inputs, input(step-lead, defender, 'block')]} });
   t.after(() => game.free());
   advanceTo(game, step);
   const guard = game.events.find(e => e.type === 'blockResult');
   assert.equal(guard.outcome, outcome);
   assert.equal(guard.resolvedStep, step);
   assert.equal(guard.attacker, attacker);
   assert.equal(guard.side, defender);
   assert.equal(guard.point.length, 3);
   const rebound = game.events.find(e => e.t === guard.t && e.type === 'recoil');
   const radial = (side) => Math.abs(rebound.velocityAfter[side].reduce((sum, val, axis) => sum + val * rebound.normal[axis], 0));
   assert.equal(game.events.find(e => e.type === 'dash' && e.t === guard.t).outcome, 'blocked');
   if (outcome === 'perfect') {
    assert.equal(guard.deflected, true);
    assert.equal(guard.stunUntil, guard.t + .5);
    assert.equal(game.control(attacker).stunIn, .5);
    assert(radial(attacker) >= 2.25);
    game.press(defender, 'dash');
    game.press(defender, 'block');
    game.advance();
    assert.equal(game.control(defender).charging, true);
    assert.equal(game.control(defender).blockIn, 3.5);
   } else {
    assert.equal(guard.deflected, undefined);
    assert.equal(game.control(attacker).stunIn, 0);
    assert(radial(0) <= 1.000001 && radial(1) <= 1.000001);
    assert.equal(game.events.some(e => e.type === 'parry'), false);
    assert(Math.abs(strike(game).damageBeforeHpClamp - strike(unguarded).damageBeforeHpClamp * .3) < 1e-9);
    assert.equal(game.control(defender).blockIn, (420 - lead) * game.rules.dt);
   }
  }
 }
});

test('an empty shield lasts 60 steps and keeps its cooldown from the original press', async t => {
 const game = await createV3Match({...bare, manual: {sides: ['input', 'input'], inputs: [input(1, 0, 'block')]}});
 t.after(() => game.free());
 advanceTo(game, 61);
 const guard = game.events.find(e => e.type === 'blockResult');
 assert.equal(guard.outcome, 'empty');
 assert.equal(guard.resolvedStep, 61);
 assert.equal(game.control(0).blockIn, 3);
 game.press(0, 'block');
 game.advance();
 assert.equal(game.events.filter(e => e.type === 'block').length, 1);
});

test('the enemy telegraph, seeded cooldown and guard options reproduce from replay', async () => {
 const {foes, judgeBuilds} = JSON.parse(await readFile(new URL('../../data/foes.json', import.meta.url)));
 const {parts, spread} = judgeBuilds.position.mang;
 const opponent = {parts: parts.map((p,i) => ({...p, mount: i ? spread : 'e0'}))};
 const setup = {...bare, fighters: [core, opponent], seed: 111300,
  manual: {sides: ['input', 'ai'], aiProfiles: [null, foes[0].ai], inputs: [input(32, 0, 'block')]}};
 const first = await simulateV3(setup);
 const {meta, events} = first;
 const charge = events.filter(e => e.type === 'dash' && e.side === 1 && e.phase === 'charge');
 assert(charge[0].t >= .4 && charge.length >= 2);
 for (const cue of charge) {
  assert(Math.abs(cue.until - cue.t - .55) < 1e-9);
  const go = events.find(e => e.type === 'dash' && e.phase === 'go' && e.side === 1 && e.pressStep === cue.pressStep);
  if (go) assert(Math.abs(go.t - cue.until) < 1e-9);
 }
 assert(Math.abs(charge[0].blockReadyIn - (32 + 420 - charge[0].pressStep) * meta.rules.dt) < 1e-9);
 const readies = events.filter(e => e.type === 'ready' && e.action === 'dash' && e.side === 1);
 assert(readies.length >= 2);
 assert(readies.every((e,i) => e.t-charge[i].t >= 4.5-1e-9 && e.t-charge[i].t <= 6+1e-9));
 assert(new Set(readies.map((e,i) => Math.round((e.t-charge[i].t)/meta.rules.dt))).size > 1);
 assert.equal(JSON.stringify(await simulateV3({...setup, combatRules: meta.combatRules, manual: meta.manual})), JSON.stringify(first));
});
