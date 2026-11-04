// 陀螺在屏幕上多大：打斗中每一帧用 stage.project() 量核心球直径和「转起来的直径」（核心加上还挂着的件转一圈的外径，
// 件按模型包围盒的伸出距离），CSS px，手机 390×844、DPR 2。量玩家的陀螺，另给两颗合起来的分布。
// 另给 Wren 的量法：2 × stage.screenRadius(center, sweep)（sweep 是装配时件的转动半径，件碎了也不变）。
// Usage: /opt/homebrew/bin/node web/scripts/top-size.mjs <baseUrl> [query=seed=7] [seconds=25] [width=390]
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4471/', query = 'seed=7', secs = '25', w = '390'] = process.argv.slice(2);
const W = Number(w), H = Math.round(W * 844 / 390);
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage();
await page.goto(`${base}?${query}`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
// Presses only when the page is actually playing manual (its default since 10-28; play=auto for the auto fight).
const manual = await page.evaluate(() => window.__top.status().control === 'manual');
await page.evaluate(manual => {
  const top = window.__top, stage = top.stage;
  window.__size = {core: [], swept: [], sweptBoth: [], sweepX2: []};
  const a = {x: 0, y: 0}, b = {x: 0, y: 0};
  const across = (c, r) => {
    const right = stage.camera.position.clone().set(1, 0, 0).applyQuaternion(stage.camera.quaternion);
    if (!stage.project(c.clone().addScaledVector(right, r), a) || !stage.project(c.clone().addScaledVector(right, -r), b)) return null;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const reach = f => Math.max(stage.coreRadius, ...f.parts.filter(p => p.alive).map(p => p.reach));
  let wait = 0, seen = false, last = performance.now();
  const loop = now => {
    const s = top.status();
    if (s.phase === 'play') {
      stage.fighters.forEach((f, i) => {
        if (!f.core.visible) return;
        const sw = across(f.center, reach(f));
        if (sw == null) return;
        window.__size.sweptBoth.push(sw);
        if (i === 0) { window.__size.swept.push(sw); window.__size.core.push(across(f.center, stage.coreRadius)); window.__size.sweepX2.push(2 * stage.screenRadius(f.center, f.sweep)); }
      });
      // Manual: press like a person (冲 when ready after a moment, 挡 most times the computer winds up).
      if (manual && s.me && s.foe) {
        const dt = (now - last) / 1000;
        if (s.foe.charging && !seen) { seen = true; if (Math.random() < 0.7 && s.me.blockIn === 0) top.press('block'); }
        if (!s.foe.charging) seen = false;
        if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) { if (wait <= 0) wait = 0.3 + Math.random() * 0.9; else if ((wait -= dt) <= 0) top.press('dash'); }
      }
    }
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  top.start();
}, manual);
await page.waitForTimeout(Number(secs) * 1000);
const out = await page.evaluate(() => {
  const q = (arr, k) => { const s = [...arr].sort((x, y) => x - y); return +s[Math.floor(k * (s.length - 1))].toFixed(1); };
  const sum = arr => ({frames: arr.length, p10: q(arr, 0.1), median: q(arr, 0.5), p90: q(arr, 0.9), min: q(arr, 0), max: q(arr, 1), pctAtLeast70: +(100 * arr.filter(v => v >= 70).length / arr.length).toFixed(1), pctIn70to100: +(100 * arr.filter(v => v >= 70 && v <= 100).length / arr.length).toFixed(1)});
  const z = window.__size;
  return {coreDiameter: sum(z.core), sweptDiameterMine: sum(z.swept), sweptDiameterBoth: sum(z.sweptBoth), sweepRadiusX2Mine: sum(z.sweepX2)};
});
console.log(JSON.stringify({base, query, width: W, height: H, dpr: 2, ...out}));
await browser.close();
