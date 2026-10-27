import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {instantiate} from './models.js';

export const TEAM = [new THREE.Color('#ff8a3d'), new THREE.Color('#3db4ff')];
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(255,255,255,${inner})`);
  grad.addColorStop(0.45, `rgba(255,255,255,${outer})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 10;
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

// Outer wall: the ring-out boundary, seen from inside as a faint grid. Redder as the safe zone shrinks.
const wallShader = {
  uniforms: {uDanger: {value: 0}},
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uDanger; varying vec3 vP;
    void main(){
      float lat = asin(clamp(vP.y,-1.0,1.0)) / 3.14159265 * 12.0;
      float lon = atan(vP.z, vP.x) / 3.14159265 * 12.0;
      // atan jumps at the seam; take the derivative of a copy whose seam is elsewhere.
      float lon2 = fract(lon / 24.0 + 0.5) * 24.0;
      vec2 g = abs(fract(vec2(lat, lon)) - 0.5);
      vec2 w = vec2(fwidth(lat), min(fwidth(lon), fwidth(lon2))) * 1.2;
      float meridian = (1.0 - smoothstep(0.0, w.y, 0.5 - g.y)) * smoothstep(0.12, 0.45, sqrt(1.0 - vP.y * vP.y));
      float line = max(1.0 - smoothstep(0.0, w.x, 0.5 - g.x), meridian);
      // Linear values: they get brightened by the sRGB conversion below.
      float shade = 0.75 + 0.25 * vP.y;
      vec3 base = mix(vec3(0.0035,0.005,0.011), vec3(0.03,0.002,0.006), 0.25 + 0.75 * uDanger) * shade;
      vec3 lineCol = mix(vec3(0.02,0.05,0.11), vec3(0.16,0.012,0.025), 0.2 + 0.8 * uDanger);
      gl_FragColor = vec4(base + lineCol * line, 1.0);
      #include <colorspace_fragment>
    }`
};
// Safe zone: back faces dim whatever lies beyond the shell, front faces glow at the rim.
const zoneBackShader = {
  uniforms: {},
  vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `void main(){ gl_FragColor = vec4(0.004,0.006,0.012,0.7); }`
};
const zoneFrontShader = {
  uniforms: {uTime: {value: 0}},
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vP = position; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float rim = pow(f, 4.0);
      float pulse = 0.85 + 0.15 * sin(uTime * 2.0);
      vec3 c = vec3(0.3, 0.85, 1.0) * (rim * 0.55 * pulse + 0.004);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`
};
const particleShader = {
  // World-sized sparks, capped on screen so close-ups don't turn into blobs.
  vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale; uniform float uMax;
    void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(uMax, aSize * uScale / max(0.05, -mv.z)); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; varying float vA;
    void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(vC * vA * (1.0 - r) * 1.6, 1.0); }`
};

class Particles {
  constructor(scene, n = 420) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({...particleShader, uniforms: {uScale: {value: 300}, uMax: {value: 24}}, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending});
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
  }
  burst(at, colors, count, speed, size, life) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      tmp.randomDirection().multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([tmp.x, tmp.y, tmp.z], i * 3);
      const c = colors[k % colors.length];
      this.col.set([c.r, c.g, c.b], i * 3);
      this.size[i] = size * (0.5 + Math.random() * 0.8);
      this.max[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
    }
  }
  update(dt) {
    const drag = Math.exp(-dt * 3.2);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; this.vel[i * 3 + k] *= drag; }
      this.alpha[i] = Math.max(0, this.life[i] / this.max[i]);
    }
    for (const name of ['position', 'aAlpha', 'color', 'aSize']) this.geo.attributes[name].needsUpdate = true;
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.geo.attributes.aAlpha.needsUpdate = true; }
}

/** Expanding billboard rings at impact points (crit / weak / ko). Driven by real time. */
class Rings {
  constructor(scene) {
    const tex = ringTexture();
    this.pool = Array.from({length: 8}, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending}));
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      return {s, age: 0, dur: 1, from: 0, to: 1};
    });
    this.next = 0;
  }
  spawn(at, color, from, to, dur) {
    const r = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    Object.assign(r, {age: 0, dur, from, to});
    r.s.position.copy(at);
    r.s.material.color.copy(color);
    r.s.visible = true;
  }
  update(dt) {
    for (const r of this.pool) {
      if (!r.s.visible) continue;
      r.age += dt;
      const k = r.age / r.dur;
      if (k >= 1) { r.s.visible = false; continue; }
      const e = 1 - (1 - k) ** 3;
      r.s.scale.setScalar(r.from + (r.to - r.from) * e);
      r.s.material.opacity = (1 - k) * 1.1;
    }
  }
  clear() { for (const r of this.pool) r.s.visible = false; }
}

function itemRadius(item) {
  return Math.hypot(...item.bounds.max.map((v, k) => (v - item.bounds.min[k]) / 2));
}

export class Stage {
  constructor(canvas, rules) {
    this.rules = rules;
    this.items = new Map(rules.items.map(i => [i.id, i]));
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070a12');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(55, 390 / 844, 0.05, 60);
    this.scene.add(this.camera);
    // Lights ride with the camera so every shape stays lit the same way while the view orbits.
    this.scene.add(new THREE.HemisphereLight('#c9dcff', '#20121a', 0.7));
    const key = new THREE.DirectionalLight('#fff4e6', 2.0);
    key.position.set(1.2, 1.6, 1.0);
    const rim = new THREE.DirectionalLight('#a9c8ff', 1.8);
    rim.position.set(-0.6, 0.8, -2.0);
    for (const l of [key, rim]) {
      const target = new THREE.Object3D();
      this.camera.add(l, target);
      target.position.set(0, 0, -1);
      l.target = target;
    }

    const R = rules.arena.radius;
    this.wall = new THREE.Mesh(new THREE.SphereGeometry(R, 72, 48), new THREE.ShaderMaterial({...wallShader, uniforms: THREE.UniformsUtils.clone(wallShader.uniforms), side: THREE.BackSide, depthWrite: false}));
    this.wall.renderOrder = -2;
    this.scene.add(this.wall);
    const zoneGeo = new THREE.SphereGeometry(1, 64, 40);
    this.zoneBack = new THREE.Mesh(zoneGeo, new THREE.ShaderMaterial({...zoneBackShader, side: THREE.BackSide, transparent: true, depthWrite: false}));
    this.zoneBack.renderOrder = -1;
    this.zoneFront = new THREE.Mesh(zoneGeo, new THREE.ShaderMaterial({...zoneFrontShader, uniforms: THREE.UniformsUtils.clone(zoneFrontShader.uniforms), side: THREE.FrontSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
    this.zoneFront.renderOrder = 4;
    this.scene.add(this.zoneBack, this.zoneFront);

    this.haloTex = radialTexture(0.9, 0.35);
    this.particles = new Particles(this.scene);
    this.rings = new Rings(this.scene);
    this.fighters = [];
    this.time = 0;

    this.cam = {focus: new THREE.Vector3(), dist: 6, quat: new THREE.Quaternion(), shake: 0, push: 0, pushAt: new THREE.Vector3(), ready: false, turning: false};
    this.view = {w: 390, h: 844, top: 70, bottom: 130, extra: 0, extraTarget: 0};
  }

  resize(w, h, top, bottom) {
    Object.assign(this.view, {w, h, top, bottom});
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyInsets();
    const dpr = this.renderer.getPixelRatio();
    this.particles.mat.uniforms.uScale.value = h * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.particles.mat.uniforms.uMax.value = 14 * dpr;
  }

  /** Builds one fighter per definition: every part is its own model, plus a base for assemblies. */
  setFighters(definitions) {
    for (const f of this.fighters) {
      this.scene.remove(f.root);
      f.root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    }
    this.fighters = definitions.map((def, i) => {
      const uniforms = {uRim: {value: TEAM[i].clone()}, uFlash: {value: 0}, uDanger: {value: 0}, uDim: {value: 0}};
      const root = new THREE.Group();
      const parts = def.parts.map(p => {
        const obj = instantiate(p.item, uniforms);
        root.add(obj);
        return obj;
      });
      let base = null;
      if (def.parts.length > 1) {
        const he = this.rules.arena.base.halfExtents;
        const mat = new THREE.MeshStandardMaterial({color: '#3a4256', roughness: 0.6, metalness: 0.2});
        base = new THREE.Mesh(new THREE.BoxGeometry(he[0] * 2, he[1] * 2, he[2] * 2), mat);
        mat.onBeforeCompile = shader => { shader.uniforms.uRim = uniforms.uRim; shader.fragmentShader = 'uniform vec3 uRim;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uRim * pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2) * 1.5;'); };
        root.add(base);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: this.haloTex, color: TEAM[i], transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending}));
      halo.renderOrder = 3;
      root.add(halo);
      this.scene.add(root);
      const mounts = this.rules.arena.mounts;
      const radius = Math.max(...def.parts.map(p => Math.hypot(...mounts[p.mount]) + itemRadius(this.items.get(p.item))));
      return {root, parts, base, halo, uniforms, radius, center: new THREE.Vector3(), flash: 0, danger: 0, dim: 0, dimTarget: 0};
    });
    this.cam.ready = false;
  }

  /** Applies one sampled replay state (world transforms). */
  pose(state) {
    state.fighters.forEach((s, i) => {
      const f = this.fighters[i];
      s.parts.forEach((p, k) => { f.parts[k].position.copy(p.pos); f.parts[k].quaternion.copy(p.quat); });
      if (f.base) { f.base.position.copy(s.pos); f.base.quaternion.copy(s.quat); }
      f.center.copy(s.pos);
    });
    const a = this.rules.arena;
    this.zoneBack.scale.setScalar(Math.max(state.zoneRadius, 0.001));
    this.zoneFront.scale.setScalar(Math.max(state.zoneRadius, 0.001));
    this.wall.material.uniforms.uDanger.value = 1 - (state.zoneRadius - a.zoneEndRadius) / (a.zoneStartRadius - a.zoneEndRadius);
    this.zoneRadius = state.zoneRadius;
  }

  // Shift the projection so the focus sits in the middle of the area between HUD and controls
  // (plus any extra bottom panel such as the caption).
  applyInsets() {
    const {w, h, top, bottom, extra} = this.view;
    this.camera.setViewOffset(w, h, 0, (bottom + extra - top) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }
  /** Extra space covered at the bottom (CSS px); eased in updateCamera. */
  setBottomPanel(px) { this.view.extraTarget = px; }

  flashFighter(i, amount) { const f = this.fighters[i]; f.flash = Math.max(f.flash, amount); }
  dimFighter(i) { this.fighters[i].dimTarget = 1; }
  burst(point, colors, count, speed, size, life) { this.particles.burst(point, colors, count, speed, size, life); }
  ring(point, color, from, to, dur) { this.rings.spawn(point, color, from, to, dur); }
  shake(amount) { this.cam.shake = Math.min(1.2, Math.max(this.cam.shake, amount)); }
  /** 0..1: push the camera toward a point (decisive slow motion). */
  setPush(amount, point) { this.cam.push = amount; if (point) this.cam.pushAt.copy(point); }
  /**
   * Replay cut: with the fighters posed at the hit, pick a side-on view of the contact that neither
   * fighter blocks. Tries directions around the line between them (fighter 1 stays on top) and casts
   * rays from each camera spot to the contact point and to the smaller fighter; prefers clear views,
   * little tilt, and staying close to the current direction.
   */
  aimAtHit(point) {
    const [a, b] = this.fighters;
    if (!a || !b) return;
    const c = this.cam;
    const n = new THREE.Vector3().subVectors(b.center, a.center);
    if (n.lengthSq() < 1e-8) return;
    n.normalize();
    this.scene.updateMatrixWorld(true);
    const meshesOf = f => { const m = []; f.root.traverse(o => { if (o.isMesh) m.push(o); }); return m; };
    const all = [...meshesOf(a), ...meshesOf(b)];
    const [small, big] = a.radius <= b.radius ? [a, b] : [b, a];
    const bigMeshes = meshesOf(big);
    const cur = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat);
    const e1 = cur.clone().addScaledVector(n, -cur.dot(n));
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).addScaledVector(n, -n.x);
    if (e1.lengthSq() < 1e-6) e1.set(0, 1, 0).addScaledVector(n, -n.y);
    e1.normalize();
    const e2 = new THREE.Vector3().crossVectors(n, e1);
    const ray = new THREE.Raycaster();
    const D = 1.1;
    const blocked = (target, meshes, fwd, margin) => {
      const from = target.clone().addScaledVector(fwd, -D);
      ray.set(from, fwd);
      ray.near = 0;
      ray.far = D - margin;
      return ray.intersectObjects(meshes, false).length > 0;
    };
    // Points spread over the smaller fighter's model (plus its centre): how much of it the big one hides.
    const samples = [small.center.clone()];
    small.root.traverse(o => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 12));
      for (let i = 0; i < pos.count; i += step) samples.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    });
    const scoreOf = (fwd, tilt) => {
      const hidden = samples.filter(p => blocked(p, bigMeshes, fwd, 0.01)).length / samples.length;
      // The contact point often sits a little inside the render meshes, hence the wider margin.
      return hidden * 8 + (blocked(point, all, fwd, 0.08) ? 3 : 0) + Math.abs(tilt) * 0.8 + (1 - fwd.dot(cur)) * 0.5;
    };
    // The current view competes too (as if untilted): if it already shows the contact, there is no cut.
    let best = cur, bestScore = Math.abs(cur.dot(n)) < 0.9 ? scoreOf(cur, 0) : Infinity;
    for (const tilt of [0, 0.4, -0.4, 0.8, -0.8, 1.15, -1.15]) {
      for (let k = 0; k < 24; k++) {
        const ang = (k / 24) * Math.PI * 2;
        const fwd = e1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(e2, Math.sin(ang))
          .multiplyScalar(Math.cos(tilt)).addScaledVector(n, Math.sin(tilt)).normalize();
        const score = scoreOf(fwd, tilt);
        if (score < bestScore) { bestScore = score; best = fwd; }
      }
    }
    if (best !== cur) {
      tmpM.lookAt(new THREE.Vector3(), best, n);
      c.quat.setFromRotationMatrix(tmpM);
    }
    c.turning = false;
    c.locked = true; // the decisive shot holds: no orbiting until the next match
  }
  /** Jump focus and distance to the current pose (after a cut); orientation is kept. */
  snapFocus() {
    const [a, b] = this.fighters;
    if (!a || !b) return;
    this.cam.focus.addVectors(a.center, b.center).multiplyScalar(0.5);
    this.cam.dist = -1;
  }
  clearFx() {
    this.particles.clear();
    this.rings.clear();
    for (const f of this.fighters) { f.flash = 0; f.dim = f.dimTarget = 0; f.uniforms.uDim.value = 0; f.uniforms.uFlash.value = 0; }
    this.cam.shake = 0;
  }

  /** Frames both fighters: opens with their line up the (tall) screen, then only orbits when they line up in depth. */
  updateCamera(dt, snap) {
    const [a, b] = this.fighters;
    if (!a || !b) return;
    const c = this.cam;
    const axis = tmp.subVectors(b.center, a.center);
    const d = axis.length();
    const mid = tmp2.addVectors(a.center, b.center).multiplyScalar(0.5);
    if (snap || !c.ready) {
      // Opening shot: look across the line between them, slightly from above, fighter 1 on top.
      const up = axis.clone().normalize();
      const fwd = new THREE.Vector3(0.0, -0.35, -1).normalize();
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      tmpM.lookAt(new THREE.Vector3(), fwd, up);
      c.quat.setFromRotationMatrix(tmpM);
      c.focus.copy(mid);
      c.ready = true;
      c.dist = -1;
      c.locked = false;
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat);
    if (d > 0.35 && !c.locked) {
      // Only orbit when the two start lining up along the view (one hiding the other), and then by
      // the smallest rotation that brings their line back across the screen. No deliberate roll.
      const n = axis.clone().divideScalar(d);
      const along = Math.abs(fwd.dot(n));
      if (!c.turning && along > 0.5) c.turning = true;
      if (c.turning && along < 0.17) c.turning = false;
      if (c.turning) {
        const wantFwd = fwd.clone().addScaledVector(n, -fwd.dot(n)).normalize();
        tmpQ.setFromUnitVectors(fwd, wantFwd);
        const angle = Math.acos(THREE.MathUtils.clamp(fwd.dot(wantFwd), -1, 1));
        const maxStep = THREE.MathUtils.degToRad(30) * dt;
        const weight = THREE.MathUtils.smoothstep(d, 0.35, 1.0);
        const k = Math.min(1 - Math.exp(-dt / 0.8), angle > 1e-5 ? maxStep / angle : 1) * weight;
        c.quat.premultiply(new THREE.Quaternion().slerp(tmpQ, k)).normalize();
      }
    }
    const focus = mid.clone().lerp(c.pushAt, c.push * 0.85);
    c.focus.lerp(focus, snap ? 1 : 1 - Math.exp(-dt / 0.18));

    // Distance that keeps both bounding spheres inside the free area (with margin).
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quat);
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quat);
    const fv = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    if (Math.abs(this.view.extra - this.view.extraTarget) > 0.5) {
      this.view.extra += (this.view.extraTarget - this.view.extra) * (snap ? 1 : 1 - Math.exp(-dt / 0.35));
      this.applyInsets();
    }
    const freeV = tanV * (this.view.h - this.view.top - this.view.bottom - this.view.extra) / this.view.h;
    let need = 1.0;
    for (const f of this.fighters) {
      const rel = f.center.clone().sub(c.focus);
      const depth = rel.dot(fv);
      need = Math.max(need,
        (Math.abs(rel.dot(right)) + f.radius) / (tanH * 0.86) - depth,
        (Math.abs(rel.dot(upv)) + f.radius) / (freeV * 0.86) - depth);
    }
    need = Math.max(c.push > 0 ? 0.7 : 1.0, need * (1 - c.push * 0.4));
    if (c.dist < 0 || snap) c.dist = need;
    // Zoom out quickly, zoom in gently — except while pushing in on the decisive hit.
    else c.dist += (need - c.dist) * (1 - Math.exp(-dt / (need > c.dist ? 0.22 : c.push > 0.05 ? 0.3 : 0.9)));

    this.camera.quaternion.copy(c.quat);
    this.camera.position.copy(c.focus).addScaledVector(fv, -c.dist);
    if (c.shake > 0.001) {
      const s = c.shake * c.shake * 0.035 * c.dist;
      this.camera.position.addScaledVector(right, (Math.random() - 0.5) * s).addScaledVector(upv, (Math.random() - 0.5) * s);
      c.shake *= Math.exp(-dt * 9);
    }
  }

  /** realDt drives camera and rings; simDt drives particles (slow motion and hit-stop apply). */
  render(realDt, simDt) {
    this.time += realDt;
    this.zoneFront.material.uniforms.uTime.value = this.time;
    for (const f of this.fighters) {
      f.flash *= Math.exp(-realDt * 14);
      f.dim += (f.dimTarget - f.dim) * (1 - Math.exp(-realDt * 4));
      f.uniforms.uFlash.value = f.flash;
      f.uniforms.uDim.value = f.dim;
      const outside = this.zoneRadius !== undefined && f.center.length() > this.zoneRadius;
      f.danger += ((outside ? 0.55 + 0.45 * Math.sin(this.time * 12) : 0) - f.danger) * (1 - Math.exp(-realDt * 10));
      f.uniforms.uDanger.value = Math.max(0, f.danger);
      // Halo sits just behind the fighter so it reads as a backlight, not a fog over it.
      f.halo.position.copy(f.center).addScaledVector(tmp.subVectors(f.center, this.camera.position).normalize(), f.radius * 0.9);
      f.halo.scale.setScalar(f.radius * 2.8);
      f.halo.material.opacity = 0.32 * (1 - f.dim * 0.8);
    }
    this.particles.update(simDt);
    this.rings.update(realDt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(p, out) {
    tmp.copy(p).project(this.camera);
    if (tmp.z > 1) return null;
    out.x = (tmp.x * 0.5 + 0.5) * this.view.w;
    out.y = (-tmp.y * 0.5 + 0.5) * this.view.h;
    return out;
  }
  /** Approximate on-screen radius (CSS px) of a fighter. */
  screenRadius(i) {
    const f = this.fighters[i];
    const dist = Math.max(0.05, f.center.distanceTo(this.camera.position));
    return f.radius / (dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * this.view.h / 2;
  }
}
