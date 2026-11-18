/**
 * The opening page's 奶锅 you can turn (凡朔's viewer.js from his UI preview, 11-07): judge.js loads this only once the
 * page is ready, so the pot's model (meshopt-packed in this build) never holds up the first screen; until it comes, and if
 * it can't, the styled picture stays. Stops and lets the GPU go when the page closes. 看碰撞体 (Elara 742f4a4a) puts the
 * shell the fight would collide this pot with over it (hull.json, from the importer: tools/import-item/showcase-hull.mjs),
 * see-through in the arena's teal, turning with it.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import potUrl from '../../data/showcase/pot/model.glb?url';
import hull from '../../data/showcase/pot/hull.json';

/** Shows the pot in `box` (its <img> is the stand-in) and says so in `hint`, with `toggle` (if there is one) showing and
 *  hiding its collision shell; returns a function that takes it down. A load that `current()` says a later showing of the
 *  page has replaced touches nothing (Sol 4be2198c: else its close took the new viewer's 收起 away with the shell up). */
export async function showPot(box, hint, toggle, current = () => true) {
  const {scene: pot} = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(potUrl);
  if (!current() || !box.isConnected || box.closest('[hidden]')) return () => {};
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(), environment = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
  scene.environment = generator.fromScene(environment).texture;
  environment.dispose(); generator.dispose();
  const bounds = new THREE.Box3().setFromObject(pot), size = bounds.getSize(new THREE.Vector3()).length();
  pot.position.sub(bounds.getCenter(new THREE.Vector3()));
  scene.add(pot, new THREE.HemisphereLight(0xffefda, 0x687a77, 1.3));
  // In the model's own coordinates, so a child of the pot: a faint skin, and its faces' edges (not the triangles'), drawn
  // through the pot so the whole shell reads.
  const skin = new ConvexGeometry(hull.points.map(p => new THREE.Vector3(...p))), edges = new THREE.EdgesGeometry(skin, 8);
  const edgeLook = new THREE.LineBasicMaterial({color: 0x7ee4ca, transparent: true, opacity: 0.85, depthTest: false}), shell = new THREE.Group();
  const lines = new THREE.LineSegments(edges, edgeLook); lines.renderOrder = 1;
  shell.add(new THREE.Mesh(skin, new THREE.MeshBasicMaterial({color: 0x4fd8c0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide})), lines);
  shell.visible = false;
  pot.add(shell);
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
  // While it is up the bar says what it is (Elara 231842fb: only that the fight collides with it).
  const label = toggle?.parentElement.firstElementChild, named = label?.textContent;
  const show = on => {
    shell.visible = on; toggle.textContent = on ? '收起' : '看碰撞体'; toggle.setAttribute('aria-pressed', String(on));
    label.textContent = on ? '对战里碰的就是这层外壳' : named; draw();
  };
  const flip = () => show(!shell.visible);
  if (toggle) { toggle.onclick = flip; show(false); toggle.hidden = false; }
  return () => {
    if (toggle?.onclick === flip) { toggle.hidden = true; toggle.onclick = null; label.textContent = named; }
    edges.dispose(); edgeLook.dispose();
    sized.disconnect(); controls.dispose();
    scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of [o.material].flat()) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); } } });
    scene.environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
}
