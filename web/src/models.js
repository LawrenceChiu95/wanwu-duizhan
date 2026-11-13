import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Bundle the phone-sized GLBs in data/models (catalog `glb` paths are relative to the repo root).
// data/lux3d holds the 17–20 MB originals and is deliberately not bundled.
// The six original items (pot and lamp are the textured Lux3D generations) plus everything the import script writes
// to data/models/generated. Only URLs are bundled here; a model is fetched when a build first uses it.
const urls = import.meta.glob(['../../data/models/pan-lux3d-mobile.glb', '../../data/models/lamp-lux3d-mobile.glb', '../../data/models/broom.glb', '../../data/models/scissors.glb', '../../data/models/slipper.glb', '../../data/models/pillow.glb', '../../data/models/generated/**/*.glb'], {query: '?url', import: 'default', eager: true});
// Generation records (item.origin, 看它怎么来的): the original photo and the styled image, kept under data/origins/<id>/.
const originUrls = import.meta.glob('../../data/origins/**/*.{jpg,jpeg,png,webp}', {query: '?url', import: 'default', eager: true});
/** A record's picture: a repo-relative path from the catalog (bundled above), or a URL as it is. */
// A URL as it is (拍一件's items come from the shoot backend: /api/shoot/files/…, or data: in the local fake).
const isUrl = path => /^(data:|blob:|https?:|\/)/.test(path);
export const pictureUrl = path => isUrl(path) ? path : Object.entries(originUrls).find(([key]) => key.endsWith('/' + path))?.[1] ?? null;
// Each catalog item at the turntable's starting angle (scripts/make-stills.mjs), shown on its card until the model is drawn.
const stillUrls = import.meta.glob('../../data/stills/*.webp', {query: '?url', import: 'default', eager: true});
export const stillUrl = id => stillUrls[`../../data/stills/${id}.webp`] ?? null;
const urlFor = glb => isUrl(glb) ? glb : Object.entries(urls).find(([key]) => key.endsWith('/' + glb))?.[1];

const loader = new GLTFLoader();
// 评委版's models are packed with meshopt (tools/import-item/pack-web-models.mjs); the normal build doesn't load this.
const decoder = __JUDGE__ ? import('three/addons/libs/meshopt_decoder.module.js').then(m => { loader.setMeshoptDecoder(m.MeshoptDecoder); }) : null;
const cache = new Map();
const loading = new Map();
const poses = new Map();

/**
 * How a card holds the item (task #3, Elara 6c4b05c9: open a card and it already shows the side most like the photo,
 * no turning). The game model is the generated one laid out for the fight by `normalization.matrix`; the card turns
 * that layout back, so the item stands as it was made: Y up, and for a photo-made item (Aholo, Lux3D) facing +Z, the
 * way the styled picture looks at it. That needs no one to set it per item, so a judge's own new photo gets it too.
 * `card.yaw` (radians about Y, catalog) turns a model whose front is elsewhere; `card.upright: false` keeps the fight's
 * layout for a model that does not stand the way it was made (the two pans and the pillow were made facing the camera
 * edge-on or face-on; they keep the old three-quarter view, yaw 0.6).
 */
function cardPose(item) {
  const pose = new THREE.Matrix4(), m = item.normalization?.matrix;
  if (m && item.card?.upright !== false) {
    const layout = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().fromArray(m)), det = layout.determinant();
    // The layout's uniform scale is the card fit's business; only its turn (and any mirroring) is undone.
    if (Math.abs(det) > 1e-12) pose.setFromMatrix3(layout.multiplyScalar(1 / Math.cbrt(Math.abs(det))).invert());
  }
  return {pose, yaw: item.card?.yaw ?? 0, swing: item.card?.swing ?? 0};
}

const thumbnails = new Map();

/** Render loaded equipment once using the existing renderer, without another WebGL context. */
export function itemThumbnail(itemId, renderer, environment) {
  if (thumbnails.has(itemId)) return thumbnails.get(itemId);
  if (!cache.has(itemId)) return null;
  const object = cache.get(itemId).clone(true), scene = new THREE.Scene();
  const bounds = new THREE.Box3().setFromObject(object), center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3()), span = size.length();
  const camera = new THREE.PerspectiveCamera(35, 1.6, span / 100, span * 10);
  const extents = size.toArray(), thin = extents.indexOf(Math.min(...extents));
  const flat = extents[thin] < Math.max(...extents) * 0.28;
  const direction = new THREE.Vector3(0.85, 0.7, 1.2);
  if (flat) {
    direction.set(0.15, 0.15, 0.15).setComponent(thin, 1);
    if (thin === 1) camera.up.set(0, 0, -1);
  }
  direction.normalize();
  camera.position.copy(center).addScaledVector(direction, span * 3);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  // Fit every GLB bounding-box corner with margin, not just its longest dimension.
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const inverse = camera.quaternion.clone().invert();
  let distance = 0;
  for (let i = 0; i < 8; i++) {
    const point = new THREE.Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).sub(center).applyQuaternion(inverse);
    distance = Math.max(distance, point.z + Math.max(Math.abs(point.y) / tangent, Math.abs(point.x) / (tangent * camera.aspect)) * 1.16);
  }
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.updateMatrixWorld(true);
  scene.environment = environment;
  scene.environmentIntensity = 0.65;
  scene.add(object, new THREE.HemisphereLight('#fff5eb', '#344d42', 1));
  const light = new THREE.DirectionalLight('#fff8ea', 1.6);
  light.position.copy(camera.position);
  scene.add(light);
  const target = new THREE.WebGLRenderTarget(256, 160);
  const oldTarget = renderer.getRenderTarget(), oldColor = renderer.getClearColor(new THREE.Color());
  const oldAlpha = renderer.getClearAlpha(), viewport = renderer.getViewport(new THREE.Vector4());
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const bytes = new Uint8Array(256 * 160 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 160, bytes);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 160;
    const context = canvas.getContext('2d'), pixels = context.createImageData(256, 160);
    for (let row = 0; row < 160; row++) pixels.data.set(bytes.subarray((159 - row) * 1024, (160 - row) * 1024), row * 1024);
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL();
    thumbnails.set(itemId, url);
    return url;
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldColor, oldAlpha);
    renderer.setViewport(viewport);
    target.dispose();
  }
}

/** Loads the given items' GLBs, each once and only when first needed (keeps the first load small). */
export function loadModels(items) {
  return Promise.all(items.map(item => {
    if (!loading.has(item.id)) loading.set(item.id, loadOne(item));
    return loading.get(item.id);
  }));
}

/** Puts the given items' GLBs in the browser's cache and nothing more (no decoding, so the screen never hitches), one at a
 *  time at low priority; loadModels finds them there later. A miss here only means that model downloads when used. */
export async function prefetchModels(items) {
  for (const item of items) {
    const url = item && !loading.has(item.id) && urlFor(item.glb);
    if (url) await fetch(url, {priority: 'low'}).then(r => r.arrayBuffer()).catch(() => {});
  }
}

/** An item whose GLB is not bundled is an error (no stand-in box: it would look like the import worked). */
async function loadOne(item) {
  {
    const url = urlFor(item.glb);
    if (!url) throw Error(`缺模型文件：${item.name ?? item.id}（${item.glb}）`);
    await decoder;
    const gltf = await loader.loadAsync(url);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // Toy look: lift near-black albedo so silhouettes stay readable on the dark stage.
      for (const m of mats) {
        if (m.color) m.color.setRGB(0.05 + m.color.r * 0.95, 0.05 + m.color.g * 0.95, 0.055 + m.color.b * 0.95);
        if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.45);
      }
    });
    cache.set(item.id, gltf.scene);
    poses.set(item.id, cardPose(item));
  }
}

const RIM_HEAD = 'uniform vec3 uRim;\nuniform float uFlash;\nuniform float uWarm;\nuniform float uDanger;\nuniform float uDim;\nuniform float uStrike;\n';
const RIM_BODY = `#include <emissivemap_fragment>
{
  float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float rim = pow(1.0 - facing, 3.0);
  totalEmissiveRadiance += uRim * (rim * 1.1 + 0.015) * (1.0 - uDim * 0.7);
  // uWarm (the new feel's short hit light, stage.js): the flash goes warm and dimmer instead of white, and the striker's
  // gold edge is fainter (that feel builds no outline shell); unset it reads 0.
  totalEmissiveRadiance += mix(vec3(1.6), vec3(1.0, 0.55, 0.24), uWarm) * uFlash;
  totalEmissiveRadiance += uRim * uStrike * rim * mix(1.6, 0.9, uWarm);
  totalEmissiveRadiance += vec3(1.0, 0.12, 0.08) * uDanger * (0.25 + rim);
}`;

/** A fresh copy of the item's model whose materials share the fighter's rim/flash uniforms. */
export function instantiate(itemId, uniforms) {
  const src = cache.get(itemId);
  if (!src) throw Error(`Model not loaded: ${itemId}`);
  const obj = src.clone(true);
  obj.traverse(o => {
    if (!o.isMesh) return;
    const patch = m => {
      const c = m.clone();
      if (!c.isMeshStandardMaterial) return c;
      c.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = RIM_HEAD + shader.fragmentShader
          .replace('#include <emissivemap_fragment>', RIM_BODY)
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uDim * 0.75;');
      };
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(patch) : patch(o.material);
  });
  return obj;
}

/**
 * One item on its own turntable for the 角色库 cards and 看它怎么来的: stood as it was made (cardPose), lit like the
 * stage, centred, and framed so the whole turn fits a square. `yaw` is the turn that faces its front to the camera.
 * Drawn live by LiveTurns (livecards.js); null until the model has loaded.
 */
export function turnRig(itemId, environment, zoom = 1) {
  const src = cache.get(itemId);
  if (!src) return null;
  const scene = new THREE.Scene();
  scene.environment = environment ?? null;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242e, 1.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(2, 3, 2.5);
  scene.add(keyLight);
  const obj = src.clone(true), spin = new THREE.Group(), {pose, yaw, swing} = poses.get(itemId);
  obj.applyMatrix4(pose);
  spin.add(obj);
  scene.add(spin);
  const box = new THREE.Box3().setFromObject(obj), center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  return {scene, camera: turnCamera(box.translate(center.negate()), zoom), spin, yaw, swing};
}

/**
 * Fit for a turntable: as the model turns it sweeps a cylinder (its widest reach around the vertical axis by its
 * height), seen a little from above, filling most of the square. `box` is centred on the origin; `zoom` moves the
 * camera that much closer.
 */
function turnCamera(box, zoom = 1) {
  const reach = Math.hypot(Math.max(-box.min.x, box.max.x), Math.max(-box.min.z, box.max.z)), half = (box.max.y - box.min.y) / 2;
  const pitch = 0.42, camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const extent = Math.max(reach, half * Math.cos(pitch) + reach * Math.sin(pitch));
  const dist = (extent / Math.tan(THREE.MathUtils.degToRad(15)) * 1.06 + reach * Math.cos(pitch)) / zoom;
  camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

/**
 * The item's outline before its model has loaded, for an item without a still (task #37: a card must not sit empty and
 * look broken): the catalog hull, stood and turned as the card holds it, framed by the same turntable camera, as an SVG
 * path in a 0–100 square. Null without a hull.
 */
export function outlinePath(item) {
  if (!item.hull?.length) return null;
  const {pose, yaw} = cardPose(item), stood = item.hull.map(p => new THREE.Vector3(...p).applyMatrix4(pose));
  const box = new THREE.Box3().setFromPoints(stood), center = box.getCenter(new THREE.Vector3());
  const camera = turnCamera(box.clone().translate(center.clone().negate())), turn = new THREE.Matrix4().makeRotationY(yaw);
  const pts = stood.map(v => {
    v.sub(center).applyMatrix4(turn).project(camera);
    return [(v.x + 1) * 50, (1 - v.y) * 50];
  });
  // Convex hull of the projected points (monotone chain).
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => list.reduce((h, p) => { while (h.length > 1 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop(); h.push(p); return h; }, []);
  const lower = half(pts), upper = half([...pts].reverse());
  return 'M' + [...lower.slice(0, -1), ...upper.slice(0, -1)].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
}
