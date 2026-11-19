import assert from 'node:assert/strict';
import test from 'node:test';
import {createV3Match, PVP_COMBAT_OPTIONS as rules} from '../../sim/v3.js';
import {random} from '../../sim/math.js';
import {Session} from '../../web/src/netplay/session.js';

const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const pot = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);
const knife = build([{item: 'fanshuo-knife', orient: 'out'}, {item: 'fanshuo-plate', orient: 'hug'}]);
const pvp = (seed, fighters) => createV3Match({...rules, seed, fighters, manual: {sides: ['input', 'input']}});

/**
 * Two phones on one clock, 60 picture frames a second (two physics steps each), a network between them that is `rtt`
 * milliseconds there and back (± jitter) and drops `loss` of what it carries. Each person presses at random.
 */
export async function duel({seed, fighters, rtt, jitter = 0, loss = 0, delay = 2}) {
  const roll = random(seed ^ 0x2545f491), net = [];
  const phones = await Promise.all([0, 1].map(async seat => new Session(await pvp(seed, fighters), {seat, delay})));
  const nextPress = [0, 1].map(() => 40 + Math.floor(roll() * 60));
  let ms = 0, frame = 0;
  while (!phones.every(p => p.finished) && frame < 60 * 200) {
    frame++; ms = frame * 1000 / 60;
    for (const n of net.filter(n => n.at <= ms)) phones[n.to].receive(n.msg);
    net.splice(0, net.length, ...net.filter(n => n.at > ms));
    for (const [seat, p] of phones.entries()) {
      if (!p.m.done && p.present >= nextPress[seat]) { p.press(roll() < .6 ? 'dash' : 'block'); nextPress[seat] = p.present + 24 + Math.floor(roll() * 120); }
      p.tick(frame * 2);
      if (roll() >= loss) net.push({to: 1 - seat, at: ms + rtt / 2 + (roll() * 2 - 1) * jitter, msg: structuredClone(p.outgoing())});
    }
  }
  return phones;
}

async function straight(seed, fighters, log) {
  const m = await pvp(seed, fighters), at = new Map();
  for (const [step, side, action] of log) at.set(step, [...at.get(step) ?? [], [side, action]]);
  while (!m.done) { for (const [side, action] of at.get(m.step + 1) ?? []) m.press(side, action); m.advance(); }
  return m;
}

for (const [name, net] of [['same Wi-Fi', {rtt: 20, jitter: 8}], ['50 ms', {rtt: 50, jitter: 10}], ['150 ms', {rtt: 150, jitter: 20}], ['150 ms and 1% lost', {rtt: 150, jitter: 20, loss: .01}], ['400 ms', {rtt: 400, jitter: 40}]]) {
  test(`two phones ${name}: both see the same match, the one their presses make`, async () => {
    for (const [seed, fighters] of [[7, [pot, knife]], [42, [knife, pot]]]) {
      const [a, b] = await duel({seed, fighters, ...net});
      assert.ok(a.finished && b.finished, 'both finished');
      assert.equal(a.desync, null); assert.equal(b.desync, null);
      const ra = JSON.stringify(a.m.result()), rb = JSON.stringify(b.m.result());
      assert.equal(ra, rb, `seed ${seed}: the phones differ`);
      // Whoever's presses, on the steps they were tagged with, played straight give the same match.
      const log = [...a.log.filter(x => x[1] === a.seat), ...b.log.filter(x => x[1] === b.seat)];
      assert.equal(JSON.stringify((await straight(seed, fighters, log)).result()), ra, `seed ${seed}: not the straight match`);
      assert.ok(a.m.result().meta.manual.inputs.length > 4, 'presses were taken');
    }
  });
}

test('a late press is played again from its step, and a lie about the state is caught', async () => {
  const [a] = await duel({seed: 3, fighters: [pot, pot], rtt: 150, jitter: 20});
  assert.ok(a.stats.rollbacks > 0 && a.stats.maxDepth > 0);
  const m = await pvp(3, [pot, pot]), s = new Session(m, {seat: 0});
  s.receive({k: 'in', u: 130, p: [], n: 120, a: 0, h: [[60, 12345]]});
  s.tick(120);
  assert.equal(s.desync?.step, 60);
  m.free();
});

test('a state check that comes with the late press it hangs on waits for the replay, not a false 两边算岔了', async () => {
  const [a, b] = await Promise.all([0, 1].map(async seat => new Session(await pvp(5, [pot, knife]), {seat})));
  b.receive({k: 'in', u: 200, p: [], n: 0, a: 0, h: []});
  b.tick(48);
  a.receive(b.outgoing());
  b.press('dash'); b.tick(130);
  a.tick(90);
  const stale = a.hashes.get(60);
  b.receive(a.outgoing());
  const told = b.outgoing();
  assert.ok(told.h.some(([s, h]) => s === 60 && h !== stale), 'the press changed step 60');
  a.receive(told);
  assert.equal(a.desync, null, 'not before the replay');
  a.tick(130);
  assert.equal(a.desync, null);
  assert.equal(a.hashes.get(120), b.hashes.get(120));
  a.m.free(); b.m.free();
});
