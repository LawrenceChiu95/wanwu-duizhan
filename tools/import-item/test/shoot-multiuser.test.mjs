import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import sharp from 'sharp';
import {startShootServer} from '../shoot/server.mjs';
import {openJobs} from '../shoot/jobs.mjs';
import {fakeGenerator} from '../shoot/fake.mjs';
const photo = await sharp({create: {width: 20, height: 24, channels: 3, background: '#ccaa88'}}).png().toBuffer();
const directory = () => fs.mkdtemp(path.join(os.tmpdir(), 'shoot-people-'));
async function until(read, accept) {
 const end = Date.now() + 25000;
 do { const r = await read(); if (accept(r)) return r; await pause(10); } while (Date.now() < end);
 throw Error('Test checkpoint timed out');
}
function browser(app, initial = '') {
 let cookie = initial;
 return {
  get cookie() { return cookie; },
  async call(route, data, method = data === undefined ? 'GET' : 'POST') {
   const headers = {cookie}; let body;
   if (data instanceof FormData) body = data;
   else if (data !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(data); }
   const r = await fetch(app.url + '/api/shoot/' + route, {method, headers, body});
   cookie = r.headers.get('set-cookie')?.split(';')[0] ?? cookie;
   return {status: r.status, ...await r.json()};
  },
  create(key) { const form = new FormData(); form.append('photo', new Blob([photo]), 'a.png'); form.append('clientKey', key); return this.call('jobs', form); }
 };
}
const finish = (b, id) => until(() => b.call('jobs/' + id), r => ['failed', 'succeeded'].includes(r.job.status));
async function appFor(t, opts = {}) { const app = await startShootServer({port: 0, directory: await directory(), fakeOptions: {delayMs: 1}, ...opts}); t.after(() => app.close()); return app; }

test('two real HTTP browser identities isolate keys, status, actions, items and all assets', async t => {
 const app = await appFor(t), a = browser(app), b = browser(app);
 const firstResponse = await fetch(app.url + '/api/shoot/quota');
 assert.match(firstResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
 const qa = await a.call('quota'), qb = await b.call('quota');
 assert.equal(qa.limit, 2); assert.equal(qa.recognition.limit, 5); assert.equal(qa.global.limit, 160); assert.equal(qa.global.recognition.limit, 400);
 assert.notEqual(a.cookie, b.cookie);
 const replies = [await a.create('same-browser-key'), await b.create('same-browser-key')];
 const x = replies[0].job, y = replies[1].job; assert.notEqual(x.id, y.id);
 assert.equal((await b.call('jobs/' + y.id)).job.queuePosition, 1);
 assert.equal((await b.call('quota')).activeJobId, y.id);
 for (const action of ['', '/retry', '/retake']) assert.equal((await b.call('jobs/' + x.id + action, undefined, action ? 'POST' : 'GET')).status, 404);
 assert.equal((await b.call('jobs/' + x.id + '/regenerate', {confirm: true, clientKey: 'cross-regen-key'})).status, 404);
 assert.equal((await b.call('jobs', {fromJob: x.id, clientKey: 'cross-busy-key'})).status, 404);
 assert.equal((await a.create('same-browser-key')).job.id, x.id);
 assert.equal((await finish(a, x.id)).job.status, 'succeeded');
 assert.equal((await finish(b, y.id)).job.status, 'succeeded');
 const [i] = (await a.call('items')).items, [j] = (await b.call('items')).items;
 assert.equal(i.id, 'shoot_' + x.id.slice(2)); assert.equal(j.id, 'shoot_' + y.id.slice(2));
 assert.equal((await a.call('jobs/' + x.id)).job.queuePosition, null);
 for (const file of ['model.glb', 'photo.jpg', 'styled.jpg']) {
  const route = `${app.url}/api/shoot/files/${i.id}/${file}`;
  assert.equal((await fetch(route, {headers: {cookie: b.cookie}})).status, 404);
  assert.equal((await fetch(route, {headers: {cookie: a.cookie}})).status, 200);
 }
 const forged = browser(app, a.cookie.slice(0, -1) + (a.cookie.endsWith('a') ? 'b' : 'a'));
 assert.equal((await forged.call('jobs/' + x.id)).status, 404);
 assert.deepEqual((await forged.call('items')).items, []);
 const disk = JSON.parse(await fs.readFile(path.join(app.jobs.directory, 'state.json')));
 assert.ok(Object.keys(disk.keys).some(k => k.endsWith(':same-browser-key')));
 assert.ok(!JSON.stringify([x, i, qa]).includes(disk.sessionSecret));
 assert.ok(!JSON.stringify(x).includes(disk.jobs[x.id].owner));
});

test('global reservations and per-browser single job serialize concurrent acceptance before any provider call', async t => {
 const dir = await directory(), generator = await fakeGenerator(dir, {delayMs: 1});
 let release; const gate = new Promise(r => release = r); const recognize = generator.recognize;
 generator.recognize = async (...args) => { await gate; return recognize(...args); };
 const limits = {browser: {generation: 2, recognition: 5}, global: {generation: 3, recognition: 4}};
 const app = await appFor(t, {directory: dir, generator, limits}), people = Array.from({length: 5}, () => browser(app));
 try {
  await Promise.all(people.map(b => b.call('quota')));
  const rs = await Promise.all(people.map((b, n) => b.create('queue-key-' + n)));
  const accepted = rs.filter(r => r.status === 202); assert.equal(accepted.length, 3);
  assert.equal(rs.filter(r => r.status === 429 && r.error.kind === 'generation' && r.error.scope === 'global').length, 2);
  const positions = await Promise.all(accepted.map(r => app.jobs.get(r.job.id)));
  assert.deepEqual(positions.map(j => j.queuePosition).sort(), [0, 1, 2]);
  const n = rs.findIndex(r => r.status === 202);
  assert.equal((await people[n].create('another-active-key')).error.code, 'active-job');
  assert.equal((await people[n].call('quota')).remaining, 1);
  assert.equal((await people[n].call('quota')).global.remaining, 0);
  assert.equal((await app.jobs.quota()).used, 0);
  assert.deepEqual((await app.jobs.items()), []);
 } finally { release(); }
});

test('five recognition attempts persist, generation is returned after rejection, Taipei midnight restores daily limits', async () => {
 const dir = await directory(); let time = Date.parse('2026-11-04T15:59:59Z');
 let app = await startShootServer({port: 0, directory: dir, clock: () => time, fakeOptions: {delayMs: 1, fault: 'photo-unclear'}}), b = browser(app);
 try {
  for (let n = 0; n < 5; n++) { const {job} = await b.create('unclear-key-' + n); assert.equal((await finish(b, job.id)).job.error.code, 'photo-unclear'); }
  const q = await b.call('quota'); assert.equal(q.remaining, 2); assert.equal(q.recognition.remaining, 0); assert.equal(q.resetsAt, '2026-11-04T16:00:00.000Z');
  assert.equal((await b.create('unclear-denied')).error.kind, 'recognition');
  const cookie = b.cookie; await app.close(); app = await startShootServer({port: 0, directory: dir, clock: () => time, fakeOptions: {delayMs: 1, fault: 'photo-unclear'}}); b = browser(app, cookie);
  assert.equal((await b.call('quota')).recognition.remaining, 0);
  time = Date.parse('2026-11-04T16:00:00Z');
  assert.equal((await b.call('quota')).recognition.remaining, 5);
  assert.equal((await b.call('quota')).remaining, 2);
  const next = await b.create('next-day-key'); assert.equal(next.status, 202); await finish(b, next.job.id);
  assert.equal((await b.call('quota')).recognition.remaining, 4);
 } finally { await app.close(); }
});

test('two generations deny a third before recognition; original key replay and free retry do not consume slots', async t => {
 const dir = await directory(), generator = await fakeGenerator(dir, {delayMs: 1, fault: 'download'});
 let recognized = 0; const recognize = generator.recognize; generator.recognize = (...args) => { recognized++; return recognize(...args); };
 const app = await appFor(t, {directory: dir, generator}), b = browser(app);
 const first = await b.create('cap-generation-1'); await finish(b, first.job.id);
 assert.equal((await b.call('quota')).remaining, 1);
 assert.equal((await b.call(`jobs/${first.job.id}/retry`, undefined, 'POST')).status, 200);
 assert.equal((await finish(b, first.job.id)).job.status, 'succeeded');
 assert.equal((await b.create('cap-generation-1')).job.id, first.job.id);
 const second = await b.create('cap-generation-2'); await finish(b, second.job.id);
 const denied = await b.create('cap-generation-3'); assert.equal(denied.status, 429); assert.equal(denied.error.kind, 'generation'); assert.equal(denied.error.scope, 'browser');
 assert.equal(denied.error.message, '今天的生成名额用完了，明天再来'); assert.equal(recognized, 2);
 assert.equal((await b.call('quota')).recognition.remaining, 3);
});

test('queued jobs and ownership survive restart in FIFO order with no repeated completed work', async () => {
 const dir = await directory(); let app = await startShootServer({port: 0, directory: dir, fakeOptions: {delayMs: 1}});
 let a = browser(app), b = browser(app), c = browser(app);
 try {
  await Promise.all([a.call('quota'), b.call('quota'), c.call('quota')]);
  const x = (await a.create('restart-queue-1')).job;
  await until(() => a.call('jobs/' + x.id), r => r.job.retakeUntil);
  const y = (await b.create('restart-queue-2')).job, z = (await c.create('restart-queue-3')).job;
  const cookies = [a.cookie, b.cookie, c.cookie]; await app.close();
  const state = JSON.parse(await fs.readFile(path.join(dir, 'state.json')));
  assert.equal(state.jobs[y.id].job.steps[0].startedAt, null);
  const generator = await fakeGenerator(dir, {delayMs: 1}), order = [], submit = generator.submit;
  generator.submit = async id => { order.push(id); return submit(id); };
  app = await startShootServer({port: 0, directory: dir, generator});
  [a, b, c] = cookies.map(cookie => browser(app, cookie));
  assert.equal((await b.create('restart-queue-2')).job.id, y.id);
  assert.equal((await c.call('jobs/' + x.id)).status, 404);
  for (const [who, j] of [[a, x], [b, y], [c, z]]) assert.equal((await finish(who, j.id)).job.status, 'succeeded');
  assert.deepEqual(order, [x.id, y.id, z.id]);
  assert.equal((await app.jobs.quota()).used, 3);
  assert.equal((await a.call('quota')).used, 1); assert.equal((await b.call('quota')).used, 1);
 } finally { await app.close(); }
});

test('historical unowned inventory remains local-only when cookie sessions are introduced', async () => {
 const dir = await directory(), jobs = await openJobs({directory: dir, fakeOptions: {delayMs: 1}});
 const old = await jobs.create({photo, clientKey: 'legacy-local-key'}); await until(() => jobs.get(old.id), j => j.status === 'succeeded'); assert.equal((await jobs.items()).length, 1); await jobs.close();
 const file = path.join(dir, 'state.json'), saved = JSON.parse(await fs.readFile(file));
 delete saved.jobs[old.id].owner; delete saved.sessionSecret; await fs.writeFile(file, JSON.stringify(saved));
 const app = await startShootServer({port: 0, directory: dir}), b = browser(app);
 try { assert.equal((await b.call('jobs/' + old.id)).status, 404); assert.deepEqual((await b.call('items')).items, []); assert.equal((await b.call('quota')).activeJobId, null); }
 finally { await app.close(); }
});

test('a queued job crossing midnight checks generation again before spending recognition', async t => {
 const dir = await directory(), generator = await fakeGenerator(dir, {delayMs: 1, fault: 'photo-unclear'});
 let time = Date.parse('2026-11-04T15:59:59Z'), entered, release, count = 0;
 const ready = new Promise(r => entered = r), gate = new Promise(r => release = r), recognize = generator.recognize;
 generator.recognize = async (...args) => { count++; if (count === 1) { entered(); await gate; } return recognize(...args); };
 const app = await appFor(t, {directory: dir, generator, clock: () => time, limits: {browser: {generation: 2, recognition: 5}, global: {generation: 2, recognition: 10}}});
 const people = Array.from({length: 4}, () => browser(app));
 try {
  await Promise.all(people.map(b => b.call('quota')));
  const first = (await people[0].create('old-day-first')).job; await ready;
  const old = (await people[1].create('old-day-queued')).job;
  time = Date.parse('2026-11-04T16:00:00Z');
  const fresh = [(await people[2].create('new-day-first')).job, (await people[3].create('new-day-second')).job];
  release(); await finish(people[0], first.id);
  const denied = await finish(people[1], old.id); assert.equal(denied.job.error.code, 'quota'); assert.equal(denied.job.error.kind, 'generation');
  for (let n = 0; n < 2; n++) await finish(people[n + 2], fresh[n].id);
  assert.equal(count, 3, 'old queued photo must not incur a recognition call after capacity changed');
 } finally { release(); }
});

test('the global recognition limit rejects before calling the provider and resets in Taipei time', async t => {
 let count = 0, time = Date.parse('2026-11-04T15:59:59Z');
 const dir = await directory(), generator = await fakeGenerator(dir, {delayMs: 1, fault: 'photo-unclear'}), recognize = generator.recognize;
 generator.recognize = (...args) => { count++; return recognize(...args); };
 const app = await appFor(t, {directory: dir, generator, clock: () => time, limits: {browser: {generation: 2, recognition: 5}, global: {generation: 160, recognition: 2}}});
 const people = Array.from({length: 3}, () => browser(app)); await Promise.all(people.map(b => b.call('quota')));
 for (let n = 0; n < 2; n++) { const {job} = await people[n].create('recognize-global-' + n); await finish(people[n], job.id); }
 const denied = await people[2].create('recognize-third'); assert.equal(denied.status, 429); assert.equal(denied.error.kind, 'recognition'); assert.equal(denied.error.scope, 'global'); assert.equal(count, 2);
 time = Date.parse('2026-11-04T16:00:00Z'); const {job} = await people[2].create('recognize-third'); await finish(people[2], job.id); assert.equal(count, 3);
});

test('the CLI keeps its cookie for subsequent requests and a second observation without revealing it', async () => {
 const {spawn} = await import('node:child_process');
 const dir = await directory(), script = path.join(dir, 'tools/import-item/shoot/check-real.mjs');
 await fs.mkdir(path.dirname(script), {recursive: true}); await fs.copyFile(new URL('../shoot/check-real.mjs', import.meta.url), script);
 const image = path.join(dir, 'photo.png'); await fs.writeFile(image, photo);
 const source = `process.argv=['node','check-real','--photo',${JSON.stringify(image)},'--key','cli-cookie-key','--allow-paid'];
 let seen=[];globalThis.fetch=async(url,o)=>{seen.push(o.headers?.cookie??'');const mode=process.env.TEST_SHOOT_PROVIDER??'real',provider=mode==='switch'?(url.endsWith('quota')?'real':'fake'):mode;return Response.json(url.endsWith('quota')?{provider}:{job:{id:'j_cli',status:'failed',error:{code:'unknown-submit'}}},{headers:{'set-cookie':'wanwu_shoot_'+provider+'=fake-private-session; HttpOnly; SameSite=Strict'}})};
 try{await import(${JSON.stringify(pathToFileURL(script).href)})}finally{console.log('HEADERS='+JSON.stringify(seen))}`;
 async function run(provider = 'real') {
  const p = spawn(process.execPath, ['--input-type=module', '-e', source], {env: {...process.env, TEST_SHOOT_PROVIDER: provider}}); let out = '', err = '';
  p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b);
  const exit = await new Promise(r => p.once('exit', r)); assert.equal(exit, 1, err);
  return JSON.parse(out.split('HEADERS=')[1]);
 }
 assert.deepEqual(await run(), ['', 'wanwu_shoot_real=fake-private-session']);
 assert.deepEqual(await run('fake'), ['wanwu_shoot_real=fake-private-session']);
 assert.deepEqual(await run('switch'), ['wanwu_shoot_real=fake-private-session', 'wanwu_shoot_real=fake-private-session']);
 assert.deepEqual(await run(), ['wanwu_shoot_real=fake-private-session', 'wanwu_shoot_real=fake-private-session']);
 const cookieFile = path.join(dir, '.aholo/shoot-client-cookie.json'); assert.equal(JSON.parse(await fs.readFile(cookieFile)).cookie, 'wanwu_shoot_real=fake-private-session');
 if (process.platform !== 'win32') assert.equal((await fs.stat(cookieFile)).mode & 0o777, 0o600);
});

test('real and fake browser cookies coexist without replacing the owner of an existing job', async t => {
 const real = await appFor(t, {generator: {real: true, charged: () => false, recognize() { throw Object.assign(Error('unclear'), {code: 'photo-unclear'}); }}});
 const fake = await appFor(t), b = browser(real);
 const {job} = await b.create('separate-provider-key'); await finish(b, job.id);
 const realCookie = b.cookie; assert.match(realCookie, /^wanwu_shoot_real=/);
 const visitFake = await fetch(fake.url + '/api/shoot/quota', {headers: {cookie: realCookie}});
 const fakeCookie = visitFake.headers.get('set-cookie').split(';')[0]; assert.match(fakeCookie, /^wanwu_shoot_fake=/);
 const response = await fetch(real.url + '/api/shoot/jobs/' + job.id, {headers: {cookie: `${realCookie}; ${fakeCookie}`}});
 assert.equal(response.status, 200); assert.equal((await response.json()).job.id, job.id);
 assert.equal(response.headers.get('set-cookie').split(';')[0], realCookie);
});
