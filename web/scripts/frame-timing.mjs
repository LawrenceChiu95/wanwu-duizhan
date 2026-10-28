// Frame times during a fight on the real GPU (headless Chrome defaults to software GL, ~150 ms a frame: meaningless).
// Usage: node scripts/frame-timing.mjs <playUrl> [width=390] [seconds=8]
import {chromium} from 'playwright';
const [url, w = '390', secs = '8'] = process.argv.slice(2);
const browser = await chromium.launch({channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: Number(w), height: Math.round(Number(w) * 844 / 390)}, deviceScaleFactor: 2});
await page.goto(url);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const t0 = Date.now();
await page.evaluate(() => window.__top.start());
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
const startMs = Date.now() - t0;
const times = await page.evaluate(secs => new Promise(res => { const out = []; let last = performance.now(); const end = last + secs * 1000; const f = now => { out.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); }), Number(secs));
times.sort((a, b) => a - b);
const q = p => +times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(1);
console.log(JSON.stringify({renderer: gl, width: Number(w), frames: times.length, median: q(.5), p95: q(.95), max: q(.999), over50ms: times.filter(t => t > 50).length, clickToFightMs: startMs, simMs: (await page.evaluate(() => window.__top.status())).simMs}));
await browser.close();
