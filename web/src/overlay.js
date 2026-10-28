import * as THREE from 'three';

const ease = k => 1 - (1 - k) ** 3;
const NS = 'http://www.w3.org/2000/svg';
const HEX = ['#ff8a3d', '#3db4ff'];
const CALL_TIME = 0.6;

/** DOM effects over the canvas: a life ring around each core, banners, flash. Animated from update(realDt). */
export class Overlay {
  constructor(stage, els) {
    this.stage = stage;
    this.layer = els.fx;
    this.flashEl = els.flash;
    this.bannerEl = els.banner;
    this.nums = [];
    this.calls = [];
    this.flash = 0;
    this.banner = {age: 0, dur: 0};
    this.p = {x: 0, y: 0};
    this.rings = [0, 1].map(i => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'ring');
      const track = document.createElementNS(NS, 'circle'), arc = document.createElementNS(NS, 'circle');
      track.setAttribute('class', 'track');
      arc.setAttribute('stroke', HEX[i]);
      svg.append(track, arc);
      this.layer.append(svg);
      return {svg, track, arc, hp: 1, shown: 1};
    });
    // 「你」 over the player's top (side 0, orange, in both modes): a plate with a chevron pointing down at it.
    this.me = document.createElement('div');
    this.me.className = 'me';
    this.me.innerHTML = '<b>你</b><i></i>';
    this.layer.append(this.me);
    this.meShown = 0;
  }

  /** Floating word anchored to a world point, drifting up. */
  number(point, text, cls, dur = 1.3) {
    const el = document.createElement('div');
    el.className = `num ${cls}`;
    el.textContent = text;
    this.layer.append(el);
    this.nums.push({el, at: new THREE.Vector3().copy(point), age: 0, dur, rise: 40, half: el.offsetWidth * 0.65, h: el.offsetHeight});
  }
  /**
   * Who hit with what: a short plate in the striker's colour (「锅」, 「锅 暴击」), held up above the contact point on a
   * thin pin so it does not sit on the tops (about half a metre up, in screen px). Plates that would land on one another
   * stack upward, so a quick exchange stays readable; each is gone within CALL_TIME.
   */
  callout(point, side, name, {crit = false, dash = false, cls = ''} = {}) {
    const el = document.createElement('div');
    el.className = `call t${side} ${cls}${dash ? ' dash' : ''}`;
    if (dash) { const em = document.createElement('em'); em.textContent = '冲'; el.append(em); }
    const b = document.createElement('b');
    b.textContent = name;
    el.append(b);
    if (crit) { const em = document.createElement('em'); em.textContent = '暴击'; el.append(em); }
    this.layer.append(el);
    const at = new THREE.Vector3().copy(point), w = el.offsetWidth, h = el.offsetHeight, p = this.stage.project(at, {x: 0, y: 0});
    const base = Math.max(18, Math.round(this.stage.screenRadius(at, 0.55)));
    // Lift above every live plate it would cover (screen px above its anchor), lowest free spot first.
    let lift = 0;
    for (let moved = Boolean(p); moved;) {
      moved = false;
      for (const c of this.calls) {
        const q = this.stage.project(c.at, {x: 0, y: 0});
        if (!q || Math.abs(q.x - p.x) >= (w + c.w) / 2 + 4) continue;
        const bottom = p.y - base - lift, top = bottom - h, cbottom = q.y - c.base - c.lift, ctop = cbottom - c.h;
        if (top < cbottom + 3 && bottom > ctop - 3) { lift = p.y - base - ctop + 3; moved = true; }
      }
    }
    // The pin runs from the contact point up to the lowest plate only (a lifted plate would have it cross the others).
    let pin = null;
    if (lift === 0) { pin = document.createElement('i'); pin.className = `callpin t${side}`; pin.style.height = `${base}px`; this.layer.append(pin); }
    this.calls.push({el, pin, at, age: 0, w, h, base, lift});
  }
  screenFlash(amount) { this.flash = Math.max(this.flash, amount); }
  showBanner(text, color, dur = 1.1) {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.banner = {age: 0, dur};
  }
  setCoreHp(i, frac, snap) { const r = this.rings[i]; r.hp = frac; if (snap) r.shown = frac; }
  clear() {
    for (const n of [...this.nums, ...this.calls]) { n.el.remove(); n.pin?.remove(); }
    this.nums = [];
    this.calls = [];
    this.flash = 0;
    this.banner.dur = 0;
    this.bannerEl.style.opacity = 0;
    this.flashEl.style.opacity = 0;
  }

  update(dt, showRings) {
    const {stage, p} = this;
    const W = this.layer.clientWidth;
    for (let k = this.nums.length - 1; k >= 0; k--) {
      const n = this.nums[k];
      n.age += dt;
      const t = n.age / n.dur;
      if (t >= 1 || !stage.project(n.at, p)) { n.el.remove(); this.nums.splice(k, 1); continue; }
      const scale = t < 0.1 ? 0.6 + 6 * t : 1.2 - Math.min(0.2, (t - 0.1) * 2);
      const y = p.y - ease(Math.min(1, t * 1.4)) * n.rise;
      n.el.style.opacity = t > 0.7 ? (1 - t) / 0.3 : 1;
      const x = Math.min(W - 8 - n.half, Math.max(8 + n.half, p.x));
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${scale})`;
    }
    for (let k = this.calls.length - 1; k >= 0; k--) {
      const c = this.calls[k];
      c.age += dt;
      const t = c.age / CALL_TIME;
      if (t >= 1 || !stage.project(c.at, p)) { c.el.remove(); c.pin?.remove(); this.calls.splice(k, 1); continue; }
      const x = Math.min(W - 6 - c.w / 2, Math.max(6 + c.w / 2, p.x)), y = p.y - c.base - c.lift, fade = t > 0.65 ? (1 - t) / 0.35 : 1;
      c.el.style.opacity = fade;
      c.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${t < 0.12 ? 0.7 + 2.5 * t : 1})`;
      if (c.pin) { c.pin.style.opacity = fade; c.pin.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`; }
    }
    this.flash *= Math.exp(-dt * 11);
    this.flashEl.style.opacity = this.flash > 0.01 ? this.flash.toFixed(3) : 0;
    if (this.banner.dur > 0) {
      this.banner.age += dt;
      const t = this.banner.age / this.banner.dur;
      this.bannerEl.style.opacity = t < 0.15 ? t / 0.15 : t > 0.75 ? Math.max(0, (1 - t) / 0.25) : 1;
      this.bannerEl.style.transform = `scale(${1.25 - 0.25 * ease(Math.min(1, t * 4))})`;
      if (t >= 1) this.banner.dur = 0;
    }
    // 「你」: rides just above the player's top (above its pieces' reach), always on top of everything.
    const me = stage.fighters[0];
    const meOn = showRings && stage.showMe && me && me.dim < 0.6 && stage.project(me.center, p);
    this.meShown += ((meOn ? 1 : 0) - this.meShown) * (1 - Math.exp(-dt * 12));
    if (this.meShown > 0.02 && me && stage.project(me.center, p)) {
      // Capped, so on a close camera (昨天的镜头) it stays by the player's core instead of landing on the other top;
      // and slid sideways when the other core sits right where it would go.
      const r = Math.min(64, stage.screenRadius(me.center, stage.reachOf(me) + 0.1) * 0.95);
      let x = p.x;
      const y = Math.max(stage.view.top + 34, p.y - r - 4), foe = stage.fighters[1], q = {x: 0, y: 0};
      if (foe?.core.visible && stage.project(foe.center, q)) {
        const fr = stage.screenRadius(foe.center, stage.coreRadius) + 4;
        if (Math.abs(q.x - x) < 20 + fr && q.y > y - 44 - fr && q.y < y + fr) x = q.x + Math.sign(x - q.x || 1) * (20 + fr);
      }
      this.meDx = (this.meDx ?? 0) + (x - p.x - (this.meDx ?? 0)) * (1 - Math.exp(-dt * 14));
      x = Math.min(W - 22, Math.max(22, p.x + this.meDx));
      // A hit's plate wins over the marker for the moment it is up (they would otherwise pile on the same spot).
      let under = false;
      for (const c of this.calls) {
        if (!stage.project(c.at, q)) continue;
        const cx = Math.min(W - 6 - c.w / 2, Math.max(6 + c.w / 2, q.x)), cy = q.y - c.base - c.lift;
        if (Math.abs(cx - x) < c.w / 2 + 20 && cy > y - 46 && cy - c.h < y) { under = true; break; }
      }
      this.meCovered = (this.meCovered ?? 0) + ((under ? 1 : 0) - (this.meCovered ?? 0)) * (1 - Math.exp(-dt * 16));
      this.me.style.opacity = (this.meShown * (1 - 0.85 * this.meCovered)).toFixed(3);
      this.me.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    } else this.me.style.opacity = 0;
    // Life ring around each core: the core is the thing that must not break.
    this.rings.forEach((r, i) => {
      const f = stage.fighters[i];
      if (!showRings || !f || f.dim > 0.9 || !stage.project(f.center, p)) { r.svg.style.opacity = 0; return; }
      r.shown += (r.hp - r.shown) * (1 - Math.exp(-dt * 10));
      const rad = Math.max(10, stage.screenRadius(f.center, stage.coreRadius) + 5), w = rad > 22 ? 4 : 3, size = rad * 2 + w * 2;
      const c = 2 * Math.PI * rad;
      r.svg.setAttribute('width', size);
      r.svg.setAttribute('height', size);
      for (const el of [r.track, r.arc]) { el.setAttribute('cx', size / 2); el.setAttribute('cy', size / 2); el.setAttribute('r', rad); el.setAttribute('stroke-width', w); }
      r.arc.setAttribute('stroke-dasharray', `${(c * Math.max(0, r.shown)).toFixed(1)} ${c.toFixed(1)}`);
      r.arc.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
      const low = r.hp < 0.35;
      r.arc.setAttribute('stroke', low ? (Math.sin(performance.now() / 90) > 0 ? '#ff4d5e' : HEX[i]) : HEX[i]);
      r.svg.style.opacity = 0.95;
      r.svg.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
    });
  }
}
