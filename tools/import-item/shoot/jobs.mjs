import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash, randomBytes, createHmac, timingSafeEqual} from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {readJson, saveJson} from '../state.mjs';
import {keepPicture} from '../origin.mjs';
import {rateItem} from '../../../sim/item-rating.js';
import {fakeGenerator} from './fake.mjs';
import {realGenerator} from './real.mjs';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const MAX_PHOTO = 32 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const retryFor = {busy: 'resubmit', 'step-failed': 'regenerate', expired: 'regenerate', download: 'same', process: 'same', 'process-unfixable': 'regenerate', 'photo-upload': 'same', 'photo-read': 'none', 'photo-unclear': 'none', 'unknown-submit': 'none', 'recognition-auth': 'none', 'recognition-limit': 'none', 'recognition-network': 'same', 'recognition-service': 'same', 'recognition-invalid': 'none', 'recognition-interrupted': 'none', 'process-corrupt': 'none', 'process-too-large': 'none'};
export function apiError(code, message, status = 400, extra = {}) {
  return Object.assign(Error(message), {status, code, ...extra});
}
const keyValid = key => typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key);
const LOCAL = 'local'; // Trusted in-process tools only; never accepted from HTTP.
const DEFAULT_LIMITS = {browser: {generation: 2, recognition: 5}, global: {generation: 160, recognition: 400}};
const recognitionRetry = r => !r.job.recognition && !r.providerId && !r.pending && !r.providerState?.pending && !Object.keys(r.providerState?.tasks ?? {}).length && ['recognition-network', 'recognition-service'].includes(r.job.error?.code);
const activeStatus = r => ['recognizing', 'generating'].includes(r.job.status);
const dayAt = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
const resetAt = time => new Date(Date.parse(dayAt(time) + 'T00:00:00+08:00') + 86400000).toISOString();

// A directory lock has only an empty PID subdirectory; stale ownership can be
// recovered after a hard restart without removing any task or asset content.
async function own(directory) {
  const lock = path.join(directory, '.owner');
  try { await fs.mkdir(lock); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const entries = await fs.readdir(lock);
    if (entries.length !== 1 || !/^\d+$/.test(entries[0])) throw Error('Shoot owner lock is incomplete; inspect the empty lock before restarting');
    try { process.kill(Number(entries[0]), 0); throw Error('Shoot data directory is already in use'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await fs.rmdir(path.join(lock, entries[0])); await fs.rmdir(lock); await fs.mkdir(lock);
  }
  const owner = path.join(lock, String(process.pid)); await fs.mkdir(owner);
  return async () => { await fs.rmdir(owner); await fs.rmdir(lock); };
}

export async function openJobs({directory, repo = REPO, generator, fakeOptions, mode = 'fake', env = process.env, realOptions, clock = Date.now, limits = DEFAULT_LIMITS, budget = null} = {}) {
  for (const scope of ['browser', 'global']) for (const kind of ['generation', 'recognition']) if (!Number.isSafeInteger(limits[scope]?.[kind]) || limits[scope][kind] < 1) throw Error('Invalid daily shoot limits');
  if (budget && (!/^[A-Za-z0-9_-]{1,64}$/.test(budget.stage) || !Number.isSafeInteger(budget.limit) || budget.limit < 0)) throw Error('Invalid public budget');
  if (!['real', 'fake'].includes(mode)) throw Error('Choose provider real or fake');
  if (!generator && mode === 'real') generator = realGenerator({env, ...realOptions});
  directory ??= path.join(repo, mode === 'real' ? '.aholo/shoot-real' : '.aholo/shoot');
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  await fs.chmod(directory, 0o700);
  const release = await own(directory);
  let store, provider, catalog, mountRules;
  try {
    store = await readJson(path.join(directory, 'state.json'), {jobs: {}, keys: {}, items: []});
    if (!store || !store.jobs || !store.keys || !Array.isArray(store.items)) throw Error('Invalid shoot state file');
    store.jobs = Object.assign(Object.create(null), store.jobs);
    store.keys = Object.assign(Object.create(null), store.keys);
    store.sessionSecret ??= randomBytes(32).toString('hex');
    if (!/^[a-f0-9]{64}$/.test(store.sessionSecret)) throw Error('Invalid shoot session secret');
    // Unowned historical records stay local-only. A new visitor never inherits them.
    for (const r of Object.values(store.jobs)) {
      r.owner ??= LOCAL;
      // Preserve the old global receipt; the browser refund is independent.
      r.recognitionAttempts ??= r.allowance?.recognition ? [{day: r.allowance.recognition.day}] : [];
      if (!r.job.recognition && r.job.status === 'failed' && r.job.error?.code !== 'photo-unclear' && r.recognitionAttempts.length) r.recognitionAttempts.at(-1).refunded = true;
      if (recognitionRetry(r)) r.job.error.retry = 'same';
      await fs.chmod(path.join(directory, r.job.id), 0o700);
    }
    if (budget && Object.values(store.jobs).some(r => !r.budget && (activeStatus(r) || r.job.error?.retry === 'same' && !recognitionRetry(r)))) throw Error('Public budget requires a separate directory from unmetered unfinished jobs');
    store.sequence ??= 0;
    for (const r of Object.values(store.jobs)) r.queueOrder ??= ++store.sequence;
    const kind = generator?.real ? 'real' : 'fake';
    if ((store.provider ?? 'fake') !== kind && Object.keys(store.jobs).length) throw Error('Shoot data provider changed; use a separate state directory');
    store.provider = kind;
    const oldItem = store.items.findIndex(item => ![1, -1].includes(item?.outEnd));
    if (oldItem >= 0) throw Error(`Saved shoot item ${store.items[oldItem]?.id ?? '(missing id)'} lacks valid outEnd; archive and clear the local shoot directory before upgrading (shoot/README.md)`);
    catalog = await readJson(path.join(repo, 'data/catalog.json'));
    mountRules = await readJson(path.join(repo, 'sim/v3-rules.json'));
    provider = generator ?? await fakeGenerator(directory, fakeOptions);
  } catch (error) { await release(); throw error; }
  const template = catalog.items.find(i => i.id === 'pan-lux3d');
  if (!template) { await release(); throw Error('Missing fake pot template'); }
  let closed = false, storageError = null, chain = Promise.resolve(), runner = Promise.resolve();
  const abort = new AbortController();
  const retakeWaits = new Map();
  const now = () => new Date(clock()).toISOString();
  const save = async () => {
    try { await saveJson(path.join(directory, 'state.json'), store, {mode: 0o600}); }
    catch (error) {
      if (!storageError) { storageError = error; console.error('Shoot persistence failed:', error.code ?? 'UNKNOWN'); }
      throw apiError('server', 'Persistence failed; restart after fixing storage', 503);
    }
  };
  const serial = fn => { const result = chain.then(() => { if (storageError) throw apiError('server', 'Persistence failed; restart after fixing storage', 503); return fn(); }); chain = result.catch(() => {}); return result; };
  const pending = () => Object.values(store.jobs).filter(activeStatus).sort((a, b) => a.queueOrder - b.queueOrder);
  const active = owner => pending().find(r => owner === undefined || r.owner === owner);
  const publicJob = record => copy({retakeUntil: null, ...record.job, queuePosition: activeStatus(record) && !record.job.steps[0].startedAt ? Math.max(0, pending().indexOf(record)) : null});
  const get = (id, owner) => { const r = store.jobs[id]; if (!Object.hasOwn(store.jobs, id) || (owner !== undefined && r.owner !== owner)) throw apiError('not-found', 'No such job', 404); return r; };
  const scopedKey = (owner, key) => owner === LOCAL ? key : `${owner}:${key}`;
  const receiptCount = (r, kind, day, browser) => kind === 'recognition'
    ? (r.recognitionAttempts ?? []).filter(a => a.day === day && (!browser || !a.refunded)).length
    : Number(r.allowance?.[kind]?.day === day);
  const usage = (kind, day, owner, browser = false) => Object.values(store.jobs).reduce((n, r) => n + ((owner === undefined || r.owner === owner) ? receiptCount(r, kind, day, browser) : 0), 0);
  function checkQuota(kind, owner, skip) {
    const day = dayAt(clock());
    for (const scope of ['browser', 'global']) {
      const who = scope === 'browser' ? owner : undefined;
      // Only the current reservation is skipped, never earlier retries.
      const receipt = skip?.recognitionAttempts?.at(-1);
      const reserved = kind === 'recognition'
        ? Number(skip?.allowance?.recognition?.day === day && receipt?.day === day && (who === undefined || !receipt.refunded))
        : Number(skip?.allowance?.[kind]?.day === day);
      const n = usage(kind, day, who, scope === 'browser') - reserved;
      if (n >= limits[scope][kind]) throw apiError('quota', kind === 'generation' ? '今天的生成名额用完了，明天再来' : '今天的认物名额用完了，明天再来', 429, {kind, scope, resetsAt: resetAt(clock())});
    }
  }
  // Internal HTTP retries reuse one receipt. A manual retry adds one global
  // safety receipt, while service faults refund only the browser's receipt.
  function reserve(record, kind) {
    checkQuota(kind, record.owner, record);
    if (kind === 'recognition' && record.allowance?.recognition?.day !== dayAt(clock())) (record.recognitionAttempts ??= []).push({day: dayAt(clock())});
    (record.allowance ??= {})[kind] = {day: dayAt(clock())};
  }
  // Reserve the whole known 12+1 credit route before accepting work. Retain
  // reservations after the first paid boundary, even if the reply was lost.
  // This is a conservative spend ceiling, not a supplier balance or invoice.
  function publicBudget() {
    if (!budget) return null;
    const reserved = Object.values(store.jobs).reduce((n, r) => n + (r.budget?.stage === budget.stage ? r.budget.credits : 0), 0);
    const remaining = Math.max(0, budget.limit - reserved);
    return {limit: budget.limit, remaining, available: remaining >= 13};
  }
  function checkBudget() {
    if (budget && !publicBudget().available) throw apiError('budget', '暂时不能拍，请先用现成角色打一局', 503);
  }
  const sign = id => createHmac('sha256', store.sessionSecret).update(id).digest('hex');
  function session(token) {
    if (typeof token === 'string' && /^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) {
      const [id, sig] = token.split('.');
      if (timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(id), 'hex'))) return {owner: id, token};
    }
    const id = randomUUID(); return {owner: id, token: `${id}.${sign(id)}`};
  }
  const charged = id => provider.real ? provider.charged(get(id).providerState) : provider.charged(id);
  const context = record => ({state: record.providerState ??= {tasks: {}, timestamps: {}}, folder: path.join(directory, record.job.id), recognition: record.job.recognition, save: () => serial(save), allowCreate: !record.freeRetry, signal: abort.signal, mountRules});
  async function fail(record, code, details = {}) {
    if (!record.job.recognition && code !== 'photo-unclear' && record.recognitionAttempts?.length) record.recognitionAttempts.at(-1).refunded = true;
    if (!record.job.steps[0].startedAt || code === 'busy') delete record.allowance?.generation;
    if (!record.job.steps[0].startedAt || (code === 'busy' && !charged(record.job.id))) delete record.budget;
    record.job.status = 'failed'; record.job.error = {code, message: code, retry: retryFor[code] ?? 'same', charged: charged(record.job.id), ...details}; await save();
  }
  // No automatic paid retry, including an interrupted call before providerId was saved.
  try {
    for (const record of Object.values(store.jobs)) {
      const parent = store.jobs[record.job.fromJob ?? record.job.regenerateOf];
      if (parent && !parent.usedBy) { parent.usedBy = record.job.id; }
    }
    await save(); // Persist session identity and legacy ownership before serving requests.
    for (const record of Object.values(store.jobs)) {
      if (record.pending || record.providerState?.pending) await fail(record, 'unknown-submit');
      else if (record.providerState?.recognitionPending && !record.job.recognition && record.job.status !== 'failed') await fail(record, 'recognition-interrupted');
    }
  }
  catch (error) { await release(); throw error; }
  async function waitForRetake(record) {
    const j = record.job;
    if (closed || j.status !== 'generating') return false;
    if (j.retakeUntil && !j.steps[0].startedAt) {
      const wait = new AbortController(); retakeWaits.set(j.id, wait);
      try {
        const signal = AbortSignal.any([abort.signal, wait.signal]);
        while (clock() < Date.parse(j.retakeUntil)) await pause(Date.parse(j.retakeUntil) - clock(), undefined, {signal});
      }
      catch (error) { if (error.name !== 'AbortError') throw error; return false; }
      finally { retakeWaits.delete(j.id); }
    }
    // This durable boundary and retake() share the queue. The real provider's
    // local providerId is not a paid submission; its first step can submit.
    return serial(async () => {
      if (closed || j.status !== 'generating') return false;
      if (!j.steps[0].startedAt) reserve(record, 'generation');
      j.steps[0].startedAt ??= now();
      if (provider.real) record.providerId ??= j.id;
      else if (!record.providerId) record.pending = true;
      await save(); return true;
    });
  }
  async function work(record) {
    const j = record.job, folder = path.join(directory, j.id);
    try {
      if (!j.recognition) {
        await serial(async () => { reserve(record, 'generation'); reserve(record, 'recognition'); await save(); });
        const recognition = await provider.recognize(template, context(record));
        // A response received while closing is still valuable paid work: save it
        // before honoring shutdown, then leave later stages for restart.
        await serial(async () => { j.recognition = recognition; if (record.providerState) delete record.providerState.recognitionPending; j.status = 'generating'; j.retakeUntil = !j.fromJob && !j.regenerateOf ? new Date(clock() + 5000).toISOString() : null; await save(); });
      }
      if (!await waitForRetake(record)) return;
      if (!record.providerId) {
        let providerId;
        try { providerId = await provider.submit(j.id); }
        catch (error) {
          await serial(async () => { if (error.code === 'busy') record.pending = false; await fail(record, error.code === 'busy' ? 'busy' : 'unknown-submit'); });
          return;
        }
        await serial(async () => { record.providerId = providerId; record.pending = false; await save(); });
      }
      for (const step of j.steps) {
        if (closed) return;
        if (step.endedAt) continue;
        await serial(async () => { step.startedAt ??= now(); await save(); });
        const prepared = await provider.step(step.key, j.id, context(record), catalog);
        if (closed) return;
        if (!provider.real && step.key === 'styled') await fs.copyFile(path.join(folder, 'photo.jpg'), path.join(folder, 'styled.jpg'));
        if (!provider.real && step.key === 'download') await fs.copyFile(path.join(repo, template.glb), path.join(folder, 'model.glb'));
        if (step.key !== 'process') await serial(async () => { step.endedAt = now(); await save(); });
        else await serial(async () => {
          await Promise.all(['photo.jpg', 'styled.jpg', 'model.glb'].map(f => fs.access(path.join(folder, f))));
          const ended = now(), id = `shoot_${j.id.slice(2)}`, url = `/api/shoot/files/${id}`;
          // The real provider returns prepared geometry; fake uses the fixed asset.
          const item = provider.real ? prepared : copy(template);
          delete item.comparisonBase; delete item.origin;
          if (provider.real) Object.assign(item, {id, glb: `${url}/model.glb`});
          else Object.assign(item, {id, outEnd: mountRules.top.outEnd[template.id] ?? 1, name: `我拍的锅${store.items.length ? ' ' + (store.items.length + 1) : ''}`, glb: `${url}/model.glb`, massBasis: 'local-fake', source: {generator: 'local-fake', templateId: template.id, license: '沿用仓库锅样本；不是本次真实生成'}});
          item.rating = rateItem(item, catalog.materials);
          const started = Date.parse(j.createdAt), styled = Date.parse(j.steps[0].startedAt), model = Date.parse(j.steps[1].startedAt);
          item.origin = {photo: `${url}/photo.jpg`, styled: `${url}/styled.jpg`, steps: [{key: 'photo', seconds: (styled - started) / 1000}, {key: 'styled', seconds: (model - styled) / 1000}, {key: 'model', seconds: (Date.parse(ended) - model) / 1000}]};
          // Assets are ready before the single inventory/job commit.
          store.items.push(item); step.endedAt = ended; j.status = 'succeeded'; j.itemId = id; j.error = null; await save();
        });
      }
    } catch (error) {
      // Received recognition failures are paid responses too: preserve their
      // classification during close, just as a successful recognition is saved.
      if ((!closed || !j.recognition) && !storageError) await serial(async () => {
        if (!j.recognition && record.providerState) delete record.providerState.recognitionPending;
        if (error.code === 'quota') { await fail(record, 'quota', {message: error.message, retry: 'none', kind: error.kind, scope: error.scope, resetsAt: error.resetsAt}); return; }
        await fail(record, Object.hasOwn(retryFor, error.code) ? error.code : j.recognition ? (j.steps[3].startedAt ? 'process' : 'download') : 'photo-unclear');
      });
    }
  }
  function start(record) {
    runner = runner.then(() => !closed && activeStatus(record) ? work(record) : undefined).catch(error => { if (!storageError) { storageError = error; console.error('Shoot persistence failed:', error.code ?? 'UNKNOWN'); } });
  }
  for (const record of pending()) start(record);

  async function create({clientKey, photo, fromJob, regenerateOf, confirm}, owner = LOCAL) {
    if (!keyValid(clientKey)) throw apiError('key-conflict', 'clientKey must contain 8–128 letters, digits, underscore or hyphen');
    let photoHash;
    if (photo) {
      if (!Buffer.isBuffer(photo) || photo.length > MAX_PHOTO) throw apiError('photo-invalid', 'Photo exceeds 32 MiB', 413);
      photoHash = hash(photo);
    }
    const key = scopedKey(owner, clientKey);
    const fingerprint = hash(JSON.stringify({photoHash, fromJob, regenerateOf, confirm}));
    return serial(async () => {
      if (closed) throw apiError('server', 'Service closing', 503);
      if (Object.hasOwn(store.keys, key)) {
        const old = store.keys[key];
        if (old.fingerprint !== fingerprint) throw apiError('key-conflict', 'Same clientKey with different input', 409);
        return publicJob(get(old.id, owner));
      }
      const parent = fromJob || regenerateOf ? get(fromJob ?? regenerateOf, owner) : null;
      if (parent?.usedBy) throw apiError('not-allowed', 'This source job already created a replacement', 409);
      const current = active(owner);
      if (current) throw apiError('active-job', 'A job is still active', 409, {activeJobId: current.job.id});
      if (regenerateOf && (confirm !== true || parent.job.error?.retry !== 'regenerate')) throw apiError('not-allowed', 'Explicit confirmation and a regeneratable failure required', 409);
      if (fromJob && parent.job.error?.code !== 'busy') throw apiError('not-allowed', 'fromJob is only for confirmed busy rejection', 409);
      if ((!photo && !parent) || (photo && parent)) throw apiError('photo-invalid', 'One photo or one source job required');
      checkBudget();
      if (photo) {
      try {
        const metadata = await sharp(photo, {limitInputPixels: 64000000}).metadata();
        if (!['jpeg', 'png'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw Error('Expected one JPEG or PNG');
        // Force decode now; a truncated container is not a valid accepted photo.
        await sharp(photo, {limitInputPixels: 64000000}).stats();
      } catch { throw apiError('photo-invalid', 'Invalid JPEG/PNG or pixel limit'); }
      }
      checkQuota('generation', owner);
      if (!parent?.job.recognition) checkQuota('recognition', owner);
      const id = `j_${randomUUID()}`, folder = path.join(directory, id); await fs.mkdir(folder, {mode: 0o700});
      if (photo) await keepPicture(photo, path.join(folder, 'photo.jpg'));
      else await fs.copyFile(path.join(directory, parent.job.id, 'photo.jpg'), path.join(folder, 'photo.jpg'));
      const j = {id, clientKey, createdAt: now(), status: parent?.job.recognition ? 'generating' : 'recognizing', recognition: parent?.job.recognition ? copy(parent.job.recognition) : null, retakeUntil: null, steps: ['styled', 'model', 'download', 'process'].map(key => ({key, startedAt: null, endedAt: null})), estimateSeconds: provider.real ? 90 : 1, error: null, itemId: null, fromJob: fromJob ?? null, regenerateOf: regenerateOf ?? null};
      const record = {...(budget ? {budget: {stage: budget.stage, credits: 13}} : {}), owner, queueOrder: ++store.sequence, job: j, pending: false, providerId: null};
      reserve(record, 'generation');
      if (!j.recognition) reserve(record, 'recognition');
      if (parent) parent.usedBy = id;
      store.jobs[id] = record; store.keys[key] = {id, fingerprint}; await save(); start(record); return publicJob(record);
    });
  }
  return {
    directory,
    cookieName: provider.real ? 'wanwu_shoot_real' : 'wanwu_shoot_fake',
    session,
    health: async () => {
      await serial(() => {});
      const recognitionProxy = await provider.health?.();
      if (recognitionProxy?.required && !recognitionProxy.reachable) throw apiError('recognition-proxy', 'Recognition proxy is unavailable', 503);
      return {status: 'ok', provider: provider.real ? 'real' : 'fake', ...(recognitionProxy ? {recognitionProxy} : {})};
    },
    waitingForPaidId: () => Boolean(provider.real && provider.waitingForPaidId?.()),
    create,
    get: (id, owner) => serial(() => publicJob(get(id, owner))),
    items: owner => serial(() => copy(store.items.filter(i => owner === undefined || Object.values(store.jobs).some(r => r.owner === owner && r.job.itemId === i.id)))),
    quota: owner => serial(() => {
      const day = dayAt(clock()), count = (kind, who, browser = false) => usage(kind, day, who, browser);
      return {...(budget ? {budget: publicBudget()} : {}), provider: provider.real ? 'real' : 'fake', limit: limits.browser.generation, remaining: Math.max(0, limits.browser.generation - count('generation', owner)), resetsAt: resetAt(clock()),
        recognition: {limit: limits.browser.recognition, remaining: Math.max(0, limits.browser.recognition - count('recognition', owner, true))},
        global: {limit: limits.global.generation, remaining: Math.max(0, limits.global.generation - count('generation')), recognition: {limit: limits.global.recognition, remaining: Math.max(0, limits.global.recognition - count('recognition'))}},
        used: Object.values(store.jobs).filter(r => (owner === undefined || r.owner === owner) && charged(r.job.id)).length, activeJobId: active(owner)?.job.id ?? null};
    }),
    retake: (id, owner) => serial(async () => {
      if (closed) throw apiError('server', 'Service closing', 503);
      const r = get(id, owner), j = r.job;
      if (j.status === 'failed' && j.error?.code === 'retake') return publicJob(r);
      if (j.status !== 'generating' || !j.retakeUntil || clock() >= Date.parse(j.retakeUntil) || j.steps.some(s => s.startedAt) || r.pending || r.providerId) throw apiError('not-allowed', 'Generation has started or no retake window is open', 409);
      delete r.allowance?.generation; delete r.budget;
      j.status = 'failed'; j.error = {code: 'retake', message: 'retake', retry: 'none', charged: false};
      await save(); retakeWaits.get(id)?.abort(); return publicJob(r);
    }),
    retry: (id, owner) => serial(async () => {
      if (closed) throw apiError('server', 'Service closing', 503);
      const r = get(id, owner), current = active(r.owner);
      const recognition = recognitionRetry(r);
      if (r.job.status !== 'failed' || r.job.error?.retry !== 'same' || (!r.providerId && !recognition) || r.pending) throw apiError('not-allowed', 'This job cannot be retried', 409);
      if (current && current !== r) throw apiError('active-job', 'A job is still active', 409, {activeJobId: current.job.id});
      if (recognition) {
        checkBudget(); checkQuota('generation', r.owner); checkQuota('recognition', r.owner);
        delete r.allowance?.recognition;
        reserve(r, 'generation'); reserve(r, 'recognition');
        if (budget) r.budget = {stage: budget.stage, credits: 13};
      } else if (provider.real) r.freeRetry = true;
      r.queueOrder = ++store.sequence; r.job.error = null; r.job.status = recognition ? 'recognizing' : 'generating'; await save(); start(r); return publicJob(r);
    }),
    file: (id, name, owner) => serial(() => {
      if (!['model.glb', 'photo.jpg', 'styled.jpg'].includes(name)) throw apiError('not-found', 'No such file', 404);
      const item = store.items.find(i => i.id === id), record = Object.values(store.jobs).find(r => r.job.itemId === id);
      if (!item || !record || (owner !== undefined && record.owner !== owner)) throw apiError('not-found', 'No such item', 404);
      return path.join(directory, record.job.id, name);
    }),
    async close() { closed = true; abort.abort(); try { await runner; await chain; } finally { await release(); } }
  };
}
