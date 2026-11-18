import http from 'node:http';
import {parseArgs, promisify} from 'node:util';
import {gzip} from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {openJobs, apiError, MAX_PHOTO, REPO} from './jobs.mjs';

const TYPES = {'.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2'};
const compress = promisify(gzip);
async function staticFile(req, res, webRoot, route) {
  let name;
  try { name = decodeURIComponent(route); } catch { throw apiError('bad-request', 'Invalid URL encoding'); }
  const root = await fs.realpath(webRoot), candidate = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!candidate.startsWith(root + path.sep)) throw apiError('not-found', 'No such file', 404);
  const file = await fs.realpath(candidate), ext = path.extname(file);
  if (!file.startsWith(root + path.sep) || !Object.hasOwn(TYPES, ext)) throw apiError('not-found', 'No such file', 404);
  let bytes = await fs.readFile(file);
  const hashed = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(name);
  const headers = {'content-type': TYPES[ext], 'cache-control': hashed ? 'private, max-age=31536000, immutable' : 'no-store', 'x-content-type-options': 'nosniff'};
  if (['.js', '.css', '.json', '.wasm'].includes(ext)) {
    headers.vary = 'Accept-Encoding';
    const accepted = String(req.headers['accept-encoding'] ?? '').split(',').map(v => v.trim().split(/\s*;\s*/)).find(([name]) => name.toLowerCase() === 'gzip');
    if (accepted && Number(accepted.slice(1).find(v => v.startsWith('q='))?.slice(2) ?? '1') > 0) {
      bytes = await compress(bytes); headers['content-encoding'] = 'gzip';
    }
  }
  headers['content-length'] = bytes.length;
  res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : bytes);
}
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
export async function startShootServer({port = 4408, directory, repo = REPO, webRoot = path.join(repo, 'web/dist'), frontendOrigin = null, publicOrigin = null, privateOrigin = null, previewAccessCode = null, headerIdentity = false, resilientPhotos = headerIdentity, ...options} = {}) {
  if (typeof headerIdentity !== 'boolean' || (headerIdentity && (!publicOrigin || privateOrigin || previewAccessCode))) throw Error('Header identity requires a dedicated public API');
  if (!headerIdentity && (options.budget?.limit === null || options.limits?.global?.generation === null)) throw Error('Only the dedicated judge API can disable spend or global generation limits');
  if (privateOrigin !== null) {
    const u = new URL(privateOrigin), parts = u.hostname.split('.').map(Number);
    if (publicOrigin || u.protocol !== 'http:' || u.origin !== privateOrigin || parts.length !== 4 || !parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) || parts[0] !== 100 || parts[1] < 64 || parts[1] > 127 || !options.budget) throw Error('Private mode requires exact Tailscale HTTP origin and budget');
  }
  if (publicOrigin !== null) {
    const u = new URL(publicOrigin);
    if (u.protocol !== 'https:' || u.origin !== publicOrigin || !options.budget) throw Error('Public mode requires exact HTTPS origin and budget');
  }
  // A temporary, explicitly authorized preview serves the existing game on the
  // same HTTPS origin. The opaque link exchanges for a separate access cookie;
  // it never replaces each browser's independent job ownership cookie.
  if (previewAccessCode !== null && (!publicOrigin || frontendOrigin || !/^[a-f0-9]{64}$/.test(previewAccessCode) || options.budget.limit > 130)) throw Error('Preview requires HTTPS, a 256-bit access code and budget <=130');
  const previewCookie = '__Host-wanwu_preview';
  const sameCode = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(previewAccessCode ?? ''));
  if (frontendOrigin !== null) {
    const u = new URL(frontendOrigin);
    if (u.origin !== frontendOrigin || (publicOrigin ? u.protocol !== 'https:' : u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw Error('Frontend origin must be exact HTTPS in public mode, otherwise local HTTP');
  }
  const jobs = await openJobs({directory, repo, resilientPhotos, ...options, ...((publicOrigin || privateOrigin) && !options.limits ? {limits: {browser: {generation: privateOrigin ? 20 : 2, recognition: privateOrigin ? 100 : 5}, global: {generation: 20, recognition: privateOrigin ? 100 : 400}}} : {})});
  const server = http.createServer(async (req, res) => {
    const json = (code, value) => { res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(value)); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const hosts = [new URL(origin).host, ...(publicOrigin ? [new URL(publicOrigin).host] : []), ...(privateOrigin ? [new URL(privateOrigin).host, `localhost:${server.address().port}`] : [])];
      const origins = [origin, frontendOrigin, publicOrigin, privateOrigin, ...(privateOrigin ? [`http://localhost:${server.address().port}`] : [])].filter(Boolean);
      if (!hosts.includes(req.headers.host) || (req.headers.origin && !origins.includes(req.headers.origin))) throw apiError('forbidden', 'Unrecognized host or origin', 403);
      const url = new URL(req.url, origin), route = url.pathname;
      res.setHeader('referrer-policy', 'no-referrer');
      if (previewAccessCode && req.method === 'GET' && route.startsWith('/open/')) {
        if (url.search || !sameCode(route.slice('/open/'.length))) throw apiError('forbidden', 'Invalid preview link', 403);
        res.writeHead(303, {'location': '/?shoot=real&capture=1', 'cache-control': 'no-store', 'set-cookie': `${previewCookie}=${previewAccessCode}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`});
        return res.end();
      }
      if (route.startsWith('/api/') && url.search) throw apiError('bad-request', 'Unexpected query parameters');
      if (req.method === 'GET' && route === '/api/shoot/health') return json(200, await jobs.health());
      if (previewAccessCode) {
        const access = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(previewCookie + '='));
        if (access.length !== 1 || !sameCode(access[0].slice(previewCookie.length + 1))) throw apiError('forbidden', 'Open your private preview link first', 403);
      } else if (publicOrigin && !route.startsWith('/api/shoot/')) throw apiError('not-found', 'API only', 404);
      // Static requests don't carry the API-path owner cookie. Never mint a new
      // one here: a slow asset could otherwise overwrite an active API session.
      if (!route.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw apiError('not-found', 'Unknown route', 404);
        return await staticFile(req, res, webRoot, route);
      }
      // ModelScope embeds the game cross-site, where Safari can block cookies.
      // This dedicated mode requires an explicitly saved bearer identity. An
      // invalid/missing token must never silently become another paying owner.
      let identity;
      if (headerIdentity) {
        const token = req.headers['x-shoot-session'];
        if (route === '/api/shoot/session' && req.method === 'POST') {
          await body(req, 0);
          if (token !== undefined) throw apiError('session', 'Session creation must not replace an existing identity', 401);
          return json(200, {token: jobs.session(null).token});
        }
        if (typeof token !== 'string' || (identity = jobs.session(token)).token !== token) throw apiError('session', 'Missing or invalid shoot session', 401);
      } else {
        const cookies = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(jobs.cookieName + '='));
        identity = jobs.session(cookies.length === 1 ? cookies[0].slice(jobs.cookieName.length + 1) : null);
        res.setHeader('set-cookie', `${jobs.cookieName}=${identity.token}; Path=${publicOrigin ? '/api/shoot' : '/'}; HttpOnly; SameSite=Strict; Max-Age=31536000${publicOrigin ? '; Secure' : ''}`);
      }
      const owner = identity.owner;
      const jobResult = job => {
        // Already-open pages understand a refunded terminal failure.
        if (job.status === 'recognition-missed' && req.headers['x-shoot-category'] !== '2') {
          return {job: {...job, status: 'failed', error: {...job.error, code: 'photo-failed'}}};
        }
        return {job};
      };
      if (req.method === 'GET' && route === '/api/shoot/quota') return json(200, await jobs.quota(owner));
      if (req.method === 'GET' && route === '/api/shoot/items') return json(200, {items: await jobs.items(owner)});
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
        return json(202, jobResult(await jobs.create(input, owner)));
      }
      const jobRoute = route.match(/^\/api\/shoot\/jobs\/(j_[a-f0-9-]{36})(?:\/(retry|regenerate|retake|category))?$/);
      if (jobRoute) {
        const [, id, action] = jobRoute;
        if (req.method === 'GET' && !action) return json(200, jobResult(await jobs.get(id, owner)));
        if (req.method === 'POST' && action === 'retry') { await body(req, 0); return json(200, jobResult(await jobs.retry(id, owner))); }
        if (req.method === 'POST' && action === 'retake') { await body(req, 0); return json(200, jobResult(await jobs.retake(id, owner))); }
        if (req.method === 'POST' && action === 'category') return json(200, jobResult(await jobs.chooseCategory(id, (await jsonBody(req, ['category'])).category, owner)));
        if (req.method === 'POST' && action === 'regenerate') return json(202, jobResult(await jobs.create({...await jsonBody(req, ['confirm', 'clientKey']), regenerateOf: id}, owner)));
      }
      const fileRoute = route.match(/^\/api\/shoot\/files\/(shoot_[a-f0-9-]{36})\/(model\.glb|photo\.jpg|styled\.jpg)$/);
      if (req.method === 'GET' && fileRoute) {
        const file = await jobs.file(fileRoute[1], fileRoute[2], owner);
        res.writeHead(200, {'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); return res.end(await fs.readFile(file));
      }
      throw apiError('not-found', 'Unknown API route', 404);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : 500);
      const code = error.status ? error.code : status === 404 ? 'not-found' : 'server';
      json(status, {error: {code, message: status === 500 ? 'Local backend failure' : error.message, retry: code === 'server' ? 'same' : 'none', charged: false, ...(error.kind ? {kind: error.kind, scope: error.scope, resetsAt: error.resetsAt} : {})}, ...(error.activeJobId ? {activeJobId: error.activeJobId} : {})});
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await jobs.close(); throw error; }
  return {jobs, server, url: `http://127.0.0.1:${server.address().port}`, async close() { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); await jobs.close(); }};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {config: {type: 'string'}, 'frontend-origin': {type: 'string'}, provider: {type: 'string', default: 'fake'}}});
  let config = {};
  if (values.config) {
    if (!path.isAbsolute(values.config)) throw Error('Config path must be absolute');
    config = fields(JSON.parse(await fs.readFile(values.config, 'utf8')), ['port', 'directory', 'publicOrigin', 'privateOrigin', 'frontendOrigin', 'previewAccessCode', 'headerIdentity', 'budget', 'limits', 'recognitionPrimary']);
    if (config.port !== (config.headerIdentity === true ? 4331 : 4330) || !path.isAbsolute(config.directory ?? '') || !(config.publicOrigin || config.privateOrigin) || !config.budget) throw Error('Public config requires port 4330 (cookie) or 4331 (header session), absolute private directory, origin and budget');
    if (config.recognitionPrimary !== undefined && (config.headerIdentity !== true || !['gemini', 'modelscope'].includes(config.recognitionPrimary))) throw Error('Recognition primary is only configurable on the dedicated judge API');
    process.umask(0o077);
  }
  const serverConfig = {...config};
  delete serverConfig.recognitionPrimary;
  const instance = await startShootServer({...serverConfig, frontendOrigin: values['frontend-origin'] ?? config.frontendOrigin ?? null, mode: values.provider});
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
