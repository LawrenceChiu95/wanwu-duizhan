// 手感版截图：手动模式里打一局，截「打斗中」「自己冲中了」「挡住冲（弹开）」三张；电脑和手机各一套。
// 页面里装一个像人一样按的小循环（冲好了隔一会儿就冲；电脑蓄力时多半举挡），用 __top.freezeOn 在那一下定格再截。
// Usage: /opt/homebrew/bin/node web/scripts/feel-shots.mjs <baseUrl> <outDir> [width=390] [seed=7]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4471/', out = './shots', w = '390', seedArg = '7'] = process.argv.slice(2);
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}, deviceScaleFactor: 1} : {viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage(), logs = [];
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
const status = () => page.evaluate(() => window.__top.status());
const shot = name => page.screenshot({path: `${out}/${W}-${name}.png`});
await page.goto(`${base}?play=manual&seed=${seedArg}`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const top = window.__top;
  let wait = 0, seen = false, last = performance.now();
  const loop = now => {
    const dt = (now - last) / 1000;
    last = now;
    const s = top.status();
    if (s.phase === 'play' && !s.frozen && s.me && s.foe) {
      if (s.foe.charging && !seen) { seen = true; if (Math.random() < 0.85 && s.me.blockIn === 0) top.press('block'); }
      if (!s.foe.charging) seen = false;
      if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) { if (wait <= 0) wait = 0.2 + Math.random() * 0.6; else if ((wait -= dt) <= 0) top.press('dash'); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
await page.click('#goBtn');
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
const report = {width: W, seed: Number(seedArg), shots: {}};
// Mid-fight: about six seconds in, whatever is happening.
await page.waitForTimeout(6000);
await page.evaluate(() => window.__top.freeze());
await page.waitForTimeout(200);
await shot('1-fight');
report.shots.fight = (await status()).t;
// The player's own lunge landing (prefer one on the core), then a parry.
for (const [name, kind, delay] of [['2-dash-hit', 'dash-mine', 70], ['3-parry', 'parry', 110]]) {
  await page.evaluate(([k, d]) => { window.__top.release(); window.__top.freezeOn(k, d, 1); }, [kind, delay]);
  let s = await status();
  for (const t0 = Date.now(); !s.frozen && s.phase === 'play' && Date.now() - t0 < 90000; s = await status()) await page.waitForTimeout(50);
  if (!s.frozen) { report.shots[name] = null; continue; }
  await page.waitForTimeout(200);
  await shot(name);
  report.shots[name] = s.t;
}
await page.evaluate(() => window.__top.release());
report.logs = logs.slice(0, 20);
await writeFile(`${out}/${W}-shots.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
