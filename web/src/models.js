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
