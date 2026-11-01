// 看它怎么来的 check (MVP §4-4) with a stand-in record until the generation script writes real ones: the lamp (not loaded
// yet when its card is clicked, so the 3D step has to turn in once the model arrives) gets a
// drawn "photo" and "styled image" and 3 / 24 / 62 s steps; open it from its 角色库 card, shoot steps 1 and 3, then 装上它.
// Usage: node scripts/how-shots.mjs [base=http://127.0.0.1:4392/] [outDir=/tmp/iris-mvp]
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4392/', out = '/tmp/iris-mvp'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto(base);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
await page.evaluate(() => {
  const pic = (bg, fg, label) => { const c = document.createElement('canvas'); c.width = 480; c.height = 480; const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 480, 480); g.fillStyle = fg; g.beginPath(); g.ellipse(220, 250, 150, 95, 0, 0, 7); g.fill(); g.fillRect(340, 235, 120, 28);
    g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.fillText(label, 20, 450); return c.toDataURL('image/jpeg', 0.8); };
  window.__top.setOrigin('lamp-lux3d', {photo: pic('#8a7f70', '#3b3633', '原照（示例）'), styled: pic('#1d2a3a', '#c76a2a', '改图（示例）'),
    steps: [{key: 'photo', seconds: 3}, {key: 'styled', seconds: 24}, {key: 'model', seconds: 62}]});
});
await page.evaluate(() => document.querySelector('[data-pick="1"]').click());
await page.waitForSelector('#library:not([hidden])');
await page.evaluate(() => document.querySelector('.card[data-item="lamp-lux3d"] [data-how]').click());
await page.waitForSelector('#howView:not([hidden])');
await page.waitForTimeout(1500);
await page.screenshot({path: `${out}/how-1-${390}.png`, timeout: 90000});
await page.waitForTimeout(8000);
const turned = await page.evaluate(() => document.getElementById('howTurn').style.backgroundImage.startsWith('url('));
await page.screenshot({path: `${out}/how-3-${390}.png`, timeout: 90000});
const view = await page.evaluate(() => ({title: document.getElementById('howTitle').textContent, total: document.getElementById('howTotal').textContent,
  steps: [...document.querySelectorAll('#howSteps li')].map(li => li.textContent.trim().replace(/\s+/g, ' ')), equip: document.querySelector('#howEquip span').textContent}));
// Opened from the right slot with the lamp free, 装上它 installs it and closes.
const before = await page.evaluate(() => window.__top.status().mine.parts.map(p => p.item));
await page.evaluate(() => document.getElementById('howEquip').click());
await page.waitForTimeout(300);
const stillOpen = await page.evaluate(() => !document.getElementById('howView').hidden);
console.log(JSON.stringify({errors, turned, view, before, stillOpen}, null, 1));
await browser.close();
