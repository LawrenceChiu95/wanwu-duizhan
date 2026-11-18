/**
 * 拍一件 (MVP 规格 §4-5, task #47): 拍照或选图 → 认物 → 生成中 → 好了, or 失败, over the whole page like the 角色库.
 * The job lives on the backend (shoot-api.js); this page only keeps its id, a small copy of the photo and whether 好了
 * has been seen (localStorage), so closing and reopening the page picks it up where it was. One job at a time
 * (Elara f63778f3): 拍一件 during a job says 「上一件还在做」 and shows its progress.
 *
 * While a job runs the player can go and fight (先去打一局); a tag at the top of the build and result screens shows how
 * far it has got and, once done, takes them to 好了.
 */
import {ShootError, decodeImage, newClientKey, setPass} from './shoot-api.js';

const JOB_KEY = 'wanwu-shoot-job';
const MADE_KEY = 'wanwu-shoot-made';
const CAT = {pot: '锅', lamp: '台灯', scissors: '刀剪', broom: '扫把', slipper: '拖鞋', pillow: '枕头'};
// The 「好了」 line (Elara 8d32a2a6): the five scoring materials and three states of wear; 不确定 says nothing.
const MATERIAL = {metal: '金属', wood: '木头', plastic: '塑料', cloth: '布', rubber: '橡胶'};
const WEAR = {intact: '完好', worn: '有点旧', damaged: '破损'};
// The four steps after 认物 and each one's usual share of the estimate (the real generation's, tools/import-item README).
// Only the time left and the bar come from them: the screen no longer lists them (Elara 207a725b).
const STEPS = [{key: 'styled', share: 0.25}, {key: 'model', share: 0.59}, {key: 'download', share: 0.06}, {key: 'process', share: 0.1}];
const LATE_HOLD = 1500; // ms 「已经开始生成了」 stays up on 认物 before 生成中
const RECOG_HOLD = 2600; // ms the 认物 result stays up once it is in, before 生成中 takes over
const SLOW = 10 * 60; // seconds: past this a job is 比平时慢, not failed
const TOAST = 4500; // ms 「做好了」 stays over a match
// What the screen says for each failure code (the draft's 「界面说」); the backend's own words only go to its log.
const SAY = {
  'photo-invalid': '这张照片用不了，换一张试试',
  'photo-unclear': '没看清拍的是什么，靠近一点、亮一点再拍',
  pass: '口令不对',
  quota: '今天的生成名额用完了，明天再来',
  busy: '生成的人太多，稍等再提交',
  // Every retry spent, today's photo given back (Elara d597a68a: say it straight, nothing about counting).
  'photo-failed': '这次没成功，再拍一次',
  'step-failed': '这次没生成出来，可以重新生成（会多算一次）',
  expired: '结果过期了，可以重新生成（会多算一次）',
  download: '模型没取回来，再试一次',
  process: '处理没成功，再试一次',
  'process-unfixable': '这个模型处理不了，可以重新生成（会多算一次）',
  'key-conflict': '出了点问题，重新拍一次',
  server: '出了点问题，再试一次',
  // 本机后台接线补充 (Sol 19f3ff20, PR #53): request codes; and a server error three times running (Sol 21c4552e).
  forbidden: '页面和后台的地址对不上，请从游戏入口打开',
  'bad-request': '请求有问题，请重新打开页面',
  'not-found': '没找到这件，请回角色库看看',
  'not-allowed': '这一步现在不能做，请刷新任务状态',
  'server-down': '后台出了问题，稍后再来',
  // task #62: the page reached something that isn't 拍一件's backend; and an item made but turned down by the game.
  'no-backend': '这个地址上没有拍一件的后台，请从游戏入口打开',
  refused: '游戏装不进这件，换一张再拍',
  // 评委版: what the shared budget has left can't pay for one more (Elara edd90212); it isn't anyone's daily allowance.
  budget: '暂时不能拍，先用现成角色打一局',
  // 评委版: the backend doesn't know this page's token any more (Sol e0a86865); a new one is only on the player's say.
  session: '之前的拍照记录找不到了，可以重新开始',
  // 真模式任务错误 (tools/import-item/shoot README): the reason and the way on in plain words (Elara 021f6bf5). 认物
  // breaking on the service's side is never put on the photo (Elara 1572a214).
  'photo-read': '照片没存好，重新拍一件',
  'photo-upload': '照片没传上去，再试一次',
  'recognition-limit': '认物的人太多，过一会儿再拍',
  'recognition-auth': '认物暂时用不了，先用现成角色打一局',
  'process-corrupt': '这件的模型坏了，换一件再拍',
  'process-too-large': '这件的模型太大，换一件再拍'
};
const SERVICE = ['recognition-service', 'recognition-network', 'recognition-invalid', 'recognition-interrupted'];
for (const code of SERVICE) SAY[code] = '认物这一步出了故障，不是照片的问题，再试一次';
// 评委自己拍 (Elara 6dee70f7): which daily allowance ran out, and whose. The first is Elara's; a quota error that doesn't
// say (?shootFail=quota) reads as it.
const QUOTA_SAY = {'generation-browser': SAY.quota, 'generation-global': '今天大家的生成名额都用完了，明天再来',
  'recognition-browser': '今天的认物名额用完了，明天再来', 'recognition-global': '今天大家的认物名额都用完了，明天再来', budget: SAY.budget, session: SAY.session};
const quotaKey = (kind, scope) => QUOTA_SAY[`${kind}-${scope}`] ? `${kind}-${scope}` : 'generation-browser';
const QUOTA_WAIT = 3000; // ms the 评委版 waits for /quota before taking 拍一件 as off for now

/**
 * Today's allowances as /quota gives them; {out} when asking was itself turned down for quota (429), {lost} when the
 * backend no longer knows this page's token (401 session). The 评委版 (strict) takes everything else (no answer in
 * time, a gateway's 502/503/504, the budget, no backend here, a browser that won't keep the token) as {down}:
 * 暂时不能拍, and the characters already there are the way on (Sol 5a01f773, Elara edd90212). Elsewhere that stays
 * unknown (null).
 */
export async function readQuota(api, strict = false, wait = QUOTA_WAIT) {
  let timer = 0, slow = false;
  const late = strict && new Promise((_, no) => { timer = setTimeout(() => { slow = true; no(new ShootError('offline')); }, wait); });
  try {
    return await (strict ? Promise.race([api.quota(), late]) : api.quota());
  } catch (e) {
    // late: no answer yet, which says nothing about whether a photo could be taken (the page may go on asking).
    return e.code === 'quota' ? {out: quotaKey(e.kind, e.scope)} : e.code === 'session' ? {lost: true} : strict ? {down: true, late: slow} : null;
  } finally { clearTimeout(timer); }
}
/** What /quota said lets a new photo be taken now (the 评委版 skips the items as it opens otherwise, Elara c1bc2dac). */
export const shootOpen = quota => Boolean(quota) && !quota.down && !quota.lost && !quota.out && quota.budget?.available !== false
  && ![quota.remaining, quota.global?.remaining, quota.recognition?.remaining, quota.global?.recognition?.remaining].includes(0);
const QUEUE_LONG = 3 * 60; // seconds waiting in line before it says there are a lot of people
// The page and its backend don't match: asking again won't help, so polling stops until 拍一件 is opened again (task #62).
// 评委版: session (the backend doesn't know this page's token) and storage (the browser won't keep one) are the same:
// nothing is sent until the player starts again (Sol e0a86865).
const MISMATCH = ['forbidden', 'bad-request', 'no-backend', 'session', 'storage'];
// A photo picked that can't go now (used up as it was sent, or the backend went away): the 评委版's two real generations
// show under the message, the photo and its retry kept (Sol e8c34c47, Elara 489c0d4b).
const CANT_NOW = ['quota', 'budget', 'offline', 'server', 'server-down'];
const DOWN_AFTER = 3; // the same server error this many times running: stop offering 再试
const ICON = {
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>',
  album: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5" /><circle cx="15.5" cy="9.5" r="1.4" /></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 4.7" /><path d="M5 4v5h5" /></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h13" /><path d="M13 6l6 6-6 6" /></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>',
  wait: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>'
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ms = t => t == null ? null : Date.parse(t);
const dur = sec => sec >= 60 ? `${Math.floor(sec / 60)} 分 ${String(Math.round(sec % 60)).padStart(2, '0')} 秒` : `${Math.max(1, Math.round(sec))} 秒`;
const about = sec => sec > 75 ? `${Math.round(sec / 60)} 分钟左右` : sec > 45 ? '1 分钟左右' : sec > 10 ? `${Math.ceil(sec / 10) * 10} 秒左右` : '几秒';
// task #84: the real 认物 names the thing as the model says it (name, no inSix); only the fake backend still sorts
// every photo into the six and says which one it counts as.
// Nobody picked one of the six in time: no name of a thing it isn't (Elara 258971dd).
const NAMELESS = '无名之物';
const catOf = r => r?.chosen === 'timeout' ? NAMELESS : r?.name ?? CAT[r?.category] ?? '东西';
const countAs = r => !('inSix' in (r ?? {})) ? catOf(r) : r.inSix ? `按${catOf(r)}算` : `不在六类里，按最像的${catOf(r)}算`;
const matOf = r => r?.materialName ?? MATERIAL[r?.material] ?? '';
/** The tag beside an item's name: one of the six, or nothing when the category is just the name again (task #84). */
// One the player picked says so, one nobody picked says what it counts as (Elara 258971dd; item.chosen, Sol).
export const catLabel = (it, name) => it?.chosen === 'player' ? '你选的' : it?.chosen === 'timeout' ? '按枕头算'
  : (c => c !== name ? c : '')(CAT[it?.category] ?? it?.category ?? '');

/** A small JPEG data URL of the photo for this page's own screens (the backend keeps the original). */
async function thumbOf(blob, side = 480) {
  const img = await decodeImage(blob), k = Math.min(1, side / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), {width: Math.round(img.width * k), height: Math.round(img.height * k)});
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
/**
 * What gets uploaded: a JPEG or PNG up to 4096 on its long side as it is; anything bigger, or anything else the phone can
 * open (HEIC from an album), as a JPEG at most 4096 on its long side, so a large photo doesn't run out the upload's time.
 */
async function uploadable(file) {
  const img = await decodeImage(file), k = Math.min(1, 4096 / Math.max(img.width, img.height));
  if (k === 1 && /^image\/(jpeg|png)$/.test(file.type) && file.size <= 32 * 2 ** 20) return file;
  const c = Object.assign(document.createElement('canvas'), {width: Math.round(img.width * k), height: Math.round(img.height * k)});
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}

/**
 * ctx (main.js): api; addItems(items); item(id); refused(id) → the game turned it down; name(id); grade(id) → rating; spec(id); seen(id) / markSeen(id) for the
 * card flip; flip(el, id) turns a face-down card over; turns, loadModels; equipLabel(id) → {text, disabled}; equip(id);
 * libraryOpen(), openLibrary(); openHow(id); goPlay(); tagRoom() → whether the top tag may show now; fightRoom() → whether a
 * match is on (where 好了 shows a moment, untappable); tagTop() → where the tag goes, under the top plate; placed(id) → put in a
 * slot yet (「做好了」 stays on the tag until then); onChange().
 * 评委版 only: strict (see readQuota); quota, what the page asked as it opened; samples, the two real generations shown
 * beside 拍照 ({id, name, tag, own, photo, time}), and sample(id) replays one (Elara edd90212, 9e17f724).
 */
export function mountShoot(ctx) {
  const $ = id => document.getElementById(id);
  const el = {view: $('shootView'), back: $('shootBack'), backText: $('shootBackText'), quota: $('shootQuota'), steps: $('shootSteps'), body: $('shootBody'),
    cam: $('shootCam'), album: $('shootAlbum'), tag: $('shootTag'), ask: $('shootAsk'), askText: $('shootAskText'), askYes: $('shootAskYes'), askNo: $('shootAskNo')};
  const {api} = ctx;
  let stored = (() => { try { return JSON.parse(localStorage.getItem(JOB_KEY)); } catch { return null; } })();
  const keep = () => { try { if (stored) localStorage.setItem(JOB_KEY, JSON.stringify(stored)); else localStorage.removeItem(JOB_KEY); } catch { /* no storage here */ } };
  // A finished item let go for a new photo before it was put on: the tag keeps saying 「做好了 · 装上去打」 for it till it
  // is (Elara 5ca726ff, Sol 0a6517fd), unless a job of this page has something of its own to say.
  let made = (() => { try { return JSON.parse(localStorage.getItem(MADE_KEY)); } catch { return null; } })(), tagMade = null;
  const keepMade = () => { try { if (made) localStorage.setItem(MADE_KEY, JSON.stringify(made)); else localStorage.removeItem(MADE_KEY); } catch { /* no storage here */ } };
  function letGo() {
    if (job?.status === 'succeeded' && !ctx.placed?.(job.itemId)) { made = {id: job.itemId, what: catOf(job.recognition)}; keepMade(); }
  }
  let job = null, offline = false, pending = null, startError = null, busyNote = '', quota = ctx.quota ?? null, shown = '', recogAt = -Infinity, timer = 0, ticker = 0;
  let quotaErr = 'generation-browser'; // which allowance the last quota error was about
  // Errors running: polls that got a server error, item fetches that failed after 好了, sends that got a server error.
  let pollFails = 0, itemFails = 0, sendFails = 0, lastSend = null, quotaStale = false, quotaAsk = 0;
  // One clientKey per paid action on a job (再提交, 重新生成), reused whenever that request is sent again; kept with the
  // job, so it survives the 角色库 and a reload (PR #57 B1, Elara a14738e8).
  const keyFor = kind => { const ks = stored.keys ??= {}; ks[kind + ':' + job.id] ??= newClientKey(); keep(); return ks[kind + ':' + job.id]; };

  // recognition-missed (远夏 02fcaaeb, Sol 9fc357dd): 认物 made nothing of it; the backend holds nothing and waits for the
  // player, a new photo or one of the six, so here it ends like a failure until they pick.
  const missed = j => j?.status === 'recognition-missed';
  const final = j => j?.status === 'succeeded' || j?.status === 'failed' || missed(j);
  // 好了 but its item not yet in this page's catalog (task #56 S2): no card until it is, and it keeps being fetched.
  const fetching = () => job?.status === 'succeeded' && !ctx.item(job.itemId) && !ctx.refused(job.itemId);
  // 好了 at the backend, but the game turned the item down (task #62): it will never come in, so the job lets go.
  const refused = () => job?.status === 'succeeded' && !ctx.item(job.itemId) && ctx.refused(job.itemId);
  // A job this page follows, no longer asked about because the page and its backend don't match (task #70).
  const stopped = () => MISMATCH.includes(startError) && !!stored && !!job;
  // Time since generation really began: waiting in line isn't being slow.
  const elapsed = () => job?.steps[0]?.startedAt ? (api.now() - ms(job.steps[0].startedAt)) / 1000 : 0;
  // People ahead while it waits its turn (for 认物, or for generation once 认物 and its retake moment are over).
  const ahead = () => job && !final(job) && job.queuePosition > 0 && !job.steps.some(s => s.startedAt) ? job.queuePosition : 0;
  const queuedFor = () => (api.now() - ms(job.status === 'recognizing' ? job.createdAt : job.retakeUntil ?? job.createdAt)) / 1000;
  // Seconds still open to say 不是它，重拍 (task #85): after a new photo's 认物 the backend waits until retakeUntil before
  // anything is paid for; null when there is no such moment (a job made from an earlier one's 认物).
  const retakeLeft = () => job?.status === 'generating' && job.retakeUntil && !job.steps.some(s => s.startedAt)
    ? Math.max(0, (ms(job.retakeUntil) - api.now()) / 1000) : 0;
  // The missed job whose 直接选一类 was tapped: the six instead of 再拍一张 (Elara a68613bb). Nothing is sent until a pick.
  let choosing = null;
  // The pick for one job (Sol c25acdf8): {id, cat} on its way or taken (shown till a poll moves on), or {id, say} when it
  // went wrong. Another job never sees it.
  let pick = null;
  // After 不是它 was tapped: what 认物 says, whether the call is still out, and when the backend said too late. 认物 stays
  // up until the answer is in and a moment after a 「已经开始生成了」, so the tap is never just swallowed.
  let retakeSay = '', retaking = false, lateAt = -Infinity;
  // The job whose 鉴定卡 has stamped in (it does once; later screens of the same job show it as it is), and its styled
  // picture: asked for once 改画风 is done, then the photo turns into it, once.
  let idFor = null, styled = {id: null, url: null, asking: false, tries: 0, shown: false};
  // 好了 seen arrive during a match: a quiet line over the fight for a moment (Elara 207a725b), then the tag on 结算.
  let madeFor = null, toastLeft = 0, toastAt = 0;
  const retakeLate = () => lateAt > -Infinity;
  // Seconds left: each step not yet done at its usual share of the estimate, less the time the current one has had.
  function remaining() {
    const total = (job.estimateSeconds ?? 90) * 0.95;
    let left = 0;
    for (const st of STEPS) {
      const s = job.steps.find(x => x.key === st.key);
      if (s?.endedAt) continue;
      left += Math.max(0, st.share * total - (s?.startedAt ? (api.now() - ms(s.startedAt)) / 1000 : 0));
    }
    return job.status === 'recognizing' ? total : Math.max(0, left);
  }
  function fraction() {
    if (!job || job.status === 'recognizing') return 0.02;
    if (job.status === 'succeeded') return 1;
    let f = 0;
    const total = (job.estimateSeconds ?? 90) * 0.95;
    for (const st of STEPS) {
      const s = job.steps.find(x => x.key === st.key);
      if (s?.endedAt) f += st.share;
      else if (s?.startedAt) f += st.share * Math.min(0.92, (api.now() - ms(s.startedAt)) / 1000 / (st.share * total));
    }
    return Math.max(0.03, Math.min(0.98, f));
  }

  // ---------- polling: every pollMs while a job runs, paused while the page is in the background ----------
  async function poll() {
    clearTimeout(timer);
    if (!stored?.id || document.hidden) return;
    const id = stored.id;
    try {
      const j = await api.job(id);
      if (stored?.id !== id) return;
      offline = false;
      pollFails = 0;
      // Answered as its own backend again (reopened from the tag, or back to the page): the mismatch is over (task #70).
      if (MISMATCH.includes(startError)) startError = null;
      // Retaken (here a moment ago, or in another tab): nothing more to follow, back to taking a photo.
      if (j.status === 'failed' && j.error?.code === 'retake') { fresh(); return; }
      const was = job;
      job = j;
      // 认物 just came in while watching: its result stays up a moment (a page reopened later goes straight on).
      if (j.recognition && was?.status === 'recognizing') recogAt = performance.now();
      if (fetching()) await loadItems();
      if (j.status !== was?.status || j.steps[0].startedAt !== was?.steps[0].startedAt) loadQuota();
    } catch (e) {
      if (e.code === 'offline') offline = true;
      else if (e.code === 'pass') { job = null; startError = 'pass'; }
      // Only the backend saying it has no such job ends it (task #56 S1); a 500 or 503 keeps the id and asks again later.
      else if (e.code === 'not-found') { stored = null; job = null; startError = 'not-found'; keep(); }
      else if (MISMATCH.includes(e.code)) startError = e.code;
      else pollFails++;
    }
    sync();
    // Slower while it keeps failing: twice the wait each time, up to eight times.
    const fails = Math.max(pollFails, itemFails);
    if (stored && !MISMATCH.includes(startError) && (!final(job) || fetching())) timer = setTimeout(poll, api.pollMs * Math.min(8, 2 ** fails));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  async function loadItems() {
    try { await ctx.addItems(await api.items()); itemFails = fetching() ? itemFails + 1 : 0; } catch (e) { if (MISMATCH.includes(e.code)) startError = e.code; else itemFails++; }
  }
  // Every ask, and every count set here, takes a number; an answer counts only if nothing came after it, so an ask
  // from before a send that arrives late can't put back the old count (Sol f3006c38).
  async function loadQuota() {
    if (quota?.lost) return;
    const n = ++quotaAsk, q = await readQuota(api, ctx.strict);
    if (n !== quotaAsk) return;
    quota = q; if (!quota?.down) quotaStale = false; paintQuota();
  }
  // A send that didn't go through (someone else took the last photo, the network, the backend): the count read before
  // it may be wrong now, so it goes at once and is asked again; only an answer replaces it, a failed ask leaves the
  // state as it was (Sol 9e197ca4, Elara c8dc6ca0).
  async function recheckQuota() {
    if (quota?.lost) return;
    quotaStale = true; paintQuota();
    const n = ++quotaAsk, q = await readQuota(api, ctx.strict);
    if (n !== quotaAsk) return;
    if (q && !q.down && !q.lost) { quota = q; quotaStale = false; }
    paintQuota();
  }
  // An allowance used up today, as a QUOTA_SAY key: a new photo needs a generation and a 认物 left.
  function quotaOut() {
    if (quota?.lost) return 'session';
    if (quota?.down || quota?.budget?.available === false) return 'budget';
    if (quota?.out) return quota.out;
    if (quota?.remaining === 0) return 'generation-browser';
    if (quota?.global?.remaining === 0) return 'generation-global';
    if (quota?.recognition?.remaining === 0) return 'recognition-browser';
    if (quota?.global?.recognition?.remaining === 0) return 'recognition-global';
    return null;
  }

  // ---------- screens ----------
  // Which screen the state calls for; each key is drawn once, then only its live parts are updated.
  function screen() { return startError ? 'err:' + startError : under(); }
  // The screen the job itself calls for, under any error.
  function under() {
    if (!stored) return pending ? 'confirm' : quotaOut() ? 'out:' + quotaOut() : 'pick';
    if (!job) return 'wait';
    if (ahead() && job.status === 'recognizing') return 'qrecog';
    if (missed(job)) return choosing === job.id || pick?.id === job.id ? 'choose' : 'missed';
    if (job.status === 'recognizing' || (job.status === 'generating' && (retakeLeft() > 0 || retaking || performance.now() - lateAt < LATE_HOLD || performance.now() - recogAt < RECOG_HOLD))) return 'recog';
    if (ahead()) return 'qgen';
    if (job.status === 'generating') return 'gen';
    // A failure whose photo was given back reads as the last word, whatever its code (Sol c6bbf915).
    if (job.status === 'failed') return job.error.code === 'unknown-submit' ? 'held' : 'fail:' + (job.error.refunded ? 'photo-failed' : job.error.code);
    return fetching() ? 'fetch' : refused() ? 'lost:refused' : 'done:' + job.itemId;
  }
  const STEP_OF = {pick: 0, out: 0, confirm: 0, wait: 2, qrecog: 1, recog: 1, missed: 1, choose: 1, qgen: 2, gen: 2, fetch: 2, fail: 2, held: 2, lost: 3, done: 3, err: 0};
  function paintSteps(key) {
    // An error lights the step the job stopped at (task #70), the first one if there is no job; a job that failed before
    // anything was recognised, or a request turned down by 认物, stopped at 认物 (Elara fa35bf76).
    const [kind, code] = key.split(':');
    const at = (kind === 'fail' && !job.recognition) || (kind === 'err' && code.startsWith('recognition-')) ? STEP_OF.recog
      : STEP_OF[kind === 'err' ? under().split(':')[0] : kind];
    el.steps.querySelectorAll('li').forEach((li, i) => {
      li.className = i < at ? 'done' : i === at ? (kind === 'fail' || kind === 'err' || kind === 'lost' ? 'now bad' : kind === 'held' ? 'now hold' : 'now') : '';
    });
  }
  // Shown only once the backend enforces a limit (Elara 71be6494): the fewest of what a new photo needs; nothing while
  // 暂时不能拍, when no count is the one that matters.
  function paintQuota() {
    // Nothing to count while no photo can be taken at all: 暂时不能拍, or the backend no longer knows this page.
    const left = ['budget', 'session'].includes(quotaOut()) || ['session', 'storage'].includes(startError) ? [] : [quota?.remaining, quota?.global?.remaining, quota?.recognition?.remaining, quota?.global?.recognition?.remaining].filter(n => n != null);
    el.quota.textContent = left.length && !quotaStale ? `今天还能拍 ${Math.min(...left)} 件` : '';
  }
  const photo = () => stored?.photo ?? pending?.thumb ?? '';
  const frame = (cls, inner) => `<div class="sframe ${cls}">${photo() ? `<img src="${esc(photo())}" alt="你拍的照片">` : ''}${inner}</div>`;
  const foot = (...btns) => `<div class="sfoot">${btns.join('')}</div>`;
  const ghost = (act, label, icon = '') => `<button type="button" class="sghost" data-act="${act}">${icon}<span>${label}</span></button>`;
  const go = (act, label, sub = '') => `<button type="button" class="go" data-act="${act}"><span>${label}</span>${sub ? `<small>${sub}</small>` : ICON.arrow}</button>`;
  const PLAY_LINK = '<button type="button" class="slink" data-act="play">先用现成的角色打一局</button>';
  // 评委版: two real generations, there to look at (and play) whether or not 拍照 is on now (Elara 9e17f724).
  const SAMPLE = ctx.sample && ctx.samples?.length ? `<div class="ssamples"><span>${ICON.play}看它怎么来的</span><div>${ctx.samples.map(x =>
    `<button type="button" data-act="sample" data-id="${esc(x.id)}"${x.own ? ' class="own"' : ''}><img src="${esc(x.photo ?? '')}" alt=""><b>${esc(x.name)}</b><small>${esc(x.own ? x.tag : '网上公开图片')}</small><small>用时 ${esc(x.time)}</small></button>`).join('')}</div></div>` : '';

  // 鉴定卡 (Elara 207a725b): what 认物 made of the photo, its name, material and one line (recognition.verdict, Sol
  // 99c2016a; none, no line), stamped in the moment it is in. Before that, a blank one being read.
  // A long name (up to 12 characters) gets smaller rather than cut; a long material goes under it.
  const idFace = r => `<span class="sid-head"><i></i>鉴定单</span><span class="sid-row"><b class="sid-name" style="--n:${Array.from(catOf(r)).length}">${esc(catOf(r))}</b>
    ${matOf(r) ? `<span class="sid-mat"><small>材质</small>${esc(matOf(r))}</span>` : ''}</span>${r.verdict ? `<p class="sid-say">${esc(r.verdict)}</p>` : ''}
    ${'inSix' in r && !r.inSix ? `<small class="sid-as">${esc(countAs(r))}</small>` : ''}${r.chosen ? `<small class="sid-as">${r.chosen === 'timeout' ? '没选，就按枕头来做' : '你选的，就按它来做'}</small>` : ''}
    <i class="sid-seal" aria-hidden="true">${r.chosen ? (r.chosen === 'timeout' ? '默认' : '你选的') : '已鉴定'}</i>`;
  function idCard() {
    const r = job?.recognition;
    if (!r) return '<div class="sid wait" data-live="id"><span class="sid-head"><i></i>鉴定单</span><span class="sid-row"><b class="sid-name"></b><span class="sid-scan">正在认是什么</span></span></div>';
    const fresh = idFor !== job.id;
    idFor = job.id;
    return `<div class="sid${fresh ? ' in' : ''}" data-live="id">${idFace(r)}</div>`;
  }
  // 改画风's picture over the photo once it is in, decoded first so it turns over whole; three tries, then the photo stays.
  function paintStyled(img, face) {
    if (!img || !job?.styledUrl) return;
    if (styled.id !== job.id) styled = {id: job.id, url: null, asking: false, tries: 0, shown: false};
    const id = job.id;
    if (!styled.url && !styled.asking && styled.tries < 3) {
      styled.asking = true; styled.tries++;
      api.fileUrl(job.styledUrl).then(async u => { const im = new Image(); im.src = u; await im.decode(); if (styled.id === id) styled.url = u; })
        .catch(() => {}).finally(() => { if (styled.id === id) styled.asking = false; });
    }
    if (!styled.url || !img.hidden) return;
    img.src = styled.url;
    img.hidden = false;
    img.parentElement.classList.add('styled', ...styled.shown ? [] : ['turning']);
    styled.shown = true;
    face.textContent = '游戏里的样子';
  }

  function draw(key) {
    const [kind, code] = key.split(':');
    let html = '';
    // The big frame is a tap target too, the same as the button under it (远夏 865a85a3, Elara 14b23d0e: many tap it first).
    if (kind === 'pick') {
      html = `<div class="sframe pick" data-act="camera" role="button" tabindex="0" aria-label="拍照"><span class="sview">${ICON.camera}<b>拍一件身边的东西</b><small>一次拍一样，让它占满画面</small></span></div>
        ${api.kind === 'fake' && !api.named ? `<div class="ssix"><span>拍什么都行，会按最像的一类算攻守</span><div>${Object.values(CAT).map(c => `<i>${c}</i>`).join('')}</div></div>`
          : '<div class="ssix"><span>拍的是什么就认成什么，大小、轻重、软硬看照片估</span></div>'}${SAMPLE}
        ${foot(ghost('album', '从相册选', ICON.album), go('camera', '拍照'))}`;
    } else if (kind === 'out') {
      // Used up for today: 拍照 greyed, and the way on is a game with the characters already there (Elara 6dee70f7).
      const [line, after] = QUOTA_SAY[code].split('，');
      html = `<div class="sframe pick out"${code === 'session' ? ' data-act="renew" role="button" tabindex="0" aria-label="重新开始拍"' : ''}><span class="sview">${ICON.camera}<b>${line}</b><small>${after}</small></span></div>
        <div class="ssix"><span>角色库里现成的角色随时能打</span></div>${SAMPLE}
        ${foot(code === 'session' ? ghost('renew', '重新开始拍', ICON.retry) : `<button type="button" class="sghost" disabled>${ICON.camera}<span>拍照</span></button>`, go('play', '先去打一局'))}`;
    } else if (kind === 'qrecog' || kind === 'qgen') {
      html = `${frame('scan', `<span class="stag">排队中</span>${job.recognition ? `<span class="scat">${esc(countAs(job.recognition))}</span>` : ''}`)}
        <div class="squeue"><b data-live="ahead"></b><small>轮到了自动开始${kind === 'qrecog' ? '认物' : '生成'}，可以先去打一局，好了顶部会提醒你</small></div>
        <p class="snote warn" data-live="warn" hidden></p>
        ${foot(go('play', '先去打一局'))}`;
    } else if (kind === 'confirm') {
      html = `${frame('', '')}<p class="snote">生成一般 3 分钟左右，等的时候可以先去打一局</p><p class="serr" data-live="send"></p>
        ${foot(ghost('retake', '重拍', ICON.retry), go('submit', '用这张，开始'))}`;
    } else if (kind === 'wait') {
      html = `${frame('scan', '<i class="sline"></i>')}<p class="snote" data-live="warn">正在找回这一件…</p>
        <div class="sfoot" data-live="out" hidden>${go('play', '先用现成的角色打一局')}</div>`;
    } else if (kind === 'fetch') {
      html = `${frame('gen', '<i class="ssweep"></i>')}<p class="snote">生成好了，正在取回…</p><p class="snote warn" data-live="warn" hidden></p>
        ${foot(ghost('lib', '回角色库'))}`;
    } else if (kind === 'recog') {
      html = `${frame(job.recognition ? 'scan got' : 'scan', `<i class="sline"></i><span class="stag" data-live="rtag">${job.recognition ? '认好了' : '认物中'}</span>`)}
        ${idCard()}${api.kind === 'fake' ? `<div class="sfines"><p class="sfine fake">${api.named ? '现在是假生成：认出来的名字是地址里写的' : '现在是假生成：前两张固定是扫把、刀剪，之后从六类里随机'}</p></div>` : ''}
        <div class="sfoot"><button type="button" class="sghost sretake" data-act="nothis" hidden>${ICON.retry}<span>不是它，重拍</span></button>
          <p class="snext"><i class="spin"></i><span data-live="next">正在认是什么</span></p></div>`;
    } else if (kind === 'missed') {
      // 认物 made nothing of it (远夏 02fcaaeb, Elara a68613bb): his words, a new photo first, the six only if asked for.
      html = `${frame('scan got', '<span class="stag ask">没认出来</span>')}
        <div class="smsg"><b>这是啥呀，没认出来，再拍一张好啵？</b><small class="scount">这次没算次数</small></div>
        <div class="sfoot smiss">${go('fresh', '再拍一张')}<button type="button" class="slink" data-act="choose">直接选一类</button></div>`;
    } else if (kind === 'choose') {
      // The six (Elara 9699c50e): made only once one is picked, no default and no clock (Elara a68613bb).
      html = `${frame('scan got', '<span class="stag ask">没认出来</span>')}
        <div class="schoose"><b>挑一个最像的吧</b><small>按你挑的那类来做，大小、轻重照这类算</small>
          <div>${Object.entries(CAT).map(([k, c]) => `<button type="button" data-act="pick" data-cat="${k}">${c}</button>`).join('')}</div></div>
        <p class="serr" data-live="send"></p>
        <div class="sfoot smiss"><p class="snext"><span data-live="next"></span></p><button type="button" class="slink" data-act="fresh">还是再拍一张</button></div>`;
    } else if (kind === 'gen') {
      // The photo, then the styled picture over it as soon as there is one (Elara 207a725b); the 鉴定卡 under it.
      html = `${frame('gen', `<img class="sstyled" data-live="styled" alt="改成游戏画风的图" hidden><i class="sedge"></i><i class="ssweep"></i>
          <span class="sface" data-live="face">你拍的</span><span class="snow" data-live="now"></span>`)}
        ${idCard()}
        <div class="seta"><b data-live="eta"></b><small>好了会在顶部提醒你</small></div>
        <div class="sbar"><i data-live="bar"></i></div>
        <p class="snote warn" data-live="warn" hidden></p>
        ${foot(go('play', '先去打一局'))}`;
    } else if (kind === 'fail' || kind === 'err' || kind === 'lost') {
      const retry = kind === 'fail' ? job.error.retry : 'none';
      // Whether this one took one of today's photos (Elara 5027aa74: every failure screen says so). A job's own word
      // (charged: paid generation began), or a photo 认物 could not make out: only the photo's own fault is the player's
      // (Elara 7235d89f); a request turned down made no job.
      const count = kind === 'fail' && code === 'photo-failed' ? '这次没算次数' : kind === 'lost' || (kind === 'fail' && (job.error.charged === true || code === 'photo-unclear')) ? (retry === 'same' ? '这次算了一次，再试不另算' : '这次算了一次')
        // 认物 breaking is always our fault, whatever the job says about retrying (Elara 139c00fb).
        : (kind === 'fail' && (job.error.charged === false || code.startsWith('recognition-'))) || (kind === 'err' && lastSend && code !== 'pass') ? '这次没算次数' : '';
      const btns = code === 'pass' ? [go('pass', '确定')]
        // The last word: one way on, a new photo (Elara d597a68a).
        : code === 'photo-failed' ? [go('fresh', '再拍一次')]
        // Again after 认物 broke is a new go: it takes one of today's photos once made (Elara 704b790a). After a paid stage
        // broke, today's photo is taken already.
        : retry === 'same' ? [ghost('lib', '回角色库'), go('retry', '再试', code.startsWith('recognition-') ? '做成才算' : '')]
        : retry === 'resubmit' ? [ghost('lib', '回角色库'), go('resubmit', '再提交', '这次没算')]
        : retry === 'regenerate' ? [ghost('lib', '回角色库'), go('regen', '重新生成', '会多算一次')]
        : ['photo-invalid', 'photo-unclear', 'key-conflict', 'refused', 'process-corrupt', 'process-too-large'].includes(code) ? [ghost('lib', '回角色库'), go('fresh', '换一张拍')]
        : code === 'server' && lastSend ? [ghost('lib', '回角色库'), go('again', '再试')]
        : code === 'recognition-limit' || code === 'recognition-auth' ? [ghost('lib', '回角色库'), go('play', '先去打一局')]
        // A job that stopped with no retry: its way on is a new photo.
        : kind === 'fail' || SERVICE.includes(code) || code === 'photo-read' ? [ghost('lib', '回角色库'), go('fresh', '重新拍')]
        : code === 'not-allowed' && stored ? [ghost('lib', '回角色库'), go('refresh', '刷新')]
        : code === 'session' ? [ghost('renew', '重新开始拍', ICON.retry), go('play', '先去打一局')]
        : code === 'quota' || code === 'server-down' || code === 'budget' || code === 'storage' ? [ghost('lib', '回角色库'), go('play', '先去打一局')]
        : [ghost('lib', '回角色库')];
      // No 再试 button, no 「再试一次」 (Elara 8c97da17): the way on is then a new photo, here or from the 角色库.
      const has = act => btns.some(b => b.includes(`data-act="${act}"`));
      const say = (code === 'quota' ? QUOTA_SAY[quotaErr] : code === 'storage' ? SAY.budget : SAY[code] ?? (kind === 'fail' ? '这一件没做成，再试一次' : SAY.server))
        .replace(/再试一次.*$/, m => ['retry', 'again', 'resubmit'].some(has) ? m : has('fresh') ? '重新拍一件' : '回角色库重新拍一件');
      html = `${frame('bad', `<span class="sbadge">${kind === 'lost' ? '装不进游戏' : code === 'session' ? '记录找不到了' : code === 'budget' || code === 'storage' ? '暂时不能拍' : MISMATCH.includes(code) ? '连错了后台' : code === 'quota' ? '名额用完了' : job?.recognition ? '没生成出来' : '没做成'}</span>`)}
        <div class="smsg"><b>${esc(say)}</b>${count ? `<small class="scount">${count}</small>` : ''}${code === 'pass' ? '<input type="password" class="spass" id="shootPass" placeholder="输入口令" autocomplete="current-password">' : ''}</div>
        <p class="serr" data-live="send"></p>${kind === 'err' && CANT_NOW.includes(code) ? SAMPLE : ''}${foot(...btns)}`;
    } else if (kind === 'held') {
      // unknown-submit (Elara 8d32a2a6, 69a1c60d): one sentence and only 回角色库, no retake or retry: the paid
      // submission is being checked. It doesn't hold the one-at-a-time place, so 拍一件 starts a new photo.
      html = `${frame('held', `<span class="sbadge">${ICON.wait}核实中</span>`)}<div class="smsg held"><b>这件还在核实，不会多扣</b></div>${foot(ghost('lib', '回角色库'))}`;
    } else if (kind === 'done') {
      const id = code, r = ctx.grade(id), it = ctx.item(id), eq = ctx.equipLabel(id);
      // Broken only between its parts, never inside one (Elara 258971dd: 「完好」 split over two lines).
      const line = [it.materialName ?? MATERIAL[it.material], ...ctx.spec(id).split(' · '), WEAR[it.condition]].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join(' · ');
      const end = Math.max(...job.steps.map(s => ms(s.endedAt) ?? 0)), took = end ? (end - ms(job.createdAt)) / 1000 : null;
      // A page reopened in another browser has no photo of its own; the item carries the one the backend kept (Elara cf1366e6).
      const shot = photo() || it.origin?.photo || '';
      html = `<h2 class="shead">做好了</h2><div class="spair"><figure><span class="pane">${shot ? `<img src="${esc(shot)}" alt="">` : ''}</span><figcaption>你拍的</figcaption></figure>
          <figure><span class="pane"><canvas class="turn" data-live="turn"></canvas></span><figcaption>生成的 3D · 拖着转</figcaption></figure></div>
        <div class="sstage"><div class="card sreveal${r ? ' grade' + r.grade : ''}" data-item="${esc(id)}">
          ${r ? `<i class="big g${r.grade}">${r.grade}</i>` : ''}
          <div class="sname"><span class="nm"><b>${esc(ctx.name(id))}</b>${(c => c ? `<span class="cat">${esc(c)}</span>` : '')(catLabel(it, ctx.name(id)))}</span><small>${line}</small></div>
          ${r ? `<span class="rates">${[['attack', '攻击'], ['range', '范围'], ['durability', '耐久']].map(([k, label]) => `<span>${label}</span><i class="g${r.letters[k]}">${r.letters[k]}</i>`).join('')}</span>` : ''}
          <span class="cover" aria-hidden="true"><i>?</i></span></div></div><i class="sdim" aria-hidden="true"></i>
        <p class="sdone">${ICON.check}<span>已经放进角色库${took ? `，用时 ${dur(took)}` : ''}</span>${it.origin ? `<button type="button" data-act="how">${ICON.play}看它怎么来的</button>` : ''}</p>
        ${foot(ghost('lib', '回角色库'), `<button type="button" class="go" data-act="equip"${eq.disabled ? ' disabled' : ''}><span>${eq.text}</span></button>`)}`;
    }
    el.body.innerHTML = html;
    el.body.scrollTop = 0;
    if (kind === 'done') showDone(code);
  }
  async function showDone(id) {
    const card = el.body.querySelector('.sreveal'), canvas = el.body.querySelector('[data-live="turn"]');
    ctx.turns.prune();
    if (ctx.grade(id) && !ctx.seen(id)) ctx.flip(card, id, 500, card.parentElement);
    if (!stored.seen) { stored.seen = true; keep(); paintTag(); }
    await ctx.loadModels([ctx.item(id)]);
    if (canvas.isConnected) ctx.turns.show(canvas, id, {zoom: 1.3, drag: true});
  }
  // The parts of a screen that move: 认物's result, 生成中's steps, times and bar, the connection and slow notices.
  function update() {
    const live = n => el.body.querySelector(`[data-live="${n}"]`);
    if (shown === 'recog' && job.recognition) {
      const card = live('id');
      if (card.classList.contains('wait')) { card.outerHTML = idCard(); live('rtag').textContent = '认好了'; el.body.querySelector('.sframe').classList.add('got'); }
      const left = Math.ceil(retakeLeft()), btn = el.body.querySelector('[data-act="nothis"]');
      btn.hidden = (!left && !retaking) || retakeLate();
      live('next').textContent = retakeLate() ? retakeSay : !left ? '认好了，马上开始生成' : retakeSay ? `${retakeSay}（还剩 ${left} 秒）` : `${left} 秒后开始生成`;
    }
    if (shown === 'choose') {
      const mine = pick?.id === job.id ? pick : null, cat = mine?.cat;
      live('next').textContent = cat ? `好，按${CAT[cat]}来做…` : '';
      live('next').parentElement.hidden = !cat;
      live('send').textContent = mine?.say ?? '';
      for (const b of el.body.querySelectorAll('[data-act="pick"]')) { b.disabled = !!cat; b.classList.toggle('on', b.dataset.cat === cat); }
      // On its way, the pick may already be generating: a new photo now would only meet it as the job still running.
      el.body.querySelector('[data-act="fresh"]').hidden = !!cat;
    }
    const queued = shown === 'qrecog' || shown === 'qgen';
    // Waiting for generation: when theirs is done, about 3 minutes for each one ahead (the one being made counts) and 3
    // for theirs (Elara 29784833 b6322589, Sol 787696c8). Waiting for 认物: no minutes.
    if (queued) live('ahead').innerHTML = shown === 'qgen' ? `前面还有 <em>${ahead()}</em> 件，做好大约 <em>${(ahead() + 1) * 3}</em> 分钟` : `前面还有 <em>${ahead()}</em> 个人`;
    if (shown === 'wait' || shown === 'gen' || shown === 'fetch' || queued) {
      const warn = live('warn'), fails = shown === 'fetch' ? itemFails : pollFails;
      const text = offline ? '连不上，自动重连中' : fails >= DOWN_AFTER ? SAY['server-down'] : fails ? '后台没回话，过一会儿再查'
        : shown === 'fetch' ? '' : busyNote || (queued ? (queuedFor() > QUEUE_LONG ? '人有点多，要多等一会儿' : '') : job && elapsed() > SLOW ? '比平时慢，再等等' : '');
      // 找回 with no answer from the backend: the characters already there are a way out.
      if (shown === 'wait') { if (text) warn.textContent = text; live('out').hidden = !text; } else { warn.hidden = !text; warn.textContent = text; }
    }
    if (shown !== 'gen' || !job) return;
    const left = remaining(), done = key => Boolean(job.steps.find(x => x.key === key)?.endedAt);
    live('eta').innerHTML = elapsed() > SLOW || left <= 0 ? '快好了' : `预计还要 <em>${about(left)}</em>`;
    live('bar').style.setProperty('--fill', fraction());
    // One line in plain words over the picture, not the backend's steps (Elara 207a725b).
    const now = !done('styled') ? '正在画成游戏里的样子' : !done('model') ? '画好了，正在做成 3D' : '快好了，正在放进角色库';
    if (live('now').textContent !== now) live('now').textContent = now;
    paintStyled(live('styled'), live('face'));
  }
  function sync() {
    // 好了 and in the catalog while a match is on: the quiet line over the fight, once per job.
    if (job?.status === 'succeeded' && ctx.item(job.itemId) && madeFor !== job.id) {
      madeFor = job.id;
      if (stored && !stored.seen && ctx.fightRoom?.()) { toastLeft = TOAST; toastAt = performance.now(); setTimeout(toastTick, 100); }
    }
    paintTag();
    ctx.onChange?.();
    if (el.view.hidden) return;
    const key = screen();
    if (key !== shown) { shown = key; draw(key); paintSteps(key); paintQuota(); }
    // A failure the player has now seen no longer calls them back from the top tag.
    if (/^(fail|held|lost|missed|choose)/.test(key) && stored && !stored.seen) { stored.seen = true; keep(); }
    update();
  }

  // ---------- the tag at the top of the build and result screens ----------
  // The line under the HUD (冲中, 撞碎了…) goes first: 「做好了」 waits under it, its clock stopped, and gets its whole time
  // once that is down (Elara 5fd78c17).
  function toastTick() {
    const now = performance.now();
    if (!ctx.hudBusy?.()) toastLeft -= now - toastAt;
    toastAt = now;
    if (!ctx.fightRoom?.()) toastLeft = 0;
    paintTag();
    if (toastLeft > 0) setTimeout(toastTick, 100);
  }
  function paintTag() {
    if (made && ctx.placed?.(made.id)) { made = null; keepMade(); }
    const own = !stored || !job ? null : stopped() ? 'bad' : fetching() ? 'run' : refused() ? (stored.seen ? null : 'bad') : job.status === 'succeeded' ? (ctx.placed?.(job.itemId) ? null : 'done')
      : job.status === 'failed' || missed(job) ? (stored.seen ? null : 'bad') : 'run';
    // The one let go: on the build and result screens only, once it is in the 角色库.
    tagMade = !own && made && ctx.item(made.id) ? made : null;
    const room = ctx.tagRoom(), state = own ?? (tagMade ? 'done' : null);
    // In a match only 好了, only for a moment, and not to be tapped: the fight's buttons are right there.
    const quiet = !room && !tagMade && state === 'done' && ctx.fightRoom?.() && toastLeft > 0 && !ctx.hudBusy?.();
    el.tag.hidden = !(room || quiet) || !el.view.hidden || !state;
    if (el.tag.hidden) return;
    el.tag.className = quiet ? 'done quiet' : state;
    // Out of reach for keys too, not only taps: Enter on a focused tag would open 拍一件 mid-fight (Sol eab01e32).
    el.tag.inert = quiet;
    const top = ctx.tagTop?.();
    el.tag.style.top = top == null ? '' : `${top}px`;
    const what = esc(tagMade ? tagMade.what : catOf(job.recognition));
    const html = quiet ? `<b>${what}做好了</b><small>打完就能装上去打</small>`
      : state === 'done' ? `<b>${what}做好了</b><span class="sgo">装上去打</span>${ICON.arrow}`
      : state === 'bad' ? `<b>${stopped() ? (startError === 'session' ? '拍照记录找不到了，去看看' : '拍一件连错了后台，去看看') : refused() ? '这件装不进游戏，去看看' : missed(job) ? '这件没认出来，去看看' : job.error.code === 'unknown-submit' ? '这件还在核实' : '这件没生成出来，去看看'}</b>${ICON.arrow}`
      : fetching() ? `<i class="ring" style="--fill:1"></i><b>${what}生成好了</b><small>正在取回</small>`
      : ahead() ? `<i class="ring" style="--fill:0.02"></i><b>${job.recognition ? what : '新的一件'}排队中</b><small>${job.status === 'recognizing' ? `前面还有 ${ahead()} 人` : `前面 ${ahead()} 件，做好约 ${(ahead() + 1) * 3} 分钟`}</small>`
      : `<i class="ring" style="--fill:${fraction().toFixed(2)}"></i><b>${job.recognition ? what : '新的一件'}生成中</b><small>${remaining() > 0 && elapsed() < SLOW ? '还要 ' + about(remaining()) : '快好了'}</small>`;
    if (el.tag.innerHTML !== html) el.tag.innerHTML = html;
  }
  // The one let go has no job to show: straight on, as the 好了 screen's 装上去打 does.
  el.tag.onclick = () => { if (el.tag.inert) return; if (tagMade) ctx.equip(tagMade.id); else open('tag'); };

  // ---------- actions ----------
  async function send(fn) {
    const btn = el.body.querySelector('.sfoot .go'), note = el.body.querySelector('[data-live="send"]');
    if (btn) btn.disabled = true;
    if (note) note.textContent = '';
    lastSend = fn;
    try {
      const j = await fn();
      startError = null;
      sendFails = 0;
      stored = {id: j.id, photo: photo(), seen: false};
      keep();
      job = j;
      pending = null;
      retakeSay = ''; retaking = false; lateAt = -Infinity;
      recogAt = j.recognition ? -Infinity : 0;
      loadQuota();
      sync();
      poll();
    } catch (e) {
      if (btn) btn.disabled = false;
      // Out of budget is marked (and older asks dropped) before the count is asked again, so that answer counts: a held
      // photo given back elsewhere shows here without reopening (Sol c8817327, Elara 826455ed).
      if (e.code === 'budget') { quotaAsk++; quota = {down: true}; }
      recheckQuota();
      if (e.code === 'offline') {
        if (note) note.innerHTML = `没传上去，网络好了再点一次，或者${PLAY_LINK}`;
        // The photo and 用这张，开始 stay; the two real generations join them (Sol e8c34c47, Elara 489c0d4b).
        if (note && SAMPLE && !el.body.querySelector('.ssamples')) note.insertAdjacentHTML('afterend', SAMPLE);
        return;
      }
      if (e.code === 'quota') quotaErr = quotaKey(e.kind, e.scope);
      if (e.code === 'active-job') { await adopt(e.activeJobId); return; }
      if (job && final(job) && (e.code === 'quota' || e.code === 'budget')) { if (note) note.textContent = e.code === 'budget' ? SAY.budget : QUOTA_SAY[quotaErr]; return; }
      startError = e instanceof ShootError ? e.code : 'server';
      // A server error may be resent as it was (same request, same clientKey), but not forever (Sol 21c4552e).
      if (startError === 'server' && ++sendFails >= DOWN_AFTER) startError = 'server-down';
      // 再试, 再提交 or 重新生成 that the backend couldn't take: the failed job stays this page's, seen or not, until that
      // step goes through, so coming back later carries on with the same job and key (PR #57 B1). Refused outright, it lets go.
      if (job && stored) { stored.hold = startError === 'server' || startError === 'server-down'; keep(); }
      if (!job) stored = null;
      sync();
    }
  }
  // A job already running (this page lost track of it, or it began elsewhere): show it, saying why.
  async function adopt(id) {
    stored = {id, photo: stored?.photo ?? pending?.thumb ?? '', seen: false};
    keep();
    pending = null;
    busyNote = '上一件还在做，做完才能拍下一件';
    job = null;
    await poll();
  }
  function pickFile(input) {
    input.value = '';
    input.click();
  }
  async function picked(file) {
    if (!file) return;
    try {
      pending = {file: await uploadable(file), thumb: await thumbOf(file), key: newClientKey()};
    } catch {
      startError = 'photo-invalid';
    }
    sync();
  }
  el.cam.onchange = () => picked(el.cam.files[0]);
  el.album.onchange = () => picked(el.album.files[0]);
  // Back to taking a photo; a retake has just given its generation back, so today's count is asked again.
  function fresh() { letGo(); retakeSay = ''; retaking = false; lateAt = -Infinity; startError = null; pending = null; job = null; stored = null; busyNote = ''; lastSend = null; sendFails = 0; keep(); sync(); loadQuota(); }
  async function ask() {
    await loadQuota();
    el.askText.textContent = `会多算一次${quota?.remaining != null ? `（今天还剩 ${quota.remaining} 次）` : ''}，用同一张照片和同一个认物结果重新做一件。`;
    el.ask.hidden = false;
    return new Promise(res => { el.askYes.onclick = () => { el.ask.hidden = true; res(true); }; el.askNo.onclick = () => { el.ask.hidden = true; res(false); }; });
  }
  el.ask.onclick = e => { if (e.target === el.ask) el.askNo.click(); };
  const acts = {
    camera: () => pickFile(el.cam),
    album: () => pickFile(el.album),
    retake: () => { pending = null; sync(); pickFile(el.cam); },
    fresh: () => { fresh(); pickFile(el.cam); },
    submit: () => send(() => api.create(pending.file, pending.key)),
    pass: () => {
      const v = $('shootPass')?.value.trim();
      if (!v) return;
      setPass(v);
      startError = null;
      if (pending) send(() => api.create(pending.file, pending.key)); else { stored ? poll() : sync(); }
    },
    retry: () => { const id = job.id; send(() => api.retry(id)); },
    // 不是它，重拍 (task #85): ends the job before generation is paid for and goes back to taking a photo. Too late (the
    // backend already started), it says so and carries on; not reached, the button stays for another go while time is left.
    nothis: async () => {
      const id = job.id, btn = el.body.querySelector('[data-act="nothis"]');
      btn.disabled = true;
      retaking = true;
      try {
        await api.retake(id);
        if (stored?.id === id) fresh();
      } catch (e) {
        retaking = false;
        if (stored?.id !== id) return;
        if (e.code === 'not-allowed') { lateAt = performance.now(); retakeSay = '已经开始生成了'; poll(); }
        else { btn.disabled = false; retakeSay = e.code === 'offline' ? '没连上，再点一次' : '没成功，再点一次'; }
        sync();
      }
    },
    choose: () => { choosing = job.id; sync(); },
    // One of the six for a missed job: it goes on to 生成中 once the backend has it, today's generation counted then
    // (Sol 9fc357dd). The reply can come late, after a poll has moved on or another photo was taken (Sol 886c3a95): it
    // never replaces the job, the poll for the job still shown does.
    pick: async b => {
      const id = job.id, cat = b.dataset.cat;
      pick = {id, cat};
      sync();
      try {
        await api.category(id, cat);
        if (stored?.id === id) poll();
      } catch (e) {
        if (pick?.id !== id) return;
        if (e.code === 'not-allowed') { pick = null; if (stored?.id === id) poll(); }
        // Today's generations used up, or the shared budget: no pick goes through, so no second try.
        else if (e.code === 'quota' || e.code === 'budget') pick = {id, say: e.code === 'quota' ? QUOTA_SAY[e.scope === 'global' ? 'generation-global' : 'generation-browser'] : SAY.budget};
        else if (e.code === 'active-job') pick = {id, say: '上一件还在做，做完再来选'};
        else pick = {id, say: e.code === 'offline' ? '没连上，再点一次' : '没成功，再点一次'};
      } finally { sync(); }
    },
    again: () => lastSend && send(lastSend),
    refresh: () => { startError = null; poll(); },
    resubmit: () => { const id = job.id, key = keyFor('re'); send(() => api.resubmit(id, key)); },
    regen: async () => {
      if (!(await ask())) return;
      const old = job.id, key = keyFor('regen');
      send(() => api.regenerate(old, key));
    },
    play: () => { close(); ctx.goPlay(); },
    lib: () => { const done = job?.status === 'succeeded'; close(); if (done || ctx.libraryOpen()) ctx.openLibrary(); },
    how: () => ctx.openHow(job.itemId),
    sample: b => ctx.sample(b.dataset.id),
    // 评委版, after 401 session: a new token only because the player asked for it; the old job is let go (Sol e0a86865).
    renew: () => { api.renew?.(); quotaAsk++; quota = null; fresh(); },
    equip: () => { const id = job.itemId; close(); ctx.equip(id); }
  };
  el.body.onclick = e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) acts[b.dataset.act]?.(b); };
  el.body.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.sframe[data-act]')) { e.preventDefault(); e.target.click(); } };

  // ---------- open / close ----------
  // back names the screen this one closes onto (Pollux acbd091c): 组装台, 结算 or 角色库.
  function open(from, back) {
    el.backText.textContent = back || (from === 'library' ? '角色库' : '返回');
    // From the 拍一件 button or a ?capture=1 link (not the tag, which is about the job it shows): asking for a new photo.
    const fresh = from === 'library' || from === 'link';
    // One job at a time: while one runs, 拍一件 shows it (Elara f63778f3).
    busyNote = fresh && stored && job && !final(job) ? '上一件还在做，做完才能拍下一件' : '';
    // A finished job seen already gives way to a new photo. One not seen yet is shown first, however 拍一件 was opened
    // (Elara 5027aa74): a failure while the player was off playing a game would otherwise go without a word.
    if (fresh && stored && job && final(job) && !stored.hold && stored.seen) { letGo(); stored = null; job = null; keep(); }
    // Back from the 角色库 a while later: a server error may be sent again three more times.
    if (fresh && startError) { if (startError === 'quota' || startError === 'budget') pending = null; startError = null; sendFails = 0; }
    shown = '';
    el.view.hidden = false;
    paintQuota();
    loadQuota();
    sync();
    clearInterval(ticker);
    ticker = setInterval(() => {
      if (el.view.hidden) return clearInterval(ticker);
      // Past midnight in Taipei the allowances are back: ask again rather than keep saying 明天再来.
      if (quota?.resetsAt && Date.now() >= ms(quota.resetsAt)) { quota.resetsAt = null; loadQuota(); }
      sync();
    }, 250);
    poll();
  }
  function close() { el.view.hidden = true; el.ask.hidden = true; clearInterval(ticker); sync(); }
  el.back.onclick = close;
  if (stored) poll();
  return {
    open, close, paintTag,
    // made: 好了 and the item is in this page's catalog (the 拍一件 button's 新 mark waits for it, not for the backend);
    // stopped: no longer asked about, the page and backend don't match (the button stops showing it running).
    get state() { return {stored, job, screen: el.view.hidden ? null : screen(), offline, made: job?.status === 'succeeded' && !!ctx.item(job.itemId), stopped: stopped()}; }
  };
}
