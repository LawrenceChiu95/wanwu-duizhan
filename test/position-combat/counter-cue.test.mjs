import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createV3Match, COUNTER_CUE_LIT as LIT, MATERIAL_JUDGE_COMBAT_OPTIONS as solo, PVP_COMBAT_OPTIONS as pvpRules} from '../../sim/v3.js';
import {random} from '../../sim/math.js';

// 反打 (Elara b32bfd9a ①): after a 完美 the 冲 button lights up as 「反打」 while control().counterIn >= COUNTER_CUE_LIT,
// and a 冲 pressed while it is lit must land as the counter. Scripted players block a reaction after each cue; at each
// fight's first 完美 the 冲 goes in at the first and the last lit step, on the three stages and in 一机双人.
const {foes, judgeBuilds} = JSON.parse(readFileSync(new URL('../../data/foes.json', import.meta.url)));
const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const P1 = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);
const P2 = build([{item: 'fanshuo-plate', orient: 'out'}, {item: 'fanshuo-roller', orient: 'hug'}]);
function setup(mode, seed, inputs = []) {
 if (mode === 'pvp') return {...pvpRules, seed, fighters: [P1, P2], manual: {sides: ['input', 'input'], inputs}};
 const foe = foes.find(f => f.id === mode), tuned = judgeBuilds.position[mode];
 return {...solo, seed, fighters: [P1, build(tuned.parts, tuned.spread)], combatRules: {...solo.combatRules, ceramicShards: true},
  manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...tuned.ai, ...tuned.impactAi}], inputs}};
}
const players = mode => mode === 'pvp' ? [0, 1] : [0];
// 冲 would be taken at the next step (main.js press(): a 完美 readies it for that step).
const ready = c => c.dashIn <= 1 / 120 + 1e-9 && !c.charging && !c.dashing && !(c.stunIn > 0);

// The scripted fight up to its first `most` 完美: the presses it took and each 完美 (side, step).
async function script(mode, seed, most) {
 const m = await createV3Match(setup(mode, seed)), rng = random(seed ^ 0x5eed), plans = [null, null], perfect = [];
 try {
  for (let seen = 0; !m.done && perfect.length < most && m.t < 90; m.advance()) {
   for (; seen < m.events.length; seen++) {
    const e = m.events[seen];
    if (e.type === 'dashCue' && players(mode).includes(1 - e.side)) plans[1 - e.side] = m.t + .25 + rng() * .3;
    if (e.type === 'blockResult' && e.outcome === 'perfect' && e.deflected && players(mode).includes(e.side)) perfect.push({side: e.side, step: Math.round(e.t / m.rules.dt)});
   }
   for (const s of players(mode)) {
    const c = m.control(s);
    if (plans[s] !== null && m.t >= plans[s]) { m.press(s, 'block'); plans[s] = null; }
    else if (rng() < .02 && ready(c) && !c.shield && !(c.counterIn > 0)) m.press(s, 'dash');
   }
  }
  const presses = m.events.filter(e => players(mode).includes(e.side) && (e.type === 'block' || e.type === 'dash' && e.phase === 'charge'))
   .map(e => ({step: e.pressStep, side: e.side, action: e.type}));
  return {presses, perfect};
 } finally { m.free(); }
}

// The same fight replayed up to `at`: is 反打 lit for `side` there, and does a 冲 pressed then land while countering? A blow
// at step s+1 is a counter exactly when counterIn > 0 at s (countering(): the window still open, the foe still stunned).
async function pressAt(mode, seed, presses, side, at) {
 const m = await createV3Match(setup(mode, seed, presses.filter(p => p.step < at)));
 try {
  while (!m.done && m.step < at - 1) m.advance();
  const c = m.control(side);
  if (!ready(c) || !(c.counterIn + 1e-9 >= LIT)) return {lit: false};
  m.press(side, 'dash');
  for (let n = 0; n < 240 && !m.done; n++) {
   const open = m.control(side).counterIn > 0, from = m.events.length;
   m.advance();
   if (m.events.slice(from).some(e => e.attacker === side && e.dash && e.damage > 0)) return {lit: true, counter: open};
  }
  return {lit: true, counter: false};
 } finally { m.free(); }
}

const steps = s => Math.round(s * 120);
for (const mode of ['mang', 'wen', 'chang', 'pvp']) {
 test(`${mode}: a 冲 pressed while 反打 is lit lands as the counter`, async () => {
  // The first 完美 of each fight, till three fights have had one (a scripted 一机双人 can end before anyone gets one).
  let fights = 0;
  for (let seed = 41; fights < 3 && seed < 61; seed++) {
   const {presses, perfect: [hit]} = await script(mode, seed, 1);
   if (!hit) continue;
   fights++;
   const {side, step} = hit;
   // Lit from the step after the 完美 (counterIn counts from the next step) till counterIn drops under LIT.
   const first = step + 1, last = step + steps(1 - LIT);
   for (const at of [first, last]) {
    const r = await pressAt(mode, seed, presses, side, at);
    assert.ok(r.lit, `${mode} seed ${seed} side ${side}: 反打 not lit ${at - step} steps after the 完美`);
    assert.ok(r.counter, `${mode} seed ${seed} side ${side}: lit ${at - step} steps after the 完美, but no counter landed`);
   }
   assert.equal((await pressAt(mode, seed, presses, side, last + 1)).lit, false, `${mode} seed ${seed}: still lit ${last + 1 - step} steps after the 完美`);
  }
  assert.equal(fights, 3, `${mode}: only ${fights} fights with a 完美`);
 });
}

test('without a 完美, 反打 never lights', async () => {
 const m = await createV3Match(setup('mang', 7));
 try {
  for (let seen = 0; !m.done && m.t < 20; m.advance()) {
   for (; seen < m.events.length; seen++) assert.ok(!(m.events[seen].type === 'blockResult' && m.events[seen].outcome === 'perfect'));
   if (m.step % 30 === 0 && ready(m.control(0))) m.press(0, 'dash');
   assert.equal(m.control(0).counterIn, 0);
  }
 } finally { m.free(); }
});
