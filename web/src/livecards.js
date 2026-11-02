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
const STILL_ANGLE = 0.6;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

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

  /** Turns `itemId` in `canvas`, or holds one angle if `still`. Call again once the model has loaded. */
  show(canvas, itemId, {still = false} = {}) {
    let v = this.views.get(canvas);
    if (!v) {
      v = {canvas, ctx: canvas.getContext('2d'), seen: false};
      this.views.set(canvas, v);
      this.io.observe(canvas);
    }
    if (v.id !== itemId) { v.id = itemId; v.rig = null; v.ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.removeAttribute('data-drawn'); }
    v.rig ??= turnRig(itemId, this.environment);
    v.still = still;
    v.done = false;
    v.bg = null;
    canvas.toggleAttribute('data-ready', Boolean(v.rig));
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
      if (v.canvas.width !== size) v.canvas.width = v.canvas.height = size;
      saved ??= {target: r.getRenderTarget(), viewport: r.getViewport(new THREE.Vector4()), scissor: r.getScissor(new THREE.Vector4()), scissorTest: r.getScissorTest(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha()};
      r.setRenderTarget(null);
      r.setViewport(0, 0, size / pr, size / pr);
      r.setScissor(0, 0, size / pr, size / pr);
      r.setScissorTest(true);
      // The canvas has no alpha: clear to the colour the card shows behind the model.
      r.setClearColor(v.bg ??= backdrop(v.canvas), 1);
      v.rig.spin.rotation.y = v.still || reduced.matches ? STILL_ANGLE : (t / TURN) * Math.PI * 2;
      r.render(v.rig.scene, v.rig.camera);
      v.ctx.drawImage(gl, 0, gl.height - size, size, size, 0, 0, size, size);
      // The card fades the model in over its outline only once there is a picture to show (task #37).
      v.canvas.setAttribute('data-drawn', '');
      v.done = v.still || reduced.matches;
      this.drawn++;
    }
    if (!saved) return;
    r.setRenderTarget(saved.target);
    r.setViewport(saved.viewport);
    r.setScissor(saved.scissor);
    r.setScissorTest(saved.scissorTest);
    r.setClearColor(saved.color, saved.alpha);
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
