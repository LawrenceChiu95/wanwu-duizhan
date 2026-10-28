// 追拍镜头转多快：同一批回放逐帧（1/60 秒）喂给「原速」（v4）和「慢三成」两种镜头，量镜头偏航角速度（度/秒）和
// 两颗陀螺离屏幕边、离安全区边最近多少 px（sweep：按装好时整颗转起来的半径，碎件后也不缩；live：按还在的件），不渲染，几秒出结果。
// 回放在 Node 里打：手动模式电脑对电脑（同网页默认装法和固定对手，同种子结果固定），可再加自动的。
// 撞击时的追拍震屏照网页的触发量加上（带随机，只影响离边 px 的零头）。需 dev server（npx vite）。
// Usage: /opt/homebrew/bin/node web/scripts/cam-yaw.mjs <baseUrl> [seeds=1..10] [styles=v4,slow] [width=390] [out.json]
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
import {simulateV3} from '../../sim/v3.js';
const [base = 'http://127.0.0.1:4391/', seedArg = '1,2,3,4,5,6,7,8,9,10', styleArg = 'v4,slow', w = '390', outFile] = process.argv.slice(2);
const MINE = {parts: [{item: 'pan-lux3d', mount: 'e0', orient: 'out'}, {item: 'pillow', mount: 'e180', orient: 'hug'}]};
const FOE = {parts: [{item: 'pan-lux3d', mount: 'e0', orient: 'out'}, {item: 'lamp-lux3d', mount: 'e180', orient: 'hug'}]};
const replays = [];
for (const seed of seedArg.split(',').map(Number)) replays.push(JSON.stringify(await simulateV3({fighters: [MINE, FOE], mode: 'A', seed, manual: {sides: ['ai', 'ai']}})));
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}} : {viewport: {width: W, height: H}, deviceScaleFactor: 1, isMobile: true, hasTouch: true});
const page = await ctx.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(`${base}?seed=1`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
// A live manual match on the page, frozen, so the HUD and the 冲/挡 pad are laid out as in play.
await page.evaluate(() => window.__top.start());
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
const out = await page.evaluate(async ([replays, styles]) => {
  const top = window.__top, st = top.stage;
  top.freeze();
  const {Playback} = await import('/src/playback.js');
  const V = st.camera.position.constructor, dt = 1 / 60, LEAD = 0.05, deg = 180 / Math.PI;
  const o = {x: 0, y: 0}, a = {x: 0, y: 0}, b = {x: 0, y: 0};
  // The disc a top sweeps as it spins, about its own (possibly tilted) axis: radius R, from its pieces' lowest to highest
  // point; 36 points round each rim. Returns the nearest distance of any of them to the four edges [left, right, top, bottom].
  const disc = (f, R, y0, y1) => {
    const e = [Infinity, Infinity, Infinity, Infinity];
    for (let k = 0; k < 36; k++) for (const y of [y0, 0, y1]) {
      st.project(new V(Math.cos(k * Math.PI / 18) * R, y, Math.sin(k * Math.PI / 18) * R).applyQuaternion(f.root.quaternion).add(f.center), a);
      e[0] = Math.min(e[0], a.x); e[1] = Math.min(e[1], st.view.w - a.x); e[2] = Math.min(e[2], a.y); e[3] = Math.min(e[3], st.view.h - a.y);
    }
    return e;
  };
  const extent = (f, live) => {
    let R = live ? st.reachOf(f) : st.frameRadius(f), y0 = -st.coreRadius, y1 = st.coreRadius;
    for (const p of f.parts) if (!live || p.alive) { y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1); }
    return disc(f, R, y0, y1);
  };
  // Floor ground truth (as camera-sim.mjs): arena floor points, 10 a second; per pair the mean shift of the visible ones
  // (whole-picture move), the mean of each point's own shift (counts turning too), and top / bottom halves moving opposite.
  const grid = [];
  for (let x = -2.4; x <= 2.4; x += 0.2) for (let z = -2.4; z <= 2.4; z += 0.2) if (Math.hypot(x, z) <= 2.4) grid.push(new V(x, 0, z));
  const res = {};
  for (const style of styles) {
    const rates = [], games = [], pairs = [];
    for (const json of replays) {
      const r = JSON.parse(json), pb = new Playback(r), fr = r.frames;
      const lerpAt = (t, n) => { const i = pb.frameIndex(t), A = fr[i], B = fr[Math.min(i + 1, fr.length - 1)], k = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0; return new V().fromArray(A.fighters[n].pos).lerp(new V().fromArray(B.fighters[n].pos), k); };
      // The page's live lookahead (main.js): the sim's lead, then a short capped carry-on at the current velocity.
      const look = t => pb.state.fighters.map((s, n) => [0.1].map(d => {
        const lt = Math.min(t + LEAD, pb.end), from = lerpAt(lt, n);
        const p = from.add(s.vel.clone().multiplyScalar(Math.min(0.2, t + d - lt)).clampLength(0, 0.45)), q = Math.hypot(p.x, p.z);
        if (q > 2.2) { p.x *= 2.2 / q; p.z *= 2.2 / q; }
        return p;
      }));
      st.setCamStyle(style);
      st.setCameraMode('fight');
      st.setFocusOn(null);
      let prev = null, ei = 0, yawSum = 0, n = 0, minScreen = Infinity, minSafe = Infinity, minScreenLive = Infinity, minSafeLive = Infinity, at = null, atLive = null, outT = 0, run = 0, longest = 0, edges = {};
      const {w, h, top: hudTop} = st.view, bottom = st.safeBottom();
      let nextSample = 0, last = null;
      for (let t = 0; t <= pb.end; t += dt) {
        pb.seek(t);
        st.pose(pb.state);
        st.setLookahead(look(t));
        st.setPushV4(pb.pushAmount(t));
        // The page's chase-camera shake triggers (main.js onEvent).
        for (; ei < r.events.length && r.events[ei].t <= t; ei++) {
          const e = r.events[ei];
          if ((e.type === 'hit' || e.type === 'weak') && e.role !== 'recoil') { const core = e.targetPart === 'core'; st.shakeV4(core ? 0.75 : core || e.type === 'weak' || e.tier >= 2 ? 0.5 : 0.3); }
          else if (e.type === 'break') st.shakeV4(0.8);
          else if (e.type === 'ko') st.shakeV4(1.1);
        }
        st.updateCamera(dt, t === 0);
        st.camera.updateMatrixWorld();
        const yaw = st.cam.yaw;
        if (prev !== null) { const d = Math.abs(Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev))) * deg / dt; rates.push(d); yawSum += d * dt; n++; }
        prev = yaw;
        let outNow = false;
        for (const f of st.fighters) {
          if (!f.core.visible) continue;
          const S = extent(f, false), L = extent(f, true);
          const e = Math.min(...S), el = Math.min(...L);
          if (e < minScreen) { minScreen = e; at = +t.toFixed(2); }
          if (el < minScreenLive) { minScreenLive = el; atLive = +t.toFixed(2); }
          if (el < 0) { outNow = true; const k = ['left', 'right', 'top', 'bottom'][L.indexOf(el)]; edges[k] = (edges[k] ?? 0) + 1; }
          minSafeLive = Math.min(minSafeLive, L[0], L[1], L[2] - hudTop, L[3] - bottom);
          minSafe = Math.min(minSafe, S[0], S[1], S[2] - hudTop, S[3] - bottom);
        }
        if (outNow) { outT += dt; run += dt; longest = Math.max(longest, run); } else run = 0;
        if (t >= nextSample - 1e-9) {
          nextSample += 0.1;
          const pts = grid.map(g => { const q = {x: 0, y: 0}; return st.project(g, q) ? [q.x, q.y] : null; });
          if (last) {
            let n = 0, sx = 0, sy = 0, own = 0, tn = 0, tx = 0, ty = 0, bn = 0, bx = 0, by = 0;
            last.forEach((p, k) => {
              const q = pts[k];
              if (!p || !q || p[0] < 0 || p[0] > w || p[1] < hudTop || p[1] > h - bottom) return;
              const dx = q[0] - p[0], dy = q[1] - p[1];
              n++; sx += dx; sy += dy; own += Math.hypot(dx, dy);
              if (p[1] < (hudTop + h - bottom) / 2) { tn++; tx += dx; ty += dy; } else { bn++; bx += dx; by += dy; }
            });
            const T = tn ? [tx / tn, ty / tn] : [0, 0], B = bn ? [bx / bn, by / bn] : [0, 0];
            pairs.push({m: n ? Math.hypot(sx / n, sy / n) : 0, own: n ? own / n : 0, opp: Math.hypot(...T) >= 1 && Math.hypot(...B) >= 1 && T[0] * B[0] + T[1] * B[1] < 0, game: games.length});
          }
          last = pts;
        }
      }
      games.push({seed: r.meta.seed, dur: +pb.end.toFixed(1), meanDegS: +(yawSum / (n * dt)).toFixed(1), minScreenPx: +minScreen.toFixed(1), at, minSafePx: +minSafe.toFixed(1), live: {minScreenPx: +minScreenLive.toFixed(1), at: atLive, minSafePx: +minSafeLive.toFixed(1), outS: +outT.toFixed(2), longestOutS: +longest.toFixed(2), edges}});
    }
    const s = [...rates].sort((x, y) => x - y), q = k => +s[Math.floor(k * (s.length - 1))].toFixed(1);
    const moving = s.filter(v => v > 1), qm = k => +moving[Math.floor(k * (moving.length - 1))].toFixed(1);
    let worst = 0;
    for (let i = 0; i + 10 <= pairs.length; i++) if (pairs[i].game === pairs[i + 9].game) worst = Math.max(worst, pairs.slice(i, i + 10).reduce((x, p) => x + p.m, 0));
    const floor = {meanPxS: +(pairs.reduce((x, p) => x + p.m, 0) / (pairs.length * 0.1)).toFixed(1), ownMeanPxS: +(pairs.reduce((x, p) => x + p.own, 0) / (pairs.length * 0.1)).toFixed(1),
      worstSecondPx: +worst.toFixed(1), oppositePct: +(100 * pairs.filter(p => p.opp).length / pairs.length).toFixed(1), over30S: +(pairs.filter(p => p.m > 30).length * 0.1).toFixed(1)};
    res[style] = {floor, frames: s.length, all: {median: q(0.5), p75: q(0.75), p90: q(0.9), p95: q(0.95), max: q(1)}, turning: {pct: +(100 * moving.length / s.length).toFixed(1), median: qm(0.5), p95: qm(0.95)},
      meanDegS: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1), minScreenPx: Math.min(...games.map(g => g.minScreenPx)), minSafePx: Math.min(...games.map(g => g.minSafePx)),
      live: {minScreenPx: Math.min(...games.map(g => g.live.minScreenPx)), minSafePx: Math.min(...games.map(g => g.live.minSafePx)), outS: +games.reduce((x, g) => x + g.live.outS, 0).toFixed(2), longestOutS: Math.max(...games.map(g => g.live.longestOutS)), totalS: +games.reduce((x, g) => x + g.dur, 0).toFixed(1)}, games};
  }
  return res;
}, [replays, styleArg.split(',')]);
const styles = Object.keys(out);
if (styles.length === 2) {
  const [A, B] = styles.map(k => out[k]), r = (x, y) => +(y / x).toFixed(3);
  out.ratio = {of: `${styles[1]}/${styles[0]}`, floorMean: r(A.floor.meanPxS, B.floor.meanPxS), floorOwnMean: r(A.floor.ownMeanPxS, B.floor.ownMeanPxS), allMedian: r(A.all.median, B.all.median), allP95: r(A.all.p95, B.all.p95), turningMedian: r(A.turning.median, B.turning.median), turningP95: r(A.turning.p95, B.turning.p95), mean: r(A.meanDegS, B.meanDegS)};
}
if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, (k, v) => k === 'games' ? v.map(g => `${g.seed}:${g.dur}s mean${g.meanDegS} sweep edge${g.minScreenPx}@${g.at} safe${g.minSafePx} | live edge${g.live.minScreenPx}@${g.live.at} safe${g.live.minSafePx} out${g.live.outS}s longest${g.live.longestOutS}s ${JSON.stringify(g.live.edges)}`) : v, 1));
await browser.close();
