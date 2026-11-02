// Fight labels against the 「你」 tag, every frame of a whole fight (PR #18 S2: the old check sampled every ~60 ms and
// skipped the first 6 s). A requestAnimationFrame loop in the page checks each frame from the fight's first to the
// 决胜 replay. It is installed while still on the build screen, before 开打 is pressed, so the first fight frame is
// not missed (task #46); phasesBeforeFight counts the frames it saw before the fight (build screen, then computing) as proof it was already running. Each frame: does any shown callout (opacity > 0.3) overlap 「你」 while 「你」 is shown (opacity > 0.2)? The first 6 s
// are hands-off (the first coach line has to wait), then a bot dashes and blocks. Then, with the 决胜 caption up, the
// credits link must be out of reach: not focusable, Enter on it opens nothing (PR #18 S1).
// Writes <outDir>/label-overlap-<W>.json; exits 1 on any overlap frame or a reachable link.
// Usage (from web/, dev server up): /opt/homebrew/bin/node scripts/label-overlap.mjs [base=http://127.0.0.1:4392/] [outDir=/tmp/iris-overlap] [W=390] [H=844]
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
const [base = 'http://127.0.0.1:4392/', out = '/tmp/iris-overlap', W = '390', H = '844'] = process.argv.slice(2);
await mkdir(out, {recursive: true});
const w = Number(W), h = Number(H);
const browser = await chromium.launch({channel: 'chromium'});
const ctx = await browser.newContext({viewport: {width: w, height: h}, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: w < 900});
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}?coach=again&seed=7&mine=pan-lux3d,out,pillow,hug,e180`);
await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 120000});
await page.evaluate(() => {
  const log = window.__overlap = {framesBeforeFight: 0, phasesBeforeFight: {}, frames: 0, meShown: 0, calls: 0, hits: [], done: false};
  let t0 = null;
  const frame = () => {
    const phase = window.__top.status().phase;
    if (t0 === null && phase !== 'play') { log.framesBeforeFight++; log.phasesBeforeFight[phase] = (log.phasesBeforeFight[phase] ?? 0) + 1; requestAnimationFrame(frame); return; }
    t0 ??= performance.now();
    if (phase !== 'play') { log.done = true; log.endPhase = phase; log.seconds = +((performance.now() - t0) / 1000).toFixed(2); return; }
    log.frames++;
    const me = document.querySelector('.me'), mo = +getComputedStyle(me).opacity;
    const calls = [...document.querySelectorAll('.call')].filter(c => +getComputedStyle(c).opacity > 0.3);
    if (calls.length) log.calls++;
    if (mo > 0.2) {
      log.meShown++;
      const m = me.getBoundingClientRect();
      const hit = calls.find(c => { const r = c.getBoundingClientRect(); return r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top; });
      if (hit && log.hits.length < 50) log.hits.push({s: +((performance.now() - t0) / 1000).toFixed(3), me: +mo.toFixed(2), call: hit.textContent});
      if (hit) log.hitFrames = (log.hitFrames ?? 0) + 1;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});
await page.waitForFunction(() => window.__overlap.framesBeforeFight > 0);
await page.click('#goBtn');
await page.waitForFunction(() => window.__top.status().phase === 'play', null, {timeout: 120000});
// Fight frames already checked by the time the script itself sees the fight: what installing the check only then would miss.
await page.evaluate(() => { window.__overlap.framesWhenScriptSawFight = window.__overlap.frames; });
await page.waitForTimeout(6000);
await page.evaluate(() => { window.__top.press('dash'); window.__bot = setInterval(() => { const s = window.__top.status(); if (s.phase !== 'play' || !s.me) return; if (s.foe?.charging) window.__top.press('block'); else if (s.me.dashIn <= 0) window.__top.press('dash'); }, 50); });
await page.waitForFunction(() => window.__overlap.done, null, {timeout: 300000});
await page.evaluate(() => clearInterval(window.__bot));
const overlap = await page.evaluate(() => window.__overlap);
// The 决胜 caption: the link must be unseen and out of keyboard reach.
const captionUp = await page.waitForFunction(() => document.querySelector('#caption').classList.contains('on'), null, {timeout: 30000}).then(() => true, () => false);
const link = captionUp ? await page.evaluate(() => {
  const b = document.querySelector('#creditsBtn'); b.focus();
  return {visibility: getComputedStyle(b).visibility, focused: document.activeElement === b};
}) : null;
if (captionUp) { await page.keyboard.press('Enter'); link.creditsOpened = await page.evaluate(() => !document.querySelector('#credits').hidden); }
await page.screenshot({path: `${out}/label-overlap-${W}-caption.png`});
await page.waitForFunction(() => window.__top.status().phase === 'result', null, {timeout: 60000});
const after = await page.evaluate(() => { const b = document.querySelector('#creditsBtn'); b.focus(); return {visibility: getComputedStyle(b).visibility, focused: document.activeElement === b}; });
await browser.close();
const failures = [];
if (!overlap.phasesBeforeFight.build) failures.push('frame check was not running before the fight started');
if (overlap.hitFrames) failures.push(`${overlap.hitFrames} frame(s) with a callout over 「你」`);
if (!captionUp) failures.push('决胜 caption never came up');
else if (link.focused || link.creditsOpened || link.visibility !== 'hidden') failures.push('credits link reachable under the 决胜 caption');
if (!after.focused) failures.push('credits link not reachable on the result screen');
if (errors.length) failures.push('page errors');
const report = {W: w, H: h, overlap, captionUp, linkUnderCaption: link, linkOnResult: after, errors, failures};
await writeFile(`${out}/label-overlap-${W}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (failures.length) { console.error(failures.join('; ')); process.exitCode = 1; }
