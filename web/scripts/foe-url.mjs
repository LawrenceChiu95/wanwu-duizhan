// Usage: node web/scripts/foe-url.mjs <baseUrl> <outDir>
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {simulateV3} from '../../sim/v3.js';

const [base = 'http://127.0.0.1:4330/', out = '/tmp/foe-url'] = process.argv.slice(2);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const report = {matches: [], rejected: []};
const sha = value => createHash('sha256').update(value).digest('hex');
const def = (first, orient, second, other, mount) => ({parts: [{item: first, mount: 'e0', orient}, {item: second, mount, orient: other}]});
const mine = def('pan-lux3d', 'out', 'pillow', 'hug', 'e180');
const defaults = def('pan-lux3d', 'out', 'lamp-lux3d', 'hug', 'e180');

try {
  for (const c of [
    {name: 'default', query: 'play=auto', expected: defaults, labels: ['锅', '台灯']},
    {name: 'pot-v-broom', query: 'play=auto&foe=broom,out,pillow,hug,e180', expected: def('broom', 'out', 'pillow', 'hug', 'e180'), labels: ['扫把', '枕头']},
    {name: 'generated-manual', query: 'play=manual&foe=wasteland-broom,hug,wasteland-pot,out,e90', expected: def('wasteland-broom', 'hug', 'wasteland-pot', 'out', 'e90'), labels: ['废土扫把', '废土锅']}
  ]) {
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}?seed=7&${c.query}`);
    await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
    assert.deepEqual(await page.$$eval('#foeParts span', spans => spans.map(s => s.textContent)), c.labels);
    await page.waitForTimeout(400);
    await page.screenshot({path: `${out}/${c.name}-build.png`});
    await page.tap('#goBtn');
    await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 60000});
    if (c.query.startsWith('play=auto')) {
      await page.evaluate(() => window.__top.trackSafe(12));
    } else {
      for (let n = 0; n < 3000; n++) {
        const s = await page.evaluate(() => window.__top.status());
        if (s.phase === 'result') break;
        if (s.me && s.foe) {
          if (s.foe.dashing && s.me.blockIn === 0 && !s.me.shield) await page.tap('#blockBtn');
          else if (s.me.dashIn === 0 && !s.me.charging && !s.me.dashing) await page.tap('#dashBtn');
        }
        await page.waitForTimeout(40);
      }
    }
    await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 120000});
    const raw = await page.evaluate(() => window.__top.replayJson()), replay = JSON.parse(raw);
    assert.deepEqual(replay.meta.initial.map(f => f.definition), [mine, c.expected]);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('undefined')), false);
    assert.deepEqual(errors, []);
    let nodeSha = null;
    if (c.query.startsWith('play=auto')) {
      const node = JSON.stringify(await simulateV3({fighters: [mine, c.expected], mode: 'A', seed: 7}));
      assert.equal(raw, node); nodeSha = sha(node);
    } else assert.ok(replay.meta.manual.inputs.length > 0);
    await writeFile(`${out}/${c.name}-replay.json`, raw);
    await page.screenshot({path: `${out}/${c.name}-result.png`});
    report.matches.push({name: c.name, definitions: replay.meta.initial.map(f => f.definition), duration: replay.meta.duration, replaySha256: sha(raw), nodeSha256: nodeSha, errors});
    await page.close();
  }

  for (const query of [
    'foe=', 'foe=broom,out', 'foe=missing,out,pillow,hug,e180',
    'foe=broom,out,broom,hug,e180', 'foe=broom,wrong,pillow,hug,e180',
    'foe=broom,out,pillow,wrong,e180', 'foe=broom,out,pillow,hug,e45',
    'foe=broom,out,pillow,hug,e180,extra', 'foe=broom,out,pillow,hug,e180&foe=broom,out,pillow,hug,e90'
  ]) {
    const page = await ctx.newPage();
    await page.goto(`${base}?seed=7&${query}`);
    await page.waitForSelector('#error:not([hidden])', {timeout: 60000});
    const error = await page.$eval('#error', e => e.textContent);
    assert.match(error, /foe参数无效/);
    assert.equal(await page.$eval('#busy', e => e.hidden), true);
    assert.equal(await page.evaluate(() => Boolean(window.__top)), false);
    report.rejected.push({query, error});
    if (query === 'foe=') await page.screenshot({path: `${out}/invalid.png`});
    await page.close();
  }
  await writeFile(`${out}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({matches: report.matches.length, rejected: report.rejected.length, errors: []}));
} finally {await browser.close();}
