// Playwright look at the top demo. Usage: node scripts/top-shots.mjs <baseUrl> <outDir> [width] [query]
// Shots: build, a hit, a break, the result. Uses the page's window.__top test hooks.
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4377/', out = './shots-top', w = '390', query = ''] = process.argv.slice(2);
const W = Number(w), H = Math.round(W * 844 / 390);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
const status = () => page.evaluate(() => window.__top?.status());
async function until(pred, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    const s = await status().catch(() => null);
    if (s && pred(s)) return s;
    if (Date.now() - t0 > timeout) throw Error(`timeout; last status ${JSON.stringify(s)}`);
    await page.waitForTimeout(30);
  }
}
const shot = name => page.screenshot({path: `${out}/${name}-${W}.png`});
const report = {width: W};
await page.goto(`${base}?${query}`);
await until(s => s.phase === 'build');
await page.waitForTimeout(900);
await shot('1-build');
report.overflow = await page.evaluate(() => [...document.querySelectorAll('#build *, #foe *, #hud *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).map(e => e.className || e.tagName));
// Fight: freeze on the n-th attacking hit, then a break, then the result.
await page.evaluate(() => { window.__top.freezeOn('hit', 110, 2); window.__top.start(); });
let s = await until(s => s.frozen);
await page.waitForTimeout(250);
await shot('2-hit');
report.hit = {t: s.t, simMs: s.simMs, meta: s.meta && {duration: s.meta.duration, winner: s.meta.winner, reason: s.meta.reason}, reason: s.reason};
await page.evaluate(ms => { window.__top.release(); window.__top.freezeOn('break', ms, 1); }, Number(process.env.BREAK_MS ?? 380));
s = await until(s => s.frozen || s.phase === 'result');
await page.waitForTimeout(250);
if (s.frozen) { await shot('3-break'); report.break = {t: s.t}; }
await page.evaluate(() => window.__top.release());
s = await until(s => s.phase === 'result', 120000);
await page.waitForTimeout(600);
await shot('4-result');
report.result = {reason: s.reason, decisive: s.decisive?.why};
report.logs = logs.slice(0, 30);
await writeFile(`${out}/report-${W}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
