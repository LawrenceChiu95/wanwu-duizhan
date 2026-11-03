import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Document, NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {setTimeout as pause} from 'node:timers/promises';
import {realGenerator, parseRecognition, recognitionPrompt} from '../shoot/real.mjs';
import {startShootServer} from '../shoot/server.mjs';
import {openJobs, REPO} from '../shoot/jobs.mjs';
import {readJson} from '../state.mjs';
import {rateItem} from '../../../sim/item-rating.js';
import {validateRuntimeItem} from '../../../sim/runtime-items.js';
const env = {GEMINI_API_KEY: 'test-gemini-secret', AHOLO_API_KEY: 'test-aholo-secret'};
const result = {category: 'pot', inSix: true, lengthCm: 42, massKg: 0.72, material: 'metal', condition: 'worn', basis: '可见锅沿，按常见锅估计尺寸，有磨损'};
const image = await sharp({create: {width: 32, height: 32, channels: 3, background: '#abcabc'}}).png().toBuffer();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-real-test-'));
const catalog = await readJson(path.join(REPO, 'data/catalog.json'));
const dir = () => fs.mkdtemp(path.join(root, 'case-'));
async function mesh() {
 const d = new Document(), b = d.createBuffer(), pos = d.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 2,0,0, 0,1,0, 0,0,1])).setBuffer(b);
 const ix = d.createAccessor().setType('SCALAR').setArray(new Uint16Array([0,2,1,0,1,3,0,3,2,1,2,3])).setBuffer(b);
 const node = d.createNode().setMesh(d.createMesh().addPrimitive(d.createPrimitive().setAttribute('POSITION', pos).setIndices(ix)));
 d.getRoot().setDefaultScene(d.createScene().addChild(node)); return Buffer.from(await new NodeIO().writeBinary(d));
}
const model = await mesh();
const geminiReply = value => ({status: 'completed', steps: [{type: 'model_output', content: [{type: 'text', text: JSON.stringify(value)}]}]});
function gateway(options = {}) {
 const seen = [], creates = [], observations = []; let once = false;
 const fetch = async (url, request) => {
  const u = new URL(url), headers = new Headers(request.headers); seen.push({host: u.hostname, route: u.pathname, method: request.method});
  const ok = d => Response.json({c: '0', d});
  if (u.hostname === 'generativelanguage.googleapis.com') {
   assert.equal(headers.get('x-goog-api-key'), env.GEMINI_API_KEY); assert.equal(headers.has('authorization'), false);
   assert.equal(request.redirect, 'error'); assert.equal(headers.get('api-revision'), '2026-05-20');
   const body = JSON.parse(request.body); assert.equal(body.store, false); assert.equal(body.model, 'gemini-3.5-flash-lite'); assert.equal(body.input[0].text, recognitionPrompt);
   assert.equal(body.input[1].mime_type, 'image/jpeg'); assert.equal((await sharp(Buffer.from(body.input[1].data, 'base64')).metadata()).format, 'jpeg');
   assert.deepEqual(body.response_format.schema.required.sort(), Object.keys(result).sort());
   if (options.visionTimeout) return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), {once: true}));
   return Response.json(options.visionReply ?? geminiReply(options.recognition ?? result));
  }
  assert.equal(headers.has('x-goog-api-key'), false);
  if (u.hostname === 'api.aholo.ai') {
   assert.equal(headers.get('authorization'), env.AHOLO_API_KEY); assert.equal(request.redirect, 'error');
   if (u.pathname.endsWith('/token')) return Response.json({ousToken: 'test-upload-token', globalDomain: 'https://upload.example', blockSize: 1000000});
   if (u.pathname.endsWith('/create')) {
    const stage = u.pathname.includes('multimodal') ? 'image' : 'mesh'; creates.push(stage);
    if (options.directory) { const disk = await readJson(path.join(options.directory, 'state.json')); observations.push(Object.values(disk.jobs).find(r => r.providerState?.pending)?.providerState.pending); }
    if (options.busy === stage) return Response.json({c: 'GENERATION_CONCURRENCY_LIMIT_EXCEEDED', d: null});
    if (options.unknown === stage) throw Error('simulated lost reply ' + env.AHOLO_API_KEY);
    const payload = JSON.parse(request.body);
    if (stage === 'mesh') assert.deepEqual(payload, {img: 'https://assets.example/styled.jpg', version: 'G1-Turbo', faceCount: 100000, enablePbr: true, outputFormat: ['zip', 'glb'], aiPredictSize: false});
    return ok(stage + '-id');
   }
   if (u.pathname.endsWith('/get')) {
    const stage = u.searchParams.get('taskid') === 'image-id' ? 'image' : 'mesh';
    const states = options.statuses?.[stage]; const status = states?.length > 1 ? states.shift() : states?.[0] ?? 3;
    return ok({status, outputs: [{content: `https://assets.example/${stage === 'image' ? 'styled.jpg' : 'model.glb'}`} ]});
   }
  } else {
   assert.equal(headers.has('authorization'), false);
   if (u.hostname === 'upload.example') {
    assert.equal(headers.get('ous-token-v2'), 'test-upload-token');
    return ok(u.pathname.endsWith('/status') ? {status: 5, url: 'https://assets.example/photo.jpg'} : {});
   }
   assert.equal(headers.has('ous-token-v2'), false);
   if (u.pathname === '/styled.jpg') return new Response(image);
   if (u.pathname === '/model.glb') {
    if (options.downloadFailure && !once) { once = true; throw Error('lost download'); }
    return new Response(options.badModel ? Buffer.from('invalid paid model') : model);
   }
  }
  throw Error('Unexpected offline protocol request');
 };
 return {fetch, seen, creates, observations, visionCalls: () => seen.filter(s => s.host === 'generativelanguage.googleapis.com').length};
}
async function until(read, accept) { for (let i = 0; i < 1500; i++) { const value = await read(); if (accept(value)) return value; await pause(10); } throw Error('fixture checkpoint timed out'); }
const finish = (jobs, id) => until(() => jobs.get(id), j => ['succeeded', 'failed'].includes(j.status));
async function open(t, options = {}) {
 const directory = options.directory ?? await dir(), g = gateway({...options, directory});
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}, timeoutMs: options.visionTimeout ? 10 : 10000}});
 t.after(() => jobs.close()); return {jobs, g, directory};
}

test('strict recognition bounds/enums/refusals do not silently substitute a high rating', () => {
 for (const patch of [{category: 'chair'}, {material: 'glass'}, {condition: 'new'}, {inSix: 'yes'}, {lengthCm: 0}, {lengthCm: 301}, {massKg: 0}, {massKg: Infinity}, {massKg: '1'}, {basis: ''}, {basis: 'a\n'}, {basis: 'a'.repeat(161)}, {extra: 1}]) assert.throws(() => parseRecognition({...result, ...patch}), {code: 'photo-unclear'});
 for (const condition of ['intact', 'worn', 'damaged', 'unknown']) assert.equal(parseRecognition({...result, condition}).condition, condition);
 assert.equal(parseRecognition({...result, lengthCm: 1, massKg: .001}).lengthMeters, .01);
 assert.equal(parseRecognition({...result, lengthCm: 300, massKg: 100, inSix: false}).inSix, false);
});

test('real startup names missing env keys before touching disk and refuses provider changes', async t => {
 const directory = path.join(await dir(), 'not-created');
 await assert.rejects(openJobs({mode: 'real', directory, env: {}}), /GEMINI_API_KEY, AHOLO_API_KEY/);
 await assert.rejects(fs.access(directory), {code: 'ENOENT'});
 assert.throws(() => realGenerator({env: {GEMINI_API_KEY: 'test'}}), /AHOLO_API_KEY/);
 const fake = await openJobs({directory}); await fake.create({photo: image, clientKey: 'fake-mode-0001'}); await fake.close();
 await assert.rejects(openJobs({directory, mode: 'real', env}), /provider changed/);
 await assert.rejects(fs.access(path.join(directory, '.owner')), {code: 'ENOENT'});
});

test('offline real HTTP task: structured vision, two durable paid stages, geometry/rating, no provider secrets in public output', async t => {
 const directory = await dir(), g = gateway({directory, statuses: {image: [0, 1, 3], mesh: [1, 3]}});
 let app = await startShootServer({port: 0, directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}});
 try {
  const create = async () => { const form = new FormData(); form.append('photo', new Blob([image]), 'test.png'); form.append('clientKey', 'real-key-0001'); const response = await fetch(app.url + '/api/shoot/jobs', {method: 'POST', body: form}); assert.equal(response.status, 202); return (await response.json()).job; };
  const copies = await Promise.all(Array.from({length: 10}, create)); assert.equal(new Set(copies.map(j => j.id)).size, 1);
  const done = await finish(app.jobs, copies[0].id); assert.equal(done.status, 'succeeded');
  assert.equal(done.recognition.lengthMeters, .42); assert.equal(done.recognition.massKg, .72);
  assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image', 'mesh']); assert.deepEqual(g.observations, ['multimodal-to-image', 'img-to-3d']);
  assert.ok(done.steps.every(s => s.startedAt && s.endedAt));
  const [item] = await app.jobs.items(); validateRuntimeItem(item, catalog); assert.deepEqual(item.rating, rateItem(item, catalog.materials));
  assert.equal(item.material, 'metal'); assert.equal(item.condition, 'worn'); assert.equal(item.mass, .72); assert.equal(item.outEnd, 1);
  assert.ok(Math.abs(Math.max(...item.bounds.max.map((v,i) => v - item.bounds.min[i])) - .42) < 1e-6);
  assert.ok(item.normalization.outwardEnd === 'wide');
  const publicText = JSON.stringify([done, item, await app.jobs.quota()]);
  for (const secret of [...Object.values(env), 'image-id', 'mesh-id', 'assets.example', 'test-upload-token']) assert.ok(!publicText.includes(secret));
  const saved = JSON.stringify(await readJson(path.join(directory, 'state.json'))); for (const secret of Object.values(env)) assert.ok(!saved.includes(secret));
  assert.equal((await app.jobs.quota()).provider, 'real');
  for (const asset of [item.glb, item.origin.photo, item.origin.styled]) assert.equal((await fetch(app.url + asset)).status, 200);
  await app.close(); app = await startShootServer({port: 0, directory, mode: 'real', env, realOptions: {fetch: () => {throw Error('must not call network');}}});
  assert.equal((await app.jobs.get(done.id)).status, 'succeeded'); assert.deepEqual(await app.jobs.items(), JSON.parse(JSON.stringify([item]))); // JSON normalizes -0 in the transform matrix.
 } finally { await app.close(); }
});

for (const options of [{visionReply: {status: 'failed', steps: []}}, {recognition: {...result, massKg: -1}}, {visionTimeout: true}]) test(`vision refusal/bounds/timeout never enters Aholo ${JSON.stringify(options)}`, async t => {
 const {jobs, g} = await open(t, options), j = await jobs.create({photo: image, clientKey: 'vision-fail-0001'}), done = await finish(jobs, j.id);
 assert.equal(done.error.code, 'photo-unclear'); assert.equal(done.error.charged, false); assert.deepEqual(g.creates, []); assert.equal(g.visionCalls(), 1);
 assert.equal((await jobs.create({photo: image, clientKey: 'vision-fail-0001'})).id, j.id); assert.equal(g.visionCalls(), 1);
});

for (const category of ['scissors', 'broom', 'lamp', 'slipper', 'pillow']) test(`recognized ${category} uses this piece's material, size and condition with valid runtime geometry`, async t => {
 const {jobs} = await open(t, {recognition: {...result, category, material: 'cloth', condition: 'damaged', inSix: false}});
 const j = await jobs.create({photo: image, clientKey: `category-${category}-001`}); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
 const [item] = await jobs.items(); assert.equal(item.category, category); assert.equal(item.material, 'cloth'); assert.equal(item.condition, 'damaged'); validateRuntimeItem(item, catalog);
});

for (const stage of ['image', 'mesh']) test(`unknown ${stage} create never repeats after restart and does not occupy active slot`, async t => {
 const directory = await dir(), g = gateway({unknown: stage, directory});
 let jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}});
 try {
  const j = await jobs.create({photo: image, clientKey: 'unknown-real-001'}), failed = await finish(jobs, j.id);
  assert.deepEqual(failed.error, {code: 'unknown-submit', message: 'unknown-submit', retry: 'none', charged: true});
  const count = g.creates.length; await jobs.close(); jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch}});
  assert.equal((await jobs.get(j.id)).error.code, 'unknown-submit'); assert.equal((await jobs.quota()).activeJobId, null);
  assert.equal((await jobs.create({photo: image, clientKey: 'unknown-real-001'})).id, j.id); assert.equal(g.creates.length, count);
  await assert.rejects(jobs.retry(j.id), {code: 'not-allowed'}); assert.deepEqual(await jobs.items(), []);
 } finally { await jobs.close(); }
});

for (const stage of ['image', 'mesh']) for (const status of [4, 6, 9, 0]) test(`Aholo ${stage} terminal/unknown/timeout ${status} preserves paid stages`, async t => {
 const {jobs, g} = await open(t, {statuses: {[stage]: [status]}}), j = await jobs.create({photo: image, clientKey: 'status-real-0001'}), failed = await finish(jobs, j.id);
 assert.equal(failed.error.code, stage === 'mesh' && [9, 0].includes(status) ? 'download' : 'step-failed'); assert.equal(failed.error.charged, true); assert.deepEqual(g.creates, stage === 'mesh' ? ['image', 'mesh'] : ['image']);
 if (failed.error.retry === 'regenerate') await assert.rejects(jobs.retry(j.id), {code: 'not-allowed'});
 else { await jobs.retry(j.id); await finish(jobs, j.id); assert.deepEqual(g.creates, ['image', 'mesh']); }
});

for (const stage of ['image', 'mesh']) test(`confirmed ${stage} busy rejection reports existing charges accurately`, async t => {
 const {jobs, g} = await open(t, {busy: stage}), j = await jobs.create({photo: image, clientKey: 'busy-real-0001'}), done = await finish(jobs, j.id);
 assert.equal(done.error.code, stage === 'image' ? 'busy' : 'step-failed'); assert.equal(done.error.charged, stage !== 'image');
 const child = await jobs.create({clientKey: 'busy-real-0002', ...(stage === 'image' ? {fromJob: j.id} : {regenerateOf: j.id, confirm: true})});
 await finish(jobs, child.id); assert.equal(g.visionCalls(), 1); assert.deepEqual(child.recognition, done.recognition);
});

test('download failure resumes saved model IDs without new vision or paid creation; processing failure keeps paid source', async t => {
 const {jobs, g, directory} = await open(t, {downloadFailure: true}); const j = await jobs.create({photo: image, clientKey: 'download-real-001'});
 const failed = await finish(jobs, j.id); assert.equal(failed.error.code, 'download'); assert.equal(failed.error.retry, 'same');
 await jobs.retry(j.id); assert.equal((await finish(jobs, j.id)).status, 'succeeded'); assert.deepEqual(g.creates, ['image', 'mesh']); assert.equal(g.visionCalls(), 1);
 assert.deepEqual(await fs.readFile(path.join(directory, j.id, 'source.glb')), model);
 const bad = await open(t, {badModel: true}), b = await bad.jobs.create({photo: image, clientKey: 'process-real-001'});
 assert.equal((await finish(bad.jobs, b.id)).error.code, 'process-unfixable'); await assert.rejects(bad.jobs.retry(b.id), {code: 'not-allowed'}); assert.deepEqual(bad.g.creates, ['image', 'mesh']);
 assert.equal((await fs.readFile(path.join(bad.directory, b.id, 'source.glb'))).toString(), 'invalid paid model');
});


for (const stage of ['vision', 'image', 'mesh']) for (const window of ['before', 'after']) test(`real paid ${stage} ${window}-reply hard exit keeps pending and never resubmits`, {timeout: 15000}, async t => {
 const directory = await dir();
 const source = `import fs from 'node:fs/promises'; import assert from 'node:assert/strict'; import path from 'node:path'; import sharp from 'sharp';
 import {startShootServer} from ${JSON.stringify(new URL('../shoot/server.mjs', import.meta.url).href)};
 import {recognitionPrompt} from ${JSON.stringify(new URL('../shoot/real.mjs', import.meta.url).href)};
 import {readJson} from ${JSON.stringify(new URL('../state.mjs', import.meta.url).href)};
 const env=${JSON.stringify(env)}, result=${JSON.stringify(result)}, image=Buffer.from(${JSON.stringify(image.toString('base64'))},'base64'), model=Buffer.from(${JSON.stringify(model.toString('base64'))},'base64');
 const geminiReply=${geminiReply.toString()}; const gateway=${gateway.toString()};
 const directory=${JSON.stringify(directory)}, stage=${JSON.stringify(stage)}, window=${JSON.stringify(window)}, g=gateway({directory});
 let chargeCalls=0;
 const request=async(url,options)=>{
  const isVision=new URL(url).hostname==='generativelanguage.googleapis.com';
  const isCreate=isVision||new URL(url).pathname.endsWith('/create');
  const actualStage=isVision?'vision':url.includes('multimodal-to-image')?'image':'mesh';
  const stop=async()=>{await fs.writeFile(path.join(directory,'charges.json'),JSON.stringify(chargeCalls));process.send({checkpoint:stage+'-'+window});await new Promise(()=>{});};
  if(isCreate&&actualStage===stage&&window==='before')await stop();
  const reply=await g.fetch(url,options);
  if(isCreate&&!isVision)chargeCalls++;
  if(isCreate&&actualStage===stage&&window==='after')await stop();
  return reply;
 };
 const app=await startShootServer({port:0,directory,mode:'real',env,realOptions:{fetch:request,pause:async()=>{}}});
 process.send({url:app.url});`;
 const child = spawn(process.execPath, ['--input-type=module', '-e', source], {cwd: path.join(REPO, 'tools/import-item'), stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
 let stderr = '', address, checkpoint; child.stderr.on('data', chunk => stderr += chunk);
 child.on('message', message => { if (message.url) address = message.url; if (message.checkpoint) checkpoint = message.checkpoint; });
 t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; } });
 await until(async () => { if (child.exitCode !== null) throw Error(stderr); return address; }, Boolean);
 const form = new FormData(); form.append('photo', new Blob([image]), 'test.png'); form.append('clientKey', 'real-hard-exit-001');
 const response = await fetch(address + '/api/shoot/jobs', {method: 'POST', body: form}); assert.equal(response.status, 202); const {job} = await response.json();
 await until(async () => { if (child.exitCode !== null) throw Error(stderr); return checkpoint; }, Boolean);
 const disk = await readJson(path.join(directory, 'state.json')); if (stage === 'vision') assert.equal(disk.jobs[job.id].providerState.recognitionPending, true);
 else assert.equal(disk.jobs[job.id].providerState.pending, stage === 'image' ? 'multimodal-to-image' : 'img-to-3d');
 assert.equal(await readJson(path.join(directory, 'charges.json')), (stage === 'mesh' ? 1 : 0) + (stage !== 'vision' && window === 'after' ? 1 : 0));
 const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
 let calls = 0; const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: () => {calls++;throw Error('no resubmit');}}});
 try {
  const failed = await jobs.get(job.id); assert.equal(failed.error.code, stage === 'vision' ? 'photo-unclear' : 'unknown-submit'); assert.equal(failed.error.retry, 'none');
  assert.equal((await jobs.create({photo: image, clientKey: 'real-hard-exit-001'})).id, job.id); assert.equal(calls, 0); assert.equal((await jobs.quota()).activeJobId, null);
 } finally { await jobs.close(); }
});
