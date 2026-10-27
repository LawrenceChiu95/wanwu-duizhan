import * as THREE from 'three';
import {loadCatalog} from '../../sim/index.js';
import {simulateV3, loadV3Rules, mountExtents} from '../../sim/v3.js';
import creditsMd from '../../data/CREDITS.md?raw';
import {loadModels} from './models.js';
import {Stage, TEAM, CORE_TRAVEL, CORE_RISE} from './stage.js';
import {Playback} from './playback.js';
import {Overlay} from './overlay.js';
import {reasonLine, NAMES} from './reason.js';

const $ = id => document.getElementById(id);
const el = {
  app: $('app'), canvas: $('view'), fx: $('fx'), flash: $('flash'), banner: $('banner'),
  caption: $('caption'), captionText: $('captionText'), slowtag: $('slowtag'), clock: $('clock'),
  hud: $('hud'), foe: $('foe'), foeParts: $('foeParts'), build: $('build'), go: $('goBtn'),
  result: $('result'), resultMeta: $('resultMeta'), winnerLine: $('winnerLine'), whyLine: $('whyLine'),
  sheet: $('sheet'), sheetGrid: $('sheetGrid'), sheetTitle: $('sheetTitle'),
  credits: $('credits'), creditsBody: $('creditsBody'), busy: $('busy'), busyText: $('busyText'), error: $('error')
};
// The six things on offer; pot and lamp are the textured Lux3D generations.
const OFFER = ['pan-lux3d', 'broom', 'lamp-lux3d', 'scissors', 'slipper', 'pillow'];
// The computer's fixed build.
const FOE = {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'lamp-lux3d', orient: 'hug'}], spread: 'e180'};
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

const isLux = id => id.endsWith('-lux3d');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const toDef = b => ({parts: [{item: b.parts[0].item, mount: 'e0', orient: b.parts[0].orient}, {item: b.parts[1].item, mount: b.spread, orient: b.parts[1].orient}]});
const HINT = {out: '伸出去，转起来抡人', hug: '贴着核心，替它挡'};
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
  const spec = id => { const it = byId.get(id); return `${Math.round(Math.max(...it.bounds.max.map((v, i) => v - it.bounds.min[i])) * 100)} cm · ${it.mass} kg`; };
  const layout = def => def.parts.map(p => ({item: p.item, orient: p.orient, ...mountExtents(byId.get(p.item), p.mount, p.orient, rules)}));
  const sweepOf = def => Math.max(rules.core.radius, ...layout(def).map(p => p.r1));
  const stage = new Stage(el.canvas, {items, coreRadius: rules.core.radius, layout});
  const overlay = new Overlay(stage, el);
  renderCredits(items);

  const q = new URLSearchParams(location.search);
  const mode = q.get('mode') === 'B' ? 'B' : 'A';
  const fromUrl = () => {
    const p = (q.get('mine') ?? '').split(',');
    if (p.length !== 5) return null;
    const b = {parts: [{item: p[0], orient: p[1]}, {item: p[2], orient: p[3]}], spread: p[4]};
    return b.parts.every(x => OFFER.includes(x.item) && ['out', 'hug'].includes(x.orient)) && b.parts[0].item !== b.parts[1].item && ['e180', 'e90'].includes(b.spread) ? b : null;
  };
  const mine = structuredClone(fromUrl() ?? DEFAULT);
  let seed = Number.isInteger(Number(q.get('seed'))) && q.has('seed') ? Number(q.get('seed')) : randomSeed();
  const fixedSeed = q.has('seed');
  await loadModels([...new Set([...mine.parts, ...FOE.parts].map(p => byId.get(p.item)))]);
  el.busy.hidden = true;

  // ---------- state ----------
  let phase = 'loading'; // loading | build | computing | play | finale | result | replay
  let breaksAt = new Set(), pb = null, replay = null, finaleAge = 0, finaleSim = 0, replayEnd = 0, captionHold = 0, spinAngle = 0, liveSlowShown = false;
  const hpView = [0, 1].map(() => ({core: 1, chip: 1, since: 9}));

  // Opponent tag on the build screen.
  el.foeParts.innerHTML = FOE.parts.map(p => `<span>${NAMES[p.item]}${ICON[p.orient]}</span>`).join('');

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
    stage.setFighters([toDef(mine), toDef(FOE)]);
    stage.clearFx();
    overlay.clear();
    stage.setCameraMode('build');
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
      box.innerHTML = def.parts.map(p => `<span class="pc">${ICON[p.orient]}<b>${NAMES[p.item]}</b><span class="mini"><i></i></span></span>`).join('');
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
    el.clock.textContent = pb ? Math.floor(pb.t) : '0';
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

  // ---------- events → effects ----------
  function onEvent(e) {
    const point = e.point ? new THREE.Vector3().fromArray(e.point) : null;
    if (e.type === 'hit' || e.type === 'weak') {
      if (e.role === 'recoil') { stage.flashPart(e.target, e.targetPart, 0.3); return; }
      const core = e.targetPart === 'core', big = core || e.type === 'weak' || e.tier >= 2;
      stage.burst(point, [WHITE, SPARK, TEAM[e.attacker], WHITE], big ? 40 : 22, big ? 2.8 : 2.0, big ? 0.03 : 0.022, big ? 0.6 : 0.45);
      // Core hit: a ring in the victim's colour; a hugging piece taking it: a pale "blocked" ring.
      stage.ring(point, core ? TEAM[e.target] : e.targetOrient === 'hug' ? BLOCK : WHITE, 0.04, big ? 0.75 : 0.5, big ? 0.4 : 0.3);
      stage.flashPart(e.target, e.targetPart, core ? 1 : 0.75);
      // Which piece struck (the striker's colour), crit added; a hugging piece taking it says so, stacked with it.
      if (e.damage > 0) {
        overlay.callout(point, e.attacker, e.item === '__core' ? '核心' : NAMES[e.item], {crit: e.type === 'weak'});
        if (!core && e.targetOrient === 'hug' && e.type === 'hit') overlay.callout(point, e.target, '挡住', {cls: 'block'});
        flashHud(e);
      }
      if (core) overlay.screenFlash(0.18);
      if (e.type === 'weak') { overlay.screenFlash(0.45); stage.ring(point, HOT, 0.05, 0.9, 0.45); }
    } else if (e.type === 'break') {
      stage.breakPart(e.target, Number(e.targetPart.split('-')[1]), e);
      overlay.number(new THREE.Vector3().fromArray(e.pose.pos), `${e.target === 0 ? '你的' : '对手的'}${NAMES[e.item] ?? ''}碎了`, `broke t${e.target}`, 1.8);
      // The camera never moves; only a piece or a core breaking jolts the picture a few px.
      stage.shake(4);
      overlay.screenFlash(0.25);
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
      overlay.showBanner('核心碎了', replay.meta.winner === 0 ? HEX[0] : '#ffffff', 1.3);
    }
    test.onEvent(e);
  }

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
    // Yield to the page every few hundred physics steps so the preview keeps spinning.
    const r = await simulateV3({fighters: [toDef(mine), toDef(FOE)], mode, seed, onProgress: () => new Promise(res => setTimeout(res, 0))});
    test.simMs = performance.now() - t0;
    if (id !== runId) return;
    el.busy.hidden = true;
    replay = r;
    breaksAt = new Set(r.events.filter(x => x.type === 'break').map(x => `${x.t}|${x.target}|${x.targetPart}`));
    pb = new Playback(r);
    liveSlowShown = false;
    stage.setFighters(r.meta.initial.map(f => f.definition));
    stage.clearFx();
    overlay.clear();
    stage.setCameraMode('fight');
    buildHud(r.meta.initial.map(f => f.definition));
    for (const h of hpView) Object.assign(h, {core: 1, chip: 1, since: 9});
    [0, 1].forEach(i => overlay.setCoreHp(i, 1, true));
    el.build.hidden = true;
    el.foe.hidden = true;
    el.hud.hidden = false;
    setCaption(false, reasonLine(r));
    captionHold = 0;
    layout_();
    stage.pose(pb.state);
    stage.updateCamera(0, true);
    phase = 'play';
    overlay.showBanner('开转', '#ffffff', 0.8);
    // Shareable address on a normal page; sandboxed viewers (opaque origin) refuse URL changes, which is fine.
    try { history.replaceState(null, '', `?mine=${[mine.parts[0].item, mine.parts[0].orient, mine.parts[1].item, mine.parts[1].orient, mine.spread].join(',')}${fixedSeed ? `&seed=${seed}` : ''}${mode === 'B' ? '&mode=B' : ''}`); } catch { /* sandboxed viewer */ }
  }
  function showResult() {
    if (pb.t < pb.end - 1e-6) {
      stage.clearFx();
      overlay.clear();
      pb.seek(pb.end);
      stage.pose(pb.state);
    }
    phase = 'result';
    const m = replay.meta;
    stage.setCameraMode('result');
    el.winnerLine.textContent = m.winner === null ? '平局' : m.winner === 0 ? '你赢了' : '你输了';
    el.result.className = m.winner === null ? 'draw' : m.winner === 0 ? 'win' : 'lose';
    el.resultMeta.textContent = `第 ${Math.round(m.duration)} 秒 · ${m.reason === 'timeout' ? '时间到' : m.reason === 'double-ko' ? '两颗核心同时碎了' : '核心碎了'}`;
    el.whyLine.textContent = reasonLine(replay);
    $('replayBtn').hidden = pb.slowAt === null;
    setCaption(false);
    el.result.hidden = false;
    layout_();
    if (m.winner !== null) stage.revealOnResult(m.winner, el.result.offsetTop);
  }
  function replaySlow() {
    if (!pb || pb.slowAt === null) return;
    el.result.hidden = true;
    stage.clearFx();
    overlay.clear();
    pb.slowEnabled = true;
    stage.setCameraMode('fight');
    pb.seek(pb.replayFrom);
    replayEnd = 0;
    stage.pose(pb.state);
    phase = 'replay';
    layout_();
  }

  // ---------- controls ----------
  let sheetSlot = 0;
  function openSheet(k) {
    sheetSlot = k;
    el.sheetTitle.textContent = k ? '第二件' : '第一件';
    el.sheetGrid.innerHTML = '';
    const other = mine.parts[1 - k].item;
    for (const id of OFFER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = id === mine.parts[k].item ? 'sel' : '';
      b.disabled = id === other;
      b.innerHTML = `<b>${NAMES[id]}</b><small>${isLux(id) ? '<i class="lux">Lux3D</i>' : ''}${spec(id)}</small>${id === other ? '<span class="used">已装</span>' : ''}`;
      b.onclick = () => { mine.parts[k].item = id; el.sheet.hidden = true; rebuildMine(); };
      el.sheetGrid.append(b);
    }
    el.sheet.hidden = false;
  }
  document.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { if (phase === 'build') openSheet(Number(b.dataset.pick)); }; });
  document.querySelectorAll('.slot').forEach(slot => slot.querySelectorAll('[data-orient]').forEach(b => {
    b.onclick = () => { if (phase !== 'build') return; mine.parts[Number(slot.dataset.slot)].orient = b.dataset.orient; rebuildMine(); };
  }));
  document.querySelectorAll('[data-spread]').forEach(b => { b.onclick = () => { if (phase !== 'build') return; mine.spread = b.dataset.spread; rebuildMine(); }; });
  $('sheetClose').onclick = () => { el.sheet.hidden = true; };
  el.sheet.onclick = e => { if (e.target === el.sheet) el.sheet.hidden = true; };
  el.go.onclick = () => start();
  $('replayBtn').onclick = () => replaySlow();
  $('againBtn').onclick = () => showBuild();
  $('creditsBtn').onclick = () => { el.credits.hidden = false; };
  $('creditsClose').onclick = () => { el.credits.hidden = true; };
  el.credits.onclick = e => { if (e.target === el.credits) el.credits.hidden = true; };

  // ---------- layout ----------
  function layout_() {
    const w = el.app.clientWidth, h = el.app.clientHeight;
    const building = !el.build.hidden;
    // Fight and result share one fixed frame: below the HUD, above the decisive caption's place, whether or not
    // the caption is showing, so nothing that appears or goes away ever moves the camera.
    const top = building ? el.foe.offsetHeight : el.hud.offsetHeight;
    const bottom = building ? el.build.offsetHeight : el.caption.offsetHeight + 24;
    stage.resize(w, h, top, bottom);
  }
  new ResizeObserver(layout_).observe(el.app);

  // ---------- test hooks (Playwright screenshots; no effect on normal play) ----------
  const test = {
    frozen: false, freezeOn: null, freezeDelay: 0, pending: -1, simMs: 0, nth: 1, seen: 0, speed: 1, safe: null,
    onEvent(e) {
      if (!this.freezeOn || this.pending >= 0) return;
      const ok = this.freezeOn === 'break' ? e.type === 'break' : this.freezeOn === 'hit' ? (e.type === 'hit' || e.type === 'weak') && e.role === 'attack' : this.freezeOn === 'core' ? (e.type === 'hit' || e.type === 'weak') && e.role === 'attack' && e.targetPart === 'core' : false;
      if (ok && ++this.seen >= this.nth) this.pending = this.freezeDelay;
    }
  };
  window.__top = {
    status: () => ({phase, frozen: test.frozen, t: pb?.t ?? 0, simMs: test.simMs, seed, mine: structuredClone(mine), meta: replay && {...replay.meta, initial: undefined, rules: undefined}, decisive: replay?.decisive, reason: replay && reasonLine(replay), caption: el.caption.classList.contains('on')}),
    freezeOn(type, delayMs = 60, nth = 1) { Object.assign(test, {freezeOn: type, freezeDelay: delayMs / 1000, pending: -1, nth, seen: 0}); },
    freeze() { test.frozen = true; },
    release() { Object.assign(test, {frozen: false, freezeOn: null, pending: -1}); },
    // Safe-area audit: worst overflow per phase over every rendered frame (px > 0 means something was cut off).
    trackSafe(speed = 1) { test.speed = speed; test.safe = {}; },
    safe: () => test.safe,
    setBuild(b) { Object.assign(mine, structuredClone(b)); rebuildMine(); },
    stage,
    overlay,
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
    let simDt = dt;
    if (phase === 'build' || phase === 'computing') {
      spinAngle += dt * PREVIEW_SPIN;
      stage.pose(previewState());
    } else if (phase === 'play' || phase === 'replay') {
      simDt = pb.advance(dt, 1, onEvent);
      stage.pose(pb.state);
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
      el.slowtag.classList.toggle('on', phase === 'finale' && pb.slowAmount(v) > 0.3);
      if (phase === 'finale' && finaleAge > 1.4 && pb.slowFactor(v) > 0.99) showResult();
    }
    stage.updateCamera(dt, false);
    if (test.safe && dt > 0 && phase !== 'build' && phase !== 'computing') {
      const o = stage.safeOverflow(), cur = test.safe[phase];
      if (!cur || o.px > cur.px) test.safe[phase] = {...o, t: +(pb?.t ?? 0).toFixed(2), w: el.app.clientWidth};
    }
    stage.render(dt, simDt);
    overlay.update(dt, true);
    if (pb && phase !== 'build' && phase !== 'computing') { updateHud(dt, pb.state); updateHudFlash(dt); }
  }
  showBuild();
  requestAnimationFrame(frame);
  if (q.get('autoplay') === '1') start();
}

main().catch(showError);
