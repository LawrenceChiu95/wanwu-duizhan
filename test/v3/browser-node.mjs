import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import assert from'node:assert/strict';
import{simulateV3}from'../../sim/v3.js';import{definition}from'./probe.mjs';
const browser=JSON.parse(await readFile(new URL('./browser.json',import.meta.url),'utf8'));
assert.equal(browser.error,undefined);assert.equal(browser.items,8);assert.deepEqual(browser.pageErrors,[]);const results=[];
for(const example of browser.results){const {left,right,mode,seed}=example,r=await simulateV3({fighters:[definition(left),definition(right)],mode,seed}),sha256=createHash('sha256').update(JSON.stringify(r)).digest('hex');assert.equal(sha256,example.sha256);results.push({...example,equal:true,frames:r.frames.length,events:r.events.length});}
await writeFile(new URL('./browser-node.json',import.meta.url),JSON.stringify({results,passed:true},null,2)+'\n');console.log(JSON.stringify(results));
