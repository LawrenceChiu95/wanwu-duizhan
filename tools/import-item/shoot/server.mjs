import http from 'node:http';
import {parseArgs} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openJobs, apiError, MAX_PHOTO, REPO} from './jobs.mjs';

const TYPES = {'.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2'};
async function body(req, limit, code = 'bad-request') {
  const chunks = []; let size = 0;
  // Leave the request alive on rejection so the client receives the JSON error.
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    // Keep draining after the limit without retaining more bytes. Throwing from
    // inside this iterator would pause it again after an attempted resume().
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw apiError(code, 'Request too large', 413);
  return Buffer.concat(chunks);
}
function fields(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !allowed.includes(k))) throw apiError('bad-request', 'Unexpected request fields');
  return value;
}
async function jsonBody(req, allowed) {
  let parsed;
  try { parsed = JSON.parse((await body(req, 8192)).toString('utf8')); }
  catch (error) { if (error.status) throw error; throw apiError('bad-request', 'Invalid JSON'); }
  return fields(parsed, allowed);
}
export async function startShootServer({port = 4408, directory, repo = REPO, webRoot = path.join(repo, 'web/dist'), frontendOrigin = null, ...options} = {}) {
  if (frontendOrigin !== null) { const u = new URL(frontendOrigin); if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.origin !== frontendOrigin) throw Error('frontendOrigin must be an exact local HTTP origin'); }
  const jobs = await openJobs({directory, repo, ...options});
  const server = http.createServer(async (req, res) => {
    const json = (code, value) => { res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(value)); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin && req.headers.origin !== frontendOrigin)) throw apiError('forbidden', 'Local same-origin requests only', 403);
      const url = new URL(req.url, origin), route = url.pathname;
      if (route.startsWith('/api/') && url.search) throw apiError('bad-request', 'Unexpected query parameters');
      if (req.method === 'GET' && route === '/api/shoot/quota') return json(200, await jobs.quota());
      if (req.method === 'GET' && route === '/api/shoot/items') return json(200, {items: await jobs.items()});
      if (req.method === 'POST' && route === '/api/shoot/jobs') {
        let input;
        const type = req.headers['content-type'] ?? '';
        if (type.startsWith('multipart/form-data;')) {
          const bytes = await body(req, MAX_PHOTO + 65536, 'photo-invalid');
          let data;
          try { data = await new Request(origin, {method: 'POST', headers: {'content-type': type}, body: bytes}).formData(); }
          catch { throw apiError('photo-invalid', 'Malformed photo form'); }
          if ([...data.keys()].some(k => !['photo', 'clientKey'].includes(k)) || data.getAll('photo').length !== 1 || data.getAll('clientKey').length !== 1) throw apiError('photo-invalid', 'Expected one photo and one key');
          const file = data.get('photo');
          if (!(file instanceof File) || file.size > MAX_PHOTO) throw apiError('photo-invalid', 'Expected photo <=32 MiB');
          input = {clientKey: data.get('clientKey'), photo: Buffer.from(await file.arrayBuffer())};
        } else if (type.startsWith('application/json')) input = await jsonBody(req, ['clientKey', 'fromJob']);
        else throw apiError('bad-request', 'Expected multipart or JSON', 415);
        return json(202, {job: await jobs.create(input)});
      }
      const jobRoute = route.match(/^\/api\/shoot\/jobs\/(j_[a-f0-9-]{36})(?:\/(retry|regenerate))?$/);
      if (jobRoute) {
        const [, id, action] = jobRoute;
        if (req.method === 'GET' && !action) return json(200, {job: await jobs.get(id)});
        if (req.method === 'POST' && action === 'retry') { await body(req, 0); return json(200, {job: await jobs.retry(id)}); }
        if (req.method === 'POST' && action === 'regenerate') return json(202, {job: await jobs.create({...await jsonBody(req, ['confirm', 'clientKey']), regenerateOf: id})});
      }
      const fileRoute = route.match(/^\/api\/shoot\/files\/(shoot_[a-f0-9-]{36})\/(model\.glb|photo\.jpg|styled\.jpg)$/);
      if (req.method === 'GET' && fileRoute) {
        const file = await jobs.file(fileRoute[1], fileRoute[2]);
        res.writeHead(200, {'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); return res.end(await fs.readFile(file));
      }
      if (route.startsWith('/api/')) throw apiError('not-found', 'Unknown API route', 404);
      if (req.method !== 'GET') throw apiError('not-found', 'Unknown route', 404);
      // Serve a prebuilt game on the same origin; never expose source/state paths.
      let name;
      try { name = decodeURIComponent(route); } catch { throw apiError('bad-request', 'Invalid URL encoding'); }
      const root = await fs.realpath(webRoot), candidate = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!candidate.startsWith(root + path.sep)) throw apiError('not-found', 'No such file', 404);
      const file = await fs.realpath(candidate);
      if (!file.startsWith(root + path.sep) || !Object.hasOwn(TYPES, path.extname(file))) throw apiError('not-found', 'No such file', 404);
      const bytes = await fs.readFile(file);
      res.writeHead(200, {'content-type': TYPES[path.extname(file)], 'x-content-type-options': 'nosniff'}); res.end(bytes);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      const code = error.status ? error.code : status === 404 ? 'not-found' : 'server';
      json(status, {error: {code, message: status === 500 ? 'Local backend failure' : error.message, retry: code === 'server' ? 'same' : 'none', charged: false}, ...(error.activeJobId ? {activeJobId: error.activeJobId} : {})});
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await jobs.close(); throw error; }
  return {jobs, server, url: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); await jobs.close(); }};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {'frontend-origin': {type: 'string'}, provider: {type: 'string', default: 'fake'}}});
  const instance = await startShootServer({frontendOrigin: values['frontend-origin'] ?? null, mode: values.provider});
  console.log(`Local ${values.provider} shoot backend: ${instance.url}`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return;
    closing = true;
    if (instance.jobs.waitingForPaidId()) console.log('Closing shoot backend; in-flight paid creation ID may take up to 120 seconds to arrive.');
    try { await instance.close(); process.exit(0); }
    catch (error) {
      // Fixed safe identifiers only; filesystem errors can carry paths/URLs and
      // provider errors can include secrets in their message or stack.
      const safe = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : 'UNKNOWN';
      console.error('Shoot shutdown failed:', JSON.stringify({type: safe(error?.name), code: safe(error?.code), status: Number.isInteger(error?.status) ? error.status : null}));
      process.exit(1);
    }
  });
}
