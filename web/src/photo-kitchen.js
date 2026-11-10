import * as THREE from 'three';

const PHOTO = new URL('./assets/battle-depth.svg', import.meta.url).href;
// Impact feel on 凡朔's fixed camera (Elara #万物对战:e6f14ad0): the old chase camera's shake, as px of picture translation
// (its 0.03 × distance jitter at 58°), and a short push-in that tightens the framing and is back within PUSH_TIME.
const SHAKE_PX = 0.03 / (2 * Math.tan(THREE.MathUtils.degToRad(58 / 2))), PUSH_TIME = 0.22;

/** A world-space photographic plate sharing the fight camera (2.5D). */
export class PhotoKitchen {
  constructor(stage) {
    this.stage = stage;
    this.enabled = false;
    this.ready = new THREE.TextureLoader().loadAsync(PHOTO).then(texture => {
      this.source = texture;
      this.canvas = document.createElement('canvas');
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      // Preserve the supplied image's colour, independently of mesh exposure.
      stage.scene.backgroundIntensity = 1;
      this.plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map: this.texture, toneMapped: false, depthWrite: false}));
      this.plate.visible = this.enabled;
      this.plate.renderOrder = -100;
      const reference = new THREE.PerspectiveCamera();
      reference.position.set(9, 8, 4);
      reference.lookAt(0, 0, 0);
      this.plate.quaternion.copy(reference.quaternion);
      this.plate.position.copy(reference.position).add(new THREE.Vector3(0, 0, -100).applyQuaternion(reference.quaternion));
      stage.scene.add(this.plate);
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.stage.scene.background = new THREE.Color('#070a12');
    if (this.plate) this.plate.visible = enabled;
  }

  noteCollision() { this.collisionAge = 0; }

  update(dt) {
    const {camera, view} = this.stage;
    if (this.texture && (this.lastW !== view.w || this.lastH !== view.h)) {
      this.lastW = view.w;
      this.lastH = view.h;
      this.canvas.width = Math.round(view.w * 2);
      this.canvas.height = Math.round(view.h * 2);
      const ctx = this.canvas.getContext('2d');
      const w = this.canvas.width, h = this.canvas.height;
      ctx.fillStyle = '#070a12';
      ctx.fillRect(0, 0, w, h);
      // Scale the gradient to fill the plate at each viewport size.
      const image = this.source.image;
      ctx.drawImage(image, 0, 0, w, h);
      this.texture.needsUpdate = true;
      this.referenceReady = false;
    }
    const x = view.w * 0.515;
    // Keep the marked cupboard area and stay above the build/attack controls.
    const y = Math.max(view.top + view.w * 0.17, Math.min(view.h * 0.525, view.h - this.stage.safeBottom() - view.w * 0.17));
    if (this.lastTargetY !== y) this.referenceReady = false;
    this.lastTargetY = y;
    camera.position.set(9, 8, 4);
    camera.up.set(0, 1, 0);
    // Zoom only: rotating a single plate can reveal its edge even at the zoom limit.
    camera.lookAt(0, 0, 0);
    if (!this.enabled) camera.rotateZ(-Math.PI / 5.6);
    camera.updateMatrixWorld(true);
    // Calibrate the core's outer glow to the user's ~48px circles at 393px width.
    const depth = camera.position.length();
    const nominal = this.stage.coreRadius * 6.5 * 0.7 * view.h / (2 * depth * view.w * (48 / 393));
    this.maxFov = THREE.MathUtils.radToDeg(2 * Math.atan(nominal * 2));
    const building = !document.getElementById('build').hidden;
    // The fight drives the target: approach/contact closes in, separation opens out.
    // A critically damped spring keeps position and speed continuous on impacts.
    const [a, b] = this.stage.fighters;
    let distance = a && b ? a.center.distanceTo(b.center) : 0;
    if (a?.vel && b?.vel && distance > 0.001) {
      const direction = b.center.clone().sub(a.center).divideScalar(distance);
      distance += THREE.MathUtils.clamp(b.vel.clone().sub(a.vel).dot(direction) * 0.12, -0.25, 0.25);
    }
    const progress = THREE.MathUtils.clamp((distance - 0.8) / 1.8, 0, 1);
    this.collisionAge = (this.collisionAge ?? Infinity) + Math.max(0, dt);
    let target = 1 + progress * progress * (3 - 2 * progress);
    if (this.collisionAge < 0.22) target = Math.min(target, 1.15);
    if (building) { this.zoom = 1; this.zoomVelocity = 0; this.collisionAge = Infinity; }
    else if (dt > 0) {
      const step = Math.min(dt, 0.1), omega = 3;
      const delta = (this.zoom ?? 1) - target;
      const c = (this.zoomVelocity ?? 0) + omega * delta;
      const decay = Math.exp(-omega * step);
      this.zoom = target + (delta + c * step) * decay;
      this.zoomVelocity = ((this.zoomVelocity ?? 0) - omega * c * step) * decay;
    }
    this.zoom ??= 1;
    this.zoomTarget = target;
    let tangent = nominal * THREE.MathUtils.clamp(this.zoom, 1, 2);
    if (!this.enabled && !building && a && b) {
      tangent /= 2.15;
      const halfHeight = Math.max(1, Math.min(y - view.top, view.h - this.stage.safeBottom() - y));
      for (const fighter of [a,b]) {
        const pos = this.fitPoint ??= new THREE.Vector3();
        pos.copy(fighter.center).applyMatrix4(camera.matrixWorldInverse);
        const radius = this.stage.frameRadius(fighter) * 1.28;
        const depthToFront = Math.max(1, -pos.z - radius);
        tangent = Math.max(tangent, (Math.abs(pos.x)+radius)/(depthToFront*camera.aspect*0.9),
          (Math.abs(pos.y)+radius)*view.h/(2*halfHeight*depthToFront*0.9));
      }
    }
    const c = this.stage.cam;
    let sx = 0, sy = 0;
    if (!building && dt > 0) {
      if (c.push) {
        c.push.age += dt;
        const k = c.push.age / PUSH_TIME;
        if (k >= 1) c.push = null;
        else tangent /= 1 + c.push.amount * (k < 0.2 ? Math.sin(k / 0.2 * Math.PI / 2) : (1 - (k - 0.2) / 0.8) ** 2);
      }
      if (c.shake4 > 0.001) {
        const amp = c.shake4 * c.shake4 * SHAKE_PX * view.h;
        sx = (Math.random() - 0.5) * amp; sy = (Math.random() - 0.5) * amp;
        c.shake4 *= Math.exp(-dt * 9);
      }
    } else if (building) { c.push = null; c.shake4 = 0; }
    const desired = THREE.MathUtils.radToDeg(2 * Math.atan(tangent));
    camera.fov = desired;
    const ox = view.w / 2 - x, oy = view.h / 2 - y;
    this.stage.setOffset(ox + sx, oy + sy);
    camera.updateProjectionMatrix();
    if (this.plate && !this.referenceReady) {
      // Leave a small border reserve even at the new maximum zoom-out.
      const height = 200 * nominal * 2 * 1.02;
      this.plate.scale.set(height * camera.aspect, height, 1);
      this.plate.quaternion.copy(camera.quaternion);
      this.plate.position.copy(camera.position).add(new THREE.Vector3(ox * height / view.h, -oy * height / view.h, -100).applyQuaternion(camera.quaternion));
      this.referenceReady = true;
    }
    this.stage.particles.mat.uniforms.uScale.value = view.h * this.stage.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }

  dispose() {
    if (this.plate) { this.stage.scene.remove(this.plate); this.plate.geometry.dispose(); this.plate.material.dispose(); }
    this.texture?.dispose(); this.source?.dispose();
  }
}
