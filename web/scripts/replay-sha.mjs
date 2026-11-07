// 自动版回放没变：网页里算出的整局回放（JSON）和 Node 里同装法、同种子 simulateV3 的结果比 sha256，逐字节一致才算过。
// 网页只改了画面和反馈，回放应和改之前（main 上同一个 sim/）完全一样；这里同时打印 sha，可和 main 上跑出的对照。
// 页面只剩手动（10-28），自动对打用 play=auto 打开。
// Usage: /opt/homebrew/bin/node web/scripts/replay-sha.mjs <baseUrl> [seeds=7,42] [mine=pan-lux3d,out,pillow,hug,e180] [feel]
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {simulateV3} from '../../sim/v3.js';
const [base = 'http://127.0.0.1:4471/', seeds = '7,42', mine = 'pan-lux3d,out,pillow,hug,e180', feel = ''] = process.argv.slice(2);
const h = x => createHash('sha256').update(x).digest('hex');
const browser = await chromium.launch({channel: 'chromium'});
const page = await browser.newPage({viewport: {width: 390, height: 844}});
const rows = [];
for (const seed of seeds.split(',').map(Number)) {
  const url = new URL(base);
  url.searchParams.set('mine', mine); url.searchParams.set('seed', seed); url.searchParams.set('play', 'auto');
  if (feel) url.searchParams.set('feel', feel);
  await page.goto(url.href);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
  await page.evaluate(() => window.__top.start());
  await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 120000});
  const json = await page.evaluate(() => window.__top.replayJson());
  const r = JSON.parse(json);
  const again = await simulateV3({fighters: r.meta.initial.map(f => f.definition), mode: r.meta.mode, seed: r.meta.seed, feel: r.meta.feel, feelRules: r.meta.feelRules, combat: r.meta.combat, combatRules: r.meta.combatRules});
  rows.push({seed, mine, browser: h(json), node: h(JSON.stringify(again)), equal: h(json) === h(JSON.stringify(again)), duration: r.meta.duration, winner: r.meta.winner});
}
await browser.close();
console.log(JSON.stringify(rows, null, 1));
if (!rows.every(r => r.equal)) process.exit(1);
