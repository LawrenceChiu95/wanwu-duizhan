import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {instantiate} from './models.js';

export const TEAM = [new THREE.Color('#ff8a3d'), new THREE.Color('#3db4ff')];
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

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
/** Core ball skin: dark metal in the team colour, a bright equator band and stripes that show the spin. */
function coreTextures(color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const base = color.clone().multiplyScalar(0.35);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, 256, 128);
  const e = document.createElement('canvas');
  e.width = 256;
  e.height = 128;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 256, 128);
  for (const ctx of [g, ge]) {
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.fillRect(0, 56, 256, 16); // equator band
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 4; k++) ctx.fillRect(k * 64 + 4, 0, 10, 128); // meridian stripes
  }
  const map = new THREE.CanvasTexture(c), emissive = new THREE.CanvasTexture(e);
  map.colorSpace = emissive.colorSpace = THREE.SRGBColorSpace;
  return {map, emissive};
}

const backdropShader = {
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vP;
    void main(){
      float lat = asin(clamp(vP.y,-1.0,1.0)) / 3.14159265 * 12.0;
      float lon = atan(vP.z, vP.x) / 3.14159265 * 12.0;
      float lon2 = fract(lon / 24.0 + 0.5) * 24.0;
      vec2 g = abs(fract(vec2(lat, lon)) - 0.5);
      vec2 w = vec2(fwidth(lat), min(fwidth(lon), fwidth(lon2))) * 1.2;
      float meridian = (1.0 - smoothstep(0.0, w.y, 0.5 - g.y)) * smoothstep(0.12, 0.45, sqrt(1.0 - vP.y * vP.y));
      float line = max(1.0 - smoothstep(0.0, w.x, 0.5 - g.x), meridian);
      float shade = 0.75 + 0.25 * vP.y;
      vec3 base = vec3(0.0035,0.005,0.011) * shade;
      gl_FragColor = vec4(base + vec3(0.012,0.03,0.07) * line, 1.0);
      #include <colorspace_fragment>
    }`
};
// Faint rings in the spin plane around the pull centre: where "the middle" is, and how far apart they are.
const planeShader = {
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vP;
    void main(){
      float r = length(vP);
      float k = r / 0.5;
      float ring = 1.0 - smoothstep(0.0, fwidth(k) * 1.5, abs(fract(k) - 0.5) * -1.0 + 0.5);
      float fade = (1.0 - smoothstep(1.2, 3.6, r));
      float centre = exp(-r * r * 18.0) * 0.3;
      gl_FragColor = vec4(vec3(0.25, 0.55, 1.0) * (ring * 0.09 * fade + centre), 1.0);
      #include <colorspace_fragment>
    }`
};
const particleShader = {
  vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale; uniform float uMax;
    void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(uMax, aSize * uScale / max(0.05, -mv.z)); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; varying float vA;
    void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(vC * vA * (1.0 - r) * 1.6, 1.0); }`
};
// Spin trail: a fan swept behind each part, in the body frame. out parts sweep a flat sector,
// hugging parts a band of cylinder. Brightest at the part and at its outer edge.
const fanShader = {
  vertexShader: `attribute vec2 aFan; uniform float uTheta; uniform float uSpan; uniform float uR0; uniform float uR1; uniform float uY0; uniform float uY1; uniform float uHug;
    varying vec2 vF;
    void main(){
      float ang = uTheta - aFan.x * uSpan;
      float r = uHug > 0.5 ? uR1 : mix(uR0, uR1, aFan.y);
      float y = uHug > 0.5 ? mix(uY0, uY1, aFan.y) : 0.5 * (uY0 + uY1);
      vF = aFan;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(sin(ang) * r, y, cos(ang) * r, 1.0);
    }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uHug; varying vec2 vF;
    void main(){
      float along = pow(1.0 - vF.x, 1.25);
      // Flat sector for an out part: faint inside, a bright streak where the tip passed.
      float edge = smoothstep(0.86, 0.985, vF.y) * (1.0 - smoothstep(0.985, 1.0, vF.y));
      float across = uHug > 0.5 ? 0.35 + 0.65 * (1.0 - abs(vF.y - 0.5) * 2.0) : 0.10 + 0.35 * vF.y * vF.y + 1.1 * edge;
      float a = along * across * uOpacity;
      vec3 col = mix(uColor, vec3(1.0), 0.45 * edge * pow(1.0 - vF.x, 3.0));
      gl_FragColor = vec4(col * a, 1.0);
    }`
};

class Particles {
  constructor(scene, n = 520) {
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
  burst(at, colors, count, speed, size, life, drift) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      tmp.randomDirection().multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      if (drift) tmp.add(drift);
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

/** Expanding billboard rings at impact points. Driven by real time. */
class Rings {
  constructor(scene) {
    const tex = ringTexture();
    this.pool = Array.from({length: 10}, () => {
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

const fanGeometry = (() => {
  // 24 steps along the sweep x 2 across.
  const n = 24, pos = [], fan = [], index = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= 1; j++) { pos.push(0, 0, 0); fan.push(i / n, j); }
  for (let i = 0; i < n; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; index.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFan', new THREE.Float32BufferAttribute(fan, 2));
  g.setIndex(index);
  return g;
})();

export class Stage {
  /** layout(def) -> [{item, orient, offset, quat, theta, r0, r1, y0, y1}] for a fighter definition (body frame). */
  constructor(canvas, {items, coreRadius, layout}) {
    this.items = new Map(items.map(i => [i.id, i]));
    this.coreRadius = coreRadius;
    this.layout = layout;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070a12');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(58, 390 / 844, 0.05, 80);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#c9dcff', '#20121a', 0.75));
    const key = new THREE.DirectionalLight('#fff4e6', 2.0);
    key.position.set(1.2, 1.6, 1.0);
    const rim = new THREE.DirectionalLight('#a9c8ff', 1.6);
    rim.position.set(-0.6, 0.8, -2.0);
    for (const l of [key, rim]) {
      const target = new THREE.Object3D();
      this.camera.add(l, target);
      target.position.set(0, 0, -1);
      l.target = target;
    }

    const back = new THREE.Mesh(new THREE.SphereGeometry(9, 72, 48), new THREE.ShaderMaterial({...backdropShader, side: THREE.BackSide, depthWrite: false}));
    back.renderOrder = -2;
    this.scene.add(back);
    const plane = new THREE.Mesh(new THREE.CircleGeometry(4, 96), new THREE.ShaderMaterial({...planeShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.02;
    plane.renderOrder = -1;
    this.scene.add(plane);

    this.haloTex = radialTexture(0.9, 0.35);
    this.coreGeo = new THREE.SphereGeometry(coreRadius, 40, 28);
    this.coreTex = TEAM.map(coreTextures);
    this.particles = new Particles(this.scene);
    this.rings = new Rings(this.scene);
    this.fighters = [];
    this.debris = [];
    this.time = 0;
    this.cam = {focus: new THREE.Vector3(), dist: 4, yaw: 0, pitch: 0.95, shake: 0, push: 0, pushAt: new THREE.Vector3(), ready: false, mode: 'fight'};
    this.view = {w: 390, h: 844, top: 70, bottom: 130};
  }

  resize(w, h, top, bottom) {
    Object.assign(this.view, {w, h, top, bottom});
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyInsets();
    const dpr = this.renderer.getPixelRatio();
    this.particles.mat.uniforms.uScale.value = h * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.particles.mat.uniforms.uMax.value = 16 * dpr;
  }
  setInsets(top, bottom) { Object.assign(this.view, {top, bottom}); this.applyInsets(); }
  applyInsets() {
    const {w, h, top, bottom} = this.view;
    this.camera.setViewOffset(w, h, 0, (bottom - top) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  disposeFighter(f) {
    this.scene.remove(f.root, f.halo);
    f.halo.material.dispose();
    f.root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
  }

  /** One fighter per definition: a body group (core ball, parts at their mounts, spin fans). */
  setFighters(definitions) {
    for (const f of this.fighters) this.disposeFighter(f);
    this.clearDebris();
    this.fighters = definitions.map((def, i) => this.buildFighter(def, i));
    this.cam.ready = false;
  }
  /** Rebuild one fighter in place (assembly edits), keeping its pose. */
  replaceFighter(i, def) {
    const old = this.fighters[i];
    const f = this.buildFighter(def, i);
    if (old) {
      f.root.position.copy(old.root.position);
      f.root.quaternion.copy(old.root.quaternion);
      f.center.copy(old.center);
      this.disposeFighter(old);
    }
    this.fighters[i] = f;
  }
  buildFighter(def, i) {
    const team = TEAM[i];
    const root = new THREE.Group();
    const coreUniforms = {uRim: {value: team.clone()}, uFlash: {value: 0}, uDanger: {value: 0}, uDim: {value: 0}};
    const coreMat = new THREE.MeshStandardMaterial({map: this.coreTex[i].map, emissiveMap: this.coreTex[i].emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.9, metalness: 0.75, roughness: 0.3});
    patchRim(coreMat, coreUniforms);
    const core = new THREE.Mesh(this.coreGeo, coreMat);
    root.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: this.haloTex, color: team, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending}));
    halo.renderOrder = 3;
    this.scene.add(halo);
    const parts = this.layout(def).map(p => {
      const uniforms = {uRim: {value: team.clone()}, uFlash: {value: 0}, uDanger: {value: 0}, uDim: {value: 0}};
      const obj = instantiate(p.item, uniforms);
      const holder = new THREE.Group();
      holder.position.fromArray(p.offset);
      holder.quaternion.fromArray(p.quat);
      holder.add(obj);
      root.add(holder);
      const fan = new THREE.Mesh(fanGeometry, new THREE.ShaderMaterial({...fanShader, uniforms: {
        uTheta: {value: p.theta}, uSpan: {value: 0}, uR0: {value: p.r0}, uR1: {value: p.r1}, uY0: {value: p.y0}, uY1: {value: p.y1}, uHug: {value: p.orient === 'hug' ? 1 : 0},
        uColor: {value: team.clone().lerp(new THREE.Color('#ffffff'), 0.25)}, uOpacity: {value: 0.5}
      }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide}));
      fan.frustumCulled = false;
      fan.renderOrder = 2;
      root.add(fan);
      // Framing extent: the model's own bounds about the spin axis (a model can reach past its collision hull).
      root.updateMatrixWorld(true);
      let reach = p.r1, y0 = p.y0, y1 = p.y1;
      obj.traverse(o => {
        if (!o.isMesh) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (let c = 0; c < 8; c++) {
          const v = new THREE.Vector3(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
          reach = Math.max(reach, Math.hypot(v.x, v.z)); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
      });
      return {holder, obj, fan, uniforms, flash: 0, damage: 0, alive: true, item: p.item, orient: p.orient, r1: p.r1, reach, y0, y1};
    });
    this.scene.add(root);
    const sweep = Math.max(this.coreRadius, ...parts.map(p => p.r1));
    return {root, core, coreUniforms, halo, parts, sweep, center: new THREE.Vector3(), spin: 0, flash: 0, dim: 0, dimTarget: 0, coreAlive: true, def};
  }

  /** Applies one sampled replay state: body transform, angular speed about its up axis, alive flags, HP. */
  pose(state) {
    state.fighters.forEach((s, i) => {
      const f = this.fighters[i];
      if (!f) return;
      f.root.position.copy(s.pos);
      f.root.quaternion.copy(s.quat);
      f.center.copy(s.pos);
      tmp.copy(UP).applyQuaternion(s.quat);
      f.spin = s.angularVelocity ? s.angularVelocity.dot(tmp) : 0;
      s.parts.forEach((p, k) => {
        const part = f.parts[k];
        if (!part) return;
        if (part.alive !== p.alive) { part.alive = p.alive; part.holder.visible = p.alive; part.fan.visible = p.alive; }
        part.damage = 1 - p.hp / p.maxHp;
      });
      f.coreDamage = 1 - s.hp / s.maxHp;
      if (f.coreAlive !== s.hp > 0) { f.coreAlive = s.hp > 0; f.dimTarget = f.coreAlive ? 0 : 1; }
    });
  }

  flashPart(i, partId, amount) {
    const f = this.fighters[i];
    if (!f) return;
    if (partId === 'core') f.flash = Math.max(f.flash, amount);
    else { const p = f.parts[Number(partId.split('-')[1])]; if (p) p.flash = Math.max(p.flash, amount); }
  }
  burst(point, colors, count, speed, size, life, drift) { this.particles.burst(point, colors, count, speed, size, life, drift); }
  ring(point, color, from, to, dur) { this.rings.spawn(point, color, from, to, dur); }
  shake(amount) { this.cam.shake = Math.min(1.2, Math.max(this.cam.shake, amount)); }
  setPush(amount, point) { this.cam.push = amount; if (point) this.cam.pushAt.copy(point); }

  /** A part breaks off: its model flies away from the break pose with the recorded velocity, tumbling and shrinking. */
  breakPart(i, partIndex, e) {
    const f = this.fighters[i];
    const part = f?.parts[partIndex];
    if (!part) return;
    part.holder.updateWorldMatrix(true, false);
    const piece = part.obj.clone(true);
    const m = part.obj.matrixWorld.clone();
    m.decompose(piece.position, piece.quaternion, piece.scale);
    // Stays bright in the team colour while it falls away, so it reads as "theirs, gone".
    this.scene.add(piece);
    const vel = new THREE.Vector3().fromArray(e.velocity);
    // A little extra outward kick so the piece clearly leaves the core.
    const out = piece.position.clone().sub(f.center).setY(0);
    if (out.lengthSq() > 1e-6) vel.addScaledVector(out.normalize(), 1.2);
    const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.debris.push({piece, vel, spinAxis, spin: 6 + Math.random() * 6, age: 0, life: 1.6, scale0: piece.scale.x});
    part.alive = false;
    part.holder.visible = false;
    part.fan.visible = false;
    const at = piece.position.clone();
    this.burst(at, [new THREE.Color('#ffffff'), TEAM[i], new THREE.Color('#ffd27a'), TEAM[i]], 70, 2.6, 0.03, 1.0, vel.clone().multiplyScalar(0.5));
    this.ring(at, TEAM[i], 0.1, 1.4, 0.6);
    this.ring(at, new THREE.Color('#ffffff'), 0.05, 0.7, 0.35);
  }
  /** The loser's core is gone: whatever is still mounted falls away. */
  scatter(i) {
    const f = this.fighters[i];
    if (!f) return;
    f.parts.forEach((p, k) => {
      if (!p.alive) return;
      p.holder.updateWorldMatrix(true, true);
      const at = new THREE.Vector3().setFromMatrixPosition(p.obj.matrixWorld), out = at.clone().sub(f.center).setY(0.15).normalize();
      this.breakPart(i, k, {velocity: out.multiplyScalar(1.6).toArray()});
    });
  }
  clearDebris() { for (const d of this.debris) this.scene.remove(d.piece); this.debris = []; }
  clearFx() {
    this.particles.clear();
    this.rings.clear();
    this.clearDebris();
    for (const f of this.fighters) {
      f.flash = 0; f.dim = f.dimTarget = 0; f.coreAlive = true;
      for (const p of f.parts) { p.flash = 0; p.alive = true; p.holder.visible = p.fan.visible = true; }
    }
    this.cam.shake = 0;
    this.cam.push = 0;
  }

  /**
   * Camera from above the spin plane. fight: both tops framed, the player (0) near the bottom and the
   * opponent (1) at the top; the yaw follows the line between them slowly. build: closer on the player.
   */
  /** build | fight | result (result frames only the given fighters, from higher up). */
  setCameraMode(mode, only = null) { this.cam.mode = mode; this.cam.only = only; }
  updateCamera(dt, snap) {
    const [a, b] = this.fighters;
    if (!a || !b) return;
    const c = this.cam;
    const axis = tmp.subVectors(b.center, a.center).setY(0);
    if (axis.lengthSq() > 1e-6 && c.mode !== 'result') {
      const want = Math.atan2(axis.x, axis.z);
      let d = want - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (snap || !c.ready) c.yaw = want;
      // Follow only a clear turn of the line, and gently, so the view does not swim.
      else if (Math.abs(d) > 0.25) c.yaw += Math.sign(d) * Math.min(Math.abs(d) - 0.25, dt * 1.6);
    }
    // In the decisive slow motion the view tips toward top-down, so the near top cannot loom over the hit;
    // the result looks down on the winner so its core and both pieces read.
    const pitch = c.mode === 'build' ? 0.6 : c.mode === 'result' ? 1.22 : 0.92 + c.push * 0.3;
    c.pitch += (pitch - c.pitch) * (snap || !c.ready ? 1 : 1 - Math.exp(-dt / (c.mode === 'result' ? 0.3 : 0.5)));
    const fwd = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
    tmpM.lookAt(new THREE.Vector3(), fwd, UP);
    tmpQ.setFromRotationMatrix(tmpM);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tmpQ), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * this.camera.aspect;
    const freeV = tanV * (this.view.h - this.view.top - this.view.bottom) / this.view.h;

    if (c.mode === 'build') {
      const focus = tmp2.copy(a.center).lerp(b.center, 0.22);
      if (snap || !c.ready) c.focus.copy(focus); else c.focus.lerp(focus, 1 - Math.exp(-dt / 0.2));
      const rel = tmp.copy(a.center).sub(c.focus), depth = rel.dot(fwd), rx = a.sweep * 1.05, ry = a.sweep * (Math.sin(c.pitch) * 0.9 + 0.2);
      const need = Math.max(1.6, (Math.abs(rel.dot(right)) + rx) / (tanH * 0.95) - depth, (Math.abs(rel.dot(upv)) + ry) / (freeV * 0.95) - depth);
      if (snap || !c.ready) c.dist = need; else c.dist += (need - c.dist) * (1 - Math.exp(-dt / 0.45));
    } else {
      // Keep every listed top whole in the safe area (below the HUD, above the caption or result card):
      // each top's swept cylinder (its live pieces' reach and height), sampled around, is fitted with a margin.
      const list = c.mode === 'result' && c.only ? c.only.map(i => this.fighters[i]).filter(Boolean) : [a, b];
      const pts = [];
      for (const f of list) {
        let R = this.coreRadius, y0 = -this.coreRadius, y1 = this.coreRadius;
        for (const p of f.parts) if (p.alive) { R = Math.max(R, p.reach); y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1); }
        // About the top's own (possibly tilted) up axis; 12 samples, pushed out to circumscribe the circle.
        R /= Math.cos(Math.PI / 12);
        for (let k = 0; k < 12; k++) for (const y of [y0, y1]) pts.push(new THREE.Vector3(Math.cos(k * Math.PI / 6) * R, y, Math.sin(k * Math.PI / 6) * R).applyQuaternion(f.root.quaternion).add(f.center));
      }
      const base = new THREE.Vector3();
      for (const f of list) base.add(f.center);
      base.divideScalar(list.length);
      let x0 = Infinity, x1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of pts) { const d = tmp.copy(p).sub(base), x = d.dot(right), y = d.dot(upv); x0 = Math.min(x0, x); x1 = Math.max(x1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y); }
      const focus = base.addScaledVector(right, (x0 + x1) / 2).addScaledVector(upv, (v0 + v1) / 2);
      if (snap || !c.ready) c.focus.copy(focus); else c.focus.lerp(focus, 1 - Math.exp(-dt / 0.15));
      // Distance from the focus actually used, so a lagging pan is covered too.
      const m = c.mode === 'result' ? 0.62 : 0.88;
      let need = 0.8;
      for (const p of pts) { const d = tmp.copy(p).sub(c.focus), z = d.dot(fwd); need = Math.max(need, Math.abs(d.dot(right)) / (tanH * m) - z, Math.abs(d.dot(upv)) / (freeV * m) - z); }
      // Zoom out at once when the tops fly apart; come back in gently.
      if (snap || !c.ready) c.dist = need;
      else c.dist += (need - c.dist) * (1 - Math.exp(-dt / (need > c.dist ? 0.06 : c.mode === 'result' ? 0.3 : 0.6)));
    }
    c.ready = true;

    this.camera.quaternion.copy(tmpQ);
    this.camera.position.copy(c.focus).addScaledVector(fwd, -c.dist);
    if (c.shake > 0.001) {
      const s = c.shake * c.shake * 0.03 * c.dist;
      this.camera.position.addScaledVector(right, (Math.random() - 0.5) * s).addScaledVector(upv, (Math.random() - 0.5) * s);
      c.shake *= Math.exp(-dt * 9);
    }
  }

  /** realDt drives camera, rings and glow; simDt drives particles and debris (slow motion applies). */
  render(realDt, simDt) {
    this.time += realDt;
    for (const f of this.fighters) {
      f.flash *= Math.exp(-realDt * 12);
      f.dim += (f.dimTarget - f.dim) * (1 - Math.exp(-realDt * 4));
      const danger = Math.max(0, (f.coreDamage ?? 0) - 0.5) * 2;
      f.coreUniforms.uFlash.value = f.flash;
      f.coreUniforms.uDim.value = f.dim;
      f.coreUniforms.uDanger.value = danger * (0.5 + 0.5 * Math.sin(this.time * 10));
      f.core.visible = f.dim < 0.98;
      // Halo behind the core: makes the core readable from far away; it fades once the core is gone.
      f.halo.position.copy(f.center).addScaledVector(tmp.subVectors(f.center, this.camera.position).normalize(), this.coreRadius * 1.2);
      f.halo.scale.setScalar(this.coreRadius * 6.5);
      f.halo.material.opacity = 0.55 * (1 - f.dim);
      const span = Math.min(2.1, Math.abs(f.spin) * 0.16) * Math.sign(f.spin || 1);
      for (const p of f.parts) {
        p.flash *= Math.exp(-realDt * 12);
        p.uniforms.uFlash.value = p.flash;
        // Worn parts glow red, more and faster as they near breaking.
        p.uniforms.uDanger.value = p.damage > 0.4 ? (p.damage - 0.4) / 0.6 * (0.55 + 0.45 * Math.sin(this.time * (6 + 10 * p.damage))) : 0;
        p.fan.material.uniforms.uSpan.value = span;
        p.fan.material.uniforms.uOpacity.value = 0.9 * Math.min(1, Math.max(0, Math.abs(f.spin) - 1) / 6);
      }
    }
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const d = this.debris[k];
      d.age += simDt;
      const t = d.age / d.life;
      if (t >= 1) { this.scene.remove(d.piece); this.debris.splice(k, 1); continue; }
      d.piece.position.addScaledVector(d.vel, simDt);
      d.vel.multiplyScalar(Math.exp(-simDt * 0.8));
      d.piece.quaternion.premultiply(tmpQ.setFromAxisAngle(d.spinAxis, d.spin * simDt));
      d.piece.scale.setScalar(d.scale0 * (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45));
    }
    this.particles.update(simDt);
    this.rings.update(realDt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Test aid: how far (CSS px) any visible core or mounted piece reaches outside the safe area (below the HUD,
   * above the caption or result card). Positive = cut off by that much; negative = the smallest margin left.
   * Pieces use their mesh bounding boxes, so this errs on the side of reporting an overflow.
   */
  safeOverflow() {
    const {w, h, top, bottom} = this.view;
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    let worst = {px: -Infinity, who: null};
    const check = (q, who) => {
      tmp.copy(q).project(this.camera);
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
      const o = Math.max(-x, x - w, top - y, y - (h - bottom));
      if (o > worst.px) worst = {px: o, who};
    };
    this.fighters.forEach((f, i) => {
      if (!f.core.visible) return;
      for (const d of [right, upv]) for (const sgn of [1, -1]) check(tmp2.copy(f.center).addScaledVector(d, sgn * this.coreRadius), `${i}:core`);
      f.parts.forEach((p, k) => {
        if (!p.alive) return;
        p.obj.traverse(o => {
          if (!o.isMesh) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          for (let c = 0; c < 8; c++) check(new THREE.Vector3(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld), `${i}:${k}`);
        });
      });
    });
    return worst;
  }

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(p, out) {
    tmp.copy(p).project(this.camera);
    if (tmp.z > 1) return null;
    out.x = (tmp.x * 0.5 + 0.5) * this.view.w;
    out.y = (-tmp.y * 0.5 + 0.5) * this.view.h;
    return out;
  }
  /** On-screen radius (CSS px) of a sphere of the given world radius at a point. */
  screenRadius(p, r) {
    const dist = Math.max(0.05, p.distanceTo(this.camera.position));
    return r / (dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * this.view.h / 2;
  }
}

const RIM_HEAD = 'uniform vec3 uRim;\nuniform float uFlash;\nuniform float uDanger;\nuniform float uDim;\n';
const RIM_BODY = `#include <emissivemap_fragment>
{
  float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float rim = pow(1.0 - facing, 3.0);
  totalEmissiveRadiance += uRim * (rim * 1.1 + 0.015) * (1.0 - uDim * 0.8);
  totalEmissiveRadiance += vec3(1.0) * uFlash * 1.6;
  totalEmissiveRadiance += vec3(1.0, 0.12, 0.08) * uDanger * (0.35 + rim);
}`;
function patchRim(m, uniforms) {
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = RIM_HEAD + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', RIM_BODY)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uDim * 0.8;');
  };
}
