// 镜头快调：把一局录好的回放逐帧（1/60 秒）同步喂给 stage.updateCamera，不渲染，几秒出结果；用来比镜头参数。
// 量：玩家陀螺「转起来的直径」和核心直径（CSS px）、比例尺、核心离安全区边 ≥15% 屏宽的帧占比、整颗离边最小 px；
// 镜头自身的晃动用场地地面点的屏幕位移算（10 帧/秒、上下两半），是 Wren 量法的「地面真值」版，比实拍的相位相关更严。
// 第一次跑某个 name 时在页面里打一局（手动的用像人一样按的小循环、3 倍速），回放存进缓存目录，之后复用同一局。
// camJSON 覆盖 CAM 参数（另可给 aheadT: [秒…] 换前瞻时刻）。需 dev server（npx vite）。
// Usage: /opt/homebrew/bin/node web/scripts/camera-sim.mjs <baseUrl> <name> <query> [camJSON|-] [width=390] [cacheDir=/tmp/camera-sim]
import {chromium} from 'playwright';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
const [base, name, query, camArg = '-', w = '390', cache = '/tmp/camera-sim'] = process.argv.slice(2);
mkdirSync(cache, {recursive: true});
const W = Number(w), H = Math.round(W * 844 / 390);
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 1, isMobile: true, hasTouch: true});
const page = await ctx.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(`${base}?${query}`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
// Manual when the page is actually playing manual (its default since 10-28; play=auto for the auto fight).
const manual = await page.evaluate(() => window.__top.status().control === 'manual');
const file = `${cache}/${name}.json`;
let json = existsSync(file) ? readFileSync(file, 'utf8') : null;
await page.evaluate(manual => {
  const top = window.__top;
  if (manual) top.trackSafe(3);
  let wait = 0, seen = false, last = performance.now();
  const loop = now => {
    const s = top.status(), dt = (now - last) / 1000 * 3; last = now;
    if (manual && s.phase === 'play' && s.me && s.foe) {
      if (s.foe.charging && !seen) { seen = true; if (Math.random() < 0.7 && s.me.blockIn === 0) top.press('block'); }
      if (!s.foe.charging) seen = false;
      if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) { if (wait <= 0) wait = 0.3 + Math.random() * 0.9; else if ((wait -= dt) <= 0) top.press('dash'); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  top.start();
}, manual && !json);
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
if (!json) {
  if (manual) await page.waitForFunction(() => !['play'].includes(window.__top.status().phase), null, {timeout: 120000, polling: 250});
  json = await page.evaluate(() => window.__top.replayJson());
  writeFileSync(file, json);
}
const out = await page.evaluate(async ([json, camArg, manual]) => {
  const top = window.__top, st = top.stage, CAM = top.cam;
  top.freeze();
  const over = camArg !== '-' ? JSON.parse(camArg) : {};
  const AHEADX = over.aheadT; delete over.aheadT;
  Object.assign(CAM, over);
  const {Playback} = await import('/src/playback.js');
  const r = JSON.parse(json), pb = new Playback(r), fr = r.frames, V = st.camera.position.constructor;
  const dt = 1 / 60, LEAD = 0.05, AHEAD = AHEADX ?? [0.1];
  const lerpAt = (t, n) => { const i = pb.frameIndex(t), A = fr[i], B = fr[Math.min(i + 1, fr.length - 1)], k = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0; return new V().fromArray(A.fighters[n].pos).lerp(new V().fromArray(B.fighters[n].pos), k); };
  const look = t => pb.state.fighters.map((s, n) => AHEAD.map(d => {
    if (!manual) return lerpAt(Math.min(t + d, pb.end), n);
    const lt = Math.min(t + LEAD, pb.end), from = lerpAt(lt, n);
    const step = s.vel.clone().multiplyScalar(Math.min(0.2, t + d - lt));
    const p = from.add(step.clampLength(0, 0.45)), q = Math.hypot(p.x, p.z);
    if (q > 2.2) { p.x *= 2.2 / q; p.z *= 2.2 / q; }
    return p;
  }));
  const grid = [];
  for (let x = -4; x <= 4; x += 0.25) for (let z = -4; z <= 4; z += 0.25) if (Math.hypot(x, z) <= 2.4) grid.push(new V(x, 0, z));
  const o = {x: 0, y: 0}, a = {x: 0, y: 0}, b = {x: 0, y: 0};
  const across = (c, rr) => {
    const right = new V(1, 0, 0).applyQuaternion(st.camera.quaternion);
    st.project(c.clone().addScaledVector(right, rr), a); st.project(c.clone().addScaledVector(right, -rr), b);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const reach = f => Math.max(st.coreRadius, ...f.parts.filter(p => p.alive).map(p => p.reach));
  const {w, h} = st.view;
  st.cam.ready = false;
  const diag = {aim: [], foc: [], goal: []}, swept = [], core = [], scale = [], samples = [];
  let core15 = 0, frames = 0, minHard = Infinity, nextSample = 0;
  for (let t = 0; t <= pb.end; t += dt) {
    pb.seek(t);
    st.pose(pb.state);
    st.setLookahead(look(t));
    st.updateCamera(dt, t === 0);
    st.camera.updateMatrixWorld();
    frames++;
    { const mm = CAM.margin * st.view.w, now = [];
      for (const f of st.fighters) if (f.core.visible) now.push({p: f.center, r: st.coreRadius, m: mm}, {p: f.center, r: st.reachOf(f), m: CAM.edgePx});
      const aim = st.fighters[0].center.clone().add(st.fighters[1].center).multiplyScalar(0.5); aim.y *= 0.5;
      const K = st.view.h / 2 / Math.tan(st.camera.fov * Math.PI / 360);
      diag.aim.push(K / st.distanceFor(aim, now)); diag.foc.push(K / st.distanceFor(st.cam.focus, now)); diag.goal.push(K / Math.exp(st.cam.goal)); }
    const f0 = st.fighters[0];
    swept.push(across(f0.center, reach(f0)));
    core.push(across(f0.center, st.coreRadius));
    scale.push(st.cam.stat.pxPerMetre);
    if (st.coreMargin() >= 0.15 * w) core15++;
    // analytic reach overflow
    const top = st.view.top, bottom = st.safeBottom();
    for (const f of st.fighters) {
      if (!f.core.visible) continue;
      st.project(f.center, o); const rr = across(f.center, reach(f)) / 2;
      minHard = Math.min(minHard, o.x - rr, w - o.x - rr, o.y - rr - top, h - bottom - o.y - rr);
    }
    if (t >= nextSample - 1e-9) {
      nextSample += 0.1;
      samples.push({t, s: st.cam.stat.pxPerMetre, pts: grid.map(g => { const q = {x: 0, y: 0}; return st.project(g, q) ? [q.x, q.y] : null; })});
    }
  }
  // Motion metrics (floor ground truth) over 10 fps pairs.
  const pairs = [];
  for (let i = 1; i < samples.length; i++) {
    const A = samples[i - 1].pts, B = samples[i].pts;
    let n = 0, sx = 0, sy = 0, tn = 0, tx = 0, ty = 0, bn = 0, bx = 0, by = 0;
    A.forEach((p, k) => {
      const q = B[k];
      if (!p || !q || p[0] < 0 || p[0] > w || p[1] < 0 || p[1] > h) return;
      const dx = q[0] - p[0], dy = q[1] - p[1];
      n++; sx += dx; sy += dy;
      if (p[1] < h / 2) { tn++; tx += dx; ty += dy; } else { bn++; bx += dx; by += dy; }
    });
    const m = n ? Math.hypot(sx / n, sy / n) : 0, T = tn ? [tx / tn, ty / tn] : [0, 0], Bv = bn ? [bx / bn, by / bn] : [0, 0];
    pairs.push({t: samples[i].t, m, z: Math.abs(Math.log(samples[i].s / samples[i - 1].s)) > 0.0047, opp: Math.hypot(...T) >= 1 && Math.hypot(...Bv) >= 1 && T[0] * Bv[0] + T[1] * Bv[1] < 0});
  }
  const span = pairs.length * 0.1;
  const worst = Math.max(...pairs.map((p, i) => pairs.slice(i, i + 10).reduce((s, q) => s + q.m, 0)));
  // 8-second windows: worst opposite share over any 8 s window
  let worstOpp8 = 0, worstMean8 = 0;
  for (let i = 0; i + 80 <= pairs.length; i += 10) { const win = pairs.slice(i, i + 80); worstOpp8 = Math.max(worstOpp8, win.filter(p => p.opp).length / 80 * 100); worstMean8 = Math.max(worstMean8, win.reduce((s, p) => s + p.m, 0) / 8); }
  const q = (arr, k) => { const s = [...arr].sort((x, y) => x - y); return +s[Math.floor(k * (s.length - 1))].toFixed(1); };
  const dist = arr => ({p10: q(arr, .1), p25: q(arr, .25), med: q(arr, .5), p90: q(arr, .9)});
  return {
    dur: +pb.end.toFixed(1), swept: {...dist(swept), ge140: +(100 * swept.filter(v => v >= 140).length / swept.length).toFixed(1), ge120: +(100 * swept.filter(v => v >= 120).length / swept.length).toFixed(1)},
    core: dist(core), scale: dist(scale), needAim: dist(diag.aim), needFocus: dist(diag.foc), goal: dist(diag.goal), core15: +(100 * core15 / frames).toFixed(1), minHardPx: +minHard.toFixed(1),
    motion: {mean: +(pairs.reduce((s, p) => s + p.m, 0) / span).toFixed(1), worstSec: +worst.toFixed(1), oppPct: +(100 * pairs.filter(p => p.opp).length / pairs.length).toFixed(1), worstOpp8: +worstOpp8.toFixed(1), worstMean8: +worstMean8.toFixed(1), over30: pairs.filter(p => p.m > 30).length * 0.1, zoomPct: +(100 * pairs.filter(p => p.z).length / pairs.length).toFixed(1)},
  };
}, [json, camArg, manual]);
console.log(name, camArg === '-' ? '' : camArg, JSON.stringify(out));
await browser.close();
