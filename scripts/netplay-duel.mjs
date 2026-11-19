// 好友对撞's acceptance run (docs/netplay-spec.md 验收 1 and 2): two browsers, each pressing at random, play whole matches
// through the room service (tools/netplay) with the network made slow and lossy in between, and report per match whether
// both worked out the same match, and the feel numbers.
//
//   PORT=7871 NETPLAY_WEB_ROOT=$PWD/web/dist-judge-position node tools/netplay/main.mjs &
//   node scripts/netplay-duel.mjs http://127.0.0.1:7871 [rtt ms] [loss 0..1] [matches] [chromium|webkit] [cpu slowdown]
//
// The presses go by the room service here (no WebRTC), through a proxy that holds every message RTT/4 each way (so two
// hops, phone to phone, are RTT/2) and drops `loss` of the presses; the room's own messages are never dropped.
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {chromium, webkit} from '../web/node_modules/playwright/index.mjs';
import {WebSocketServer, WebSocket} from '../tools/netplay/node_modules/ws/wrapper.mjs';

const [upstream = 'http://127.0.0.1:7871', rttArg = '0', lossArg = '0', matchesArg = '1', guestArg = 'chromium', cpuArg = '1'] = process.argv.slice(2);
const rtt = Number(rttArg), loss = Number(lossArg), matches = Number(matchesArg), cpu = Number(cpuArg);
const up = new URL(upstream);

// ---- the slow network: HTTP passed on as it is, the room's socket held and thinned ----
const hold = rtt / 4;
const server = createServer((req, res) => {
  const out = request({host: up.hostname, port: up.port, path: req.url, method: req.method, headers: {...req.headers, host: up.host, ...(req.headers.origin && {origin: up.origin})}}, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  out.on('error', () => res.writeHead(502).end());
  req.pipe(out);
});
const wss = new WebSocketServer({noServer: true});
let dropped = 0, carried = 0;
server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, client => {
  // As if the page were on the room service's own address (it checks where a socket comes from).
  const far = new WebSocket(`ws://${up.host}${req.url}`, {headers: {origin: up.origin}});
  const queue = {toFar: [], toClient: []};
  // In order, each RTT/4 (± a little) after it came, as a TCP line would; a press message may be lost on the way.
  const pass = (data, to, q) => {
    const text = data.toString();
    if (loss > 0 && /"t":"relay"/.test(text) && Math.random() < loss) { dropped++; return; }
    if (/"t":"relay"/.test(text)) carried++;
    const at = Math.max(q.due ?? 0, Date.now() + hold + (hold ? (Math.random() - 0.5) * hold * 0.4 : 0));
    q.due = at;
    setTimeout(() => { if (to.readyState === WebSocket.OPEN) to.send(text); }, at - Date.now());
  };
  const early = [];
  far.on('open', () => { for (const d of early.splice(0)) pass(d, far, queue.toFar); });
  client.on('message', d => far.readyState === WebSocket.OPEN ? pass(d, far, queue.toFar) : early.push(d));
  far.on('message', d => pass(d, client, queue.toClient));
  client.on('close', () => far.close());
  far.on('close', () => client.close());
  far.on('error', () => client.close());
}));
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---- two phones ----
const launch = kind => (kind === 'webkit' ? webkit : chromium).launch({headless: true, ...(kind === 'webkit' ? {} : {args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']})});
const hostBrowser = await launch('chromium'), guestBrowser = guestArg === 'webkit' ? await launch('webkit') : hostBrowser;
const phone = async (browser, name) => {
  const context = await browser.newContext({viewport: {width: 390, height: 780}, hasTouch: true, isMobile: browser.browserType().name() !== 'webkit' ? true : undefined});
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|shoot/i.test(m.text())) errors.push(m.text()); });
  // The presses by the room service only, as when the two phones are not on one Wi-Fi.
  await page.addInitScript(() => { delete window.RTCPeerConnection; });
  return {page, errors, name, context};
};
const a = await phone(hostBrowser, 'host'), b = await phone(guestBrowser, 'guest');
if (cpu > 1 && guestArg !== 'webkit') {
  const cdp = await b.context.newCDPSession(b.page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: cpu});
}
const status = p => p.page.evaluate(() => window.__top?.status());
const waitPhase = (p, ...phases) => p.page.waitForFunction(ph => ph.includes(window.__top?.status().phase), phases, {timeout: 120000});

await a.page.goto(origin + '/?shoot=off');
await a.page.locator('#introFriend').click({timeout: 20000}).catch(async e => { console.error(JSON.stringify({errors: a.errors, health: await a.page.evaluate(() => fetch('/api/netplay/health').then(r => r.status + ' ' + r.headers.get('content-type')).catch(e => String(e)))})); throw e; });
await a.page.locator('#netCreate').click();
const code = await (await a.page.waitForFunction(() => document.querySelector('#netRoomCode')?.textContent || null)).jsonValue();
await b.page.goto(origin + `/?shoot=off&room=${code}`);
// Each phone presses at random through the fight, as two people would (60 % 冲).
const bot = p => p.page.evaluate(() => {
  clearInterval(window.__duelBot);
  // Frames a second while it fights, and the longest frame (a phone that can't keep up is what makes the other wait).
  if (!window.__fps) { window.__fps = {n: 0, t0: performance.now(), last: performance.now(), worst: 0}; const f = () => { const now = performance.now(), x = window.__fps; x.worst = Math.max(x.worst, now - x.last); x.last = now; x.n++; requestAnimationFrame(f); }; requestAnimationFrame(f); }
  window.__duelBot = setInterval(() => { if (window.__top.status().phase === 'play' && Math.random() < 0.3) window.__top.press(Math.random() < 0.6 ? 'dash' : 'block'); }, 120);
});
const rows = [];
const dump = async e => {
  console.error(String(e).split('\n')[0]);
  for (const p of [a, b]) console.error(p.name, JSON.stringify(await status(p).catch(() => null), (k, v) => ['mine', 'foeBuild', 'meta', 'decisive', 'teach'].includes(k) ? undefined : v), await p.page.evaluate(() => [document.querySelector('#netSay')?.textContent, document.querySelector('#busyText')?.textContent, document.querySelector('#foeLabel')?.textContent, document.querySelector('#goBtn')?.textContent]).catch(() => null), p.errors.slice(0, 5));
  process.exit(1);
};
try { for (let n = 0; n < matches; n++) {
  for (const p of [a, b]) {
    await p.page.waitForFunction(() => { const s = window.__top?.status(); return s?.phase === 'build' && s.net?.room === 'loadout' && !document.querySelector('#goBtn').disabled; }, null, {timeout: 60000});
    await p.page.locator('#goBtn').click();
  }
  await Promise.all([a, b].map(p => waitPhase(p, 'play')));
  await Promise.all([a, b].map(bot));
  await Promise.all([a, b].map(p => waitPhase(p, 'finale', 'result', 'replay')));
  // Settled by the room: both phones sent the same winner and check.
  await Promise.all([a, b].map(p => p.page.waitForFunction(() => window.__top.status().net?.room === 'finished', null, {timeout: 30000})));
  const [sa, sb] = await Promise.all([a, b].map(status));
  const [ra, rb] = await Promise.all([a, b].map(p => p.page.evaluate(() => { const j = window.__top.replayJson(); let h = 0x811c9dc5; for (let i = 0; i < j.length; i++) h = Math.imul(h ^ j.charCodeAt(i), 0x01000193); return {len: j.length, h: h >>> 0}; })));
  const same = ra.len === rb.len && ra.h === rb.h;
  const [fa, fb] = await Promise.all([a, b].map(p => p.page.evaluate(() => { const x = window.__fps; return {fps: +(x.n / ((performance.now() - x.t0) / 1000)).toFixed(1), worstMs: Math.round(x.worst)}; })));
  rows.push({match: n + 1, same, winner: sa.meta.winner, duration: +sa.meta.duration.toFixed(2), reason: sa.meta.reason, host: {...sa.net, feel: sa.feel, frames: fa}, guest: {...sb.net, feel: sb.feel, frames: fb}});
  console.log(JSON.stringify(rows.at(-1)));
  assert.equal(sa.net.desync, null, 'host saw no desync');
  assert.equal(sb.net.desync, null, 'guest saw no desync');
  if (n + 1 < matches) {
    for (const p of [a, b]) {
      await waitPhase(p, 'result');
      await p.page.locator('#againBtn').click();
    }
  }
} } catch (e) { await dump(e); }
const all = rows.flatMap(r => [r.host, r.guest]);
const flat = k => all.flatMap(x => x.feel[k]);
const pct = (xs, q) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const shown = flat('windups').map(w => w.shown), sim = flat('windups').map(w => w.sim);
console.log(JSON.stringify({rtt, loss, guest: guestArg, cpu, matches, allSame: rows.every(r => r.same), carried, dropped,
  reactionMs: {median: pct(flat('reactions'), 0.5), p95: pct(flat('reactions'), 0.95), n: flat('reactions').length},
  windupShownMs: {median: pct(shown, 0.5), min: pct(shown, 0), n: shown.length}, windupSimMs: pct(sim, 0.5),
  rollbacksPerMatch: +(all.reduce((x, y) => x + y.stats.rollbacks, 0) / all.length).toFixed(1), maxDepth: Math.max(...all.map(x => x.stats.maxDepth)),
  slowestResimMs: +Math.max(...all.map(x => x.stats.slowestMs)).toFixed(1), resimMs: {p95: pct(all.flatMap(x => x.stats.resimMs), 0.95), n: all.flatMap(x => x.stats.resimMs).length, over16: all.flatMap(x => x.stats.resimMs).filter(x => x > 16)}, seenRollbacks: all.reduce((x, y) => x + y.seenRollbacks, 0), seenMaxSteps: Math.max(...all.map(x => x.seenMaxSteps)),
  stalls: all.reduce((x, y) => x + y.stats.stalls, 0), fps: {host: rows.map(r => r.host.frames), guest: rows.map(r => r.guest.frames)}, errors: [...a.errors, ...b.errors].slice(0, 5)}));
await hostBrowser.close();
if (guestBrowser !== hostBrowser) await guestBrowser.close();
server.close();
process.exit(0);
