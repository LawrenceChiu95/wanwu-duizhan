import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createV3Match, COUNTER_CUE_LIT as LIT, MATERIAL_JUDGE_COMBAT_OPTIONS as solo, PVP_COMBAT_OPTIONS as pvpRules} from '../../sim/v3.js';
import {random} from '../../sim/math.js';

// 反打 (Elara b32bfd9a ①): after a 完美 the 冲 button lights up as 「反打」 while 冲 is ready, control().counterIn >=
// COUNTER_CUE_LIT and control().counterLands, and a 冲 pressed while it is lit must land as the counter (Elara 66cd3fe0:
// every lit step, so the last one too). Scripted players block a reaction after each cue; after a 完美 the light is read
// step by step with nothing pressed, then the 冲 goes in at the first and the last lit step, on the three stages and in
// 一机双人, with the stock builds, random ones (out and hug) and Sol's 长臂猿 fights that lit too long (0fe8da0c).
// A wider sweep (40 random fights a mode): /private/tmp/claude-501/counter/sweep.mjs, numbers in #131.
const {foes, judgeBuilds} = JSON.parse(readFileSync(new URL('../../data/foes.json', import.meta.url)));
const build = (parts, spread = 'e180') => ({parts: parts.map((p, i) => ({...p, mount: i ? spread : 'e0'}))});
const P1 = build([{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}]);
const P2 = build([{item: 'fanshuo-plate', orient: 'out'}, {item: 'fanshuo-roller', orient: 'hug'}]);
const ITEMS = ['knife', 'pot', 'cushion', 'mouse', 'plate', 'shaver', 'chair', 'roller', 'camera', 'feather', 'rabbit', 'cup'].map(i => `fanshuo-${i}`);
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const randomBuild = rng => {
 const first = pick(rng, ITEMS);
 return build([{item: first, orient: pick(rng, ['out', 'hug'])}, {item: pick(rng, ITEMS.filter(i => i !== first)), orient: pick(rng, ['out', 'hug'])}], pick(rng, ['e90', 'e180', 'e270']));
};
const foeBuild = mode => { const t = judgeBuilds.position[mode]; return build(t.parts, t.spread); };
function setup(mode, seed, fighters, inputs = []) {
 if (mode === 'pvp') return {...pvpRules, seed, fighters, manual: {sides: ['input', 'input'], inputs}};
 const foe = foes.find(f => f.id === mode), tuned = judgeBuilds.position[mode];
 return {...solo, seed, fighters, combatRules: {...solo.combatRules, ceramicShards: true},
  manual: {sides: ['input', 'ai'], aiProfiles: [null, {...foe.ai, ...tuned.ai, ...tuned.impactAi}], inputs}};
}
const players = mode => mode === 'pvp' ? [0, 1] : [0];
// 冲 would be taken at the next step (main.js press(): a 完美 readies it for that step).
const ready = c => c.dashIn <= 1 / 120 + 1e-9 && !c.charging && !c.dashing && !(c.stunIn > 0);
// main.js updateSidePad().
const lit = c => ready(c) && c.counterIn + 1e-9 >= LIT && c.counterLands;

// The scripted fight up to its first 完美: the presses it took and the 完美 (side, step).
async function script(mode, seed, fighters) {
 const m = await createV3Match(setup(mode, seed, fighters)), rng = random(seed ^ 0x5eed), plans = [null, null];
 let perfect = null;
 try {
  for (let seen = 0; !m.done && !perfect && m.t < 90; m.advance()) {
   for (; seen < m.events.length; seen++) {
    const e = m.events[seen];
    if (e.type === 'dashCue' && players(mode).includes(1 - e.side)) plans[1 - e.side] = m.t + .25 + rng() * .3;
    if (e.type === 'blockResult' && e.outcome === 'perfect' && e.deflected && players(mode).includes(e.side)) perfect = {side: e.side, step: Math.round(e.t / m.rules.dt)};
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

// The steps a 冲 would be taken at while 反打 is lit after the 完美 at `step`, nothing pressed after it: main.js keeps it
// off once it has gone off, so the first run of them.
async function litSteps(mode, seed, fighters, presses, side, step) {
 const m = await createV3Match(setup(mode, seed, fighters, presses.filter(p => p.step <= step)));
 try {
  while (!m.done && m.step < step) m.advance();
  const on = [];
  for (let n = 0; n < 125 && !m.done; n++, m.advance()) {
   if (lit(m.control(side))) on.push(m.step + 1);
   else if (on.length) break;
  }
  return on;
 } finally { m.free(); }
}

// The same fight replayed up to `at` with a 冲 pressed for `side` then: does it land while countering? A blow at step s+1
// is a counter exactly when counterIn > 0 at s (countering(): the window still open, the foe still stunned).
async function pressAt(mode, seed, fighters, presses, side, at) {
 const m = await createV3Match(setup(mode, seed, fighters, presses.filter(p => p.step < at)));
 try {
  while (!m.done && m.step < at - 1) m.advance();
  m.press(side, 'dash');
  for (let n = 0; n < 240 && !m.done; n++) {
   const open = m.control(side).counterIn > 0, from = m.events.length;
   m.advance();
   if (m.events.slice(from).some(e => e.attacker === side && e.dash && e.damage > 0)) return open;
  }
  return false;
 } finally { m.free(); }
}

async function check(mode, seed, fighters, presses, {side, step}) {
 const on = await litSteps(mode, seed, fighters, presses, side, step), where = `${mode} seed ${seed} side ${side}`;
 assert.ok(on.length > 0, `${where}: 反打 never lit after the 完美`);
 for (const at of [on[0], on.at(-1)]) assert.ok(await pressAt(mode, seed, fighters, presses, side, at), `${where}: lit ${at - step} steps after the 完美, but no counter landed`);
 return on;
}

for (const mode of ['mang', 'wen', 'chang', 'pvp']) {
 test(`${mode}: a 冲 pressed while 反打 is lit lands as the counter`, async () => {
  // The stock builds' first 完美, then two random builds', till each has had one (a scripted 一机双人 can end without).
  const rng = random(mode.length * 977);
  for (const [want, builds] of [[3, () => [P1, P2]], [2, () => [randomBuild(rng), mode === 'pvp' ? randomBuild(rng) : null]]]) {
   let fights = 0;
   for (let seed = 41; fights < want && seed < 71; seed++) {
    const [mine, theirs] = builds(), fighters = mode === 'pvp' ? [mine, theirs] : [mine, foeBuild(mode)];
    const {presses, perfect} = await script(mode, seed, fighters);
    if (!perfect) continue;
    fights++;
    await check(mode, seed, fighters, presses, perfect);
   }
   assert.equal(fights, want, `${mode}: only ${fights} fights with a 完美`);
  }
 });
}

// Sol 0fe8da0c: 长臂猿, the player on a chair out and a feather duster hugged at 90°; the 冲 Sol pressed 35 steps after
// the 完美 (0.71 s left, lit by counterIn alone) flew short. Now 反打 is off by then, and its last lit step lands.
const SOL = {fighters: [build([{item: 'fanshuo-chair', orient: 'out'}, {item: 'fanshuo-feather', orient: 'hug'}], 'e90'), foeBuild('chang')], fights: [
 {seed: 155, perfect: 3393, presses: '15d,357b,805d,822b,958d,1335b,1539d,1916b,2106d,2472b,2723d,2932b,3300d,3373b'},
 {seed: 157, perfect: 3072, presses: '38d,290b,764d,835b,1317d,1536b,1719d,1909b,2106d,2495b,2707d,3071b'}]};
for (const {seed, perfect, presses} of SOL.fights) {
 test(`chang seed ${seed} (Sol 0fe8da0c): 反打 is off before the 冲 that flew short`, async () => {
  const inputs = presses.split(',').map(p => ({step: +p.slice(0, -1), side: 0, action: p.at(-1) === 'd' ? 'dash' : 'block'}));
  const on = await check('chang', seed, SOL.fighters, inputs, {side: 0, step: perfect});
  assert.ok(on.at(-1) < perfect + 35, `chang seed ${seed}: still lit 35 steps after the 完美`);
  assert.equal(await pressAt('chang', seed, SOL.fighters, inputs, 0, perfect + 35), false, `chang seed ${seed}: the 冲 at 35 steps now lands`);
 });
}

test('without a 完美, 反打 never lights', async () => {
 const m = await createV3Match(setup('mang', 7, [P1, foeBuild('mang')]));
 try {
  for (let seen = 0; !m.done && m.t < 20; m.advance()) {
   for (; seen < m.events.length; seen++) assert.ok(!(m.events[seen].type === 'blockResult' && m.events[seen].outcome === 'perfect'));
   if (m.step % 30 === 0 && ready(m.control(0))) m.press(0, 'dash');
   assert.equal(m.control(0).counterIn, 0);
   assert.equal(m.control(0).counterLands, false);
  }
 } finally { m.free(); }
});
