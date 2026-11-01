// Loopback-only module proof. Both browser processes and the server always close.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chromium,webkit} from '../../web/node_modules/playwright/index.mjs';
import {simulateV3} from '../../sim/v3.js';
import {fixtures,options} from '../v3-top/v13/experiment.mjs';
const root=new URL('../../',import.meta.url),out=new URL('./browser/',import.meta.url);await mkdir(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const files=['sim/v3.js','sim/v3-rules.json','sim/index.js','sim/math.js','data/catalog.json','test/mvp/browser.mjs'];
const sources=Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(new URL(p,root)))])));
const html='<!doctype html><meta charset="utf-8"><title>MVP module test</title><link rel="icon" href="data:,"><script type="importmap">{"imports":{"@dimforge/rapier3d-compat":"/sim/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs"}}</script><script type="module">import {simulateV3} from "/sim/v3.js";window.runModule=simulateV3;</script>';
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=new URL('.'+decodeURIComponent(path),root);if(!file.href.startsWith(root.href)){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Type',file.pathname.endsWith('.json')?'application/json':file.pathname.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end();}
});
const cases=[
 {id:'auto-A',options:options(fixtures[0],7,'auto',.25,'A')},
 {id:'auto-B',options:options(fixtures[1],42,'auto',.25,'B')},
 {id:'manual-mash',options:options(fixtures[2],19,'mash')},
 {id:'manual-ai-profiles',options:{...options(fixtures[3],19,'timing'),manual:{sides:['ai','ai'],aiSeeds:[123,456]}}},
 {id:'generated-broom-knife',options:{fighters:[{parts:[{item:'wasteland-broom',orient:'out',mount:'e0'},{item:'wasteland-knife',orient:'hug',mount:'e180'}]},{parts:[{item:'broom',orient:'out',mount:'e0'},{item:'scissors',orient:'hug',mount:'e180'}]}],seed:37,manual:{sides:['input','ai'],inputs:[{step:1,side:0,action:'block'},{step:601,side:0,action:'block'}]}}}
];
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const records=await Promise.all(cases.map(async c=>{const r=await simulateV3(c.options);assert.equal(r.events[0].type,'start');assert.equal(r.events.at(-1).type,'result');const json=JSON.stringify(r);await writeFile(new URL(`${c.id}.json.gz`,out),gzipSync(json));return {...c,nodeJson:json};}));
 const receipts=[];
 for(const engine of ['chrome','webkit']){
  browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.runModule,null,{polling:100,timeout:30000});
  for(const c of records){const json=await page.evaluate(async o=>JSON.stringify(await window.runModule(o)),c.options);assert.equal(json,c.nodeJson,`${engine}/${c.id}: complete JSON mismatch`);receipts.push({engine,case:c.id,nodeSha256:sha(c.nodeJson),browserSha256:sha(json),equal:true,bytes:Buffer.byteLength(json)});}
  assert.deepEqual(errors,[]);await browser.close();browser=null;
 }
 for(const [p,hash]of Object.entries(sources))assert.equal(sha(await readFile(new URL(p,root))),hash,`source changed: ${p}`);
 const proof={at:new Date().toISOString(),sources,cases:receipts,scope:'Complete Node/Chrome/WebKit JSON equality; separate phone.mjs checks the rendered full-match path.'};await writeFile(new URL('proof.json',out),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
