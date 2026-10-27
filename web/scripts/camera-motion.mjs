// 镜头晃不晃：照 Wren 的量法，点「开打」后 1.5 秒起，10 帧/秒截 8 秒（CSS px，DPR 1），交给 camera-motion.py 做整帧相位相关。
// 同时记下整局里两颗陀螺有没有出安全区（stage.safeOverflow）、场地边缘一圈有没有出画面。
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
await page.waitForTimeout(600);
// Every rendered frame: worst overflow of the tops past the safe area, and of the arena rim past the canvas.
await page.evaluate(() => {
  const top = window.__top, stage = top.stage;
  top.trackSafe(1);
  window.__rim = {px: -Infinity};
  const loop = () => {
    const s = top.status();
    if (s.phase !== 'build' && s.phase !== 'computing') {
      const p = stage.camera.position.clone(), o = {x: 0, y: 0}, {w, h} = stage.view;
      for (let k = 0; k < 64; k++) {
        p.set(Math.cos(k * Math.PI / 32) * stage.arenaRim, -0.02, Math.sin(k * Math.PI / 32) * stage.arenaRim);
        if (!stage.project(p, o)) continue;
        window.__rim.px = Math.max(window.__rim.px, -o.x, o.x - w, -o.y, o.y - h);
      }
    }
    requestAnimationFrame(loop);
  };
  loop();
});
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
await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 180000});
await page.waitForTimeout(1500);
const report = await page.evaluate(() => {
  const stage = window.__top.stage, f = stage.cam.fixed, o = stage.camera.position.clone().set(0, 0, 0);
  // Size on screen: CSS px per metre at the arena centre, and the default top (pan reach 0.5 m) across.
  return {status: window.__top.status(), safe: window.__top.safe(), rim: window.__rim, frame: {R: +f.R.toFixed(2), Y: +f.Y.toFixed(2), pxPerMetre: +stage.screenRadius(o, 1).toFixed(1)}};
});
await writeFile(`${out}/capture.json`, JSON.stringify({width: W, height: H, query, times, errors, safe: report.safe, rim: report.rim, frame: report.frame, duration: report.status.meta?.duration, winner: report.status.meta?.winner}, null, 1));
console.log(JSON.stringify({width: W, height: H, frames: times.length, span: times.at(-1) - times[0], safe: report.safe, rim: report.rim, frame: report.frame, errors}));
await browser.close();
