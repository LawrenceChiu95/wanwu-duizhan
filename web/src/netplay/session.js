/**
 * 好友对撞 (docs/netplay-spec.md): each phone runs the whole match and the two send each other only their presses, each
 * tagged with the physics step it lands on. No DOM here, so the two-phone tests run it in Node (test/netplay/).
 *
 * A press of mine lands `delay` steps after the step I am on, so the other phone usually has it before it gets there.
 * Until a step's presses from the other phone are in, it is played as if they pressed nothing; when a press turns up for
 * a step already played, the match goes back to its last snapshot before that step and plays forward again (rollback).
 * The page keeps the sim about LIVE_LEAD ahead of the picture, so a rollback shorter than that is never seen.
 *
 * Wire message, both ways (sent often, each one complete, so a lost one costs nothing):
 *   {k:'in', u, p:[[step, action], …], n, a, v, h:[[step, hash], …]}
 *   u: every press of mine up to this step is in p (or there was none); p: my presses after a (the steps the other phone
 *   already has), each step's full list; n: the step I am on; a: up to which step I have all of theirs; v: how far
 *   ahead of their last n I was when it came (both phones' v together say who is ahead, whatever the delay); h: state hashes
 *   of steps whose presses both phones have (sim/v3.js hash()).
 */
export const ACTIONS = ['dash', 'block'];

export class Session {
  constructor(match, {seat, delay = 2, maxRollback = 48, hashEvery = 60, snapEvery = 4} = {}) {
    if (![0, 1].includes(seat)) throw Error('seat must be 0 or 1');
    this.m = match;
    this.seat = seat;
    this.delay = delay;
    this.maxRollback = maxRollback;
    this.hashEvery = hashEvery;
    // A snapshot every few steps, not every one: a rollback plays up to snapEvery - 1 more steps, for a quarter of the
    // garbage (a slow phone's long collections were its slowest frames).
    this.snapEvery = snapEvery;
    this.present = match.step;
    this.mine = new Map();      // step -> [action]
    this.theirs = new Map();    // step -> [action], as last told
    this.used = new Map();      // step -> what of theirs that step was played with
    this.remoteUpto = match.step;
    this.peerAck = match.step;  // they have all my presses up to here
    this.snaps = new Map([[match.step, match.snapshot()]]);
    this.hashes = new Map();
    this.theirHashes = new Map();
    this.rollbackFrom = Infinity;
    this.desync = null;
    this.lead = null;           // my step when their last message came, less the step it said they were on
    this.remoteLead = null;     // the same, as the other phone measured it
    this.stats = {rollbacks: 0, maxDepth: 0, resteps: 0, slowestMs: 0, resimMs: [], stalls: 0, sent: 0, received: 0};
    // Once before the fight, so the first real rollback is not also the first time the page ever goes back (slow).
    match.restore(this.snaps.get(match.step));
    this.log = [];              // every press both ways, for a desync report
  }

  /** Up to which step both phones' presses are known: no rollback can reach it any more. */
  get confirmed() { return Math.min(this.present, this.remoteUpto); }
  /** The match is over and nothing still to come from the other phone can change that. */
  get finished() { return this.m.done && this.present <= this.remoteUpto; }

  /** My press now: it lands `delay` steps on. Returns that step. */
  press(action) {
    if (!ACTIONS.includes(action)) throw Error(`bad action ${action}`);
    const step = this.present + this.delay;
    this.mine.set(step, [...this.mine.get(step) ?? [], action]);
    this.log.push([step, this.seat, action]);
    return step;
  }

  outgoing() {
    const p = [];
    for (const [step, actions] of [...this.mine].sort((x, y) => x[0] - y[0])) if (step > this.peerAck) for (const a of actions) p.push([step, a]);
    const h = [...this.hashes].filter(([s]) => s <= this.confirmed && s < this.rollbackFrom).slice(-4);
    this.stats.sent++;
    return {k: 'in', u: this.present + this.delay - 1, p, n: this.present, a: this.remoteUpto, v: this.lead ?? 0, h};
  }

  receive(msg) {
    if (msg?.k !== 'in' || !Number.isInteger(msg.u) || !Array.isArray(msg.p)) return;
    this.stats.received++;
    if (Number.isInteger(msg.a) && msg.a > this.peerAck) {
      this.peerAck = msg.a;
      for (const s of this.mine.keys()) if (s <= this.peerAck && s < this.present - this.maxRollback) this.mine.delete(s);
    }
    const told = new Map();
    for (const [step, action] of msg.p) {
      if (!Number.isInteger(step) || !ACTIONS.includes(action) || step <= this.remoteUpto) continue;
      told.set(step, [...told.get(step) ?? [], action]);
    }
    for (const [step, actions] of told) {
      const before = key(this.theirs.get(step));
      if (before === key(actions)) continue;
      this.theirs.set(step, actions);
      for (const a of actions) this.log.push([step, 1 - this.seat, a]);
      if (step <= this.present && key(actions) !== this.used.get(step)) this.rollbackFrom = Math.min(this.rollbackFrom, step);
    }
    if (msg.u > this.remoteUpto) {
      // Steps up to u with nothing in p had no press: if one was played with a press told earlier and since taken back
      // (never: a step's list only grows), it would show here too.
      for (let s = this.remoteUpto + 1; s <= Math.min(msg.u, this.present); s++)
        if (!told.has(s) && this.used.has(s) && this.used.get(s) !== key(this.theirs.get(s))) this.rollbackFrom = Math.min(this.rollbackFrom, s);
      this.remoteUpto = msg.u;
    }
    if (Number.isInteger(msg.n)) this.lead = this.present - msg.n;
    if (Number.isFinite(msg.v)) this.remoteLead = msg.v;
    for (const [s, h] of msg.h ?? []) this.theirHashes.set(s, h);
    this.check();
  }

  /**
   * Steps I am ahead of the other phone (negative: behind). Each phone's lead over the other's last message counts the
   * time that message took too; half the difference of the two leads leaves only how far apart the two are.
   */
  get advantage() { return this.lead === null || this.remoteLead === null ? 0 : (this.lead - this.remoteLead) / 2; }
  /** Steps a message takes from one phone to the other, the same way: half the two leads' sum (whoever is ahead). */
  get oneWay() { return this.lead === null || this.remoteLead === null ? 0 : Math.max(0, (this.lead + this.remoteLead) / 2); }

  check() {
    for (const [s, h] of this.theirHashes) {
      // A step a late press has just changed is checked once it is played again (tick), not with the state it had.
      if (s > this.confirmed || s >= this.rollbackFrom) continue;
      this.theirHashes.delete(s);
      const mine = this.hashes.get(s);
      if (mine !== undefined && mine !== h && !this.desync) this.desync = {step: s, mine, theirs: h};
    }
    for (const s of this.hashes.keys()) if (s < this.confirmed - this.hashEvery * 8) this.hashes.delete(s);
  }

  step() {
    const s = this.m.step + 1, m = this.m;
    for (const a of this.mine.get(s) ?? []) m.press(this.seat, a);
    const theirs = this.theirs.get(s);
    for (const a of theirs ?? []) m.press(1 - this.seat, a);
    this.used.set(s, key(theirs));
    m.advance();
    if (s % this.hashEvery === 0 || m.done) this.hashes.set(s, m.hash());
    if (!m.done && s % this.snapEvery === 0) this.snaps.set(s, m.snapshot());
  }

  /**
   * Play forward to `target` (the step the picture wants the sim on), going back first if a late press asks for it.
   * Never more than maxRollback past the other phone's last known step: past that it waits (stalled).
   * Returns {rolledTo, t, depth} when it went back (the page drops what it had from after match time t), else {}.
   */
  tick(target) {
    const out = {};
    const t0 = globalThis.performance?.now() ?? Date.now();
    if (this.rollbackFrom <= this.present) {
      let back = this.rollbackFrom - 1;
      while (back > 0 && !this.snaps.has(back)) back--;
      const snap = this.snaps.get(back);
      if (!snap) throw Error(`no snapshot at or before step ${this.rollbackFrom - 1} (present ${this.present}, other phone up to ${this.remoteUpto})`);
      this.m.restore(snap);
      out.t = this.m.t;
      const depth = this.present - back;
      while (this.m.step < this.present && !this.m.done) { this.step(); this.stats.resteps++; }
      this.present = this.m.step;
      // Only the going back and playing again (Sol 6dac35bc): what the frame plays on from there is not a rollback's.
      const ms = (globalThis.performance?.now() ?? Date.now()) - t0;
      this.stats.slowestMs = Math.max(this.stats.slowestMs, ms);
      if (this.stats.resimMs.length < 400) this.stats.resimMs.push(+ms.toFixed(1));
      this.stats.rollbacks++;
      this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);
      out.rolledTo = back;
      out.depth = depth;
    }
    this.rollbackFrom = Infinity;
    const limit = this.remoteUpto + this.maxRollback;
    if (target > limit && !this.m.done) { this.stats.stalls++; out.stalled = true; }
    while (!this.m.done && this.present < Math.min(target, limit)) { this.step(); this.present = this.m.step; }
    // A late press is never for a step at or before remoteUpto, so the last snapshot there is the oldest one needed.
    let floor = Math.min(this.remoteUpto, this.present);
    while (floor > 0 && !this.snaps.has(floor)) floor--;
    for (const s of this.snaps.keys()) if (s < floor) this.snaps.delete(s);
    for (const s of this.used.keys()) if (s < Math.min(this.remoteUpto, this.present)) this.used.delete(s);
    this.check();
    return out;
  }

  /** What a desync report needs (sent to the room service, which keeps it). */
  report() { return {seat: this.seat, present: this.present, remoteUpto: this.remoteUpto, desync: this.desync, presses: this.log, hashes: [...this.hashes]}; }
}

const key = actions => actions?.length ? actions.join() : '';
