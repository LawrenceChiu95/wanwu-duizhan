import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import sharp from 'sharp';
import {recognizePhoto, parseRecognition, recognitionPrompt, recognitionSchema} from '../shoot/recognition.mjs';
import {qwenBackup, qwenText, qwenStream} from '../shoot/qwen.mjs';
import {realGenerator} from '../shoot/real.mjs';
import {fakeGenerator} from '../shoot/fake.mjs';
import {openJobs} from '../shoot/jobs.mjs';
const fixtures = JSON.parse(await fs.readFile(new URL('./fixtures/qwen-demo.json', import.meta.url)));
// Transport fixtures keep the captured demo text intact. The protocol stubs
// provide the two fields the new request asks for.
const currentReply = value => ({...value, hasBladeOrPoint: value.name === '菜刀', impactHardness: value.hardness});
const result = currentReply(fixtures[4].expected);
const sampleReply = '```json\n'+JSON.stringify(result)+'\n```';
const image = await sharp({create:{width:32,height:24,channels:3,background:'#abcabc'}}).jpeg().toBuffer();
const env={GEMINI_API_KEY:'PRIVATE-GOOGLE',AHOLO_API_KEY:'PRIVATE-AHOLO',SHOOT_RECOGNITION_BACKUP:'qwen',DASHSCOPE_API_KEY:'PRIVATE-QWEN',DASHSCOPE_BASE_URL:'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'};
const backup=qwenBackup(env);
const google=value=>Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(value)}]}]});
const sse=(text, reason='stop', done=true)=>'data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:reason}]})+'\n\n'+(done?'data: [DONE]\n\n':'');
const qwen=text=>new Response(sse(text));
const base={photo:image,key:env.GEMINI_API_KEY,diagnose:()=>{},pause:async()=>{}};
const broken=async()=>{throw Object.assign(Error('PRIVATE network'),{cause:{code:'ECONNREFUSED'}});};

test('backup is absent by default, requires explicit region-safe credentials, never silently enables',()=>{
 assert.equal(qwenBackup({}),null);assert.equal(qwenBackup({...env,SHOOT_RECOGNITION_BACKUP:'off'}),null);
 for(const patch of [{SHOOT_RECOGNITION_BACKUP:'on'},{DASHSCOPE_API_KEY:''},{DASHSCOPE_API_KEY:'key\nX: injected'},{DASHSCOPE_BASE_URL:'http://test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'},{DASHSCOPE_BASE_URL:'https://evil.example/compatible-mode/v1'},{DASHSCOPE_BASE_URL:env.DASHSCOPE_BASE_URL+'?key=secret'},{DASHSCOPE_BASE_URL:env.DASHSCOPE_BASE_URL.replace('beijing','hongkong')}])assert.throws(()=>qwenBackup({...env,...patch}));
 assert.doesNotThrow(()=>realGenerator({env:{GEMINI_API_KEY:'g',AHOLO_API_KEY:'a'}}));
});
test('all eight demo texts decode only after whole-fence removal',()=>{
 assert.equal(fixtures.length,8);
 for(const f of fixtures){assert.throws(()=>JSON.parse(f.text));assert.deepEqual(JSON.parse(qwenText(f.text)),f.expected);assert.doesNotThrow(()=>parseRecognition(currentReply(f.expected)));}
});
test('default path allows one retry, while normal primary success never calls backup',async()=>{
 let primary=0,secondary=0;await assert.rejects(recognizePhoto({...base,fetch:async()=>{primary++;return broken();},backupFetch:async()=>{secondary++;assert.fail();}}),{code:'recognition-network'});assert.equal(primary,2);assert.equal(secondary,0);
 assert.equal((await recognizePhoto({...base,backup,fetch:async()=>google(result),backupFetch:async()=>assert.fail()})).name,result.name);
});
for(const problem of ['network',500,503,429])test(`primary ${problem} automatically uses backup once with bounded private protocol`,async()=>{
 const events=[],waits=[];let primary=0,secondary=0;
 const got=await recognizePhoto({...base,backup,diagnose:x=>events.push(x),pause:async ms=>waits.push(ms),fetch:async()=>{primary++;return problem==='network'?broken():new Response('PRIVATE BODY',{status:problem});},backupFetch:async(url,r)=>{
  secondary++;assert.equal(url,backup.url);assert.equal(r.headers.Authorization,'Bearer PRIVATE-QWEN');assert.equal(r.headers['x-goog-api-key'],undefined);assert.equal(r.redirect,'error');
  const b=JSON.parse(r.body);assert.equal(b.model,'qwen3.5-omni-plus');assert.equal(b.max_tokens,1024);assert.deepEqual(b.modalities,['text']);assert.equal(b.stream,true);assert.equal(b.messages[0].content[0].text,recognitionPrompt+'\n只使用下述JSON schema中的字段，required字段必须提供：'+JSON.stringify(recognitionSchema));assert.match(b.messages[0].content[1].image_url.url,/^data:image\/jpeg;base64,/);return qwen(JSON.stringify({...result, verdict:'金属杯身，碰撞声清脆'}));
 }});
 assert.equal(got.name,result.name);assert.equal(got.verdict,'金属杯身，碰撞声清脆');assert.equal(primary,problem===429?1:2);assert.equal(secondary,1);assert.deepEqual(waits,problem===429?[]:[2000]);assert.equal(events.at(-1).provider,'qwen');assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});
for(const problem of [400,401,403,404,422,'invalid','unclear'])test(`primary ${problem} never switches`,async()=>{
 const unclear={...result,clear:false};for(const k of Object.keys(unclear))if(!['clear','recognizable','basis'].includes(k))unclear[k]=null;
 let primary=0;await assert.rejects(recognizePhoto({...base,backup,fetch:async()=>{primary++;return problem==='unclear'?google(unclear):problem==='invalid'?google({...result,hardness:5}):new Response('',{status:problem});},backupFetch:async()=>assert.fail('not eligible for fallback')}));assert.equal(primary,1);
});
test('an interrupted HTTP 401 body still fails as authentication and never switches',async()=>{
 const body=new ReadableStream({start(c){c.error(Error('private body error'));}});let fallback=0;
 await assert.rejects(recognizePhoto({...base,backup,fetch:async()=>new Response(body,{status:401}),backupFetch:async()=>{fallback++;return qwen(sampleReply);}}),{code:'recognition-auth'});
 assert.equal(fallback,0);
});
test('backup rejects prose, partial/truncated replies, extra fields and oversized bodies; no guessing',async()=>{
 const malformed=[qwen('Here is JSON '+JSON.stringify(result)),qwen('```json\n'+JSON.stringify(result)),qwen(JSON.stringify({...result,extra:1})),new Response(sse(JSON.stringify(result),'length')),new Response('x'.repeat(262145))];
 for (const response of malformed) {
  const events = [];
  await assert.rejects(recognizePhoto({...base, backup, fetch: broken, backupFetch: async () => response, diagnose: event => events.push(event)}), {code: 'recognition-network'});
  assert.equal(events.at(-1).error, 'recognition-invalid');
 }
});
for (const [status, backupError] of [[302, 'recognition-service'], [401, 'recognition-auth'], [403, 'recognition-auth'], [429, 'recognition-limit'], [503, 'recognition-service']]) {
 test(`backup ${status} preserves the primary network error and logs the backup error`, async () => {
  const events = [];
  await assert.rejects(recognizePhoto({...base, backup, fetch: broken, backupFetch: async () => new Response('', {status}), diagnose: event => events.push(event)}), {code: 'recognition-network'});
  assert.deepEqual(events.map(event => event.error), ['recognition-network', 'recognition-network', backupError]);
  assert.equal(events.at(-1).status, status);
 });
}
test('per-attempt timeout switches, aborts a hanging backup and leaves no later requests',async()=>{
 let primary=0,secondary=0,backupSignal;const events=[];
 const hangs=(_u,r)=>new Promise((_,reject)=>{r.signal.addEventListener('abort',()=>reject(r.signal.reason),{once:true});});
 const started=performance.now();await assert.rejects(recognizePhoto({...base,backup,timeoutMs:20,totalTimeoutMs:500,diagnose:x=>events.push(x),fetch:(u,r)=>{primary++;return hangs(u,r);},backupFetch:(u,r)=>{secondary++;backupSignal=r.signal;return hangs(u,r);}}),{code:'recognition-network'});
 assert.ok(performance.now()-started<1000);assert.equal(primary,2);assert.equal(secondary,1);assert.equal(backupSignal.aborted,true);assert.ok(events.every(x=>x.timedOut));await sleep(30);assert.equal(primary+secondary,3);
});
test('total deadline also interrupts retry waiting and cannot start backup after expiry',async()=>{
 let count=0;const started=performance.now();await assert.rejects(recognizePhoto({...base,backup,totalTimeoutMs:35,pause:sleep,fetch:async()=>{count++;return broken();},backupFetch:async()=>assert.fail()}),{code:'recognition-network'});assert.equal(count,1);assert.ok(performance.now()-started<500);
});
test('a backup outage leaves the original job retryable and one later generation charged', async t => {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-backup-'));
 const fake = await fakeGenerator(directory, {delayMs: 1});
 let primaryCalls = 0, backupCalls = 0;
 const real = realGenerator({
  env, fetch: async () => { primaryCalls++; return broken(); }, pause: async () => {},
  backupFetch: async () => ++backupCalls === 1 ? new Response('', {status: 403}) : qwen(sampleReply)
 });
 fake.recognize = real.recognize;
 const jobs = await openJobs({directory, generator: fake, budget: {stage: 'isolated-backup', limit: 39}});
 t.after(() => jobs.close());
 const job = await jobs.create({photo: image, clientKey: 'backup-original'}, 'owner');
 const terminal = async () => {
  for (let i = 0; i < 1500; i++) {
   const current = await jobs.get(job.id, 'owner');
   if (['failed', 'succeeded'].includes(current.status)) return current;
   await sleep(5);
  }
  assert.fail('job did not finish');
 };
 const failed = await terminal();
 assert.equal(failed.error.code, 'recognition-network');
 assert.equal(failed.error.retry, 'same');
 assert.equal(fake.used(), 0);
 const refunded = await jobs.quota('owner');
 assert.equal(refunded.recognition.remaining, 5);
 assert.equal(refunded.global.recognition.remaining, 399);
 assert.equal(refunded.budget.remaining, 39);

 assert.equal((await jobs.retry(job.id, 'owner')).id, job.id);
 const done = await terminal();
 assert.equal(done.status, 'succeeded');
 assert.equal(done.recognition.name, result.name);
 assert.equal(primaryCalls, 4);
 assert.equal(backupCalls, 2);
 assert.equal(fake.used(), 1);
 const quota = await jobs.quota('owner');
 assert.equal(quota.used, 1);
 assert.equal(quota.recognition.remaining, 4);
 assert.equal(quota.global.recognition.remaining, 398);
 assert.equal(quota.budget.remaining, 26);
 const state = JSON.parse(await fs.readFile(path.join(directory, 'state.json')));
 assert.equal(Object.keys(state.jobs).length, 1);
 assert.deepEqual(state.jobs[job.id].recognitionAttempts.map(attempt => Boolean(attempt.refunded)), [true, false]);
 assert.equal((await jobs.create({photo: image, clientKey: 'backup-original'}, 'owner')).id, job.id);
 assert.equal(primaryCalls, 4);
});

test('SSE assembles text deltas, ignores usage and requires a clean finish and end marker',()=>{
 assert.equal(qwenStream(sse(fixtures[0].text)),fixtures[0].text);
 // The official Omni example omits role from text chunks and ends with usage.
 const pieces=[fixtures[0].text.slice(0,10),fixtures[0].text.slice(10)];
 const noRole=[...pieces.map(content=>({choices:[{index:0,delta:{content},finish_reason:null}]})),{choices:[{index:0,delta:{content:''},finish_reason:'stop'}]},{choices:[],usage:{total_tokens:42}}].map(chunk=>'data: '+JSON.stringify(chunk)).join('\n\n')+'\n\ndata: [DONE]\n';
 assert.equal(qwenStream(noRole),fixtures[0].text);
 for(const raw of [sse('{}','stop',false),sse('{}','length'),sse('{}').replace('assistant','tool'),sse('{}')+'data: {}\n',JSON.stringify({choices:[]}), 'data: null\n', 'data: '+JSON.stringify({error:{message:'PRIVATE'},choices:[{index:0,delta:{role:'assistant'},finish_reason:'stop'}]})+'\n', 'data: '+JSON.stringify({choices:[null]})+'\n', 'data: '+JSON.stringify({error:{message:'PRIVATE'}})+'\n'])assert.throws(()=>qwenStream(raw));
});

test('native HTTPS backup bypasses an enabled broken environment proxy and aborts stalled bodies',{skip:process.platform==='win32'},async t=>{
 const https=await import('node:https'),http=await import('node:http'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{once}=await import('node:events');
 const run=promisify(execFile),directory=await fs.mkdtemp(path.join(os.tmpdir(),'wanwu-backup-tls-'));
 await fs.writeFile(path.join(directory,'cert.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n');
 await run('/usr/bin/openssl',['req','-x509','-nodes','-newkey','rsa:2048','-days','1','-config',path.join(directory,'cert.cnf'),'-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem')]);
 let proxyCalls=0,requests=0;const proxy=http.createServer((_q,r)=>{proxyCalls++;r.writeHead(502);r.end();});proxy.on('connect',(_r,s)=>{proxyCalls++;s.destroy();});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
 const server=https.createServer({key:await fs.readFile(path.join(directory,'key.pem')),cert:await fs.readFile(path.join(directory,'cert.pem'))},(req,res)=>{requests++;if(req.url==='/stall'){res.writeHead(200);res.write('data: ');return;}if(req.url==='/redirect'){res.writeHead(302,{Location:'https://must-not-follow.invalid'});res.end();return;}if(req.url==='/large'){res.end('x'.repeat(262145));return;}res.end(sse(fixtures[4].text));});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();server.close();proxy.closeAllConnections();proxy.close();});
 const moduleUrl=new URL('../shoot/qwen.mjs',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';import {directQwenRequest,qwenStream} from ${JSON.stringify(moduleUrl)};const base='https://localhost:${server.address().port}';const options={headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)};const r=await directQwenRequest(base,options);assert.equal(r.status,200);assert.ok(qwenStream(Buffer.concat(r.body).toString()).includes('保温杯'));assert.equal((await directQwenRequest(base+'/redirect',options)).status,302);await assert.rejects(directQwenRequest(base+'/large',options),{code:'recognition-invalid'});await assert.rejects(directQwenRequest(base+'/stall',{...options,signal:AbortSignal.timeout(30)}));console.log('direct-proxy-bypass-and-abort: passed');`;
 const got=await run(process.execPath,['--input-type=module','-e',script],{env:{...process.env,NODE_USE_ENV_PROXY:'1',HTTP_PROXY:`http://127.0.0.1:${proxy.address().port}`,HTTPS_PROXY:`http://127.0.0.1:${proxy.address().port}`,https_proxy:`http://127.0.0.1:${proxy.address().port}`,http_proxy:`http://127.0.0.1:${proxy.address().port}`,NO_PROXY:'',no_proxy:'',NODE_EXTRA_CA_CERTS:path.join(directory,'cert.pem')},timeout:10000});
 assert.match(got.stdout,/passed/);assert.equal(proxyCalls,0);assert.equal(requests,4);
});

test('overall deadline cancels backup and preserves the primary rate limit', async () => {
 let calls = 0, signal;
 const started = performance.now();
 await assert.rejects(recognizePhoto({
  ...base, backup, totalTimeoutMs: 55, timeoutMs: 1000,
  fetch: async () => new Response('', {status: 429}),
  backupFetch: (_url, request) => {
   calls++;
   signal = request.signal;
   return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  }
 }), {code: 'recognition-limit'});
 assert.equal(calls, 1);
 assert.equal(signal.aborted, true);
 assert.ok(performance.now() - started < 500);
 await sleep(20);
 assert.equal(calls, 1);
});


test('backup unclear photo remains a photo rejection without a generation or another provider',async()=>{
 const unclear={...result,clear:false};for(const k of Object.keys(unclear))if(!['clear','recognizable','basis'].includes(k))unclear[k]=null;
 let n=0;await assert.rejects(recognizePhoto({...base,backup,fetch:broken,backupFetch:async()=>{n++;return qwen(JSON.stringify(unclear));}}),{code:'photo-unclear'});assert.equal(n,1);
});
