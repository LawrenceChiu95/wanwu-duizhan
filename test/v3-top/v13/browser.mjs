// Cross-runtime module proof, not visual or phone acceptance. Own loopback server and headless Chrome are always closed.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {chromium} from '../../../web/node_modules/playwright/index.mjs';
import {simulateV3} from '../../../sim/v3.js';
import {root,fixtures,options,sha,baseline} from './experiment.mjs';
const out=new URL(process.env.V13_BROWSER??'./browser/',import.meta.url);await mkdir(out,{recursive:true});
const sources=Object.fromEntries(await Promise.all(['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','data/catalog.json','test/v3-top/v13/browser.mjs'].map(async p=>[p,sha(await readFile(new URL(p,root)))])));
const html='<!doctype html><meta charset="utf-8"><title>Module verification</title><link rel="icon" href="data:,"><script type="importmap">{"imports":{"@dimforge/rapier3d-compat":"/sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs"}}</script><script type="module">import {simulateV3} from "/sim/v3.js";window.runModule=simulateV3;</script>';
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=new URL('.'+decodeURIComponent(path),root);if(!file.href.startsWith(root.href)){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Type',file.pathname.endsWith('.json')?'application/json':file.pathname.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(await readFile(file));
 }catch(e){res.statusCode=404;res.end();}
});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.runModule,null,{timeout:60000});
 const old=await baseline(),cases=[];
 for(const mode of ['A','B'])for(const seed of [7,42])cases.push({id:`auto-${mode}-${seed}`,width:1440,options:options(fixtures[0],seed,'auto',.25,mode)});
 for(const width of [390,1440])for(const window of [.2,.25,.3])cases.push({id:`manual-${width}-${window}`,width,options:options(fixtures[0],width===390?7:42,'mash',window)});
 cases.push({id:'manual-explicit-ai-profiles',width:390,options:{...options(fixtures[1],19,'timing'),manual:{sides:['ai','ai'],blockTime:.25,aiSeeds:[123,456]}}});
 const receipts=[];
 for(const c of cases){
  await page.setViewportSize({width:c.width,height:c.width===390?844:900});
  const nodeReplay=await simulateV3(c.options),nodeJson=JSON.stringify(nodeReplay);
  const chromeJson=await page.evaluate(async o=>JSON.stringify(await window.runModule(o)),c.options);
  assert.equal(chromeJson,nodeJson,`${c.id}: complete JSON byte mismatch`);
  const oldHash=c.options.manual===null?sha(await old.simulateV3(c.options)):null;
  await writeFile(new URL(`${c.id}.json.gz`,out),gzipSync(nodeJson));
  receipts.push({id:c.id,width:c.width,mode:c.options.mode,seed:c.options.seed,openingHalfTurn:nodeReplay.meta.openingHalfTurn,blockTime:nodeReplay.meta.manual?.blockTime??null,nodeSha256:sha(nodeJson),chromeSha256:sha(chromeJson),bytes:Buffer.byteLength(nodeJson),equal:true,oldAutoSha256:oldHash,automaticBaselineChanged:oldHash===null?null:oldHash!==sha(nodeJson),duration:nodeReplay.meta.duration,winner:nodeReplay.meta.winner,accepted:nodeReplay.meta.manual?.inputs.length??0});
 }
 assert.deepEqual(errors,[]);
 for(const [p,hash]of Object.entries(sources))assert.equal(sha(await readFile(new URL(p,root))),hash,`source changed: ${p}`);
 const proof={sources,at:new Date().toISOString(),userAgent:await page.evaluate(()=>navigator.userAgent),browserVersion:browser.version(),scope:'Local Chrome module equality at two viewport sizes; no rendered game, device or Safari acceptance.',cases:receipts,errors};
 await writeFile(new URL('proof.json',out),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}finally{
 if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}
