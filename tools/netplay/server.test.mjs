import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import {readFileSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import test from 'node:test';
import {WebSocket} from 'ws';
import {digest} from './items.mjs';
import {createNetplayServer} from './server.mjs';

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

async function fixture(t, {shoot = false, webRoot} = {}) {
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
  const app = createNetplayServer({origin, upstream, webRoot, tickMs: 5, now: () => time, storeTrace: async trace => { traces.push(trace); }});
  const url = await listen(app.server);
  t.after(() => app.close());
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

test('two seats negotiate versions, handshakes, countdown, relay, result and rematch', async t => {
  const f = await fixture(t), {a, b, aSession, bSession, state, matchId} = await pair(f.url);
  const c = await client(f.url);
  assert.equal(aSession.seat, 0);
  assert.equal(bSession.seat, 1);
  assert.notEqual(aSession.token, bSession.token);
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
  b.send('rematch', {matchId});
  const next = await a.next('state', frame => frame.phase === 'loadout' && frame.matchId !== matchId);
  assert.equal(next.prepare, null);
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
  a.send('ping', {n: 1});
  await a.next('pong');
  assert.deepEqual(f.traces.map(trace => trace.seat).sort(), [0, 1]);
  assert.equal(f.traces.every(trace => trace.matchId === matchId && trace.step === 25), true);
});

test('leaving revokes the seat while a survivor keeps the same result', async t => {
  const f = await fixture(t), {a, b, bSession, matchId} = await pair(f.url);
  await getPlaying(f, {a, b, matchId});
  b.send('leave');
  const result = await a.state('finished');
  assert.equal(result.reason, 'disconnect');
  assert.equal(result.winner, 0);
  const fresh = await client(f.url);
  fresh.send('resume', {code: bSession.code, token: bSession.token});
  assert.equal((await fresh.next('error')).code, 'session');
});

test('the built font is served with its original MIME type', async t => {
  const webRoot = await mkdtemp(join(tmpdir(), 'netplay-web-'));
  const file = join(webRoot, 'smiley-sans.woff');
  await writeFile(file, 'wOFF fixture');
  const f = await fixture(t, {webRoot});
  const font = await fetch(f.url + '/smiley-sans.woff');
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff');
  assert.equal(await font.text(), 'wOFF fixture');
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
