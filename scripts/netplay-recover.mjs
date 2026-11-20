// 好友对撞's recovery check (Elara db4ed438 ① ②): two browsers in one room through the room service, and the ways a phone
// drops out — its page reloaded mid-fight (the guest's, then the host's), and its connection lost just as it says 准备,
// as its 3D is in, as it sends the result and as it presses 再来一局. Each match must still be played out, the same on
// both phones, and the next one start.
//
//   PORT=7871 NETPLAY_WEB_ROOT=$PWD/web/dist-judge-position node tools/netplay/main.mjs &
//   node scripts/netplay-recover.mjs http://127.0.0.1:7871
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {chromium} from '../web/node_modules/playwright/index.mjs';
import {WebSocketServer, WebSocket} from '../tools/netplay/node_modules/ws/wrapper.mjs';

const [upstream = 'http://127.0.0.1:7871'] = process.argv.slice(2);
const up = new URL(upstream);

// ---- the line between: passed on as it is, except that a phone's socket can be cut as one of its messages goes ----
const cut = {seat: null, what: null, done: 0};  // cut that seat's socket as it sends {t: what}, the message lost with it
const server = createServer((req, res) => {
  const out = request({host: up.hostname, port: up.port, path: req.url, method: req.method, headers: {...req.headers, host: up.host, ...(req.headers.origin && {origin: up.origin})}}, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  out.on('error', () => res.writeHead(502).end());
  req.pipe(out);
});
const wss = new WebSocketServer({noServer: true});
server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, client => {
  const far = new WebSocket(`ws://${up.host}${req.url}`, {headers: {origin: up.origin}});
  let seat = null;
  const early = [];
  const toFar = d => {
    const text = d.toString();
    if (cut.what && seat === cut.seat && text.includes(`"t":"${cut.what}"`)) { cut.what = null; cut.done++; client.terminate(); far.close(); return; }
    far.send(text);
  };
  far.on('open', () => { for (const d of early.splice(0)) toFar(d); });
  client.on('message', d => far.readyState === WebSocket.OPEN ? toFar(d) : early.push(d));
  far.on('message', d => { const text = d.toString(); const m = /"t":"session".*"seat":(\d)/.exec(text); if (m) seat = Number(m[1]); if (client.readyState === WebSocket.OPEN) client.send(text); });
  client.on('close', () => far.close());
  far.on('close', () => client.close());
  far.on('error', () => client.close());
}));
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({headless: true, args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']});
const phone = async name => {
  const context = await browser.newContext({viewport: {width: 390, height: 780}, hasTouch: true, isMobile: true});
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  // Phones that have had their 木桩 (好友初见): 准备 goes straight to the room.
  await page.addInitScript(() => localStorage.setItem('wanwu-netplay-warm-seen', '1'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|shoot/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { delete window.RTCPeerConnection; });
  return {page, errors, name};
};
const a = await phone('host'), b = await phone('guest');
const status = p => p.page.evaluate(() => window.__top?.status());
const until = (p, fn, arg, timeout = 60000) => p.page.waitForFunction(fn, arg, {timeout});
const inPhase = (p, ...phases) => until(p, ph => ph.includes(window.__top?.status().phase), phases);
const room = (p, ...phases) => until(p, ph => ph.includes(window.__top?.status().net?.room), phases);
const bot = p => p.page.evaluate(() => {
  clearInterval(window.__duelBot);
  window.__duelBot = setInterval(() => { if (window.__top.status().phase === 'play' && Math.random() < 0.3) window.__top.press(Math.random() < 0.6 ? 'dash' : 'block'); }, 120);
});
const ready = async p => {
  await until(p, () => { const s = window.__top?.status(); return s?.phase === 'build' && s.net?.room === 'loadout' && !document.querySelector('#goBtn').disabled; });
  await p.page.locator('#goBtn').click();
};
const replayHash = p => p.page.evaluate(() => { const j = window.__top.replayJson(); let h = 0x811c9dc5; for (let i = 0; i < j.length; i++) h = Math.imul(h ^ j.charCodeAt(i), 0x01000193); return {len: j.length, h: h >>> 0}; });
const rows = [];
const fail = async e => {
  console.error(String(e).split('\n')[0]);
  for (const p of [a, b]) console.error(p.name, JSON.stringify(await status(p).catch(() => null), (k, v) => ['mine', 'foeBuild', 'meta', 'decisive', 'teach', 'feel'].includes(k) ? undefined : v), await p.page.evaluate(() => [document.querySelector('#netSay')?.textContent, document.querySelector('#busyText')?.textContent, document.querySelector('#foeLabel')?.textContent, document.querySelector('#goBtn')?.textContent, document.querySelector("#whyLine")?.textContent, (b => b && [b.disabled, b.textContent, b.getBoundingClientRect().height, getComputedStyle(b).visibility, document.querySelector("#result").hidden, getComputedStyle(document.querySelector("#result")).opacity])(document.querySelector("#againBtn")), document.elementFromPoint(195, 600)?.id]).catch(() => null), p.errors.slice(0, 5));
  process.exit(1);
};

// One match: `before` runs as the match is being set up, `during` once it has fought a few seconds.
async function match(name, {cutAt = null, reload = null}) {
  const t0 = Date.now();
  if (cutAt && ['ready', 'assetsReady'].includes(cutAt.what)) Object.assign(cut, cutAt);
  await ready(a); await ready(b);
  await Promise.all([a, b].map(p => inPhase(p, 'play')));
  await Promise.all([a, b].map(bot));
  if (reload) {
    await new Promise(ok => setTimeout(ok, 3000));
    const p = reload === 'host' ? a : b, before = await status(p);
    await p.page.reload();
    await inPhase(p, 'play');
    const after = await status(p);
    assert.equal(after.net.matchId, before.net.matchId, `${reload}: back in the same match`);
    await bot(p);
  }
  if (cutAt?.what === 'result') Object.assign(cut, cutAt);
  await Promise.all([a, b].map(p => inPhase(p, 'finale', 'result', 'replay')));
  await Promise.all([a, b].map(p => room(p, 'finished')));
  const [sa, sb] = await Promise.all([a, b].map(status));
  const [ra, rb] = await Promise.all([a, b].map(replayHash));
  const row = {name, same: ra.len === rb.len && ra.h === rb.h, winner: sa.meta.winner, reason: sa.meta.reason, cuts: cut.done, desync: [sa.net.desync, sb.net.desync], bad: [sa.net.stats.bad, sb.net.stats.bad], s: Math.round((Date.now() - t0) / 1000)};
  rows.push(row);
  console.log(JSON.stringify(row));
  assert.ok(row.same, 'the same match on both phones');
  assert.deepEqual(row.desync, [null, null]);
  if (cutAt) assert.equal(cut.done, cuts + 1, `the cut at ${cutAt.what} happened`);
  cuts = cut.done;
}
let cuts = 0;
const again = async cutAt => {
  for (const p of [a, b]) await inPhase(p, 'result');
  if (cutAt) Object.assign(cut, cutAt);
  for (const p of [a, b]) await p.page.locator('#againBtn').click();
  if (cutAt) { await room(a, 'loadout'); assert.equal(cut.done, cuts + 1, `the cut at ${cutAt.what} happened`); cuts = cut.done; }
};

try {
  await a.page.goto(origin + '/?shoot=off');
  await a.page.locator('#introFriend').click({timeout: 20000});
  await a.page.locator('#netCreate').click();
  const code = await (await a.page.waitForFunction(() => document.querySelector('#netRoomCode')?.textContent || null)).jsonValue();
  await b.page.goto(origin + `/?shoot=off&room=${code}`);
  await match('guest reloads mid-fight', {reload: 'guest'});
  await again();
  await match('host reloads mid-fight', {reload: 'host'});
  await again();
  await match('guest cut as it says 准备', {cutAt: {seat: 1, what: 'ready'}});
  await again();
  await match('host cut as its 3D is in', {cutAt: {seat: 0, what: 'assetsReady'}});
  await again();
  await match('guest cut as it sends the result', {cutAt: {seat: 1, what: 'result'}});
  await again({seat: 0, what: 'rematch'});
  await match('after the host was cut at 再来一局', {});
} catch (e) { await fail(e); }
console.log(JSON.stringify({all: rows.length, same: rows.every(r => r.same), cuts: cut.done, errors: [...a.errors, ...b.errors].slice(0, 5)}));
await browser.close();
server.close();
process.exit(0);
