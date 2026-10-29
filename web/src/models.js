import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Bundle the phone-sized GLBs in data/models (catalog `glb` paths are relative to the repo root).
// data/lux3d holds the 17–20 MB originals and is deliberately not bundled.
// The six original items (pot and lamp are the textured Lux3D generations) plus everything the import script writes
// to data/models/generated. Only URLs are bundled here; a model is fetched when a build first uses it.
const urls = import.meta.glob(['../../data/models/pan-lux3d-mobile.glb', '../../data/models/lamp-lux3d-mobile.glb', '../../data/models/broom.glb', '../../data/models/scissors.glb', '../../data/models/slipper.glb', '../../data/models/pillow.glb', '../../data/models/generated/**/*.glb'], {query: '?url', import: 'default', eager: true});
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
