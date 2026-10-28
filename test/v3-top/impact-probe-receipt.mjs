// R2 的凭据（给只读复核用）：feel.mjs 那 24 局（6 对 × 4 种子），v1 和陀螺版各自
// 1) 不挂探针、挂探针各跑一次的回放 sha256（不挂的那遍在载入 impact-probe.mjs 之前跑完，World.step 还没被包）；
// 2) 每次有伤害的撞击：读数用的那一步、那段接触第一次有冲量的那一步、原读数（hit 事件里两边沿法线速度之和）和撞前读数。
//    v1 读晚了的（第一次冲量在读数那一步之前）逐条列出。
// Usage: nice -n 20 node test/v3-top/impact-probe-receipt.mjs → impact-probe-receipt.json
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {simulate} from '../../sim/index.js';
import {simulateV3} from '../../sim/v3.js';

const pairs = [['broom', 'pan-lux3d'], ['scissors', 'pillow'], ['lamp-lux3d', 'slipper'], ['pot', 'broom'], ['pillow', 'lamp'], ['slipper', 'scissors']];
const guard = x => x === 'pillow' ? 'pan-lux3d' : 'pillow';
const topDef = x => ({parts: [{item: x, mount: 'e0', orient: 'out'}, {item: guard(x), mount: 'e180', orient: 'hug'}]});
const v1Def = x => ({parts: [{item: x, mount: 'core', rot: [0, 0, 0]}]});
const games = pairs.flatMap(([a, b]) => [1, 2, 3, 4].map(seed => ({a, b, seed})));
const runs = g => ({
  v1: () => simulate({fighters: [v1Def(g.a), v1Def(g.b)], mode: 'A', seed: g.seed}),
  top: () => simulateV3({fighters: [topDef(g.a), topDef(g.b)], mode: 'A', seed: g.seed}),
});
const sha = r => createHash('sha256').update(JSON.stringify(r)).digest('hex');

// Pass 1: probe module not loaded at all.
const off = [];
for (const g of games) { const r = runs(g); off.push({v1: sha(await r.v1()), top: sha(await r.top())}); }

// Pass 2: with the probe.
const {probe} = await import('./impact-probe.mjs');
const rows = [], late = {v1: [], top: []}, totals = {v1: {hits: 0, late: 0}, top: {hits: 0, late: 0}};
for (const [n, g] of games.entries()) {
  const row = {game: n, a: g.a, b: g.b, seed: g.seed};
  for (const v of ['v1', 'top']) {
    const {result: r, steps} = await probe(runs(g)[v]);
    const dt = v === 'v1' ? 1 / 60 : r.meta.rules.dt;
    const on = sha(r);
    row[v] = {probeOff: off[n][v], probeOn: on, equal: on === off[n][v], steps: steps.length};
    for (const e of r.events.filter(e => ['hit', 'crit', 'weak'].includes(e.type) && e.role === 'attack')) {
      const readStep = Math.round(e.t / dt);
      let k = readStep - 1; // steps[] is 0-based; step n is steps[n - 1]
      if (!(steps[k]?.impulse > 0)) continue;
      while (k > 0 && steps[k - 1].impulse > 0) k--;
      const firstImpulseStep = k + 1;
      totals[v].hits++;
      if (firstImpulseStep < readStep) {
        totals[v].late++;
        late[v].push({game: n, a: g.a, b: g.b, seed: g.seed, t: +e.t.toFixed(6), readStep, firstImpulseStep, stepsLate: readStep - firstImpulseStep,
          oldReading: +(e.normalSpeeds[0] + e.normalSpeeds[1]).toFixed(4), preImpact: +steps[k].approach.toFixed(4), atReadStep: +steps[readStep - 1].approach.toFixed(4)});
      }
    }
  }
  rows.push(row);
}
const out = {
  method: {
    games: '6 item pairs × seeds 1–4, mode A (same as feel.mjs); v1 = one item at the core; top = item out at e0, pillow (pan-lux3d for pillow) hugging at e180',
    sha256: 'sha256 of JSON.stringify(replay); probeOff runs finish before impact-probe.mjs is imported (World.step unwrapped)',
    readStep: 'the physics step of the hit event (t / dt); v1 dt = 1/60, top dt = 1/120',
    firstImpulseStep: 'first step of the unbroken run of steps with solver impulse between the two fighters that ends at readStep',
    oldReading: 'hit event normalSpeeds[0] + normalSpeeds[1] (what feel.mjs used before R2)',
    preImpact: 'approach speed along the contact normal from the velocities just before firstImpulseStep (the R2 reading)',
    atReadStep: 'the same signed reading taken just before readStep, for comparison',
  },
  summary: {
    replaysEqual: rows.every(r => r.v1.equal && r.top.equal), games: rows.length,
    v1: {...totals.v1, lateOldMedian: med(late.v1.map(x => x.oldReading)), latePreImpactMedian: med(late.v1.map(x => x.preImpact))},
    top: totals.top,
  },
  late,
  rows,
};
function med(xs) { if (!xs.length) return null; const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; }
await writeFile(new URL('./impact-probe-receipt.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.summary));
