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
import {readJson} from '../state.mjs';
import {validateRuntimeItem} from '../../../sim/runtime-items.js';
import {REPO} from '../shoot/jobs.mjs';
const photo = await sharp({create: {width: 40, height: 32, channels: 3, background: '#aabbcc'}}).png().toBuffer();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-shoot-test-'));
const catalog = await readJson(path.join(REPO, 'data/catalog.json'));
const directory = () => fs.mkdtemp(path.join(root, 'case-'));
async function request(url, route, data, method = data === undefined ? 'GET' : 'POST') {
 const response = await fetch(url + '/api/shoot/' + route, {method, ...(data === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(data)})});
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
  const q = await request(app.url, 'quota'); assert.deepEqual({...q, status: undefined}, {status: undefined, limit: null, remaining: null, resetsAt: null, used: 1, activeJobId: null});
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
 } finally { await app.close(); }
});

test('regenerate requires confirmation and deduplicates ten confirmations', async t => {
 const app = await instance(t, {fakeOptions: {fault: 'step-failed', delayMs: 1}}); const {job} = await create(app.url, 'regen-first-001');
 assert.equal((await finished(app.url, job.id)).job.error.retry, 'regenerate');
 assert.equal((await request(app.url, `jobs/${job.id}/regenerate`, {confirm: false, clientKey: 'regen-second-001'})).status, 409);
 const r = await Promise.all(Array.from({length: 10}, () => request(app.url, `jobs/${job.id}/regenerate`, {confirm: true, clientKey: 'regen-second-001'})));
 assert.ok(r.every(x => x.status === 202 && x.job.id === r[0].job.id)); assert.equal(r[0].job.regenerateOf, job.id);
 await finished(app.url, r[0].job.id); assert.equal((await request(app.url, 'quota')).used, 2);
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

async function child(dir) {
 const source = `import {startShootServer} from ${JSON.stringify(new URL('../shoot/server.mjs', import.meta.url).href)};const app=await startShootServer({port:0,directory:${JSON.stringify(dir)},fakeOptions:{delayMs:150}});console.log(JSON.stringify({url:app.url}));process.once('SIGTERM',async()=>{await app.close();process.exit(0)});`;
 const proc = spawn(process.execPath, ['--input-type=module', '-e', source], {stdio: ['ignore', 'pipe', 'pipe']});
 let text = '', stderr = ''; proc.stdout.on('data', b => { text += b; }); proc.stderr.on('data', b => { stderr += b; });
 const info = await until(async () => { if (proc.exitCode !== null) throw Error(stderr); return text; }, s => s.includes('\n')).catch(async error => { proc.kill(); throw error; });
 return {proc, url: JSON.parse(info.split('\n')[0]).url};
}

test('real child hard restart resumes a known job, keeps output, and does not submit again', async t => {
 const dir = await directory(); let current = await child(dir); const children = [current.proc];
 t.after(async () => { for (const p of children) if (p.exitCode === null && p.signalCode === null) { const done = once(p, 'exit'); p.kill(); await done; } });
 const {job} = await create(current.url, 'hard-restart-001');
 await until(() => readJson(path.join(dir, 'state.json')), s => s.jobs[job.id].providerId);
 let exit = once(current.proc, 'exit'); current.proc.kill('SIGKILL'); await exit;
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


test('prototype key is rejected on repeated submits without creating or charging a job', async t => {
 const app = await instance(t);
 for (let i = 0; i < 2; i++) {
  const result = await create(app.url, '__proto__');
  assert.equal(result.status, 400); assert.equal(result.error.code, 'key-conflict');
 }
 assert.equal((await request(app.url, 'quota')).used, 0);
 assert.deepEqual((await request(app.url, 'items')).items, []);
 assert.deepEqual((await readJson(path.join(app.jobs.directory, 'state.json'), {jobs: {}})).jobs, {});
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
