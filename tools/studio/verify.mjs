// Offline providers only. The optional cloud URL exercises the same gateway;
// no provider environment or credentials are loaded by this harness.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {pipeline} from 'node:stream/promises';
import {startShootServer} from '../import-item/shoot/server.mjs';
import {fakeGenerator} from '../import-item/shoot/fake.mjs';
import {createGateway} from './gateway.mjs';

const {values: v} = parseArgs({options: Object.fromEntries(['out', 'frp-dir', 'photo', 'model', 'cloud-origin'].map(k => [k, {type: 'string'}]))});
for (const k of ['out', 'frp-dir', 'photo', 'model']) if (!path.isAbsolute(v[k] ?? '')) throw Error('Absolute ' + k + ' required');
await fs.mkdir(v.out, {recursive: true, mode: 0o700});
const repo = fileURLToPath(new URL('../../', import.meta.url)), servers = [], children = [], socketSet = new Set();
const result = {mode: v['cloud-origin'] ? 'cloud' : 'local-tls', realProviderCalls: 0, checks: {}, started: new Date().toISOString()};
const hash = b => createHash('sha256').update(b).digest('hex');
const run = (bin, args, env) => {
  const child = spawn(bin, args, {env, stdio: ['ignore', 'ignore', 'ignore']});
  child.on('error', () => {}); child.done = new Promise(resolve => child.once('exit', resolve)); children.push(child); return child;
};
const available = port => new Promise(resolve => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); });
async function until(fn, accept = Boolean, timeout = 30000) {
  const end = Date.now() + timeout;
  do { try { const x = await fn(); if (accept(x)) return x; } catch {} await pause(100); } while (Date.now() < end);
  throw Error('Timed out');
}
async function listen(s, port = 0) {
  servers.push(s); s.on('connection', c => { socketSet.add(c); c.once('close', () => socketSet.delete(c)); });
  s.listen(port, '127.0.0.1'); await once(s, 'listening'); return s.address().port;
}
const directory = path.join(v.out, 'jobs'), fixture = path.join(v.out, 'repo');
await fs.mkdir(path.join(fixture, 'data'), {recursive: true}); await fs.mkdir(path.join(fixture, 'sim'), {recursive: true});
const catalog = JSON.parse(await fs.readFile(path.join(repo, 'data/catalog.json')));
// Use a real retained GLB as the fake provider's download fixture. Geometry is
// not evaluated here; the test concerns transport and the real ownership layer.
catalog.items.find(i => i.id === 'pan-lux3d').glb = 'data/fixture.glb';
await fs.writeFile(path.join(fixture, 'data/catalog.json'), JSON.stringify(catalog));
await fs.copyFile(v.model, path.join(fixture, 'data/fixture.glb'));
await fs.copyFile(path.join(repo, 'sim/v3-rules.json'), path.join(fixture, 'sim/v3-rules.json'));
await fs.mkdir(directory, {recursive: true, mode: 0o700});
let app, gateway;
try {
  const generator = await fakeGenerator(directory, {delayMs: 5});
  const publicOrigin = v['cloud-origin'] || 'https://localhost';
  app = await startShootServer({port: 0, directory, repo: fixture, publicOrigin, generator, budget: {stage: 'isolated-fake-only', limit: 39}});
  let drop = true, lostResponses = 0; const uploads = [];
  const fault = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/shoot/jobs') {
      const digest = createHash('sha256'); let size = 0;
      req.on('data', b => { digest.update(b); size += b.length; });
      req.on('end', () => uploads.push({bytes: size, sha256: digest.digest('hex')}));
    }
    const lose = drop && req.method === 'POST' && req.url === '/api/shoot/jobs';
    if (lose) drop = false;
    const upstream = http.request(app.url + req.url, {method: req.method, headers: req.headers, agent: false}, response => {
      if (lose) { response.resume(); response.on('end', () => { lostResponses++; res.destroy(); }); }
      else { res.writeHead(response.statusCode, response.headers); pipeline(response, res).catch(() => res.destroy()); }
    });
    upstream.on('error', () => res.destroy()); pipeline(req, upstream).catch(() => upstream.destroy());
  });
  const backendPort = await listen(fault);
  const env = {...process.env};
  for (const key of Object.keys(env)) if (/proxy|API_KEY|GEMINI|AHOLO|GOOGLE/i.test(key)) delete env[key];
  let target = publicOrigin, ca;
  const token = v['cloud-origin'] ? process.env.WANWU_TUNNEL_TOKEN : randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw Error('Missing tunnel token');
  env.WANWU_TUNNEL_TOKEN = token;
  if (!v['cloud-origin']) {
    assert.equal(await available(7001), false);
    // macOS Control Center can legitimately own 7000. Only the cloud fixes
    // that private port; allocate a separate loopback port for this fixture.
    const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const frpPort = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const cert = path.join(v.out, 'cert.pem'), key = path.join(v.out, 'key.pem');
    const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], {stdio: 'ignore'});
    assert.equal(openssl.status, 0); await fs.chmod(key, 0o600); ca = await fs.readFile(cert);
    gateway = createGateway({publicOrigin, frpPort, tls: {key: await fs.readFile(key), cert: ca}});
    target += ':' + await listen(gateway.server);
    const serverConfig = path.join(v.out, 'frps.toml');
    await fs.writeFile(serverConfig, (await fs.readFile(path.join(repo, 'tools/studio/frps.toml'), 'utf8')).replace('bindPort = 7000', 'bindPort = ' + frpPort));
    run(path.join(v['frp-dir'], 'frps'), ['-c', serverConfig], env);
    await until(() => available(frpPort));
  }
  const url = new URL(target);
  let config = await fs.readFile(path.join(repo, 'tools/studio/frpc.example.toml'), 'utf8');
  if (ca) config = config.replace('serverPort = 443', 'serverPort = ' + url.port).replace('transport.tls.useSystemCa = true', 'transport.tls.useSystemCa = false\ntransport.tls.trustedCaFile = ' + JSON.stringify(path.join(v.out, 'cert.pem')));
  const conf = path.join(v.out, 'frpc.toml'); await fs.writeFile(conf, config, {mode: 0o600});
  Object.assign(env, {WANWU_PUBLIC_HOST: url.hostname, WANWU_BACKEND_PORT: String(backendPort)});
  run(path.join(v['frp-dir'], 'frpc'), ['-c', conf], env);
  const send = (route, {method = 'GET', cookie = '', bytes, type} = {}) => new Promise((resolve, reject) => {
    const req = https.request(target + route, {method, ca, headers: {origin: publicOrigin, ...(cookie ? {cookie} : {}), ...(type ? {'content-type': type, 'content-length': bytes.length} : {})}}, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks)})); res.on('error', reject);
    }); req.setTimeout(30000, () => req.destroy(Error('HTTP timeout'))); req.on('error', reject); req.end(bytes);
  });
  await until(() => send('/api/shoot/health'), x => x.status === 200, 60000);
  const browsers = await Promise.all([send('/api/shoot/quota'), send('/api/shoot/quota')]);
  const cookies = browsers.map(r => { assert.equal(r.status, 200); assert.match(r.headers['set-cookie'][0], /HttpOnly; SameSite=Strict;.*Secure/); return r.headers['set-cookie'][0].split(';')[0]; });
  assert.notEqual(cookies[0], cookies[1]);
  const photo = await fs.readFile(v.photo), model = await fs.readFile(v.model);
  const form = new FormData(); form.set('clientKey', 'transport-same-key'); form.set('photo', new Blob([photo], {type: 'image/jpeg'}), 'photo.jpg');
  const request = new Request('http://local.invalid', {method: 'POST', body: form});
  const bytes = Buffer.from(await request.arrayBuffer()), type = request.headers.get('content-type');
  const first = await send('/api/shoot/jobs', {method: 'POST', cookie: cookies[0], bytes, type});
  assert.equal(first.status, 503); assert.equal(lostResponses, 1);
  const retry = await send('/api/shoot/jobs', {method: 'POST', cookie: cookies[0], bytes, type}); assert.equal(retry.status, 202);
  const a = JSON.parse(retry.bytes).job;
  const other = await send('/api/shoot/jobs', {method: 'POST', cookie: cookies[1], bytes, type}); assert.equal(other.status, 202);
  const b = JSON.parse(other.bytes).job; assert.notEqual(a.id, b.id);
  const complete = [];
  for (const [i, j] of [a, b].entries()) {
    const r = await until(() => send('/api/shoot/jobs/' + j.id, {cookie: cookies[i]}), x => x.status === 200 && JSON.parse(x.bytes).job.status === 'succeeded');
    const done = JSON.parse(r.bytes).job; complete.push(done);
    for (const file of ['photo.jpg', 'model.glb']) {
      const route = '/api/shoot/files/' + done.itemId + '/' + file;
      const downloaded = await send(route, {cookie: cookies[i]}); assert.equal(downloaded.status, 200); assert.equal(downloaded.headers['cache-control'], 'no-store');
      const stored = await fs.readFile(path.join(directory, j.id, file)); assert.equal(hash(downloaded.bytes), hash(stored));
      if (file === 'model.glb') assert.equal(hash(downloaded.bytes), hash(model));
      assert.equal((await send(route, {cookie: cookies[1 - i]})).status, 404);
      result.checks[file] = {uploadBytes: file === 'photo.jpg' ? photo.length : null, storedBytes: stored.length, receivedBytes: downloaded.bytes.length, sha256: hash(stored)};
    }
    assert.equal((await send('/api/shoot/jobs/' + j.id, {cookie: cookies[1 - i]})).status, 404);
  }
  const quotas = await Promise.all(cookies.map(async cookie => JSON.parse((await send('/api/shoot/quota', {cookie})).bytes)));
  for (const q of quotas) { assert.equal(q.remaining, 1); assert.equal(q.recognition.remaining, 4); assert.equal(q.budget.remaining, 13); }
  assert.equal(generator.used(), 2);
  assert.equal(uploads.length, 3);
  for (const upload of uploads) { assert.equal(upload.bytes, bytes.length); assert.equal(upload.sha256, hash(bytes)); }
  result.checks.uploadBody = {bytes: bytes.length, sha256: hash(bytes), receivedCopies: uploads.length};
  result.checks.identityAndRetry = {owners: 2, tasks: complete.length, lostResponses, fakeSubmissions: generator.used(), generationRemainingEach: quotas.map(q => q.remaining), recognitionRemainingEach: quotas.map(q => q.recognition.remaining), budgetRemaining: quotas[0].budget.remaining, crossReadStatus: 404};
  if (gateway) { gateway.disconnect(); await until(() => send('/api/shoot/health'), x => x.status === 200); result.checks.reconnect = 'passed'; }
  result.passed = true;
} catch (e) { result.passed = false; result.error = {name: e.name, code: e.code ?? null, operator: e.operator ?? null, frames: e.stack?.split('\n').filter(s => s.trimStart().startsWith('at ')).slice(0, 3)}; process.exitCode = 1; }
finally {
  gateway?.disconnect();
  for (const child of children.reverse()) { child.kill('SIGTERM'); await Promise.race([child.done, pause(2000)]); if (child.exitCode === null) { child.kill('SIGKILL'); await child.done; } }
  for (const socket of socketSet) socket.destroy();
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  await app?.close();
  result.finished = new Date().toISOString(); result.childrenExited = children.every(c => c.exitCode !== null || c.signalCode !== null);
  await fs.writeFile(path.join(v.out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
}
