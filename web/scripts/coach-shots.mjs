// 首局提示 check (MVP §4-1): first match shows the three lines once each (shot as each appears); the second match on
// the same phone shows none. Usage: node scripts/coach-shots.mjs [base=http://127.0.0.1:4392/] [outDir=/tmp/iris-mvp]
import {chromium} from 'playwright';
const [base = 'http://127.0.0.1:4392/', out = '/tmp/iris-mvp'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(String(e)));
const report = {};
for (const [run, url] of [['first', `${base}?seed=7&coach=again`], ['second', `${base}?seed=7`]]) {
  await page.goto(url);
  await page.waitForFunction(() => window.__top?.status().phase === 'build', null, {timeout: 60000});
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => { const c = document.getElementById('coach'); if (!c.hidden) { const t = document.getElementById('coachText').textContent; if (window.__seen.at(-1) !== t) window.__seen.push(t); } })
      .observe(document.getElementById('coach'), {attributes: true, subtree: true, childList: true, characterData: true});
    document.getElementById('goBtn').click();
    window.__bot = setInterval(() => { const s = window.__top.status(); if (s.phase !== 'play' || !s.me) return; if (s.foe?.charging) window.__top.press('block'); else if (s.me.dashIn <= 0 && Math.random() < 0.3) window.__top.press('dash'); }, 80);
  });
  let shot = 0;
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => ({phase: window.__top.status().phase, seen: window.__seen.length, on: !document.getElementById('coach').hidden}));
    if (run === 'first' && st.on && st.seen > shot) { shot = st.seen; await page.screenshot({path: `${out}/coach-${shot}.png`, timeout: 90000}); }
    if (st.phase === 'result') break;
  }
  report[run] = await page.evaluate(() => { clearInterval(window.__bot); return window.__seen; });
}
report.errors = errors;
console.log(JSON.stringify(report, null, 1));
await browser.close();
