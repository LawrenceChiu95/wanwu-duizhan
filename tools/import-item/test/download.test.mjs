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
for (const [interrupt, responseDelay] of [[false, 0], [true, 0], [true, 100]]) test(`native fetch asset redirect/stream ${interrupt ? `interruption resumes the same task (response delayed ${responseDelay}ms)` : 'is saved before parsing'}`, {timeout: 15000}, async t => {
  const body = Buffer.from('complete paid result, even if not supported by the importer');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwu-download-'));
  let stopped = false;
  let interruption;
  const observed = [];
  const diagnostic = {started: Date.now(), responseDelay, interrupt, byteSamples: [], events: []};
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/global/')) {
      assert.equal(req.headers.authorization, 'fake-key');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({c: 0, d: {status: 3, outputs: [{format: 'glb', content: 'https://storage.example/result.glb'}]}}));
    } else {
      assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['ous-token-v2'], undefined);
      if (req.url === '/result.glb') { res.writeHead(302, {location: '/ready.glb'}); res.end(); }
      else if (interrupt && !stopped) {
        diagnostic.events.push({event: 'server-first-chunk', at: Date.now()});
        stopped = true; res.writeHead(200, {'content-length': body.length}); res.flushHeaders(); res.write(body.subarray(0, 8));
        // Server writes do not prove the client has consumed and saved a chunk.
        // Interrupt only after the exact partial bytes exist, even when fetch delivery is delayed.
        interruption = (async () => {
          try {
            const deadline = Date.now() + 5000;
            for (;;) {
              const size = await fs.stat(path.join(folder, 'model.glb.part')).then(s => s.size, error => {
                if (error.code === 'ENOENT') return 0;
                throw error;
              });
              if (diagnostic.byteSamples.at(-1)?.size !== size) diagnostic.byteSamples.push({size, at: Date.now()});
              if (size === 8) break;
              assert.ok(Date.now() < deadline, `fixture did not observe 8 saved bytes (saw ${size})`);
              await new Promise(resolve => setTimeout(resolve, 5));
            }
          } finally { diagnostic.events.push({event: 'server-destroy', at: Date.now()}); res.destroy(); }
        })().then(() => null, error => { diagnostic.interruptionError = error.stack; return error; });
      } else { res.writeHead(200, {'content-length': body.length}); res.write(body.subarray(0, 8)); res.end(body.subarray(8)); }
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const state = {tasks: {'multimodal-to-image': 'already-paid-image', 'img-to-3d': 'already-paid-model'}, styledSha256: 'existing-clean-picture', timestamps: timestamps()};
  const request = async (url, options) => {
    const u = new URL(url); observed.push({url, options});
    diagnostic.events.push({event: 'request', path: u.pathname, at: Date.now()});
    assert.ok(!u.pathname.endsWith('/create'), 'resuming a download must never create tasks');
    const response = await fetch(`http://127.0.0.1:${server.address().port}${u.pathname}${u.search}`, options);
    if (u.pathname === '/ready.glb' && responseDelay) await new Promise(resolve => setTimeout(resolve, responseDelay));
    diagnostic.events.push({event: 'response-delivered', path: u.pathname, status: response.status, at: Date.now()});
    return response;
  };
  const run = () => photoToGlb({photo: Buffer.alloc(0), key: 'fake-key', prompt: 'unused', folder, state, save: async () => {}, fetch: request, pause: async () => {}});
  const record = async stage => {
    diagnostic.stage = stage; diagnostic.finished = Date.now();
    diagnostic.timestamps = {...state.timestamps};
    diagnostic.partialBytes = await fs.stat(path.join(folder, 'model.glb.part')).then(s => s.size, error => ({error: error.code}));
    diagnostic.savedBytes = await fs.stat(path.join(folder, 'model.glb')).then(s => s.size, error => ({error: error.code}));
    // Emit before server cleanup, even when an earlier assertion failed. A diagnostic write must not mask that failure.
    t.diagnostic(JSON.stringify({folder, ...diagnostic}));
    await fs.writeFile(path.join(folder, 'diagnostics.json'), JSON.stringify(diagnostic, null, 2) + '\n').catch(error => t.diagnostic(`diagnostics write failed: ${error.code}`));
  };
  try {
  if (interrupt) {
    await assert.rejects(run().finally(() => record('interrupted-run')), /download interrupted/);
    assert.equal(await interruption, null);
    assert.deepEqual(await fs.readFile(path.join(folder, 'model.glb.part')), body.subarray(0, 8));
    assert.equal(state.timestamps.download_finished, null);
  }
  const file = await run(); await record('resumed');
  assert.deepEqual(await fs.readFile(file), body); assert.equal(state.downloadSha256, sha256(body)); assert.ok(state.timestamps.download_finished);
  for (const call of observed.filter(x => new URL(x.url).origin === 'https://storage.example')) {
    assert.deepEqual(call.options.headers, {}); assert.equal(call.options.redirect, 'manual'); assert.equal(call.options.credentials, 'omit');
  }
  } finally { await record('final'); }
});
