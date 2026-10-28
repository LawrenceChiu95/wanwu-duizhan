// 第 13 版「时机算数」画面提示看一遍：自己冲的箭头、对手冲的箭头、冲空、擦边、空挡、完美挡住，各定格截一张。
// 玩法像人：冲好了就冲；对手冲出来时挡（会挡住）；偶尔对手没动也挡（会空挡）。按键走真的点按（无头浏览器）。
// Usage: /opt/homebrew/bin/node web/scripts/v13-shots.mjs <baseUrl> <outDir> [width=390] [seed=7] [extra query, e.g. block=0.3]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4391/', out = '/tmp/v13-shots', w = '390', seedArg = '7', extra = ''] = process.argv.slice(2);
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}, deviceScaleFactor: 1} : {viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage(), logs = [];
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
const status = () => page.evaluate(() => window.__top.status());
const tap = sel => desk ? page.click(sel) : page.tap(sel);
const want = process.env.WANT ? process.env.WANT.split(',') : ['aim-mine', 'aim-foe', 'miss', 'glance', 'empty', 'perfect'], delay = {'aim-mine': 220, 'aim-foe': 220, miss: 120, glance: 90, empty: 90, perfect: 90}, got = {};
const report = {width: W, seed: Number(seedArg), extra};
await page.goto(`${base}?play=manual&seed=${seedArg}${extra ? `&${extra}` : ''}`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
await tap('#goBtn');
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
const arm = () => page.evaluate(([k, d]) => { window.__top.release(); if (k) window.__top.freezeOn(k, d, 1); }, [want.find(k => !got[k]) ?? null, delay[want.find(k => !got[k])] ?? 100]);
await arm();
let s = await status();
for (let guard = 0; s.phase === 'play' && guard < 4000; guard++) {
  if (s.frozen) {
    const kind = want.find(k => !got[k]);
    await page.waitForTimeout(150);
    await page.screenshot({path: `${out}/v13-${kind}-${W}.png`});
    got[kind] = s.t;
    await arm();
  } else if (s.me && s.foe) {
    if (s.foe.dashing && s.me.blockIn === 0 && !s.me.shield) await tap('#blockBtn');
    else if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) await tap('#dashBtn');
    else if (!got.empty && s.me.blockIn === 0 && !s.me.shield && guard % 37 === 0) await tap('#blockBtn');
  }
  await page.waitForTimeout(40);
  s = await status();
  // A kind that has not come up within this match is skipped, so the rest still get their turn.
  if (s.t > 30 && want.find(k => !got[k]) && guard % 200 === 199) { got[want.find(k => !got[k])] = null; await arm(); }
}
await page.evaluate(() => window.__top.release());
await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 180000});
report.blockTime = (await status()).meta?.manual?.blockTime ?? null;
report.got = got;
report.logs = logs.slice(0, 20);
await writeFile(`${out}/v13-${W}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
