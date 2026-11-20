// 好友初见 (Elara c472e5e7): the first 准备 in a friend's room on a phone with no lesson behind it warms up on a 木桩.
// Two 390-wide phones in one room through the real room service (tools/netplay/server.mjs), on the 好友对撞 page itself.
//  - A friend new to the game, in by the invite link: 冲 lit and its lunge into the 木桩, then 挡 lit at its flash and the
//    完美; back on the bench 已准备 by itself; the other phone reads 对面在热身 meanwhile. In the first match, 挡 rises
//    beside its button at the other's flashes till the player has caught one, then never.
//  - 跳过 on the card: 已准备 at once.
//  - A phone that has had the single-player lesson: 准备 goes straight to the room.
// NETPLAY_WEB=<built 好友对撞 page> checks that page; without it the page is built here first. NETPLAY_SHOTS=<dir> keeps a
// screenshot of each step.
import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createNetplayServer} from '../../tools/netplay/server.mjs';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const shots = process.env.NETPLAY_SHOTS ?? null;
let root = process.env.NETPLAY_WEB, built = null, app, origin, browser;

const freePort = () => new Promise((ok, fail) => {
  const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => ok(port)); });
});

before(async () => {
  if (!root) {
    root = built = join(mkdtempSync(join(tmpdir(), 'wanwu-netplay-warm-')), 'web');
    const env = {...process.env, WANWU_NETPLAY: '1', WANWU_COMBAT: 'position'};
    execFileSync(process.execPath, [join(webDir, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'judge', '--outDir', root, '--emptyOutDir', '--logLevel', 'error'], {cwd: webDir, env, stdio: 'inherit'});
    execFileSync(process.execPath, [join(webDir, '../tools/import-item/pack-web-models.mjs'), root], {cwd: webDir, stdio: 'ignore'});
  }
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  app = createNetplayServer({origin, webRoot: root});
  await new Promise(ok => app.server.listen(port, '127.0.0.1', ok));
  browser = await chromium.launch({headless: true, args: ['--no-proxy-server']});
});
after(async () => {
  await browser?.close();
  await app?.close();
  if (built) rmSync(join(built, '..'), {recursive: true, force: true});
});

// A phone; `kept` is what its storage already holds (a new friend's holds nothing).
async function phone(kept = {}) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: shots ? 2 : 1, hasTouch: true, isMobile: true});
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(kept => { for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v); }, kept);
  return {page, context, errors};
}
const SEEN = {'wanwu-netplay-warm-seen': '1'};
const status = p => p.page.evaluate(() => { const s = window.__top.status(); return {phase: s.phase, teach: s.teach, warm: s.warm, hint: s.hint, room: s.net?.room}; });
const shot = (p, name) => shots && p.page.screenshot({path: join(shots, `warm-${name}.png`)});
const bench = p => p.page.evaluate(() => ({go: document.querySelector('#goBtn span').textContent, why: document.querySelector('#goBtn small').textContent, plate: document.querySelector('#foeLabel').textContent}));
const card = p => p.page.evaluate(() => ({title: document.querySelector('#teachTitle').textContent, lit: document.querySelector('#pad').dataset.lit}));
// Host opens a room from 首页, the guest comes in by the invite link; both on the bench of the room's first match.
async function room(host, guest) {
  await host.page.goto(origin + '/?shoot=off');
  await host.page.locator('#introFriend').tap();
  await host.page.locator('#netCreate').tap();
  await host.page.waitForFunction(() => document.querySelector('#netLinkUrl')?.href);
  const link = await host.page.evaluate(() => document.querySelector('#netLinkUrl').href);
  await guest.page.goto(link);
  for (const p of [host, guest]) await p.page.waitForFunction(() => { const s = window.__top?.status(); return s?.phase === 'build' && s.net?.room === 'loadout' && !document.querySelector('#goBtn').disabled; });
}

test('a new friend warms up on the 木桩, is ready by itself, and is shown 挡 in the first match till one is caught', async () => {
  const host = await phone(SEEN), guest = await phone();
  await room(host, guest);
  await host.page.locator('#goBtn').tap();
  await guest.page.locator('#goBtn').tap();

  // Beat 1: 冲 lit, the fight stopped till it is pressed.
  await guest.page.waitForFunction(() => window.__top.status().teach?.stop === 'dash' && !document.querySelector('#teach').hidden);
  assert.deepEqual(await card(guest), {title: '热身：冲', lit: 'dash'});
  assert.equal((await status(guest)).room, 'loadout', 'the room is not told 准备 yet');
  await shot(guest, '1-dash');
  // The other phone meanwhile: 对面在热身 on its plate and under its 准备.
  await host.page.waitForFunction(() => document.querySelector('#goBtn small').textContent === '对面在热身');
  assert.equal((await bench(host)).plate, '对面在热身');
  await shot(host, '0-other-phone');
  await guest.page.locator('#dashBtn').tap();
  await guest.page.waitForFunction(() => window.__top.events().some(e => e.type === 'dash' && e.phase === 'end' && e.side === window.__top.status().net.seat));
  await shot(guest, '2-lunge');

  // Beat 2: the 木桩 flashes and lunges, 挡 lit; pressed, a 完美.
  await guest.page.waitForFunction(() => window.__top.status().teach?.stop === 'block' && !document.querySelector('#teach').hidden);
  assert.deepEqual(await card(guest), {title: '热身：挡', lit: 'block'});
  await shot(guest, '3-block');
  await guest.page.locator('#blockBtn').tap();
  const caught = await (await guest.page.waitForFunction(() => window.__top.events().find(e => e.type === 'blockResult' && e.side === window.__top.status().net.seat)?.outcome)).jsonValue();
  assert.equal(caught, 'perfect');
  await guest.page.waitForTimeout(150);
  await shot(guest, '4-clang');

  // Back on the bench, 准备 sent by itself; the match starts on both phones.
  await guest.page.waitForFunction(() => window.__top.status().phase === 'build');
  assert.equal((await bench(guest)).go, '已准备');
  await shot(guest, '5-ready');
  assert.equal(await guest.page.evaluate(() => localStorage.getItem('wanwu-netplay-warm-seen')), '1', 'never again on this phone');
  await Promise.all([host, guest].map(p => p.page.waitForFunction(() => { const s = window.__top.status(); return s.phase === 'play' && s.net?.room === 'playing'; })));

  // The first match: the guest's page presses 挡 itself the moment the host's lunge goes, until one is caught.
  const flashes = () => guest.page.evaluate(() => window.__top.events().filter(e => e.type === 'dashCue' && e.side !== window.__top.status().net.seat).length);
  const blockOnGo = () => guest.page.evaluate(() => new Promise(ok => {
    const me = window.__top.status().net.seat, goes = () => window.__top.events().filter(e => e.type === 'dash' && e.phase === 'go' && e.side !== me).length;
    const seen = goes(), t0 = performance.now();
    const tick = () => { if (goes() > seen) { window.__top.press('block'); ok(true); } else if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else ok(false); };
    tick();
  }));
  await guest.page.waitForTimeout(2000); // the tops in reach of each other
  let quietFlashes = 0;
  for (let i = 0; i < 8 && quietFlashes < 1; i++) {
    const was = await status(guest), n = await flashes();
    const blocking = was.hint.caught ? null : blockOnGo();
    await host.page.locator('#dashBtn').tap();
    const flashed = await guest.page.waitForFunction(n => window.__top.events().filter(e => e.type === 'dashCue' && e.side !== window.__top.status().net.seat).length > n, n, {timeout: 2500}).then(() => true, () => false);
    // The picture 0.05 s past the flash (the 挡 up, the other top still white), whatever the sim is ahead by.
    if (flashed && shots) {
      const at = await guest.page.evaluate(() => window.__top.events().filter(e => e.type === 'dashCue' && e.side !== window.__top.status().net.seat).at(-1).t);
      await guest.page.waitForFunction(at => window.__top.status().t >= at + 0.05, at);
      await shot(guest, was.hint.caught ? '7-no-hint' : `6-hint-${was.hint.shown + 1}`);
    }
    await blocking;
    await guest.page.waitForTimeout(4000); // the host's 冲 ready again
    const now = await status(guest);
    if (!flashed) continue;
    if (was.hint.caught) { assert.equal(now.hint.shown, was.hint.shown, 'no 挡 beside the button once one was caught'); quietFlashes++; }
    else assert.equal(now.hint.shown, Math.min(2, was.hint.shown + 1), '挡 beside the button at the other\'s flash');
    if (!was.hint.caught && now.hint.left === 0 && !now.hint.caught) assert.fail('both hints spent before a catch: the check could not show they stop');
  }
  assert.equal(quietFlashes, 1, 'a flash of the other\'s after the catch was seen');
  assert.deepEqual([...host.errors, ...guest.errors], []);
  await Promise.all([host, guest].map(p => p.context.close()));
});

test('跳过 on the 木桩 makes the phone ready at once', async () => {
  const host = await phone(), guest = await phone(SEEN);
  await room(host, guest);
  await host.page.locator('#goBtn').tap();
  await host.page.waitForFunction(() => window.__top.status().teach?.stop === 'dash' && !document.querySelector('#teach').hidden);
  await host.page.locator('#teachSkip').tap();
  await host.page.waitForFunction(() => window.__top.status().phase === 'build');
  assert.equal((await bench(host)).go, '已准备');
  assert.equal((await status(host)).warm, false);
  await guest.page.waitForFunction(() => document.querySelector('#foeLabel').textContent === '对面准备好了');
  await Promise.all([host, guest].map(p => p.context.close()));
});

test('a phone that has had the single-player lesson goes straight to the room', async () => {
  const host = await phone({'wanwu-teach-seen': '1'}), guest = await phone(SEEN);
  await room(host, guest);
  await host.page.locator('#goBtn').tap();
  await host.page.waitForFunction(() => document.querySelector('#goBtn span').textContent === '已准备');
  const s = await status(host);
  assert.equal(s.phase, 'build');
  assert.equal(s.warm, false);
  assert.equal(await host.page.evaluate(() => localStorage.getItem('wanwu-netplay-warm-seen')), null);
  await Promise.all([host, guest].map(p => p.context.close()));
});
