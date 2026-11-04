import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Document, NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {setTimeout as pause} from 'node:timers/promises';
import {keychainEnvironment, startReal} from '../shoot/start-real.mjs';
import {realGenerator, parseRecognition, recognitionPrompt, recognitionSchema} from '../shoot/real.mjs';
import {startShootServer} from '../shoot/server.mjs';
import {openJobs, REPO} from '../shoot/jobs.mjs';
import {readJson} from '../state.mjs';
import {rateItem, photoMassLimit} from '../../../sim/item-rating.js';
import {validateRuntimeItem} from '../../../sim/runtime-items.js';
import {sha256} from '../mesh.mjs';
import {recognizePhoto} from '../shoot/recognition.mjs';
const env = {GEMINI_API_KEY: 'test-gemini-secret', AHOLO_API_KEY: 'test-aholo-secret'};
const result = {clear: true, recognizable: true, name: '平底锅', materialName: '金属', hardness: 1.2, outwardEnd: 'wide', lengthCm: 42, massKg: 0.72, material: 'metal', condition: 'worn', basis: '可见锅沿，按常见锅估计尺寸，有磨损'};
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
   const temporary = options.visionFailures?.shift();
   if (temporary === 'network') throw new TypeError('temporary transport failure');
   if (temporary) return new Response('', {status: temporary});
   if (options.visionNetwork) throw Error('network ' + env.GEMINI_API_KEY);
   if (options.visionStatus) return new Response('private-body ' + env.GEMINI_API_KEY, {status: options.visionStatus});
   if (options.visionBadJson) return new Response('private malformed ' + env.GEMINI_API_KEY);
   if (options.visionTimeout) return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), {once: true}));
   return Response.json(Object.hasOwn(options, 'visionReply') ? options.visionReply : geminiReply(options.recognition ?? result));
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
    if (options.queryStatus?.[stage]) return new Response('private query failure', {status: options.queryStatus[stage]});
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

test('retake real provider cancels after recognition with no upload, paid creation or quota use', async t => {
 const {jobs, g, directory} = await open(t);
 const j = await jobs.create({photo: image, clientKey: 'retake-real-001'});
 const ready = await until(() => jobs.get(j.id), value => value.retakeUntil);
 assert.equal(ready.recognition.name, result.name); assert.ok(ready.steps.every(s => s.startedAt === null));
 assert.equal(g.visionCalls(), 1); assert.equal(g.seen.length, 1);
 await Promise.all(Array.from({length: 10}, () => jobs.retake(j.id)));
 assert.deepEqual((await jobs.get(j.id)).error, {code: 'retake', message: 'retake', retry: 'none', charged: false});
 assert.equal((await jobs.quota()).used, 0); assert.equal((await jobs.quota()).activeJobId, null);
 assert.deepEqual(g.creates, []); assert.equal(g.seen.length, 1); assert.deepEqual(await jobs.items(), []);
 assert.equal((await readJson(path.join(directory, 'state.json'))).jobs[j.id].providerId, null);
});

test('retake real provider automatically starts after expiry and cannot then cancel a paid job', async t => {
 const {jobs, g} = await open(t);
 const j = await jobs.create({photo: image, clientKey: 'retake-real-late-001'});
 const ready = await until(() => jobs.get(j.id), value => value.retakeUntil);
 const done = await finish(jobs, j.id); assert.equal(done.status, 'succeeded');
 assert.ok(Date.parse(done.steps[0].startedAt) >= Date.parse(ready.retakeUntil));
 await assert.rejects(jobs.retake(j.id), {code: 'not-allowed', status: 409});
 assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image', 'mesh']); assert.equal((await jobs.quota()).used, 1);
});

test('strict recognition bounds/enums/refusals do not silently substitute a high rating', () => {
 for (const patch of [{clear: false}, {clear: 'true'}, {recognizable: false}, {name: ''}, {name: 'a'.repeat(41)}, {name: 'a\n'}, {materialName: ''}, {hardness: 0}, {hardness: 1.21}, {outwardEnd: 'left'}, {material: 'glass'}, {condition: 'new'}, {inSix: 'yes'}, {lengthCm: 0}, {lengthCm: 301}, {massKg: 0}, {massKg: Infinity}, {massKg: '1'}, {basis: ''}, {basis: 'a\n'}, {basis: 'a'.repeat(161)}, {extra: 1}]) assert.throws(() => parseRecognition({...result, ...patch}), {code: 'recognition-invalid'});
 for (const condition of ['intact', 'worn', 'damaged', 'unknown']) assert.equal(parseRecognition({...result, condition}).condition, condition);
 assert.equal(parseRecognition({...result, lengthCm: 1, massKg: .001}).lengthMeters, .01);
 assert.equal(parseRecognition({...result, name: '保温杯', lengthCm: 300, massKg: 100}).name, '保温杯');
});

test('names longer than twelve characters are shortened consistently without cutting a code point', () => {
 const name='儿童电动塑料玩具小汽车加长版本';
 const parsed=parseRecognition({...result,name});
 assert.equal(parsed.name,Array.from(name).slice(0,12).join('')); assert.equal(parsed.category,parsed.name);
 assert.equal(Array.from(parseRecognition({...result,name:'🚗'.repeat(15)}).name).length,12);
 assert.equal(parseRecognition({...result,name:'日常名字'}).name,'日常名字');
});

for (const [lengthCm,massKg,expectedMass] of [[300,100,2],[1,.001,.001]]) test(`photo estimate ${lengthCm}cm/${massKg}kg produces bounded combat geometry and mass`, async t => {
 const {jobs}=await open(t,{recognition:{...result,name:'测试物件',lengthCm,massKg}});
 const j=await jobs.create({photo:image,clientKey:'bounded-photo-001'}),done=await finish(jobs,j.id);
 assert.equal(done.status,'succeeded'); assert.equal(done.recognition.massKg,massKg);
 assert.equal(photoMassLimit(catalog),2); // The historical 2.5kg pot is replaced in the default nine.
 const [item]=await jobs.items(); assert.equal(item.mass,expectedMass); validateRuntimeItem(item,catalog);
 assert.ok(Math.abs(Math.max(...item.bounds.max.map((v,i)=>v-item.bounds.min[i]))-Math.min(.8,lengthCm/100))<1e-6);
 assert.deepEqual(item.rating,rateItem(item,catalog.materials));
});

test('recognition-only entry point accepts any object without Aholo configuration or requests', async () => {
 const g=gateway({recognition:{...result,name:'马克杯',materialName:'陶瓷'}});
 const recognition=await recognizePhoto({photo:await sharp(image).jpeg().toBuffer(),key:env.GEMINI_API_KEY,fetch:g.fetch});
 assert.equal(recognition.name,'马克杯'); assert.equal(recognition.category,'马克杯'); assert.equal(recognition.materialName,'陶瓷'); assert.equal(recognition.inSix,undefined);
 assert.equal(g.visionCalls(),1); assert.equal(g.seen.length,1); assert.deepEqual(g.creates,[]);
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
 const directory = await dir(), g = gateway({directory, visionFailures: ['network', 503], statuses: {image: [0, 1, 3], mesh: [1, 3]}});
 let app = await startShootServer({port: 0, directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}});
 try {
  const create = async () => { const form = new FormData(); form.append('photo', new Blob([image]), 'test.png'); form.append('clientKey', 'real-key-0001'); const response = await fetch(app.url + '/api/shoot/jobs', {method: 'POST', body: form}); assert.equal(response.status, 202); return (await response.json()).job; };
  const copies = await Promise.all(Array.from({length: 10}, create)); assert.equal(new Set(copies.map(j => j.id)).size, 1);
  const done = await finish(app.jobs, copies[0].id); assert.equal(done.status, 'succeeded');
  assert.equal(done.recognition.lengthMeters, .42); assert.equal(done.recognition.massKg, .72);
  assert.equal(g.visionCalls(), 3); assert.deepEqual(g.creates, ['image', 'mesh']); assert.deepEqual(g.observations, ['multimodal-to-image', 'img-to-3d']);
  assert.ok(done.steps.every(s => s.startedAt && s.endedAt));
  const [item] = await app.jobs.items(); validateRuntimeItem(item, catalog); assert.deepEqual(item.rating, rateItem(item, catalog.materials));
  assert.equal(item.material, 'metal'); assert.equal(item.condition, 'worn'); assert.equal(item.mass, .72);
  assert.equal(item.outEnd, -1); // The fixture's wide end is at -X; keeping Y-up must not flip it to +Z.
  assert.equal(item.normalization.orientation.sourceUpAxis, 'Y');
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
 assert.equal(done.error.code, options.visionTimeout ? 'recognition-network' : 'recognition-invalid'); assert.equal(done.error.charged, false); assert.deepEqual(g.creates, []); assert.equal(g.visionCalls(), options.visionTimeout ? 3 : 1);
 assert.equal((await jobs.create({photo: image, clientKey: 'vision-fail-0001'})).id, j.id); assert.equal(g.visionCalls(), options.visionTimeout ? 3 : 1);
});

for (const flags of [{clear: false, recognizable: true}, {clear: true, recognizable: false}]) test(`schema-compliant unclear photo does not guess a category or create paid Aholo work ${JSON.stringify(flags)}`, async t => {
 const recognition = {...flags, name: null, materialName: null, hardness: null, outwardEnd: null, lengthCm: null, massKg: null, material: null, condition: null, basis: '无法辨认一个清楚的主要物品'};
 assert.deepEqual(Object.keys(recognition).sort(), [...recognitionSchema.required].sort());
 for (const [key, value] of Object.entries(recognition)) {
  const schema = recognitionSchema.properties[key], type = value === null ? 'null' : typeof value;
  assert.ok([schema.type].flat().includes(type));
  if (schema.enum) assert.ok(schema.enum.includes(value));
 }
 const {jobs, g} = await open(t, {recognition}), j = await jobs.create({photo: image, clientKey: 'unclear-real-001'}), failed = await finish(jobs, j.id);
 assert.equal(failed.recognition, null); assert.equal(failed.error.code, 'photo-unclear'); assert.equal(failed.error.charged, false);
 assert.deepEqual(g.creates, []); assert.equal(g.visionCalls(), 1); assert.deepEqual(await jobs.items(), []);
 assert.equal((await jobs.create({photo: image, clientKey: 'unclear-real-001'})).id, j.id); assert.equal(g.visionCalls(), 1);
});

for (const name of ['保温杯', '雨伞', '鼠标', '玩具车', '书', '马克杯']) for (const lengthCm of [1, 300]) test(`unrestricted ${name} ${lengthCm}cm uses its mesh, caps size and keeps a proportional weak spot`, async t => {
 const {jobs, directory} = await open(t, {recognition: {...result, name, lengthCm}}), j = await jobs.create({photo: image, clientKey: 'size-real-001'});
 assert.equal((await finish(jobs, j.id)).status, 'succeeded');
 const [item] = await jobs.items(); validateRuntimeItem(item, catalog);
 assert.equal(item.name, name); assert.equal(item.category, name); assert.equal(item.tag, 'photo');
 assert.equal(item.templateId, undefined); assert.equal(item.materialName, '金属'); assert.equal(item.photoPhysics.hardness, 1.2);
 const length = Math.max(...item.bounds.max.map((v, i) => v - item.bounds.min[i]));
 assert.ok(Math.abs(length - Math.min(.8, lengthCm / 100)) < 1e-6);
 assert.ok(Math.abs(item.weakPoint.radius / length - .06) < 1e-6);
 const saved=await readJson(path.join(directory,'state.json'));
 assert.deepEqual(saved.jobs[j.id].providerState.orientation,item.normalization.orientation);
});

for (const name of ['剪刀', '扫把', '台灯', '拖鞋', '枕头']) test(`recognized ${name} uses this piece's estimates instead of a category template`, async t => {
 const {jobs} = await open(t, {recognition: {...result, name, materialName: '柔软海绵', material: 'cloth', hardness: .1, condition: 'damaged', outwardEnd: 'unknown'}});
 const j = await jobs.create({photo: image, clientKey: 'identity-001'}); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
 const [item] = await jobs.items(); assert.equal(item.category, name); assert.equal(item.material, 'cloth'); assert.equal(item.condition, 'damaged'); assert.equal(item.photoPhysics.hardness, .1); validateRuntimeItem(item, catalog);
});

test('stored recognitions from the previous six-category version still finish without another provider call', async () => {
 const provider=realGenerator({env,fetch:()=>{throw Error('no request during processing');}});
 for(const category of ['scissors','pot','broom','lamp','slipper','pillow']) {
  const folder=await dir(); await fs.writeFile(path.join(folder,'model.glb'),model);
  const recognition={category,inSix:true,lengthMeters:.42,massKg:.72,material:'metal',condition:'worn'};
  const item=await provider.step('process','legacy',{folder,recognition,state:{downloadSha256:sha256(model)},save:async()=>{},mountRules:JSON.parse(await fs.readFile(path.join(REPO,'sim/v3-rules.json'),'utf8'))},catalog);
  Object.assign(item,{id:'legacy-'+category,glb:'/legacy.glb',rating:rateItem(item,catalog.materials)});
  validateRuntimeItem(item,catalog);
  assert.equal(item.category,category); assert.equal(item.photoPhysics,undefined);
  const template=catalog.items.find(i=>i.category===category&&!i.generated&&!i.comparisonBase);
  const size=Math.max(...template.bounds.max.map((v,i)=>v-template.bounds.min[i]));
  assert.ok(Math.abs(item.weakPoint.radius/.42-template.weakPoint.radius/size)<1e-6);
 }
});

for (const stage of ['image', 'mesh']) test(`unknown ${stage} create never repeats after restart and does not occupy active slot`, async t => {
 const directory = await dir(), g = gateway({unknown: stage, directory});
 let jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}});
 try {
  const j = await jobs.create({photo: image, clientKey: 'unknown-real-001'}), failed = await finish(jobs, j.id);
  assert.deepEqual(failed.error, {code: 'unknown-submit', message: 'unknown-submit', retry: 'none', charged: true});
  assert.equal(jobs.waitingForPaidId(), false, 'a retained pending marker is not an in-flight request');
  const count = g.creates.length; await jobs.close(); jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch}});
  assert.equal((await jobs.get(j.id)).error.code, 'unknown-submit'); assert.equal((await jobs.quota()).activeJobId, null);
  assert.equal((await jobs.create({photo: image, clientKey: 'unknown-real-001'})).id, j.id); assert.equal(g.creates.length, count);
  await assert.rejects(jobs.retry(j.id), {code: 'not-allowed'}); assert.deepEqual(await jobs.items(), []);
 } finally { await jobs.close(); }
});

for (const stage of ['image', 'mesh']) for (const status of [4, 6, 9, 0]) test(`Aholo ${stage} terminal/unknown/timeout ${status} preserves paid stages`, async t => {
 const {jobs, g} = await open(t, {statuses: {[stage]: [status]}}), j = await jobs.create({photo: image, clientKey: 'status-real-0001'}), failed = await finish(jobs, j.id);
 assert.equal(failed.error.code, [4, 6].includes(status) ? 'step-failed' : 'download'); assert.equal(failed.error.charged, true); assert.deepEqual(g.creates, stage === 'mesh' ? ['image', 'mesh'] : ['image']);
 if (failed.error.retry === 'regenerate') await assert.rejects(jobs.retry(j.id), {code: 'not-allowed'});
 else { await jobs.retry(j.id); await finish(jobs, j.id); assert.deepEqual(g.creates, stage === 'mesh' ? ['image', 'mesh'] : ['image']); }
});

for (const stage of ['image', 'mesh']) test(`confirmed ${stage} busy rejection reports existing charges accurately`, async t => {
 const {jobs, g} = await open(t, {busy: stage}), j = await jobs.create({photo: image, clientKey: 'busy-real-0001'}), done = await finish(jobs, j.id);
 assert.equal(done.error.code, stage === 'image' ? 'busy' : 'download'); assert.equal(done.error.charged, stage !== 'image');
 if (stage === 'image') {
  const child = await jobs.create({clientKey: 'busy-real-0002', fromJob: j.id});
  await finish(jobs, child.id); assert.deepEqual(child.recognition, done.recognition);
 } else {
  assert.equal(done.error.retry, 'same'); await jobs.retry(j.id); await finish(jobs, j.id);
  await assert.rejects(jobs.create({clientKey: 'busy-real-0002', regenerateOf: j.id, confirm: true}), {code: 'not-allowed'});
 }
 assert.equal(g.visionCalls(), 1);
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

test('partial source copy I/O failure is free to resume after restarting, with the original paid model intact', async () => {
 const directory = await dir(), g = gateway({directory}), copyFile = fs.copyFile;
 let jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}}), j;
 try {
  fs.copyFile = async (from, to, ...args) => {
   if (path.basename(to) === 'source.glb.part') {
    await fs.writeFile(to, model.subarray(0, Math.floor(model.length / 2)));
    throw Object.assign(Error('simulated copy interruption'), {code: 'EIO'});
   }
   return copyFile(from, to, ...args);
  };
  j = await jobs.create({photo: image, clientKey: 'copy-io-real-001'});
  const failed = await finish(jobs, j.id); assert.equal(failed.error.code, 'process'); assert.equal(failed.error.retry, 'same');
  assert.deepEqual(await fs.readFile(path.join(directory, j.id, 'model.glb')), model);
  await assert.rejects(fs.access(path.join(directory, j.id, 'source.glb')), {code: 'ENOENT'});
 } finally { fs.copyFile = copyFile; await jobs.close(); }
 const resumed = gateway();
 jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: resumed.fetch, pause: async () => {}}});
 try {
  assert.equal((await jobs.create({photo: image, clientKey: 'copy-io-real-001'})).id, j.id);
  await jobs.retry(j.id); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
  assert.deepEqual(await fs.readFile(path.join(directory, j.id, 'source.glb')), model);
  assert.deepEqual(g.creates, ['image', 'mesh']); assert.deepEqual(resumed.seen, []); assert.equal((await jobs.items()).length, 1);
 } finally { await jobs.close(); }
});

test('hard exit during source copy resumes processing from the intact paid model without any network call', {timeout: 15000}, async t => {
 const directory = await dir();
 const source = `import fs from 'node:fs/promises'; import assert from 'node:assert/strict'; import path from 'node:path'; import sharp from 'sharp';
 import {startShootServer} from ${JSON.stringify(new URL('../shoot/server.mjs', import.meta.url).href)};
 import {recognitionPrompt} from ${JSON.stringify(new URL('../shoot/real.mjs', import.meta.url).href)};
 import {readJson} from ${JSON.stringify(new URL('../state.mjs', import.meta.url).href)};
 const env=${JSON.stringify(env)}, result=${JSON.stringify(result)}, image=Buffer.from(${JSON.stringify(image.toString('base64'))},'base64'), model=Buffer.from(${JSON.stringify(model.toString('base64'))},'base64');
 const geminiReply=${geminiReply.toString()}; const gateway=${gateway.toString()};
 const directory=${JSON.stringify(directory)}, g=gateway({directory}), copyFile=fs.copyFile;
 fs.copyFile=async(from,to,...args)=>{
  if(path.basename(to) === 'source.glb.part'){await fs.writeFile(to,model.subarray(0,Math.floor(model.length/2)));process.send({checkpoint:true});await new Promise(()=>{});}
  return copyFile(from,to,...args);
 };
 const app=await startShootServer({port:0,directory,mode:'real',env,realOptions:{fetch:g.fetch,pause:async()=>{}}});process.send({url:app.url});`;
 const child = spawn(process.execPath, ['--input-type=module', '-e', source], {cwd: path.join(REPO, 'tools/import-item'), stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
 let stderr = '', address, checkpoint; child.stderr.on('data', chunk => stderr += chunk);
 child.on('message', message => { if (message.url) address = message.url; if (message.checkpoint) checkpoint = true; });
 t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; } });
 await until(async () => { if (child.exitCode !== null) throw Error(stderr); return address; }, Boolean);
 const form = new FormData(); form.append('photo', new Blob([image]), 'test.png'); form.append('clientKey', 'copy-exit-real-001');
 const response = await fetch(address + '/api/shoot/jobs', {method: 'POST', body: form}); assert.equal(response.status, 202); const {job} = await response.json();
 await until(async () => { if (child.exitCode !== null) throw Error(stderr); return checkpoint; }, Boolean);
 const disk = await readJson(path.join(directory, 'state.json')), record = disk.jobs[job.id];
 assert.deepEqual(record.providerState.tasks, {'multimodal-to-image': 'image-id', 'img-to-3d': 'mesh-id'});
 assert.equal(record.job.status, 'generating'); assert.ok(record.job.steps[3].startedAt); assert.equal(record.job.steps[3].endedAt, null);
 assert.deepEqual(await fs.readFile(path.join(directory, job.id, 'model.glb')), model);
 assert.ok((await fs.stat(path.join(directory, job.id, 'source.glb.part'))).size < model.length);
 await assert.rejects(fs.access(path.join(directory, job.id, 'source.glb')), {code: 'ENOENT'});
 const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
 let calls = 0;
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: () => { calls++; throw Error('must not call network'); }}});
 try {
  assert.equal((await finish(jobs, job.id)).status, 'succeeded'); assert.equal(calls, 0);
  assert.equal((await jobs.create({photo: image, clientKey: 'copy-exit-real-001'})).id, job.id);
  assert.deepEqual(await fs.readFile(path.join(directory, job.id, 'source.glb')), model);
  assert.equal((await jobs.items()).length, 1);
 } finally { await jobs.close(); }
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
  const failed = await jobs.get(job.id); assert.equal(failed.error.code, stage === 'vision' ? 'recognition-interrupted' : 'unknown-submit'); assert.equal(failed.error.retry, 'none');
  assert.equal((await jobs.create({photo: image, clientKey: 'real-hard-exit-001'})).id, job.id); assert.equal(calls, 0); assert.equal((await jobs.quota()).activeJobId, null);
 } finally { await jobs.close(); }
});

for (const [options, code] of [[{visionStatus: 401}, 'recognition-auth'], [{visionStatus: 403}, 'recognition-auth'], [{visionStatus: 429}, 'recognition-limit'], [{visionStatus: 503}, 'recognition-service'], [{visionNetwork: true}, 'recognition-network'], [{visionBadJson: true}, 'recognition-invalid']]) test(`recognition ${code} is safe, distinct and survives restart ${JSON.stringify(options)}`, async () => {
 const directory = await dir(), g = gateway(options), logs = [], log = console.error;
 let jobs;
 try {
  console.error = (...args) => logs.push(args.join(' '));
  jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch}});
  const j = await jobs.create({photo: image, clientKey: 'vision-classified-001'}), failed = await finish(jobs, j.id);
  assert.equal(failed.error.code, code); assert.equal(failed.error.retry, 'none'); assert.equal(failed.error.charged, false);
  await jobs.close(); jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch}});
  assert.equal((await jobs.get(j.id)).error.code, code); assert.equal(g.visionCalls(), options.visionStatus === 503 || options.visionNetwork ? 3 : 1); assert.deepEqual(g.creates, []);
  assert.ok(logs.length === 1 && logs[0].includes(code));
  for (const secret of [...Object.values(env), 'private-body', 'private malformed', 'https://']) assert.ok(!logs.join().includes(secret));
 } finally { console.error = log; await jobs?.close(); }
});

test('keychain launcher injects only child env and reports service names without secret diagnostics', async () => {
 const names = [], parent = {KEEP: 'ok', GEMINI_API_KEY: 'stale'}, child = {pid: 123};
 const launched = await startReal({env: parent, nodeVersion: '24.12.0', args: ['--port', '0'], readSecret: async name => {names.push(name); return ` ${name}-test-secret\n`;}, spawnServer: (node, args, options) => {
  assert.equal(node, process.execPath); assert.deepEqual(args.slice(1), ['--provider', 'real', '--port', '0']);
  assert.equal(options.env.KEEP, 'ok'); assert.equal(options.env.GEMINI_API_KEY, 'wanwu-gemini-api-key-test-secret'); assert.equal(options.env.AHOLO_API_KEY, 'wanwu-aholo-api-key-test-secret');
  assert.equal(options.env.NODE_USE_ENV_PROXY, '1'); assert.equal(options.env.HTTPS_PROXY, 'http://127.0.0.1:7897'); assert.equal(options.env.https_proxy, options.env.HTTPS_PROXY);
  assert.equal(options.env.NO_PROXY, 'api.aholo.ai'); assert.equal(options.env.no_proxy, options.env.NO_PROXY);
  assert.equal(args.some(x => x.includes('test-secret')), false); return child;
 }});
 assert.equal(launched, child); assert.equal(parent.GEMINI_API_KEY, 'stale');
 assert.deepEqual(names, ['wanwu-gemini-api-key', 'wanwu-aholo-api-key']);
 await assert.rejects(keychainEnvironment({env: {}, readSecret: async () => {throw Error('unprinted SECRET');}}), error => error.message === 'Missing keychain services: wanwu-gemini-api-key, wanwu-aholo-api-key');
 await assert.rejects(keychainEnvironment({env: {}, readSecret: async name => name.includes('gemini') ? 'fixture' : ''}), {message: 'Missing keychain services: wanwu-aholo-api-key'});
});

test('real launcher rejects old Node before reading secrets, and proxy settings affect only its child', async () => {
 let read = 0;
 for (const nodeVersion of ['18.20.8','22.18.0','23.11.0']) await assert.rejects(startReal({nodeVersion, readSecret: async () => {read++;}}), /需要 Node 24/);
 assert.equal(read, 0);
 for (const override of [false, true]) {
  const parent = {https_proxy:'http://other-app.invalid:1234', NO_PROXY:'localhost', no_proxy:'127.0.0.1', WANWU_REAL_PROXY:'http://127.0.0.1:9000', ...(override ? {WANWU_REAL_NO_PROXY:'localhost'} : {})};
  await startReal({nodeVersion:'24.12.0', env:parent, readSecret:async()=> 'fixture-key', spawnServer:(_node,_args,{env})=> {
   assert.equal(env.https_proxy,'http://127.0.0.1:9000'); assert.equal(env.HTTPS_PROXY,env.https_proxy);
   assert.equal(env.NO_PROXY,override ? 'localhost' : 'localhost,127.0.0.1,api.aholo.ai'); assert.equal(env.no_proxy,env.NO_PROXY);
  }});
  assert.equal(parent.https_proxy,'http://other-app.invalid:1234'); assert.equal(parent.NODE_USE_ENV_PROXY,undefined);
 }
});

for (const http of [404, 403, 500]) test(`known image query HTTP ${http} is bounded and free retry creates only this order's first mesh`, async () => {
 const directory = await dir(), options = {queryStatus: {image: http}}, g = gateway(options), waits = [];
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async ms => waits.push(ms)}});
 try {
  const j = await jobs.create({photo: image, clientKey: 'image-known-retry-001'}), failed = await finish(jobs, j.id);
  assert.equal(failed.error.code, 'download'); assert.equal(failed.error.retry, 'same'); assert.equal(failed.error.charged, true);
  assert.deepEqual(g.creates, ['image']); assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(g.seen.filter(x => x.route.endsWith('/get')).length, 4);
  options.queryStatus.image = null;
  await jobs.retry(j.id); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
  assert.deepEqual(g.creates, ['image', 'mesh']); assert.equal(g.visionCalls(), 1);
  assert.equal((await jobs.create({photo: image, clientKey: 'image-known-retry-001'})).id, j.id);
 } finally { await jobs.close(); }
});

test('transient query recovers inside bounded backoff without duplicate creation', async t => {
 const directory = await dir(), g = gateway(), delays = []; let failures = 0;
 const request = (url, options) => {
  if (url.includes('task/get') && failures++ < 2) return Promise.reject(Error('transient'));
  return g.fetch(url, options);
 };
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: request, pause: async ms => delays.push(ms)}}); t.after(() => jobs.close());
 const j = await jobs.create({photo: image, clientKey: 'query-backoff-001'}); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
 assert.deepEqual(delays, [1000, 2000]); assert.deepEqual(g.creates, ['image', 'mesh']);
});

for (const failedStage of ['token', 'upload']) test(`free retry after ${failedStage} failure submits each stage for the first time once`, async () => {
 const directory = await dir(), g = gateway(); let broken = true;
 const request = (url, options) => {
  if (broken && (failedStage === 'token' ? url.endsWith('/token') : url.includes('/single/upload'))) throw Error('offline upload failure');
  return g.fetch(url, options);
 };
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: request, pause: async () => {}}});
 try {
  const j = await jobs.create({photo: image, clientKey: 'upload-first-stage-001'}), failed = await finish(jobs, j.id);
  assert.equal(failed.error.code, 'photo-upload'); assert.equal(failed.error.retry, 'same'); assert.equal(failed.error.charged, false);
  assert.deepEqual(g.creates, []);
  broken = false; await jobs.retry(j.id); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
  assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image', 'mesh']);
  assert.equal((await jobs.create({photo: image, clientKey: 'upload-first-stage-001'})).id, j.id);
  assert.deepEqual(g.creates, ['image', 'mesh']);
 } finally { await jobs.close(); }
});

// Include the fixed 5-second retake window before exercising shutdown.
for (const stage of ['image', 'mesh']) test(`close collects the in-flight ${stage} creation ID before exiting`, {timeout: 10000}, async () => {
 const directory = await dir(), g = gateway(); let entered = false, release, requestSignal;
 const request = async (url, options) => {
  if (url.endsWith('/create') && url.includes(stage === 'image' ? 'multimodal-to-image' : 'img-to-3d')) {
   entered = true; requestSignal = options.signal;
   await new Promise((resolve, reject) => { release = resolve; options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true}); });
  }
  return g.fetch(url, options);
 };
 let jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: request}});
 try {
  const j = await jobs.create({photo: image, clientKey: 'close-create-001'}); await until(async () => entered, Boolean);
  const closing = jobs.close(); await pause(10); assert.equal(requestSignal.aborted, false);
  release(); await closing;
  const saved = (await readJson(path.join(directory, 'state.json'))).jobs[j.id];
  assert.equal(saved.providerState.tasks[stage === 'image' ? 'multimodal-to-image' : 'img-to-3d'], stage + '-id');
  assert.equal(saved.providerState.pending, undefined); assert.equal(saved.job.status, 'generating');
  assert.deepEqual(g.creates, stage === 'image' ? ['image'] : ['image', 'mesh']);
  jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}});
  assert.equal((await finish(jobs, j.id)).status, 'succeeded'); assert.deepEqual(g.creates, ['image', 'mesh']); assert.equal(g.visionCalls(), 1);
 } finally { release?.(); await jobs.close(); }
});

async function serverFixture() {
 // Run the actual CLI files in a tiny isolated repo. Only security and outbound
 // requests are stubbed; no real keychain, supplier or shared state is touched.
 const repo = await fs.realpath(await dir()), tools = path.join(repo, 'tools/import-item'), shoot = path.join(tools, 'shoot');
 await fs.mkdir(shoot, {recursive: true});
 for (const file of ['start-real.mjs', 'server.mjs', 'jobs.mjs']) await fs.copyFile(path.join(REPO, 'tools/import-item/shoot', file), path.join(shoot, file));
 for (const file of ['real.mjs', 'fake.mjs']) await fs.symlink(path.join(REPO, 'tools/import-item/shoot', file), path.join(shoot, file));
 for (const file of ['state.mjs', 'origin.mjs']) await fs.symlink(path.join(REPO, 'tools/import-item', file), path.join(tools, file));
 await fs.symlink(path.join(REPO, 'tools/import-item/node_modules'), path.join(tools, 'node_modules'));
 for (const folder of ['sim', 'data']) await fs.symlink(path.join(REPO, folder), path.join(repo, folder));
 await fs.writeFile(path.join(repo, 'package.json'), '{"type":"module"}');
 const bin = path.join(repo, 'bin'); await fs.mkdir(bin);
 await fs.writeFile(path.join(bin, 'security'), '#!/bin/sh\nprintf "offline-fixture-key\\n"\n', {mode: 0o700});
 return {repo, shoot, bin};
}

for (const mode of ['fake', 'real']) test(`idle ${mode} server shutdown does not claim to wait for a paid ID`, {skip: process.platform === 'win32', timeout: 5000}, async () => {
 const {repo, shoot} = await serverFixture(), hook = path.join(repo, 'idle.mjs'), ready = path.join(repo, 'signals-ready');
 await fs.writeFile(hook, `import fs from 'node:fs';import net from 'node:net';const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(port,...args){return listen.call(this,0,...args)};const on=process.on;process.on=function(event,...args){const result=on.call(this,event,...args);if(event==='SIGTERM')fs.writeFileSync(${JSON.stringify(ready)},'ready');return result};globalThis.fetch=()=>{throw Error('Unexpected offline request')};`);
 const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, path.join(shoot, 'server.mjs'), '--provider', mode], {env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
 const exited = once(child, 'exit'); let output = '';
 child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
 try {
  await until(async () => { if (child.exitCode !== null) throw Error(output); return fs.access(ready).then(() => true, () => false); }, Boolean);
  child.kill('SIGTERM'); assert.deepEqual(await exited, [0, null]);
  assert.doesNotMatch(output, /paid creation ID|120 seconds|Unexpected offline request/);
 } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
});

for (const closeFailure of [false, true]) test(`keychain launcher saves paid ID under repeated SIGINT; close failure=${closeFailure}`, {skip: process.platform === 'win32', timeout: 10000}, async () => {
 const {repo, shoot, bin} = await serverFixture();
 const hook = path.join(repo, 'offline.mjs'), entered = path.join(repo, 'creating'), released = path.join(repo, 'release');
 await fs.writeFile(hook, `
import fs from 'node:fs/promises';import net from 'node:net';import {setTimeout as pause} from 'node:timers/promises';
// This isolated fixture stubs outbound fetch; exercise launcher forwarding on
// the Node 22 CI runner independently of the production Node 24 version gate.
Object.defineProperty(process.versions,'node',{value:'24.12.0'});
const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(port,...args){return listen.call(this,0,...args)};
if(${closeFailure}){const rmdir=fs.rmdir;fs.rmdir=async(file,...args)=>{if(file.includes('/.owner/'))throw Object.assign(Error('https://private.example/offline-fixture-key'),{name:'https://private.example',code:'EACCES',status:503});return rmdir(file,...args)}};
globalThis.fetch=async(url,options)=>{
 const ok=d=>Response.json({c:'0',d});
 if(url.includes('googleapis'))return Response.json(${JSON.stringify(geminiReply(result))});
 if(url.endsWith('/token'))return Response.json({ousToken:'offline',globalDomain:'https://upload.example',blockSize:1000000});
 if(url.includes('upload.example'))return ok(url.endsWith('/status')?{status:5,url:'https://assets.example/photo.jpg'}:{});
 if(url.includes('multimodal-to-image/task/create')){
  await fs.writeFile(${JSON.stringify(entered)},'started');
  while(true){try{await fs.access(${JSON.stringify(released)});break}catch{await pause(10)}}
  return ok('image-id');
 }
 throw Error('Unexpected offline request');
};`);
 const child = spawn(process.execPath, [path.join(shoot, 'start-real.mjs')], {detached: true, env: {...process.env, PATH: bin + path.delimiter + process.env.PATH, NODE_OPTIONS: '--import=' + pathToFileURL(hook).href}, stdio: ['ignore', 'pipe', 'pipe']});
 const exited = once(child, 'exit'); let output = '', errors = '';
 child.stdout.on('data', b => output += b); child.stderr.on('data', b => errors += b);
 try {
  const url = await until(async () => {
   if (child.exitCode !== null || child.signalCode !== null) throw Error(`Offline launcher exited (${child.exitCode ?? child.signalCode}): ` + errors);
   return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  }, Boolean);
  const form = new FormData(); form.append('photo', new Blob([image]), 'test.png'); form.append('clientKey', 'signal-launcher-001');
  const response = await fetch(url + '/api/shoot/jobs', {method: 'POST', body: form}); assert.equal(response.status, 202); const {job} = await response.json();
  await until(async () => fs.access(entered).then(() => true, () => false), Boolean);
  process.kill(-child.pid, 'SIGINT'); await pause(30);
  // A second interrupt must also be harmless while the same close is pending.
  process.kill(-child.pid, 'SIGINT'); await pause(30);
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
  assert.match(output, /in-flight paid creation ID.*120 seconds/);
  await fs.writeFile(released, 'continue');
  assert.deepEqual(await exited, [closeFailure ? 1 : 0, null]);
  const state = (await readJson(path.join(repo, '.aholo/shoot-real/state.json'))).jobs[job.id];
  assert.equal(state.providerState.tasks['multimodal-to-image'], 'image-id'); assert.equal(state.providerState.pending, undefined);
  assert.equal(state.providerState.tasks['img-to-3d'], undefined);
  if (closeFailure) assert.match(errors, /Shoot shutdown failed: \{"type":"UNKNOWN","code":"EACCES","status":503\}/);
  else await assert.rejects(fs.access(path.join(repo, '.aholo/shoot-real/.owner')), {code: 'ENOENT'});
  assert.doesNotMatch(output + errors, /offline-fixture-key|private\.example/);
 } finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  await exited;
 }
});

test('close cancels an in-flight Aholo request and restart polls the saved image, never resubmits it', {timeout: 10000}, async () => {
 const directory = await dir(), g = gateway(); let querying = false, aborted = false;
 const request = (url, options) => {
  if (url.includes('task/get')) { querying = true; return new Promise((_, reject) => options.signal.addEventListener('abort', () => {aborted = true; reject(options.signal.reason);}, {once: true})); }
  return g.fetch(url, options);
 };
 let jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: request}});
 try {
  const j = await jobs.create({photo: image, clientKey: 'close-query-001'}); await until(async () => querying, Boolean);
  await jobs.close(); assert.equal(aborted, true); assert.deepEqual(g.creates, ['image']);
  jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}});
  assert.equal((await finish(jobs, j.id)).status, 'succeeded'); assert.deepEqual(g.creates, ['image', 'mesh']); assert.equal(g.visionCalls(), 1);
 } finally { await jobs.close(); }
});

test('close cancels polling sleep rather than waiting forty minutes', {timeout: 10000}, async () => {
 const directory = await dir(), g = gateway({statuses: {image: [0]}}); let asleep = false;
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: () => {asleep = true; return new Promise(() => {});}}});
 await jobs.create({photo: image, clientKey: 'close-sleep-001'}); await until(async () => asleep, Boolean);
 await jobs.close(); assert.deepEqual(g.creates, ['image']);
 const disk = await readJson(path.join(directory, 'state.json')); assert.equal(Object.values(disk.jobs)[0].job.status, 'generating');
});

test('recognition received during close is persisted and no next charged stage starts', {timeout: 10000}, async () => {
 const directory = await dir(), g = gateway(); let release, receiving = false;
 const request = async (url, options) => {
  const reply = await g.fetch(url, options);
  if (url.includes('googleapis')) { receiving = true; await new Promise(resolve => release = resolve); }
  return reply;
 };
 let jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: request}});
 try {
  const j = await jobs.create({photo: image, clientKey: 'close-recognition-001'}); await until(async () => receiving, Boolean);
  const closing = jobs.close(); release(); await closing;
  const saved = (await readJson(path.join(directory, 'state.json'))).jobs[j.id]; assert.equal(saved.job.recognition.category, '平底锅'); assert.equal(saved.providerState.recognitionPending, undefined);
  assert.deepEqual(g.creates, []);
  jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch, pause: async () => {}}});
  assert.equal((await finish(jobs, j.id)).status, 'succeeded'); assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image', 'mesh']);
 } finally { await jobs.close(); }
});

for (const [options, code] of [[{visionStatus: 401}, 'recognition-auth'], [{visionStatus: 429}, 'recognition-limit'],
 [{recognition: {clear: false, recognizable: false, name: null, materialName: null, hardness: null, outwardEnd: null, lengthCm: null, massKg: null, material: null, condition: null, basis: '照片不清楚'}}, 'photo-unclear']])
 test(`recognition failure ${code} received during close survives restart without another call`, {timeout: 5000}, async () => {
  const directory = await dir(), g = gateway(options); let release, receiving = false;
  const request = async (url, options) => {
   const response = await g.fetch(url, options);
   if (url.includes('googleapis')) { receiving = true; await new Promise(resolve => release = resolve); }
   return response;
  };
  let jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: request}});
  try {
   const j = await jobs.create({photo: image, clientKey: 'close-failed-recog-001'}); await until(async () => receiving, Boolean);
   const closing = jobs.close(); release(); await closing;
   const saved = (await readJson(path.join(directory, 'state.json'))).jobs[j.id];
   assert.equal(saved.job.status, 'failed'); assert.equal(saved.job.error.code, code); assert.equal(saved.providerState.recognitionPending, undefined);
   jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch}});
   assert.equal((await jobs.get(j.id)).error.code, code); assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, []);
  } finally { release?.(); await jobs.close(); }
 });

for (const visionReply of [null, {status: 'completed', steps: {}}, {status: 'completed', steps: [{type: 'model_output', content: [null]}]}])
 test(`malformed recognition envelope is invalid, not a network failure: ${JSON.stringify(visionReply)}`, async t => {
  const {jobs, g} = await open(t, {visionReply}), j = await jobs.create({photo: image, clientKey: 'invalid-envelope-001'});
  assert.equal((await finish(jobs, j.id)).error.code, 'recognition-invalid'); assert.deepEqual(g.creates, []);
 });

test('local photo read failure is distinct and makes no recognition request', async () => {
 const directory = await dir(), g = gateway(), read = fs.readFile;
 const log = console.error, logs = []; console.error = (...args) => logs.push(args.join(' '));
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: g.fetch}});
 fs.readFile = (file, ...args) => typeof file === 'string' && file.startsWith(directory + path.sep) && file.endsWith('photo.jpg')
  ? Promise.reject(Object.assign(Error('private path'), {code: 'EIO'})) : read(file, ...args);
 try {
  const j = await jobs.create({photo: image, clientKey: 'unreadable-photo-001'}), failed = await finish(jobs, j.id);
  assert.equal(failed.error.code, 'photo-read'); assert.equal(failed.error.retry, 'none'); assert.equal(g.visionCalls(), 0); assert.deepEqual(g.creates, []);
  assert.deepEqual(logs, ['Shoot local photo read failed: EIO']);
 } finally { fs.readFile = read; console.error = log; await jobs.close(); }
});

test('photo read after recognition retries the same job without another vision charge or duplicate creates', async t => {
 const directory = await dir(), g = gateway(), read = fs.readFile; let recognized = false;
 const request = async (url, options) => { const response = await g.fetch(url, options); if (url.includes('googleapis')) recognized = true; return response; };
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: request, pause: async () => {}}});
 t.after(() => jobs.close());
 fs.readFile = (file, ...args) => recognized && typeof file === 'string' && file.startsWith(directory + path.sep) && file.endsWith('photo.jpg')
  ? Promise.reject(Object.assign(Error('private path'), {code: 'EIO'})) : read(file, ...args);
 let j;
 try {
  j = await jobs.create({photo: image, clientKey: 'recognized-photo-read-001'}); const failed = await finish(jobs, j.id);
  assert.equal(failed.error.code, 'photo-upload'); assert.equal(failed.error.retry, 'same'); assert.equal(failed.error.charged, false);
  assert.equal(failed.recognition.category, '平底锅'); assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, []);
 } finally { fs.readFile = read; }
 await jobs.retry(j.id); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
 assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image', 'mesh']);
});

test('image-only paid ID survives a missing photo and recovery submits the first mesh exactly once', async t => {
 const queryStatus = {image: 500}, {jobs, g, directory} = await open(t, {queryStatus});
 const j = await jobs.create({photo: image, clientKey: 'image-only-read-001'}); assert.equal((await finish(jobs, j.id)).error.code, 'download');
 assert.deepEqual(g.creates, ['image']); delete queryStatus.image;
 const saved = (await readJson(path.join(directory, 'state.json'))).jobs[j.id];
 assert.deepEqual(saved.providerState.tasks, {'multimodal-to-image': 'image-id'});
 const file = path.join(directory, j.id, 'photo.jpg'), backup = path.join(directory, j.id, 'photo-backup.jpg');
 const log = console.error, logs = []; console.error = (...args) => logs.push(args.join(' '));
 await fs.rename(file, backup);
 try {
  for (let i = 0; i < 2; i++) {
   await jobs.retry(j.id); const failed = await finish(jobs, j.id);
   assert.equal(failed.error.code, 'download'); assert.equal(failed.error.retry, 'same'); assert.equal(failed.error.charged, true);
  }
  assert.deepEqual(logs, ['Shoot local photo read failed: ENOENT', 'Shoot local photo read failed: ENOENT']);
  assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image']);
 } finally { console.error = log; await fs.rename(backup, file); }
 await jobs.retry(j.id); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
 assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image', 'mesh']);
});

test('paid IDs remain free-retryable after a local photo read failure; recovery creates nothing', async t => {
 const {jobs, g, directory} = await open(t, {downloadFailure: true});
 const j = await jobs.create({photo: image, clientKey: 'paid-photo-read-001'}), first = await finish(jobs, j.id);
 assert.equal(first.error.code, 'download'); assert.deepEqual(g.creates, ['image', 'mesh']);
 const saved = (await readJson(path.join(directory, 'state.json'))).jobs[j.id];
 assert.deepEqual(saved.providerState.tasks, {'multimodal-to-image': 'image-id', 'img-to-3d': 'mesh-id'});
 const read = fs.readFile;
 fs.readFile = (file, ...args) => file === path.join(directory, j.id, 'photo.jpg')
  ? Promise.reject(Object.assign(Error('private path'), {code: 'EIO'})) : read(file, ...args);
 try {
  await jobs.retry(j.id); const failed = await finish(jobs, j.id);
  assert.equal(failed.error.code, 'download'); assert.equal(failed.error.retry, 'same'); assert.equal(failed.error.charged, true);
 } finally { fs.readFile = read; }
 await jobs.retry(j.id); assert.equal((await finish(jobs, j.id)).status, 'succeeded');
 assert.equal(g.visionCalls(), 1); assert.deepEqual(g.creates, ['image', 'mesh']);
});

async function stoppedProcess(directory) {
 const g = gateway(), provider = realGenerator({env, fetch: g.fetch, pause: async () => {}}), step = provider.step;
 provider.step = (...args) => args[0] === 'process' ? Promise.reject(Object.assign(Error('fixture process I/O'), {code: 'EIO'})) : step(...args);
 const jobs = await openJobs({directory, generator: provider});
 try { const j = await jobs.create({photo: image, clientKey: 'stored-source-001'}); assert.equal((await finish(jobs, j.id)).error.code, 'process'); return {g, j}; }
 finally { await jobs.close(); }
}
for (const both of [false, true]) test(`corrupt source ${both ? 'and raw fail without requesting payment' : 'recovers from intact raw for free'}`, async () => {
 const directory = await dir(), {j} = await stoppedProcess(directory), folder = path.join(directory, j.id);
 await fs.writeFile(path.join(folder, 'source.glb'), 'bad saved source'); if (both) await fs.writeFile(path.join(folder, 'model.glb'), 'bad raw');
 let calls = 0; const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: () => {calls++;throw Error('no network');}}});
 try {
  await jobs.retry(j.id); const done = await finish(jobs, j.id); assert.equal(calls, 0);
  if (both) { assert.equal(done.error.code, 'process-corrupt'); assert.equal(done.error.retry, 'none'); await assert.rejects(jobs.retry(j.id), {code: 'not-allowed'}); await assert.rejects(jobs.create({clientKey: 'not-another-fee-001', regenerateOf: j.id, confirm: true}), {code: 'not-allowed'}); }
  else { assert.equal(done.status, 'succeeded'); assert.deepEqual(await fs.readFile(path.join(folder, 'source.glb')), model); }
 } finally { await jobs.close(); }
});

test('corrupt source plus missing raw is non-retryable process-corrupt', async () => {
 const directory = await dir(), {j} = await stoppedProcess(directory), folder = path.join(directory, j.id);
 await fs.writeFile(path.join(folder, 'source.glb'), 'corrupt'); await fs.rename(path.join(folder, 'model.glb'), path.join(folder, 'model-missing-fixture.glb'));
 let calls = 0; const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: () => { calls++; throw Error('no network'); }}});
 try {
  await jobs.retry(j.id); const failed = await finish(jobs, j.id);
  assert.equal(failed.error.code, 'process-corrupt'); assert.equal(failed.error.retry, 'none'); assert.equal(calls, 0);
  await assert.rejects(jobs.retry(j.id), {code: 'not-allowed'});
 } finally { await jobs.close(); }
});

test('oversized raw model is rejected before reading/hash and cannot loop in free processing', async () => {
 const directory = await dir(), {j} = await stoppedProcess(directory), file = path.join(directory, j.id, 'model.glb');
 await fs.truncate(file, 64 * 1024 * 1024 + 1);
 const read = fs.readFile; let largeRead = false;
 fs.readFile = (target, ...args) => {if (target === file) largeRead = true; return read(target, ...args);};
 const jobs = await openJobs({directory, mode: 'real', env, realOptions: {fetch: () => {throw Error('no network');}}});
 try { await jobs.retry(j.id); const done = await finish(jobs, j.id); assert.equal(done.error.code, 'process-too-large'); assert.equal(done.error.retry, 'none'); assert.equal(largeRead, false); await assert.rejects(jobs.retry(j.id), {code: 'not-allowed'}); }
 finally { fs.readFile = read; await jobs.close(); }
});

test('check-real rejects relative photos before any request, and observation timeout keeps same job/key', async () => {
 const file = path.join(await dir(), 'photo.png'); await fs.writeFile(file, image);
 const run = source => new Promise(resolve => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {stdio: ['ignore', 'pipe', 'pipe']}); let output = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b); child.on('exit', code => resolve({code, output}));
 });
 const url = new URL('../shoot/check-real.mjs', import.meta.url).href;
 const relative = await run(`process.argv=['node','check-real','--photo','relative.jpg','--key','check-real-001','--allow-paid'];globalThis.fetch=()=>{throw Error('NETWORK SHOULD NOT RUN')};await import(${JSON.stringify(url)});`);
 assert.equal(relative.code, 1); assert.match(relative.output, /absolute\/photo/); assert.doesNotMatch(relative.output, /NETWORK SHOULD NOT RUN/);
 const observation = await run(`process.argv=['node','check-real','--photo',${JSON.stringify(file)},'--key','check-real-001','--allow-paid'];let clock=0,posts=0;Date.now=()=>clock++===0?0:46*60*1000;globalThis.fetch=async(url,o)=>{if(o?.method==='POST')posts++;return Response.json(url.endsWith('quota')?{provider:'real'}:{job:{id:'same-job',status:'generating',steps:[{key:'styled'}]}})};try{await import(${JSON.stringify(url)})}finally{console.log('POSTS='+posts)};`);
 assert.equal(observation.code, 1); assert.match(observation.output, /NOT a job failure/); assert.match(observation.output, /same-job/); assert.match(observation.output, /SAME absolute photo and key/); assert.match(observation.output, /POSTS=1/);
});
