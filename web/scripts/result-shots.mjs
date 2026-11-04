// 结算 check (MVP §4-7): a few manual matches at 6× speed (冲 whenever ready, 挡 when the other top is winding up), the result card's lines, numbers and tip, and a screenshot
// of each. Usage: node scripts/result-shots.mjs [base=http://127.0.0.1:4392/] [outDir=/tmp/iris-mvp] [seeds=7,42,101]
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4392/', out = '/tmp/iris-mvp', seedArg = '7,42,101'] = process.argv.slice(2);
const browser = await chromium.launch();
const report = [];
for (const [W, H] of [[390, 844], [1440, 900]]) for (const seed of seedArg.split(',').map(Number)) {
  if (W > 900 && seed !== Number(seedArg.split(',')[0])) continue;
  const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: W < 900, hasTouch: W < 900});
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}?seed=${seed}`);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
  await page.evaluate(() => window.__top.trackSafe(6));
  await page.click('#goBtn');
  // A simple player: 冲 every time it is ready, 挡 while the opponent winds up a lunge.
  await page.evaluate(() => { window.__bot = setInterval(() => { const s = window.__top.status(); if (s.phase !== 'play' || !s.me) return; if (s.foe?.charging) window.__top.press('block'); else if (s.me.dashIn <= 0) window.__top.press('dash'); }, 50); });
  await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 180000});
  await page.evaluate(() => clearInterval(window.__bot));
  await page.waitForTimeout(1500);
  await page.screenshot({path: `${out}/result-${W}-s${seed}.png`});
  const card = await page.evaluate(() => ({
    meta: document.getElementById('resultMeta').textContent, winner: document.getElementById('winnerLine').textContent,
    why: document.getElementById('whyLine').textContent, tip: document.getElementById('tipLine').textContent,
    stats: [...document.querySelectorAll('#statsList li')].map(li => li.textContent),
    buttons: [...document.querySelectorAll('#result .actions button')].filter(b => !b.hidden).map(b => ({text: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), overflow: b.scrollWidth > b.clientWidth}))
  }));
  report.push({W, seed, errors, ...card});
  // 原样再来 starts the same builds straight away.
  if (W < 900 && seed === Number(seedArg.split(',')[0])) {
    await page.click('#sameBtn');
    await page.waitForFunction(() => ['play', 'computing'].includes(window.__top.status().phase), null, {timeout: 30000});
    report.at(-1).same = await page.evaluate(() => window.__top.status().phase);
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
