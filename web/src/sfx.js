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

// Granular crackle (~0.3 s of short band-passed bursts) over a low thud: something breaking off.
function crackle(v, t) {
  for (let i = 0; i < 8; i++) {
    const at = t + i * 0.034 + Math.random() * 0.018, f = 900 + Math.random() * 2800;
    v.noise(at, 0.02 + Math.random() * 0.03, 0.32 * (1 - i / 11), 'bandpass', f, f * 0.75, 2.5);
  }
  v.tone(t, 0.16, 0.3, 'sine', 130, 55);
}

/** The sounds. Each schedules its layers on voice v from v.t on. */
const SOUNDS = {
  // Two tops knocking: a filtered-noise click over two short plastic modes; louder, brighter and longer with intensity.
  hit(v, intensity = 0.5, {core = false, crit = false} = {}) {
    const k = Math.min(1, Math.max(0, Number(intensity) || 0)), t = v.t, len = 0.07 + 0.1 * k, loud = 0.12 + 0.26 * k;
    const f = 650 + 550 * k;
    v.noise(t, len * 0.5, loud, 'bandpass', 1800 + 2600 * k, 1200 + 1200 * k, 1.1);
    v.tone(t, len, loud * 0.7, 'triangle', f, f * 0.75);
    v.tone(t, len * 0.6, loud * 0.3, 'sine', f * 2.7);
    if (core) { v.tone(t, 0.12, 0.3, 'sine', 210, 90); v.noise(t, 0.05, 0.18, 'lowpass', 600); }
    if (crit) { v.tone(t + 0.005, 0.28, 0.08, 'sine', 3150); v.tone(t + 0.005, 0.2, 0.05, 'sine', 4870); }
  },
  // The big one: a bright crack, then a pitch drop with a sub under it and mid body that small phone speakers can still
  // play. The crack leads the thump by 12 ms so a landed 冲 reads sharp, not only heavy (a friend's 「不够爽」, via Elara);
  // no louder than the clang + 完美 of a lunge caught.
  dashHit(v) {
    const t = v.t, low = t + 0.012;
    v.noise(t, 0.022, 0.5, 'highpass', 3600, 3600, 0.7, 0.001); // the crack: a snap of high noise, a little ring, a falling tick
    v.noise(t, 0.03, 0.2, 'bandpass', 2600, 1700, 2, 0.001);
    v.tone(t, 0.03, 0.12, 'triangle', 2900, 1500, 0.025, 0.001);
    v.noise(t, 0.045, 0.25, 'highpass', 1800);
    v.tone(low, 0.42, 0.42, 'sine', 140, 45, 0.25);
    v.tone(low, 0.45, 0.3, 'sine', 58, 40, 0.3, 0.008);
    v.tone(low, 0.3, 0.22, 'sine', 280, 90, 0.25); // the drop an octave up: heard as the same pitch where the sub is lost
    v.tone(low, 0.22, 0.3, 'triangle', 360, 150, 0.2);
    v.noise(low, 0.16, 0.5, 'bandpass', 300, 170, 0.9);
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
  // 一合一分 (Elara 41cd88d6): a plain bump knocking the tops apart, a short bright 「锵」. Struck metal like the parry's clang
  // but higher, cut short and well under it, so a 冲 or a 挡 still sounds like the bigger thing.
  clank(v) {
    const t = v.t;
    for (const [f, peak, dur] of [[1180, 0.09, 0.2], [3260, 0.06, 0.14], [5070, 0.035, 0.09]]) {
      for (const detune of [1, 1.006]) v.tone(t, dur, peak, 'sine', f * detune, f * detune, dur, 0.001);
    }
    v.noise(t, 0.03, 0.26, 'highpass', 3200);
    v.noise(t, 0.05, 0.12, 'bandpass', 1500, 900, 2);
  },
  // Perfect block (第 13 版): the shield bell struck harder and a fifth up, with a quick bright rise. Sits under the
  // clang when the caught blow was a lunge.
  perfect(v) {
    const t = v.t;
    for (const [f, peak, dur] of [[2490, 0.09, 0.6], [3730, 0.06, 0.45], [4980, 0.035, 0.3]]) v.tone(t, dur, peak, 'sine', f * 0.94, f, 0.04, 0.001);
    v.noise(t, 0.03, 0.12, 'highpass', 6000);
  },
  // 挡分两档's 「press now」 with the foe's flash: one short bright tick, two quick high notes, over before its launch.
  cue(v) {
    const t = v.t;
    v.tone(t, 0.06, 0.1, 'triangle', 1760, 1760, 0.05, 0.002);
    v.tone(t + 0.07, 0.07, 0.12, 'triangle', 2350, 2350, 0.06, 0.002);
    v.noise(t, 0.02, 0.08, 'highpass', 5000);
  },
  // 反打 lit (Elara b32bfd9a): a quick rising zip into one bright note, saw and square where the 挡's sounds are bells and
  // the 冲's air. A beat late, so it is heard clear of the 完美 clang it follows.
  counter(v) {
    const t = v.t + 0.1;
    v.tone(t, 0.14, 0.08, 'sawtooth', 220, 880, 0.1, 0.004);
    v.tone(t, 0.14, 0.04, 'square', 440, 1760, 0.1, 0.004);
    v.noise(t, 0.1, 0.08, 'bandpass', 600, 3000, 1.5, 0.01);
    v.tone(t + 0.1, 0.2, 0.13, 'triangle', 1175, 1175, 0.2, 0.002);
    v.tone(t + 0.1, 0.14, 0.03, 'square', 2350, 2350, 0.14, 0.002);
  },
  // 勉强 (挡分两档): caught, but early. A dull knock, low and muffled, short, no ring: the opposite of 完美's bright bell.
  thud(v) {
    const t = v.t;
    v.tone(t, 0.16, 0.22, 'sine', 170, 95, 0.14, 0.003);
    v.noise(t, 0.09, 0.22, 'lowpass', 700, 260, 0.9, 0.002);
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
  // 陶瓷炸片: a glazed piece cracking (a bright snap, a few high inharmonic rings) as it bursts, a beat after the hit's
  // thump. Thin and high, so it sits apart from it.
  porcelain(v) {
    const t = v.t;
    v.noise(t, 0.035, 0.32, 'highpass', 3800);
    v.noise(t, 0.06, 0.16, 'bandpass', 2400, 1600, 3);
    for (const [f, peak, dur] of [[2960, 0.07, 0.3], [4410, 0.05, 0.22], [6230, 0.03, 0.16]]) v.tone(t + 0.004, dur, peak, 'sine', f, f * 0.985, dur, 0.001);
  },
  // The shards landing: a few tiny high chinks, a little spread.
  chink(v) {
    for (let i = 0; i < 5; i++) {
      const at = v.t + i * 0.03 + Math.random() * 0.02, f = 3400 + Math.random() * 2600;
      v.tone(at, 0.07, 0.045 * (1 - i / 7), 'sine', f, f, 0.07, 0.001);
    }
  },
  // A core shattering: a long boom, the crackle, and a falling tone.
  ko(v) {
    const t = v.t;
    v.tone(t, 1.2, 0.5, 'sine', 95, 30, 0.9);
    v.tone(t, 0.45, 0.26, 'triangle', 240, 70, 0.4);
    v.noise(t, 0.6, 0.35, 'lowpass', 900, 150, 0.7);
    crackle(v, t + 0.02);
    v.tone(t + 0.08, 1.05, 0.08, 'triangle', 760, 110, 0.95, 0.02);
  },
  // 一机双人's 开打！: one struck plate, a bright bell over the parry's metal, a little brighter than either.
  go(v) {
    const t = v.t;
    for (const [ratio, peak, dur] of [[1, 0.13, 0.9], [2.76, 0.08, 0.6], [5.4, 0.04, 0.36]]) {
      for (const detune of [1, 1.004]) v.tone(t, dur, peak, 'sine', 784 * ratio * detune, 784 * ratio * detune, dur, 0.001);
    }
    v.tone(t, 0.5, 0.06, 'sine', 1568 * 0.94, 1568, 0.05, 0.002);
    v.noise(t, 0.05, 0.32, 'highpass', 3000);
  },
  click(v) {
    v.tone(v.t, 0.03, 0.1, 'triangle', 2200, 1500, 0.02, 0.001);
    v.noise(v.t, 0.012, 0.07, 'highpass', 5000);
  },
  // A card turning over: a short papery swish and the soft tap of it landing; quieter (k) when a screenful turns together.
  flip(v, k = 1) {
    const t = v.t, f = v.noise(t, 0.16, 0.12 * k, 'bandpass', 1200, 1200, 1.1, 0.03);
    f.frequency.exponentialRampToValueAtTime(3800, t + 0.12);
    v.noise(t + 0.17, 0.03, 0.12 * k, 'lowpass', 1800);
    v.tone(t + 0.17, 0.06, 0.08 * k, 'triangle', 300, 180, 0.05);
  },
  // Its grade showing (Elara 11-02: the draw has to feel like something). A rising run of bell notes, more of them and
  // brighter the better the grade; an S adds a low bloom and a sparkle that rings on.
  reveal(v, grade = 'C') {
    const t = v.t, rank = Math.max(0, 'DCBAS'.indexOf(grade)), notes = [523, 659, 784, 1047, 1319].slice(0, rank + 1);
    notes.forEach((f, i) => {
      const at = t + i * 0.07, last = i === notes.length - 1, dur = last ? 0.5 + rank * 0.18 : 0.28;
      v.tone(at, dur, 0.09, 'sine', f, f, dur, 0.002);
      v.tone(at, dur * 0.7, 0.03, 'sine', f * 2.01, f * 2.01, dur, 0.002);
    });
    if (grade !== 'S') return;
    const end = t + notes.length * 0.07;
    v.tone(t, 1.1, 0.16, 'sine', 131, 131, 1.1, 0.05);
    v.tone(t, 0.9, 0.06, 'triangle', 262, 262, 0.9, 0.05);
    for (let i = 0; i < 9; i++) {
      const f = 2600 + Math.random() * 3200;
      v.tone(end + i * 0.045 + Math.random() * 0.02, 0.35, 0.025, 'sine', f, f, 0.35, 0.002);
    }
    v.noise(t, 1, 0.05, 'highpass', 7000, 7000, 0.7, 0.25);
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
// 凡朔's BGM (一机双人 第二轮 ④, both modes): fetched and decoded only once the page has been touched, so it never holds up
// the first screen. It plays once from the start, then loops the groove: MUSIC_LOOP runs from a bar where the drums are
// in to the bar before the fade (bgm.mp3 is cut there, its seam cross-faded in the file, so the jump is sample-exact and
// inaudible), and it carries on across matches. Into the master under the hits, so 静音 silences it too.
const MUSIC_LEVEL = 0.3, MUSIC_LOOP = [19.753, 176.83];
// A freeze, a slow-motion blow, the charge's 「press now」: the music drops to DUCK of itself, back over DUCK_BACK s.
const DUCK = 0.5, DUCK_BACK = 0.35;
const music = {url: null, started: false, gain: null, ducked: false};
// A page out of sight (another app, the screen off) goes quiet, music too, and picks up where it was when it is back.
globalThis.document?.addEventListener('visibilitychange', () => {
  try { if (R) Promise.resolve(document.hidden ? R.ctx.suspend() : R.ctx.resume()).catch(() => {}); } catch { /* nothing to do */ }
});
async function startMusic() {
  if (music.started || !music.url || !R) return;
  music.started = true;
  try {
    const {ctx} = R, data = await (await fetch(music.url)).arrayBuffer();
    const buf = await new Promise((res, rej) => ctx.decodeAudioData(data, res, rej));
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = MUSIC_LOOP[0];
    src.loopEnd = Math.min(MUSIC_LOOP[1], buf.duration);
    gain.gain.value = MUSIC_LEVEL;
    src.connect(gain);
    gain.connect(R.master);
    src.start();
    music.gain = gain;
    music.src = src;
  } catch (err) {
    console.warn('music', err);
  }
}
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
      startMusic();
    } catch (err) {
      console.warn('sfx unlock', err);
    }
  },
  get muted() { return muted; },
  /** The BGM's file; it starts with the first touch that unlocks sound. */
  music(url) { music.url = url; if (R?.ctx.state === 'running') startMusic(); },
  /** Hold the music down (DUCK) while `on`; let go and it comes back over DUCK_BACK s. Called every frame. */
  duck(on) {
    if (!music.gain || on === music.ducked) return;
    music.ducked = on;
    try {
      const g = music.gain.gain, now = R.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(MUSIC_LEVEL * (on ? DUCK : 1), now + (on ? 0.04 : DUCK_BACK));
    } catch (err) {
      console.warn('music duck', err);
    }
  },
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
  clang: live('clang'), clank: live('clank'), perfect: live('perfect'), thud: live('thud'), cue: live('cue'), counter: live('counter'), fizzle: live('fizzle'), whiff: live('whiff'), crunch: live('crunch'), porcelain: live('porcelain'), chink: live('chink'), ko: live('ko'), click: live('click'), deny: live('deny'),
  flip: live('flip'), reveal: live('reveal'), go: live('go'),
  /** Test hook: the BGM as it stands (null until it plays). */
  _music() { return music.gain && {level: music.gain.gain.value, ducked: music.ducked, loop: [music.src.loopStart, music.src.loopEnd], length: music.src.buffer.duration, ctx: R.ctx.state, master: R.master.gain.value}; },
  /** Test hook: schedule a sound now on another context (e.g. an OfflineAudioContext) through its own master chain. */
  _render(ctx, name, ...args) {
    if (!tested.has(ctx)) tested.set(ctx, rig(ctx, LEVEL));
    play(tested.get(ctx), name, args);
    return tested.get(ctx);
  }
};
