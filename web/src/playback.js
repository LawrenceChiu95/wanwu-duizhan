import * as THREE from 'three';

const SLOW = 0.25;
// Decisive slow motion, centred on the decisive hit (replay seconds). At 0.25x the 0.25 s before
// the hit last ~1 s on screen and the 0.3 s after it ~1.2 s, plus ramps. The camera push starts
// earlier so it is already on the contact point when the hit lands.
export const SLOW_BEFORE = 0.25, SLOW_AFTER = 0.3, RAMP = 0.1, PUSH_LEAD = 0.45;
const HIT_STOP = {hit: 0.035, crit: 0.05, weak: 0.16, ko: 0.24, ringout: 0.2, zone: 0};
const DECISIVE_STOP = 0.3;
const CONTACT = new Set(['hit', 'crit', 'weak']);

/** Time of the first KO or ring-out. Nothing should come after it; anything that does is ignored. */
export function stopTime(replay) {
  const e = replay.events.find(e => e.type === 'ko' || e.type === 'ringout');
  return e ? e.t : Infinity;
}

/**
 * The hit to slow down on: decisive.eventIndex (the hit the caption describes); if that is not a
 * contact, finishEventIndex when it is one; else the biggest attack. Ring-outs anchor on the exit.
 * Timeouts too: the sim points decisive at the match's biggest hit and the page slows it down.
 */
export function decisiveAnchor(replay) {
  const {decisive} = replay;
  const stop = stopTime(replay);
  const events = replay.events.filter(e => e.t <= stop);
  const pick = i => (i === null || i === undefined || !(replay.events[i]?.t <= stop) ? null : replay.events[i]);
  const main = pick(decisive.eventIndex);
  if (main && (CONTACT.has(main.type) || main.type === 'ringout')) return main;
  const fin = pick(decisive.finishEventIndex);
  if (fin && CONTACT.has(fin.type)) return fin;
  return events.filter(e => CONTACT.has(e.type) && e.role !== 'recoil').sort((x, y) => y.damage - x.damage)[0] ?? null;
}

const v3 = () => new THREE.Vector3();
const q4 = () => new THREE.Quaternion();

/** Plays a Replay: interpolates frames, fires events once, owns slow motion and hit-stop. No physics. */
export class Playback {
  constructor(replay) {
    this.r = replay;
    this.end = replay.meta.duration;
    // Events after the KO / ring-out are dropped, and HP stays at what the KO frame recorded.
    this.stopT = stopTime(replay);
    this.events = replay.events.filter(e => e.t <= this.stopT);
    this.stopFrame = Number.isFinite(this.stopT) ? replay.frames.find(f => f.t >= this.stopT - 1e-6) ?? null : null;
    this.decisiveEvent = decisiveAnchor(replay);
    this.slowAt = this.decisiveEvent ? this.decisiveEvent.t : null;
    this.slowEnabled = true;
    this.t = 0;
    this.cursor = 0;
    this.hold = 0;
    this.state = {
      zoneRadius: 0,
      fighters: replay.frames[0].fighters.map(f => ({pos: v3(), quat: q4(), hp: f.hp, maxHp: f.maxHp, vel: v3(), parts: f.parts.map(() => ({pos: v3(), quat: q4()}))}))
    };
    this.sample(0);
  }

  /** 1 outside the decisive window, easing down to 0.25 inside it. */
  slowFactor(t) {
    if (this.slowAt === null || !this.slowEnabled) return 1;
    const a = this.slowAt - SLOW_BEFORE, b = this.slowAt + SLOW_AFTER;
    const k = Math.min(THREE.MathUtils.smoothstep(t, a - RAMP, a), 1 - THREE.MathUtils.smoothstep(t, b, b + RAMP));
    return 1 + (SLOW - 1) * k;
  }
  /** 0..1 how deep into the decisive moment we are (caption, slow tag). */
  slowAmount(t) { return (1 - this.slowFactor(t)) / (1 - SLOW); }
  /** 0..1 camera push toward the contact point; leads the slow motion so the shot is set before the hit. */
  pushAmount(t) {
    if (this.slowAt === null || !this.slowEnabled) return 0;
    const a = this.slowAt - SLOW_BEFORE, b = this.slowAt + SLOW_AFTER;
    return Math.min(THREE.MathUtils.smoothstep(t, a - PUSH_LEAD, a - RAMP), 1 - THREE.MathUtils.smoothstep(t, b, b + RAMP * 3));
  }
  inDecisive(t) { return this.slowAt !== null && this.slowEnabled && t >= this.slowAt - SLOW_BEFORE - RAMP && t <= this.slowAt + SLOW_AFTER + RAMP; }
  /** Where a replay of the decisive moment starts and stops. */
  get replayFrom() { return Math.max(0, this.slowAt - SLOW_BEFORE - PUSH_LEAD - 0.35); }
  get replayTo() { return Math.min(this.end, this.slowAt + SLOW_AFTER + RAMP + 0.35); }

  seek(t) {
    this.t = Math.max(0, Math.min(t, this.end));
    this.cursor = this.events.findIndex(e => e.t > this.t);
    if (this.cursor < 0) this.cursor = this.events.length;
    this.hold = 0;
    this.sample(this.t);
  }

  /**
   * Advances by real seconds at the given base speed. Returns the replay seconds advanced
   * and the events crossed, in order.
   */
  advance(realDt, speed, onEvent) {
    if (this.hold > 0) {
      this.hold -= realDt;
      return 0;
    }
    const start = this.t;
    const dt = realDt * speed * this.slowFactor(this.t);
    let next = Math.min(this.end, this.t + dt);
    const events = this.events;
    let stop = 0;
    while (this.cursor < events.length && events[this.cursor].t <= next) {
      const e = events[this.cursor++];
      onEvent(e, this.cursor - 1);
      stop = Math.max(stop, e.role === 'recoil' ? 0 : HIT_STOP[e.type] ?? 0, e === this.decisiveEvent && this.slowEnabled ? DECISIVE_STOP : 0);
      // Both sides of one contact share a timestamp: fire them together, then freeze on that frame.
      if (stop > 0 && (this.cursor >= events.length || events[this.cursor].t > e.t)) {
        next = e.t;
        this.hold = stop;
        break;
      }
    }
    this.t = next;
    this.sample(this.t);
    return this.t - start;
  }

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
    const f = this.r.frames;
    const i = this.frameIndex(t);
    const j = Math.min(i + 1, f.length - 1);
    const A = f[i], B = f[j];
    const span = B.t - A.t;
    const k = span > 1e-9 ? Math.min(1, Math.max(0, (t - A.t) / span)) : 0;
    this.state.zoneRadius = A.zoneRadius + (B.zoneRadius - A.zoneRadius) * k;
    // HP changes only at events; show the value the next frame records once its event fired.
    const lastFired = this.events[this.cursor - 1];
    let hpFrame = t + 1e-6 >= B.t || (lastFired && lastFired.t > A.t) ? B : A;
    if (this.stopFrame && hpFrame.t > this.stopFrame.t) hpFrame = this.stopFrame;
    this.state.fighters.forEach((s, n) => {
      const a = A.fighters[n], b = B.fighters[n];
      s.pos.fromArray(a.pos).lerp(tmpV.fromArray(b.pos), k);
      s.quat.fromArray(a.quat).slerp(tmpQ.fromArray(b.quat), k);
      if (span > 1e-9) s.vel.fromArray(b.pos).sub(tmpV.fromArray(a.pos)).divideScalar(span);
      s.hp = hpFrame.fighters[n].hp;
      s.parts.forEach((p, m) => {
        p.pos.fromArray(a.parts[m].pos).lerp(tmpV.fromArray(b.parts[m].pos), k);
        p.quat.fromArray(a.parts[m].quat).slerp(tmpQ.fromArray(b.parts[m].quat), k);
      });
    });
    return this.state;
  }
}

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
