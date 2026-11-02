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
const cache = new Map();
const loading = new Map();

/** Loads the given items' GLBs, each once and only when first needed (keeps the first load small). */
export function loadModels(items) {
  return Promise.all(items.map(item => {
    if (!loading.has(item.id)) loading.set(item.id, loadOne(item));
    return loading.get(item.id);
  }));
}

/** An item whose GLB is not bundled is an error (no stand-in box: it would look like the import worked). */
async function loadOne(item) {
  {
    const url = urlFor(item.glb);
    if (!url) throw Error(`缺模型文件：${item.name ?? item.id}（${item.glb}）`);
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
  }
}

const RIM_HEAD = 'uniform vec3 uRim;\nuniform float uFlash;\nuniform float uDanger;\nuniform float uDim;\n';
const RIM_BODY = `#include <emissivemap_fragment>
{
  float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float rim = pow(1.0 - facing, 3.0);
  totalEmissiveRadiance += uRim * (rim * 1.1 + 0.015) * (1.0 - uDim * 0.7);
  totalEmissiveRadiance += vec3(1.0) * uFlash * 1.6;
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
 * One item on its own turntable for the 角色库 cards and 看它怎么来的: lit like the stage, centred, and framed so the
 * whole turn fits a square. Drawn live by LiveTurns (livecards.js); null until the model has loaded.
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
  const obj = src.clone(true), spin = new THREE.Group();
  spin.add(obj);
  scene.add(spin);
  const box = new THREE.Box3().setFromObject(obj), center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  return {scene, camera: turnCamera(box.translate(center.negate()), zoom), spin};
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
 * look broken): the catalog hull, framed by the same turntable camera with its long side across the view, as an SVG path in a 0–100 square.
 * Null without a hull.
 */
export function outlinePath(item) {
  if (!item.hull?.length || !item.bounds) return null;
  const box = new THREE.Box3(new THREE.Vector3(...item.bounds.min), new THREE.Vector3(...item.bounds.max));
  const center = box.getCenter(new THREE.Vector3()), camera = turnCamera(box.clone().translate(center.clone().negate()));
  // Long side across, turned a little so it reads as an object rather than a flat side view.
  const size = box.getSize(new THREE.Vector3()), angle = (size.z > size.x ? Math.PI / 2 : 0) + 0.35;
  const v = new THREE.Vector3(), turn = new THREE.Matrix4().makeRotationY(angle);
  const pts = item.hull.map(([x, y, z]) => {
    v.set(x, y, z).sub(center).applyMatrix4(turn).project(camera);
    return [(v.x + 1) * 50, (1 - v.y) * 50];
  });
  // Convex hull of the projected points (monotone chain).
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => list.reduce((h, p) => { while (h.length > 1 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop(); h.push(p); return h; }, []);
  const lower = half(pts), upper = half([...pts].reverse());
  return 'M' + [...lower.slice(0, -1), ...upper.slice(0, -1)].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
}
