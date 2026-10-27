import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Bundle the phone-sized GLBs; catalog `glb` paths are relative to the repo root.
// The 17–20 MB Lux3D originals (*-pbr.glb) and intermediates (*.source.glb) are never shipped.
const urls = import.meta.glob(['../../data/models/*.glb', '../../data/lux3d/*.glb', '!../../data/lux3d/*-pbr.glb', '!../../data/lux3d/*.source.glb'], {query: '?url', import: 'default', eager: true});
const urlFor = glb => Object.entries(urls).find(([key]) => key.endsWith('/' + glb))?.[1];

const loader = new GLTFLoader();
const cache = new Map();

/** Loads each catalog item's GLB once. Items without a bundled GLB get a box from their bounds. */
export async function loadModels(items) {
  await Promise.all(items.map(async item => {
    const url = urlFor(item.glb);
    if (!url) {
      console.warn(`No GLB for ${item.id} (${item.glb}); drawing its bounds box`);
      const size = item.bounds.max.map((v, k) => v - item.bounds.min[k]);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({color: 0x9aa4b8, roughness: 0.6}));
      cache.set(item.id, mesh);
      return;
    }
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
  }));
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
