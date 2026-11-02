// Re-encode a GLB's textures as JPEG (task #39: the 废土 models' 512 px PNGs were most of their 1.4–1.7 MB).
// Only for opaque materials: JPEG has no alpha. Colour textures keep 4:2:0 chroma; data textures (metallic-roughness:
// roughness in green, metalness in blue) keep full 4:4:4 so one channel does not bleed into the other.
//   node tools/import-item/jpeg-textures.mjs <in.glb> <out.glb> [quality=85]
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {readFile, writeFile} from 'node:fs/promises';

const [input, output, quality = '85'] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: jpeg-textures.mjs <in.glb> <out.glb> [quality]');
const io = new NodeIO();
const doc = await io.readBinary(new Uint8Array(await readFile(input)));
const root = doc.getRoot();
for (const material of root.listMaterials()) {
  if (material.getAlphaMode() !== 'OPAQUE') throw Error(`${material.getName() || 'material'} uses alpha (${material.getAlphaMode()}): keep PNG`);
}
const colour = new Set(root.listMaterials().flatMap(m => [m.getBaseColorTexture(), m.getEmissiveTexture()]).filter(Boolean));
const report = [];
for (const texture of root.listTextures()) {
  const before = texture.getImage();
  if (texture.getMimeType() === 'image/jpeg') { report.push({texture: texture.getName(), kept: 'already JPEG'}); continue; }
  const image = await sharp(before).removeAlpha().jpeg({quality: Number(quality), mozjpeg: true, chromaSubsampling: colour.has(texture) ? '4:2:0' : '4:4:4'}).toBuffer();
  texture.setImage(new Uint8Array(image)).setMimeType('image/jpeg');
  report.push({texture: texture.getName() || root.listTextures().indexOf(texture), role: colour.has(texture) ? 'colour' : 'data', before: before.length, after: image.length});
}
const bytes = await io.writeBinary(doc);
await writeFile(output, bytes);
console.log(JSON.stringify({input, output, quality: Number(quality), bytes: bytes.length, textures: report}));
