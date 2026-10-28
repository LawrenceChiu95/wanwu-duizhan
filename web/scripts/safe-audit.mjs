// Safe-area audit: plays whole matches (sped up) and records, for every rendered frame, how far any visible core
// or mounted piece reaches outside the area below the HUD and above the caption / result card.
// Auto fights (play=auto: the page itself is manual-only since 10-28).
// Usage: node scripts/safe-audit.mjs <baseUrl> <out.json> [widths=300,390,1440] [speed=3]
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4377/', out = './safe-audit.json', ws = '300,390,1440', sp = '3'] = process.argv.slice(2);
const builds = [
  'pan-lux3d,out,pillow,hug,e180',      // default
  'broom,out,scissors,out,e180',        // longest reach
  'pillow,hug,lamp-lux3d,hug,e90',      // both hugging
  'slipper,out,broom,out,e90'
];
const seeds = [3, 10, 21];
const browser = await chromium.launch({channel: 'chromium'});
async function run(W) {
  const desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
  const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}} : {viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const page = await ctx.newPage();
  const rows = [];
  for (const b of builds) for (const seed of seeds) {
    await page.goto(`${base}?mine=${b}&seed=${seed}&play=auto`);
    await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
    await page.evaluate(s => { window.__top.trackSafe(s); window.__top.start(); }, Number(sp));
    await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 120000, polling: 100});
    await page.waitForTimeout(2500 / Number(sp) + 800);
    const safe = await page.evaluate(() => window.__top.safe());
    const st = await page.evaluate(() => window.__top.status());
    rows.push({build: b, seed, control: st.control, presses: st.meta.manual?.inputs.length ?? null, duration: st.meta.duration, safe});
  }
  await ctx.close();
  return {width: W, height: H, rows};
}
const res = await Promise.all(ws.split(',').map(Number).map(run));
await browser.close();
const summary = res.map(r => {
  const worst = {};
  for (const row of r.rows) for (const [ph, o] of Object.entries(row.safe)) if (!worst[ph] || o.px > worst[ph].px) worst[ph] = {...o, build: row.build, seed: row.seed};
  return {width: r.width, height: r.height, games: r.rows.length, worst};
});
await writeFile(out, JSON.stringify({summary, detail: res}, null, 1));
console.log(JSON.stringify(summary, null, 1));
