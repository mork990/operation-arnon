// "The Fence" scenario: 21 August 2021, the concrete wall with sniper slits east of Gaza City.
// The player is the incident commander. Goal: no terror attack succeeds, nobody is hurt.
import * as THREE from 'three';
import { G, rr, R, ri, pick, clamp, lerp, V3, bus, after, fmtClock, sstep } from '../core.js';
import { Actor } from '../actors.js';
import { FL, hF, lightFire, updateWorld } from './world.js';
import { FVO } from './vo.js';

export const FSTAGES = ['היערכות בעמדה', 'התקהלות מול הקיר', 'הסלמה: עשן, בלונים, מסיתים', 'התראה: מטען בגדר', 'הסתערות על הקיר', 'פיזור ההפגנה'];
const say = (id, onend) => { if (FVO[id]) G.audio.say(id, { onend, ttl: id.startsWith('br') ? 0 : 14000 }); else if (onend) onend(); };
const $ = id => document.getElementById(id);
const UP = new THREE.Vector3(0, 1, 0);

// ---------- props attached to bones (caps, megaphones, flags, vests, balloons) ----------
function findBone(root, name) { let b = null; root.traverse(c => { if (!b && c.name === name) b = c; }); return b; }
function attach(actor, boneName, mesh, offsetFig) { // offset given in the figure's own frame (y up, z forward), relative to the bone's current position
  const root = actor.root; const b = findBone(root, boneName); root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const bm = new THREE.Matrix4().multiplyMatrices(inv, b ? b.matrixWorld : root.matrixWorld);
  const bp = new THREE.Vector3().setFromMatrixPosition(bm); const q = new THREE.Quaternion().setFromRotationMatrix(bm).invert(); const s = 1 / root.scale.x;
  mesh.position.copy(offsetFig.clone().multiplyScalar(s)).applyQuaternion(q); mesh.quaternion.copy(q); (b || root).add(mesh); mesh.traverse(c => { if (c.isMesh) c.castShadow = true; });
  return mesh;
}
const PM = {};
function propMats() {
  if (PM.ok) return PM; PM.ok = true; const std = o => new THREE.MeshStandardMaterial(o);
  PM.black = std({ color: '#161616', roughness: .7 }); PM.red = std({ color: '#b3222a', roughness: .8 }); PM.metal = std({ color: '#2a2a2a', roughness: .4, metalness: .8 }); PM.white = std({ color: '#ecebe4', roughness: .9, side: THREE.DoubleSide });
  PM.blue = std({ color: '#2a4f8a', roughness: .9, side: THREE.DoubleSide }); PM.pole = std({ color: '#8a7a5a', roughness: .9 }); PM.bag = std({ color: '#3a3a30', roughness: 1 });
  const flag = (fn) => { const c = document.createElement('canvas'); c.width = 96; c.height = 64; fn(c.getContext('2d'), 96, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return std({ map: t, side: THREE.DoubleSide, roughness: .85 }); };
  PM.pal = flag((g, W, H) => { [['#1d1d1b', 0], ['#f0eee6', 1], ['#1f7a3a', 2]].forEach(([c, i]) => { g.fillStyle = c; g.fillRect(0, i * H / 3, W, H / 3); }); g.fillStyle = '#c1272d'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W * .4, H / 2); g.lineTo(0, H); g.fill(); });
  PM.hamas = flag((g, W, H) => { g.fillStyle = '#1f7a3a'; g.fillRect(0, 0, W, H); g.fillStyle = '#f2f2ea'; g.fillRect(12, 28, 72, 8); });
  PM.vestMed = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#f1efe8'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#c1272d'; g.beginPath(); g.arc(64, 32, 16, 0, 7); g.fill(); g.fillStyle = '#f1efe8'; g.beginPath(); g.arc(70, 29, 14, 0, 7); g.fill(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return std({ map: t, side: THREE.DoubleSide, roughness: .9 }); })();
  PM.vestPress = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#2a4f8a'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#f1efe8'; g.font = '700 22px Arial'; g.textAlign = 'center'; g.fillText('PRESS', 64, 40); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return std({ map: t, side: THREE.DoubleSide, roughness: .9 }); })();
  return PM;
}
const props = {
  cap(a) { const m = propMats(); const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.SphereGeometry(.115, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.black); c.scale.set(1, .75, 1.1); g.add(c); const v = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .012, 12, 1, false, -Math.PI / 2, Math.PI), m.black); v.position.set(0, -.005, .07); v.scale.set(1, 1, .8); g.add(v);
    const hp = a.eye(new THREE.Vector3()); a.root.worldToLocal(hp); return attach(a, 'Bip01_Head', g, hp.add(V3(0, .05, .01))); },
  megaphone(a) { const m = propMats(); const g = new THREE.Group(); const h = new THREE.Mesh(new THREE.CylinderGeometry(.12, .045, .3, 12, 1, true), m.white); h.rotation.x = Math.PI / 2; h.position.z = .15; g.add(h); const hd = new THREE.Mesh(new THREE.BoxGeometry(.04, .12, .06), m.black); hd.position.set(0, -.07, 0); g.add(hd);
    const b = findBone(a.root, 'Bip01_R_Hand'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); return attach(a, 'Bip01_R_Hand', g, hp.add(V3(0, .05, .06))); },
  flag(a, mat) { const m = propMats(); const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 2.2, 5), m.pole); p.position.y = .9; g.add(p); const f = new THREE.Mesh(new THREE.PlaneGeometry(.9, .6, 6, 1), mat || m.pal); f.position.set(.46, 1.7, 0); g.add(f); g.userData.cloth = f;
    const b = findBone(a.root, 'Bip01_R_Hand'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); attach(a, 'Bip01_R_Hand', g, hp); (G.flags || (G.flags = [])).push(f); return g; },
  vest(a, mat) { const g = new THREE.Mesh(new THREE.CylinderGeometry(.19, .17, .46, 14, 1, true), mat); const b = findBone(a.root, 'Bip01_Spine2'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); g.scale.set(1.05, 1, .8); return attach(a, 'Bip01_Spine2', g, hp.add(V3(0, -.1, .01))); },
  pistol(a) { const m = propMats(); const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.BoxGeometry(.03, .045, .19), m.metal); s.position.z = .06; g.add(s); const gr = new THREE.Mesh(new THREE.BoxGeometry(.028, .1, .04), m.metal); gr.position.set(0, -.05, -.02); gr.rotation.x = -.25; g.add(gr);
    const b = findBone(a.root, 'Bip01_R_Hand'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); return attach(a, 'Bip01_R_Hand', g, hp.add(V3(0, .02, .06))); },
  bag(a) { const m = propMats(); const g = new THREE.Mesh(new THREE.BoxGeometry(.3, .22, .16), m.bag); const b = findBone(a.root, 'Bip01_L_Hand'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); return attach(a, 'Bip01_L_Hand', g, hp.add(V3(0, -.12, 0))); },
  balloons(a) { const g = new THREE.Group(); const cols = ['#e8e4d8', '#e8e4d8', '#d8d0c0', '#e04a3a', '#f0f0f0']; for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rr(.16, .24), 10, 8), new THREE.MeshStandardMaterial({ color: pick(cols), roughness: .3 })); s.position.set(rr(-.3, .3), 2.1 + rr(0, .5), rr(-.3, .3)); s.scale.y = 1.2; g.add(s); }
    const str = new THREE.Mesh(new THREE.CylinderGeometry(.003, .003, 1.9, 3), propMats().white); str.position.y = 1.1; g.add(str); const b = findBone(a.root, 'Bip01_L_Hand'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); return attach(a, 'Bip01_L_Hand', g, hp); },
};

// ---------- the scenario ----------
export class FenceMission {
  constructor() {
    this.t = 0; this.stage = -1; this.events = []; this.intel = []; this.units = []; this.dusk = 0; this.tension = 18;
    this.st = { idfHurt: 0, protHurt: 0, protHurtUnjust: 0, dead: 0, militants: 0, kidsGassed: 0, fires: 0, breach: false, infiltrated: 0, prevented: [], violations: [], strikesAsked: false, rockets: 0 };
    bus.on('actorHit', (a, from, part) => this.onHit(a, from, part));
    bus.on('actorDied', a => this.onDeath(a));
    // rifle and sniper rounds also hit people in the crowd (impostors are promoted to full characters)
    const base = G.shootRay; G.shootRay = (o, dir, max, shooter) => { const r = base(o, dir, max, shooter); if (max < 300 || !G.crowd) return r;
      const lim = (r.hitWorld || r.actor) ? o.distanceTo(r.point) : max; const hit = G.crowd.raycast(o, dir, lim); if (!hit) return r;
      const act = this.promote(hit.agent); if (!act) return r; const p = o.clone().addScaledVector(dir, hit.t); return { point: p, normal: dir.clone().negate(), hitWorld: false, actor: act, part: hit.part, player: false, surface: 'flesh' }; };
  }
  // ---------- menu backdrop / briefing ----------
  backdrop() {
    for (let i = 0; i < 4; i++) lightFire(i);
    this.populate(true);
    for (let i = 0; i < 260; i++) { G.time += .1; updateWorld(.1); G.fx.update(.1); G.crowd.update(.1); }
  }
  idle(dt) { if (G.state === 'menu' || G.state === 'briefing') { this.clockTick(0); } }
  populate(menu = false) {
    const c = G.crowd; c.reset(); const k = G.isTouch ? .8 : 1;
    // families and organisers at the tents
    for (let g = 0; g < 8; g++) { const gx = rr(FL.tents[0] + 8, FL.tents[1] + 14), gz = rr(-FL.tentZ, FL.tentZ) * .9; for (let i = 0; i < 8 * k; i++) c.spawn(gx + rr(-4, 4), gz + rr(-5, 5), { cx: gx, cz: gz, rad: 5, bold: R() * .45 }); }
    // youths in rings around each burning tyre pile
    for (const [fx, fz] of FL.fires) for (let i = 0; i < 18 * k; i++) { const a = R() * 6.283, r = 2.5 + R() * 5; c.spawn(fx - 3 + Math.cos(a) * r, fz + Math.sin(a) * r * 1.2, { cx: fx - 3, cz: fz, rad: 5, bold: .3 + R() * .7 }); }
    // the front: three tight knots facing the wall
    for (const [gx, gz, n] of [[-30, -26, 36], [-26, 6, 46], [-33, 38, 34]]) for (let i = 0; i < n * k; i++) c.spawn(gx + rr(-5, 5), gz + rr(-7, 7), { cx: gx, cz: gz, rad: 6, bold: .4 + R() * .5 });
    c.cheer = .5;
  }
  briefing() {
    const lines = ['br1', 'br2', 'br3', 'br4', 'br5', 'br6'];
    const list = $('brieflines'); list.innerHTML = '';
    lines.forEach((id, i) => { if (!FVO[id]) return; const li = document.createElement('li'); li.textContent = FVO[id].text; li.style.animationDelay = (i * .15) + 's'; list.appendChild(li); say(id, i === lines.length - 1 ? () => $('bgo').classList.add('ready') : null); });
    if (!Object.keys(FVO).length) $('bgo').classList.add('ready');
    const cv = $('map'); const draw = () => { if (G.state !== 'briefing') return; const r = cv.getBoundingClientRect(); if (cv.width !== Math.round(r.width * 1.5)) { cv.width = Math.round(r.width * 1.5); cv.height = Math.round(r.height * 1.5); } this.drawMap(cv.getContext('2d'), cv.width, cv.height, { x0: -300, x1: 110, brief: true }); requestAnimationFrame(draw); }; draw();
  }
  // ---------- start ----------
  start() {
    G.state = 'play'; G.time = G.time || 0; this.t = 0; this.stageSet(0); G.missionClock = 17 * 3600; this.threats = {};
    G.player.setPos(V3(FL.cp.x, FL.bermH + .05, FL.cp.z), Math.PI / 2); G.player.pitch = -.09; G.weapon.enabled = true;
    for (let i = 0; i < 4; i++) lightFire(i);
    this.populate();
    this.spawnForces();
    this.timeline();
    this.objective('הכר את הזירה', 'ההמון מתקבץ מול הקיר. הצלפים בחרכים, צוות הגז ורכב הכריזה על דרך הביטחון.');
    G.fsound.setCrowd(.35);
    this.updateTension(0);
    const go = () => { this.waiting = false; G.lock && G.lock(); after(1.2, () => say('s1')); after(7, () => say('s2')); };
    if (location.hash === '#retry' || G.debug.noIntro) go(); else { this.waiting = true; G.command.intro(go); }
  }
  onTabletFirst() { G.tablet.hint('גרור להזזת הרחפן · צביטה או +/− לזום · נגיעה באדם מסמנת אותו'); setTimeout(() => G.tablet.hint('"תרמי" רואה דרך העשן. בלשונית "כוחות" כל הפקודות'), 4200); }
  objective(t, sub) { this.obj = t; this.calm = { title: t, text: sub }; this.refreshTask(); }
  stageSet(i) { if (this.stage === i) return; this.stage = i; G.guide.setStage(i); }
  at(t, fn) { this.events.push({ at: t, fn }); }
  clockTick(dt) { G.missionClock = 17 * 3600 + this.t * 8.4; if (G.state === 'menu' || G.state === 'briefing') G.missionClock = 16 * 3600 + 58 * 60; }
  // ---------- our forces ----------
  spawnForces() {
    const mk = (model, x, z, yaw, name, opts = {}) => { const a = new Actor(model, 'idf', V3(x, hF(x, z), z), yaw, { rifle: 'm4', accuracy: .9 }); a.name = name; a.noDie = false; a.readyAim = true; a.brain = this.postBrain(a); Object.assign(a, opts); return a; };
    const slitX = .78;
    // Border Police snipers at the central slits (the real deployment), Golani snipers at the southern ones
    this.snA = [mk('team3', slitX, -18, -Math.PI / 2, 'צלף מג״ב · אלון', { slit: -18 }), mk('team3', slitX, 0, -Math.PI / 2, 'צלף מג״ב · דור', { slit: 0 })];
    this.snB = [mk('team', slitX, 36, -Math.PI / 2, 'צלף גולני · נועם', { slit: 36 }), mk('team', slitX, 54, -Math.PI / 2, 'צלף גולני · עידו', { slit: 54 })];
    this.gasTeam = [mk('team2', 6, -24, -Math.PI / 2, 'צוות גז · רון'), mk('team2', 6.3, -20.5, -Math.PI / 2, 'צוות גז · שי')];
    this.reserve = [mk('team', 11.5, 58, -Math.PI / 2, 'כוח כוננות'), mk('team3', 12, 60.5, -Math.PI / 2, 'כוח כוננות'), mk('team', 12.5, 56, -Math.PI / 2, 'כוח כוננות')];
    for (const a of [...this.snA, ...this.snB]) { a.post = a.pos.clone(); a.lookAt = V3(-60, 1.4, a.slit); a.atWall = true; a.aimFlat = true; }
    for (const a of this.gasTeam) { a.lookAt = V3(-80, 8, -20); }
    for (const a of this.reserve) { a.readyAim = false; a.idleAnim = 'idle'; a.lookAt = V3(-50, 1, 60); }
    // command post: radio operator and the deputy with the tablet
    const cp = FL.cp; const op = new Actor('team2', 'idf', V3(cp.x + 5.9, FL.bermH, cp.z + 1.4), -Math.PI / 2, {}); op.forceAnim = 'm_cell_phone_talk_01'; op.noTag = true; op.brain = () => {};
    const dep = new Actor('team3', 'idf', V3(cp.x + 3.1, FL.bermH, cp.z - 1.7), -Math.PI / 2 + .3, { rifle: 'm4' }); dep.forceAnim = 'm_documentfile_idle'; dep.noTag = true; dep.brain = () => {}; dep.rifle.visible = false;
    this.cpCrew = [op, dep];
    // two Hamas lookouts on top of each observation post (seen in thermal from the drone)
    this.lookouts = [];
    for (const P of G.posts || []) for (let i = 0; i < 2; i++) { const y = P.pos.y + .92; const a = new Actor(i ? 'guard1' : 'fighter', 'civ', V3(P.x + (i ? .8 : -.7), y, P.z + (i ? -.6 : .5)), Math.PI / 2, {}); a.noSnap = true; a.role = 'lookout'; a.militant = true; a.brain = () => {}; a.idleAnim = i ? 'm_cell_phone_talk_01' : 'look'; a.post = P; this.lookouts.push(a); }
    // units the commander controls (Forces tab)
    this.units = [
      { id: 'snA', name: 'צלפי מג״ב · צוות א׳', sub: 'חרכים 18−, 0', actors: this.snA, pos: 'wall', shut: false, ruger: 10 },
      { id: 'snB', name: 'צלפי גולני · צוות ב׳', sub: 'חרכים 36, 54', actors: this.snB, pos: 'wall', shut: false, ruger: 10 },
      { id: 'gas', name: 'צוות גז מג״ב', sub: 'מטולי רימוני גז, דרך הביטחון', actors: this.gasTeam, ammo: 14, cd: 0 },
      { id: 'drone', name: 'רחפן גז "ים של דמעות"', sub: 'מטיל רימוני גז מהאוויר, עד 450 מ׳', sorties: 6, cd: 0 },
      { id: 'spk', name: 'כריזה בערבית', sub: 'רמקולים על ההאמר בדרך הביטחון', cd: 0 },
      { id: 'res', name: 'כוח כוננות', sub: 'האמר ו־3 לוחמים', actors: this.reserve, busy: false },
      { id: 'tank', name: 'שריון · 2 מרכבות', sub: 'בדיפונים מול עמדות חמאס', cd: 0 },
      { id: 'air', name: 'חיל האוויר', sub: 'כטב״ם חמוש ומטוסים, דרך האוגדה', cd: 0 },
    ];
    this.U = Object.fromEntries(this.units.map(u => [u.id, u]));
  }
  // our soldiers: hold a post (aim through the slit / over the berm), walk when moved, cough in gas, fire only when ordered
  postBrain(a) {
    return (dt) => {
      if (a.down) return;
      if (a.path) { a.aiming = false; return; }
      a.aiming = a.readyAim && !a.gasT; if (a.lookAt) { a.faceTo(a.lookAt); a.aimPitch = a.aimFlat ? 0 : .35; }
      const g = G.crowd.inGas(a.pos.x, a.pos.z);
      if (g > .25 && !a.gasT) { a.gasT = rr(4, 7); a.forceAnim = 'm_idle_cough_01'; a.aiming = false; if (!this._gasWarn || G.time - this._gasWarn > 30) { this._gasWarn = G.time; this.notify('הגז נסחף אלינו', `הרוח מחזירה את הגז ל${a.pos.x < 20 ? 'לוחמים בקיר' : 'עמדה'}. ירו גז רחוק יותר מערבה, מול הרוח.`, false); say('w_gasback'); } }
      if (a.gasT) { a.gasT -= dt; if (a.gasT <= 0) { a.gasT = 0; a.forceAnim = null; } }
    };
  }
  // ---------- key people in the crowd ----------
  key(model, x, z, role, opts = {}) {
    const a = new Actor(model, 'civ', V3(x, hF(x, z), z), Math.PI / 2, {}); a.role = role; a.brain = this.roleBrain(a); a.idleAnim = opts.idle || 'idle'; if (opts.kid) { a.root.scale.setScalar(.78); a.kid = true; }
    Object.assign(a, opts); (this.keys || (this.keys = [])).push(a); return a;
  }
  roleBrain(a) {
    return (dt) => {
      if (a.down || a.arrested) return;
      // gas: cough, then back off (determined roles come back later)
      const g = G.crowd.inGas(a.pos.x, a.pos.z);
      if (g > .3 && !a.coughT && !a.noGas) { a.coughT = rr(1.5, 3); a.stop(); a.forceAnim = a.kid ? 'm_idle_cough_02' : 'm_idle_cough_01'; a.gassed = (a.gassed || 0) + 1; if (a.kid) this.st.kidsGassed++; if (a.onGas) a.onGas(); }
      if (a.coughT) { a.coughT -= dt; if (a.coughT <= 0) { a.coughT = 0; a.forceAnim = null; const back = V3(a.pos.x - rr(30, 55), 0, a.pos.z + rr(-12, 12)); a.setPath([back], rr(3, 3.8), () => { a.returnT = a.determined ? rr(12, 22) : 999; }); } return; }
      if (a.returnT !== undefined && a.returnT < 900 && !a.path) { a.returnT -= dt; if (a.returnT <= 0) { a.returnT = undefined; a.plan = a.plan0 ? [...a.plan0] : a.plan; a.step = null; } }
      if (a.path || a.returnT !== undefined) return;
      if (a.tick) a.tick(dt);
      // scripted plan: [{go:V3, speed, then:fn}] or [{wait:s, anim}]
      if (!a.step && a.plan && a.plan.length) { a.step = a.plan.shift(); a.stepT = 0;
        if (a.step.go) { a.forceAnim = a.step.anim ?? null; a.setPath([a.step.go], a.step.speed || 1.4, () => { const f = a.step && a.step.then; a.step = null; f && f(a); }); }
        else { if (a.step.anim !== undefined) a.forceAnim = a.step.anim; if (a.step.wait === undefined) { const f = a.step.then; a.step = null; f && f(a); } } }
      if (a.step && a.step.wait !== undefined) { a.stepT += dt; if (a.stepT >= a.step.wait) { const f = a.step.then; a.step = null; f && f(a); } }
      // stone throwing at the wall (visual)
      if (a.thrower && !a.step && a.pos.x > -45) { a.throwT = (a.throwT ?? rr(1, 4)) - dt; if (a.throwT <= 0) { a.throwT = rr(3, 7); this.throwStone(a); } }
    };
  }
  throwStone(a) {
    a.forceAnim = 'm_cheer_01'; after(.55, () => { if (a.forceAnim === 'm_cheer_01') a.forceAnim = a.idle2 || null; const h = a.eye(new THREE.Vector3()).add(V3(0, .25, 0)); const tgt = V3(rr(-.5, 12), rr(1, 6), a.pos.z + rr(-6, 6)); G.gear && G.gear.throwStone(h, tgt); });
  }
  spawnKeys() {
    this.keys = [];
    // stone throwers with flags near the wall
    const youth = ['pM1', 'pM5', 'hostM1', 'hostM2', 'pM4', 'pM2'];
    this.youths = [];
    for (let i = 0; i < (G.isTouch ? 8 : 11); i++) { const z = rr(-50, 50); const a = this.key(pick(youth), rr(-72, -105), z, 'youth', { thrower: true, determined: R() < .6, idle2: R() < .5 ? 'm_idle_angry_02' : 'm_cheer_03' }); a.idleAnim = a.idle2; if (i % 3 === 0) props.flag(a, R() < .8 ? null : propMats().hamas); a.plan0 = [{ go: V3(rr(-18, -32), 0, z), speed: rr(1.3, 2.2) }]; this.youths.push(a); }
    // kids who came with their older brothers
    this.kids = [];
    for (let i = 0; i < 4; i++) { const a = this.key(pick(['pM4', 'pM5', 'hostM1']), rr(-92, -102), 50 + i * 2.5, 'kid', { kid: true, thrower: true, idle2: 'm_cheer_03' }); a.plan0 = []; this.kids.push(a); }
    // medics and press, at the front but apart
    this.medics = [0, 1].map(i => { const a = this.key(i ? 'guard2' : 'pM1', rr(-78, -88), -12 + i * 30, 'medic', { idle: 'idle' }); props.vest(a, propMats().vestMed); a.plan0 = [{ go: V3(-48, 0, -8 + i * 30), speed: 1.4 }]; return a; });
    this.press = [0, 1].map(i => { const a = this.key('hostM2', rr(-70, -80), 20 + i * 24, 'press', { idle: 'm_take_picture' }); props.vest(a, propMats().vestPress); a.plan0 = [{ go: V3(-40 - i * 6, 0, 14 + i * 20), speed: 1.3 }, { anim: 'm_take_picture' }]; return a; });
  }
  // ---------- the timeline ----------
  timeline() {
    this.events = [];
    this.at(6, () => { lightFire(4); lightFire(5); this.addIntel('תצפית', 'צמיגים הוצתו מול הקיר. העשן נע לעברנו עם הרוח. ברחפן, במצב תרמי, רואים דרך העשן.'); say('i1'); });
    this.at(14, () => { this.stageSet(1); this.spawnKeys(); for (const a of this.keys) if (a.plan0) a.plan = [...a.plan0];
      G.crowd.sendTo(a => a.x > -160 && a.x < -40 && a.bold > .45, -17, 0, 55, 'walkto');
      say('s3'); G.fsound.setCrowd(.55); this.setThreat('spk'); this.objective('שמור על המרחק מהקיר', 'כריזה וגז מרחיקים את ההמון בלי נפגעים. המודיעין ידווח על כל איום.'); });
    this.at(50, () => { this.spawnBalloons(); this.addIntel('מודיעין 8200', 'חוליית בלוני תבערה נערכת מדרום למאהל, 190 מ׳ מהקיר. כל בלון שיעבור עלול להצית שדות בצד שלנו.', false, { label: 'הראה ברחפן', fn: () => this.lookAt(this.balloonCell[0]) }); say('i2'); });
    this.at(82, () => { this.stageSet(2); G.crowd.front = -120; G.crowd.sendTo(a => a.x > -240 && a.x < -60 && R() < .4, -40, 10, 60, 'walkto'); this.spawnInstigator(); });
    this.at(110, () => { this.stageSet(3); this.spawnIED(); });
    this.at(215, () => { this.stageSet(4); this.surge(); });
    this.at(222, () => { this.spawnGunman(); });
    this.at(300, () => { this.pipeBombs(); });
    this.at(325, () => { this.stageSet(5); this.wrapUp(); });
  }
  // ---------- escalation pieces ----------
  spawnInstigator() {
    const a = this.key('pM3', -120, 18, 'instigator', { determined: true, idle: 'm_cheer_01' }); a.idleAnim = 'm_cheer_01'; props.megaphone(a); this.instigator = a;
    const followers = G.crowd.near(-108, 18, 45).slice(0, 30); for (const f of followers) f.follow = a;
    a.plan = [{ go: V3(-40, 0, 16), speed: 1.2 }, { wait: 6, anim: 'm_cheer_01' }, { go: V3(-9, 0, 12), speed: 1.0 }, { wait: 999, anim: 'm_cheer_01' }]; a.plan0 = [{ go: V3(-20, 0, 12), speed: 1.2 }, { wait: 999, anim: 'm_cheer_01' }];
    a.tick = () => { for (const f of followers) if (f.alive && f.follow === a && f.state !== 'flee' && f.state !== 'cough') { f.state = 'walkto'; f.tx = a.pos.x - rr(2, 12); f.tz = a.pos.z + rr(-10, 10); } };
    a.onGas = () => { this.instBroken = true; for (const f of followers) if (f.follow === a) { f.follow = null; f.state = 'flee'; f.tx = f.x - rr(25, 50); f.tz = f.z + rr(-12, 12); } };
    this.addIntel('שב״כ', 'מסית מרכזי מטעם חמאס: מעיל אימונים אדום ורמקול ביד. מוביל כמה עשרות צעירים אל הקיר.', false, { label: 'הראה ברחפן', fn: () => this.lookAt(a, true) }); say('i3'); G.tablet.mark(a); this.setThreat('instigator');
  }
  spawnBalloons() {
    const B = FL.balloon; this.balloonCell = [0, 1].map(i => { const a = this.key('hostM2', B.x + i * 2, B.z + i * 1.5, 'balloon', { idle: 'idle', determined: true }); a.plan = [{ wait: 999, anim: null }]; a.plan0 = [{ go: V3(B.x - 10, 0, B.z + 6), speed: 1.2 }, { wait: 999 }]; return a; });
    props.balloons(this.balloonCell[0]);
    this.balloonT = 35; G.tablet.mark(this.balloonCell[0]); this.setThreat('balloon');
  }
  spawnIED() {
    const pts = [V3(-2.2, 0, FL.iedZ + 1.5), V3(-2.2, 0, FL.iedZ - 1.5)];
    this.ied = [0, 1].map(i => { const a = this.key('fighter', -82 + i * 3, -140 + i * 2, 'ied', { idle: 'm_crouch_idle', determined: false }); a.plan = [{ go: V3(-46, 0, FL.iedZ + 8), speed: 1.8 }, { go: pts[i], speed: 1.2, anim: 'crouch', then: () => this.plantIED(a) }]; a.plan0 = []; return a; });
    props.bag(this.ied[0]);
    this.ied.forEach(a => a.onGas = () => { a.fled = true; this.iedAbort(); });
    this.addIntel('תצפית + שב״כ', 'שני רעולי פנים בשחור מתקדמים בזחילה אל הגדר בצפון, כ־90 מטר מעבר לקצה הקיר, כנראה עם מטען. העשן מסתיר אותם: עבור לתרמי.', true, { label: 'הראה ברחפן', fn: () => { this.lookAt(this.ied[0], true); G.drone.ir = true; } }); say('i4');
    G.tablet.mark(this.ied[0]); this.setThreat('ied');
  }
  plantIED(a) {
    if (this.iedDone || a.down || a.fled) return; a.forceAnim = 'crouch'; this.iedPlanting = (this.iedPlanting || 0) + 1;
    after(9, () => { if (a.down || a.fled || this.iedDone || this._iedAbort) return; this.iedDone = true; this.iedPos = V3(-1.5, hF(-1.5, FL.iedZ), FL.iedZ); this.setThreat('ied', false); this.setThreat('charge'); this.notify('מטען הונח בגדר!', 'החבלנים נסוגים. המטען יתפוצץ בעוד שניות. הרחק את כולם מהגדר בצפון.', true); say('w_ied');
      for (const b of this.ied) { b.forceAnim = null; b.stop(); b.setPath([V3(-100, 0, -150)], 3.4); }
      G.gear && G.gear.placeCharge(this.iedPos);
      after(20, () => this.iedBoom()); });
  }
  iedAbort() { if (this.iedDone || this._iedAbort) return; this._iedAbort = true; for (const b of this.ied) { b.plan = []; b.plan0 = []; b.determined = false; b.fled = true; if (b.alive && !b.down && !b.coughT) { b.step = null; b.forceAnim = null; b.stop(); b.setPath([V3(-100, 0, -150)], 3.2); } } this.st.prevented.push('חוליית המטען הורחקה מהגדר בלי שהניחה מטען'); this.notify('החבלנים נסוגו', 'הגז הבריח את חוליית המטען. המטען לא הונח.', false); say('w_iedok'); this.setThreat('ied', false); }
  iedBoom() {
    const p = this.iedPos; G.fx.explosion(p.clone().add(V3(0, .5, 0)), 1.1); G.audio.explosion(p, 1.1); G.gear && G.gear.removeCharge();
    this.st.breach = true; this.breach = { z: FL.iedZ, open: true, t: 0 }; this.setThreat('charge', false); this.setThreat('breach'); G.crowd.breach = this.breach; G.gear && G.gear.breachFence(p);
    // anyone of ours close to it?
    for (const a of G.actors) if (a.friendly && a.alive && a.pos.distanceTo(p) < 8) a.damage(45, p, 'body');
    this.notify('פיצוץ בגדר: נפרצה פרצה', 'צעירים רצים לפרצה. שלח את כוח הכוננות לסגור אותה, או ירה גז אל הפרצה.', true); say('w_breach');
    // a group runs for the gap and some push through into Israel
    const runners = G.crowd.near(-50, -80, 90).slice(0, 14); runners.forEach((r, i) => { r.state = 'walkto'; r.run = true; r.tx = -2; r.tz = FL.iedZ + rr(-1.5, 1.5); r.breacher = true; r.bold = 1; });
    this.breachT = 0;
  }
  surge() {
    this.tensionAdd(12);
    const n = Math.round(clamp(this.tension, 30, 95) * (G.isTouch ? 1.2 : 1.6));
    const pool = G.crowd.agents.filter(a => a.alive && a.x > -200 && a.state !== 'flee' && !a.breacher).sort((a, b) => b.x - a.x).slice(0, n);
    for (const a of pool) { a.state = 'surge'; a.tx = -rr(.7, 3.5); a.tz = clamp(a.z * .5 + rr(-30, 30), -70, 70); }
    for (const y of this.youths || []) if (!y.down && !y.arrested) { y.plan = [{ go: V3(-1.2, 0, clamp(y.pos.z * .4 + rr(-25, 25), -68, 68)), speed: rr(2.6, 3.4) }, { wait: 999, anim: y.idle2 }]; y.step = null; }
    // two go straight for the slits to grab the snipers' rifles
    this.grabbers = (this.youths || []).slice(0, 2).map((y, i) => { const s = i ? 0 : 36; y.plan = [{ go: V3(-.8, 0, s + (i ? 1.2 : -1.2)), speed: 3.2 }, { wait: 999, anim: 'm_gestic_listen_angry_01' }]; y.step = null; y.grabSlit = s; return y; });
    this.notify('ההמון מסתער על הקיר', 'מאות מתפרעים רצים לקיר. חלקם מנסים להגיע לחרכים.', true); say('s4'); G.fsound.setCrowd(1);
    this.surgeT = G.time; this.setThreat('surge');
  }
  spawnGunman() {
    const a = this.key('pM2', -112, -10, 'gunman', { determined: true, noTag: true }); props.cap(a); this.gunman = a; a.tries = 0;
    a.plan = [{ go: V3(-50, 0, -14), speed: 2.3 }, { go: V3(-3.5, 0, -22), speed: 2.5 }, { wait: 5, anim: 'm_idle_angry_02' }, { go: V3(-.9, 0, -18.6), speed: 1.6, then: () => this.gunmanFire() }];
    a.plan0 = [{ go: V3(-4, 0, -24), speed: 2.4 }, { wait: 3 }, { go: V3(-.9, 0, -18.6), speed: 1.6, then: () => this.gunmanFire() }];
    a.onGas = () => { a.tries++; if (a.tries >= 2) { a.determined = false; this.gunmanGaveUp = true; } };
    after(8, () => { this.addIntel('שב״כ · התראה חמה', 'פעיל חמאס חמוש באקדח נמצא בתוך ההמון. כוונתו לירות על הצלפים דרך החרכים המרכזיים. לבוש: חולצה שחורה, ג׳ינס וכובע מצחייה שחור. אקדח מוסתר בחגורה.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(a, true) }); say('i5'); say('i5b');
      this.gunmanWarned = G.time; G.tablet.mark(a); this.refreshTask(); });
    after(34, () => { if (this.snA.some(s => s.atWall && !this.U.snA.shut) && !this.gunmanDone) { this.notify('המפקד, הצלפים עדיין בחרכים', 'צוות א׳ של מג״ב עדיין צמוד לחרכים המרכזיים. הפעיל החמוש מתקרב.', true); say('w_still'); } });
  }
  gunmanFire() {
    const a = this.gunman; if (!a || a.down || this.gunmanDone || !a.alive) return;
    // he draws and fires three rounds through the slit at point-blank range
    a.hostile = true; a.innocent = false; a.kind = 'fighter'; a.armedVisible = true; props.pistol(a); a.forceAnim = 'm_idle_angry_02'; a.faceTo(V3(5, 1.4, -18));
    after(.7, () => {
      if (!a.alive || a.down) return; this.gunmanDone = true;
      const slit = G.slits.find(s => s.z === -18); const hole = V3(0, FL.slitY, -18);
      for (let k = 0; k < 3; k++) after(k * .35, () => { G.fx.muzzle(hole.clone().add(V3(-.25, 0, 0)), V3(1, 0, 0), .6); G.audio.shotAt(hole, 'ak'); });
      const sniper = this.snA.find(s => s.slit === -18 && s.alive && s.atWall && s.pos.distanceTo(V3(.78, s.pos.y, -18)) < 1.2);
      const shut = this.U.snA.shut; const playerThere = G.player.pos.distanceTo(V3(.9, G.player.pos.y, -18)) < 1.4;
      if (shut) { after(.2, () => { G.fx.impact(V3(.17, FL.slitY, -18), V3(1, 0, 0), 'metal'); G.audio.impact(hole, 'metal'); }); this.gunmanAverted('נורו שלוש יריות לעבר החרך, אבל החרך היה סגור. אין נפגעים.'); }
      else if (playerThere) { after(.4, () => { G.player.damage(200, hole); }); }
      else if (sniper) { after(.4, () => { sniper.damage(80, hole, 'head'); this.st.idfHurt++; this.idfShot(sniper); }); }
      else this.gunmanAverted('נורו שלוש יריות דרך החרך, אבל הצלפים כבר לא היו שם. אין נפגעים.');
      after(2.2, () => { a.forceAnim = null; a.setPath([V3(-140, 0, -30)], 3.6); a.hostile = false; });
    });
  }
  gunmanAverted(msg) { this.st.prevented.push('ירי האקדח דרך החרך לא פגע באיש'); this.notify('הירי דרך החרך לא פגע', msg, false); say('w_saved'); this.tensionAdd(-4); }
  idfShot(s) {
    this.notify('לוחם נפגע!', 'צלף מג״ב נפגע מירי אקדח מטווח אפס דרך החרך.', true); say('w_hit'); G.audio.setIntensity(1);
    after(4, () => bus.emit('missionFailed', 'לוחם מג״ב נפגע מירי אקדח מטווח אפס דרך חרך בקיר.<br><span style="font-size:16px;font-weight:500;line-height:1.6;display:block;margin-top:10px;color:#d6cab2">כך נפגע סמ״ר בראל חדריה שמואלי ז״ל ב־21 באוגוסט 2021. ההתראה הגיעה בזמן: אפשר היה להרחיק את הצלפים מהקיר, לסגור את החרכים או לזהות את היורה ברחפן. נסה שוב.</span>'));
  }
  pipeBombs() {
    const throwers = (this.youths || []).filter(y => !y.down && !y.arrested && y.pos.x > -20).slice(2, 4);
    throwers.forEach((y, i) => after(i * 5, () => { if (y.down) return; const p = V3(rr(-.8, 1.2), 0, y.pos.z + rr(-3, 3)); p.y = hF(p.x, p.z); this.throwStone(y); after(1.6, () => { G.fx.explosion(p.clone().add(V3(0, .3, 0)), .6); G.audio.explosion(p, .6);
      const hurt = [...this.snA, ...this.snB].filter(s => s.alive && s.atWall && Math.abs(s.pos.z - p.z) < 5 && !(s.id && 0)); if (hurt.length && p.x > .3) { hurt[0].damage(20, p, 'legs'); this.st.idfHurt++; this.notify('לוחם נפצע קל', 'רסיסי מטען שהושלך מעל הקיר פגעו בצלף ליד החרך.', true); }
      else if (i === 0) this.notify('מטענים הושלכו לעבר הקיר', 'פיצוצים ליד הקיר. מי שצמוד לקיר בסכנה.', false); }); }));
  }
  wrapUp() {
    // the organisers call it a day if the crowd has been kept back; otherwise it drags on and Hamas escalates
    const calm = this.tension < 62; this.addIntel('מודיעין', calm ? 'מארגני ההפגנה קוראים לחזור למאהל. ההמון מתחיל להתפזר.' : 'חמאס מעודד את הצעירים להמשיך. צפויים ניסיונות נוספים עד החשכה.', false); say(calm ? 'i6' : 'i6b');
    this.threats = {}; this.objective(calm ? 'ההמון מתפזר' : 'חמאס ממשיך לדחוף', calm ? 'שמור על השקט עד שהשטח מתרוקן.' : 'עוד כמה דקות עד החשכה. שמור על המרחק מהקיר.');
    const leaveNow = () => { for (const a of G.crowd.agents) if (a.alive && !a.breacher) { a.state = 'leave'; a.tx = rr(-440, -540); a.tz = a.z + rr(-60, 60); } for (const k of this.keys || []) if (!k.down && !k.arrested && k.alive && k.role !== 'gunman') { k.plan = []; k.plan0 = []; k.step = null; k.setPath([V3(rr(-260, -300), 0, k.pos.z)], 1.4); } };
    if (calm) after(4, leaveNow); else { this.tensionAdd(6); after(30, leaveNow); }
    G.fsound.setCrowd(.4);
    after(calm ? 55 : 80, () => this.finish());
  }
  // ---------- consequences ----------
  onHit(a, from, part) {
    if (a.friendly) { if (!a._counted) { a._counted = true; } return; }
    if (a.role === 'gunman' && a.armedVisible) return; // engaged while armed
    if (a.kind === 'civ' || a.fromCrowd) {
      if (a._hurtCounted) return; a._hurtCounted = true; this.st.protHurt++; this.tensionAdd(7);
      const justified = a.justified; if (!justified) { this.st.protHurtUnjust++; if (a.kid || a.role === 'kid') this.st.violations.push('ילד נפגע מירי'); else if (a.role === 'medic' || a.role === 'press') this.st.violations.push(a.role === 'medic' ? 'חובש נפגע מירי' : 'צלם נפגע מירי'); else this.st.violations.push('מפגין שלא היווה איום נפגע מירי'); }
      a.goDownCiv = true; this.civDown(a);
    }
  }
  onDeath(a) {
    if (a.friendly) return;
    if (a.role === 'gunman' || a.role === 'ied' || a.role === 'balloon' || a.militant) { this.st.militants++; this.tensionAdd(10); return; }
    this.st.dead++; this.tensionAdd(25);
    bus.emit('missionFailed', 'נהרג אדם שלא היווה סכנת חיים.<br><span style="font-size:16px;font-weight:500;line-height:1.6;display:block;margin-top:10px;color:#d6cab2">הוראות הפתיחה באש מתירות ירי חי רק מול סכנת חיים מיידית. מול מתפרעים לא חמושים: כריזה, גז ומרחק. נסה שוב.</span>');
  }
  civDown(a) { // the wounded sit down; a Red Crescent medic runs over, treats them, and they are helped away
    if (!a.alive) return; a.stop(); a.plan = []; a.plan0 = []; a.brain = () => {}; a.forceAnim = 'crouch'; a.hurt = true;
    const medic = (this.medics || []).filter(m => m.alive && !m.busy && !m.down).sort((m1, m2) => m1.pos.distanceTo(a.pos) - m2.pos.distanceTo(a.pos))[0];
    const leave = () => { if (!a.alive) return; a.forceAnim = null; a.setPath([V3(a.pos.x - 60, 0, a.pos.z + rr(-10, 10))], 1.1, () => a.remove()); };
    if (medic && medic.pos.distanceTo(a.pos) < 140) { medic.busy = true; medic.plan = []; medic.step = null; medic.stop(); const spot = a.pos.clone().add(V3(-.8, 0, .4)); medic.setPath([spot], 3.2, () => { medic.faceTo(a.pos); medic.forceAnim = 'm_crouch_gestic'; after(7, () => { medic.forceAnim = null; medic.busy = false; leave(); medic.setPath([V3(a.pos.x - 58, 0, a.pos.z)], 1.1, () => { medic.plan = medic.plan0 ? [...medic.plan0] : []; }); }); }); }
    else after(rr(6, 10), leave);
    for (const b of G.crowd.near(a.pos.x, a.pos.z, 25).slice(0, 12)) { b.state = 'flee'; b.tx = b.x - rr(20, 40); b.tz = b.z + rr(-10, 10); }
  }
  promote(agent) { const a = G.crowd.promote(agent, 'civ'); if (!a) return null; a.role = agent.breacher ? 'breacher' : 'crowd'; a.brain = () => {}; return a; }
  tensionAdd(v) { this.tension = clamp(this.tension + v, 0, 100); this.updateTension(0); }
  updateTension(dt) {
    const el = $('tensbar'); if (el) el.style.width = this.tension.toFixed(0) + '%';
    const tv = $('tensv'); if (tv) tv.textContent = this.tension < 30 ? 'נמוך' : this.tension < 55 ? 'בינוני' : this.tension < 75 ? 'גבוה' : 'קיצוני';
    G.crowd.cheer = .3 + this.tension / 140;
  }
  // ---------- orders ----------
  canRuger(u, tgt) { return u && u.ruger > 0 && u.actors.some(s => s.alive && !s.down) && tgt && this.dist2d(tgt, u.actors[0]) < 260; }
  dist2d(t, a) { const p = this.posOf(t); return Math.hypot(p.x - a.pos.x, p.z - a.pos.z); }
  posOf(t) { return t.isVector3 ? t : t.root ? t.pos : V3(t.x, t.y, t.z); }
  order(uid, action, arg) {
    const u = this.U[uid]; if (!u) return; const tab = G.tablet;
    if (uid === 'snA' || uid === 'snB') {
      if (action === 'move') return this.moveSnipers(u, u.pos === 'wall' ? 'berm' : 'wall');
      if (action === 'shut') { if (u.pos !== 'wall') return 'הצלפים לא בקיר'; u.shut = !u.shut; for (const s of G.slits.filter(s => u.actors.some(a => a.slit === s.z))) s.target = u.shut ? 0 : 1; G.audio.playS('hit_metal', { pos: u.actors[0].pos, vol: .6 }); this.notify(u.shut ? 'החרכים נסגרו' : 'החרכים נפתחו', u.shut ? `${u.name}: פלטות הפלדה ירדו על החרכים. הצלפים מוגנים, אבל לא רואים דרכם.` : `${u.name} שוב מתצפת דרך החרכים.`, false); say(u.shut ? 'o_shut' : 'o_open'); this.refreshTask(); return true; }
      if (action === 'warn') { this.sniperShot(u, null, 'warn'); return; }
      if (action === 'ruger' || action === 'live') { const t = arg || (tab && tab.selected()); if (!t) return tab && tab.flash('סמן קודם אדם ברחפן'); this.sniperShot(u, t, action); return; }
    }
    if (uid === 'gas') { if (u.ammo <= 0) return 'נגמרו רימוני הגז לצוות'; if (u.cd > 0) return `צוות הגז טוען (${Math.ceil(u.cd)} ש׳)`; const p = arg; if (!p) return; const from = this.gasFrom(); const d = Math.hypot(p.x - from.x, p.z - from.z); if (d > 170) { tab && tab.flash('מחוץ לטווח מטולי הגז (170 מ׳)'); return 'מחוץ לטווח מטולי הגז (170 מ׳)'; } u.ammo--; u.cd = 9; for (const a of u.actors) { a.lookAt = V3(p.x, p.y + d * .5, p.z); a.aimFlat = false; } for (let k = 0; k < 3; k++) after(k * .45 + .3, () => G.gear.launchGas(u.actors[k % 2].pos.clone().add(V3(-.4, 1.5, 0)), p.clone().add(V3(rr(-4, 4), 0, rr(-4, 4))), 'launcher')); say(pick(['o_gas1', 'o_gas2'])); this.tensionAdd(-1.5); if (p.x > -45 && Math.abs(p.z) < 80) this.gasWallT = G.time; return true; }
    if (uid === 'drone') { if (u.sorties <= 0) return 'לרחפן לא נשארו גיחות'; if (u.cd > 0) return `הרחפן בגיחה (${Math.ceil(u.cd)} ש׳)`; const p = arg && arg.isVector3 ? arg : arg && arg.pos ? arg.pos.clone() : null; if (!p) return; const d = Math.hypot(p.x - FL.cp.x, p.z - FL.cp.z); if (d > 460) { tab && tab.flash('מחוץ לטווח הרחפן (450 מ׳)'); return 'מחוץ לטווח הרחפן (450 מ׳)'; } u.sorties--; u.cd = 30; G.gear.gasDrone(p, arg && arg.root ? arg : null); say('o_drone'); this.notify('רחפן הגז יצא', `הרחפן בדרך ליעד, ${Math.round(d)} מ׳ מהחפ״ק. הוא יטיל שלושה רימוני גז.`, false); return true; }
    if (uid === 'spk') { if (u.cd > 0) return `הכריזה תהיה זמינה בעוד ${Math.ceil(u.cd)} ש׳`; u.cd = 22; const n = this.spkUsed = (this.spkUsed || 0) + 1; G.fsound.loudspeaker(); say('o_spk'); this.spkOnAir = G.time + 6;
      // most people step back; the committed ones stay (and it works less each time)
      const th = [.8, .64, .52][Math.min(2, n - 1)]; let moved = 0;
      after(1.2, () => { for (const a of G.crowd.agents) if (a.alive && a.x > -150 && a.bold < th && !a.breacher && (a.state === 'mill' || a.state === 'press' || a.state === 'walkto' || a.state === 'shuffle')) { a.state = 'walkto'; a.run = false; a.tx = a.x - rr(22, 48); a.tz = a.z + rr(-10, 10); a.cx = a.tx; a.cz = a.tz; a.rad = 10; a.bold *= .85; moved++; }
        for (const y of this.youths || []) if (!y.determined && !y.down && !y.arrested && y.alive && y.pos.x > -60) { y.plan = []; y.step = null; y.setPath([V3(y.pos.x - rr(25, 40), 0, y.pos.z + rr(-8, 8))], 1.5, () => { y.returnT = rr(25, 40); }); }
        this.notify('כריזה בערבית', moved > 20 ? `כ־${Math.round(moved / 10) * 10} אנשים מתרחקים מהקיר. הנחושים נשארים.` : 'רק מעטים זזו. מי שנשאר בקיר נחוש: צריך גז.', false); });
      this.tensionAdd(n === 1 ? -5 : -2); this.setThreat('spk', false); this.spkT = G.time; return true; }
    if (uid === 'res') { if (u.busy) return 'כוח הכוננות כבר בדרך'; if (!this.breach) { tab && tab.flash('אין פרצה לסגור כרגע'); return 'אין פרצה לסגור כרגע'; } u.busy = true; this.sendReserve(); return true; }
    if (uid === 'tank') { const post = arg; if (!post || !post.alive) return; if (u.cd > 0) return 'הטנק טוען'; u.cd = 40; this.tankFire(post); return true; }
    if (uid === 'air') { if (action === 'depot') { this.st.strikesAsked = true; this.notify('האוגדה: התקיפה תאושר בלילה', 'אין אישור לתקוף את מחסן הנשק בזמן ההפגנה, כדי לא להסלים. היעד יותקף אחרי החשכה.', false); say('o_airno'); return; }
      if (action === 'cell') { const cell = (this.balloonCell || []).filter(b => b.alive && !b.down); if (!cell.length) { tab && tab.flash('אין חוליית בלונים פעילה'); return 'אין חוליית בלונים פעילה'; } this.airStrike(cell); return true; } }
  }
  moveSnipers(u, where) {
    u.pos = where; const nests = G.bermNests; say(where === 'berm' ? 'o_berm' : 'o_wall');
    u.actors.forEach((a, i) => { if (!a.alive || a.down) return; a.atWall = false;
      if (where === 'berm') { const n = nests[(u.id === 'snA' ? 1 : 2) + (i ? (u.id === 'snA' ? -1 : 1) : 0)] || nests[0]; const tgt = n.clone().add(V3(0, 0, i ? 1.2 : -1.2)); a.setPath([V3(11, 0, a.pos.z), V3(15, 0, tgt.z), tgt], 3.2, () => { a.lookAt = V3(-120, 3, a.pos.z); a.aimFlat = false; a.aimPitch = -.05; }); }
      else { const p = a.post; a.setPath([V3(15, 0, a.pos.z), V3(11, 0, p.z), V3(4, 0, p.z), p.clone()], 3.2, () => { a.atWall = true; a.lookAt = V3(-60, 1.4, a.slit); a.aimFlat = true; }); } });
    this.notify(where === 'berm' ? `${u.name} עולה לסוללה` : `${u.name} חוזר לחרכים`, where === 'berm' ? 'הצלפים מתרחקים מהקיר ויתצפתו מהסוללה, 24 מטר אחורה. דרך החרכים כבר אי אפשר לפגוע בהם.' : 'הצלפים חוזרים לעמדות הצמודות לקיר.', false);
  }
  sniperShot(u, t, kind) {
    const shooter = u.actors.find(s => s.alive && !s.down && !s.path); if (!shooter) return G.tablet && G.tablet.flash('הצלפים בתנועה');
    const eye = shooter.eye(new THREE.Vector3());
    if (kind === 'warn') { const d = V3(-1, .6, 0).normalize(); G.fx.muzzle(eye.clone().add(V3(-.5, 0, 0)), d, .7); G.audio.shotAt(eye, 'm4'); for (const a of G.crowd.agents) if (a.alive && a.x > -120 && a.bold < .6 && Math.abs(a.z - shooter.pos.z) < 80) { a.state = 'flee'; a.tx = a.x - rr(20, 45); a.tz = a.z; } this.tensionAdd(2); say('o_warn'); return; }
    const tp = this.posOf(t).clone(); const chest = t.root ? t.chest(new THREE.Vector3()) : tp.clone().add(V3(0, 1.2, 0));
    if (!u.shut && !shooter.atWall ? !G.lineOfSight(eye, chest) : (shooter.atWall ? Math.abs(tp.z - shooter.pos.z) > 50 || u.shut : !G.lineOfSight(eye, chest))) return G.tablet && G.tablet.flash('לצלפים אין קו ראייה למטרה');
    let act = t.root ? t : this.promote(t); if (!act) return;
    const armed = act.armedVisible || (act.role === 'gunman' && this.gunmanWarned) || (act.role === 'ied' && act.pos.x > -60);
    if (kind === 'live' && !armed) { G.tablet && G.tablet.confirm('ירי חי באדם לא חמוש?', 'לפי הוראות הפתיחה באש, ירי חי מותר רק מול סכנת חיים מיידית. האדם הזה לא מזוהה כחמוש.', () => this.fireAt(u, shooter, act, 'live', false), true); return; }
    if (kind === 'ruger') { if (u.ruger <= 0) return; u.ruger--; }
    this.fireAt(u, shooter, act, kind, armed);
  }
  fireAt(u, shooter, act, kind, armed) {
    const eye = shooter.eye(new THREE.Vector3()); shooter.faceTo(act.pos); shooter.aiming = true;
    after(.6, () => { const mz = eye.clone().add(act.chest(new THREE.Vector3()).sub(eye).normalize().multiplyScalar(.8)); G.fx.muzzle(mz, act.chest(new THREE.Vector3()).sub(eye).normalize(), kind === 'ruger' ? .35 : .8); G.audio.shotAt(eye, 'm4');
      if (!act.alive) return; const legit = kind === 'ruger' ? ['instigator', 'ied', 'breacher', 'gunman'].includes(act.role) || act.armedVisible : armed; act.justified = legit;
      if (kind === 'ruger') { act.damage(35, eye, 'legs'); if (act.role === 'instigator') { this.notify('המסית נפגע ברגליו', 'הקבוצה שהוביל מתפזרת. הוא נפצע, ולכן זו לא תוצאה ללא נפגעים.', false); if (act.onGas) act.onGas(); } }
      else { act.damage(140, eye, 'body'); if (armed) { this.st.prevented.push(act.role === 'gunman' ? 'הפעיל החמוש נוטרל לפני שירה' : 'חבלן נוטרל'); if (act.role === 'gunman') this.gunmanDone = true; if (act.role === 'ied') this.iedAbort(); } }
      say(kind === 'ruger' ? 'o_ruger' : 'o_live'); });
  }
  sendReserve() {
    const r = this.reserve; say('o_res'); this.notify('כוח הכוננות יוצא לפרצה', 'האמר ושלושה לוחמים נוסעים בדרך הביטחון אל הפרצה בצפון.', false);
    for (const a of r) { a.root.visible = false; if (a.rifle) a.rifle.visible = false; a.noSnap = true; a.stop(); }
    const h = G.resHummer; this.resDrive = { h, pts: [V3(9.5, 0, 40), V3(9.5, 0, -140), V3(6.5, 0, FL.iedZ + 16)], i: 0 }; G.hotObjects = (G.hotObjects || []).concat([h]);
  }
  reserveArrive() {
    const h = G.resHummer; const r = this.reserve;
    r.forEach((a, i) => { a.root.visible = true; if (a.rifle) a.rifle.visible = true; a.noSnap = false; a.pos.set(h.position.x - 1.6, h.position.y, h.position.z + (i - 1) * 1.6); a.readyAim = true; a.setPath([V3(3 + i * 2.2, 0, FL.iedZ + (i - 1) * 3)], 3, () => { a.lookAt = V3(-20, 1, FL.iedZ); a.arrived = true; }); });
  }
  tankFire(post) {
    G.tablet && G.tablet.confirm('ירי פגז לעבר ' + post.name + '?', 'לפי התצפית יש בעמדה שני תצפיתנים של חמאס. הירי יהרוג אותם ועלול להביא להסלמה: ירי רקטות, הפגנות גדולות יותר מחר.', () => {
      const tk = G.tanks.reduce((b, t) => (!b || t.position.distanceTo(post.pos) < b.position.distanceTo(post.pos)) ? t : b, null);
      if (tk) { const tur = tk.userData.turret; const tp = post.pos.clone(); const lp = tk.worldToLocal(tp.clone()); tur.rotation.y = Math.atan2(lp.x, lp.z); }
      after(2, () => { const mz = tk ? tk.userData.gun.localToWorld(tk.userData.muzzleT.clone()) : post.pos; G.fx.muzzle(mz, post.pos.clone().sub(mz).normalize(), 3); G.fx.dustBurst(mz.clone().setY(hF(mz.x, mz.z)), 6, 40); G.audio.explosion(mz, .9);
        after(.9, () => { G.fx.explosion(post.pos, 1.6); G.audio.explosion(post.pos, 1.6); post.alive = false; if (post.manned) { post.manned = false; this.st.militants += 2; for (const l of this.lookouts.filter(l => l.post === post)) l.remove(); } this.tensionAdd(22); this.st.rockets++; this.notify('העמדה הושמדה', 'שני תצפיתנים של חמאס נהרגו. ההמון זועם, וחמאס מאיים להגיב בירי רקטות.', true); G.gear && G.gear.smokeColumn(post.pos); }); });
      say('o_tank'); }, true);
  }
  airStrike(cell) {
    G.tablet && G.tablet.confirm('תקיפת כטב״ם בחוליית הבלונים?', 'התקיפה תהרוג את שני המשגרים. זה יעצור את הבלונים, אבל בזמן הפגנה זו הסלמה משמעותית. גז מהרחפן יכול להבריח אותם בלי נפגעים.', () => {
      say('o_air'); after(2.5, () => G.fsound.jet()); after(4, () => { const p = cell[0].pos.clone(); G.fx.explosion(p.clone().add(V3(0, .5, 0)), 1.2); G.audio.explosion(p, 1.3); for (const b of cell) { b.militant = true; b.damage(200, p, 'body'); } this.balloonT = 1e9; this.tensionAdd(20); this.st.rockets++; this.notify('החוליה נפגעה', 'שני משגרי הבלונים נהרגו. הבלונים נעצרו, והמתח בשטח עלה מאוד.', true); }); }, true);
  }
  // ---------- per frame ----------
  update(dt) {
    if (this.waiting) { this.clockTick(0); return; }
    this.t += dt; this.clockTick(dt);
    for (let i = this.events.length - 1; i >= 0; i--) if (this.t >= this.events[i].at) { const e = this.events.splice(i, 1)[0]; e.fn(); }
    for (const u of this.units) { if (u.cd > 0) u.cd -= dt; }
    // slit shutters animate
    for (const s of G.slits) { const tgt = s.target ?? 1; s.open += Math.sign(tgt - s.open) * Math.min(Math.abs(tgt - s.open), dt * 2.5); s.shutter.rotation.z = -1.35 * s.open; }
    // balloons
    if (this.balloonCell && !this._cellGone) { const alive = this.balloonCell.filter(b => b.alive && !b.down && !b.coughT && !b.path && b.pos.x < -150); if (alive.length) { this.balloonT -= dt; if (this.balloonT <= 0) { this.balloonT = rr(26, 34); G.gear.launchBalloon(alive[0].pos.clone().add(V3(0, 2.2, 0))); if (!this._bFirst) { this._bFirst = true; this.notify('בלון תבערה שוגר', 'הבלון נסחף עם הרוח לעבר השדות שלנו. הרחק את החוליה (רחפן גז) כדי לעצור שיגורים.', false); } } }
      else if (!this._cellGone && this.balloonCell.every(b => !b.alive || b.down || (b.gassed && b.pos.x < -185) || b.path)) { if (this.balloonCell.some(b => b.gassed)) { this._cellGone = true; this.balloonT = 1e9; this.st.prevented.push('חוליית הבלונים הוברחה בגז'); this.notify('חוליית הבלונים ברחה', 'הגז הבריח את משגרי הבלונים.', false); for (const b of this.balloonCell) { b.plan = []; b.plan0 = []; b.determined = false; } } } }
    // grabbing at the slits
    for (const g of this.grabbers || []) { if (g.down || !g.alive || g.coughT) continue; const s = [...this.snA, ...this.snB].find(x => x.slit === g.grabSlit && x.atWall && x.alive); const u = this.snA.includes(s) ? this.U.snA : this.U.snB;
      if (s && !u.shut && g.pos.x > -2.2 && Math.abs(g.pos.z - g.grabSlit) < 2.5) { g.grabT = (g.grabT || 0) + dt; if (g.grabT > 2 && !g.grabbed) { g.grabbed = true; this.notify('מתפרעים מנסים למשוך נשק דרך החרך', `ליד החרך ${g.grabSlit}: ידיים נשלחות פנימה אל הרובה של הצלף. הרחק את הצלפים או סגור את החרכים.`, true); say('w_grab'); this.tensionAdd(4); } } }
    if (this.resDrive) { const d = this.resDrive, h = d.h, t = d.pts[d.i]; const dx = t.x - h.position.x, dz = t.z - h.position.z, L = Math.hypot(dx, dz); if (L < 1) { d.i++; if (d.i >= d.pts.length) { this.resDrive = null; this.reserveArrive(); } } else { const sp = Math.min(13, L * 1.2 + 3); h.position.x += dx / L * sp * dt; h.position.z += dz / L * sp * dt; h.position.y = hF(h.position.x, h.position.z); h.rotation.y = Math.atan2(dx, dz); } }
    // breach: anyone who crossed into Israel must be stopped
    if (this.breach) { this.breachT += dt; const inside = G.crowd.agents.filter(a => a.alive && a.x > 1.5 && !a.arrested);
      for (const a of inside) { if (!a.inIL) { a.inIL = true; a.state = 'walkto'; a.tx = rr(14, 26); a.tz = FL.iedZ + rr(-15, 4); a.run = true; this.st.infiltrated++; a.onward = G.time + rr(8, 16); } else if (a.onward && G.time > a.onward && a.state === 'mill') { a.onward = 0; a.state = 'walkto'; a.tx = rr(44, 60); a.tz = a.z + rr(-20, 20); a.run = false; } }
      const res = this.reserve.filter(r => r.arrived); if (res.length) for (const a of inside) { if (Math.hypot(a.x - res[0].pos.x, a.z - res[0].pos.z) < 45) { a.arrested = true; a.state = "arrested"; a.act = "cough"; a.sp = 0; after(9, () => { a.alive = false; }); } }
      if (res.length && !this.breachClosed) { this.breachClosed = true; after(8, () => { this.st.prevented.push('החודרים נעצרו והפרצה נסגרה בלי נפגעים'); this.notify('הפרצה נסגרה', `כוח הכוננות עצר ${this.st.infiltrated} חודרים. אין נפגעים.`, false); say('w_closed'); this.breach.open = false; G.crowd.breach = null; this.setThreat('breach', false); }); }
      if (!this.breachClosed && inside.some(a => a.x > 36)) { this.breach = null; bus.emit('missionFailed', 'מתפרעים חדרו דרך הפרצה לשטח ישראל והגיעו לסוללה.<br><span style="font-size:16px;font-weight:500;display:block;margin-top:10px;color:#d6cab2">פרצה בגדר צריך לסגור מיד: כוח הכוננות או גז אל הפרצה. נסה שוב.</span>'); } }
    // tension: people pressing the wall and stones raise it; gas, distance and the end of the day lower it
    this.tT = (this.tT || 0) - dt; if (this.tT <= 0) { this.tT = .5; const nearM = G.crowd.count2(-25, 0); const nearK = (this.keys || []).filter(k => k.alive && !k.down && k.pos.x > -30 && k.pos.x < 2).length; const gasN = G.crowd.gasClouds.filter(c => c.x > -120).length;
      const d = (this.stage >= 1 && this.stage < 5 ? .05 : 0) + Math.min(50, nearM) * .005 + nearK * .03 - gasN * .2 - (this.stage >= 5 ? .5 : 0); this.tension = clamp(this.tension + d * .5, 4, 100); this.updateTension(); this.checkThreats(); }
    // player standing at a slit during the surge is in danger (as the snipers are)
    if (this.stage >= 4 && !this._playerWarn && G.player.pos.x < 2 && Math.abs(G.player.pos.z) < 72) { this._playerWarn = true; this.notify('אתה צמוד לקיר', 'מפקד האירוע לא צריך להיות בחרכים. חזור לחפ״ק.', true); }
    this.dusk = sstep(250, 420, this.t);
  }
  lookAt(t, mark = false) { G.tablet && G.tablet.show('drone'); G.drone.target.copy(this.posOf(t)); G.drone.fov = G.drone.fovT = 6; if (mark && t.root) G.tablet.mark(t, true); }
  // ---------- the task card: what is happening now and the recommended orders ----------
  setThreat(id, on = true) { const T = this.threats || (this.threats = {}); if (on) { if (!T[id]) T[id] = G.time; } else delete T[id]; this.refreshTask(); }
  checkThreats() {
    if (this.stage >= 5 || !this.threats) return; const T = this.threats; const ok = a => a && a.alive && !a.removed && !a.down && !a.arrested;
    const set = (id, on) => { if (!!T[id] !== !!on) this.setThreat(id, on); };
    const wallN = G.crowd.count2(-24, 0);
    set('wall', this.stage >= 1 && this.spkUsed && G.time - this.spkT > 7 && wallN >= 16 && !(this.gasWallT && G.time - this.gasWallT < 22) && !T.surge);
    set('balloon', this.balloonCell && !this._cellGone && this.balloonCell.some(ok));
    set('instigator', this.instigator && ok(this.instigator) && !this.instBroken && this.instigator.pos.x > -160);
    set('surge', T.surge && G.time - this.surgeT < 55 && !(this.gasWallT && G.time - this.gasWallT < 14 && G.crowd.gasClouds.filter(c => c.x > -45).length >= 2));
    this.refreshTask();
  }
  gunmanThreat() { const g = this.gunman; return g && this.gunmanWarned && g.alive && !g.down && !this.gunmanDone && !this.gunmanGaveUp; }
  refreshTask() {
    if (!G.command) return; const T = this.threats || {};
    let id = ['breach', 'charge', 'ied', 'surge', 'balloon', 'instigator', 'wall', 'spk'].find(k => T[k]);
    if (this.gunmanThreat()) id = 'gunman';
    const t = id ? this.taskDef(id) : { kind: 'מצב', title: (this.calm && this.calm.title) || 'שמור על המרחק מהקיר', text: (this.calm && this.calm.text) || '', acts: [{ icon: 'spk', label: 'כריזה', fn: () => this.order('spk') }, { icon: 'tab', label: 'טאבלט', cls: 'alt', fn: () => G.tablet.show('drone') }] };
    const sig = id + '|' + t.title + '|' + t.acts.map(a => a.label).join(',');
    if (sig === this._taskSig) return; this._taskSig = sig; G.command.setTask(t);
  }
  taskDef(id) {
    const U = this.U; const ok = a => a && a.alive && !a.removed && !a.down;
    const eye = (o, ir = false) => ({ icon: 'eye', label: 'הראה ברחפן', cls: 'alt', fn: () => { this.lookAt(o, !!(o && o.root)); if (ir) G.drone.ir = true; } });
    const gasAt = (p, label) => ({ icon: 'gas', label, fn: () => G.command.startAim('gas', p) });
    const exposed = [U.snA, U.snB].filter(u => u.pos === 'wall' && !u.shut);
    switch (id) {
      case 'spk': return { kind: 'המון', title: 'המפגינים מתקרבים לקיר', text: 'מתחילים באזהרה: כריזה בערבית מרחיקה את רוב האנשים, בלי לפגוע באיש.', hot: 'spk', acts: [{ icon: 'spk', label: 'הפעל כריזה', fn: () => this.order('spk') }] };
      case 'wall': return { kind: 'המון', title: 'קבוצה נשארה צמודה לקיר', text: 'הנחושים לא זזו מהכריזה. גז על הקבוצה, כ־25 מ׳ מהקיר: הרוח נושבת אלינו ותסחף אותו קדימה.', hot: 'gas', acts: [gasAt(this.bestGasTarget(), 'כוון גז לקבוצה'), { icon: 'spk', label: 'כריזה נוספת', cls: 'alt', fn: () => this.order('spk') }] };
      case 'balloon': { const c = this.balloonCell.find(ok); return { kind: 'איום', threat: true, title: 'חוליית בלוני תבערה', text: 'שני משגרים מדרום למאהל. גז מהרחפן יבריח אותם בלי נפגעים. תקיפה מהאוויר תהרוג אותם ותסלים את המצב.', hot: 'drone', acts: [{ icon: 'drone', label: 'רחפן גז לחוליה', fn: () => this.order('drone', 'fire', c) }, eye(c), { icon: 'air', label: 'תקיפה מהאוויר', cls: 'danger', fn: () => this.order('air', 'cell') }] }; }
      case 'instigator': { const a = this.instigator; const p = V3(Math.min(a.pos.x - 4, -24), 0, a.pos.z); p.y = hF(p.x, p.z); return { kind: 'איום', threat: true, title: 'מסית עם רמקול', text: 'מעיל אדום ורמקול. הוא מוביל עשרות צעירים לקיר. גז על הקבוצה שלו יפרק אותה. רוגר לרגליים מותר, אבל זו פגיעה.', hot: 'gas', acts: [gasAt(p, 'גז על הקבוצה'), eye(a), { icon: 'rifle', label: 'רוגר לרגליים', cls: 'danger', fn: () => { const u = [U.snB, U.snA].find(u => u.pos === 'berm') || U.snA; return this.order(u.id, 'ruger', a); } }] }; }
      case 'ied': { const a = this.ied.find(ok) || this.ied[0]; return { kind: 'איום', threat: true, title: 'חבלנים זוחלים לגדר', text: 'שני רעולי פנים עם תיק, בצפון, ליד הגדר. גז יבריח אותם לפני שיניחו מטען. בעשן רואים אותם רק בתרמי.', hot: 'drone', acts: [{ icon: 'drone', label: 'רחפן גז לחבלנים', fn: () => this.order('drone', 'fire', a) }, gasAt(a.pos.clone(), 'גז מהצוות'), eye(a, true)] }; }
      case 'charge': return { kind: 'איום', threat: true, title: 'מטען בגדר!', text: 'החבלנים בורחים. כשהמטען יתפוצץ תיפתח פרצה. כוח הכוננות מוכן לצאת ברגע שזה קורה.', acts: [eye(this.iedPos)] };
      case 'breach': return { kind: 'איום', threat: true, title: 'פרצה בגדר', text: 'צעירים רצים לפרצה ועוברים לצד שלנו. כוח הכוננות סוגר אותה ועוצר אותם. גז אל הפרצה עוצר את הבאים.', hot: '', acts: [...(U.res.busy ? [] : [{ icon: 'res', label: 'שלח כוח כוננות', fn: () => this.order('res') }]), gasAt(V3(-22, hF(-22, FL.iedZ), FL.iedZ), 'גז מול הפרצה'), eye(V3(-1, 0, FL.iedZ))] };
      case 'surge': return { kind: 'איום', threat: true, title: 'הסתערות על הקיר', text: exposed.length ? 'מאות רצים לקיר, חלקם לחרכים. גז לאורך הקיר, והרחקת הצלפים מהחרכים.' : 'מאות רצים לקיר. הצלפים מוגנים. גז לאורך הקיר ירחיק את ההמון.', hot: 'gas', acts: [gasAt(this.bestGasTarget(), 'גז לאורך הקיר'), ...(exposed.length ? [{ icon: 'snipers', label: 'צלפים לסוללה', cls: 'alt', fn: () => this.orderSnipers('berm') }, { icon: 'slits', label: 'סגור חרכים', cls: 'alt', fn: () => this.orderSlits(true) }] : [])] };
      case 'gunman': { const g = this.gunman; const safe = !this.snA.some(s => s.alive && s.atWall) || U.snA.shut;
        if (safe) return { kind: 'התראה חמה', threat: true, title: 'המחבל החמוש עדיין בשטח', text: 'הצלפים מוגנים: ' + (U.snA.shut ? 'החרכים סגורים.' : 'הם על הסוללה.') + ' אל תחזיר אותם לחרכים עד שהוא יתרחק.', acts: [eye(g)] };
        return { kind: 'התראה חמה', threat: true, title: 'מחבל חמוש בדרך לחרכים', text: 'חולצה שחורה, כובע מצחייה, אקדח בחגורה. הוא מתכוון לירות על הצלפים דרך החרכים. הרחק אותם לסוללה או סגור את החרכים.', hot: 'snipers', acts: [{ icon: 'snipers', label: 'צלפים לסוללה', fn: () => this.orderSnipers('berm') }, { icon: 'slits', label: 'סגור חרכים', fn: () => this.orderSlits(true) }, eye(g)] }; }
    }
    return { title: '', text: '', acts: [] };
  }
  orderSnipers(where) {
    const us = [this.U.snA, this.U.snB]; if (us.some(u => u.actors.some(a => a.path))) return 'הצלפים בתנועה';
    const toBerm = where ? where === 'berm' : us.some(u => u.pos === 'wall'); let n = 0;
    for (const u of us) if (u.actors.some(a => a.alive && !a.down) && (u.pos === 'wall') === toBerm) { this.moveSnipers(u, toBerm ? 'berm' : 'wall'); n++; }
    if (!n) return toBerm ? 'הצלפים כבר על הסוללה' : 'הצלפים כבר בקיר';
    setTimeout(() => this.refreshTask(), 50); return true;
  }
  orderSlits(shut) {
    const us = [this.U.snA, this.U.snB].filter(u => u.pos === 'wall'); if (!us.length) return 'הצלפים על הסוללה, החרכים ריקים';
    if (shut === undefined) shut = !us.every(u => u.shut); let n = 0;
    for (const u of us) if (u.shut !== shut) { this.order(u.id, 'shut'); n++; }
    return n ? true : (shut ? 'החרכים כבר סגורים' : 'החרכים כבר פתוחים');
  }
  gasFrom() { const a = this.gasTeam.filter(x => x.alive && !x.down); const p = V3(0, 0, 0); for (const x of a) p.add(x.pos); return a.length ? p.multiplyScalar(1 / a.length).add(V3(0, 1.4, 0)) : V3(6, 1.4, -22); }
  // where a gas volley would move the most people off the wall (upwind of them, since the breeze carries it east)
  bestGasTarget(x0 = -75, x1 = -6) {
    const cell = 10, bins = new Map();
    for (const a of G.crowd.agents) { if (!a.alive || a.x < x0 || a.x > x1 || Math.abs(a.z) > 110) continue; const k = Math.floor(a.x / cell) * 1000 + Math.floor(a.z / cell); const b = bins.get(k) || { n: 0, x: 0, z: 0 }; b.n++; b.x += a.x; b.z += a.z; bins.set(k, b); }
    let best = null; for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    if (!best) return V3(-30, hF(-30, 0), 0);
    const x = Math.min(best.x / best.n - 6, -24), z = best.z / best.n; return V3(x, hF(x, z), z);
  }
  // ---------- markers over threats and our units (main view) ----------
  markers() {
    const L = []; const T = this.threats || {}; const ok = a => a && a.alive && !a.removed && !a.down && !a.arrested;
    if (T.balloon) { const b = this.balloonCell.find(ok); if (b) L.push({ id: 'bal', pos: b.pos, label: 'בלוני תבערה', kind: 'threat' }); }
    if (T.instigator && ok(this.instigator)) L.push({ id: 'inst', pos: this.instigator.pos, label: 'מסית', kind: 'threat' });
    if (T.ied) { const b = this.ied.find(ok); if (b) L.push({ id: 'ied', pos: b.pos, label: 'חבלנים', kind: 'threat', h: 1.6 }); }
    if (T.charge && this.iedPos) L.push({ id: 'chg', pos: this.iedPos, label: 'מטען', kind: 'threat', h: 1.4 });
    if (T.breach) L.push({ id: 'br', pos: V3(-1, 0, FL.iedZ), label: 'פרצה', kind: 'threat', h: 3.2 });
    if (this.gunmanThreat()) L.push({ id: 'gun', pos: this.gunman.pos, label: 'חמוש', kind: 'threat' });
    const avg = arr => { const a = arr.filter(x => x.alive && !x.removed); if (!a.length) return null; const p = V3(0, 0, 0); for (const x of a) p.add(x.pos); return p.multiplyScalar(1 / a.length); };
    for (const [u, lbl] of [[this.U.snA, 'צלפי מג״ב'], [this.U.snB, 'צלפי גולני']]) { const p = avg(u.actors); if (!p) continue; const moving = u.actors.some(a => a.path); const danger = u.pos === 'wall' && !u.shut && !moving && this.gunmanThreat() && u === this.U.snA;
      L.push({ id: u.id, pos: p, label: lbl + (moving ? ' · בתנועה' : u.pos === 'wall' ? (u.shut ? ' · חרכים סגורים' : ' · בחרכים') : ' · סוללה'), kind: danger ? 'unit warn' : 'unit', h: 2.1 }); }
    const gp = avg(this.gasTeam); if (gp) L.push({ id: 'gasT', pos: gp, label: 'צוות גז', kind: 'unit', h: 2.1 });
    if (G.spkPos) L.push({ id: 'spkH', pos: G.spkPos, label: this.spkOnAir > G.time ? 'כריזה · משדר' : 'כריזה', kind: this.spkOnAir > G.time ? 'unit warn' : 'unit', h: .9 });
    if (this.breach || this.U.res.busy) { const h = G.resHummer; L.push({ id: 'res', pos: this.resDrive ? h.position : (avg(this.reserve) || h.position), label: 'כוננות', kind: 'unit', h: 2.4 }); }
    return L;
  }
  // ---------- intel & notifications ----------
  addIntel(from, text, red = false, go = null) { const it = { t: G.missionClock, from, text, red, go, isNew: true }; this.intel.unshift(it); G.tablet && G.tablet.onIntel(it); this.notify(from, text, red, true); }
  notify(h, text, red, intel = false) { const n = $('notif'); if (!n) return; $('notifH').textContent = h; $('notifT').textContent = text; n.className = 'on' + (red ? ' red' : ''); n.onclick = () => G.tablet && G.tablet.show(intel ? 'intel' : 'drone'); clearTimeout(this._nt); this._nt = setTimeout(() => n.className = '', red ? 9000 : 6500); if (G.tablet) G.tablet.toast(h, text, red); if (red) G.audio.squelch && G.audio.squelch(); }
  // ---------- identification for the tablet ----------
  identify(o) {
    if (o.friendly) return { name: o.name || 'כוח שלנו', desc: o.atWall ? 'בעמדה צמודה לקיר.' : 'בעמדה.', threat: false, unit: true };
    const r = o.role; const warned = this.gunmanWarned;
    if (r === 'gunman') return warned ? { name: 'תואם את תיאור השב״כ', desc: 'חולצה שחורה, ג׳ינס, כובע מצחייה. פעיל חמאס חמוש באקדח. ' + (o.armedVisible ? 'האקדח שלוף!' : 'האקדח מוסתר.'), threat: true } : { name: 'מפגין', desc: 'צעיר בחולצה שחורה ובכובע. אין עליו מידע כרגע.', threat: false };
    if (r === 'instigator') return { name: 'מסית מרכזי (חמאס)', desc: 'מעיל אימונים אדום, רמקול. מוביל קבוצה לקיר. רוגר לרגליים מותר נגדו, אבל זו פגיעה.', threat: true };
    if (r === 'ied') return { name: 'חבלן', desc: 'רעול פנים בשחור, זוחל לגדר. ' + (o === this.ied[0] ? 'נושא תיק: ככל הנראה מטען.' : 'מלווה את נושא המטען.'), threat: true };
    if (r === 'balloon') return { name: 'משגר בלוני תבערה', desc: 'חוליית הבלונים מדרום למאהל. גז מהרחפן יבריח אותם.', threat: true };
    if (r === 'lookout') return { name: 'תצפיתן של חמאס', desc: 'על גג עמדת התצפית. מדווח לחמאס על תנועות הכוח.', threat: false };
    if (r === 'kid' || o.kid) return { name: 'ילד', desc: 'ילד בין המפגינים. אסור לפגוע בו.', threat: false, kid: true };
    if (r === 'medic') return { name: 'חובש', desc: 'אפוד לבן עם סהר אדום. צוות רפואי.', threat: false };
    if (r === 'press') return { name: 'צלם עיתונות', desc: 'אפוד PRESS כחול. מתעד את ההפגנה.', threat: false };
    if (r === 'youth') return { name: 'מתפרע', desc: 'זורק אבנים לעבר הקיר. לא חמוש.', threat: false };
    if (r === 'breacher') return { name: 'חודר', desc: 'עבר את הגדר לשטח ישראל. לא חמוש.', threat: false };
    return { name: 'מפגין', desc: o.kid ? 'ילד.' : 'לא מזוהה כאיום.', threat: false };
  }
  // ---------- tablet map ----------
  drawMap(g, W, H, v = {}) {
    const x0 = v.x0 ?? -320, x1 = v.x1 ?? 90; const zc = v.zc ?? 0; const span = (x1 - x0) * H / W; const z0 = zc - span / 2;
    const px = x => (x - x0) / (x1 - x0) * W, pz = z => (z - z0) / span * H; this._map = { x0, x1, z0, span, W, H };
    g.fillStyle = '#1d1c16'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a261c'; g.fillRect(0, 0, px(0), H); g.fillStyle = '#20231b'; g.fillRect(px(0), 0, W - px(0), H);
    g.strokeStyle = 'rgba(232,220,196,.06)'; g.lineWidth = 1; for (let x = Math.ceil(x0 / 50) * 50; x < x1; x += 50) { g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), H); g.stroke(); } for (let z = Math.ceil(z0 / 50) * 50; z < z0 + span; z += 50) { g.beginPath(); g.moveTo(0, pz(z)); g.lineTo(W, pz(z)); g.stroke(); }
    // fields, roads, berm
    g.fillStyle = '#3a3526'; g.fillRect(px(4), 0, px(11) - px(4), H); g.fillStyle = '#4a4232'; g.fillRect(px(FL.bermX - 8), pz(-FL.bermZ), px(FL.bermX + 8) - px(FL.bermX - 8), pz(FL.bermZ) - pz(-FL.bermZ));
    // barrier: wall (thick) and fence
    g.strokeStyle = '#9a9a92'; g.lineWidth = 2; g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), H); g.stroke(); g.strokeStyle = '#d8d2c0'; g.lineWidth = 5; g.beginPath(); g.moveTo(px(0), pz(-FL.wallZ)); g.lineTo(px(0), pz(FL.wallZ)); g.stroke();
    g.strokeStyle = 'rgba(200,190,170,.5)'; g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(px(FL.wire), 0); g.lineTo(px(FL.wire), H); g.stroke(); g.setLineDash([]);
    for (const s of G.slits || []) { g.fillStyle = s.open > .5 ? '#f2b84b' : '#6a6b60'; g.fillRect(px(0) - 4, pz(s.z) - 2, 8, 4); }
    if (this.breach) { g.fillStyle = '#e0533d'; g.beginPath(); g.arc(px(0), pz(this.breach.z), 6, 0, 7); g.fill(); }
    // tents, stage, posts, depot, fires
    g.fillStyle = 'rgba(226,221,208,.35)'; g.fillRect(px(FL.tents[0]), pz(-FL.tentZ), px(FL.tents[1]) - px(FL.tents[0]), pz(FL.tentZ) - pz(-FL.tentZ));
    for (const s of G.fireSpots || []) if (s.lit) { g.fillStyle = '#e07a2a'; g.beginPath(); g.arc(px(s.p.x), pz(s.p.z), 4, 0, 7); g.fill(); g.fillStyle = 'rgba(30,30,30,.35)'; g.beginPath(); g.ellipse(px(s.p.x + 40), pz(s.p.z + 8), 40 / (x1 - x0) * W + 6, 8, 0, 0, 7); g.fill(); }
    for (const p of G.posts || []) { g.strokeStyle = p.alive ? '#7fb07a' : '#6a6b60'; g.lineWidth = 2; g.strokeRect(px(p.x) - 6, pz(p.z) - 6, 12, 12); g.fillStyle = g.strokeStyle; g.font = '11px Heebo'; g.textAlign = 'center'; g.fillText(p.name, px(p.x), pz(p.z) - 10); }
    // crowd density
    g.fillStyle = 'rgba(224,83,61,.55)'; for (const a of G.crowd.agents) if (a.alive) { const X = px(a.x), Y = pz(a.z); if (X > 0 && X < W && Y > 0 && Y < H) g.fillRect(X - 1, Y - 1, 2.2, 2.2); }
    // gas clouds
    for (const c of G.crowd.gasClouds) { g.fillStyle = `rgba(230,230,210,${.25 * c.k})`; g.beginPath(); g.arc(px(c.x), pz(c.z), c.r / (x1 - x0) * W + 3, 0, 7); g.fill(); }
    // key people known to intel
    const dot = (p, col, lbl) => { g.fillStyle = col; g.beginPath(); g.arc(px(p.x), pz(p.z), 4.5, 0, 7); g.fill(); if (lbl) { g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText(lbl, px(p.x), pz(p.z) - 8); } };
    for (const m of (G.tablet && G.tablet.marks) || []) { const p = this.posOf(m.obj); dot(p, m.threat ? '#ff6a50' : '#f2b84b', m.label); }
    // our forces
    for (const a of G.actors) if (a.friendly && a.alive) { g.fillStyle = a.down ? '#e0533d' : '#9ac0e6'; g.fillRect(px(a.pos.x) - 3, pz(a.pos.z) - 3, 6, 6); }
    for (const t of G.tanks || []) { g.strokeStyle = '#9ac0e6'; g.lineWidth = 2; g.strokeRect(px(t.position.x) - 6, pz(t.position.z) - 4, 12, 8); }
    g.fillStyle = '#f2b84b'; g.beginPath(); g.arc(px(G.player.pos.x), pz(G.player.pos.z), 5, 0, 7); g.fill(); g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText('אתה', px(G.player.pos.x), pz(G.player.pos.z) + 16);
    if (G.drone) { const d = G.drone.target; g.strokeStyle = '#e8f0e0'; g.lineWidth = 1.5; g.beginPath(); g.arc(px(d.x), pz(d.z), 9, 0, 7); g.stroke(); g.beginPath(); g.moveTo(px(d.x) - 14, pz(d.z)); g.lineTo(px(d.x) + 14, pz(d.z)); g.moveTo(px(d.x), pz(d.z) - 14); g.lineTo(px(d.x), pz(d.z) + 14); g.stroke(); }
    // wind arrow
    g.save(); g.translate(W - 40, 36); g.rotate(Math.atan2(G.wind.z, G.wind.x)); g.strokeStyle = '#e8dcc4'; g.lineWidth = 2; g.beginPath(); g.moveTo(-14, 0); g.lineTo(14, 0); g.lineTo(8, -5); g.moveTo(14, 0); g.lineTo(8, 5); g.stroke(); g.restore(); g.fillStyle = '#a39a86'; g.font = '11px Heebo'; g.textAlign = 'center'; g.fillText('רוח', W - 40, 58);
    g.fillStyle = 'rgba(232,220,196,.6)'; g.font = '12px Heebo'; g.textAlign = 'right'; g.fillText('רצועת עזה', px(0) - 10, 18); g.textAlign = 'left'; g.fillText('ישראל', px(0) + 10, 18);
    if (v.brief) { g.fillStyle = '#9ac0e6'; g.textAlign = 'center'; g.fillText('חפ״ק', px(FL.cp.x), pz(FL.cp.z) + 18); g.fillText('סוללה', px(FL.bermX), pz(-FL.bermZ) - 6); g.fillStyle = '#d8d2c0'; g.fillText('הקיר', px(0) + 20, pz(-FL.wallZ) - 6); g.fillStyle = 'rgba(226,221,208,.8)'; g.fillText('מאהל', px((FL.tents[0] + FL.tents[1]) / 2), pz(0)); }
  }
  // ---------- end ----------
  finish() {
    if (G.state !== 'play') return; say('e1'); this.done = true; G.stats.end = performance.now();
    const s = this.st; const clean = s.idfHurt === 0 && s.protHurt === 0 && s.dead === 0 && s.militants === 0;
    bus.emit('missionComplete', { clean });
  }
  fillEnd() {
    const s = this.st; const secs = Math.round((G.stats.end - G.stats.start) / 1000);
    $('st-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; $('st-idf').textContent = s.idfHurt; $('st-prot').textContent = s.protHurt; $('st-dead').textContent = s.dead + s.militants;
    const perfect = s.idfHurt === 0 && s.protHurt === 0 && s.dead === 0 && s.militants === 0;
    const good = s.idfHurt === 0 && s.protHurtUnjust === 0 && s.dead === 0;
    $('endGrade').innerHTML = perfect ? 'אף אחד לא נפגע.<small>הירי דרך החרך נמנע, וגם בצד השני אין נפגעים. זו המטרה.</small>' : good ? 'האירוע נמנע.<small>אין נפגעים בצד שלנו. היו נפגעים בצד השני, כולם מירי מוצדק.</small>' : s.idfHurt === 0 ? 'הלוחמים שלמים, אבל היו פגיעות מיותרות.<small>פגיעה במי שלא היווה איום היא כישלון, גם כשהמשימה הושלמה.</small>' : 'היו נפגעים בצד שלנו.<small>ההתראות הגיעו בזמן. אפשר היה למנוע את זה.</small>';
    const li = []; for (const p of s.prevented) li.push([p, false]);
    if (s.fires) li.push([`${s.fires} שריפות בשדות שלנו מבלוני תבערה`, true]);
    for (const v of s.violations) li.push([v, true]);
    if (s.militants) li.push([`${s.militants} פעילי חמאס נהרגו`, true]);
    if (s.kidsGassed) li.push(['ילדים נחשפו לגז מדמיע', true]);
    if (s.rockets) li.push(['הירי והתקיפות הגבירו את המתח, וחמאס איים בירי רקטות', true]);
    if (s.strikesAsked || true) li.push(['בלילה תקף חיל האוויר ארבעה מחסני נשק של חמאס (כפי שקרה במציאות)', false]);
    $('endList').innerHTML = li.map(([t, b]) => `<li class="${b ? 'bad' : ''}">${t}</li>`).join('');
  }
}
