// 第 13 版整场半圈：同一种子三个镜头的开场、自己空挡各截一张；整局打完核回放和刷新后转没转一致。
// Usage: /opt/homebrew/bin/node web/scripts/half-turn-shots.mjs <baseUrl> <outDir> [width=390] [seeds=1,101] [feel]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {simulateV3} from '../../sim/v3.js';
const [base = 'http://127.0.0.1:4391/', out = '/tmp/half-turn', w = '390', seedsArg = '1,101', feel = ''] = process.argv.slice(2);
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}, deviceScaleFactor: 1} : {viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage(), logs = [];
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
const status = () => page.evaluate(() => window.__top.status());
const tap = sel => desk ? page.click(sel) : page.tap(sel);
const h = x => createHash('sha256').update(x).digest('hex');
const start = async url => {
  await page.goto(url);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
  await tap('#goBtn');
  await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
};
const report = {width: W, seeds: {}, logs};
for (const seed of seedsArg.split(',').map(Number)) {
  const r = report.seeds[seed] = {};
  for (const cam of ['slow', 'v4', 'new']) {
    const url = new URL(base);
    url.searchParams.set('play', 'manual'); url.searchParams.set('seed', seed);
    if (cam !== 'slow') url.searchParams.set('cam', cam); else url.searchParams.delete('cam');
    if (feel) url.searchParams.set('feel', feel);
    await start(url.href);
    await page.waitForTimeout(500);
    await page.screenshot({path: `${out}/s${seed}-${cam}-open-${W}.png`});
    // Own prompt: an empty 挡 while the opponent is not lunging (the 冲 arrow: v13-shots.mjs WANT=aim-mine with this seed).
    await page.evaluate(() => window.__top.freezeOn('empty', 90, 1));
    await page.waitForFunction(() => { const s = window.__top.status(); return s.me && s.me.blockIn === 0 && !s.me.shield && !s.foe.dashing && !s.foe.charging; }, null, {timeout: 30000});
    await tap('#blockBtn');
    r[`${cam}EmptyFrozen`] = await page.waitForFunction(() => window.__top.status().frozen, null, {timeout: 10000}).then(() => true, () => false);
    await page.waitForTimeout(150);
    await page.screenshot({path: `${out}/s${seed}-${cam}-empty-${W}.png`});
    await page.evaluate(() => window.__top.release());
    if (cam !== 'slow') continue;
    // Finish this one by hand-ish play, then check the replay and a reload.
    let s = await status();
    for (let g = 0; s.phase === 'play' && g < 6000; g++) {
      if (s.me && s.foe) {
        if (s.foe.dashing && s.me.blockIn === 0 && !s.me.shield) await tap('#blockBtn');
        else if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) await tap('#dashBtn');
      }
      await page.waitForTimeout(40);
      s = await status();
    }
    await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 180000});
    const json = await page.evaluate(() => window.__top.replayJson()), rep = JSON.parse(json);
    const again = await simulateV3({fighters: rep.meta.initial.map(f => f.definition), mode: rep.meta.mode, seed: rep.meta.seed, manual: rep.meta.manual, feel: rep.meta.feel, feelRules: rep.meta.feelRules});
    r.halfTurn = rep.meta.openingHalfTurn;
    r.startX = rep.meta.initial.map(f => +f.pos[0].toFixed(3));
    r.replayEqual = h(json) === h(JSON.stringify(again));
    r.nodeHalfTurn = again.meta.openingHalfTurn;
    r.presses = rep.meta.manual.inputs.length;
    await page.reload();
    await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
    await tap('#goBtn');
    await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
    await page.evaluate(() => { window.__top.speed?.(8); });
    r.reloadUrl = page.url();
    await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 300000});
    r.reloadHalfTurn = (await status()).meta.openingHalfTurn;
  }
}
await writeFile(`${out}/half-turn-${W}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
