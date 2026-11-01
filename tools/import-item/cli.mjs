import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {readGlb, prepareMesh, sha256} from './mesh.mjs';
import {photoToGlb} from './aholo.mjs';
import {keepPicture, writeOrigin} from './origin.mjs';
import {timestamps, readJson, saveJson, withLock} from './state.mjs';

export const CATEGORIES = ['scissors', 'pot', 'broom', 'lamp', 'slipper', 'pillow'];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const slug = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
const help = `Node 22: npm ci --prefix tools/import-item
node tools/import-item/cli.mjs glb --glb <file.glb> --category <category> --id <new-id> --name <name>
node tools/import-item/cli.mjs photo --photo <photo.jpg|png> --category <category> --id <new-id> --name <name>
Categories: ${CATEGORIES.join(', ')}. Optional: --prompt <file.txt>, --run <run-id>.
photo reads AHOLO_API_KEY from the environment and creates PAID tasks. Unknown creation results STOP.
Private state: .aholo/runs/<run-id>/state.json. photo defaults to a fingerprint of photo/prompt/category; glb defaults to id.
Repeat to resume; name/id do not change a photo run. Never clear pending blindly.`;

export function argumentsFor(argv) {
  if (!argv.length || argv.includes('--help')) return null;
  const [mode, ...rest] = argv;
  if (!['photo', 'glb'].includes(mode)) throw Error('Choose photo or glb mode; use --help');
  const args = {mode};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!['--photo', '--glb', '--category', '--id', '--name', '--prompt', '--run'].includes(flag) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw Error('Unknown option or missing value; use --help');
    const key = flag.slice(2); if (args[key] !== undefined) throw Error(`Duplicate option ${flag}`); args[key] = rest[i + 1];
  }
  if (!CATEGORIES.includes(args.category)) throw Error('Choose an existing category; use --help');
  if (!slug(args.id) || (args.run !== undefined && !slug(args.run))) throw Error('id and run must be 1–48 lowercase letters, digits or hyphens, starting with a letter');
  if (!args.name?.trim() || [...args.name].length > 40 || /[\u0000-\u001f\u007f]/.test(args.name)) throw Error('name must be 1–40 visible characters');
  if (!args[mode] || args[mode === 'photo' ? 'glb' : 'photo'] || (mode === 'glb' && args.prompt)) throw Error('Supply only the input for the selected mode');
  return {...args, name: args.name.trim(), run: args.run ?? (mode === 'glb' ? args.id : undefined)};
}

async function sourcePhoto(file) {
  if ((await fs.stat(file)).size > 32 * 1024 * 1024) throw Error('Photo exceeds 32 MiB');
  const bytes = await fs.readFile(file);
  const meta = await sharp(bytes, {limitInputPixels: 64000000}).metadata();
  if (!['jpeg', 'png'].includes(meta.format)) throw Error('Photo must be JPEG or PNG');
  return bytes;
}

/** CLI dispatch is also the isolated fake-interface test entry; production uses the defaults. */
export async function runCli(argv, {repoRoot = ROOT, env = process.env, fetch, pause, now = () => new Date().toISOString(), log = console.log} = {}) {
  const args = argumentsFor(argv); if (!args) { log(help); return null; }
  const root = path.resolve(repoRoot), catalogFile = path.join(root, 'data', 'catalog.json');
  const initialCatalog = await readJson(catalogFile);
  const template = initialCatalog.items.find(i => i.category === args.category && !i.generated && !i.comparisonBase);
  const standard = initialCatalog.itemStandards[args.category];
  if (!template || !standard) throw Error('Category template is missing from catalog');
  const raw = args.mode === 'photo' ? await sourcePhoto(path.resolve(args.photo)) : await readGlb(path.resolve(args.glb));
  const promptFile = args.mode === 'photo' ? (args.prompt ? path.resolve(args.prompt) : fileURLToPath(new URL(`./prompts/${args.category}.txt`, import.meta.url))) : null;
  const prompt = promptFile ? (await fs.readFile(promptFile, 'utf8')).trim() : null;
  if (promptFile && (!prompt || Buffer.byteLength(prompt) > 32000)) throw Error('Prompt is empty or exceeds 32 KiB');
  // Paid work depends on the photo, prompt and category, never catalog metadata.
  const identity = {mode: args.mode, ...(args.mode === 'glb' ? {id: args.id, name: args.name} : {}), category: args.category, sourceSha256: sha256(raw), promptSha256: prompt ? sha256(prompt) : null};
  const runId = args.run ?? `photo-${sha256(JSON.stringify(identity)).slice(0, 24)}`;
  const folder = path.join(root, '.aholo', 'runs', runId); await fs.mkdir(folder, {recursive: true});
  return withLock(path.join(folder, 'lock'), async () => {
    const stateFile = path.join(folder, 'state.json');
    let state = await readJson(stateFile);
    const sameInput = state && (args.mode === 'photo' ? Object.keys(identity).every(k => state.input?.[k] === identity[k]) : JSON.stringify(state.input) === JSON.stringify(identity));
    if (state && !sameInput) throw Error('Run input changed. Restore its original photo/model, prompt and category to resume; use a new run only for intentionally new work');
    state ??= {schemaVersion: 1, input: identity, tasks: {}, timestamps: timestamps()};
    state.input = identity; // Also drops id/name from pre-review photo state when --run selects it.
    const save = () => saveJson(stateFile, state); await save();
    const catalog = await readJson(catalogFile);
    const existing = catalog.items.find(i => i.id === args.id);
    if (existing && !(state.prepared && existing.source?.importRun === runId && existing.source.normalizedSha256 === state.prepared.sha256 && existing.source.sourceSha256 === state.prepared.sourceSha256)) throw Error('Item ID already exists; original items are never overwritten');
    const destination = path.join(root, 'data', 'models', 'generated', `${args.id}.glb`);
    if (existing) {
      if (sha256(await fs.readFile(destination)) !== existing.source.normalizedSha256) throw Error('Existing imported asset changed');
      if (existing.name !== args.name) await withLock(path.join(root, '.aholo', 'catalog-lock'), async () => {
        const current = await readJson(catalogFile), item = current.items.find(i => i.id === args.id);
        if (JSON.stringify(item) !== JSON.stringify(existing)) throw Error('Imported item changed concurrently; name was not overwritten');
        item.name = args.name; await saveJson(catalogFile, current);
      });
      state.timestamps.inventory_ready ??= now(); await save();
      const result = {id: args.id, run: runId, alreadyImported: true, ...state.prepared}; log(JSON.stringify(result)); return result;
    }
    let model = raw;
    let photo = raw;
    if (args.mode === 'photo') {
      photo = await keepPicture(raw, path.join(folder, 'photo.png'));
      state.photoSha256 = sha256(photo); await save();
    }
    if (args.mode === 'photo') {
      const key = env.AHOLO_API_KEY?.trim();
      if (!key && !state.timestamps.download_finished) throw Error('Set AHOLO_API_KEY in the environment for photo mode; no key file is read');
      let file;
      try { file = await photoToGlb({photo, key, prompt, folder, state, save, fetch, pause, now}); }
      catch (error) { throw Error(`Run ${runId}: ${error.message}`); }
      try { model = await readGlb(file); }
      catch (error) { throw Error(`${error.message}. Paid result kept at .aholo/runs/${runId}/model.glb; prepare it manually and use glb mode. No generation retry.`); }
    }
    const prepared = await prepareMesh(model, template, standard);
    state.prepared = {...prepared.report, sourceSha256: sha256(model)}; await save();
    // Category properties are copied, never inferred from a generated mesh's appearance.
    const item = {id: args.id, name: args.name, category: args.category, templateId: template.id, generated: true, glb: `data/models/generated/${args.id}.glb`, tag: template.tag, material: template.material, stats: structuredClone(template.stats), mass: standard.massKg, massBasis: 'category', standardLongSide: standard.longSideMeters, ...prepared.shape, source: {generator: args.mode === 'photo' ? 'Aholo G1-Turbo' : 'user-supplied GLB', license: 'LicenseRef-UserProvided', sourceSha256: sha256(model), normalizedSha256: prepared.report.sha256, importRun: runId, preparation: {triangles: prepared.report.triangles, textureSizes: prepared.report.textureSizes}}};
    await withLock(path.join(root, '.aholo', 'catalog-lock'), async () => {
      const current = await readJson(catalogFile);
      if (current.items.some(i => i.id === args.id)) throw Error('Item ID was imported concurrently; no item overwritten');
      // Reject a category change during preparation rather than silently mixing rule snapshots.
      const currentTemplate = current.items.find(i => i.id === template.id);
      if (JSON.stringify(currentTemplate) !== JSON.stringify(template) || JSON.stringify(current.itemStandards[args.category]) !== JSON.stringify(standard)) throw Error('Category changed during preparation; rerun after checking catalog');
      await fs.mkdir(path.dirname(destination), {recursive: true});
      try { await fs.writeFile(destination, prepared.bytes, {flag: 'wx'}); }
      catch (e) { if (e.code !== 'EEXIST') throw e; if (sha256(await fs.readFile(destination)) !== state.prepared.sha256) throw Error('Destination model exists and differs; it was not overwritten'); }
      if (args.mode === 'photo') {
        const origin = await writeOrigin(root, args.id, folder, state, now);
        if (origin) item.origin = origin;
      }
      state.timestamps.inventory_ready ??= now();
      current.items.push(item); await saveJson(catalogFile, current);
    });
    await save();
    const result = {id: args.id, run: runId, ...prepared.report}; log(JSON.stringify(result)); return result;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(error => {
    // No stacks, request objects or response bodies in public CLI output.
    let message = String(error.message ?? 'Import failed');
    const key = process.env.AHOLO_API_KEY?.trim(); if (key) message = message.replaceAll(key, '[redacted]');
    message = message.replace(/https?:\/\/\S+/g, '[asset URL]');
    console.error(message); process.exitCode = 1;
  });
}
