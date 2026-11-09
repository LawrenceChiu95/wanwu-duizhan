import * as THREE from 'three';
import {loadCatalog, registerItems} from '../../sim/index.js';
import {simulateV3, createV3Match, loadV3Rules, mountExtents, warmEngine, POSITION_COMBAT_RULES} from '../../sim/v3.js';
import creditsMd from '../../data/CREDITS.md?raw';
import ladderJson from '../../data/foes.json';
import {loadModels, pictureUrl, stillUrl, outlinePath, itemThumbnail} from './models.js';
import {LiveTurns} from './livecards.js';
import {GRADES, STATS, ratingOf, byGrade} from './rating.js';
import {Stage, TEAM, CORE_TRAVEL, CORE_RISE, CAM} from './stage.js';
import {Playback} from './playback.js';
import {Overlay} from './overlay.js';
import {reasonLine, endLine, matchStats, pickStats, tipLine, NAMES, setNames, wholeSeconds} from './reason.js';
import {sfx} from './sfx.js';
import {shootApi} from './shoot-api.js';
import {catLabel, mountShoot, readQuota, shootOpen} from './shoot.js';

const $ = id => document.getElementById(id);
const el = {
  app: $('app'), canvas: $('view'), fx: $('fx'), flash: $('flash'), banner: $('banner'),
  caption: $('caption'), captionText: $('captionText'), slowtag: $('slowtag'), clock: $('clock'),
  hud: $('hud'), foe: $('foe'), foeParts: $('foeParts'), build: $('build'), go: $('goBtn'),
  result: $('result'), resultMeta: $('resultMeta'), winnerLine: $('winnerLine'), whyLine: $('whyLine'), statsList: $('statsList'), tipLine: $('tipLine'),
  foeSheet: $('foeSheet'), foeList: $('foeList'),
  library: $('library'), libGrid: $('libGrid'), libTitle: $('libTitle'), libCount: $('libCount'), libGrades: $('libGrades'),
  resultBuild: $('resultBuild'), how: $('howView'), howTitle: $('howTitle'), howShot: $('howShot'), howTurn: $('howTurn'), howCat: $('howCat'), howNow: $('howNow'),
  howBar: $('howBar'), howSteps: $('howSteps'), howTotal: $('howTotal'), howEquip: $('howEquip'), howNote: $('howNote'),
  shoot: $('shootView'), shootBtn: $('shootBtn'),
  credits: $('credits'), creditsBody: $('creditsBody'), busy: $('busy'), busyText: $('busyText'), error: $('error'),
  coach: $('coach'), coachTag: $('coachTag'), coachText: $('coachText'),
  pad: $('pad'), dashBtn: $('dashBtn'), blockBtn: $('blockBtn'), dashNope: $('dashNope'), blockNope: $('blockNope'), mute: $('muteBtn'), camSeg: $('camSeg')
};
// Manual mode: the sim runs live this far ahead of what is shown (a press is taken at the next physics step).
const LIVE_LEAD = 0.05;
// The trial page (远夏 77df1bda, Elara 910599fc) offers 凡朔's twelve (Sol's rated items, in his order), then the player's
// own photos, not the drafts a comparisonBase replaces. The earlier items stay in the catalog only for the three
// opponents, until theirs are made of his things.
const ROSTER = ['fanshuo-knife', 'fanshuo-pot', 'fanshuo-cushion', 'fanshuo-mouse', 'fanshuo-plate', 'fanshuo-shaver', 'fanshuo-chair',
  'fanshuo-roller', 'fanshuo-camera', 'fanshuo-feather', 'fanshuo-rabbit', 'fanshuo-cup'];
const EARLIER = new Set(['scissors', 'lamp', 'broom', 'pot', 'slipper', 'pillow', 'pan-lux3d', 'lamp-lux3d', 'wasteland-knife', 'wasteland-pot', 'wasteland-broom']);
const offerOf = items => {
  const replaced = new Set(items.map(i => i.comparisonBase).filter(Boolean));
  const rank = id => ROSTER.includes(id) ? ROSTER.indexOf(id) : ROSTER.length;
  return items.map(i => i.id).filter(id => !replaced.has(id) && !EARLIER.has(id)).sort((a, b) => rank(a) - rank(b));
};
// The computer's default build; ?foe= can override it for measurements.
const DEFAULT_FOE = {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'lamp-lux3d', orient: 'hug'}], spread: 'e180'};
// 换个对手 (MVP 规格 §4-2; Elara 11-02 470a4546): the computer's builds to pick from, strong to weak by Sol's R8 two-piece
// check (test/mvp/results-combo-check-r2: each pair at its best layout against a fixed pool of opponents). The default first.
const FOES = [
  {level: '默认', build: DEFAULT_FOE},
  {level: '强', rank: 'hi', build: {parts: [{item: 'broom', orient: 'out'}, {item: 'pillow', orient: 'out'}], spread: 'e90'}},
  {level: '偏强', rank: 'hi', build: {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'slipper', orient: 'out'}], spread: 'e90'}},
  {level: '中', rank: 'mid', build: {parts: [{item: 'broom', orient: 'out'}, {item: 'slipper', orient: 'out'}], spread: 'e180'}},
  {level: '弱', rank: 'lo', build: {parts: [{item: 'scissors', orient: 'out'}, {item: 'slipper', orient: 'hug'}], spread: 'e180'}}
];
const SPREAD = {e180: '对面', e90: '挨着'};
// 三个对手 (task #86, Elara 2a3c7171): one harder than the last, each won unlocks the next. Progress stays on this phone.
// A page built for one set of rules (__COMBAT__, vite.config.js) takes the foe builds tuned for them where there are any
// (judgeBuilds.<current|position>.<foe id>, Sol b54239d2); names, notes and AI stay the shared ones.
const LADDER = ladderJson.foes.map(f => { const build = __COMBAT__ && ladderJson.judgeBuilds?.[__COMBAT__]?.[f.id]; return build ? {...f, build} : f; });
const LADDER_KEY = 'wanwu-ladder';
const SVG = {
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>',
  open: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.6-1.8" /></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" /></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h13" /><path d="M13 6l6 6-6 6" /></svg>'
};
// Sol bccac3b7: 锅 out, 抱枕 hugging.
const DEFAULT = {parts: [{item: 'fanshuo-pot', orient: 'out'}, {item: 'fanshuo-cushion', orient: 'hug'}], spread: 'e180'};
const PREVIEW_SPIN = 2.4;
const RESULT_SPIN = 1.2;
const HEX = TEAM.map(c => '#' + c.getHexString());
const WHITE = new THREE.Color('#ffffff'), HOT = new THREE.Color('#ffe14d'), SPARK = new THREE.Color('#ffd27a'), BLOCK = new THREE.Color('#b8f0ff');
const ICON = {
  out: '<svg class="ico" viewBox="0 0 24 24"><circle cx="6" cy="12" r="3.2" /><path d="M9.5 12H21" /><path d="M17 8.5l4 3.5-4 3.5" /></svg>',
  hug: '<svg class="ico" viewBox="0 0 24 24"><circle cx="10" cy="12" r="4" /><path d="M16.5 5.5a9 9 0 0 1 0 13" /></svg>'
};

function showError(err) {
  el.go.disabled = true;
  el.busy.hidden = true;
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

// The default items Lux3D made from a photo, and who made them when it wasn't us (Elara 907b6fa5): each gets the Lux3D tag
// on the build screen and in 角色库, and its source line says so. 废土刀 is 凡朔's run (PR #6, same source sha256).
const LUX = {'pan-lux3d': '', 'lamp-lux3d': '', 'wasteland-knife': '', 'wasteland-pot': '', 'wasteland-broom': ''};
const isLux = id => Object.hasOwn(LUX, id);
// Text and attribute values alike (names will come from outside once 拍一件 is live: quotes must not end an attribute).
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// The result reason as HTML: 谁撞碎了谁 on the first row, 剩血 on its own row after reasonLine's \n; item names and 核心 are
// kept whole so a narrow phone never breaks one across two lines (Elara 8d91d2fa).
const reasonHtml = text => {
  const words = [...new Set([...Object.values(NAMES), '核心'])].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${words.join('|')})`);
  return text.split('\n').map(row => `<span class="row">${row.split(re).map((t, i) => i % 2 ? `<span class="w">${esc(t)}</span>` : esc(t)).join('')}</span>`).join('');
};
const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const toDef = b => ({parts: [{item: b.parts[0].item, mount: 'e0', orient: b.parts[0].orient}, {item: b.parts[1].item, mount: b.spread, orient: b.parts[1].orient}]});
// R7 (伸出攻、贴着守): 伸出 hits harder and breaks sooner; 贴着 takes blows for the core and hits softer.
const HINT = {out: '攻：撞人更疼，自己易碎', hug: '守：替核心挡，少掉血'};
const randomSeed = () => 1 + Math.floor(Math.random() * 9999);

// 评委版 shows its own list instead (judge.js): only what is in that build, in Chinese, one line per thing.
function renderCredits(items, md = creditsMd) {
  const link = s => s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const html = [];
  let list = false, tableHead = false;
  const close = () => { if (list) html.push('</ul>'); list = false; };
  for (const line of md.split('\n')) {
    const l = line.trim();
    if (/^\|/.test(l)) {
      if (/^\|[\s|:-]+\|$/.test(l)) continue;
      if (!list) { html.push('<ul>'); list = true; tableHead = true; }
      if (tableHead) { tableHead = false; continue; }
      html.push(`<li>${l.split('|').slice(1, -1).map(c => c.trim()).filter(Boolean).map(c => link(esc(c))).join(' · ')}</li>`);
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

// 拍一件's lasting address switches, kept when 开打 rewrites the address (Elara a510bb73 B1); shootReset is not one.
const SHOOT_KEEP = ['shoot', 'shootSpeed', 'shootFail', 'shootCat', 'shootSix'];
// Items from the photo backend go to the sim's registerItems one at a time before the page shows, equips or replays
// them (tools/import-item/shoot README): it checks each and recomputes its rating; one it turns down stays out, the rest come in.
// Its checks don't change, so one turned down isn't offered again (and 拍一件 lets that job go, task #62).
const simKnows = new Set(), simRefused = new Set();
async function register(list) {
  const ok = [];
  for (const it of list) {
    if (simRefused.has(it?.id)) continue;
    try { await registerItems([it]); simKnows.add(it.id); ok.push(it); } catch (e) { simRefused.add(it?.id); console.warn(`拍一件: ${it?.id} not registered: ${e.message}`); }
  }
  return ok;
}
// What /items sent, less any entry that isn't an item with an id (a null among them mustn't sink the rest, task #62).
// Said once in the console, like a turned-down item: a backend sending these may be leaving out the item a job waits for (task #70).
let saidBad = false;
function photoItems(list) {
  const ok = (Array.isArray(list) ? list : []).filter(it => it && typeof it === 'object' && typeof it.id === 'string');
  if (!saidBad && (!Array.isArray(list) || ok.length < list.length)) {
    saidBad = true;
    console.warn(`拍一件: /items ${Array.isArray(list) ? `had ${list.length - ok.length} entries that aren't items (null or no id), left out` : 'sent no list'}`);
  }
  return ok;
}

async function main() {
  el.busy.hidden = false;
  const q = new URLSearchParams(location.search);
  const feel = q.get('feel') === 'bounce' ? 'bounce' : undefined;
  // A page built with WANWU_COMBAT (vite.config.js) plays only those rules, whatever the address says.
  const combat = (__COMBAT__ || q.get('combat')) === 'position' ? 'position' : undefined;
  const combatOptions = combat ? {combat, combatRules: POSITION_COMBAT_RULES} : {};
  const ladderKey = combat ? `${LADDER_KEY}-position` : LADDER_KEY;
  // shootReset is a one-off: dropped from the address at once so a reload keeps the fake's state.
  if (q.has('shootReset')) try { history.replaceState(null, '', `?${location.search.slice(1).split('&').filter(p => p && !p.startsWith('shootReset=')).join('&')}`); } catch { /* sandboxed viewer */ }
  // 评委版 (judge.js, task #4): 拍一件 talks to this origin's backend (Elara edd90212), with one real generation beside it.
  const judge = __JUDGE__ ? await import('./judge.js') : null;
  // 拍一件's items are in the catalog before anything reads it, so a reopened page whose address equips one finds it
  // (Elara a510bb73 B2). A backend that doesn't answer within 5 s leaves the page with what it shipped with. The 评委版
  // gives all of it, /quota then the items, 3 s together before 开始玩 (Sol e0a86865), and skips the items when /quota
  // says no photo can be taken now (Elara c1bc2dac); what isn't back by then, or was skipped, is asked again once the page
  // is up: the player's own items stay in the 角色库 after the day's photos run out (Elara cf1366e6).
  const within = (p, ms) => Promise.race([p, new Promise(ok => setTimeout(ok, Math.max(0, ms), null))]).catch(() => []);
  const shoot0 = shootApi(q, __JUDGE__).then(async api => {
    if (!api) return null;
    if (!__JUDGE__) return {api, items: await within(api.items(), 5000) ?? [], again: true};
    const by = performance.now() + 3000;
    const quota = await readQuota(api, true, 3000);
    const sent = shootOpen(quota) ? await within(api.items(), by - performance.now()) : null;
    return {api, quota, items: sent ?? [], again: sent === null || Boolean(quota.late)};
  });
  const [items, rules, shot] = await Promise.all([loadCatalog(), loadV3Rules(), shoot0]);
  // Only a page with 拍一件 on has fetched /items; a plain page has nothing to check, or to warn about (task #76).
  if (shot) items.push(...await register(photoItems(shot.items).filter(it => !items.some(i => i.id === it.id))));
  const byId = new Map(items.map(i => [i.id, i]));
  setNames(items);
  // The replayed item can be looked at, not equipped: it is in byId and NAMES but never in the 角色库 (OFFER).
  if (judge) { byId.set(judge.showcase.id, judge.showcase); setNames([judge.showcase]); }
  const OFFER = offerOf(items);
  const rate = id => ratingOf(byId.get(id));
  // A grade letter, coloured by grade (empty for an item without one).
  const gradeTag = (id, cls = 'grade') => { const g = rate(id)?.grade; return g ? `<i class="${cls} g${g}">${g}</i>` : ''; };
  const spec = id => { const it = byId.get(id); return `${Math.round(Math.max(...it.bounds.max.map((v, i) => v - it.bounds.min[i])) * 100)} cm · ${it.mass} kg`; };
  const layout = def => def.parts.map(p => ({item: p.item, orient: p.orient, ...mountExtents(byId.get(p.item), p.mount, p.orient, rules)}));
  const sweepOf = def => Math.max(rules.core.radius, ...layout(def).map(p => p.r1));
  const stage = new Stage(el.canvas, {items, coreRadius: rules.core.radius, layout});
  const turns = new LiveTurns(stage.renderer, stage.scene.environment);
  const overlay = new Overlay(stage, el);
  renderCredits(items, judge?.creditsMd);

  const mode = q.get('mode') === 'B' ? 'B' : 'A';
  // An address can name a photo item the backend hasn't handed over yet (/items slow or down as the page opens, task #62):
  // the page opens with the default build rather than an error, and takes the address's once the item comes in.
  const late = {};
  // A build as 物品ID,out或hug,另一物品ID,out或hug,e180或e90: the build, null when it waits in late, undefined when unusable.
  const readBuild = (key, text) => {
    const p = text.split(',');
    const b = {parts: [{item: p[0], orient: p[1]}, {item: p[2], orient: p[3]}], spread: p[4]};
    const shape = p.length === 5 && b.parts.every(x => ['out', 'hug'].includes(x.orient)) && b.parts[0].item !== b.parts[1].item && ['e180', 'e90'].includes(b.spread);
    if (shape && b.parts.every(x => OFFER.includes(x.item))) return b;
    if (shape && shot && b.parts.every(x => OFFER.includes(x.item) || !byId.has(x.item))) { late[key] = b; return null; }
  };
  const buildArg = b => [b.parts[0].item, b.parts[0].orient, b.parts[1].item, b.parts[1].orient, b.spread].join(',');
  const fromUrl = (key = 'mine') => {
    if (!q.has(key)) return null;
    const b = q.getAll(key).length === 1 ? readBuild(key, q.get(key)) : undefined;
    if (b !== undefined) return b;
    throw Error(`${key}参数无效：格式为物品ID,out或hug,另一物品ID,out或hug,e180或e90；两件须是清单中不同的道具，${key}只能出现一次`);
  };
  // The player's build is kept on this phone (task #70 item 6, Elara c4225110): the hosted viewer drops the address, so a
  // reload or reopening went back to the default. An address's build still comes first; a kept one naming an item that
  // is gone falls back to the default without a word, and one whose photo item hasn't come in yet waits like the address's.
  const BUILD_KEY = 'wanwu-build';
  const keptArg = (() => { try { return localStorage.getItem(BUILD_KEY); } catch { return null; } })();
  const mine = structuredClone((q.has('mine') ? fromUrl() : keptArg && readBuild('mine', keptArg)) ?? DEFAULT);
  // ?foe= (measurements) keeps no progress: ?foe=mang|wen|chang fights that one of the three, its build and play, with no
  // picking (Wren's recordings, Elara f01a2add); a build fights it with the old 换个对手 list and the old play. Otherwise the ladder.
  const ladderOn = !q.has('foe');
  const pinned = q.getAll('foe').length === 1 ? LADDER.findIndex(f => f.id === q.get('foe')) : -1;
  const ladder = (() => {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(ladderKey)); } catch { /* no storage, or not ours */ }
    const won = new Set((Array.isArray(kept?.won) ? kept.won : []).filter(id => LADDER.some(f => f.id === id)));
    const open = i => i === 0 || won.has(LADDER[i - 1].id);
    const keptAt = LADDER.findIndex(f => f.id === kept?.at);
    // The one picked last time; else the first not yet won (the last, once all are).
    const at = keptAt >= 0 && open(keptAt) ? keptAt : Math.max(0, LADDER.findIndex((f, i) => open(i) && !won.has(f.id)));
    return {won, open, at: at < 0 ? LADDER.length - 1 : at};
  })();
  const keepLadder = () => { try { localStorage.setItem(ladderKey, JSON.stringify({won: [...ladder.won], at: LADDER[ladder.at].id})); } catch { /* no storage here */ } };
  let FOE = structuredClone(ladderOn ? LADDER[ladder.at].build : pinned >= 0 ? LADDER[pinned].build : fromUrl('foe') ?? DEFAULT_FOE);
  let seed = Number.isInteger(Number(q.get('seed'))) && q.has('seed') ? Number(q.get('seed')) : randomSeed();
  const fixedSeed = q.has('seed');
  // Manual only on the page (远夏 10-28 e3a68f0a): you press 冲 / 挡. The auto fight stays for the test scripts (?play=auto).
  let control = q.get('play') === 'auto' ? 'auto' : 'manual', live = null;
  // Fight camera (the HUD toggle, or ?cam=): 俯视 the framing camera from above ('new'), 慢三成 yesterday's chase camera
  // turning, following and zooming 30 % slower ('slow', default), 原速 yesterday's camera as it was ('v4')
  // (远夏 10-28 2735f129: keep all three).
  // 第 13 版 hand-feel trial only (no on-page option): ?block=0.2 / 0.25 / 0.3 s block window; default is the rules' own.
  const blockTime = ['0.2', '0.25', '0.3'].includes(q.get('block')) ? Number(q.get('block')) : undefined;
  let camStyle = ['v4', 'slow'].includes(q.get('cam')) ? q.get('cam') : 'new';
  stage.setCamStyle(camStyle);
  await loadModels([...new Set([...mine.parts, ...FOE.parts].map(p => byId.get(p.item)))]);
  await stage.kitchen.ready;
  el.busy.hidden = true;
  // 评委版: the build screen needs no physics, so its engine (a separate file there) loads only now, while the judge reads
  // the opening card and builds, instead of holding up the first screen or the first 开打.
  if (judge) { judge.readyIntro(); warmEngine().catch(showError); }

  // ---------- state ----------
  let phase = 'loading'; // loading | build | computing | play | finale | result | replay
  // Which of the three the match on screen is against (null with a build in ?foe=), and what its result did to the ladder
  // (worked out once: the result shows again after 重看).
  let fought = null, outcome = null;
  // A piece that breaks on the very frame a lunge is bounced off a shield: its 「…碎了」 comes half a second later, so the
  // bounce reads first and nobody wonders whether it was blocked (Elara 80e885bc); one still up from before is let go.
  let lastParryT = -Infinity, lastClashT = -Infinity, lateNums = [];
  let pb = null, replay = null, finaleAge = 0, finaleSim = 0, replayEnd = 0, captionHold = 0, spinAngle = 0, liveSlowShown = false;
  const hpView = [0, 1].map(() => ({core: 1, chip: 1, since: 9}));

  // Opponent tag on the build screen, and 换个对手: a sheet of the computer's builds; the pick stays for the next rounds.
  const sameBuild = (x, y) => x.spread === y.spread && x.parts.every((p, i) => p.item === y.parts[i].item && p.orient === y.parts[i].orient);
  const partsHtml = b => b.parts.map(p => `<span>${gradeTag(p.item)}${esc(NAMES[p.item])}${ICON[p.orient]}</span>`).join('');
  const markHtml = (i, cls = '') => `<span class="ft f${i + 1}${cls}">${LADDER[i].mark}</span>`;
  function renderFoe() {
    el.foeParts.innerHTML = partsHtml(FOE);
    const at = ladderOn ? ladder.at : pinned;
    if (at < 0) return;
    const f = LADDER[at];
    el.foe.classList.add('ladder');
    $('foeMark').className = `ft f${at + 1}`; $('foeMark').textContent = f.mark; $('foeMark').hidden = false;
    $('foeLabel').textContent = f.name;
    $('foeBtn').hidden = !ladderOn;
    if (!ladderOn) return;
    // The number is how many are won (as the ladder's 已赢 N/3); the ring marks the one being fought.
    const won = LADDER.filter(g => ladder.won.has(g.id)).length;
    $('foeBtn').setAttribute('aria-label', `三个对手，已赢 ${won} 个，现在打第 ${ladder.at + 1} 个`);
    $('foeBtn').innerHTML = `<i class="pips">${LADDER.map((g, i) => `<i class="${ladder.won.has(g.id) ? 'won' : ''}${i === ladder.at ? ' now' : ''}"></i>`).join('')}</i><b>${won}/${LADDER.length}</b>${SVG.down}`;
  }
  renderFoe();
  let foeReq = 0;
  // Only on the build screen: once 开打 is pressed this round's opponent is fixed, so 原样再来 fights the same one (Sol B1).
  function openFoes() {
    if (phase !== 'build') return;
    if (ladderOn) { openLadder(); return; }
    el.foeList.innerHTML = FOES.map((f, i) => `<button type="button" class="frow" role="radio" data-foe="${i}" aria-checked="${sameBuild(f.build, FOE)}">
      <span class="lvl${f.rank ? ' ' + f.rank : ''}">${f.level}</span><span class="fparts">${partsHtml(f.build)}</span><small>${SPREAD[f.build.spread]}</small></button>`).join('');
    for (const row of el.foeList.querySelectorAll('[data-foe]')) row.onclick = () => setFoe(FOES[Number(row.dataset.foe)].build);
    el.foeSheet.hidden = false;
  }
  // The ladder: one row per opponent, joined by a line; a locked one shows neither its build nor lets itself be picked.
  function openLadder() {
    const won = LADDER.filter(f => ladder.won.has(f.id)).length, clear = won === LADDER.length;
    $('foeHead').classList.toggle('clear', clear);
    $('foeTitle').textContent = clear ? '三个都赢了' : '三个对手';
    $('foeProg').textContent = `已赢 ${won} / ${LADDER.length}`;
    $('foeSub').textContent = clear ? '随便挑一个，换个装法再打一轮' : '一个比一个难，赢了上一个才解锁下一个';
    el.foeList.innerHTML = LADDER.map((f, i) => {
      const head = `<span class="nm">${esc(f.name)}<small>第 ${i + 1} 个</small></span>`;
      if (!ladder.open(i)) return `<div class="rung locked" role="radio" aria-checked="false" aria-disabled="true" data-rung="${i}">
        <span class="ft off">${SVG.lock}</span>${head}<span class="play">${esc(f.play)}</span><span class="need">${SVG.lock}赢了${esc(LADDER[i - 1].name)}解锁</span></div>`;
      const won = ladder.won.has(f.id);
      return `<button type="button" class="rung${won ? ' won' : ''}" role="radio" aria-checked="${i === ladder.at}" data-rung="${i}">${markHtml(i)}${head}
        ${won ? `<span class="st won">${SVG.check}已赢</span>` : i === ladder.at ? '<span class="st now">正在打</span>' : ''}
        <span class="play">${esc(f.play)}</span><span class="rparts">${partsHtml(f.build)}</span></button>`;
    }).join('');
    for (const row of el.foeList.querySelectorAll('[data-rung]')) row.onclick = () => {
      const i = Number(row.dataset.rung);
      if (ladder.open(i)) { pickFoe(i); return; }
      row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
      sfx.deny();
    };
    el.foeSheet.hidden = false;
  }
  function pickFoe(i) {
    el.foeSheet.hidden = true;
    if (phase !== 'build') return;
    ladder.at = i;
    keepLadder();
    renderFoe();
    setFoe(LADDER[i].build);
  }
  async function setFoe(b) {
    el.foeSheet.hidden = true;
    if (phase !== 'build' || sameBuild(b, FOE)) return;
    const req = ++foeReq;
    FOE = structuredClone(b);
    renderFoe();
    layout_();
    await loadModels(FOE.parts.map(p => byId.get(p.item)));
    if (req !== foeReq || phase !== 'build') return;
    stage.replaceFighter(1, toDef(FOE));
    stage.pose(previewState());
  }
  $('foeBtn').onclick = openFoes;
  $('foeClose').onclick = () => { el.foeSheet.hidden = true; };
  el.foeSheet.onclick = e => { if (e.target === el.foeSheet) el.foeSheet.hidden = true; };

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
      slot.querySelector('.item .nm').querySelector('.grade')?.remove();
      slot.querySelector('.item .nm').insertAdjacentHTML('afterbegin', gradeTag(part.item));
      slot.querySelector('.lux').hidden = !isLux(part.item);
      slot.querySelector('.spec').textContent = spec(part.item);
      slot.querySelector('.hint').textContent = HINT[part.orient];
      const thumb = slot.querySelector('.module-thumb');
      thumb.dataset.modelId = part.item;
      thumb.dataset.modelPath = byId.get(part.item).glb;
      const url = itemThumbnail(part.item, stage.renderer, stage.scene.environment);
      thumb.hidden = !url;
      if (url) { thumb.src = url; thumb.alt = NAMES[part.item]; }
      for (const b of slot.querySelectorAll('[data-orient]')) b.setAttribute('aria-checked', String(b.dataset.orient === part.orient));
    });
    for (const b of document.querySelectorAll('[data-spread]')) b.setAttribute('aria-checked', String(b.dataset.spread === mine.spread));
    // Not while the default stands in for a build whose photo item is on its way: that one is what to keep.
    if (!(late.mine && sameBuild(mine, DEFAULT))) try { localStorage.setItem(BUILD_KEY, buildArg(mine)); } catch { /* no storage here */ }
  }
  let buildReq = 0;
  async function rebuildMine() {
    const req = ++buildReq;
    syncBuild();
    await loadModels(mine.parts.map(p => byId.get(p.item)));
    if (req !== buildReq || phase !== 'build') return;
    stage.replaceFighter(0, toDef(mine));
    syncBuild();
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
    el.go.disabled = !el.error.hidden;
    $('foeBtn').disabled = !el.error.hidden;
    [0, 1].forEach(i => overlay.setCoreHp(i, 1, true));
    syncBuild();
    layout_();
    stage.updateCamera(0, true);
    takeLate(); // the address's build, if its photo item came in during a match (task #70)
  }

  // ---------- HUD ----------
  function buildHud(defs) {
    $('foeWho').textContent = fought === null ? '对手' : LADDER[fought].name;
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
    if (text !== undefined) el.captionText.innerHTML = reasonHtml(text);
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
  const pieceName = id => id === '__core' ? '核心' : NAMES[id];
  // 谁打谁看位置 (combat=position): the replay says so; a live match's events carry positionClash.
  const positionCombat = e => replay?.meta?.combat === 'position' || typeof e.positionClash === 'boolean';
  function onEvent(e) {
    if (e.type === 'contact' || e.type === 'hit' || e.type === 'weak') stage.kitchen?.photo.noteCollision();
    const point = e.point ? new THREE.Vector3().fromArray(e.point) : null;
    if (e.type === 'hit' || e.type === 'weak') {
      if (e.role === 'recoil') { stage.flashPart(e.target, e.targetPart, 0.3); return; }
      const core = e.targetPart === 'core', big = core || e.type === 'weak' || e.tier >= 2, dash = e.dash && !e.parry;
      if (dash) {
        // A landed lunge: the full treatment (hit-stop is in Playback): spark lines, a camera punch, a heavy thump.
        stage.burst(point, [SPARK, TEAM[e.attacker], HOT], 48, 4.2, 0.032, 0.85);
        stage.impact(point, 1, [WHITE, HOT, TEAM[e.attacker]]);
        overlay.screenFlash(0.10);
        sfx.dashHit();
        buzz(40);
      } else {
        // An ordinary knock: the same, scaled down.
        stage.burst(point, [SPARK, TEAM[e.attacker], BLOCK], big ? 28 : 16, big ? 3.6 : 2.7, big ? 0.028 : 0.020, big ? 0.72 : 0.55);
        stage.impact(point, e.shield ? 0.18 : big ? 0.65 : 0.32, [WHITE, SPARK, TEAM[e.attacker]]);
        overlay.screenFlash(big ? 0.05 : 0.025);
        sfx.hit(Math.min(1, 0.35 + (e.closingSpeed ?? 3) / 12 + (big ? 0.2 : 0)), {core, crit: e.type === 'weak'});
      }
      // Yesterday's camera shook on every blow (no-op with the new camera).
      stage.shakeV4(core ? 0.75 : big ? 0.5 : 0.3);
      // Core hit: a ring in the victim's colour; a hugging piece taking it: a pale "blocked" ring.
      stage.ring(point, core ? TEAM[e.target] : e.targetOrient === 'hug' ? BLOCK : TEAM[e.attacker], 0.04, big ? 1.05 : 0.7, big ? 0.44 : 0.34);
      // Position combat: the striking piece gets a glowing edge in its colour, the struck one flashes too (a clash: both edged).
      const position = positionCombat(e);
      if (position) stage.strike(e.attacker, e.part, point);
      stage.flashPart(e.target, e.targetPart, core || position ? 0.32 : 0.18);
      // Which piece struck (the striker's colour), crit added; a hugging piece taking it says so, stacked with it.
      if (e.damage > 0) {
        // 护住 (the hit landed on a hugging piece) rides in the same plate: two plates on one spot piled up (Elara 11-02 a788037f).
        const opts = {crit: e.type === 'weak', dash: e.dash && !e.parry, guard: !core && e.targetOrient === 'hug' && e.type === 'hit' && !e.parry};
        // Position combat names both: 「拖鞋 打 扫帚」; a clash gives one 「对撞」 plate for the pair (side 0's piece first).
        if (!position) overlay.callout(point, e.attacker, pieceName(e.item), opts);
        else if (!e.clash) overlay.callout(point, e.attacker, pieceName(e.item), {...opts, hit: {side: e.target, name: pieceName(e.targetItem)}});
        else if (e.t !== lastClashT) {
          lastClashT = e.t;
          const [mine, theirs] = e.attacker === 0 ? [e.item, e.targetItem] : [e.targetItem, e.item];
          overlay.callout(point, 0, pieceName(mine), {crit: opts.crit, hit: {side: 1, name: pieceName(theirs), clash: true}});
        }
        if (e.dash && !e.parry) stage.ring(point, TEAM[e.attacker], 0.1, 1.3, 0.4);
        flashHud(e);
      }
      if (core) overlay.screenFlash(0.06);
      if (e.type === 'weak') { overlay.screenFlash(0.12); stage.ring(point, HOT, 0.05, 0.9, 0.45); }
    } else if (e.type === 'break') {
      coach(2, {side: e.target, k: Number(e.targetPart.split('-')[1])});
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
  const COACH = [{text: '按冲，朝它扑过去', at: 'dash'}, {text: '它冲过来时按挡，把它弹开', at: 'block'}, {text: '件只挡一边，核心随时会挨撞', at: 'mid'}];
  // Line 3 says what the broken piece took with it (Elara 11-02 a788037f): only its own side; the core can be hit any
  // time and still fights with what is left (task #31, Sol's 2891 / 9099 diagnosis).
  const BROKE_LINE = {out: '伸出的件碎了，还有另一件和核心能撞', hug: '贴着的件碎了，核心这一边没了遮挡'};
  const COACH_KEY = 'wanwu-coach-seen';
  const coachSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem(COACH_KEY) ?? '[]')); } catch { return new Set(); } })();
  if (q.get('coach') === 'again') coachSeen.clear();
  // Line 1 stays up until the player first presses 冲 (Elara 11-02 a788037f: it went by before it could be read); a line
  // waiting behind it comes once 冲 is pressed or after COACH_HOLD s. Lines 2 and 3 stay COACH_HOLD s each.
  const COACH_HOLD = 3;
  let coachTimer = 0, coachSince = -Infinity, coachFirstUp = false;
  function coach(n, broke) {
    if (control !== 'manual' || !live || coachSeen.has(n) || phase !== 'play') return;
    if (n > 0) coach(0);
    const wait = coachSince + COACH_HOLD - performance.now() / 1000;
    if (wait > 0) { setTimeout(() => coach(n, broke), wait * 1000 + 50); return; }
    coachSeen.add(n);
    coachSince = performance.now() / 1000;
    coachFirstUp = n === 0;
    try { localStorage.setItem(COACH_KEY, JSON.stringify([...coachSeen])); } catch { /* no storage here */ }
    // Numbered in the order they actually came up: lines 2 and 3 follow the match (a piece can break before a lunge).
    el.coachTag.textContent = `${coachSeen.size}/3`;
    // 「还有另一件」 is checked when the line actually shows: a line queued behind another can come up after that side's
    // other piece broke too, and then only the general line is still true (task #33).
    const f = broke && stage.fighters[broke.side], orient = f?.def.parts[broke.k]?.orient;
    const brokeLine = orient === 'out' && !f.parts.some((p, m) => m !== broke.k && p.alive) ? null : BROKE_LINE[orient];
    el.coachText.textContent = n === 2 && brokeLine ? brokeLine : COACH[n].text;
    el.coach.dataset.at = COACH[n].at;
    el.coach.hidden = false;
    clearTimeout(coachTimer);
    if (!coachFirstUp) coachTimer = setTimeout(() => { el.coach.hidden = true; }, (COACH_HOLD + 1.2) * 1000);
  }
  // The first 冲: line 1 has done its job; it goes, and whatever waits behind it may come now.
  function coachDashed() {
    if (!coachFirstUp) return;
    coachFirstUp = false;
    coachSince = -Infinity;
    el.coach.hidden = true;
  }
  function hideCoach() { clearTimeout(coachTimer); coachFirstUp = false; el.coach.hidden = true; }

  // ---------- match ----------
  let runId = 0;
  async function start() {
    if (phase !== 'build' || !el.error.hidden) return;
    const id = ++runId;
    if (!fixedSeed) seed = randomSeed();
    fought = ladderOn ? ladder.at : pinned >= 0 ? pinned : null;
    outcome = null;
    phase = 'computing';
    el.go.disabled = true;
    el.foeSheet.hidden = true;
    $('foeBtn').disabled = true;
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
      // The opponent's play is fixed with its build as 开打 is pressed; one without its own (a build in ?foe=) plays the old way.
      const ai = fought === null ? null : LADDER[fought].ai;
      const match = await createV3Match({fighters: [toDef(mine), toDef(FOE)], mode, seed, feel, ...combatOptions, manual: {sides: ['input', 'ai'], ...(blockTime ? {blockTime} : {}), ...(ai ? {aiProfiles: [null, structuredClone(ai)]} : {})}});
      if (id !== runId) { match.free(); return; }
      r = {meta: {initial: match.initial, duration: Infinity, rules: match.rules, ...(combat && {combat})}, frames: match.frames, events: match.events, decisive: {eventIndex: null, why: null}};
      live = {match, done: false};
    } else {
      // Yield to the page every few hundred physics steps so the preview keeps spinning.
      r = await simulateV3({fighters: [toDef(mine), toDef(FOE)], mode, seed, feel, ...combatOptions, onProgress: () => new Promise(res => setTimeout(res, 0))});
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
    lastClashT = -Infinity;
    layout_();
    stage.pose(pb.state);
    stage.setLookahead(lookahead());
    stage.updateCamera(0, true);
    phase = 'play';
    overlay.showBanner('开转', '#ffffff', 0.8);
    setTimeout(() => coach(0), 400);
    // Shareable address on a normal page; sandboxed viewers (opaque origin) refuse URL changes, which is fine.
    // An address build still waiting for its photo item stays in the address, unless the player has changed that side (task #70).
    // ?foe= stays too, so a reload is still a measurement and not the ladder (Sol's S1 on PR #84).
    const waits = k => late[k] && sameBuild(k === 'mine' ? mine : FOE, k === 'mine' ? DEFAULT : DEFAULT_FOE);
    try { history.replaceState(null, '', `?mine=${waits('mine') ? q.get('mine') ?? keptArg : buildArg(mine)}${ladderOn ? '' : `&foe=${pinned >= 0 ? LADDER[pinned].id : waits('foe') ? q.get('foe') : buildArg(FOE)}`}${fixedSeed ? `&seed=${seed}` : ''}${mode === 'B' ? '&mode=B' : ''}${control === 'auto' ? '&play=auto' : ''}${feel ? '&feel=bounce' : ''}${combat ? '&combat=position' : ''}${camStyle !== 'slow' ? `&cam=${camStyle}` : ''}${blockTime ? `&block=${q.get('block')}` : ''}${SHOOT_KEEP.filter(k => q.has(k)).map(k => `&${k}=${encodeURIComponent(q.get(k))}`).join('')}`); } catch { /* sandboxed viewer */ }
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
    el.whyLine.innerHTML = reasonHtml(reasonLine(replay));
    const builds = m.initial.map(f => f.definition.parts.map(p => `<span>${gradeTag(p.item)}${esc(NAMES[p.item])}</span>`).join(''));
    el.resultBuild.innerHTML = `<span class="rw">你</span>${builds[0]}<span class="rw vs">${fought === null ? '对手' : esc(LADDER[fought].name)}</span>${builds[1]}`;
    const stats = matchStats(replay, replay.meta.initial.map(f => f.definition));
    el.statsList.innerHTML = pickStats(stats, m.winner).map(x => `<li><b>${esc(x.value)}</b><span>${esc(x.label)}</span></li>`).join('');
    el.tipLine.textContent = tipLine(stats, m.winner, fought === null ? null : LADDER[fought].id);
    outcome ??= ladderOutcome(m.winner);
    showOutcome(outcome);
    $('replayBtn').hidden = pb.slowAt === null;
    setCaption(false);
    el.result.hidden = false;
    layout_();
    // The camera eases over to the winner alone, above the card (a draw keeps both in frame).
    stage.setFocusOn(m.winner, el.result.offsetTop);
  }
  // A win over a ladder opponent: kept at once. The first win over one unlocks the next (打下一个), the first over the last
  // one is the 三个都赢了 ending (随便挑 opens the ladder). Losing, a draw, or ?foe= leave the result as it was.
  function ladderOutcome(winner) {
    if (!ladderOn || winner !== 0) return {act: 'again'};
    const id = LADDER[fought].id, first = !ladder.won.has(id);
    ladder.won.add(id);
    keepLadder();
    renderFoe();
    const last = fought === LADDER.length - 1;
    if (last) return {act: first ? 'pick' : 'again', clear: first};
    return {act: 'next', unlocked: first ? fought + 1 : null};
  }
  function showOutcome(o) {
    el.result.classList.toggle('clear', Boolean(o.clear));
    el.resultBuild.hidden = el.statsList.hidden = Boolean(o.clear);
    $('clearTrio').hidden = !o.clear;
    if (o.clear) {
      el.winnerLine.textContent = '三个都赢了';
      $('clearTrio').innerHTML = LADDER.map((f, i) => `<span><span class="tw">${markHtml(i)}<i>${SVG.check}</i></span>${esc(f.name)}</span>`).join('');
      el.tipLine.textContent = '现在三个随便挑，换个装法再打一轮';
    }
    const card = $('unlockCard');
    card.hidden = o.unlocked == null;
    if (o.unlocked != null) {
      const f = LADDER[o.unlocked];
      card.innerHTML = `${markHtml(o.unlocked)}<span class="txt"><span class="k">${SVG.open}解锁下一个</span><b>${esc(f.name)}</b><span class="play">${esc(f.play)}</span></span>`;
      el.tipLine.textContent = '';
    }
    $('againBtn').innerHTML = `<span>${o.act === 'next' ? '打下一个' : o.act === 'pick' ? '随便挑' : '换个装法再打'}</span>${SVG.arrow}`;
    $('againBtn').dataset.act = o.act;
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
  // 角色库: every item a card (3D turning, name, category, size and weight, where it came from at the foot). The other slot's item
  // is tagged with its side (「右边在用」) and can't be picked; this slot's own says its side too (「左边在用」). Photo-made items with a saved generation record get
  // 「看它怎么来的」 (item.origin, written by the generation script); the rest say where they came from instead.
  const sourceLine = it => {
    if (isLux(it.id)) return `来源：照片 → Lux3D 生成${LUX[it.id] ? ' · ' + LUX[it.id] : ''}`;
    if (/^CC/.test(it.source?.license ?? '')) return `来源：公开的 CC 模型${it.source.author ? ' · ' + it.source.author : ''}`;
    if (it.generated && it.tag === 'photo') return '来源：照片生成';
    return '来源：现成的 3D 模型';
  };
  let libSlot = 0, libReq = 0;
  function cardHtml(id, k) {
    const it = byId.get(id), other = mine.parts[1 - k].item === id, own = mine.parts[k].item === id;
    // Which side each tag means, not 已装/装着 (same word to a player, Elara 08bbe423).
    const side = j => j ? '右边' : '左边';
    const badge = other ? `<span class="badge">${side(1 - k)}在用</span>` : own ? `<span class="badge own">${side(k)}在用</span>` : '';
    const corner = it.origin?.photo ? `<img class="photo" src="${esc(pictureUrl(it.origin.photo) ?? '')}" alt="原照">` : '';
    const foot = it.origin ? '<button type="button" class="how" data-how><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg>看它怎么来的</button>' : `<small class="src">${esc(sourceLine(it))}</small>`;
    // Top to bottom (Elara 11-02 444752f6): the grade, biggest; the three letters; centimetres and kilograms, small.
    const r = rate(id), grade = r?.grade;
    // Until the model is drawn (task #37, Elara 684ed1e6): the styled picture of a photographed item, else the item's own
    // still at the turntable's starting angle (task #39: an outline alone read as a shard), else its outline, faint. The
    // turning 3D fades in over it. No spinner.
    const still = it.origin?.styled ? pictureUrl(it.origin.styled) : stillUrl(id), path = still ? null : outlinePath(it);
    const ghost = still ? `<img class="ghost still" src="${esc(still)}" alt="">`
      : path ? `<svg class="ghost" viewBox="0 0 100 100" aria-hidden="true"><path d="${path}" /></svg>` : '';
    const rows = r ? `<span class="rates">${STATS.map(([k, label]) => `<span>${label}</span><i class="g${r.letters[k]}">${r.letters[k]}</i>`).join('')}</span>` : '';
    return `<article class="card${own ? ' own' : ''}${other ? ' used' : ''}${grade ? ' grade' + grade : ''}" data-item="${esc(id)}">
      <button type="button" class="pick"${other ? ' disabled' : ''} aria-label="装上${esc(NAMES[id])}${grade ? `，${grade} 级` : ''}">
        <span class="media">${ghost}<canvas class="turn"></canvas>${corner}${isLux(id) ? '<i class="lux">Lux3D</i>' : ''}${badge}</span>
        <span class="nm">${gradeTag(id, 'big')}<b>${esc(NAMES[id])}</b>${(c => c ? `<span class="cat">${esc(c)}</span>` : '')(catLabel(it, NAMES[id]))}</span>
        ${rows}<small class="spec">${spec(id)}</small>
      </button>${foot}<span class="cover" aria-hidden="true"><i>?</i></span></article>`;
  }
  async function openLibrary(k) {
    const req = ++libReq;
    libSlot = k;
    el.libTitle.textContent = `挑一件，装到${k ? '右边' : '左边'}`;
    el.libCount.textContent = `${OFFER.length} 件 · 点卡片就装上，回拼装页`;
    // Collection so far, best grade first (远夏 11-02: collect the S).
    const count = g => OFFER.filter(id => rate(id)?.grade === g).length;
    el.libGrades.innerHTML = `收集${GRADES.map(g => `<span><i class="g${g}">${g}</i>${count(g)}</span>`).join('')}`;
    const shown = byGrade(OFFER, rate);
    el.libGrid.innerHTML = shown.map(id => cardHtml(id, k)).join('');
    revealUnseen();
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
    // The 3D turns in as each model arrives (the page only loads a model once a card or a build needs it): the cards on
    // screen together first, so a small model is not stuck behind a big one (task #37), then the rest.
    turns.prune();
    const turnOf = id => el.libGrid.querySelector(`.card[data-item="${CSS.escape(id)}"] .turn`);
    const onScreen = shown.filter(id => turnOf(id)?.getBoundingClientRect().top < innerHeight);
    for (const group of [onScreen, shown.filter(id => !onScreen.includes(id))]) {
      await Promise.all(group.map(async id => {
        await loadModels([byId.get(id)]);
        if (req !== libReq || el.library.hidden) return;
        const turn = turnOf(id);
        if (turn) turns.show(turn, id);
      }));
      if (req !== libReq || el.library.hidden) return;
    }
  }
  function closeLibrary() { libReq++; revealIo.disconnect(); el.library.hidden = true; }

  // 翻牌 (Elara 11-02 79a528bb): a grade this phone has not seen yet is dealt face down and turns over the first time
  // its card is on screen, one after another, with a sound by grade and gold for an S. Remembered per item and rating
  // version, so a re-rated item (new scores or score lines) turns over again. ?reveal=again resets it.
  const SEEN_KEY = 'wanwu-grades-seen';
  const gradesSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); } })();
  if (q.get('reveal') === 'again') gradesSeen.clear();
  const seenKey = id => `${id}:${rate(id)?.version}`;
  const REVEAL_GAP = 260, REVEAL_FACE = 330; // ms between cards; ms into the turn when the face shows
  let revealAt = 0;
  const revealIo = new IntersectionObserver(entries => {
    for (const e of entries.filter(x => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)) {
      revealIo.unobserve(e.target);
      const card = e.target, id = card.dataset.item, wait = Math.max(0, revealAt - performance.now());
      revealAt = performance.now() + wait + REVEAL_GAP;
      setTimeout(() => {
        if (!card.isConnected || el.library.hidden) return; // left before its turn: still face down next time
        card.classList.replace('down', 'turning');
        sfx.flip();
        setTimeout(() => {
          if (!card.isConnected || el.library.hidden) return; // left mid-turn, before the face showed: turn again next time
          faceUp(id);
        }, REVEAL_FACE);
      }, wait);
    }
  }, {threshold: 0.6});
  function revealUnseen() {
    revealIo.disconnect();
    revealAt = performance.now() + 250; // after the 角色库 has faded in
    for (const card of el.libGrid.querySelectorAll('.card')) {
      if (!rate(card.dataset.item) || gradesSeen.has(seenKey(card.dataset.item))) continue;
      card.classList.add('down');
      revealIo.observe(card);
    }
  }
  $('libBack').onclick = closeLibrary;
  // The face showing: its sound by grade, a short buzz for an S (task #55), and remembered.
  function faceUp(id) {
    const grade = rate(id)?.grade;
    sfx.reveal(grade);
    if (grade === 'S') buzz([30, 50, 40]);
    gradesSeen.add(seenKey(id));
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...gradesSeen])); } catch { /* no storage here */ }
  }
  // The same turn for one card outside the grid (拍一件's 好了): face down now, turned over after `wait` ms. With `lift`
  // (the card's holder, task #55) it first rises to the middle of 拍一件's frame, a little bigger, and holds a beat face
  // down; turned, it stays up longer the better the grade, then settles back where it was.
  // Left before the face showed (task #63): back face down, silent and unseen. Its screen closed (回角色库, 装上它), it
  // turns the next time it is shown; under 看它怎么来的, it turns again once that closes.
  const LIFT = 380, PAUSE = 420, DEAL = 660, HOLD = {S: 1100, A: 800, B: 550, C: 350, D: 350};
  function turnOver(card, id, wait, lift = null) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) lift = null;
    card.classList.add('down');
    const then = (ms, go) => setTimeout(() => {
      if (!card.isConnected) return;
      if (card.offsetParent && el.how.hidden) return go();
      card.classList.replace('turning', 'down');
      lift?.classList.remove('lifted');
      const back = () => { if (card.isConnected && card.offsetParent) el.how.hidden ? turnOver(card, id, 300, lift) : setTimeout(back, 200); };
      if (card.offsetParent) setTimeout(back, 200);
    }, ms);
    then(wait, () => {
      if (lift) {
        // Measured on the card (its holder also has its margins) against the frame: on a phone it already spans the
        // frame less its margins, so up there it fills the width, edge to edge; on a desktop's centred frame the same.
        const r = card.getBoundingClientRect(), f = lift.closest('#shootView')?.getBoundingClientRect() ?? {left: 0, top: 0, width: innerWidth, height: innerHeight};
        lift.style.setProperty('--dx', `${f.left + f.width / 2 - (r.left + r.width / 2)}px`);
        lift.style.setProperty('--dy', `${f.top + f.height / 2 - (r.top + r.height / 2)}px`);
        lift.style.setProperty('--k', Math.min(1.2, (f.width + 8) / r.width).toFixed(3));
        lift.classList.add('lifted');
      }
      then(lift ? LIFT + PAUSE : 0, () => {
        card.classList.replace('down', 'turning');
        sfx.flip();
        then(REVEAL_FACE, () => {
          faceUp(id);
          if (lift) setTimeout(() => lift.classList.remove('lifted'), DEAL - REVEAL_FACE + (HOLD[rate(id)?.grade] ?? HOLD.B));
        });
      });
    });
  }

  // 看它怎么来的: three steps from the item's own record (photo → the styled image → the 3D turning), about ten seconds,
  // each step's real time beside it. 品类 shows only for one of the six; a real item's category is its name (task #84).
  const STEPS = [{key: 'photo', name: '照片', play: 3}, {key: 'styled', name: '改成画风的图', play: 3}, {key: 'model', name: '3D 转起来', play: 4}];
  const dur = sec => sec >= 60 ? `${Math.floor(sec / 60)} 分 ${String(Math.round(sec % 60)).padStart(2, '0')} 秒` : `${Math.round(sec)} 秒`;
  let howItem = null, howT = 0, howTimer = 0, howReq = 0;
  async function openHow(id) {
    const it = byId.get(id), o = it?.origin;
    if (!o) return;
    howItem = id;
    const secs = STEPS.map(st => o.steps?.find(x => x.key === st.key)?.seconds);
    el.howTitle.textContent = `${NAMES[id]}是怎么来的`;
    el.howCat.textContent = catLabel(it, NAMES[id]);
    el.howCat.parentElement.hidden = !el.howCat.textContent;
    el.howSteps.innerHTML = STEPS.map((st, i) => {
      const pic = st.key === 'model' ? '<canvas class="mini3d"></canvas>' : `<img src="${esc(pictureUrl(st.key === 'photo' ? o.photo : o.styled) ?? '')}" alt="">`;
      return `<li data-step="${i}"><span class="n">${i + 1}</span><b>${st.name}</b>${pic}<span class="sec">${Number.isFinite(secs[i]) ? dur(secs[i]) : '—'}</span></li>`;
    }).join('');
    el.howTotal.textContent = secs.every(Number.isFinite) ? `实际用时 ${dur(secs.reduce((a, b) => a + b, 0))}` : '';
    // 评委版's replayed item: whose photo it is, and back to the 角色库 instead of 装上它 (it isn't one of the nine).
    const shown = judge?.showcase.id === id, other = !shown && mine.parts[1 - libSlot].item === id;
    el.howNote.hidden = !shown;
    if (shown) el.howNote.textContent = judge.photoCredit;
    el.howEquip.disabled = other;
    el.howEquip.querySelector('span').textContent = shown ? (el.shoot.hidden ? '回角色库' : '回拍一件') : other ? '另一边已经装着它' : mine.parts[libSlot].item === id ? '装着，回拼装' : '装上它';
    turns.prune();
    turns.show(el.howTurn, id);
    el.how.hidden = false;
    playHow();
    // The 3D step needs the model, which the 角色库 may not have loaded yet: it turns in once it arrives.
    const req = ++howReq;
    await loadModels([it]);
    if (req !== howReq || el.how.hidden) return;
    turns.show(el.howTurn, id);
    turns.show(el.howSteps.querySelector('.mini3d'), id, {still: true});
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
    if (judge?.showcase.id === howItem) { closeHow(); return; }
    if (mine.parts[1 - libSlot].item === howItem) return;
    const id = howItem;
    closeHow();
    equip(id);
  };
  // Into the slot the 角色库 was last opened for, from wherever the player is (a 拍一件 tag can be tapped on the result).
  async function equip(id) {
    if (mine.parts[1 - libSlot].item === id) return;
    mine.parts[libSlot].item = id;
    shoot?.close();
    closeLibrary();
    if (phase === 'result') { await loadModels([byId.get(id)]); showBuild(); } else rebuildMine();
  }
  const equipLabel = id => mine.parts[1 - libSlot].item === id ? {text: '另一边已经装着它', disabled: true}
    : {text: mine.parts[libSlot].item === id ? '装着，回拼装' : '装上它', disabled: false};

  // ---------- 拍一件 (task #47) ----------
  // Items made from photos arrive while the page is open: into the 角色库, the names, the stage and the sim, no rebuild.
  // The sim takes them first; one it turns down never shows up here, so the 好了 card waits for it (task #56 S2).
  // The address's build, once its photo items are in, if the player hasn't changed that side in the meantime.
  function takeLate() {
    const ready = b => b && b.parts.every(x => OFFER.includes(x.item));
    if (phase !== 'build') return;
    if (ready(late.mine) && sameBuild(mine, DEFAULT)) { mine.parts = structuredClone(late.mine.parts); mine.spread = late.mine.spread; rebuildMine(); }
    if (ready(late.foe) && sameBuild(FOE, DEFAULT_FOE)) setFoe(late.foe);
    for (const k of Object.keys(late)) if (ready(late[k])) delete late[k];
  }
  async function addItems(sent) {
    const list = photoItems(sent);
    if (!list.some(it => !byId.has(it.id))) { takeLate(); return; }
    await register(list.filter(it => !byId.has(it.id)));
    const fresh = list.filter(it => !byId.has(it.id) && simKnows.has(it.id));
    if (!fresh.length) return;
    for (const it of fresh) { byId.set(it.id, it); items.push(it); stage.items.set(it.id, it); }
    setNames(items);
    OFFER.splice(0, OFFER.length, ...offerOf(items));
    takeLate();
  }
  let shoot = null;
  shoot0.then(async s => {
    // 评委版 with ?shoot=off: no backend; the 角色库's 拍一件 shows how one real item was made.
    if (!s && judge) {
      el.shootBtn.lastChild.textContent = '拍一件示例';
      el.shootBtn.hidden = false;
      el.shootBtn.onclick = () => openHow(judge.showcase.id);
    }
    if (!s) return;
    const {api} = s;
    // The backend is down: the 角色库 has what the page shipped with. The 评委版's backend was slow already, so 拍一件
    // doesn't wait for these.
    const more = s.again && api.items().then(addItems).catch(() => {});
    if (!judge) await more;
    takeLate();
    shoot = mountShoot({
      api, addItems, turns, loadModels, equip, equipLabel, openHow,
      strict: Boolean(judge), quota: s.quota, sample: judge && (() => openHow(judge.showcase.id)),
      item: id => byId.get(id), refused: id => simRefused.has(id), name: id => NAMES[id], grade: rate, spec,
      seen: id => gradesSeen.has(seenKey(id)), flip: turnOver,
      libraryOpen: () => !el.library.hidden, openLibrary: () => openLibrary(libSlot),
      goPlay: () => { closeHow(); closeLibrary(); if (phase === 'result') showBuild(); },
      tagRoom: () => (phase === 'build' || phase === 'result') && el.library.hidden && el.how.hidden && el.foeSheet.hidden && el.credits.hidden,
      onChange: () => {
        const s = shoot?.state;
        el.shootBtn.classList.toggle('run', Boolean(s?.job && !s.stopped && !['succeeded', 'failed'].includes(s.job.status)));
        el.shootBtn.classList.toggle('new', Boolean(s?.made && !s.stored?.seen));
        // One that failed while the player was elsewhere says so here too (Elara 021f6bf5); 拍一件 then shows it first.
        const failed = Boolean(s?.stored && !s.stored.seen && s.job?.status === 'failed' && s.job.error?.code !== 'unknown-submit');
        el.shootBtn.classList.toggle('bad', failed);
        el.shootBtn.lastChild.textContent = failed ? '上一件没做成' : '拍一件';
      }
    });
    el.shootBtn.hidden = false;
    el.shootBtn.onclick = () => shoot.open('library');
    window.__top.shoot = shoot;
    // ?capture=1 opens 拍一件 as soon as it is there: 凡朔's private link goes straight to the camera (Sol 2779c0dc).
    // A one-off like shootReset, dropped from the address so a reload lands on the build screen.
    if (q.get('capture') === '1') {
      try { history.replaceState(null, '', `?${location.search.slice(1).split('&').filter(p => p && !p.startsWith('capture=')).join('&')}`); } catch { /* sandboxed viewer */ }
      shoot.open('link');
    }
  }).catch(showError);
  document.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => { if (phase === 'build') openLibrary(Number(b.dataset.pick)); }; });
  document.querySelectorAll('.slot').forEach(slot => slot.querySelectorAll('[data-orient]').forEach(b => {
    b.onclick = () => { if (phase !== 'build') return; mine.parts[Number(slot.dataset.slot)].orient = b.dataset.orient; rebuildMine(); };
  }));
  document.querySelectorAll('[data-spread]').forEach(b => { b.onclick = () => { if (phase !== 'build') return; mine.spread = b.dataset.spread; rebuildMine(); }; });
  // 冲 / 挡: taken on press (not release); the sim decides at its next step whether it is ready.
  function press(action) {
    if (!live || live.done || phase !== 'play') { diag.tap(action, phase === 'play' ? '已结束' : `不在对局 ${phase}`); return; }
    const c = live.match.control(0), left = action === 'dash' ? c.dashIn : c.blockIn;
    // Still cooling at the next physics step: the sim would drop it anyway, so nothing is sent; the button shakes and
    // 还没好 rises over it, so a tap that cannot count never looks like a dead button.
    if (left > rules.dt + 1e-9) {
      replay_(action === 'dash' ? el.dashBtn : el.blockBtn, 'deny'); replay_(action === 'dash' ? el.dashNope : el.blockNope, 'show');
      test.denied++; sfx.deny(); diag.tap(action, `冷却 ${left.toFixed(1)}s`); return;
    }
    diag.tap(action, '收下');
    live.match.press(0, action);
    if (action === 'dash') coachDashed();
    sfx.click();
  }
  // Restart a one-shot CSS animation class (a second tap mid-shake shakes again).
  function replay_(btn, cls) { btn.classList.remove(cls); void btn.offsetWidth; btn.classList.add(cls); }
  for (const [btn, action] of [[el.dashBtn, 'dash'], [el.blockBtn, 'block']]) {
    btn.left = btn.querySelector('.left');
    // Real press state on touchdown: the button goes down and lights up until the finger lifts.
    btn.addEventListener('pointerdown', ev => { ev.preventDefault(); btn.classList.add('down'); press(action); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(type, () => btn.classList.remove('down'));
    btn.addEventListener('pointercancel', () => diag.cancel());
    btn.addEventListener('animationend', ev => { if (ev.animationName === 'padDeny') btn.classList.remove('deny'); else if (ev.animationName === 'padPop') btn.classList.remove('pop'); });
  }
  // A thumb held down or rocked on a button opens no menu and selects nothing (远夏's Android, task 5ee99454).
  el.pad.addEventListener('contextmenu', ev => ev.preventDefault());
  for (const n of [el.dashNope, el.blockNope]) n.addEventListener('animationend', () => n.classList.remove('show'));
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
  $('againBtn').onclick = () => {
    const act = $('againBtn').dataset.act;
    showBuild();
    if (act === 'next') pickFoe(Math.min(fought + 1, LADDER.length - 1));
    else if (act === 'pick') openLadder();
  };
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

  // ---------- diagnostics ----------
  // For a phone we cannot hold: frames per second, how fast game time runs against the wall clock (cooldowns count in game
  // time, so a slow phone makes them long), and what became of the last taps. Five quick taps on the clock open or close it,
  // which works inside the studio page's frame where an address parameter may not reach us; ?diag=1 opens it too.
  const diag = (() => {
    const box = $('diag'), taps = [], count = {};
    let on = q.get('diag') === '1', n = 0, wall = 0, playWall = 0, game = 0, lastT = null, fightWall = 0, fightGame = 0, fightStop = 0, worst = 0, fps = 0, ratio = null, slowest = 0, cancels = 0, hits = [];
    try { on ||= localStorage.getItem('wd.diag') === '1'; } catch { /* sandboxed viewer */ }
    const draw = () => {
      if (!on) return;
      const now = performance.now();
      box.textContent = [`帧 ${fps}/秒 · 游戏 ${ratio === null ? '—' : `${ratio.toFixed(2)}×`}`,
        `本局 ${fightWall ? `${(fightGame / fightWall).toFixed(2)}×` : '—'} · 其中停顿慢放 ${fightStop.toFixed(1)}秒`, `最慢一帧 ${slowest}ms · 取消 ${cancels}`,
        ...taps.map(t => `${t.action === 'dash' ? '冲' : '挡'} ${t.what} · ${((now - t.at) / 1000).toFixed(1)}秒前`)].join('\n');
    };
    const toggle = () => {
      on = !on; box.hidden = !on;
      try { localStorage.setItem('wd.diag', on ? '1' : '0'); } catch { /* sandboxed viewer */ }
      draw();
    };
    box.hidden = !on;
    el.clock.addEventListener('pointerdown', ev => {
      hits = [...hits.filter(t => ev.timeStamp - t < 1500), ev.timeStamp];
      if (hits.length >= 5) { hits = []; toggle(); }
    });
    return {
      // t: the match clock during a fight (null otherwise), so the ratio is what the fight really ran at. Hit stops and slow
      // motion lower it by design; stop says this frame was one of those, and the fight's total of them shows beside it.
      frame(w, t, stop) {
        n++; wall += w; worst = Math.max(worst, w);
        // A new fight starts its clock again from 0.
        if (t !== null && (lastT === null || t < lastT)) fightWall = fightGame = fightStop = 0;
        if (t !== null && lastT !== null && t >= lastT) { game += t - lastT; playWall += w; fightGame += t - lastT; fightWall += w; if (stop) fightStop += w; }
        lastT = t;
        if (wall < 0.5) return;
        fps = Math.round(n / wall); ratio = playWall ? game / playWall : null; slowest = Math.round(worst * 1000);
        n = wall = playWall = game = worst = 0;
        draw();
      },
      count: () => ({...count, cancels}),
      tap(action, what) { const k = `${action} ${what.split(' ')[0]}`; count[k] = (count[k] ?? 0) + 1; taps.unshift({action, what, at: performance.now()}); taps.length = Math.min(taps.length, 6); draw(); },
      cancel() { cancels++; draw(); }
    };
  })();

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
    taps: diag.count,
    turns,
    setControl(c) { control = c; },
    // Fixture for the 看它怎么来的 check until the generation script writes real records.
    setOrigin(id, origin) { byId.get(id).origin = origin; },
    // A card still for data/stills (scripts/make-stills.mjs): the item at the turntable's starting angle, as a WebP data URL.
    async still(id, size, turn) { await loadModels([byId.get(id)]); return turns.shot(id, size, turn); },
    // Fixture for the 结算 layout check: any reasonLine text (e.g. from a stored replay) through the card's own rendering.
    setReason(text) { el.whyLine.innerHTML = reasonHtml(text); },
    // The finished replay as JSON (to re-simulate it elsewhere from its recorded presses and compare bytes).
    replayJson: () => replay && JSON.stringify(replay),
    status: () => ({phase, control, cam: camStyle, denied: test.denied, live: Boolean(live), foe: live && !live.done ? live.match.control(1) : null, me: live && !live.done ? live.match.control(0) : null, inputs: live?.done ? replay.meta.manual.inputs : null, frozen: test.frozen, t: pb?.t ?? 0, simMs: test.simMs, seed, mine: structuredClone(mine), foeBuild: structuredClone(FOE), meta: replay && {...replay.meta, initial: undefined, rules: undefined}, decisive: replay?.decisive, reason: replay && reasonLine(replay), caption: el.caption.classList.contains('on')}),
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
      return {frames: m.frames, core15Pct: +(100 * m.core15 / m.frames).toFixed(1), ok15Pct: +(100 * m.ok15 / m.frames).toFixed(1), minMarginPx: +m.minMargin.toFixed(1), sweptMinMarginLrPx: +m.sweptLr.toFixed(1), sweptMinMarginSafePx: +m.sweptSafe.toFixed(1), core15PctExact: +(100 * m.core15 / m.frames).toFixed(2), outSecs: +m.out.toFixed(2), outRunMaxSecs: +m.outRunMax.toFixed(2), offLrSecs: +m.offLr.toFixed(2), offLrAt: m.offLrAt ?? [], pxPerMetre: {p10: q(0.1), median: q(0.5), p90: q(0.9), min: q(0), max: q(1)}};
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
  let last = performance.now(), lastTagKey = '';
  function frame(now) {
    requestAnimationFrame(frame);
    const wall = (now - last) / 1000;
    let dt = Math.min(0.1, wall);
    last = now;
    diag.frame(wall, phase === 'play' && pb ? pb.t : null, pb && (pb.hold > 0 || pb.slowNow || pb.slowFactor(pb.t) < 1));
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
        const m = test.frame ??= {frames: 0, ok15: 0, core15: 0, minMargin: Infinity, scale: [], sweptLr: Infinity, sweptSafe: Infinity, lastT: null, out: 0, outRun: 0, outRunMax: 0, offLr: 0};
        m.frames++;
        const sm = stage.sweptMargin();
        m.sweptLr = Math.min(m.sweptLr, sm.lr);
        m.sweptSafe = Math.min(m.sweptSafe, sm.safe);
        if (-o.px >= 0.15 * el.app.clientWidth) m.ok15++;
        if (stage.coreMargin() >= 0.15 * el.app.clientWidth) m.core15++;
        m.minMargin = Math.min(m.minMargin, -o.px);
        // 出画 (MVP 规格 §7): match seconds with a core or mounted piece past the safe area, the longest such stretch, and
        // seconds with a swept circle past the screen's left or right edge (Wren's 10-29 measure).
        const dT = m.lastT == null ? 0 : Math.max(0, pb.t - m.lastT);
        m.lastT = pb.t;
        if (o.px > 0) { m.out += dT; m.outRun += dT; m.outRunMax = Math.max(m.outRunMax, m.outRun); } else m.outRun = 0;
        if (sm.lr < 0) { m.offLr += dT; (m.offLrAt ??= []).push(+pb.t.toFixed(2)); }
        m.scale.push(stage.cam.stat.pxPerMetre);
      }
    }
    // The 角色库 covers the whole page: the stage under it would only draw what no one sees, and its canvas draws the
    // cards' 3D instead (看它怎么来的 over the 角色库: only its own).
    if (el.library.hidden && el.shoot.hidden) stage.render(dt, simDt);
    else turns.render(now / 1000, !el.how.hidden ? el.how : !el.shoot.hidden ? el.shoot : el.library);
    // The 拍一件 tag shows on the build and result screens only: redrawn as the player moves between screens.
    const tagKey = `${phase}${el.library.hidden}${el.how.hidden}${el.foeSheet.hidden}${el.credits.hidden}`;
    if (shoot && tagKey !== lastTagKey) { lastTagKey = tagKey; shoot.paintTag(); }
    overlay.update(dt, true);
    if (pb && phase !== 'build' && phase !== 'computing') { updateHud(dt, pb.state); updateHudFlash(dt); updatePad(); }
  }
  showBuild();
  requestAnimationFrame(frame);
  if (q.get('autoplay') === '1') start();
}

main().catch(showError);
