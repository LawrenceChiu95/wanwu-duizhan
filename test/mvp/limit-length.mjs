// One-time, repeatable migration of existing normalized assets to current category dimensions.
// No simplification/reorientation: preserve the GLB binary buffers and scale the scene root uniformly.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {validateGlb} from '../../tools/import-item/mesh.mjs';
const root = new URL('../../', import.meta.url);
const standards = JSON.parse(await fs.readFile(new URL('data/item-standards.json', root), 'utf8'));
const catalogFile = new URL('data/catalog.json', root);
const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
for (const item of catalog.items) {
  const standard = standards[item.category];
  const span = Math.max(...item.bounds.max.map((v, i) => v - item.bounds.min[i]));
  const factor = standard.longSideMeters / span;
  if (Math.abs(factor - 1) < 1e-6) continue;
  if (factor > 1) throw Error(`This migration only shortens: ${item.id}`);
  const file = new URL(item.glb, root), bytes = await fs.readFile(file);
  const gltf = validateGlb(bytes), jsonLength = bytes.readUInt32LE(12);
  for (const scene of gltf.scenes) {
    const wrapper = gltf.nodes.length;
    gltf.nodes.push({name: 'mvp_category_length', scale: [factor, factor, factor], children: scene.nodes});
    scene.nodes = [wrapper];
  }
  const raw = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const tail = bytes.subarray(20 + jsonLength), header = Buffer.from(bytes.subarray(0, 20));
  header.writeUInt32LE(20 + json.length + tail.length, 8); header.writeUInt32LE(json.length, 12);
  const output = Buffer.concat([header, json, tail]); validateGlb(output);
  await fs.writeFile(file, output);
  const scaled = v => v.map(n => n * factor);
  item.hull = item.hull.map(scaled);
  item.bounds = {min: scaled(item.bounds.min), max: scaled(item.bounds.max)};
  item.weakPoint = {pos: scaled(item.weakPoint.pos), radius: item.weakPoint.radius * factor};
  item.volume *= factor * factor * factor;
  item.standardLongSide = standard.longSideMeters;
  if (item.normalization?.matrix) item.normalization.matrix = item.normalization.matrix.map((n, i) => i % 4 < 3 ? n * factor : n);
  item.source.normalizedSha256 = crypto.createHash('sha256').update(output).digest('hex');
  console.log(item.id, span, '->', standard.longSideMeters, 'mass unchanged', item.mass);
}
catalog.itemStandards = standards;
await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
