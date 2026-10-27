import * as THREE from 'three';
import {loadCatalog, loadRules, simulate} from '../../sim/index.js';
import creditsMd from '../../data/CREDITS.md?raw';
import {loadModels} from './models.js';
import {Stage, TEAM} from './stage.js';
import {Playback} from './playback.js';
import {Overlay} from './overlay.js';

const $ = id => document.getElementById(id);
const el = {
  app: $('app'), canvas: $('view'), fx: $('fx'), flash: $('flash'), banner: $('banner'),
  caption: $('caption'), captionText: $('captionText'), captionTag: $('captionTag'), slowtag: $('slowtag'), clock: $('clock'),
  result: $('result'), winnerLine: $('winnerLine'), reasonLine: $('reasonLine'), whyLine: $('whyLine'),
  controls: $('controls'), hud: $('hud'), seed: $('seedInput'), go: $('goBtn'),
  sheet: $('sheet'), sheetGrid: $('sheetGrid'), sheetTitle: $('sheetTitle'),
  credits: $('credits'), creditsBody: $('creditsBody'), busy: $('busy'), busyText: $('busyText'), error: $('error')
};
const MAX_SEED = 0xffffffff;
const REASON = {ko: '血量打空', ringout: '被撞出擂台', 'double-ko': '同归于尽', timeout: '时间到'};
const MODE_NAME = {A: '物理', B: '数值'};
const HEX = TEAM.map(c => '#' + c.getHexString());
const WHITE = new THREE.Color('#ffffff'), HOT = new THREE.Color('#ffe14d'), RED = new THREE.Color('#ff4d5e');

function showError(err) {
  el.error.hidden = false;
  el.error.textContent = `出错了：${err?.message ?? err}`;
  console.error(err);
}
addEventListener('error', e => showError(e.error ?? e.message));
addEventListener('unhandledrejection', e => showError(e.reason));

// How the match ended; older replays without finishType are inferred from meta.reason.
const finishOf = r => r.decisive.finishType ?? (r.meta.reason === 'ringout' ? 'ringout' : r.meta.reason === 'timeout' ? 'timeout' : 'contact');
const randomSeed = () => Math.floor(Math.random() * MAX_SEED);
// Lux3D items (generated from a photo) keep a short name plus a small tag.
const isLux = item => /Lux3D/i.test(item.name) || item.glb.includes('/lux3d/');
const shortName = item => item.name.replace(/[（(]Lux3D[)）]\s*$/i, '');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nameHtml = item => esc(shortName(item)) + (isLux(item) ? '<i class="lux">Lux3D</i>' : '');
const sizeCm = item => Math.round(Math.max(...item.bounds.max.map((v, k) => v - item.bounds.min[k])) * 100);
const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

function renderCredits(items) {
  // The attribution table and notes from data/CREDITS.md (with links); items it does not
  // list yet (e.g. Lux3D generations) fall back to the catalog's own source fields.
  const link = s => s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const html = [];
  let list = false, tableHead = false;
  const close = () => { if (list) html.push('</ul>'); list = false; };
  for (const line of creditsMd.split('\n')) {
    const l = line.trim();
    if (/^\|/.test(l)) {
      if (/^\|[\s|:-]+\|$/.test(l)) continue; // separator row
      if (!list) { html.push('<ul>'); list = true; tableHead = true; }
      if (tableHead) { tableHead = false; continue; } // header row
      html.push(`<li>${l.split('|').slice(1, -1).map(c => link(esc(c.trim()))).join(' · ')}</li>`);
      continue;
    }
    close();
    if (/^# /.test(l) || !l) continue;
    if (/^##+ /.test(l)) html.push(`<h4>${esc(l.replace(/^#+ /, ''))}</h4>`);
    else html.push(`<p>${link(esc(l))}</p>`);
  }
  close();
  // Anything the credits file does not mention yet falls back to the catalog's source fields.
  const extra = items.filter(i => !creditsMd.includes(i.glb.split('/').pop()) && !creditsMd.includes(i.name));
  if (extra.length) html.push('<ul>' + extra.map(i => `<li>${esc(i.name)} · ${esc(i.source?.author ?? '')} · ${esc(i.source?.license ?? '')} · ${link(esc(i.source?.url ?? ''))}</li>`).join('') + '</ul>');
  el.creditsBody.innerHTML = html.join('');
}

async function main() {
  el.busy.hidden = false;
  const [items, rules] = await Promise.all([loadCatalog(), loadRules()]);
  const byId = new Map(items.map(i => [i.id, i]));
  const arena = rules.arena;
  const stage = new Stage(el.canvas, rules);
  const overlay = new Overlay(stage, el);
  renderCredits(items);

  const q = new URLSearchParams(location.search);
  const pickRandom = exclude => {
    const pool = items.filter(i => i.id !== exclude);
    return pool[Math.floor(Math.random() * pool.length)].id;
  };
  const urlSeed = q.has('seed') ? Number(q.get('seed')) : NaN;
  const s = {
    a: byId.has(q.get('a')) ? q.get('a') : pickRandom(),
    b: null,
    mode: q.get('mode') === 'B' ? 'B' : 'A',
    seed: Number.isInteger(urlSeed) && urlSeed >= 0 && urlSeed <= MAX_SEED ? urlSeed : randomSeed(),
    speed: q.get('speed') === '0.5' ? 0.5 : 1
  };
  s.b = byId.has(q.get('b')) ? q.get('b') : pickRandom(s.a);
  await loadModels([byId.get(s.a), byId.get(s.b)]);
  el.busy.hidden = true;

  // ---------- match state ----------
  let phase = 'loading'; // loading | idle | play | finale | result | replay
  let pb = null, replay = null, finish = 'contact', autoReplay = false, finaleAge = 0, finaleSim = 0, replayEnd = 0, captionHold = 0, idleSpin = 0;
  const hpView = [0, 1].map(() => ({hp: 1, chip: 1, since: 0}));
  const def = id => ({parts: [{item: id, mount: 'core', rot: [0, 0, 0]}]});

  function idleState() {
    const st = {zoneRadius: arena.zoneStartRadius, fighters: []};
    [s.a, s.b].forEach((id, i) => {
      const pos = new THREE.Vector3(i === 0 ? -1.25 : 1.25, 0, 0);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25 * Math.sin(idleSpin * 0.7 + i), (i === 0 ? 1 : -1) * Math.PI / 2 + idleSpin * 0.6, 0.15));
      st.fighters.push({pos, quat, hp: 1, maxHp: 1, parts: [{pos, quat}]});
    });
    return st;
  }
  let idleReq = 0;
  async function showIdle() {
    const req = ++idleReq;
    el.busyText.textContent = '载入中';
    el.busy.hidden = false;
    await loadModels([byId.get(s.a), byId.get(s.b)]);
    el.busy.hidden = true;
    if (req !== idleReq) return;
    phase = 'idle';
    stage.setFighters([def(s.a), def(s.b)]);
    stage.clearFx();
    overlay.clear();
    stage.pose(idleState());
    stage.updateCamera(0, true);
    for (const h of hpView) Object.assign(h, {hp: 1, chip: 1});
    el.result.hidden = true;
    setCaption(false);
    syncControls();
  }

  // ---------- HUD ----------
  function setCaption(on, text) {
    if (text !== undefined) el.captionText.textContent = text;
    el.caption.classList.toggle('on', on);
    // Keep the fighters framed above the caption while it is up.
    stage.setBottomPanel(on ? el.caption.offsetHeight + 8 : 0);
  }
  function updateHud(dt, state) {
    [0, 1].forEach(i => {
      const f = state.fighters[i];
      const v = hpView[i];
      const frac = Math.max(0, f.hp / f.maxHp);
      if (frac < v.hp - 1e-6) v.since = 0;
      v.hp = frac;
      v.since += dt;
      if (v.since > 0.45) v.chip = Math.max(v.hp, v.chip - dt * 0.6);
      if (v.chip < v.hp) v.chip = v.hp;
      $(`fill${i}`).style.transform = `scaleX(${v.hp})`;
      $(`chip${i}`).style.transform = `scaleX(${v.chip})`;
      $(`hp${i}`).textContent = phase === 'idle' ? `${arena.fighterHp ?? byId.get(i ? s.b : s.a).stats.hp}` : `${Math.ceil(f.hp)}`;
    });
    el.clock.textContent = pb && phase !== 'idle' ? Math.floor(pb.t) : '0';
  }
  function syncControls() {
    [0, 1].forEach(i => {
      const item = byId.get(i ? s.b : s.a);
      const btn = $(`pick${i}`);
      btn.querySelector('b').innerHTML = nameHtml(item);
      btn.querySelector('small').textContent = isLux(item) ? '' : `${sizeCm(item)} cm`; // the tag needs the room
      if (phase === 'idle') $(`name${i}`).innerHTML = nameHtml(item);
    });
    for (const b of document.querySelectorAll('#modeSeg button')) b.setAttribute('aria-checked', String(b.dataset.mode === s.mode));
    for (const b of document.querySelectorAll('#speedSeg button')) b.setAttribute('aria-checked', String(Number(b.dataset.speed) === s.speed));
    if (document.activeElement !== el.seed) el.seed.value = String(s.seed);
    const playing = phase === 'play' || phase === 'finale' || phase === 'replay';
    el.go.classList.toggle('restart', playing);
    el.go.querySelector('span').textContent = playing ? '重开' : '开打';
    el.go.querySelector('svg').innerHTML = playing ? '<path d="M12 5a7 7 0 1 1-6.6 4.7" /><path d="M5 4v5h5" />' : '<path d="M7 5l12 7-12 7z" />';
  }

  // ---------- events → effects ----------
  function onEvent(e) {
    const tgt = e.target, att = e.attacker;
    const point = new THREE.Vector3().fromArray(e.point);
    const center = stage.fighters[tgt].center;
    // Numbers sit on the target's far side, so the two numbers of one contact don't stack.
    const away = center.clone().sub(stage.fighters[1 - tgt].center);
    const numAt = center.clone().addScaledVector(away.normalize(), stage.fighters[tgt].radius * 0.6);
    const dmg = e.damage >= 10 ? Math.round(e.damage) : e.damage.toFixed(1);
    if (e.role === 'recoil') {
      // The striker's own small jolt: keep it quiet so the real hit reads as the cause.
      stage.flashFighter(tgt, 0.25);
      overlay.number(numAt, `-${dmg}`, 'recoil');
    } else if (e.type === 'hit') {
      stage.burst(point, [WHITE, TEAM[att]], 10, 1.4, 0.018, 0.45);
      stage.flashFighter(tgt, 0.55);
      stage.shake(0.3);
      overlay.number(numAt, `-${dmg}`, `t${tgt}`);
    } else if (e.type === 'crit' || e.type === 'weak') {
      const weak = e.type === 'weak';
      overlay.screenFlash(weak ? 0.6 : 0.45);
      stage.burst(point, weak ? [HOT, WHITE, HOT] : [WHITE, HOT, TEAM[att]], weak ? 40 : 30, 2.6, 0.026, 0.7);
      stage.ring(point, weak ? HOT : WHITE, 0.05, weak ? 0.9 : 0.7, 0.45);
      if (weak) stage.ring(point, HOT, 0.05, 0.45, 0.3);
      stage.flashFighter(tgt, 1);
      stage.shake(weak ? 0.9 : 0.7);
      overlay.number(numAt, `-${dmg}`, weak ? 'weak' : 'big', weak ? '弱点 ×2' : '暴击');
    } else if (e.type === 'zone') {
      overlay.number(center.clone(), `-${dmg}`, 'zone');
    } else if (e.type === 'ko' && finish === 'zone') {
      // Died to the shrinking zone: say it plainly, no knockout fanfare.
      stage.burst(center, [RED, TEAM[tgt]], 18, 0.8, 0.02, 1.0);
      stage.dimFighter(tgt);
      stage.shake(0.2);
      overlay.showBanner('圈外倒下', '#ff6b78', 1.4);
    } else if (e.type === 'ko') {
      stage.burst(center, [TEAM[tgt], WHITE, TEAM[tgt]], 60, 3.2, 0.03, 1.1);
      stage.ring(center, TEAM[tgt], 0.1, 1.6, 0.7);
      stage.flashFighter(tgt, 1);
      stage.dimFighter(tgt);
      stage.shake(1.1);
      overlay.screenFlash(0.5);
      overlay.showBanner('KO', HEX[att ?? 0], 1.2);
    } else if (e.type === 'ringout') {
      stage.burst(point, [RED, WHITE, TEAM[tgt]], 50, 3, 0.03, 1.0);
      stage.ring(point, RED, 0.1, 1.8, 0.7);
      stage.shake(1);
      overlay.screenFlash(0.35);
      overlay.showBanner('出界', HEX[att ?? 0], 1.2);
    }
    test.onEvent(e);
  }

  // ---------- run ----------
  let runId = 0;
  async function start() {
    const raw = el.seed.value.trim() || String(s.seed);
    const seed = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(seed) || seed > MAX_SEED) {
      el.seed.parentElement.style.boxShadow = 'inset 0 0 0 2px #ff4d5e';
      return;
    }
    el.seed.parentElement.style.boxShadow = '';
    s.seed = seed;
    const id = ++runId;
    idleReq++; // a pending idle preview must not override the match
    el.busyText.textContent = '计算中';
    el.busy.hidden = false;
    el.result.hidden = true;
    await loadModels([byId.get(s.a), byId.get(s.b)]);
    await nextPaint();
    const t0 = performance.now();
    const r = await simulate({fighters: [def(s.a), def(s.b)], mode: s.mode, seed: s.seed});
    test.simMs = performance.now() - t0;
    if (id !== runId) return;
    el.busy.hidden = true;
    replay = r;
    finish = finishOf(r);
    pb = new Playback(r);
    // A zone death's biggest real hit happened mid-fight: show it as a replay after the end instead.
    pb.slowEnabled = finish !== 'zone';
    autoReplay = finish === 'zone' && pb.slowAt !== null;
    el.captionTag.textContent = finish === 'ringout' ? '决定性一击 · 出界' : '决定性一击';
    stage.setFighters(r.meta.initial.map(f => f.definition));
    stage.clearFx();
    overlay.clear();
    stage.pose(pb.state);
    stage.updateCamera(0, true);
    for (const h of hpView) Object.assign(h, {hp: 1, chip: 1, since: 9});
    [0, 1].forEach(i => { $(`name${i}`).innerHTML = r.meta.initial[i].definition.parts.map(p => nameHtml(byId.get(p.item))).join('+'); });
    setCaption(false, r.decisive.caption);
    captionHold = 0;
    phase = 'play';
    overlay.showBanner('开打', '#ffffff', 0.9);
    history.replaceState(null, '', `?a=${s.a}&b=${s.b}&mode=${s.mode}&seed=${s.seed}`);
    syncControls();
  }
  function showResult() {
    if (pb.t < pb.end - 1e-6) {
      // Back from a mid-match replay: put the board back to how the match ended.
      stage.clearFx();
      overlay.clear();
      pb.seek(pb.end);
      stage.pose(pb.state);
      for (const e of replay.events) if (e.type === 'ko') stage.dimFighter(e.target);
      for (const [i, f] of pb.state.fighters.entries()) Object.assign(hpView[i], {hp: f.hp / f.maxHp, chip: f.hp / f.maxHp, since: 9});
      for (const f of pb.state.fighters) f.vel.set(0, 0, 0);
    }
    phase = 'result';
    const m = replay.meta;
    const names = m.initial.map(f => f.definition.parts.map(p => nameHtml(byId.get(p.item))).join('+'));
    el.winnerLine.innerHTML = m.winner === null ? '平局' : `<em style="color:${HEX[m.winner]}">${names[m.winner]}</em> 胜`;
    const why = finish === 'zone' ? '在圈外掉光了血' : m.reason === 'double-ko' && m.winner !== null ? '同时倒下，按撞击方判胜' : REASON[m.reason] ?? m.reason;
    el.reasonLine.textContent = `${why} · ${m.duration.toFixed(1)} 秒 · ${MODE_NAME[m.mode]} · #${m.seed}`;
    el.whyLine.textContent = replay.decisive.caption;
    $('replayBtn').hidden = pb.slowAt === null;
    setCaption(false);
    el.result.hidden = false;
    stage.setBottomPanel(el.result.offsetHeight + 8);
    syncControls();
  }
  function replaySlow() {
    if (!pb) return;
    el.result.hidden = true;
    stage.clearFx();
    overlay.clear();
    pb.slowEnabled = true;
    el.captionTag.textContent = `${finish === 'zone' ? '最大一击' : '决定性一击'} · 回放`;
    // Anchored on the decisive hit itself (see decisiveAnchor), not on decisive.t0/t1.
    pb.seek(pb.replayFrom);
    replayEnd = 0;
    stage.pose(pb.state);
    for (const [i, f] of pb.state.fighters.entries()) Object.assign(hpView[i], {hp: f.hp / f.maxHp, chip: f.hp / f.maxHp, since: 9});
    phase = 'replay';
    syncControls();
  }

  // ---------- controls ----------
  let sheetSide = 0;
  function openSheet(side) {
    sheetSide = side;
    el.sheet.querySelector('.panel').className = `panel sheet${side}`;
    el.sheetTitle.textContent = side ? '右边（蓝）' : '左边（橙）';
    const current = side ? s.b : s.a;
    el.sheetGrid.innerHTML = '';
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = item.id === current ? 'sel' : '';
      b.innerHTML = `<b>${nameHtml(item)}</b><small>${sizeCm(item)} cm</small>`;
      b.onclick = () => choose(item.id);
      el.sheetGrid.append(b);
    }
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'rand';
    r.innerHTML = '<b>随机</b><small>?</small>';
    r.onclick = () => choose(pickRandom(side ? s.a : s.b));
    el.sheetGrid.append(r);
    el.sheet.hidden = false;
  }
  function choose(id) {
    if (sheetSide) s.b = id; else s.a = id;
    el.sheet.hidden = true;
    if (phase === 'idle' || phase === 'result') showIdle();
    syncControls();
  }
  $('pick0').onclick = () => openSheet(0);
  $('pick1').onclick = () => openSheet(1);
  $('sheetClose').onclick = () => { el.sheet.hidden = true; };
  el.sheet.onclick = e => { if (e.target === el.sheet) el.sheet.hidden = true; };
  $('shuffleBtn').onclick = () => {
    s.a = pickRandom();
    s.b = pickRandom(s.a);
    if (phase === 'idle' || phase === 'result') showIdle();
    syncControls();
  };
  for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => { s.mode = b.dataset.mode; syncControls(); };
  for (const b of document.querySelectorAll('#speedSeg button')) b.onclick = () => { s.speed = Number(b.dataset.speed); syncControls(); };
  $('reseedBtn').onclick = () => { s.seed = randomSeed(); el.seed.value = String(s.seed); el.seed.parentElement.style.boxShadow = ''; };
  el.seed.addEventListener('input', () => {
    el.seed.value = el.seed.value.replace(/\D/g, '');
    const v = Number(el.seed.value);
    if (el.seed.value && v <= MAX_SEED) { s.seed = v; el.seed.parentElement.style.boxShadow = ''; }
  });
  el.go.onclick = () => start();
  $('replayBtn').onclick = () => replaySlow();
  $('againBtn').onclick = () => { s.seed = randomSeed(); el.seed.value = String(s.seed); start(); };
  $('creditsBtn').onclick = () => { el.credits.hidden = false; };
  $('creditsClose').onclick = () => { el.credits.hidden = true; };
  el.credits.onclick = e => { if (e.target === el.credits) el.credits.hidden = true; };

  // ---------- layout ----------
  function layout() {
    const w = el.app.clientWidth, h = el.app.clientHeight;
    const top = el.hud.offsetHeight, bottom = el.controls.offsetHeight;
    el.caption.style.bottom = el.result.style.bottom = `${bottom + 8}px`;
    stage.resize(w, h, top, bottom);
  }
  new ResizeObserver(layout).observe(el.app);
  layout();

  // ---------- test hooks (Playwright screenshots; no effect on normal play) ----------
  const test = {
    frozen: false, freezeOnType: null, freezeDelay: 0, pending: -1, simMs: 0,
    onEvent(e) {
      // 'decisive' = the anchored hit while slow motion is on; a type list skips that hit.
      const hit = this.freezeOnType === 'decisive' ? e === pb.decisiveEvent && pb.slowEnabled : e !== pb.decisiveEvent && this.freezeOnType?.includes(e.type);
      if (hit && this.pending < 0) this.pending = this.freezeDelay;
    }
  };
  window.__wanwu = {
    status: () => ({phase, frozen: test.frozen, t: pb?.t ?? 0, slow: pb ? pb.slowAmount(pb.t) : 0, anchor: pb?.decisiveEvent ? {t: pb.decisiveEvent.t, type: pb.decisiveEvent.type, index: replay.events.indexOf(pb.decisiveEvent)} : null, caption: el.caption.classList.contains('on'), simMs: test.simMs, meta: replay && {...replay.meta, initial: undefined}, decisive: replay?.decisive, events: replay?.events.length}),
    freezeOn(types, delayMs = 60) { test.freezeOnType = types; test.freezeDelay = delayMs / 1000; test.pending = -1; },
    freeze() { test.frozen = true; },
    release() { test.frozen = false; test.freezeOnType = null; test.pending = -1; },
    start,
    stage,
    seek(t) { if (phase === 'play') { pb.seek(t); stage.pose(pb.state); } }
  };

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (test.pending >= 0) {
      test.pending -= dt;
      if (test.pending < 0) { test.frozen = true; test.freezeOnType = null; }
    }
    if (test.frozen) dt = 0;
    if (phase === 'loading') return; // fighters not built yet
    let simDt = dt;
    if (phase === 'idle') {
      idleSpin += dt;
      stage.pose(idleState());
    } else if (phase === 'play' || phase === 'replay') {
      simDt = pb.advance(dt, s.speed, onEvent);
      stage.pose(pb.state);
      const slow = pb.slowAmount(pb.t);
      stage.setPush(pb.pushAmount(pb.t), pb.decisiveEvent && new THREE.Vector3().fromArray(pb.decisiveEvent.point));
      el.slowtag.classList.toggle('on', slow > 0.3);
      if (pb.inDecisive(pb.t)) { setCaption(true); captionHold = 1.6; }
      else if (captionHold > 0) { captionHold -= dt; if (captionHold <= 0) setCaption(false); }
      if (phase === 'replay' && pb.t < pb.end && pb.t >= pb.replayTo - 1e-9 && pb.hold <= 0) {
        replayEnd += dt;
        if (replayEnd > 0.6) showResult();
      } else if (pb.done) {
        if (phase === 'play' && finish === 'timeout') overlay.showBanner('时间到', '#ffffff', 1.3);
        phase = 'finale';
        finaleAge = finaleSim = 0;
      }
    } else if (phase === 'finale' || phase === 'result') {
      // Coast after the last frame (ring-outs keep flying). A finishing blow lands at the very end
      // of the replay, so the rest of its slow motion plays out here at the same slowed rate.
      finaleAge += dt;
      const v = pb.end + finaleSim;
      simDt = phase === 'finale' ? dt * s.speed * pb.slowFactor(v) : dt;
      finaleSim += simDt;
      const drift = Math.exp(-finaleSim * 1.6);
      for (const f of pb.state.fighters) {
        const step = f.vel.clone().multiplyScalar(simDt * drift);
        f.pos.add(step);
        for (const p of f.parts) p.pos.add(step);
      }
      stage.pose(pb.state);
      stage.setPush(phase === 'finale' ? pb.pushAmount(v) : 0);
      el.slowtag.classList.toggle('on', phase === 'finale' && pb.slowAmount(v) > 0.3);
      if (phase === 'finale' && finaleAge > (finish === 'contact' ? 1.3 : 1.6) && pb.slowFactor(v) > 0.99) {
        if (autoReplay) { autoReplay = false; replaySlow(); } else showResult();
      }
    }
    stage.updateCamera(dt, false);
    stage.render(dt, simDt);
    overlay.update(dt, true);
    updateHud(dt, phase === 'idle' ? idleState() : pb.state);
  }
  syncControls();
  showIdle();
  requestAnimationFrame(frame);
  if (q.get('autoplay') === '1') start();
}

main().catch(showError);
