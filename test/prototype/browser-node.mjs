// Compare two complete real replays with the captured Chrome module results.
import fs from 'node:fs/promises';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {simulate} from '../../sim/index.js';import {single} from '../../sim/batch.js';
const browser=JSON.parse(await fs.readFile(new URL('./browser.json',import.meta.url),'utf8'));
assert.equal(browser.error,undefined);assert.equal(browser.items,8);assert.ok(browser.deterministic&&browser.sameInitial);
const examples=[{left:'broom',right:'pot',mode:'A',seed:1,sha256:browser.sha256},browser.critical],results=[];
for(const example of examples){
 const {left,right,mode,seed}=example,replay=await simulate({fighters:[single(left),single(right)],mode,seed});
 const sha256=crypto.createHash('sha256').update(JSON.stringify(replay)).digest('hex');assert.equal(sha256,example.sha256);
 results.push({left,right,mode,seed,sha256,equal:true,frames:replay.frames.length,events:replay.events.length});
}
await fs.writeFile(new URL('./browser-node.json',import.meta.url),JSON.stringify({results,passed:true},null,2)+'\n');console.log(JSON.stringify(results));
