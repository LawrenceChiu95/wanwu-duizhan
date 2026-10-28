// Existing local preview only; no build/server/publish.
// nice -n 20 node .../verify-browser.mjs /absolute/web/node_modules/playwright/index.mjs
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {sha256} from './compare.mjs';

assert(process.argv[2], 'Pass the existing Playwright module path; this script never installs it.');
const {chromium} = await import(pathToFileURL(process.argv[2]).href);
const samples=JSON.parse(await readFile(new URL('samples/index.json',import.meta.url),'utf8'));
const browser=await chromium.launch({headless:true});
const receipts=[],errors=[];
try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  for(const pair of samples)for(const e of pair.examples){
    await page.goto(e.url,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__top?.status().phase==='build');
    const before=await page.evaluate(()=>window.__top.status());
    assert.equal(before.seed,pair.seed);assert.equal(before.control,'auto');
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>Boolean(window.__top?.replayJson()),null,{timeout:60000});
    const json=await page.evaluate(()=>window.__top.replayJson());
    const actual=sha256(json);
    assert.equal(actual,e.replaySha256,`Browser replay differs: ${pair.pair}/${e.kind}`);
    receipts.push({pair:pair.pair,kind:e.kind,url:e.url,resolvedUrl:page.url(),seed:before.seed,mine:before.mine,
      sha256:actual,expectedSha256:e.replaySha256,equal:true,winner:JSON.parse(json).meta.winner,duration:JSON.parse(json).meta.duration});
  }
  assert.deepEqual(errors,[]);
  await writeFile(new URL('samples/browser-verification.json',import.meta.url),JSON.stringify({browser:browser.version(),viewport:{width:390,height:844},
    checkedAt:new Date().toISOString(),receipts,errors,scope:'URL parsing, real start click, complete simulated replay; no visual comprehension or phone acceptance'},null,2)+'\n');
}finally{await browser.close();}
console.log(JSON.stringify({browserSamplesIdentical:receipts.length,errors}));
