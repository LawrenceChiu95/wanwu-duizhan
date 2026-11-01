import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {sha256} from './mesh.mjs';

// Re-encode pixels rather than copying metadata containers. rotate() applies EXIF
// orientation before Sharp drops EXIF, GPS, XMP, IPTC and embedded thumbnails.
export async function keepPicture(bytes, file) {
  // Resize before encoding/uploading; camera JPEGs above 64 MP can use decoder
  // shrink-on-load. Keep a finite decode bound for untrusted image headers.
  const image = sharp(bytes, {limitInputPixels: 256000000});
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages ?? 1) > 1) throw Error('Replay picture must be a single JPEG, PNG or WebP image');
  const clean = await image.rotate().resize({width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true}).flatten({background: '#ffffff'}).jpeg({quality: 85}).toBuffer();
  await writeExclusive(file, clean);
  return clean;
}

async function writeExclusive(file, bytes) {
  try { await fs.writeFile(file, bytes, {flag: 'wx'}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (sha256(await fs.readFile(file)) !== sha256(bytes)) throw Error('Saved replay picture differs; it was not overwritten');
  }
}

// Called with the catalog lock held, after the model is ready. Legacy runs with
// missing pictures/timestamps and GLB imports get no invented replay record.
export async function writeOrigin(root, id, folder, state, now) {
  if (!state.photoSha256 || !state.styledSha256) return null;
  let photos;
  try { photos = await Promise.all(['photo', 'styled'].map(name => fs.readFile(path.join(folder, state[`${name}File`] === `${name}.jpg` ? `${name}.jpg` : `${name}.png`)))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (let i = 0; i < photos.length; i++) if (sha256(photos[i]) !== state[i === 0 ? 'photoSha256' : 'styledSha256']) return null;
  const before = ['upload_started', 'upload_finished', 'image_submit', 'image_success_observed', 'mesh_submit', 'mesh_success_observed', 'download_finished'].map(key => Date.parse(state.timestamps[key]));
  if (before.some((value, i) => !Number.isFinite(value) || (i && value < before[i - 1]))) return null;
  const directory = path.join(root, 'data', 'origins', id);
  await fs.mkdir(directory, {recursive: true});
  for (let i = 0; i < photos.length; i++) await keepPicture(photos[i], path.join(directory, `${i === 0 ? 'photo' : 'styled'}.jpg`));
  const ready = state.timestamps.inventory_ready ?? now();
  if (!Number.isFinite(Date.parse(ready)) || Date.parse(ready) < before.at(-1)) return null;
  const times = {...state.timestamps, inventory_ready: ready};
  // The timestamp is the inventory commit boundary, after asset writes, just
  // before the atomic catalog rename; retries preserve the first completed run.
  state.timestamps.inventory_ready = ready;
  return {photo: `data/origins/${id}/photo.jpg`, styled: `data/origins/${id}/styled.jpg`, steps: [
    ['photo', 'upload_started', 'image_submit'],
    ['styled', 'image_submit', 'mesh_submit'],
    ['model', 'mesh_submit', 'inventory_ready']
  ].map(([key, start, end]) => ({key, seconds: (Date.parse(times[end]) - Date.parse(times[start])) / 1000}))};
}
