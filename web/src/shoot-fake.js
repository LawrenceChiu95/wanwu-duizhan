/**
 * 拍一件's local stand-in backend (?shoot=fake, task #47): the same calls and job states as the real one in
 * 「前端要的任务接口」 第 2 稿, kept in this browser's localStorage so closing and reopening the page finds the job where
 * it was. Nothing is uploaded and nothing is generated: a finished job becomes a copy of an item already in the repo,
 * with the player's photo.
 *
 * A job's stages run on a clock of their own so a walkthrough need not wait the real minute and a half; the job reports
 * that clock's times, and the screens read it through now(), so they still show real-length durations.
 *   ?shootSpeed=10        the clock runs 10× (default 1)
 *   ?shootFail=<code>     the next new photo fails with that code at its usual stage; @stage moves it
 *                         (recognize | styled | model | download | process), e.g. shootFail=server@download.
 *                         Only jobs from a new photo fail: 再试, 再提交 and 重新生成 go through.
 *                         Also: slow (the 3D step takes 11 minutes), offline (polls fail for ten seconds),
 *                         server-poll (polls get a server error for ten seconds), server-items (the first two
 *                         item fetches after it is done get a server error), server-create (sending the photo always
 *                         gets a server error), offline-create (sending the photo never gets through), forbidden-poll (polls get forbidden for ten seconds, as a backend
 *                         started for another page address would answer), refused (the first item made comes out in a form
 *                         the game's registerItems turns down: scale 2; photos after it come out fine),
 *                         choose (认物 makes nothing of it: recognition-missed, held there until the player picks one of
 *                         the six or takes a new photo; Elara a68613bb, Sol 9fc357dd), photo-failed (the last word
 *                         once every retry is spent: today's photo given back, refunded: true).
 *   ?shootItemsSlow=15000 item fetches don't answer until that many ms after the page loaded (main.js waits 5 s at start).
 *   ?shootItemsNull=1     item fetches carry a null and an entry with no id among the items.
 *   ?shootAgainFail=3     the first 3 calls of 再试, 再提交 or 重新生成 get a server error (counted across reloads), then they
 *                         go through; the keys they carried are kept in the fake's storage (againKeys).
 * The same-key and parent checks follow 第 2 稿 and 「本机后台接线补充」 (task #56 S3): a key is 8–128 of [A-Za-z0-9_-];
 * the same key with other input is key-conflict; a parent gets one 再提交 or 重新生成, another key on it is not-allowed;
 * an id it never made is not-found. Still only this browser's storage: it shows the page copes, not that the real one is idempotent.
 *   ?shootCat=<category>  what the photo is recognised as (pot, lamp, scissors, broom, slipper, pillow); without it the
 *                         first photo is a broom (an S) and the second a knife (a C), then each gets one of the six
 *                         at random (the page says so on 认物; Elara 1fd38db4, and c4225110 3dda8148 for
 *                         第 22 版: the published copy can't take ?shootCat, so whoever tries it sees an S turn over first;
 *                         the slipper was left out there while its model was a plain grey one, back since task #74)
 *   ?shootSix=0           recognised as outside the six, counted as the nearest
 *   ?shootName=保温杯      answers the way the real 认物 does since task #84: that name (and category), no inSix; the item
 *                         takes the name too. &shootMat=不锈钢 adds materialName. The model and numbers still come from
 *                         the six; the game takes such an item once sim/runtime-items.js accepts any category (Sol, task #84).
 *   ?shootVerdict=<text>  the 认物 line on the 鉴定卡 (recognition.verdict, Sol 99c2016a); =0 leaves it out, as the real
 *                         one does when the model's line is missing or turned down. Without it each of the six has its own.
 *   ?shootReset=1         forget every fake job, item and the page's current job
 * Many players at once (评委自己拍, Elara 6dee70f7; fields as agreed with Sol df0613d4 f056c835). None of these is on by
 * default, so the stage copies behave as before:
 *   ?shootGen=2           this browser's generations a day; ?shootRecog=5 its 认物 a day. A new photo holds one of each
 *                         before 认物 (a 认物 is spent even if retaken; a retake gives the generation back), so a photo
 *                         that can't be generated is turned away before anything is spent.
 *   ?shootAllGen=N        what is left today for everyone (generations); ?shootAllRecog=N the same for 认物.
 *   ?shootQueue=3         a new photo has three people ahead of it before 认物; ?shootQueueGen=2 two more ahead once the
 *                         retake moment is over, before generation starts. ?shootQueueSec=40 how long each one ahead takes.
 */
import {loadCatalog} from '../../sim/index.js';
import {loadV3Rules} from '../../sim/v3.js';
import {stillUrl} from './models.js';
import potStyled from '../../data/showcase/pot/styled.webp?url';
import {ShootError, decodeImage, getPass} from './shoot-api.js';

const KEY = 'wanwu-shoot-fake', PHOTO = 'wanwu-shoot-fake-photo:';
// Seconds per stage at speed 1, roughly the real generation's (tools/import-item README); the four after 认物 sum to 90.
const STAGES = [['recognize', 3], ['styled', 22], ['model', 53], ['download', 6], ['process', 9]];
const STEP_KEYS = ['styled', 'model', 'download', 'process'];
const ESTIMATE = 90;
// After a new photo's 认物, this long (ms, on the fake clock) to say 不是它，重拍 before generation starts (task #85).
const RETAKE_MS = 5000;
// What each category becomes: an item already in the repo.
// 评委版 bundles the twelve's models only (model-files.judge.js), so there each category copies one of those instead.
const SOURCE = __JUDGE__ ? {pot: 'fanshuo-pot', scissors: 'fanshuo-knife', broom: 'fanshuo-feather', lamp: 'fanshuo-cup', slipper: 'fanshuo-cushion', pillow: 'fanshuo-rabbit'}
  : {pot: 'wasteland-pot', scissors: 'wasteland-knife', broom: 'wasteland-broom', lamp: 'lamp-lux3d', slipper: 'slipper', pillow: 'pillow'};
const CAT_NAME = {pot: '锅', lamp: '台灯', scissors: '刀剪', broom: '扫把', slipper: '拖鞋', pillow: '枕头'};
// recognition.verdict: what it is like and how a knock with it feels, never how strong it is (Elara 48e25b06).
const VERDICT = {pot: '厚实金属，碰上去闷响一声', lamp: '灯罩轻、底座沉，晃一晃才站稳', scissors: '细长一条，刃口先碰到人',
  broom: '杆子长，毛头一扫一大片', slipper: '扁扁软软，拍上去啪的一声', pillow: '软乎乎的，撞上去先陷进去'};
const BASIS = {pot: '圆口、有柄', lamp: '灯罩、底座', scissors: '细长、有刃', broom: '长柄、一头散开', slipper: '扁平、鞋形', pillow: '软、方块'};
// Where each failure happens unless @stage says otherwise: [stage, fraction into it]; 'create' fails the call itself.
const FAIL_AT = {
  'photo-invalid': 'create', pass: 'create', quota: 'create', 'key-conflict': 'create',
  'photo-unclear': [0, 1], 'photo-failed': [2, 0.5], busy: [1, 0], 'step-failed': [2, 0.5], 'unknown-submit': [2, 0.1], expired: [3, 0],
  download: [3, 0.6], process: [4, 0.5], 'process-unfixable': [4, 0.7], server: [2, 0.4],
  'photo-read': [0, 0.2], 'photo-upload': [1, 0.1], 'process-corrupt': [4, 0.5], 'process-too-large': [4, 0.5],
  ...Object.fromEntries(['service', 'network', 'interrupted', 'invalid', 'auth', 'limit'].map(k => [`recognition-${k}`, [0, 1]]))
};
const MISSED = {code: 'recognition-missed', message: '', retry: 'none', charged: false, refunded: true};
const RETRY = {'photo-failed': 'none', 'photo-invalid': 'none', 'photo-unclear': 'none', pass: 'none', quota: 'none', busy: 'resubmit', 'step-failed': 'regenerate', expired: 'regenerate',
  download: 'same', process: 'same', 'process-unfixable': 'regenerate', 'unknown-submit': 'none', 'key-conflict': 'none', 'active-job': 'none', server: 'same',
  // 真模式任务错误; 认物 failing on the service's side can be tried again on the same photo (Elara 1572a214, Sol 3afa412e).
  'photo-read': 'none', 'photo-upload': 'same', 'recognition-service': 'same', 'recognition-network': 'same', 'recognition-interrupted': 'none',
  'recognition-invalid': 'none', 'recognition-auth': 'none', 'recognition-limit': 'none', 'process-corrupt': 'none', 'process-too-large': 'none'};
const KEY_FORM = /^[A-Za-z0-9_-]{8,128}$/;
const VERSION = 3; // 3: the first two photos are fixed (第 22 版), so a browser that tried 第 21 版 starts again
// No daily limit unless asked for (?shootGen and the rest): /quota then reports limit and remaining as null.

const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked: the fake forgets */ } };
const iso = ms => ms == null ? null : new Date(ms).toISOString();
const today = () => new Date().toDateString();

/** The photo as the backend would keep it for the item's origin: a JPEG data URL, 640 px on the long side. */
async function keepPhoto(blob) {
  const img = await decodeImage(blob), k = Math.min(1, 640 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), {width: Math.round(img.width * k), height: Math.round(img.height * k)});
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export async function fakeApi(q) {
  // Storage from before the key checks (no version) is dropped with the page's job, as ?shootReset=1 would (Sol 21c4552e).
  if (q.get('shootReset') === '1' || (read(KEY) && read(KEY).v !== VERSION)) {
    for (const k of Object.keys(localStorage)) if (k === KEY || k.startsWith(PHOTO) || k === 'wanwu-shoot-job') localStorage.removeItem(k);
  }
  const [catalog, rules] = await Promise.all([loadCatalog(), loadV3Rules()]);
  const speed = Math.max(0.1, Number(q.get('shootSpeed')) || 1);
  const [failCode, failStage] = (q.get('shootFail') ?? '').split('@');
  const pinned = SOURCE[q.get('shootCat')] ? q.get('shootCat') : null, inSix = q.get('shootSix') !== '0';
  const realName = q.get('shootName')?.trim() || null, realMat = q.get('shootMat')?.trim() || null;
  const verdictOf = cat => q.get('shootVerdict') === '0' ? null : q.get('shootVerdict')?.trim() || VERDICT[cat];
  const FIRST = ['broom', 'scissors'], RANDOM = Object.keys(SOURCE);
  const someCat = n => pinned ?? FIRST[n] ?? RANDOM[Math.floor(Math.random() * RANDOM.length)];
  const st = read(KEY) ?? {v: VERSION, clock: {real0: Date.now(), virt0: Date.now(), speed}, seq: 0, jobs: {}, keys: {}, items: [], used: {day: today(), n: 0}};
  const vnow = () => st.clock.virt0 + (Date.now() - st.clock.real0) * st.clock.speed;
  // A new speed takes over from where the clock is: it never runs backwards.
  if (st.clock.speed !== speed) st.clock = {real0: Date.now(), virt0: vnow(), speed};
  const save = () => write(KEY, st);
  save();
  const used = () => st.used.day === today() ? st.used.n : 0;
  const usedRecog = () => st.used.day === today() ? st.used.r ?? 0 : 0;
  const num = k => q.has(k) ? Math.max(0, Number(q.get(k)) || 0) : null;
  const LIMIT = {gen: num('shootGen'), recog: num('shootRecog'), allGen: num('shootAllGen'), allRecog: num('shootAllRecog')};
  const AHEAD = num('shootQueue') ?? 0, AHEAD_GEN = num('shootQueueGen') ?? 0, PER = (num('shootQueueSec') || 40) * 1000;

  const stageMs = (rec, s) => (rec.slow && STAGES[s][0] === 'model' ? 660 : STAGES[s][1]) * 1000;
  // Brings a job up to the clock: which stage it is in, whether a planned failure has struck, and the item once done.
  function advance(rec) {
    if (rec.done) return;
    const now = vnow();
    let t = rec.t0;
    if (now < t) return; // still waiting its turn for 认物
    for (let s = rec.from; s < STAGES.length; s++) {
      const d = stageMs(rec, s);
      rec.times[s] = [t, null];
      if (s >= 1 && !rec.charged && !(rec.fail?.code === 'busy' && rec.fail.stage === s)) {
        rec.charged = true;
        st.used = {day: today(), n: used() + 1, r: usedRecog()};
      }
      if (rec.fail?.stage === s && now >= t + rec.fail.frac * d) {
        // photo-failed gives today's photo back (Sol c6bbf915).
        const refunded = rec.fail.code === 'photo-failed';
        if (refunded && rec.charged) st.used = {day: today(), n: Math.max(0, used() - 1), r: usedRecog()};
        rec.done = {status: 'failed', error: {code: rec.fail.code, message: '', retry: RETRY[rec.fail.code], charged: rec.charged && !refunded, ...refunded ? {refunded} : {}}, stage: s};
        return;
      }
      if (now < t + d) return;
      rec.times[s][1] = t += d;
      // A new photo's 认物 is in: nothing is paid for until the moment to say 不是它 has passed (task #85).
      // 认物 made nothing of it: held, no clock, until the player picks one of the six; then straight on, with no 不是它
      // moment (they chose it).
      if (s === 0 && rec.choose) {
        if (!rec.picked) return;
        rec.genAt = t = rec.picked.at;
        continue;
      }
      if (s === 0) {
        rec.retakeUntil = t + RETAKE_MS;
        rec.genAt = rec.retakeUntil + (rec.aheadGen ?? 0) * PER; // then waiting its turn for generation
        if (now < rec.genAt) return;
        t = rec.genAt;
      }
    }
    const n = st.items.length + 1, chosen = rec.recognition.chosen;
    const base = chosen === 'timeout' ? '无名之物' : rec.recognition.name ?? `我拍的${CAT_NAME[rec.cat]}`;
    const same = st.items.filter(i => i.cat === rec.cat && i.label === rec.recognition.name).length;
    const secs = s => rec.times[s]?.[1] != null ? (rec.times[s][1] - rec.times[s][0]) / 1000 : STAGES[s][1];
    st.items.push({id: `shot-${n}`, job: rec.id, cat: rec.cat, chosen, label: rec.recognition.name, matName: rec.recognition.materialName,
      name: same ? `${base} ${same + 1}` : base, photo: rec.photo,
      steps: [{key: 'photo', seconds: secs(0)}, {key: 'styled', seconds: secs(1)}, {key: 'model', seconds: secs(2) + secs(3) + secs(4)}]});
    rec.done = {status: 'succeeded', error: null};
    rec.itemId = `shot-${n}`;
  }
  // The six's 认物 for a category the player picked: its name is the category's.
  function pick(rec, cat, chosen, at) {
    const {inSix: _, ...r} = recognise(cat);
    Object.assign(rec, {cat, picked: {at}, recognition: {...r, name: CAT_NAME[cat], chosen}});
  }
  const choosing = rec => !rec.done && rec.choose && !rec.picked && rec.times[0]?.[1] != null;
  function view(rec) {
    advance(rec);
    save();
    const stage = rec.done ? null : rec.times.findIndex((x, s) => s >= rec.from && x && x[1] == null), now = vnow();
    // People ahead while waiting its turn, 0 once it is being worked on but no step has started, null after that.
    const queuePosition = rec.done || rec.times[1] ? null : now < rec.t0 ? Math.ceil((rec.t0 - now) / PER)
      : rec.genAt && now >= rec.retakeUntil && now < rec.genAt ? Math.ceil((rec.genAt - now) / PER) : 0;
    return {
      id: rec.id, clientKey: rec.clientKey, createdAt: iso(rec.createdAt),
      status: rec.done?.status ?? (choosing(rec) ? 'recognition-missed' : stage === 0 || (rec.from === 0 && !rec.times[0]) ? 'recognizing' : 'generating'), queuePosition,
      recognition: choosing(rec) ? null : rec.times[0]?.[1] != null || rec.from > 0 ? rec.recognition : null, retakeUntil: iso(rec.retakeUntil),
      steps: STEP_KEYS.map((key, i) => ({key, startedAt: iso(rec.times[i + 1]?.[0]), endedAt: iso(rec.times[i + 1]?.[1])})),
      // The real one's styled.jpg once 改画风 is done (PR #103); here a real one for the pot (the showcase pan's), the
      // still of the item it will copy for the rest.
      styledUrl: rec.times[1]?.[1] != null ? (rec.cat === 'pot' ? potStyled : stillUrl(SOURCE[rec.cat])) : null,
      estimateSeconds: ESTIMATE, error: rec.done?.error ?? (choosing(rec) ? MISSED : null), itemId: rec.itemId ?? null, regenerateOf: rec.regenerateOf ?? null
    };
  }
  const get = id => { const rec = st.jobs[id]; if (!rec) throw new ShootError('not-found'); return rec; };
  // A key seen before: the job it made, if it was made by this same call on this same parent; otherwise key-conflict.
  function sameKey(clientKey, parent, kind) {
    if (!KEY_FORM.test(clientKey ?? '')) throw new ShootError('key-conflict');
    const rec = st.jobs[st.keys[clientKey]];
    if (!rec) return null;
    if (rec.parent !== parent || rec.kind !== kind) throw new ShootError('key-conflict');
    return view(rec);
  }
  // 再提交 or 重新生成 on a parent: only of the kind its failure allows, and only once.
  function child(id, retry) {
    const old = get(id);
    advance(old);
    if (old.done?.error?.retry !== retry || old.child) throw new ShootError('not-allowed');
    return old;
  }
  // A missed one holds nothing (Sol 9fc357dd): a new photo goes ahead beside it.
  const active = () => Object.values(st.jobs).find(r => (advance(r), !r.done && !choosing(r)));
  // What is left today: a running job not yet charged holds one generation.
  const held = () => { const r = active(); return r && !r.charged ? 1 : 0; };
  const left = (limit, spent) => limit == null ? null : Math.max(0, limit - spent);
  const allowance = () => ({gen: left(LIMIT.gen, used() + held()), allGen: left(LIMIT.allGen, used() + held()),
    recog: left(LIMIT.recog, usedRecog()), allRecog: left(LIMIT.allRecog, usedRecog())});
  // A photo needs a generation and a 认物 left; 再提交 and 重新生成 only a generation.
  function mayStart(photo) {
    const a = allowance();
    if (a.gen === 0) throw new ShootError('quota', {kind: 'generation', scope: 'browser'});
    if (a.allGen === 0) throw new ShootError('quota', {kind: 'generation', scope: 'global'});
    if (photo && a.recog === 0) throw new ShootError('quota', {kind: 'recognition', scope: 'browser'});
    if (photo && a.allRecog === 0) throw new ShootError('quota', {kind: 'recognition', scope: 'global'});
  }
  function recognise(cat) {
    const src = catalog.find(i => i.id === SOURCE[cat]);
    const lengthMeters = +Math.max(...src.bounds.max.map((v, i) => v - src.bounds.min[i])).toFixed(2);
    const r = {category: cat, inSix, basis: BASIS[cat], lengthMeters, massKg: src.mass, material: src.material, condition: src.condition ?? 'unknown',
      sizeLabel: lengthMeters < 0.25 ? '小' : lengthMeters < 0.6 ? '中' : '大', ...verdictOf(cat) ? {verdict: verdictOf(cat)} : {}};
    if (!realName) return r;
    delete r.inSix;
    return {...r, name: realName, category: realName, ...realMat ? {materialName: realMat} : {}};
  }
  // A new job: from a new photo (stage 0), or another go at an old one's photo and recognition (stage 1).
  function open(clientKey, fields) {
    if (active()) throw new ShootError('active-job', {activeJobId: active().id});
    const id = `fake-${++st.seq}`, now = vnow();
    st.jobs[id] = {id, clientKey, createdAt: now, t0: now, from: 0, times: [], done: null, charged: false, realCreated: Date.now(), ...fields};
    st.keys[clientKey] = id;
    return view(st.jobs[id]);
  }
  function again(old, clientKey, kind, extra) {
    const j = open(clientKey, {from: 1, photo: old.photo, sig: old.sig, cat: old.cat, recognition: old.recognition, times: [old.times[0]], slow: false, fail: null,
      parent: old.id, kind, ...extra});
    old.child = j.id;
    save();
    return j;
  }
  const tick = ms => new Promise(r => setTimeout(r, ms));
  // ?shootAgainFail=N: a follow-up on a failed job fails with a server error until N of them have.
  const againFail = Number(q.get('shootAgainFail')) || 0;
  function down(clientKey) {
    st.againKeys = [...st.againKeys ?? [], clientKey ?? null];
    save();
    if (st.againKeys.length <= againFail) throw new ShootError('server');
  }
  let itemsFail = 0; // ?shootFail=server-items: item fetches still to fail once a job of this page load is done
  const itemsAt = performance.now() + (Number(q.get('shootItemsSlow')) || 0); // ?shootItemsSlow=ms: no items before then
  const itemsNull = q.has('shootItemsNull');

  return {
    kind: 'fake',
    named: !!realName, // ?shootName: the screens say what the real one says
    pollMs: 500,
    now: vnow,
    fileUrl: async path => path,
    async create(photo, clientKey) {
      await tick(300);
      const sig = `${photo.size}:${photo.type}`;
      if (failCode === 'server-create') throw new ShootError('server');
      if (failCode === 'offline-create') throw new ShootError('offline');
      const seen = sameKey(clientKey, null, 'create');
      if (seen) { if (st.jobs[seen.id].sig !== sig) throw new ShootError('key-conflict'); return seen; }
      const where = FAIL_AT[failCode];
      if (failCode === 'pass' && !getPass()) throw new ShootError('pass');
      if (where === 'create' && failCode !== 'pass') throw new ShootError(failCode);
      if (!/^image\/(jpeg|png)$/.test(photo.type) || photo.size > 32 * 2 ** 20) throw new ShootError('photo-invalid');
      if (active()) throw new ShootError('active-job', {activeJobId: active().id});
      mayStart(true);
      const at = Array.isArray(where) ? [failStage ? STAGES.findIndex(x => x[0] === failStage) : where[0], failStage ? 0.5 : where[1]] : null;
      const key = PHOTO + (st.seq + 1);
      write(key, await keepPhoto(photo));
      if (failCode === 'server-items') itemsFail = 2;
      const cat = someCat(Object.values(st.jobs).filter(r => r.kind === 'create').length);
      st.used = {day: today(), n: used(), r: usedRecog() + 1};
      return open(clientKey, {t0: vnow() + AHEAD * PER, aheadGen: AHEAD_GEN, photo: key, sig, cat, recognition: recognise(cat), slow: failCode === 'slow', parent: null, kind: 'create',
        offline: failCode === 'offline' ? 'offline' : failCode === 'server-poll' ? 'server' : failCode === 'forbidden-poll' ? 'forbidden' : null,
        refused: failCode === 'refused' && !Object.values(st.jobs).some(r => r.refused), choose: failCode === 'choose', fail: at && at[0] >= 0 ? {code: failCode, stage: at[0], frac: at[1]} : null});
    },
    async resubmit(fromJob, clientKey) {
      await tick(300);
      down(clientKey);
      return sameKey(clientKey, fromJob, 'resubmit') ?? (mayStart(false), again(child(fromJob, 'resubmit'), clientKey, 'resubmit', {}));
    },
    async job(id) {
      await tick(120);
      const rec = get(id), since = Date.now() - rec.realCreated;
      if (rec.offline && since > 4000 && since < 14000) throw new ShootError(rec.offline === true ? 'offline' : rec.offline);
      return view(rec);
    },
    async retry(id) {
      await tick(300);
      down(null);
      const rec = get(id);
      advance(rec);
      if (rec.done?.error?.retry !== 'same') throw new ShootError('not-allowed');
      Object.assign(rec, {from: rec.done.stage, t0: vnow(), fail: null, done: null});
      return view(rec);
    },
    // 不是它，重拍 (task #85): only between 认物 and the start of generation; the job ends unpaid and lets go of its place.
    async retake(id) {
      await tick(300);
      down(null);
      const rec = get(id);
      advance(rec);
      if (rec.done || rec.retakeUntil == null || vnow() >= rec.retakeUntil) throw new ShootError('not-allowed');
      rec.done = {status: 'failed', error: {code: 'retake', message: '', retry: 'none', charged: false}, stage: 1};
      save();
      return view(rec);
    },
    // The player's pick for a missed one; picked already, the job as it is; otherwise not-allowed. It takes one of
    // today's generations then, and waits for one running.
    async category(id, category) {
      await tick(300);
      down(null);
      const rec = get(id);
      advance(rec);
      if (!CAT_NAME[category]) throw new ShootError('bad-request');
      if (rec.picked) return view(rec);
      if (!choosing(rec)) throw new ShootError('not-allowed');
      if (active()) throw new ShootError('active-job', {activeJobId: active().id});
      mayStart(false);
      pick(rec, category, 'player', vnow());
      save();
      return view(rec);
    },
    async regenerate(id, clientKey) {
      await tick(300);
      down(clientKey);
      return sameKey(clientKey, id, 'regenerate') ?? (mayStart(false), again(child(id, 'regenerate'), clientKey, 'regenerate', {regenerateOf: id}));
    },
    async quota() {
      const a = allowance(), midnight = new Date(); midnight.setHours(24, 0, 0, 0);
      return {limit: LIMIT.gen, used: used(), remaining: a.gen, recognition: {limit: LIMIT.recog, remaining: a.recog},
        global: {limit: LIMIT.allGen, remaining: a.allGen, recognition: {limit: LIMIT.allRecog, remaining: a.allRecog}},
        resetsAt: Object.values(LIMIT).some(v => v != null) ? midnight.toISOString() : null, activeJobId: active()?.id ?? null};
    },
    // Built on every read from the item it copies, so a rebuilt page's still and model URLs are the current ones.
    async items() {
      if (performance.now() < itemsAt) await tick(itemsAt - performance.now());
      for (const r of Object.values(st.jobs)) advance(r);
      save();
      if (itemsFail && Object.values(st.jobs).some(r => r.done?.status === 'succeeded')) { itemsFail--; throw new ShootError('server'); }
      const list = st.items.map(x => {
        const src = catalog.find(i => i.id === SOURCE[x.cat]), it = {...structuredClone(src), id: x.id, name: x.name, source: {kind: 'photo', job: x.job}};
        // Sticks out the way the item it copies does (registerItems wants outEnd on every new item).
        it.outEnd = src.outEnd ?? rules.top.outEnd[src.id] ?? 1;
        it.scale ??= 1; // catalog models are all in meters (sim/index.js); registerItems wants it said
        if (st.jobs[x.job]?.refused) it.scale = 2;
        if (x.label) it.category = x.label;
        if (x.matName) it.materialName = x.matName;
        // The twelve 评委版 copies are photo items, which the sim takes only when their category is their name.
        if (it.photoPhysics) it.category = it.name;
        if (x.chosen) it.chosen = x.chosen; // picked of the six, or the pillow once time ran out (Elara 258971dd)
        delete it.comparisonBase;
        it.origin = {photo: read(x.photo) ?? '', styled: stillUrl(src.id), steps: x.steps};
        return it;
      });
      return itemsNull ? [null, ...list, {name: 'no id'}] : list;
    }
  };
}
