// 出画 audit (MVP 规格 §7): plays auto fights at real speed (the camera eases on real time, so no speed-up) at 390×844 and
// reports per game the seconds a core or mounted piece is past the safe area (outSecs, longest stretch outRunMaxSecs) and
// the seconds a top's as-built swept circle is past the screen's left or right edge (offLrSecs, Wren's 10-29 measure,
// which keeps a broken piece's reach). Usage (from web/, dev server up):
// /opt/homebrew/bin/node scripts/offframe-audit.mjs <base> <out.json> <cams=slow,v4,new> <seeds=37,7> [mine build]
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const [base, out, cams = 'slow,v4,new', seeds = '37,7', mine = ''] = process.argv.slice(2);
const browser = await chromium.launch({channel: 'chromium'});
const jobs = [];
for (const cam of cams.split(',')) for (const seed of seeds.split(',')) jobs.push({cam, seed});
const rows = [];
async function run({cam, seed}) {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  const page = await ctx.newPage();
  await page.goto(`${base}?seed=${seed}&play=auto&cam=${cam}${mine ? `&mine=${mine}` : ''}`);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
  await page.evaluate(() => { window.__top.trackSafe(1); window.__top.start(); });
  await page.waitForFunction(() => window.__top.status().phase === 'result' || window.__top.status().phase === 'finale', null, {timeout: 200000, polling: 200});
  const f = await page.evaluate(() => window.__top.framing());
  const st = await page.evaluate(() => window.__top.status());
  const breaks = JSON.parse(await page.evaluate(() => window.__top.replayJson())).events.filter(e => e.type === 'break').map(e => +e.t.toFixed(2));
  rows.push({cam: st.cam, seed: Number(seed), duration: +st.meta.duration.toFixed(2), outSecs: f.outSecs, outRunMaxSecs: f.outRunMaxSecs, offLrSecs: f.offLrSecs, offLrFrom: f.offLrAt[0] ?? null, breaks, minMarginPx: f.minMarginPx, frames: f.frames});
  console.error(JSON.stringify(rows.at(-1)));
  await ctx.close();
}
const N = 2;
await Promise.all(Array.from({length: N}, async () => { while (jobs.length) await run(jobs.shift()); }));
await browser.close();
rows.sort((a, b) => a.cam.localeCompare(b.cam) || a.seed - b.seed);
await writeFile(out, JSON.stringify(rows, null, 1));
