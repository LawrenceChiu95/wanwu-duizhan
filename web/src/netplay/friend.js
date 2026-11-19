/**
 * 好友对撞's room (docs/netplay-spec.md 「玩家怎么玩」 1, 4, 5): open a room and show its code, QR and link, or come in by
 * one; then each phone fits its own top and says 准备, the room hands both builds to both, each checks them and fetches
 * the other's models, and both start on the room's clock. The fight itself is main.js's, over session.js.
 *
 * Only on an address that has the room service (/api/netplay/health answers): the 评委版 link has none and never shows it.
 */
import qrcode from '../vendor/qrcode.js';
import {itemSignature} from '../../../sim/runtime-items.js';
import {NetClient} from './client.js';
import {sha256Hex} from './sha256.js';

// What of an item the room hands the other phone, and hashes (tools/netplay/items.mjs `fields`, Sol #156).
export const ITEM_FIELDS = ['id', 'name', 'category', 'tag', 'condition', 'material', 'materialName',
  'scale', 'mass', 'volume', 'massBasis', 'generated', 'photoPhysics', 'outEnd',
  'bounds', 'hull', 'weakPoint', 'rating', 'stats', 'standardLongSide'];
export const shareable = item => Object.fromEntries(ITEM_FIELDS.filter(k => Object.hasOwn(item, k)).map(k => [k, item[k]]));

/** SHA-256 of itemSignature(value), lower-case hex, as the room service computes it (plain JS where there is no crypto.subtle). */
export async function digest(value) {
  const text = new TextEncoder().encode(itemSignature(value));
  if (!globalThis.crypto?.subtle) return sha256Hex(text);
  const bytes = await crypto.subtle.digest('SHA-256', text);
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The room this tab was in (sessionStorage): a reloaded page goes back into it. */
export const keptRoom = () => NetClient.kept();

export async function available() {
  try { const r = await fetch('/api/netplay/health', {cache: 'no-store'}); return r.ok && (await r.json())?.status === 'ok'; } catch { return false; }
}

/** This build, so the two phones play the same rules: the page's own script file is named by its contents. */
export function buildVersion() {
  const src = [...document.scripts].map(s => s.src).find(s => /\/assets\/index-[\w-]+\.js$/.test(s));
  return src ? src.match(/index-([\w-]+)\.js$/)[1].replace(/[^A-Za-z0-9_.-]/g, '') : 'dev';
}

const ROOM_HTML = `
  <header class="lhead"><button type="button" class="back" id="netBack"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>回首页</button><b>好友对撞</b><i></i></header>
  <div class="nbody">
    <div class="nstart" id="netStart">
      <p class="nlead">两台手机各拿一台，实时对撞</p>
      <button type="button" class="kgo" id="netCreate"><span>开个房间</span><small>给朋友扫码</small><b aria-hidden="true">→</b></button>
      <p class="nor"><span>或者</span></p>
      <form class="njoin" id="netJoin" autocomplete="off"><label for="netCode">输入朋友的房间号</label><div class="nrow"><input id="netCode" inputmode="latin" autocapitalize="characters" maxlength="6" placeholder="6 位" spellcheck="false"><button type="submit" class="nkey"><span>进房</span></button></div></form>
    </div>
    <div class="nhost" id="netHost" hidden>
      <p class="nlead">让朋友用手机扫这个码</p>
      <div class="nqr" id="netQr"></div>
      <p class="ncode"><small>房间号</small><b id="netRoomCode"></b></p>
      <button type="button" class="nkey" id="netCopy"><span>复制链接发给朋友</span></button>
      <p class="nlink" id="netLink" hidden><small>长按复制，发给朋友</small><a id="netLinkUrl"></a></p>
    </div>
    <p class="nsay" id="netSay" aria-live="polite"></p>
  </div>`;

/**
 * hooks: {version, onBench(state), onPrepare(state) → Promise (models in), onCountdown(state), onState(state, was),
 * onGame(d, via), onLink(kind), onHome(), onReload(state) → a Promise while it puts a match back after a reload, else
 * null}. Returns the room's controls.
 *
 * What this phone tells the room (准备, 模型到了, the result, 再来一局) is told again until the room's state says it has
 * it (seats[].ready, assetsReady, resultReady, rematchReady, Sol 1701f8e0): a message lost with the connection is made
 * up on the state the room sends when it is back.
 */
export function createFriend(app, hooks) {
  const box = document.createElement('section');
  box.id = 'netRoom';
  box.hidden = true;
  box.innerHTML = ROOM_HTML;
  app.append(box);
  const $ = id => box.querySelector(`#${id}`);
  const say = text => { $('netSay').textContent = text; };
  let client = null, phase = null, prepared = null, readySent = null, reloaded = false, restoring = false;
  // What this phone has told the room for the match it is on, to tell again if the room's state does not have it.
  let told = {};

  const link = code => `${location.origin}${location.pathname}?room=${code}`;
  function showHost(code) {
    $('netStart').hidden = true;
    $('netHost').hidden = false;
    $('netRoomCode').textContent = code;
    const qr = qrcode(0, 'M');
    qr.addData(link(code));
    qr.make();
    $('netQr').innerHTML = qr.createSvgTag({cellSize: 6, margin: 2, scalable: true});
    $('netLinkUrl').textContent = $('netLinkUrl').href = link(code);
    showLink(!canCopy());
  }
  // Only https (or this Mac itself) lets a page copy (Wren e1bda3fc: the LAN address is http): there the link is shown,
  // to long-press, instead of a 复制 key that can't (Elara 4a54464d).
  const canCopy = () => Boolean(globalThis.isSecureContext && navigator.clipboard?.writeText);
  function showLink(on) { $('netCopy').hidden = on; $('netLink').hidden = !on; }
  $('netCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(link(client?.code ?? '')); say('链接已复制，发给朋友'); } catch { showLink(true); }
  };
  // A tap picks the whole link (for the phone's own 拷贝), and never goes to it: this phone is in the room already.
  $('netLinkUrl').onclick = ev => { ev.preventDefault(); getSelection()?.selectAllChildren(ev.currentTarget); };
  $('netBack').onclick = () => { leave(); hooks.onHome(); };

  const ERRORS = {
    version: '两边版本不同，请都刷新一下', room: '没有这个房间，或者已经关了', full: '这个房间已经有两个人了',
    session: '房间连不上了，重新开一个吧', busy: '房间太多了，稍后再开', item: '有件东西对面拿不到，换一件再准备',
    'shoot-offline': '拍照服务暂时连不上，先用内置的件', parts: '这套装法不行，换一下再准备'
  };
  function connect(how) {
    client?.leave();
    client = new NetClient({version: hooks.version, on: {
      session: msg => { if (msg.seat === 0) showHost(msg.code); },
      state: (state, was) => onState(state, was),
      game: (d, via) => hooks.onGame(d, via),
      link: kind => hooks.onLink?.(kind),
      error: code => {
        say(ERRORS[code] ?? `出错了（${code}）`);
        if (['room', 'full', 'session', 'version'].includes(code) && phase !== 'playing') { $('netStart').hidden = false; $('netHost').hidden = true; }
        if (['item', 'shoot-offline', 'parts'].includes(code)) { readySent = null; told.ready = null; hooks.onReadyRefused?.(ERRORS[code]); }
      }
    }});
    how(client);
    return client;
  }

  async function onState(state, was) {
    const fresh = was?.matchId !== state.matchId;
    phase = state.phase;
    if (fresh) { prepared = null; readySent = null; told = {}; }
    const mine = client.seat, other = state.seats[1 - mine], me = state.seats[mine];
    // A reloaded page came back in with the room holding its seat away (resume active:false): a match it was in is put
    // back first (main.js), then it is here (presence), and the room plays on.
    if (reloaded) {
      reloaded = false;
      const back = hooks.onReload?.(state);
      if (back) {
        hooks.onState?.(state, was);
        restoring = true;
        try { await back; } finally { restoring = false; }
        if (client?.state) client.send({t: 'presence', active: document.visibilityState === 'visible'});
        return;
      }
      client.send({t: 'presence', active: document.visibilityState === 'visible'});
    }
    hooks.onState?.(state, was);
    if (me && state.matchId === told.matchId) {
      if (told.ready && state.phase === 'loadout' && !me.ready) client.send(told.ready);
      if (told.assets && state.phase === 'preparing' && !me.assetsReady) client.send(told.assets);
      if (told.result && ['playing', 'paused'].includes(state.phase) && !me.resultReady) client.send(told.result);
      if (told.rematch && state.phase === 'finished' && !me.rematchReady) client.send(told.rematch);
    }
    if (state.phase === 'waiting') {
      box.hidden = false;
      // The friend who came in by the link waits here for the room's maker (Sol #156: they can come in while it is away).
      if (mine === 1) { $('netStart').hidden = $('netHost').hidden = true; }
      say(mine === 1 && !state.seats[0]?.connected ? '等房主回来…' : other?.connected ? '' : '等朋友进来…');
      return;
    }
    // Past the waiting the room's page is gone (a reloaded page comes back in on it, whatever the room is at).
    box.hidden = true;
    if (state.phase === 'loadout') { hooks.onBench(state); return; }
    if (state.phase === 'preparing' && state.prepare && prepared !== state.matchId) {
      prepared = state.matchId;
      const ok = await hooks.onPrepare(state);
      if (ok && client.state?.matchId === state.matchId) tell('assets', {t: 'assetsReady', matchId: state.matchId, hash: state.prepare.hash});
      return;
    }
    if (state.phase === 'countdown' && (fresh || was?.phase !== 'countdown' || was.startAt !== state.startAt)) hooks.onCountdown(state);
  }

  function open(code) {
    box.hidden = false;
    $('netStart').hidden = false;
    $('netHost').hidden = true;
    say('');
    const kept = NetClient.kept();
    if (code && kept?.code === code) { reloaded = true; connect(c => c.resume(kept.code, kept.token, false)); }
    else if (code) { say('进房中…'); connect(c => c.join(code)); }
  }
  $('netCreate').onclick = () => { say('开房中…'); connect(c => c.create()); };
  $('netJoin').onsubmit = ev => {
    ev.preventDefault();
    const code = $('netCode').value.trim().toUpperCase();
    if (!/^[23456789A-HJ-NP-Z]{6}$/.test(code)) { say('房间号是 6 位字母和数字'); return; }
    say('进房中…');
    connect(c => c.join(code));
  };
  function leave() { client?.leave(); client = null; phase = null; told = {}; box.hidden = true; }
  function tell(what, msg) { told = {...told.matchId === msg.matchId ? told : {matchId: msg.matchId}, [what]: msg}; client.send(msg); }
  // Off the page (锁屏, 切走): the room pauses the fight for both; back, it carries on (工作包 5).
  document.addEventListener('visibilitychange', () => {
    if (!client?.state || reloaded || restoring || !['countdown', 'playing', 'paused'].includes(client.state.phase)) return;
    client.send({t: 'presence', active: document.visibilityState === 'visible'});
  });

  return {
    open, leave,
    get client() { return client; },
    get seat() { return client?.seat ?? null; },
    get state() { return client?.state ?? null; },
    /** 准备: my build to the room (parts as the sim takes them; a photo item's owner pass, only between me and the room). */
    ready(parts, shootSession) {
      const s = client?.state;
      if (!s || s.phase !== 'loadout' || readySent === s.matchId) return false;
      readySent = s.matchId;
      tell('ready', {t: 'ready', matchId: s.matchId, parts, ...(shootSession && {shootSession})});
      return true;
    },
    get readySent() { return readySent === client?.state?.matchId; },
    result(winner, hash) { const s = client?.state; if (s) tell('result', {t: 'result', matchId: s.matchId, winner, hash}); },
    desync(step, log) { const s = client?.state; if (s) client.send({t: 'desync', matchId: s.matchId, step, log}); },
    /** 再来一局: told now if the room has the match finished, else once it has (a phone that saw the desync first). */
    rematch() {
      const s = client?.state;
      if (!s) return;
      const msg = {t: 'rematch', matchId: s.matchId};
      if (s.phase === 'finished') tell('rematch', msg);
      else told = {...told.matchId === s.matchId ? told : {matchId: s.matchId}, rematch: msg};
    },
    /** The room this tab was in when its page was last loaded (a reload goes back into it). */
    kept: () => NetClient.kept(),
    game(d) { return client?.game(d); },
    serverNow() { return client?.serverNow() ?? Date.now(); },
    get rtt() { return client?.rtt ?? null; },
    get direct() { return Boolean(client?.direct); },
    say
  };
}
