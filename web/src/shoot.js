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
const CAT = {pot: '锅', lamp: '台灯', scissors: '刀剪', broom: '扫把', slipper: '拖鞋', pillow: '枕头'};
// The 「好了」 line (Elara 8d32a2a6): the five scoring materials and three states of wear; 不确定 says nothing.
const MATERIAL = {metal: '金属', wood: '木头', plastic: '塑料', cloth: '布', rubber: '橡胶'};
const WEAR = {intact: '完好', worn: '有点旧', damaged: '破损'};
// The four steps after 认物 and each one's usual share of the estimate (the real generation's, tools/import-item README).
const STEPS = [{key: 'styled', name: '改成画风的图', share: 0.25}, {key: 'model', name: '做成 3D', share: 0.59},
  {key: 'download', name: '取回模型', share: 0.06}, {key: 'process', name: '算等级、放进角色库', share: 0.1}];
const RECOG_HOLD = 2600; // ms the 认物 result stays up once it is in, before 生成中 takes over
const SLOW = 10 * 60; // seconds: past this a job is 比平时慢, not failed
// What the screen says for each failure code (the draft's 「界面说」); the backend's own words only go to its log.
const SAY = {
  'photo-invalid': '这张照片用不了，换一张试试',
  'photo-unclear': '没看清拍的是什么，靠近一点、亮一点再拍',
  pass: '口令不对',
  quota: '今天能拍的件数用完了，明天再来',
  busy: '生成的人太多，这次没算次数，稍等再提交',
  'step-failed': '这次没生成出来，可以重新生成（会多算一次）',
  expired: '结果过期了，可以重新生成（会多算一次）',
  download: '模型没取回来，再试一次（不算次数）',
  process: '处理没成功，再试一次（不算次数）',
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
  refused: '游戏装不进这件，换一张再拍'
};
// The page and its backend don't match: asking again won't help, so polling stops until 拍一件 is opened again (task #62).
const MISMATCH = ['forbidden', 'bad-request', 'no-backend'];
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
const catOf = r => CAT[r?.category] ?? '东西';
const countAs = r => r.inSix ? `按${catOf(r)}算` : `不在六类里，按最像的${catOf(r)}算`;

/** A small JPEG data URL of the photo for this page's own screens (the backend keeps the original). */
async function thumbOf(blob, side = 480) {
  const img = await decodeImage(blob), k = Math.min(1, side / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), {width: Math.round(img.width * k), height: Math.round(img.height * k)});
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
/** What gets uploaded: a JPEG or PNG as it is; anything else the phone can open (HEIC from an album) as a JPEG. */
async function uploadable(file) {
  if (/^image\/(jpeg|png)$/.test(file.type) && file.size <= 32 * 2 ** 20) return file;
  const img = await decodeImage(file), k = Math.min(1, 4096 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), {width: Math.round(img.width * k), height: Math.round(img.height * k)});
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}

/**
 * ctx (main.js): api; addItems(items); item(id); refused(id) → the game turned it down; name(id); grade(id) → rating; spec(id); seen(id) / markSeen(id) for the
 * card flip; flip(el, id) turns a face-down card over; turns, loadModels; equipLabel(id) → {text, disabled}; equip(id);
 * libraryOpen(), openLibrary(); openHow(id); goPlay(); tagRoom() → whether the top tag may show now; onChange().
 */
export function mountShoot(ctx) {
  const $ = id => document.getElementById(id);
  const el = {view: $('shootView'), back: $('shootBack'), backText: $('shootBackText'), quota: $('shootQuota'), steps: $('shootSteps'), body: $('shootBody'),
    cam: $('shootCam'), album: $('shootAlbum'), tag: $('shootTag'), ask: $('shootAsk'), askText: $('shootAskText'), askYes: $('shootAskYes'), askNo: $('shootAskNo')};
  const {api} = ctx;
  let stored = (() => { try { return JSON.parse(localStorage.getItem(JOB_KEY)); } catch { return null; } })();
  const keep = () => { try { if (stored) localStorage.setItem(JOB_KEY, JSON.stringify(stored)); else localStorage.removeItem(JOB_KEY); } catch { /* no storage here */ } };
  let job = null, offline = false, pending = null, startError = null, busyNote = '', quota = null, shown = '', recogAt = -Infinity, timer = 0, ticker = 0;
  // Errors running: polls that got a server error, item fetches that failed after 好了, sends that got a server error.
  let pollFails = 0, itemFails = 0, sendFails = 0, lastSend = null;
  // One clientKey per paid action on a job (再提交, 重新生成), reused whenever that request is sent again; kept with the
  // job, so it survives the 角色库 and a reload (PR #57 B1, Elara a14738e8).
  const keyFor = kind => { const ks = stored.keys ??= {}; ks[kind + ':' + job.id] ??= newClientKey(); keep(); return ks[kind + ':' + job.id]; };

  const final = j => j?.status === 'succeeded' || j?.status === 'failed';
  // 好了 but its item not yet in this page's catalog (task #56 S2): no card until it is, and it keeps being fetched.
  const fetching = () => job?.status === 'succeeded' && !ctx.item(job.itemId) && !ctx.refused(job.itemId);
  // 好了 at the backend, but the game turned the item down (task #62): it will never come in, so the job lets go.
  const refused = () => job?.status === 'succeeded' && !ctx.item(job.itemId) && ctx.refused(job.itemId);
  const elapsed = () => job ? (api.now() - ms(job.createdAt)) / 1000 : 0;
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
  async function loadQuota() { try { quota = await api.quota(); } catch { quota = null; } paintQuota(); }

  // ---------- screens ----------
  // Which screen the state calls for; each key is drawn once, then only its live parts are updated.
  function screen() {
    if (startError) return 'err:' + startError;
    if (!stored) return pending ? 'confirm' : 'pick';
    if (!job) return 'wait';
    if (job.status === 'recognizing' || (job.status === 'generating' && performance.now() - recogAt < RECOG_HOLD)) return 'recog';
    if (job.status === 'generating') return 'gen';
    if (job.status === 'failed') return job.error.code === 'unknown-submit' ? 'held' : 'fail:' + job.error.code;
    return fetching() ? 'fetch' : refused() ? 'lost:refused' : 'done:' + job.itemId;
  }
  const STEP_OF = {pick: 0, confirm: 0, wait: 2, recog: 1, gen: 2, fetch: 2, fail: 2, held: 2, lost: 3, done: 3, err: 0};
  function paintSteps(key) {
    const kind = key.split(':')[0], at = STEP_OF[kind];
    el.steps.querySelectorAll('li').forEach((li, i) => {
      li.className = i < at ? 'done' : i === at ? (kind === 'fail' || kind === 'err' || kind === 'lost' ? 'now bad' : kind === 'held' ? 'now hold' : 'now') : '';
    });
  }
  // Shown only once the backend enforces a limit; this round it reports null (Elara 71be6494).
  function paintQuota() { el.quota.textContent = quota?.remaining != null ? `今天还能拍 ${quota.remaining} 件` : ''; }
  const photo = () => stored?.photo ?? pending?.thumb ?? '';
  const frame = (cls, inner) => `<div class="sframe ${cls}">${photo() ? `<img src="${esc(photo())}" alt="你拍的照片">` : ''}${inner}</div>`;
  const foot = (...btns) => `<div class="sfoot">${btns.join('')}</div>`;
  const ghost = (act, label, icon = '') => `<button type="button" class="sghost" data-act="${act}">${icon}<span>${label}</span></button>`;
  const go = (act, label, sub = '') => `<button type="button" class="go" data-act="${act}"><span>${label}</span>${sub ? `<small>${sub}</small>` : ICON.arrow}</button>`;

  function draw(key) {
    const [kind, code] = key.split(':');
    let html = '';
    if (kind === 'pick') {
      html = `<div class="sframe pick"><span class="sview">${ICON.camera}<b>拍一件身边的东西</b><small>一件东西、拍全、背景干净</small></span></div>
        <div class="ssix"><span>会认成这六类之一，不在里面的按形状最像的算</span><div>${Object.values(CAT).map(c => `<i>${c}</i>`).join('')}</div></div>
        ${foot(ghost('album', '从相册选', ICON.album), go('camera', '拍照'))}`;
    } else if (kind === 'confirm') {
      html = `${frame('', '')}<p class="snote">生成要 1–2 分钟，等的时候可以先去打一局</p><p class="serr" data-live="send"></p>
        ${foot(ghost('retake', '重拍', ICON.retry), go('submit', '用这张，开始'))}`;
    } else if (kind === 'wait') {
      html = `${frame('scan', '<i class="sline"></i>')}<p class="snote" data-live="warn">正在找回这一件…</p>`;
    } else if (kind === 'fetch') {
      html = `${frame('gen', '<i class="ssweep"></i>')}<p class="snote">生成好了，正在取回…</p><p class="snote warn" data-live="warn" hidden></p>
        ${foot(ghost('lib', '回角色库'))}`;
    } else if (kind === 'recog') {
      html = `${frame('scan', '<i class="sline"></i><span class="stag" data-live="rtag">认物中</span>')}
        <div class="srec"><span class="lbl">认出来是</span><b class="stamp" data-live="as"></b>
        <p class="sfine">认物由看图模型定，不能改，免得专挑强的</p>${api.kind === 'fake' ? '<p class="sfine fake">现在是假生成：拍什么都会随机给一类</p>' : ''}</div>
        <div class="sfoot"><p class="snext"><i class="spin"></i><span data-live="next">正在认是什么，几秒就好</span></p></div>`;
    } else if (kind === 'gen') {
      html = `${frame('gen', `<i class="ssweep"></i><span class="scat">${esc(countAs(job.recognition))}</span><span class="snow" data-live="now"></span>`)}
        <div class="seta"><b data-live="eta"></b><small>好了会在顶部提醒你</small></div>
        <div class="sbar"><i data-live="bar"></i></div>
        <ol class="hsteps sgsteps">${STEPS.map((st, i) => `<li data-step="${st.key}"><span class="n">${i + 1}</span><b>${st.name}</b><span class="sec"></span></li>`).join('')}</ol>
        <p class="snote warn" data-live="warn" hidden></p>
        ${foot(go('play', '先去打一局'))}`;
    } else if (kind === 'fail' || kind === 'err' || kind === 'lost') {
      const retry = kind === 'fail' ? job.error.retry : 'none';
      const btns = code === 'pass' ? [go('pass', '确定')]
        : retry === 'same' ? [ghost('lib', '回角色库'), go('retry', '再试', '不算次数')]
        : retry === 'resubmit' ? [ghost('lib', '回角色库'), go('resubmit', '再提交', '这次没算')]
        : retry === 'regenerate' ? [ghost('lib', '回角色库'), go('regen', '重新生成', '会多算一次')]
        : ['photo-invalid', 'photo-unclear', 'key-conflict', 'refused'].includes(code) ? [ghost('lib', '回角色库'), go('fresh', '换一张拍')]
        : code === 'server' && lastSend ? [ghost('lib', '回角色库'), go('again', '再试')]
        : code === 'not-allowed' && stored ? [ghost('lib', '回角色库'), go('refresh', '刷新')]
        : [ghost('lib', '回角色库')];
      html = `${frame('bad', `<span class="sbadge">${kind === 'lost' ? '装不进游戏' : MISMATCH.includes(code) ? '连错了后台' : '没生成出来'}</span>`)}
        <div class="smsg"><b>${esc(SAY[code] ?? SAY.server)}</b>${code === 'pass' ? '<input type="password" class="spass" id="shootPass" placeholder="输入口令" autocomplete="current-password">' : ''}</div>
        <p class="serr" data-live="send"></p>${foot(...btns)}`;
    } else if (kind === 'held') {
      // unknown-submit (Elara 8d32a2a6, 69a1c60d): one sentence and only 回角色库, no retake or retry: the paid
      // submission is being checked. It doesn't hold the one-at-a-time place, so 拍一件 starts a new photo.
      html = `${frame('held', `<span class="sbadge">${ICON.wait}核实中</span>`)}<div class="smsg held"><b>这件还在核实，不会多扣</b></div>${foot(ghost('lib', '回角色库'))}`;
    } else if (kind === 'done') {
      const id = code, r = ctx.grade(id), it = ctx.item(id), eq = ctx.equipLabel(id);
      const line = [MATERIAL[it.material], ctx.spec(id), WEAR[it.condition]].filter(Boolean).join(' · ');
      const end = Math.max(...job.steps.map(s => ms(s.endedAt) ?? 0)), took = end ? (end - ms(job.createdAt)) / 1000 : null;
      html = `<h2 class="shead">做好了</h2><div class="spair"><figure><span class="pane"><img src="${esc(photo())}" alt=""></span><figcaption>你拍的</figcaption></figure>
          <figure><span class="pane"><canvas class="turn" data-live="turn"></canvas></span><figcaption>生成的 3D</figcaption></figure></div>
        <div class="sstage"><div class="card sreveal${r ? ' grade' + r.grade : ''}" data-item="${esc(id)}">
          ${r ? `<i class="big g${r.grade}">${r.grade}</i>` : ''}
          <div class="sname"><span class="nm"><b>${esc(ctx.name(id))}</b><span class="cat">${esc(CAT[it.category] ?? it.category ?? '')}</span></span><small>${esc(line)}</small></div>
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
    if (canvas.isConnected) ctx.turns.show(canvas, id, {zoom: 1.3});
  }
  // The parts of a screen that move: 认物's result, 生成中's steps, times and bar, the connection and slow notices.
  function update() {
    const live = n => el.body.querySelector(`[data-live="${n}"]`);
    if (shown === 'recog' && job.recognition) {
      const as = live('as');
      if (!as.textContent) { as.textContent = countAs(job.recognition); live('rtag').textContent = '认好了'; live('next').textContent = '认好了，马上开始生成'; el.body.querySelector('.sframe').classList.add('got'); }
    }
    if (shown === 'wait' || shown === 'gen' || shown === 'fetch') {
      const warn = live('warn'), fails = shown === 'fetch' ? itemFails : pollFails;
      const text = offline ? '连不上，自动重连中' : fails >= DOWN_AFTER ? SAY['server-down'] : fails ? '后台没回话，过一会儿再查'
        : shown === 'fetch' ? '' : busyNote || (job && elapsed() > SLOW ? '比平时慢，再等等' : '');
      if (shown === 'wait') { if (text) warn.textContent = text; } else { warn.hidden = !text; warn.textContent = text; }
    }
    if (shown !== 'gen' || !job) return;
    const left = remaining(), now = STEPS.findIndex(st => !job.steps.find(x => x.key === st.key)?.endedAt);
    live('eta').innerHTML = elapsed() > SLOW || left <= 0 ? '快好了' : `预计还要 <em>${about(left)}</em>`;
    live('bar').style.setProperty('--fill', fraction());
    live('now').textContent = now >= 0 ? `第 ${now + 1} 步 · ${STEPS[now].name}` : '';
    for (const li of el.body.querySelectorAll('[data-step]')) {
      const i = STEPS.findIndex(st => st.key === li.dataset.step), s = job.steps.find(x => x.key === li.dataset.step), sec = li.querySelector('.sec');
      const state = s?.endedAt ? 'done' : s?.startedAt ? 'now' : '';
      if (li.className !== state) li.className = state;
      sec.innerHTML = state === 'done' ? dur((ms(s.endedAt) - ms(s.startedAt)) / 1000) : state === 'now' ? '<i class="spin"></i>进行中'
        : (t => t === '几秒' ? t : '约 ' + t)(about(STEPS[i].share * (job.estimateSeconds ?? 90) * 0.95));
      li.querySelector('.n').innerHTML = state === 'done' ? ICON.check : String(i + 1);
    }
  }
  function sync() {
    paintTag();
    ctx.onChange?.();
    if (el.view.hidden) return;
    const key = screen();
    if (key !== shown) { shown = key; draw(key); paintSteps(key); }
    // A failure the player has now seen no longer calls them back from the top tag.
    if (/^(fail|held|lost)/.test(key) && stored && !stored.seen) { stored.seen = true; keep(); }
    update();
  }

  // ---------- the tag at the top of the build and result screens ----------
  function paintTag() {
    const room = ctx.tagRoom(), state = !stored || !job ? null : fetching() ? 'run' : refused() ? (stored.seen ? null : 'bad') : job.status === 'succeeded' ? (stored.seen ? null : 'done')
      : job.status === 'failed' ? (stored.seen ? null : 'bad') : 'run';
    el.tag.hidden = !room || !el.view.hidden || !state;
    if (el.tag.hidden) return;
    el.tag.className = state;
    const what = catOf(job.recognition);
    const html = state === 'done' ? `<b>${what}生成好了，去装上</b>${ICON.arrow}`
      : state === 'bad' ? `<b>${refused() ? '这件装不进游戏，去看看' : job.error.code === 'unknown-submit' ? '这件还在核实' : '这件没生成出来，去看看'}</b>${ICON.arrow}`
      : fetching() ? `<i class="ring" style="--fill:1"></i><b>${what}生成好了</b><small>正在取回</small>`
      : `<i class="ring" style="--fill:${fraction().toFixed(2)}"></i><b>${job.recognition ? what : '新的一件'}生成中</b><small>${remaining() > 0 && elapsed() < SLOW ? '还要 ' + about(remaining()) : '快好了'}</small>`;
    if (el.tag.innerHTML !== html) el.tag.innerHTML = html;
  }
  el.tag.onclick = () => open('tag');

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
      recogAt = j.recognition ? -Infinity : 0;
      loadQuota();
      sync();
      poll();
    } catch (e) {
      if (btn) btn.disabled = false;
      if (e.code === 'offline') { if (note) note.textContent = '没传上去，网络好了再点一次'; return; }
      if (e.code === 'active-job') { await adopt(e.activeJobId); return; }
      if (job && final(job) && e.code === 'quota') { if (note) note.textContent = SAY.quota; return; }
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
  function fresh() { startError = null; pending = null; job = null; stored = null; busyNote = ''; lastSend = null; sendFails = 0; keep(); sync(); }
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
    equip: () => { const id = job.itemId; close(); ctx.equip(id); }
  };
  el.body.onclick = e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) acts[b.dataset.act]?.(); };

  // ---------- open / close ----------
  function open(from) {
    el.backText.textContent = from === 'library' ? '角色库' : '返回';
    // One job at a time: while one runs, 拍一件 shows it (Elara f63778f3).
    busyNote = from === 'library' && stored && job && !final(job) ? '上一件还在做，做完才能拍下一件' : '';
    // A finished job seen already, or one that can't go on, gives way to a new photo.
    if (from === 'library' && stored && job && final(job) && !stored.hold && (stored.seen || job.error?.retry === 'none' || refused())) { stored = null; job = null; keep(); }
    // Back from the 角色库 a while later: a server error may be sent again three more times.
    if (from === 'library' && startError) { startError = null; sendFails = 0; }
    shown = '';
    el.view.hidden = false;
    loadQuota();
    sync();
    clearInterval(ticker);
    ticker = setInterval(() => { if (el.view.hidden) clearInterval(ticker); else sync(); }, 250);
    poll();
  }
  function close() { el.view.hidden = true; el.ask.hidden = true; clearInterval(ticker); sync(); }
  el.back.onclick = close;
  if (stored) poll();
  return {
    open, close, paintTag,
    // made: 好了 and the item is in this page's catalog (the 拍一件 button's 新 mark waits for it, not for the backend).
    get state() { return {stored, job, screen: el.view.hidden ? null : screen(), offline, made: job?.status === 'succeeded' && !!ctx.item(job.itemId)}; }
  };
}
