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

/**
 * A page reloaded mid-match (Elara db4ed438 ①): its presses and step kept on the phone, a new match from the start; it
 * asks the other phone for all of its presses ({k:'again'}), plays up to where it was, and the match goes on. The room
 * has the match paused meanwhile, so neither phone plays on until the reloaded one is back.
 */
async function reloadDuel({seed, fighters, rtt, loss = 0, at = 600, who = [1]}) {
  const roll = random(seed ^ 0x51ed27), net = [];
  const phones = await Promise.all([0, 1].map(async seat => new Session(await pvp(seed, fighters), {seat})));
  const nextPress = [0, 1].map(() => 40 + Math.floor(roll() * 60));
  const back = [null, null];
  let ms = 0, frame = 0, reloaded = false;
  while (!phones.every(p => p.finished) && frame < 60 * 200) {
    frame++; ms = frame * 1000 / 60;
    if (!reloaded && phones[0].present >= at) {
      reloaded = true;
      for (const seat of who) {
        const old = phones[seat], kept = {p: structuredClone(old.own), n: old.present};
        old.m.free();
        const s = phones[seat] = new Session(await pvp(seed, fighters), {seat});
        s.resume(kept.p, kept.n);
        back[seat] = kept.n;
      }
      net.length = 0;  // what was on its way to the old page is gone with it
    }
    for (const n of net.filter(n => n.at <= ms)) {
      const p = phones[n.to];
      if (n.msg.k === 'again') { p.again(); net.push({to: 1 - n.to, at: ms + rtt / 2, msg: structuredClone(p.outgoing())}); }
      else p.receive(n.msg);
    }
    net.splice(0, net.length, ...net.filter(n => n.at > ms));
    const restoring = back.some(x => x !== null);
    for (const [seat, p] of phones.entries()) {
      if (back[seat] !== null) {
        if (p.peerFull === null) { if (frame % 10 === 0) net.push({to: 1 - seat, at: ms + rtt / 2, msg: {k: 'again'}}); continue; }
        p.tick(Math.max(back[seat], p.peerFull.u - p.delay + 1, p.peerFull.a - p.delay + 1));
        back[seat] = null;
        continue;
      }
      if (restoring) continue;  // paused by the room
      if (!p.m.done && p.present >= nextPress[seat]) { p.press(roll() < .6 ? 'dash' : 'block'); nextPress[seat] = p.present + 24 + Math.floor(roll() * 120); }
      p.tick(p.present + 2);
      if (roll() >= loss) net.push({to: 1 - seat, at: ms + rtt / 2, msg: structuredClone(p.outgoing())});
    }
  }
  return phones;
}

for (const [name, who] of [['the guest', [1]], ['the host', [0]], ['both', [0, 1]]]) {
  test(`${name} reloading mid-match plays on into the same match`, async () => {
    for (const [seed, fighters] of [[7, [pot, knife]], [42, [knife, pot]]]) {
      const [a, b] = await reloadDuel({seed, fighters, rtt: 80, loss: .03, who});
      assert.ok(a.finished && b.finished, 'both finished');
      assert.equal(a.desync, null); assert.equal(b.desync, null);
      const ra = JSON.stringify(a.m.result());
      assert.equal(ra, JSON.stringify(b.m.result()), `seed ${seed}: the phones differ`);
      const log = [...a.own.map(([s, x]) => [s, 0, x]), ...b.own.map(([s, x]) => [s, 1, x])];
      assert.equal(JSON.stringify((await straight(seed, fighters, log)).result()), ra, `seed ${seed}: not the straight match`);
      assert.ok(a.own.some(([s]) => s > 620) && b.own.some(([s]) => s > 620), 'both pressed after the reload');
      a.m.free(); b.m.free();
    }
  });
}

test('a broken or made-up message from the other phone is dropped and counted, and the next good one is taken', async () => {
  const s = new Session(await pvp(9, [pot, knife]), {seat: 0});
  const junk = [null, 7, 'in', {}, {k: 'in'}, {k: 'in', u: 1.5, p: []}, {k: 'in', u: 1e12, p: []}, {k: 'in', u: -9, p: []},
    {k: 'in', u: 10, p: 'dash'}, {k: 'in', u: 10, p: [[5]]}, {k: 'in', u: 10, p: [[5, 'kick']]}, {k: 'in', u: 10, p: [[5000, 'dash']]},
    {k: 'in', u: 10, p: [], n: 'x'}, {k: 'in', u: 10, p: [], v: Infinity}, {k: 'in', u: 10, p: [], h: [[60]]},
    {k: 'in', u: 10, p: [], h: [[60, 'abc']]}, {k: 'in', u: 10, p: [], h: Array(40).fill([60, 1])}, {k: 'in', u: 10, p: [], a: NaN}];
  for (const msg of junk) assert.equal(s.receive(msg), false, JSON.stringify(msg));
  assert.equal(s.stats.bad, junk.length);
  assert.equal(s.remoteUpto, 0, 'nothing taken');
  assert.equal(s.receive({k: 'in', u: 10, p: [[8, 'dash']], n: 8, a: 0, v: 0, h: []}), true);
  assert.equal(s.remoteUpto, 10);
  assert.deepEqual(s.theirs.get(8), ['dash']);
  s.tick(20);
  assert.equal(s.present, 20);
  s.m.free();
});

test('two presses on one step reach the other phone in the order they were made', async () => {
  const [a, b] = await Promise.all([0, 1].map(async seat => new Session(await pvp(11, [pot, knife]), {seat})));
  a.tick(40); b.tick(40);
  a.press('dash'); a.press('block');
  assert.deepEqual(a.outgoing().p.map(x => x[1]), ['dash', 'block']);
  b.receive(a.outgoing());
  assert.deepEqual(b.theirs.get(42), ['dash', 'block']);
  for (const s of [a, b]) { s.receive((s === a ? b : a).outgoing()); s.tick(120); }
  a.receive(b.outgoing()); b.receive(a.outgoing()); a.tick(120); b.tick(120);
  assert.equal(a.m.hash(), b.m.hash());
  // Every event of the match so far, one by one, the same on both.
  assert.equal(JSON.stringify(b.m.events), JSON.stringify(a.m.events));
  assert.ok(a.m.events.some(e => e.side === 0 && e.type === 'dash'), 'the 冲 was played');
  a.m.free(); b.m.free();
});
