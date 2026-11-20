import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import {readFileSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {WebSocket} from 'ws';
import {digest} from './items.mjs';
import {createNetplayServer} from './server.mjs';
import {createGateway} from '../studio/gateway.mjs';

const origin = 'https://netplay.example';
const version = 'build-a';
const checkHash = '9'.repeat(64);
const ownerToken = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.' + 'a'.repeat(64);
const otherToken = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.' + 'b'.repeat(64);
const photoId = 'shoot_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherId = 'shoot_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const shootPhoto = JSON.parse(readFileSync(new URL('../../data/showcase/thermos/item.json', import.meta.url), 'utf8'));
const modelPath = '/api/shoot/files/' + photoId + '/model.glb';
const part = (item, mount = 'e0') => ({item, mount, orient: 'hug'});
const pot = part('fanshuo-pot');
const plate = part('fanshuo-plate');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}

async function fixture(t, {shoot = false, webRoot, beforeTrace, studio = false} = {}) {
  const requests = [], traces = [];
  let time = 1000;
  let upstream;
  if (shoot) {
    const mock = http.createServer(async (req, res) => {
      const session = req.headers['x-shoot-session'];
      requests.push({method: req.method, path: req.url, hasOwner: session === ownerToken, origin: req.headers.origin});
      if (req.url === '/api/shoot/session' && req.method === 'POST') {
        for await (const chunk of req) assert.equal(chunk.length, 0);
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({token: ownerToken}));
      }
      if (req.url === '/api/shoot/items' && [ownerToken, otherToken].includes(session)) {
        const item = {...shootPhoto, id: photoId, glb: modelPath, source: {private: 'never shared'}};
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({items: session === ownerToken ? [item] : []}));
      }
      if (req.url === modelPath && session === ownerToken) {
        res.setHeader('content-type', 'model/gltf-binary');
        return res.end('glTFfixture');
      }
      res.writeHead(404).end();
    });
    upstream = await listen(mock);
    t.after(() => new Promise(resolve => mock.close(resolve)));
  }
  const roomRequests = studio ? new EventEmitter() : null;
  const gateway = roomRequests && createGateway({publicOrigin: origin, apiPort: Number(new URL(upstream).port), rooms: roomRequests});
  const gatewayUrl = gateway && await listen(gateway.server);
  const app = createNetplayServer({origin, upstream: gatewayUrl || upstream, webRoot, tickMs: 5, now: () => time, storeTrace: async trace => {
    if (beforeTrace) await beforeTrace(trace);
    traces.push(trace);
  }});
  for (const event of ['request', 'upgrade']) roomRequests?.on(event, (...args) => app.server.emit(event, ...args));
  const url = gatewayUrl || await listen(app.server);
  t.after(() => app.close());
  if (gateway) t.after(() => new Promise(resolve => {
    gateway.disconnect();
    gateway.server.close(resolve);
    gateway.server.closeAllConnections();
  }));
  return {url, requests, traces, ahead: ms => { time += ms; }};
}

async function client(url, from = origin) {
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/api/netplay/ws', {origin: from});
  const events = new EventEmitter(), frames = [];
  ws.on('message', blob => {
    frames.push(JSON.parse(blob));
    events.emit('frame');
  });
  await once(ws, 'open');
  return {
    ws, frames,
    send(t, fields = {}) { ws.send(JSON.stringify({t, ...fields})); },
    async next(t, where = () => true) {
      const until = AbortSignal.timeout(2000);
      for (;;) {
        const index = frames.findIndex(frame => frame.t === t && where(frame));
        if (index >= 0) return frames.splice(index, 1)[0];
        await once(events, 'frame', {signal: until});
      }
    },
    state(phase) { return this.next('state', frame => frame.phase === phase); }
  };
}

async function pair(url) {
  const a = await client(url), b = await client(url);
  a.send('create', {version});
  const aSession = await a.next('session');
  await a.state('waiting');
  b.send('join', {code: aSession.code.toLowerCase(), version});
  const bSession = await b.next('session');
  const state = await a.state('loadout');
  assert.deepEqual(state, await b.state('loadout'));
  return {a, b, aSession, bSession, state, matchId: state.matchId};
}

async function getPlaying(f, {a, b, matchId}) {
  a.send('ready', {matchId, parts: [pot]});
  b.send('ready', {matchId, parts: [plate]});
  const prepare = await a.state('preparing');
  assert.deepEqual(prepare, await b.state('preparing'));
  a.send('assetsReady', {matchId, hash: checkHash});
  assert.equal((await a.next('error')).code, 'assets');
  a.send('assetsReady', {matchId, hash: prepare.prepare.hash});
  b.send('assetsReady', {matchId, hash: prepare.prepare.hash});
  const count = await a.state('countdown');
  assert.equal(count.startAt, 2000);
  assert.deepEqual(count, await b.state('countdown'));
  f.ahead(2500);
  assert.deepEqual(await a.state('playing'), await b.state('playing'));
}

test('health counts room seats with open connections, including while in the background', async t => {
  const {url} = await fixture(t);
  const health = async (rooms, connectedPlayers) => {
    const res = await fetch(url + '/api/netplay/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), {status: 'ok', rooms, connectedPlayers});
  };
  await client(url); // An unseated socket is not a player.
  await health(0, 0);

  const a = await client(url);
  a.send('create', {version});
  const {code} = await a.next('session');
  await a.state('waiting');
  await health(1, 1);

  const b = await client(url);
  b.send('join', {code, version});
  await a.state('loadout');
  await health(1, 2);
  b.send('presence', {active: false});
  await a.next('state', frame => !frame.seats[1].connected);
  await health(1, 2);

  b.send('leave');
  await a.state('finished');
  await health(1, 1);
  const closed = once(a.ws, 'close');
  a.send('leave');
  await closed;
  await health(0, 0);
});

test('two seats negotiate versions, handshakes, countdown, relay, result and rematch', async t => {
  const f = await fixture(t), {a, b, aSession, bSession, state, matchId} = await pair(f.url);
  const c = await client(f.url);
  assert.equal(aSession.seat, 0);
  assert.equal(bSession.seat, 1);
  assert.notEqual(aSession.token, bSession.token);
  assert.equal(state.round, 1);
  assert.equal(JSON.stringify(state).includes(aSession.token), false);
  c.send('join', {code: aSession.code, version: 'old'});
  assert.equal((await c.next('error')).code, 'version');
  c.send('join', {code: aSession.code, version});
  assert.equal((await c.next('error')).code, 'full');
  a.send('ping', {n: 4});
  assert.deepEqual(await a.next('pong'), {t: 'pong', n: 4, s: 1000});
  a.send('signal', {d: {ice: 'test'}});
  assert.deepEqual(await b.next('signal'), {t: 'signal', from: 0, d: {ice: 'test'}});
  await getPlaying(f, {a, b, matchId});
  b.send('relay', {matchId, d: {step: 123, action: 'block'}});
  assert.deepEqual(await a.next('relay'), {t: 'relay', from: 1, matchId, d: {step: 123, action: 'block'}});
  a.send('result', {matchId, winner: 0, hash: 2931433});
  b.send('result', {matchId, winner: 0, hash: 2931433});
  const result = await a.state('finished');
  assert.equal(result.winner, 0);
  assert.equal(result.reason, 'complete');
  assert.deepEqual(result, await b.state('finished'));
  a.send('rematch', {matchId});
  const oneVote = await a.next('state', frame => frame.phase === 'finished' && frame.seats[0].rematchReady);
  assert.equal(oneVote.round, 1);
  assert.deepEqual(oneVote, await b.next('state', frame => frame.phase === 'finished' && frame.seats[0].rematchReady));
  b.send('rematch', {matchId});
  const next = await a.next('state', frame => frame.phase === 'loadout' && frame.matchId !== matchId);
  assert.equal(next.prepare, null);
  assert.equal(next.round, 2);
  assert.deepEqual(next, await b.next('state', frame => frame.matchId === next.matchId));
  b.send('relay', {matchId, d: {step: 124}});
  assert.equal((await b.next('error')).code, 'match');
});

test('background and reconnect pause both seats; expired reconnect sees the same result', async t => {
  const f = await fixture(t), {a, b, bSession, matchId} = await pair(f.url);
  await getPlaying(f, {a, b, matchId});
  b.send('presence', {active: false});
  const paused = await a.state('paused');
  assert.equal(paused.pausedSeat, 1);
  assert.equal(paused.deadline, 18500);
  b.send('presence', {active: true});
  assert.equal((await a.state('playing')).resumeAt, 4500);
  b.ws.terminate();
  await a.state('paused');
  const fresh = await client(f.url);
  fresh.send('resume', {code: bSession.code, token: bSession.token});
  assert.deepEqual(await fresh.next('session'), bSession);
  assert.equal((await a.state('playing')).resumeAt, 4500);
  fresh.ws.terminate();
  await a.state('paused');
  f.ahead(15_001);
  const result = await a.state('finished');
  assert.equal(result.reason, 'disconnect');
  assert.equal(result.winner, 0);
  const late = await client(f.url);
  late.send('resume', {code: bSession.code, token: bSession.token});
  await late.next('session');
  const seen = await late.state('finished');
  assert.equal(seen.reason, result.reason);
  assert.equal(seen.winner, result.winner);
  assert.equal(seen.round, 1);

  a.send('rematch', {matchId});
  late.send('rematch', {matchId});
  const rematch = await late.state('loadout');
  assert.equal(rematch.round, 2);
  assert.equal((await a.next('state', frame => frame.matchId === rematch.matchId)).round, 2);
  const reloaded = await client(f.url);
  reloaded.send('resume', {code: bSession.code, token: bSession.token});
  await reloaded.next('session');
  assert.equal((await reloaded.state('loadout')).round, 2);
});

test('readiness, loaded assets and final results can be retried through reconnect', async t => {
  const f = await fixture(t), {a, b, bSession, matchId} = await pair(f.url);
  a.send('ready', {matchId, parts: [pot]});
  await a.next('state', state => state.seats[0].ready);
  b.ws.terminate();
  await a.next('state', state => !state.seats[1].connected);

  const fresh = await client(f.url);
  fresh.send('resume', {code: bSession.code, token: bSession.token, version});
  await fresh.next('session');
  const restored = await fresh.state('loadout');
  assert.deepEqual(restored.seats.map(seat => seat.ready), [true, false]);
  await a.next('state', state => state.seats[1].connected);
  a.send('ready', {matchId, parts: [plate]});
  await a.next('state', state => state.seats[0].ready);
  fresh.send('ready', {matchId, parts: [plate]});
  const prep = await fresh.state('preparing');
  assert.deepEqual(prep.prepare.loadouts.map(x => x.parts), [[pot], [plate]]);
  const hash = prep.prepare.hash;
  a.send('assetsReady', {matchId, hash});
  await a.next('state', state => state.seats[0].assetsReady);
  fresh.send('assetsReady', {matchId, hash});
  await fresh.state('countdown');
  await a.state('countdown');
  a.send('assetsReady', {matchId, hash});
  await a.next('state', state => state.phase === 'countdown' && state.seats.every(x => x.assetsReady));
  f.ahead(2500);
  await fresh.state('playing');

  fresh.ws.terminate();
  await a.state('paused');
  const finalReport = {matchId, winner: 0, hash: 9271};
  a.send('result', finalReport);
  await a.next('state', state => state.seats[0].resultReady);
  a.send('result', finalReport);
  await a.next('state', state => state.seats[0].resultReady);
  const returned = await client(f.url);
  returned.send('resume', {code: bSession.code, token: bSession.token, version});
  await returned.next('session');
  assert.deepEqual((await returned.state('playing')).seats.map(seat => seat.resultReady), [true, false]);
  returned.send('result', finalReport);
  assert.equal((await returned.state('finished')).reason, 'complete');

  returned.ws.terminate();
  await a.next('state', state => state.phase === 'finished' && !state.seats[1].connected);
  a.send('rematch', {matchId});
  await a.next('state', state => state.seats[0].rematchReady);
  const next = await client(f.url);
  next.send('resume', {code: bSession.code, token: bSession.token, version});
  await next.next('session');
  await next.state('finished');
  next.send('rematch', {matchId});
  const rematch = await next.state('loadout');
  assert.notEqual(rematch.matchId, matchId);
  assert.ok(rematch.seats.every(seat => !seat.ready && !seat.assetsReady && !seat.resultReady && !seat.rematchReady));
});

test('a reloaded seat keeps the match paused until it restores its state', async t => {
  const f = await fixture(t), {a, b, aSession, bSession, matchId} = await pair(f.url);
  await getPlaying(f, {a, b, matchId});
  for (const [seat, session] of [[0, aSession], [1, bSession]]) {
    const replacement = await client(f.url);
    replacement.send('resume', {code: session.code, token: session.token, version: 'old', active: false});
    assert.equal((await replacement.next('error')).code, 'version');
    replacement.send('resume', {code: session.code, token: session.token, version, active: false});
    assert.deepEqual(await replacement.next('session'), session);
    const paused = await replacement.state('paused');
    assert.equal(paused.matchId, matchId);
    assert.equal(paused.pausedSeat, seat);
    assert.equal(paused.seats[seat].connected, false);
    replacement.send('presence', {active: true});
    const resumed = await replacement.state('playing');
    assert.equal(resumed.matchId, matchId);
    assert.ok(resumed.seats.every(x => x.connected));
  }
});

test('source photograph is kept private and only the two seats can read the selected model', async t => {
  const f = await fixture(t, {shoot: true}), {a, b, aSession, bSession, matchId} = await pair(f.url);
  b.send('ready', {matchId, parts: [part(photoId)], shootSession: otherToken});
  assert.equal((await b.next('error')).code, 'item');
  a.send('ready', {matchId, parts: [part(otherId)], shootSession: ownerToken});
  assert.equal((await a.next('error')).code, 'item');
  a.send('ready', {matchId, parts: [part(photoId)], shootSession: ownerToken});
  b.send('ready', {matchId, parts: [plate]});
  const {prepare} = await b.state('preparing');
  const shared = prepare.loadouts[0].items[0];
  assert.equal(shared.hash, digest(shared.item));
  assert.equal(shared.item.id, photoId);
  for (const key of ['origin', 'glb', 'source', 'normalization', 'currentRating']) assert.equal(Object.hasOwn(shared.item, key), false);
  assert.equal(JSON.stringify(prepare).includes(ownerToken), false);
  assert.equal(await (await fetch(f.url + shared.model, {headers: {'X-Netplay-Seat': bSession.token}})).text(), 'glTFfixture');
  assert.equal((await fetch(f.url + shared.model)).status, 404);
  assert.equal((await fetch(f.url + shared.model, {headers: {'X-Netplay-Seat': otherToken}})).status, 404);
  assert.equal((await fetch(f.url + shared.model.replace(photoId, otherId), {headers: {'X-Netplay-Seat': aSession.token}})).status, 404);
  assert.equal((await fetch(f.url + shared.model.replace(photoId, photoId + '/photo.jpg'), {headers: {'X-Netplay-Seat': aSession.token}})).status, 404);
  assert.equal((await fetch(f.url + modelPath, {headers: {'x-shoot-session': otherToken}})).status, 404);
  assert.equal((await fetch(f.url + '/api/shoot/jobs', {method: 'POST', headers: {origin: 'https://unrelated.example'}})).status, 403);
  const reply = await fetch(f.url + '/api/shoot/session', {method: 'POST', headers: {origin}});
  assert.equal((await reply.json()).token, ownerToken);
  assert.equal(f.requests.every(req => req.origin === undefined), true);
  assert.equal(f.requests.filter(req => req.method === 'POST').length, 1);
  assert.equal(f.requests.filter(req => req.hasOwner && req.path === modelPath).length, 1);
});

test('judge gateway serves rooms and original shooting routes on the same listener', async t => {
  const f = await fixture(t, {shoot: true, studio: true});
  const {a, b, bSession, matchId} = await pair(f.url);
  assert.equal((await (await fetch(f.url + '/api/netplay/health')).json()).connectedPlayers, 2);
  assert.equal((await fetch(f.url + '/api/netplay/health', {headers: {origin: 'https://elsewhere.example'}})).status, 403);
  const session = await fetch(f.url + '/api/shoot/session', {method: 'POST', headers: {origin}});
  assert.equal((await session.json()).token, ownerToken);
  assert.equal(f.requests.find(req => req.method === 'POST').origin, origin);
  a.send('ready', {matchId, parts: [part(photoId)], shootSession: ownerToken});
  b.send('ready', {matchId, parts: [plate]});
  const {prepare} = await b.state('preparing');
  const {model} = prepare.loadouts[0].items[0];
  assert.equal((await fetch(f.url + model)).status, 404);
  const file = await fetch(f.url + model, {headers: {'X-Netplay-Seat': bSession.token}});
  assert.equal(await file.text(), 'glTFfixture');
});

test('desync preserves one trace per seat and unrelated origins cannot connect', async t => {
  const f = await fixture(t), {a, b, matchId} = await pair(f.url);
  await assert.rejects(client(f.url, 'https://unrelated.example'), /403/);
  await getPlaying(f, {a, b, matchId});
  a.send('result', {matchId, winner: 1, hash: checkHash});
  b.send('result', {matchId, winner: 0, hash: checkHash});
  const result = await a.state('finished');
  assert.equal(result.winner, null);
  assert.equal(result.reason, 'desync');
  a.send('desync', {matchId, step: 25, log: {input: [3], checks: {25: checkHash}}});
  b.send('desync', {matchId, step: 25, log: {input: [4], checks: {25: '3'.repeat(64)}}});
  a.send('desync', {matchId, step: 26, log: {input: [5]}});
  await a.next('state', state => state.seats[0].traceReady);
  await b.next('state', state => state.seats[1].traceReady);
  assert.deepEqual(f.traces.map(trace => trace.seat).sort(), [0, 1]);
  assert.equal(f.traces.every(trace => trace.matchId === matchId && trace.step === 25), true);
});

test('trace acknowledgement survives resume and only follows a successful write', async t => {
  const write = Promise.withResolvers();
  let attempts = 0;
  const f = await fixture(t, {beforeTrace: () => ++attempts === 1 ? write.promise : undefined});
  const {a, b, aSession, matchId} = await pair(f.url);
  await getPlaying(f, {a, b, matchId});
  const report = {matchId, step: 25, log: {input: [3]}};
  a.send('desync', report);
  const finished = await a.state('finished');
  assert.equal(finished.reason, 'desync');
  assert.equal(finished.seats[0].traceReady, false);
  a.ws.terminate();
  const resumed = await client(f.url);
  resumed.send('resume', {code: aSession.code, token: aSession.token, version});
  await resumed.next('session');
  assert.equal((await resumed.state('finished')).seats[0].traceReady, false);

  resumed.send('desync', report);
  resumed.send('ping', {n: 1});
  await resumed.next('pong');
  assert.equal(attempts, 1);
  write.reject(new Error('simulated disk failure'));
  assert.equal((await resumed.next('error')).code, 'trace-store');
  resumed.send('desync', report);
  await resumed.next('state', state => state.seats[0].traceReady);
  resumed.send('desync', report);
  await resumed.next('state', state => state.seats[0].traceReady);
  assert.equal(attempts, 2);
  assert.equal(f.traces.length, 1);
});

test('leaving revokes the seat while a survivor keeps the same result', async t => {
  const f = await fixture(t), {a, b, bSession, matchId} = await pair(f.url);
  await getPlaying(f, {a, b, matchId});
  b.send('leave');
  const result = await a.state('finished');
  assert.equal(result.reason, 'disconnect');
  assert.equal(result.winner, 0);
  assert.equal(result.seats[1].left, true);
  const fresh = await client(f.url);
  fresh.send('resume', {code: bSession.code, token: bSession.token});
  assert.equal((await fresh.next('error')).code, 'session');
});

test('a result survives an opponent leaving while the other seat is temporarily offline', async t => {
  const f = await fixture(t), {a, b, aSession, matchId} = await pair(f.url);
  await getPlaying(f, {a, b, matchId});
  const outcome = {matchId, winner: 0, hash: checkHash};
  a.send('result', outcome);
  b.send('result', outcome);
  await a.state('finished');
  await b.state('finished');

  a.ws.terminate();
  const offline = await b.next('state', state => state.phase === 'finished' && !state.seats[0].connected);
  assert.equal(offline.seats[0].left, false);
  const closed = once(b.ws, 'close');
  b.send('leave');
  await closed;

  const resumed = await client(f.url);
  resumed.send('resume', {code: aSession.code, token: aSession.token});
  await resumed.next('session');
  const finished = await resumed.state('finished');
  assert.equal(finished.winner, outcome.winner);
  assert.equal(finished.reason, 'complete');
  assert.equal(finished.seats[1].left, true);
});

test('the bundled font, scene, music and license are served with their MIME types', async t => {
  const webRoot = await mkdtemp(join(tmpdir(), 'netplay-web-'));
  const f = await fixture(t, {webRoot});
  const types = {
    'smiley-sans.woff': 'font/woff',
    'bgm.mp3': 'audio/mpeg',
    'scene.spz': 'application/octet-stream',
    'LICENSES.txt': 'text/plain; charset=utf-8'
  };
  for (const [name, type] of Object.entries(types)) {
    await writeFile(join(webRoot, name), name);
    const response = await fetch(f.url + '/' + name);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('content-type'), type);
    assert.equal(await response.text(), name);
  }
});

test('precompressed assets keep their media types and negotiate gzip or identity', async t => {
  const webRoot = await mkdtemp(join(tmpdir(), 'netplay-gzip-'));
  const f = await fixture(t, {webRoot});
  const source = Buffer.from('netplay asset\n'.repeat(256)), compressed = gzipSync(source);
  for (const [name, type] of Object.entries({
    'engine.wasm': 'application/wasm', 'game.js': 'text/javascript; charset=utf-8', 'item.glb': 'model/gltf-binary'
  })) {
    await writeFile(join(webRoot, name), source);
    await writeFile(join(webRoot, name + '.gz'), compressed);
    const url = f.url + '/' + name;
    for (const [accept, gzip] of [['br, GZip; q=0.5', true], ['*', true], ['gzip;q=0, *;q=1', false], ['identity', false]]) {
      const headers = {'accept-encoding': accept};
      const response = await fetch(url, {headers});
      assert.equal(response.status, 200, name);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(response.headers.get('vary'), 'Accept-Encoding');
      assert.equal(response.headers.get('content-encoding'), gzip ? 'gzip' : null);
      assert.equal(Number(response.headers.get('content-length')), gzip ? compressed.length : source.length);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
      const head = await fetch(url, {method: 'HEAD', headers});
      assert.deepEqual(head.headers.get('content-encoding'), response.headers.get('content-encoding'));
      assert.deepEqual(head.headers.get('content-length'), response.headers.get('content-length'));
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    assert.equal((await fetch(url + '.gz')).status, 404);
  }
  await writeFile(join(webRoot, 'plain.js'), source);
  const plain = await fetch(f.url + '/plain.js', {headers: {'accept-encoding': 'gzip'}});
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.deepEqual(Buffer.from(await plain.arrayBuffer()), source);
  const unavailable = await fetch(f.url + '/plain.js', {headers: {'accept-encoding': 'gzip, identity;q=0'}});
  assert.equal(unavailable.status, 406);
});

test('a friend can use the invitation while the host shares it outside the browser', async t => {
  const f = await fixture(t), host = await client(f.url);
  host.send('create', {version});
  const session = await host.next('session');
  await host.state('waiting');
  const closed = once(host.ws, 'close');
  host.ws.terminate();
  await closed;
  f.ahead(60_000);
  const guest = await client(f.url);
  guest.send('join', {code: session.code, version});
  await guest.next('session');
  const joined = await guest.state('loadout');
  assert.equal(joined.seats[0].connected, false);
  assert.equal(joined.seats[1].connected, true);
  f.ahead(60_000);
  const resumed = await client(f.url);
  resumed.send('resume', {code: session.code, token: session.token});
  assert.deepEqual(await resumed.next('session'), session);
  const room = await resumed.state('loadout');
  assert.equal(room.matchId, joined.matchId);
  assert.equal(room.seats[0].connected, true);
});

test('an abandoned invitation expires after ten minutes', async t => {
  const f = await fixture(t), host = await client(f.url);
  host.send('create', {version});
  const session = await host.next('session');
  await host.state('waiting');
  f.ahead(600_001);
  const guest = await client(f.url);
  guest.send('join', {code: session.code, version});
  assert.equal((await guest.next('error')).code, 'room');
});
