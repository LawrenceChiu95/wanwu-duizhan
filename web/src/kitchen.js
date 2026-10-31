import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {SparkRenderer, SplatMesh} from '@sparkjsdev/spark';
import {PhotoKitchen} from './photo-kitchen.js';

const SCENE_URL = new URL('../../data/scenes/kitchen/scene.spz', import.meta.url).href;
const INITIAL = {x: 0, height: 3.3, z: 0, scale: 2.4, yaw: 0};

/** Local visual experiment; the simulation's coordinates and colliders stay untouched. */
export class KitchenPreview {
  constructor(stage, originalBackdrop) {
    this.stage = stage;
    this.originalBackdrop = originalBackdrop;
    this.calibration = {...INITIAL};
    this.inspection = false;
    this.mode = new URLSearchParams(location.search).get('background') === '3d' ? '3d' : 'photo';
    this.photo = new PhotoKitchen(stage);
    this.group = new THREE.Group();
    this.spark = new SparkRenderer({renderer: stage.renderer, depthTest: true, depthWrite: false});
    this.mesh = null;
    /* The 3D scene loads only when requested; image mode needs no splat download. */
    this.loadScene = () => {
      if (this.mesh) return this.mesh.initialized;
      this.mesh = new SplatMesh({url: SCENE_URL, lod: false});
      // Aholo reports Z-up; the game uses Y-up.
      this.mesh.rotation.x = -Math.PI / 2;
      this.group.add(this.mesh);
      return this.mesh.initialized;
    };
    stage.scene.add(this.spark, this.group);
    this.controls = new OrbitControls(stage.camera, stage.renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minDistance = 0.001;
    this.controls.maxDistance = 0.05;
    this.makePanel();
    document.getElementById('camSeg').hidden = true;
    this.applyCalibration();
    this.setVisible(true);
    this.ready = (this.mode === 'photo' ? this.photo.ready : this.loadScene()).then(() => {
      this.panel.dataset.ready = 'true';
      this.status.textContent = this.mode === 'photo' ? '图1局部构图 · 背景随镜头运动' : '3D厨房已载入';
    });
    this.onStart = () => this.setInspection(false);
    document.getElementById('goBtn').addEventListener('click', this.onStart);
    addEventListener('pagehide', () => this.dispose(), {once: true});
  }

  applyCalibration() {
    const {x, height, z, scale, yaw} = this.calibration;
    // Keep the source observation point at the battle camera, and face the room
    // rather than looking down at its reconstructed floor.
    this.group.position.set(x, 5 + height - INITIAL.height, 10 + z);
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
      new THREE.Vector3(0, 5, 10), new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    this.group.quaternion.copy(orientation).multiply(new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), -Math.PI / 2 + THREE.MathUtils.degToRad(yaw)));
    this.group.scale.setScalar(scale);
    this.group.updateMatrixWorld(true);
  }

  setVisible(visible) {
    this.group.visible = visible && this.mode === '3d';
    this.spark.visible = visible && this.mode === '3d';
    this.photo.setEnabled(visible && this.mode === 'photo');
    for (const object of this.originalBackdrop) object.visible = !visible;
  }

  setInspection(inspecting) {
    this.inspection = inspecting;
    this.controls.enabled = inspecting;
    this.inspectButton.textContent = inspecting ? '回到战斗视角' : '环顾厨房';
    const camera = this.stage.camera;
    if (inspecting) {
      camera.clearViewOffset();
      camera.fov = 60;
      camera.up.set(0, 1, 0);
      camera.position.copy(this.group.position);
      this.controls.target.copy(camera.position).add(new THREE.Vector3(-0.01, 0, 0).applyQuaternion(this.group.quaternion));
      camera.lookAt(this.controls.target);
      camera.updateProjectionMatrix();
      this.controls.update();
    } else {
      camera.up.set(0, 1, 0);
      this.stage.applyInsets();
      this.stage.cam.ready = false;
      this.stage.updateCamera(0, true);
    }
  }

  updateBattleCamera(dt = 0) {
    if (this.mode === 'photo') { this.photo.update(dt); return; }
    // Preserve the source panorama's observation point; translation exposes reconstruction gaps.
    const {camera, fighters, view} = this.stage;
    const bottom = this.stage.safeBottom();
    const safe = Math.max(0.1, (view.h - view.top - bottom) / view.h);
    camera.up.set(0, 1, 0);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const matrix = camera.matrixWorld.elements;
    let tangent = Math.tan(THREE.MathUtils.degToRad(46 / 2));
    for (const fighter of fighters) {
      const relative = fighter.center.clone().sub(camera.position);
      const radius = fighter.sweep + 0.12;
      const depth = Math.max(0.2, -(relative.x * matrix[8] + relative.y * matrix[9] + relative.z * matrix[10]) - radius);
      const x = relative.x * matrix[0] + relative.y * matrix[1] + relative.z * matrix[2];
      const y = relative.x * matrix[4] + relative.y * matrix[5] + relative.z * matrix[6];
      tangent = Math.max(tangent, (Math.abs(x) + radius) / (depth * camera.aspect * 0.92), (Math.abs(y) + radius) / (depth * safe * 0.92));
    }
    const desired = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(tangent)), 46, 130);
    camera.fov = desired >= camera.fov ? desired : camera.fov + (desired - camera.fov) * (dt ? 1 - Math.exp(-dt * 5) : 1);
    this.stage.setOffset(-view.w * 0.035, Math.max((bottom - view.top) / 2, view.h * 0.06));
    camera.updateProjectionMatrix();
    this.stage.particles.mat.uniforms.uScale.value = view.h * this.stage.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }

  makePanel() {
    this.panel = document.createElement('details');
    this.panel.className = 'kitchen-panel';
    this.panel.id = 'kitchenPanel';
    this.panel.innerHTML = `<summary>厨房独立预览</summary><p id="kitchenStatus" role="status">正在载入厨房…</p>
      <label>背景方式<select id="kitchenMode"><option value="photo">局部构图 · 随镜头运动</option><option value="3d">3D厨房对照</option></select></label>
      <button type="button" id="inspectKitchen">环顾厨房</button>
      <label class="kitchen-check"><input type="checkbox" id="showKitchen" checked> 显示厨房</label>
      <fieldset><legend>场景对齐</legend></fieldset>
      <button type="button" id="resetKitchen">重置场景对齐</button>
      <small>只调整环境画面，不改变对战规则。环顾时可拖动转向。</small>`;
    document.body.append(this.panel);
    this.status = this.panel.querySelector('#kitchenStatus');
    this.inspectButton = this.panel.querySelector('#inspectKitchen');
    const mode = this.panel.querySelector('#kitchenMode');
    mode.value = this.mode;
    this.inspectButton.hidden = this.mode === 'photo';
    this.panel.querySelector('fieldset').hidden = this.mode === 'photo';
    this.panel.querySelector('#resetKitchen').hidden = this.mode === 'photo';
    mode.addEventListener('change', async () => {
      this.mode = mode.value;
      this.setInspection(false);
      this.inspectButton.hidden = this.mode === 'photo';
      this.panel.querySelector('fieldset').hidden = this.mode === 'photo';
      this.panel.querySelector('#resetKitchen').hidden = this.mode === 'photo';
      this.setVisible(this.panel.querySelector('#showKitchen').checked);
      this.status.textContent = this.mode === 'photo' ? '图1局部构图 · 背景随镜头运动' : '正在载入3D厨房…';
      if (this.mode === '3d') {
        try { await this.loadScene(); this.status.textContent = '3D厨房已载入'; }
        catch { this.status.textContent = '3D厨房加载失败，可切回图片'; }
      }
    });
    this.inspectButton.addEventListener('click', () => this.setInspection(!this.inspection));
    this.panel.querySelector('#showKitchen').addEventListener('change', event => this.setVisible(event.target.checked));
    const fields = [
      ['x', '左右位置', -8, 8, 0.1], ['z', '前后位置', -8, 8, 0.1],
      ['height', '地面对齐', -2, 9, 0.05], ['scale', '房间大小', 0.5, 5, 0.1],
      ['yaw', '房间朝向', -180, 180, 5]
    ];
    for (const [key, title, min, max, step] of fields) {
      const label = document.createElement('label');
      label.innerHTML = `<span>${title}</span><input aria-label="${title}" type="number" min="${min}" max="${max}" step="${step}" value="${INITIAL[key]}">`;
      const input = label.querySelector('input');
      input.addEventListener('input', () => {
        if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
        this.calibration[key] = input.valueAsNumber;
        this.applyCalibration();
      });
      this.panel.querySelector('fieldset').append(label);
    }
    this.panel.querySelector('#resetKitchen').addEventListener('click', () => {
      this.calibration = {...INITIAL};
      fields.forEach(([key], i) => { this.panel.querySelectorAll('input[type=number]')[i].value = INITIAL[key]; });
      this.applyCalibration();
    });
  }

  dispose() {
    document.getElementById('goBtn')?.removeEventListener('click', this.onStart);
    this.controls.dispose();
    this.stage.scene.remove(this.group, this.spark);
    this.mesh?.dispose();
    this.photo.dispose();
    this.spark.dispose();
    this.panel.remove();
  }
}
