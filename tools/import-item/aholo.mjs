import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {sha256} from './mesh.mjs';
import {keepPicture} from './origin.mjs';

const BASE = 'https://api.aholo.ai/global';
function https(value) {
  let url; try { url = new URL(value); } catch { throw Error('Missing or invalid asset URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('Asset URLs must use HTTPS without embedded credentials');
  return url.href;
}
async function limitedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw Error('Response exceeds size limit');
  const parts = []; let size = 0;
  for await (const chunk of response.body ?? []) { size += chunk.length; if (size > limit) throw Error('Response exceeds size limit'); parts.push(chunk); }
  return Buffer.concat(parts);
}
function unwrap(reply) {
  const code = String(reply?.c ?? 'unknown');
  if (code === 'GENERATION_CONCURRENCY_LIMIT_EXCEEDED') throw Object.assign(Error('GENERATION_CONCURRENCY_LIMIT_EXCEEDED; no task created'), {code: 'busy'});
  if (code !== '0') throw Error(`Aholo business error ${/^[A-Za-z0-9_-]{1,96}$/.test(code) ? code : 'unknown'}; check task history. No generation retry.`);
  return reply.d;
}

// Only credential-free asset GETs may redirect. Every hop is checked, including
// relative Location values; API and upload requests keep redirect:'error'.
async function download(url, file, request, cancelled) {
  const signal = cancelled ? AbortSignal.any([cancelled, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
  signal.throwIfAborted();
  let current = https(url), response;
  for (let hop = 0; hop <= 5; hop++) {
    try { response = await request(current, {method: 'GET', headers: {}, redirect: 'manual', credentials: 'omit', signal}); }
    catch { throw Error('Asset download failed. Existing tasks and received .part bytes are kept; rerun only downloads again.'); }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location || hop === 5) throw Error('Asset redirect missing or exceeds five hops; existing tasks are kept');
    let next; try { next = new URL(location, current).href; } catch { throw Error('Invalid asset redirect'); }
    current = https(next);
  }
  if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP ${response.status}; check the existing task in the Aholo console. No generation retry.`); }
  if (!response.body) throw Error('Asset response has no body; existing tasks are kept');
  const partial = `${file}.part`, handle = await fs.open(partial, 'w'), hash = crypto.createHash('sha256');
  try {
    for await (const chunk of response.body) { await handle.writeFile(chunk); hash.update(chunk); }
  } catch { throw Error('Asset download interrupted. Received .part bytes and existing tasks are kept; rerun only downloads again.'); }
  finally { await handle.close(); }
  // Save the complete paid result before format/size validation, including files
  // that our importer rejects. Streaming avoids loading oversized results in RAM.
  await fs.rename(partial, file);
  return hash.digest('hex');
}

/** The key is only attached to the fixed official API gateway, never result/upload URLs. */
export async function photoToGlb({photo, key, prompt, folder, state, save, fetch: request = globalThis.fetch, pause, now = () => new Date().toISOString(), stopAfter = 'download', allowCreate = true, allowFirstSubmit = false, signal, onCreate, checkFailedCredits = false}) {
  const waitPause = async ms => {
    signal?.throwIfAborted();
    if (!pause) return sleep(ms, undefined, {signal});
    let stop;
    const cancelled = new Promise((_, reject) => { stop = () => reject(signal.reason); signal?.addEventListener('abort', stop, {once: true}); });
    try { await Promise.race([pause(ms), cancelled]); } finally { signal?.removeEventListener('abort', stop); }
    signal?.throwIfAborted();
  };
  const send = async (url, {headers = {}, method = 'GET', body, cancelOnClose = true} = {}) => {
    const target = https(url);
    let response;
    try {
      if (cancelOnClose) signal?.throwIfAborted();
      response = await request(target, {method, headers, body, redirect: 'error', signal: cancelOnClose && signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)});
    }
    catch (error) {
      const timeout = error.name === 'TimeoutError';
      throw Object.assign(Error('Network request failed. Existing task IDs and pending flags are kept; rerun to resume, never recreate blindly.'), {
        transient: timeout || error instanceof TypeError, reason: timeout ? 'timeout' : 'transport'
      });
    }
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      throw Object.assign(Error(`HTTP ${status}; existing tasks are kept; no generation retry.`), {
        transient: status >= 500 || status === 408 || status === 429, reason: 'http', status
      });
    }
    return response;
  };
  const json = async (url, options) => {
    const response = await send(url, options);
    let bytes;
    try { bytes = await limitedBody(response, 1024 * 1024); }
    catch (error) {
      const timeout = error.name === 'TimeoutError';
      throw Object.assign(Error('Could not read the API reply. Pending task creation is not retried.'), {
        transient: timeout || error instanceof TypeError, reason: timeout ? 'timeout' : 'response-read'
      });
    }
    try { return JSON.parse(bytes.toString()); }
    catch { throw Error('Invalid API reply; check the console. Pending task creation is not retried.'); }
  };
  const api = (route, payload, cancelOnClose = true) => json(BASE + route, {headers: {Authorization: key, ...(payload ? {'Content-Type': 'application/json'} : {})}, ...(payload ? {method: 'POST', body: JSON.stringify(payload)} : {}), cancelOnClose});
  const stamp = async name => { state.timestamps[name] ??= now(); await save(); };
  const create = async (stage, payload, timestamp) => {
    if (state.pending) throw Error(`Unconfirmed ${state.pending} creation. Check Aholo task history and record its ID before any retry; do not clear pending and resubmit blindly.`);
    signal?.throwIfAborted();
    if (state.tasks[stage]) throw Error('This stage already has a task ID; resume it instead of creating another');
    if (!allowCreate && !allowFirstSubmit) throw Error('First submission is not enabled for this resume');
    if (state.busyRetry?.stage === stage) {
      const remaining = state.busyRetry.notBefore - Date.parse(now());
      if (remaining > 0) await waitPause(remaining);
    }
    state.pending = stage; await stamp(timestamp);
    // Shutdown can arrive while the pending marker is being saved. No request
    // has left yet, so remove that marker and leave the first submit for restart.
    if (signal?.aborted) { delete state.pending; await save(); signal.throwIfAborted(); }
    // Once sent, collect the paid task ID even during shutdown. The request still
    // has its 120-second timeout; only polling/uploads obey the close signal.
    onCreate?.(true);
    try {
      const id = unwrap(await api(`/lux3d/v1/generate/${stage}/task/create`, payload, false));
      if (!['number', 'string'].includes(typeof id) || !/^[A-Za-z0-9_-]{1,128}$/.test(String(id))) throw Error('Creation reply has no valid task ID; pending is kept. Check the console before retrying.');
      state.tasks[stage] = id; delete state.pending; await save();
    } finally { onCreate?.(false); }
  };
  const refunded = async (id, submittedAt) => {
    const submitted = Date.parse(submittedAt);
    if (!Number.isFinite(submitted)) return false;
    try {
      const query = new URLSearchParams({status: '4', pagesize: '100', starttime: String(submitted - 300_000)});
      const history = unwrap(await api(`/lux3d/v1/generate/task/list?${query}`));
      const entry = Array.isArray(history?.items) && history.items.find(item => String(item?.taskId) === String(id));
      return entry?.status === 4 && entry.consumedCredits === 0;
    } catch { return false; }
  };
  const wait = async (stage, timestamp, submitTimestamp) => {
    const id = state.tasks[stage];
    for (let i = 0; i < 240; i++) {
      signal?.throwIfAborted();
      let detail;
      // Only read-only queries are retried, never creation. A bare HTTP 404,
      // permission error or unknown reply does not prove this paid task expired.
      for (let attempt = 0; ; attempt++) {
        try { detail = unwrap(await api(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(id)}`)); break; }
        catch (error) { signal?.throwIfAborted(); if (attempt === 3) throw error; await waitPause(1000 * 2 ** attempt); }
      }
      if (detail?.status === 3) { if (!Array.isArray(detail.outputs)) throw Error('Completed task has no output list'); await stamp(timestamp); return detail.outputs; }
      if ([4, 6].includes(detail?.status)) {
        const error = Object.assign(Error('Existing generation task failed or was canceled'), {code: 'step-failed'});
        if (detail.status === 4 && checkFailedCredits && await refunded(id, state.timestamps[submitTimestamp])) error.retryTask = {stage, id};
        throw error;
      }
      if (![0, 1].includes(detail?.status)) throw Error('Unknown task status; stop without creating a new task');
      await waitPause(10000);
    }
    throw Error('Polling timed out. Rerun to poll the same task; no new generation is needed.');
  };
  if (state.pending) throw Error(`Unconfirmed ${state.pending} creation. Check Aholo task history before resuming; no new task was submitted.`);
  const model = path.join(folder, 'model.glb');
  if (stopAfter === 'styled' && state.styledSha256) return path.join(folder, 'styled.jpg');
  // Validation belongs to the caller for both first download and cached reruns,
  // so rejected paid files always receive the same manual-recovery instructions.
  if (state.timestamps.download_finished) return model;
  const imageStage = 'multimodal-to-image', meshStage = 'img-to-3d';
  if (!state.tasks[meshStage]) {
    if (!state.tasks[imageStage] && !state.tasks[meshStage]) {
      if (!state.photoUrl) {
        await stamp('upload_started');
        let uploadStep = 'credential';
        try {
          const token = await api('/asset/v1/token');
          if (!token?.ousToken || !Number.isSafeInteger(Number(token.blockSize)) || Number(token.blockSize) <= 0) throw Error('Invalid upload token reply');
          const domain = https(token.globalDomain).replace(/\/$/, ''), headers = {'ous-token-v2': token.ousToken};
          const md5 = crypto.createHash('md5').update(photo).digest('hex'), size = Number(token.blockSize);
          uploadStep = 'send-file';
          const part = async (route, fields, content) => {
            const form = new FormData(); for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
            form.append('file', new Blob([content], {type: 'application/octet-stream'}), 'photo.jpg');
            unwrap(await json(domain + route, {method: 'POST', headers, body: form}));
          };
          if (photo.length > size) {
            const query = new URLSearchParams({md5, blocks: String(Math.ceil(photo.length / size)), size: String(photo.length), name: 'photo.jpg'});
            const init = unwrap(await json(`${domain}/ous/api/v2/block/upload/init?${query}`, {method: 'POST', headers}));
            if (!init?.deduplicated) for (let offset = 0; offset < photo.length; offset += size) await part('/ous/api/v2/block/upload/part', {block: offset / size + 1}, photo.subarray(offset, offset + size));
          } else await part('/ous/api/v2/single/upload', {md5}, photo);
          uploadStep = 'poll-status';
          for (let i = 0; i < 150; i++) {
            const detail = unwrap(await json(`${domain}/ous/api/v2/upload/status`, {headers}));
            if (detail?.status === 5 && detail.url) { state.photoUrl = https(detail.url); break; }
            if ([6, 8].includes(detail?.status)) throw Error('Photo upload failed');
            await waitPause(2000);
          }
          if (!state.photoUrl) throw Object.assign(Error('Photo upload timed out; no generation was submitted'), {transient: true, reason: 'timeout'});
        } catch (error) {
          signal?.throwIfAborted();
          throw Object.assign(error, {uploadStep});
        }
        await stamp('upload_finished');
      }
      await create(imageStage, {img: state.photoUrl, prompt}, 'image_submit');
    }
    if (!state.tasks[imageStage]) throw Error('Existing model task has no image task record; restore its history, never regenerate blindly');
    const outputs = await wait(imageStage, 'image_success_observed', 'image_submit');
    // Current multimodal-to-image contract returns the styled image first.
    const styled = https(outputs[0]?.content);
    if (!state.styledSha256) {
      const styledFile = path.join(folder, 'styled-download');
      if (!state.styledDownloadSha256) { state.styledDownloadSha256 = await download(styled, styledFile, request, signal); await save(); }
      if ((await fs.stat(styledFile)).size > 32 * 1024 * 1024) throw Error('Styled image exceeds 32 MiB; the result is kept in styled-download for manual recovery');
      const bytes = await fs.readFile(styledFile);
      if (sha256(bytes) !== state.styledDownloadSha256) throw Error('Saved styled download changed; restore it before importing');
      state.styledSha256 = sha256(await keepPicture(bytes, path.join(folder, 'styled.jpg'))); state.styledFile = 'styled.jpg'; await save();
    }
    if (stopAfter === 'styled') return path.join(folder, 'styled.jpg');
    if (!state.tasks[meshStage]) await create(meshStage, {img: styled, version: 'G1-Turbo', faceCount: 12000, enablePbr: true, outputFormat: ['zip', 'glb'], aiPredictSize: false}, 'mesh_submit');
  }
  const outputs = await wait(meshStage, 'mesh_success_observed', 'mesh_submit');
  if (stopAfter === 'model') return null;
  // Pick by explicit format or pathname, never a fixed output position.
  const output = outputs.find(x => String(x.format ?? x.type ?? '').toLowerCase() === 'glb' || (() => { try { return new URL(x.content).pathname.toLowerCase().endsWith('.glb'); } catch { return false; } })());
  if (!output) throw Error('Completed task has no identifiable GLB output; check its formats without creating another task');
  state.downloadSha256 = await download(output.content, model, request, signal); await stamp('download_finished');
  return model;
}
