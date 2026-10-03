// The commander's main-screen controls (adapted from mission 2): the order bar, the "what now" task card with one-tap
// actions, world markers (red = threat, blue = our force) and the intro card.
import * as THREE from 'three';
import { G, clamp, bus } from '../core.js';
import { hT } from './world.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3();
const sv = b => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
export const ICON = {
  spk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 10v4h3l8 4.5V5.5L6 10H3z"/><path d="M17 9.2a4 4 0 0 1 0 5.6M19.6 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  air: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.5l1.6 6.5 7.9 4v2l-7.9-2-.6 5.5 2.5 2v1.5L12 21l-3.5 1v-1.5l2.5-2-.6-5.5-7.9 2v-2l7.9-4z"/></svg>',
  tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M10 18.5h4"/></svg>',

  zik: sv('<path d="M12 4v16M5 9.5l7 1.5 7-1.5M9.5 19h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  force: sv('<circle cx="8" cy="6.5" r="2.2"/><circle cx="16" cy="6.5" r="2.2"/><path d="M4 20v-4.5a4 4 0 0 1 8 0V20M12 20v-4.5a4 4 0 0 1 8 0V20"/>'),
  robot: sv('<rect x="5" y="9" width="14" height="6" rx="1.5"/><circle cx="8" cy="17.5" r="1.8"/><circle cx="16" cy="17.5" r="1.8"/><path d="M12 9V5.5l4-1.5"/>'),
  smoke: sv('<circle cx="8" cy="14" r="4"/><circle cx="14.5" cy="11" r="4.5"/><circle cx="17" cy="16.5" r="3"/>'),
  tank: sv('<rect x="3" y="13" width="18" height="5" rx="2.5"/><path d="M7 13v-3h7v3M14 11h7"/>'),
  apc: sv('<path d="M3 16V10l2.5-3h12L21 10v6H3z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="12" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  blast: sv('<path d="M12 3l1.8 5 5-2-2.6 4.6L21 13l-5 1 1.6 5-4.6-3-3.4 4-.8-5.2L3 14l4.6-2.6L4.5 7l5 1.6z"/>'),
};

export class Command {
  constructor() {
    this.task = null; this.pool = new Map(); this.pulses = [];
    document.querySelectorAll('[data-icon]').forEach(e => { e.innerHTML = ICON[e.dataset.icon] || ''; });
    document.querySelectorAll('#cmdbar button').forEach(b => { const go = e => { e.preventDefault(); e.stopPropagation(); this.press(b.dataset.cmd); }; b.addEventListener('click', go); b.addEventListener('touchstart', go, { passive: false }); });
    bus.on('key', k => { if (G.state !== 'play' || (G.tablet && G.tablet.open) || this.introOn) return;
      const m = { Digit1: 'zik', Digit2: 'force', Digit3: 'spk', Digit4: 'smoke', Digit5: 'apc' }[k]; if (m) this.press(m);
      if ((k === 'Enter' || k === 'KeyF') && this.task && this.task.acts[0]) this.runAct(0); if (k === 'KeyG' && this.task && this.task.acts[1]) this.runAct(1); });
    const cv = $('c');
    cv.addEventListener('wheel', e => { if (G.state !== 'play') return; e.preventDefault(); this.zoom = clamp((this.zoom || 1) * (e.deltaY > 0 ? 1 / 1.2 : 1.2), 1, 4); }, { passive: false });
    $('bIntro').addEventListener('click', () => this.closeIntro());
  }
  intro(done) { this.introOn = true; this._introDone = done; $('intro').hidden = false; }
  closeIntro() { if (!this.introOn) return; this.introOn = false; $('intro').hidden = true; const f = this._introDone; this._introDone = null; f && f(); }
  press(cmd) {
    if (G.state !== 'play' || this.introOn) return; const M = G.mission; if (!M.U) return;
    G.audio.playS('dry', { vol: .25, rate: 2 });
    if (cmd === 'zik') return G.tablet.show('drone');
    if (cmd === 'force') return G.tablet.show('forces');
    this.say(M.order(cmd));
  }
  say(r) { if (typeof r === 'string') G.ui.toast(r); }
  // feedback ring on the ground (the loudspeaker's reach)
  pulse(p, col, R, dur, y = .3) { const m = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .9, depthWrite: false, fog: false, side: THREE.DoubleSide })); m.position.set(p.x, (p.y || hT(p.x, p.z)) + y, p.z); m.renderOrder = 40; G.scene.add(m); this.pulses.push({ m, t: 0, R, dur }); }
  // ---------- the task card ----------
  setTask(t) {
    const el = $('task'); this.task = t; if (!t) { el.hidden = true; return; } el.hidden = false;
    el.className = t.threat ? 'threat' : ''; $('taskK').textContent = t.kind || (t.threat ? 'איום' : 'משימה'); $('taskT').textContent = t.title; $('taskP').textContent = t.text;
    const box = $('taskA'); box.innerHTML = ''; (t.acts || []).forEach((a, i) => { const b = document.createElement('button'); b.className = a.cls || (i ? 'alt' : ''); b.innerHTML = (ICON[a.icon] || '') + `<span>${a.label}</span>` + (!G.isTouch && i < 2 ? `<kbd>${i ? 'G' : 'F'}</kbd>` : ''); b.onclick = e => { e.stopPropagation(); this.runAct(i); }; b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.runAct(i); }, { passive: false }); box.appendChild(b); });
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    document.querySelectorAll('#cmdbar button').forEach(b => b.classList.toggle('hot', !!t.hot && b.dataset.cmd === t.hot));
  }
  runAct(i) { const a = this.task && this.task.acts[i]; if (!a || G.state !== 'play') return; G.audio.playS('dry', { vol: .25, rate: 2 }); const r = a.fn(); this.say(r); setTimeout(() => G.mission.refreshTask(true), 120); return r; }
  // ---------- markers over people and places ----------
  markers() {
    const box = $('wmarks'); const list = G.state === 'play' && !this.introOn ? G.mission.markers() : []; const cam = G.camera; const W = innerWidth, H = innerHeight; const seen = new Set();
    for (const m of list) {
      seen.add(m.id); let el = this.pool.get(m.id);
      if (!el) { el = document.createElement('div'); el.innerHTML = '<i></i><b></b><em></em>'; box.appendChild(el); this.pool.set(m.id, el); }
      el.className = 'wm ' + m.kind; const b = el.children[1], em = el.children[2]; if (b.textContent !== m.label) b.textContent = m.label;
      _v.set(m.pos.x, (m.pos.y ?? hT(m.pos.x, m.pos.z)) + (m.h ?? 2.3), m.pos.z); const dist = _v.distanceTo(cam.position); _v.project(cam);
      let x = (_v.x * .5 + .5) * W, y = (-_v.y * .5 + .5) * H; const behind = _v.z > 1; const pad = G.isTouch ? 34 : 44;
      const off = behind || x < pad || x > W - pad || y < pad || y > H - pad;
      if (off) { if (m.kind !== 'threat') { el.style.display = 'none'; continue; }
        let dx = x - W / 2, dy = y - H / 2; if (behind) { dx = -dx; dy = -dy; } const k = Math.min((W / 2 - pad) / Math.max(1, Math.abs(dx)), (H / 2 - pad - 40) / Math.max(1, Math.abs(dy))); x = W / 2 + dx * k; y = H / 2 + dy * k; el.classList.add('edge'); el.children[0].style.transform = `rotate(${Math.atan2(dy, dx) - Math.PI / 4}rad)`; }
      else el.children[0].style.transform = '';
      el.style.display = ''; el.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
      const txt = `${Math.round(dist)} מ׳`; if (em.textContent !== txt) em.textContent = txt;
    }
    for (const [id, el] of this.pool) if (!seen.has(id)) el.style.display = 'none';
  }
  update(dt) {
    const M = G.mission; if (M && M.U) { const U = M.U; const set = (cmd, p, n, dis) => { const b = document.querySelector(`#cmdbar button[data-cmd="${cmd}"]`); if (!b) return; b.style.setProperty('--p', (clamp(p, 0, 1) * 100).toFixed(0) + '%'); const nn = b.querySelector('.n'); if (nn && nn.textContent !== String(n ?? '')) nn.textContent = n ?? ''; b.disabled = !!dis; };
      set('zik', 0, U.zik.ammo, false); set('force', 0, '', false); set('spk', U.spk.cd / 20, '', !(M.phase === 'shaft' || M.phase === 'withdraw' || M.phase === 'ready')); set('smoke', 0, U.smoke.n, U.smoke.n <= 0); set('apc', 0, '', U.apc.busy || !(M.phase === 'extract' || M.phase === 'ready')); }
    for (let i = this.pulses.length - 1; i >= 0; i--) { const p = this.pulses[i]; p.t += dt; const k = p.t / p.dur; if (k >= 1) { G.scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); this.pulses.splice(i, 1); continue; } p.m.scale.setScalar(1 + p.R * k); p.m.material.opacity = .85 * (1 - k); }
    if (G.player) { const f = (G.fovBase0 || 54) / (this.zoom || 1); if (Math.abs(G.player.fovBase - f) > .01) G.player.fovBase += (f - G.player.fovBase) * Math.min(1, dt * 10); }
    const sub = $('sub'), nt = $('notif'); if (sub && nt) { const on = sub.classList.contains('on') && sub.offsetTop < innerHeight * .4; const top = on ? sub.offsetTop + sub.offsetHeight + 6 : 0; const v = top ? top + 'px' : ''; if (nt.style.top !== v) nt.style.top = v; }
    this.markers();
  }
}
