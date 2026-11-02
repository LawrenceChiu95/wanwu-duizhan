// Card stills (task #39): each offered catalog item at the turntable's starting angle, drawn by the page's own card
// renderer (same camera, lights and environment as the turning model that fades in over it), saved as
// data/stills/<id>.webp. Photographed items show their styled picture instead and get none.
// Run again after adding or changing a model. Needs the dev server: npm run dev, then
//   node scripts/make-stills.mjs [base=http://127.0.0.1:4330/] [size=360]
import {chromium} from 'playwright';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4330/', size = '360'] = process.argv.slice(2);
const root = new URL('../../', import.meta.url);
const {items} = JSON.parse(await readFile(new URL('data/catalog.json', root), 'utf8'));
const replaced = new Set(items.map(i => i.comparisonBase).filter(Boolean));
const ids = items.filter(i => !replaced.has(i.id) && !i.origin?.styled).map(i => i.id);
const browser = await chromium.launch();
// Large enough a stage canvas to draw a still of `size` device pixels in its corner.
const page = await browser.newPage({viewport: {width: 1000, height: 1000}, deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
await mkdir(new URL('data/stills/', root), {recursive: true});
const report = {};
for (const id of ids) {
  const url = await page.evaluate(([id, size]) => window.__top.still(id, size), [id, Number(size)]);
  const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  if (!url.startsWith('data:image/webp')) throw Error(`${id}: not a WebP`);
  await writeFile(new URL(`data/stills/${id}.webp`, root), bytes);
  report[id] = `${(bytes.length / 1024).toFixed(1)} KB`;
}
console.log(JSON.stringify({size: Number(size), stills: report, errors}, null, 1));
await browser.close();
if (errors.length) process.exit(1);
