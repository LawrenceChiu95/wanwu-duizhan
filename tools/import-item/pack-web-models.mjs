// 评委版 (task #4): makes a built web page's models smaller for phones, in place. Every GLB under <dist>/assets gets
// meshopt geometry (EXT_meshopt_compression, level 'medium': quantized, no lossy filters; the page decodes it with
// three's MeshoptDecoder when built with __JUDGE__) and its JPEG/PNG textures as WebP at the same size. A file that
// comes out bigger is left as it was. The sim never reads these files (it plays from catalog.json), so only how the items look can change.
// Usage: node tools/import-item/pack-web-models.mjs <dist dir>   (web: npm run build:judge runs it)
import fs from 'node:fs/promises';
import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dequantize, meshopt, textureCompress} from '@gltf-transform/functions';
import {MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';

const dist = process.argv[2];
if (!dist) throw Error('Usage: node pack-web-models.mjs <dist dir>');
const dir = path.join(dist, 'assets');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder': MeshoptEncoder});

const rows = [];
for (const name of (await fs.readdir(dir)).filter(n => n.endsWith('.glb')).sort()) {
  const file = path.join(dir, name), before = (await fs.stat(file)).size;
  const doc = await io.read(file);
  // Same size, WebP instead of JPEG/PNG (halving them to 512 saved only 0.2 MB more over all nine, so they keep their size).
  await doc.transform(textureCompress({encoder: sharp, targetFormat: 'webp', quality: 82, effort: 90, formats: /^image\/(jpeg|png)$/}));
  // The two Lux3D models come already quantized under a tiny node scale; quantizing them again flattened them (pan bounds
  // came out 0 × 0 × 0.19 m), so every model goes back to floats first.
  await doc.transform(dequantize(), meshopt({encoder: MeshoptEncoder, level: 'medium'}));
  const out = await io.writeBinary(doc);
  if (out.byteLength < before) await fs.writeFile(file, out);
  rows.push({name, beforeKB: Math.round(before / 1024), afterKB: Math.round(Math.min(before, out.byteLength) / 1024)});
}
console.table(rows);
const sum = k => rows.reduce((a, r) => a + r[k], 0);
console.log(`GLB total ${sum('beforeKB')} KB -> ${sum('afterKB')} KB`);
