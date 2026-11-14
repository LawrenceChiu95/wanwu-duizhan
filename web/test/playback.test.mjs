import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Playback} from '../src/playback.js';
import {createV3Match, simulateV3, PLANAR_JUDGE_COMBAT_OPTIONS} from '../../sim/v3.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const fighter = () => ({pos: [0, 0, 0], quat: [0, 0, 0, 1], angularVelocity: [0, 0, 0], hp: 100, maxHp: 100, parts: []});
function fixture(events) {
  return {meta: {duration: 10}, decisive: {}, events, frames: [0, 10].map(t => ({t, fighters: [fighter(), fighter()]}))};
}
const impacts = [
  {t: .013, type: 'hit'},
  {t: .013, type: 'weak'}, // same contact freezes once, for the longer .16 s
  {t: .027, type: 'break'},
  {t: .201, type: 'hit', role: 'attack', dash: true}, // .08 s
  {t: .252, type: 'hit'} // .045 s
];
for (const ms of [16, 33, 50, 100]) {
  test(`${ms} ms frames consume exactly wall time minus designed hit-stops`, () => {
    const p = new Playback(fixture(impacts)), fired = [];
    p.slowEnabled = false;
    for (let wall = 0; wall < 2;) {
      const dt = Math.min(ms / 1000, 2 - wall);
      p.advance(dt, 1, e => fired.push(e));
      wall += dt;
    }
    close(p.t, 2 - .16 - .14 - .08 - .045);
    close(p.hold, 0);
    assert.deepEqual(fired, impacts, 'same-timestamp events fire together, once, in order');
  });
}

test('speed scales moving time, not the real duration of a hit-stop', () => {
  const p = new Playback(fixture([{t: .01, type: 'hit'}]));
  p.slowEnabled = false;
  p.advance(.1, 2, () => {});
  close(p.t, (.1 - .045) * 2);
  close(p.hold, 0);
});

test('parry dilation starts after its unchanged .1 second freeze and seek clears it', () => {
  const p = new Playback(fixture([{t: .01, type: 'parry'}]));
  p.slowEnabled = false;
  p.advance(.05, 1, () => {});
  close(p.t, .01);
  close(p.hold, .06);
  close(p.dilate, .4);
  p.advance(.08, 1, () => {});
  close(p.t, .016);
  close(p.hold, 0);
  close(p.dilate, .38);
  p.seek(1);
  close(p.hold, 0);
  close(p.dilate, 0);
});

test('a deflect in the same step stands in for the parry: its own shorter freeze and slow motion, once', () => {
  for (const [events, stop, time] of [
    [[{t: .01, type: 'parry'}, {t: .01, type: 'blockResult', deflected: true, perfect: true}], .09, .15],
    [[{t: .01, type: 'blockResult', deflected: true, perfect: true}, {t: .01, type: 'parry'}], .09, .15],
    [[{t: .01, type: 'blockResult', deflected: true}], .05, .12]
  ]) {
    const p = new Playback(fixture(events)), fired = [];
    p.slowEnabled = false;
    p.advance(.02, 1, e => fired.push(e));
    assert.equal(fired.length, events.length);
    close(p.t, .01);
    close(p.hold, stop - .01);
    close(p.dilate, time);
  }
  // Without `deflected` (?feel=old) a block result changes nothing.
  const p = new Playback(fixture([{t: .01, type: 'blockResult', outcome: 'perfect'}]));
  p.slowEnabled = false;
  p.advance(.05, 1, () => {});
  close(p.t, .05);
  close(p.dilate, 0);
});

test('live in the new feel a glance that strikes freezes as an ordinary knock, whatever it hit (Elara fc75c4cc)', () => {
  const crit = {t: .01, type: 'weak', role: 'attack', dashQuality: 'glance'};
  for (const [soft, stop] of [[true, .045], [false, .16]]) {
    const p = new Playback(fixture([crit]));
    p.slowEnabled = false;
    p.softGlance = soft;
    p.advance(.02, 1, () => {});
    close(p.hold, stop - .01);
  }
  // A crit that was no glance keeps its beat.
  const p = new Playback(fixture([{...crit, dashQuality: null}]));
  p.slowEnabled = false;
  p.softGlance = true;
  p.advance(.02, 1, () => {});
  close(p.hold, .15);
});

test('live refined feel stops only on a full dash or a real parry', () => {
  const full = {t: .02, type: 'hit', role: 'attack', dash: true};
  const ordinary = [{t: .01, type: 'hit', shield: true}, {t: .01, type: 'break'},
    {t: .015, type: 'weak', role: 'attack', dashQuality: 'glance'}];
  const p = new Playback(fixture([...ordinary, full]), {dashOnlyImpact: true});
  p.slowEnabled = false;
  p.advance(.03, 1, () => {});
  close(p.t, .02);
  close(p.hold, .07);
  close(p.dilate, 0);

  const feedback = [
    {t: .01, type: 'parry'}, {t: .01, type: 'blockResult', deflected: true, perfect: true}
  ];
  const q = new Playback(fixture([...feedback]), {dashOnlyImpact: true});
  q.slowEnabled = false;
  q.advance(.02, 1, () => {});
  close(q.hold, .08);
  close(q.dilate, .15);
});

test('a freeze the page asks for holds the event that asked, or the next frame (new-feel breaks, Elara 2621157e)', () => {
  // During the break's own event: the picture stops on that event, as a replay's break does.
  const p = new Playback(fixture([{t: .01, type: 'break'}]), {dashOnlyImpact: true});
  p.slowEnabled = false;
  p.advance(.05, 1, e => { if (e.type === 'break') p.freezeFor(.14); });
  close(p.t, .01);
  close(p.hold, .14 - .04);
  // Between frames (a break that waited for ceramic shards): the next frame holds from its start.
  const q = new Playback(fixture([]), {dashOnlyImpact: true});
  q.slowEnabled = false;
  q.advance(.1, 1, () => {});
  q.freezeFor(.14);
  q.advance(.1, 1, () => {});
  close(q.t, .1);
  close(q.hold, .04);
  q.advance(.1, 1, () => {});
  close(q.t, .16);
});

const options = {
  fighters: [
    {parts: [{item: 'pan-lux3d', mount: 'e0', orient: 'out'}, {item: 'pillow', mount: 'e180', orient: 'hug'}]},
    {parts: [{item: 'pan-lux3d', mount: 'e0', orient: 'out'}, {item: 'lamp-lux3d', mount: 'e180', orient: 'hug'}]}
  ],
  mode: 'A', seed: 9908,
  manual: {sides: ['input', 'ai'], inputs: [
    {step: 1, side: 0, action: 'dash'}, {step: 30, side: 0, action: 'block'},
    {step: 501, side: 0, action: 'dash'}, {step: 800, side: 0, action: 'block'}
  ]}
};
test('four frame intervals retain every byte of the fixed-input 120 Hz replay', async () => {
  const reference = JSON.stringify(await simulateV3(options));
  const hashes = [];
  for (const ms of [16, 33, 50, 100]) {
    const m = await createV3Match(options);
    try {
      const p = new Playback({meta: {duration: Infinity}, decisive: {}, frames: m.frames, events: m.events});
      p.slowEnabled = false;
      let frames = 0;
      while (!p.done) {
        assert.ok(++frames < 20000, 'live match finishes');
        while (!m.done && m.t < p.t + ms / 1000 + .05) m.advance();
        if (m.done) p.r = m.result();
        p.sync(m.done);
        p.advance(ms / 1000, 1, () => {});
      }
      const bytes = JSON.stringify(m.result());
      assert.equal(m.rules.dt, 1 / 120);
      assert.equal(bytes, reference, `${ms} ms fixed-input full replay`);
      hashes.push(createHash('sha256').update(bytes).digest('hex'));
    } finally { m.free(); }
  }
  assert.equal(new Set(hashes).size, 1);
});

test('planar charges follow until the last ten steps and preserve the block window', async () => {
  const r = await simulateV3({...options, ...PLANAR_JUDGE_COMBAT_OPTIONS});
  assert.ok(r.frames.every(frame => frame.fighters.every(fighter => fighter.pos[1] === 0)));
  const charge = r.events.find(event => event.type === 'dash' && event.phase === 'charge' && event.side === 0);
  const go = r.events.find(event => event.type === 'dash' && event.phase === 'go' && event.side === 0);
  const aims = r.events.filter(event => event.type === 'dashAim' && event.side === 0 && event.pressStep === charge.pressStep);
  assert.ok(aims.length > 1);
  assert.ok(aims.every(aim => aim.until === charge.until && aim.lockedDir[1] === 0 && aim.reach > 0));
  close(go.t - charge.t, .3);
  close(go.t - aims.at(-1).t, 10 / 120);
  assert.deepEqual(go.dir, aims.at(-1).lockedDir);
  const block = r.events.find(event => event.type === 'block' && event.side === 0);
  close(block.until - block.t, r.meta.rules.manual.blockTime);
  assert.equal(r.meta.combatRules.lockCorePlane, true);
});
