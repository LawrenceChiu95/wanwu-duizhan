// 角色库 check (MVP §4-3): open it from slot 1, wait for every card's 3D, pick another item, back on the build screen
// with that item installed. Usage: node scripts/library-shots.mjs [base=http://127.0.0.1:4392/] [outDir=/tmp/iris-mvp]
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4392/', out = '/tmp/iris-mvp'] = process.argv.slice(2);
const browser = await chromium.launch();
const report = {};
for (const [W, H] of [[390, 844], [1440, 900]]) {
  const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: W < 900, hasTouch: W < 900});
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
  const before = await page.evaluate(() => window.__top.status().mine.parts.map(p => p.item));
  await page.click('[data-pick="0"]');
  await page.waitForSelector('#library:not([hidden])');
  await page.waitForFunction(() => [...document.querySelectorAll('#libGrid .turn')].every(t => t.classList.contains('on')), null, {timeout: 60000});
  await page.waitForTimeout(400);
  await page.screenshot({path: `${out}/library-${W}.png`});
  const cards = await page.$$eval('#libGrid .card', cs => cs.map(c => ({id: c.dataset.item, name: c.querySelector('.nm b').textContent, badge: c.querySelector('.badge')?.textContent ?? null, disabled: c.querySelector('.pick').disabled, foot: (c.querySelector('.src') ?? c.querySelector('.how'))?.textContent})));
  const pickId = cards.find(c => !c.disabled && !c.badge).id;
  await page.click(`#libGrid .card[data-item="${pickId}"] .pick`);
  await page.waitForSelector('#library', {state: 'hidden'});
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => window.__top.status().mine.parts.map(p => p.item));
  const slotName = await page.textContent('.slot[data-slot="0"] .item b');
  await page.screenshot({path: `${out}/build-after-${W}.png`});
  report[W] = {errors, before, cards, picked: pickId, after, slotName, ok: after[0] === pickId && errors.length === 0};
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
