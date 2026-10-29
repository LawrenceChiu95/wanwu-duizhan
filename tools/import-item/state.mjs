import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const timestamps = () => Object.fromEntries(['upload_started', 'upload_finished', 'image_submit', 'image_success_observed', 'mesh_submit', 'mesh_success_observed', 'download_finished', 'inventory_ready'].map(k => [k, null]));
export async function readJson(file, missing = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return missing; throw e; }
}
export async function saveJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  await fs.rename(temporary, file);
}
export async function withLock(directory, work) {
  try { await fs.mkdir(directory); } catch (e) { if (e.code === 'EEXIST') throw Error(`Lock already exists: ${path.basename(path.dirname(directory))}/${path.basename(directory)}. Check that no importer is running before removing the empty lock directory.`); throw e; }
  try { return await work(); } finally { await fs.rmdir(directory); }
}
