import assert from 'node:assert/strict';
import test from 'node:test';
import {createV3Match, PVP_COMBAT_OPTIONS as rules} from '../../sim/v3.js';
import {random} from '../../sim/math.js';

const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const pot = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);
const knife = build([{item: 'fanshuo-knife', orient: 'out'}, {item: 'fanshuo-plate', orient: 'hug'}]);
// 好友对撞 plays the 评委版's 一机双人 rules: ceramic shards on, the faster lunge (web/src/main.js NET_OPTIONS).
const net = {...rules, combatRules: {...rules.combatRules, ceramicShards: true, lungeTempo: 1.6}};
let options = rules;
const pvp = (seed, fighters) => createV3Match({...options, seed, fighters, manual: {sides: ['input', 'input']}});

// Two people pressing at random: a 冲 or 挡 every 0.2–1.2 s each, the whole match.
function script(seed) {
  const roll = random(seed), out = new Map();
  for (const side of [0, 1]) for (let step = 30 + Math.floor(roll() * 60); step < 14400; step += 24 + Math.floor(roll() * 120)) {
    const k = out.get(step) ?? [];
    k.push([side, roll() < .6 ? 'dash' : 'block']);
    out.set(step, k);
  }
  return out;
}
const pressFor = (m, presses) => { for (const [side, action] of presses.get(m.step + 1) ?? []) m.press(side, action); };

async function straight(seed, fighters, presses) {
  const m = await pvp(seed, fighters), hashes = [];
  while (!m.done) { pressFor(m, presses); m.advance(); hashes.push(m.hash()); }
  return {result: JSON.stringify(m.result()), hashes};
}

// The same presses, but now and then wound back 1–12 steps and played again, as a late press from the other phone would.
async function rolled(seed, fighters, presses) {
  const m = await pvp(seed, fighters), roll = random(seed ^ 0x5bd1e995), shots = new Map(), hashes = [];
  let rollbacks = 0;
  shots.set(0, m.snapshot());
  while (!m.done) {
    pressFor(m, presses); m.advance(); hashes[m.step - 1] = m.hash();
    if (m.done) break;
    shots.set(m.step, m.snapshot()); for (const k of shots.keys()) if (k < m.step - 60) shots.delete(k);
    if (roll() < .08) { const back = Math.max(0, m.step - 1 - Math.floor(roll() * 12)); m.restore(shots.get(back)); rollbacks++; }
  }
  return {result: JSON.stringify(m.result()), hashes, rollbacks};
}

test('a match wound back and played again comes out byte for byte the same', async () => {
  for (const [seed, fighters] of [[7, [pot, knife]], [23, [knife, pot]], [42, [pot, pot]]]) {
    const presses = script(seed), a = await straight(seed, fighters, presses), b = await rolled(seed, fighters, presses);
    assert.ok(b.rollbacks > 100, `seed ${seed}: only ${b.rollbacks} rollbacks`);
    assert.equal(b.hashes.length, a.hashes.length, `seed ${seed} length`);
    const first = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
    assert.equal(first, -1, `seed ${seed}: hashes part at step ${first + 1}`);
    assert.equal(b.result, a.result, `seed ${seed} result`);
  }
});

test('…and so does one under the rules 好友对撞 plays, ceramic pieces and a seed the room hands out', async () => {
  options = net;
  try {
    const cup = build([{item: 'fanshuo-cup', orient: 'out'}, {item: 'fanshuo-plate', orient: 'out'}]);
    for (const [seed, fighters] of [[4271333276, [pot, cup]], [2654435769, [cup, knife]], [99, [cup, cup]]]) {
      const presses = script(seed), a = await straight(seed, fighters, presses), b = await rolled(seed, fighters, presses);
      const first = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
      assert.equal(first, -1, `seed ${seed}: hashes part at step ${first + 1}`);
      assert.equal(b.result, a.result, `seed ${seed} result`);
    }
  } finally { options = rules; }
});

test('restoring rewinds a press that came after the snapshot', async () => {
  const m = await pvp(3, [pot, pot]);
  try {
    for (let i = 0; i < 100; i++) m.advance();
    const shot = m.snapshot(), events = m.events.length;
    m.press(0, 'dash');
    for (let i = 0; i < 40; i++) m.advance();
    assert.ok(m.control(0).dashIn > 0);
    m.restore(shot);
    assert.equal(m.step, 100); assert.equal(m.events.length, events);
    assert.equal(m.control(0).dashIn, 0); assert.equal(m.control(0).charging, false);
  } finally { m.free(); }
});
