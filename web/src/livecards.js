import * as THREE from 'three';
import {turnRig} from './models.js';

/**
 * The 角色库 cards and 看它怎么来的 turn their models live, at the screen's own rate (Elara 11-02 9a68db0a: a pre-shot
 * strip still stepped on a slow turn at 72 frames, and its memory grew with every item collected).
 *
 * One WebGL context: while these screens cover the page the stage is not drawn, so its canvas is free. Each view on
 * screen is drawn into that canvas's bottom-left corner and copied into the view's own 2D canvas in the same task,
 * before the browser presents or clears it; the views scroll with the page like any element.
 * Kept light for phones: only views on screen are drawn, nothing once the screens close (main.js stops calling
 * render), at most 2 device pixels per CSS pixel, and a still frame for reduced motion.
 */
const TURN = 6; // seconds per turn, as the strips had
// Every turn starts at the item's front (rig.yaw, models.js cardPose), which is also the held angle (reduced motion,
// 看它怎么来的) and the angle of the card's pre-made still (data/stills, task #39), so the model fades in over its own
// picture. For a photo-made item the front is the side its styled picture shows.
// An item with card.swing (radians) swings that far either side of its front instead of turning all the way round, starting
// and held at +swing: 评委版's flip-flop stands on its sole's edge, so a full turn would show the bare sole half the time.
const angle = (rig, turns) => rig.swing ? rig.swing * Math.cos(turns * Math.PI * 2) : turns * Math.PI * 2;
const FADE = 0.4; // seconds the model takes to fade in over its still (style.css); it holds the still's angle meanwhile
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// The turntables draw as the opening page's pot does, with no tone mapping: the stage's ACES greys and darkens a model's
// colours (Elara b32bfd9a ③, e3832fa5). Set only while one is drawn; the stage keeps its own.
const TURN_TONE = {toneMapping: THREE.NoToneMapping, toneMappingExposure: 1};
// A finger dragged across a view turns the model: a full width is a little over a half turn. Up and down still scroll
// the page (touch-action: pan-y in style.css).
function dragTurn(v) {
  const c = v.canvas;
  c.classList.add('drag');
  c.addEventListener('pointerdown', e => { v.held = {id: e.pointerId, x: e.clientX}; c.setPointerCapture?.(e.pointerId); });
  c.addEventListener('pointermove', e => {
    if (v.held?.id !== e.pointerId) return;
    v.offset += (e.clientX - v.held.x) / Math.max(1, c.clientWidth) * Math.PI * 1.2;
    v.held.x = e.clientX;
    v.done = false;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) c.addEventListener(type, e => { if (v.held?.id === e.pointerId) v.held = null; });
}
function turnTone(r) {
  const was = {toneMapping: r.toneMapping, toneMappingExposure: r.toneMappingExposure};
  Object.assign(r, TURN_TONE);
  return () => Object.assign(r, was);
}

export class LiveTurns {
  constructor(renderer, environment) {
    this.renderer = renderer;
    this.environment = environment;
    this.views = new Map();
    this.drawn = 0; // views drawn so far (test hook: draws per second)
    this.io = new IntersectionObserver(entries => {
      for (const e of entries) { const v = this.views.get(e.target); if (v) v.seen = e.isIntersecting; }
    });
  }

  /**
   * Turns `itemId` in `canvas`, or holds one angle if `still`. Call again once the model has loaded. `zoom` > 1 brings
   * the camera closer than the card fit (拍一件's 好了, where the 3D is the reward and should fill its pane). `drag`: a
   * finger across it turns it too, and it stops turning by itself while held (好了, Elara 9e197c2f).
   */
  show(canvas, itemId, {still = false, zoom = 1, drag = false} = {}) {
    let v = this.views.get(canvas);
    if (!v) {
      v = {canvas, ctx: canvas.getContext('2d'), seen: false, turned: 0, at: null, offset: 0, held: null};
      this.views.set(canvas, v);
      this.io.observe(canvas);
      if (drag) dragTurn(v);
    }
    if (v.id !== itemId) { v.id = itemId; v.rig = null; v.t0 = null; v.turned = 0; v.at = null; v.offset = 0; v.ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.removeAttribute('data-drawn'); }
    v.rig ??= turnRig(itemId, this.environment, zoom);
    v.still = still;
    v.done = false;
    v.bg = null;
    canvas.toggleAttribute('data-ready', Boolean(v.rig));
  }

  /**
   * The item at its front as a `size`-pixel WebP with a clear background, for data/stills (scripts/make-stills.mjs).
   * The stage canvas has no alpha, so the model is drawn over black and over white and the alpha is the difference.
   * `turn` (radians) turns it on from its front (评委版's opening card shows its item three-quarter, so it reads as 3D).
   */
  shot(itemId, size, turn = 0) {
    const rig = turnRig(itemId, this.environment);
    if (!rig) throw Error(`Model not loaded: ${itemId}`);
    rig.spin.rotation.y = rig.yaw + turn;
    const r = this.renderer, gl = r.domElement, pr = r.getPixelRatio();
    if (size > Math.min(gl.width, gl.height)) throw Error(`Stage canvas smaller than ${size}px`);
    const saved = {viewport: r.getViewport(new THREE.Vector4()), scissor: r.getScissor(new THREE.Vector4()), scissorTest: r.getScissorTest(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha()};
    const over = colour => {
      r.setRenderTarget(null);
      r.setViewport(0, 0, size / pr, size / pr);
      r.setScissor(0, 0, size / pr, size / pr);
      r.setScissorTest(true);
      r.setClearColor(colour, 1);
      r.render(rig.scene, rig.camera);
      const ctx = Object.assign(document.createElement('canvas'), {width: size, height: size}).getContext('2d');
      ctx.drawImage(gl, 0, gl.height - size, size, size, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size);
    };
    const untone = turnTone(r), black = over(0x000000), white = over(0xffffff).data, d = black.data;
    untone();
    r.setViewport(saved.viewport);
    r.setScissor(saved.scissor);
    r.setScissorTest(saved.scissorTest);
    r.setClearColor(saved.color, saved.alpha);
    for (let i = 0; i < d.length; i += 4) {
      const a = 1 - ((white[i] - d[i]) + (white[i + 1] - d[i + 1]) + (white[i + 2] - d[i + 2])) / 765;
      // Over black the colour is premultiplied by alpha: divide it back out.
      for (let k = 0; k < 3; k++) d[i + k] = a > 0 ? Math.min(255, Math.round(d[i + k] / a)) : 0;
      d[i + 3] = Math.round(a * 255);
    }
    const out = Object.assign(document.createElement('canvas'), {width: size, height: size});
    out.getContext('2d').putImageData(black, 0, 0);
    return out.toDataURL('image/webp', 0.82);
  }

  /** Forgets views whose canvas has left the page (the 角色库 rebuilds its cards on every open). */
  prune() {
    for (const [canvas] of this.views) if (!canvas.isConnected) { this.io.unobserve(canvas); this.views.delete(canvas); }
  }

  /** Draws the views inside `root` that are on screen, at time `t` seconds. */
  render(t, root) {
    const r = this.renderer, gl = r.domElement, pr = r.getPixelRatio(), most = Math.min(gl.width, gl.height);
    let saved = null;
    for (const v of this.views.values()) {
      if (!v.rig || !v.seen || v.done || !root.contains(v.canvas)) continue;
      const size = Math.min(most, Math.round(v.canvas.clientWidth * Math.min(devicePixelRatio, 2)));
      if (!size) continue;
      // Both sides: a fresh canvas is 300×150, so a 150 px card at 2× would keep its height (crops the model).
      if (v.canvas.width !== size || v.canvas.height !== size) v.canvas.width = v.canvas.height = size;
      saved ??= {target: r.getRenderTarget(), viewport: r.getViewport(new THREE.Vector4()), scissor: r.getScissor(new THREE.Vector4()), scissorTest: r.getScissorTest(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), untone: turnTone(r)};
      r.setRenderTarget(null);
      r.setViewport(0, 0, size / pr, size / pr);
      r.setScissor(0, 0, size / pr, size / pr);
      r.setScissorTest(true);
      // The canvas has no alpha: clear to the colour the card shows behind the model.
      r.setClearColor(v.bg ??= backdrop(v.canvas), 1);
      v.t0 ??= t;
      // Turns by itself after the fade, not while a finger holds it; a drag adds its own angle on top.
      if (v.at !== null && v.held === null && t - v.t0 > FADE) v.turned += (t - v.at) / TURN;
      v.at = t;
      v.rig.spin.rotation.y = v.rig.yaw + v.offset + angle(v.rig, v.still || reduced.matches ? 0 : v.turned);
      r.render(v.rig.scene, v.rig.camera);
      v.ctx.drawImage(gl, 0, gl.height - size, size, size, 0, 0, size, size);
      // The card fades the model in over its outline only once there is a picture to show (task #37).
      v.canvas.setAttribute('data-drawn', '');
      v.done = (v.still || reduced.matches) && v.held === null;
      this.drawn++;
    }
    if (!saved) return;
    r.setRenderTarget(saved.target);
    r.setViewport(saved.viewport);
    r.setScissor(saved.scissor);
    r.setScissorTest(saved.scissorTest);
    r.setClearColor(saved.color, saved.alpha);
    saved.untone();
  }
}

/** The colour an element shows through to: its ancestors' backgrounds laid over each other down to an opaque one. */
function backdrop(el) {
  const layers = [];
  for (let n = el; n instanceof Element; n = n.parentElement) {
    const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (!m) continue;
    const a = m[3] ?? 1;
    if (a > 0) layers.push([m[0], m[1], m[2], a]);
    if (a >= 1) break;
  }
  let rgb = [0, 0, 0];
  for (const [r, g, b, a] of layers.reverse()) rgb = [r * a + rgb[0] * (1 - a), g * a + rgb[1] * (1 - a), b * a + rgb[2] * (1 - a)];
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}
