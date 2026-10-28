// Check a packed artifact under the viewer-like sandbox (scripts/viewer-sandbox-server.mjs must be serving it).
// Cover at 300 and 390 px, the play link, then the game: blocked requests, page errors, display font, textures;
// then (10-28) a real tap on 开打 goes straight into a manual fight (no 自动 / 手动 choice left), a tap on 冲 is taken,
// the sound is on (an AudioContext running after the tap, and voices started), and the 慢三成 / 原速 switch flips the camera.
// Usage: node scripts/verify-pack.mjs [base=http://127.0.0.1:4399/] [outDir]
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4399/', out = '/tmp'] = process.argv.slice(2);
const browser = await chromium.launch({channel: 'chromium'});
const report = {};
for (const W of [300, 390]) {
  const ctx = await browser.newContext({viewport: {width: W, height: 796}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const page = await ctx.newPage(), problems = [];
  // Count the sounds the page starts (sfx.js synthesizes everything with WebAudio).
  await page.addInitScript(() => {
    window.__voices = 0;
    const A = window.AudioContext;
    if (!A) return;
    window.AudioContext = class extends A { constructor(...a) { super(...a); window.__audio = this; } };
    for (const k of ['createOscillator', 'createBufferSource']) {
      const f = A.prototype[k];
      A.prototype[k] = function (...a) { const n = f.apply(this, a), start = n.start.bind(n); n.start = (...b) => { window.__voices++; return start(...b); }; return n; };
    }
  });
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused/.test(m.text())) problems.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', r => problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  const cover = await page.evaluate(() => ({font: document.fonts.check('20px Smiley'), overflowX: document.documentElement.scrollWidth > innerWidth + 0.5, h: document.documentElement.scrollHeight}));
  await page.screenshot({path: `${out}/0-cover-${W}.png`, fullPage: true});
  await page.click('a.play');
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
  await page.waitForTimeout(800);
  const game = await page.evaluate(() => {
    let meshes = 0, textured = 0;
    window.__top.stage.scene.traverse(o => { if (o.isMesh && o.material?.map !== undefined) { meshes++; if (o.material.map?.image) textured++; } });
    return {url: location.pathname, font: document.fonts.check('20px Smiley'), meshes, textured, overflowX: document.documentElement.scrollWidth > innerWidth + 0.5};
  });
  game.controlSwitch = await page.evaluate(() => document.querySelectorAll('[data-control]').length);
  await page.tap('#goBtn');
  await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => window.__voices);
  await page.tap('#dashBtn');
  await page.waitForTimeout(500);
  Object.assign(game, await page.evaluate(v0 => {
    const s = window.__top.status();
    return {control: s.control, pad: !document.getElementById('pad').hidden, dashTaken: Boolean(s.me && (s.me.charging || s.me.dashing || s.me.dashIn > 0)),
      audio: window.__audio?.state ?? null, voicesAfterTap: window.__voices - v0, simMs: s.simMs, cam0: s.cam};
  }, before));
  await page.tap('[data-cam="v4"]');
  game.camAfterTap1 = (await page.evaluate(() => window.__top.status())).cam;
  await page.tap('[data-cam="slow"]');
  game.camAfterTap2 = (await page.evaluate(() => window.__top.status())).cam;
  await page.screenshot({path: `${out}/1-fight-${W}.png`});
  report[W] = {cover, game, problems};
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
