import * as THREE from 'three';

const PHOTO = new URL('./assets/battle-depth.svg', import.meta.url).href;
// Impact feel on 凡朔's fixed camera (Elara #万物对战:e6f14ad0): the old chase camera's shake, as px of picture translation
// (its 0.03 × distance jitter at 58°), and a short push-in that tightens the framing and is back within PUSH_TIME.
const SHAKE_PX = 0.03 / (2 * Math.tan(THREE.MathUtils.degToRad(58 / 2))), PUSH_TIME = 0.22;
// 一机双人's straight-down camera (stage.topDown): this high over the two tops' midpoint (followed at TOP_FOLLOW /s, so the
// table never seems to sway). It pushes in and out as single-player does (第三轮 ②): the same zoom on the tops' distance, as a
// half-width of TOP_NEAR m across the band at 1 (close) to twice that at 2 (apart). A floor under it keeps every top's whole
// swept circle in the band: it widens at once as a top needs room and gives way slowly, so a lunge never leaves the picture.
const TOP_HEIGHT = 12, TOP_NEAR = 1.2, TOP_ROOM = 1.12, TOP_FOLLOW = 2.5;

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
    if (this.stage.topDown && document.getElementById('build').hidden) { this.updateTopDown(dt); return; }
    if (this.plate) this.plate.visible = this.enabled;
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
    const [a, b] = this.stage.fighters;
    let tangent = nominal * THREE.MathUtils.clamp(this.zoomStep(dt, building), 1, 2);
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
    const [sx, sy, push] = this.jolt(dt, building);
    tangent /= push;
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

  /** The fight's zoom, 1 (close) to 2 (apart): approach/contact closes in, separation opens out. A critically damped spring
   * keeps position and speed continuous on impacts. */
  zoomStep(dt, building) {
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
    return this.zoom;
  }

  /** The picture's jolts this frame: [x px, y px, how much the push-in tightens the view (1 = none)]. */
  jolt(dt, building) {
    const {view} = this.stage, c = this.stage.cam;
    let sx = 0, sy = 0, push = 1;
    if (!building && dt > 0) {
      if (c.push) {
        c.push.age += dt;
        const k = c.push.age / PUSH_TIME;
        if (k >= 1) c.push = null;
        else push = 1 + c.push.amount * (k < 0.2 ? Math.sin(k / 0.2 * Math.PI / 2) : (1 - (k - 0.2) / 0.8) ** 2);
      }
      if (c.shake4 > 0.001) {
        const amp = c.shake4 * c.shake4 * SHAKE_PX * view.h;
        sx = (Math.random() - 0.5) * amp; sy = (Math.random() - 0.5) * amp;
        c.shake4 *= Math.exp(-dt * 9);
      }
      // 冲挡加重 (Castor 1c01d17d, Elara fa18a1da): this camera had dropped the framing camera's jolts. With `jolts` on it
      // plays them as stage.js does: the decisive shake (a break, a block that bounces) and the punch of a landed 冲 (it throws
      // the view along the lunge). ?feel=old leaves them off, as on the 评委版.
      if (this.stage.jolts) {
        const time = c.shakeTime ?? 0.16;
        if (c.shakeAge < time) {
          c.shakeAge += dt;
          const k = Math.max(0, 1 - c.shakeAge / time), ph = c.shakeAge * 2 * Math.PI * 14;
          sx += Math.sin(ph) * c.shakeAmp * k;
          sy += Math.cos(ph * 0.8) * c.shakeAmp * 0.6 * k;
        }
        if (c.punch) {
          c.punch.age += dt;
          const k = c.punch.age / (c.punch.time ?? 0.14);
          if (k >= 1) c.punch = null;
          // Only a landed 冲's punch moves this view; an ordinary knock stays as light as it was (平撞轻).
          else if (c.punch.lunge) { const e = k < 0.25 ? Math.sin(k / 0.25 * Math.PI / 2) : (1 - (k - 0.25) / 0.75) ** 2; sx -= c.punch.dx * c.punch.px * e; sy -= c.punch.dy * c.punch.px * e; }
        }
      }
    } else if (building) { c.push = null; c.shake4 = 0; c.punch = null; c.shakeAge = Infinity; }
    return [sx, sy, push];
  }

  /** 一机双人: straight down on the arena, stage.topDown up the screen, its centre in the middle of the band between the bars. */
  updateTopDown(dt) {
    const {camera, view} = this.stage, fighters = this.stage.fighters;
    if (this.plate) this.plate.visible = false;
    const fresh = !(dt > 0) || this.topTan == null || this.topFor !== this.stage.topDown;
    // Over the midpoint of the tops still standing (a broken core's top no longer counts).
    const mid = (this.topMid ??= new THREE.Vector3()).set(0, 0, 0), live = fighters.filter(f => f.dim <= 0.5);
    for (const f of live) mid.add(f.center);
    if (live.length) mid.divideScalar(live.length).setY(0);
    const centre = this.topCentre ??= new THREE.Vector3();
    if (fresh) centre.copy(mid); else centre.lerp(mid, 1 - Math.exp(-dt * TOP_FOLLOW));
    camera.position.set(centre.x, TOP_HEIGHT, centre.z);
    camera.up.copy(this.stage.topDown);
    camera.lookAt(centre.x, 0, centre.z);
    camera.updateMatrixWorld(true);
    const bottom = view.h - this.stage.safeBottom(), y = (view.top + bottom) / 2;
    const halfH = Math.max(40, (bottom - view.top) / 2), halfW = view.w / 2 - 6, k = view.h / 2;
    // The tangent of half the vertical field of view: the zoom's TOP_NEAR..2×TOP_NEAR m across the narrower half of the band,
    // and, under it, the floor that keeps every top's swept circle inside the band.
    const zoomed = TOP_NEAR * THREE.MathUtils.clamp(this.zoomStep(dt, false), 1, 2) / TOP_HEIGHT * k / Math.min(halfW, halfH);
    let floor = 0;
    for (const f of live) {
      const p = (this.fitPoint ??= new THREE.Vector3()).copy(f.center).applyMatrix4(camera.matrixWorldInverse);
      const r = this.stage.frameRadius(f) * TOP_ROOM, depth = Math.max(1, -p.z - r);
      floor = Math.max(floor, (Math.abs(p.x) + r) / depth * k / halfW, (Math.abs(p.y) + r) / depth * k / halfH);
    }
    // As single-player's fit: at once when a top needs more room, then giving way slowly.
    if (fresh || floor > this.topTan) this.topTan = floor;
    else this.topTan += (floor - this.topTan) * (1 - Math.exp(-dt * 1.2));
    this.topFor = this.stage.topDown;
    // What the band shows across its narrower half, in metres (for measuring against single-player).
    this.topHalfWidth = Math.max(zoomed, this.topTan) * TOP_HEIGHT * Math.min(halfW, halfH) / k;
    const [sx, sy, push] = this.jolt(dt, false);
    // An impact's push-in tightens the zoom, never past the floor: both tops stay whole through it.
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(zoomed / push, this.topTan)));
    this.stage.setOffset(sx, view.h / 2 - y + sy);
    camera.updateProjectionMatrix();
    this.stage.particles.mat.uniforms.uScale.value = view.h * this.stage.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }

  dispose() {
    if (this.plate) { this.stage.scene.remove(this.plate); this.plate.geometry.dispose(); this.plate.material.dispose(); }
    this.texture?.dispose(); this.source?.dispose();
  }
}
