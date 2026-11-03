import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {readJson, saveJson} from '../state.mjs';
import {keepPicture} from '../origin.mjs';
import {rateItem} from '../../../sim/item-rating.js';
import {fakeGenerator} from './fake.mjs';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const MAX_PHOTO = 32 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const retryFor = {busy: 'resubmit', 'step-failed': 'regenerate', expired: 'regenerate', download: 'same', process: 'same', 'process-unfixable': 'regenerate', 'photo-unclear': 'none', 'unknown-submit': 'none'};
export function apiError(code, message, status = 400, extra = {}) {
  return Object.assign(Error(message), {status, code, ...extra});
}
const keyValid = key => typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key);
const publicJob = record => copy(record.job);

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

export async function openJobs({directory = path.join(REPO, '.aholo/shoot'), repo = REPO, generator, fakeOptions} = {}) {
  await fs.mkdir(directory, {recursive: true});
  const release = await own(directory);
  let store, provider, catalog, mountRules;
  try {
    store = await readJson(path.join(directory, 'state.json'), {jobs: {}, keys: {}, items: []});
    if (!store || !store.jobs || !store.keys || !Array.isArray(store.items)) throw Error('Invalid shoot state file');
    store.jobs = Object.assign(Object.create(null), store.jobs);
    store.keys = Object.assign(Object.create(null), store.keys);
    const oldItem = store.items.findIndex(item => ![1, -1].includes(item?.outEnd));
    if (oldItem >= 0) throw Error(`Saved shoot item ${store.items[oldItem]?.id ?? '(missing id)'} lacks valid outEnd; archive and clear the local shoot directory before upgrading (shoot/README.md)`);
    catalog = await readJson(path.join(repo, 'data/catalog.json'));
    mountRules = await readJson(path.join(repo, 'sim/v3-rules.json'));
    provider = generator ?? await fakeGenerator(directory, fakeOptions);
  } catch (error) { await release(); throw error; }
  const template = catalog.items.find(i => i.id === 'pan-lux3d');
  if (!template) { await release(); throw Error('Missing fake pot template'); }
  let closed = false, storageError = null, chain = Promise.resolve(), runner = Promise.resolve();
  const now = () => new Date().toISOString();
  const save = async () => {
    try { await saveJson(path.join(directory, 'state.json'), store); }
    catch (error) {
      if (!storageError) { storageError = error; console.error('Shoot persistence failed:', error.code ?? 'UNKNOWN'); }
      throw apiError('server', 'Persistence failed; restart after fixing storage', 503);
    }
  };
  const serial = fn => { const result = chain.then(() => { if (storageError) throw apiError('server', 'Persistence failed; restart after fixing storage', 503); return fn(); }); chain = result.catch(() => {}); return result; };
  const active = () => Object.values(store.jobs).find(r => ['recognizing', 'generating'].includes(r.job.status));
  const get = id => { const r = store.jobs[id]; if (!Object.hasOwn(store.jobs, id)) throw apiError('not-found', 'No such job', 404); return r; };
  const charged = id => provider.charged(id);
  async function fail(record, code) {
    record.job.status = 'failed'; record.job.error = {code, message: code, retry: retryFor[code] ?? 'same', charged: charged(record.job.id)}; await save();
  }
  // No automatic paid retry, including an interrupted call before providerId was saved.
  try {
    let restored = false;
    for (const record of Object.values(store.jobs)) {
      const parent = store.jobs[record.job.fromJob ?? record.job.regenerateOf];
      if (parent && !parent.usedBy) { parent.usedBy = record.job.id; restored = true; }
    }
    if (restored) await save();
    for (const record of Object.values(store.jobs)) if (record.pending) await fail(record, 'unknown-submit');
  }
  catch (error) { await release(); throw error; }
  async function work(record) {
    const j = record.job, folder = path.join(directory, j.id);
    try {
      if (!j.recognition) {
        const recognition = await provider.recognize(template);
        if (closed) return;
        await serial(async () => { j.recognition = recognition; j.status = 'generating'; await save(); });
      }
      if (closed) return;
      if (!record.providerId) {
        await serial(async () => { record.pending = true; j.steps[0].startedAt ??= now(); await save(); });
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
        await provider.step(step.key, j.id);
        if (closed) return;
        if (step.key === 'styled') await fs.copyFile(path.join(folder, 'photo.jpg'), path.join(folder, 'styled.jpg'));
        if (step.key === 'download') await fs.copyFile(path.join(repo, template.glb), path.join(folder, 'model.glb'));
        if (step.key !== 'process') await serial(async () => { step.endedAt = now(); await save(); });
        else await serial(async () => {
          await Promise.all(['photo.jpg', 'styled.jpg', 'model.glb'].map(f => fs.access(path.join(folder, f))));
          const ended = now(), id = `shoot_${j.id.slice(2)}`, url = `/api/shoot/files/${id}`;
          // Model and geometry both use the same fixed, already-normalized asset.
          const item = copy(template);
          delete item.comparisonBase; delete item.origin;
          Object.assign(item, {id, outEnd: mountRules.top.outEnd[template.id] ?? 1, name: `我拍的锅${store.items.length ? ' ' + (store.items.length + 1) : ''}`, glb: `${url}/model.glb`, massBasis: 'local-fake', source: {generator: 'local-fake', templateId: template.id, license: '沿用仓库锅样本；不是本次真实生成'}});
          item.rating = rateItem(item, catalog.materials);
          const started = Date.parse(j.createdAt), styled = Date.parse(j.steps[0].startedAt), model = Date.parse(j.steps[1].startedAt);
          item.origin = {photo: `${url}/photo.jpg`, styled: `${url}/styled.jpg`, steps: [{key: 'photo', seconds: (styled - started) / 1000}, {key: 'styled', seconds: (model - styled) / 1000}, {key: 'model', seconds: (Date.parse(ended) - model) / 1000}]};
          // Assets are ready before the single inventory/job commit.
          store.items.push(item); step.endedAt = ended; j.status = 'succeeded'; j.itemId = id; j.error = null; await save();
        });
      }
    } catch (error) {
      if (!closed && !storageError) await serial(() => fail(record, Object.hasOwn(retryFor, error.code) ? error.code : j.recognition ? (j.steps[3].startedAt ? 'process' : 'download') : 'photo-unclear'));
    }
  }
  function start(record) { runner = runner.then(() => closed ? undefined : work(record)).catch(error => { storageError ??= error; }); }
  for (const record of Object.values(store.jobs)) if (['recognizing', 'generating'].includes(record.job.status)) start(record);

  async function create({clientKey, photo, fromJob, regenerateOf, confirm}) {
    if (!keyValid(clientKey)) throw apiError('key-conflict', 'clientKey must contain 8–128 letters, digits, underscore or hyphen');
    let photoHash;
    if (photo) {
      if (!Buffer.isBuffer(photo) || photo.length > MAX_PHOTO) throw apiError('photo-invalid', 'Photo exceeds 32 MiB', 413);
      photoHash = hash(photo);
    }
    const fingerprint = hash(JSON.stringify({photoHash, fromJob, regenerateOf, confirm}));
    return serial(async () => {
      if (closed) throw apiError('server', 'Service closing', 503);
      if (Object.hasOwn(store.keys, clientKey)) {
        const old = store.keys[clientKey];
        if (old.fingerprint !== fingerprint) throw apiError('key-conflict', 'Same clientKey with different input', 409);
        return publicJob(get(old.id));
      }
      const parent = fromJob || regenerateOf ? get(fromJob ?? regenerateOf) : null;
      if (parent?.usedBy) throw apiError('not-allowed', 'This source job already created a replacement', 409);
      const current = active();
      if (current) throw apiError('active-job', 'A job is still active', 409, {activeJobId: current.job.id});
      if (regenerateOf && (confirm !== true || parent.job.error?.retry !== 'regenerate')) throw apiError('not-allowed', 'Explicit confirmation and a regeneratable failure required', 409);
      if (fromJob && parent.job.error?.code !== 'busy') throw apiError('not-allowed', 'fromJob is only for confirmed busy rejection', 409);
      if ((!photo && !parent) || (photo && parent)) throw apiError('photo-invalid', 'One photo or one source job required');
      if (photo) {
      try {
        const metadata = await sharp(photo, {limitInputPixels: 64000000}).metadata();
        if (!['jpeg', 'png'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw Error('Expected one JPEG or PNG');
        // Force decode now; a truncated container is not a valid accepted photo.
        await sharp(photo, {limitInputPixels: 64000000}).stats();
      } catch { throw apiError('photo-invalid', 'Invalid JPEG/PNG or pixel limit'); }
      }
      const id = `j_${randomUUID()}`, folder = path.join(directory, id); await fs.mkdir(folder);
      if (photo) await keepPicture(photo, path.join(folder, 'photo.jpg'));
      else await fs.copyFile(path.join(directory, parent.job.id, 'photo.jpg'), path.join(folder, 'photo.jpg'));
      const j = {id, clientKey, createdAt: now(), status: parent?.job.recognition ? 'generating' : 'recognizing', recognition: parent?.job.recognition ? copy(parent.job.recognition) : null, steps: ['styled', 'model', 'download', 'process'].map(key => ({key, startedAt: null, endedAt: null})), estimateSeconds: 1, error: null, itemId: null, fromJob: fromJob ?? null, regenerateOf: regenerateOf ?? null};
      const record = {job: j, pending: false, providerId: null};
      if (parent) parent.usedBy = id;
      store.jobs[id] = record; store.keys[clientKey] = {id, fingerprint}; await save(); start(record); return publicJob(record);
    });
  }
  return {
    directory,
    create,
    get: id => serial(() => publicJob(get(id))),
    items: () => serial(() => copy(store.items)),
    quota: () => serial(() => ({limit: null, remaining: null, resetsAt: null, used: provider.used(), activeJobId: active()?.job.id ?? null})),
    retry: id => serial(async () => {
      const r = get(id), current = active();
      if (r.job.error?.retry !== 'same' || !r.providerId || r.pending) throw apiError('not-allowed', 'This job cannot be retried', 409);
      if (current && current !== r) throw apiError('active-job', 'A job is still active', 409, {activeJobId: current.job.id});
      r.job.error = null; r.job.status = 'generating'; await save(); start(r); return publicJob(r);
    }),
    file: (id, name) => serial(() => {
      if (!['model.glb', 'photo.jpg', 'styled.jpg'].includes(name)) throw apiError('not-found', 'No such file', 404);
      const item = store.items.find(i => i.id === id), record = Object.values(store.jobs).find(r => r.job.itemId === id);
      if (!item || !record) throw apiError('not-found', 'No such item', 404);
      return path.join(directory, record.job.id, name);
    }),
    async close() { closed = true; try { await runner; await chain; } finally { await release(); } }
  };
}
