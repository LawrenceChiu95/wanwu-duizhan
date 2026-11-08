/**
 * The opening page's 奶锅 you can turn (凡朔's viewer.js from his UI preview, 11-07): judge.js loads this only once the
 * page is ready, so the pot's model (meshopt-packed in this build) never holds up the first screen; until it comes, and if
 * it can't, the styled picture stays. Stops and lets the GPU go when the page closes.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import potUrl from '../../data/showcase/pot/model.glb?url';

/** Shows the pot in `box` (its <img> is the stand-in) and says so in `hint`; returns a function that takes it down. */
export async function showPot(box, hint) {
  const {scene: pot} = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(potUrl);
  if (!box.isConnected || box.closest('[hidden]')) return () => {};
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(), environment = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
  scene.environment = generator.fromScene(environment).texture;
  environment.dispose(); generator.dispose();
  const bounds = new THREE.Box3().setFromObject(pot), size = bounds.getSize(new THREE.Vector3()).length();
  pot.position.sub(bounds.getCenter(new THREE.Vector3()));
  scene.add(pot, new THREE.HemisphereLight(0xffefda, 0x687a77, 1.3));
  const camera = new THREE.PerspectiveCamera(34, 1, size / 100, size * 20);
  camera.position.set(-1.25, 0.82, 0.42).normalize().multiplyScalar(size * 1.42);
  box.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false; controls.enableZoom = false; controls.update();
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener('change', draw);
  const sized = new ResizeObserver(() => {
    const {clientWidth: w, clientHeight: h} = box;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); draw();
  });
  sized.observe(box);
  box.querySelector('img').hidden = true;
  hint.textContent = '拖动旋转';
  return () => {
    sized.disconnect(); controls.dispose();
    scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of [o.material].flat()) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); } } });
    scene.environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
}
