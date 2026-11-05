import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {setTimeout as pause} from 'node:timers/promises';
import sharp from 'sharp';
import {startShootServer} from '../shoot/server.mjs';
import {openJobs} from '../shoot/jobs.mjs';
import {fakeGenerator} from '../shoot/fake.mjs';

const photo = await sharp({create: {width: 8, height: 8, channels: 3, background: 'orange'}}).png().toBuffer();
const dir = () => fs.mkdtemp(path.join(os.tmpdir(), 'shoot-public-'));
const budget = {stage: 'validation-39', limit: 39};
async function until(fn, accept) {
  const end = Date.now() + 25000;
  do { const value = await fn(); if (accept(value)) return value; await pause(10); } while (Date.now() < end);
  throw Error('Timed out');
}

test('public HTTP exposes only API, validates host/origin, sets a secure private cookie, and health fails with storage', async t => {
  const directory = await dir();
  const app = await startShootServer({port: 0, directory, budget, publicOrigin: 'https://game-api.example', frontendOrigin: 'https://game.example'});
  t.after(() => app.close());
  const get = (route, headers) => new Promise((resolve, reject) => {
    http.get(app.url + route, {headers}, res => {
      const chunks = []; res.on('data', b => chunks.push(b));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: res.statusCode, headers: res.headers})));
    }).on('error', reject);
  });
  const health = await get('/api/shoot/health'); assert.equal(health.status, 200); assert.equal(health.headers.get('set-cookie'), null);
  assert.equal((await (await get('/api/shoot/quota')).json()).global.limit, 20);
  const q = await get('/api/shoot/quota', {host: 'game-api.example', origin: 'https://game.example'});
  assert.equal(q.status, 200); assert.match(q.headers.get('set-cookie'), /Path=\/api\/shoot; HttpOnly; SameSite=Strict;.*; Secure$/);
  assert.equal(q.headers.get('cache-control'), 'no-store'); assert.deepEqual((await q.json()).budget, {limit: 39, remaining: 39, available: true});
  for (const route of ['/', '/data/catalog.json', '/state.json', '/api/elsewhere']) assert.equal((await get(route)).status, 404);
  assert.equal((await get('/api/shoot/quota?x=1')).status, 400);
  assert.equal((await get('/api/shoot/quota', {host: 'other.example'})).status, 403);
  assert.equal((await get('/api/shoot/quota', {origin: 'https://other.example'})).status, 403);
  assert.equal((await get('/api/shoot/quota', {'x-forwarded-host': 'other.example'})).status, 200);
  await fs.rename(path.join(directory, 'state.json'), path.join(directory, 'saved-state.json'));
  await fs.mkdir(path.join(directory, 'state.json'));
  await assert.rejects(app.jobs.create({clientKey: 'failed-disk-key', photo}), e => e.status === 503);
  assert.equal((await get('/api/shoot/health')).status, 503);
});

test('39-credit reservation is atomic across browsers and survives restart without a paid call', async () => {
  const directory = await dir(), generator = await fakeGenerator(directory, {delayMs: 1});
  let release; const gate = new Promise(r => release = r), recognize = generator.recognize;
  generator.recognize = async (...args) => { await gate; return recognize(...args); };
  let jobs = await openJobs({directory, generator, budget});
  const replies = await Promise.allSettled(Array.from({length: 4}, (_, n) => jobs.create({clientKey: 'public-limit-' + n, photo}, 'browser-' + n)));
  assert.equal(replies.filter(r => r.status === 'fulfilled').length, 3);
  assert.ok(replies.some(r => r.status === 'rejected' && r.reason.code === 'budget' && r.reason.status === 503));
  assert.deepEqual((await jobs.quota()).budget, {limit: 39, remaining: 0, available: false});
  assert.equal(generator.used(), 0);
  release(); await jobs.close();
  jobs = await openJobs({directory, budget, fakeOptions: {delayMs: 1}});
  try {
    assert.equal((await jobs.quota()).budget.remaining, 0);
    await assert.rejects(jobs.create({clientKey: 'restart-new-key', photo}, 'new-browser'), e => e.code === 'budget');
    const old = replies.find(r => r.status === 'fulfilled').value;
    assert.equal((await jobs.create({clientKey: old.clientKey, photo}, 'browser-0')).id, old.id);
  } finally { await jobs.close(); }
});

test('prepaid retake returns budget; recognition attempts still count and files are private', async () => {
  const directory = await dir(), jobs = await openJobs({directory, budget, fakeOptions: {delayMs: 1}});
  try {
    const j = await jobs.create({clientKey: 'budget-retake-key', photo}, 'a');
    await until(() => jobs.get(j.id, 'a'), j => j.retakeUntil && !j.steps[0].startedAt);
    assert.equal((await jobs.quota('a')).budget.remaining, 26);
    await jobs.retake(j.id, 'a');
    const q = await jobs.quota('a'); assert.equal(q.budget.remaining, 39); assert.equal(q.remaining, 2); assert.equal(q.recognition.remaining, 4);
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(directory, 'state.json'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(directory, j.id))).mode & 0o777, 0o700);
  } finally { await jobs.close(); }
});

test('recognition failure releases generation budget without calling a paid provider', async () => {
  const jobs = await openJobs({directory: await dir(), budget, fakeOptions: {fault: 'photo-unclear', delayMs: 1}});
  try {
    const j = await jobs.create({clientKey: 'budget-bad-photo', photo});
    await until(() => jobs.get(j.id), j => j.status === 'failed');
    assert.equal((await jobs.quota()).budget.remaining, 39);
    assert.equal((await jobs.quota()).used, 0);
  } finally { await jobs.close(); }
});

test('unknown submission retains full budget after restart; a new explicit stage has its own limit', async () => {
  const directory = await dir(); let jobs = await openJobs({directory, budget: {stage: 'first', limit: 13}, fakeOptions: {fault: 'unknown-submit', delayMs: 1}});
  const j = await jobs.create({clientKey: 'budget-lost-reply', photo});
  const failed = await until(() => jobs.get(j.id), j => j.status === 'failed');
  assert.equal(failed.error.code, 'unknown-submit'); assert.equal((await jobs.quota()).budget.remaining, 0); await jobs.close();
  jobs = await openJobs({directory, budget: {stage: 'first', limit: 13}});
  assert.equal((await jobs.quota()).budget.available, false); await jobs.close();
  jobs = await openJobs({directory, budget: {stage: 'second', limit: 13}});
  assert.equal((await jobs.quota()).budget.remaining, 13); await jobs.close();
  jobs = await openJobs({directory, budget: {stage: 'first', limit: 13}});
  assert.equal((await jobs.quota()).budget.remaining, 0); await jobs.close();
});

test('free download retry reuses its original budget reservation even when the ceiling is full', async () => {
  const jobs = await openJobs({directory: await dir(), budget: {stage: 'test', limit: 13}, fakeOptions: {fault: 'download', delayMs: 1}});
  try {
    const j = await jobs.create({clientKey: 'budget-free-retry', photo});
    const failed = await until(() => jobs.get(j.id), j => j.status === 'failed');
    assert.equal(failed.error.code, 'download'); assert.equal((await jobs.quota()).budget.remaining, 0);
    await jobs.retry(j.id);
    await until(() => jobs.get(j.id), j => j.status === 'succeeded');
    assert.equal((await jobs.quota()).budget.remaining, 0); assert.equal((await jobs.quota()).used, 1);
  } finally { await jobs.close(); }
});

test('public mode rejects incomplete HTTPS/budget configuration', async () => {
  for (const options of [{publicOrigin: 'http://unsafe.example', budget}, {publicOrigin: 'https://api.example'}, {publicOrigin: 'https://api.example/path', budget}, {publicOrigin: 'https://api.example', frontendOrigin: 'http://ui.example', budget}]) {
    await assert.rejects(startShootServer({port: 0, directory: await dir(), ...options}));
  }
});

test('private Tailscale mode serves existing game with HTTP cookie and a separate 20-piece allowance', async t => {
  const directory = await dir(), webRoot = await dir();
  await fs.writeFile(path.join(webRoot, 'index.html'), '<h1>existing game</h1>');
  const app = await startShootServer({port: 0, directory, webRoot, privateOrigin: 'http://100.75.234.81:4330', budget: {stage: 'owner', limit: 260}});
  t.after(() => app.close());
  assert.match(await (await fetch(app.url + '/')).text(), /existing game/);
  const response = await fetch(app.url + '/api/shoot/quota', {headers: {origin: 'http://100.75.234.81:4330'}});
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); assert.ok(!response.headers.get('set-cookie').includes('Secure'));
  const q = await response.json(); assert.equal(q.limit, 20); assert.equal(q.global.limit, 20); assert.equal(q.budget.remaining, 260);
  for (const privateOrigin of ['http://8.8.8.8:4330', 'http://100.75.abc.81:4330', 'https://100.75.234.81:4330']) await assert.rejects(startShootServer({port: 0, directory: await dir(), privateOrigin, budget}));
});

test('budgeted service refuses unmetered unfinished legacy state instead of auto-paying after restart', async () => {
  const directory = await dir(); let jobs = await openJobs({directory, fakeOptions: {delayMs: 1}});
  const j = await jobs.create({clientKey: 'unmetered-legacy', photo});
  await until(() => jobs.get(j.id), j => j.retakeUntil && !j.steps[0].startedAt);
  await jobs.close();
  await assert.rejects(openJobs({directory, budget}), /separate directory/);
});

test('private preview exchanges its link, gates photos and static files, and keeps two browsers separate', async t => {
  const directory = await dir(), webRoot = await dir(), accessCode = 'a'.repeat(64);
  await fs.writeFile(path.join(webRoot, 'index.html'), '<h1>preview game</h1>');
  await fs.writeFile(path.join(webRoot, 'font.woff'), 'font');
  await fs.mkdir(path.join(webRoot, 'assets'));
  const library = 'const library = "public physics";\n'.repeat(500);
  await fs.writeFile(path.join(webRoot, 'assets/rapier-Test1234.js'), library);
  for (const ext of ['js', 'css', 'json', 'wasm']) await fs.writeFile(path.join(webRoot, `assets/game-Test1234.${ext}`), 'retained bytes '.repeat(500));
  const outside = await dir();
  await fs.writeFile(path.join(outside, 'private.js'), 'outside build');
  await fs.symlink(path.join(outside, 'private.js'), path.join(webRoot, 'assets/rapier-Escape123.js'));
  const app = await startShootServer({port: 0, directory, webRoot, publicOrigin: 'https://preview.example', previewAccessCode: accessCode, budget: {stage: 'fanshuo', limit: 130}, fakeOptions: {delayMs: 1}});
  t.after(() => app.close());
  const send = async (route, {method = 'GET', cookie = '', bytes, headers = {}} = {}) => new Promise((resolve, reject) => {
    const req = http.request(app.url + route, {method, headers: {host: 'preview.example', origin: 'https://preview.example', ...(cookie ? {cookie} : {}), ...headers}}, res => {
      const chunks = []; res.on('data', b => chunks.push(b));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), bytes: Buffer.concat(chunks)}));
    }); req.on('error', reject); req.end(bytes);
  });
  for (const route of ['/', '/font.woff', '/assets/game-Test1234.js', '/assets/rapier-Test1234.js?extra=1', '/api/shoot/quota', '/api/shoot/items', '/api/shoot/jobs']) assert.equal((await send(route)).status, 403);
  const probe = await send('/assets/rapier-Test1234.js', {headers: {'accept-encoding': 'gzip'}});
  assert.equal(probe.status, 200); assert.equal(probe.headers['content-encoding'], 'gzip'); assert.equal(probe.headers.vary, 'Accept-Encoding');
  assert.equal(probe.headers['cache-control'], 'public, max-age=31536000, immutable'); assert.equal(probe.headers['set-cookie'], undefined);
  assert.equal(gunzipSync(probe.bytes).toString(), library); assert.ok(probe.bytes.length < Buffer.byteLength(library));
  const head = await send('/assets/rapier-Test1234.js', {method: 'HEAD', headers: {'accept-encoding': 'gzip'}});
  assert.equal(head.status, 200); assert.equal(head.body, ''); assert.equal(Number(head.headers['content-length']), probe.bytes.length);
  assert.equal((await send('/assets/rapier-Test1234.js', {method: 'POST'})).status, 403);
  assert.equal((await send('/assets/rapier-Escape123.js')).status, 404);
  assert.equal((await send('/assets/rapier-Test1234.js', {headers: {host: 'other.example'}})).status, 403);
  assert.equal((await send('/assets/rapier-Test1234.js', {headers: {origin: 'https://other.example'}})).status, 403);
  const uncompressed = await send('/assets/rapier-Test1234.js', {headers: {'accept-encoding': 'gzip;q=0'}});
  assert.equal(uncompressed.body, library); assert.equal(uncompressed.headers['content-encoding'], undefined);
  assert.equal((await send('/api/shoot/health')).status, 200);
  for (const code of ['b'.repeat(64), 'a'.repeat(63), '%E4%B8%AD'.repeat(64)]) assert.equal((await send('/open/' + code)).status, 403);
  assert.equal((await send('/open/' + accessCode + '?extra=1')).status, 403);
  const link = await send('/open/' + accessCode);
  assert.equal(link.status, 303); assert.equal(link.headers.location, '/?shoot=real&capture=1');
  assert.equal(link.headers['cache-control'], 'no-store'); assert.equal(link.headers['referrer-policy'], 'no-referrer');
  assert.match(link.headers['set-cookie'][0], /^__Host-wanwu_preview=.*; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  const access = link.headers['set-cookie'][0].split(';')[0];
  const page = await send('/', {cookie: access});
  assert.match(page.body, /preview game/); assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.headers['set-cookie'], undefined);
  for (const ext of ['js', 'css', 'json', 'wasm']) {
    const asset = await send(`/assets/game-Test1234.${ext}`, {cookie: access, headers: {'accept-encoding': 'br, gzip;q=0.8'}});
    assert.equal(asset.status, 200); assert.equal(asset.headers['content-encoding'], 'gzip');
    assert.equal(asset.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.equal(asset.headers['set-cookie'], undefined);
    assert.equal(gunzipSync(asset.bytes).toString(), 'retained bytes '.repeat(500));
  }
  const font = await send('/font.woff', {cookie: access}); assert.equal(font.status, 200); assert.equal(font.headers['content-type'], 'font/woff');
  assert.equal((await send('/api/shoot/quota', {cookie: access + '; ' + access})).status, 403);
  const browsers = await Promise.all([send('/api/shoot/quota', {cookie: access}), send('/api/shoot/quota', {cookie: access})]);
  const cookies = browsers.map(r => access + '; ' + r.headers['set-cookie'][0].split(';')[0]);
  assert.notEqual(cookies[0], cookies[1]);
  const form = new FormData(); form.set('clientKey', 'same-client-key'); form.set('photo', new Blob([photo], {type: 'image/png'}), 'photo.png');
  const request = new Request(app.url, {method: 'POST', body: form});
  const bytes = Buffer.from(await request.arrayBuffer()), headers = {'content-type': request.headers.get('content-type')};
  const replies = await Promise.all(cookies.map(cookie => send('/api/shoot/jobs', {method: 'POST', cookie, bytes, headers})));
  assert.ok(replies.every(r => r.status === 202));
  const ids = replies.map(r => JSON.parse(r.body).job.id); assert.notEqual(ids[0], ids[1]);
  assert.equal((await send('/api/shoot/jobs/' + ids[0], {cookie: cookies[1]})).status, 404);
  assert.equal(JSON.parse((await send('/api/shoot/quota', {cookie: cookies[0]})).body).budget.remaining, 104);
});

test('temporary preview refuses weak codes, cross-site frontend, or a budget above 130', async () => {
  for (const extra of [{previewAccessCode: 'weak'}, {previewAccessCode: 'a'.repeat(64), frontendOrigin: 'https://other.example'}, {previewAccessCode: 'a'.repeat(64), budget: {stage: 'fanshuo', limit: 143}}]) {
    await assert.rejects(startShootServer({port: 0, directory: await dir(), publicOrigin: 'https://preview.example', budget: {stage: 'fanshuo', limit: 130}, ...extra}));
  }
});
