// 评委版 opening card (judge-intro.html): the replayed flip-flop's 3D as a still, drawn by the page's own card renderer
// at the turntable's starting angle, like data/stills. Run again after changing its model. Needs the judge dev server:
// npm run dev:judge, then  node scripts/make-showcase-still.mjs [base=http://127.0.0.1:4330/] [size=600] [turn=0.7]
// (turn: radians from its front, the styled picture's angle, so the still shows it has thickness)
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4330/', size = '600', turn = '0.7'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1000, height: 1000}, deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
const url = await page.evaluate(([size, turn]) => window.__top.still('showcase-flipflop', size, turn), [Number(size), Number(turn)]);
if (!url.startsWith('data:image/webp')) throw Error('not a WebP');
const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
await writeFile(new URL('../../data/showcase/flipflop/still.webp', import.meta.url), bytes);
console.log(JSON.stringify({size: Number(size), turn: Number(turn), kb: +(bytes.length / 1024).toFixed(1), errors}));
await browser.close();
if (errors.length) process.exit(1);
