// 手动模式看一遍：装配（手动已选）、打斗中按钮（一个冷却一个就绪）、冲撞命中、冲撞被挡住、结算；
// 打完把这局在浏览器里实时按出来的回放，拿它记下的按键在 Node 里重算，比 sha256（逐字节一致才算过）。
// 按键走真的触摸点按（Playwright tap，无头浏览器，不碰本机屏幕）。
// Usage: /opt/homebrew/bin/node web/scripts/manual-shots.mjs <baseUrl> <outDir> [width=390] [seed=7]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {simulateV3} from '../../sim/v3.js';
const [base = 'http://127.0.0.1:4377/', out = '/tmp/manual-shots', w = '390', seedArg = '7'] = process.argv.slice(2);
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}, deviceScaleFactor: 1} : {viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage(), logs = [];
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
const status = () => page.evaluate(() => window.__top.status());
const shot = name => page.screenshot({path: `${out}/${name}-${W}.png`});
const tap = sel => desk ? page.click(sel) : page.tap(sel);
const report = {width: W, seed: Number(seedArg)};
await page.goto(`${base}?play=manual&seed=${seedArg}`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
await page.waitForTimeout(800);
await shot('m1-build');
await tap('#goBtn');
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});

// Play like a person: lunge when 冲 is ready, raise 挡 when the computer winds up. Grab the moments on the way.
// The dash shot wants the player's own lunge landing clean on the computer's core (a hit on a hugging part also shows the part's 「挡住」).
const want = ['dash-core', 'parry'], got = {};
let s = await status(), pressedFight = false;
await page.evaluate(k => window.__top.freezeOn(k, 140, 1), want[0]);
for (let guard = 0; s.phase === 'play' && guard < 3000; guard++) {
  if (s.frozen) {
    const kind = want.find(k => !got[k]);
    await page.waitForTimeout(150);
    await shot(kind === 'dash-core' ? 'm3-dash-hit' : 'm4-parry');
    got[kind] = s.t;
    const next = want.find(k => !got[k]);
    await page.evaluate(k => { window.__top.release(); if (k) window.__top.freezeOn(k, 120, 1); }, next ?? null);
  } else if (s.me && s.foe) {
    if (s.foe.charging && s.me.blockIn === 0 && !s.me.shield) await tap('#blockBtn');
    else if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) await tap('#dashBtn');
    // One frame with the buttons in both states (one cooling, one ready) for the fight shot.
    if (!pressedFight && s.t > 6 && (s.me.dashIn > 1.5) !== (s.me.blockIn > 1.5)) { await shot('m2-fight'); pressedFight = true; report.fightShotAt = s.t; }
  }
  await page.waitForTimeout(40);
  s = await status();
}
report.got = got;
await page.evaluate(() => window.__top.release());
await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 180000});
await page.waitForTimeout(1500);
await shot('m5-result');
s = await status();
report.result = {winner: s.meta.winner, reason: s.meta.reason, duration: s.meta.duration, line: s.reason, presses: s.inputs.length};
// Determinism: the replay the browser built live, against Node re-simulating only its recorded presses.
const json = await page.evaluate(() => window.__top.replayJson()), browserReplay = JSON.parse(json);
const again = await simulateV3({fighters: browserReplay.meta.initial.map(f => f.definition), mode: browserReplay.meta.mode, seed: browserReplay.meta.seed, manual: {sides: ['input', 'ai'], inputs: browserReplay.meta.manual.inputs}});
const h = x => createHash('sha256').update(x).digest('hex');
report.determinism = {browserLive: h(json), nodeFromPresses: h(JSON.stringify(again)), equal: h(json) === h(JSON.stringify(again)), presses: browserReplay.meta.manual.inputs.length};
report.logs = logs.slice(0, 20);
await writeFile(`${out}/manual-${W}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
