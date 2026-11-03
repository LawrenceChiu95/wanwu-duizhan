import {readFile, stat} from 'node:fs/promises';
import crypto from 'node:crypto';
import {NodeIO, Logger} from '@gltf-transform/core';
import {weld, simplify, compactPrimitive} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import RAPIER from '@dimforge/rapier3d-compat';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const LIMIT = 64 * 1024 * 1024;
let rapierReady;
const io = () => new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/** No external resource resolution: imports are self-contained static GLB 2.0. */
export function validateGlb(bytes) {
  if (bytes.length < 28 || bytes.length > LIMIT || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Expected a complete GLB 2.0 file (maximum 64 MiB)');
  const length = bytes.readUInt32LE(12);
  if (length % 4 || length > bytes.length - 20 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw Error('Invalid GLB JSON chunk');
  let json;
  try { json = JSON.parse(bytes.subarray(20, 20 + length).toString()); } catch { throw Error('Invalid GLB JSON'); }
  if (!json || json.asset?.version !== '2.0') throw Error('Expected glTF 2.0');
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some(x => x.uri !== undefined)) throw Error('GLB external or URI resources are not supported; embed all buffers and images');
  if (json.animations?.length || json.skins?.length || json.meshes?.some(m => m.primitives?.some(p => p.targets?.length))) throw Error('Only static meshes are supported (no animation, skin or morph targets)');
  if (json.extensionsUsed?.length || json.extensionsRequired?.length) throw Error('Compressed or extended GLB is not supported; export a plain embedded GLB');
  return json;
}

export async function readGlb(file) {
  if ((await stat(file)).size > LIMIT) throw Error('GLB exceeds 64 MiB');
  const bytes = await readFile(file); validateGlb(bytes); return bytes;
}

function geometry(doc) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw Error('GLB has no scene');
  const points = []; let triangles = 0;
  const visit = node => {
    const matrix = node.getWorldMatrix();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (primitive.getMode() !== 4) throw Error('Only triangle primitives are supported');
      const positions = primitive.getAttribute('POSITION');
      if (!positions || positions.getType() !== 'VEC3') throw Error('Missing VEC3 positions');
      const indices = primitive.getIndices();
      const count = indices?.getCount() ?? positions.getCount();
      if (count % 3) throw Error('Invalid triangle index count');
      triangles += count / 3;
      const used = indices ? new Set(indices.getArray()) : Array.from({length: count}, (_, i) => i);
      for (const i of used) {
        if (!Number.isSafeInteger(i) || i < 0 || i >= positions.getCount()) throw Error('Triangle index exceeds vertex count');
        const p = positions.getElement(i, []);
        const world = [0, 1, 2].map(r => matrix[r] * p[0] + matrix[r + 4] * p[1] + matrix[r + 8] * p[2] + matrix[r + 12]);
        if (!world.every(Number.isFinite)) throw Error('Non-finite vertex or transform');
        points.push(world);
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const root of scene.listChildren()) visit(root);
  if (!points.length || !triangles) throw Error('GLB has no triangle geometry');
  return {scene, points, triangles};
}

function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return {min, max};
}

export async function prepareMesh(raw, template, standard) {
  validateGlb(raw);
  const doc = await io().readBinary(new Uint8Array(raw));
  const sourceTriangles = geometry(doc).triangles;
  await MeshoptSimplifier.ready;
  if (sourceTriangles > 10000) await doc.transform(weld(), simplify({simplifier: MeshoptSimplifier, ratio: 10000 / sourceTriangles, error: .02}));
  // Aholo's pot has many UV seams: topology-only simplification stops at 33K.
  // Permit seam collapses with explicit UV/normal error weights, retaining the
  // original vertex attributes and PBR materials. Do not use simplifySloppy.
  const remaining = geometry(doc).triangles;
  if (remaining > 15000) for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION');
    const attributes = primitive.listSemantics().filter(s => s === 'NORMAL' || s.startsWith('TEXCOORD_') || s.startsWith('COLOR_')).map(s => primitive.getAttribute(s));
    const stride = attributes.reduce((n, a) => n + a.getElementSize(), 0);
    const values = new Float32Array(positions.getCount() * stride);
    for (let i = 0; i < positions.getCount(); i++) {
      let offset = i * stride;
      for (const attribute of attributes) { const element = attribute.getElement(i, []); values.set(element, offset); offset += element.length; }
    }
    const indices = primitive.getIndices();
    const target = Math.max(3, Math.floor(indices.getCount() * 12000 / remaining / 3) * 3);
    const [result] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(indices.getArray()), new Float32Array(positions.getArray()), 3, values, stride, Array(stride).fill(1), null, target, .03, ['Permissive']);
    primitive.setIndices(indices.clone().setArray(result));
    if (indices.listParents().length === 1) indices.dispose();
    compactPrimitive(primitive);
  }
  const textureSizes = [];
  // Colour textures with nothing transparent in them are stored as JPEG (task #42: as PNGs they were most of a 废土
  // model's 1.4–1.7 MB; side by side the JPEGs looked the same). Textures with transparency and data textures (normal,
  // metallic-roughness, occlusion) stay PNG: JPEG's blocks would show on alpha edges and bend normals.
  // Transparent: used by a blended or masked material, or alpha below 250 anywhere (the 废土 generations carry stray
  // 254s in an alpha channel their opaque materials ignore).
  const materials = doc.getRoot().listMaterials();
  const colour = new Set(materials.flatMap(m => [m.getBaseColorTexture(), m.getEmissiveTexture()]).filter(Boolean));
  const data = new Set(materials.flatMap(m => [m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture()]).filter(Boolean));
  const blended = new Set(materials.filter(m => m.getAlphaMode() !== 'OPAQUE').map(m => m.getBaseColorTexture()).filter(Boolean));
  const solid = async png => { const {channels} = await sharp(png).stats(); return channels.length !== 4 && channels.length !== 2 || channels.at(-1).min >= 250; };
  for (const texture of doc.getRoot().listTextures()) {
    if (!texture.getImage()) throw Error('Texture has no embedded image');
    const {data: png, info} = await sharp(texture.getImage(), {limitInputPixels: 4096 * 4096}).resize(512, 512, {fit: 'inside', withoutEnlargement: true}).png().toBuffer({resolveWithObject: true});
    const jpeg = colour.has(texture) && !data.has(texture) && !blended.has(texture) && await solid(png);
    const bytes = jpeg ? await sharp(png).removeAlpha().jpeg({quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer() : png;
    texture.setImage(new Uint8Array(bytes)).setMimeType(jpeg ? 'image/jpeg' : 'image/png');
    textureSizes.push([info.width, info.height]);
  }
  const current = geometry(doc);
  if (current.triangles > 15000) throw Error(`Simplification stopped at ${current.triangles} triangles, above 15000; asset needs manual preparation`);
  const sourceBounds = bounds(current.points), spans = sourceBounds.max.map((v, i) => v - sourceBounds.min[i]);
  const length = Math.max(...spans);
  if (!(length > 0)) throw Error('Degenerate model bounds');
  const longest = spans.indexOf(length);
  // Pick a different axis even for symmetric bounds. Always a right-handed basis.
  const thinnest = [0, 1, 2].filter(i => i !== longest).sort((a, b) => spans[a] - spans[b] || a - b)[0];
  // Match the current category templates: knife tip out, pot bowl/broom head out.
  // Compare the outer 10% at each end; source coordinate sign has no meaning.
  const endWidths = (points, box, axis) => [-1, 1].map(sign => {
    const size = box.max[axis] - box.min[axis];
    const end = points.filter(p => sign < 0 ? p[axis] <= box.min[axis] + size * .1 : p[axis] >= box.max[axis] - size * .1);
    if (!end.length) return 0;
    const b = bounds(end);
    return Math.max(...[0, 1, 2].filter(k => k !== axis).map(k => b.max[k] - b.min[k]));
  });
  const distinguishable = w => Math.max(...w) > 0 && Math.abs(w[0] - w[1]) / Math.max(...w) >= .1;
  let outwardEnd = {scissors: 'narrow', pot: 'wide', broom: 'wide'}[template.category];
  // The other templates have no hand-authored head/tip rule. Learn which width
  // belongs outside from their actual longest-axis hull and mounting sign.
  if (!outwardEnd && template.hull && [1, -1].includes(template.outEnd)) {
    const spans = template.bounds.max.map((v, i) => v - template.bounds.min[i]);
    const axis = spans.indexOf(Math.max(...spans)), ends = endWidths(template.hull, template.bounds, axis);
    if (distinguishable(ends)) outwardEnd = ends[template.outEnd === 1 ? 1 : 0] > ends[template.outEnd === 1 ? 0 : 1] ? 'wide' : 'narrow';
  }
  const widths = endWidths(current.points, sourceBounds, longest);
  const resolved = outwardEnd && distinguishable(widths);
  const orientation = {templateId: template.id, method: resolved ? 'template-end-width' : 'longest-axis',
    ...(resolved ? {outwardEnd} : {reason: outwardEnd ? 'source-ends-indistinguishable' : 'template-ends-indistinguishable'})};
  const flip = resolved && (outwardEnd === 'wide' ? widths[0] > widths[1] : widths[0] < widths[1]);
  const Y = [0, 0, 0], Z = [0, 0, 0]; Y[thinnest] = 1; Z[longest] = flip ? -1 : 1;
  const X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
  const axes = [X, Y, Z], scale = standard.longSideMeters / length, center = sourceBounds.max.map((v, i) => (v + sourceBounds.min[i]) / 2);
  const matrix = Array(16).fill(0); matrix[15] = 1;
  for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) matrix[c * 4 + r] = axes[r][c] * scale; matrix[12 + r] = -axes[r].reduce((s, a, k) => s + a * center[k], 0) * scale; }
  const wrapper = doc.createNode('item_meters_centered').setMatrix(matrix);
  for (const child of [...current.scene.listChildren()]) { current.scene.removeChild(child); wrapper.addChild(child); }
  current.scene.addChild(wrapper);
  const output = Buffer.from(await io().writeBinary(doc)); validateGlb(output);
  const check = await io().readBinary(new Uint8Array(output)), final = geometry(check), finalBounds = bounds(final.points);
  const measured = Math.max(...finalBounds.max.map((v, k) => v - finalBounds.min[k]));
  if (Math.abs(measured - standard.longSideMeters) > 1e-6) throw Error('Normalized model size failed round-trip check');
  const supports = new Map();
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue;
    let best = final.points[0], score = -Infinity;
    for (const p of final.points) { const s = x * p[0] + y * p[1] + z * p[2]; if (s > score) { score = s; best = p; } }
    supports.set(best.join(','), best);
  }
  const hull = [...supports.values()];
  await (rapierReady ??= RAPIER.init());
  const descriptor = RAPIER.ColliderDesc.convexHull(new Float32Array(hull.flat()));
  if (!descriptor || hull.length < 4 || hull.length > 64) throw Error('Rapier rejected the support hull');
  const world = new RAPIER.World({x: 0, y: 0, z: 0}); let volume;
  try { volume = world.createCollider(descriptor.setMass(standard.massKg)).volume(); } finally { world.free(); }
  if (!(volume > 0) || !Number.isFinite(volume)) throw Error('Invalid hull volume');
  const weak = final.points.reduce((a, b) => b[2] > a[2] ? b : a);
  return {bytes: output, shape: {hull, bounds: finalBounds, volume, weakPoint: {pos: weak, radius: template.weakPoint.radius}, normalization: {matrix, sourceBounds, sourceVertices: current.points.length, orientation, ...(resolved ? {outwardEnd} : {})}}, report: {sourceTriangles, triangles: final.triangles, vertices: final.points.length, textureSizes, materials: check.getRoot().listMaterials().length, bytes: output.length, sha256: sha256(output), hullPoints: hull.length, longSideMeters: measured}};
}
