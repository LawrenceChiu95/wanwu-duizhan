import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import sharp from 'sharp';
import {recognizePhoto} from '../shoot/recognition.mjs';
import {recognitionProxyHealth} from '../shoot/proxy-health.mjs';
import {openJobs} from '../shoot/jobs.mjs';
import {fakeGenerator} from '../shoot/fake.mjs';

const photo = await sharp({create: {width: 1600, height: 1200, channels: 3, background: '#abcabc'}}).jpeg().toBuffer();
const result = {clear: true, recognizable: true, name: '保温杯', materialName: '金属', material: 'metal', hardness: 1.2, hasBladeOrPoint: false, impactHardness: 1.2, lengthCm: 20, massKg: .3, condition: 'intact', outwardEnd: 'wide', basis: '杯身按常见尺寸估计'};
const reply = () => Response.json({status: 'completed', steps: [{type: 'model_output', content: [{type: 'text', text: JSON.stringify(result)}]}]});
const dir = () => fs.mkdtemp(path.join(os.tmpdir(), 'recognition-recovery-'));
const budget = {stage: 'recovery', limit: 39};
async function until(fn, accept) { for(let i=0;i<1000;i++){const x=await fn();if(accept(x))return x;await sleep(5);}throw Error('fixture timeout'); }
const fail = (jobs,id,owner) => until(()=>jobs.get(id,owner), x=>x.status==='failed');
async function broken(directory, code = 'recognition-network') {
  const generator=await fakeGenerator(directory,{delayMs:1}); let calls=0;
  generator.recognize=async()=>{calls++;throw Object.assign(Error(code),{code});};
  return {generator,calls:()=>calls};
}

test('recognition shrinks only its request and logs each safe diagnostic with spaced bounded retries', async()=>{
 const waits=[],events=[],original=Buffer.from(photo);let n=0;
 const fetch=async(_url,request)=>{
  const body=JSON.parse(request.body),bytes=Buffer.from(body.input[1].data,'base64'),m=await sharp(bytes).metadata();
  assert.equal(m.width,1024);assert.equal(m.height,768);assert.equal(m.format,'jpeg');assert.ok(bytes.length<photo.length);
  if(n++===0)throw Object.assign(Error('PRIVATE SECRET URL'),{cause:{code:'ECONNREFUSED'}});
  return reply();
 };
 assert.equal((await recognizePhoto({photo,key:'PRIVATE KEY',fetch,pause:async ms=>waits.push(ms),diagnose:x=>events.push(x)})).name,'保温杯');
 assert.deepEqual(photo,original);assert.deepEqual(waits,[2000]);assert.equal(events.length,2);assert.equal(events[0].cause,'ECONNREFUSED');assert.equal(events[1].error,null);
 assert.ok(!JSON.stringify(events).includes('PRIVATE'));assert.ok(2*15000+waits.reduce((a,b)=>a+b,0)<60000);
});

test('timeout produces two per-attempt abort diagnostics; authentication is not retried',async()=>{
 const events=[],waits=[];
 await assert.rejects(recognizePhoto({photo,key:'KEY',timeoutMs:5,diagnose:x=>events.push(x),pause:async x=>waits.push(x),fetch:(_u,o)=>new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}))}),{code:'recognition-network'});
 assert.equal(events.length,2);assert.ok(events.every(x=>x.timedOut));assert.deepEqual(waits,[2000]);
 let calls=0;await assert.rejects(recognizePhoto({photo,key:'KEY',diagnose:()=>{},pause:async()=>assert.fail(),fetch:async()=>{calls++;return new Response('',{status:401});}}),{code:'recognition-auth'});assert.equal(calls,1);
});

test('service failures refund same owner, retain global attempts and manually retry only one original job',async()=>{
 const directory=await dir(),b=await broken(directory);let jobs=await openJobs({directory,generator:b.generator,budget});
 const j=await jobs.create({photo,clientKey:'original-recognition'},'same-browser');await fail(jobs,j.id,'same-browser');
 let q=await jobs.quota('same-browser');assert.equal(q.recognition.remaining,5);assert.equal(q.global.recognition.remaining,399);assert.equal(q.remaining,2);assert.equal(q.budget.remaining,39);assert.equal(b.generator.used(),0);
 await assert.rejects(jobs.retry(j.id,'other-browser'),{code:'not-found'});
 assert.equal((await jobs.create({photo,clientKey:'original-recognition'},'same-browser')).id,j.id);assert.equal(b.calls(),1);
 const savedPhoto=await fs.readFile(path.join(directory,j.id,'photo.jpg'));
 const retries=await Promise.allSettled([jobs.retry(j.id,'same-browser'),jobs.retry(j.id,'same-browser')]);assert.equal(retries.filter(x=>x.status==='fulfilled').length,1);
 await fail(jobs,j.id,'same-browser');assert.equal(b.calls(),2);q=await jobs.quota('same-browser');assert.equal(q.recognition.remaining,5);assert.equal(q.global.recognition.remaining,398);assert.equal(q.budget.remaining,39);
 assert.deepEqual(await fs.readFile(path.join(directory,j.id,'photo.jpg')),savedPhoto);
 await jobs.close();const before=b.calls();jobs=await openJobs({directory,generator:b.generator,budget});
 try {assert.equal(b.calls(),before);assert.equal((await jobs.get(j.id,'same-browser')).error.retry,'same');assert.equal((await jobs.quota('same-browser')).global.recognition.remaining,398);assert.equal(Object.keys(JSON.parse(await fs.readFile(path.join(directory,'state.json'))).jobs).length,1);}finally{await jobs.close();}
});

test('same recognition job recovers into one normal generation, never a free paid resubmission',async()=>{
 const directory=await dir(),b=await broken(directory),recognize=(await fakeGenerator(directory)).recognize;
 const jobs=await openJobs({directory,generator:b.generator,budget});
 try {
  const j=await jobs.create({photo,clientKey:'recover-into-generation'},'a');await fail(jobs,j.id,'a');b.generator.recognize=recognize;
  await jobs.retry(j.id,'a');await until(()=>jobs.get(j.id,'a'),x=>x.status==='succeeded');
  assert.equal(b.generator.used(),1);const q=await jobs.quota('a');assert.equal(q.recognition.remaining,4);assert.equal(q.global.recognition.remaining,398);assert.equal(q.budget.remaining,26);
  await assert.rejects(jobs.retry(j.id,'a'),{code:'not-allowed'});assert.equal(b.generator.used(),1);
 }finally{await jobs.close();}
});

test('legacy network failures gain refund and manual retry on restart without another call',async()=>{
 const directory=await dir(),b=await broken(directory);let jobs=await openJobs({directory,generator:b.generator,budget});const j=await jobs.create({photo,clientKey:'legacy-network-record'},'a');await fail(jobs,j.id,'a');await jobs.close();
 const file=path.join(directory,'state.json'),state=JSON.parse(await fs.readFile(file));delete state.jobs[j.id].recognitionAttempts;state.jobs[j.id].job.error.retry='none';await fs.writeFile(file,JSON.stringify(state));
 jobs=await openJobs({directory,generator:b.generator,budget});try{const q=await jobs.quota('a');assert.equal(q.recognition.remaining,5);assert.equal(q.global.recognition.remaining,399);assert.equal((await jobs.get(j.id,'a')).error.retry,'same');assert.equal(b.calls(),1);}finally{await jobs.close();}
});

test('global safety ceiling blocks refunded manual retries; Taipei midnight opens a new day without erasing history',async()=>{
 const directory=await dir(),b=await broken(directory);let time=Date.parse('2026-11-05T15:59:00Z');
 const jobs=await openJobs({directory,generator:b.generator,budget,clock:()=>time,limits:{browser:{generation:2,recognition:5},global:{generation:20,recognition:2}}});
 try{
  const j=await jobs.create({photo,clientKey:'global-safety-record'},'a');await fail(jobs,j.id,'a');await jobs.retry(j.id,'a');await fail(jobs,j.id,'a');
  await assert.rejects(jobs.retry(j.id,'a'),{code:'quota',scope:'global',kind:'recognition'});assert.equal(b.calls(),2);assert.equal((await jobs.quota('a')).recognition.remaining,5);
  time+=120000;await jobs.retry(j.id,'a');await fail(jobs,j.id,'a');assert.equal(b.calls(),3);assert.equal((await jobs.quota('a')).global.recognition.remaining,1);
  const r=JSON.parse(await fs.readFile(path.join(directory,'state.json'))).jobs[j.id];assert.equal(r.recognitionAttempts.length,3);assert.equal(r.recognitionAttempts[0].day,'2026-11-05');assert.equal(r.recognitionAttempts[2].day,'2026-11-06');
 }finally{await jobs.close();}
});

test('unclear photo spends a browser attempt, unlike service, network, auth or malformed responses',async()=>{
 for(const code of ['photo-unclear','recognition-service','recognition-network','recognition-auth','recognition-invalid','photo-read']){
  const directory=await dir(),b=await broken(directory,code),jobs=await openJobs({directory,generator:b.generator,budget});
  try{const j=await jobs.create({photo,clientKey:'refund-class-'+code},'a');await fail(jobs,j.id,'a');const q=await jobs.quota('a');assert.equal(q.recognition.remaining,code==='photo-unclear'?4:5);assert.equal(q.global.recognition.remaining,399);assert.equal((await jobs.quota()).recognition.remaining,code==='photo-unclear'?4:5);assert.equal(q.budget.remaining,39);}finally{await jobs.close();}
 }
});

test('proxy health distinguishes a closed local proxy from TCP reachability and labels upstream unverified',async()=>{
 const server=net.createServer(s=>s.end());server.listen(0,'127.0.0.1');await once(server,'listening');
 const env={NODE_USE_ENV_PROXY:'1',https_proxy:`http://127.0.0.1:${server.address().port}`};
 assert.deepEqual(await recognitionProxyHealth(env),{required:true,reachable:true,check:'tcp-only'});
 await new Promise(r=>server.close(r));assert.equal((await recognitionProxyHealth(env)).reachable,false);
 assert.equal((await recognitionProxyHealth({...env,NODE_USE_ENV_PROXY:''})).check,'proxy-not-enabled');assert.equal((await recognitionProxyHealth({})).check,'direct-unverified');
 const directory=await dir(),generator=await fakeGenerator(directory);generator.health=()=>recognitionProxyHealth(env);const jobs=await openJobs({directory,generator});try{const health=await jobs.health();assert.equal(health.status,'ok');assert.equal(health.recognitionProxy.reachable,false);assert.equal(health.recognitionProxy.required,true);}finally{await jobs.close();}
});

test('an unreadable saved photo is a service failure before any vision request',async()=>{
 await assert.rejects(recognizePhoto({photo:Buffer.from('broken saved JPEG'),key:'KEY',fetch:async()=>assert.fail('must not contact vision')}),{code:'recognition-invalid'});
});
