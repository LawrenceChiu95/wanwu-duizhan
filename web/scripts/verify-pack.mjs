// Check a packed artifact under the viewer-like sandbox (scripts/viewer-sandbox-server.mjs must be serving it).
// Cover at 300 and 390 px, the play link, then the game: blocked requests, page errors, display font, textures.
// Usage: node scripts/verify-pack.mjs [base=http://127.0.0.1:4399/] [outDir]
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4399/', out = '/tmp'] = process.argv.slice(2);
const browser = await chromium.launch({channel: 'chromium'});
const report = {};
for (const W of [300, 390]) {
  const ctx = await browser.newContext({viewport: {width: W, height: 796}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const page = await ctx.newPage(), problems = [];
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
  await page.evaluate(() => window.__top.start());
  await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
  game.simMs = (await page.evaluate(() => window.__top.status())).simMs;
  report[W] = {cover, game, problems};
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
