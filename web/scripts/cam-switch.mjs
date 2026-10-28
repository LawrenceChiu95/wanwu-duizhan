// 撞击后马上切镜头，会不会再多抖一次（Sol 第 11 版 R1）：陀螺摆在一个固定姿态不动，在镜头 A 下照网页的触发量来一下冲撞命中
// （火花 punch、追拍震屏）和一次碎件震屏，立刻切到镜头 B（有的再切回 A），之后每帧读相机位姿和画面偏移；场面不动，
// 切过去之后的帧应该一动不动（最大相邻帧位移 0）。
// Usage: /opt/homebrew/bin/node web/scripts/cam-switch.mjs <baseUrl>
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4391/'] = process.argv.slice(2);
const browser = await chromium.launch({channel: 'chromium'});
const page = await (await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})).newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(`${base}?play=manual&seed=7`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
await page.evaluate(() => window.__top.start());
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const top = window.__top, st = top.stage, dt = 1 / 60;
  top.freeze();
  const V = st.camera.position.constructor;
  st.setLookahead(null);
  const pose = () => ({p: st.camera.position.clone(), q: st.camera.quaternion.clone(), off: [...st.cam.offset], x: st.camera.view ? [st.camera.view.offsetX, st.camera.view.offsetY] : [0, 0]});
  // Largest change between consecutive frames: camera position (mm), turn (millidegrees), picture offset (px).
  const run = n => {
    let a = pose(), worst = {posMm: 0, turnMdeg: 0, offsetPx: 0};
    for (let i = 0; i < n; i++) {
      st.updateCamera(dt, false); st.camera.updateMatrixWorld();
      const b = pose();
      worst.posMm = Math.max(worst.posMm, a.p.distanceTo(b.p) * 1000);
      worst.turnMdeg = Math.max(worst.turnMdeg, a.q.angleTo(b.q) * 180 / Math.PI * 1000);
      worst.offsetPx = Math.max(worst.offsetPx, Math.hypot(b.x[0] - a.x[0], b.x[1] - a.x[1]), Math.hypot(b.off[0] - a.off[0], b.off[1] - a.off[1]));
      a = b;
    }
    for (const k in worst) worst[k] = +worst[k].toFixed(3);
    return worst;
  };
  const hit = () => {
    const f = st.fighters[1], at = f.center.clone();
    st.punch(at, 11); st.shakeV4(0.75); st.shake(4);  // as main.js: impact() punches 2 + 9 × power, then the chase shake and a break jolt
  };
  const rows = [];
  for (const seq of [['new', 'slow', 'new'], ['v4', 'new'], ['slow', 'v4'], ['new', 'v4'], ['slow', 'new'], ['v4', 'slow']]) {
    st.setCamStyle(seq[0]); st.updateCamera(dt, true); run(30);
    hit();
    const during = run(2);
    const after = [];
    for (const s of seq.slice(1)) {
      st.setCamStyle(s);
      st.updateCamera(dt, false); st.camera.updateMatrixWorld();  // the cut frame
      after.push({to: s, next20: run(20)});
      if (s !== seq.at(-1)) hit(), run(2);
    }
    rows.push({seq: seq.join('→'), jolt: during, after});
  }
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
