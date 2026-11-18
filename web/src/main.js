import * as THREE from 'three';
import {loadCatalog, registerItems} from '../../sim/index.js';
import {simulateV3, createV3Match, loadV3Rules, mountExtents, openingDistance, warmEngine, POSITION_COMBAT_RULES, PLANAR_JUDGE_COMBAT_OPTIONS, MATERIAL_JUDGE_COMBAT_OPTIONS, PVP_COMBAT_OPTIONS, COUNTER_CUE_LIT} from '../../sim/v3.js';
import ladderJson from '../../data/foes.json';
import {loadModels, prefetchModels, pictureUrl, stillUrl, outlinePath, itemThumbnail, setFileSource} from './models.js';
import {LiveTurns} from './livecards.js';
import {GRADES, STATS, ratingOf, byGrade} from './rating.js';
import {Stage, TEAM, CORE_TRAVEL, CORE_RISE, CAM} from './stage.js';
import {Playback, BREAK_STOP} from './playback.js';
import {BreakHolds} from './break-holds.js';
import {Overlay} from './overlay.js';
import {reasonLine, endLine, matchStats, pickStats, tipLine, NAMES, setNames, wholeSeconds, WEN_HINT} from './reason.js';
import {sfx} from './sfx.js';
import bgmUrl from './assets/bgm.mp3?url';
import {shootApi} from './shoot-api.js';
import {catLabel, mountShoot, readQuota, shootOpen} from './shoot.js';

const $ = id => document.getElementById(id);
// Inside another page (ModelScope's studio frame), whose floating ball sits over our right edge: the sheets keep below it (style.css).
document.documentElement.toggleAttribute('data-framed', self !== top);
const el = {
  app: $('app'), canvas: $('view'), fx: $('fx'), flash: $('flash'), banner: $('banner'),
  caption: $('caption'), captionText: $('captionText'), slowtag: $('slowtag'), clock: $('clock'),
  hud: $('hud'), foe: $('foe'), foeParts: $('foeParts'), build: $('build'), go: $('goBtn'),
  result: $('result'), resultMeta: $('resultMeta'), winnerLine: $('winnerLine'), whyLine: $('whyLine'), statsList: $('statsList'), tipLine: $('tipLine'),
  foeSheet: $('foeSheet'), foeList: $('foeList'),
  library: $('library'), libGrid: $('libGrid'), libTitle: $('libTitle'), libCount: $('libCount'), libGrades: $('libGrades'),
  resultBuild: $('resultBuild'), how: $('howView'), howTitle: $('howTitle'), howShot: $('howShot'), howTurn: $('howTurn'), howCat: $('howCat'), howNow: $('howNow'),
  howBar: $('howBar'), howSteps: $('howSteps'), howTotal: $('howTotal'), howEquip: $('howEquip'), howNote: $('howNote'),
  howSrc: $('howSrc'), howPick: $('howPick'),
  shoot: $('shootView'), shootBtn: $('shootBtn'),
  busy: $('busy'), busyText: $('busyText'), error: $('error'),
  teach: $('teach'), teachCard: $('teachCard'), teachTitle: $('teachTitle'), teachLine: $('teachLine'), teachOk: $('teachOk'), teachSkip: $('teachSkip'),
  teachHoles: $('teachHoles'), teachRims: $('teachRims'),
  pad: $('pad'), dashBtn: $('dashBtn'), blockBtn: $('blockBtn'), dashNope: $('dashNope'), blockNope: $('blockNope'), mute: $('muteBtn'), camSeg: $('camSeg'),
  pad2: $('pad2'), pvpTip: $('pvpTip'), pvpWin: $('pvpWin'), pvpReady: $('pvpReady'), pvpScore: $('pvpScore')
};
// Manual mode: the sim runs live this far ahead of what is shown (a press is taken at the next physics step).
const LIVE_LEAD = 0.05;
// Every match's start (一机双人 第二轮 ①, single-player too from 第三轮 ①): 准备 for READY_GO s, then 开打！ until READY; the
// sim starts after it, so its numbers are untouched.
const READY = 1.5, READY_GO = 0.9;
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
// The computer's default build; ?foe= can override it for measurements. 评委版 ships none of the early models (models.js),
// so its default is made of the twelve: 一机双人's 2P default, even with 1P's (Elara 17ed7f8b).
const DEFAULT_FOE = __JUDGE__ ? {parts: [{item: 'fanshuo-plate', orient: 'out'}, {item: 'fanshuo-roller', orient: 'hug'}], spread: 'e180'}
  : {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'lamp-lux3d', orient: 'hug'}], spread: 'e180'};
// 换个对手 (MVP 规格 §4-2; Elara 11-02 470a4546): the computer's builds to pick from, strong to weak by Sol's R8 two-piece
// check (test/mvp/results-combo-check-r2: each pair at its best layout against a fixed pool of opponents). The default first.
// 评委版's list is the three opponents' builds instead (below), weakest last.
const SOLO_FOES = [
  {level: '默认', build: DEFAULT_FOE},
  {level: '强', rank: 'hi', build: {parts: [{item: 'broom', orient: 'out'}, {item: 'pillow', orient: 'out'}], spread: 'e90'}},
  {level: '偏强', rank: 'hi', build: {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'slipper', orient: 'out'}], spread: 'e90'}},
  {level: '中', rank: 'mid', build: {parts: [{item: 'broom', orient: 'out'}, {item: 'slipper', orient: 'out'}], spread: 'e180'}},
  {level: '弱', rank: 'lo', build: {parts: [{item: 'scissors', orient: 'out'}, {item: 'slipper', orient: 'hug'}], spread: 'e180'}}
];
const SPREAD = {e180: '对面', e90: '挨着'};
// 三个对手 (task #86, Elara 2a3c7171): one harder than the last, each won unlocks the next. Progress stays on this phone.
// A page built for one set of rules (__COMBAT__, vite.config.js) takes the foe builds tuned for them where there are any
// (judgeBuilds.<current|position>.<foe id>). A tuned build can override its foe's reaction settings.
const LADDER = ladderJson.foes.map(f => {
  const tuned = __COMBAT__ && ladderJson.judgeBuilds?.[__COMBAT__]?.[f.id];
  if (!tuned) return f;
  const {ai, impactAi, ...build} = tuned;
  return {...f, build, ai: ai ? {...f.ai, ...ai} : f.ai, impactAi};
});
const FOES = __JUDGE__ ? [{level: '默认', build: DEFAULT_FOE}, ...LADDER.map((f, i) => ({level: ['弱', '中', '强'][i] ?? '强', rank: ['lo', 'mid', 'hi'][i] ?? 'hi', build: f.build})).reverse()] : SOLO_FOES;
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
// Gone from 评委版 (Elara 17ed7f8b); old builds and links naming it still open (main.js readBuild).
const RETIRED = new Set(['showcase-flipflop']);
// 一机双人's 2P before they pick (Elara 1e2c813c: no lopsided start): 40 scripted matches against DEFAULT went 20 : 20.
const DEFAULT_P2 = {parts: [{item: 'fanshuo-plate', orient: 'out'}, {item: 'fanshuo-roller', orient: 'hug'}], spread: 'e180'};
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
sfx.music(bgmUrl);
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
  const feelArg = q.get('feel');
  const feel = feelArg === 'bounce' ? 'bounce' : undefined;
  // A page built with WANWU_COMBAT (vite.config.js) plays only those rules, whatever the address says.
  const combat = (__COMBAT__ || q.get('combat')) === 'position' ? 'position' : undefined;
  const soloOptions = __COMBAT__ === 'position' ? (feelArg === 'old' ? PLANAR_JUDGE_COMBAT_OPTIONS : MATERIAL_JUDGE_COMBAT_OPTIONS)
    : combat ? {combat, combatRules: POSITION_COMBAT_RULES} : {};
  // 一机双人 plays its own rules (sim/v3.js PVP_COMBAT_OPTIONS), whatever the page's single-player ones are.
  let combatOptions = soloOptions;
  const ladderKey = combat ? `${LADDER_KEY}-position` : LADDER_KEY;
  // shootReset is a one-off: dropped from the address at once so a reload keeps the fake's state.
  if (q.has('shootReset')) try { history.replaceState(null, '', `?${location.search.slice(1).split('&').filter(p => p && !p.startsWith('shootReset=')).join('&')}`); } catch { /* sandboxed viewer */ }
  // 评委版 (judge.js, task #4): 拍一件 talks to this origin's backend (Elara edd90212), with one real generation beside it.
  const judge = __JUDGE__ ? await import('./judge.js') : null;
  // 拍一件's items are in the catalog before anything reads it, so a reopened page whose address equips one finds it
  // (Elara a510bb73 B2). A backend that doesn't answer within 5 s leaves the page with what it shipped with. The 评委版
  // doesn't wait for it at all (Elara b231705e: a slow /quota held its first screen past 3 s): the first match's models come
  // down beside /quota and the items, and those go in when they arrive, a build naming one waiting in late like an
  // address's. It asks /quota then the items, 3 s together (Sol e0a86865), and skips the items when /quota says no photo
  // can be taken now (Elara c1bc2dac); what isn't back by then, or was skipped, is asked again: the player's own items
  // stay in the 角色库 after the day's photos run out (Elara cf1366e6).
  const within = (p, ms) => Promise.race([p, new Promise(ok => setTimeout(ok, Math.max(0, ms), null))]).catch(() => []);
  const shoot0 = shootApi(q, __JUDGE__).then(async api => {
    if (!api) return null;
    if (!__JUDGE__) return {api, items: await within(api.items(), 5000) ?? [], again: true};
    const by = performance.now() + 3000;
    const quota = await readQuota(api, true, 3000);
    const sent = shootOpen(quota) ? await within(api.items(), by - performance.now()) : null;
    return {api, quota, items: sent ?? [], again: sent === null || Boolean(quota.late)};
  });
  const [items, rules, shot] = await Promise.all([loadCatalog(), loadV3Rules(), __JUDGE__ ? null : shoot0]);
  const photoLater = __JUDGE__ && q.get('shoot') !== 'off'; // shootApi: the 评委版's photo items may still come in
  // Anything not shipped in the catalog came from 拍一件: the result tip compares it with the opponent (Elara 365a2667).
  // 评委版's replayed items (below) aren't the player's photos, so they don't count.
  const shipped = new Set(items.map(i => i.id));
  // Only a page with 拍一件 on has fetched /items; a plain page has nothing to check, or to warn about (task #76).
  if (shot) items.push(...await register(photoItems(shot.items).filter(it => !items.some(i => i.id === it.id))));
  // 评委版's two replayed items (judge.js) can be played as well as looked at (Elara 9e17f724): in the sim and the stage
  // like a photo item, but not in the 角色库's cards (OFFER). One the sim turns down can still be looked at.
  const SAMPLES = judge?.showcases ?? [];
  const sampleIds = new Set(SAMPLES.map(x => x.item.id));
  const playable = new Set((await register(SAMPLES.map(x => x.item))).map(it => it.id));
  items.push(...SAMPLES.map(x => x.item).filter(it => playable.has(it.id)));
  const byId = new Map(items.map(i => [i.id, i]));
  for (const x of SAMPLES) byId.set(x.item.id, x.item);
  setNames([...items, ...SAMPLES.map(x => x.item)]);
  const sampleOf = id => SAMPLES.find(x => x.item.id === id);
  const offerNow = () => offerOf(items).filter(id => !sampleIds.has(id));
  const OFFER = offerNow();
  // What a build may name: the 角色库's items and the replayed ones that play.
  const usable = id => OFFER.includes(id) || playable.has(id);
  const rate = id => ratingOf(byId.get(id));
  // A grade letter, coloured by grade (empty for an item without one).
  const gradeTag = (grade, cls = 'grade') => grade ? `<i class="${cls} g${grade}">${grade}</i>` : '';
  const spec = id => { const it = byId.get(id); return `${Math.round(Math.max(...it.bounds.max.map((v, i) => v - it.bounds.min[i])) * 100)} cm · ${it.mass} kg`; };
  const layout = def => def.parts.map(p => ({item: p.item, orient: p.orient, ...mountExtents(byId.get(p.item), p.mount, p.orient, rules)}));
  const sweepOf = def => Math.max(rules.core.radius, ...layout(def).map(p => p.r1));
  const stage = new Stage(el.canvas, {items, coreRadius: rules.core.radius, layout});
  // 冲挡加重 (Elara fa18a1da): ?feel=old is the 评委版's hand feel (bada379) for side-by-side play, its picture included:
  // the fixed camera without jolts, no 「弹开！」, breaks and blows as they were.
  const oldFx = q.get('feel') === 'old';
  // The new feel's hit light: warm and short on the pieces, so they stay readable under the push-in (Elara c53fc626).
  stage.shortHitLight = !oldFx;
  // A broken piece's slot goes dark with a crack across it (terminal.css .newfeel); ?feel=old keeps its red 碎 slot.
  el.hud.classList.toggle('newfeel', !oldFx);
  stage.jolts = !oldFx;
  const turns = new LiveTurns(stage.renderer, stage.scene.environment);
  const overlay = new Overlay(stage, el);

  const mode = q.get('mode') === 'B' ? 'B' : 'A';
  // An address can name a photo item the backend hasn't handed over yet (/items slow or down as the page opens, task #62):
  // the page opens with the default build rather than an error, and takes the address's once the item comes in.
  const late = {};
  // A kept build naming items this page can't see (?shoot=off: no photo items at all) is held: the default stands in for
  // it, and it stays kept until the player changes that side themselves (Sol 9db420ed, Elara d0cdc43b). held[side] is
  // the stand-in.
  const held = {};
  const fillOf = key => key === 'p2' ? DEFAULT_P2 : key === 'foe' ? DEFAULT_FOE : DEFAULT;
  // A build as 物品ID,out或hug,另一物品ID,out或hug,e180或e90: the build, null when it waits in late, undefined when unusable.
  const readBuild = (key, text) => {
    const p = text.split(',');
    const b = {parts: [{item: p[0], orient: p[1]}, {item: p[2], orient: p[3]}], spread: p[4]};
    const shape = p.length === 5 && b.parts.every(x => ['out', 'hug'].includes(x.orient)) && b.parts[0].item !== b.parts[1].item && ['e180', 'e90'].includes(b.spread);
    // An old build or link naming the retired 拖鞋演示 (Sol 7adde033, f60f5af3): its other piece stays, a photo item one
    // too once it comes in; the default's takes the retired one's place, how both stick out and the spread as they were.
    // Held like the above, so the kept record stays until the player changes that side (Elara cc489dd2).
    const retired = shape && b.parts.some(x => RETIRED.has(x.item));
    if (retired) {
      const kept = b.parts.find(x => !RETIRED.has(x.item))?.item, fill = fillOf(key).parts.map(x => x.item).filter(id => id !== kept);
      let i = 0;
      b.parts = b.parts.map(x => RETIRED.has(x.item) ? {item: fill[i++], orient: x.orient} : x);
    }
    if (shape && b.parts.every(x => usable(x.item))) { if (retired) held[key] = b; return b; }
    if (shape && b.parts.every(x => usable(x.item) || !byId.has(x.item))) {
      if (shot || photoLater) { late[key] = b; if (retired) held[key] = b; return null; }
      held[key] = fillOf(key);
    }
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
  // Enable ceramic shards in the planar judge build. Keep the explicit toggle for local trials.
  const ceramicArg = q.get('ceramic');
  const ceramic = combatOptions.combatRules?.lockCorePlane === true
    && (ceramicArg === '1' || (__JUDGE__ && __COMBAT__ === 'position' && ceramicArg !== '0'));
  let camStyle = ['v4', 'slow'].includes(q.get('cam')) ? q.get('cam') : 'new';
  stage.setCamStyle(camStyle);
  await loadModels([...new Set([...mine.parts, ...FOE.parts].map(p => byId.get(p.item)))]);
  await stage.kitchen.ready;
  el.busy.hidden = true;
  // 评委版: the build screen needs no physics, so its engine (a separate file there) loads only now, while the judge reads
  // the opening card and builds, instead of holding up the first screen or the first 开打.
  // The rest of the 角色库's models then come down behind it, after the engine (Elara ead80382): opening the 角色库 or
  // swapping an item later needn't wait for the network, and the first screen still waits for the first match's only.
  let prefetched = Promise.resolve();
  // 首页's 和电脑打 / 和人打 (远夏 06bec9f5): a pick before the page below is set up waits for it.
  let setUp;
  const whenSetUp = new Promise(ok => { setUp = ok; });
  if (judge) { judge.readyIntro(two => whenSetUp.then(() => setPvp(two))); prefetched = warmEngine().then(() => prefetchModels(OFFER.map(id => byId.get(id))), showError); }
  // ?scene=kitchen: the 3D kitchen behind the build bench (bench-kitchen.js) comes down last, after everything a match needs;
  // if it fails the bench just keeps the usual backdrop.
  if (stage.bench) prefetched.finally(() => stage.bench.want());

  // ---------- state ----------
  let phase = 'loading'; // loading | build | computing | ready (一机双人's 准备 → 开打！) | play | finale | result | replay
  // Which of the three the match on screen is against (null with a build in ?foe=), and what its result did to the ladder
  // (worked out once: the result shows again after 重看).
  let fought = null, outcome = null;
  // 一机双人 (Elara 1e2c813c): `pvp`, two people at this phone; `pick`, whose build the bench is showing (0 the foot's 1P,
  // 1 the head's 2P, who is FOE meanwhile). The single-player opponent waits in soloFoe.
  let pvp = false, pick = 0, soloFoe = null;
  // The run of matches the two have played (原样再战 and 重选装备 carry it on, 回单人 and 回首页 start it again), and the
  // match last counted, so the result coming back after 重看 counts nothing. readyAge: how far into 准备 → 开打！.
  let score = [0, 0], scored = 0, readyAge = 0;
  const cur = () => pick ? FOE : mine;
  // Who a side is, in the words of the mode being played. 一机双人's bars each face their own end, so both say 你: a
  // colour is only a colour, never a name (第二轮, Elara 522ee793).
  const sideName = i => pvp ? '你' : i ? '对手' : '你';
  // A word a side earned faces that side's end of the phone (Elara 1d222196): 2P's turns to the head.
  const faces2P = i => pvp && i === 1;
  // A piece that breaks on the very frame a lunge is bounced off a shield: its 「…碎了」 comes half a second later, so the
  // bounce reads first and nobody wonders whether it was blocked (Elara 80e885bc); one still up from before is let go.
  // lastKnockT: the step of the latest ordinary knock shown, so a glance in the same step does not knock twice.
  let lastParryT = -Infinity, lastKnockT = -Infinity, lateNums = [];
  // The latest lunge direction per side (its 'go'), for the push of a landed 冲; a bounce off a shield, held a step so a
  // deflect in the same step can stand in for it (Sol 661f75e1: the two come together, said once).
  const lungeDir = [null, null];
  let heldParry = null, lastDeflectT = -Infinity;
  // 挡分两档 (Elara 896cf31c): the match plays guardTiming, so a block is 完美, 勉强 or 空, said where it struck (set per match).
  let tiered = false;
  // 一合一分 (Elara 41cd88d6): the sim reports each exchange and the foe's flash itself (exchange, dashCue).
  let round = false;
  let pb = null, replay = null, finaleAge = 0, finaleSim = 0, replayEnd = 0, captionHold = 0, spinAngle = 0, liveSlowShown = false;
  const hpView = [0, 1].map(() => ({core: 1, chip: 1, since: 9}));

  // Opponent tag on the build screen, and 换个对手: a sheet of the computer's builds; the pick stays for the next rounds.
  const sameBuild = (x, y) => x.spread === y.spread && x.parts.every((p, i) => p.item === y.parts[i].item && p.orient === y.parts[i].orient);
  const partsHtml = (b, ladderOpponent = false) => {
    // The ladder AI fights with pinned catalog scores. Convert those scores without applying player material bonuses.
    const pinnedRatings = ladderOpponent && control === 'manual' && combatOptions.combatRules?.itemRatings;
    return b.parts.map(p => {
      const rating = pinnedRatings ? ratingOf({rating: byId.get(p.item)?.rating}) : rate(p.item);
      return `<span>${gradeTag(rating?.grade)}${esc(NAMES[p.item])}${ICON[p.orient]}</span>`;
    }).join('');
  };
  const markHtml = (i, cls = '') => `<span class="ft f${i + 1}${cls}">${LADDER[i].mark}</span>`;
  function renderFoe() {
    const at = ladderOn ? ladder.at : pinned;
    el.foeParts.innerHTML = partsHtml(FOE, at >= 0);
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
        <span class="play">${esc(f.play)}</span><span class="rparts">${partsHtml(f.build, true)}</span></button>`;
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
    const defs = [toDef(mine), toDef(FOE)], d = openingDistance(defs.map(sweepOf), rules, combatOptions.combatRules?.opening);
    return {fighters: defs.map((def, i) => {
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spinAngle * (i ? 1 : 1) + (i ? 1.3 : 0));
      return {pos: new THREE.Vector3(i === 0 ? -d / 2 : d / 2, 0, 0), quat, angularVelocity: new THREE.Vector3(0, PREVIEW_SPIN, 0), hp: 1, maxHp: 1, parts: def.parts.map(() => ({alive: true, hp: 1, maxHp: 1}))};
    })};
  };
  function syncBuild() {
    document.querySelectorAll('.slot').forEach(slot => {
      const k = Number(slot.dataset.slot), part = cur().parts[k];
      slot.querySelector('.item b').textContent = NAMES[part.item];
      slot.querySelector('.item .nm').querySelector('.grade')?.remove();
      slot.querySelector('.item .nm').insertAdjacentHTML('afterbegin', gradeTag(rate(part.item)?.grade));
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
    for (const b of document.querySelectorAll('[data-spread]')) b.setAttribute('aria-checked', String(b.dataset.spread === cur().spread));
    // Not while the default stands in for a build whose photo item is on its way: that one is what to keep.
    if (!(late.mine && sameBuild(mine, DEFAULT) || held.mine && sameBuild(mine, held.mine))) try { localStorage.setItem(BUILD_KEY, buildArg(mine)); } catch { /* no storage here */ }
    if (pvp && !(late.p2 && sameBuild(FOE, DEFAULT_P2) || held.p2 && sameBuild(FOE, held.p2))) try { localStorage.setItem(P2_KEY, buildArg(FOE)); } catch { /* no storage here */ }
  }
  // The player changed the side being picked: what it chose is kept from now on, even the default again, and a held or
  // late build for that side is let go (Sol d6d88569). A tap on what is already there changes nothing (Sol 5a3aa4e6).
  const changed = (was, now) => { if (was === now) return; const k = pick ? 'p2' : 'mine'; delete held[k]; delete late[k]; };
  // One count per side: a newer change to that side lets its older one go, and 1P's and 2P's never cancel each other
  // (both restored at once when the photo list comes in, Sol c0b3e440).
  const buildReq = [0, 0];
  // The bench's side (by default the one being picked) after a change: its top swapped in once its models are down.
  async function rebuild(side = pick) {
    const req = ++buildReq[side];
    syncBuild();
    const b = side ? FOE : mine;
    await loadModels(b.parts.map(p => byId.get(p.item)));
    if (req !== buildReq[side] || phase !== 'build') return;
    stage.replaceFighter(side, toDef(b));
    syncBuild();
    stage.pose(previewState());
  }
  // ---------- 一机双人 (Elara 1e2c813c) ----------
  // 2P's build is kept on this phone apart from 1P's; one naming an item no longer here starts from DEFAULT_P2, and one
  // whose photo item hasn't come in yet waits in late as 1P's does, kept until then (Sol 10478c56).
  const P2_KEY = 'wanwu-pvp-p2';
  const keptP2 = () => {
    let b = null;
    delete late.p2; delete held.p2;
    try { const text = localStorage.getItem(P2_KEY); b = text && readBuild('p2', text); } catch { /* no storage here */ }
    return structuredClone(b ?? DEFAULT_P2);
  };
  let pvpReq = 0;
  // In or out of 一机双人, onto the bench at 1P's turn (首页's 和人打 / 和电脑打, ?pvp=1, 回单人).
  async function setPvp(two) {
    const req = ++pvpReq;
    score = [0, 0];
    // Back to one player: the run's score goes, not only out of sight (Elara 97280117).
    if (!two) el.pvpScore.textContent = el.pvpWin.lastChild.textContent = '';
    foeReq++; // a 换个对手 still loading is let go
    if (two !== pvp) {
      if (two) { soloFoe = FOE; FOE = keptP2(); } else { FOE = soloFoe ?? FOE; soloFoe = null; }
      pvp = two;
      combatOptions = two ? PVP_COMBAT_OPTIONS : soloOptions;
      // Out of 一机双人, a reload is single-player again: the address as it is now, which 开打 may have written (Sol 10478c56).
      if (!two && new URLSearchParams(location.search).get('pvp') === '1') try { history.replaceState(null, '', `?${location.search.slice(1).split('&').filter(x => x && x !== 'pvp=1').join('&')}`); } catch { /* sandboxed viewer */ }
    }
    pick = 0;
    libSlot = 0;
    el.app.classList.toggle('pvp', pvp);
    await loadModels(FOE.parts.map(p => byId.get(p.item)));
    if (req !== pvpReq) return;
    if (phase === 'build' || phase === 'result') showBuild();
  }
  // The bench's top plate: whose turn it is, in their colour, and 下一步 then 开打; single-player, the opponent as before.
  function renderPick() {
    el.foe.classList.toggle('p0', pvp && pick === 0);
    el.foe.classList.toggle('p1', pvp && pick === 1);
    // 2P's turn turns the whole screen to the head of the phone, so the phone never moves and 1P's buttons are still
    // at 1P's end when the fight starts (Elara 29b53529).
    el.app.classList.toggle('turned', pvp && pick === 1 && phase === 'build');
    el.foe.querySelectorAll('.terminal-id').forEach((n, i) => {
      n.querySelector('span').textContent = pvp ? `${i + 1}P` : i ? '对手' : '你';
      n.classList.toggle('on', pvp && i === pick);
      n.classList.toggle(`p${i}`, pvp);
    });
    // With an opening page, 回首页 is #homeBtn and this is only 2P's 回 1P; without one, 一机双人's way back to single-player.
    $('pvpBack').hidden = !pvp || !pick && homeOn;
    $('pvpBack').querySelector('span').textContent = pick ? '回 1P' : '回首页';
    // 2P's turn has one way back, to 1P (Pollux acbd091c): 回首页 comes back with 1P's.
    $('homeBtn').hidden = !homeOn || pvp && pick === 1;
    el.go.querySelector('span').textContent = pvp && pick === 0 ? '下一步' : '开打';
    if (!pvp) { $('foeLabel').textContent = '对手'; $('foeBtn').hidden = false; renderFoe(); return; }
    $('foeLabel').textContent = pick ? '轮到上方 2P 选装' : '轮到下方 1P 选装';
    $('foeBtn').hidden = $('foeMark').hidden = true;
    el.foeParts.innerHTML = '';
  }
  function setPick(i) {
    if (phase !== 'build') return;
    choiceReq++;
    pick = i;
    libSlot = 0;
    syncBuild();
    renderPick();
  }
  // 回首页: the opening page's two choices again; a page without one (not the 评委版) goes straight back to single-player.
  // Off the fight only (选装备 either side's turn, 结算): two hands on the phone mid-fight don't tap it by mistake (Elara
  // 4f2df5b4). The ladder and the build stay as they are; the two-player score starts again.
  const homeOn = Boolean(judge && document.getElementById('intro'));
  $('homeBtn').hidden = !homeOn;
  function goHome() {
    if (phase !== 'build' && phase !== 'result' && phase !== 'loading') return;
    score = [0, 0];
    el.hud.hidden = true; // single-player's result keeps it up
    // The opening page is inside #app: turn 2P's screen back first, at once, so it is never shown upside down.
    if (pick) { el.app.style.transition = 'none'; setPick(0); void el.app.offsetWidth; el.app.style.transition = ''; }
    if (!judge?.showIntro()) setPvp(false);
  }
  $('homeBtn').onclick = goHome;
  $('pvpBack').onclick = () => { if (pick) setPick(0); else goHome(); };
  function showBuild() {
    phase = 'build';
    stage.setHeat(0);
    pb = replay = null;
    live?.match.free();
    live = null;
    showPads(false);
    endTeach();
    endNudge();
    stage.setFighters([toDef(mine), toDef(FOE)]);
    stage.clearFx();
    overlay.clear(); lateNums = []; resetHighlights();
    stage.setCameraMode('build');
    stage.setFocusOn(null);
    stage.setLookahead(null);
    stage.showMe = false;
    stage.topDown = null;
    stage.pose(previewState());
    el.hud.hidden = true;
    el.result.hidden = el.pvpWin.hidden = el.pvpReady.hidden = true;
    el.build.hidden = false;
    el.foe.hidden = false;
    setCaption(false);
    el.go.disabled = !el.error.hidden;
    $('foeBtn').disabled = !el.error.hidden;
    [0, 1].forEach(i => overlay.setCoreHp(i, 1, true));
    syncBuild();
    renderPick();
    layout_();
    stage.updateCamera(0, true);
    takeLate(); // the address's build, if its photo item came in during a match (task #70)
  }

  // ---------- HUD ----------
  function buildHud(defs) {
    $('foeWho').textContent = pvp ? sideName(1) : fought === null ? '对手' : LADDER[fought].name;
    el.hud.querySelector('.s0 .who b').textContent = sideName(0);
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
        // A piece the ceramic shards broke keeps its slot as it was until they land; one they only hurt, its hp.
        const sp = stage.fighters[i]?.parts[k];
        if (sp?.held) return;
        const p = f.parts[k], pf = Math.max(0, Math.min(p.maxHp, p.hp + (p.alive ? sp?.owed ?? 0 : 0)) / p.maxHp), bar = pc.querySelector('.mini i');
        bar.style.transform = `scaleX(${pf})`;
        bar.classList.toggle('low', pf < 0.4);
        pc.classList.toggle('gone', !p.alive);
      });
      overlay.setCoreHp(i, frac);
    });
  }
  // The same blow on the HUD: the striking piece lights in its side's colour, the piece (or core bar) hit flashes white.
  const hudChip = (side, part) => part === 'core' ? el.hud.querySelector(`.s${side} .core .bar`) : el.hud.querySelectorAll(`.s${side} .pc`)[Number(part.split('-')[1])];
  // Runs on the game clock (holds through hit-stop and a frozen frame), like the callouts.
  const hudFlash = new Map();
  const setFlash = (node, cls, dur = 0.55) => {
    const was = hudFlash.get(node);
    // A 1.4 s 高光 slot is not cut short by an ordinary blow from the same piece.
    if (was && was.dur > dur && was.age < was.dur) return;
    if (was && was.cls !== cls) node.classList.remove(was.cls);
    hudFlash.set(node, {age: 0, cls, dur});
  };
  const dropFlash = node => { const f = hudFlash.get(node); if (f) { node.classList.remove(f.cls); hudFlash.delete(node); } };
  const strikerChip = (side, part) => part === 'core' ? el.hud.querySelector(`.s${side} .ball`) : hudChip(side, part);
  function flashHud(e) {
    const a = strikerChip(e.attacker, e.part), b = hudChip(e.target, e.targetPart);
    if (a) setFlash(a, `strike${e.attacker}`);
    if (b && b !== a) setFlash(b, 'hurt');
  }
  // The few big moments of a match say who did what to whom, once, where the eye can find it: one line 「拖鞋 撞碎了
  // 马克杯！」 at a fixed spot under the HUD for about 1.4 s, or with ?call=slot the striking piece's HUD slot grows and
  // stays lit as long (凡朔 11-11, Pollux 52464265, Elara d021fab4). Only the player's own landed 冲 and 暴击, and a piece
  // broken on either side: three or four a match (Elara 8dbd9359). A line holds at least 1.2 s on screen (the picture's
  // clock, so slow motion and hit-stop count; Sol 7ff4ad44) before a newer one may replace it, a break its whole 1.4 s;
  // a break in the same step (replay time) as the 冲 that did it takes that line over, counted once. 「弹开！」 holds the line
  // against nothing but takes it from anything but a break: it and 冲中, whichever comes later shows (Elara 1cdf161b).
  const HILITE = q.get('call') === 'slot' ? 'slot' : 'line', HILITE_TIME = 1.4, HILITE_HOLD = 1.2, DEFLECT_LINE_TIME = 0.9;
  // `${side}:${part}` → the blow that took its last hp (hpAfter 0), a rebound's included (Sol f82fe05f); the last blow
  // that hurt it stands in for a replay recorded before hpAfter.
  const killer = new Map(), lastHurt = new Map();
  // 'break' events waiting for the batch of ceramic shards that caused them (Elara f08a6c36, 937d44f2).
  const heldBreaks = new BreakHolds();
  let hilite = null; // {t, broke, age, node, deflect}: the line now up, `age` its seconds on screen, `node` its slot with ?call=slot
  const partName = (part, item) => part === 'core' ? '核心' : NAMES[item] ?? '';
  // `who`: words for the striker in place of its piece's name (a break no recorded blow explains); `at`: where it happened.
  function highlight(t, side, part, item, verb, target, targetPart, targetItem, broke = false, who = partName(part, item), at = null) {
    const same = hilite && !hilite.deflect && Math.abs(t - hilite.t) < 1e-6;
    // A break always takes the line, even over another break: a broken piece never goes without its words, and none
    // follow the top (Elara 937d44f2). The 1.2 s hold is for the other lines, and ?call=slot keeps its own rules.
    const takes = broke && HILITE === 'line';
    // 挡分两档 puts the line over the contact, where the newest word always takes the place of the one up (Elara 4efa6f73).
    if (!takes && hilite && !hilite.deflect && (same ? !broke || hilite.broke : !tiered && hilite.age < (hilite.broke ? HILITE_TIME : HILITE_HOLD))) return false;
    if (phase === 'play' && !same) test.highlights++;
    const was = hilite?.node;
    // ?call=slot: a 「弹开！」 plate still up goes with the line it gave way to (Sol 9961be5a).
    if (hilite?.deflect) overlay.dropHighlight();
    hilite = {t, broke, age: 0, node: null};
    if (HILITE === 'slot') {
      const a = strikerChip(side, part);
      // The replaced slot goes out, so two never stay lit together.
      if (was) dropFlash(was);
      if (a) { dropFlash(a); setFlash(a, `star${side}`, HILITE_TIME); }
      hilite.node = a;
      return true;
    }
    const whom = targetPart ? partName(targetPart, targetItem) : '';
    const spot = at ?? stage.fighters[target]?.center;
    if (tiered && spot) {
      // No room for the whole line at 390 wide: 「锅 冲中！」, 「马克杯 碎了！」.
      const short = broke ? whom && {who: whom, verb: '碎了', whom: '', side: target, whomSide: target} : {who, verb, whom: '', side, whomSide: target};
      overlay.stampLine(spot, {who, verb, whom, side, whomSide: target}, short, HILITE_TIME, faces2P(side));
      return true;
    }
    const top = el.hud.getBoundingClientRect().bottom - el.app.getBoundingClientRect().top + 12;
    overlay.highlight({who, verb, whom, side, whomSide: target}, top, HILITE_TIME);
    return true;
  }
  // 挡分两档: the foe's 「now」. Its top flashes magenta from 凡朔's arcs with a short tick CUE_LEAD before it launches:
  // seen, plus about a quarter second to react, the press lands in the 完美 window (Elara b3365358). The wind-up's squash
  // and glow still say 「it's coming」. `cueAt`: replay time of the one due, null with none.
  const CUE_LEAD = 0.3;
  let cueAt = null;
  function cue(side = 1) { cueAt = null; stage.launchFlash(side); sfx.cue(); dip(0.55); }
  // BGM down for a moment (第二轮补, Elara 16120707): a perfect block, a piece breaking, the charge's 「press now」, which
  // the other side must hear to block; the decisive slow motion holds it down in the loop. Wall-clock seconds.
  let dipUntil = 0;
  const dip = secs => { dipUntil = Math.max(dipUntil, performance.now() + secs * 1000); };
  // A new match, a jump back into the decisive replay, or a skip to the end: no line, slot or blame carries over (Sol f82fe05f).
  function resetHighlights() {
    cueAt = null; hilite = null; killer.clear(); lastHurt.clear(); heldBreaks.clear(); heldParry = null; lungeDir.fill(null);
    for (const [node, f] of hudFlash) if (f.cls.startsWith('star')) dropFlash(node);
  }
  function updateHudFlash(dt) {
    if (hilite && (hilite.age += dt) >= HILITE_TIME) hilite = null;
    for (const [node, f] of hudFlash) {
      f.age += dt;
      const on = f.age < f.dur;
      node.classList.toggle(f.cls, on);
      if (!on) hudFlash.delete(node);
    }
  }
  // cut: gone at once, no fade. The result card rises where it was, and the card says the same reason (Elara 8dbd9359).
  function setCaption(on, text, cut = false) {
    if (text !== undefined) el.captionText.innerHTML = reasonHtml(text);
    el.caption.classList.toggle('cut', cut && !on);
    el.caption.classList.toggle('on', on);
  }

  // 第 13 版: a one-word verdict on the player's own 挡, over its own top, gone within a second; since 11-11 only 完美 is
  // left (Elara d021fab4). The opponent's get the picture only (Elara 714284f2).
  function verdict(side, text, cls) {
    const f = stage.fighters[side];
    if (side !== 0 && !pvp || !f) return;
    overlay.verdict(f, text, cls, undefined, faces2P(side));
  }
  // How far the aim arrow reaches from the core: the lunge's carry, but no further than the far side of the target as it
  // stands (Kimi fbe3bc4a 2678e876: a near-camera arrow running past it took half the phone screen). The carry is the
  // sim's own free lunge for this build (`reach`, the core's travel, so its front edge goes a sweep further; heavier
  // builds lunge shorter); older replays without it use the plain speed × time (Elara 207a725b).
  function aimReach(side, reach) {
    const a = stage.fighters[side], b = stage.fighters[1 - side];
    const carry = reach !== undefined && a ? reach + a.sweep : rules.manual.dashSpeed * rules.manual.dashTime;
    // The head lands just past the target so it is not hidden under it, and the arrow is never shorter than ~0.9 m.
    return a && b ? Math.min(carry, Math.max(Math.hypot(b.center.x - a.center.x, b.center.z - a.center.z) + b.sweep + 0.4, a.sweep * 1.05 + 0.9)) : carry;
  }
  // A replay jumped into mid-lunge has no 'go' to say where it went: from the lunger's core to where it struck.
  function towardPoint(side, point) {
    const a = stage.fighters[side];
    return a && point ? [point.x - a.center.x, 0, point.z - a.center.z] : null;
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
    'perfect-foe': e => e.type === 'blockResult' && e.outcome === 'perfect' && e.side === 1,
    empty: e => e.type === 'blockResult' && e.outcome === 'empty' && e.side === 0,
    tight: e => e.type === 'blockResult' && e.outcome === 'tight' && e.side === 0,
    'go-foe': e => e.type === 'dash' && e.phase === 'go' && e.side === 1 && e.t > 1,
    // 冲挡: the player's block bounces the foe off (deflect), or the player's own lunge is bounced (stun).
    deflect: e => e.type === 'blockResult' && e.deflected && e.side === 0,
    stunned: e => e.type === 'blockResult' && e.deflected && e.attacker === 0,
    miss: e => e.type === 'dash' && e.phase === 'end' && quality(e) === 'miss' && e.side === 0,
    glance: e => e.type === 'dash' && e.phase === 'end' && quality(e) === 'glance' && e.side === 0,
    // Any end of the player's own lunge (aim-check.mjs compares the arrow's grey with the sim's verdict).
    'end-mine': e => e.type === 'dash' && e.phase === 'end' && e.side === 0,
    shards: e => e.type === 'archetype' && e.archetype === 'brittle',
    // The player's 冲 landing (「冲中」).
    'hit-mine': e => e.type === 'hit' && e.attacker === 0 && e.dash && !e.parry && e.damage > 0
  };

  // ---------- events → effects ----------
  // 谁打谁看位置 (combat=position): the replay says so; a live match's events carry positionClash.
  const positionCombat = e => replay?.meta?.combat === 'position' || typeof e.positionClash === 'boolean';
  // A piece breaking: its line (with ?call=slot, its striker's slot and 「…碎了」 over the top), the model flying off, a
  // crunch and a jolt. `late`: it waited for ceramic shards, so the 「…碎了」 goes where the piece is now.
  function breakNow(e, late = false) {
    const k = `${e.target}:${e.targetPart}`, by = killer.get(k) ?? lastHurt.get(k);
    // A break always takes the line (Elara 8dbd9359, 937d44f2); with no recorded blow it still says what broke:
    // 「盘子 碎了！」 (Elara cd8eb72d).
    const at = stage.breakPart(e.target, Number(e.targetPart.split('-')[1]), e);
    if (by) highlight(e.t, by.side, by.part, by.item, '撞碎了', e.target, e.targetPart, e.item, true, undefined, at);
    else if (HILITE === 'line') highlight(e.t, e.target, null, null, '碎了', e.target, null, null, true, NAMES[e.item] ?? '', at);
    // New feel: the picture holds as the replay's does, and the piece's slot under the HUD shakes, cracks and goes dark
    // (凡朔's 对象 lost the break among the knocks; Elara 2621157e). ?feel=old as it was.
    if (pb?.dashOnlyImpact) pb.freezeFor(BREAK_STOP);
    dip(0.5);
    const chip = !oldFx && hudChip(e.target, e.targetPart);
    if (chip) { dropFlash(chip); setFlash(chip, 'crack', 0.6); }
    sfx.crunch();
    buzz(25);
    stage.shakeV4(0.8);
    const broke = [late && at ? at : new THREE.Vector3().fromArray(e.pose.pos), `${pvp ? '' : `${sideName(e.target)}的`}${NAMES[e.item] ?? ''}碎了`, `broke t${e.target}`, 1.8];
    // Over the top only with ?call=slot; the line always takes a break (Elara 937d44f2).
    if (HILITE === 'slot') { if (e.t - lastParryT < 1e-6) lateNums.push({wait: 0.5, broke}); else overlay.number(...broke); }
    // The camera never moves; only a piece or a core breaking jolts the picture: hard since 冲挡加重 (Elara fa18a1da).
    if (oldFx) stage.shake(4); else stage.shake(10, 0.3);
    overlay.screenFlash(0.25);
  }
  // A lunge into a raised shield: it is bounced, and that should read at a glance (white flash, a clang, a
  // short slow motion from Playback, the lunger flung away trailing streaks). The words come from blockResult /
  // the lunge's end, and only for the player's own top.
  function parryNow(e, point) {
    stage.parry(e.target, point, e.attacker);
    stage.punch(point, 7);
    overlay.screenFlash(0.45);
    sfx.clang();
    buzz([25, 40, 45]);
  }
  // After each step: a parry no deflect stood in for still shows.
  function flushParry() {
    if (heldParry && Math.abs(heldParry.e.t - lastDeflectT) > 1e-6) parryNow(heldParry.e, heldParry.point);
    heldParry = null;
  }
  // 冲挡加重 (Elara fa18a1da): a block that bounced the other top away (Sol 661f75e1). A small ring and sparks at the contact,
  // the bounced top flung with streaks, the picture shakes, Playback slows 0.12 s (0.15 s for a perfect one, a lunge caught
  // head-on), and for the player's own block one word, 「弹开！」, in the line under the HUD (deflectLine). The other top's
  // block gets the picture only. It stands in for the parry of the same step.
  function deflect(e, point) {
    lastDeflectT = e.t;
    const perfect = !!e.perfect, at = point ?? stage.fighters[e.side]?.center;
    if (!at) return;
    // Light at the contact point only, so both tops read through the slow motion (Elara aa5b5c83); the screen flash is a
    // hint, never a white-out (Elara 2065efad).
    stage.deflect(e.side, at, e.attacker);
    overlay.screenFlash(0.1);
    stage.shake(perfect ? 9 : 6, perfect ? 0.26 : 0.2);
    stage.shakeV4(perfect ? 1 : 0.7);
    sfx.clang();
    if (perfect || tiered) { sfx.perfect(); dip(0.5); }
    buzz(perfect ? [30, 40, 60] : [25, 40]);
    // 挡分两档: 「完美！」 over the contact, clear of both tops, in place of the 「弹开！」 line under the HUD (Elara 896cf31c).
    if (e.side === 0 || pvp) { if (tiered) overlay.stamp(at, '完美！', 'perfect', undefined, faces2P(e.side)); else deflectLine(e.t); }
  }
  // 「弹开！」: a small dark plate where 冲中 goes, not on the tops (Elara 2065efad), one look for every bounce (Elara 03075914).
  // It takes the line from anything but a break, which a broken piece never goes without, and gives it up to anything.
  function deflectLine(t) {
    if (hilite?.broke && hilite.age < HILITE_TIME) return;
    if (hilite?.node) dropFlash(hilite.node);
    hilite = {t, broke: false, age: 0, node: null, deflect: true};
    const top = el.hud.getBoundingClientRect().bottom - el.app.getBoundingClientRect().top + 12;
    overlay.plate('弹开！', 'deflect', top, DEFLECT_LINE_TIME);
  }
  function onEvent(e) {
    if (e.type === 'contact' || e.type === 'hit' || e.type === 'weak') stage.kitchen?.photo.noteCollision();
    const point = e.point ? new THREE.Vector3().fromArray(e.point) : null;
    if ((e.type === 'hit' || e.type === 'weak') && e.damage > 0) {
      const k = `${e.target}:${e.targetPart}`, by = {side: e.attacker, part: e.part, item: e.item};
      lastHurt.set(k, by);
      if (e.hpAfter === 0 && !killer.has(k)) killer.set(k, by);
    }
    if (e.type === 'hit' || e.type === 'weak') {
      if (e.role === 'recoil') { stage.flashPart(e.target, e.targetPart, 0.3); return; }
      // 冲挡加重: a glance (a lunge off its lane) is the smallest ordinary knock however it struck: no core-sized shake, no
      // 暴击 flash or line, so it never reads like a landed 冲; its damage and breaks show as usual (Elara 14f39c4f).
      const glance = !oldFx && e.dashQuality === 'glance', crit = e.type === 'weak' && !glance;
      // A 冲 caught on a raised shield: the deflect in the same step is its picture, so the blow only nudges the struck
      // piece, no white burst, ring or edge over the two tops (Elara aa5b5c83). ?feel=old keeps its full knock.
      const caught = !oldFx && e.parry;
      // 一合一分: a plain bump's picture and sound come once from its exchange; its damage still counts (HUD, breaks).
      const plain = round && !(e.dash && !e.parry) && !caught;
      const core = e.targetPart === 'core' && !glance, big = core || crit || e.tier >= 2 && !glance, dash = e.dash && !e.parry;
      if (dash) {
        // A landed lunge: the full treatment (hit-stop is in Playback): spark lines, a camera punch, a heavy thump.
        // ?feel=old is as bright as the old 评委版 (Elara e6f14ad0). The new feel keeps the light at the contact, smaller and
        // warmer, so the struck piece reads through the hit-stop (Elara aa5b5c83); 凡朔's field and colours stay as they are.
        if (oldFx) stage.burst(point, [WHITE, HOT, TEAM[e.attacker], WHITE, SPARK], 80, 3.8, 0.042, 0.75);
        else stage.burst(point, [HOT, TEAM[e.attacker], SPARK, WHITE], 44, 3.6, 0.026, 0.5);
        stage.impact(point, oldFx ? 1 : 0.7, oldFx ? [WHITE, HOT, TEAM[e.attacker]] : [HOT, SPARK, TEAM[e.attacker]]);
        // The view lurches on along the lunge and pushes in (Elara fa18a1da); ?feel=old keeps the 评委版's small push-in.
        if (!oldFx) stage.lungePunch(point, lungeDir[e.attacker] ?? towardPoint(e.attacker, point), 16, 0.24);
        stage.ring(point, WHITE, 0.05, oldFx ? 1.0 : 0.55, 0.3);
        overlay.screenFlash(oldFx ? 0.32 : 0.14);
        sfx.dashHit();
        buzz(40);
      } else if (caught) {
        lastKnockT = e.t;
        sfx.hit(0.5);
      } else if (round) {
        // 一合一分: a plain bump's spark, 锵 and shake come once from its exchange (below), not from each piece it touched.
        lastKnockT = e.t;
      } else {
        // An ordinary knock: the same, scaled down.
        lastKnockT = e.t;
        stage.burst(point, [WHITE, SPARK, TEAM[e.attacker], WHITE], big ? 40 : 22, big ? 2.8 : 2.0, big ? 0.03 : 0.022, big ? 0.6 : 0.45);
        stage.impact(point, e.shield ? 0.18 : big ? 0.65 : 0.32, [WHITE, SPARK, TEAM[e.attacker]]);
        overlay.screenFlash(big ? 0.05 : 0.025);
        sfx.hit(glance ? 0.6 : Math.min(1, 0.35 + (e.closingSpeed ?? 3) / 12 + (big ? 0.2 : 0)), {core, crit});
      }
      // Every blow shakes the picture, 凡朔's fixed camera included (photo-kitchen.js).
      if (!plain) stage.shakeV4(core ? 0.75 : big ? 0.5 : 0.3);
      // Core hit: a ring in the victim's colour; a hugging piece taking it: a pale "blocked" ring.
      if (!caught && !plain) stage.ring(point, core ? TEAM[e.target] : e.targetOrient === 'hug' ? BLOCK : WHITE, 0.04, big ? 0.75 : 0.5, big ? 0.4 : 0.3);
      // The striking piece gets a glowing edge in its colour, the struck one flashes too (a clash: both edged). It says which
      // piece hit now that no word plate does (凡朔 11-11, Elara 207a725b b2bd14f1); position combat edges every touch.
      if (!caught && !plain && (positionCombat(e) || e.damage > 0)) stage.strike(e.attacker, e.part, point);
      if (!plain) stage.flashPart(e.target, e.targetPart, caught ? 0.3 : (core ? 1 : 0.75) * (dash && !oldFx ? 0.6 : 1));
      if (e.damage > 0) {
        if (e.dash && !e.parry) stage.ring(point, TEAM[e.attacker], 0.1, 1.3, 0.4);
        flashHud(e);
        if ((e.attacker === 0 || pvp) && (crit && !plain || e.dash && !e.parry)) highlight(e.t, e.attacker, e.part, e.item, crit ? '暴击' : '冲中', e.target, e.targetPart, e.targetItem, false, undefined, point);
      }
      if (core && !caught && !plain) overlay.screenFlash(dash && !oldFx ? 0.06 : 0.18);
      // A 冲 that also found the weak spot keeps the new feel's lowered light: the hot ring still marks the crit (Sol 9961be5a).
      if (crit && !caught && !plain) { overlay.screenFlash(dash && !oldFx ? 0.06 : 0.45); stage.ring(point, HOT, 0.05, dash && !oldFx ? 0.6 : 0.9, 0.45); }
    } else if (e.type === 'exchange') {
      // 一合一分 (Elara 41cd88d6): every exchange knocks both tops apart and each slide shows as a short trail. A plain bump
      // is a light spark, a short 锵 and a light shake, no freeze and no word; a 冲 or 挡 keeps its own picture (hit, blockResult).
      stage.recoil(0);
      stage.recoil(1);
      if (e.kind === 'bump') {
        stage.bump(point);
        stage.shakeV4(0.2);
        sfx.clank();
      }
    } else if (e.type === 'dashCue') {
      // The foe's flash, timed by the sim from where its lunge will meet (it can come after the launch); 一机双人, either side's.
      if (e.side === 1 || pvp) cue(e.side);
      if (e.side === 1) teachFlash(e);
    } else if (e.type === 'break') {
      // A piece the ceramic shards broke breaks when they land (Elara f08a6c36); any other break shows at once.
      if (!heldBreaks.hold(`${e.target}:${e.targetPart}`, e)) breakNow(e);
    } else if (e.type === 'archetype' && e.archetype === 'brittle') {
      // 陶瓷炸片: the plate cracks a beat after the blow, bursts, and the shards fly into the piece the sim hurt; no new
      // words. Its HUD slot, and a break the sim records in the same step (its line naming the ceramic piece), wait for them.
      const k = `${e.target}:${e.targetPart}`;
      if (e.damage > 0) {
        const by = {side: e.side, part: e.part, item: e.item};
        lastHurt.set(k, by);
        if (e.hpAfter === 0) killer.set(k, by);
      }
      const batch = heldBreaks.shoot(k, e.hpAfter === 0);
      stage.ceramicShards(e.side, e.part, e.target, e.targetPart, {hold: e.hpAfter === 0 ? batch : null, owe: e.damage, burst: () => sfx.porcelain(), landed: () => {
        sfx.chink();
        const chip = e.damage > 0 && hudChip(e.target, e.targetPart);
        if (chip) setFlash(chip, 'hurt', 0.7);
        const b = heldBreaks.land(batch);
        // Gone already if its core broke while they flew (scatter took it).
        if (b && stage.fighters[e.target]?.parts[Number(e.targetPart.split('-')[1])]?.alive) breakNow(b, true);
      }});
    } else if (e.type === 'dash') {
      if (e.phase === 'charge') {
        stage.charge(e.side, e.until - e.t);
        // 第 13 版: the direction is set at the press; show it through the wind-up so both sides can read the lunge.
        // Only the player's own arrow greys out when the target leaves the full-lunge lane (Elara 80e885bc); the opponent's is unchanged.
        // Where a lunge is judged on the surface it meets (#109), a wide piece can land one off that lane, so the arrow stays lit (Elara c4bcd7c1).
        const lane = e.side === 0 && !combatOptions.combatRules?.impactDashContacts ? rules.manual.dashAlignment : null;
        stage.aim(e.side, e.lockedDir ?? towardFoe(e.side), e.until - e.t, aimReach(e.side, e.reach), lane);
        sfx.charge(e.until - e.t);
        if (tiered && !round && e.side === 1) cueAt = Math.max(e.t, e.until - CUE_LEAD);
      } else if (e.phase === 'go') {
        lungeDir[e.side] = e.dir;
        stage.lunge(e.side, e.dir, rules.manual.dashTime);
        if (e.side === 1 && cueAt !== null) cue();
        sfx.whoosh();
      }
      else {
        if (e.side === 1) cueAt = null;
        stage.endLunge(e.side);
        // How the lunge ended, as the sim judged it (full / glance / miss / blocked); the page never judges a hit itself.
        const q = quality(e);
        // 冲空, 擦边 and 被挡 say no word (凡朔 11-11, Elara d021fab4); a miss still shows and sounds its whiff.
        if (q === 'miss') { stage.whiff(e.side); sfx.whiff(); }
        // 冲挡加重: a glance (off the lunge's lane) still knocks like an ordinary collision, its spark, sound and small shake,
        // when the step showed none (a hit inside the shared damage cooldown sends no hit); never the 冲中 treatment, no
        // word (Elara 61eededb). ?feel=old keeps the 评委版's silence.
        else if (q === 'glance' && !oldFx && e.t !== lastKnockT) {
          const at = point ?? stage.fighters[e.side]?.center;
          if (at) {
            stage.burst(at, [WHITE, SPARK, TEAM[e.side], WHITE], 22, 2.0, 0.022, 0.45);
            stage.impact(at, 0.32, [WHITE, SPARK, TEAM[e.side]]);
          }
          overlay.screenFlash(0.025);
          sfx.hit(0.6);
          stage.shakeV4(0.3);
        }
      }
    } else if (e.type === 'dashAim') {
      // The lunge follows the target until just before it goes (Sol, 同平面 PR #103): the arrow turns and resizes with it.
      stage.reaim(e.side, e.lockedDir, aimReach(e.side, e.reach));
    } else if (e.type === 'block') {
      stage.raiseShield(e.side, e.until - e.t);
      sfx.ting();
    } else if (e.type === 'blockResult') {
      teachBlocked(e);
      // 老龟's second block of a lunge this match: once, its result card's line beside the player's top (Elara 424f0bcb).
      if (wenHint && e.side === 1 && e.outcome !== 'empty' && ++wenHint.caught === 2) overlay.nudge(WEN_HINT.replace('：', '\n'), 'deflect nudge two', WEN_HINT_TIME);
      // 「挡住了，点冲反打」 only after a 完美: a 勉强 leaves the lunge unstunned, so the 冲 after it is no counter (Elara 4977a695).
      if (nudge && e.side === 0 && e.outcome !== 'empty') { nudge.caught++; nudge.held ||= e.outcome === 'perfect'; }
      // 第 13 版: one result per block window. "empty" only means nothing was caught (not necessarily too early).
      if (e.deflected) deflect(e, point);
      else if (e.outcome === 'tight') {
        // 勉强: caught, but pressed early. Half a flare, a dull knock, a small faded word; no slow motion (Elara 896cf31c).
        stage.tightBlock(e.side, point);
        sfx.thud();
        buzz(20);
        const at = point ?? stage.fighters[e.side]?.center;
        if ((e.side === 0 || pvp) && at) overlay.stamp(at, '勉强', 'tight', undefined, faces2P(e.side));
      } else if (e.outcome === 'perfect' && e.damageApplied !== false) {
        stage.perfectBlock(e.side, point);
        overlay.screenFlash(0.2);
        sfx.perfect();
        dip(0.5);
        verdict(e.side, '完美', 'perfect');
      } else if (e.outcome === 'perfect') {
        // Caught a real new contact while the shared damage cooldown let nothing through (damageApplied false, Elara
        // c65e070d): it still counts as held, one size smaller, no 「完美」.
        stage.perfectBlock(e.side, point, 0.6);
        sfx.ting();
      } else { stage.fizzle(e.side); sfx.fizzle(); }
    } else if (e.type === 'parry') {
      // A 「…碎了」 still up from an earlier break would read as this blow's result: clear it (Elara 80e885bc, Wren's 被挡 shot).
      lastParryT = e.t;
      overlay.hurry('broke');
      // ?feel=old has no deflect: the parry shows at once. Otherwise it waits for the end of this step.
      if (oldFx) parryNow(e, point); else heldParry = {e, point};
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
      if (oldFx) stage.shake(6); else stage.shake(13, 0.4);
      overlay.screenFlash(0.5);
      sfx.ko();
      buzz(70);
      stage.shakeV4(1.1);
      overlay.showBanner('核心碎了', replay.meta.winner === 0 || pvp && replay.meta.winner === 1 ? HEX[replay.meta.winner] : '#ffffff', 1.3);
    }
    test.onEvent(e);
  }

  // ---------- 第一关教学 ----------
  // A new phone's first 莽牛 (Elara 534cbd22, from Altair's plan): four times the fight stops dead and the screen goes dark
  // but for what the stop is about, with a card beside it (a title, two lines at most). Only the lit button goes on, with
  // no time-out; a tap anywhere else does nothing but make it hop; 跳过 on the card ends the lesson.
  // 1 the tops come on: both tops and the bars, 知道了. 2 they close in: 冲 and your top. 3 莽牛 flashes for a lunge with 挡
  // ready: 莽牛 and 挡. The lesson's 挡 is taken at the physics step a shadow match has shown to be a 完美 (it replays the
  // live presses and tries the step), so it gets the bounce it promised. 4 莽牛 bounced off and reeling, 冲 lit as 反打:
  // 莽牛 and 反打, and a 冲 then lands as the counter (counterLit, the light ①).
  // The sim never runs more than LIVE_LEAD past the picture, so it stops with it (Elara d308f7b8): a press any time in a
  // stop is the same press. For 4 the sim waits at the lit step (teachStep) and the picture comes up to it. Not again on
  // this phone, nor in 一机双人 or a replay; ?coach=again brings it back.
  const TEACH_KEY = 'wanwu-teach-seen';
  // Stop 1 this far into the fight (s): the tops are in and not yet close (stop 2 comes at about .55).
  const TEACH_INTRO = 0.2;
  // How far ahead (s of fight) the shadow looks for the lunge's touch.
  const TEACH_LOOK = 2.5;
  // How far the tops close in (metres between cores from the start) before stop 2; the 挡 goes in this many physics steps
  // before the lunge touches, well inside the 完美 window.
  const TEACH_NEAR = 0.35, TEACH_EARLY = 8;
  // Stop 4 once this much of the counter window is left (a fifth gone: 莽牛 seen bounced off).
  const TEACH_REEL = 0.8;
  // The card at each stop, its two lines broken where the sentence breaks (20 characters at most: one line at 360 wide);
  // the words are the sim's (counterDamage 5.2 to a 冲's 1.9; a 完美 stuns the lunger).
  const TEACH_CARD = {
    intro: ['撞碎它的核心就赢', '陀螺自己转、自己撞。外面挂的是你的东西，\n中间是核心，先把对面核心撞碎的赢。'],
    dash: ['冲', '点「冲」朝它撞过去。\n冲完要等一会儿才能再冲。'],
    block: ['它一闪光，点挡', '闪光就是它要冲过来了。\n这时挡住，能把它弹开、撞晕。'],
    counter: ['挡住了，反打', '它晕着的时候，「冲」会亮成「反打」，\n这时冲过去伤害最重。']
  };
  // The press each stop waits for.
  const TEACH_PRESS = {dash: 'dash', block: 'block', counter: 'dash'};
  let teach = null;
  function teachStart(args) {
    teach = null;
    if (!live || pvp || !round || fought === null || LADDER[fought].id !== 'mang') return;
    try { if (q.get('coach') !== 'again' && localStorage.getItem(TEACH_KEY) === '1') return; localStorage.setItem(TEACH_KEY, '1'); } catch { /* no storage here: every first 莽牛 */ }
    // lesson: 0 waits for the tops to close (or a 冲 already taken: dashed), 1 for a lunge to wind up, 2 for the block's
    // 完美, 3 done. hold: the sim step stop 4 waits at.
    teach = {intro: false, lesson: 0, stop: null, args, blockAt: null, armed: false, lit: false, hold: null, dashed: false};
  }
  function endTeach() {
    teach = null;
    teachHide();
    el.blockBtn.classList.remove('armed');
  }
  el.teachSkip.onclick = () => { if (teach) { diag.tap('teach', '跳过'); endTeach(); } };
  el.teachOk.onclick = () => { if (teach?.stop?.kind === 'intro') teachGo(); };
  el.teachOk.addEventListener('animationend', () => el.teachOk.classList.remove('hop'));
  // A tap in the shade: the lit button hops.
  el.teach.addEventListener('pointerdown', ev => { if (!el.teachCard.contains(ev.target)) teachNudge(); });
  function teachNudge() {
    const kind = teach?.stop?.kind;
    if (!kind || el.teach.hidden) return;
    replay_(kind === 'intro' ? el.teachOk : kind === 'block' ? el.blockBtn : el.dashBtn, 'hop');
  }
  function teachShow(kind) {
    const [title, line] = TEACH_CARD[kind];
    el.teach.dataset.kind = kind;
    el.teachTitle.textContent = title;
    el.teachLine.textContent = line;
    el.teachOk.hidden = kind !== 'intro';
    el.teach.hidden = false;
    // Only the button to press (if one is) lit and in reach.
    el.pad.dataset.lit = TEACH_PRESS[kind] ?? 'none';
    teachLayout();
  }
  function teachHide() {
    el.teach.hidden = true;
    delete el.pad.dataset.lit;
  }
  // The block stop's card waits for the shadow match (teachFlash).
  function teachStop(kind) {
    teach.stop = {kind};
    if (kind !== 'block') teachShow(kind);
  }
  // The stop ends: the lit button pressed. Full speed at once.
  function teachGo() {
    const s = teach?.stop;
    if (!s) return;
    teach.stop = null;
    teachHide();
    if (s.kind === 'dash') teach.lesson = 1;
    if (s.kind === 'counter') { teach.hold = null; teach.lesson = 3; }
    // The 挡 stop let go unpressed (跳过 aside, only by a shadow that found no 完美): the lunge comes on as it would.
  }
  // The speed the picture (and the sim behind it) runs at: 0 in a stop.
  function teachScale() { return teach?.stop ? 0 : 1; }
  // Each frame of play: stops 1 and 2 when their moment comes, 4 once the picture is up to the step the sim waits at; the
  // holes follow the tops.
  function teachTick() {
    if (!teach) return;
    if (!live || live.done) { endTeach(); return; }
    if (!teach.stop) {
      const [a, b] = pb.state.fighters;
      if (!teach.intro) {
        if (pb.t >= TEACH_INTRO) { teach.intro = true; teachStop('intro'); }
      } else if (teach.lesson === 0) {
        const c = live.match.control(0), d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        teach.d0 ??= d;
        // A 冲 already taken (Sol f06c02c1): stop 2 as soon as it is ready again, so its line on the wait is still read.
        if (c.dashIn <= rules.dt && !c.charging && !c.dashing && !(c.stunIn > 0) && (teach.dashed || teach.d0 - d >= TEACH_NEAR)) teachStop('dash');
      } else if (teach.hold !== null && pb.t >= teach.hold - rules.dt) teachStop('counter');
    }
    if (!el.teach.hidden) teachLayout();
  }
  // The holes over what the stop is about, rimmed, and the card beside them: under the tops if it fits above the
  // buttons, else over them under the bars, never on a hole.
  function teachLayout() {
    const kind = el.teach.dataset.kind, fa = stage.fighters[0], fb = stage.fighters[1], box = el.app.getBoundingClientRect();
    const holes = [], tops = [];
    for (const [n, f] of [[0, fa], [1, fb]]) {
      const p = {x: 0, y: 0};
      if (!f || !stage.project(f.center, p)) continue;
      const r = Math.max(30, stage.screenRadius(f.center, stage.reachOf(f) + 0.12));
      tops.push({x: p.x, y: p.y, r});
      if (kind === 'intro' || (n === 0) === (kind === 'dash')) holes.push({x: p.x, y: p.y, r});
    }
    const lit = kind === 'intro' ? el.hud : kind === 'block' ? el.blockBtn : el.dashBtn, rb = lit.getBoundingClientRect(), pad = kind === 'intro' ? 4 : 6;
    holes.push({x: rb.left - box.left - pad, y: rb.top - box.top - pad, w: rb.width + 2 * pad, h: rb.height + 2 * pad});
    const shape = h => h.r ? `<circle cx="${h.x.toFixed(1)}" cy="${h.y.toFixed(1)}" r="${h.r.toFixed(1)}" />` : `<rect x="${h.x.toFixed(1)}" y="${h.y.toFixed(1)}" width="${h.w.toFixed(1)}" height="${h.h.toFixed(1)}" rx="9" />`;
    const svg = holes.map(shape).join('');
    if (el.teachHoles.dataset.svg !== svg) { el.teachHoles.innerHTML = el.teachRims.innerHTML = svg; el.teachHoles.dataset.svg = svg; }
    if (!tops.length) return;
    const W = el.app.clientWidth, h = el.teachCard.offsetHeight, w = el.teachCard.offsetWidth;
    const padTop = el.pad.getBoundingClientRect().top - box.top, hudBottom = el.hud.getBoundingClientRect().bottom - box.top;
    const under = Math.max(...tops.map(t => t.y + t.r)) + 14, over = Math.min(...tops.map(t => t.y - t.r)) - 14 - h;
    const y = under + h <= padTop - 12 ? under : Math.max(hudBottom + 10, over);
    const x = Math.min(W - 8 - w / 2, Math.max(8 + w / 2, tops.reduce((s, t) => s + t.x, 0) / tops.length));
    el.teachCard.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
  // 莽牛 flashes for a lunge: stop 3, if 挡 is ready. The fight stops at once; the card comes up when the shadow match has
  // found a 挡 step that makes a 完美. No such step (the lunge would miss, or the shadow has not kept to the live match):
  // the fight goes on and the next flash is tried. A 挡 pressed before the card is up waits for it.
  async function teachFlash(e) {
    if (!teach || teach.lesson !== 1 || teach.stop || !live || live.done) return;
    const c = live.match.control(0);
    if (c.blockIn > rules.dt || c.stunIn > 0) return;
    teachStop('block');
    const stop = teach.stop, t = teach, m0 = live.match;
    const at = await teachPlan(e.t).catch(err => { console.warn('教学: 影子对局失败', err); return null; });
    if (teach !== t || t.stop !== stop || live?.match !== m0) return;
    // No 完美 to be had on this lunge: no stop, the next lunge with 挡 ready brings it.
    if (at === null) { t.stop = null; return; }
    t.blockAt = at;
    teachShow('block');
  }
  // The presses the live match took from the player so far, at the steps it took them.
  const takenPresses = m => m.events.flatMap(e => e.side === 0 && (e.type === 'block' || e.type === 'dash' && e.phase === 'charge') ? [{step: e.pressStep, side: 0, action: e.type}] : []);
  // A shadow of the live match (stopped now): the same start and the live presses, plus `extra`, run up to the live step.
  // The sim is deterministic, so it is the same fight; one that has not kept to it (other events, other places) is null.
  async function teachShadow(extra = []) {
    const m0 = live.match, now = m0.step, args = teach.args;
    const m = await createV3Match({...args, manual: {...args.manual, inputs: [...takenPresses(m0), ...extra]}});
    while (!m.done && m.step < now) m.advance();
    const a = m0.frames.at(-1), b = m.frames.findLast(f => f.t <= m.t + 1e-9);
    if (m.step !== now || m0.step !== now || m.events.length !== m0.events.length || !b || a.t !== b.t || a.fighters.some((f, i) => f.pos.some((v, k) => v !== b.fighters[i].pos[k]))) { m.free(); console.warn('教学: 影子对局对不上'); return null; }
    return m;
  }
  // The step to take the lesson's 挡 at for a 完美 on the lunge flashed at `from`, or null. First where the lunge would
  // first touch with nothing pressed; then that 挡, tried in a second shadow, moved to the touch it meets if need be.
  async function teachPlan(from) {
    const now = live.match.step, until = now + Math.ceil(TEACH_LOOK / rules.dt);
    let m = await teachShadow(), touch = null;
    if (!m) return null;
    try {
      for (let seen = m.events.length; touch === null && !m.done && m.step < until;) {
        m.advance();
        for (; seen < m.events.length && touch === null; seen++) {
          const e = m.events[seen];
          if (e.t > from && (e.type === 'dash' && e.phase === 'end' && e.side === 1 || e.damage > 0 && e.target === 0)) touch = Math.round(e.t / rules.dt);
        }
      }
    } finally { m.free(); }
    for (let tries = 0; touch !== null && tries < 3; tries++) {
      const at = Math.max(now + 1, touch - TEACH_EARLY);
      m = await teachShadow([{step: at, side: 0, action: 'block'}]);
      if (!m) return null;
      let got = null;
      try {
        for (let seen = m.events.length; !got && !m.done && m.step < until;) {
          m.advance();
          for (; seen < m.events.length && !got; seen++) if (m.events[seen].type === 'blockResult' && m.events[seen].side === 0) got = m.events[seen];
        }
      } finally { m.free(); }
      if (!got) return null;
      if (got.outcome === 'perfect' && got.deflected) return at;
      // Met later than planned (a 紧挡): go again from where the shield was met. An empty one: no lunge came in time.
      const met = Math.round(got.t / rules.dt);
      touch = got.outcome === 'empty' || met <= touch ? null : met;
    }
    return null;
  }
  // Before each live physics step: the armed 挡 goes in at its step. After its 完美 the sim waits (true) at the first step
  // 反打 is lit with TEACH_REEL of the window left, for stop 4; its light out before that (it stays out, updateSidePad)
  // or the window over: no stop 4.
  function teachStep(m) {
    if (!teach) return false;
    if (teach.hold !== null) return true;
    if (teach.lesson === 2 && teach.blockAt === null) {
      const c = m.control(0), lit = counterLit(c);
      if (teach.lit && !lit) teach.lesson = 3;
      else if (lit && c.counterIn <= TEACH_REEL + 1e-9) { teach.hold = m.t; return true; }
      teach.lit ||= lit;
      return false;
    }
    if (teach.blockAt === null || m.step + 1 < teach.blockAt || teach.stop) return false;
    teach.blockAt = null;
    if (!teach.armed) { teach.lesson = 3; return false; }
    teach.armed = false;
    el.blockBtn.classList.remove('armed');
    m.press(0, 'block');
    return false;
  }
  // The lesson's 挡 landed: anything but a 完美 ends the lesson there (a 完美 brings stop 4, teachStep).
  function teachBlocked(e) {
    if (!teach || teach.lesson !== 2 || e.side !== 0) return;
    if (e.outcome !== 'perfect' || !e.deflected) teach.lesson = 3;
  }

  // ---------- 提示出手 ----------
  // Stage 1 only (Elara af9e8542): a player who only blocks loses (Sol a8851e63), since 第三轮 ④ to the arena closing in
  // after 60 s rather than to the clock. After NUDGE_IDLE s without a 冲, or NUDGE_BLOCKS blocks that caught a lunge with no 冲 between, 冲 beats and a plate under the player's top
  // says why, for NUDGE_TIME s; twice a match at most, gone at the next 冲. Match seconds.
  const NUDGE_IDLE = 12, NUDGE_BLOCKS = 3, NUDGE_MAX = 2, NUDGE_TIME = 5;
  let nudge = null;
  const WEN_HINT_TIME = 4.5;
  let wenHint = null;
  function nudgeTick(t) {
    if (!nudge || phase !== 'play' || live?.done) return;
    if (nudge.on) { if (t - nudge.since >= NUDGE_TIME) nudgeOff(t); return; }
    if (nudge.shown >= NUDGE_MAX || t - nudge.since < NUDGE_IDLE && nudge.caught < NUDGE_BLOCKS) return;
    Object.assign(nudge, {on: true, since: t, caught: 0, shown: nudge.shown + 1});
    el.dashBtn.classList.add('nudge');
    // It says only what happened: 「挡住了」 once a block has caught one (Castor 72baf2c8, Elara ad7297c3).
    overlay.nudge(nudge.held ? '挡住了，点冲反打' : '点冲，朝它撞过去', 'deflect nudge', NUDGE_TIME);
  }
  // Out of the match (time up, a core broken, back to the build): nothing of the hint stays (Elara 27b4d4c3).
  function endNudge() { nudge = null; el.dashBtn.classList.remove('nudge'); overlay.dropNudge(); }
  function nudgeOff(t) {
    if (!nudge) return;
    Object.assign(nudge, {since: t, caught: 0});
    if (!nudge.on) return;
    nudge.on = false;
    el.dashBtn.classList.remove('nudge');
    overlay.dropNudge();
  }

  // A model is fetched only once a card or a build needs it, and can fail: the build changes only once it is here, so the
  // old one can always fight (Sol f0e85efc). say() puts a short line where 计算中 shows.
  const fetched = id => loadModels([byId.get(id)]).then(() => true, e => { console.error(e); return false; });
  // A choice waiting on its model belongs to the player, slot and screen it was made on: passing the phone, 开打, closing
  // or reopening the 角色库 or choosing again drops it (Sol 2622da9b), so a late model never picks for anyone.
  let choiceReq = 0;
  const choosing = () => { const ask = ++choiceReq, side = pick, slot = libSlot, was = phase;
    return () => ask === choiceReq && pick === side && libSlot === slot && phase === was; };
  let sayTimer = 0;
  function say(text) {
    clearTimeout(sayTimer);
    el.busyText.textContent = text;
    el.busy.classList.add('say');
    el.busy.hidden = false;
    sayTimer = setTimeout(() => { if (el.busy.classList.contains('say')) { el.busy.hidden = true; el.busy.classList.remove('say'); } }, 2600);
  }

  // ---------- match ----------
  let runId = 0;
  async function start() {
    if (phase !== 'build' || !el.error.hidden) return;
    const id = ++runId;
    choiceReq++;
    if (!fixedSeed) seed = randomSeed();
    fought = pvp ? null : ladderOn ? ladder.at : pinned >= 0 ? pinned : null;
    outcome = null;
    phase = 'computing';
    el.go.disabled = true;
    el.foeSheet.hidden = true;
    $('foeBtn').disabled = true;
    el.busyText.textContent = '计算中';
    el.busy.classList.remove('say');
    el.busy.hidden = false;
    // A build only changes once its models are here, so this fails only on a lost connection: back to the build, 开打 lit.
    try { await loadModels([...mine.parts, ...FOE.parts].map(p => byId.get(p.item))); } catch (e) {
      console.error(e);
      if (id !== runId) return;
      phase = 'build';
      el.go.disabled = $('foeBtn').disabled = !el.error.hidden;
      say('3D 没下载下来，再点一次开打');
      return;
    }
    await nextPaint();
    const t0 = performance.now();
    let r;
    live?.match.free();
    live = null;
    // 一机双人 is always played live: two people press.
    if (control === 'manual' || pvp) {
      // Played live: the sim steps just ahead of the picture and takes the buttons as it goes.
      // The opponent's play is fixed with its build as 开打 is pressed; one without its own (a build in ?foe=) plays the old way.
      const opponent = fought === null ? null : LADDER[fought];
      const ai = opponent && (combatOptions.combatRules?.impactControls && opponent.impactAi
        ? {...opponent.ai, ...opponent.impactAi}
        : opponent.ai);
      const manual = pvp ? {sides: ['input', 'input']} : {sides: ['input', 'ai'], ...(blockTime ? {blockTime} : {}), ...(ai ? {aiProfiles: [null, structuredClone(ai)]} : {})};
      const args = {fighters: [toDef(mine), toDef(FOE)], mode, seed, feel, ...combatOptions, ...(ceramic && {combatRules: {...combatOptions.combatRules, ceramicShards: true}}), manual};
      const match = await createV3Match(args);
      if (id !== runId) { match.free(); return; }
      r = {meta: {initial: match.initial, duration: Infinity, rules: match.rules, ...(combat && {combat})}, frames: match.frames, events: match.events, decisive: {eventIndex: null, why: null}};
      live = {match, done: false, args};
    } else {
      // Yield to the page every few hundred physics steps so the preview keeps spinning.
      r = await simulateV3({fighters: [toDef(mine), toDef(FOE)], mode, seed, feel, ...combatOptions, onProgress: () => new Promise(res => setTimeout(res, 0))});
    }
    test.simMs = performance.now() - t0;
    if (id !== runId) return;
    el.busy.hidden = true;
    replay = r;
    tiered = Boolean((live ? combatOptions.combatRules : r.meta.combatRules)?.guardTiming);
    round = Boolean((live ? combatOptions.combatRules : r.meta.combatRules)?.round);
    stage.trailAlways = !round;
    el.dashBtn.classList.remove('nudge');
    nudge = live && round && fought !== null && LADDER[fought].id === 'mang' ? {on: false, shown: 0, since: 0, caught: 0, held: false} : null;
    teachStart(live?.args);
    wenHint = live && round && fought !== null && LADDER[fought].id === 'wen' ? {caught: 0} : null;
    // Live under the reworked rules only a landed 冲 and a 挡 that caught one stop the picture (Elara 2065efad, Sol 54ec30e6).
    // 一合一分: an ordinary bump never stops a replay either (quietBumps).
    pb = new Playback(r, {dashOnlyImpact: Boolean(live) && !oldFx && combatOptions.combatRules?.refinedImpact === true, quietBumps: round});
    // A glance in a live match freezes no longer than an ordinary knock (Elara fc75c4cc); the result's replay is unchanged.
    pb.softGlance = Boolean(live) && !oldFx;
    liveSlowShown = false;
    stage.setFighters(r.meta.initial.map(f => f.definition));
    stage.clearFx();
    overlay.clear(); lateNums = []; resetHighlights();
    stage.setCameraMode('fight');
    stage.setFocusOn(null);
    stage.showMe = true;
    // 一机双人: straight down on the table, 2P's start up the screen and 1P's down it, so the two ends of the phone each
    // have their own half; both tops ringed and trailed alike.
    const [p0, p1] = r.meta.initial.map(f => new THREE.Vector3().fromArray(f.pos));
    stage.topDown = pvp ? p1.sub(p0).setY(0).normalize() : null;
    stage.showBoth = pvp;
    buildHud(r.meta.initial.map(f => f.definition));
    for (const h of hpView) Object.assign(h, {core: 1, chip: 1, since: 9});
    [0, 1].forEach(i => overlay.setCoreHp(i, 1, true));
    el.build.hidden = true;
    el.foe.hidden = true;
    el.hud.hidden = false;
    showPads(Boolean(live));
    if (!live) setCaption(false, reasonLine(r));
    captionHold = 0;
    lastParryT = lastKnockT = -Infinity;
    test.highlights = 0;
    layout_();
    stage.pose(pb.state);
    // The HUD and buttons as they stand at 0 s now, not on the next frame: 原样再战 showed the last match's seconds and
    // cooldowns for a frame (Castor, Elara a7234eb7).
    updateHud(0, pb.state); updatePad();
    stage.setLookahead(lookahead());
    stage.updateCamera(0, true);
    stage.setHeat(0);
    phase = 'ready';
    // Back the right way for the fight; 重选装备 afterwards starts again from 1P.
    if (pvp) { pick = 0; el.app.style.transition = 'none'; el.app.classList.remove('turned'); void el.app.offsetWidth; el.app.style.transition = ''; }
    // 准备 then 开打！ before anything counts, so a hand still on its way is not behind: both ends in 一机双人 (第二轮 ①), the
    // player's alone single-player (第三轮 ①, in place of 开转). The first lesson waits for 开打 (readyStep).
    getReady();
    // Shareable address on a normal page; sandboxed viewers (opaque origin) refuse URL changes, which is fine.
    // An address build still waiting for its photo item stays in the address, unless the player has changed that side (task #70).
    // ?foe= stays too, so a reload is still a measurement and not the ladder (Sol's S1 on PR #84).
    const waits = k => late[k] && sameBuild(k === 'mine' ? mine : FOE, k === 'mine' ? DEFAULT : DEFAULT_FOE);
    // 一机双人's builds are kept on the phone: its address says only that it is two players.
    const shootArgs = SHOOT_KEEP.filter(k => q.has(k)).map(k => `&${k}=${encodeURIComponent(q.get(k))}`).join('');
    if (pvp) { try { history.replaceState(null, '', `?pvp=1${fixedSeed ? `&seed=${seed}` : ''}${ceramicArg === '0' || ceramicArg === '1' ? `&ceramic=${ceramicArg}` : ''}${shootArgs}`); } catch { /* sandboxed viewer */ } return; }
    // A held build kept on the phone isn't named: the address would bring back the stand-in, and a reload reads the kept
    // one again; an address's stays as it came.
    const standIn = held.mine && sameBuild(mine, held.mine);
    try { history.replaceState(null, '', `?${standIn ? q.has('mine') ? `mine=${q.get('mine')}` : '' : `mine=${waits('mine') ? q.get('mine') ?? keptArg : buildArg(mine)}`}${ladderOn ? '' : `&foe=${pinned >= 0 ? LADDER[pinned].id : waits('foe') ? q.get('foe') : buildArg(FOE)}`}${fixedSeed ? `&seed=${seed}` : ''}${mode === 'B' ? '&mode=B' : ''}${control === 'auto' ? '&play=auto' : ''}${feelArg === 'old' ? '&feel=old' : feel ? '&feel=bounce' : ''}${combat ? '&combat=position' : ''}${camStyle !== 'slow' ? `&cam=${camStyle}` : ''}${blockTime ? `&block=${q.get('block')}` : ''}${HILITE === 'slot' ? '&call=slot' : ''}${ceramicArg === '0' || ceramicArg === '1' ? `&ceramic=${ceramicArg}` : ''}${stage.bench ? '&scene=kitchen' : ''}${shootArgs}`); } catch { /* sandboxed viewer */ }
  }
  function showResult() {
    showPads(false);
    endTeach();
    endNudge();
    if (pb.t < pb.end - 1e-6) {
      stage.clearFx();
      overlay.clear(); lateNums = []; resetHighlights();
      pb.seek(pb.end);
      stage.pose(pb.state);
    } else {
      // Ended right on the last frame: ceramic shards still in the air go now, not over the card (Elara 4f446065).
      stage.dropCeramic();
      heldBreaks.clear();
      stage.pose(pb.state);
    }
    phase = 'result';
    const m = replay.meta;
    stage.setCameraMode('result');
    stage.showMe = false;
    stage.setLookahead(null);
    // 一机双人 (第二轮 ②): each end is told about itself, 你赢了 / 你输了, not by a colour or a number to remember. The card
    // is 1P's (你 / 对面); 2P's own line is the plate turned to the head of the phone.
    const said = side => m.winner === null ? '平局' : m.winner === side ? '你赢了' : '你输了';
    el.winnerLine.textContent = said(0);
    el.result.className = m.winner === null ? 'draw' : m.winner === 0 ? 'win' : 'lose';
    el.resultMeta.textContent = `第 ${wholeSeconds(m.duration)} 秒 · ${endLine(replay)}`;
    const who = pvp ? ['你', '对面'] : [sideName(0), sideName(1)];
    el.whyLine.innerHTML = reasonHtml(reasonLine(replay, who));
    const defs = m.initial.map(f => f.definition);
    const foeRatings = m.combatRules?.itemRatings?.parts?.[1];
    const foeGrades = defs[1].parts.map((p, i) => {
      const rating = foeRatings ? ratingOf({rating: foeRatings[i]}) : rate(p.item);
      return rating?.grade ?? null;
    });
    const builds = defs.map((def, side) => def.parts.map((p, i) =>
      `<span>${gradeTag(side === 1 ? foeGrades[i] : rate(p.item)?.grade)}${esc(NAMES[p.item])}</span>`).join(''));
    el.resultBuild.innerHTML = `<span class="rw">${who[0]}</span>${builds[0]}<span class="rw vs">${pvp || fought === null ? who[1] : esc(LADDER[fought].name)}</span>${builds[1]}`;
    // 第二轮 ⑤: the run so far, each end from its own side.
    if (pvp && scored !== runId) { scored = runId; if (m.winner !== null) score[m.winner]++; }
    el.pvpScore.hidden = !pvp;
    el.pvpScore.textContent = `你 ${score[0]} : ${score[1]} 对面`;
    // 一机双人: the numbers and the tip are about 1P's play against the computer, so neither shows.
    const stats = matchStats(replay, defs, id => !shipped.has(id) && !sampleIds.has(id), {oldFeel: oldFx, foeGrades});
    el.statsList.innerHTML = pvp ? '' : pickStats(stats, m.winner).map(x => `<li><b>${esc(x.value)}</b><span>${esc(x.label)}</span></li>`).join('');
    el.tipLine.textContent = pvp ? '' : tipLine(stats, m.winner, fought === null ? null : LADDER[fought].id);
    outcome ??= ladderOutcome(m.winner);
    showOutcome(outcome);
    $('replayBtn').hidden = pb.slowAt === null;
    setCaption(false, undefined, true);
    // The highlight under the HUD goes with it, or it sits on the result's own lines (Elara 5fd78c17).
    overlay.dropHighlight();
    // 一机双人's bars stand where the card comes up: they go with the buttons, back for 重看. 2P gets who won in the top
    // half, turned to them, so nobody has to lean over the card (Elara 1d222196).
    if (pvp) { el.hud.hidden = true; overlay.dropWords(); }
    el.pvpWin.hidden = !pvp;
    el.pvpWin.className = m.winner === null ? 'draw' : m.winner === 1 ? 'blue' : 'lose';
    el.pvpWin.firstChild.textContent = said(1);
    el.pvpWin.lastChild.textContent = `你 ${score[1]} : ${score[0]} 对面`;
    el.result.hidden = false;
    layout_();
    // 回首页 stays over the mute unless the card comes up that far (a first win's unlock and 拍一件 lines): then just above it.
    // The camera eases over to the winner alone, above the card (a draw keeps both in frame).
    stage.setFocusOn(m.winner, el.result.offsetTop);
  }
  // A win over a ladder opponent: kept at once. The first win over one unlocks the next (打下一个), the first over the last
  // one is the 三个都赢了 ending (随便挑 opens the ladder). Losing, a draw, or ?foe= leave the result as it was.
  function ladderOutcome(winner) {
    if (pvp || !ladderOn || winner !== 0) return {act: 'again'};
    const id = LADDER[fought].id, first = !ladder.won.has(id);
    ladder.won.add(id);
    keepLadder();
    renderFoe();
    const last = fought === LADDER.length - 1;
    if (last) return {act: first ? 'pick' : 'again', clear: first};
    // The first win over 莽牛 points at 拍一件 too (Elara 6b6a3c3b): it is made while they fight the next one.
    return {act: 'next', unlocked: first ? fought + 1 : null, shootNow: first && id === 'mang'};
  }
  function showOutcome(o) {
    el.result.classList.toggle('clear', Boolean(o.clear));
    el.resultBuild.hidden = el.statsList.hidden = Boolean(o.clear);
    $('clearTrio').hidden = !o.clear;
    if (o.clear) {
      el.winnerLine.textContent = '三个都赢了';
      $('clearTrio').innerHTML = LADDER.map((f, i) => `<span><span class="tw">${markHtml(i)}<i>${SVG.check}</i></span>${esc(f.name)}</span>`).join('');
      // All three beaten: point at 拍一件 too, in plain words (Elara 2621157e, bd72b574); a tap opens it when the page has it.
      el.tipLine.innerHTML = shoot ? '现在三个随便挑。<br>也可以<button type="button" class="tipshoot">拍一件</button>你身边的东西，装上再打'
        : '现在三个随便挑，换个装法再打一轮';
      el.tipLine.querySelector('.tipshoot')?.addEventListener('click', () => shoot?.open('link', '结算'));
    }
    const card = $('unlockCard');
    card.hidden = o.unlocked == null;
    if (o.unlocked != null) {
      const f = LADDER[o.unlocked];
      card.innerHTML = `${markHtml(o.unlocked)}<span class="txt"><span class="k">${SVG.open}解锁下一个</span><b>${esc(f.name)}</b><span class="play">${esc(f.play)}</span></span>`;
      el.tipLine.innerHTML = o.shootNow && shoot ? `做好要 3 分钟左右，先去打${esc(f.name)}，回来就能装上` : '';
    }
    $('shootNowBtn').hidden = !(o.shootNow && shoot);
    $('againBtn').innerHTML = `<span>${pvp ? '重选装备' : o.act === 'next' ? '打下一个' : o.act === 'pick' ? '随便挑' : '换个装法再打'}</span>${SVG.arrow}`;
    $('againBtn').dataset.act = o.act;
    $('sameBtn').textContent = pvp ? '原样再战' : '原样再来';
    // 结算's way back, beside its main button: the 首页 in both modes when there is one (Pollux, Elara 56506aa2).
    $('soloBtn').hidden = !pvp && !homeOn;
    $('soloBtn').textContent = homeOn ? '回首页' : '回单人';
  }
  function replaySlow() {
    // A live match had no decisive slow motion; its finished replay has.
    if (live && !pb.full) { pb = new Playback(replay, {quietBumps: round}); pb.full = true; }
    if (!pb || pb.slowAt === null) return;
    el.result.hidden = el.pvpWin.hidden = true;
    el.hud.hidden = false;
    showPads(false);
    stage.clearFx();
    overlay.clear(); lateNums = []; resetHighlights();
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
  // The player's own photo items not put on yet: first in the 角色库, newest first, marked 新 (Elara 5ca726ff). Kept on
  // this phone once one goes into a slot; the 拍一件 tag's 「做好了 · 装上去打」 waits for that too.
  const PLACED_KEY = 'wanwu-placed';
  const placed = (() => { try { return new Set(JSON.parse(localStorage.getItem(PLACED_KEY) ?? '[]')); } catch { return new Set(); } })();
  const isPlaced = id => placed.has(id) || [mine, FOE].some(b => b.parts.some(x => x.item === id));
  const unplaced = () => OFFER.filter(id => !shipped.has(id) && !sampleIds.has(id) && !isPlaced(id)).reverse();
  function place(id) {
    if (placed.has(id)) return;
    placed.add(id);
    try { localStorage.setItem(PLACED_KEY, JSON.stringify([...placed])); } catch { /* no storage here */ }
    shoot?.paintTag();
  }
  function cardHtml(id, k, isNew) {
    const it = byId.get(id), other = cur().parts[1 - k].item === id, own = cur().parts[k].item === id;
    // Which side each tag means, not 已装/装着 (same word to a player, Elara 08bbe423).
    const side = j => j ? '右边' : '左边';
    const badge = other ? `<span class="badge">${side(1 - k)}在用</span>` : own ? `<span class="badge own">${side(k)}在用</span>` : isNew ? '<span class="badge new">新</span>' : '';
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
        <span class="nm">${gradeTag(rate(id)?.grade, 'big')}<span class="nmt"><b>${esc(NAMES[id])}</b>${(c => c ? `<span class="cat">${esc(c)}</span>` : '')(catLabel(it, NAMES[id]))}</span></span>
        ${rows}<small class="spec">${spec(id)}</small>
      </button>${foot}<span class="cover" aria-hidden="true"><i>?</i></span></article>`;
  }
  async function openLibrary(k, again = false) {
    const req = ++libReq, top = el.libGrid.scrollTop;
    if (!again) choiceReq++;
    libSlot = k;
    el.libTitle.textContent = `挑一件，装到${k ? '右边' : '左边'}`;
    el.libCount.textContent = `${OFFER.length} 件 · 点卡片就装上，回拼装页`;
    // Collection so far, best grade first (远夏 11-02: collect the S).
    const count = g => OFFER.filter(id => rate(id)?.grade === g).length;
    el.libGrades.innerHTML = `收集${GRADES.map(g => `<span><i class="g${g}">${g}</i>${count(g)}</span>`).join('')}`;
    const first = unplaced(), shown = [...first, ...byGrade(OFFER.filter(id => !first.includes(id)), rate)];
    el.libGrid.innerHTML = shown.map(id => cardHtml(id, k, first.includes(id))).join('');
    revealUnseen();
    el.libGrid.scrollTop = again ? top : 0;
    el.library.hidden = false;
    for (const card of el.libGrid.querySelectorAll('.card')) {
      const id = card.dataset.item;
      card.querySelector('.pick').onclick = async () => {
        if (cur().parts[1 - libSlot].item === id || card.classList.contains('wait')) return;
        // A just-shot item's 3D may still be on its way: the build changes once it is here (Sol f0e85efc).
        // A new card dealt in meanwhile redraws the grid, not the choice.
        const still = choosing();
        card.classList.add('wait');
        const ok = await fetched(id);
        card.classList.remove('wait');
        if (!still() || el.library.hidden) return;
        if (!ok) { say('它的 3D 没下载下来，再点一次试试'); return; }
        changed(cur().parts[libSlot].item, id);
        cur().parts[libSlot].item = id;
        place(id);
        closeLibrary();
        rebuild();
      };
      const how = card.querySelector('[data-how]');
      if (how) how.onclick = () => openHow(id);
    }
    // The 3D turns in as each model arrives (the page only loads a model once a card or a build needs it): the cards on
    // screen together first, so a small model is not stuck behind a big one (task #37), then the rest.
    turns.prune();
    const turnOf = id => el.libGrid.querySelector(`.card[data-item="${CSS.escape(id)}"] .turn`);
    const onScreen = shown.filter(id => { const r = turnOf(id)?.getBoundingClientRect(); return r && r.top < innerHeight && r.bottom > 0; });
    for (const group of [onScreen, shown.filter(id => !onScreen.includes(id))]) {
      // One that fails keeps its styled picture and leaves the others turning in.
      await Promise.all(group.map(async id => {
        if (!await fetched(id)) return;
        if (req !== libReq || el.library.hidden) return;
        const turn = turnOf(id);
        if (turn) turns.show(turn, id);
      }));
      if (req !== libReq || el.library.hidden) return;
    }
  }
  function closeLibrary() { libReq++; choiceReq++; el.library.hidden = true; }

  // 翻牌 (Elara 11-02 79a528bb): a grade this phone has not seen yet turns over when 拍一件's 好了 shows it, with a sound
  // by grade and gold for an S. Remembered per item and rating version, so a re-rated item turns over again there.
  // ?reveal=again resets it.
  const SEEN_KEY = 'wanwu-grades-seen';
  const gradesSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); } })();
  if (q.get('reveal') === 'again') gradesSeen.clear();
  const seenKey = id => `${id}:${rate(id)?.version}`;
  const REVEAL_FACE = 330; // ms into the turn when the face shows
  // In the 角色库 every card is face up from the start (Pollux acbd091c, Elara 0f310068): dealt face down, the ones
  // scrolled past too fast stayed a row of 「？」. What it shows now counts as seen, so 拍一件's 好了 doesn't turn it again.
  function revealUnseen() {
    const ids = [...el.libGrid.querySelectorAll('.card')].map(c => c.dataset.item).filter(id => rate(id) && !gradesSeen.has(seenKey(id)));
    if (!ids.length) return;
    for (const id of ids) gradesSeen.add(seenKey(id));
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...gradesSeen])); } catch { /* no storage here */ }
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
        // Measured on the screen; on 2P's turn the page is upside down, so the way there is too.
        const way = el.app.classList.contains('turned') ? -1 : 1;
        lift.style.setProperty('--dx', `${way * (f.left + f.width / 2 - (r.left + r.width / 2))}px`);
        lift.style.setProperty('--dy', `${way * (f.top + f.height / 2 - (r.top + r.height / 2))}px`);
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
  // Whole seconds first, so 119.6 reads 2 分 00 秒. The total is the real one rounded (保温杯 155.2 s is 2 分 35 秒, as the
  // report says; Elara 035de2b0), and the steps round so they add up to it: the ones with the most cut off go up first.
  const dur = sec => (sec = Math.round(sec)) >= 60 ? `${Math.floor(sec / 60)} 分 ${String(sec % 60).padStart(2, '0')} 秒` : `${sec} 秒`;
  const wholeSteps = secs => {
    const out = secs.map(Math.floor);
    let left = Math.round(secs.reduce((a, b) => a + b, 0)) - out.reduce((a, b) => a + b, 0);
    for (const i of secs.map((x, i) => i).sort((a, b) => (secs[b] % 1) - (secs[a] % 1))) if (left-- > 0) out[i]++;
    return out;
  };
  const durAll = secs => dur(secs.reduce((a, b) => a + b, 0));
  let howItem = null, howT = 0, howTimer = 0, howReq = 0;
  async function openHow(id) {
    const it = byId.get(id), o = it?.origin;
    if (!o) return;
    howItem = id;
    const raw = STEPS.map(st => o.steps?.find(x => x.key === st.key)?.seconds), timed = raw.every(Number.isFinite);
    const secs = timed ? wholeSteps(raw) : raw;
    el.howTitle.textContent = `${NAMES[id]}是怎么来的`;
    el.howCat.textContent = catLabel(it, NAMES[id]);
    el.howCat.parentElement.hidden = !el.howCat.textContent;
    el.howSteps.innerHTML = STEPS.map((st, i) => {
      const pic = st.key === 'model' ? '<canvas class="mini3d"></canvas>' : `<img src="${esc(pictureUrl(st.key === 'photo' ? o.photo : o.styled) ?? '')}" alt="">`;
      return `<li data-step="${i}"><span class="n">${i + 1}</span><b>${st.name}</b>${pic}<span class="sec">${Number.isFinite(secs[i]) ? dur(secs[i]) : '—'}</span></li>`;
    }).join('');
    el.howTotal.textContent = timed ? `实际用时 ${durAll(secs)}` : '';
    // 评委版's replayed items: whose photo it is, the other one a tap away, and 装上去打 (back, for one the sim turned down).
    const sample = sampleOf(id), other = cur().parts[1 - libSlot].item === id, stuck = sample && !playable.has(id);
    el.howNote.hidden = !sample;
    el.howSrc.hidden = !sample;
    if (sample) {
      el.howNote.textContent = sample.credit;
      el.howSrc.textContent = sample.tag;
      el.howSrc.classList.toggle('own', sample.own);
    }
    el.howPick.hidden = !sample || SAMPLES.length < 2;
    el.howPick.innerHTML = SAMPLES.map(x => `<button type="button" data-id="${esc(x.item.id)}"${x.item.id === id ? ' aria-current="true"' : ''}><b>${esc(NAMES[x.item.id])}</b><small>${esc(x.tag)}</small></button>`).join('');
    el.howEquip.disabled = !stuck && other;
    el.howEquip.querySelector('span').textContent = stuck ? (el.shoot.hidden ? '回角色库' : '回拍一件') : other ? '另一边已经装着它'
      : cur().parts[libSlot].item === id ? '装着，回拼装' : sample ? '装上去打' : '装上它';
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
  el.howPick.onclick = e => { const b = e.target.closest('[data-id]'); if (b && b.dataset.id !== howItem) openHow(b.dataset.id); };
  el.howEquip.onclick = () => {
    if (sampleOf(howItem) && !playable.has(howItem)) { closeHow(); return; }
    if (cur().parts[1 - libSlot].item === howItem) return;
    const id = howItem;
    closeHow();
    equip(id);
  };
  // Into the slot the 角色库 was last opened for, from wherever the player is (a 拍一件 tag can be tapped on the result).
  async function equip(id) {
    if (cur().parts[1 - libSlot].item === id) return;
    shoot?.close();
    closeLibrary();
    const still = choosing(), ok = await fetched(id);
    if (!still()) return;
    if (!ok) { say('它的 3D 没下载下来，原来的还能打'); return; }
    if (cur().parts[1 - libSlot].item === id) return;
    changed(cur().parts[libSlot].item, id);
    cur().parts[libSlot].item = id;
    place(id);
    if (phase === 'result') showBuild(); else rebuild();
  }
  const equipLabel = id => cur().parts[1 - libSlot].item === id ? {text: '另一边已经装着它', disabled: true}
    : {text: cur().parts[libSlot].item === id ? '装着，回拼装' : '装上去打', disabled: false};

  // ---------- 拍一件 (task #47) ----------
  // Items made from photos arrive while the page is open: into the 角色库, the names, the stage and the sim, no rebuild.
  // The sim takes them first; one it turns down never shows up here, so the 好了 card waits for it (task #56 S2).
  // The address's build, once its photo items are in, if the player hasn't changed that side in the meantime.
  // Its models come down first, so the swap shows whole: 开打 pressed meanwhile fights the build on screen (Elara 89e3686f).
  // One whose model won't open is let go, and the playable build on screen stays, with no error (Elara 80e11ec2).
  async function takeLate() {
    const ready = b => b && b.parts.every(x => usable(x.item));
    if (phase !== 'build') return;
    const keys = Object.keys(late).filter(k => ready(late[k]));
    const opens = await Promise.all(keys.map(k => loadModels(late[k].parts.map(x => byId.get(x.item))).then(() => true, () => false)));
    if (phase !== 'build') return;
    const take = k => opens[keys.indexOf(k)] && ready(late[k]);
    if (take('mine') && sameBuild(mine, DEFAULT)) { mine.parts = structuredClone(late.mine.parts); mine.spread = late.mine.spread; rebuild(0); }
    if (take('foe') && !pvp && sameBuild(FOE, DEFAULT_FOE)) setFoe(late.foe);
    if (take('p2') && pvp && sameBuild(FOE, DEFAULT_P2)) { FOE.parts = structuredClone(late.p2.parts); FOE.spread = late.p2.spread; rebuild(1); }
    for (const k of keys) delete late[k];
  }
  async function addItems(sent) {
    const list = photoItems(sent);
    if (!list.some(it => !byId.has(it.id))) { takeLate(); return; }
    await register(list.filter(it => !byId.has(it.id)));
    const fresh = list.filter(it => !byId.has(it.id) && simKnows.has(it.id));
    if (!fresh.length) return;
    for (const it of fresh) { byId.set(it.id, it); items.push(it); stage.items.set(it.id, it); }
    setNames(items);
    OFFER.splice(0, OFFER.length, ...offerNow());
    // Open already: the 角色库 is drawn again with them, where it was scrolled to (Elara c611b379: 「以为没存上」).
    if (!el.library.hidden) openLibrary(libSlot, true);
    takeLate();
    // A finished one not put on yet may be among them: its 「做好了」 shows now (Sol 521149bb).
    shoot?.paintTag();
  }
  let shoot = null;
  // The build's own 拍一件 (Elara 6b6a3c3b) breathes until the player has shot something: none of their photo items in
  // the catalog and no job kept on this phone.
  const benchShoot = $('benchShoot');
  const paintBenchShoot = () => benchShoot.classList.toggle('first', !shoot?.state.stored && items.every(it => shipped.has(it.id) || sampleIds.has(it.id)));
  shoot0.then(async s => {
    // 评委版 with ?shoot=off: no backend; the 角色库's 拍一件 shows how the two real items were made.
    if (!s && judge) {
      el.shootBtn.lastChild.textContent = '拍一件示例';
      el.shootBtn.hidden = false;
      el.shootBtn.onclick = () => openHow(SAMPLES[0].item.id);
    }
    if (!s) return;
    const {api} = s;
    if (api.fileUrl) setFileSource(api.fileUrl);
    if (judge) await addItems(s.items);
    // The backend is down: the 角色库 has what the page shipped with. The 评委版's backend was slow already, so 拍一件
    // doesn't wait for these.
    const more = s.again && api.items().then(addItems).catch(() => {});
    if (!judge) await more;
    takeLate();
    shoot = mountShoot({
      api, addItems, turns, loadModels, equip, equipLabel, openHow,
      strict: Boolean(judge), quota: s.quota, sample: judge && (id => openHow(id)),
      samples: SAMPLES.map(x => {
        const steps = x.item.origin.steps;
        return {id: x.item.id, name: NAMES[x.item.id], tag: x.tag, own: x.own, photo: pictureUrl(x.item.origin.photo), time: durAll(steps.map(st => st.seconds))};
      }),
      item: id => byId.get(id), refused: id => simRefused.has(id), name: id => NAMES[id], grade: rate, spec,
      seen: id => gradesSeen.has(seenKey(id)), flip: turnOver, placed: isPlaced,
      libraryOpen: () => !el.library.hidden, openLibrary: () => openLibrary(libSlot),
      goPlay: () => { closeHow(); closeLibrary(); if (phase === 'result') showBuild(); },
      tagRoom: () => (phase === 'build' || phase === 'result') && el.library.hidden && el.how.hidden && el.foeSheet.hidden,
      fightRoom: () => phase === 'play' || phase === 'finale',
      hudBusy: () => Boolean(overlay.hilite),
      // Just under whichever plate is at the top (the build's title or the match's bars), so the tag covers neither.
      tagTop: () => { const top = [el.foe, el.hud].find(x => !x.hidden); return top ? top.offsetTop + top.offsetHeight + 8 : null; },
      onChange: () => {
        const s = shoot?.state;
        paintBenchShoot();
        el.shootBtn.classList.toggle('run', Boolean(s?.job && !s.stopped && !['succeeded', 'failed', 'recognition-missed'].includes(s.job.status)));
        el.shootBtn.classList.toggle('new', Boolean(s?.made && !s.stored?.seen));
        // One that failed while the player was elsewhere says so here too (Elara 021f6bf5); 拍一件 then shows it first.
        const missed = Boolean(s?.stored && !s.stored.seen && s.job?.status === 'recognition-missed');
        const failed = missed || Boolean(s?.stored && !s.stored.seen && s.job?.status === 'failed' && s.job.error?.code !== 'unknown-submit');
        el.shootBtn.classList.toggle('bad', failed);
        el.shootBtn.lastChild.textContent = missed ? '上一件没认出来' : failed ? '上一件没做成' : '拍一件';
      }
    });
    el.shootBtn.hidden = false;
    el.shootBtn.onclick = () => shoot.open('library');
    benchShoot.hidden = false;
    benchShoot.onclick = () => shoot.open('link', '组装台');
    $('shootNowBtn').onclick = () => shoot.open('link', '结算');
    paintBenchShoot();
    if (more) more.then(paintBenchShoot);
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
    b.onclick = () => { if (phase !== 'build') return; const part = cur().parts[Number(slot.dataset.slot)]; changed(part.orient, b.dataset.orient); part.orient = b.dataset.orient; rebuild(); };
  }));
  document.querySelectorAll('[data-spread]').forEach(b => { b.onclick = () => { if (phase !== 'build') return; changed(cur().spread, b.dataset.spread); cur().spread = b.dataset.spread; rebuild(); }; });
  // Each side's 冲 / 挡 (一机双人: 2P's pair is #pad2 at the head of the phone).
  const pads = [{box: el.pad, dash: el.dashBtn, block: el.blockBtn, dashNope: el.dashNope, blockNope: el.blockNope},
    {box: el.pad2, dash: $('dashBtn2'), block: $('blockBtn2'), dashNope: $('dashNope2'), blockNope: $('blockNope2')}];
  function showPads(on) { el.pad.hidden = !on; el.pad2.hidden = !on || !pvp; }
  // 冲 / 挡: taken on press (not release); the sim decides at its next step whether it is ready.
  function press(action, side = 0) {
    if (!live || live.done || phase !== 'play' || side && !pvp) { diag.tap(action, phase === 'play' ? '已结束' : `不在对局 ${phase}`); return; }
    // 第一关教学: in a stop only the lit button goes on, once its card is up (the 挡 stop's waits a moment for the shadow,
    // Sol f06c02c1); the other (or 1, where the card's is) makes it hop.
    if (teach?.stop && !side && (el.teach.hidden || TEACH_PRESS[teach.stop.kind] !== action)) { teachNudge(); diag.tap(action, '教学停住'); return; }
    // A 冲 tap, taken or not, is what the hint asks for.
    if (action === 'dash' && !side) nudgeOff(pb.t);
    // 冲挡加重: a top bounced off a block (or a heavy one after a lunge that met nothing) is stunned, both buttons with it.
    const c = live.match.control(side), left = Math.max(action === 'dash' ? c.dashIn : c.blockIn, c.stunIn ?? 0), pad = pads[side];
    // Still cooling at the next physics step: the sim would drop it anyway, so nothing is sent; the button shakes and
    // 还没好 rises over it, so a tap that cannot count never looks like a dead button.
    if (left > rules.dt + 1e-9) {
      const nope = action === 'dash' ? pad.dashNope : pad.blockNope;
      replay_(action === 'dash' ? pad.dash : pad.block, 'deny'); seatNope(nope); replay_(nope, 'show');
      test.denied++; sfx.deny(); diag.tap(action, `冷却 ${left.toFixed(1)}s`); return;
    }
    diag.tap(action, '收下');
    // 第一关教学: every stop comes, whatever is pressed before it (Elara 8b471471, d2999ce8). A 冲 before stop 2 goes out and
    // stop 2 comes once 冲 is ready again. 反打 lit before stop 4 (the picture coming up to the 完美's bounce): stop 4 at
    // once, the sim held at this lit step, and the 冲 sent from its card, since a 反打 spent now could not be taught. The
    // lesson's 挡 waits for its step (teachStep); a 冲 meanwhile would spoil its 完美. The lit button's press ends its stop.
    if (teach && !side) {
      if (teach.lesson === 0 && action === 'dash') teach.dashed = true;
      if (teach.lesson === 2 && action === 'dash' && !teach.stop) {
        if (teach.blockAt !== null || teach.hold !== null) { diag.tap(action, '教学等挡'); return; }
        if (counterLit(c)) { teach.hold = live.match.t; diag.tap(action, '教学第四步'); return; }
      }
      // The 挡 stop: taken at the 完美 step, the card up or not yet (then the stop holds till the shadow is done).
      if (teach.lesson === 1 && action === 'block' && (teach.stop?.kind === 'block' || teach.blockAt !== null)) {
        teach.armed = true; teach.lesson = 2; sfx.click();
        // The press shows at once (Pollux, Elara 56506aa2): 挡 stays in, gold-edged, till its shield goes up.
        teachHide();
        el.blockBtn.classList.add('armed');
        if (teach.blockAt !== null) teachGo();
        return;
      }
      // Anything else before the 挡's step: the fight is no longer the one its 完美 was worked out for.
      if (teach.blockAt !== null && !teach.armed) { teach.blockAt = null; teach.lesson = 3; }
      teachGo();
    }
    live.match.press(side, action);
    sfx.click();
  }
  // 还没好 sits just above its button.
  function seatNope(n) {
    n.style.bottom = '';
    // 一机双人: that side's bars stand just inside its buttons (8 px up); 还没好 goes past them, onto the arena's edge (Castor ②).
    if (pvp) { n.style.bottom = `calc(100% + ${8 + (el.hud.querySelector('.side')?.offsetHeight ?? 34) + 6}px)`; return; }
  }
  // Restart a one-shot CSS animation class (a second tap mid-shake shakes again).
  function replay_(btn, cls) { btn.classList.remove(cls); void btn.offsetWidth; btn.classList.add(cls); }
  for (const [side, pad] of pads.entries()) for (const [btn, action] of [[pad.dash, 'dash'], [pad.block, 'block']]) {
    btn.left = btn.querySelector('.left');
    btn.word = btn.querySelector('span');
    // Real press state on touchdown: the button goes down and lights up until the finger lifts. Each button keeps its own
    // fingers by pointerId (一机双人: four thumbs at once), so one lifting never lets go of another's press.
    const fingers = new Set();
    btn.addEventListener('pointerdown', ev => { ev.preventDefault(); fingers.add(ev.pointerId); btn.classList.add('down'); press(action, side); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(type, ev => { fingers.delete(ev.pointerId); if (!fingers.size) btn.classList.remove('down'); });
    btn.addEventListener('pointercancel', () => diag.cancel());
    btn.addEventListener('animationend', ev => { if (ev.animationName === 'padDeny') btn.classList.remove('deny'); else if (ev.animationName === 'padPop') btn.classList.remove('pop'); else if (ev.animationName === 'teachHop') btn.classList.remove('hop'); });
  }
  // A thumb held down or rocked on a button opens no menu and selects nothing (远夏's Android, task 5ee99454).
  for (const {box} of pads) box.addEventListener('contextmenu', ev => ev.preventDefault());
  for (const n of pads.flatMap(x => [x.dashNope, x.blockNope])) n.addEventListener('animationend', () => n.classList.remove('show'));
  // Keys for a computer: 1P J (or space) and K (or shift), 一机双人's 2P A and S.
  const KEYS = {KeyJ: [0, 'dash'], Space: [0, 'dash'], KeyK: [0, 'block'], ShiftLeft: [0, 'block'], ShiftRight: [0, 'block'], KeyA: [1, 'dash'], KeyS: [1, 'block']};
  const keyOf = ev => { const k = KEYS[ev.code]; return k && (!k[0] || pvp) ? {side: k[0], action: k[1], btn: pads[k[0]][k[1]]} : null; };
  addEventListener('keydown', ev => { if (ev.repeat) return; const k = keyOf(ev); if (!k) return; if (ev.code === 'Space') ev.preventDefault(); k.btn.classList.add('down'); press(k.action, k.side); });
  addEventListener('keyup', ev => keyOf(ev)?.btn.classList.remove('down'));
  // 一机双人: two people's thumbs on one glass. No pinch or double-tap zoom, no page dragged, no text picked up, while a
  // match is on (touch-action and user-select in terminal.css do the rest; iOS Safari needs its gesture events stopped too).
  const fighting = () => pvp && ['ready', 'play', 'finale', 'replay'].includes(phase);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, ev => { if (pvp) ev.preventDefault(); }, {passive: false});
  document.addEventListener('touchmove', ev => { if (fighting()) ev.preventDefault(); }, {passive: false});
  document.addEventListener('dblclick', ev => { if (fighting()) ev.preventDefault(); }, {passive: false});
  // The first match ever in 一机双人: one line to each end of the phone, then never again.
  const PVP_TIP_KEY = 'wanwu-pvp-tip-seen';
  function pvpTip() {
    try { if (q.get('coach') !== 'again' && localStorage.getItem(PVP_TIP_KEY) === '1') return; localStorage.setItem(PVP_TIP_KEY, '1'); } catch { /* no storage here: every time */ }
    el.pvpTip.hidden = false; // shown, its lines' fade (terminal.css) plays from the start
  }
  el.pvpTip.addEventListener('animationend', () => { el.pvpTip.hidden = true; });
  // No clock loss (第三轮 ④): how tight the arena looks at match time t, from the rules this match is played under. The
  // picture runs ahead of the rules (Elara 08ad43bb): an ease-out, so it shows within a second of 60 s and is plainly
  // different by 62 s (0.44 of the way), while the pull and damage are still barely up.
  function heatAt(t) {
    const o = (live ? combatOptions.combatRules : replay?.meta.combatRules)?.overtime;
    return o ? 1 - (1 - Math.min(1, Math.max(0, (t - o.start) / o.ramp))) ** 4 : 0;
  }
  // 准备 → 开打！: the plates (single-player only the one at the foot); the loop counts readyAge on and lets the fight go at READY.
  function getReady() {
    readyAge = 0;
    for (const b of el.pvpReady.children) b.textContent = '准备';
    el.pvpReady.className = pvp ? '' : 'solo';
    el.pvpReady.hidden = false;
  }
  function readyStep(dt) {
    const was = readyAge;
    readyAge += dt;
    if (was < READY_GO && readyAge >= READY_GO) {
      for (const b of el.pvpReady.children) b.textContent = '开打！';
      el.pvpReady.className = pvp ? 'fight' : 'solo fight';
      sfx.go();
      buzz(30);
    }
    // 一机双人's first match: its line about the buttons comes once the plates are gone, where they stood.
    if (readyAge >= READY) {
      el.pvpReady.hidden = true; phase = 'play';
      if (pvp) pvpTip();
    }
  }
  // Sound on / off (remembered where the page may store it).
  const mutes = [el.mute, $('muteTop'), $('introMute')].filter(Boolean);
  const syncMute = () => { for (const b of mutes) { b.classList.toggle('off', sfx.muted); b.setAttribute('aria-label', sfx.muted ? '打开声音' : '关掉声音'); } };
  for (const b of mutes) b.addEventListener('click', () => { sfx.setMuted(!sfx.muted); syncMute(); });
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
    for (const side of pvp ? [0, 1] : [0]) updateSidePad(side);
  }
  function updateSidePad(side) {
    const c = live.match.control(side), M = rules.manual, pad = pads[side];
    // 冲挡加重 (Elara 8723e99a, 9eb901cb): locked, not cooling, while the top is stunned (both buttons) or 冲 is held after
    // a block that caught nothing (Sol 4ef6dad5; gone from the rules since Elara 2065efad): the whole plate goes into
    // shade, no seconds (terminal.css). A button whose own cooldown runs longer (冲 just spent on the lunge that got bounced) keeps the
    // cooldown's seconds and fill under the stripes. The lock wins over a 冲 or 挡 already going (a shield up as a heavy
    // lunge ends, a lunge charging as the shield runs out empty): that keeps going, but the button no longer lights as if
    // a tap would count (Sol e0535c0d). A tap shakes it as in cooling.
    const stun = c.stunIn ?? 0, dashLock = Math.max(stun, c.dashLockIn ?? 0);
    for (const [btn, due, total, on, lock] of [[pad.dash, c.dashIn, M.dashCooldown, c.charging || c.dashing, dashLock], [pad.block, c.blockIn, M.blockCooldown, c.shield, stun]]) {
      // Ready as press() counts it: a tap now is taken at the next step, so its last step of cooling shows no 「1」 (Wren
      // 3b937043: 「1反打」, the digit under a lit 反打, which a tap at that moment does land).
      const cool = due > rules.dt + 1e-9 ? due : 0;
      const state = lock > 0 ? (lock >= cool - rules.dt ? 'locked' : 'cooling') : on ? 'on' : cool > 0 ? 'cooling' : live.done ? 'idle' : 'ready';
      const left = state === 'locked' ? lock : cool;
      if (state === 'locked' && btn.dataset.state !== 'locked') btn.lockTotal = lock;
      btn.style.setProperty('--p', state === 'on' ? 0 : (1 - left / (state === 'locked' ? btn.lockTotal : total)).toFixed(3));
      btn.classList.toggle('on', state === 'on');
      btn.classList.toggle('locked', lock > 0);
      btn.classList.toggle('cooling', state === 'cooling');
      btn.classList.toggle('ready', state === 'ready');
      const wait = state === 'cooling' ? String(Math.ceil(left - 1e-6)) : '';
      if (btn.left.textContent !== wait) btn.left.textContent = wait;
      // Back from cooling: one pop so the thumb knows without looking twice.
      if (state === 'ready' && (btn.dataset.state === 'cooling' || btn.dataset.state === 'locked')) replay_(btn, 'pop');
      btn.dataset.state = state;
    }
    // 反打 (Elara b32bfd9a ①): 冲 lights up and says so while a 冲 pressed now lands as the counter (counterLands: it gets
    // there in time, Sol 0fe8da0c). The eyes are on the
    // 完美 in the arena then (Elara fa80d1bb), so it comes on with a sound of its own as well as a pop and a ring.
    // Once off it stays off till the next 完美 (counterLands can come back for a step or two: one light, one sound).
    let counter = !live.done && counterLit(c);
    if (!(c.counterIn > 0)) pad.counterOver = false;
    else if (!counter && pad.dash.classList.contains('counter')) pad.counterOver = true;
    counter &&= !pad.counterOver;
    if (pad.dash.classList.contains('counter') !== counter) {
      pad.dash.classList.toggle('counter', counter);
      pad.dash.word.textContent = counter ? '反打' : '冲';
      if (counter) sfx.counter();
    }
  }
  // A 冲 taken at the next step would land as the counter (control() of the step now), so 反打 can light.
  function counterLit(c) {
    return (c.counterIn ?? 0) + 1e-9 >= COUNTER_CUE_LIT && c.counterLands && c.dashIn <= rules.dt + 1e-9 && !c.charging && !c.dashing && !(c.stunIn > 0);
  }
  // Release check only (__top.counterBot(), scripts/check-judge-navigation.mjs): taps 挡 a beat after each of the foe's
  // cues and 冲 only while 反打 is lit, step by step in the sim loop (the same at any speed), so the fight is won on a
  // 反打 and the result screen reads a match that ended with its window open (Wren b7e0e2df).
  let bot = null;
  function botStep(m) {
    for (; bot.seen < m.events.length; bot.seen++) { const e = m.events[bot.seen]; if (e.type === 'dashCue' && e.side === 1) bot.block = m.step + 30; }
    const c = m.control(0);
    if (bot.block !== null && m.step >= bot.block) { bot.block = null; if (c.blockIn <= rules.dt + 1e-9 && !c.charging && !c.dashing && !(c.stunIn > 0)) press('block'); }
    else if (counterLit(c)) press('dash');
  }
  // 一机双人's bench: 1P's 下一步 hands it to 2P, whose 开打 starts the match.
  el.go.onclick = () => { if (pvp && pick === 0) setPick(1); else start(); };
  $('replayBtn').onclick = () => replaySlow();
  $('againBtn').onclick = () => {
    const act = $('againBtn').dataset.act;
    showBuild();
    if (act === 'next') pickFoe(Math.min(fought + 1, LADDER.length - 1));
    else if (act === 'pick') openLadder();
  };
  // 原样再来: the same two builds again at once (a new seed unless ?seed= fixed it).
  $('sameBtn').onclick = () => { showBuild(); start(); };
  // 一机双人's way back to the three opponents; with an opening page, back to it.
  $('soloBtn').onclick = () => { if (homeOn) goHome(); else setPvp(false); };

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
    if (pvp && !building && !el.hud.hidden) {
      // 一机双人: the arena takes the band between the two sides' bars (each just inside its pair of buttons). Measured in
      // the page's layout, which the screen turned for 2P's build step doesn't change.
      const s0 = el.hud.querySelector('.s0'), s1 = el.hud.querySelector('.s1');
      stage.setPad(0);
      stage.resize(w, h, s1.offsetTop + s1.offsetHeight + 6, h - s0.offsetTop + 6);
      return;
    }
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
    frozen: false, highlights: 0, freezeOn: null, freezeDelay: 0, pending: -1, simMs: 0, denied: 0, nth: 1, seen: 0, speed: 1, safe: null,
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
    status: () => ({phase, pvp, pick, control, cam: camStyle, denied: test.denied, live: Boolean(live), foe: live && !live.done ? live.match.control(1) : null, me: live && !live.done ? live.match.control(0) : null, inputs: live?.done ? replay.meta.manual.inputs : null, frozen: test.frozen, highlights: test.highlights, t: pb?.t ?? 0, simMs: test.simMs, seed, mine: structuredClone(mine), foeBuild: structuredClone(FOE), meta: replay && {...replay.meta, initial: undefined, rules: undefined}, decisive: replay?.decisive, reason: replay && reasonLine(replay), caption: el.caption.classList.contains('on'), teach: teach && {lesson: teach.lesson, stop: teach.stop?.kind ?? null, blockAt: teach.blockAt, armed: teach.armed}}),
    freezeOn(type, delayMs = 60, nth = 1) { Object.assign(test, {freezeOn: type, freezeDelay: delayMs / 1000, pending: -1, nth, seen: 0}); },
    freeze() { test.frozen = true; },
    release() { Object.assign(test, {frozen: false, freezeOn: null, pending: -1}); },
    // Safe-area audit: worst overflow per phase over every rendered frame (px > 0 means something was cut off).
    counterBot(on = true) { bot = on ? {seen: 0, block: null} : null; },
    trackSafe(speed = 1) { test.speed = speed; test.safe = {}; test.frame = null; },
    safe: () => test.safe,
    // 一机双人's camera: the metres across the band's narrower half, and the zoom (1 close .. 2 apart).
    topView: () => ({half: stage.kitchen?.photo.topHalfWidth ?? null, zoom: stage.kitchen?.photo.zoom ?? null}),
    // The player's own aim arrow: 0 on the lane .. 1 grey (off the full-lunge lane), null when none is showing.
    caught: () => test.caught ?? null,
    aimWide: () => stage.fighters[0]?.act.aimDir ? stage.fighters[0].act.aimWide : null,
    framing() {
      const m = test.frame;
      if (!m) return null;
      const s = [...m.scale].sort((a, b) => a - b), q = k => +s[Math.floor(k * (s.length - 1))].toFixed(1);
      return {frames: m.frames, core15Pct: +(100 * m.core15 / m.frames).toFixed(1), ok15Pct: +(100 * m.ok15 / m.frames).toFixed(1), minMarginPx: +m.minMargin.toFixed(1), sweptMinMarginLrPx: +m.sweptLr.toFixed(1), sweptMinMarginSafePx: +m.sweptSafe.toFixed(1), core15PctExact: +(100 * m.core15 / m.frames).toFixed(2), outSecs: +m.out.toFixed(2), outRunMaxSecs: +m.outRunMax.toFixed(2), offLrSecs: +m.offLr.toFixed(2), offLrAt: m.offLrAt ?? [], pxPerMetre: {p10: q(0.1), median: q(0.5), p90: q(0.9), min: q(0), max: q(1)}};
    },
    setBuild(b) { changed(buildArg(cur()), buildArg({...cur(), ...b})); Object.assign(cur(), structuredClone(b)); rebuild(); },
    setPvp,
    setPick,
    stage,
    overlay,
    // Framing camera parameters (tuning runs only).
    cam: CAM,
    start,
    music: () => sfx._music(),
    events: () => replay?.events.filter(e => e.type !== 'contact' && e.type !== 'recoil').map(e => ({t: e.t, type: e.type, role: e.role, attacker: e.attacker, dash: e.dash, target: e.target, targetPart: e.targetPart, damage: e.damage, side: e.side, phase: e.phase, outcome: e.outcome})) ?? []
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
    // 回首页 is out of reach in a fight only: from the first frame on the bench, models still loading or not (Castor 9329c4e0).
    el.app.classList.toggle('infight', !['loading', 'build', 'result'].includes(phase));
    if (phase === 'loading') return;
    if (phase === 'play' && teach) dt *= teachScale();
    for (const n of lateNums) if ((n.wait -= dt) <= 0) overlay.number(...n.broke);
    lateNums = lateNums.filter(n => n.wait > 0);
    let simDt = dt;
    if (phase === 'build' || phase === 'computing') {
      spinAngle += dt * PREVIEW_SPIN;
      stage.pose(previewState());
    } else if (phase === 'ready') {
      readyStep(dt);
      stage.pose(pb.state);
    } else if (phase === 'play' || phase === 'replay') {
      if (phase === 'play' && live && !live.done) {
        // Keep the live sim just ahead of the picture; once it is over, the replay is complete.
        const m = live.match;
        while (!m.done && m.t < pb.t + dt + LIVE_LEAD && !teachStep(m)) { if (bot) botStep(m); m.advance(); }
        if (m.done) { live.done = true; replay = m.result(); pb.r = replay; setCaption(false, reasonLine(replay)); }
        pb.sync(live.done);
      }
      simDt = pb.advance(dt, 1, onEvent);
      if (phase === 'play') teachTick();
      if (cueAt !== null && pb.t >= cueAt - 1e-9) cue();
      flushParry();
      stage.pose(pb.state);
      stage.setLookahead(lookahead());
      stage.setPushV4(pb.pushAmount(pb.t));
      stage.setHeat(heatAt(pb.t));
      const slow = pb.slowAmount(pb.t);
      el.slowtag.classList.toggle('on', slow > 0.3);
      if (pb.inDecisive(pb.t)) { if (!el.caption.classList.contains('on')) setCaption(true); captionHold = 1.6; }
      else if (captionHold > 0) { captionHold -= dt; if (captionHold <= 0) setCaption(false); }
      if (phase === 'replay' && pb.t >= pb.replayTo - 1e-9 && pb.hold <= 0) {
        replayEnd += dt;
        if (replayEnd > 0.6) showResult();
      } else if (pb.done) {
        // A match on time says so; with no clock (第三轮 ④) the backstop is silent, only the card says 拖得太久.
        if (phase === 'play' && replay.meta.reason === 'timeout' && !replay.meta.combatRules?.overtime) overlay.showBanner('时间到', '#ffffff', 1.3);
        phase = 'finale';
        finaleAge = finaleSim = 0;
        endNudge();
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
    const slowNow = pb && (phase === 'play' || phase === 'replay' ? pb.slowFactor(pb.t) < 0.99 : phase === 'finale' && pb.slowFactor(pb.end + finaleSim) < 0.99);
    sfx.duck(Boolean(slowNow) || performance.now() < dipUntil);
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
    // The 拍一件 tag shows on the build and result screens only: redrawn as the player moves between screens, and the
    // frame a highlight goes up or down under the HUD (its 「做好了」 gives way to it).
    const tagKey = `${phase}${el.library.hidden}${el.how.hidden}${el.foeSheet.hidden}${Boolean(overlay.hilite)}`;
    if (shoot && tagKey !== lastTagKey) { lastTagKey = tagKey; shoot.paintTag(); }
    overlay.update(dt, true);
    if (pb && phase !== 'build' && phase !== 'computing') { updateHud(dt, pb.state); updateHudFlash(dt); updatePad(); }
    if (nudge) nudgeTick(pb.t);
  }
  showBuild();
  setUp();
  // ?pvp=1: straight into 一机双人, past the opening page.
  if (q.get('pvp') === '1') { judge?.skipIntro(); setPvp(true); }
  requestAnimationFrame(frame);
  if (q.get('autoplay') === '1') start();
}

main().catch(showError);
