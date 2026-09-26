// Mission script: Operation Arnon (8 June 2024, Nuseirat) – team Bravo, "Sapir" building
import * as THREE from 'three';
import { G, bus, after, clearTimers, rr, R, pick, clamp, V3 } from './core.js';
import { Actor, hostileBrain, teamBrain, civBrain, hostageBrain } from './actors.js';
import { B, openDoor } from './building.js';
import { LAYOUT, groundY } from './world.js';
import { makePickup, makeAPC, makeHeli } from './vehicles.js';
import { Input } from './player.js';

const HOSTAGE_NAMES = ['דניאל', 'אביב', 'רועי'];
const say = (id, onend) => G.audio.say(id, { onend });
export const BRIEFING = [['br1', 0], ['br2', 1], ['br3', 1], ['br4', 2], ['br5', 2], ['br6', 1], ['br7', 2], ['br8', 3], ['br9', 3]];

export class Mission {
  constructor() {
    this.phase = -1; this.checkpoint = 0; this.interactions = []; this.enemiesLeft = 0; this.failed = false; this.timer = null; this.team = []; this.hostages = []; this.cmd = null;
    bus.on('friendlyFire', a => this.onFriendlyFire(a));
    bus.on('playerDied', () => this.fail('נפגעת. הצוות לא הצליח להמשיך בלעדיך.'));
    bus.on('actorDied', a => { if (a.hostile) this.countGroup(); if (a.kind === 'hostage' && !this.failed) this.fail(a.down ? `החטוף ${a.name} מת מפצעיו. הוא לא קיבל טיפול בזמן.` : 'חטוף נפגע ונהרג. המשימה נכשלה.');
      if (a.friendly && !this.failed) { G.stats.kia = (G.stats.kia || 0) + 1; G.ui.toast(`${(a.name || 'לוחם').split(' ·')[0]} נהרג.`, 'warn'); } });
    bus.on('actorDown', a => this.onCasualty(a));
    bus.on('playerBleeding', () => this.onPlayerBleeding());
  }
  // ---------- casualties: anyone of ours (or a hostage) who goes down bleeds until treated ----------
  whoName(a) { return a.kind === 'hostage' ? `החטוף ${a.name}` : (a.name || 'הלוחם').split(' ·')[0]; }
  onCasualty(a) {
    if (this.failed || a.removed) return; const who = this.whoName(a);
    G.ui.toast(`${who} נפגע ומדמם! גש אליו והחזק E כדי לטפל`, 'warn'); G.stats.wounded = (G.stats.wounded || 0) + 1;
    if (a.kind === 'hostage') say('w5'); else { const n = a.name || ''; say(n.includes('2') ? 'w1a' : 'w1b'); after(1.3, () => say(n.includes('2') ? 'w2b' : 'w2a')); }
    const it = this.interact({ pos: a.chest(new THREE.Vector3()), r: 2.4, hold: 2.6, label: `החזק E כדי לטפל ב${who} (חוסם עורקים)`, cond: () => a.alive && a.down && !a.removed,
      onDone: () => { a.treat(G.player); say(R() < .5 ? 'w3' : 'w4'); G.ui.toast(`${who}: חוסם עורקים הונח. הדימום נעצר.`); G.stats.treated = (G.stats.treated || 0) + 1; } });
    it.casualty = a; this.lastCasualty = a;
    after(a.kind === 'hostage' ? 11 : 15, () => this.autoTreat(a));
  }
  autoTreat(a) {
    if (!a.alive || !a.down || a.removed || this.failed) return;
    const pool = [...this.team, ...G.actors.filter(x => x.kind === 'idf')].filter(m => m !== a && m.alive && !m.down && !m.seat && !m.removed && !m.noMedic && m.pos.distanceTo(a.pos) < 30 && Math.abs(m.pos.y - a.pos.y) < 1.5);
    const medic = pool.sort((m1, m2) => m1.pos.distanceTo(a.pos) - m2.pos.distanceTo(a.pos))[0];
    if (!medic) { after(5, () => this.autoTreat(a)); return; }
    const fol = medic.follow; medic.follow = null; const tgt = a.pos.clone().add(new THREE.Vector3(.55, 0, .35));
    medic.setPath([tgt], 3.6, m => { m.forceAnim = 'crouch'; m.faceTo(a.pos); after(3.4, () => { if (a.alive && a.down) { a.treat(m); G.ui.toast(`${(m.name || 'חובש').split(' ·')[0]} טיפל ב${this.whoName(a)}.`); } m.forceAnim = m.keepCrouch ? 'crouch' : null; if (fol) { m.follow = fol; fol.ci = undefined; } }); });
  }
  onPlayerBleeding() {
    if (this.failed) return; const P = G.player; G.ui.toast('נפגעת ואתה מדמם! החזק E כדי לחבוש את עצמך', 'warn');
    const it = this.interact({ r: 6, hold: 3.2, label: 'החזק E כדי לחבוש את עצמך', cond: () => P.bleeding && P.alive, onDone: () => { P.bleeding = false; P.health = Math.max(P.health, 50); say('w6'); G.ui.toast('חבשת את עצמך. הדימום נעצר.'); } });
    Object.defineProperty(it, 'pos', { get: () => P.eyePos });
  }
  get guide() { return G.guide; }
  objective(text, sub = '', target = null, label = '', kind = 'go') { G.ui.setObjective(text, sub); this.guide.setTarget(target, label, kind); this.lastProgress = G.time; }
  clearWorld() {
    clearTimers(); G.audio.clearVoice(); this.interactions = []; this.timer = null; this.failed = false; this.onUpdate = null; this.hitDone = false; this.upstairsSpawned = false; this.breachAt = 0; this.nudge = null;
    for (const a of [...G.actors]) a.remove(); G.actors.length = 0;
    for (const v of this.vehicles || []) { G.scene.remove(v.obj); if (v.engine) G.audio.stopLoop(v.engine); if (v.loop) G.audio.stopLoop(v.loop); }
    for (const k of ['heli', 'heli2', 'truck', 'apc0', 'apc1']) G.audio.stopLoop(k, .1);
    this.vehicles = []; this.team = []; this.hostages = []; this.cmd = null; G.panic = 0; G.player.seat = null; G.player.frozen = false; G.player.alive = true; G.player.health = 100; G.player.bleeding = false; G.weapon.enabled = true;
    G.weapon.mag = 30; G.weapon.reserve = Math.max(G.weapon.reserve, 150); G.weapon.reloading = 0; G.audio.distantBattle(0.4); G.audio.setIntensity(.15);
    for (const d of Object.values(B.doors)) { d.open = false; d.anim = null; d.mesh.rotation.set(0, 0, 0); d.mesh.visible = true; if (!B.blockers.includes(d.blocker)) B.blockers.push(d.blocker); }
    B.doors.apt.mesh.position.set(B.core.x0 + .04, B.levels[3], B.aptDoor.z1);
    G.ui.prompt(null); G.ui.show('timerbox', false); this.guide.setTarget(null);
  }
  addVehicle(v) { this.vehicles.push(v); return v; }
  // ammo: take magazines from a teammate standing next to you
  ammoCheck() {
    const w = G.weapon; if (!this.team.length || w.reserve >= 90) { if (this._ammoIt) this._ammoIt.done = true; this._ammoIt = null; return; }
    const near = this.team.find(t => t.alive && t.pos.distanceTo(G.player.pos) < 2.6);
    if (!near) { if (this._ammoIt) this._ammoIt.done = true; this._ammoIt = null; return; }
    if (this._ammoIt && !this._ammoIt.done) { this._ammoIt.pos = near.chest(new THREE.Vector3()); return; }
    this._ammoIt = this.interact({ pos: near.chest(new THREE.Vector3()), r: 2.8, hold: .8, label: `החזק E כדי לקחת מחסניות מ${near.name.split(' ·')[0]}`, onDone: () => { w.reserve = Math.min(270, w.reserve + 120); G.audio.playS('mag_in', { vol: .6 }); G.ui.toast(`קיבלת 4 מחסניות (${w.reserve} כדורים)`); this._ammoIt = null; } });
  }
  interact(o) { const it = { prog: 0, ...o }; this.interactions.push(it); return it; }
  spawn(model, kind, p, yaw, opts = {}) { const a = new Actor(model, kind, p, yaw, opts); a.group = opts.group; for (let i = 0; i < 6 && a.resolveWalls(.32); i++); return a; }
  enemy(model, p, yaw, opts = {}) {
    const a = this.spawn(model, opts.kind || 'guard', p, yaw, { rifle: 'ak', health: opts.health ?? 100, accuracy: opts.accuracy, group: opts.group || this.group, headband: opts.kind === 'fighter' });
    a.brain = hostileBrain(a); a.range = opts.range || 70; a.peek = opts.peek; a.hunt = opts.hunt; a.idleAnim = opts.idleAnim || 'angry';
    if (opts.alert) { a.alertT = 99; a.state = 'engage'; }
    if (opts.path) a.setPath(opts.path, opts.speed || 3.2, x => { x.idleAnim = opts.endAnim || x.idleAnim; });
    return a;
  }
  teammate(p, yaw, name, opts = {}) {
    const a = this.spawn(opts.model || ({ 'בראבו 2': 'team2', 'בראבו 4': 'team3' }[name] || 'team'), 'team', p, yaw, { rifle: 'm4', accuracy: .7 }); a.brain = teamBrain(a); a.name = name; a.weaponsFree = false; a.idleAnim = 'idle'; a.fireMul = 1.3; a.noDie = true; // a downed operator stays critical until treated
    this.team.push(a); return a;
  }
  setGroup(g) { this.group = g; this.enemiesLeft = 0; }
  countGroup() { this.enemiesLeft = G.actors.filter(x => x.alive && x.hostile && x.group === this.group).length; return this.enemiesLeft; }
  fail(reason) { if (this.failed) return; this.failed = true; G.player.frozen = true; G.audio.clearVoice(); bus.emit('missionFailed', reason); }
  onFriendlyFire(a) {
    if (a.kind === 'hostage') { this.fail('פגעת בחטוף. המשימה בוטלה.'); return; }
    if (a.kind === 'civ') { G.stats.civHits++; if (G.stats.civHits >= 2) this.fail('פגעת שוב בבלתי־מעורב. המשימה בוטלה.'); else { G.ui.toast('פגעת בבלתי־מעורב. עוד פגיעה אחת והמשימה תבוטל.', 'warn'); say('m1'); } return; }
    if (a.kind === 'team' || a.kind === 'idf') G.ui.toast('אל תירה בכוחות שלנו', 'warn');
  }
  update(dt) {
    if (G.state === 'play' || G.state === 'cutscene') G.missionClock += dt;
    const p = G.player; let shown = null;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    for (const it of this.interactions) {
      if (it.done || (it.cond && !it.cond())) { it.prog = 0; continue; }
      const d = it.pos.distanceTo(p.eyePos); if (d > (it.r || 1.8)) { it.prog = 0; continue; }
      const dir = it.pos.clone().sub(p.eyePos).normalize(); if (d > .9 && dir.dot(f) < .45) { it.prog = 0; continue; }
      shown = it;
      if (Input.interact) { it.prog += dt / (it.hold || .01); if (it.prog >= 1) { it.done = true; Input.interact = false; G.ui.prompt(null); it.onDone(); shown = null; break; } } else it.prog = Math.max(0, it.prog - dt * 2);
    }
    G.ui.prompt(shown ? (G.isTouch ? shown.label.replace('החזק E', 'החזק "פעולה"') : shown.label) : null, shown ? shown.prog : 0);
    if (shown) this.guide.hint('interact');
    if (!shown && G.ui.btnUse) G.ui.btnUse.hidden = true;
    if (this.timer) { this.timer.t -= dt; const t = Math.max(0, this.timer.t); document.getElementById('timerv').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; if (this.timer.t <= 0) { const fn = this.timer.done; this.timer = null; G.ui.show('timerbox', false); fn(); } }
    if (this.onUpdate) this.onUpdate(dt);
    if (G.state === 'play') this.ammoCheck();
    for (const v of this.vehicles || []) v.update(dt);
    if (this.nudge && G.state === 'play' && G.time - this.lastProgress > 35) { this.lastProgress = G.time; say(this.nudge); }
  }
  startTimer(sec, label, done) { this.timer = { t: sec, done }; document.getElementById('timerl').textContent = label; G.ui.show('timerbox', true); }
  start(cp = 0) {
    this.clearWorld(); this.checkpoint = cp; G.stats.start = G.stats.start || performance.now();
    [this.p0_ride, this.p1_building, this.p3_hostages, this.p4_stuck, this.p5_beach][cp].call(this);
  }
  restart() { this.start(this.checkpoint); }

  // true when a person-sized box at p is clear of walls, stalls and props
  clear(p) { const bvh = G.bvhMesh && G.bvhMesh.geometry.boundsTree; if (!bvh) return true; const b = new THREE.Box3(new THREE.Vector3(p.x - .3, p.y + .25, p.z - .3), new THREE.Vector3(p.x + .3, p.y + 1.6, p.z + .3)); return !bvh.intersectsBox(b, new THREE.Matrix4()); }
  placeCharge() {
    const y = B.levels[3], x = B.core.x0 + .075, g = new THREE.Group(); g.name = 'breachCharge';
    const cordM = new THREE.MeshStandardMaterial({ color: '#b8431f', roughness: .6 }), tapeM = new THREE.MeshStandardMaterial({ color: '#8e8e86', roughness: .9 }), boxM = new THREE.MeshStandardMaterial({ color: '#1c1c1a', roughness: .5 });
    const seg = (a, b) => { const d = b.clone().sub(a); const m = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, d.length(), 6), cordM); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(m); };
    const z0 = -8.22, z1 = -7.62, ya = y + .95, yb = y + 1.95; const P = (yy, zz) => new THREE.Vector3(x, yy, zz);
    seg(P(ya, z0), P(ya, z1)); seg(P(ya, z1), P(yb, z1)); seg(P(yb, z1), P(yb, z0)); seg(P(yb, z0), P(ya, z0)); seg(P(ya + .5, z0), P(ya + .5, z1)); // frame + cross strip at the lock
    for (const [yy, zz] of [[ya, z0], [ya, z1], [yb, z0], [yb, z1], [ya + .5, (z0 + z1) / 2], [(ya + yb) / 2, z0], [(ya + yb) / 2, z1]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(.008, .05, .09), tapeM); t.position.set(x + .006, yy, zz); t.rotation.x = .3; g.add(t); }
    const ib = new THREE.Mesh(new THREE.BoxGeometry(.05, .12, .08), boxM); ib.position.set(x + .02, ya - .12, z1 - .05); g.add(ib);
    const led = new THREE.Mesh(new THREE.SphereGeometry(.008, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff2a10' })); led.position.set(x + .047, ya - .08, z1 - .05); g.add(led); g.userData.led = led;
    const wire = new THREE.CatmullRomCurve3([P(ya - .18, z1 - .05), P(y + .3, z1 + .05), new THREE.Vector3(x + .3, y + .02, -7.5), new THREE.Vector3(45.2, y + .02, -7.45), new THREE.Vector3(46.2, y + .02, -7.9)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(wire, 40, .004, 4), boxM));
    g.traverse(m => { if (m.isMesh) m.castShadow = true; }); G.scene.add(g);
    let on = true; const blink = () => { if (!g.parent) return; on = !on; led.visible = on; after(on ? .12 : .6, blink); }; blink();
    return g;
  }
  // walk an actor to a street destination; from inside the target building it first takes the stairs and the front door
  goOut(a, dest, speed, done) {
    const P = B.points.exitPath; const inB = a.pos.x > B.x0 - .2 && a.pos.x < B.x1 + .2 && a.pos.z > B.z0 - .2 && a.pos.z < B.z1 - .1;
    if (!inB) { a.setPath([dest], speed, done); return; }
    let bi = P.length - 2, bd = 1e9; const eye = a.pos.clone(); eye.y += 1.2;
    P.forEach((q, i) => { const d = q.distanceTo(a.pos); if (d < bd && Math.abs(q.y - a.pos.y) < 1.3 && G.lineOfSight(eye, q.clone().setY(q.y + 1.2))) { bd = d; bi = i; } });
    a.follow = null; a.setPath([...P.slice(bi), dest], speed, done);
  }
  marketCivilians(n) {
    const models = ['civM1', 'civM2', 'civM3', 'civF1', 'civF2'];
    // vendors standing behind their stalls near the route
    let v = 0; for (const st of G.stalls || []) { if (v >= n * .3 || st.x < -20 || st.x > 115 || R() < .45) continue; v++;
      const back = st.z < 0 ? -1 : 1; if (!this.clear(V3(st.x, 0, st.z + back * .95))) continue; const a = this.spawn(pick(['civM2', 'civM3', 'civM1']), 'civ', V3(st.x + rr(-.6, .6), 0, st.z + back * .95), back < 0 ? 0 : Math.PI); a.state = 'ambient'; a.brain = civBrain(a); a.idleAnim = pick(['idle', 'look', 'angry']); }
    for (let i = 0; i < n - v; i++) {
      const x = R() < .7 ? rr(-10, 110) : rr(-30, 128); if (x > 30 && x < 58 && R() < .7) continue; const side = R() < .5 ? -1 : 1; const z = side * rr(1.6, 3.9); if (!this.clear(V3(x, 0, z))) continue;
      const a = this.spawn(pick(models), 'civ', V3(x, 0, z), R() * 6.28); a.state = 'ambient'; a.brain = civBrain(a);
      if (R() < .45) { const x2 = x + rr(-14, 14); const walk = () => { if (a.state !== 'ambient') return; a.setPath([V3(x2, 0, z)], rr(.9, 1.3), () => { if (a.state !== 'ambient') return; after(rr(1, 5), () => { if (a.state !== 'ambient') return; a.setPath([V3(x, 0, z)], rr(.9, 1.3), () => after(rr(1, 5), walk)); }); }); }; walk(); }
      else a.idleAnim = pick(['idle', 'look', 'idle']);
    }
  }

  // shoppers and vendors along the first stretch of the ride (x 130-230), which used to be deserted
  rideCivilians(n) {
    const models = ['civM1', 'civM2', 'civM3', 'civF1', 'civF2'];
    for (const st of (G.stalls || []).filter(s => s.x > 130)) { if (R() < .5 || n <= 0) continue; const back = st.z < 0 ? -1 : 1; const p = V3(st.x + rr(-.6, .6), 0, st.z + back * .95); if (!this.clear(p)) continue; const a = this.spawn(pick(['civM2', 'civM3', 'civM1']), 'civ', p, back < 0 ? 0 : Math.PI); a.state = 'ambient'; a.brain = civBrain(a); a.idleAnim = pick(['idle', 'look', 'idle']); n--; }
    for (let i = 0; i < n; i++) { const x = rr(132, 228), z = (R() < .5 ? -1 : 1) * rr(2.2, 4.1); if (z < 0 && z > -2.9) continue; const p = V3(x, 0, z); if (!this.clear(p)) continue; const a = this.spawn(pick(models), 'civ', p, R() * 6.28); a.state = 'ambient'; a.brain = civBrain(a); a.idleAnim = pick(['idle', 'look', 'idle']); }
  }

  // ---------- PHASE 0: the ride in ----------
  p0_ride() {
    G.state = 'cutscene'; G.missionClock = 10 * 3600 + 58 * 60 + 25; G.audio.setCrowd(1); G.audio.setIntensity(.15);
    this.guide.setStage(0);
    this.objective('הגעה ליעד "ספיר"', 'אתה בארגז הטנדר, מתחת לברזנט. הסתכל סביב.');
    this.guide.hint('look');
    this.marketCivilians(G.isTouch ? 16 : 44); this.rideCivilians(G.isTouch ? 7 : 18);
    const truck = this.addVehicle(makePickup()); this.truck = truck;
    const route = [V3(236, 0, -1.1), V3(180, 0, -1.2), V3(120, 0, -1.0), V3(80, 0, -1.2), V3(62, 0, -1.5), V3(49.5, 0, -1.9)];
    truck.obj.position.copy(route[0]); truck.obj.rotation.y = -Math.PI / 2;
    truck.engine = 'truck'; G.audio.loop('vehicle_engine_godot_truck_town', 'truck', { vol: .55, pos: truck.obj.position, rate: .9 });
    const seats = [V3(-.42, .82, .55), V3(.42, .82, .2), V3(-.42, .82, -.25)];
    ['בראבו 1', 'בראבו 2', 'בראבו 4'].forEach((n, i) => { const t = this.teammate(V3(0, 0, 0), 0, n); t.seat = seats[i]; t.forceAnim = 'crouch'; t.noTag = true; if (i === 0) this.cmd = t; });
    G.player.sitIn(truck.bed, V3(.4, 1.62, -.55), 2.6); G.player.yaw = -Math.PI / 2 + .5; G.player.pitch = -.05; G.weapon.enabled = false;
    truck.followPath(route, 6.2, () => this.p0_arrive());
    this.onUpdate = () => { for (const t of this.team) if (t.seat) { t.root.position.copy(t.seat).applyMatrix4(truck.bed.matrixWorld); t.aimYaw = truck.obj.rotation.y + Math.PI; t.root.rotation.y = t.aimYaw; } G.vehShake = truck.speed / 6; G.audio.setLoopPos('truck', truck.obj.position); };
    after(1.5, () => say('r1')); after(6.5, () => say('r2')); after(13, () => say('r3')); after(17.5, () => say('r4')); after(25, () => say('r5'));
  }
  p0_arrive() {
    G.missionClock = 10 * 3600 + 59 * 60 + 38; G.audio.stopLoop('truck', 1.5);
    say('r6'); say('r7', () => { G.ui.fadeTo(1, .5).then(() => { this.p1_building(true); G.ui.fadeTo(0, .7); }); });
  }

  // ---------- PHASE 1: into the building, up to the 3rd floor ----------
  p1_building(fromRide = false) {
    if (!fromRide) { this.clearWorld(); this.marketCivilians(G.isTouch ? 14 : 38); this.truck = this.addVehicle(makePickup()); }
    this.checkpoint = 1; G.state = 'play'; G.weapon.enabled = true; G.player.seat = null; this.guide.setStage(1); this.nudge = 'm2';
    const truck = this.truck; truck.curve = null; truck.obj.position.set(49.5, 0, -1.9); truck.obj.rotation.y = -Math.PI / 2; truck.speed = 0;
    if (G.missionClock < 10 * 3600 + 59 * 60 + 40) G.missionClock = 10 * 3600 + 59 * 60 + 40;
    G.player.setPos(V3(47.2, 0, -3.2), Math.PI * .92); G.player.pitch = .05; G.player.crouching = false;
    for (const t of this.team) t.remove(); this.team = [];
    const t1 = this.teammate(V3(48.2, 0, -3.0), Math.PI, 'בראבו 1'); this.cmd = t1;
    this.teammate(V3(48.8, 0, -3.8), Math.PI, 'בראבו 2'); this.teammate(V3(47.9, 0, -4.2), Math.PI, 'בראבו 4');
    this.team.forEach((t, i) => { t.follow = { leader: G.player, gap: 1.6 + i * 1.3, maxSpeed: 4.2 }; t.readyAim = true; });
    G.panic = .6; G.panicAt = V3(47, 0, -3); G.audio.setCrowd(.6); G.audio.setIntensity(.35);
    const entrance = V3(45, 1.4, -6.6), landing3 = V3(45.2, B.levels[3] + 1.2, -7.9), door = V3(B.core.x0 + .1, B.levels[3] + 1.2, -7.8);
    this.objective('היכנס לבניין "ספיר"', 'הכניסה בחזית, מול הטנדר. הצוות הולך אחריך.', entrance, 'כניסה');
    this.guide.hint('move'); after(9, () => this.guide.hint('civ'));
    after(.8, () => say('p1a'));
    this.interact({ pos: door, r: 1.9, hold: 1.4, label: 'החזק E כדי להצמיד מטען פריצה', onDone: () => this.p2_breach() });
    let step = 0;
    this.onUpdate = () => {
      const p = G.player.pos;
      if (step === 0 && G.inside) { step = 1; this.objective('עלה לקומה השלישית', 'במדרגות. הדירה בקומה 3, משמאל לחדר המדרגות.', landing3, 'קומה 3'); this.guide.hint('stairs'); }
      if (step === 1 && p.y > 5.5) { step = 2; say('p1b'); this.lastProgress = G.time; }
      if (step >= 1 && step < 3 && p.y > 8.8 && p.z > -9.2 && p.x > 43.3) {
        step = 3; say('p1c'); this.objective('הצמד מטען פריצה לדלת הדירה', 'הדלת משמאל למדרגות. הצוות מסתדר מאחוריך.', door, 'דלת', 'use');
        this.stackPending = [...this.team]; this.team.forEach(t => { if (t.follow) t.follow.gap = .5; }); G.missionClock = Math.max(G.missionClock, 10 * 3600 + 59 * 60 + 52);
      }
      // teammates take their breaching positions once they have actually reached the 3rd-floor landing (not from a flight below)
      if (step >= 3 && this.stackPending && this.stackPending.length) this.stackPending = this.stackPending.filter(t => { const i = this.team.indexOf(t); const sp = B.points.stack[i + 1]; if (Math.abs(t.pos.y - B.levels[3]) < .3 && t.pos.z > -8.9) { t.follow = null; t.setPath(i === 2 ? [V3(46.1, B.levels[3], -8.1), sp] : [sp], 1.6, x => x.faceTo(V3(43, B.levels[3], -7.8))); return false; } return true; });
    };
    this.setGroup('apt');
    B.points.guards.forEach(g => { const e = this.enemy(g.model, g.p, g.yaw, { accuracy: .32, range: 18 }); e.idleAnim = 'idle'; });
    B.points.family.forEach(f => { const c = this.spawn(f.model, 'civ', f.p, f.yaw); c.idleAnim = 'crouch'; c.state = 'cower'; });
    this.hostages = B.points.hostages.map((h, i) => { const a = this.spawn(h.model, 'hostage', h.p, h.yaw); a.idleAnim = 'crouch'; a.name = HOSTAGE_NAMES[i]; a.brain = hostageBrain(a); a.noTag = true; return a; });
    this.countGroup();
  }

  // ---------- PHASE 2: breach and clear ----------
  p2_breach() {
    this.guide.setStage(2); this.nudge = null;
    const y3 = B.levels[3]; const safe = V3(46.4, y3 + 1.2, -8.2);
    // the charge is now physically on the door: det-cord frame, tape, initiator with a blinking LED and a firing wire back to the stack
    const charge = this.placeCharge(); G.audio.playS('mag_in', { vol: .55, pos: V3(B.core.x0 + .1, y3 + 1.2, -7.8) });
    this.objective('התרחק מהדלת', 'המטען מוצמד. עמוד בצד, ליד הקיר, והמתן לספירה בקשר.', safe, 'מחסה');
    G.missionClock = 11 * 3600 - 14; say('b1');
    for (const t of this.team) { t.forceAnim = 'crouch'; t.faceTo(V3(47, y3, -8.4)); }
    // radio countdown: HQ calls the synchronized breach (both buildings) ~6 s before the charge fires
    const t0 = G.time; let armed = false; const doorP = V3(B.core.x0 + .1, y3, -7.8);
    const arm = () => { if (armed) return; armed = true; say('b2', () => { this.startTimer(5, 'פריצה בעוד', () => {}); }); for (const k of ['n5', 'n4', 'n3', 'n2']) say(k); say('n1', () => blow()); };
    const wait = () => { if (armed || this.failed) return; if (G.player.pos.distanceTo(doorP) > 1.9 || G.time - t0 > 7) arm(); else after(.25, wait); };
    after(2.4, wait);
    const blow = () => {
      if (charge) charge.removeFromParent(); for (const t of this.team) t.forceAnim = null;
      const dp = V3(B.core.x0, B.levels[3] + 1.1, -7.8);
      G.fx.explosion(dp, .45); G.audio.explosion(dp, 1); G.fx.dustBurst(dp, .6, 30, [.7, .68, .62]); G.player.shake = 1;
      const d = G.player.pos.distanceTo(dp); if (d < 1.4) G.player.damage(35, dp);
      openDoor('apt', 1.55, .12); B.doors.apt.mesh.position.x -= .35;
      G.missionClock = 11 * 3600; this.breachAt = G.time; G.panic = 1; G.panicAt = dp.clone(); G.audio.setIntensity(.8); G.audio.setCrowd(.15);
      after(.9, () => { const fp = V3(41.5, B.levels[3] + .3, -8.6); say('p2b'); after(.8, () => { G.fx.glow.emit(fp, V3(), .15, 8, 12, [8, 8, 8, 1], [4, 4, 4, 0]); G.audio.flashbang(fp); const see = G.lineOfSight(G.camera.position, fp); const f = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion); const dir = fp.clone().sub(G.camera.position).normalize(); if (see && dir.dot(f) > .3) { G.ui.flash(.95); G.audio.tinnitus(2.5); } for (const a of G.actors) if (a.hostile && a.group === 'apt') { a.alertT = 99; a.state = 'alert'; a.reactT = 2.2; } }); });
      for (const t of this.team) { t.weaponsFree = true; t.readyAim = true; }
      after(1.8, () => this.team.forEach((t, i) => { t.follow = { leader: G.player, gap: 1.3 + i * 1.1, maxSpeed: 4.5 }; }));
      this.objective('טהר את הדירה', '3 חמושים בפנים. יש בדירה גם משפחה: אל תירה בה.', null);
      this.guide.hint('shoot', true);
      after(6, () => say('p2c')); after(18, () => say('p2d'));
      after(13, () => { if (!this.upstairsSpawned) { this.upstairsSpawned = true; const g = B.points.upstairsGuard; const e = this.enemy(g.model, g.p, g.yaw, { accuracy: .3, range: 20, alert: true }); e.setPath([V3(44.3, B.levels[4] - .2, -9.2), V3(44.3, (B.levels[4] + B.levels[3]) / 2, -12.6), V3(46.1, (B.levels[4] + B.levels[3]) / 2, -12.6), V3(46.1, B.levels[3] + .3, -9.0)], 2.4); say('p2e'); this.countGroup(); } });
      // room-clear callouts as the apartment guards go down
      let kills = 0; const onK = a => { if (!a.hostile || a.group !== 'apt') return; kills++; if (kills === 1) after(1.2, () => say('c1')); if (kills === 2) after(1.2, () => say('c2')); if (kills >= 3) bus.off('actorDied', onK); }; bus.on('actorDied', onK);
    };
    let cleared = false;
    this.onUpdate = () => {
      if (!this.breachAt || cleared) return;
      const n = this.countGroup(); G.ui.setObjective('טהר את הדירה', n ? `נשארו ${n} חמושים. יש בדירה גם משפחה: אל תירה בה.` : '');
      if (G.time - this.breachAt > 3 && n === 0) {
        cleared = true; say('p2f'); this.guide.setStage(3);
        const hd = V3(40.25, B.levels[3] + 1.1, -16.85);
        this.objective('פתח את הדלת לחדר החטופים', 'בקצה המסדרון, משמאל.', hd, 'חדר החטופים', 'use');
        this.interact({ pos: hd, r: 1.7, hold: .5, label: 'החזק E כדי לפתוח את הדלת', onDone: () => this.p3_rescue() });
      }
    };
  }

  // ---------- PHASE 3: hostages found, out of the building under fire ----------
  p3_rescue() {
    openDoor('host', -1.6, .6); G.audio.setIntensity(.55); this.guide.setTarget(null);
    after(.5, () => say('p3a')); after(.6, () => say('p3b')); after(.7, () => say('p3c')); after(.8, () => say('p3d', () => say('p3e')));
    after(2, () => this.p3_escort());
  }
  p3_hostages() {
    this.clearWorld(); this.checkpoint = 2; G.state = 'play';
    this.truck = this.addVehicle(makePickup()); this.truck.obj.position.set(49.5, 0, -1.9); this.truck.obj.rotation.y = -Math.PI / 2;
    G.player.setPos(V3(40.9, B.levels[3], -15.4), Math.PI); G.missionClock = 11 * 3600 + 5 * 60;
    openDoor('apt', 1.55, .01); B.doors.apt.mesh.position.x -= .35; openDoor('host', -1.6, .01);
    const t1 = this.teammate(V3(41, B.levels[3], -12.5), Math.PI, 'בראבו 1'); this.cmd = t1; this.teammate(V3(42.5, B.levels[3], -8.8), Math.PI, 'בראבו 2'); this.teammate(V3(41, B.levels[3], -11.2), Math.PI, 'בראבו 4');
    this.team.forEach(t => { t.weaponsFree = true; t.readyAim = true; });
    this.hostages = B.points.hostages.map((h, i) => { const a = this.spawn(h.model, 'hostage', h.p, h.yaw); a.name = HOSTAGE_NAMES[i]; return a; });
    B.points.family.forEach(f => { const c = this.spawn(f.model, 'civ', f.p, f.yaw); c.idleAnim = 'crouch'; c.state = 'cower'; });
    say('p3e'); this.p3_escort();
  }
  p3_escort() {
    this.checkpoint = 2; this.guide.setStage(4); this.nudge = 'm3';
    const truckPt = () => this.truck.obj.position.clone().add(V3(0, 1.6, 0));
    this.objective('הובל את החטופים לטנדר', 'רד במדרגות וצא לרחוב. החטופים הולכים אחריך.', truckPt, 'טנדר');
    this.guide.hint('escort');
    const hy = B.levels[3]; this.hostages.forEach((h, i) => { h.noTag = false; h.idleAnim = 'nervous'; const inRoom = h.pos.x < 40.2 && h.pos.z < -15.4 && Math.abs(h.pos.y - hy) < 1; h.follow = { leader: G.player, gap: 1.4 + i * 1.1, maxSpeed: 4.6, via: inRoom ? [V3(39.5, hy, -16.85 + (i - 1) * .15), V3(40.9, hy, -16.85)] : null }; h.hurt = i === 2; });
    this.team.forEach((t, i) => { t.follow = { leader: G.player, gap: 4.8 + i * 1.2, maxSpeed: 4.8 }; });
    this.setGroup('street'); let spawned = false, commanderHit = false, atTruck = false, warned = 0;
    this.onUpdate = () => {
      const p = G.player.pos;
      if (!spawned && p.y < 6.8) { spawned = true; this.streetAmbush(); say('p3f'); G.audio.setIntensity(.9); G.audio.distantBattle(1.4); }
      if (!commanderHit && p.y < .6 && p.z > -6.5 && this.cmd && ((this.cmd.pos.y < .5 && this.cmd.pos.z > -5.8) || (this.exitT ||= G.time) < G.time - 12)) { commanderHit = true; this.commanderDown(); } // he is hit once he is out in the street
      const far = this.hostages.filter(h => h.pos.distanceTo(p) > 11).length;
      if (far && G.time - warned > 12) { warned = G.time; G.ui.toast('החטופים נשארו מאחור. חזור אליהם.', 'warn'); }
      if (!atTruck && commanderHit && this.cmd && !this.cmd.down && p.distanceTo(this.truck.obj.position) < 5 && this.hostages.every(h => h.pos.distanceTo(this.truck.obj.position) < 7)) { atTruck = true; this.coverLoading(); }
    };
  }
  streetAmbush() {
    const roofY = (x, z) => { const y = G.floorAt(V3(x, 0, z), 40); return y === null ? 0 : y; };
    [[30, 14, true], [58, 13, true], [66, -2.5, false], [18, 2.5, false], [70, 16, true], [8, -1, false], [24, -14, true], [80, -2, false], [52, 18, true], [-2, 3, false]].forEach(([x, z, roof], i) => {
      const y = roof ? roofY(x, z) : 0; const start = roof ? V3(x, y, z) : V3(x + (x > 40 ? 16 : -16), 0, z);
      const e = this.enemy(pick(['fighter', 'guard1', 'fighter']), start, Math.atan2(46 - x, -2 - z), { kind: 'fighter', accuracy: .2, range: 75, alert: true, peek: true, path: roof ? null : [V3(x, 0, z)], speed: 3.8 });
      e.state = 'alert'; e.reactT = 1.5 + i * .6;
    });
    this.countGroup();
  }
  commanderDown() {
    const c = this.cmd; if (!c) return;
    say('p3g'); c.name = 'בראבו 1 · פצוע קשה'; c.noDie = true; c.noMedic = true; c.bleedRate = .7; c.keepCrouch = true; c.health = Math.min(c.health, 38); c.goDown();
    G.fx.impact(c.chest(new THREE.Vector3()), V3(0, 0, 1), 'flesh'); G.fx.impact(c.chest(new THREE.Vector3()), V3(0, 1, 0), 'flesh');
    after(2.2, () => say('p3h'));
    this.objective('טפל במפקד הפצוע', 'בראבו 1 נפגע ומדמם. גש אליו והחזק E כדי להניח חוסם עורקים. החטופים ממתינים לידך.', () => c.pos.clone().add(V3(0, 1.4, 0)), 'פצוע', 'use');
    const onT = (a) => { if (a !== c) return; bus.off && bus.off('actorTreated', onT); c.name = 'בראבו 1 · פצוע'; c.forceAnim = null; c.hurt = true; this.goOut(c, V3(47.5, 0, -2.6), 1.5, x => { x.forceAnim = 'crouch'; x.stop(); });
      const truckPt = () => this.truck.obj.position.clone().add(V3(0, 1.6, 0)); this.objective('הובל את החטופים לטנדר', 'המפקד מטופל. קדימה, לרכב.', truckPt, 'טנדר'); };
    bus.on('actorTreated', onT);
  }
  coverLoading() {
    this.objective('חפה על ההעמסה', 'ירה בחמושים בגגות ובקצות הרחוב עד שהטנדר מוכן.', null);
    say('p3j');
    this.hostages.forEach((h, i) => { h.follow = null; this.goOut(h, V3(51 + i * .7, 0, -3.4), 3, x => { x.idleAnim = 'crouch'; x.stop(); }); });
    this.startTimer(24, 'העמסה לטנדר', () => this.p4_drive());
    after(6, () => { [[8, 1], [4, -2.5], [12, 3], [16, -3], [2, 2]].forEach(([x, z]) => this.enemy('fighter', V3(x - 22, 0, z), Math.PI / 2, { kind: 'fighter', accuracy: .14, alert: true, peek: true, path: [V3(x, 0, z)], speed: 4 })); this.countGroup(); say('p3i'); });
  }

  // ---------- PHASE 4: drive out, vehicle disabled, hold until rescue force ----------
  p4_drive() {
    G.ui.fadeTo(1, .6).then(() => {
      const truck = this.truck; for (const h of this.hostages) h.remove(); this.hostages = [];
      for (const t of this.team) t.remove(); this.team = [];
      for (const a of [...G.actors]) if (a.hostile) a.remove();
      G.player.sitIn(truck.bed, V3(.4, 1.62, -.55), 2.8); G.player.yaw = truck.obj.rotation.y; G.weapon.enabled = true; G.state = 'play';
      truck.stalled = false; G.audio.loop('vehicle_engine_godot_truck_town', 'truck', { vol: .7, pos: truck.obj.position, rate: 1.05 }); truck.engine = 'truck';
      truck.followPath([V3(49.5, 0, -1.9), V3(30, 0, -1.2), V3(0, 0, .2), V3(-30, 0, .6), V3(LAYOUT.stuck.x, 0, LAYOUT.stuck.z), V3(-120, 0, .5)], 7.5);
      G.ui.fadeTo(0, .6); this.objective('ירי מהטנדר', 'אתה בארגז, פונה לאחור. ירה בחמושים שרודפים אחריכם.', null); this.guide.hint('vehicle'); say('p4a');
      this.setGroup('drive'); for (const [x, z] of [[20, 10], [-5, -9], [-20, 12], [-35, -10], [8, -12], [-12, 9], [-28, 4.2], [-44, -4]]) this.enemy('fighter', V3(x, 0, z), 0, { kind: 'fighter', accuracy: .12, alert: true, range: 60 });
      // the hostages and one operator ride in the bed with you, crouched under the tarp line
      const seats = [V3(-.42, .82, .8), V3(.42, .82, .7), V3(-.42, .82, .2)];
      this.hostages = B.points.hostages.map((h, i) => { const a = this.spawn(h.model, 'hostage', truck.obj.position.clone(), 0); a.name = HOSTAGE_NAMES[i]; a.seat = seats[i]; a.forceAnim = 'crouch'; a.noTag = true; return a; });
      const t2 = this.teammate(truck.obj.position.clone(), 0, 'בראבו 2'); t2.seat = V3(-.45, .82, -.45); t2.forceAnim = 'crouch'; t2.noTag = true; t2.weaponsFree = true;
      const riders = [...this.hostages, t2];
      this.onUpdate = () => { G.vehShake = truck.speed / 5;
        for (const r of riders) if (r.seat && !r.removed) { r.root.position.copy(r.seat).applyMatrix4(truck.bed.matrixWorld); r.aimYaw = truck.obj.rotation.y + Math.PI; r.root.rotation.y = r.aimYaw; }
        if (!this.hitDone && truck.obj.position.x < LAYOUT.stuck.x + 6) { this.hitDone = true; this.vehicleHit(); } };
    });
  }
  vehicleHit() {
    const truck = this.truck; const p = truck.obj.position.clone().add(V3(-3, .8, -2.5));
    G.fx.explosion(p, .8); G.audio.explosion(p, 1.1); G.player.shake = 1; G.player.damage(12, p);
    truck.stalled = true; G.audio.stopLoop('truck', .8);
    say('p4b'); say('p4c');
    after(2.4, () => { G.ui.fadeTo(1, .35).then(() => { this.p4_stuck(true); G.ui.fadeTo(0, .5); }); });
  }
  p4_stuck(fromDrive = false) {
    const L = LAYOUT.stuck;
    if (!fromDrive) { this.clearWorld(); this.truck = this.addVehicle(makePickup()); G.missionClock = 11 * 3600 + 11 * 60; }
    this.checkpoint = 3; G.state = 'play'; G.weapon.enabled = true; this.guide.setStage(5); this.nudge = null;
    const truck = this.truck; truck.curve = null; truck.stalled = true; truck.obj.position.set(L.x, 0, L.z); truck.obj.rotation.y = -Math.PI / 2 + .12;
    G.fx.coloredSmoke(truck.obj.position.clone().add(V3(-2.4, 1, 0)), [.2, .19, .18]);
    G.player.standUp(V3(L.x + 3.6, 0, L.z - 1.4)); G.player.yaw = -.16; G.player.crouching = true;
    for (const t of this.team) t.remove(); this.team = []; for (const h of this.hostages) h.remove();
    const cover = [V3(L.x - 3.2, 0, L.z + 2.4), V3(L.x + 3, 0, L.z + 2.2)];
    const t2 = this.teammate(cover[0], Math.PI / 2, 'בראבו 2'); const t4 = this.teammate(cover[1], -Math.PI / 2, 'בראבו 4');
    const c = this.teammate(V3(L.x + .6, 0, L.z + 2.1), 0, 'בראבו 1 · פצוע'); this.cmd = c; c.forceAnim = 'crouch'; c.weaponsFree = false; c.hurt = true; c.noMedic = true; c.keepCrouch = true;
    [t2, t4].forEach(t => { t.weaponsFree = true; t.readyAim = true; t.idleAnim = 'crouch'; t.fireMul = 1.6; });
    this.hostages = B.points.hostages.map((h, i) => { const a = this.spawn(h.model, 'hostage', V3(L.x - 1.2 + i * 1.1, 0, L.z + 1.9), Math.PI); a.idleAnim = 'crouch'; a.name = HOSTAGE_NAMES[i]; return a; });
    this.objective('הגן על החטופים עד שכוח החילוץ יגיע', 'חמושים יגיעו מהסמטאות, מהגגות וממערב. החטופים מאחורי הטנדר.', null);
    this.guide.hint('cover', true); say('p4j');
    G.audio.setIntensity(1); G.audio.distantBattle(2);
    this.setGroup('stuck');
    let wave = 0; const waves = [
      [[-50, -34, -51.5, -12], [-50, 34, -48.5, 11], [-100, -2, -84, -3], [-44, -14, -44, -14, true]],
      [[-52, -34, -48.5, -10], [-110, 3, -86, 3.2], [-72, 14, -72, 14, true], [-50, 34, -51, 12.5], [-30, 3, -38, 3.4]],
      [[-50, -34, -52, -11], [-50, 34, -51, 11], [-110, -3, -90, -3], [-66, -14, -66, -14, true], [-28, -3, -36, -3.3], [-80, 14, -80, 14, true]],
      [[-52, -34, -49, -12], [-48, 34, -50, 12], [-110, 2, -88, 2], [-106, -3, -92, -3.5], [-44, 14, -44, 14, true], [-26, 3, -34, 3.2], [-26, -3, -33, -3]],
    ];
    const calls = ['p4d', 'p4e', 'p4f', 'p4d'];
    const spawnWave = () => { const wv = waves[wave++]; if (!wv) return; wv.forEach(([sx, sz, tx, tz, roof]) => { const y = roof ? (G.floorAt(V3(tx, 0, tz), 40) ?? 0) : 0; const e = this.enemy(pick(['fighter', 'fighter', 'guard1']), V3(sx, y, sz), 0, { kind: 'fighter', accuracy: .2, alert: true, peek: true, range: 80, path: roof ? null : [V3(tx, 0, tz)], speed: 4.2 }); e.state = 'alert'; e.reactT = rr(1, 2.5); }); this.countGroup(); if (wave > 1) say(calls[wave - 2]); };
    spawnWave(); after(22, spawnWave); after(44, spawnWave); after(64, spawnWave);
    after(40, () => { say('p4g'); after(5, () => { const roofE = G.actors.filter(a => a.alive && a.hostile && a.pos.y > 4); const tgt = roofE[0] ? roofE[0].pos.clone() : V3(-66, 12, -14); G.fx.explosion(tgt, 1.6); G.audio.explosion(tgt, 1.6); for (const a of G.actors) if (a.hostile && a.alive && a.pos.distanceTo(tgt) < 7) a.damage(999, tgt); }); });
    after(8, () => say('p4h'));
    this.startTimer(90, 'כוח החילוץ יגיע בעוד', () => this.rescueForce());
    this.onUpdate = () => { const n = this.countGroup(); G.ui.setObjective('הגן על החטופים עד שכוח החילוץ יגיע', n ? `${n} חמושים בשטח. החטופים מאחורי הטנדר.` : 'החטופים מאחורי הטנדר. שמור על הכיסוי.'); };
  }
  rescueForce() {
    this.guide.setStage(6); say('p4i');
    const L = LAYOUT.stuck; this.apcs = [];
    this.objective('חכה לנגמ״שים', 'הם מגיעים ממערב, מכיוון החוף.', () => this.apcs[0] ? this.apcs[0].obj.position.clone().add(V3(0, 3, 0)) : null, 'נגמ״ש');
    [[-7, .5], [-16.5, -.8]].forEach(([dx, dz], i) => { const v = this.addVehicle(makeAPC()); v.guns = true; v.obj.position.set(-200, 0, dz); v.obj.rotation.y = Math.PI / 2; v.followPath([V3(-200, 0, dz), V3(-120, 0, dz), V3(L.x + dx, 0, dz)], 12, () => { if (i === 0) this.apcArrived(v); }); G.audio.loop('vehicle_engine_godot_truck_town', 'apc' + i, { vol: .9, pos: v.obj.position, rate: .6 }); v.engine = 'apc' + i; this.apcs.push(v); });
    for (const a of G.actors) if (a.hostile && a.alive && a.pos.x < L.x - 20) a.damage(999, V3(-200, 1, 0));
    this.onUpdate = () => {};
  }
  apcArrived(v) {
    for (const a of this.apcs) a.rampOpen = true;
    for (const k of ['apc0', 'apc1']) G.audio.stopLoop(k, 2);
    for (let i = 0; i < 3; i++) { const s = this.spawn(['team2', 'team3', 'team'][i % 3], 'idf', V3(v.obj.position.x - 6.6, 0, v.obj.position.z + (i - 1) * 2.3), -Math.PI / 2, { rifle: 'm4', accuracy: .6 }); s.brain = teamBrain(s); s.weaponsFree = true; s.readyAim = true; }
    // the hostages run to the ramp, climb it and disappear into the troop compartment
    const vx = v.obj.position.x, vz = v.obj.position.z;
    this.hostages.forEach((h, i) => { after(i * .7, () => { if (h.removed) return; h.setPath([V3(vx - 6.4, 0, vz + (i - 1) * .35), V3(vx - 3.6, 0, vz)], 3.4, x => { x.remove(); G.ui.toast(`${x.name} בתוך הנגמ״ש`); }); }); });
    this.onUpdate = () => { for (const h of this.hostages) if (!h.removed && h.path && h.pathI === 1) { h.noSnap = true; h.pos.y = .62 * clamp((h.pos.x - (vx - 5.25)) / 1.35, 0, 1); } };
    const ramp = V3(v.obj.position.x - 4.3, 1.3, v.obj.position.z);
    this.objective('עלה לנגמ״ש', 'הדלת האחורית פתוחה. החטופים עולים ראשונים, אחריהם אתה.', ramp, 'נגמ״ש', 'use');
    this.interact({ pos: ramp, r: 2.6, hold: .3, label: 'החזק E כדי להיכנס לנגמ״ש', cond: () => this.hostages.every(h => h.removed), onDone: () => this.p5_transfer() });
  }

  // ---------- PHASE 5: beach landing zone, helicopter ----------
  p5_transfer() { G.ui.fadeTo(1, .8).then(() => { this.p5_beach(true); G.ui.fadeTo(0, 1.2); }); }
  p5_beach(fromApc = false) {
    this.clearWorld(); this.checkpoint = 4; G.state = 'play'; G.missionClock = 11 * 3600 + 24 * 60; this.guide.setStage(7);
    const lz = LAYOUT.lz; const apc = this.addVehicle(makeAPC()); apc.obj.position.set(-318, 0, 12); apc.obj.rotation.y = -Math.PI / 2 - .3; apc.rampOpen = true; apc.guns = true;
    G.player.setPos(V3(-323, groundY(-323), 13), Math.PI / 2 + .35); G.player.crouching = false;
    this.hostages = B.points.hostages.map((h, i) => { const a = this.spawn(h.model, 'hostage', V3(-322.5 - i * .9, groundY(-322), 11.5 + i * .6), Math.PI / 2); a.name = HOSTAGE_NAMES[i]; a.idleAnim = 'nervous'; return a; });
    for (let i = 0; i < 4; i++) { const s = this.spawn(['team3', 'team2', 'team', 'team3'][i], 'idf', V3(-331 - i * 2.5, groundY(-331 - i * 2.5), 2 + i * 6), Math.PI / 2, { rifle: 'm4', accuracy: .5 }); s.brain = teamBrain(s); s.weaponsFree = true; s.readyAim = true; s.idleAnim = 'crouch'; s.lookAt = V3(-250, 0, 0); }
    this.lzSmoke = V3(lz.x + 3, groundY(lz.x + 3), lz.z - 6);
    const heli = this.addVehicle(makeHeli()); this.heli = heli;
    if (heli) { heli.obj.position.set(lz.x - 420, 60, lz.z + 140); heli.obj.rotation.y = Math.atan2(420, -140) + Math.PI; heli.rotor = 1; heli.loop = 'heli'; G.audio.loop('heli_uh60_main_rotor_idle_power_loop_gpl', 'heli', { vol: 2.2, pos: heli.obj.position }); G.audio.loop('heli_uh60_fast_rotor_bass_gpl', 'heli2', { vol: 1.2, pos: heli.obj.position }); }
    this.objective('אבטח את נקודת הנחיתה', 'העשן הירוק מסמן את הנחיתה. ירה בחמושים ממזרח עד שהמסוק נוחת.', this.lzSmoke.clone().add(V3(0, 2, 0)), 'נקודת נחיתה');
    say('p5a');
    this.setGroup('beach');
    for (const [x, z] of [[-262, -40], [-258, 44], [-270, 70], [-250, 3], [-266, -18]]) this.enemy('fighter', V3(x, 0, z), -Math.PI / 2, { kind: 'fighter', accuracy: .06, alert: true, range: 120, peek: true });
    G.audio.setIntensity(.7); G.audio.distantBattle(1.2);
    this.onUpdate = (dt) => { if (R() < dt * 6) G.fx.coloredSmoke(this.lzSmoke, [.35, .7, .3]); if (heli) G.audio.setLoopPos('heli2', heli.obj.position); };
    if (heli) heli.fly(V3(lz.x, groundY(lz.x) + 18, lz.z), 22, { ease: k => 1 - Math.pow(1 - k, 2), pitch: -.12, done: () => { heli.setDoors(true); heli.fly(V3(lz.x, groundY(lz.x), lz.z), 6, { ease: k => k * k * (3 - 2 * k), done: () => this.heliLanded() }); } });
    after(9, () => say('p5b'));
  }
  heliLanded() {
    const lz = LAYOUT.lz; say('p5c'); say('p5g'); const heli = this.heli;
    // board through whichever cabin door faces the team (the model's cabin doors sit at x≈-3, z=±1.25)
    const dR = heli.toWorld(V3(-3.0, -2.3, -2.4)), dL = heli.toWorld(V3(-3.0, -2.3, 2.4)); const pp = G.player.pos;
    const door = (dR.distanceToSquared(pp) < dL.distanceToSquared(pp) ? dR : dL); door.y = groundY(door.x); this.heliSide = door === dR ? -1 : 1;
    // aircrew/medics jump out and take a knee beside the door, waving the group in
    for (let i = 0; i < 2; i++) { const s = this.spawn(i ? 'team2' : 'team3', 'idf', door.clone().add(V3(1.6 + i * 1.2, 0, -1.4 + i * 2.4)), Math.PI / 2, { rifle: 'm4', accuracy: .5 }); s.brain = teamBrain(s); s.weaponsFree = true; s.readyAim = true; s.idleAnim = i ? 'crouch' : 'idle'; s.lookAt = V3(-250, 0, 0); }
    this.objective('עלה למסוק', 'החטופים רצים למסוק. הצטרף אליהם.', door.clone().add(V3(0, 1.4, 0)), 'מסוק', 'use');
    this.hostages.forEach((h, i) => { h.hurt = false; h.follow = null; h.setPath([V3(-330, 0, 18 + i), door.clone().add(V3(i * .3, 0, i * .2))], 3.8, x => { x.remove(); heli.addPassenger && heli.addPassenger(x.model, i); }); });
    this.interact({ pos: door.clone().add(V3(0, 1.3, 0)), r: 3, hold: .3, label: 'החזק E כדי לעלות למסוק', cond: () => this.hostages.every(h => h.removed), onDone: () => this.finale() });
  }
  finale() {
    const heli = this.heli; G.state = 'cutscene'; G.ui.setObjective('', ''); this.guide.setTarget(null); this.guide.setStage(8);
    const seat = heli.seats ? heli.toLocal(heli.seats.player) : V3(.8, 1.2, .6);
    G.player.sitIn(heli.obj, seat, 2.9); G.player.yaw = heli.obj.rotation.y - 1.3; G.player.pitch = -.1; G.weapon.enabled = false;
    for (const a of [...G.actors]) if (a.hostile) a.remove();
    say('p5d');
    heli.fly(heli.obj.position.clone().add(V3(0, 25, 0)), 6, { ease: k => k * k, done: () => heli.fly(V3(-900, 90, 150), 18, { pitch: .15 }) });
    after(7, () => say('p5e')); after(13, () => say('p5f'));
    after(19, () => { G.ui.fadeTo(1, 2.5).then(() => { G.stats.end = performance.now(); bus.emit('missionComplete'); }); });
  }
}
