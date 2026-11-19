// 好友对撞's desync check (Castor e34c1871, Elara 64235b6a): two browsers in one room through the real room service, one
// phone's checks made wrong mid-fight (window.__top.netSkew, its report padded past the room's size limit). Both phones
// must say 这局不算 (one that sees it at once, not waiting for the room), the room must end the match as a desync and
// keep both phones' reports as objects in its trace directory. Then, on the 结算: the guest's 再来一局 shows on the
// host's as 对面想再来一局, and the host's 回首页 turns the guest's key into 对面已离开 · 回首页.
//
//   NETPLAY_TRACE_DIR=<empty dir> PORT=7873 NETPLAY_WEB_ROOT=$PWD/web/dist-netplay-<sha> node tools/netplay/main.mjs &
//   node scripts/netplay-desync.mjs http://127.0.0.1:7873 <that dir> [screenshot dir]
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';

const [origin = 'http://127.0.0.1:7873', traceDir, shots = null] = process.argv.slice(2);
assert.ok(traceDir, 'the room service\'s NETPLAY_TRACE_DIR is the second argument');
assert.equal(readdirSync(traceDir).length, 0, 'the trace directory starts empty');

const browser = await chromium.launch({headless: true, args: ['--no-proxy-server', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']});
const phone = async name => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true});
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|shoot/i.test(m.text())) errors.push(m.text()); });
  return {page, errors, name};
};
const a = await phone('host'), b = await phone('guest');
const until = (p, fn, arg, timeout = 60000) => p.page.waitForFunction(fn, arg, {timeout});
const shot = (p, name) => shots && p.page.screenshot({path: join(shots, `${name}.png`)});
const card = p => p.page.evaluate(() => ({winner: document.querySelector('#winnerLine').textContent, why: document.querySelector('#whyLine').textContent,
  key: document.querySelector('#againBtn').textContent, disabled: document.querySelector('#againBtn').disabled,
  tip: document.querySelector('#tipLine').hidden ? null : document.querySelector('#tipLine').textContent, room: window.__top.status().net?.room,
  me: +getComputedStyle(document.querySelector('#fx .me')).opacity}));

await a.page.goto(origin + '/?shoot=off');
await a.page.locator('#introFriend').tap();
await a.page.locator('#netCreate').tap();
const code = await (await a.page.waitForFunction(() => document.querySelector('#netRoomCode')?.textContent || null)).jsonValue();
await b.page.goto(origin + `/?shoot=off&room=${code}`);
for (const p of [a, b]) {
  await until(p, () => { const s = window.__top?.status(); return s?.phase === 'build' && s.net?.room === 'loadout' && !document.querySelector('#goBtn').disabled; });
  await p.page.locator('#goBtn').tap();
}
await Promise.all([a, b].map(p => until(p, () => window.__top.status().phase === 'play')));
for (const p of [a, b]) await p.page.evaluate(() => { window.__bot = setInterval(() => { if (window.__top.status().phase === 'play' && Math.random() < 0.3) window.__top.press(Math.random() < 0.6 ? 'dash' : 'block'); }, 120); });
await a.page.waitForTimeout(1500);

// ---- the desync ----
const t0 = Date.now();
assert.ok(await a.page.evaluate(() => window.__top.netSkew(6000)), 'the host has a match to skew');
const shown = {};
await Promise.all([a, b].map(async p => {
  await until(p, () => window.__top.status().phase === 'result' && document.querySelector('#winnerLine').textContent === '这局不算', null, 20000);
  shown[p.name] = Date.now() - t0;
}));
await Promise.all([a, b].map(p => until(p, () => window.__top.status().net?.room === 'finished', null, 20000)));
await a.page.waitForTimeout(1200);
const [ca, cb] = await Promise.all([a, b].map(card));
await shot(a, 'desync-host'); await shot(b, 'desync-guest');
for (const c of [ca, cb]) { assert.equal(c.winner, '这局不算'); assert.match(c.why, /作废/); assert.equal(c.key, '再来一局'); assert.ok(c.me < 0.02, '「你」 is off the card'); }
const room = await a.page.evaluate(() => window.__top.status().net);

// The room's record of it: one file a phone (the one that saw it, and the one the room told), each an object.
await new Promise(ok => setTimeout(ok, 800));
const files = readdirSync(traceDir).filter(f => f.endsWith('.json'));
const traces = files.map(f => JSON.parse(readFileSync(join(traceDir, f), 'utf8')));
const host = traces.find(t => t.seat === 0);
assert.deepEqual(traces.map(t => t.seat).sort(), [0, 1], 'both phones\' reports are kept');
for (const t of traces) { assert.equal(typeof t.log, 'object'); assert.ok(Array.isArray(t.log.presses) && Array.isArray(t.log.hashes)); assert.ok(t.step >= 0); }
assert.ok(traces.some(t => t.log.desync?.step >= 0), 'the phone that saw it says where');
assert.ok(host.log.dropped.presses > 0, 'the padded report was cut to size, not refused');
assert.ok(Buffer.byteLength(JSON.stringify(host.log)) <= 46000);

// ---- the 结算 after it: the guest asks for another, then the host goes home ----
await b.page.locator('#againBtn').tap();
await until(a, () => !document.querySelector('#tipLine').hidden && document.querySelector('#tipLine').textContent === '对面想再来一局', null, 10000);
const voted = await card(a);
assert.ok(voted.me < 0.02);
await shot(a, 'rematch-asked-host');
await a.page.locator('#soloBtn').tap();
await until(b, () => document.querySelector('#againBtn').textContent === '对面已离开 · 回首页' && !document.querySelector('#againBtn').disabled, null, 10000);
const left = await card(b);
assert.ok(left.me < 0.02);
await shot(b, 'left-guest');
await b.page.locator('#againBtn').tap();
await until(b, () => !document.getElementById('intro')?.hidden, null, 10000);
const errors = [...a.errors, ...b.errors];
assert.deepEqual(errors, []);
console.log(JSON.stringify({shownMs: shown, room: {reason: room.reason ?? null, room: room.room}, card: {host: ca, guest: cb},
  traces: traces.map(t => ({file: files[traces.indexOf(t)], seat: t.seat, step: t.step, bytes: Buffer.byteLength(JSON.stringify(t.log)), presses: t.log.presses.length, dropped: t.log.dropped})),
  rematchAsked: voted.tip, afterLeave: {key: left.key, disabled: left.disabled}, guestHome: true}, null, 1));
await browser.close();
