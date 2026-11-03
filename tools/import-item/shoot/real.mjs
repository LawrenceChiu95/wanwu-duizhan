import fs from 'node:fs/promises';
import path from 'node:path';
import {photoToGlb} from '../aholo.mjs';
import {prepareMesh, readGlb, sha256} from '../mesh.mjs';

import {recognizePhoto} from './recognition.mjs';
export {parseRecognition, recognitionPrompt, recognitionSchema} from './recognition.mjs';
const failure = code => Object.assign(Error(code), {code});
async function readPhoto(folder) {
  try { return await fs.readFile(path.join(folder, 'photo.jpg')); }
  catch (error) {
    const type = typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN';
    console.error('Shoot local photo read failed:', type);
    throw failure('photo-read');
  }
}
// Env-only secrets never enter the task record or an exception message. Injected
// fetch/pause exercise the same protocol with offline fixtures in contract tests.
export function realGenerator({env = process.env, fetch: request = globalThis.fetch, pause, timeoutMs = 10000} = {}) {
  const missing = ['GEMINI_API_KEY', 'AHOLO_API_KEY'].filter(k => !env[k]?.trim());
  if (missing.length) throw Error(`Real shoot provider requires environment: ${missing.join(', ')}`);
  const geminiKey = env.GEMINI_API_KEY.trim(), aholoKey = env.AHOLO_API_KEY.trim();
  let submitting = false;
  return {
    real: true,
    waitingForPaidId: () => submitting,
    async recognize(_template, context) {
      const {state, save, folder} = context;
      if (state.recognitionPending) throw failure('recognition-interrupted');
      state.recognitionPending = true; await save();
      return recognizePhoto({photo: await readPhoto(folder), key: geminiKey, fetch: request, timeoutMs});
    },
    charged: state => Boolean(state?.pending || Object.keys(state?.tasks ?? {}).length),
    async step(step, _id, context, catalog) {
      const {state, folder, save, recognition, allowCreate, signal, mountRules} = context;
      if (step !== 'process') {
        // Each stage may submit once when it has neither an ID nor pending;
        // free resume can finish that first submission (Elara 0e7833a1).
        try {
          const photo = await readPhoto(folder);
          const prompt = `把参考照片的主要物品改成废土朋克游戏道具。照片里的${recognition.name ?? recognition.category}是什么就保留什么。保留照片原物件的轮廓、比例、主要结构和材质特征，不替换成标准样本。少量工业黄漆、警示纹、划痕和旧布。不要加第二件物品、人体、背景、尖刺或夸大结构。完整单件，浅灰背景，均匀柔光。`;
          await photoToGlb({photo, key: aholoKey, prompt, folder, state, save, fetch: request, pause, stopAfter: step, allowCreate, allowFirstSubmit: !allowCreate, signal, onCreate: value => { submitting = value; }});
        } catch (error) {
          if (error.code === 'busy' && state.pending) { delete state.pending; await save(); }
          if (state.pending) throw failure('unknown-submit');
          if (error.code === 'busy' && !Object.keys(state.tasks).length) throw failure('busy');
          if (error.code === 'step-failed') throw failure('step-failed');
          if (!Object.keys(state.tasks).length) throw failure('photo-upload');
          throw failure('download');
        }
        return;
      }
      try {
        // Old stored recognitions can finish with their original template. New
        // photos have their own identity, physical estimates and mesh geometry.
        const unrestricted = typeof recognition.name === 'string';
        const lengthMeters = Math.min(.8, recognition.lengthMeters);
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
        const prepared = await prepareMesh(raw, {...template, outEnd: mountRules.top.outEnd[template.id] ?? 1}, {longSideMeters: lengthMeters, massKg: recognition.massKg});
        if (!unrestricted) {
          const templateLength = Math.max(...template.bounds.max.map((v, i) => v - template.bounds.min[i]));
          prepared.shape.weakPoint.radius *= lengthMeters / templateLength;
        }
        state.orientation = prepared.shape.normalization.orientation; await save();
        await fs.writeFile(path.join(folder, 'model.glb'), prepared.bytes);
        return {name: recognition.name ?? `我拍的${({scissors:"剪刀",pot:"锅",broom:"扫把",lamp:"台灯",slipper:"拖鞋",pillow:"枕头"})[recognition.category]}`, category: recognition.category, ...(unrestricted ? {materialName: recognition.materialName, photoPhysics: {hardness: recognition.hardness}} : {templateId: template.id}),
          generated: true, scale: 1, outEnd: 1, tag: unrestricted ? 'photo' : template.tag, stats: unrestricted ? {hp: 60, attack: 11, defense: 4} : structuredClone(template.stats),
          material: recognition.material, condition: recognition.condition, mass: recognition.massKg,
          massBasis: 'photo-estimate', standardLongSide: lengthMeters, ...prepared.shape,
          source: {generator: 'Aholo G1-Turbo', license: 'LicenseRef-UserProvided', sourceSha256: sha256(raw), normalizedSha256: prepared.report.sha256,
            preparation: {triangles: prepared.report.triangles, textureSizes: prepared.report.textureSizes}}};
      } catch (error) {
        const code = ['process-corrupt', 'process-too-large'].includes(error.code) ? error.code : error.code ? 'process' : 'process-unfixable';
        if (code === 'process-too-large' || code === 'process-corrupt') console.error('Shoot processing failed:', code);
        throw failure(code);
      }
    }
  };
}
