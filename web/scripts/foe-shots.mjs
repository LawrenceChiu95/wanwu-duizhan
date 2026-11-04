// 换个对手 check (MVP 规格 §4-2): the VS line at 390 / 300 / 1440, the sheet, picking the 强 build (the preview's right-hand
// top changes), and at 390 a fight against it, then 原样再来 keeps it. Each step is compared with what it should be
// (items, which way each faces, spacing); the raw results go to <outDir>/foe-shots.json and any mismatch exits 1
// (Sol's S1/S2 on PR #17). Usage (from web/, dev server up):
// /opt/homebrew/bin/node scripts/foe-shots.mjs [base=http://127.0.0.1:4392/] [outDir=/tmp/iris-foe]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4392/', out = '/tmp/iris-foe'] = process.argv.slice(2);
await mkdir(out, {recursive: true});
// FOES in src/main.js: the default first, then 强 (row 1).
const DEFAULT = {parts: [{item: 'pan-lux3d', orient: 'out'}, {item: 'lamp-lux3d', orient: 'hug'}], spread: 'e180'};
const STRONG = {parts: [{item: 'broom', orient: 'out'}, {item: 'pillow', orient: 'out'}], spread: 'e90'};
const build = b => b && {parts: b.parts.map(({item, orient}) => ({item, orient})), spread: b.spread};
const failures = [];
const expect = (W, what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push({W, what, got, want}); };
const browser = await chromium.launch({channel: 'chromium'});
const report = {};
for (const [W, H] of [[390, 844], [300, 650], [1440, 900]]) {
  const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: W < 900, hasTouch: W < 900});
  const page = await ctx.newPage(), errors = [], r = {errors};
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => { try { localStorage.setItem('wanwu-coach-seen', '[0,1,2]'); } catch {} });
  await page.goto(base);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
  await page.waitForTimeout(600);
  r.header = await page.evaluate(() => { const h = document.querySelector('#foe'), b = document.querySelector('#foeBtn').getBoundingClientRect(); return {h: h.offsetHeight, btn: [b.left, b.right, b.top, b.bottom].map(Math.round), wraps: h.scrollWidth > h.clientWidth}; });
  await page.screenshot({path: `${out}/build-${W}.png`});
  await page.click('#foeBtn');
  await page.waitForSelector('#foeSheet:not([hidden])');
  await page.waitForTimeout(400);
  await page.screenshot({path: `${out}/sheet-${W}.png`});
  r.before = build(await page.evaluate(() => window.__top.status().foeBuild));
  r.rows = await page.$$eval('.frow', rs => rs.map(x => ({t: x.textContent.replace(/\s+/g, ' ').trim(), on: x.getAttribute('aria-checked')})));
  expect(W, 'build before picking', r.before, DEFAULT);
  expect(W, 'sheet rows ticked', r.rows.map(x => x.on), ['true', 'false', 'false', 'false', 'false']);
  expect(W, 'row 1 is 强', r.rows[1]?.t.startsWith('强'), true);
  await page.click('.frow[data-foe="1"]');
  await page.waitForTimeout(2500);
  await page.screenshot({path: `${out}/build-strong-${W}.png`});
  r.after = await page.evaluate(() => ({foe: window.__top.status().foeBuild, tag: document.querySelector('#foeParts').textContent}));
  expect(W, 'build after picking 强', build(r.after.foe), STRONG);
  expect(W, 'VS line on one row', r.header.wraps, false);
  if (W === 390) {
    await page.click('#goBtn');
    await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 120000});
    await page.evaluate(() => { window.__bot = setInterval(() => { const s = window.__top.status(); if (s.phase !== 'play' || !s.me) return; if (s.foe?.charging) window.__top.press('block'); else if (s.me.dashIn <= 0) window.__top.press('dash'); }, 50); });
    await page.waitForTimeout(5000);
    await page.screenshot({path: `${out}/fight-strong-${W}.png`});
    await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 300000});
    await page.evaluate(() => clearInterval(window.__bot));
    r.fight = await page.evaluate(() => ({reason: window.__top.status().reason, foe: window.__top.status().foeBuild}));
    expect(W, 'fought the 强 build', build(r.fight.foe), STRONG);
    await page.click('#sameBtn');
    await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 120000});
    r.same = await page.evaluate(() => window.__top.status().foeBuild);
    expect(W, '原样再来 keeps the 强 build', build(r.same), STRONG);
  }
  expect(W, 'page errors', errors, []);
  report[W] = r;
  await ctx.close();
}
await browser.close();
report.failures = failures;
await writeFile(`${out}/foe-shots.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (failures.length) { console.error(`${failures.length} mismatch(es); see failures in ${out}/foe-shots.json`); process.exitCode = 1; }
