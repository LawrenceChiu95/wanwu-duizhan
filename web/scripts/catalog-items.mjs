// 拼装页读 catalog 的物品清单：打开选择器记下全部选项，再逐件把新加的东西从选择器装到第一件、打完一局（真点按冲/挡），
// 截选择器、拼装页、结算三张；全程查页面文字里有没有 undefined，以及页面报错。
// Usage: /opt/homebrew/bin/node web/scripts/catalog-items.mjs <baseUrl> <outDir> [width=390] [seed=7] [ids=新加的全部，逗号分隔]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4330/', out = '/tmp/catalog-items', w = '390', seedArg = '7', idsArg = ''] = process.argv.slice(2);
const W = Number(w), desk = W >= 900, H = desk ? 900 : Math.round(W * 844 / 390);
const ORIGINAL = ['锅', '扫把', '台灯', '剪刀', '拖鞋', '枕头'];
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext(desk ? {viewport: {width: W, height: H}, deviceScaleFactor: 1} : {viewport: {width: W, height: H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const tap = (page, sel) => desk ? page.click(sel) : page.tap(sel);
const report = {width: W, seed: Number(seedArg), matches: []};

async function open() {
  const page = await ctx.newPage(), logs = [];
  page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  await page.goto(`${base}?play=manual&seed=${seedArg}`);
  await page.waitForFunction(() => window.__top?.status().phase === 'build' || !document.getElementById('error').hidden, null, {timeout: 120000});
  const error = await page.$eval('#error', e => e.hidden ? null : e.textContent);
  return {page, logs, error};
}
const sheetLabels = page => page.$$eval('#sheetGrid button', bs => bs.map(b => ({name: b.querySelector('b').textContent, html: b.querySelector('b').innerHTML, disabled: b.disabled})));
const undefinedText = page => page.evaluate(() => document.body.innerText.includes('undefined'));

// 1. The list as the picker shows it.
{
  const {page, logs, error} = await open();
  report.loadError = error;
  if (!error) {
    await tap(page, '[data-pick="0"]');
    await page.waitForSelector('#sheet:not([hidden])');
    await page.waitForTimeout(600);
    report.offer = await sheetLabels(page);
    report.originalOrderKept = JSON.stringify(report.offer.slice(0, 6).map(o => o.name)) === JSON.stringify(ORIGINAL);
    await page.screenshot({path: `${out}/sheet-${W}.png`});
  }
  report.logs = logs.slice(0, 20);
  await page.close();
}
const ids = idsArg ? idsArg.split(',') : null;
const added = (report.offer ?? []).slice(6).map(o => o.name);

// 2. Each added item: picked through the sheet, one full match.
for (const name of ids ?? added) {
  const {page, logs} = await open();
  const m = {name, undefinedSeen: false};
  await tap(page, '[data-pick="0"]');
  await page.waitForSelector('#sheet:not([hidden])');
  const buttons = await page.$$('#sheetGrid button');
  let picked = false;
  for (const b of buttons) if (await b.$eval('b', e => e.textContent) === name) { await (desk ? b.click() : b.tap()); picked = true; break; }
  m.picked = picked;
  if (picked) {
    await page.waitForFunction(() => window.__top.status().phase === 'build');
    await page.waitForTimeout(600);
    m.slotName = await page.$eval('.slot[data-slot="0"] .item b', e => e.textContent);
    await page.screenshot({path: `${out}/build-${name}-${W}.png`});
    await tap(page, '#goBtn');
    await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
    let s = await page.evaluate(() => window.__top.status());
    for (let guard = 0; s.phase === 'play' && guard < 4000; guard++) {
      if (s.me && s.foe) {
        if (s.foe.dashing && s.me.blockIn === 0 && !s.me.shield) await tap(page, '#blockBtn');
        else if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) await tap(page, '#dashBtn');
      }
      if (guard % 10 === 0 && await undefinedText(page)) m.undefinedSeen = true;
      await page.waitForTimeout(40);
      s = await page.evaluate(() => window.__top.status());
    }
    await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 180000});
    await page.waitForTimeout(800);
    if (await undefinedText(page)) m.undefinedSeen = true;
    const st = await page.evaluate(() => window.__top.status());
    m.result = {winner: st.meta?.winner ?? null, duration: st.meta?.duration ?? null, reason: st.meta?.reason ?? null};
    m.whyLine = await page.$eval('#whyLine', e => e.textContent);
    await page.screenshot({path: `${out}/result-${name}-${W}.png`});
  }
  m.logs = logs.slice(0, 20);
  report.matches.push(m);
  await page.close();
}
await writeFile(`${out}/catalog-items-${W}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
await browser.close();
