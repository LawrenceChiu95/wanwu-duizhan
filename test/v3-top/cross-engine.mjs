// 同一局在 Chrome 和 Node 里算出来是否逐字节一致：随机 N 局陀螺装法（含网页固定对手），比 sha256。
// 需要先在仓库根目录起静态服务：python3 -m http.server 4488 --bind 127.0.0.1
// Usage: /opt/homebrew/bin/node test/v3-top/cross-engine.mjs [games=24]
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {createHash} from 'node:crypto';
import {simulateV3} from '../../sim/v3.js';
import {LOADOUTS, FOE} from './loadouts.mjs';
import {random} from '../../sim/math.js';
const games = Number(process.argv[2] ?? 24), pick = random(1028), cases = [];
for (let g = 0; g < games; g++) cases.push({fighters: [LOADOUTS[Math.floor(pick() * LOADOUTS.length)], g % 3 === 0 ? FOE : LOADOUTS[Math.floor(pick() * LOADOUTS.length)]], mode: g % 5 === 4 ? 'B' : 'A', seed: 100 + g});
const node = [];
for (const c of cases) node.push(createHash('sha256').update(JSON.stringify(await simulateV3(c))).digest('hex'));
const browser = await chromium.launch({channel: 'chrome', headless: true});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4488/test/v3/browser-check.html');
await page.waitForFunction(() => window.verification);
const chrome = await page.evaluate(async cases => {
  const {simulateV3} = await import('/sim/v3.js'), out = [];
  for (const c of cases) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(await simulateV3(c)))); out.push([...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('')); }
  return {out, ua: navigator.userAgent};
}, cases);
await browser.close();
const mismatched = cases.map((c, i) => ({i, seed: c.seed, mode: c.mode, equal: node[i] === chrome.out[i]})).filter(x => !x.equal);
console.log(JSON.stringify({games, node: process.version, chrome: chrome.ua.match(/Chrome\/[\d.]+/)?.[0], equal: games - mismatched.length, mismatched}, null, 1));
if (mismatched.length) process.exit(1);
