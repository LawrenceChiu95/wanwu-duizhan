import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Bundle the phone-sized GLBs in data/models (catalog `glb` paths are relative to the repo root).
// data/lux3d holds the 17–20 MB originals and is deliberately not bundled.
// The six original items (pot and lamp are the textured Lux3D generations) plus everything the import script writes
// to data/models/generated. Only URLs are bundled here; a model is fetched when a build first uses it.
const urls = import.meta.glob(['../../data/models/pan-lux3d-mobile.glb', '../../data/models/lamp-lux3d-mobile.glb', '../../data/models/broom.glb', '../../data/models/scissors.glb', '../../data/models/slipper.glb', '../../data/models/pillow.glb', '../../data/models/generated/**/*.glb'], {query: '?url', import: 'default', eager: true});
// Generation records (item.origin, 看它怎么来的): the original photo and the styled image, kept under data/origins/<id>/.
const originUrls = import.meta.glob('../../data/origins/**/*.{jpg,jpeg,png,webp}', {query: '?url', import: 'default', eager: true});
/** A record's picture: a repo-relative path from the catalog (bundled above), or a data:/https: URL as it is. */
export const pictureUrl = path => /^(data:|https?:)/.test(path) ? path : Object.entries(originUrls).find(([key]) => key.endsWith('/' + path))?.[1] ?? null;
const urlFor = glb => Object.entries(urls).find(([key]) => key.endsWith('/' + glb))?.[1];

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
 * A turntable strip for the 角色库 cards: `frames` square views of the item turning once, side by side in one PNG.
 * Rendered once per item with the page's own renderer (no second WebGL context) and played back as a CSS sprite; the
 * element gets `--frames` so the animation steps through all of them. 72 frames over a six-second turn is 12 a second:
 * at 24 it moved 15° per step and looked like it stuck (远夏 11-02). Keep `frames * size` within 16384, the widest
 * image every browser here draws.
 */
const strips = new Map();
export function turntable(itemId, renderer, environment, {frames = 72, size = 160} = {}) {
  const key = `${itemId}:${frames}:${size}`;
  if (strips.has(key)) return strips.get(key);
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
  // Fit: centre the model; as it turns it sweeps a cylinder (its widest reach around the vertical axis by its height),
  // seen a little from above, filling most of the square.
  const box = new THREE.Box3().setFromObject(obj), center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  box.translate(center.negate());
  const reach = Math.hypot(Math.max(-box.min.x, box.max.x), Math.max(-box.min.z, box.max.z)), half = (box.max.y - box.min.y) / 2;
  const pitch = 0.42, camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const extent = Math.max(reach, half * Math.cos(pitch) + reach * Math.sin(pitch));
  const dist = extent / Math.tan(THREE.MathUtils.degToRad(15)) * 1.06 + reach * Math.cos(pitch);
  camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch));
  camera.lookAt(0, 0, 0);
  const target = new THREE.WebGLRenderTarget(size, size, {samples: 4, colorSpace: THREE.SRGBColorSpace});
  const canvas = document.createElement('canvas');
  canvas.width = size * frames;
  canvas.height = size;
  const ctx = canvas.getContext('2d'), pixels = new Uint8Array(size * size * 4), img = ctx.createImageData(size, size);
  const old = {target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), viewport: renderer.getViewport(new THREE.Vector4())};
  try {
    renderer.setClearColor(0x000000, 0);
    for (let i = 0; i < frames; i++) {
      spin.rotation.y = (i / frames) * Math.PI * 2;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      // WebGL rows run bottom-up.
      for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      ctx.putImageData(img, i * size, 0);
    }
  } finally {
    renderer.setRenderTarget(old.target);
    renderer.setClearColor(old.color, old.alpha);
    renderer.setViewport(old.viewport);
    target.dispose();
  }
  const strip = {url: canvas.toDataURL('image/png'), frames, size};
  strips.set(key, strip);
  return strip;
}
