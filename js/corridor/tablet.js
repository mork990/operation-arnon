// The incident commander's tablet (adapted from mission 2's fence/tablet.js): live feed of the observation drone
// (EO / thermal, tap to mark and identify), the tactical map, the intel feed, and every unit's orders.
import * as THREE from 'three';
import { G, clamp, lerp, V3, fmtClock, bus } from '../core.js';
import { Input } from '../player.js';
import { CL, hC } from './world.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3(), _ray = new THREE.Ray();

export class Tablet {
  constructor() {
    this.el = $('tablet'); this.open = false; this.tab = 'drone'; this.marks = []; this.sel = null; this.pick = null; this.unread = 0; this.firstOpen = true;
    const cam = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 4, 6000);
    G.drone = { cam, active: false, ir: false, target: V3(0, 0, -40), fov: 15, fovT: 15, ang: -.4, alt: 160, rad: 170, track: null, pos: new THREE.Vector3() };
    bus.on('key', k => { if (G.state !== 'play') return; if (k === 'KeyT' || k === 'Tab') this.toggle(); if (this.open && k === 'Escape') this.close(); });
    addEventListener('keydown', e => { if (e.code === 'Tab' && G.state === 'play') e.preventDefault(); });
    $('bTablet').addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    $('bTablet').addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
    $('tbClose').addEventListener('click', () => this.close());
    document.querySelectorAll('.tb-tabs button').forEach(b => b.addEventListener('click', () => this.show(b.dataset.tab)));
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
    $('bHome').addEventListener('click', () => { G.drone.track = null; G.drone.target.set(0, 0, -30); G.drone.fovT = 15; });
    const mc = $('tmap');
    mc.addEventListener('pointerup', e => { const r = mc.getBoundingClientRect(); const M = G.mission._map; if (!M) return; const sx = (e.clientX - r.left) / r.width * M.W, sy = (e.clientY - r.top) / r.height * M.H; const x = M.x0 + sx / M.W * (M.x1 - M.x0), z = M.z0 + sy / M.H * M.span; const p = V3(x, hC(x, z), z);
      let best = null, bd = 18; for (const m of this.marks) { const q = G.mission.posOf(m.obj); const d = Math.hypot((q.x - M.x0) / (M.x1 - M.x0) * M.W - sx, (q.z - M.z0) / M.span * M.H - sy); if (d < bd) { bd = d; best = m; } }
      if (best) { this.select(best); this.show('drone'); G.drone.target.copy(G.mission.posOf(best.obj)); } else { G.drone.target.copy(p); G.drone.track = null; this.flash('הרחפן מכוון לנקודה. פתח את לשונית "רחפן"'); } });
    $('pickCancel').addEventListener('click', () => this.pickEnd());
    $('cfmNo').addEventListener('click', () => { $('cfm').classList.remove('on'); this._cfm = null; });
    $('cfmYes').addEventListener('click', () => { const f = this._cfm; $('cfm').classList.remove('on'); this._cfm = null; f && f(); });
    this.statusT = 0; this.mapT = 0;
  }
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
  panBy(dx, dy) { const d = G.drone; d.track = null; const k = Math.tan(THREE.MathUtils.degToRad(d.fov / 2)) * d.cam.position.distanceTo(d.target) * 2 / innerHeight; const cam = d.cam;
    const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion); right.y = 0; right.normalize(); const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0; fwd.normalize();
    d.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k * 1.4); d.target.x = clamp(d.target.x, -400, 300); d.target.z = clamp(d.target.z, -600, 400); d.target.y = hC(d.target.x, d.target.z); }
  groundAt(sx, sy) {
    const cam = G.drone.cam; const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, cam); _ray.copy(rc.ray);
    const h = G.bvhMesh.geometry.boundsTree.raycastFirst(_ray, THREE.DoubleSide); if (h) return h.point.clone();
    const t = -_ray.origin.y / _ray.direction.y; return t > 0 ? _ray.origin.clone().addScaledVector(_ray.direction, t) : null;
  }
  tap(sx, sy) {
    if (this.pick) { const p = this.groundAt(sx, sy); if (p) this.pickDone(p); return; }
    const cam = G.drone.cam; let best = null, bd = G.isTouch ? 34 : 24;
    const test = (obj, p) => { _v.copy(p); _v.y += 1; _v.project(cam); if (_v.z > 1) return; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight; const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = obj; } };
    for (const a of G.actors) if (a.alive && !a.removed && !a.noTag) test(a, a.pos);
    for (const a of G.crowd.agents) if (a.alive) test(a, _v.set(a.x, a.y, a.z).clone());
    if (!best) { this.select(null); const p = this.groundAt(sx, sy); if (p) { G.drone.target.lerp(p, .5); } return; }
    // people in the column become full characters once the commander picks them out (and keep walking)
    if (!best.root) { const act = G.mission.promote(best); if (act) best = act; else return; }
    this.mark(best, true);
  }
  mark(obj, select = false) {
    let m = this.marks.find(m => m.obj === obj);
    if (!m) { const info = G.mission.identify(obj); if (info.unit) { this.flash(info.name); return; } m = { obj, n: ++this.markN || (this.markN = 1), threat: info.threat }; m.label = `יעד ${m.n}`; this.marks.push(m); if (this.marks.length > 12) this.marks.shift(); G.audio.playS('dry', { vol: .25, rate: 2.2 }); }
    if (select) this.select(m);
  }
  select(m) { this.sel = m || null; const ti = $('tgtInfo'); if (!m) { ti.classList.remove('on'); return; } ti.classList.add('on'); this.renderTarget(); }
  selected() { return this.sel ? this.sel.obj : null; }
  renderTarget() {
    const m = this.sel; if (!m) return; const o = m.obj, M = G.mission; const info = M.identify(o); m.threat = info.threat; const alive = o.alive && !o.removed;
    const job = M.idJob && M.idJob.obj === o;
    $('tgtInfo').classList.toggle('threat', info.threat); $('tgtName').textContent = `${m.label} · ${info.name}${!alive ? ' · לא בשטח' : ''}${job ? ` · בתצפית ${Math.min(100, Math.round(M.idJob.t / 4 * 100))}%` : ''}`; $('tgtDesc').textContent = info.desc;
    const acts = [];
    acts.push({ l: G.drone.track === o ? 'הפסק מעקב' : 'עקוב', f: () => { G.drone.track = G.drone.track === o ? null : o; this.renderTarget(); } });
    if (o.role === 'suspect' && !o.identified) acts.push({ l: job ? 'מזהה…' : 'זהה (תצפית)', c: 'go', dis: job, f: () => M.identify0(o) });
    if (!o.friendly && o.role !== 'sniper' && o.role !== 'sheltering' && !o.detained) acts.push({ l: o.flagged ? 'מסומן לעיכוב' : 'סמן לעיכוב במחסום', c: o.identified && o.armed ? 'go' : '', dis: !!o.flagged, f: () => M.flag(o) });
    if (!o.friendly && (o.role === 'old' || o.hurt) && !o.cared) acts.push({ l: 'שלח חובשים', c: 'go', dis: M.U.med.busy, f: () => M.sendMedics(o) });
    acts.push({ l: 'כרטיס תקיפה', c: 'danger', f: () => M.strikeCard(o) });
    acts.push({ l: 'בטל סימון', f: () => { this.marks = this.marks.filter(x => x !== m); if (G.drone.track === o) G.drone.track = null; this.select(null); } });
    const box = $('tgtActs'); box.innerHTML = ''; for (const a of acts) { const b = document.createElement('button'); b.textContent = a.l; if (a.c) b.className = a.c; b.disabled = !!a.dis || !alive; b.onclick = e => { e.stopPropagation(); const r = a.f(); if (typeof r === 'string') this.flash(r); setTimeout(() => this.renderTarget(), 50); }; box.appendChild(b); }
  }
  startPick(label, fn) { this.pick = fn; $('pickTxt').textContent = label; $('pickBar').classList.add('on'); if (this.tab !== 'drone' && this.tab !== 'map') this.show('drone'); this.hint('גע בנקודה ברחפן או במפה'); }
  pickDone(p) { const f = this.pick; this.pickEnd(); f && f(p); this.renderUnits(); }
  pickEnd() { this.pick = null; $('pickBar').classList.remove('on'); }
  confirm(h, p, yes, danger = false) { $('cfmH').textContent = h; $('cfmP').textContent = p; const y = $('cfmYes'); y.className = danger ? 'danger' : 'go'; y.textContent = danger ? 'אשר ביצוע' : 'אשר'; this._cfm = yes; $('cfm').classList.add('on'); if (!this.open) this.show(this.tab); }
  flash(t) { this.hint(t); G.ui.toast(t); }
  hint(t) { const h = $('feedHint'); h.textContent = t; h.classList.add('on'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('on'), 2600); }
  toast(h) { if (this.open) this.hint(h); }
  onIntel(it) { this.unread++; this.badge(); if (this.open && this.tab === 'intel') this.renderIntel(); document.querySelector('.tb-tabs button[data-tab="intel"]').classList.toggle('unread', !(this.open && this.tab === 'intel')); }
  badge() { const b = $('bTablet'); $('tbBadge').textContent = this.unread; b.classList.toggle('unread', this.unread > 0); }
  renderIntel(keepNew) {
    const ol = $('intelList'); ol.innerHTML = '';
    if (!G.mission.intel.length) { ol.innerHTML = '<li><p>אין עדיין דיווחים. דיווחי מודיעין ותצפית יופיעו כאן.</p></li>'; return; }
    for (const it of G.mission.intel) { const li = document.createElement('li'); li.className = (it.red ? 'red ' : '') + (it.isNew && keepNew ? 'new' : ''); li.innerHTML = `<div class="h"><b>${it.from}</b><span>${fmtClock(it.t).slice(0, 5)}</span></div><p>${it.text}</p>`; if (it.go) { const b = document.createElement('button'); b.className = 'go'; b.textContent = it.go.label; b.onclick = () => it.go.fn(); li.appendChild(b); } ol.appendChild(li); }
  }
  renderUnits() {
    const M = G.mission, U = M.U; const box = $('unitList'); box.innerHTML = '';
    const roe = document.createElement('div'); roe.className = 'roe'; roe.innerHTML = '<b>נהלים במסדרון:</b> האזרחים אינם יעד. תקיפה רק בזיהוי ודאי של חמוש ורחוק מאזרחים. עיכוב רק אחרי זיהוי. רכב שלא עוצר: קריאה, ירי אזהרה, ורק אז ירי למנוע.'; box.appendChild(roe);
    const card = (u, st, acts, cls = '') => { const d = document.createElement('div'); d.className = 'ucard'; d.innerHTML = `<h4>${u.name}<small>${u.sub || ''}</small></h4><div class="st ${cls}">${st}</div>`; const a = document.createElement('div'); a.className = 'acts'; for (const x of acts) { const b = document.createElement('button'); b.textContent = x.l; if (x.c) b.className = x.c; b.disabled = !!x.dis; b.onclick = () => { const r = x.f(); if (typeof r === 'string') this.flash(r); setTimeout(() => this.renderUnits(), 80); }; a.appendChild(b); } d.appendChild(a); box.appendChild(d); };
    const cp = U.cp, q = G.crowd.queueLen();
    card(cp, `${cp.laneB ? 'שני נתיבים' : 'נתיב 1 בלבד'} · קצב ${({ open: 'רגיל', slow: 'איטי', pause: 'עצור' })[cp.flow]} · בתור ${q}${cp.hold ? ' · עצירה בנקודת ההמתנה' : ''}`, [
      { l: cp.laneB ? 'סגור נתיב 2' : 'פתח נתיב 2', c: cp.laneB ? '' : 'go', f: () => M.order('cp', 'laneB') },
      { l: 'קצב רגיל', dis: cp.flow === 'open', f: () => M.order('cp', 'flow', 'open') }, { l: 'בדיקה איטית', dis: cp.flow === 'slow', f: () => M.order('cp', 'flow', 'slow') }, { l: 'עצור מעבר', dis: cp.flow === 'pause', f: () => M.order('cp', 'flow', 'pause') },
      { l: cp.hold ? 'פתח נקודת המתנה' : 'עצירה בנקודת ההמתנה', f: () => M.order('cp', 'hold') } ], M.press > .85 ? 'bad' : M.press > .5 ? 'warn' : '');
    const sp = U.spk; card(sp, sp.cd > 0 ? `הודעה בשידור… (${Math.ceil(sp.cd)} ש׳)` : 'מוכן', [{ l: 'כריזה לטור', c: 'go', dis: sp.cd > 0, f: () => M.order('spk') }]);
    const md = U.med, need = M.needsCare(); card(md, md.busy ? 'בטיפול / בדרך' : need ? 'יש פצוע שממתין!' : 'מוכן, באוהל הרפואה', [{ l: 'שלח לפצוע הבא', c: 'go', dis: md.busy || !need, f: () => M.sendMedics() }], need && !md.busy ? 'warn' : '');
    for (const id of ['apcA', 'apcB', 'tank']) { const u = U[id], S = M.armourSpots(id); const acts = Object.entries(S).map(([k, v]) => ({ l: v.label, dis: !!u.drive || u.pos === k, f: () => M.moveArmour(id, k) }));
      if (id === 'apcA') acts.push({ l: `מסך עשן לקו האש (${u.smoke})`, c: 'go', dis: u.smoke <= 0 || !M.firing || M.covered, f: () => M.cover() });
      card(u, u.drive ? 'בתנועה…' : S[u.pos].label, acts); }
    const inf = U.inf, T = M.threats || {}; card(inf, inf.busy ? 'במשימה…' : 'מוכן ליד נמ״ר ב׳', [
      { l: 'ליווי שיירת הפינוי', c: 'go', dis: inf.busy || !M.convoy || M.block || M.convoy.st === 'moving' || M.convoy.st === 'done', f: () => M.convoyGo(true) },
      { l: 'סריקת הפיר', dis: inf.busy || !M.tunnel || M.tunnel.st !== 'open', f: () => M.tunnelSearch() } ]);
    const eng = U.eng; card(eng, eng.busy ? 'הרובוט בשטח…' : 'מוכן · רובוט', [{ l: 'בדיקת התיק החשוד', c: 'go', dis: eng.busy || !M.bag || M.bag.st === 'done' || M.bag.st === 'cordon', f: () => M.bagRespond() }]);
    const d9 = U.d9; card(d9, d9.busy ? 'בעבודה…' : 'מוכן בשוליים המזרחיים', [{ l: 'פינוי ההריסות מנתיב הרכבים', c: 'go', dis: d9.busy || !M.block, f: () => M.d9Clear() }, { l: 'אטימת הפיר', dis: d9.busy || !M.tunnel || M.tunnel.st !== 'secured', f: () => M.tunnelSeal() }]);
    const mp = U.mp; card(mp, mp.on ? 'מתגברים את הבודקים · קצב +25%' : mp.busy ? 'בדרך למחסום…' : 'בעורף', [{ l: 'תגבור הבודקים', c: 'go', dis: mp.on || mp.busy, f: () => M.mpReinforce() }]);
    const mo = U.mor; card(mo, `${mo.ammo} מטחי עשן${mo.busy ? ' · באוויר' : ''}`, [{ l: 'עשן בין בניין הצלף לכביש', dis: mo.busy || mo.ammo <= 0, f: () => M.mortarSmoke(V3(CL.sniper.x + 14, 0, CL.sniper.z + 22), 'בין בניין הצלף לכביש') }, { l: 'עשן בנקודה…', dis: mo.busy || mo.ammo <= 0, f: () => this.startPick('בחר נקודה לעשן', p => { const r = M.mortarSmoke(p); if (typeof r === 'string') this.flash(r); }) }]);
    const tgt = this.selected() || (M.rpgAlive().length && !M.rpgOut ? M.rpgAlive()[0] : null) || (M.mortarTeam && M.mortarTeam.alive ? M.mortarTeam : null) || (M.firing && M.sniper && M.sniper.alive ? M.sniper : null);
    const sc = document.createElement('div'); sc.className = 'ucard strike'; sc.innerHTML = `<h4>תקיפה<small>כטב״ם ${U.uav.shots} · מרכבה · מסוק ${U.heli.used ? 0 : 1} · חיל האוויר</small></h4><div class="st">כל תקיפה עוברת כרטיס מידתיות ובדיקת יועמ״ש. אזרחים אינם יעד.</div>`;
    const sa = document.createElement('div'); sa.className = 'acts'; const sb = document.createElement('button'); sb.className = 'danger'; sb.textContent = tgt ? `כרטיס תקיפה: ${M.strikeInfo(tgt).name}` : 'סמן יעד ברחפן'; sb.disabled = !tgt; sb.onclick = () => { const r = M.strikeCard(tgt); if (typeof r === 'string') this.flash(r); }; sa.appendChild(sb); sc.appendChild(sa); box.appendChild(sc);
  }
  resizeMap() { const c = $('tmap'); const r = c.getBoundingClientRect(); const s = Math.min(2, devicePixelRatio || 1); c.width = Math.max(10, Math.round(r.width * s)); c.height = Math.max(10, Math.round(r.height * s)); }
  update(dt) {
    const d = G.drone; if (!d) return;
    if (d.track) { const p = G.mission.posOf(d.track); if (p && d.track.alive !== false && !d.track.removed) d.target.lerp(V3(p.x, p.y, p.z), Math.min(1, dt * 3)); else d.track = null; }
    d.ang += dt * .012; d.fov = lerp(d.fov, d.fovT, Math.min(1, dt * 6));
    const cam = d.cam; cam.position.set(d.target.x + Math.cos(d.ang) * d.rad, d.target.y + d.alt, d.target.z + Math.sin(d.ang) * d.rad); cam.lookAt(d.target.x, d.target.y + 1, d.target.z);
    if (Math.abs(cam.fov - d.fov) > .01) { cam.fov = d.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld();
    if (!this.open) return;
    const now = G.missionClock;
    if (this.tab === 'drone') {
      const lat = 31.4180 - d.target.z / 111000, lon = 34.3660 + d.target.x / 94670; const slant = cam.position.distanceTo(d.target); const hdg = ((Math.atan2(d.target.x - cam.position.x, -(d.target.z - cam.position.z)) * 180 / Math.PI) + 360) % 360;
      $('fhTL').innerHTML = `<span class="rec">● REC</span> ${d.ir ? 'IR WHT' : 'EO DAY'}<br>ZIK · ${fmtClock(now)}`;
      $('fhTR').innerHTML = `ALT ${Math.round(d.alt + 40)}m AGL<br>SLR ${Math.round(slant)}m · HDG ${hdg.toFixed(0).padStart(3, '0')}<br>FOV ${d.fov.toFixed(1)}°`;
      $('fhBL').innerHTML = `TGT ${lat.toFixed(5)}N ${lon.toFixed(5)}E<br>${d.track ? 'TRACK' : 'MAN'}`;
      $('bIR').setAttribute('aria-pressed', d.ir); $('bTrack').setAttribute('aria-pressed', !!d.track);
      const box = $('feedMarks'); let html = '';
      for (const m of this.marks) { const o = m.obj; if (!o.alive || o.removed) continue; const p = G.mission.posOf(o); _v.set(p.x, p.y + 1.9, p.z).project(cam); if (_v.z > 1) continue; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight;
        const hpx = Math.max(12, 1.9 / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.distanceTo(p) * 2) * innerHeight); const w = hpx * .55;
        html += `<div class="fmk${m.threat ? ' threat' : ''}${this.sel === m ? ' sel' : ''}" style="left:${x.toFixed(0)}px;top:${(y + hpx).toFixed(0)}px;width:${w.toFixed(0)}px;height:${hpx.toFixed(0)}px"><span>${m.label}</span></div>`; }
      if (d.fov < 9) for (const a of G.actors) { if (!a.friendly || !a.alive || a.noTag) continue; _v.copy(a.pos); _v.y += 1.9; _v.project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight; const hpx = Math.max(10, 1.9 / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.distanceTo(a.pos) * 2) * innerHeight);
        html += `<div class="fmk unit" style="left:${x.toFixed(0)}px;top:${(y + hpx).toFixed(0)}px;width:${(hpx * .5).toFixed(0)}px;height:${hpx.toFixed(0)}px"><span>${(a.name || '').split(' · ')[0]}</span></div>`; }
      if (box._h !== html) { box.innerHTML = html; box._h = html; }
      this.tgtT = (this.tgtT || 0) - dt; if (this.sel && this.tgtT <= 0) { this.tgtT = .5; this.renderTarget(); }
    }
    if (this.tab === 'map') { this.mapT -= dt; if (this.mapT <= 0) { this.mapT = .12; const c = $('tmap'); if (c.width < 20) this.resizeMap(); G.mission.drawMap(c.getContext('2d'), c.width, c.height, {}); } }
    if (this.tab === 'forces') { this.uT = (this.uT || 0) - dt; if (this.uT <= 0) { this.uT = 1; this.renderUnits(); } }
    this.statusT -= dt; if (this.statusT <= 0) { this.statusT = .4; const M = G.mission, s = M.st;
      $('tbClock').textContent = fmtClock(now).slice(0, 5);
      $('tbStatus').innerHTML = `<span class="tens">צפיפות <i style="--t:${(Math.min(1, M.press) * 100).toFixed(0)}%"></i></span><span>עברו <b>${G.crowd.passed}</b></span><span>בתור <b>${G.crowd.queueLen()}</b></span><span class="${s.civHurt ? 'bad' : ''}">אזרחים פצועים <b>${s.civHurt}</b></span><span class="${s.idfHurt ? 'bad' : ''}">לוחמים פצועים <b>${s.idfHurt}</b></span><span>עיכובים <b>${s.detained}</b></span>`; }
  }
}
