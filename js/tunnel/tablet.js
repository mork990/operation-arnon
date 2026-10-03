// The commander's tablet in the forward command vehicle: the "Zik" (Hermes 450) feed in day and thermal, the map,
// the intel log and every unit's orders. Adapted from mission 2's tablet (no crowd; strikes need a marked target).
import * as THREE from 'three';
import { G, clamp, lerp, V3, fmtClock, bus } from '../core.js';
import { hT, TL } from './world.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3(), _ray = new THREE.Ray();

export class Tablet {
  constructor() {
    this.el = $('tablet'); this.open = false; this.tab = 'drone'; this.marks = []; this.sel = null; this.unread = 0; this.firstOpen = true;
    const cam = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 4, 6000);
    // a Hermes 450 orbits far higher than this; the model keeps its view angle (about 40 degrees down) and a long lens
    G.drone = { cam, active: false, ir: false, target: V3(-100, 0, 15), fov: 16, fovT: 16, ang: .75, alt: 190, rad: 230, track: null, pos: new THREE.Vector3() };
    bus.on('key', k => { if (G.state !== 'play') return; if (k === 'KeyT' || k === 'Tab') this.toggle(); if (this.open && k === 'Escape') this.close(); if (this.open && k === 'KeyI') G.drone.ir = !G.drone.ir; });
    addEventListener('keydown', e => { if (e.code === 'Tab' && G.state === 'play') e.preventDefault(); });
    $('bTablet').addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    $('bTablet').addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
    $('tbClose').addEventListener('click', () => this.close());
    document.querySelectorAll('.tb-tabs button').forEach(b => b.addEventListener('click', () => this.show(b.dataset.tab)));
    // feed input: drag = pan, tap = select a person, wheel / pinch = zoom
    const feed = $('tb-drone'); const ptrs = new Map(); let drag = null, pinch = null;
    feed.addEventListener('pointerdown', e => { if (e.target.closest('button,#tgtInfo')) return; feed.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false }; else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: G.drone.fovT }; drag = null; } });
    feed.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); G.drone.fovT = clamp(pinch.fov * pinch.d / Math.max(20, d), 1.2, 30); return; }
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 9) drag.moved = true; if (drag.moved) this.panBy(dx, dy); } });
    const up = e => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (drag && !drag.moved && ptrs.size === 0) this.tap(e.clientX, e.clientY); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) drag = null; };
    feed.addEventListener('pointerup', up); feed.addEventListener('pointercancel', up);
    feed.addEventListener('wheel', e => { e.preventDefault(); G.drone.fovT = clamp(G.drone.fovT * (e.deltaY > 0 ? 1.18 : 1 / 1.18), 1.2, 30); }, { passive: false });
    $('bIR').addEventListener('click', () => { G.drone.ir = !G.drone.ir; });
    $('bZin').addEventListener('click', () => { G.drone.fovT = clamp(G.drone.fovT / 1.6, 1.2, 30); });
    $('bZout').addEventListener('click', () => { G.drone.fovT = clamp(G.drone.fovT * 1.6, 1.2, 30); });
    $('bTrack').addEventListener('click', () => { if (G.drone.track) G.drone.track = null; else if (this.sel) G.drone.track = this.sel.obj; else this.flash('סמן קודם אדם'); });
    $('bHome').addEventListener('click', () => { G.drone.track = null; G.drone.target.set(TL.B.x + 10, 0, TL.B.z); G.drone.fovT = 16; });
    // map: tap = move the feed there, or select a mark
    const mc = $('tmap');
    mc.addEventListener('pointerup', e => { const r = mc.getBoundingClientRect(); const M = G.mission._map; if (!M) return; const sx = (e.clientX - r.left) / r.width * M.W, sy = (e.clientY - r.top) / r.height * M.H; const x = M.x0 + sx / M.W * (M.x1 - M.x0), z = M.z0 + sy / M.H * M.span; const p = V3(x, hT(x, z), z);
      let best = null, bd = 18; for (const m of this.marks) { const q = G.mission.posOf(m.obj); const d = Math.hypot((q.x - M.x0) / (M.x1 - M.x0) * M.W - sx, (q.z - M.z0) / M.span * M.H - sy); if (d < bd) { bd = d; best = m; } }
      if (best) { this.select(best); this.show('drone'); G.drone.target.copy(G.mission.posOf(best.obj)); } else { G.drone.target.copy(p); this.flash('"זיק" מכוון לנקודה. פתח את לשונית "זיק"'); } });
    $('cfmNo').addEventListener('click', () => { $('cfm').classList.remove('on'); this._cfm = null; });
    $('cfmYes').addEventListener('click', () => { const f = this._cfm; $('cfm').classList.remove('on'); this._cfm = null; f && f(); });
    this.statusT = 0; this.mapT = 0;
  }
  // ---------- open / close ----------
  toggle() { this.open ? this.close() : this.show(this.tab); }
  show(tab) {
    if (G.state !== 'play') return;
    if (!this.open) { this.open = true; this.el.hidden = false; document.body.classList.add('tabopen'); $('touch').hidden = true; G.audio.playS('dry', { vol: .3, rate: 1.8 }); if (this.firstOpen) { this.firstOpen = false; G.mission.onTabletFirst && G.mission.onTabletFirst(); } }
    this.tab = tab; document.querySelectorAll('.tb-tabs button').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); if (on) b.classList.remove('unread'); });
    for (const p of ['drone', 'map', 'intel', 'forces']) $('tb-' + p).classList.toggle('on', p === tab);
    G.drone.active = tab === 'drone';
    if (tab === 'intel') { this.unread = 0; this.badge(); for (const it of G.mission.intel) it.isNew = false; setTimeout(() => this.renderIntel(), 1500); this.renderIntel(true); }
    if (tab === 'forces') this.renderUnits();
    if (tab === 'map') this.resizeMap();
  }
  close() { if (!this.open) return; this.open = false; this.el.hidden = true; document.body.classList.remove('tabopen'); G.drone.active = false; $('cfm').classList.remove('on'); if (G.state === 'play' && G.isTouch) $('touch').hidden = false; }
  // ---------- the feed ----------
  panBy(dx, dy) { const d = G.drone; d.track = null; const k = Math.tan(THREE.MathUtils.degToRad(d.fov / 2)) * d.cam.position.distanceTo(d.target) * 2 / innerHeight; const cam = d.cam;
    const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion); right.y = 0; right.normalize(); const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0; fwd.normalize();
    d.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k * 1.4); d.target.x = clamp(d.target.x, -500, 250); d.target.z = clamp(d.target.z, -420, 420); d.target.y = hT(d.target.x, d.target.z); }
  groundAt(sx, sy) {
    const cam = G.drone.cam; const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, cam); _ray.copy(rc.ray);
    const h = G.bvhMesh.geometry.boundsTree.raycastFirst(_ray, THREE.DoubleSide); if (h) return h.point.clone();
    const t = -_ray.origin.y / _ray.direction.y; return t > 0 ? _ray.origin.clone().addScaledVector(_ray.direction, t) : null;
  }
  tap(sx, sy) {
    const cam = G.drone.cam; let best = null, bd = G.isTouch ? 34 : 24;
    for (const a of G.actors) { if (!a.alive || a.removed || !a.root.visible) continue; _v.copy(a.pos); _v.y += 1; _v.project(cam); if (_v.z > 1) continue; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight; const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = a; } }
    if (!best) { this.select(null); const p = this.groundAt(sx, sy); if (p) G.drone.target.lerp(p, .5); return; }
    this.mark(best, true);
  }
  mark(obj, select = false) {
    let m = this.marks.find(m => m.obj === obj);
    if (!m) { const info = G.mission.identify(obj); if (info.unit) { this.flash(info.name); return; } m = { obj, n: ++this.markN || (this.markN = 1), threat: info.threat }; m.label = `יעד ${m.n}`; this.marks.push(m); if (this.marks.length > 6) this.marks.shift(); G.audio.playS('dry', { vol: .25, rate: 2.2 }); }
    if (select) this.select(m);
  }
  select(m) { this.sel = m; const ti = $('tgtInfo'); if (!m) { ti.classList.remove('on'); return; } ti.classList.add('on'); this.renderTarget(); }
  renderTarget() {
    const m = this.sel; if (!m) return; const o = m.obj; const M = G.mission; const info = M.identify(o); m.threat = info.threat; const alive = o.alive && !o.removed;
    $('tgtInfo').classList.toggle('threat', info.threat); $('tgtName').textContent = `${m.label} · ${info.name}${!alive ? ' · לא בשטח' : o.down ? ' · פצוע' : ''}`; $('tgtDesc').textContent = info.desc;
    const U = M.U; const acts = [];
    acts.push({ l: G.drone.track === o ? 'הפסק מעקב' : 'עקוב', f: () => { G.drone.track = G.drone.track === o ? null : o; this.renderTarget(); } });
    acts.push({ l: 'זהה (זום)', f: () => { G.drone.track = o; G.drone.fovT = 3.4; } });
    // a strike on someone not positively identified as armed asks twice
    const hit = (kind, label) => ({ l: label, c: 'danger', dis: U[kind].cd > 0 || U[kind].pending || (kind === 'zik' && U.zik.ammo <= 0), f: () => info.threat ? M.strike(kind, o) : this.confirm('אין זיהוי ודאי של חמוש', 'תקיפה בלי זיהוי ודאי עלולה לפגוע באזרח. לאשר בכל זאת?', () => { const r = M.strike(kind, o); if (typeof r === 'string') this.flash(r); }, true) });
    acts.push(hit('zik', `"זיק" (${U.zik.ammo})`), hit('tank', 'פגז טנק'), hit('air', 'סיוע אווירי'));
    acts.push({ l: 'בטל סימון', f: () => { this.marks = this.marks.filter(x => x !== m); if (G.drone.track === o) G.drone.track = null; this.select(null); } });
    const box = $('tgtActs'); box.innerHTML = ''; for (const a of acts) { const b = document.createElement('button'); b.textContent = a.l; if (a.c) b.className = a.c; b.disabled = !!a.dis || !alive; b.onclick = e => { e.stopPropagation(); const r = a.f(); if (typeof r === 'string') this.flash(r); setTimeout(() => this.renderTarget(), 50); }; box.appendChild(b); }
  }
  confirm(h, p, yes, danger = false) { $('cfmH').textContent = h; $('cfmP').textContent = p; const y = $('cfmYes'); y.className = danger ? 'danger' : 'go'; y.textContent = danger ? 'אשר ביצוע' : 'אשר'; this._cfm = yes; $('cfm').classList.add('on'); if (!this.open) this.show(this.tab); }
  flash(t) { this.hint(t); G.ui.toast(t); }
  hint(t) { const h = $('feedHint'); h.textContent = t; h.classList.add('on'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('on'), 2600); }
  toast(h) { if (this.open) this.hint(h); }
  // ---------- intel ----------
  onIntel() { this.unread++; this.badge(); if (this.open && this.tab === 'intel') this.renderIntel(); document.querySelector('.tb-tabs button[data-tab="intel"]').classList.toggle('unread', !(this.open && this.tab === 'intel')); }
  badge() { const b = $('bTablet'); $('tbBadge').textContent = this.unread; b.classList.toggle('unread', this.unread > 0); }
  renderIntel(keepNew) {
    const ol = $('intelList'); ol.innerHTML = '';
    if (!G.mission.intel.length) { ol.innerHTML = '<li><p>אין עדיין דיווחים.</p></li>'; return; }
    for (const it of G.mission.intel) { const li = document.createElement('li'); li.className = (it.red ? 'red ' : '') + (it.isNew && keepNew ? 'new' : ''); li.innerHTML = `<div class="h"><b>${it.from}</b><span>${fmtClock(it.t).slice(0, 5)}</span></div><p>${it.text}</p>`; ol.appendChild(li); }
  }
  // ---------- forces ----------
  renderUnits() {
    const M = G.mission; const U = M.U; const box = $('unitList'); box.innerHTML = '';
    const roe = document.createElement('div'); roe.className = 'roe'; roe.innerHTML = '<b>הוראות:</b> אש רק על זיהוי ודאי של חמוש, והרחק מבתים מאוכלסים. לפני פיצוץ: הבתים ברדיוס 45 מ׳ ריקים והכוח בחוץ.'; box.appendChild(roe);
    const card = (u, st, acts, cls = '') => { const d = document.createElement('div'); d.className = 'ucard'; d.innerHTML = `<h4>${u.name}<small>${u.sub || ''}</small></h4><div class="st ${cls}">${st}</div>`; const a = document.createElement('div'); a.className = 'acts'; for (const x of acts) { const b = document.createElement('button'); b.textContent = x.l; if (x.c) b.className = x.c; b.disabled = !!x.dis; b.onclick = () => { const r = x.f(); if (typeof r === 'string') this.flash(r); setTimeout(() => this.renderUnits(), 80); }; a.appendChild(b); } d.appendChild(a); box.appendChild(d); };
    const al = M.alive(); const hurt = al.filter(a => a.down).length; const ph = M.phase;
    const fst = { search: 'במאסף, ממתינים לפקודה', choose: 'ממתינים לפקודה', route: 'ממתינים לבחירת מסלול', moving: 'בתנועה', clearing: 'מטהרים את הבית', shaft: M.charging ? 'מורידים מטענים לפיר' : 'בבית ב׳, ליד הפיר', withdraw: 'יוצאים מהרדיוס', ready: 'בנקודת הכינוס', blast: 'בנקודת הכינוס', extract: 'בנקודת הכינוס, תחת אש', done: 'במאסף' }[ph] || '';
    const fa = [];
    if (ph === 'search' || ph === 'choose') for (const id of ['B', 'A', 'C']) if (!M.searched[id] && id !== M.where) fa.push({ l: `שלח לבית ${id === 'A' ? 'א׳' : id === 'B' ? 'ב׳' : 'ג׳'}`, c: 'go', f: () => M.sendTo(id) });
    if (ph === 'route') fa.push({ l: 'דרך המטע', c: 'go', f: () => { M.phase = 'search'; return M.sendTo('B', 'cover'); } }, { l: 'ברחוב', f: () => { M.phase = 'search'; return M.sendTo('B', 'fast'); } });
    if (ph === 'shaft') fa.push({ l: 'הנח מטענים', c: 'go', dis: !M.trapFound || M.charged || M.charging, f: () => M.placeCharges() }, { l: 'הוצא את הקשיש', dis: !M.warned || !M.holdout() || M.escorting, f: () => M.escortHoldout() }, { l: 'צא מהרדיוס', c: 'go', dis: !M.charged, f: () => M.withdraw() });
    if (ph === 'ready') fa.push({ l: 'פוצץ את הפיר', c: 'danger', f: () => M.blast() });
    card(U.force, `${al.length - hurt} כשירים${hurt ? ` · ${hurt} פצועים` : ''} · ${fst}`, fa, hurt ? 'bad' : '');
    card(U.robot, U.robot.used ? (M.robotBusy ? 'בפיר…' : 'סיים סריקה') : 'מוכן, על הנמר', [{ l: 'שלח לפיר', c: 'go', dis: ph !== 'shaft' || U.robot.used, f: () => M.sendRobot() }]);
    card(U.spk, U.spk.cd > 0 ? `משדר… (${Math.ceil(U.spk.cd)} ש׳)` : M.warned ? 'השכנים הוזהרו' : 'מוכן', [{ l: 'כריזה ואזהרה בטלפון', c: 'go', dis: U.spk.cd > 0, f: () => M.order('spk') }, { l: 'נקישה על הגג (הבית הדרומי)', dis: !M.warned || !M.holdout(), f: () => M.roofKnock() }]);
    card(U.smoke, `${U.smoke.n} רימונים${M.smokeT > 0 ? ' · מסך פעיל' : ''}`, [{ l: 'מסך עשן סביב הכוח', c: 'go', dis: U.smoke.n <= 0, f: () => M.smoke() }]);
    const tgt = this.sel && this.sel.obj; const tl = tgt ? ` על ${this.sel.label}` : ' (סמן יעד ב"זיק")';
    for (const k of ['zik', 'tank', 'air']) { const u = U[k]; card(u, u.pending ? 'בדרך ליעד…' : u.cd > 0 ? `טוען… (${Math.ceil(u.cd)} ש׳)` : k === 'zik' ? `מוכן · ${u.ammo} חימושים` : 'מוכן', [{ l: 'תקוף' + tl, c: 'danger', dis: !tgt || u.cd > 0 || u.pending || (k === 'zik' && u.ammo <= 0), f: () => M.strike(k, tgt) }]); }
    card(U.apc, U.apc.busy ? 'בדרך / באיסוף' : 'מוכן במאסף', [{ l: 'צא לאסוף את הכוח', c: 'go', dis: U.apc.busy || !(ph === 'extract' || ph === 'ready'), f: () => M.pickup() }]);
  }
  resizeMap() { const c = $('tmap'); const r = c.getBoundingClientRect(); const s = Math.min(2, devicePixelRatio || 1); c.width = Math.max(10, Math.round(r.width * s)); c.height = Math.max(10, Math.round(r.height * s)); }
  // ---------- per frame ----------
  update(dt) {
    const d = G.drone; if (!d) return;
    if (d.track) { const o = d.track; if (o.alive !== false && !o.removed) d.target.lerp(o.pos, Math.min(1, dt * 3)); else d.track = null; }
    d.ang += dt * .01; d.fov = lerp(d.fov, d.fovT, Math.min(1, dt * 6));
    const cam = d.cam; cam.position.set(d.target.x + Math.cos(d.ang) * d.rad, d.target.y + d.alt, d.target.z + Math.sin(d.ang) * d.rad); cam.lookAt(d.target.x, d.target.y + 1, d.target.z);
    if (Math.abs(cam.fov - d.fov) > .01) { cam.fov = d.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld();
    if (!this.open) return;
    const now = G.missionClock;
    if (this.tab === 'drone') {
      const lat = 31.5050 - d.target.z / 111000, lon = 34.4700 + d.target.x / 94670; const slant = cam.position.distanceTo(d.target); const hdg = ((Math.atan2(d.target.x - cam.position.x, -(d.target.z - cam.position.z)) * 180 / Math.PI) + 360) % 360;
      $('fhTL').innerHTML = `<span class="rec">● REC</span> ${d.ir ? 'IR WHT' : 'EO'}<br>ZIK · H450 · ${fmtClock(now)}`;
      $('fhTR').innerHTML = `ALT ${Math.round(d.alt * 16 + 200)}FT AGL<br>SLR ${(slant * 14 / 1000).toFixed(2)}KM · HDG ${hdg.toFixed(0).padStart(3, '0')}<br>FOV ${d.fov.toFixed(1)}°`;
      $('fhBL').innerHTML = `TGT ${lat.toFixed(5)}N ${lon.toFixed(5)}E<br>${d.track ? 'TRACK' : 'MAN'} · ${G.mission.radiusOn && !G.mission.blown ? 'SAFE R 45M' : ''}`;
      $('bIR').setAttribute('aria-pressed', d.ir); $('bTrack').setAttribute('aria-pressed', !!d.track);
      const box = $('feedMarks'); let html = ''; const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const boxAt = (p, cls, label, hgt = 1.9) => { _v.set(p.x, p.y + hgt, p.z).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) return; const x = (_v.x * .5 + .5) * innerWidth, y = (-_v.y * .5 + .5) * innerHeight; const hpx = Math.max(12, hgt / (tanH * cam.position.distanceTo(p) * 2) * innerHeight);
        html += `<div class="fmk ${cls}" style="left:${x.toFixed(0)}px;top:${(y + hpx).toFixed(0)}px;width:${(hpx * .55).toFixed(0)}px;height:${hpx.toFixed(0)}px"><span>${label}</span></div>`; };
      for (const m of this.marks) { const o = m.obj; if (!o.alive || o.removed) continue; boxAt(o.pos, (m.threat ? 'threat' : '') + (this.sel === m ? ' sel' : ''), m.label); }
      if (d.fov < 9) for (const a of G.actors) { if (!a.friendly || !a.alive || !a.root.visible) continue; boxAt(a.pos, 'unit', (a.name || '').split(' · ')[0]); }
      if (box._h !== html) { box.innerHTML = html; box._h = html; }
      this.tgtT = (this.tgtT || 0) - dt; if (this.sel && this.tgtT <= 0) { this.tgtT = .6; this.renderTarget(); }
    }
    if (this.tab === 'map') { this.mapT -= dt; if (this.mapT <= 0) { this.mapT = .15; const c = $('tmap'); if (c.width < 20) this.resizeMap(); G.mission.drawMap(c.getContext('2d'), c.width, c.height, {}); } }
    if (this.tab === 'forces') { this.uT = (this.uT || 0) - dt; if (this.uT <= 0) { this.uT = 1; this.renderUnits(); } }
    this.statusT -= dt; if (this.statusT <= 0) { this.statusT = .4; const M = G.mission; const s = M.st;
      $('tbClock').textContent = fmtClock(now).slice(0, 5);
      $('tbStatus').innerHTML = `<span class="tens">סיכון <i style="--t:${M.risk.toFixed(0)}%"></i></span><span class="${s.teamHurt ? 'bad' : ''}">פצועים שלנו <b>${s.teamHurt}</b></span><span class="${s.civHurt ? 'bad' : ''}">אזרחים שנפגעו <b>${s.civHurt}</b></span><span>הפיר <b>${s.shaft ? 'הושמד' : M.radiusOn ? 'אותר' : 'לא אותר'}</b></span><span>"זיק" <b>${M.U.zik.ammo}</b> · עשן <b>${M.U.smoke.n}</b></span>`; }
  }
}
