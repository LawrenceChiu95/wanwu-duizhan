import assert from 'node:assert/strict';
import test from 'node:test';
import {createV3Match, loadV3Rules, applyLungeTempo, MATERIAL_JUDGE_COMBAT_OPTIONS as solo} from '../../sim/v3.js';

// 冲加快试玩 (远夏 4872800a, Elara 5c5bbeba): lungeTempo makes the lunge faster and shorter in time, about as far, and
// leaves the wind-ups alone; without it nothing changes.
const reach = (M, dt, damping) => {
 let speed = M.dashSpeed, d = 0;
 for (let i = 0; i < Math.round(M.dashTime / dt); i++) { speed = (Math.min(speed, M.dashSpeedLimit) + M.dashThrust * dt) / (1 + damping * dt); d += speed * dt; }
 return d;
};
const P = {parts: [{item: 'fanshuo-pot', orient: 'out', mount: 'e0'}, {item: 'fanshuo-cushion', orient: 'hug', mount: 'e180'}]};
const F = {parts: [{item: 'fanshuo-plate', orient: 'out', mount: 'e0'}, {item: 'fanshuo-roller', orient: 'hug', mount: 'e180'}]};

test('a faster lunge reaches about as far in less time', async () => {
 const r = await loadV3Rules(), base = reach(r.manual, r.dt, r.linearDamping);
 for (const k of [1.3, 1.6]) {
  const M = applyLungeTempo({...r.manual}, k);
  assert.ok(Math.abs(M.dashTime - r.manual.dashTime / k) < 1e-12 && M.dashSpeed > r.manual.dashSpeed);
  assert.ok(Math.abs(reach(M, r.dt, r.linearDamping) / base - 1) < .03, `reach at ${k}`);
 }
});

test('lungeTempo is checked and only touches the lunge', async () => {
 const args = k => ({fighters: [P, F], seed: 803, ...solo, combatRules: {...solo.combatRules, ...(k !== undefined && {lungeTempo: k})}, manual: {sides: ['input', 'ai']}});
 for (const k of [0.5, 2.5, NaN]) await assert.rejects(createV3Match(args(k)), /lungeTempo/);
 const plain = await createV3Match(args()), fast = await createV3Match(args(1.3));
 try {
  const a = plain.rules.manual, b = fast.rules.manual;
  assert.equal(b.dashTime, a.dashTime / 1.3);
  for (const key of ['chargeTime', 'dashCooldown', 'blockTime', 'blockCooldown', 'dashDamage']) assert.equal(b[key], a[key], key);
 } finally { plain.free(); fast.free(); }
});
