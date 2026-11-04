// 镜头晃不晃：照 Wren 的量法，点「开打」后 1.5 秒起，10 帧/秒截 8 秒（CSS px，DPR 1），交给 camera-motion.py 做整帧相位相关
// （camera-blockmatch.py 用块匹配再量一遍）。
// 同时记下整局里两颗陀螺有没有出安全区（stage.safeOverflow）、离安全区四边留没留够屏宽 15%、镜头比例尺（px/米）。
// 手动模式（页面实际在手动，即默认或 play=manual；play=auto 是自动）页面里装一个「像人一样按」的小循环：冲好了隔一会儿就冲，电脑蓄力时多半举挡。
// Usage: /opt/homebrew/bin/node web/scripts/camera-motion.mjs <baseUrl> <outDir> [width=390] [height] [query]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4377/', out = '/tmp/camera-motion', w = '390', hArg, query = ''] = process.argv.slice(2);
const W = Number(w), H = Number(hArg || (W >= 900 ? 900 : Math.round(W * 844 / 390)));
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const page = await browser.newPage({viewport: {width: W, height: H}, deviceScaleFactor: 1, hasTouch: W < 900, isMobile: W < 900});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`${base}?${query}`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
const manual = await page.evaluate(() => window.__top.status().control === 'manual');
await page.waitForTimeout(600);
// Tuning runs: CAMTUNE='{"hold":1}' overrides framing-camera parameters before the match.
if (process.env.CAMTUNE) await page.evaluate(t => Object.assign(window.__top.cam, t), JSON.parse(process.env.CAMTUNE));
// HIDE=1: draw no tops, effects or overlays (the camera's own motion over the floor only; a check on the estimators).
if (process.env.HIDE) { await page.evaluate(() => { window.__top.stage.debugHide = true; }); await page.addStyleTag({content: '#fx { display: none !important; }'}); }
// Every rendered frame: worst overflow of the tops past the safe area, margins and scale (see __top.framing()).
await page.evaluate(manual => {
  const top = window.__top, stage = top.stage;
  top.trackSafe(1);
  // Ground truth for the estimators: where the arena centre (a floor point) lands on screen, and the scale, every frame.
  window.__camTrack = [];
  const o = {x: 0, y: 0}, centre = stage.camera.position.clone().set(0, -0.02, 0);
  const track = () => {
    const s = top.status();
    if (s.phase === 'play' && stage.project(centre, o)) window.__camTrack.push([performance.now(), o.x, o.y, stage.screenRadius(centre, 1)]);
    requestAnimationFrame(track);
  };
  requestAnimationFrame(track);
  if (!manual) return;
  // Press like a person: 冲 0.3–1.2 s after it is ready; 挡 70 % of the time when the computer winds up.
  let wait = 0, seenCharge = false, last = performance.now();
  const loop = now => {
    const dt = (now - last) / 1000;
    last = now;
    const s = top.status();
    if (s.phase === 'play' && s.me && s.foe) {
      if (s.foe.charging && !seenCharge) { seenCharge = true; if (Math.random() < 0.7 && s.me.blockIn === 0) top.press('block'); }
      if (!s.foe.charging) seenCharge = false;
      if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) { if (wait <= 0) wait = 0.3 + Math.random() * 0.9; else if ((wait -= dt) <= 0) top.press('dash'); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}, manual);
// Desktop: only the game frame (the side panels never move), which also keeps 10 shots a second possible.
const box = await page.locator('#app').boundingBox(), clip = {x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height)};
await page.click('#goBtn');
const clickAt = Date.now();
await page.waitForTimeout(1500);
const times = [];
for (let i = 0; i < 80; i++) {
  const due = clickAt + 1500 + i * 100;
  const wait = due - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  times.push(Date.now() - clickAt);
  await page.screenshot({path: `${out}/f${String(i).padStart(3, '0')}.png`, clip});
}
// Let the match finish to audit the tops and rim over the whole fight and the result.
for (let t0 = Date.now(); (await page.evaluate(() => window.__top.status().phase)) !== 'result';) {
  if (Date.now() - t0 > 180000) throw Error(`no result after 180 s: ${JSON.stringify(await page.evaluate(() => window.__top.status()))} ${errors.join(' | ')}`);
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1500);
const report = await page.evaluate(() => ({status: window.__top.status(), safe: window.__top.safe(), frame: window.__top.framing()}));
// The camera's own motion over the same 8 s, sampled at the capture instants (10 a second): floor-point shift and zoom.
const truth = await page.evaluate(([t0, times]) => {
  const tr = window.__camTrack, at = ms => tr.reduce((b, r) => Math.abs(r[0] - ms) < Math.abs(b[0] - ms) ? r : b, tr[0]);
  const pts = times.map(t => at(t0 + t));
  let sum = 0, worst = 0, zoomFast = 0;
  const steps = [];
  for (let i = 1; i < pts.length; i++) {
    const [, x0, y0, s0] = pts[i - 1], [, x1, y1, s1] = pts[i];
    steps.push(Math.hypot(x1 - x0, y1 - y0));
    // A half-screen-height point moves this far from the zoom alone.
    if (Math.abs(Math.log(s1 / s0)) * 211 >= 1) zoomFast++;
  }
  sum = steps.reduce((a, b) => a + b, 0);
  for (let i = 0; i + 10 <= steps.length; i++) worst = Math.max(worst, steps.slice(i, i + 10).reduce((a, b) => a + b, 0));
  return {floorMeanPxS: +(sum / ((times.at(-1) - times[0]) / 1000)).toFixed(2), floorWorstSecondPx: +worst.toFixed(1), floorMaxStepPx: +Math.max(...steps).toFixed(1), zoomPairsOver1px: zoomFast, pairs: steps.length};
}, [clickAt - (await page.evaluate(() => Date.now() - performance.now())), times]);
await writeFile(`${out}/capture.json`, JSON.stringify({width: W, height: H, query, times, errors, safe: report.safe, frame: report.frame, duration: report.status.meta?.duration, winner: report.status.meta?.winner, presses: report.status.inputs?.length ?? null, truth}, null, 1));
console.log(JSON.stringify({width: W, height: H, frames: times.length, span: times.at(-1) - times[0], safe: report.safe, frame: report.frame, presses: report.status.inputs?.length ?? null, truth, errors}));
await browser.close();
