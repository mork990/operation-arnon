// The incident commander's controls on the main screen (adapted from mission 2's fence/command.js):
// order buttons (loudspeaker, lane 2, checkpoint pace, medics, smoke and armour), the "what now" task card with
// one-tap actions, and markers over threats and our own units.
import * as THREE from 'three';
import { G, clamp, bus } from '../core.js';
import { hC } from './world.js';
import { ICON as FICON } from '../fence/command.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3();

export const ICON = Object.assign({}, FICON, {
  lane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 3v18M12 3v18M20 3v18"/><path d="M8 15l0-8M8 7l-2 2.5M8 7l2 2.5M16 9v8M16 17l-2-2.5M16 17l2-2.5"/></svg>',
  flow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h13l-3-3M3 8l0 0M21 16H8l3 3"/></svg>',
  med: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.6 4.5h5.2L17.2 12l2.6 4.5h-5.2L12 21l-2.6-4.5H4.2L6.8 12 4.2 7.5h5.2z"/></svg>',
  smoke: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 18h7l2-3h6l2 3"/><circle cx="8" cy="9" r="3"/><circle cx="13" cy="7" r="3.4"/><circle cx="17.5" cy="10" r="2.6"/></svg>',
  uav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2 11h20M12 6v12M9 18h6M8 11l4-5 4 5"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
});

export class Command {
  constructor() {
    this.task = null; this.pool = new Map();
    document.querySelectorAll('[data-icon]').forEach(e => { e.innerHTML = ICON[e.dataset.icon] || ''; });
    document.querySelectorAll('#cmdbar button').forEach(b => { const go = e => { e.preventDefault(); e.stopPropagation(); this.press(b.dataset.cmd); }; b.addEventListener('click', go); b.addEventListener('touchstart', go, { passive: false }); });
    bus.on('key', k => { if (G.state !== 'play' || (G.tablet && G.tablet.open) || this.introOn) return;
      const m = { Digit1: 'spk', Digit2: 'lane', Digit3: 'flow', Digit4: 'med', Digit5: 'cover' }[k]; if (m) this.press(m);
      if ((k === 'Enter' || k === 'KeyF') && this.task && this.task.acts[0]) this.runAct(0); if (k === 'KeyG' && this.task && this.task.acts[1]) this.runAct(1); });
    const cv = $('c');
    cv.addEventListener('wheel', e => { if (!G.freeCursor || G.state !== 'play' || (G.gear && G.gear.bino)) return; e.preventDefault(); this.zoom = clamp((this.zoom || 1) * (e.deltaY > 0 ? 1 / 1.2 : 1.2), 1, 3.6); }, { passive: false });
    $('bIntro').addEventListener('click', () => this.closeIntro());
  }
  intro(done) { this.introOn = true; this._introDone = done; $('intro').hidden = false; G.freeCursor = true; }
  closeIntro() { if (!this.introOn) return; this.introOn = false; $('intro').hidden = true; const f = this._introDone; this._introDone = null; f && f(); }
  press(cmd) {
    if (G.state !== 'play' || this.introOn) return; const M = G.mission; if (!M.U) return;
    G.audio.playS('dry', { vol: .25, rate: 2 });
    if (cmd === 'spk') return this.say(M.order('spk'));
    if (cmd === 'lane') return this.say(M.order('cp', 'laneB'));
    if (cmd === 'flow') return this.say(M.order('cp', 'flow'));
    if (cmd === 'med') return this.say(M.order('med'));
    if (cmd === 'cover') return this.say(M.cover());
  }
  say(r) { if (typeof r === 'string') G.ui.toast(r); }
  // the old gas-aiming API is gone in this mission; the tablet calls endAim when it opens
  endAim() {}
  setTask(t) {
    const el = $('task'); this.task = t; if (!t) { el.hidden = true; return; } el.hidden = false;
    el.className = t.threat ? 'threat' : ''; $('taskK').textContent = t.kind || (t.threat ? 'איום' : 'משימה'); $('taskT').textContent = t.title; $('taskP').textContent = t.text;
    const box = $('taskA'); box.innerHTML = ''; (t.acts || []).forEach((a, i) => { const b = document.createElement('button'); b.className = a.cls || (i ? 'alt' : ''); b.innerHTML = (ICON[a.icon] || '') + `<span>${a.label}</span>` + (!G.isTouch && i < 2 ? `<kbd>${i ? 'G' : 'F'}</kbd>` : ''); b.onclick = e => { e.stopPropagation(); this.runAct(i); }; b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.runAct(i); }, { passive: false }); box.appendChild(b); });
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    document.querySelectorAll('#cmdbar button').forEach(b => b.classList.toggle('hot', !!t.hot && b.dataset.cmd === t.hot));
  }
  runAct(i) { const a = this.task && this.task.acts[i]; if (!a || G.state !== 'play') return; G.audio.playS('dry', { vol: .25, rate: 2 }); const r = a.fn(); this.say(r); if (G.mission.refreshTask) setTimeout(() => G.mission.refreshTask(), 120); }
  markers() {
    const box = $('wmarks'); const list = G.state === 'play' && !this.introOn ? G.mission.markers() : []; const cam = G.camera; const W = innerWidth, H = innerHeight; const seen = new Set();
    for (const m of list) {
      seen.add(m.id); let el = this.pool.get(m.id);
      if (!el) { el = document.createElement('div'); el.innerHTML = '<i></i><b></b><em></em>'; box.appendChild(el); this.pool.set(m.id, el); }
      el.className = 'wm ' + m.kind; const b = el.children[1], em = el.children[2]; if (b.textContent !== m.label) b.textContent = m.label;
      _v.set(m.pos.x, (m.pos.y || hC(m.pos.x, m.pos.z)) + (m.h ?? 2.3), m.pos.z); const dist = _v.distanceTo(cam.position); _v.project(cam);
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
    const M = G.mission; if (M && M.U) { const U = M.U; const set = (cmd, p, n, dis, lbl) => { const b = document.querySelector(`#cmdbar button[data-cmd="${cmd}"]`); if (!b) return; b.style.setProperty('--p', (clamp(p, 0, 1) * 100).toFixed(0) + '%'); const nn = b.querySelector('.n'); if (nn && nn.textContent !== String(n ?? '')) nn.textContent = n ?? ''; b.disabled = !!dis; if (lbl) { const s = b.querySelector('span'); if (s.textContent !== lbl) s.textContent = lbl; } };
      set('spk', U.spk.cd / 14, '', false);
      set('lane', 0, '', false, U.cp.laneB ? 'סגור נתיב 2' : 'פתח נתיב 2');
      set('flow', 0, '', false, { open: 'קצב: רגיל', slow: 'קצב: איטי', pause: 'קצב: עצירה' }[U.cp.flow]);
      set('med', U.med.busy ? 1 : 0, '', U.med.busy, U.med.busy ? 'חובשים בדרך' : 'חובשים');
      set('cover', 0, U.apcA.smoke, U.apcA.smoke <= 0 && U.apcA.pos === 'cover', 'עשן ושריון'); }
    if (G.player && !(G.gear && G.gear.bino)) { const z = this.zoom || 1; const f = (G.fovBase0 || 54) / z; if (Math.abs(G.player.fovBase - f) > .01) G.player.fovBase += (f - G.player.fovBase) * Math.min(1, dt * 10); }
    const sub = $('sub'), nt = $('notif'); if (sub && nt) { const on = sub.classList.contains('on') && sub.offsetTop < innerHeight * .4; const top = on ? sub.offsetTop + sub.offsetHeight + 6 : 0; const v = top ? top + 'px' : ''; if (nt.style.top !== v) nt.style.top = v; }
    this.markers();
  }
}
