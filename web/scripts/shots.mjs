// Headless screenshots + desktop rAF rate. Needs `npm run preview` running.
// Usage: node scripts/shots.mjs [baseUrl] [a] [b] [seed]   (Node >= 20)
// PROXY=socks5://localhost:1055 reaches the tailnet hostname from this Mac (userspace tailscaled).
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';

const base = process.argv[2] ?? 'http://127.0.0.1:4330/';
const [a, b, seed] = [process.argv[3] ?? 'broom', process.argv[4] ?? 'pot', process.argv[5] ?? '1'];
const out = new URL('../shots/', import.meta.url);
await mkdir(out, {recursive: true});

// channel 'chromium' = new headless with the real GPU (Metal); the default shell falls back to SwiftShader.
const browser = await chromium.launch({channel: 'chromium', ...(process.env.PROXY ? {proxy: {server: process.env.PROXY}} : {})});
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
const status = () => page.evaluate(() => window.__wanwu?.status());
async function until(pred, timeout = 90000) {
  const t0 = Date.now();
  for (;;) {
    const s = await status();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > timeout) throw Error(`timeout; last status ${JSON.stringify(s)}`);
    await page.waitForTimeout(25);
  }
}
const tag = process.env.TAG ?? '';
const shot = name => page.screenshot({path: new URL(tag + name, out).pathname});
const report = {};

if (process.env.UI) {
  // Idle screen, item picker and credits sheet.
  await page.goto(`${base}?a=${a}&b=${b}&seed=${seed}`);
  await until(s => s.phase === 'idle');
  await page.waitForTimeout(600);
  await shot('ui-1-idle.png');
  await page.click('#pick1');
  await page.waitForTimeout(200);
  await shot('ui-2-picker.png');
  await page.click('#sheetClose');
  await page.click('#creditsBtn');
  await page.waitForTimeout(200);
  await shot('ui-3-credits.png');
}

for (const mode of ['A', 'B']) {
  const t0 = Date.now();
  await page.goto(`${base}?a=${a}&b=${b}&mode=${mode}&seed=${seed}&autoplay=1`);
  let s = await until(s => s.phase === 'play' && s.t > 0.35);
  const loadMs = Date.now() - t0;
  await page.evaluate(() => window.__wanwu.freeze());
  await shot(`${mode}-1-start.png`);
  // Count requestAnimationFrame callbacks for 8 s of live play.
  await page.evaluate(() => { window.__wanwu.release(); window.__wanwu.freezeOn(['crit', 'weak'], 70); });
  const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  const fps = mode === 'A' ? await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 8000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })) : null;
  s = await until(s => s.frozen || s.phase === 'result');
  if (s.frozen) await shot(`${mode}-2-crit.png`);
  const critAt = s.t;
  await page.evaluate(() => window.__wanwu.release());
  s = await until(s => s.slow > 0.97 && s.caption);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__wanwu.freeze());
  await shot(`${mode}-3-slowmo.png`);
  const slowAt = (await status()).t;
  await page.evaluate(() => window.__wanwu.release());
  s = await until(s => s.phase === 'result');
  await page.waitForTimeout(600);
  await shot(`${mode}-4-result.png`);
  report[mode] = {gpu, loadMs, simMs: Math.round(s.simMs), fps, critAt, slowAt, meta: s.meta, decisive: s.decisive};
}
await writeFile(new URL(tag + 'shots.json', out), JSON.stringify({base, a, b, seed, report, logs}, null, 2));
console.log(JSON.stringify({report, logs: logs.slice(0, 20)}, null, 1));
await browser.close();
