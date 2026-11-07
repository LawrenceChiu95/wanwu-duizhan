import v3Rules from '../../sim/v3-rules.json';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {instantiate} from './models.js';

export const TEAM = [new THREE.Color('#ff8a3d'), new THREE.Color('#3db4ff')];
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color('#ffffff');

// Framing fight camera (feel pass, 10-28; replaces the fixed overview of f682a58, which made the tops ~60 px on a phone).
// One fixed orientation for the whole fight, steep (CAM_PITCH from horizontal, nearly top-down so a portrait screen
// is used top to bottom), the player's side near (bottom) and the opponent's far (top). It never turns. It aims at
// the midpoint of the two tops and pulls in or out so both stay inside the safe area with MARGIN of the screen width
// to spare (each core centre; the whole top, pieces included, keeps EDGE_PX), through critically damped springs:
// - the aim only moves once the midpoint has wandered deadZone metres from it (back-and-forth between clashes moves nothing);
// - the widest framing needed over the last HOLD seconds (and a tenth of a second ahead, from the replay or from the
//   tops' velocities) is kept, so it does not breathe in and out with every clash;
// - it pulls in no faster than zoomInRate (5 %/s: a zoom that slow does not read as motion), and out with a soft spring;
// - a hard floor, whatever the springs are doing: every visible top's whole swept radius (`sweep`, its pieces as built,
//   Wren's measure) at least hardPx inside the screen, plus room for the shake / punch offset, and each core centre
//   hardCore of the width inside the safe area.
// Tuned (10-28) with a replay-driven camera simulator over two auto and two manual fights at 390 wide: as large as the
// tops can be while the floor still moves under the sway limits (mean <=40 px/s, worst second <=150 px, top and bottom
// halves opposite <=5 %). Bigger needs faster zooms, which those limits rule out (see RESULT/report).
// The 2D picture offsets (shake on a break, a short punch on a big hit) only translate, a few px, never turn.
// CORE_TRAVEL and the drawn rim share the simulation fence; keep a core radius inside it.
// CORE_RISE: how far a core leaves the spin plane (max 1.05 m).
export const CORE_TRAVEL = v3Rules.arenaRadius - v3Rules.core.radius, ARENA_RIM = v3Rules.arenaRadius, CORE_RISE = 1.1;
const FIZZLE_TIME = 0.32, AIM_FADE = 0.22;
const GREY = new THREE.Color('#9aa3ad'), GREY_DARK = new THREE.Color('#5d646d');
const CAM_PITCH = THREE.MathUtils.degToRad(72), CAM_YAW = Math.PI / 2, CAM_FOV = 24, SHAKE_TIME = 0.16, PUNCH_TIME = 0.14, V4_FOV = 58;
// v4 chase camera: how fast it may turn after the line between the tops (rad/s); 'slow' turns at SLOW_TURN of that
// (远夏 10-28 e3a68f0a: yesterday's camera, turning about 30 % slower) and also follows and zooms slower (2735f129):
// the eases' rates are scaled by SLOW_PAN / SLOW_ZOOM, set so the measured median pan and zoom speeds come out about
// 0.7 of v4's (web/scripts/cam-yaw.mjs), with more room round the tops (SLOW_FIT of the frame instead of 0.88) so the
// slower zoom keeps them on screen; SLOW_FLOOR is the last-resort limit on how far the zoom-out may lag.
const V4_TURN = 1.6, SLOW_TURN = 0.7, SLOW_PAN = 0.4, SLOW_ZOOM = 0.6, SLOW_FIT = 0.75, SLOW_FLOOR = 0.9;
export const CAM = {margin: 0.15, edgePx: 12, hold: 0.6, zoomInRate: 0.05, zoomW: 3, slack: 0, panW: 2.0, deadZone: 0.25, minHalfWidth: 1.1, hardPx: 6, hardCore: 0.15};
const CAM_FWD = new THREE.Vector3(Math.sin(CAM_YAW) * Math.cos(CAM_PITCH), -Math.sin(CAM_PITCH), Math.cos(CAM_YAW) * Math.cos(CAM_PITCH));
const CAM_QUAT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), CAM_FWD, new THREE.Vector3(0, 1, 0)));
const CAM_RIGHT = new THREE.Vector3(1, 0, 0).applyQuaternion(CAM_QUAT), CAM_UP = new THREE.Vector3(0, 1, 0).applyQuaternion(CAM_QUAT);
/** Critically damped spring step (exact for constant target): returns [x, v]. */
function spring(x, v, target, w, dt) {
  const d = x - target, e = Math.exp(-w * dt), c = v + w * d;
  return [target + (d + c * dt) * e, (v - w * c * dt) * e];
}

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
// The arena floor in the spin plane: a faint half-metre grid (so a camera move reads as the floor sliding, calmly),
// a few rings round the pull centre, and the rim. The grid is what the eye holds on to when the picture pans.
const planeShader = {
  uniforms: {uRim: {value: ARENA_RIM}},
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vP; uniform float uRim;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // Terrazzo-like speckle: a dot in some cells of a fine lattice, each its own brightness. Fixed to the floor, so it
    // slides as one piece when the camera moves (and gives the eye, and a motion measurement, something to hold).
    float speckle(vec2 p, float cell){
      vec2 c = floor(p / cell), f = fract(p / cell) - 0.5;
      float h = hash(c), r = 0.18 + 0.22 * hash(c + 7.3);
      vec2 o = vec2(hash(c + 1.7), hash(c + 3.1)) - 0.5;
      float d = length(f - o * 0.5);
      return step(0.55, h) * (1.0 - smoothstep(r - fwidth(p.x / cell), r, d)) * (0.4 + 0.6 * hash(c + 9.1));
    }
    float lines(vec2 p, float step, float width){
      vec2 k = p / step, d = 0.5 - abs(fract(k) - 0.5), w = fwidth(k) * width;
      vec2 l = 1.0 - smoothstep(vec2(0.0), w, d);
      return max(l.x, l.y);
    }
    void main(){
      float r = length(vP);
      float inside = 1.0 - smoothstep(uRim - 0.02, uRim + 0.02, r);
      float fade = 1.0 - smoothstep(0.4, uRim, r) * 0.5;
      float grid = lines(vP, 0.5, 1.1);
      float k = r / 1.0;
      float ring = 1.0 - smoothstep(0.0, fwidth(k) * 1.4, 0.5 - abs(fract(k) - 0.5));
      float centre = exp(-r * r * 22.0) * 0.22;
      // The arena edge: a bright line with a soft glow inside it, so the whole stage reads as one dish.
      float rimW = fwidth(r) * 1.5;
      float rim = 1.0 - smoothstep(0.0, rimW + 0.012, abs(r - uRim));
      float glow = exp(-max(0.0, uRim - r) * 4.0) * inside;
      float bed = inside * (0.05 - 0.02 * r / uRim);
      float tex = (vnoise(vP * 9.0) * 0.6 + vnoise(vP * 23.0) * 0.4) * 0.014 + speckle(vP, 0.045) * 0.026 + speckle(vP + 0.37, 0.11) * 0.022;
      vec3 c = vec3(0.25, 0.5, 1.0) * (grid * 0.075 * fade * inside + ring * 0.07 * inside + centre + bed + glow * 0.09) + vec3(0.55, 0.7, 1.0) * tex * inside;
      gl_FragColor = vec4(c + vec3(0.5, 0.78, 1.0) * rim * 0.6, 1.0);
      #include <colorspace_fragment>
    }`
};
// A low wall standing on the rim: a glow fading upward, lit in a top's colour where that top is close to it.
const wallShader = {
  uniforms: {uA: {value: new THREE.Vector2(99, 99)}, uB: {value: new THREE.Vector2(99, 99)}, uCA: {value: new THREE.Color()}, uCB: {value: new THREE.Color()}},
  vertexShader: `varying vec3 vW; varying float vH; void main(){ vH = uv.y; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `varying vec3 vW; varying float vH; uniform vec2 uA; uniform vec2 uB; uniform vec3 uCA; uniform vec3 uCB;
    void main(){
      float base = pow(1.0 - vH, 2.2);
      float lip = smoothstep(0.9, 1.0, vH) * 0.6;
      float a = exp(-pow(distance(vW.xz, uA), 2.0) * 1.6), b = exp(-pow(distance(vW.xz, uB), 2.0) * 1.6);
      vec3 c = vec3(0.32, 0.6, 1.0) * (base * 0.32 + lip * 0.25) + (uCA * a + uCB * b) * (base * 1.1 + lip * 0.8);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`
};
// The player's own top: a thin, half-transparent line hugging the outside of its core (远夏 10-28 89169677: the big
// bright ring read as a skill or weapon range). No glow, no pulse, no ticks; 「你」 and the orange trail do the work.
// The line sits at r = 0.9 of the quad and stays about 2 px wide whatever the zoom.
const ME_RING_R = 1.22, ME_RING_OPACITY = 0.5;
const meRingShader = {
  uniforms: {uColor: {value: new THREE.Color('#ff8a3d')}, uOpacity: {value: ME_RING_OPACITY}},
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vP; uniform vec3 uColor; uniform float uOpacity;
    void main(){
      float r = length(vP);
      float a = (1.0 - smoothstep(0.6, 1.4, abs(r - 0.9) / max(fwidth(r), 1e-5))) * uOpacity;
      if (a <= 0.0) discard;
      gl_FragColor = vec4(uColor, a);
      #include <colorspace_fragment>
    }`
};
// Motion trail: a ribbon along the last few tenths of a second of the core's path, brightest at the head.
const trailShader = {
  uniforms: {uColor: {value: new THREE.Color()}, uOpacity: {value: 0}},
  vertexShader: `attribute float aK; attribute float aS; varying float vK; varying float vS; void main(){ vK = aK; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying float vK; varying float vS; uniform vec3 uColor; uniform float uOpacity;
    void main(){
      float a = pow(vK, 1.6) * (1.0 - abs(vS)) * uOpacity;
      gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35 * vK * vK * (1.0 - abs(vS))) * a, 1.0);
    }`
};
// Speed lines and spark streaks: instanced quads lying flat in the spin plane, bright at the head.
const streakShader = {
  vertexShader: `attribute vec3 aColor; attribute float aAlpha; varying vec2 vQ; varying vec3 vC; varying float vA;
    void main(){ vQ = position.xz; vC = aColor; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vQ; varying vec3 vC; varying float vA;
    void main(){
      float along = vQ.x + 1.0;            // 0 at the tail, 1 at the head
      float across = 1.0 - abs(vQ.y) * 2.0;
      float a = pow(along, 1.4) * pow(across, 0.8) * vA;
      gl_FragColor = vec4(mix(vC, vec3(1.0), 0.5 * along * across) * a * 1.5, 1.0);
    }`
};
// Shield bubble: bright rim, faint face, a slow ripple, additive.
const shieldShader = {
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
    void main(){
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float rim = pow(f, 2.2);
      float ripple = 0.5 + 0.5 * sin(vP.y * 60.0 - uTime * 9.0);
      gl_FragColor = vec4(uColor * uOpacity * (rim * 1.5 + 0.12 + 0.12 * ripple * f), 1.0);
      #include <colorspace_fragment>
    }`
};
// Aim of a lunge (第 13 版): a flat arrow on the floor along the direction locked at the press. Chevrons stream toward the
// head; uGrow reveals it from the core outwards during the wind-up. Plane x: 0 at the tail .. 1 at the tip. Normal
// (not additive) blending, so the team colour stays true on the blue floor.
const aimShader = {
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uGrow; uniform float uTime;
    void main(){
      float x = vUv.x, y = abs(vUv.y - 0.5) * 2.0;
      float head = step(0.74, x);
      float hw = head > 0.5 ? (1.0 - x) / 0.26 : 0.34;
      float inside = 1.0 - smoothstep(hw - 0.1, hw, y);
      float chev = smoothstep(0.55, 0.85, fract((x - y * 0.12) * 6.0 - uTime * 4.0));
      float edge = smoothstep(hw - 0.22, hw - 0.08, y) * inside;
      float a = inside * mix(0.22 + 0.55 * chev, 1.0, max(head, edge * 0.8));
      a *= smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(uGrow - 0.06, uGrow, x));
      gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.3 * head + 0.2 * edge), a * uOpacity);
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
// Position combat's striking piece: a shell pushed out along the normals (a few px at any distance), back faces only, so
// a soft team-colour edge shows round its outline while its own texture stays as it is.
const strikeShellShader = {
  vertexShader: `uniform float uWidth;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xyz += normalize(normalMatrix * normal) * uWidth * -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity;
    void main(){ gl_FragColor = vec4(uColor * 1.5 * uOpacity, 1.0); }`
};
// Flat-shaded models (the pillow) carry no normals: the shell gets smooth ones, averaged over vertices at the same spot.
const shellGeos = new WeakMap();
function shellGeometry(g) {
  if (g.attributes.normal) return g;
  if (!shellGeos.has(g)) {
    const s = g.clone(), pos = s.attributes.position, idx = s.index, n = pos.count, sum = new Map(), key = new Array(n);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i++) key[i] = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const tris = idx ? idx.count / 3 : n / 3, at = k => idx ? idx.getX(k) : k;
    for (let t = 0; t < tris; t++) {
      const [i, j, k] = [at(3 * t), at(3 * t + 1), at(3 * t + 2)];
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, j); c.fromBufferAttribute(pos, k);
      const face = c.sub(b).cross(a.sub(b));
      for (const v of [i, j, k]) { const m = sum.get(key[v]) ?? sum.set(key[v], new THREE.Vector3()).get(key[v]); m.add(face); }
    }
    const normal = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const m = sum.get(key[i]); const l = m?.length() || 1; normal.set([m ? m.x / l : 0, m ? m.y / l : 1, m ? m.z / l : 0], i * 3); }
    s.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    shellGeos.set(g, s);
  }
  return shellGeos.get(g);
}
function strikeShell(team) {
  return new THREE.ShaderMaterial({...strikeShellShader, uniforms: {uColor: {value: team.clone()}, uOpacity: {value: 0}, uWidth: {value: 0.012}},
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, visible: false});
}
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

/** Streaks: flat quads in the spin plane that fly along their direction, shrink and fade (speed lines, spark lines). */
class Streaks {
  constructor(scene, n = 160) {
    const g = new THREE.BufferGeometry();
    // x from -1 (tail) to 0 (head), z across; scaled per instance to (length, 1, width).
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -0.5, 0, 0, -0.5, 0, 0, 0.5, -1, 0, 0.5], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aColor', this.color);
    g.setAttribute('aAlpha', this.alpha);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({...streakShader, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide}), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.items = Array.from({length: n}, () => ({life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0), len: 0.3, width: 0.03, a: 1}));
    this.next = 0;
    this.n = n;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
  }
  /** One streak: head at `at`, pointing along `dir` (xz), moving with `vel`. */
  add(at, dir, vel, len, width, life, color, a = 1) {
    const i = this.next, it = this.items[i];
    this.next = (this.next + 1) % this.n;
    it.pos.copy(at);
    it.dir.set(dir.x, 0, dir.z);
    if (it.dir.lengthSq() < 1e-8) it.dir.set(1, 0, 0);
    it.dir.normalize();
    it.vel.copy(vel);
    Object.assign(it, {len, width, life, max: life, a});
    this.color.setXYZ(i, color.r, color.g, color.b);
  }
  /** Spark lines bursting out of a point in the spin plane. */
  burst(at, count, speed, len, width, life, colors) {
    for (let k = 0; k < count; k++) {
      const ang = Math.random() * Math.PI * 2, d = tmp.set(Math.cos(ang), 0, Math.sin(ang));
      const v = d.clone().multiplyScalar(speed * (0.55 + Math.random() * 0.7));
      this.add(at, d, v, len * (0.6 + Math.random() * 0.8), width, life * (0.7 + Math.random() * 0.5), colors[k % colors.length]);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it.life <= 0) { this.alpha.setX(i, 0); this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      it.pos.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.exp(-dt * 5));
      this.q.setFromUnitVectors(tmp.set(1, 0, 0), it.dir);
      this.m.compose(it.pos, this.q, this.s.set(it.len * (0.35 + 0.65 * k), 1, it.width));
      this.mesh.setMatrixAt(i, this.m);
      this.alpha.setX(i, it.a * k);
    }
    this.mesh.instanceMatrix.needsUpdate = this.alpha.needsUpdate = this.color.needsUpdate = true;
  }
  clear() { for (const it of this.items) it.life = 0; this.update(0); }
}

/** Debris when an item breaks: small shards that burst out, tumble, fall to the floor and fade. */
class Shards {
  constructor(scene, n = 72) {
    this.mesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1), new THREE.MeshStandardMaterial({color: '#ffffff', metalness: 0.3, roughness: 0.5, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.35}), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.items = Array.from({length: n}, () => ({life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), spin: 0, q: new THREE.Quaternion(), size: 0.05}));
    this.n = n;
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.s = new THREE.Vector3();
    this.update(0);
  }
  burst(at, count, speed, colors, drift) {
    for (let k = 0; k < count; k++) {
      const i = this.next, it = this.items[i];
      this.next = (this.next + 1) % this.n;
      it.pos.copy(at);
      const ang = Math.random() * Math.PI * 2;
      it.vel.set(Math.cos(ang), 0.5 + Math.random() * 0.9, Math.sin(ang)).multiplyScalar(speed * (0.5 + Math.random() * 0.8));
      if (drift) it.vel.addScaledVector(drift, 0.6);
      it.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      it.spin = 8 + Math.random() * 14;
      it.q.identity();
      it.size = 0.028 + Math.random() * 0.045;
      it.life = it.max = 0.8 + Math.random() * 0.5;
      this.mesh.setColorAt(i, colors[k % colors.length]);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it.life <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      it.life -= dt;
      const k = Math.max(0, it.life / it.max);
      it.vel.y -= 6 * dt;
      it.vel.multiplyScalar(Math.exp(-dt * 1.4));
      it.pos.addScaledVector(it.vel, dt);
      // Land on the floor and skid.
      if (it.pos.y < -0.02) { it.pos.y = -0.02; it.vel.y = Math.abs(it.vel.y) * 0.3; it.vel.x *= 0.6; it.vel.z *= 0.6; it.spin *= 0.6; }
      it.q.premultiply(tmpQ.setFromAxisAngle(it.axis, it.spin * dt));
      this.m.compose(it.pos, it.q, this.s.setScalar(it.size * Math.min(1, k / 0.3)));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { for (const it of this.items) it.life = 0; this.update(0); }
}

/** A short ribbon behind a core: its path over the last TRAIL_TIME of sim time, tapering to the tail. */
const TRAIL_N = 28;
class Trail {
  constructor(scene, color) {
    const g = new THREE.BufferGeometry(), k = [], s = [], index = [];
    for (let i = 0; i < TRAIL_N; i++) { k.push(i / (TRAIL_N - 1), i / (TRAIL_N - 1)); s.push(-1, 1); }
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    this.pos = new Float32Array(TRAIL_N * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(k, 1));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(s, 1));
    g.setIndex(index);
    this.mat = new THREE.ShaderMaterial({...trailShader, uniforms: {uColor: {value: color.clone()}, uOpacity: {value: 0}}, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide});
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.geo = g;
    this.hist = [];
  }
  clear() { this.hist = []; this.mesh.visible = false; }
  /** Record the core's position at sim time t, then rebuild the ribbon. width/opacity/len are the current look. */
  update(at, t, len, width, opacity) {
    const h = this.hist;
    if (!h.length || t > h[h.length - 1].t + 1e-6) h.push({t, x: at.x, y: at.y, z: at.z});
    else if (t < h[h.length - 1].t - 1e-6) { h.length = 0; h.push({t, x: at.x, y: at.y, z: at.z}); }
    else Object.assign(h[h.length - 1], {x: at.x, y: at.y, z: at.z});
    while (h.length > 2 && h[1].t < t - len) h.shift();
    if (h.length > 90) h.splice(0, h.length - 90);
    this.mat.uniforms.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.01 && h.length > 1;
    if (!this.mesh.visible) return;
    // Resample the path evenly in time from tail to head.
    const t0 = Math.max(h[0].t, t - len), span = Math.max(1e-6, t - t0);
    let j = 0;
    const p = [];
    for (let i = 0; i < TRAIL_N; i++) {
      const ti = t0 + span * i / (TRAIL_N - 1);
      while (j < h.length - 2 && h[j + 1].t < ti) j++;
      const a = h[j], b = h[Math.min(j + 1, h.length - 1)], u = b.t > a.t ? Math.min(1, Math.max(0, (ti - a.t) / (b.t - a.t))) : 1;
      p.push(new THREE.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u));
    }
    for (let i = 0; i < TRAIL_N; i++) {
      const d = tmp.subVectors(p[Math.min(i + 1, TRAIL_N - 1)], p[Math.max(i - 1, 0)]).setY(0);
      if (d.lengthSq() < 1e-10) d.set(1, 0, 0);
      d.normalize();
      const side = tmp2.set(-d.z, 0, d.x).multiplyScalar(width * Math.pow(i / (TRAIL_N - 1), 0.6));
      this.pos.set([p[i].x - side.x, p[i].y - 0.03, p[i].z - side.z, p[i].x + side.x, p[i].y - 0.03, p[i].z + side.z], i * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
  }
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
    this.arenaRim = ARENA_RIM;
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

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 390 / 844, 0.1, 240);
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

    const back = new THREE.Mesh(new THREE.SphereGeometry(90, 72, 48), new THREE.ShaderMaterial({...backdropShader, side: THREE.BackSide, depthWrite: false}));
    back.renderOrder = -2;
    this.scene.add(back);
    const plane = new THREE.Mesh(new THREE.CircleGeometry(ARENA_RIM + 0.2, 128), new THREE.ShaderMaterial({...planeShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.02;
    plane.renderOrder = -1;
    this.scene.add(plane);
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RIM, ARENA_RIM, 0.34, 160, 1, true), new THREE.ShaderMaterial({...wallShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide}));
    this.wall.position.y = 0.15;
    this.wall.renderOrder = -1;
    this.scene.add(this.wall);

    this.haloTex = radialTexture(0.9, 0.35);
    this.coreGeo = new THREE.SphereGeometry(coreRadius, 40, 28);
    this.shieldGeo = new THREE.SphereGeometry(coreRadius * 2.6, 40, 28);
    this.coreTex = TEAM.map(coreTextures);
    this.particles = new Particles(this.scene);
    this.rings = new Rings(this.scene);
    this.streaks = new Streaks(this.scene);
    this.shards = new Shards(this.scene);
    this.trails = TEAM.map(c => new Trail(this.scene, c));
    // Afterimages of a lunging core: a few fading team-coloured glows left along its path.
    this.ghosts = Array.from({length: 14}, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map: this.haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
      s.visible = false;
      s.renderOrder = 2;
      this.scene.add(s);
      return {s, age: 0, life: 0.3};
    });
    this.nextGhost = 0;
    // The player's marker ring (side 0, the orange side, is "you" in both modes).
    this.meRing = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({...meRingShader, transparent: true, depthWrite: false}));
    this.meRing.rotation.x = -Math.PI / 2;
    this.meRing.renderOrder = 9;
    this.meRing.visible = false;
    // One aim arrow per side (第 13 版: 冲 locks its direction at the press; both sides' arrows show, so a lunge can be read and blocked).
    this.aims = TEAM.map(c => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), new THREE.ShaderMaterial({...aimShader, uniforms: {uColor: {value: c.clone()}, uOpacity: {value: 0}, uGrow: {value: 0}, uTime: {value: 0}}, transparent: true, depthWrite: false, side: THREE.DoubleSide}));
      m.rotation.order = 'YXZ';
      m.renderOrder = 8;
      m.visible = false;
      this.scene.add(m);
      return m;
    });
    this.scene.add(this.meRing);
    this.showMe = false;
    this.camStyle = 'new';
    this.chase = false;
    this.turnScale = 1;
    this.panScale = this.zoomScale = 1;
    this.fighters = [];
    this.debris = [];
    this.time = 0;
    this.cam = {focus: new THREE.Vector3(), dist: 4, yaw: CAM_YAW, pitch: 0.95, ready: false, mode: 'fight', shakeAge: 1, shakeAmp: 0, offset: [0, 0],
      fv: new THREE.Vector3(), logD: 0, logDv: 0, goal: 0, hist: [], clock: 0, offY: 0, offYv: 0, punch: null, only: null, cardTop: null, ahead: null, stat: null};
    this.view = {w: 390, h: 844, top: 70, bottom: 130};
  }

  resize(w, h, top, bottom) {
    Object.assign(this.view, {w, h, top, bottom});
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyInsets();
    const dpr = this.renderer.getPixelRatio();
    this.particles.mat.uniforms.uScale.value = h * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.particles.mat.uniforms.uMax.value = 26 * dpr;
  }
  applyInsets() {
    const {w, h, top, bottom} = this.view;
    this.setOffset(0, (bottom - top) / 2);
  }
  /** Shifts the picture on screen (CSS px) without moving the camera: a pure 2D translation. */
  setOffset(x, y) {
    const {w, h} = this.view;
    this.cam.offset = [x, y];
    this.camera.setViewOffset(w, h, x, y, w, h);
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
    const coreUniforms = {uRim: {value: team.clone()}, uFlash: {value: 0}, uStrike: {value: 0}, uDanger: {value: 0}, uDim: {value: 0}};
    const coreMat = new THREE.MeshStandardMaterial({map: this.coreTex[i].map, emissiveMap: this.coreTex[i].emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.9, metalness: 0.75, roughness: 0.3});
    patchRim(coreMat, coreUniforms);
    const core = new THREE.Mesh(this.coreGeo, coreMat);
    root.add(core);
    const coreShell = new THREE.Mesh(this.coreGeo, strikeShell(team));
    core.add(coreShell);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: this.haloTex, color: team, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending}));
    halo.renderOrder = 3;
    this.scene.add(halo);
    const parts = this.layout(def).map(p => {
      const uniforms = {uRim: {value: team.clone()}, uFlash: {value: 0}, uStrike: {value: 0}, uDanger: {value: 0}, uDim: {value: 0}};
      const obj = instantiate(p.item, uniforms);
      const holder = new THREE.Group();
      holder.position.fromArray(p.offset);
      holder.quaternion.fromArray(p.quat);
      holder.add(obj);
      const shellMat = strikeShell(team), shell = obj.clone(true);
      shell.traverse(o => { if (o.isMesh) { o.geometry = shellGeometry(o.geometry); o.material = shellMat; } });
      holder.add(shell);
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
      return {holder, obj, shell: shellMat, fan, uniforms, flash: 0, strike: 0, damage: 0, alive: true, item: p.item, orient: p.orient, r1: p.r1, reach, y0, y1};
    });
    this.scene.add(root);
    const sweep = Math.max(this.coreRadius, ...parts.map(p => p.r1));
    // Manual mode: shield bubble round the core (1 s), wind-up glow and the lunge's streak, all on the sim clock.
    const shield = new THREE.Mesh(this.shieldGeo, new THREE.ShaderMaterial({...shieldShader, uniforms: {uColor: {value: new THREE.Color('#bff4ff').lerp(team, 0.25)}, uOpacity: {value: 0}, uTime: {value: 0}}, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
    shield.visible = false;
    shield.renderOrder = 4;
    root.add(shield);
    return {root, core, coreShell: coreShell.material, coreUniforms, halo, parts, sweep, shield, shieldColor: shield.material.uniforms.uColor.value.clone(), act: {charge: 0, dash: 0, shield: 0, parry: 0}, center: new THREE.Vector3(), spin: 0, flash: 0, strike: 0, dim: 0, dimTarget: 0, coreAlive: true, def};
  }

  /** Applies one sampled replay state: body transform, angular speed about its up axis, alive flags, HP. */
  pose(state) {
    state.fighters.forEach((s, i) => {
      const f = this.fighters[i];
      if (!f) return;
      f.root.position.copy(s.pos);
      f.root.quaternion.copy(s.quat);
      f.center.copy(s.pos);
      if (s.vel) (f.vel ??= new THREE.Vector3()).copy(s.vel);
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
  /**
   * Position combat: the piece that struck gets a glowing edge in its side's colour, gone within about a second, over its
   * own texture (the struck piece gets the white flash); a few colour lines rush from its side into the contact point, so
   * 390 px wide still shows who hit whom.
   */
  strike(i, partId, point) {
    const f = this.fighters[i];
    if (!f) return;
    const p = partId === 'core' ? f : f.parts[Number(partId.split('-')[1])];
    if (p) p.strike = 1;
    const d = tmp.subVectors(point, f.center).setY(0);
    if (d.lengthSq() < 1e-8) return;
    d.normalize();
    const dir = d.clone(), side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let k = 0; k < 4; k++) {
      const at = point.clone().addScaledVector(side, (k - 1.5) * 0.045).addScaledVector(dir, -0.03 * Math.abs(k - 1.5));
      this.streaks.add(at, dir, dir.clone().multiplyScalar(1.4), 0.5 + 0.12 * (k % 2), 0.04, 0.32, k === 1 || k === 2 ? TEAM[i] : WHITE, 0.95);
    }
  }
  burst(point, colors, count, speed, size, life, drift) { this.particles.burst(point, colors, count, speed, size, life, drift); }
  ring(point, color, from, to, dur) { this.rings.spawn(point, color, from, to, dur); }
  /** Manual mode: wind-up before a lunge (glow in pulses, a ring closing in, the top squashed flat and wide). */
  charge(i, secs) {
    const f = this.fighters[i];
    if (!f) return;
    f.act.charge = f.act.chargeLen = secs;
    this.rings.spawn(f.center, TEAM[i].clone().lerp(WHITE, 0.3), 1.6, 0.25, secs);
  }
  /** The lunge itself: a burst behind, speed lines and afterimages while it flies (see render), the squash let go. */
  lunge(i, dir, secs) {
    const f = this.fighters[i];
    if (!f) return;
    f.act.charge = 0;
    f.act.dash = f.act.dashLen = secs;
    f.act.dir = new THREE.Vector3().fromArray(dir).setY(0).normalize();
    f.act.ghostIn = 0;
    f.act.pop = 1;
    const back = f.center.clone().addScaledVector(f.act.dir, -0.25);
    this.burst(back, [TEAM[i], WHITE, TEAM[i]], 30, 1.4, 0.035, 0.4, f.act.dir.clone().multiplyScalar(-1.8));
    this.ring(f.center, TEAM[i], 0.2, 1.0, 0.3);
    // A fan of speed lines blown backwards at launch.
    for (let k = 0; k < 12; k++) {
      const side = tmp2.set(-f.act.dir.z, 0, f.act.dir.x).multiplyScalar((Math.random() - 0.5) * 0.7);
      const at = tmp.copy(f.center).addScaledVector(f.act.dir, -0.15 - Math.random() * 0.3).add(side);
      this.streaks.add(at, f.act.dir, f.act.dir.clone().multiplyScalar(-2.5 - Math.random() * 2), 0.55 + Math.random() * 0.5, 0.035, 0.28 + Math.random() * 0.12, k % 3 ? TEAM[i] : WHITE);
    }
  }
  endLunge(i) { const f = this.fighters[i]; if (f) { f.act.dash = 0; f.act.aimOut = Math.max(f.act.aimOut ?? 0, 0.001); } }
  /**
   * The lunge's locked direction as an arrow on the floor, from the edge of the top's sweep where it stood at the press:
   * it grows out over the wind-up (`secs`), stays put while the top runs along it and fades out after the lunge ends.
   * `len` is how far from the core it reaches (m, the caller caps it at the lunge's carry and the target); it stops at the wall.
   * `align` (the player's own top only): the full-lunge alignment; once the target has moved off the locked lane (cosine
   * below it) until the lunge ends, the arrow goes grey and thin, so a lunge going wide reads as wide (Elara 80e885bc).
   */
  aim(i, dir, secs, len, align = null) {
    const f = this.fighters[i];
    if (!f || !dir) return;
    const d = new THREE.Vector3().fromArray(dir).setY(0);
    if (d.lengthSq() < 1e-8) return;
    d.normalize();
    // A fixed lane on the floor from where the top stood at the press (it hardly moves while winding up), cut at the wall.
    const from = f.center.clone(), start = f.sweep * 1.05, pd = from.x * d.x + from.z * d.z;
    const toWall = -pd + Math.sqrt(Math.max(0, pd * pd - (from.x * from.x + from.z * from.z) + ARENA_RIM * ARENA_RIM));
    Object.assign(f.act, {aimDir: d, aimFrom: from, aimAge: 0, aimGrow: Math.max(0.05, secs), aimLen: Math.max(0.3, Math.min(len, toWall) - start), aimOut: 0, aimAlign: align, aimWide: 0});
  }
  raiseShield(i, secs) { const f = this.fighters[i]; if (f) { f.act.shield = f.act.shieldLen = secs; f.act.fizzle = 0; f.shield.visible = true; } }
  /** A block that caught a real hit in its window: the bubble flares and a bright ring snaps out from the core (size < 1: held without damage). */
  perfectBlock(i, point, size = 1) {
    const f = this.fighters[i];
    if (!f) return;
    f.act.shield = 0;
    f.act.parry = Math.max(f.act.parry, 0.3 * size);
    this.ring(f.center, new THREE.Color('#ffffff'), 0.25, 0.25 + 1.25 * size, 0.32);
    if (point && size >= 1) this.ring(point, new THREE.Color('#e6fbff'), 0.08, 0.9, 0.3);
  }
  /** A block whose window ran out with nothing caught: the bubble goes grey, cracks and drops away in a few dull flakes. */
  fizzle(i) {
    const f = this.fighters[i];
    if (!f) return;
    f.act.shield = 0;
    f.act.fizzle = FIZZLE_TIME;
    this.shards.burst(f.center, 7, 0.9, [GREY, GREY_DARK]);
  }
  /** A lunge that met nothing: it pulls up in a small puff of floor dust. */
  whiff(i) {
    const f = this.fighters[i];
    if (!f) return;
    const at = tmp.copy(f.center).setY(f.center.y - 0.06);
    this.burst(at, [GREY, GREY_DARK, GREY], 26, 0.7, 0.05, 0.55, f.act.aimDir ? f.act.aimDir.clone().multiplyScalar(0.5) : undefined);
    this.ring(at, GREY, 0.15, 0.7, 0.35);
  }
  /** A lunge (by side `by`) bounced off this shield: the bubble flares, a pale ring snaps out, and the lunger is flung with streaks. */
  parry(i, point, by) {
    const f = this.fighters[i];
    if (!f) return;
    f.act.parry = 0.35;
    this.ring(point, new THREE.Color('#e6fbff'), 0.1, 1.8, 0.5);
    this.ring(f.center, new THREE.Color('#bff4ff'), 0.3, 1.2, 0.35);
    const pale = [WHITE, new THREE.Color('#bff4ff'), new THREE.Color('#9fe6ff')];
    this.burst(point, pale, 60, 3.0, 0.035, 0.5);
    this.streaks.burst(point, 18, 6, 0.45, 0.04, 0.3, pale);
    const g = this.fighters[by];
    if (g) g.act.fling = 0.5;
  }
  /** Spark lines and a camera punch at an impact. power: 0..1 (a landed lunge is 1). */
  impact(point, power, colors) {
    this.streaks.burst(point, Math.round(5 + 13 * power), 3 + 4 * power, 0.22 + 0.3 * power, 0.025 + 0.02 * power, 0.16 + 0.12 * power, colors);
    this.punch(point, 2 + 9 * power);
  }
  clearActs() { for (const f of this.fighters) { Object.assign(f.act, {charge: 0, dash: 0, shield: 0, parry: 0, fling: 0, pop: 0, fizzle: 0, aimDir: null}); f.shield.visible = false; f.root.scale.setScalar(1); } for (const m of this.aims) m.visible = false; }
  /** A short jolt for a decisive blow (a piece or a core breaking): a few px of picture translation, no turn. */
  shake(px) { const c = this.cam; if (this.chase || (c.shakeAge < SHAKE_TIME && c.shakeAmp > px)) return; c.shakeAge = 0; c.shakeAmp = px; }
  /** Camera punch: the picture jumps a few px toward the impact and settles back within PUNCH_TIME (translation only). */
  punch(point, px) {
    const c = this.cam, at = {x: 0, y: 0};
    // Shake and punch belong to the framing camera (俯视); the chase cameras shake their own way (shakeV4).
    if (this.chase || !this.project(point, at)) return;
    const {w, h, top} = this.view, cx = w / 2, cy = top + (h - top - this.safeBottom()) / 2;
    let dx = cx - at.x, dy = cy - at.y;
    const n = Math.hypot(dx, dy);
    if (n < 1) { dx = 0; dy = 1; } else { dx /= n; dy /= n; }
    if (c.punch && c.punch.age < PUNCH_TIME && c.punch.px > px) return;
    c.punch = {dx, dy, px, age: 0};
  }

  /** One fading afterimage glow at a point (sim clock). */
  ghost(at, color, life) {
    const g = this.ghosts[this.nextGhost];
    this.nextGhost = (this.nextGhost + 1) % this.ghosts.length;
    g.s.position.copy(at);
    g.s.material.color.copy(color);
    g.s.visible = true;
    g.age = 0;
    g.life = life;
  }

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
    this.burst(at, [WHITE, TEAM[i], new THREE.Color('#ffd27a'), TEAM[i]], 70, 2.6, 0.03, 1.0, vel.clone().multiplyScalar(0.5));
    // Shards of it: team colour, grey and white, scattering over the floor.
    this.shards.burst(at, 16, 2.6, [TEAM[i], new THREE.Color('#9aa4b8'), WHITE, TEAM[i].clone().multiplyScalar(0.6)], vel);
    this.streaks.burst(at, 10, 4.5, 0.35, 0.035, 0.24, [WHITE, TEAM[i]]);
    this.ring(at, TEAM[i], 0.1, 1.4, 0.6);
    this.ring(at, WHITE, 0.05, 0.7, 0.35);
  }
  /** The loser's core is gone: whatever is still mounted falls away. */
  scatter(i) {
    const f = this.fighters[i];
    if (!f) return;
    this.shards.burst(f.center, 22, 3.2, [TEAM[i], WHITE, TEAM[i].clone().multiplyScalar(0.5)]);
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
    this.streaks.clear();
    this.shards.clear();
    for (const t of this.trails) t.clear();
    for (const g of this.ghosts) g.s.visible = false;
    this.clearDebris();
    for (const f of this.fighters) {
      f.flash = f.strike = 0; f.dim = f.dimTarget = 0; f.coreAlive = true;
      for (const p of f.parts) { p.flash = p.strike = 0; p.alive = true; p.holder.visible = p.fan.visible = true; }
    }
    this.cam.shakeAge = SHAKE_TIME;
    this.cam.punch = null;
    this.clearActs();
  }

  /**
   * Which fight camera: 'v4', yesterday's chase camera (03a4da9), kept as it was: it turns to follow the line between
   * the tops, pulls in and out at once, and shakes; 'slow', the same camera turning at SLOW_TURN of v4's rate and
   * following and zooming slower (SLOW_PAN, SLOW_ZOOM), with more room (SLOW_FIT) and a floor on its zoom-out (SLOW_FLOOR) so a top
   * never leaves the screen; or 'new', the framing camera above (俯视).
   */
  setCamStyle(style) {
    this.camStyle = style === 'v4' || style === 'slow' ? style : 'new';
    this.chase = this.camStyle !== 'new';
    this.turnScale = this.camStyle === 'slow' ? SLOW_TURN : 1;
    this.panScale = this.camStyle === 'slow' ? SLOW_PAN : 1;
    this.zoomScale = this.camStyle === 'slow' ? SLOW_ZOOM : 1;
    this.camera.fov = this.chase ? V4_FOV : CAM_FOV;
    this.camera.updateProjectionMatrix();
    this.particles.mat.uniforms.uScale.value = this.view.h * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    // A switch is a clean cut: no jolt started under the other camera carries over (Sol 第 11 版 R1).
    Object.assign(this.cam, {ready: false, shake4: 0, push4: 0, shakeAge: SHAKE_TIME, shakeAmp: 0, punch: null});
  }
  /** Chase camera only: camera-position shake on blows (0..1.2) and the decisive push (0..1), as v4 drove them. */
  shakeV4(amount) { if (this.chase) this.cam.shake4 = Math.min(1.2, Math.max(this.cam.shake4 ?? 0, amount)); }
  setPushV4(amount) { this.cam.push4 = amount; }
  /** Yesterday's chase camera (03a4da9 updateCamera, fight and result), lifted as it was; only the safe area now counts the 冲/挡 pad. */
  updateCameraV4(dt, snap) {
    const [a, b] = this.fighters;
    const c = this.cam;
    const axis = tmp.subVectors(b.center, a.center).setY(0);
    if (axis.lengthSq() > 1e-6 && c.mode !== 'result') {
      const want = Math.atan2(axis.x, axis.z);
      let d = want - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (snap || !c.ready) c.yaw = want;
      // Follow only a clear turn of the line, and gently, so the view does not swim.
      else if (Math.abs(d) > 0.25) c.yaw += Math.sign(d) * Math.min(Math.abs(d) - 0.25, dt * V4_TURN * this.turnScale);
    }
    // In the decisive slow motion the view tips toward top-down, so the near top cannot loom over the hit;
    // the result looks down on the winner so its core and both pieces read.
    const pitch = c.mode === 'result' ? 1.22 : 0.92 + (c.push4 ?? 0) * 0.3;
    c.pitch += (pitch - c.pitch) * (snap || !c.ready ? 1 : 1 - Math.exp(-dt / (c.mode === 'result' ? 0.3 : 0.5)));
    const fwd = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
    tmpM.lookAt(new THREE.Vector3(), fwd, UP);
    tmpQ.setFromRotationMatrix(tmpM);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tmpQ), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ);
    const {h, top} = this.view, bottom = this.safeBottom();
    if (c.offset[0] !== 0 || c.offset[1] !== (bottom - top) / 2) this.setOffset(0, (bottom - top) / 2);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * this.camera.aspect;
    const freeV = tanV * (h - top - bottom) / h;
    // Keep every listed top whole in the safe area (below the HUD, above the caption or result card):
    // each top's swept cylinder (its live pieces' reach and height), sampled around, is fitted with a margin.
    const list = c.mode === 'result' && c.only != null ? [this.fighters[c.only]].filter(Boolean) : [a, b];
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
    if (snap || !c.ready) c.focus.copy(focus); else c.focus.lerp(focus, 1 - Math.exp(-dt * this.panScale / 0.15));
    // Distance from the focus actually used, so a lagging pan is covered too.
    const m = c.mode === 'result' ? 0.62 : this.camStyle === 'slow' ? SLOW_FIT : 0.88;
    let need = 0.8;
    for (const p of pts) { const d = tmp.copy(p).sub(c.focus), z = d.dot(fwd); need = Math.max(need, Math.abs(d.dot(right)) / (tanH * m) - z, Math.abs(d.dot(upv)) / (freeV * m) - z); }
    // Zoom out at once when the tops fly apart; come back in gently.
    if (snap || !c.ready) c.dist = need;
    else c.dist += (need - c.dist) * (1 - Math.exp(-dt * (c.mode === 'result' ? 1 : this.zoomScale) / (need > c.dist ? 0.06 : c.mode === 'result' ? 0.3 : 0.6)));
    // 'slow' only: the zoom-out may not lag so far that a top's sweep crosses the screen edge (v4 let it, for up to
    // 0.25 s at a time, by up to 17 px at 390 wide): never looser than SLOW_FLOOR of the frame. Rarely acts (<1 % of frames).
    if (this.camStyle === 'slow') {
      let hard = 0;
      for (const p of pts) { const d = tmp.copy(p).sub(c.focus), z = d.dot(fwd); hard = Math.max(hard, Math.abs(d.dot(right)) / (tanH * SLOW_FLOOR) - z, Math.abs(d.dot(upv)) / (freeV * SLOW_FLOOR) - z); }
      // Test aid: how often this limit had to act.
      c.floorFrames = (c.floorFrames ?? 0) + 1;
      if (hard > c.dist) { c.dist = hard; c.floorHits = (c.floorHits ?? 0) + 1; }
    }
    c.ready = true;
    this.camera.quaternion.copy(tmpQ);
    this.camera.position.copy(c.focus).addScaledVector(fwd, -c.dist);
    if (c.shake4 > 0.001) {
      const s = c.shake4 * c.shake4 * 0.03 * c.dist;
      this.camera.position.addScaledVector(right, (Math.random() - 0.5) * s).addScaledVector(upv, (Math.random() - 0.5) * s);
      c.shake4 *= Math.exp(-dt * 9);
    }
    c.stat = {pxPerMetre: this.screenRadius(c.focus, 1), dist: c.dist};
  }

  /** build: close on the player's top. fight / result: the framing camera over the two tops (see CAM). */
  setCameraMode(mode) { if (mode !== this.cam.mode) { this.cam.mode = mode; this.cam.ready = false; } }
  /** Manual mode's buttons (px from the bottom): the framing keeps the tops above them. */
  setPad(px) { this.view.pad = px; }
  /** Result: frame only the winner (null = both), above the result card's top edge (px from the top; null = no card). */
  setFocusOn(i, cardTop = null) { this.cam.only = i; this.cam.cardTop = cardTop; }
  /** Where the tops will be shortly (per fighter, a few world points), so the framing widens before they fly apart. */
  setLookahead(points) { this.cam.ahead = points; }
  safeBottom() {
    const {h, pad = 0, bottom} = this.view, c = this.cam;
    return Math.max(bottom, pad, c.cardTop != null ? h - c.cardTop + 8 : 0);
  }
  /**
   * What the framing keeps on screen: the top's swept radius (`sweep`, its pieces' full reach as built, which Wren
   * measures with screenRadius and which does not shrink when a piece breaks off) or its models' reach, if larger.
   */
  frameRadius(f) { return Math.max(f.sweep, this.reachOf(f)); }
  /** How far a fighter reaches about its spin axis right now (core, or its longest piece still on). */
  reachOf(f) {
    let r = this.coreRadius * 1.4;
    for (const p of f.parts) if (p.alive) r = Math.max(r, p.reach);
    return r;
  }
  /**
   * Camera distance needed so every subject sphere (p, r) fits inside the safe area shrunk by its own margin m (px),
   * with the camera looking at `focus` along the fixed direction. Analytic for the perspective projection.
   */
  distanceFor(focus, subjects) {
    const {w, h, top} = this.view, B = this.safeBottom();
    const tanV = Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2)), f = h / 2 / tanV;
    let D = CAM.minHalfWidth / (tanV * w / h);
    for (const s of subjects) {
      const hx = Math.max(20, w / 2 - s.m), hy = Math.max(20, (h - top - B) / 2 - s.m);
      const d = tmp.subVectors(s.p, focus), x = Math.abs(d.dot(CAM_RIGHT)), y = Math.abs(d.dot(CAM_UP)), z = d.dot(CAM_FWD);
      D = Math.max(D, f * (x + s.r) / hx - z, f * (y + s.r) / hy - z);
    }
    return D;
  }
  updateCamera(dt, snap) {
    const [a, b] = this.fighters;
    if (!a || !b) return;
    const c = this.cam;
    if (c.mode !== 'build' && this.chase) return this.updateCameraV4(dt, snap);
    if (c.mode !== 'build') {
      const {w, h, top} = this.view, B = this.safeBottom();
      // The principal point sits in the middle of the safe area (eased, so a card coming up never jumps the picture).
      const wantOff = (B - top) / 2;
      if (snap || !c.ready) { c.offY = wantOff; c.offYv = 0; } else [c.offY, c.offYv] = spring(c.offY, c.offYv, wantOff, 3, dt);
      const framed = this.fighters.map((f, i) => i).filter(i => c.only == null || c.only === i);
      // Per top: its core centre keeps `margin` of the width from every safe-area edge, its whole swept radius edgePx.
      // Shake and punch are worked out first: the hard floor leaves room for the few px they move the picture.
      let sx = 0, sy = 0;
      if (c.shakeAge < SHAKE_TIME) {
        c.shakeAge += dt;
        const k = Math.max(0, 1 - c.shakeAge / SHAKE_TIME), ph = c.shakeAge * 2 * Math.PI * 14;
        sx = Math.sin(ph) * c.shakeAmp * k;
        sy = Math.cos(ph * 0.8) * c.shakeAmp * 0.6 * k;
      }
      if (c.punch) {
        c.punch.age += dt;
        const k = c.punch.age / PUNCH_TIME;
        if (k >= 1) c.punch = null;
        else { const e = k < 0.25 ? Math.sin(k / 0.25 * Math.PI / 2) : Math.pow(1 - (k - 0.25) / 0.75, 2); sx -= c.punch.dx * c.punch.px * e; sy -= c.punch.dy * c.punch.px * e; }
      }
      sx = Math.round(sx); sy = Math.round(sy);
      const now = [], soon = [], hardSet = [], m = CAM.margin * w, hardM = CAM.hardPx + Math.max(Math.abs(sx), Math.abs(sy));
      for (const i of framed) {
        const f = this.fighters[i], r = this.frameRadius(f);
        now.push({p: f.center, r: this.coreRadius, m}, {p: f.center, r, m: CAM.edgePx});
        hardSet.push({p: f.center, r, m: hardM});
        if (CAM.hardCore) hardSet.push({p: f.center, r: 0, m: CAM.hardCore * w + hardM - CAM.hardPx});
        for (const p of c.ahead?.[i] ?? []) soon.push({p, r: this.coreRadius, m}, {p, r, m: CAM.edgePx});
      }
      // Aim: the midpoint of the framed tops (the winner alone on the result card).
      const aim = tmp2.set(0, 0, 0);
      for (const s of hardSet) aim.add(s.p);
      aim.divideScalar(hardSet.length).setY(aim.y * 0.5);
      if (snap || !c.ready) { c.focus.copy(aim); c.fv.set(0, 0, 0); c.aim = aim.clone(); } else {
        const off = tmp3.subVectors(aim, c.aim), n = off.length();
        if (n > CAM.deadZone) c.aim.addScaledVector(off, 1 - CAM.deadZone / n);
        for (const k of ['x', 'y', 'z']) [c.focus[k], c.fv[k]] = spring(c.focus[k], c.fv[k], c.aim[k], CAM.panW, dt);
      }
      // Zoom: the widest framing needed now, shortly, and over the last HOLD seconds; in slowly, out softly.
      const all = now.concat(soon);
      const need = Math.log(Math.max(this.distanceFor(aim, all), this.distanceFor(c.focus, all)));
      c.clock += dt;
      c.hist.push({t: c.clock, v: need});
      while (c.hist.length && (c.hist[0].t < c.clock - CAM.hold || c.hist.length > 400)) c.hist.shift();
      let goal = -Infinity;
      for (const e of c.hist) goal = Math.max(goal, e.v);
      if (snap || !c.ready) { c.goal = goal; c.logD = goal; c.logDv = 0; c.hist = [{t: c.clock, v: goal}]; } else {
        c.goal = goal > c.goal ? goal + CAM.slack : Math.max(goal, c.goal - CAM.zoomInRate * dt);
        [c.logD, c.logDv] = spring(c.logD, c.logDv, c.goal, CAM.zoomW, dt);
      }
      // Hard floor: every framed top's whole swept radius on screen right now, whatever the springs are doing.
      const hard = Math.log(this.distanceFor(c.focus, hardSet));
      if (c.logD < hard) { c.logD = hard; c.logDv = Math.max(0, c.logDv); }
      c.ready = true;
      c.dist = Math.exp(c.logD);
      this.camera.quaternion.copy(CAM_QUAT);
      this.camera.position.copy(c.focus).addScaledVector(CAM_FWD, -c.dist);
      // Shake (a break) and punch (a big hit): translation of the picture only, a few px, gone within 0.16 s.
      this.setOffset(sx, Math.round(c.offY + sy));
      // Test aid: the framing as it was this frame.
      c.stat = {pxPerMetre: this.screenRadius(c.focus, 1), dist: c.dist};
      return;
    }
    if (c.offset[0] !== 0 || c.offset[1] !== (this.view.bottom - this.view.top) / 2) this.applyInsets();
    const axis = tmp.subVectors(b.center, a.center).setY(0);
    c.yaw = axis.lengthSq() > 1e-6 ? Math.atan2(axis.x, axis.z) : CAM_YAW;
    c.pitch = 0.6;
    const fwd = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
    tmpM.lookAt(new THREE.Vector3(), fwd, UP);
    tmpQ.setFromRotationMatrix(tmpM);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tmpQ), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQ);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * this.camera.aspect;
    const freeV = tanV * (this.view.h - this.view.top - this.view.bottom) / this.view.h;
    // Assembly preview: close on the player's top, easing when its size changes.
    const focus = tmp2.copy(a.center).lerp(b.center, 0.22);
    if (snap || !c.ready) c.focus.copy(focus); else c.focus.lerp(focus, 1 - Math.exp(-dt / 0.2));
    // Fitted on the top's swept cylinder (its pieces' reach and their height, sampled around), not its reach alone: two
    // hugging pieces stand tall on a small reach and ran into the 你的陀螺 panel (Elara 11-02 a788037f).
    let R = this.coreRadius, y0 = -this.coreRadius, y1 = this.coreRadius;
    for (const p of a.parts) { R = Math.max(R, p.reach); y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1); }
    R = Math.max(R, a.sweep) / Math.cos(Math.PI / 12);
    let need = 1.6;
    for (let k = 0; k < 12; k++) for (const y of [y0, y1]) {
      const d = tmp.set(Math.cos(k * Math.PI / 6) * R, y, Math.sin(k * Math.PI / 6) * R).add(a.center).sub(c.focus), z = d.dot(fwd);
      need = Math.max(need, Math.abs(d.dot(right)) / (tanH * 0.95) - z, Math.abs(d.dot(upv)) / (freeV * 0.95) - z);
    }
    if (snap || !c.ready) c.dist = need; else c.dist += (need - c.dist) * (1 - Math.exp(-dt / 0.45));
    c.ready = true;
    this.camera.quaternion.copy(tmpQ);
    this.camera.position.copy(c.focus).addScaledVector(fwd, -c.dist);
  }

  /**
   * Assembly preview: a piece of the player's top passing between the camera and its core turns see-through, so the core
   * is never hidden behind a pillow (Elara 11-02 a788037f). Build only; everywhere else every piece is drawn solid.
   */
  fadeFront(f, on) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize(), d = new THREE.Vector3();
    for (const p of f.parts) {
      let op = 1;
      if (on) {
        p.holder.getWorldPosition(d).sub(f.center).setY(0);
        const n = d.length(), front = n > 1e-4 ? -d.dot(fwd) / n : 0, k = Math.min(1, Math.max(0, (front - 0.3) / 0.45));
        op = +(1 - 0.7 * k * k * (3 - 2 * k)).toFixed(2);
      }
      if (op === (p.op ?? 1)) continue;
      const flip = (op < 1) !== ((p.op ?? 1) < 1);
      p.op = op;
      p.obj.traverse(o => {
        if (!o.isMesh) return;
        for (const m of [o.material].flat()) { m.opacity = op; if (flip) { m.transparent = op < 1; m.depthWrite = op >= 1; m.needsUpdate = true; } }
      });
    }
  }

  /** realDt drives camera, rings and glow; simDt drives particles and debris (slow motion applies). */
  render(realDt, simDt) {
    this.time += realDt;
    if (this.fighters[0]) this.fadeFront(this.fighters[0], this.cam.mode === 'build');
    for (const f of this.fighters) {
      f.flash *= Math.exp(-realDt * 12);
      f.dim += (f.dimTarget - f.dim) * (1 - Math.exp(-realDt * 4));
      const danger = Math.max(0, (f.coreDamage ?? 0) - 0.5) * 2;
      f.strike *= Math.exp(-realDt * 2.5);
      f.coreUniforms.uFlash.value = f.flash;
      f.coreUniforms.uStrike.value = f.strike;
      f.coreShell.uniforms.uOpacity.value = f.strike;
      f.coreShell.visible = f.strike > 0.04;
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
        p.strike *= Math.exp(-realDt * 2.5);
        p.uniforms.uFlash.value = p.flash;
        p.uniforms.uStrike.value = p.strike;
        p.shell.uniforms.uOpacity.value = p.strike;
        p.shell.visible = p.strike > 0.04;
        // Worn parts glow red, more and faster as they near breaking.
        p.uniforms.uDanger.value = p.damage > 0.4 ? (p.damage - 0.4) / 0.6 * (0.55 + 0.45 * Math.sin(this.time * (6 + 10 * p.damage))) : 0;
        p.fan.material.uniforms.uSpan.value = span;
        p.fan.material.uniforms.uOpacity.value = 0.9 * Math.min(1, Math.max(0, Math.abs(f.spin) - 1) / 6);
      }
    }
    this.simClock = (this.simClock ?? 0) + simDt;
    this.fighters.forEach((f, i) => {
      const a = f.act;
      let sxz = 1, sy = 1;
      if (a.charge > 0) {
        // Wind-up: the core brightens in pulses, the whole top sinks a little and squashes flat and wide.
        a.charge = Math.max(0, a.charge - simDt);
        const k = 1 - a.charge / a.chargeLen, e = 1 - (1 - k) * (1 - k);
        f.coreUniforms.uFlash.value = Math.max(f.coreUniforms.uFlash.value, 0.3 + 0.7 * k * (0.6 + 0.4 * Math.sin(this.time * 40)));
        f.root.position.y -= 0.05 * Math.sin(Math.PI * Math.min(1, k * 1.2));
        sxz = 1 + 0.16 * e;
        sy = 1 - 0.35 * e;
      }
      if (a.pop > 0) {
        // Let go: a quick stretch up that settles.
        a.pop = Math.max(0, a.pop - simDt / 0.22);
        sxz *= 1 - 0.07 * a.pop;
        sy *= 1 + 0.2 * a.pop;
      }
      f.root.scale.set(sxz, sy, sxz);
      if (a.dash > 0) {
        a.dash = Math.max(0, a.dash - simDt);
        this.particles.burst(f.center, [TEAM[i], WHITE], 3, 0.15, 0.04, 0.32);
        if (simDt > 0 && a.dir) {
          // Speed lines streaming off the back, and an afterimage every few hundredths of a second.
          for (let k = 0; k < 2; k++) {
            const side = tmp2.set(-a.dir.z, 0, a.dir.x).multiplyScalar((Math.random() - 0.5) * 0.6);
            this.streaks.add(tmp.copy(f.center).addScaledVector(a.dir, -0.1 - Math.random() * 0.25).add(side), a.dir, a.dir.clone().multiplyScalar(-1.2), 0.45 + Math.random() * 0.4, 0.03, 0.22, k ? WHITE : TEAM[i], 0.85);
          }
          a.ghostIn -= simDt;
          if (a.ghostIn <= 0) { a.ghostIn = 0.035; this.ghost(f.center, TEAM[i], 0.28); }
        }
      }
      if (a.fling > 0) {
        // Bounced off a shield: streaks peel off behind it as it is flung away.
        a.fling = Math.max(0, a.fling - simDt);
        if (simDt > 0 && f.vel && f.vel.lengthSq() > 0.25) {
          const d = tmp3.copy(f.vel).setY(0).normalize();
          for (let k = 0; k < 2; k++) {
            const side = tmp2.set(-d.z, 0, d.x).multiplyScalar((Math.random() - 0.5) * 0.7);
            this.streaks.add(tmp.copy(f.center).addScaledVector(d, -0.15 - Math.random() * 0.2).add(side), d, d.clone().multiplyScalar(-1), 0.5 + Math.random() * 0.4, 0.035, 0.24, k ? WHITE : new THREE.Color('#bff4ff'), 0.9);
          }
          a.ghostIn = (a.ghostIn ?? 0) - simDt;
          if (a.ghostIn <= 0) { a.ghostIn = 0.04; this.ghost(f.center, TEAM[i], 0.3); }
        }
      }
      if (a.shield > 0 || a.parry > 0 || a.fizzle > 0) {
        a.shield = Math.max(0, a.shield - simDt);
        a.parry = Math.max(0, a.parry - simDt);
        a.fizzle = Math.max(0, (a.fizzle ?? 0) - simDt);
        // The window (第 13 版, about 0.25 s): the bubble snaps shut at once, then visibly tightens and dims until it ends,
        // so how long it lasts reads at a glance. A perfect block flares it (parry); an empty one turns it grey and drops it.
        const u = f.shield.material.uniforms, left = a.shieldLen > 0 ? a.shield / a.shieldLen : 0;
        const win = a.shield > 0 ? Math.min(1, (a.shieldLen - a.shield) / 0.03) * (0.45 + 0.55 * left) : 0;
        const fz = a.fizzle / FIZZLE_TIME;
        u.uOpacity.value = Math.max(1.05 * win, (a.parry / 0.35) ** 2 * 1.3, 0.7 * fz * fz);
        u.uColor.value.copy(f.shieldColor).lerp(GREY, a.shield > 0 || a.parry > 0 ? 0 : 1);
        u.uTime.value = this.time;
        f.shield.scale.setScalar(a.shield > 0 ? 0.82 + 0.18 * left : a.parry > 0 ? 1 + 0.25 * (1 - a.parry / 0.35) : 0.82 - 0.25 * (1 - fz));
        f.shield.visible = f.coreAlive;
      } else f.shield.visible = false;
      // The lunge's aim arrow: grows over the wind-up, holds while it flies, fades once it is over.
      const aim = this.aims[i];
      if (a.aimDir && f.coreAlive) {
        a.aimAge += simDt;
        if (a.aimOut > 0) a.aimOut += simDt;
        const grow = Math.min(1, a.aimAge / a.aimGrow), out = a.aimOut > 0 ? Math.max(0, 1 - a.aimOut / AIM_FADE) : 1;
        if (out <= 0) { a.aimDir = null; aim.visible = false; }
        else {
          const start = f.sweep * 1.05;
          aim.visible = true;
          aim.position.set(a.aimFrom.x + a.aimDir.x * start, a.aimFrom.y - 0.04, a.aimFrom.z + a.aimDir.z * start);
          aim.rotation.set(-Math.PI / 2, Math.atan2(-a.aimDir.z, a.aimDir.x), 0);
          // Off the lane: judged on the cores as drawn, while the lunge is still live; it eases in and holds once it ends.
          const o = this.fighters[1 - i];
          if (a.aimAlign !== null && a.aimOut === 0 && o?.coreAlive) {
            const dx = o.center.x - f.center.x, dz = o.center.z - f.center.z, n = Math.hypot(dx, dz);
            const wide = n > 1e-6 && (dx * a.aimDir.x + dz * a.aimDir.z) / n < a.aimAlign ? 1 : 0;
            a.aimWide += (wide - a.aimWide) * Math.min(1, realDt * 18);
          }
          const wide = a.aimWide ?? 0;
          aim.scale.set(a.aimLen, f.sweep * 0.7 * (1 - 0.5 * wide), 1);
          const mu = aim.material.uniforms;
          mu.uColor.value.copy(TEAM[i]).lerp(GREY, wide);
          mu.uGrow.value = 0.15 + 0.9 * (1 - (1 - grow) ** 2);
          mu.uOpacity.value = (0.55 + 0.45 * grow) * (1 - 0.3 * wide) * out * (1 - f.dim);
          mu.uTime.value = this.time;
        }
      } else aim.visible = false;
      // Motion trail: always on for the player's top (orange), only while lunging or flung for the opponent.
      const hot = a.dash > 0 || a.fling > 0, mine = i === 0 && this.showMe;
      const op = f.dim > 0.5 ? 0 : hot ? 1 : mine ? 0.6 : 0;
      this.trails[i].update(f.center, this.simClock, hot ? 0.42 : 0.28, hot ? 0.3 : 0.14, op);
      // The wall lights up in a top's colour where that top is close to it.
      const rr = Math.hypot(f.center.x, f.center.z) + this.reachOf(f) * 0.6, near = Math.min(1, Math.max(0, (rr - (ARENA_RIM - 1.0)) / 0.8)) * (1 - f.dim);
      this.wall.material.uniforms[i ? 'uB' : 'uA'].value.set(f.center.x, f.center.z);
      this.wall.material.uniforms[i ? 'uCB' : 'uCA'].value.copy(TEAM[i]).multiplyScalar(near * 0.9);
    });
    // The player's ring: a fixed thin line just outside its core (the core hides the far side of it); nothing drives it.
    const me = this.fighters[0];
    this.meRing.visible = Boolean(this.showMe && me && me.dim < 0.6);
    if (this.meRing.visible) {
      this.meRing.position.set(me.center.x, me.center.y - 0.04, me.center.z);
      this.meRing.scale.setScalar(this.coreRadius * ME_RING_R / 0.9);
      this.meRing.material.uniforms.uOpacity.value = ME_RING_OPACITY * (1 - me.dim);
    }
    for (const g of this.ghosts) {
      if (!g.s.visible) continue;
      g.age += simDt;
      const k = g.age / g.life;
      if (k >= 1) { g.s.visible = false; continue; }
      g.s.material.opacity = 0.75 * (1 - k);
      g.s.scale.setScalar(this.coreRadius * (5 + 3 * k));
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
    // Test aid (camera-motion.mjs HIDE=1): draw only the floor, wall and backdrop, to measure the camera without the tops.
    if (this.debugHide) {
      for (const f of this.fighters) f.root.visible = f.halo.visible = false;
      for (const o of [this.particles.points, this.streaks.mesh, this.shards.mesh, this.meRing, ...this.trails.map(t => t.mesh), ...this.ghosts.map(g => g.s), ...this.rings.pool.map(r => r.s), ...this.debris.map(d => d.piece)]) o.visible = false;
    }
    this.particles.update(simDt);
    this.streaks.update(simDt);
    this.shards.update(simDt);
    this.rings.update(realDt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Test aid: how far (CSS px) any visible core or mounted piece reaches outside the safe area (below the HUD,
   * above the caption or result card, and above the 冲/挡 buttons in manual mode). Positive = cut off by that much;
   * negative = the smallest margin left. Pieces use their mesh bounding boxes, so this errs on the side of reporting an overflow.
   */
  safeOverflow() {
    const {w, h, top} = this.view, bottom = this.safeBottom();
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
      if (!f.core.visible || (this.cam.only != null && this.cam.only !== i)) return;
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

  /**
   * Test aid (Wren's measure): the smallest gap (CSS px) between a framed top's swept circle, screenRadius(center, sweep),
   * and the screen's left / right edges (lr), and the safe area's four edges (safe). Negative: off.
   */
  sweptMargin() {
    const {w, h, top} = this.view, bottom = this.safeBottom(), o = {x: 0, y: 0};
    let lr = Infinity, safe = Infinity;
    this.fighters.forEach((f, i) => {
      if (!f.core.visible || (this.cam.only != null && this.cam.only !== i) || !this.project(f.center, o)) return;
      const r = this.screenRadius(f.center, f.sweep);
      lr = Math.min(lr, o.x - r, w - o.x - r);
      safe = Math.min(safe, o.x - r, w - o.x - r, o.y - r - top, h - bottom - o.y - r);
    });
    return {lr, safe};
  }
  /** Test aid: the smallest distance (CSS px) from a framed core centre to an edge of the safe area. */
  coreMargin() {
    const {w, h, top} = this.view, bottom = this.safeBottom(), o = {x: 0, y: 0};
    let m = Infinity;
    this.fighters.forEach((f, i) => {
      if (!f.core.visible || (this.cam.only != null && this.cam.only !== i) || !this.project(f.center, o)) return;
      m = Math.min(m, o.x, w - o.x, o.y - top, h - bottom - o.y);
    });
    return m;
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

const RIM_HEAD = 'uniform vec3 uRim;\nuniform float uFlash;\nuniform float uDanger;\nuniform float uDim;\nuniform float uStrike;\n';
const RIM_BODY = `#include <emissivemap_fragment>
{
  float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float rim = pow(1.0 - facing, 3.0);
  totalEmissiveRadiance += uRim * (rim * 1.1 + 0.015) * (1.0 - uDim * 0.8);
  totalEmissiveRadiance += vec3(1.0) * uFlash * 1.6;
  totalEmissiveRadiance += uRim * uStrike * rim * 1.6;
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
