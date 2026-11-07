import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadRules} from '../../sim/index.js';
import {alternativePositionRoles, createV3Match, loadV3Rules, simulateV3, tierDamage} from '../../sim/v3.js';

const rules = {radiusTolerance: .03, recoilBase: .7, recoilLength: .02, outBonus: .08, rangeAttack: .4, rangeHp: .8, capHp: 60};
const fighters = [
 {parts: [{item: 'pan-lux3d', orient: 'out', mount: 'e0'}]},
 {parts: [{item: 'broom', orient: 'out', mount: 'e0'}]}
];
const roles = {attacker: 1, clash: false, tipRatios: [.2, .8]};

test('inward comparison uses approach before contact and treats two receding sides as a clash', () => {
 const options = {mode: 'inward', radii: [1, .5], priorRadii: [1.2, .52], elapsed: .2, reach: [1, 0]};
 const result = alternativePositionRoles(roles, options, .1, .3);
 assert.equal(result.attacker, 0);
 assert.equal(result.positionMode, 'inward');
 assert.equal(result.tipMultiplier, 1.06);
 const receding = alternativePositionRoles(roles, {...options, priorRadii: [.8, .3]}, .1, .3);
 assert.deepEqual(receding.positionValues, [0, 0]);
 assert.equal(receding.attacker, null);
 assert.equal(receding.clash, true);
});

test('reach correction can reverse a larger core radius without changing measured radii', () => {
 const result = alternativePositionRoles(roles, {mode: 'reach', radii: [1, .5], reach: [.8, .1]}, .03, .3);
 assert.equal(result.attacker, 1);
 assert.deepEqual(result.positionRadii, [1, .5]);
 assert.deepEqual(result.positionValues, [1 - .8, .5 - .1]);
});

test('fixed attachment cap is independent of reduced HP, while core cap stays unchanged', async () => {
 const catalog = await loadRules();
 const physics = await loadV3Rules();
 const attacker = catalog.items.find(item => item.id === 'pan-lux3d');
 const target = catalog.items.find(item => item.id === 'wasteland-broom');
 const input = {mode: 'A', impulse: 100, ramp: 4.5, attacker, target, materials: catalog.materials, matchups: catalog.matchups, rules: physics, positionRules: rules};
 for (const maxHp of [6.78, 40.68]) {
  assert.equal(tierDamage({...input, maxHp}).damageCap, 60 * physics.maxHitFraction);
  assert.equal(tierDamage({...input, maxHp, weak: true}).damageCap, 60 * physics.weakCritMaxFraction);
 }
 const core = {...target, id: '__core'};
 assert.equal(tierDamage({...input, target: core, maxHp: physics.core.hp}).damageCap, physics.core.hp * physics.maxHitFraction);
});

for (const roleMode of ['radius', 'inward', 'reach']) test(`${roleMode} alternative freezes and reproduces the complete replay`, async () => {
 const combatRules = {...rules, roleMode, ...(roleMode === 'inward' && {inwardWindow: .15, inwardTolerance: .1})};
 const options = {fighters, seed: 904001, combat: 'position', combatRules, manual: {sides: ['ai', 'ai']}};
 const first = await simulateV3(options);
 const second = await simulateV3({...options, combatRules: first.meta.combatRules});
 const sha = replay => createHash('sha256').update(JSON.stringify(replay)).digest('hex');
 assert.equal(sha(first), sha(second));
 assert.deepEqual(first.meta.combatRules, combatRules);
 const contacts = first.events.filter(event => event.type === 'contact');
 assert(contacts.length > 0);
 if (roleMode !== 'radius') assert(contacts.every(event => event.positionMode === roleMode));
});

test('alternative parameters reject invalid caps, modes and approach windows', async () => {
 for (const extra of [{capHp: 0}, {capHp: Infinity}, {roleMode: 'unknown'}, {roleMode: 'inward'}, {roleMode: 'inward', inwardWindow: 0, inwardTolerance: .1}, {roleMode: 'inward', inwardWindow: .15, inwardTolerance: -1}]) {
  await assert.rejects(createV3Match({fighters, seed: 1, combat: 'position', combatRules: {...rules, ...extra}}));
 }
});
