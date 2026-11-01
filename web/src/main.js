import * as THREE from 'three';
import {loadCatalog} from '../../sim/index.js';
import {simulateV3, createV3Match, loadV3Rules, mountExtents} from '../../sim/v3.js';
import creditsMd from '../../data/CREDITS.md?raw';
import {loadModels, turntable, pictureUrl} from './models.js';
import {Stage, TEAM, CORE_TRAVEL, CORE_RISE, CAM} from './stage.js';
import {Playback} from './playback.js';
import {Overlay} from './overlay.js';
import {reasonLine, endLine, matchStats, pickStats, tipLine, NAMES, setNames, wholeSeconds} from './reason.js';
import {sfx} from './sfx.js';

const $ = id => document.getElementById(id);
const el = {
  app: $('app'), canvas: $('view'), fx: $('fx'), flash: $('flash'), banner: $('banner'),
  caption: $('caption'), captionText: $('captionText'), slowtag: $('slowtag'), clock: $('clock'),
  hud: $('hud'), foe: $('foe'), foeParts: $('foeParts'), build: $('build'), go: $('goBtn'),
  result: $('result'), resultMeta: $('resultMeta'), winnerLine: $('winnerLine'), whyLine: $('whyLine'), statsList: $('statsList'), tipLine: $('tipLine'),
  library: $('library'), libGrid: $('libGrid'), libTitle: $('libTitle'), libCount: $('libCount'),
  how: $('howView'), howTitle: $('howTitle'), howShot: $('howShot'), howTurn: $('howTurn'), howCat: $('howCat'), howNow: $('howNow'),
  howBar: $('howBar'), howSteps: $('howSteps'), howTotal: $('howTotal'), howEquip: $('howEquip'),
  credits: $('credits'), creditsBody: $('creditsBody'), busy: $('busy'), busyText: $('busyText'), error: $('error'),
  coach: $('coach'), coachTag: $('coachTag'), coachText: $('coachText'),
  pad: $('pad'), dashBtn: $('dashBtn'), blockBtn: $('blockBtn'), mute: $('muteBtn'), camSeg: $('camSeg')
};
// Manual mode: the sim runs live this far ahead of what is shown (a press is taken at the next physics step).
const LIVE_LEAD = 0.05;
// The original six keep this order (pot and lamp are the textured Lux3D generations); other catalog items follow.
const ORDER = ['pan-lux3d', 'broom', 'lamp-lux3d', 'scissors', 'slipper', 'pillow'];
// Everything in the catalog except the drafts a comparisonBase replaces.
const offerOf = items => {
  const replaced = new Set(items.map(i => i.comparisonBase).filter(Boolean));
  const rank = id => ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length;
  return items.map(i => i.id).filter(id => !replaced.has(id)).sort((a, b) => rank(a) - rank(b));
};
// The computer's default build; ?foe= can override it for measurements.
const DEFAULT_FOE = {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'lamp-lux3d', orient: 'hug'}], spread: 'e180'};
const DEFAULT = {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'pillow', orient: 'hug'}], spread: 'e180'};
const PREVIEW_SPIN = 2.4;
const RESULT_SPIN = 1.2;
const HEX = TEAM.map(c => '#' + c.getHexString());
const WHITE = new THREE.Color('#ffffff'), HOT = new THREE.Color('#ffe14d'), SPARK = new THREE.Color('#ffd27a'), BLOCK = new THREE.Color('#b8f0ff');
const ICON = {
  out: '<svg class="ico" viewBox="0 0 24 24"><circle cx="6" cy="12" r="3.2" /><path d="M9.5 12H21" /><path d="M17 8.5l4 3.5-4 3.5" /></svg>',
  hug: '<svg class="ico" viewBox="0 0 24 24"><circle cx="10" cy="12" r="4" /><path d="M16.5 5.5a9 9 0 0 1 0 13" /></svg>'
};

function showError(err) {
  el.error.hidden = false;
  el.error.textContent = `出错了：${err?.message ?? err}`;
  console.error(err);
}
addEventListener('error', e => showError(e.error ?? e.message));
addEventListener('unhandledrejection', e => showError(e.reason));
// Sound starts on the first touch or key (browsers only allow audio after a user gesture).
for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) addEventListener(type, () => sfx.unlock(), {capture: true, passive: true});
// Short buzzes on the big moments where the phone supports it (iOS ignores this).
const buzz = pattern => { try { if (!sfx.muted) navigator.vibrate?.(pattern); } catch { /* not allowed */ } };

const isLux = id => id.endsWith('-lux3d');
// Text and attribute values alike (names will come from outside once 拍一件 is live: quotes must not end an attribute).
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const toDef = b => ({parts: [{item: b.parts[0].item, mount: 'e0', orient: b.parts[0].orient}, {item: b.parts[1].item, mount: b.spread, orient: b.parts[1].orient}]});
// R7 (伸出攻、贴着守): 伸出 hits harder and breaks sooner; 贴着 takes blows for the core and hits softer.
const HINT = {out: '攻：撞人更疼，自己易碎', hug: '守：替核心挡，少掉血'};
const randomSeed = () => 1 + Math.floor(Math.random() * 9999);

function renderCredits(items) {
  const link = s => s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const html = [];
  let list = false, tableHead = false;
  const close = () => { if (list) html.push('</ul>'); list = false; };
  for (const line of creditsMd.split('\n')) {
    const l = line.trim();
    if (/^\|/.test(l)) {
      if (/^\|[\s|:-]+\|$/.test(l)) continue;
      if (!list) { html.push('<ul>'); list = true; tableHead = true; }
      if (tableHead) { tableHead = false; continue; }
      html.push(`<li>${l.split('|').slice(1, -1).map(c => link(esc(c.trim()))).join(' · ')}</li>`);
      continue;
    }
    close();
    if (/^# /.test(l) || !l) continue;
    if (/^##+ /.test(l)) html.push(`<h4>${esc(l.replace(/^#+ /, ''))}</h4>`);
    else html.push(`<p>${link(esc(l))}</p>`);
  }
  close();
  el.creditsBody.innerHTML = html.join('');
}

async function main() {
  el.busy.hidden = false;
  const [items, rules] = await Promise.all([loadCatalog(), loadV3Rules()]);
  const byId = new Map(items.map(i => [i.id, i]));
  setNames(items);
  const OFFER = offerOf(items);
  const spec = id => { const it = byId.get(id); return `${Math.round(Math.max(...it.bounds.max.map((v, i) => v - it.bounds.min[i])) * 100)} cm · ${it.mass} kg`; };
  const layout = def => def.parts.map(p => ({item: p.item, orient: p.orient, ...mountExtents(byId.get(p.item), p.mount, p.orient, rules)}));
  const sweepOf = def => Math.max(rules.core.radius, ...layout(def).map(p => p.r1));
  const stage = new Stage(el.canvas, {items, coreRadius: rules.core.radius, layout});
  const overlay = new Overlay(stage, el);
  renderCredits(items);

  const q = new URLSearchParams(location.search);
  const mode = q.get('mode') === 'B' ? 'B' : 'A';
  const fromUrl = (key = 'mine') => {
    if (!q.has(key)) return null;
    const p = q.get(key).split(',');
    const b = {parts: [{item: p[0], orient: p[1]}, {item: p[2], orient: p[3]}], spread: p[4]};
    if (p.length === 5 && b.parts.every(x => OFFER.includes(x.item) && ['out', 'hug'].includes(x.orient)) && b.parts[0].item !== b.parts[1].item && ['e180', 'e90'].includes(b.spread) && (key !== 'foe' || q.getAll(key).length === 1)) return b;
    if (key === 'foe') {
      el.busy.hidden = true;
      throw Error('foe参数无效：格式为物品ID,out或hug,另一物品ID,out或hug,e180或e90；两件须是清单中不同的道具，foe只能出现一次');
    }
    return null;
  };
  const mine = structuredClone(fromUrl() ?? DEFAULT);
  const FOE = structuredClone(fromUrl('foe') ?? DEFAULT_FOE);
  let seed = Number.isInteger(Number(q.get('seed'))) && q.has('seed') ? Number(q.get('seed')) : randomSeed();
  const fixedSeed = q.has('seed');
  // Manual only on the page (远夏 10-28 e3a68f0a): you press 冲 / 挡. The auto fight stays for the test scripts (?play=auto).
  let control = q.get('play') === 'auto' ? 'auto' : 'manual', live = null;
  // Fight camera (the HUD toggle, or ?cam=): 俯视 the framing camera from above ('new'), 慢三成 yesterday's chase camera
  // turning, following and zooming 30 % slower ('slow', default), 原速 yesterday's camera as it was ('v4')
  // (远夏 10-28 2735f129: keep all three).
  // 第 13 版 hand-feel trial only (no on-page option): ?block=0.2 / 0.25 / 0.3 s block window; default is the rules' own.
  const blockTime = ['0.2', '0.25', '0.3'].includes(q.get('block')) ? Number(q.get('block')) : undefined;
  let camStyle = ['v4', 'new'].includes(q.get('cam')) ? q.get('cam') : 'slow';
  stage.setCamStyle(camStyle);
  await loadModels([...new Set([...mine.parts, ...FOE.parts].map(p => byId.get(p.item)))]);
  el.busy.hidden = true;

  // ---------- state ----------
  let phase = 'loading'; // loading | build | computing | play | finale | result | replay
  // A piece that breaks on the very frame a lunge is bounced off a shield: its 「…碎了」 comes half a second later, so the
  // bounce reads first and nobody wonders whether it was blocked (Elara 80e885bc); one still up from before is let go.
  let lastParryT = -Infinity, lateNums = [];
  let pb = null, replay = null, finaleAge = 0, finaleSim = 0, replayEnd = 0, captionHold = 0, spinAngle = 0, liveSlowShown = false;
  const hpView = [0, 1].map(() => ({core: 1, chip: 1, since: 9}));

  // Opponent tag on the build screen.
  el.foeParts.innerHTML = FOE.parts.map(p => `<span>${esc(NAMES[p.item])}${ICON[p.orient]}</span>`).join('');

  // ---------- build preview: both tops spin slowly where the match will start ----------
  const previewState = () => {
    const defs = [toDef(mine), toDef(FOE)], d = sweepOf(defs[0]) + sweepOf(defs[1]) + rules.initialGap;
    return {fighters: defs.map((def, i) => {
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spinAngle * (i ? 1 : 1) + (i ? 1.3 : 0));
      return {pos: new THREE.Vector3(i === 0 ? -d / 2 : d / 2, 0, 0), quat, angularVelocity: new THREE.Vector3(0, PREVIEW_SPIN, 0), hp: 1, maxHp: 1, parts: def.parts.map(() => ({alive: true, hp: 1, maxHp: 1}))};
    })};
  };
  function syncBuild() {
    document.querySelectorAll('.slot').forEach(slot => {
      const k = Number(slot.dataset.slot), part = mine.parts[k];
      slot.querySelector('.item b').textContent = NAMES[part.item];
      slot.querySelector('.lux').hidden = !isLux(part.item);
      slot.querySelector('.spec').textContent = spec(part.item);
      slot.querySelector('.hint').textContent = HINT[part.orient];
      for (const b of slot.querySelectorAll('[data-orient]')) b.setAttribute('aria-checked', String(b.dataset.orient === part.orient));
    });
    for (const b of document.querySelectorAll('[data-spread]')) b.setAttribute('aria-checked', String(b.dataset.spread === mine.spread));
  }
  let buildReq = 0;
  async function rebuildMine() {
    const req = ++buildReq;
    syncBuild();
    await loadModels(mine.parts.map(p => byId.get(p.item)));
    if (req !== buildReq || phase !== 'build') return;
    stage.replaceFighter(0, toDef(mine));
    stage.pose(previewState());
  }
  function showBuild() {
    phase = 'build';
    pb = replay = null;
    live?.match.free();
    live = null;
    el.pad.hidden = true;
    hideCoach();
    stage.setFighters([toDef(mine), toDef(FOE)]);
    stage.clearFx();
    overlay.clear(); lateNums = [];
    stage.setCameraMode('build');
    stage.setFocusOn(null);
    stage.setLookahead(null);
    stage.showMe = false;
    stage.pose(previewState());
    el.hud.hidden = true;
    el.result.hidden = true;
    el.build.hidden = false;
    el.foe.hidden = false;
    setCaption(false);
    el.go.disabled = false;
    [0, 1].forEach(i => overlay.setCoreHp(i, 1, true));
    syncBuild();
    layout_();
    stage.updateCamera(0, true);
  }

  // ---------- HUD ----------
  function buildHud(defs) {
    defs.forEach((def, i) => {
      const box = el.hud.querySelector(`.s${i} .parts`);
      // Imported items often have three- or four-character names: those tags get the compact style (style.css .pc.long).
      const fit = name => [...name].length > 3 ? ' long long4' : [...name].length > 2 ? ' long' : '';
      box.innerHTML = def.parts.map(p => `<span class="pc${fit(NAMES[p.item])}">${ICON[p.orient]}<b>${esc(NAMES[p.item])}</b><span class="mini"><i></i></span></span>`).join('');
    });
  }
  function updateHud(dt, state) {
    state.fighters.forEach((f, i) => {
      const v = hpView[i], frac = Math.max(0, f.hp / f.maxHp);
      if (frac < v.core - 1e-6) v.since = 0;
      v.core = frac;
      v.since += dt;
      if (v.since > 0.45) v.chip = Math.max(v.core, v.chip - dt * 0.6);
      if (v.chip < v.core) v.chip = v.core;
      const side = el.hud.querySelector(`.s${i}`);
      side.querySelector('.core .fill').style.transform = `scaleX(${v.core})`;
      side.querySelector('.core .chip').style.transform = `scaleX(${v.chip})`;
      side.querySelectorAll('.pc').forEach((pc, k) => {
        const p = f.parts[k], pf = Math.max(0, p.hp / p.maxHp), bar = pc.querySelector('.mini i');
        bar.style.transform = `scaleX(${pf})`;
        bar.classList.toggle('low', pf < 0.4);
        pc.classList.toggle('gone', !p.alive);
      });
      overlay.setCoreHp(i, frac);
    });
    el.clock.textContent = pb ? wholeSeconds(pb.t) : '0';
  }
  // The same blow on the HUD: the striking piece lights in its side's colour, the piece (or core bar) hit flashes white.
  const hudChip = (side, part) => part === 'core' ? el.hud.querySelector(`.s${side} .core .bar`) : el.hud.querySelectorAll(`.s${side} .pc`)[Number(part.split('-')[1])];
  // Runs on the game clock (holds through hit-stop and a frozen frame), like the callouts.
  const hudFlash = new Map();
  function flashHud(e) {
    const a = e.part === 'core' ? el.hud.querySelector(`.s${e.attacker} .ball`) : hudChip(e.attacker, e.part), b = hudChip(e.target, e.targetPart);
    if (a) hudFlash.set(a, {age: 0, cls: `strike${e.attacker}`});
    if (b && b !== a) hudFlash.set(b, {age: 0, cls: 'hurt'});
  }
  function updateHudFlash(dt) {
    for (const [node, f] of hudFlash) {
      f.age += dt;
      const on = f.age < 0.55;
      node.classList.toggle(f.cls, on);
      if (!on) hudFlash.delete(node);
    }
  }
  function setCaption(on, text) {
    if (text !== undefined) el.captionText.textContent = text;
    el.caption.classList.toggle('on', on);
  }

  // 第 13 版: a one-word verdict on the player's own 冲 / 挡 (完美, 挡空了, 擦边, 冲空, 被挡), small, over its own top, gone
  // within a second. The opponent's get the picture only (Elara 714284f2), so a clash never sprouts several words.
  function verdict(side, text, cls) {
    const f = stage.fighters[side];
    if (side !== 0 || !f) return;
    overlay.verdict(f, text, cls);
  }
  // How far the aim arrow reaches from the core: the lunge's carry, but no further than the far side of the target as it
  // stands at the press (Kimi fbe3bc4a 2678e876: a near-camera arrow running past it took half the phone screen).
  function aimReach(side) {
    const a = stage.fighters[side], b = stage.fighters[1 - side], carry = rules.manual.dashSpeed * rules.manual.dashTime;
    // The head lands just past the target so it is not hidden under it, and the arrow is never shorter than ~0.9 m.
    return a && b ? Math.min(carry, Math.max(Math.hypot(b.center.x - a.center.x, b.center.z - a.center.z) + b.sweep + 0.4, a.sweep * 1.05 + 0.9)) : carry;
  }
  // Older replays have no locked direction on the wind-up: aim at the other core as it stands then.
  function towardFoe(side) {
    const a = stage.fighters[side], b = stage.fighters[1 - side];
    return a && b ? [b.center.x - a.center.x, 0, b.center.z - a.center.z] : null;
  }

  // Test aid (v13-shots.mjs): freeze on the player's own 第 13 版 moments.
  const quality = e => e.quality ?? (e.outcome === 'hit' ? 'full' : e.outcome);
  const V13_FREEZE = {
    'aim-mine': e => e.type === 'dash' && e.phase === 'charge' && e.side === 0 && e.t > 1,
    'aim-foe': e => e.type === 'dash' && e.phase === 'charge' && e.side === 1 && e.t > 1,
    perfect: e => e.type === 'blockResult' && e.outcome === 'perfect' && e.damageApplied !== false && e.side === 0,
    held: e => e.type === 'blockResult' && e.outcome === 'perfect' && e.damageApplied === false && e.side === 0,
    empty: e => e.type === 'blockResult' && e.outcome === 'empty' && e.side === 0,
    miss: e => e.type === 'dash' && e.phase === 'end' && quality(e) === 'miss' && e.side === 0,
    glance: e => e.type === 'dash' && e.phase === 'end' && quality(e) === 'glance' && e.side === 0,
    // Any end of the player's own lunge (aim-check.mjs compares the arrow's grey with the sim's verdict).
    'end-mine': e => e.type === 'dash' && e.phase === 'end' && e.side === 0
  };

  // ---------- events → effects ----------
  function onEvent(e) {
    const point = e.point ? new THREE.Vector3().fromArray(e.point) : null;
    if (e.type === 'hit' || e.type === 'weak') {
      if (e.role === 'recoil') { stage.flashPart(e.target, e.targetPart, 0.3); return; }
      const core = e.targetPart === 'core', big = core || e.type === 'weak' || e.tier >= 2, dash = e.dash && !e.parry;
      if (dash) {
        // A landed lunge: the full treatment (hit-stop is in Playback): spark lines, a camera punch, a heavy thump.
        stage.burst(point, [WHITE, HOT, TEAM[e.attacker], WHITE, SPARK], 80, 3.8, 0.042, 0.75);
        stage.impact(point, 1, [WHITE, HOT, TEAM[e.attacker]]);
        stage.ring(point, WHITE, 0.05, 1.0, 0.3);
        overlay.screenFlash(0.32);
        sfx.dashHit();
        buzz(40);
      } else {
        // An ordinary knock: the same, scaled down.
        stage.burst(point, [WHITE, SPARK, TEAM[e.attacker], WHITE], big ? 40 : 22, big ? 2.8 : 2.0, big ? 0.03 : 0.022, big ? 0.6 : 0.45);
        stage.impact(point, e.shield ? 0.1 : big ? 0.4 : 0.18, [WHITE, SPARK, TEAM[e.attacker]]);
        sfx.hit(Math.min(1, 0.35 + (e.closingSpeed ?? 3) / 12 + (big ? 0.2 : 0)), {core, crit: e.type === 'weak'});
      }
      // Yesterday's camera shook on every blow (no-op with the new camera).
      stage.shakeV4(core ? 0.75 : big ? 0.5 : 0.3);
      // Core hit: a ring in the victim's colour; a hugging piece taking it: a pale "blocked" ring.
      stage.ring(point, core ? TEAM[e.target] : e.targetOrient === 'hug' ? BLOCK : WHITE, 0.04, big ? 0.75 : 0.5, big ? 0.4 : 0.3);
      stage.flashPart(e.target, e.targetPart, core ? 1 : 0.75);
      // Which piece struck (the striker's colour), crit added; a hugging piece taking it says so, stacked with it.
      if (e.damage > 0) {
        overlay.callout(point, e.attacker, e.item === '__core' ? '核心' : NAMES[e.item], {crit: e.type === 'weak', dash: e.dash && !e.parry});
        if (!core && e.targetOrient === 'hug' && e.type === 'hit' && !e.parry) overlay.callout(point, e.target, '护住', {cls: 'block'});
        if (e.dash && !e.parry) stage.ring(point, TEAM[e.attacker], 0.1, 1.3, 0.4);
        flashHud(e);
      }
      if (core) overlay.screenFlash(0.18);
      if (e.type === 'weak') { overlay.screenFlash(0.45); stage.ring(point, HOT, 0.05, 0.9, 0.45); }
    } else if (e.type === 'break') {
      coach(2);
      stage.breakPart(e.target, Number(e.targetPart.split('-')[1]), e);
      sfx.crunch();
      buzz(25);
      stage.shakeV4(0.8);
      const broke = [new THREE.Vector3().fromArray(e.pose.pos), `${e.target === 0 ? '你的' : '对手的'}${NAMES[e.item] ?? ''}碎了`, `broke t${e.target}`, 1.8];
      if (e.t - lastParryT < 1e-6) lateNums.push({wait: 0.5, broke}); else overlay.number(...broke);
      // The camera never moves; only a piece or a core breaking jolts the picture a few px.
      stage.shake(4);
      overlay.screenFlash(0.25);
    } else if (e.type === 'dash') {
      if (e.phase === 'charge' && e.side === 1) coach(1);
      if (e.phase === 'charge') {
        stage.charge(e.side, e.until - e.t);
        // 第 13 版: the direction is locked at the press; show it through the wind-up so both sides can read the lunge.
        // Only the player's own arrow greys out when the target leaves the full-lunge lane (Elara 80e885bc); the opponent's is unchanged.
        stage.aim(e.side, e.lockedDir ?? towardFoe(e.side), e.until - e.t, aimReach(e.side), e.side === 0 ? rules.manual.dashAlignment : null);
        sfx.charge(e.until - e.t);
      } else if (e.phase === 'go') { stage.lunge(e.side, e.dir, rules.manual.dashTime); sfx.whoosh(); }
      else {
        stage.endLunge(e.side);
        // How the lunge ended, as the sim judged it (full / glance / miss / blocked); the page never judges a hit itself.
        const q = quality(e);
        if (q === 'miss') { stage.whiff(e.side); sfx.whiff(); verdict(e.side, '冲空', 'dud'); }
        else if (q === 'glance') verdict(e.side, '擦边', 'glance');
        else if (q === 'blocked') verdict(e.side, '被挡', 'dud');
      }
    } else if (e.type === 'block') {
      stage.raiseShield(e.side, e.until - e.t);
      sfx.ting();
    } else if (e.type === 'blockResult') {
      // 第 13 版: one result per block window. "empty" only means nothing was caught (not necessarily too early).
      if (e.outcome === 'perfect' && e.damageApplied !== false) {
        stage.perfectBlock(e.side, point);
        overlay.screenFlash(0.2);
        sfx.perfect();
        verdict(e.side, '完美', 'perfect');
      } else if (e.outcome === 'perfect') {
        // Caught a real new contact while the shared damage cooldown let nothing through (damageApplied false, Elara
        // c65e070d): it still counts as held, one size smaller, no 「完美」.
        stage.perfectBlock(e.side, point, 0.6);
        sfx.ting();
        verdict(e.side, '挡住', 'held');
      } else { stage.fizzle(e.side); sfx.fizzle(); verdict(e.side, '挡空了', 'dud'); }
    } else if (e.type === 'parry') {
      // A 「…碎了」 still up from an earlier break would read as this blow's result: clear it (Elara 80e885bc, Wren's 被挡 shot).
      lastParryT = e.t;
      overlay.hurry('broke');
      // A lunge into a raised shield: it is bounced, and that should read at a glance (white flash, a clang, a
      // short slow motion from Playback, the lunger flung away trailing streaks). The words come from blockResult /
      // the lunge's end, and only for the player's own top.
      stage.parry(e.target, point, e.attacker);
      stage.punch(point, 7);
      overlay.screenFlash(0.45);
      sfx.clang();
      buzz([25, 40, 45]);
    } else if (e.type === 'ko') {
      // Every core that broke goes (both, when they break in the same instant).
      for (const i of e.targets ?? [e.target]) {
        const f = stage.fighters[i];
        if (!f) continue;
        stage.burst(f.center, [TEAM[i], WHITE, TEAM[i], SPARK], 90, 3.4, 0.032, 1.2);
        stage.ring(f.center, TEAM[i], 0.1, 1.8, 0.7);
        stage.flashPart(i, 'core', 1);
        stage.scatter(i);
      }
      stage.shake(6);
      overlay.screenFlash(0.5);
      sfx.ko();
      buzz(70);
      stage.shakeV4(1.1);
      overlay.showBanner('核心碎了', replay.meta.winner === 0 ? HEX[0] : '#ffffff', 1.3);
    }
    test.onEvent(e);
  }

  // ---------- 首局提示 ----------
  // Three lines, each once ever (remembered on this phone): at the start, the first time the other top winds up a
  // lunge, the first time a piece breaks. Manual play only. A sandboxed viewer without storage just shows them again.
  const COACH = [{text: '按冲，朝它扑过去', at: 'dash'}, {text: '它冲过来时按挡，把它弹开', at: 'block'}, {text: '件碎了，核心就露出来了', at: 'mid'}];
  const COACH_KEY = 'wanwu-coach-seen';
  const coachSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem(COACH_KEY) ?? '[]')); } catch { return new Set(); } })();
  if (q.get('coach') === 'again') coachSeen.clear();
  let coachTimer = 0, coachSince = -Infinity;
  function coach(n) {
    if (control !== 'manual' || !live || coachSeen.has(n) || phase !== 'play') return;
    // In order, and each up for at least two seconds: the opponent often winds up before the first line has been read.
    if (n > 0) coach(0);
    const wait = coachSince + 2 - performance.now() / 1000;
    if (wait > 0) { setTimeout(() => coach(n), wait * 1000 + 50); return; }
    coachSeen.add(n);
    coachSince = performance.now() / 1000;
    try { localStorage.setItem(COACH_KEY, JSON.stringify([...coachSeen])); } catch { /* no storage here */ }
    // Numbered in the order they actually came up: lines 2 and 3 follow the match (a piece can break before a lunge).
    el.coachTag.textContent = `${coachSeen.size}/3`;
    el.coachText.textContent = COACH[n].text;
    el.coach.dataset.at = COACH[n].at;
    el.coach.hidden = false;
    clearTimeout(coachTimer);
    coachTimer = setTimeout(() => { el.coach.hidden = true; }, 3200);
  }
  function hideCoach() { clearTimeout(coachTimer); el.coach.hidden = true; }

  // ---------- match ----------
  let runId = 0;
  async function start() {
    if (phase !== 'build') return;
    const id = ++runId;
    if (!fixedSeed) seed = randomSeed();
    phase = 'computing';
    el.go.disabled = true;
    el.busyText.textContent = '计算中';
    el.busy.hidden = false;
    await loadModels([...mine.parts, ...FOE.parts].map(p => byId.get(p.item)));
    await nextPaint();
    const t0 = performance.now();
    let r;
    live?.match.free();
    live = null;
    if (control === 'manual') {
      // Played live: the sim steps just ahead of the picture and takes the buttons as it goes.
      const match = await createV3Match({fighters: [toDef(mine), toDef(FOE)], mode, seed, manual: {sides: ['input', 'ai'], ...(blockTime ? {blockTime} : {})}});
      if (id !== runId) { match.free(); return; }
      r = {meta: {initial: match.initial, duration: Infinity, rules: match.rules}, frames: match.frames, events: match.events, decisive: {eventIndex: null, why: null}};
      live = {match, done: false};
    } else {
      // Yield to the page every few hundred physics steps so the preview keeps spinning.
      r = await simulateV3({fighters: [toDef(mine), toDef(FOE)], mode, seed, onProgress: () => new Promise(res => setTimeout(res, 0))});
    }
    test.simMs = performance.now() - t0;
    if (id !== runId) return;
    el.busy.hidden = true;
    replay = r;
    pb = new Playback(r);
    liveSlowShown = false;
    stage.setFighters(r.meta.initial.map(f => f.definition));
    stage.clearFx();
    overlay.clear(); lateNums = [];
    stage.setCameraMode('fight');
    stage.setFocusOn(null);
    stage.showMe = true;
    buildHud(r.meta.initial.map(f => f.definition));
    for (const h of hpView) Object.assign(h, {core: 1, chip: 1, since: 9});
    [0, 1].forEach(i => overlay.setCoreHp(i, 1, true));
    el.build.hidden = true;
    el.foe.hidden = true;
    el.hud.hidden = false;
    el.pad.hidden = !live;
    if (!live) setCaption(false, reasonLine(r));
    captionHold = 0;
    lastParryT = -Infinity;
    layout_();
    stage.pose(pb.state);
    stage.setLookahead(lookahead());
    stage.updateCamera(0, true);
    phase = 'play';
    overlay.showBanner('开转', '#ffffff', 0.8);
    setTimeout(() => coach(0), 400);
    // Shareable address on a normal page; sandboxed viewers (opaque origin) refuse URL changes, which is fine.
    try { history.replaceState(null, '', `?mine=${[mine.parts[0].item, mine.parts[0].orient, mine.parts[1].item, mine.parts[1].orient, mine.spread].join(',')}${fixedSeed ? `&seed=${seed}` : ''}${mode === 'B' ? '&mode=B' : ''}${control === 'auto' ? '&play=auto' : ''}${camStyle !== 'slow' ? `&cam=${camStyle}` : ''}${blockTime ? `&block=${q.get('block')}` : ''}`); } catch { /* sandboxed viewer */ }
  }
  function showResult() {
    el.pad.hidden = true;
    hideCoach();
    if (pb.t < pb.end - 1e-6) {
      stage.clearFx();
      overlay.clear(); lateNums = [];
      pb.seek(pb.end);
      stage.pose(pb.state);
    }
    phase = 'result';
    const m = replay.meta;
    stage.setCameraMode('result');
    stage.showMe = false;
    stage.setLookahead(null);
    el.winnerLine.textContent = m.winner === null ? '平局' : m.winner === 0 ? '你赢了' : '你输了';
    el.result.className = m.winner === null ? 'draw' : m.winner === 0 ? 'win' : 'lose';
    el.resultMeta.textContent = `第 ${wholeSeconds(m.duration)} 秒 · ${endLine(replay)}`;
    el.whyLine.textContent = reasonLine(replay);
    const stats = matchStats(replay, replay.meta.initial.map(f => f.definition));
    el.statsList.innerHTML = pickStats(stats, m.winner).map(x => `<li><b>${esc(x.value)}</b><span>${esc(x.label)}</span></li>`).join('');
    el.tipLine.textContent = tipLine(stats, m.winner);
    $('replayBtn').hidden = pb.slowAt === null;
    setCaption(false);
    el.result.hidden = false;
    layout_();
    // The camera eases over to the winner alone, above the card (a draw keeps both in frame).
    stage.setFocusOn(m.winner, el.result.offsetTop);
  }
  function replaySlow() {
    // A live match had no decisive slow motion; its finished replay has.
    if (live && !pb.full) { pb = new Playback(replay); pb.full = true; }
    if (!pb || pb.slowAt === null) return;
    el.result.hidden = true;
    el.pad.hidden = true;
    stage.clearFx();
    overlay.clear(); lateNums = [];
    pb.slowEnabled = true;
    stage.setCameraMode('fight');
    stage.setFocusOn(null);
    stage.showMe = true;
    pb.seek(pb.replayFrom);
    replayEnd = 0;
    stage.pose(pb.state);
    phase = 'replay';
    layout_();
  }

  // ---------- controls ----------
  // 角色库: every item a card (3D turning, name, category, size and weight, where it came from). The other slot's item
  // is 「已装」 and can't be picked; this slot's own is 「装着」. Photo-made items with a saved generation record get
  // 「看它怎么来的」 (item.origin, written by the generation script); the rest say where they came from instead.
  const CAT = {pot: '锅', lamp: '台灯', scissors: '刀剪', broom: '扫把', slipper: '拖鞋', pillow: '枕头'};
  const sourceOf = it => {
    if (it.origin) return {tag: null, line: null};
    if (isLux(it.id)) return {tag: 'Aholo 生成', line: '来源：照片生成'};
    if (/^CC/.test(it.source?.license ?? '')) return {tag: 'CC 模型', line: `来源：公开的 CC 模型${it.source.author ? ' · ' + it.source.author : ''}`};
    return {tag: '3D 模型', line: '来源：只有 3D 模型'};
  };
  let libSlot = 0, libReq = 0;
  function cardHtml(id, k) {
    const it = byId.get(id), src = sourceOf(it), other = mine.parts[1 - k].item === id, own = mine.parts[k].item === id;
    const badge = other ? '<span class="badge">已装</span>' : own ? '<span class="badge own">装着</span>' : '';
    const corner = it.origin?.photo ? `<img class="photo" src="${esc(pictureUrl(it.origin.photo) ?? '')}" alt="原照">` : src.tag ? `<span class="srctag">${esc(src.tag)}</span>` : '';
    const foot = it.origin ? '<button type="button" class="how" data-how><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg>看它怎么来的</button>' : `<small class="src">${esc(src.line)}</small>`;
    return `<article class="card${own ? ' own' : ''}${other ? ' used' : ''}" data-item="${esc(id)}">
      <button type="button" class="pick"${other ? ' disabled' : ''} aria-label="装上${esc(NAMES[id])}">
        <span class="media"><i class="turn"></i>${corner}${badge}</span>
        <span class="nm"><b>${esc(NAMES[id])}</b><span class="cat">${esc(CAT[it.category] ?? it.category ?? '')}</span></span>
        <small class="spec">${spec(id)}</small>
      </button>${foot}</article>`;
  }
  async function openLibrary(k) {
    const req = ++libReq;
    libSlot = k;
    el.libTitle.textContent = `挑一件，装到${k ? '右边' : '左边'}`;
    el.libCount.textContent = `${OFFER.length} 件 · 点卡片就装上，回拼装页`;
    el.libGrid.innerHTML = OFFER.map(id => cardHtml(id, k)).join('');
    el.libGrid.scrollTop = 0;
    el.library.hidden = false;
    for (const card of el.libGrid.querySelectorAll('.card')) {
      const id = card.dataset.item;
      card.querySelector('.pick').onclick = () => {
        if (mine.parts[1 - libSlot].item === id) return;
        mine.parts[libSlot].item = id;
        closeLibrary();
        rebuildMine();
      };
      const how = card.querySelector('[data-how]');
      if (how) how.onclick = () => openHow(id);
    }
    // The 3D turns in as each model arrives (the page only loads a model once a card or a build needs it).
    for (const id of OFFER) {
      await loadModels([byId.get(id)]);
      if (req !== libReq || el.library.hidden) return;
      const strip = turntable(id, stage.renderer, stage.scene.environment);
      const turn = el.libGrid.querySelector(`.card[data-item="${CSS.escape(id)}"] .turn`);
      if (strip && turn) { turn.style.backgroundImage = `url(${strip.url})`; turn.classList.add('on'); }
      await nextPaint();
    }
  }
  function closeLibrary() { libReq++; el.library.hidden = true; }
  $('libBack').onclick = closeLibrary;

  // 看它怎么来的: three steps from the item's own record (photo → the styled image → the 3D turning), about ten seconds,
  // each step's real time beside it. The category is the one the player's pick fixed, not something a model guessed.
  const STEPS = [{key: 'photo', name: '照片', play: 3}, {key: 'styled', name: '改成画风的图', play: 3}, {key: 'model', name: '3D 转起来', play: 4}];
  const dur = sec => sec >= 60 ? `${Math.floor(sec / 60)} 分 ${String(Math.round(sec % 60)).padStart(2, '0')} 秒` : `${Math.round(sec)} 秒`;
  let howItem = null, howT = 0, howTimer = 0, howReq = 0;
  async function openHow(id) {
    const it = byId.get(id), o = it?.origin;
    if (!o) return;
    howItem = id;
    const secs = STEPS.map(st => o.steps?.find(x => x.key === st.key)?.seconds);
    el.howTitle.textContent = `${NAMES[id]}是怎么来的`;
    el.howCat.textContent = CAT[it.category] ?? it.category ?? '';
    el.howSteps.innerHTML = STEPS.map((st, i) => {
      const pic = st.key === 'model' ? '<i class="mini3d"></i>' : `<img src="${esc(pictureUrl(st.key === 'photo' ? o.photo : o.styled) ?? '')}" alt="">`;
      return `<li data-step="${i}"><span class="n">${i + 1}</span><b>${st.name}</b>${pic}<span class="sec">${Number.isFinite(secs[i]) ? dur(secs[i]) : '—'}</span></li>`;
    }).join('');
    el.howTotal.textContent = secs.every(Number.isFinite) ? `实际用时 ${dur(secs.reduce((a, b) => a + b, 0))}` : '';
    const other = mine.parts[1 - libSlot].item === id;
    el.howEquip.disabled = other;
    el.howEquip.querySelector('span').textContent = other ? '另一边已经装着它' : mine.parts[libSlot].item === id ? '装着，回拼装' : '装上它';
    el.howTurn.style.backgroundImage = '';
    el.how.hidden = false;
    playHow();
    // The 3D step needs the model, which the 角色库 may not have loaded yet: it turns in once it arrives.
    const req = ++howReq;
    await loadModels([it]);
    if (req !== howReq || el.how.hidden) return;
    const strip = turntable(id, stage.renderer, stage.scene.environment, {size: 320});
    el.howTurn.style.backgroundImage = strip ? `url(${strip.url})` : '';
    const small = turntable(id, stage.renderer, stage.scene.environment);
    el.howSteps.querySelector('.mini3d').style.backgroundImage = small ? `url(${small.url})` : '';
  }
  function playHow() {
    howT = 0;
    cancelAnimationFrame(howTimer);
    let last = performance.now();
    const total = STEPS.reduce((a, st) => a + st.play, 0), o = byId.get(howItem).origin;
    const tick = now => {
      howT = Math.min(total, howT + (now - last) / 1000);
      last = now;
      let at = 0, i = 0;
      while (i < STEPS.length - 1 && howT >= at + STEPS[i].play) at += STEPS[i++].play;
      const k = Math.min(1, (howT - at) / STEPS[i].play);
      el.howBar.querySelectorAll('i').forEach((b, n) => b.style.setProperty('--fill', n < i ? 1 : n === i ? k : 0));
      el.howSteps.querySelectorAll('li').forEach((li, n) => { li.classList.toggle('done', n < i || howT >= total); li.classList.toggle('now', n === i && howT < total); });
      const key = STEPS[i].key, src = key === 'model' ? null : pictureUrl(key === 'photo' ? o.photo : o.styled);
      if (src && el.howShot.getAttribute('src') !== src) el.howShot.src = src;
      el.howShot.hidden = key === 'model';
      el.howTurn.classList.toggle('on', key === 'model');
      el.howNow.textContent = `第 ${i + 1} 步 · ${STEPS[i].name}`;
      if (howT < total && !el.how.hidden) howTimer = requestAnimationFrame(tick);
    };
    howTimer = requestAnimationFrame(tick);
  }
  function closeHow() { howReq++; cancelAnimationFrame(howTimer); el.how.hidden = true; }
  $('howBack').onclick = closeHow;
  $('howReplay').onclick = playHow;
  el.howEquip.onclick = () => {
    if (mine.parts[1 - libSlot].item === howItem) return;
    mine.parts[libSlot].item = howItem;
    closeHow();
    closeLibrary();
    rebuildMine();
  };
  document.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { if (phase === 'build') openLibrary(Number(b.dataset.pick)); }; });
  document.querySelectorAll('.slot').forEach(slot => slot.querySelectorAll('[data-orient]').forEach(b => {
    b.onclick = () => { if (phase !== 'build') return; mine.parts[Number(slot.dataset.slot)].orient = b.dataset.orient; rebuildMine(); };
  }));
  document.querySelectorAll('[data-spread]').forEach(b => { b.onclick = () => { if (phase !== 'build') return; mine.spread = b.dataset.spread; rebuildMine(); }; });
  // 冲 / 挡: taken on press (not release); the sim decides at its next step whether it is ready.
  function press(action) {
    if (!live || live.done || phase !== 'play') return;
    const c = live.match.control(0), left = action === 'dash' ? c.dashIn : c.blockIn;
    // Still cooling at the next physics step: the sim would drop it anyway, so nothing is sent; the button shakes instead.
    if (left > rules.dt + 1e-9) { replay_(action === 'dash' ? el.dashBtn : el.blockBtn, 'deny'); test.denied++; sfx.deny(); return; }
    live.match.press(0, action);
    sfx.click();
  }
  // Restart a one-shot CSS animation class (a second tap mid-shake shakes again).
  function replay_(btn, cls) { btn.classList.remove(cls); void btn.offsetWidth; btn.classList.add(cls); }
  for (const [btn, action] of [[el.dashBtn, 'dash'], [el.blockBtn, 'block']]) {
    btn.left = btn.querySelector('.left');
    // Real press state on touchdown: the button goes down and lights up until the finger lifts.
    btn.addEventListener('pointerdown', ev => { ev.preventDefault(); btn.classList.add('down'); press(action); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(type, () => btn.classList.remove('down'));
    btn.addEventListener('animationend', ev => { if (ev.animationName === 'padDeny') btn.classList.remove('deny'); else if (ev.animationName === 'padPop') btn.classList.remove('pop'); });
  }
  const keyBtn = ev => ev.code === 'KeyJ' || ev.code === 'Space' ? el.dashBtn : ev.code === 'KeyK' || ev.code === 'ShiftLeft' || ev.code === 'ShiftRight' ? el.blockBtn : null;
  addEventListener('keydown', ev => { if (ev.repeat) return; const b = keyBtn(ev); if (!b) return; if (b === el.dashBtn) ev.preventDefault(); b.classList.add('down'); press(b === el.dashBtn ? 'dash' : 'block'); });
  addEventListener('keyup', ev => keyBtn(ev)?.classList.remove('down'));
  // Sound on / off (remembered where the page may store it).
  const syncMute = () => { el.mute.classList.toggle('off', sfx.muted); el.mute.setAttribute('aria-label', sfx.muted ? '打开声音' : '关掉声音'); };
  el.mute.addEventListener('click', () => { sfx.setMuted(!sfx.muted); syncMute(); });
  syncMute();
  // 俯视 / 慢三成 / 原速: switch at any time (a cut, then that camera carries on).
  const syncCam = () => { for (const b of el.camSeg.querySelectorAll('[data-cam]')) b.setAttribute('aria-checked', String(b.dataset.cam === camStyle)); };
  el.camSeg.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.cam === camStyle) return;
    camStyle = b.dataset.cam;
    stage.setCamStyle(camStyle);
    syncCam();
    try { const rest = location.search.slice(1).split('&').filter(p => p && !p.startsWith('cam=')); if (camStyle !== 'slow') rest.push(`cam=${camStyle}`); history.replaceState(null, '', `?${rest.join('&')}`); } catch { /* sandboxed viewer */ }
  }));
  syncCam();
  function updatePad() {
    if (!live || el.pad.hidden) return;
    const c = live.match.control(0), M = rules.manual;
    for (const [btn, left, total, on] of [[el.dashBtn, c.dashIn, M.dashCooldown, c.charging || c.dashing], [el.blockBtn, c.blockIn, M.blockCooldown, c.shield]]) {
      const state = on ? 'on' : left > 0 ? 'cooling' : live.done ? 'idle' : 'ready';
      btn.style.setProperty('--p', on ? 0 : (1 - left / total).toFixed(3));
      btn.classList.toggle('on', state === 'on');
      btn.classList.toggle('cooling', state === 'cooling');
      btn.classList.toggle('ready', state === 'ready');
      const wait = state === 'cooling' ? String(Math.ceil(left - 1e-6)) : '';
      if (btn.left.textContent !== wait) btn.left.textContent = wait;
      // Back from cooling: one pop so the thumb knows without looking twice.
      if (state === 'ready' && btn.dataset.state === 'cooling') replay_(btn, 'pop');
      btn.dataset.state = state;
    }
  }
  el.go.onclick = () => start();
  $('replayBtn').onclick = () => replaySlow();
  $('againBtn').onclick = () => showBuild();
  // 原样再来: the same two builds again at once (a new seed unless ?seed= fixed it).
  $('sameBtn').onclick = () => { showBuild(); start(); };
  $('creditsBtn').onclick = () => { el.credits.hidden = false; };
  $('creditsClose').onclick = () => { el.credits.hidden = true; };
  el.credits.onclick = e => { if (e.target === el.credits) el.credits.hidden = true; };

  // ---------- camera lookahead ----------
  // Where each top will be 0.1 s from now: from the replay when it already has those frames (auto, and
  // the few hundredths the live sim runs ahead), else carried on at its current velocity (live). Only for framing.
  const AHEAD = [0.1], tmpV = new THREE.Vector3();
  function lookahead() {
    if (!pb) return null;
    const fr = pb.r.frames, last = fr[fr.length - 1];
    return pb.state.fighters.map((s, n) => AHEAD.map(dt => {
      const t = pb.t + dt;
      if (last.t >= t) {
        const i = pb.frameIndex(t), A = fr[i], B = fr[Math.min(i + 1, fr.length - 1)], k = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0;
        return new THREE.Vector3().fromArray(A.fighters[n].pos).lerp(new THREE.Vector3().fromArray(B.fighters[n].pos), k);
      }
      // Live: a short, capped guess (a lunge would otherwise be carried on straight through the other top).
      const from = last.t > pb.t ? new THREE.Vector3().fromArray(last.fighters[n].pos) : s.pos.clone();
      const step = tmpV.copy(s.vel).multiplyScalar(Math.min(0.2, t - Math.max(pb.t, last.t)));
      const p = from.add(step.clampLength(0, 0.45));
      const d = Math.hypot(p.x, p.z);
      if (d > CORE_TRAVEL) { p.x *= CORE_TRAVEL / d; p.z *= CORE_TRAVEL / d; }
      return p;
    }));
  }

  // ---------- layout ----------
  function layout_() {
    const w = el.app.clientWidth, h = el.app.clientHeight;
    const building = !el.build.hidden;
    // Fight and result share one fixed frame: below the HUD, above the decisive caption's place, whether or not
    // the caption is showing, so nothing that appears or goes away ever moves the camera.
    const top = building ? el.foe.offsetHeight : el.hud.offsetHeight;
    const bottom = building ? el.build.offsetHeight : el.caption.offsetHeight + 24;
    // Manual: the buttons take the room under the arena (the arena only makes way if that room is not there).
    stage.setPad(building || el.pad.hidden ? 0 : h - el.pad.offsetTop + 8);
    stage.resize(w, h, top, bottom);
  }
  new ResizeObserver(layout_).observe(el.app);

  // ---------- test hooks (Playwright screenshots; no effect on normal play) ----------
  const test = {
    frozen: false, freezeOn: null, freezeDelay: 0, pending: -1, simMs: 0, denied: 0, nth: 1, seen: 0, speed: 1, safe: null,
    onEvent(e) {
      if (!this.freezeOn || this.pending >= 0) return;
      const v13 = V13_FREEZE[this.freezeOn];
      const ok = v13 ? v13(e) : this.freezeOn === 'parry' ? e.type === 'parry' : this.freezeOn === 'dash-mine' ? (e.type === 'hit' || e.type === 'weak') && e.role === 'attack' && e.dash && !e.parry && e.damage > 0 && e.attacker === 0 : this.freezeOn === 'dash-hit' || this.freezeOn === 'dash-core' ? (e.type === 'hit' || e.type === 'weak') && e.role === 'attack' && e.dash && !e.parry && e.damage > 0 && (this.freezeOn === 'dash-hit' || (e.targetPart === 'core' && e.attacker === 0)) : this.freezeOn === 'break' ? e.type === 'break' : this.freezeOn === 'hit' ? (e.type === 'hit' || e.type === 'weak') && e.role === 'attack' : this.freezeOn === 'core' ? (e.type === 'hit' || e.type === 'weak') && e.role === 'attack' && e.targetPart === 'core' : false;
      if (ok && ++this.seen >= this.nth) { this.pending = this.freezeDelay; this.caught = {type: e.type, side: e.side, quality: e.quality ?? e.outcome ?? null, alignment: e.alignment ?? null, t: e.t}; }
    }
  };
  window.__top = {
    press,
    setControl(c) { control = c; },
    // Fixture for the 看它怎么来的 check until the generation script writes real records.
    setOrigin(id, origin) { byId.get(id).origin = origin; },
    // The finished replay as JSON (to re-simulate it elsewhere from its recorded presses and compare bytes).
    replayJson: () => replay && JSON.stringify(replay),
    status: () => ({phase, control, cam: camStyle, denied: test.denied, live: Boolean(live), foe: live && !live.done ? live.match.control(1) : null, me: live && !live.done ? live.match.control(0) : null, inputs: live?.done ? replay.meta.manual.inputs : null, frozen: test.frozen, t: pb?.t ?? 0, simMs: test.simMs, seed, mine: structuredClone(mine), meta: replay && {...replay.meta, initial: undefined, rules: undefined}, decisive: replay?.decisive, reason: replay && reasonLine(replay), caption: el.caption.classList.contains('on')}),
    freezeOn(type, delayMs = 60, nth = 1) { Object.assign(test, {freezeOn: type, freezeDelay: delayMs / 1000, pending: -1, nth, seen: 0}); },
    freeze() { test.frozen = true; },
    release() { Object.assign(test, {frozen: false, freezeOn: null, pending: -1}); },
    // Safe-area audit: worst overflow per phase over every rendered frame (px > 0 means something was cut off).
    trackSafe(speed = 1) { test.speed = speed; test.safe = {}; test.frame = null; },
    safe: () => test.safe,
    // The player's own aim arrow: 0 on the lane .. 1 grey (off the full-lunge lane), null when none is showing.
    caught: () => test.caught ?? null,
    aimWide: () => stage.fighters[0]?.act.aimDir ? stage.fighters[0].act.aimWide : null,
    framing() {
      const m = test.frame;
      if (!m) return null;
      const s = [...m.scale].sort((a, b) => a - b), q = k => +s[Math.floor(k * (s.length - 1))].toFixed(1);
      return {frames: m.frames, core15Pct: +(100 * m.core15 / m.frames).toFixed(1), ok15Pct: +(100 * m.ok15 / m.frames).toFixed(1), minMarginPx: +m.minMargin.toFixed(1), sweptMinMarginLrPx: +m.sweptLr.toFixed(1), sweptMinMarginSafePx: +m.sweptSafe.toFixed(1), core15PctExact: +(100 * m.core15 / m.frames).toFixed(2), pxPerMetre: {p10: q(0.1), median: q(0.5), p90: q(0.9), min: q(0), max: q(1)}};
    },
    setBuild(b) { Object.assign(mine, structuredClone(b)); rebuildMine(); },
    stage,
    overlay,
    // Framing camera parameters (tuning runs only).
    cam: CAM,
    start,
    events: () => replay?.events.filter(e => e.type !== 'contact' && e.type !== 'recoil').map(e => ({t: e.t, type: e.type, role: e.role, target: e.target, targetPart: e.targetPart, damage: e.damage})) ?? []
  };

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (test.pending >= 0) {
      test.pending -= dt;
      if (test.pending < 0) { test.frozen = true; test.freezeOn = null; }
    }
    if (test.frozen) dt = 0;
    dt *= test.speed;
    if (phase === 'loading') return;
    for (const n of lateNums) if ((n.wait -= dt) <= 0) overlay.number(...n.broke);
    lateNums = lateNums.filter(n => n.wait > 0);
    let simDt = dt;
    if (phase === 'build' || phase === 'computing') {
      spinAngle += dt * PREVIEW_SPIN;
      stage.pose(previewState());
    } else if (phase === 'play' || phase === 'replay') {
      if (phase === 'play' && live && !live.done) {
        // Keep the live sim just ahead of the picture; once it is over, the replay is complete.
        const m = live.match;
        while (!m.done && m.t < pb.t + dt + LIVE_LEAD) m.advance();
        if (m.done) { live.done = true; replay = m.result(); pb.r = replay; setCaption(false, reasonLine(replay)); }
        pb.sync(live.done);
      }
      simDt = pb.advance(dt, 1, onEvent);
      stage.pose(pb.state);
      stage.setLookahead(lookahead());
      stage.setPushV4(pb.pushAmount(pb.t));
      const slow = pb.slowAmount(pb.t);
      el.slowtag.classList.toggle('on', slow > 0.3);
      if (pb.inDecisive(pb.t)) { if (!el.caption.classList.contains('on')) setCaption(true); captionHold = 1.6; }
      else if (captionHold > 0) { captionHold -= dt; if (captionHold <= 0) setCaption(false); }
      if (phase === 'replay' && pb.t >= pb.replayTo - 1e-9 && pb.hold <= 0) {
        replayEnd += dt;
        if (replayEnd > 0.6) showResult();
      } else if (pb.done) {
        if (phase === 'play' && replay.meta.reason === 'timeout') overlay.showBanner('时间到', '#ffffff', 1.3);
        phase = 'finale';
        finaleAge = finaleSim = 0;
      }
    } else if (phase === 'finale' || phase === 'result') {
      // Coast after the last frame; the loser's core is gone, the winner keeps spinning.
      finaleAge += dt;
      const v = pb.end + finaleSim;
      simDt = phase === 'finale' ? dt * pb.slowFactor(v) : dt;
      finaleSim += simDt;
      const drift = Math.exp(-finaleSim * 1.6);
      for (const f of pb.state.fighters) {
        f.pos.addScaledVector(f.vel, simDt * drift);
        // The camera is fixed: coasting never carries a top past where the fight itself can reach.
        const d = Math.hypot(f.pos.x, f.pos.z);
        if (d > CORE_TRAVEL) { f.pos.x *= CORE_TRAVEL / d; f.pos.z *= CORE_TRAVEL / d; }
        f.pos.y = Math.max(-CORE_RISE, Math.min(CORE_RISE, f.pos.y));
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat);
        if (phase === 'result' && f.hp > 0) {
          // On the result card the winner stands up straight and slows to a lazy turn, so from above its
          // core and both pieces read as "this top" rather than a blur of whatever tilt the last hit left.
          const k = 1 - Math.exp(-dt / 0.35);
          f.quat.premultiply(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0)), k));
          const s = f.angularVelocity.dot(up), want = Math.sign(s || 1) * RESULT_SPIN;
          f.angularVelocity.set(0, s + (want - s) * k, 0);
          up.set(0, 1, 0).applyQuaternion(f.quat);
        }
        f.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(up, f.angularVelocity.length() * simDt * (f.hp > 0 ? 1 : drift)));
      }
      stage.pose(pb.state);
      stage.setLookahead(null);
      stage.setPushV4(phase === 'finale' ? pb.pushAmount(pb.end + finaleSim) : 0);
      el.slowtag.classList.toggle('on', phase === 'finale' && pb.slowAmount(v) > 0.3);
      // Manual: the decisive blow comes back as a slow replay before the result.
      if (phase === 'finale' && finaleAge > 1.4 && pb.slowFactor(v) > 0.99) {
        if (live && !live.replayed) { live.replayed = true; replaySlow(); }
        if (phase === 'finale') showResult();
      }
    }
    stage.updateCamera(dt, false);
    if (test.safe && dt > 0 && phase !== 'build' && phase !== 'computing') {
      const o = stage.safeOverflow(), cur = test.safe[phase];
      if (!cur || o.px > cur.px) test.safe[phase] = {...o, t: +(pb?.t ?? 0).toFixed(2), w: el.app.clientWidth};
      // Framing audit (fight only): how often both tops keep 15 % of the width clear of every safe-area edge, and the
      // scale (CSS px per metre at the aim point) the camera picked.
      if (phase === 'play' && stage.cam.stat) {
        const m = test.frame ??= {frames: 0, ok15: 0, core15: 0, minMargin: Infinity, scale: [], sweptLr: Infinity, sweptSafe: Infinity};
        m.frames++;
        const sm = stage.sweptMargin();
        m.sweptLr = Math.min(m.sweptLr, sm.lr);
        m.sweptSafe = Math.min(m.sweptSafe, sm.safe);
        if (-o.px >= 0.15 * el.app.clientWidth) m.ok15++;
        if (stage.coreMargin() >= 0.15 * el.app.clientWidth) m.core15++;
        m.minMargin = Math.min(m.minMargin, -o.px);
        m.scale.push(stage.cam.stat.pxPerMetre);
      }
    }
    stage.render(dt, simDt);
    overlay.update(dt, true);
    if (pb && phase !== 'build' && phase !== 'computing') { updateHud(dt, pb.state); updateHudFlash(dt); updatePad(); }
  }
  showBuild();
  requestAnimationFrame(frame);
  if (q.get('autoplay') === '1') start();
}

main().catch(showError);
