import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {photoToGlb} from '../aholo.mjs';
import {timestamps} from '../state.mjs';
import {sha256} from '../mesh.mjs';

// A local HTTP fixture bridges the injected HTTPS names so native fetch streams,
// redirects and truncated bodies are exercised without real Aholo or TLS keys.
for (const interrupt of [false, true]) test(`native fetch asset redirect/stream ${interrupt ? 'interruption resumes the same task' : 'is saved before parsing'}`, async t => {
  const body = Buffer.from('complete paid result, even if not supported by the importer');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-download-'));
  let stopped = false;
  const observed = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/global/')) {
      assert.equal(req.headers.authorization, 'fake-key');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({c: 0, d: {status: 3, outputs: [{format: 'glb', content: 'https://storage.example/result.glb'}]}}));
    } else {
      assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['ous-token-v2'], undefined);
      if (req.url === '/result.glb') { res.writeHead(302, {location: '/ready.glb'}); res.end(); }
      else if (interrupt && !stopped) {
        stopped = true; res.writeHead(200, {'content-length': body.length}); res.flushHeaders(); res.write(body.subarray(0, 8));
        setTimeout(() => res.destroy(), 30);
      } else { res.writeHead(200, {'content-length': body.length}); res.write(body.subarray(0, 8)); res.end(body.subarray(8)); }
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const state = {tasks: {'multimodal-to-image': 'already-paid-image', 'img-to-3d': 'already-paid-model'}, styledSha256: 'existing-clean-picture', timestamps: timestamps()};
  const request = (url, options) => {
    const u = new URL(url); observed.push({url, options});
    assert.ok(!u.pathname.endsWith('/create'), 'resuming a download must never create tasks');
    return fetch(`http://127.0.0.1:${server.address().port}${u.pathname}${u.search}`, options);
  };
  const run = () => photoToGlb({photo: Buffer.alloc(0), key: 'fake-key', prompt: 'unused', folder, state, save: async () => {}, fetch: request, pause: async () => {}});
  if (interrupt) {
    await assert.rejects(run(), /download interrupted/);
    assert.deepEqual(await fs.readFile(path.join(folder, 'model.glb.part')), body.subarray(0, 8));
    assert.equal(state.timestamps.download_finished, null);
  }
  const file = await run();
  assert.deepEqual(await fs.readFile(file), body); assert.equal(state.downloadSha256, sha256(body)); assert.ok(state.timestamps.download_finished);
  for (const call of observed.filter(x => new URL(x.url).origin === 'https://storage.example')) {
    assert.deepEqual(call.options.headers, {}); assert.equal(call.options.redirect, 'manual'); assert.equal(call.options.credentials, 'omit');
  }
});
