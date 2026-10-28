// 第 13 版：自己的锁定箭头「冲歪了变灰」和规则判定对不对得上。每次自己冲结束定格，读箭头灰度和规则给的 quality/alignment，截一张。
// Usage: /opt/homebrew/bin/node web/scripts/aim-check.mjs <baseUrl> <outDir> [width=390] [seeds=7,37] [maxPerSeed=8]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4391/', out = '/tmp/aim-check', w = '390', seedsArg = '7,37', maxArg = '8'] = process.argv.slice(2);
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390), max = Number(maxArg);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}, deviceScaleFactor: 1} : {viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage(), logs = [];
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
const status = () => page.evaluate(() => window.__top.status());
const tap = sel => desk ? page.click(sel) : page.tap(sel);
const rows = [];
for (const seed of seedsArg.split(',').map(Number)) {
  await page.goto(`${base}?play=manual&seed=${seed}`);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
  await tap('#goBtn');
  await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
  const arm = () => page.evaluate(() => { window.__top.release(); window.__top.freezeOn('end-mine', 0, 1); });
  await arm();
  let s = await status(), n = 0;
  for (let g = 0; s.phase === 'play' && g < 6000; g++) {
    if (s.frozen) {
      const [caught, wide] = await page.evaluate(() => [window.__top.caught(), window.__top.aimWide()]);
      const k = `s${seed}-${n}-${caught?.quality}`;
      if (n < max) await page.screenshot({path: `${out}/${k}-${W}.png`});
      rows.push({seed, n, t: +caught.t.toFixed(2), quality: caught.quality, alignment: caught.alignment === null ? null : +caught.alignment.toFixed(3), aimWide: wide === null ? null : +wide.toFixed(2)});
      n++;
      await arm();
    } else if (s.me && s.foe && s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) await tap('#dashBtn');
    await page.waitForTimeout(40);
    s = await status();
  }
  await page.evaluate(() => window.__top.release());
}
const agree = rows.filter(r => r.aimWide !== null && (r.quality === 'full') === (r.aimWide < 0.5)).length;
const report = {width: W, rows, agree, total: rows.filter(r => r.aimWide !== null).length, logs};
await writeFile(`${out}/aim-check-${W}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({agree: report.agree, total: report.total, logs}));
for (const r of rows) console.log(JSON.stringify(r));
await browser.close();
