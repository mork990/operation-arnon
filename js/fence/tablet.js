// The incident commander's tablet: live drone feed (EO / thermal), tactical map, intel feed, forces and orders
import * as THREE from 'three';
import { G, clamp, lerp, V3, fmtClock, bus } from '../core.js';
import { Input } from '../player.js';
import { FL, hF } from './world.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3(), _ray = new THREE.Ray();

export class Tablet {
  constructor() {
    this.el = $('tablet'); this.open = false; this.tab = 'drone'; this.marks = []; this.sel = null; this.pick = null; this.unread = 0; this.firstOpen = true;
    const cam = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 4, 6000);
    G.drone = { cam, active: false, ir: false, target: V3(-40, 3, 0), fov: 15, fovT: 15, ang: -2.25, alt: 150, rad: 175, track: null, pos: new THREE.Vector3() };
    // keyboard
    bus.on('key', k => { if (G.state !== 'play') return; if (k === 'KeyT' || k === 'Tab') this.toggle(); if (this.open && k === 'Escape') this.close(); });
    addEventListener('keydown', e => { if (e.code === 'Tab' && G.state === 'play') e.preventDefault(); });
    $('bTablet').addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    $('bTablet').addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
    $('tbClose').addEventListener('click', () => this.close());
    document.querySelectorAll('.tb-tabs button').forEach(b => b.addEventListener('click', () => this.show(b.dataset.tab)));
    // drone feed input: drag = pan, tap = select person / pick point, wheel / pinch = zoom
    const feed = $('tb-drone'); const ptrs = new Map(); let drag = null, pinch = null;
    feed.addEventListener('pointerdown', e => { if (e.target.closest('button,#tgtInfo')) return; feed.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false }; else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: G.drone.fovT }; drag = null; } });
    feed.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); G.drone.fovT = clamp(pinch.fov * pinch.d / Math.max(20, d), 1.1, 34); return; }
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 9) drag.moved = true; if (drag.moved) this.panBy(dx, dy); } });
    const up = e => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (drag && !drag.moved && ptrs.size === 0) this.tap(e.clientX, e.clientY); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) drag = null; };
    feed.addEventListener('pointerup', up); feed.addEventListener('pointercancel', up);
    feed.addEventListener('wheel', e => { e.preventDefault(); G.drone.fovT = clamp(G.drone.fovT * (e.deltaY > 0 ? 1.18 : 1 / 1.18), 1.1, 34); }, { passive: false });
    $('bIR').addEventListener('click', () => { G.drone.ir = !G.drone.ir; });
    $('bZin').addEventListener('click', () => { G.drone.fovT = clamp(G.drone.fovT / 1.6, 1.1, 34); });
    $('bZout').addEventListener('click', () => { G.drone.fovT = clamp(G.drone.fovT * 1.6, 1.1, 34); });
    $('bTrack').addEventListener('click', () => { if (G.drone.track) G.drone.track = null; else if (this.sel) G.drone.track = this.sel.obj; else this.flash('סמן קודם אדם'); });
    $('bHome').addEventListener('click', () => { G.drone.track = null; G.drone.target.set(-30, 2, 0); G.drone.fovT = 15; });
    // map: tap = pick point / select mark / move the drone there
    const mc = $('tmap');
    mc.addEventListener('pointerup', e => { const r = mc.getBoundingClientRect(); const M = G.mission._map; if (!M) return; const sx = (e.clientX - r.left) / r.width * M.W, sy = (e.clientY - r.top) / r.height * M.H; const x = M.x0 + sx / M.W * (M.x1 - M.x0), z = M.z0 + sy / M.H * M.span; const p = V3(x, hF(x, z), z);
      if (this.pick) { this.pickDone(p); return; }
      let best = null, bd = 18; for (const m of this.marks) { const q = G.mission.posOf(m.obj); const d = Math.hypot((q.x - M.x0) / (M.x1 - M.x0) * M.W - sx, (q.z - M.z0) / M.span * M.H - sy); if (d < bd) { bd = d; best = m; } }
      if (best) { this.select(best); this.show('drone'); G.drone.target.copy(G.mission.posOf(best.obj)); } else { G.drone.target.copy(p); this.flash('הרחפן מכוון לנקודה. פתח את לשונית "רחפן"'); } });
    $('pickCancel').addEventListener('click', () => this.pickEnd());
    $('cfmNo').addEventListener('click', () => { $('cfm').classList.remove('on'); this._cfm = null; });
    $('cfmYes').addEventListener('click', () => { const f = this._cfm; $('cfm').classList.remove('on'); this._cfm = null; f && f(); });
    this.statusT = 0; this.mapT = 0;
  }
  // ---------- open / close ----------
  toggle() { this.open ? this.close() : this.show(this.tab); }
  show(tab) {
    if (G.state !== 'play') return;
    if (!this.open) { this.open = true; this.el.hidden = false; document.body.classList.add('tabopen'); $('touch').hidden = true; Input.fire = false; Input.move.set(0, 0); G.noPauseOnUnlock = true; document.exitPointerLock && document.exitPointerLock(); setTimeout(() => { G.noPauseOnUnlock = false; }, 300); G.audio.playS('dry', { vol: .3, rate: 1.8 }); if (this.firstOpen) { this.firstOpen = false; G.mission.onTabletFirst && G.mission.onTabletFirst(); } }
    this.tab = tab; document.querySelectorAll('.tb-tabs button').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); if (on) b.classList.remove('unread'); });
    for (const p of ['drone', 'map', 'intel', 'forces']) $('tb-' + p).classList.toggle('on', p === tab);
    G.drone.active = tab === 'drone';
    if (tab === 'intel') { this.unread = 0; this.badge(); for (const it of G.mission.intel) it.isNew = false; setTimeout(() => this.renderIntel(), 1500); this.renderIntel(true); }
    if (tab === 'forces') this.renderUnits();
    if (tab === 'map') this.resizeMap();
  }
  close() { if (!this.open) return; this.open = false; this.el.hidden = true; document.body.classList.remove('tabopen'); G.drone.active = false; this.pickEnd(); $('cfm').classList.remove('on'); if (G.state === 'play') { if (G.isTouch) $('touch').hidden = false; G.lock && G.lock(); } }
  // ---------- drone ----------
  panBy(dx, dy) { const d = G.drone; d.track = null; const k = Math.tan(THREE.MathUtils.degToRad(d.fov / 2)) * d.cam.position.distanceTo(d.target) * 2 / innerHeight; const cam = d.cam;
    const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion); right.y = 0; right.normalize(); const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0; fwd.normalize();
    d.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k * 1.4); d.target.x = clamp(d.target.x, -700, 200); d.target.z = clamp(d.target.z, -700, 700); d.target.y = hF(d.target.x, d.target.z); }
  groundAt(sx, sy) {
    const cam = G.drone.cam; const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, cam); _ray.copy(rc.ray);
    const h = G.bvhMesh.geometry.boundsTree.raycastFirst(_ray, THREE.DoubleSide); if (h) return h.point.clone();
    const t = (hF(-200, 0) - _ray.origin.y) / _ray.direction.y; return t > 0 ? _ray.origin.clone().addScaledVector(_ray.direction, t) : null;
  }
  tap(sx, sy) {
    if (this.pick) { const p = this.groundAt(sx, sy); if (p) this.pickDone(p); return; }
    const cam = G.drone.cam; let best = null, bd = G.isTouch ? 34 : 24;
    const test = (obj, p) => { _v.copy(p); _v.y += 1; _v.project(cam); if (_v.z > 1) return; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight; const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = obj; } };
    for (const a of G.actors) if (a.alive && !a.removed && !(a.noTag && a.friendly)) test(a, a.pos);
    for (const a of G.crowd.agents) if (a.alive) test(a, _v.set(a.x, a.y, a.z).clone());
    if (!best) { this.select(null); const p = this.groundAt(sx, sy); if (p) { G.drone.target.lerp(p, .5); } return; }
    // crowd agents become full characters once the commander picks them out
    if (!best.root) { const act = G.mission.promote(best); if (act) { act.role = best.breacher ? 'breacher' : 'crowd'; act.brain = G.mission.roleBrain(act); act.plan = []; act.idleAnim = 'm_cheer_03'; best = act; } }
    this.mark(best, true);
  }
  mark(obj, select = false) {
    let m = this.marks.find(m => m.obj === obj);
    if (!m) { const info = G.mission.identify(obj); if (info.unit) { this.flash(info.name); return; } m = { obj, n: ++this.markN || (this.markN = 1), threat: info.threat }; m.label = `יעד ${m.n}`; this.marks.push(m); if (this.marks.length > 6) this.marks.shift(); G.audio.playS('dry', { vol: .25, rate: 2.2 }); }
    if (select) this.select(m);
  }
  select(m) { this.sel = m; const ti = $('tgtInfo'); if (!m) { ti.classList.remove('on'); return; } ti.classList.add('on'); this.renderTarget(); }
  selected() { return this.sel ? this.sel.obj : null; }
  renderTarget() {
    const m = this.sel; if (!m) return; const o = m.obj; const info = G.mission.identify(o); m.threat = info.threat; const alive = o.root ? o.alive && !o.removed : o.alive;
    $('tgtInfo').classList.toggle('threat', info.threat); $('tgtName').textContent = `${m.label} · ${info.name}${!alive ? ' · לא בשטח' : o.down ? ' · פצוע' : ''}`; $('tgtDesc').textContent = info.desc;
    const U = G.mission.U; const acts = [];
    acts.push({ l: G.drone.track === o ? 'הפסק מעקב' : 'עקוב', f: () => { G.drone.track = G.drone.track === o ? null : o; this.renderTarget(); } });
    acts.push({ l: 'גז לכאן (צוות)', c: 'go', dis: U.gas.cd > 0 || U.gas.ammo <= 0, f: () => G.mission.order('gas', 'fire', G.mission.posOf(o).clone()) });
    acts.push({ l: 'גז מהרחפן', c: 'go', dis: U.drone.cd > 0 || U.drone.sorties <= 0, f: () => G.mission.order('drone', 'fire', G.mission.posOf(o).clone()) });
    const sn = [U.snA, U.snB].filter(u => u.actors.some(a => a.alive && !a.down && !a.path)); const u = sn.find(u => u.pos === 'berm') || sn[0];
    if (u) { acts.push({ l: `רוגר לרגליים (${u.ruger})`, dis: u.ruger <= 0, f: () => G.mission.order(u.id, 'ruger', o) }); acts.push({ l: 'ירי חי', c: 'danger', f: () => G.mission.order(u.id, 'live', o) }); }
    if (G.mission.balloonCell && G.mission.balloonCell.includes(o)) acts.push({ l: 'תקיפת כטב״ם', c: 'danger', f: () => G.mission.order('air', 'cell') });
    acts.push({ l: 'בטל סימון', f: () => { this.marks = this.marks.filter(x => x !== m); if (G.drone.track === o) G.drone.track = null; this.select(null); } });
    const box = $('tgtActs'); box.innerHTML = ''; for (const a of acts) { const b = document.createElement('button'); b.textContent = a.l; if (a.c) b.className = a.c; b.disabled = !!a.dis || !alive; b.onclick = e => { e.stopPropagation(); const r = a.f(); if (typeof r === 'string') this.flash(r); setTimeout(() => this.renderTarget(), 50); }; box.appendChild(b); }
  }
  // ---------- pick a point (gas etc.) ----------
  startPick(label, fn) { this.pick = fn; $('pickTxt').textContent = label; $('pickBar').classList.add('on'); if (this.tab !== 'drone' && this.tab !== 'map') this.show('drone'); this.hint('גע בנקודה ברחפן או במפה'); }
  pickDone(p) { const f = this.pick; this.pickEnd(); f && f(p); this.renderUnits(); }
  pickEnd() { this.pick = null; $('pickBar').classList.remove('on'); }
  confirm(h, p, yes, danger = false) { $('cfmH').textContent = h; $('cfmP').textContent = p; const y = $('cfmYes'); y.className = danger ? 'danger' : 'go'; y.textContent = danger ? 'אשר ביצוע' : 'אשר'; this._cfm = yes; $('cfm').classList.add('on'); if (!this.open) this.show(this.tab); }
  flash(t) { this.hint(t); G.ui.toast(t); }
  hint(t) { const h = $('feedHint'); h.textContent = t; h.classList.add('on'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('on'), 2600); }
  toast(h, t, red) { if (this.open) this.hint(h); }
  // ---------- intel ----------
  onIntel(it) { this.unread++; this.badge(); if (this.open && this.tab === 'intel') this.renderIntel(); document.querySelector('.tb-tabs button[data-tab="intel"]').classList.toggle('unread', !(this.open && this.tab === 'intel')); }
  badge() { const b = $('bTablet'); $('tbBadge').textContent = this.unread; b.classList.toggle('unread', this.unread > 0); }
  renderIntel(keepNew) {
    const ol = $('intelList'); ol.innerHTML = '';
    if (!G.mission.intel.length) { ol.innerHTML = '<li><p>אין עדיין דיווחים. דיווחי מודיעין ותצפית יופיעו כאן.</p></li>'; return; }
    for (const it of G.mission.intel) { const li = document.createElement('li'); li.className = (it.red ? 'red ' : '') + (it.isNew && keepNew ? 'new' : ''); li.innerHTML = `<div class="h"><b>${it.from}</b><span>${fmtClock(it.t).slice(0, 5)}</span></div><p>${it.text}</p>`; if (it.go) { const b = document.createElement('button'); b.className = 'go'; b.textContent = it.go.label; b.onclick = () => it.go.fn(); li.appendChild(b); } ol.appendChild(li); }
  }
  // ---------- forces ----------
  renderUnits() {
    const M = G.mission; const box = $('unitList'); box.innerHTML = '';
    const roe = document.createElement('div'); roe.className = 'roe'; roe.innerHTML = '<b>הוראות פתיחה באש:</b> ירי חי רק מול אדם חמוש. רוגר לרגליים רק נגד מסית או חבלן. קודם כריזה, גז ומרחק. <b>הרוח</b> נושבת ממערב ומחזירה גז אלינו.'; box.appendChild(roe);
    const card = (u, st, acts, cls = '') => { const d = document.createElement('div'); d.className = 'ucard'; d.innerHTML = `<h4>${u.name}<small>${u.sub || ''}</small></h4><div class="st ${cls}">${st}</div>`; const a = document.createElement('div'); a.className = 'acts'; for (const x of acts) { const b = document.createElement('button'); b.textContent = x.l; if (x.c) b.className = x.c; b.disabled = !!x.dis; b.onclick = () => { const r = x.f(); if (typeof r === 'string') this.flash(r); setTimeout(() => this.renderUnits(), 80); }; a.appendChild(b); } d.appendChild(a); box.appendChild(d); };
    const sp = M.U.spk; card(sp, sp.cd > 0 ? `הודעה בשידור… (${Math.ceil(sp.cd)} ש׳)` : 'מוכן', [{ l: 'כריזה: "התרחקו מהגדר"', c: 'go', dis: sp.cd > 0, f: () => M.order('spk') }]);
    const gas = M.U.gas; card(gas, gas.cd > 0 ? `טוען… (${Math.ceil(gas.cd)} ש׳) · ${gas.ammo} מטחים` : `מוכן · ${gas.ammo} מטחים · טווח 170 מ׳`, [{ l: 'ירי גז לנקודה', c: 'go', dis: gas.cd > 0 || gas.ammo <= 0, f: () => this.startPick('גע בנקודה לירי גז', p => M.order('gas', 'fire', p)) }]);
    const dr = M.U.drone; card(dr, dr.cd > 0 ? `בגיחה… (${Math.ceil(dr.cd)} ש׳) · ${dr.sorties} גיחות` : `מוכן · ${dr.sorties} גיחות · טווח 450 מ׳`, [{ l: 'הטלת גז בנקודה', c: 'go', dis: dr.cd > 0 || dr.sorties <= 0, f: () => this.startPick('גע בנקודה להטלת גז', p => M.order('drone', 'fire', p)) }]);
    for (const u of [M.U.snA, M.U.snB]) { const moving = u.actors.some(a => a.path); const hurt = u.actors.some(a => a.down || !a.alive);
      card(u, hurt ? 'לוחם פצוע!' : moving ? 'בתנועה…' : u.pos === 'wall' ? (u.shut ? 'בקיר · החרכים סגורים' : 'צמודים לחרכים בקיר') : 'על הסוללה, 24 מ׳ מהקיר', [
        { l: u.pos === 'wall' ? 'הרחק לסוללה' : 'החזר לחרכים', c: u.pos === 'wall' ? 'go' : '', dis: moving, f: () => M.order(u.id, 'move') },
        { l: u.shut ? 'פתח חרכים' : 'סגור חרכים', dis: u.pos !== 'wall' || moving, f: () => M.order(u.id, 'shut') },
        { l: 'ירי אזהרה באוויר', dis: moving, f: () => M.order(u.id, 'warn') },
        { l: `רוגר ביעד מסומן (${u.ruger})`, dis: moving || u.ruger <= 0, f: () => M.order(u.id, 'ruger') },
        { l: 'ירי חי ביעד מסומן', c: 'danger', dis: moving, f: () => M.order(u.id, 'live') } ], hurt ? 'bad' : u.pos === 'wall' && !u.shut ? 'warn' : ''); }
    const rs = M.U.res; card(rs, rs.busy ? 'בפרצה' : M.breach ? 'פרצה בגדר! מוכן לצאת' : 'מוכן, ליד דרך הביטחון', [{ l: 'סגור פרצה ועצור חודרים', c: 'go', dis: rs.busy || !M.breach, f: () => M.order('res') }], M.breach && !rs.busy ? 'warn' : '');
    const tk = M.U.tank; card(tk, tk.cd > 0 ? 'טוען…' : 'בדיפונים, מכוונים לעמדות חמאס', (G.posts || []).map(p => ({ l: `ירי לעבר ${p.name}`, c: 'danger', dis: !p.alive || tk.cd > 0, f: () => M.order('tank', 'fire', p) })));
    const air = M.U.air; card(air, 'דרך האוגדה', [{ l: 'תקיפת מחסן נשק של חמאס', c: 'danger', f: () => M.order('air', 'depot') }, { l: 'תקיפת חוליית הבלונים', c: 'danger', dis: !(M.balloonCell && M.balloonCell.some(b => b.alive && !b.down)), f: () => M.order('air', 'cell') }]);
  }
  resizeMap() { const c = $('tmap'); const r = c.getBoundingClientRect(); const s = Math.min(2, devicePixelRatio || 1); c.width = Math.max(10, Math.round(r.width * s)); c.height = Math.max(10, Math.round(r.height * s)); }
  // ---------- per frame ----------
  update(dt) {
    const d = G.drone; if (!d) return;
    // orbit slowly around the look point (tracking a person if asked), always looking at it
    if (d.track) { const p = G.mission.posOf(d.track); if (p && (d.track.root ? d.track.alive !== false && !d.track.removed : d.track.alive)) d.target.lerp(V3(p.x, p.y, p.z), Math.min(1, dt * 3)); else d.track = null; }
    d.ang += dt * .012; d.fov = lerp(d.fov, d.fovT, Math.min(1, dt * 6));
    const cam = d.cam; cam.position.set(d.target.x + Math.cos(d.ang) * d.rad, d.target.y + d.alt, d.target.z + Math.sin(d.ang) * d.rad); cam.lookAt(d.target.x, d.target.y + 1, d.target.z);
    if (Math.abs(cam.fov - d.fov) > .01) { cam.fov = d.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld();
    if (!this.open) return;
    const now = G.missionClock;
    if (this.tab === 'drone') {
      // telemetry overlay
      const lat = 31.4700 - d.target.z / 111000, lon = 34.4760 + d.target.x / 94670; const slant = cam.position.distanceTo(d.target); const hdg = ((Math.atan2(d.target.x - cam.position.x, -(d.target.z - cam.position.z)) * 180 / Math.PI) + 360) % 360;
      $('fhTL').innerHTML = `<span class="rec">● REC</span> ${d.ir ? 'IR WHT' : 'EO DAY'}<br>SKYLARK · ${fmtClock(now)}`;
      $('fhTR').innerHTML = `ALT ${Math.round(d.alt + 90)}m AGL<br>SLR ${Math.round(slant)}m · HDG ${hdg.toFixed(0).padStart(3, '0')}<br>FOV ${d.fov.toFixed(1)}°`;
      $('fhBL').innerHTML = `TGT ${lat.toFixed(5)}N ${lon.toFixed(5)}E<br>${d.track ? 'TRACK' : 'MAN'} · WIND 270/${(G.wind.length() * 3.6).toFixed(0)}KM/H`;
      $('bIR').setAttribute('aria-pressed', d.ir); $('bTrack').setAttribute('aria-pressed', !!d.track);
      // mark boxes follow people
      const box = $('feedMarks'); let html = '';
      for (const m of this.marks) { const o = m.obj; const alive = o.root ? o.alive && !o.removed : o.alive; if (!alive) continue; const p = G.mission.posOf(o); _v.set(p.x, p.y + 1.9, p.z).project(cam); if (_v.z > 1) continue; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight;
        const hpx = Math.max(12, 1.9 / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.distanceTo(p) * 2) * innerHeight); const w = hpx * .55;
        html += `<div class="fmk${m.threat ? ' threat' : ''}${this.sel === m ? ' sel' : ''}" style="left:${x.toFixed(0)}px;top:${(y + hpx).toFixed(0)}px;width:${w.toFixed(0)}px;height:${hpx.toFixed(0)}px"><span>${m.label}</span></div>`; }
      // our forces are outlined in blue when zoomed in
      if (d.fov < 9) for (const a of G.actors) { if (!a.friendly || !a.alive || a.noTag) continue; _v.copy(a.pos); _v.y += 1.9; _v.project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight; const hpx = Math.max(10, 1.9 / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.distanceTo(a.pos) * 2) * innerHeight);
        html += `<div class="fmk unit" style="left:${x.toFixed(0)}px;top:${(y + hpx).toFixed(0)}px;width:${(hpx * .5).toFixed(0)}px;height:${hpx.toFixed(0)}px"><span>${(a.name || '').split(' · ')[0]}</span></div>`; }
      if (box._h !== html) { box.innerHTML = html; box._h = html; }
      this.tgtT = (this.tgtT || 0) - dt; if (this.sel && this.tgtT <= 0) { this.tgtT = .6; this.renderTarget(); }
    }
    if (this.tab === 'map') { this.mapT -= dt; if (this.mapT <= 0) { this.mapT = .12; const c = $('tmap'); if (c.width < 20) this.resizeMap(); G.mission.drawMap(c.getContext('2d'), c.width, c.height, {}); } }
    if (this.tab === 'forces') { this.uT = (this.uT || 0) - dt; if (this.uT <= 0) { this.uT = 1; this.renderUnits(); } }
    this.statusT -= dt; if (this.statusT <= 0) { this.statusT = .4; const s = G.mission.st; const t = G.mission.tension;
      $('tbClock').textContent = fmtClock(now).slice(0, 5);
      $('tbStatus').innerHTML = `<span class="tens">מתח <i style="--t:${t.toFixed(0)}%"></i></span><span class="${s.idfHurt ? 'bad' : ''}">פצועים שלנו <b>${s.idfHurt}</b></span><span class="${s.protHurt ? 'bad' : ''}">פצועים בצד השני <b>${s.protHurt}</b></span><span class="${s.dead + s.militants ? 'bad' : ''}">הרוגים <b>${s.dead + s.militants}</b></span><span>אנשים בשטח <b>${G.crowd.count}</b></span><span>גז: צוות <b>${G.mission.U.gas.ammo}</b> · רחפן <b>${G.mission.U.drone.sorties}</b></span>`; }
  }
}
