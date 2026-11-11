import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {startShootServer} from '../shoot/server.mjs';

const origin = 'https://game.example';
const photo = await sharp({create: {width: 8, height: 8, channels: 3, background: 'orange'}}).png().toBuffer();
const options = {port: 0, publicOrigin: origin, headerIdentity: true, budget: {stage: 'session-fake', limit: 39}, fakeOptions: {delayMs: 1}};
const call = (app, route, token, body, extra = {}) => fetch(app.url + '/api/shoot/' + route, {
  method: body === undefined ? 'GET' : 'POST', headers: {origin, ...(token ? {'x-shoot-session': token} : {}), ...extra}, body
});
async function session(app) {
  const response = await call(app, 'session', null, '');
  assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const {token} = await response.json(); assert.match(token, /^[a-f0-9-]{36}\.[a-f0-9]{64}$/); return token;
}
function form() {
  const data = new FormData(); data.set('clientKey', 'same-session-key'); data.set('photo', new Blob([photo]), 'photo.png'); return data;
}
async function finish(app, id, token) {
  const end = Date.now() + 20000;
  do {
    const r = await call(app, 'jobs/' + id, token), {job} = await r.json();
    if (['succeeded', 'failed'].includes(job.status)) return job;
    await pause(10);
  } while (Date.now() < end);
  throw Error('Fake job timed out');
}

test('header session is explicit, validated before writes, and never replaced by cookies or invalid input', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shoot-session-'));
  const app = await startShootServer({...options, directory}); t.after(() => app.close());
  const a = await session(app), b = await session(app); assert.notEqual(a, b);
  assert.equal((await call(app, 'health')).status, 200);
  for (const token of [null, 'invalid', a.slice(0, -1) + (a.endsWith('a') ? 'b' : 'a')]) {
    for (const [route, body] of [['quota', undefined], ['jobs', form()]]) {
      const r = await call(app, route, token, body, {cookie: 'wanwu_shoot_fake=' + a});
      assert.equal(r.status, 401); assert.equal(r.headers.get('set-cookie'), null);
      assert.equal((await r.json()).error.code, 'session');
    }
  }
  assert.equal((await app.jobs.quota()).used, 0);
  assert.equal(Object.keys(JSON.parse(await fs.readFile(path.join(directory, 'state.json'))).jobs).length, 0);
  assert.equal((await call(app, 'session', a, '')).status, 401);
  assert.equal((await call(app, 'session', null, 'x')).status, 413);
  assert.equal((await call(app, 'session', null, '', {origin: 'https://other.example'})).status, 403);
  const q = await call(app, 'quota', a); assert.equal(q.status, 200); assert.equal(q.headers.get('set-cookie'), null);
  const wire = await q.text(); assert.ok(!wire.includes(a)); assert.ok(!wire.includes(b));
});

test('cookie-free identities isolate private assets and same-key recovery survives a backend restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shoot-session-restart-'));
  let app = await startShootServer({...options, directory});
  try {
    const a = await session(app), b = await session(app);
    // Accept a request and discard its reply, as a lost connection would do.
    const lost = await call(app, 'jobs', a, form()); assert.equal(lost.status, 202); await lost.arrayBuffer();
    const retry = await call(app, 'jobs', a, form()), first = (await retry.json()).job;
    const state = JSON.parse(await fs.readFile(path.join(directory, 'state.json'))); assert.equal(Object.keys(state.jobs).length, 1);
    assert.equal((await finish(app, first.id, a)).status, 'succeeded');
    assert.equal((await call(app, 'jobs/' + first.id, b)).status, 404);
    const {items: [item]} = await (await call(app, 'items', a)).json();
    assert.deepEqual((await (await call(app, 'items', b)).json()).items, []);
    for (const file of ['model.glb', 'photo.jpg', 'styled.jpg']) {
      const route = `files/${item.id}/${file}`;
      assert.equal((await call(app, route, b)).status, 404);
      assert.equal((await call(app, route)).status, 401);
      assert.equal((await call(app, route, a)).status, 200);
    }
    await app.close(); app = await startShootServer({...options, directory});
    assert.equal((await (await call(app, 'jobs', a, form())).json()).job.id, first.id);
    const q = await (await call(app, 'quota', a)).json(); assert.equal(q.remaining, 1); assert.equal(q.recognition.remaining, 4); assert.equal(q.budget.remaining, 26);
    assert.equal((await call(app, 'jobs/' + first.id, b)).status, 404);
  } finally { await app.close(); }
});

test('header identity cannot be enabled on the private preview or a nonpublic backend', async () => {
  await assert.rejects(startShootServer({headerIdentity: true}), /dedicated public API/);
  await assert.rejects(startShootServer({...options, previewAccessCode: 'a'.repeat(64)}), /dedicated public API/);
});

test('judge can disable the aggregate caps without bypassing the browser quota', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shoot-unmetered-'));
  const budget = {...options.budget, limit: null};
  const limits = {browser: {generation: 10, recognition: 10}, global: {generation: null, recognition: 400}};
  await assert.rejects(startShootServer({...options, directory, headerIdentity: false, budget}), /dedicated judge API/);
  await assert.rejects(startShootServer({...options, directory, headerIdentity: false, limits}), /dedicated judge API/);
  const clock = () => Date.parse('2026-11-11T04:00:00Z');
  let app = await startShootServer({...options, directory, clock});
  const a = await session(app), b = await session(app);
  await app.close();

  // Existing signed sessions have used today's quota and the old shared budget.
  const file = path.join(directory, 'state.json');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const token of [a, b]) for (let i = 0; i < 10; i++) {
    const id = 'j_' + randomUUID(), day = '2026-11-11';
    await fs.mkdir(path.join(directory, id));
    state.jobs[id] = {job: {id, status: 'succeeded'}, owner: token.split('.')[0], queueOrder: ++state.sequence,
      allowance: {generation: {day}, recognition: {day}}, budget: {stage: budget.stage, credits: 13}};
  }
  await fs.writeFile(file, JSON.stringify(state));
  app = await startShootServer({...options, directory, clock, budget, limits});
  t.after(() => app.close());
  const c = await session(app);
  const quota = await (await call(app, 'quota', c)).json();
  assert.equal(quota.remaining, 10);
  assert.equal(quota.recognition.remaining, 10);
  assert.equal(quota.global.recognition.remaining, 380);
  assert.equal(quota.global.remaining, null);
  assert.equal(Object.hasOwn(quota, 'budget'), false);
  assert.equal((await call(app, 'jobs', a, form())).status, 429);
  assert.equal((await call(app, 'jobs', c, form())).status, 202);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const [id, record] of Object.entries(state.jobs)) assert.deepEqual(saved.jobs[id].budget, record.budget);
});


test('dedicated config uses 4331 and refuses to take the existing cookie backend port', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shoot-session-cli-'));
  const config = path.join(directory, 'config.json'), script = fileURLToPath(new URL('../shoot/server.mjs', import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/proxy|api_key|gemini|aholo|google/i.test(key)));
  const run = () => spawn(process.execPath, [script, '--config', config], {env, stdio: ['ignore', 'pipe', 'pipe']});
  // Only the CLI config contract: omit the function API's fakeOptions.
  const base = {port: 4331, directory, publicOrigin: origin, headerIdentity: true, budget: options.budget};
  await fs.writeFile(config, JSON.stringify({...base, port: 4330}));
  const invalid = run(); invalid.stdout.resume(); invalid.stderr.resume(); assert.notEqual((await once(invalid, 'exit'))[0], 0);
  await fs.writeFile(config, JSON.stringify(base));
  const child = run(); let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  const end = Date.now() + 5000;
  while (!output.includes('127.0.0.1:4331') && child.exitCode === null && Date.now() < end) await pause(10);
  assert.ok(output.includes('127.0.0.1:4331'), 'dedicated fake backend did not start');
  const r = await fetch('http://127.0.0.1:4331/api/shoot/session', {method: 'POST', headers: {origin}});
  assert.equal(r.status, 200); assert.equal(r.headers.get('set-cookie'), null); await r.arrayBuffer();
});
