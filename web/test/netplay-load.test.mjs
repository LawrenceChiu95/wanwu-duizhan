// 好友对撞 on a phone network (远夏 801288e4, Elara cd588352): the physics engine's file or a model cut off halfway.
// Two 390-wide phones in one room through the real room service (tools/netplay/server.mjs), on the 好友对撞 page itself.
//  - Cut off twice (the engine) and once (a model): the page asks again by itself; nothing is said, 准备 works, they play.
//  - Cut off every time: one line in Chinese, a 重新加载 key, and 准备 says under it why it can't be pressed.
//  - The other's photo item: its model short, then garbled, then whole: each fetched anew, never the bad copy kept
//    (Sol f0c274a3), and they play. The photo backend is a stand-in here.
//  - The bench's default for the other phone never comes to a friend from a link: the room is not opened, the page
//    says so with 重新加载 and throws nothing; with the network back, that key takes them into the room (Sol ad5547c5).
// NETPLAY_WEB=<built 好友对撞 page> checks that page (tools/netplay/stage.mjs runs this before a release); without it the
// page is built here first. NETPLAY_SHOTS=<dir> keeps a screenshot of each.
import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createNetplayServer} from '../../tools/netplay/server.mjs';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const shots = process.env.NETPLAY_SHOTS ?? null;
let root = process.env.NETPLAY_WEB, built = null, app, origin, browser, shootStub;

// The photo backend's stand-in: one photo item (the thermos, under a shoot_ id) for whoever holds TOKEN.
const PHOTO = 'shoot_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TOKEN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.' + 'a'.repeat(64);
const PHOTO_GLB = `/api/shoot/files/${PHOTO}/model.glb`, thermos = new URL('../../data/showcase/thermos/', import.meta.url);
const glbBytes = readFileSync(new URL('model.glb', thermos));
const photoItem = (({origin: _, ...it}) => ({...it, id: PHOTO, glb: PHOTO_GLB}))(JSON.parse(readFileSync(new URL('item.json', thermos), 'utf8')));
const stub = () => http.createServer((req, res) => {
  const send = v => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
  if (req.url === '/api/shoot/session' && req.method === 'POST') return send({token: TOKEN});
  if (req.headers['x-shoot-session'] !== TOKEN) return res.writeHead(401, {'content-type': 'application/json'}).end('{"error":{"code":"session"}}');
  if (req.url === '/api/shoot/quota') return send({provider: 'real', limit: 10, remaining: 10, resetsAt: Date.now() + 3600e3,
    recognition: {limit: 20, remaining: 20}, global: {limit: null, remaining: null, recognition: {limit: 400, remaining: 400}}});
  if (req.url === '/api/shoot/items') return send({items: [photoItem]});
  if (req.url === PHOTO_GLB) { res.setHeader('content-type', 'model/gltf-binary'); return res.end(glbBytes); }
  res.writeHead(404).end();
});

const freePort = () => new Promise((ok, fail) => {
  const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => ok(port)); });
});

before(async () => {
  if (!root) {
    root = built = join(mkdtempSync(join(tmpdir(), 'wanwu-netplay-load-')), 'web');
    const env = {...process.env, WANWU_NETPLAY: '1', WANWU_COMBAT: 'position'};
    execFileSync(process.execPath, [join(webDir, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'judge', '--outDir', root, '--emptyOutDir', '--logLevel', 'error'], {cwd: webDir, env, stdio: 'inherit'});
    execFileSync(process.execPath, [join(webDir, '../tools/import-item/pack-web-models.mjs'), root], {cwd: webDir, stdio: 'ignore'});
  }
  const [port, shootPort] = [await freePort(), await freePort()];
  origin = `http://127.0.0.1:${port}`;
  shootStub = stub();
  await new Promise(ok => shootStub.listen(shootPort, '127.0.0.1', ok));
  app = createNetplayServer({origin, webRoot: root, upstream: `http://127.0.0.1:${shootPort}`});
  await new Promise(ok => app.server.listen(port, '127.0.0.1', ok));
  browser = await chromium.launch({headless: true, args: ['--no-proxy-server']});
});
after(async () => {
  await browser?.close();
  await app?.close();
  shootStub?.close();
  if (built) rmSync(join(built, '..'), {recursive: true, force: true});
});

// A phone on which files matching `pattern` fail their first `cuts` times (Infinity: every time).
async function phone(cut = []) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: shots ? 2 : 1, hasTouch: true, isMobile: true});
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const asked = {};
  // Counted per address: each file matching is cut its first `cuts` times, the connection reset or (short) its bytes
  // ending early with a 200, as a phone network can leave them (Sol c263fd78).
  for (const [name, pattern, cuts, short = false] of cut) {
    const each = asked[name] = {};
    await page.route(pattern, async route => {
      const n = each[route.request().url()] = (each[route.request().url()] ?? 0) + 1;
      if (n > cuts) return route.continue();
      if (!short) return route.abort('connectionreset');
      const whole = await route.fetch();
      return route.fulfill({response: whole, body: (await whole.body()).subarray(0, 200000)});
    });
  }
  return {page, asked, context};
}
const bench = p => p.page.evaluate(() => ({
  error: document.querySelector('#error').hidden ? null : document.querySelector('#error').textContent,
  reload: Boolean(document.querySelector('#error:not([hidden]) #reloadBtn')),
  go: document.querySelector('#goBtn').disabled, why: document.querySelector('#goBtn small').textContent
}));
// Host opens a room from 首页, the guest comes in by its code; both on the bench of the room's first match.
async function room(host, guest) {
  await host.page.goto(origin + '/?shoot=off');
  await host.page.locator('#introFriend').tap();
  await host.page.locator('#netCreate').tap();
  const code = await (await host.page.waitForFunction(() => document.querySelector('#netRoomCode')?.textContent || null)).jsonValue();
  await guest.page.goto(origin + `/?shoot=off&room=${code}`);
  for (const p of [host, guest]) await p.page.waitForFunction(() => { const s = window.__top?.status(); return s?.phase === 'build' && s.net?.room === 'loadout'; });
}

test('a file cut off on the way is asked for again, and the match plays', async () => {
  const host = await phone([['engine', '**/*.wasm', 2], ['model', '**/*.glb', 1]]), guest = await phone();
  await room(host, guest);
  await host.page.waitForFunction(() => !document.querySelector('#goBtn').disabled);
  const seen = await bench(host);
  if (shots) await host.page.screenshot({path: join(shots, 'load-again-host.png')});
  assert.equal(seen.error, null, 'nothing is said about a file that came on its second or third try');
  assert.deepEqual(Object.values(host.asked.engine), [3], 'the engine was asked for three times: cut twice, then whole');
  assert.ok(Object.values(host.asked.model).some(n => n >= 2), 'a model cut off was asked for again');
  for (const p of [host, guest]) await p.page.locator('#goBtn').tap();
  await Promise.all([host, guest].map(p => p.page.waitForFunction(() => window.__top.status().phase === 'play')));
  await Promise.all([host, guest].map(p => p.context.close()));
});

test('an engine that never comes says so in Chinese, with 重新加载, and 准备 says why it is dark', async () => {
  const host = await phone([['engine', '**/*.wasm', Infinity]]), guest = await phone();
  await room(host, guest);
  await host.page.waitForFunction(() => !document.querySelector('#error').hidden);
  await guest.page.waitForFunction(() => !document.querySelector('#goBtn').disabled);
  await guest.page.locator('#goBtn').tap();
  await host.page.waitForFunction(() => document.querySelector('#foeLabel').textContent === '对面准备好了');
  await host.page.waitForTimeout(500);
  const seen = await bench(host);
  if (shots) await host.page.screenshot({path: join(shots, 'load-failed-host.png')});
  assert.equal(seen.error, '网络断了一下，没加载完重新加载');
  assert.doesNotMatch(seen.error, /[A-Za-z]/, 'no browser English on the page');
  assert.ok(seen.reload, 'a 重新加载 key');
  assert.ok(seen.go, '准备 cannot be pressed');
  assert.match(seen.why, /重新加载/, '准备 says why under it');
  assert.deepEqual(Object.values(host.asked.engine), [3], 'asked three times before it said so');
  // The key loads the page again (the network back now), into the same room, the other's 准备 still there.
  await host.page.unrouteAll();
  await Promise.all([host.page.waitForEvent('load'), host.page.locator('#reloadBtn').tap()]);
  await host.page.waitForFunction(() => { const s = window.__top?.status(); return s?.net?.seat === 0 && s.net.room === 'loadout' && document.querySelector('#error').hidden; });
  await host.page.waitForFunction(() => document.querySelector('#foeLabel').textContent === '对面准备好了');
  await Promise.all([host, guest].map(p => p.context.close()));
});

test('an engine whose bytes always end early says the same, not the browser\'s English', async () => {
  const host = await phone([['engine', '**/*.wasm', Infinity, true]]);
  await host.page.goto(origin + '/?shoot=off');
  await host.page.locator('#introFriend').tap();
  await host.page.locator('#netCreate').tap();
  await host.page.waitForFunction(() => !document.querySelector('#error').hidden);
  await host.page.waitForTimeout(500);
  const seen = await bench(host);
  if (shots) await host.page.screenshot({path: join(shots, 'load-short-host.png')});
  assert.equal(seen.error, '网络断了一下，没加载完重新加载');
  assert.ok(seen.reload && seen.go);
  assert.match(seen.why, /重新加载/);
  assert.deepEqual(Object.values(host.asked.engine), [3]);
  await host.context.close();
});

test('the other\'s photo model, come short, then garbled, is fetched anew each time, and they play', async () => {
  const host = await phone(), guest = await phone();
  // The host's phone has shot one: its pass kept, and its build with it on.
  await host.page.addInitScript(([token, id]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('wanwu-shoot-session', token);
    localStorage.setItem('wanwu-build', `${id},out,fanshuo-cushion,hug,e180`);
  }, [TOKEN, PHOTO]);
  const asked = [];
  await guest.page.route('**/api/netplay/models/**', async route => {
    const whole = await route.fetch(), body = await whole.body();
    asked.push(body.length);
    if (asked.length === 1) return route.fulfill({response: whole, body: body.subarray(0, 2000)});
    // Its length right but its scene unreadable: only reading it shows it's bad.
    if (asked.length === 2) { const bad = Buffer.from(body); bad.fill(0x7b, 20, 60); return route.fulfill({response: whole, body: bad}); }
    return route.fulfill({response: whole, body});
  });
  await host.page.goto(origin + '/');
  await host.page.waitForFunction(() => document.querySelector('.slot .item b')?.textContent === '保温杯');
  await host.page.locator('#introFriend').tap();
  await host.page.locator('#netCreate').tap();
  const code = await (await host.page.waitForFunction(() => document.querySelector('#netRoomCode')?.textContent || null)).jsonValue();
  await guest.page.goto(origin + `/?shoot=off&room=${code}`);
  for (const p of [host, guest]) {
    await p.page.waitForFunction(() => { const s = window.__top?.status(); return s?.phase === 'build' && s.net?.room === 'loadout' && !document.querySelector('#goBtn').disabled; });
    await p.page.locator('#goBtn').tap();
  }
  await Promise.all([host, guest].map(p => p.page.waitForFunction(() => window.__top.status().phase === 'play')));
  assert.equal(asked.length, 3, 'asked for three times: short, garbled, whole');
  assert.equal((await bench(guest)).error, null);
  await Promise.all([host, guest].map(p => p.context.close()));
});

test('a friend whose default opponent never comes is told, not let into a half-drawn room', async () => {
  const host = await phone(), guest = await phone([['default', /\/assets\/fanshuo-(plate|roller)-[^/]+\.glb$/, Infinity]]);
  const thrown = [];
  guest.page.on('pageerror', e => thrown.push(e.message));
  guest.page.on('console', m => { if (m.type() === 'error' && /Model not loaded/.test(m.text())) thrown.push(m.text()); });
  await host.page.goto(origin + '/?shoot=off');
  await host.page.locator('#introFriend').tap();
  await host.page.locator('#netCreate').tap();
  const code = await (await host.page.waitForFunction(() => document.querySelector('#netRoomCode')?.textContent || null)).jsonValue();
  // Their own opponent on this phone is another build (?foe=), so the page itself comes up whole and only the room's
  // default for the other phone is missing.
  await guest.page.goto(origin + `/?shoot=off&foe=fanshuo-cup,out,fanshuo-knife,hug,e180&room=${code}`);
  await guest.page.waitForFunction(() => !document.querySelector('#error').hidden);
  await guest.page.waitForTimeout(1500);
  const seen = await bench(guest);
  if (shots) await guest.page.screenshot({path: join(shots, 'load-default-guest.png')});
  assert.equal(seen.error, '网络断了一下，没加载完重新加载');
  assert.ok(seen.reload && seen.go);
  assert.deepEqual(thrown, [], 'nothing thrown, no half-drawn bench');
  assert.equal(await guest.page.evaluate(() => window.__top.status().net), null, 'the room was not opened');
  assert.ok(Object.values(guest.asked.default).every(n => n >= 3), 'each asked for three times at least (the page fetches ahead too)');
  assert.equal(await host.page.evaluate(() => window.__top.status().net?.room), 'waiting', 'the host still waits for them');
  await guest.page.unrouteAll();
  await Promise.all([guest.page.waitForEvent('load'), guest.page.locator('#reloadBtn').tap()]);
  await guest.page.waitForFunction(() => { const s = window.__top?.status(); return s?.net?.seat === 1 && s.net.room === 'loadout' && document.querySelector('#error').hidden; });
  await Promise.all([host, guest].map(p => p.context.close()));
});
