// The incident commander's controls on the main screen:
// order buttons (loudspeaker, gas team, gas drone, snipers, slits), aiming gas with a ring on the ground,
// the "what now" task card with one-tap actions, and markers over threats and our own units.
import * as THREE from 'three';
import { G, clamp, V3, after, bus } from '../core.js';
import { Input } from '../player.js';
import { hF, FL } from './world.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export const ICON = {
  spk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 10v4h3l8 4.5V5.5L6 10H3z"/><path d="M17 9.2a4 4 0 0 1 0 5.6M19.6 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>',
  gas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 20c2.2-6 6-9.6 10.5-10.6" stroke-dasharray="2 2.6"/><circle cx="17" cy="9" r="3.2"/><circle cx="20.2" cy="13" r="2.3"/><circle cx="14.4" cy="13.2" r="2.3"/></svg>',
  drone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5.5" cy="5.5" r="2.6"/><circle cx="18.5" cy="5.5" r="2.6"/><circle cx="5.5" cy="18.5" r="2.6"/><circle cx="18.5" cy="18.5" r="2.6"/><path d="M7.5 7.5l2.6 2.6M16.5 7.5l-2.6 2.6M7.5 16.5l2.6-2.6M16.5 16.5l-2.6-2.6"/><rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1"/></svg>',
  snipers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 20h20"/><path d="M3.5 20c2.5-5.2 5-7.2 8.5-7.2s6 2 8.5 7.2"/><circle cx="12" cy="6.2" r="2.2"/><path d="M12 8.4v4.2M8 10.5l8-1.6"/></svg>',
  slits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3.5" width="18" height="17" rx="1"/><path d="M3 9.5h18M3 15.5h18" opacity=".45"/><rect x="8" y="11" width="8" height="3" fill="currentColor" stroke="none"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  res: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 15V9.5l2-3.5h9l2.5 3.5H21V15H3z"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/></svg>',
  air: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.5l1.6 6.5 7.9 4v2l-7.9-2-.6 5.5 2.5 2v1.5L12 21l-3.5 1v-1.5l2.5-2-.6-5.5-7.9 2v-2l7.9-4z"/></svg>',
  tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M10 18.5h4"/></svg>',
  rifle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
};

export class Command {
  constructor() {
    this.aim = null; this.mouse = null; this.task = null; this.pool = new Map();
    // ground reticle for gas: a flat ring, a glowing curtain around it and a tall beacon, so it reads even at the low angle from the berm
    const grad = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.6, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const mk = (geo, op, map = null) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#f2b84b', map, transparent: true, opacity: op, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide })); m.renderOrder = 50; m.frustumCulled = false; return m; };
    const g = new THREE.Group();
    g.add(mk(new THREE.RingGeometry(.84, 1, 72).rotateX(-Math.PI / 2), .95), mk(new THREE.CircleGeometry(.84, 48).rotateX(-Math.PI / 2), .16));
    g.add(mk(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true).translate(0, .5, 0), .6, grad));
    const stalk = mk(new THREE.CylinderGeometry(.5, .5, 1, 10, 1, true).translate(0, .5, 0), .9, grad); g.add(stalk); this.stalk = stalk;
    g.visible = false; G.scene.add(g); this.ring = g; this.ringMats = g.children.map(c => c.material);
    this.pulses = [];
    document.querySelectorAll('[data-icon]').forEach(e => { e.innerHTML = ICON[e.dataset.icon] || ''; });
    // order buttons
    document.querySelectorAll('#cmdbar button').forEach(b => { const go = e => { e.preventDefault(); e.stopPropagation(); this.press(b.dataset.cmd); }; b.addEventListener('click', go); b.addEventListener('touchstart', go, { passive: false }); });
    const btn = (id, f) => { const b = $(id); b.addEventListener('click', e => { e.stopPropagation(); f(); }); b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); f(); }, { passive: false }); };
    btn('aimGo', () => this.fire()); btn('aimX', () => this.endAim());
    bus.on('key', k => { if (G.state !== 'play' || (G.tablet && G.tablet.open) || this.introOn) return;
      const m = { Digit1: 'spk', Digit2: 'gas', Digit3: 'drone', Digit4: 'snipers', Digit5: 'slits' }[k]; if (m) this.press(m);
      if (k === 'Escape' && this.aim) this.endAim(); if ((k === 'Enter' || k === 'KeyF') && this.task && this.task.acts[0]) this.runAct(0); if (k === 'KeyG' && this.task && this.task.acts[1]) this.runAct(1); });
    // desktop: free cursor while commanding. Drag turns the view, a click on the ground fires the aimed gas, the wheel zooms
    const cv = $('c'); let down = null;
    cv.addEventListener('mousemove', e => { this.mouse = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('mouseleave', () => { this.mouse = null; });
    cv.addEventListener('mousedown', e => { if (G.freeCursor) down = { x: e.clientX, y: e.clientY, b: e.button }; });
    addEventListener('mouseup', e => { if (!down) return; const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6; const b = down.b; down = null; if (!click || !G.freeCursor || G.state !== 'play') return; if (this.aim) { if (b === 2) this.endAim(); else { this.aim.lock = null; this.pickScreen(e.clientX, e.clientY, true); } } });
    cv.addEventListener('wheel', e => { if (!G.freeCursor || G.state !== 'play' || (G.gear && G.gear.bino)) return; e.preventDefault(); this.zoom = clamp((this.zoom || 1) * (e.deltaY > 0 ? 1 / 1.2 : 1.2), 1, 3.2); }, { passive: false });
    // touch: a quick tap on the scene (look area) sets the aim point
    const zone = $('lookzone'); const taps = new Map();
    zone.addEventListener('touchstart', e => { for (const t of e.changedTouches) taps.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 }); }, { passive: true });
    zone.addEventListener('touchmove', e => { for (const t of e.changedTouches) { const s = taps.get(t.identifier); if (s) s.moved = Math.max(s.moved, Math.hypot(t.clientX - s.x, t.clientY - s.y)); } }, { passive: true });
    zone.addEventListener('touchend', e => { for (const t of e.changedTouches) { const s = taps.get(t.identifier); taps.delete(t.identifier); if (s && s.moved < 12 && performance.now() - s.t < 350 && this.aim && s.x > innerWidth * .3) this.pickScreen(s.x, s.y, false); } }, { passive: true });
    $('bIntro').addEventListener('click', () => this.closeIntro());
  }
  // ---------- intro ----------
  intro(done) { this.introOn = true; this._introDone = done; $('intro').hidden = false; G.freeCursor = true; }
  closeIntro() { if (!this.introOn) return; this.introOn = false; $('intro').hidden = true; const f = this._introDone; this._introDone = null; f && f(); }
  // ---------- orders from the bar ----------
  press(cmd) {
    if (G.state !== 'play' || this.introOn) return; const M = G.mission; if (!M.U) return;
    G.audio.playS('dry', { vol: .25, rate: 2 });
    if (cmd === 'spk') return this.say(M.order('spk'));
    if (cmd === 'gas' || cmd === 'drone') { if (this.aim && this.aim.kind === cmd) return this.endAim(); return this.startAim(cmd); }
    if (cmd === 'snipers') return this.say(M.orderSnipers());
    if (cmd === 'slits') return this.say(M.orderSlits());
  }
  say(r) { if (typeof r === 'string') G.ui.toast(r); }
  // ---------- aiming gas on the ground ----------
  startAim(kind, preset = null) {
    const M = G.mission; const u = M.U[kind];
    if (kind === 'gas' && (u.ammo <= 0)) return G.ui.toast('נגמרו רימוני הגז לצוות');
    if (kind === 'drone' && u.sorties <= 0) return G.ui.toast('לרחפן לא נשארו גיחות');
    this.aim = { kind, lock: preset ? preset.clone() : null, p: null, ok: false };
    document.querySelectorAll('#cmdbar button').forEach(b => b.classList.toggle('on', b.dataset.cmd === kind));
    $('aimbar').classList.add('on'); $('aimGo').innerHTML = (kind === 'gas' ? ICON.gas : ICON.drone) + (kind === 'gas' ? 'ירה גז' : 'שלח רחפן');
    this.ring.visible = true; document.body.classList.add('aiming');
  }
  endAim() { this.aim = null; this.ring.visible = false; $('aimbar').classList.remove('on'); document.body.classList.remove('aiming'); document.querySelectorAll('#cmdbar button').forEach(b => b.classList.remove('on')); }
  pickScreen(sx, sy, fire) {
    const cam = G.camera; const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); cam.updateMatrixWorld(); rc.setFromCamera(ndc, cam); const p = this.groundHit(rc.ray.origin, rc.ray.direction);
    if (!p) return G.ui.toast('כוון אל הקרקע בצד של עזה');
    this.aim.lock = p; this.evalAim(); if (fire) this.fire();
  }
  groundHit(o, d) {
    if (d.y > .02) return null; let t = 1, prev = 1;
    for (let i = 0; i < 400 && t < 900; i++) { const x = o.x + d.x * t, z = o.z + d.z * t; if (o.y + d.y * t < hF(x, z)) { let a = prev, b = t; for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (o.y + d.y * m < hF(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; } const X = o.x + d.x * b, Z = o.z + d.z * b; return V3(X, hF(X, Z), Z); } prev = t; t += .8 + t * .012; }
    return null;
  }
  evalAim() {
    const a = this.aim; if (!a) return; const M = G.mission; const p = a.p = a.lock || a.hover; if (!p) { a.ok = false; a.msg = G.isTouch ? 'גע בשטח במקום שאליו לירות' : 'הזז את העכבר אל השטח'; return; }
    const from = a.kind === 'gas' ? M.gasFrom() : V3(FL.cp.x, 0, FL.cp.z); const d = Math.hypot(p.x - from.x, p.z - from.z); const rng = a.kind === 'gas' ? 170 : 460;
    const near = G.actors.some(x => x.friendly && x.alive && Math.hypot(x.pos.x - p.x, x.pos.z - p.z) < 13);
    a.ok = false; a.warn = false;
    if (p.x > -3) a.msg = 'היעד בצד שלנו של הקיר';
    else if (d > rng) a.msg = `מחוץ לטווח (${Math.round(d)} מ׳, מקסימום ${rng})`;
    else if (near) a.msg = 'קרוב מדי לכוחות שלנו';
    else { a.ok = true; a.dist = d; const n = G.crowd.near(p.x, p.z, 12).length; a.msg = `${Math.round(Math.hypot(p.x - G.player.pos.x, p.z - G.player.pos.z))} מ׳ · ${n ? n + ' אנשים באזור' : 'אין אנשים באזור'}`; if (p.x > -22) { a.warn = true; a.msg += ' · הרוח תסחף את הגז לקיר'; } }
  }
  fire() {
    const a = this.aim; if (!a) return; this.evalAim(); if (!a.ok) { G.ui.toast(a.msg); return; }
    const r = G.mission.order(a.kind, 'fire', a.p.clone()); if (typeof r === 'string') { G.ui.toast(r); return; }
    this.pulse(a.p, '#f2b84b', 13, 1.1); this.endAim();
  }
  // ---------- feedback rings on the ground (loudspeaker wave, gas target) ----------
  pulse(p, col, R, dur, y = .3) { const m = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .9, depthWrite: false, fog: false, side: THREE.DoubleSide })); m.position.set(p.x, (p.y || hF(p.x, p.z)) + y, p.z); m.renderOrder = 40; G.scene.add(m); this.pulses.push({ m, t: 0, R, dur }); }
  // ---------- the task card ----------
  setTask(t) {
    const el = $('task'); this.task = t; if (!t) { el.hidden = true; return; } el.hidden = false;
    el.className = t.threat ? 'threat' : ''; $('taskK').textContent = t.kind || (t.threat ? 'איום' : 'משימה'); $('taskT').textContent = t.title; $('taskP').textContent = t.text;
    const box = $('taskA'); box.innerHTML = ''; (t.acts || []).forEach((a, i) => { const b = document.createElement('button'); b.className = a.cls || (i ? 'alt' : ''); b.innerHTML = (ICON[a.icon] || '') + `<span>${a.label}</span>` + (!G.isTouch && i < 2 ? `<kbd>${i ? 'G' : 'F'}</kbd>` : ''); b.onclick = e => { e.stopPropagation(); this.runAct(i); }; b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.runAct(i); }, { passive: false }); box.appendChild(b); });
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    document.querySelectorAll('#cmdbar button').forEach(b => b.classList.toggle('hot', !!t.hot && b.dataset.cmd === t.hot));
  }
  runAct(i) { const a = this.task && this.task.acts[i]; if (!a || G.state !== 'play') return; G.audio.playS('dry', { vol: .25, rate: 2 }); const r = a.fn(); this.say(r); if (G.mission.refreshTask) setTimeout(() => G.mission.refreshTask(), 120); }
  // ---------- markers over people and places ----------
  markers() {
    const box = $('wmarks'); const list = G.state === 'play' && !this.introOn ? G.mission.markers() : []; const cam = G.camera; const W = innerWidth, H = innerHeight; const seen = new Set();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    for (const m of list) {
      seen.add(m.id); let el = this.pool.get(m.id);
      if (!el) { el = document.createElement('div'); el.innerHTML = '<i></i><b></b><em></em>'; box.appendChild(el); this.pool.set(m.id, el); }
      el.className = 'wm ' + m.kind; const b = el.children[1], em = el.children[2]; if (b.textContent !== m.label) b.textContent = m.label;
      _v.set(m.pos.x, (m.pos.y ?? hF(m.pos.x, m.pos.z)) + (m.h ?? 2.3), m.pos.z); const dist = _v.distanceTo(cam.position); _v.project(cam);
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
  // ---------- per frame ----------
  update(dt) {
    // cooldowns / counts on the bar
    const M = G.mission; if (M && M.U) { const U = M.U; const set = (cmd, p, n, dis, lbl) => { const b = document.querySelector(`#cmdbar button[data-cmd="${cmd}"]`); if (!b) return; b.style.setProperty('--p', (clamp(p, 0, 1) * 100).toFixed(0) + '%'); const nn = b.querySelector('.n'); if (nn && nn.textContent !== String(n ?? '')) nn.textContent = n ?? ''; b.disabled = !!dis; if (lbl) { const s = b.querySelector('span'); if (s.textContent !== lbl) s.textContent = lbl; } };
      set('spk', U.spk.cd / 22, '', false); set('gas', U.gas.cd / 9, U.gas.ammo, U.gas.ammo <= 0); set('drone', U.drone.cd / 30, U.drone.sorties, U.drone.sorties <= 0);
      const atWall = [U.snA, U.snB].some(u => u.pos === 'wall'); set('snipers', 0, '', false, atWall ? 'צלפים לסוללה' : 'צלפים לקיר');
      const shut = [U.snA, U.snB].every(u => u.shut); set('slits', 0, '', !atWall, shut ? 'פתח חרכים' : 'סגור חרכים'); }
    // aim ring
    const a = this.aim;
    if (a) { if (G.tablet && G.tablet.open) this.endAim(); else {
      if (!a.lock) { let sx = innerWidth / 2, sy = innerHeight / 2; if (G.freeCursor && !G.isTouch && this.mouse) { sx = this.mouse.x; sy = this.mouse.y; } const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1); const rc = this._rc || (this._rc = new THREE.Raycaster()); G.camera.updateMatrixWorld(); rc.setFromCamera(ndc, G.camera); a.hover = this.groundHit(rc.ray.origin, rc.ray.direction); }
      this.evalAim(); const p = a.p;
      if (p) { const R = 12; const dist = p.distanceTo(G.camera.position); this.ring.visible = true; this.ring.position.set(p.x, p.y + .15, p.z); this.ring.children[0].scale.setScalar(R); this.ring.children[1].scale.setScalar(R); this.ring.children[2].scale.set(R, 2 + dist * .03, R); this.stalk.scale.set(.25 + dist / 260, 7 + dist / 12, .25 + dist / 260);
        const col = !a.ok ? '#e0533d' : a.warn ? '#f2d04b' : '#f2b84b'; for (const m of this.ringMats) m.color.set(col); this.ringMats[0].opacity = .75 + .2 * Math.sin(G.time * 6); this.ringMats[2].opacity = .7 + .15 * Math.sin(G.time * 6); }
      else this.ring.visible = false;
      $('aimTxt').textContent = (a.kind === 'gas' ? 'צוות הגז · ' : 'רחפן הגז · ') + (a.msg || ''); $('aimbar').classList.toggle('bad', !a.ok); $('aimGo').disabled = !a.ok; } }
    for (let i = this.pulses.length - 1; i >= 0; i--) { const p = this.pulses[i]; p.t += dt; const k = p.t / p.dur; if (k >= 1) { G.scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); this.pulses.splice(i, 1); continue; } p.m.scale.setScalar(1 + p.R * k); p.m.material.opacity = .85 * (1 - k); }
    // wheel zoom while commanding
    if (G.player && !(G.gear && G.gear.bino)) { const z = this.zoom || 1; const f = (G.fovBase0 || 54) / z; if (Math.abs(G.player.fovBase - f) > .01) G.player.fovBase += (f - G.player.fovBase) * Math.min(1, dt * 10); }
    // radio subtitles and intel notifications stack at the top instead of overlapping
    const sub = $('sub'), nt = $('notif'); if (sub && nt) { const on = sub.classList.contains('on') && sub.offsetTop < innerHeight * .4; const top = on ? sub.offsetTop + sub.offsetHeight + 6 : 0; const v = top ? top + 'px' : ''; if (nt.style.top !== v) nt.style.top = v; }
    this.markers();
  }
}
