import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {gunzipSync} from 'node:zlib';
import {createGateway} from './gateway.mjs';

async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return server.address().port;
}
const request = (port, route, {method = 'GET', headers = {}, bytes = ''} = {}) => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port, path: route, method, headers}, res => {
    const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks)}));
  }); req.on('error', reject); req.end(bytes);
});

test('API uses a fixed loopback destination and preserves status, private cookies and bytes', async t => {
  let seen;
  const apiPort = await listen(t, http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen = {path: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie, bytes: Buffer.concat(chunks)};
    res.writeHead(202, {'set-cookie': ['a=one; HttpOnly; Secure', 'b=two; HttpOnly; Secure'], 'cache-control': 'public', connection: 'close'}); res.end('accepted');
  }));
  const g = createGateway({publicOrigin: 'https://game.example', apiPort}); t.after(() => g.disconnect());
  const port = await listen(t, g.server), bytes = Buffer.alloc(270000, 42);
  const r = await request(port, '/api/shoot/jobs', {method: 'POST', bytes, headers: {origin: 'https://game.example', cookie: 'owner=fake-fixture', 'x-forwarded-host': 'elsewhere.example'}});
  assert.equal(r.status, 202); assert.equal(r.bytes.toString(), 'accepted'); assert.equal(r.headers['set-cookie'].length, 2); assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual(seen, {path: '/api/shoot/jobs', host: 'game.example', origin: 'https://game.example', cookie: 'owner=fake-fixture', bytes});
  await request(port, '/unused/../api/shoot/jobs?fixture=1'); assert.equal(seen.path, '/api/shoot/jobs?fixture=1');
  for (const route of ['/api/elsewhere', 'http://other.example/api/shoot/jobs', '//other.example/api/shoot/jobs']) assert.ok([400, 404].includes((await request(port, route)).status));
});

test('lost upstream response becomes 503 and a write is never automatically replayed', async t => {
  let calls = 0;
  const apiPort = await listen(t, http.createServer((req, res) => { calls++; req.resume(); req.on('end', () => res.destroy()); }));
  const g = createGateway({publicOrigin: 'https://game.example', apiPort}); t.after(() => g.disconnect()); const port = await listen(t, g.server);
  const r = await request(port, '/api/shoot/jobs', {method: 'POST', bytes: 'fixture'});
  assert.equal(r.status, 503); assert.equal(calls, 1); assert.equal(r.headers['cache-control'], 'no-store');
});

test('immutable build preloads bytes, isolates paths and revalidates actual output after restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-studio-static-')), outside = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-studio-outside-'));
  await fs.mkdir(path.join(root, 'assets')); await fs.writeFile(path.join(root, 'index.html'), 'page '.repeat(100));
  await fs.writeFile(path.join(root, 'assets/app-Hash12345.js'), 'immutable JS');
  await fs.writeFile(path.join(outside, 'private.json'), 'private'); await fs.symlink(path.join(outside, 'private.json'), path.join(root, 'escape.json'));
  const model = path.join(root, 'assets/model-SameHash123.glb'); await fs.writeFile(model, 'old');
  const g = createGateway({publicOrigin: 'https://game.example', webRoot: root}); t.after(() => g.disconnect()); const port = await listen(t, g.server);
  assert.equal((await request(port, '/escape.json')).status, 404); assert.equal((await request(port, '/%xx')).status, 404);
  assert.equal((await request(port, '/assets/app-Hash12345.js')).headers['cache-control'], 'public, max-age=31536000, immutable');
  const first = await request(port, '/assets/model-SameHash123.glb'); assert.equal(first.bytes.toString(), 'old'); assert.equal(first.headers['cache-control'], 'no-cache');
  assert.match(first.headers.etag, /^"[a-f0-9]{64}"$/);
  const cached = await request(port, '/assets/model-SameHash123.glb', {headers: {'if-none-match': 'W/' + first.headers.etag}});
  assert.equal(cached.status, 304); assert.equal(cached.bytes.length, 0);
  await fs.writeFile(model, 'new');
  // A running container serves its preloaded immutable build. The next build
  // can retain Vite's source hash name, but gets a fresh output-byte ETag.
  assert.equal((await request(port, '/assets/model-SameHash123.glb')).bytes.toString(), 'old');
  const next = createGateway({publicOrigin: 'https://game.example', webRoot: root}); t.after(() => next.disconnect());
  await next.ready; const nextPort = await listen(t, next.server);
  const changed = await request(nextPort, '/assets/model-SameHash123.glb', {headers: {'if-none-match': first.headers.etag}});
  assert.equal(changed.status, 200); assert.equal(changed.bytes.toString(), 'new'); assert.notEqual(changed.headers.etag, first.headers.etag);
  const page = await request(port, '/', {headers: {'accept-encoding': 'gzip'}}); assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(gunzipSync(page.bytes).toString(), 'page '.repeat(100));
  const unchanged = await request(port, '/', {headers: {'accept-encoding': 'gzip', 'if-none-match': '"other", ' + page.headers.etag}});
  assert.equal(unchanged.status, 304); assert.equal(unchanged.bytes.length, 0);
  const uncompressed = await request(port, '/', {headers: {'accept-encoding': 'gzip;q=0'}}); assert.equal(uncompressed.headers['content-encoding'], undefined);
  assert.notEqual(uncompressed.headers.etag, page.headers.etag);
  const head = await request(port, '/', {method: 'HEAD', headers: {'accept-encoding': 'gzip'}});
  assert.equal(head.bytes.length, 0); assert.equal(Number(head.headers['content-length']), page.bytes.length); assert.equal(head.headers.etag, page.headers.etag);
});

test('unknown WebSocket path cannot reach frps', async t => {
  const g = createGateway({publicOrigin: 'https://game.example'}); t.after(() => g.disconnect()); const port = await listen(t, g.server);
  const r = await request(port, '/other', {headers: {connection: 'Upgrade', upgrade: 'websocket'}}); assert.equal(r.status, 404);
});
