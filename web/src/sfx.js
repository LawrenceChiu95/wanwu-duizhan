const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
const KEY = 'wanwu-muted';
const LEVEL = 0.8; // master gain into the limiter
const FLOOR = 1e-4; // exponential ramps start from and fall back to this instead of 0
const GAP = 0.035; // the same sound at most this often (s)...
const ALWAYS = new Set(['dashHit', 'clang', 'ko']); // ...except these, which also ignore the voice cap
const LOW = new Set(['hit', 'click']); // dropped while MAX_VOICES sounds are playing
const MAX_VOICES = 24;

/** Output chain on a context: master gain → compressor acting as a limiter → speakers, plus 1 s of shared white noise. */
function rig(ctx, level) {
  const master = ctx.createGain(), lim = ctx.createDynamicsCompressor();
  master.gain.value = level;
  lim.threshold.value = -10; lim.knee.value = 0; lim.ratio.value = 12; lim.attack.value = 0.001; lim.release.value = 0.1;
  master.connect(lim);
  lim.connect(ctx.destination);
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return {ctx, master, noise, voices: 0, last: {}};
}

/**
 * One sound starting at time t. Its layers are built with tone() and noise(); every node is disconnected together once
 * the last source has stopped, so a whole match leaks nothing.
 */
function voice(r, t) {
  const {ctx, master} = r, nodes = [], pitch = 1 + (Math.random() - 0.5) * 0.04; // ±2% so repeats are not identical
  let live = 0;
  r.voices++;
  const keep = n => { nodes.push(n); return n; };
  const ended = () => { if (--live) return; for (const n of nodes) n.disconnect(); r.voices--; };
  // Percussive envelope into the master: FLOOR → peak in att, exponential fall back to FLOOR at t0 + dur.
  const amp = (t0, dur, peak, att) => {
    const g = keep(ctx.createGain());
    g.gain.setValueAtTime(FLOOR, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + att);
    g.gain.exponentialRampToValueAtTime(FLOOR, t0 + dur);
    g.connect(master);
    return g;
  };
  const run = (src, to, t0, dur, offset) => {
    keep(src).connect(to);
    live++;
    src.onended = ended;
    src.start(t0, offset);
    src.stop(t0 + dur + 0.02);
  };
  return {
    t,
    /** Oscillator gliding f0 → f1 over `glide` s under the envelope. */
    tone(t0, dur, peak, type, f0, f1 = f0, glide = dur, att = 0.003) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * pitch, t0);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * pitch, t0 + glide);
      run(o, amp(t0, dur, peak, att), t0, dur);
    },
    /** Shared noise (from a random point) through one filter whose cutoff glides f0 → f1. Returns the filter. */
    noise(t0, dur, peak, type, f0, f1 = f0, q = 1, att = 0.002) {
      const s = ctx.createBufferSource(), f = keep(ctx.createBiquadFilter());
      s.buffer = r.noise;
      s.loop = true;
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      f.connect(amp(t0, dur, peak, att));
      run(s, f, t0, dur, Math.random() * 0.9);
      return f;
    }
  };
}

// A sharp fracture followed by a short scatter of fragments.
function crackle(v, t) {
  v.noise(t, 0.012, 0.36, 'highpass', 3400, 2200, 0.7, 0.0006);
  for (let i = 0; i < 8; i++) {
    const at = t + i * 0.022 + Math.random() * 0.012, f = 1600 + Math.random() * 3400;
    v.noise(at, 0.016 + Math.random() * 0.025, 0.28 * (1 - i / 11), 'bandpass', f, f * 0.75, 2.5, 0.001);
  }
  v.tone(t, 0.1, 0.24, 'triangle', 180, 75, 0.08, 0.001);
}

/** The sounds. Each schedules its layers on voice v from v.t on. */
const SOUNDS = {
  // Dry attack, a compact impact body and inharmonic metal modes; no long bass smear.
  hit(v, intensity = 0.5, {core = false, crit = false} = {}) {
    const k = Math.min(1, Math.max(0, Number(intensity) || 0)), t = v.t, loud = 0.12 + 0.2 * k;
    v.noise(t, 0.009 + 0.006 * k, loud * 1.2, 'highpass', 4200, 2600, 0.7, 0.0005);
    v.noise(t, 0.035 + 0.015 * k, loud * 0.85, 'bandpass', 2400 + 1500 * k, 950, 1.0, 0.0008);
    v.tone(t, 0.045 + 0.025 * k, loud * 0.55, 'triangle', 1100 + 500 * k, 480, 0.035, 0.0008);
    for (const [frequency, gain, duration] of [[1850, 0.35, 0.085], [3120, 0.23, 0.06], [4690, 0.12, 0.038]]) {
      v.tone(t, duration, loud * gain, 'sine', frequency, frequency * 0.98, duration, 0.0007);
    }
    if (core) v.tone(t, 0.085, 0.22, 'triangle', 250, 95, 0.065, 0.001);
    if (crit) { v.noise(t, 0.018, 0.2, 'highpass', 5600, 3500, 0.7, 0.0005); v.tone(t + 0.003, 0.13, 0.09, 'sine', 3800); }
  },
  // Heavy strike: fast crack, audible mid punch, brief weight and metallic splinters.
  dashHit(v) {
    const t = v.t;
    v.noise(t, 0.018, 0.5, 'highpass', 3800, 2000, 0.7, 0.0005);
    v.noise(t, 0.065, 0.36, 'bandpass', 2600, 850, 1.0, 0.0008);
    v.tone(t, 0.07, 0.23, 'sawtooth', 850, 210, 0.045, 0.001);
    v.tone(t, 0.14, 0.35, 'triangle', 320, 105, 0.1, 0.001);
    v.tone(t, 0.18, 0.28, 'sine', 110, 50, 0.13, 0.002);
    v.tone(t, 0.11, 0.14, 'sine', 2350, 2200, 0.11, 0.0007);
    v.tone(t + 0.004, 0.075, 0.09, 'sine', 4170, 3950, 0.075, 0.0007);
  },
  // Wind-up: a rising tone and a noise swell that peak at the launch, then let go quickly.
  charge(v, secs = 0.3) {
    const t = v.t, s = Math.min(2, Math.max(0.05, Number(secs) || 0.3));
    v.tone(t, s + 0.06, 0.07, 'triangle', 170, 520, s, s);
    v.noise(t, s + 0.06, 0.1, 'bandpass', 500, 3200, 3, s);
  },
  // Launch: band-passed noise sweeping up then back down, with a little air on top.
  whoosh(v) {
    const t = v.t, f = v.noise(t, 0.4, 0.3, 'bandpass', 450, 450, 1.4, 0.12);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.14);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.4);
    v.noise(t, 0.3, 0.05, 'highpass', 5000, 5000, 0.7, 0.1);
  },
  // Shield up: a small bell, a few inharmonic partials struck at once and ringing out.
  ting(v) {
    for (const [f, peak, dur] of [[1870, 0.06, 0.7], [2650, 0.04, 0.5], [3390, 0.03, 0.36], [3980, 0.02, 0.26]]) {
      v.tone(v.t, dur, peak, 'sine', f, f, dur, 0.002);
    }
  },
  // Parry: a struck metal plate (bar-like partials, each a slightly detuned pair that beats) after a sharp transient.
  clang(v) {
    for (const [ratio, peak, dur] of [[1, 0.14, 1], [2.76, 0.1, 0.7], [5.4, 0.06, 0.45], [8.9, 0.035, 0.28]]) {
      for (const detune of [1, 1.0035]) v.tone(v.t, dur, peak, 'sine', 520 * ratio * detune, 520 * ratio * detune, dur, 0.001);
    }
    v.noise(v.t, 0.05, 0.4, 'highpass', 2500);
    v.noise(v.t, 0.08, 0.2, 'bandpass', 1100, 700, 2);
  },
  // Perfect block (第 13 版): the shield bell struck harder and a fifth up, with a quick bright rise. Sits under the
  // clang when the caught blow was a lunge.
  perfect(v) {
    const t = v.t;
    for (const [f, peak, dur] of [[2490, 0.09, 0.6], [3730, 0.06, 0.45], [4980, 0.035, 0.3]]) v.tone(t, dur, peak, 'sine', f * 0.94, f, 0.04, 0.001);
    v.noise(t, 0.03, 0.12, 'highpass', 6000);
  },
  // Empty block: the bubble going out, a short muffled puff falling in pitch, no ring.
  fizzle(v) {
    const t = v.t;
    v.noise(t, 0.16, 0.12, 'lowpass', 1400, 300, 0.8, 0.004);
    v.tone(t, 0.14, 0.05, 'triangle', 420, 180, 0.12);
  },
  // A lunge that met nothing: a soft low swoosh trailing off.
  whiff(v) {
    const t = v.t, f = v.noise(t, 0.26, 0.1, 'bandpass', 900, 900, 1.2, 0.02);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.26);
  },
  crunch(v) { crackle(v, v.t); },
  // A core shattering: a long boom, the crackle, and a falling tone.
  ko(v) {
    const t = v.t;
    v.tone(t, 1.2, 0.5, 'sine', 95, 30, 0.9);
    v.tone(t, 0.45, 0.26, 'triangle', 240, 70, 0.4);
    v.noise(t, 0.6, 0.35, 'lowpass', 900, 150, 0.7);
    crackle(v, t + 0.02);
    v.tone(t + 0.08, 1.05, 0.08, 'triangle', 760, 110, 0.95, 0.02);
  },
  click(v) {
    v.tone(v.t, 0.03, 0.1, 'triangle', 2200, 1500, 0.02, 0.001);
    v.noise(v.t, 0.012, 0.07, 'highpass', 5000);
  },
  // Still cooling down: a short, quiet low buzz.
  deny(v) {
    v.tone(v.t, 0.1, 0.04, 'square', 92, 84, 0.1, 0.004);
    v.tone(v.t, 0.1, 0.03, 'square', 97, 89, 0.1, 0.004);
  }
};

function play(r, name, args) {
  try {
    const now = r.ctx.currentTime;
    if (!ALWAYS.has(name) && (now - (r.last[name] ?? -1) < GAP || LOW.has(name) && r.voices >= MAX_VOICES)) return;
    r.last[name] = now;
    SOUNDS[name](voice(r, now + 0.005), ...args);
  } catch (err) {
    console.warn('sfx', name, err);
  }
}

let R = null;
let muted = false;
try { muted = globalThis.localStorage.getItem(KEY) === '1'; } catch { /* sandboxed iframe: no storage */ }
const live = name => (...args) => { if (R && !muted && R.ctx.state === 'running') play(R, name, args); };
const tested = new WeakMap();

/**
 * Game sounds synthesized with WebAudio (no asset files). Everything is a silent no-op until unlock() has run from a
 * user gesture, and while muted; nothing here throws into the game.
 */
export const sfx = {
  unlock() {
    try {
      if (!R) { if (!AC) return; R = rig(new AC(), muted ? 0 : LEVEL); R.fresh = true; }
      const {ctx} = R;
      if (ctx.state !== 'running') Promise.resolve(ctx.resume()).catch(() => {});
      if (R.fresh || ctx.state !== 'running') {
        // iOS Safari only lets audio out once something has been started inside a gesture: one silent sample.
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.onended = () => s.disconnect();
        s.start(0);
        R.fresh = false;
      }
    } catch (err) {
      console.warn('sfx unlock', err);
    }
  },
  get muted() { return muted; },
  setMuted(on) {
    muted = Boolean(on);
    try { globalThis.localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* sandboxed iframe: no storage */ }
    try {
      if (!R) return;
      const g = R.master.gain, now = R.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(muted ? 0 : LEVEL, now, 0.015);
    } catch (err) {
      console.warn('sfx mute', err);
    }
  },
  hit: live('hit'), dashHit: live('dashHit'), charge: live('charge'), whoosh: live('whoosh'), ting: live('ting'),
  clang: live('clang'), perfect: live('perfect'), fizzle: live('fizzle'), whiff: live('whiff'), crunch: live('crunch'), ko: live('ko'), click: live('click'), deny: live('deny'),
  /** Test hook: schedule a sound now on another context (e.g. an OfflineAudioContext) through its own master chain. */
  _render(ctx, name, ...args) {
    if (!tested.has(ctx)) tested.set(ctx, rig(ctx, LEVEL));
    play(tested.get(ctx), name, args);
    return tested.get(ctx);
  }
};
