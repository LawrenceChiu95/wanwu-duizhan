import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
import sharp from 'sharp';
import {startShootServer} from '../shoot/server.mjs';
import {fakeGenerator} from '../shoot/fake.mjs';
import {readJson} from '../state.mjs';
import {validateRuntimeItem} from '../../../sim/runtime-items.js';
import {REPO, MAX_PHOTO} from '../shoot/jobs.mjs';
const photo = await sharp({create: {width: 40, height: 32, channels: 3, background: '#aabbcc'}}).png().toBuffer();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-shoot-test-'));
const catalog = await readJson(path.join(REPO, 'data/catalog.json'));
const directory = () => fs.mkdtemp(path.join(root, 'case-'));
async function request(url, route, data, method = data === undefined ? 'GET' : 'POST', signal) {
 const response = await fetch(url + '/api/shoot/' + route, {method, signal, ...(data === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(data)})});
 return {status: response.status, ...await response.json()};
}
async function create(url, key, bytes = photo) {
 const form = new FormData(); form.append('photo', new Blob([bytes], {type: 'image/png'}), 'photo.png'); form.append('clientKey', key);
 const response = await fetch(url + '/api/shoot/jobs', {method: 'POST', body: form}); return {status: response.status, ...await response.json()};
}
async function until(read, accept) {
 const deadline = Date.now() + 15000;
 do { const value = await read(); if (accept(value)) return value; await pause(10); } while (Date.now() < deadline);
 throw Error('Timed out waiting for checkpoint');
}
const finished = (url, id) => until(() => request(url, `jobs/${id}`), r => ['succeeded', 'failed'].includes(r.job.status));
async function instance(t, options = {}) { const app = await startShootServer({port: 0, directory: await directory(), fakeOptions: {delayMs: 2}, ...options}); t.after(() => app.close()); return app; }

test('HTTP ten concurrent copies: one charge, atomic inventory, real origin times, assets and restart persistence', async t => {
 const dir = await directory(); let app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 10}});
 try {
  const copies = await Promise.all(Array.from({length: 10}, () => create(app.url, 'repeat-key-0001')));
  assert.ok(copies.every(x => x.status === 202)); const id = copies[0].job.id; assert.ok(copies.every(x => x.job.id === id));
  let r = await finished(app.url, id); assert.equal(r.job.status, 'succeeded');
  const q = await request(app.url, 'quota'); assert.deepEqual({...q, status: undefined}, {status: undefined, provider: 'fake', limit: null, remaining: null, resetsAt: null, used: 1, activeJobId: null});
  const {items} = await request(app.url, 'items'); assert.equal(items.length, 1); const item = items[0]; assert.equal(item.id, r.job.itemId);
  validateRuntimeItem(item, catalog); assert.equal(item.source.generator, 'local-fake'); assert.equal(item.outEnd, -1);
  assert.deepEqual(item.origin.steps.map(s => s.key), ['photo', 'styled', 'model']); assert.ok(item.origin.steps.every(s => s.seconds >= 0));
  assert.ok(Math.abs(item.origin.steps.reduce((s, x) => s + x.seconds, 0) - (Date.parse(r.job.steps[3].endedAt) - Date.parse(r.job.createdAt)) / 1000) < 1e-9);
  for (const route of [item.glb, item.origin.photo, item.origin.styled]) { const file = await fetch(app.url + route); assert.equal(file.status, 200); assert.ok((await file.arrayBuffer()).byteLength > 100); }
  assert.equal((await create(app.url, 'repeat-key-0001', Buffer.from('changed'))).error.code, 'key-conflict');
  await app.close(); app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 1}});
  r = await request(app.url, `jobs/${id}`); assert.equal(r.job.status, 'succeeded'); assert.deepEqual((await request(app.url, 'items')).items, items); assert.equal((await request(app.url, 'quota')).used, 1);
 } finally { await app.close(); }
});

test('unknown submission never resubmits after restart; a different key can create another item', async () => {
 const dir = await directory(); let app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 1, fault: 'unknown-submit'}});
 try {
  const {job} = await create(app.url, 'unknown-key-001'); const result = await finished(app.url, job.id);
  assert.deepEqual(result.job.error, {code: 'unknown-submit', message: 'unknown-submit', retry: 'none', charged: true});
  await app.close(); app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 1}});
  for (let i = 0; i < 3; i++) {
   assert.equal((await request(app.url, `jobs/${job.id}/retry`, undefined, 'POST')).status, 409);
   assert.equal((await request(app.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'unknown-regen-01'})).status, 409);
  }
  assert.equal((await create(app.url, 'unknown-key-001')).job.id, job.id);
  assert.equal((await request(app.url, 'quota')).used, 1); assert.equal((await request(app.url, 'quota')).activeJobId, null);
  assert.equal((await readJson(path.join(dir, 'fake-ledger.json'))).calls.length, 1); assert.deepEqual((await request(app.url, 'items')).items, []);
  const next = await create(app.url, 'another-key-001'); assert.equal(next.status, 202); assert.equal((await finished(app.url, next.job.id)).job.status, 'succeeded'); assert.equal((await request(app.url, 'quota')).used, 2); assert.equal((await request(app.url, `jobs/${job.id}`)).job.error.code, 'unknown-submit');
 } finally { await app.close(); }
});

for (const fault of ['download', 'process']) test(`${fault} retry resumes free; paid count stays one`, async t => {
 const app = await instance(t, {fakeOptions: {fault, delayMs: 2}}); const {job} = await create(app.url, `retry-${fault}-001`);
 const failed = await finished(app.url, job.id); assert.equal(failed.job.error.code, fault); assert.equal(failed.job.error.retry, 'same');
 assert.equal((await request(app.url, `jobs/${job.id}/retry`, undefined, 'POST')).status, 200);
 assert.equal((await finished(app.url, job.id)).job.status, 'succeeded'); assert.equal((await request(app.url, 'quota')).used, 1);
 assert.equal((await request(app.url, `jobs/${job.id}/retry`, undefined, 'POST')).status, 409);
});

test('busy uses a new idempotent submit; retry cannot enter paid path', async () => {
 const dir = await directory(); let app = await startShootServer({port: 0, directory: dir, fakeOptions: {fault: 'busy', delayMs: 1}});
 try {
  const {job} = await create(app.url, 'busy-first-001'); const failed = await finished(app.url, job.id); assert.equal(failed.job.error.charged, false);
  assert.equal((await request(app.url, 'quota')).used, 0); assert.equal((await request(app.url, `jobs/${job.id}/retry`, undefined, 'POST')).status, 409);
  await app.close(); app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 1}});
  const replies = await Promise.all(Array.from({length: 10}, () => request(app.url, 'jobs', {fromJob: job.id, clientKey: 'busy-second-001'})));
  assert.ok(replies.every(x => x.status === 202 && x.job.id === replies[0].job.id));
  assert.equal((await finished(app.url, replies[0].job.id)).job.status, 'succeeded'); assert.equal((await request(app.url, 'quota')).used, 1);
  const reused = await request(app.url, 'jobs', {fromJob: job.id, clientKey: 'busy-third-001'});
  assert.equal(reused.status, 409); assert.equal(reused.error.code, 'not-allowed');
  assert.equal((await request(app.url, 'jobs', {fromJob: job.id, clientKey: 'busy-second-001'})).job.id, replies[0].job.id);
  assert.equal((await readJson(path.join(dir, 'state.json'))).jobs[job.id].usedBy, replies[0].job.id);
  await app.close();
  const saved = await readJson(path.join(dir, 'state.json'));
  assert.equal(saved.jobs[replies[0].job.id].job.fromJob, job.id);
  delete saved.jobs[job.id].usedBy;
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(saved));
  app = await startShootServer({port: 0, directory: dir});
  assert.equal((await readJson(path.join(dir, 'state.json'))).jobs[job.id].usedBy, replies[0].job.id);
  const replayed = await request(app.url, 'jobs', {fromJob: job.id, clientKey: 'busy-second-001'});
  assert.equal(replayed.status, 202); assert.equal(replayed.job.id, replies[0].job.id); assert.equal(replayed.job.fromJob, job.id);
  assert.equal((await request(app.url, 'jobs', {fromJob: job.id, clientKey: 'busy-fourth-001'})).error.code, 'not-allowed');
  assert.equal((await request(app.url, 'quota')).used, 1);
 } finally { await app.close(); }
});

test('regenerate requires confirmation and deduplicates ten confirmations', async t => {
 const app = await instance(t, {fakeOptions: {fault: 'step-failed', delayMs: 1}}); const {job} = await create(app.url, 'regen-first-001');
 assert.equal((await finished(app.url, job.id)).job.error.retry, 'regenerate');
 assert.equal((await request(app.url, `jobs/${job.id}/regenerate`, {confirm: false, clientKey: 'regen-second-001'})).status, 409);
 const r = await Promise.all(Array.from({length: 10}, () => request(app.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'regen-second-001'})));
 assert.ok(r.every(x => x.status === 202 && x.job.id === r[0].job.id)); assert.equal(r[0].job.regenerateOf, job.id);
 await finished(app.url, r[0].job.id); assert.equal((await request(app.url, 'quota')).used, 2);
 const reused = await request(app.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'regen-third-001'});
 assert.equal(reused.status, 409); assert.equal(reused.error.code, 'not-allowed');
 assert.equal((await request(app.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'regen-second-001'})).job.id, r[0].job.id);
 assert.equal((await readJson(path.join(app.jobs.directory, 'state.json'))).jobs[job.id].usedBy, r[0].job.id);
 assert.equal((await request(app.url, 'quota')).used, 2);
});

test('invalid photo, cross-origin/Host, unpublished files and disk lock refuse safely', async t => {
 const app = await instance(t);
 assert.equal((await create(app.url, 'invalid-photo-001', Buffer.from('not a photo'))).error.code, 'photo-invalid');
 assert.equal((await fetch(app.url + '/api/shoot/quota', {headers: {origin: 'https://other.invalid'}})).status, 403);
 assert.equal(await new Promise((resolve, reject) => { const req = http.get(app.url + '/api/shoot/quota', {headers: {host: 'other.invalid'}}, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); }), 403);
 assert.equal((await fetch(app.url + '/api/shoot/files/shoot_00000000-0000-0000-0000-000000000000/photo.jpg')).status, 404);
 await assert.rejects(startShootServer({port: 0, directory: app.jobs.directory}), /already in use/);
 assert.equal((await request(app.url, 'quota')).used, 0);
});

async function child(dir, window = null) {
 const source = `import fs from 'node:fs/promises';
 import {startShootServer} from ${JSON.stringify(new URL('../shoot/server.mjs', import.meta.url).href)};
 import {fakeGenerator} from ${JSON.stringify(new URL('../shoot/fake.mjs', import.meta.url).href)};
 const directory=${JSON.stringify(dir)}, window=${JSON.stringify(window)};
 const rename=fs.rename; fs.rename=async(...args)=>{
  try{await rename(...args)}catch(error){console.error(JSON.stringify({operation:'rename',code:error.code,destination:args[1]}));throw error;}
  if(window==='known' && args[1].endsWith('state.json')){
   const state=JSON.parse(await fs.readFile(args[1],'utf8'));
   const record=Object.values(state.jobs).find(r=>r.providerId);
   if(record){process.send({checkpoint:'known',id:record.job.id});await new Promise(()=>{});}
  }
 };
 const generator=await fakeGenerator(directory,{delayMs:150});
 if(['before-ledger','after-ledger'].includes(window)){const submit=generator.submit;generator.submit=async id=>{
   if(window==='after-ledger') await submit(id);
   await fs.writeFile(directory+'/checkpoint.json',JSON.stringify({id,window}));
   await new Promise(()=>{});
 };}
 const app=await startShootServer({port:0,directory,generator});console.log(JSON.stringify({url:app.url}));
 process.once('SIGTERM',async()=>{await app.close();process.exit(0)});`;
 const proc = spawn(process.execPath, ['--input-type=module', '-e', source], {stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
 let checkpoint = null; proc.on('message', message => { checkpoint = message; });
 let text = '', stderr = ''; proc.stdout.on('data', b => { text += b; }); proc.stderr.on('data', b => { stderr += b; });
 const info = await until(async () => { if (proc.exitCode !== null) throw Error(stderr); return text; }, s => s.includes('\n')).catch(async error => { proc.kill('SIGKILL'); throw error; });
 return {proc, url: JSON.parse(info.split('\n')[0]).url, stderr: () => stderr, checkpoint: () => checkpoint};
}

async function restartDiagnostics(dir, current) {
 const detail = {};
 try { detail.state = await readJson(path.join(dir, 'state.json')); } catch (error) { detail.stateError = error.message; }
 try { detail.quota = await request(current.url, 'quota', undefined, 'GET', AbortSignal.timeout(2000)); } catch (error) { detail.quotaError = error.message; }
 try { detail.stderr = current.stderr(); } catch (error) { detail.stderrError = error.message; }
 return detail;
}

test('hard restart diagnostics retain independent evidence when state or quota cannot be read', async () => {
 const dir = await directory(), file = path.join(dir, 'state.json');
 const app = await startShootServer({port: 0, directory: dir});
 const current = {url: app.url, stderr: () => 'child stderr sentinel'};
 try {
  await fs.writeFile(file, '{broken JSON');
  const invalid = await restartDiagnostics(dir, current);
  assert.ok(invalid.stateError); assert.equal(invalid.quota.used, 0); assert.equal(invalid.stderr, 'child stderr sentinel');
 } finally { await app.close(); }
 await fs.writeFile(file, JSON.stringify({checkpoint: 'kept'}));
 const exited = await restartDiagnostics(dir, current);
 assert.deepEqual(exited.state, {checkpoint: 'kept'}); assert.ok(exited.quotaError); assert.equal(exited.stderr, 'child stderr sentinel');
});

test('real child hard restart resumes a known job, keeps output, and does not submit again', async t => {
 const dir = await directory(); let current = await child(dir, 'known'); const children = [current.proc];
 t.after(async () => { for (const p of children) if (p.exitCode === null && p.signalCode === null) { const done = once(p, 'exit'); p.kill('SIGKILL'); await done; } });
 const {job} = await create(current.url, 'hard-restart-001');
 try { await until(current.checkpoint, s => s?.checkpoint === 'known' && s.id === job.id); }
 catch (error) {
  throw Error(`${error.message}: ${JSON.stringify(await restartDiagnostics(dir, current))}`, {cause: error});
 }
 // The writer is paused after rename. Verify the disk ourselves, then kill it;
 // neither the checkpoint notification nor in-memory state counts as durability.
 const persisted = (await readJson(path.join(dir, 'state.json'))).jobs[job.id];
 assert.equal(persisted.providerId, `fake_${job.id}`); assert.equal(persisted.pending, false);
 let exit = once(current.proc, 'exit'); current.proc.kill('SIGKILL'); await exit;
 assert.deepEqual((await readJson(path.join(dir, 'state.json'))).jobs[job.id], persisted);
 current = await child(dir); children.push(current.proc);
 const result = await finished(current.url, job.id); assert.equal(result.job.status, 'succeeded');
 assert.equal((await request(current.url, 'quota')).used, 1); assert.equal((await request(current.url, 'items')).items.length, 1);
 const item = (await request(current.url, 'items')).items[0]; assert.equal((await fetch(current.url + item.glb)).status, 200);
});

test('only one in-progress job; other keys get its id without another submission', async t => {
 const app = await instance(t, {fakeOptions: {delayMs: 50}});
 const {job} = await create(app.url, 'active-first-001');
 const next = await create(app.url, 'active-second-001');
 assert.equal(next.status, 409); assert.equal(next.error.code, 'active-job'); assert.equal(next.activeJobId, job.id);
 assert.equal((await create(app.url, 'active-first-001')).job.id, job.id);
 await finished(app.url, job.id); assert.equal((await request(app.url, 'quota')).used, 1);
});

test('explicit local dev proxy Origin works; arbitrary origins still fail', async t => {
 const app = await instance(t, {frontendOrigin: 'http://localhost:5173'});
 assert.equal((await fetch(app.url + '/api/shoot/quota', {headers: {origin: 'http://localhost:5173'}})).status, 200);
 assert.equal((await fetch(app.url + '/api/shoot/quota', {headers: {origin: 'http://localhost:5174'}})).status, 403);
 await assert.rejects(startShootServer({port: 0, directory: await directory(), frontendOrigin: 'https://external.invalid'}), /local HTTP/);
});


test('prototype-shaped keys persist their own records and replay after restart without a second charge', async () => {
 const dir = await directory(); let app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 1}});
 try {
  for (const key of ['__proto__', 'constructor', 'toString']) {
   const results = await Promise.all([create(app.url, key), create(app.url, key)]);
   assert.ok(results.every(r => r.status === 202 && r.job.id === results[0].job.id));
   assert.equal((await finished(app.url, results[0].job.id)).job.status, 'succeeded');
   const state = await readJson(path.join(dir, 'state.json'));
   assert.ok(Object.hasOwn(state.keys, key));
   assert.equal(state.keys[key].id, results[0].job.id);
   assert.match(state.keys[key].fingerprint, /^[a-f0-9]{64}$/);
   assert.equal(state.jobs[state.keys[key].id].job.clientKey, key);
  }
  assert.equal((await request(app.url, 'quota')).used, 3);
  const state = await readJson(path.join(dir, 'state.json'));
  await app.close(); app = await startShootServer({port: 0, directory: dir});
  for (const key of ['__proto__', 'constructor', 'toString']) assert.equal((await create(app.url, key)).job.id, state.keys[key].id);
  assert.equal((await request(app.url, 'quota')).used, 3);
 } finally { await app.close(); }
});

test('static page and asset query strings work; API query parameters stay invalid', async t => {
 const webRoot = await directory();
 await fs.writeFile(path.join(webRoot, 'index.html'), '<title>shoot fixture</title>');
 await fs.writeFile(path.join(webRoot, 'game.js'), 'export const ready = true;');
 const app = await instance(t, {webRoot});
 for (const query of ['?shoot=fake', '?shoot=real&mine=shoot_test&seed=7']) {
  const page = await fetch(app.url + '/' + query); assert.equal(page.status, 200); assert.equal(await page.text(), '<title>shoot fixture</title>');
 }
 const asset = await fetch(app.url + '/game.js?v=2'); assert.equal(asset.status, 200); assert.equal(await asset.text(), 'export const ready = true;');
 const api = await request(app.url, 'quota?unexpected=1'); assert.equal(api.status, 400); assert.equal(api.error.code, 'bad-request'); assert.equal(api.error.retry, 'none');
});

test('request errors use documented codes and only server failure offers same-request retry', async t => {
 const app = await instance(t);
 const forbidden = await fetch(app.url + '/api/shoot/quota', {headers: {origin: 'https://other.invalid'}});
 const cases = [
  [await create(app.url, 'short'), 400, 'key-conflict'],
  [await request(app.url, 'jobs', {unexpected: true}), 400, 'bad-request'],
  [await request(app.url, 'jobs/j_00000000-0000-0000-0000-000000000000'), 404, 'not-found'],
  [{status: forbidden.status, ...await forbidden.json()}, 403, 'forbidden']
 ];
 const {job} = await create(app.url, 'error-codes-001'); await finished(app.url, job.id);
 cases.push([await request(app.url, `jobs/${job.id}/retry`, undefined, 'POST'), 409, 'not-allowed']);
 for (const [result, status, code] of cases) { assert.equal(result.status, status); assert.equal(result.error.code, code); assert.equal(result.error.retry, 'none'); assert.equal(result.error.charged, false); }
 const broken = await instance(t, {generator: {used() { throw Error('private error detail'); }}});
 const result = await request(broken.url, 'quota');
 assert.equal(result.status, 500); assert.deepEqual(result.error, {code: 'server', message: 'Local backend failure', retry: 'same', charged: false});
});

for (const window of ['before-ledger', 'after-ledger']) test(`SIGKILL ${window}: persisted pending becomes unknown without a resubmission`, async t => {
 const dir = await directory(); let current = await child(dir, window); const children = [current.proc];
 t.after(async () => { for (const p of children) if (p.exitCode === null && p.signalCode === null) { const done = once(p, 'exit'); p.kill('SIGKILL'); await done; } });
 const {job} = await create(current.url, `kill-${window}-001`);
 const checkpoint = await until(() => readJson(path.join(dir, 'checkpoint.json')), x => x?.id === job.id);
 assert.equal(checkpoint.window, window);
 const record = (await readJson(path.join(dir, 'state.json'))).jobs[job.id];
 assert.equal(record.pending, true); assert.equal(record.providerId, null);
 const charges = window === 'after-ledger' ? 1 : 0;
 assert.equal((await readJson(path.join(dir, 'fake-ledger.json'), {calls: []})).calls.length, charges);
 const exit = once(current.proc, 'exit'); current.proc.kill('SIGKILL'); await exit;
 for (let restart = 0; restart < 2; restart++) {
  current = await child(dir); children.push(current.proc);
  const result = await request(current.url, `jobs/${job.id}`);
  assert.equal(result.job.status, 'failed');
  assert.deepEqual(result.job.error, {code: 'unknown-submit', message: 'unknown-submit', retry: 'none', charged: charges === 1});
  assert.equal((await create(current.url, `kill-${window}-001`)).job.id, job.id);
  assert.equal((await request(current.url, `jobs/${job.id}/retry`, undefined, 'POST')).error.code, 'not-allowed');
  assert.equal((await request(current.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'cannot-regenerate-001'})).error.code, 'not-allowed');
  assert.equal((await request(current.url, 'quota')).used, charges);
  assert.equal((await request(current.url, 'quota')).activeJobId, null);
  assert.deepEqual((await request(current.url, 'items')).items, []);
  const done = once(current.proc, 'exit'); current.proc.kill(); await done;
 }
});

test('failure while recording a failed step returns 503, closes, releases lock and resumes after storage repair', async t => {
 const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
 const dir = await directory(), stateFile = path.join(dir, 'state.json'), backup = path.join(dir, 'state-before-failure.json');
 const generator = await fakeGenerator(dir, {delayMs: 1});
 const step = generator.step; let broken = false;
 generator.step = async (key, id) => {
  if (!broken && key === 'styled') {
   broken = true;
   await fs.rename(stateFile, backup); await fs.mkdir(stateFile);
   throw Object.assign(Error('failed provider step before failed save'), {code: 'step-failed'});
  }
  return step(key, id);
 };
 let app = await startShootServer({port: 0, directory: dir, generator});
 try {
  const {job} = await create(app.url, 'storage-failure-001');
  const failure = await until(() => request(app.url, 'quota'), r => r.status === 503);
  assert.equal(failure.error.code, 'server'); assert.equal(failure.error.retry, 'same');
  assert.deepEqual(errors, [['Shoot persistence failed:', 'EISDIR']]);
  assert.equal((await create(app.url, 'storage-failure-002')).status, 503);
  await app.close(); app = null;
  await assert.rejects(fs.access(path.join(dir, '.owner')), {code: 'ENOENT'});
  await fs.rmdir(stateFile); await fs.rename(backup, stateFile);
  app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 1}});
  assert.equal((await finished(app.url, job.id)).job.status, 'succeeded');
  assert.equal((await request(app.url, 'quota')).used, 1);
  assert.equal((await readJson(path.join(dir, 'fake-ledger.json'))).calls.length, 1);
 } finally { if (app) await app.close(); }
});

test('legacy saved items without outEnd refuse startup clearly and release ownership', async () => {
 const dir = await directory();
 await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({jobs: {}, keys: {}, items: [{id: 'old-pot'}]}));
 await assert.rejects(startShootServer({port: 0, directory: dir}), /old-pot.*outEnd.*archive and clear/);
 await assert.rejects(fs.access(path.join(dir, '.owner')), {code: 'ENOENT'});
 assert.equal((await readJson(path.join(dir, 'state.json'))).items[0].id, 'old-pot');
});

test('upload size, pixel, malformed multipart and duplicate photo limits reject without charging', async t => {
 const app = await instance(t);
 const oversized = await create(app.url, 'photo-oversized-001', Buffer.alloc(MAX_PHOTO + 1));
 assert.equal(oversized.error.code, 'photo-invalid'); assert.equal(oversized.status, 400);
 // This is a real, compressed 64,008,000-pixel PNG, not just a forged header.
 const hugePixels = await sharp({create: {width: 8001, height: 8000, channels: 3, background: '#112233'}}).png().toBuffer();
 assert.ok(hugePixels.length < MAX_PHOTO);
 assert.equal((await create(app.url, 'photo-pixels-001', hugePixels)).error.code, 'photo-invalid');
 const malformed = await fetch(app.url + '/api/shoot/jobs', {method: 'POST', headers: {'content-type': 'multipart/form-data; boundary=missing'}, body: 'not a form'});
 assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'photo-invalid');
 const form = new FormData(); form.append('clientKey', 'photo-duplicate-001');
 for (let i = 0; i < 2; i++) form.append('photo', new Blob([photo], {type: 'image/png'}), 'photo.png');
 const duplicate = await fetch(app.url + '/api/shoot/jobs', {method: 'POST', body: form});
 assert.equal(duplicate.status, 400); assert.equal((await duplicate.json()).error.code, 'photo-invalid');
 assert.equal((await request(app.url, 'quota')).used, 0);
});

test('oversized JSON and a body on retry are bad-request, never photo-invalid', async t => {
 const app = await instance(t);
 const tooLarge = await request(app.url, 'jobs', {clientKey: 'json-too-large-001', fromJob: 'x'.repeat(9000)});
 assert.equal(tooLarge.status, 413); assert.equal(tooLarge.error.code, 'bad-request');
 const {job} = await create(app.url, 'retry-body-001'); await finished(app.url, job.id);
 const retry = await request(app.url, `jobs/${job.id}/retry`, {unexpected: true});
 assert.equal(retry.status, 413); assert.equal(retry.error.code, 'bad-request');
 assert.equal((await request(app.url, 'quota')).used, 1);
});

test('static encoded traversal and a directory symlink cannot escape the built web root', async t => {
 const webRoot = await directory(), outside = await directory();
 await fs.writeFile(path.join(webRoot, 'index.html'), '<title>public</title>');
 await fs.writeFile(path.join(outside, 'private.js'), 'private sentinel');
 await fs.symlink(outside, path.join(webRoot, 'escape'), 'junction');
 const app = await instance(t, {webRoot});
 assert.equal((await fetch(app.url + '/')).status, 200);
 const relative = `${path.basename(outside)}/private.js`;
 assert.equal(await fs.readFile(path.resolve(webRoot, '..', relative), 'utf8'), 'private sentinel');
 for (const route of [`/%2e%2e%2f${relative}`, `/%2e%2e%5c${relative}`, '/escape/private.js']) {
  const result = await fetch(app.url + route);
  assert.equal(result.status, 404); assert.ok(!(await result.text()).includes('private sentinel'));
 }
});


test('legacy regenerateOf backfills a missing parent marker before another paid child can be created', async () => {
 const dir = await directory(); let app = await startShootServer({port: 0, directory: dir, fakeOptions: {fault: 'step-failed', delayMs: 1}});
 try {
  const {job} = await create(app.url, 'legacy-regen-parent'); await finished(app.url, job.id);
  const child = await request(app.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'legacy-regen-child'});
  await finished(app.url, child.job.id); await app.close();
  const file = path.join(dir, 'state.json'), saved = await readJson(file);
  delete saved.jobs[job.id].usedBy; delete saved.jobs[child.job.id].job.fromJob;
  await fs.writeFile(file, JSON.stringify(saved));
  app = await startShootServer({port: 0, directory: dir});
  assert.equal((await readJson(file)).jobs[job.id].usedBy, child.job.id);
  const refused = await request(app.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'legacy-regen-another'});
  assert.equal(refused.status, 409); assert.equal(refused.error.code, 'not-allowed');
  assert.equal((await request(app.url, 'quota')).used, 2);
 } finally { await app.close(); }
});

for (const failure of ['ENOENT', 'EACCES', 'ENOSPC']) test(`the first save failure ${failure} returns 503 server, as do subsequent requests`, async t => {
 const app = await instance(t), rename = fs.rename;
 const logged = t.mock.method(console, 'error', () => {});
 try {
  fs.rename = async (source, target) => {
   if (target === path.join(app.jobs.directory, 'state.json')) throw Object.assign(Error('private storage fault'), {code: failure});
   return rename(source, target);
  };
  const first = await create(app.url, `first-save-${failure}`);
  assert.equal(first.status, 503); assert.equal(first.error.code, 'server'); assert.equal(first.error.retry, 'same');
  assert.ok(!first.error.message.includes('private storage fault'));
  const next = await request(app.url, 'quota'); assert.equal(next.status, 503); assert.equal(next.error.code, 'server');
  assert.deepEqual(logged.mock.calls.map(call => call.arguments), [['Shoot persistence failed:', failure]]);
  assert.equal((await readJson(path.join(app.jobs.directory, 'fake-ledger.json'), {calls: []})).calls.length, 0);
 } finally { fs.rename = rename; }
});

test('real HTTP oversized multipart and multi-MiB JSON drain fully and return 413 without a charge', async t => {
 const app = await instance(t);
 for (const [type, bytes, code] of [
  ['application/json', Buffer.alloc(4 * 1024 * 1024, 32), 'bad-request'],
  ['multipart/form-data; boundary=too-large', Buffer.alloc(MAX_PHOTO + 128 * 1024, 32), 'photo-invalid']
 ]) {
  let incoming;
  app.server.once('request', req => { incoming = req; });
  const result = await new Promise((resolve, reject) => {
   const req = http.request(app.url + '/api/shoot/jobs', {method: 'POST', headers: {'content-type': type, 'content-length': bytes.length}, agent: false}, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => { clearTimeout(timer); resolve({status: res.statusCode, ...JSON.parse(Buffer.concat(chunks).toString())}); });
   });
   const timer = setTimeout(() => { req.destroy(); reject(Error('Oversize HTTP response did not finish within 5s')); }, 5000);
   req.on('error', error => { clearTimeout(timer); reject(error); }); req.end(bytes);
  });
  assert.equal(result.status, 413); assert.equal(result.error.code, code);
  assert.equal(incoming.complete, true); assert.equal(incoming.readableEnded, true);
 }
 assert.equal((await request(app.url, 'quota')).used, 0);
 assert.equal((await request(app.url, 'quota')).activeJobId, null);
});


test('runner failure while reading provider charges logs the original error once and closes', async t => {
 const dir = await directory(), errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
 const generator = await fakeGenerator(dir, {delayMs: 1, fault: 'step-failed'});
 generator.charged = () => { throw Object.assign(Error('private provider error'), {code: 'EACCES'}); };
 const app = await startShootServer({port: 0, directory: dir, generator});
 try {
  await create(app.url, 'runner-charge-0001');
  assert.equal((await until(() => request(app.url, 'items'), r => r.status === 503)).error.code, 'server');
  await request(app.url, 'items'); assert.deepEqual(errors, [['Shoot persistence failed:', 'EACCES']]);
 } finally { await app.close(); }
 await assert.rejects(fs.access(path.join(dir, '.owner')), {code: 'ENOENT'});
});
