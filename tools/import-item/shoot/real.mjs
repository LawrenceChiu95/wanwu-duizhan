import fs from 'node:fs/promises';
import path from 'node:path';
import {recognitionProxyHealth} from './proxy-health.mjs';
import {photoToGlb} from '../aholo.mjs';
import {prepareMesh, readGlb, sha256} from '../mesh.mjs';
import {photoMassLimit} from '../../../sim/item-rating.js';

import {recognizePhoto} from './recognition.mjs';
import {qwenBackup} from './qwen.mjs';
import {photoPrompt} from './prompt.mjs';
export {parseRecognition, recognitionPrompt, recognitionSchema} from './recognition.mjs';
const failure = (code, retryable = false) => Object.assign(Error(code), {code, retryable});
async function readPhoto(folder, jobId, now) {
  try { return await fs.readFile(path.join(folder, 'photo.jpg')); }
  catch (error) {
    const type = typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN';
    console.error('Shoot local photo read failed:', JSON.stringify({time: now(), jobId, type}));
    throw failure('photo-read');
  }
}
// Env-only secrets never enter the task record or an exception message. Injected
// fetch/pause exercise the same protocol with offline fixtures in contract tests.
export function realGenerator({env = process.env, fetch: request = globalThis.fetch, pause, timeoutMs = 15000, backupFetch, totalTimeoutMs} = {}) {
  const missing = ['GEMINI_API_KEY', 'AHOLO_API_KEY'].filter(k => !env[k]?.trim());
  if (missing.length) throw Error(`Real shoot provider requires environment: ${missing.join(', ')}`);
  const geminiKey = env.GEMINI_API_KEY.trim(), aholoKey = env.AHOLO_API_KEY.trim();
  const backup = qwenBackup(env);
  let submitting = false;
  return {
    real: true,
    health: () => recognitionProxyHealth(env),
    waitingForPaidId: () => submitting,
    async recognize(_template, context) {
      const {state, save, folder, jobId, now} = context;
      if (state.recognitionPending) throw failure('recognition-interrupted');
      state.recognitionPending = true; await save();
      return recognizePhoto({photo: await readPhoto(folder, jobId, now), key: geminiKey, fetch: request, timeoutMs, pause, backup, backupFetch, totalTimeoutMs, diagnose: event => console.error('Shoot recognition attempt:', JSON.stringify({...event, time: now(), jobId}))});
    },
    charged: state => Boolean(state?.pending || Object.keys(state?.tasks ?? {}).length),
    async step(step, jobId, context, catalog) {
      const {state, folder, save, recognition, allowCreate, signal, mountRules, checkFailedCredits, now} = context;
      if (step !== 'process') {
        // Only a stage without an accepted ID or pending submission may submit;
        // free resume can finish that first submission (Elara 0e7833a1).
        try {
          const photo = await readPhoto(folder, jobId, now);
          const prompt = photoPrompt(recognition.name ?? recognition.category);
          for (;;) {
            try {
              await photoToGlb({photo, key: aholoKey, prompt, folder, state, save, fetch: request, pause, now, stopAfter: step, allowCreate, allowFirstSubmit: !allowCreate, signal, checkFailedCredits, onCreate: value => { submitting = value; }});
              break;
            } catch (error) {
              if (!error.uploadStep) throw error;
              const retry = error.transient && !state.uploadRetried;
              console.error('Shoot photo upload failed:', JSON.stringify({
                time: now(), jobId, step: error.uploadStep, attempt: state.uploadRetried ? 2 : 1,
                reason: error.reason ?? 'upstream-reply', status: error.status, retry: Boolean(retry)
              }));
              if (!retry) throw error;
              // Share a durable retry allowance across both styled/model steps and restarts.
              state.uploadRetried = true;
              await save();
            }
          }
        } catch (error) {
          const hasTask = Object.keys(state.tasks).length > 0;
          if (error.code === 'busy' && state.pending) {
            throw Object.assign(failure(hasTask ? 'download' : 'busy', true), {creationRejected: state.pending});
          }
          if (state.pending) throw failure('unknown-submit');
          if (error.code === 'step-failed') throw Object.assign(error, {retryable: Boolean(error.retryTask)});
          if (error.code === 'busy') throw failure(hasTask ? 'download' : 'busy');
          throw failure(hasTask ? 'download' : 'photo-upload');
        }
        return;
      }
      try {
        // Old stored recognitions can finish with their original template. New
        // photos have their own identity, physical estimates and mesh geometry.
        const unrestricted = typeof recognition.name === 'string';
        const lengthMeters = Math.min(.8, recognition.lengthMeters);
        const massKg = unrestricted ? Math.min(photoMassLimit(catalog), recognition.massKg) : recognition.massKg;
        const template = unrestricted ? {id: 'photo', category: 'photo', outwardEnd: recognition.outwardEnd, weakPoint: {radius: lengthMeters * .06}} : catalog.items.find(i => i.category === recognition.category && !i.generated && !i.comparisonBase);
        if (!template) throw Error('Missing legacy category template');
        // Preserve the original paid model before replacing the served asset.
        const source = path.join(folder, 'source.glb');
        const storedBytes = async file => {
          if ((await fs.stat(file)).size > 64 * 1024 * 1024) throw failure('process-too-large');
          return fs.readFile(file);
        };
        let saved;
        try { saved = await storedBytes(source); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!saved || sha256(saved) !== state.downloadSha256) {
          const model = path.join(folder, 'model.glb');
          let original;
          try { original = await storedBytes(model); }
          catch (error) { if (error.code === 'ENOENT') throw failure('process-corrupt'); throw error; }
          if (sha256(original) !== state.downloadSha256) throw failure('process-corrupt');
          // A crash can leave only a partial temporary copy. The original model
          // remains intact until the full source copy has been committed.
          await fs.copyFile(model, source + '.part');
          await fs.rename(source + '.part', source);
        }
        const raw = await readGlb(source);
        if (sha256(raw) !== state.downloadSha256) throw failure('process-corrupt');
        const prepared = await prepareMesh(raw, {...template, outEnd: mountRules.top.outEnd[template.id] ?? 1}, {longSideMeters: lengthMeters, massKg, preserveUp: unrestricted});
        if (!unrestricted) {
          const templateLength = Math.max(...template.bounds.max.map((v, i) => v - template.bounds.min[i]));
          prepared.shape.weakPoint.radius *= lengthMeters / templateLength;
        }
        state.orientation = prepared.shape.normalization.orientation; await save();
        await fs.writeFile(path.join(folder, 'model.glb'), prepared.bytes);
        return {name: recognition.name ?? `我拍的${({scissors:"剪刀",pot:"锅",broom:"扫把",lamp:"台灯",slipper:"拖鞋",pillow:"枕头"})[recognition.category]}`, category: recognition.category, ...(unrestricted ? {materialName: recognition.materialName, photoPhysics: {hardness: recognition.hardness,
            ...(recognition.impactHardness === undefined ? {} : {hasBladeOrPoint: recognition.hasBladeOrPoint, impactHardness: recognition.impactHardness})}} : {templateId: template.id}),
          generated: true, scale: 1, outEnd: 1, tag: unrestricted ? 'photo' : template.tag, stats: unrestricted ? {hp: 60, attack: 11, defense: 4} : structuredClone(template.stats),
          material: recognition.material, condition: recognition.condition, mass: massKg,
          massBasis: 'photo-estimate', standardLongSide: lengthMeters, ...prepared.shape,
          source: {generator: 'Aholo G1-Turbo', license: 'LicenseRef-UserProvided', sourceSha256: sha256(raw), normalizedSha256: prepared.report.sha256,
            preparation: {triangles: prepared.report.triangles, textureSizes: prepared.report.textureSizes}}};
      } catch (error) {
        const code = ['process-corrupt', 'process-too-large'].includes(error.code) ? error.code : error.code ? 'process' : 'process-unfixable';
        throw failure(code);
      }
    }
  };
}
