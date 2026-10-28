// 撞击力度的统一量法（R2）：两个 sim 都不改，从外面看 Rapier 每一步。
// 每次 world.step 之前记下两台的线速度、角速度、质心；之后看两台之间这一步有没有解算冲量。
// 一段接触（连续有冲量的步）的第一步，用「这一步之前」的速度算接触点沿法线的迎击速度＝撞前迎击速度。
// v1 和陀螺版用同一套读法，不再用各自 hit 事件里的读数（v1 常在冲量已经吃掉一步之后才读）。
// The very module instance the sims use (same resolved file), so patching its World reaches their worlds.
import RAPIER from '../../sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import {add, sub, rotate} from '../../sim/math.js';
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const arr = v => [v.x, v.y, v.z], qarr = q => [q.x, q.y, q.z, q.w];
let current = null;
const step = RAPIER.World.prototype.step;
RAPIER.World.prototype.step = function (...args) {
  if (!current) return step.apply(this, args);
  // The two fighters are the only dynamic bodies; the first created is the left side (index 0).
  const bodies = [];
  this.forEachRigidBody(b => { if (b.isDynamic()) bodies.push(b); });
  bodies.sort((a, b) => a.handle - b.handle);
  const before = bodies.map(b => ({v: arr(b.linvel()), w: arr(b.angvel()), c: arr(b.worldCom())}));
  const out = step.apply(this, args);
  const sides = bodies.map(() => []);
  this.forEachCollider(c => { const i = bodies.findIndex(b => b.handle === c.parent()?.handle); if (i >= 0) sides[i].push(c); });
  let impulse = 0, best = -1, point = null, rightPoint = null, normal = null;
  if (bodies.length === 2) for (const a of sides[0]) for (const b of sides[1]) this.contactPair(a, b, (m, flipped) => {
    for (let k = 0; k < m.numContacts(); k++) {
      const j = m.contactImpulse(k);
      if (!(j > 0)) continue;
      impulse += j;
      if (j > best) {
        best = j;
        const n = arr(m.normal());
        normal = flipped ? n.map(x => -x) : n;
        const p = flipped ? m.localContactPoint2(k) : m.localContactPoint1(k), q = flipped ? m.localContactPoint1(k) : m.localContactPoint2(k);
        point = p && add(arr(a.translation()), rotate(qarr(a.rotation()), arr(p)));
        rightPoint = q && add(arr(b.translation()), rotate(qarr(b.rotation()), arr(q)));
      }
    }
  });
  let approach = null;
  if (impulse > 0 && point && rightPoint && normal) {
    const at = (s, p) => add(s.v, cross(s.w, sub(p, s.c)));
    approach = dot(sub(at(before[0], point), at(before[1], rightPoint)), normal);
  }
  current.push({impulse, approach});
  return out;
};

/** Runs `run()` and returns its result plus one record per physics step: {impulse, approach} (approach from the pre-step velocities). */
export async function probe(run) {
  const steps = [];
  current = steps;
  try { return {result: await run(), steps}; } finally { current = null; }
}

/**
 * For each damaging blow (attacker's hit event) at time t: the contact run that ends at that step, its first step,
 * and the approach speed there (before any solver impulse of this run). A blow whose run began more than `fresh`
 * seconds earlier is a rub, not an impact, and is left out (counted).
 */
export function impactSpeeds(replay, steps, dt, fresh = 0.1) {
  const hits = replay.events.filter(e => ['hit', 'crit', 'weak'].includes(e.type) && e.role === 'attack');
  const out = [];
  let rubs = 0;
  for (const e of hits) {
    let k = Math.round(e.t / dt) - 1; // steps[] is 0-based; step n runs at t = n·dt
    if (!steps[k] || !(steps[k].impulse > 0)) { rubs++; continue; }
    while (k > 0 && steps[k - 1].impulse > 0) k--;
    if (e.t - (k + 1) * dt > fresh + 1e-9) { rubs++; continue; }
    out.push({t: e.t, start: (k + 1) * dt, approach: steps[k].approach});
  }
  return {impacts: out, rubs};
}
