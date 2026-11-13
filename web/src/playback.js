import * as THREE from 'three';

const SLOW = 0.25;
// Decisive slow motion, centred on the decisive hit (replay seconds). At 0.25x the 0.25 s before
// the hit last ~1 s on screen and the 0.35 s after it ~1.4 s, plus ramps. The camera push starts
// earlier so it is already on the contact point when the hit lands.
export const SLOW_BEFORE = 0.25, SLOW_AFTER = 0.35, RAMP = 0.1, PUSH_LEAD = 0.45;
const HIT_STOP = {hit: 0.045, weak: 0.16, break: 0.14, ko: 0.24, parry: 0.1};
const DECISIVE_STOP = 0.3;
// A landed lunge freezes the picture a beat longer than an ordinary knock.
const DASH_STOP = 0.08;
// A lunge bounced off a shield: after its freeze, play time runs at DILATE_SCALE for DILATE_TIME real seconds, easing back.
// Like hit-stop this is play time only: live (manual), the sim is held at its small lead over what is shown, so it
// slows down with it and a press still lands on the next physics step; the replay is unchanged.
const DILATE_TIME = 0.4, DILATE_SCALE = 0.3;
// 冲挡加重 (Elara fa18a1da): a block that bounces the other top away (blockResult.deflected, Sol 661f75e1) freezes a beat
// and runs 0.1–0.15 s slow, a perfect one (caught a lunge head-on) harder. It replaces the parry's own freeze and slow
// motion when both come in the same step, so it is said once; replays without `deflected` (?feel=old) are unchanged.
const DEFLECT = {stop: 0.05, time: 0.12, scale: 0.3}, DEFLECT_PERFECT = {stop: 0.09, time: 0.15, scale: 0.2};
const CONTACT = new Set(['hit', 'weak']);

/** Time of the KO. Nothing should come after it; anything that does is ignored. */
export function stopTime(replay) {
  const e = replay.events.find(e => e.type === 'ko');
  return e ? e.t : Infinity;
}

/** The hit to slow down on: decisive.eventIndex (the hit the reason describes), else the biggest attack. */
export function decisiveAnchor(replay) {
  const stop = stopTime(replay);
  const main = replay.events[replay.decisive.eventIndex ?? -1];
  if (main && CONTACT.has(main.type) && main.t <= stop) return main;
  return replay.events.filter(e => e.t <= stop && CONTACT.has(e.type) && e.role === 'attack').sort((x, y) => y.damage - x.damage)[0] ?? null;
}

const v3 = () => new THREE.Vector3();
const q4 = () => new THREE.Quaternion();
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

/** Plays a v3 replay: interpolates the body frames, fires events once, owns slow motion and hit-stop. No physics. */
export class Playback {
  constructor(replay) {
    this.r = replay;
    this.end = replay.meta.duration;
    this.stopT = stopTime(replay);
    this.events = replay.events.filter(e => e.t <= this.stopT && e.type !== 'contact' && e.type !== 'recoil');
    this.seen = replay.events.length;
    this.decisiveEvent = decisiveAnchor(replay);
    this.slowAt = this.decisiveEvent ? this.decisiveEvent.t : null;
    this.slowEnabled = true;
    this.t = 0;
    this.cursor = 0;
    this.hold = 0;
    this.dilate = 0;
    this.dilateLen = DILATE_TIME;
    this.dilateScale = DILATE_SCALE;
    this.state = {
      fighters: replay.frames[0].fighters.map(f => ({pos: v3(), quat: q4(), vel: v3(), angularVelocity: v3(), hp: f.hp, maxHp: f.maxHp, parts: f.parts.map(p => ({alive: true, hp: p.hp, maxHp: p.maxHp}))}))
    };
    this.sample(0);
  }

  /**
   * Live match (manual mode): the sim runs just ahead of what is shown. Take the events it has produced since, and
   * once it is over its end; until then there is no end and no decisive slow motion (that comes as a replay).
   */
  sync(done) {
    const all = this.r.events;
    for (; this.seen < all.length; this.seen++) { const e = all[this.seen]; if (e.type !== 'contact' && e.type !== 'recoil') this.events.push(e); }
    if (done) { this.end = this.r.meta.duration; this.stopT = stopTime(this.r); }
  }

  /** 1 outside the decisive window, easing down to 0.25 inside it. */
  slowFactor(t) {
    if (this.slowAt === null || !this.slowEnabled) return 1;
    const a = this.slowAt - SLOW_BEFORE, b = this.slowAt + SLOW_AFTER;
    const k = Math.min(THREE.MathUtils.smoothstep(t, a - RAMP, a), 1 - THREE.MathUtils.smoothstep(t, b, b + RAMP));
    return 1 + (SLOW - 1) * k;
  }
  slowAmount(t) { return (1 - this.slowFactor(t)) / (1 - SLOW); }
  pushAmount(t) {
    if (this.slowAt === null || !this.slowEnabled) return 0;
    const a = this.slowAt - SLOW_BEFORE, b = this.slowAt + SLOW_AFTER;
    return Math.min(THREE.MathUtils.smoothstep(t, a - PUSH_LEAD, a - RAMP), 1 - THREE.MathUtils.smoothstep(t, b, b + RAMP * 3));
  }
  inDecisive(t) { return this.slowAt !== null && this.slowEnabled && t >= this.slowAt - SLOW_BEFORE - RAMP && t <= this.slowAt + SLOW_AFTER + RAMP; }
  get replayFrom() { return Math.max(0, this.slowAt - SLOW_BEFORE - PUSH_LEAD - 0.6); }
  get replayTo() { return Math.min(this.end, this.slowAt + SLOW_AFTER + RAMP + 0.35); }

  seek(t) {
    this.t = Math.max(0, Math.min(t, this.end));
    this.cursor = this.events.findIndex(e => e.t > this.t);
    if (this.cursor < 0) this.cursor = this.events.length;
    this.hold = this.dilate = 0;
    this.sample(this.t);
  }

  /** Advances by real seconds at the given base speed; fires crossed events in order. Returns replay seconds advanced. */
  advance(realDt, speed, onEvent) {
    const start = this.t;
    const events = this.events;
    let remaining = realDt;
    while (remaining > 0) {
      // A freeze may end halfway through this frame; keep the rest for motion.
      const held = Math.min(this.hold, remaining);
      this.hold -= held;
      remaining -= held;
      if (remaining <= 0) break;
      const rate = speed * this.slowFactor(this.t) * this.dilateFactor();
      let next = Math.min(this.end, this.t + remaining * rate), stop = 0, base = 0, parried = false, deflect = null;
      while (this.cursor < events.length && events[this.cursor].t <= next) {
        const e = events[this.cursor++];
        onEvent(e);
        const dashHit = CONTACT.has(e.type) && e.role === 'attack' && e.dash && !e.parry;
        if (e.type === 'parry') parried = true;
        if (e.type === 'blockResult' && e.deflected) deflect = e.perfect || deflect === DEFLECT_PERFECT ? DEFLECT_PERFECT : DEFLECT;
        base = Math.max(base, e.role === 'recoil' || e.type === 'parry' ? 0 : HIT_STOP[e.type] ?? 0, dashHit ? DASH_STOP : 0, e === this.decisiveEvent && this.slowEnabled ? DECISIVE_STOP : 0);
        // A deflect in this step stands in for the parry's freeze, whichever came first.
        stop = Math.max(base, deflect ? deflect.stop : parried ? HIT_STOP.parry : 0);
        // Both sides of one contact share a timestamp: fire them together, then freeze on that frame.
        if (stop > 0 && (this.cursor >= events.length || events[this.cursor].t > e.t)) {
          next = e.t;
          break;
        }
      }
      const moved = stop > 0 ? Math.max(0, (next - this.t) / rate) : remaining;
      if (deflect) { this.dilate = this.dilateLen = deflect.time; this.dilateScale = deflect.scale; }
      else if (parried) { this.dilate = this.dilateLen = DILATE_TIME; this.dilateScale = DILATE_SCALE; }
      else this.dilate = Math.max(0, this.dilate - moved);
      this.t = next;
      // An impact may also happen halfway through a frame: spend its remainder on the freeze.
      remaining = stop > 0 ? Math.max(0, remaining - moved) : 0;
      this.hold = stop;
    }
    this.sample(this.t);
    return this.t - start;
  }

  /** Play-time multiplier of the parry slow motion: DILATE_SCALE, easing back to 1 over its last 40 %. */
  dilateFactor() {
    if (this.dilate <= 0) return 1;
    const k = Math.min(1, this.dilate / (this.dilateLen * 0.4));
    return this.dilateScale + (1 - this.dilateScale) * (1 - k * k * (3 - 2 * k));
  }
  get slowNow() { return this.dilate > 0; }

  get done() { return this.t >= this.end && this.cursor >= this.events.length && this.hold <= 0; }

  frameIndex(t) {
    const f = this.r.frames;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  sample(t) {
    this.state.t = t; // match time, for effects that belong to one part of the match (stage.js SPIN_FAN_OPENING)
    const f = this.r.frames;
    const i = this.frameIndex(t);
    const j = Math.min(i + 1, f.length - 1);
    const A = f[i], B = f[j];
    const span = B.t - A.t;
    const k = span > 1e-9 ? Math.min(1, Math.max(0, (t - A.t) / span)) : 0;
    // HP and broken parts change only at events; show the next frame's values once its event fired.
    const lastFired = this.events[this.cursor - 1];
    const hpFrame = t + 1e-6 >= B.t || (lastFired && lastFired.t > A.t) ? B : A;
    this.state.fighters.forEach((s, n) => {
      const a = A.fighters[n], b = B.fighters[n], h = hpFrame.fighters[n];
      s.pos.fromArray(a.pos).lerp(tmpV.fromArray(b.pos), k);
      s.quat.fromArray(a.quat).slerp(tmpQ.fromArray(b.quat), k);
      if (span > 1e-9) s.vel.fromArray(b.pos).sub(tmpV.fromArray(a.pos)).divideScalar(span);
      s.angularVelocity.fromArray(a.angularVelocity).lerp(tmpV.fromArray(b.angularVelocity), k);
      s.hp = h.hp;
      h.parts.forEach((p, m) => Object.assign(s.parts[m], {alive: p.alive, hp: p.hp, maxHp: p.maxHp}));
    });
    return this.state;
  }
}
