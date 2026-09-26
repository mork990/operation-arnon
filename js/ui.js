// HUD, menus, briefing map, subtitles, touch controls
import { G, bus, fmtClock, clamp } from './core.js';
import { Input } from './player.js';
import { LAYOUT } from './world.js';

const $ = id => document.getElementById(id);
export class UI {
  constructor() {
    this.el = { hud: $('hud'), obj: $('obj'), clock: $('clock'), ammo: $('ammo'), res: $('res'), hp: $('hpv'), vign: $('vign'), dmg: $('dmgarcs'), sub: $('sub'), subWho: $('subwho'), subTxt: $('subtxt'), prompt: $('prompt'), promptBar: $('promptbar'), promptTxt: $('prompttxt'), hit: $('hitm'), cross: $('cross'), flash: $('flash'), fade: $('fade'), toast: $('toast') };
    bus.on('sub', it => this.subtitle(it));
    bus.on('hitmarker', (kill, head) => { if (G.isTouch && navigator.vibrate) try { navigator.vibrate(kill ? 30 : 10); } catch (e) {} const h = this.el.hit; h.className = kill ? 'kill' : 'hit'; h.style.opacity = 1; clearTimeout(this._ht); this._ht = setTimeout(() => h.style.opacity = 0, kill ? 350 : 150); });
    this.objTxt = ''; this.toastT = null;
    if (G.isTouch) this.touch();
  }
  show(id, on = true) { $(id).hidden = !on; }
  setObjective(t, sub = '') { if (t === this.objTxt) return; this.objTxt = t; this.el.obj.innerHTML = `<b>${t}</b>${sub ? `<span>${sub}</span>` : ''}`; this.el.obj.classList.remove('pulse'); void this.el.obj.offsetWidth; this.el.obj.classList.add('pulse'); }
  toast(t, cls = '') { const e = this.el.toast; e.textContent = t; e.className = 'show ' + cls; clearTimeout(this.toastT); this.toastT = setTimeout(() => e.className = '', 3200); }
  subtitle(it) {
    const s = this.el.sub; if (!it || !G.settings.subtitles) { s.classList.remove('on'); return; }
    this.el.subWho.textContent = it.speaker.name; this.el.subWho.style.color = it.speaker.color || ''; this.el.subTxt.textContent = it.text; s.classList.toggle('radio', !!it.radio); s.classList.add('on');
  }
  flash(v) { this.el.flash.style.transition = 'none'; this.el.flash.style.opacity = v; requestAnimationFrame(() => { this.el.flash.style.transition = 'opacity 2.6s ease-out'; this.el.flash.style.opacity = 0; }); }
  fadeTo(v, sec = .8) { return new Promise(res => { const f = this.el.fade; f.style.transition = `opacity ${sec}s`; f.style.opacity = v; setTimeout(res, sec * 1000); }); }
  prompt(label, prog) { const p = this.el.prompt; if (!label) { p.classList.remove('on'); return; } p.classList.add('on'); this.el.promptTxt.textContent = label; this.el.promptBar.style.width = (prog * 100).toFixed(0) + '%'; if (this.btnUse) this.btnUse.hidden = false; }
  update(dt) {
    if (this.touchEl) { const on = G.state === 'play' && !(G.tablet && G.tablet.open); if (this.touchEl.hidden === on) this.touchEl.hidden = !on; }
    const p = G.player, w = G.weapon; if (!p || !w) return;
    this.el.clock.textContent = fmtClock(G.missionClock);
    this.el.ammo.textContent = w.reloading > 0 ? '––' : String(w.mag).padStart(2, '0'); this.el.res.textContent = w.reserve;
    this.el.ammo.classList.toggle('low', w.mag <= 8);
    const hp = p.health / 100; this.el.hp.style.transform = `scaleX(${hp})`; this.el.hp.parentElement.classList.toggle('crit', hp < .35);
    this.el.vign.style.opacity = clamp((1 - hp) * 1.2 + p.suppression * .4, 0, 1);
    const bl = document.getElementById('blood'); if (bl) bl.style.opacity = clamp((p.bloodT || 0) * .8 + (1 - hp) * .35, 0, .95).toFixed(2);
    const am = document.getElementById('ammowarn'); if (am) { const msg = w.reloading > 0 ? '' : w.mag === 0 && w.reserve === 0 ? 'אין תחמושת · קח מחסניות מחבר צוות' : w.mag === 0 ? (G.isTouch ? 'לחץ טעינה' : 'R לטעינה') : w.mag <= 5 ? 'מחסנית כמעט ריקה' : ''; if (am.textContent !== msg) am.textContent = msg; }
    // damage direction arcs
    const arcs = p.hurtDir.map(h => `<i style="transform:rotate(${(-h.a * 180 / Math.PI).toFixed(0)}deg);opacity:${Math.min(1, h.t).toFixed(2)}"></i>`).join('');
    if (arcs !== this._arcs) { this.el.dmg.innerHTML = arcs; this._arcs = arcs; }
    // crosshair spread
    const sp = 10 + w.spread * 900 + Math.hypot(p.vel.x, p.vel.z) * 4; this.el.cross.style.setProperty('--gap', sp.toFixed(1) + 'px'); this.el.cross.style.opacity = w.ads > .6 || !w.enabled ? 0 : 1;
  }
  // ---------- briefing map ----------
  drawMap(canvas, t = 1, focus = 0) {
    const g = canvas.getContext('2d'); const W = canvas.width, H = canvas.height; const L = LAYOUT;
    const X0 = -390, X1 = 220, Z0 = -120, Z1 = 120; const sx = x => (1 - (x - X0) / (X1 - X0)) * W, sz = z => (z - Z0) / (Z1 - Z0) * H; // east on the left? keep west on the right for RTL reading? no: north up, east right
    const px = x => (x - X0) / (X1 - X0) * W;
    g.fillStyle = '#1c1d18'; g.fillRect(0, 0, W, H);
    // sea & beach
    g.fillStyle = '#16262b'; g.fillRect(0, 0, px(L.shoreX), H); g.fillStyle = '#3a3526'; g.fillRect(px(L.shoreX), 0, px(L.beachX) - px(L.shoreX), H);
    // blocks (dense)
    g.fillStyle = '#2c2c24'; g.fillRect(px(-282), 0, px(250) - px(-282), H);
    // streets
    g.fillStyle = '#4a4636'; g.fillRect(px(L.market.x0), sz(L.market.z0), px(L.market.x1) - px(L.market.x0), sz(L.market.z1) - sz(L.market.z0));
    g.fillStyle = '#3b3829'; for (const c of L.cross) g.fillRect(px(c - L.crossW / 2), 0, px(c + L.crossW / 2) - px(c - L.crossW / 2), H); for (const c of L.lanes) g.fillRect(px(-282), sz(c - L.laneW / 2), px(250) - px(-282), sz(c + L.laneW / 2) - sz(c - L.laneW / 2));
    g.fillStyle = '#56503b'; g.fillRect(px(L.coast.x - L.coast.w / 2), 0, px(L.coast.x + L.coast.w / 2) - px(L.coast.x - L.coast.w / 2), H);
    // grid
    g.strokeStyle = 'rgba(232,220,196,.07)'; g.lineWidth = 1; for (let x = -400; x < 240; x += 50) { g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), H); g.stroke(); } for (let z = -100; z <= 100; z += 50) { g.beginPath(); g.moveTo(0, sz(z)); g.lineTo(W, sz(z)); g.stroke(); }
    // targets
    const mark = (x, z, label, col, pulse) => { const X = px(x), Y = sz(z); g.strokeStyle = col; g.lineWidth = 2; const r = 10 + (pulse ? Math.sin(performance.now() / 200) * 2 : 0); g.beginPath(); g.arc(X, Y, r, 0, 7); g.stroke(); g.beginPath(); g.moveTo(X - r - 6, Y); g.lineTo(X - r + 3, Y); g.moveTo(X + r - 3, Y); g.lineTo(X + r + 6, Y); g.moveTo(X, Y - r - 6); g.lineTo(X, Y - r + 3); g.moveTo(X, Y + r - 3); g.lineTo(X, Y + r + 6); g.stroke();
      g.fillStyle = col; g.font = '700 15px Heebo, sans-serif'; g.textAlign = 'center'; g.fillText(label, X, Y - r - 12); };
    const route = (pts, col, prog) => { g.strokeStyle = col; g.lineWidth = 3; g.setLineDash([8, 6]); g.beginPath(); const n = Math.max(2, Math.floor(pts.length * prog)); pts.slice(0, n).forEach((p, i) => i ? g.lineTo(px(p[0]), sz(p[1])) : g.moveTo(px(p[0]), sz(p[1]))); g.stroke(); g.setLineDash([]); };
    if (focus >= 1) route([[210, -1.5], [150, -1.5], [100, -1.5], [48, -1.5]], '#e8dcc4', clamp(t, 0, 1));
    if (focus >= 1) mark(40, -13, 'ספיר', '#f2b84b', focus === 2);
    if (focus >= 1) mark(L.alpha.x, L.alpha.z + 3, 'יהלום', '#9ac0e6', focus === 1);
    if (focus >= 3) { route([[48, 0], [-58, 0]], '#f2b84b', 1); route([[-58, 0], [-200, 0], [-290, 0], [-330, 18], [L.lz.x, L.lz.z]], '#7fb07a', clamp(t, 0, 1)); mark(L.lz.x, L.lz.z, 'נ.א. חוף', '#7fb07a', focus === 3); }
    g.fillStyle = 'rgba(232,220,196,.55)'; g.font = '500 12px "IBM Plex Mono", monospace'; g.textAlign = 'left'; g.fillText('N ↑', 12, 20); g.fillText('0      100m', 12, H - 12); g.fillRect(12, H - 26, px(100) - px(0), 2);
    g.textAlign = 'right'; g.fillText('הים התיכון', px(L.shoreX) - 8, 20); g.fillText('רח׳ א־רשיד', px(L.coast.x) - 8, H - 12); g.textAlign = 'center'; g.fillText('שוק נוסייראת', px(80), sz(L.market.z1) + 16);
  }
  // ---------- touch controls ----------
  touch() {
    document.body.classList.add('touch');
    const tc = $('touch'); this.touchEl = tc;
    const stick = $('stick'), knob = $('knob'); let sid = null, sx = 0, sy = 0; let lid = null, lx = 0, ly = 0;
    const zone = $('lookzone');
    // look: touch-drag with mild acceleration so small corrections are precise and big swipes turn fast
    const look = (dx, dy) => { const k = 1.55 * (1 + Math.min(1.6, Math.hypot(dx, dy) * .045)); Input.mdx += dx * k; Input.mdy += dy * k; };
    const R = 58;
    const onStart = e => { for (const t of e.changedTouches) { if (t.clientX < innerWidth * .45 && sid === null) { sid = t.identifier; sx = t.clientX; sy = t.clientY; stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; stick.classList.add('on'); } else if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } } e.preventDefault(); };
    const onMove = e => { for (const t of e.changedTouches) {
      if (t.identifier === sid) { let dx = t.clientX - sx, dy = t.clientY - sy; const L = Math.hypot(dx, dy);
        if (L > R * 1.6) { sx += dx * (1 - R * 1.6 / L); sy += dy * (1 - R * 1.6 / L); stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; dx = t.clientX - sx; dy = t.clientY - sy; } // stick follows the thumb
        const L2 = Math.hypot(dx, dy); const cx = L2 > R ? dx * R / L2 : dx, cy = L2 > R ? dy * R / L2 : dy; const dead = L2 < 6 ? 0 : 1;
        Input.move.set(cx / R * dead, cy / R * dead); Input.sprint = L2 > R * 1.15 && dy < -R * .7; knob.style.transform = `translate(${cx}px,${cy}px)`; knob.style.background = Input.sprint ? 'rgba(242,184,75,.6)' : ''; }
      else if (t.identifier === lid) { look(t.clientX - lx, t.clientY - ly); lx = t.clientX; ly = t.clientY; } } e.preventDefault(); };
    const onEnd = e => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; Input.move.set(0, 0); Input.sprint = false; stick.classList.remove('on'); knob.style.transform = ''; knob.style.background = ''; } if (t.identifier === lid) lid = null; } };
    zone.addEventListener('touchstart', onStart, { passive: false }); zone.addEventListener('touchmove', onMove, { passive: false }); zone.addEventListener('touchend', onEnd); zone.addEventListener('touchcancel', onEnd);
    // buttons; both fire buttons also steer aim while held
    let firing = 0;
    const btn = (id, down, up, steer = false) => { const b = $(id); let bid = null, bx = 0, by = 0;
      b.addEventListener('touchstart', e => { const t = e.changedTouches[0]; bid = t.identifier; bx = t.clientX; by = t.clientY; b.classList.add('down'); down && down(); if (navigator.vibrate) try { navigator.vibrate(6); } catch (er) {} e.preventDefault(); e.stopPropagation(); }, { passive: false });
      b.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === bid && steer) { look(t.clientX - bx, t.clientY - by); bx = t.clientX; by = t.clientY; } e.preventDefault(); e.stopPropagation(); }, { passive: false });
      const end = e => { b.classList.remove('down'); up && up(); bid = null; e.preventDefault(); }; b.addEventListener('touchend', end); b.addEventListener('touchcancel', end); return b; };
    btn('bFire', () => { firing++; Input.fire = true; }, () => { firing = Math.max(0, firing - 1); Input.fire = firing > 0; }, true);
    btn('bFire2', () => { firing++; Input.fire = true; }, () => { firing = Math.max(0, firing - 1); Input.fire = firing > 0; }, true);
    btn('bAds', () => { Input.adsToggle = !Input.adsToggle; $('bAds').classList.toggle('lit', Input.adsToggle); });
    btn('bReload', () => Input.reloadReq = true);
    btn('bCrouch', () => { Input.crouchReq = true; setTimeout(() => $('bCrouch').classList.toggle('lit', !!(G.player && G.player.crouching)), 30); });
    this.btnUse = btn('bUse', () => Input.interact = true, () => Input.interact = false);
    // optional gyro aiming (rotation rate, works in either landscape direction)
    this.gyroOn = false;
    addEventListener('devicemotion', e => { if (!this.gyroOn || G.state !== 'play' || !e.rotationRate) return; const r = e.rotationRate; const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90; const sgn = ang === -90 || ang === 270 ? -1 : 1; const dt = (e.interval || 16) / 1000 * (e.interval > 1 ? 1 : 1000);
      Input.mdx += -(r.beta || 0) * sgn * dt * 9; Input.mdy += -(r.gamma || 0) * sgn * dt * 9; });
  }
  async enableGyro(on) {
    this.gyroOn = false; if (!on) return;
    try { if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) { const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') return; } this.gyroOn = true; } catch (e) {}
  }
}
