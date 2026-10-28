// 三个镜头比一比（渲染器真值）：同一局手动回放（同一份按键）逐帧（1/60 秒）喂给网页里的镜头，每帧读相机位姿、投影两颗陀螺，
// 不靠截图。报：镜头平移（场地地面点 10 帧/秒的整体位移，px/s）、地面点各自位移（含转动）、陀螺屏幕速度（核心中心，px/s）、
// 扫过圆盘（还挂着的件，绕自己的轴）离屏幕边最近、核心离屏幕边最近、偏航角速度、镜头焦点平移速度（m/s）、推拉速度（|d ln 距离|/s）、
// 「慢三成」拉远兜底触发的帧占比。手动回放在 Node 里打：先电脑对电脑打一局，取玩家一方的按键，再用这份按键当玩家输入重打（各镜头共用）。
// 撞击时的追拍震屏、碎件震屏照网页的触发量加上（追拍震屏带随机，只影响 px 的零头）。需 dev server（npx vite）。
// Usage: /opt/homebrew/bin/node web/scripts/cam-yaw.mjs <baseUrl> [seeds=7,37] [styles=new,slow,v4] [width=390] [out.json]
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
import {simulateV3} from '../../sim/v3.js';
const [base = 'http://127.0.0.1:4391/', seedArg = '7,37', styleArg = 'new,slow,v4', w = '390', outFile] = process.argv.slice(2);
const MINE = {parts: [{item: 'pan-lux3d', mount: 'e0', orient: 'out'}, {item: 'pillow', mount: 'e180', orient: 'hug'}]};
const FOE = {parts: [{item: 'pan-lux3d', mount: 'e0', orient: 'out'}, {item: 'lamp-lux3d', mount: 'e180', orient: 'hug'}]};
const replays = [];
for (const seed of seedArg.split(',').map(Number)) {
  const ai = await simulateV3({fighters: [MINE, FOE], mode: 'A', seed, manual: {sides: ['ai', 'ai']}}), dt = ai.meta.rules.dt;
  const inputs = ai.events.filter(e => e.type === 'press' && e.side === 0).map(e => ({step: Math.round(e.t / dt), side: 0, action: e.action}));
  replays.push(JSON.stringify(await simulateV3({fighters: [MINE, FOE], mode: 'A', seed, manual: {sides: ['input', 'ai'], inputs}})));
}
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}} : {viewport: {width: W, height: H}, deviceScaleFactor: 1, isMobile: true, hasTouch: true});
const page = await ctx.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(`${base}?play=manual&seed=1`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
// A live manual match on the page, frozen, so the HUD and the 冲/挡 pad are laid out as in play.
await page.evaluate(() => window.__top.start());
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
// RADIUS=1.05: the swept disc at the as-built sweep × 1.05 (Wren's ruler; does not shrink when a piece breaks off).
// Default: the reach of the pieces still on (core × 1.4 at least). No glow or outline either way; edges = the viewport.
const out = await page.evaluate(async ([replays, styles, R_AS_BUILT]) => {
  const top = window.__top, st = top.stage;
  top.freeze();
  const {Playback} = await import('/src/playback.js');
  const V = st.camera.position.constructor, dt = 1 / 60, LEAD = 0.05, deg = 180 / Math.PI;
  const o = {x: 0, y: 0}, a = {x: 0, y: 0};
  // The disc a top sweeps about its own (possibly tilted) axis, radius R from its pieces' lowest to highest point, 36
  // points round each rim; nearest distance of any of them to the screen edges [left, right, top, bottom].
  const disc = (f, R, y0, y1) => {
    const e = [Infinity, Infinity, Infinity, Infinity];
    for (let k = 0; k < 36; k++) for (const y of [y0, 0, y1]) {
      st.project(new V(Math.cos(k * Math.PI / 18) * R, y, Math.sin(k * Math.PI / 18) * R).applyQuaternion(f.root.quaternion).add(f.center), a);
      e[0] = Math.min(e[0], a.x); e[1] = Math.min(e[1], st.view.w - a.x); e[2] = Math.min(e[2], a.y); e[3] = Math.min(e[3], st.view.h - a.y);
    }
    return Math.min(...e);
  };
  const sweptEdge = f => {
    let y0 = -st.coreRadius, y1 = st.coreRadius;
    for (const p of f.parts) if (p.alive) { y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1); }
    return disc(f, R_AS_BUILT ? st.frameRadius(f) * R_AS_BUILT : st.reachOf(f), y0, y1);
  };
  const coreEdge = f => disc(f, st.coreRadius, -st.coreRadius, st.coreRadius);
  const grid = [];
  for (let x = -2.4; x <= 2.4; x += 0.2) for (let z = -2.4; z <= 2.4; z += 0.2) if (Math.hypot(x, z) <= 2.4) grid.push(new V(x, 0, z));
  const q = (arr, k) => { const s = [...arr].sort((x, y) => x - y); return s.length ? +s[Math.floor(k * (s.length - 1))].toFixed(2) : null; };
  const res = {};
  for (const style of styles) {
    const yaw = [], pan = [], zoom = [], topV = [], pairs = [], games = [];
    let floorHits = 0, floorFrames = 0;
    for (const json of replays) {
      const r = JSON.parse(json), pb = new Playback(r), fr = r.frames;
      const lerpAt = (t, n) => { const i = pb.frameIndex(t), A = fr[i], B = fr[Math.min(i + 1, fr.length - 1)], k = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0; return new V().fromArray(A.fighters[n].pos).lerp(new V().fromArray(B.fighters[n].pos), k); };
      // The page's live lookahead (main.js): the sim's lead, then a short capped carry-on at the current velocity.
      const look = t => pb.state.fighters.map((s, n) => [0.1].map(d => {
        const lt = Math.min(t + LEAD, pb.end), from = lerpAt(lt, n);
        const p = from.add(s.vel.clone().multiplyScalar(Math.min(0.2, t + d - lt)).clampLength(0, 0.45)), qq = Math.hypot(p.x, p.z);
        if (qq > 2.2) { p.x *= 2.2 / qq; p.z *= 2.2 / qq; }
        return p;
      }));
      st.setCamStyle(style.split(':')[0]);
      // Tuning: 'slow:0.4:0.6' overrides the slow camera's pan and zoom speed factors.
      if (style.includes(':')) [st.panScale, st.zoomScale] = style.split(':').slice(1).map(Number);
      st.setCameraMode('fight');
      st.setFocusOn(null);
      Object.assign(st.cam, {floorHits: 0, floorFrames: 0});
      const {w, h, top: hudTop} = st.view, bottom = st.safeBottom();
      let prev = null, ei = 0, minSwept = Infinity, minCore = Infinity, atSwept = null, outT = 0, nextSample = 0, last = null, prevScr = null;
      for (let t = 0; t <= pb.end; t += dt) {
        pb.seek(t);
        st.pose(pb.state);
        st.setLookahead(look(t));
        st.setPushV4(pb.pushAmount(t));
        // The page's shake triggers (main.js onEvent): chase-camera shake on blows; the framing camera's few-px jolt on a break / KO.
        for (; ei < r.events.length && r.events[ei].t <= t; ei++) {
          const e = r.events[ei];
          if ((e.type === 'hit' || e.type === 'weak') && e.role !== 'recoil') { const core = e.targetPart === 'core'; st.shakeV4(core ? 0.75 : e.type === 'weak' || e.tier >= 2 ? 0.5 : 0.3); }
          else if (e.type === 'break') { st.shakeV4(0.8); st.shake(4); }
          else if (e.type === 'ko') { st.shakeV4(1.1); st.shake(6); }
        }
        st.updateCamera(dt, t === 0);
        st.camera.updateMatrixWorld();
        const c = st.cam, now = {yaw: c.yaw, focus: c.focus.clone(), dist: c.dist};
        if (prev) {
          yaw.push(Math.abs(Math.atan2(Math.sin(now.yaw - prev.yaw), Math.cos(now.yaw - prev.yaw))) * deg / dt);
          pan.push(now.focus.distanceTo(prev.focus) / dt);
          zoom.push(Math.abs(Math.log(now.dist / prev.dist)) / dt);
        }
        prev = now;
        const scr = [];
        let out = false;
        for (const f of st.fighters) {
          if (!f.core.visible) { scr.push(null); continue; }
          st.project(f.center, o); scr.push([o.x, o.y]);
          const se = sweptEdge(f), ce = coreEdge(f);
          if (se < minSwept) { minSwept = se; atSwept = +t.toFixed(2); }
          minCore = Math.min(minCore, ce);
          if (se < 0) out = true;
        }
        if (out) outT += dt;
        if (prevScr) scr.forEach((p, i) => { if (p && prevScr[i]) topV.push(Math.hypot(p[0] - prevScr[i][0], p[1] - prevScr[i][1]) / dt); });
        prevScr = scr;
        if (t >= nextSample - 1e-9) {
          nextSample += 0.1;
          const pts = grid.map(g => { const qq = {x: 0, y: 0}; return st.project(g, qq) ? [qq.x, qq.y] : null; });
          if (last) {
            let n = 0, sx = 0, sy = 0, own = 0;
            last.forEach((p, k) => {
              const qq = pts[k];
              if (!p || !qq || p[0] < 0 || p[0] > w || p[1] < hudTop || p[1] > h - bottom) return;
              n++; sx += qq[0] - p[0]; sy += qq[1] - p[1]; own += Math.hypot(qq[0] - p[0], qq[1] - p[1]);
            });
            pairs.push({m: n ? Math.hypot(sx / n, sy / n) / 0.1 : 0, own: n ? own / n / 0.1 : 0});
          }
          last = pts;
        }
      }
      floorHits += st.cam.floorHits ?? 0; floorFrames += st.cam.floorFrames ?? 0;
      games.push({seed: r.meta.seed, dur: +pb.end.toFixed(1), presses: r.meta.manual.inputs.length, minSweptEdgePx: +minSwept.toFixed(1), at: atSwept, minCoreEdgePx: +minCore.toFixed(1), outS: +outT.toFixed(2)});
    }
    res[style] = {
      camPanPxS: {mean: +(pairs.reduce((x, p) => x + p.m, 0) / pairs.length).toFixed(1), median: q(pairs.map(p => p.m), 0.5), p95: q(pairs.map(p => p.m), 0.95)},
      floorPointPxS: {mean: +(pairs.reduce((x, p) => x + p.own, 0) / pairs.length).toFixed(1), median: q(pairs.map(p => p.own), 0.5)},
      topScreenPxS: {median: q(topV, 0.5), p95: q(topV, 0.95)},
      minSweptEdgePx: Math.min(...games.map(g => g.minSweptEdgePx)), minCoreEdgePx: Math.min(...games.map(g => g.minCoreEdgePx)),
      yawDegS: {median: q(yaw, 0.5), p95: q(yaw, 0.95)}, focusMS: {median: q(pan, 0.5), p95: q(pan, 0.95)}, zoomPerS: {median: q(zoom, 0.5), p95: q(zoom, 0.95)},
      floorLimit: floorFrames ? {hits: floorHits, frames: floorFrames, pct: +(100 * floorHits / floorFrames).toFixed(2)} : null, games};
  }
  return res;
}, [replays, styleArg.split(','), Number(process.env.RADIUS ?? 0)]);
if (out.slow && out.v4) {  // ratios for the shipped 'slow' only
  const r = (k, s) => +(out.slow[k][s] / out.v4[k][s]).toFixed(3);
  out.ratioSlowOverV4 = {yawMedian: r('yawDegS', 'median'), focusMedian: r('focusMS', 'median'), zoomMedian: r('zoomPerS', 'median'), camPanMedian: r('camPanPxS', 'median'), camPanMean: r('camPanPxS', 'mean'), topScreenMedian: r('topScreenPxS', 'median')};
}
if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
