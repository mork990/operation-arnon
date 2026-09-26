// Personal gear (rifle / 1.5" gas launcher / binoculars), gas canisters and clouds, the gas drone,
// stones, incendiary balloons, the IED at the fence and the breach it blows.
import * as THREE from 'three';
import { G, rr, R, clamp, lerp, V3, bus, after } from '../core.js';
import { Input } from '../player.js';
import { hF, FL } from './world.js';

const $ = id => document.getElementById(id);
const V = new THREE.Vector3(), P = new THREE.Vector3();

export class Gear {
  constructor() {
    this.mode = null; this.eyeGas = 0; this.bino = false; this.hideRifle = false; this.gasAmmo = 12; this.gasReload = 0; this.fireReq = false; this._fired = false;
    this.projectiles = []; this.balloons = []; this.drones = []; this.fires = []; this.columns = [];
    const std = o => new THREE.MeshStandardMaterial(o);
    this.M = { can: std({ color: '#3d4a36', roughness: .6, metalness: .4 }), stone: std({ color: '#9b907c', roughness: 1 }), dark: std({ color: '#1f201e', roughness: .5, metalness: .6 }), olive: std({ color: '#4d5236', roughness: .8 }), rotor: new THREE.MeshBasicMaterial({ color: '#111', transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false }), rag: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.4, .4) }) };
    this.canGeo = new THREE.CylinderGeometry(.03, .03, .12, 8); this.stoneGeo = new THREE.DodecahedronGeometry(.06, 0);
    this.buildLauncher();
    // the commander starts empty-handed (orders, tablet); binoculars, rifle and the personal gas launcher are a key / tap away
    bus.on('key', k => { if (G.state !== 'play' || (G.tablet && G.tablet.open)) return; const m = { KeyV: 'bino', KeyX: 'rifle', KeyZ: 'gas', KeyQ: 'cmd' }[k]; if (m) this.set(this.mode === m ? 'cmd' : m); });
    document.querySelectorAll('#gearbar button').forEach(b => { const go = e => { e.preventDefault(); e.stopPropagation(); this.set(b.dataset.gear === this.mode ? 'cmd' : b.dataset.gear); }; b.addEventListener('click', go); b.addEventListener('touchstart', go, { passive: false }); });
    this.set('cmd', true);
  }
  // ---------- the 1.5" gas launcher, held by the same arms that hold the rifle ----------
  buildLauncher() {
    const w = G.weapon; if (!w || !w.rifle) return; const g = new THREE.Group(); const M = this.M;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, .46, 14), M.dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, .075, -.27); g.add(barrel);
    const bore = new THREE.Mesh(new THREE.CircleGeometry(.021, 12), new THREE.MeshBasicMaterial({ color: '#050505' })); bore.position.set(0, .075, -.501); bore.rotation.y = Math.PI; g.add(bore);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(.045, .06, .2), M.dark); frame.position.set(0, .05, -.02); g.add(frame);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(.035, .11, .045), M.olive); grip.position.set(0, -.03, .01); grip.rotation.x = .25; g.add(grip);
    const fg = new THREE.Mesh(new THREE.BoxGeometry(.05, .045, .16), M.olive); fg.position.set(0, .035, -.26); g.add(fg);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(.04, .09, .26), M.olive); stock.position.set(0, .04, .2); stock.rotation.x = -.06; g.add(stock);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(.012, .035, .02), M.dark); sight.position.set(0, .115, -.1); g.add(sight);
    g.traverse(c => { if (c.isMesh) { c.frustumCulled = false; c.material = c.material.clone(); } }); g.visible = false; w.rifle.add(g); this.launcher = g;
    this.rifleMeshes = []; w.rifle.traverse(c => { if (c.isMesh && !g.children.includes(c) && c !== bore) this.rifleMeshes.push(c); });
  }
  needsLock() { return this.mode === 'rifle' || this.mode === 'gas'; }
  set(mode, silent = false) {
    if (this.mode === mode) return; this.mode = mode; const w = G.weapon;
    document.querySelectorAll('#gearbar button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gear === mode)));
    const gas = mode === 'gas'; if (this.launcher) { this.launcher.visible = gas; for (const m of this.rifleMeshes) if (m.parent !== this.launcher) m.visible = !gas && m.name !== 'Sight'; }
    this.bino = mode === 'bino'; this.hideRifle = this.bino || mode === 'cmd';
    document.body.classList.toggle('cmdmode', !this.needsLock());
    // commanding uses a free mouse cursor (click the buttons, drag to look); the rifle and launcher use pointer lock
    const wasFree = G.freeCursor; G.freeCursor = !this.needsLock();
    if (G.freeCursor && !wasFree && document.pointerLockElement) { G.noPauseOnUnlock = true; document.exitPointerLock(); setTimeout(() => { G.noPauseOnUnlock = false; }, 300); }
    if (!G.freeCursor && G.state === 'play' && G.lock) G.lock();
    if (G.command && mode !== 'cmd' && mode !== 'bino') G.command.endAim();
    if (silent) { if (this.bino) G.player.fovBase = 9.5; return; }
    if (this.bino) { G.player.fovBase = 9.5; G.audio.playS('cloth', { vol: .5 }); } else G.player.fovBase = G.fovBase0 || 54;
    $('wname').textContent = gas ? 'מטול גז 1.5"' : this.bino ? 'משקפת 7x' : mode === 'cmd' ? '' : 'M4A1';
    G.audio.playS('gear', { vol: .5 });
  }
  pre(dt) { // runs before the rifle so the rifle never fires while another tool is in hand
    if (this.mode !== 'rifle') { this.fireReq = Input.fire; Input.fire = false; if (Input.reloadReq) { Input.reloadReq = false; if (this.mode === 'gas') this.reloadGas(); } }
    if (this.mode === 'bino' || this.mode === 'cmd') { Input.ads = false; Input.adsToggle = false; }
  }
  reloadGas() { if (this.gasReload > 0 || this.gasLoaded) return; this.gasReload = 1.6; G.audio.gunMech('mag_out'); }
  hud() {
    if (this.mode === 'gas') { $('ammo').textContent = this.gasLoaded ? '1' : '0'; $('res').textContent = this.gasAmmo; }
    else if (this.mode === 'bino') { $('ammo').textContent = '7x'; $('res').textContent = ''; }
    const cr = $('cross'); if (this.mode === 'bino') cr.style.opacity = 0; else if (this.mode === 'cmd') cr.style.opacity = G.command && G.command.aim && G.freeCursor && !G.isTouch ? 0 : .55;
  }
  // ---------- projectiles ----------
  launchGas(from, to, kind = 'launcher') {
    const d = Math.hypot(to.x - from.x, to.z - from.z); const T = clamp(d / 32, .8, 4.2); const vy = ((to.y + .1) - from.y + .5 * 9.8 * T * T) / T;
    const v = V3((to.x - from.x) / T, vy, (to.z - from.z) / T); this.spawnCan(from, v, kind);
    if (kind === 'launcher') { G.fsound.thump(from); G.fx.smoke.emit(from, V3(rr(-.3, .3), .5, rr(-.3, .3)), 1.5, .3, 1.5, [.85, .85, .82, .5], [.9, .9, .88, 0], 1, .2); }
  }
  spawnCan(from, v, kind) { const m = new THREE.Mesh(this.canGeo, this.M.can); m.position.copy(from); m.castShadow = true; G.scene.add(m); this.projectiles.push({ m, v: v.clone(), t: 0, kind: 'gas', landed: false, life: 26 }); }
  playerFire() {
    if (this.gasReload > 0) return; if (!this.gasLoaded) { if (this.gasAmmo > 0) this.reloadGas(); return; }
    this.gasLoaded = false; const cam = G.camera; const dir = V3(0, 0, -1).applyQuaternion(cam.quaternion); dir.y += .06; dir.normalize();
    const o = cam.position.clone().addScaledVector(dir, .6).add(V3(0, -.12, 0)); this.spawnCan(o, dir.multiplyScalar(40), 'player'); G.fsound.thump(o, true);
    G.player.recoilVel.x += 1.6; G.fx.smoke.emit(o, dir.clone().multiplyScalar(2), 1.2, .15, 1.2, [.85, .85, .82, .4], [.9, .9, .88, 0], 1, .1); G.stats.shots++;
    after(.6, () => this.reloadGas());
  }
  throwStone(from, to) { const d = Math.hypot(to.x - from.x, to.z - from.z); const T = clamp(d / 16, .6, 2.6); const v = V3((to.x - from.x) / T, (to.y - from.y + 4.9 * T * T) / T, (to.z - from.z) / T); const m = new THREE.Mesh(this.stoneGeo, this.M.stone); m.position.copy(from); G.scene.add(m); this.projectiles.push({ m, v, t: 0, kind: 'stone' }); }
  landGas(p, strong = 1) {
    const x = p.x, z = p.z; const y = hF(x, z);
    G.crowd.gasClouds.push({ x, z, r: 2, rMax: 11 + strong * 3, t: 0, life: 24 + strong * 4, k: 1, src: V3(x, y, z) });
  }
  // the "Sea of Tears" hexacopter: flies out from the command post, drops three canisters, comes back
  gasDrone(p, follow = null) {
    const g = new THREE.Group(); const M = this.M; const body = new THREE.Mesh(new THREE.BoxGeometry(.5, .18, .5), M.dark); g.add(body);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const arm = new THREE.Mesh(new THREE.BoxGeometry(.75, .04, .05), M.dark); arm.position.set(Math.cos(a) * .38, 0, Math.sin(a) * .38); arm.rotation.y = -a; g.add(arm); const r = new THREE.Mesh(new THREE.CircleGeometry(.24, 12), M.rotor); r.rotation.x = -Math.PI / 2; r.position.set(Math.cos(a) * .75, .05, Math.sin(a) * .75); g.add(r); }
    const rack = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .3), M.olive); rack.position.y = -.2; g.add(rack); g.traverse(c => { if (c.isMesh) c.castShadow = true; });
    const home = V3(FL.cp.x + 6, FL.bermH + 1.2, FL.cp.z - 2.5); g.position.copy(home); G.scene.add(g); (G.hotObjects || (G.hotObjects = [])).push(g);
    const alt = 42; const d = { g, pts: [home.clone().add(V3(0, alt, 0)), V3(p.x, hF(p.x, p.z) + alt, p.z), 'drop', V3(p.x, hF(p.x, p.z) + alt, p.z), home.clone().add(V3(0, alt, 0)), home], i: 0, wait: 0, target: p.clone() };
    d.follow = follow; this.drones.push(d); G.fsound.droneLoop(g);
  }
  launchBalloon(from) {
    const g = new THREE.Group(); for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rr(.22, .3), 10, 8), new THREE.MeshStandardMaterial({ color: i % 3 ? '#ece8dc' : '#d8cdb4', roughness: .35 })); s.scale.y = 1.25; s.position.set(rr(-.35, .35), rr(0, .5), rr(-.35, .35)); g.add(s); }
    const str = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, 1.6, 3), this.M.dark); str.position.y = -.9; g.add(str); const rag = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 5), this.M.rag); rag.position.y = -1.7; g.add(rag);
    g.position.copy(from); G.scene.add(g); (G.hotObjects || (G.hotObjects = [])).push(g);
    const land = V3(rr(170, 430), 0, from.z + rr(-80, 120)); this.balloons.push({ g, t: 0, land, alive: true, rag });
  }
  hitBalloon(o, dir, maxT) { for (const b of this.balloons) { if (!b.alive) continue; const c = b.g.position; V.copy(c).sub(o); const t = V.dot(dir); if (t < 0 || t > maxT) continue; P.copy(o).addScaledVector(dir, t); if (P.distanceTo(c) < 1.1) return { b, t }; } return null; }
  popBalloon(b) { b.alive = false; b.falling = true; G.audio.playS('bang', { pos: b.g.position, vol: .25, rate: 2 }); b.g.children.slice(0, 7).forEach(c => c.visible = false); }
  placeCharge(p) { const m = new THREE.Mesh(new THREE.BoxGeometry(.32, .22, .18), this.M.olive); m.position.copy(p).add(V3(0, .11, 0)); m.castShadow = true; G.scene.add(m); const led = new THREE.Mesh(new THREE.SphereGeometry(.02, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, .3, .2) })); led.position.set(.1, .12, 0); m.add(led); this.charge = { m, led }; }
  removeCharge() { if (this.charge) { G.scene.remove(this.charge.m); this.charge = null; } }
  breachFence(p) {
    // torn slats bent outward, a scorch and debris; the gap lets people through
    const M = new THREE.MeshStandardMaterial({ color: '#5d5f5c', roughness: .55, metalness: .7 });
    for (let i = 0; i < 9; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(.06, rr(1.6, 3.4), .06), M); bar.position.set(rr(-.6, .4), rr(.4, 1.4), p.z + rr(-1.8, 1.8)); bar.rotation.set(rr(-.9, .9), 0, rr(-1.2, 1.2)); bar.castShadow = true; G.scene.add(bar); }
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.2), new THREE.MeshBasicMaterial({ color: '#0e0d0c', transparent: true, opacity: .0 })); hole.visible = false; G.scene.add(hole);
    this.columns.push({ p: p.clone(), t: 0, life: 40, dark: .5 });
    // the fence collider has a gap now (for people on foot, via the crowd; actors are kept out by the wall collider only where it exists)
  }
  smokeColumn(p) { this.columns.push({ p: p.clone(), t: 0, life: 70, dark: .15 }); }
  fieldFire(p) { const y = hF(p.x, p.z); const f = { p: V3(p.x, y + .3, p.z), lit: true, t: 0 }; (G.fireSpots || (G.fireSpots = [])).push(f); G.mission.st.fires++; if (G.mission.st.fires === 1) G.audio.say('w_fire'); G.mission.notify('שריפה בשדה שלנו', 'בלון תבערה נחת בשדה חיטה ממזרח לסוללה. כבאות בדרך.', true); G.fsound && G.fsound.fireAt(f.p); after(60, () => { f.lit = false; }); }
  // ---------- per frame ----------
  update(dt) {
    const w = G.weapon;
    // player gas launcher
    if (this.gasReload > 0) { this.gasReload -= dt; if (this.gasReload <= 0 && this.gasAmmo > 0) { this.gasAmmo--; this.gasLoaded = true; G.audio.gunMech('mag_in'); } }
    if (this.mode === 'gas') { if (this.fireReq && !this._fired && G.state === 'play' && !(G.tablet && G.tablet.open)) { this._fired = true; this.playerFire(); } if (!this.fireReq) this._fired = false; if (!this.gasLoaded && this.gasReload <= 0 && this.gasAmmo > 0) this.reloadGas(); }
    // canisters and stones
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.t += dt;
      if (!p.landed) {
        p.v.y -= 9.8 * dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += dt * 9; p.m.rotation.z += dt * 5;
        if (p.kind === 'gas' && R() < dt * 30) G.fx.smoke.emit(p.m.position, V.set(rr(-.2, .2), rr(0, .3), rr(-.2, .2)), rr(.8, 1.4), .12, .7, [.9, .9, .88, .55], [.9, .9, .88, 0], 1, .1);
        const pos = p.m.position; const gy = hF(pos.x, pos.z);
        // the wall: stones bounce off it, canisters clear it
        if (pos.x > -.2 && pos.x < .2 && Math.abs(pos.z) < FL.wallZ && pos.y < 3.6 && p.v.x > 0) { if (p.kind === 'stone') { G.audio.impact(pos, 'concrete'); G.fx.impact(pos.clone(), V3(-1, 0, 0), 'concrete'); p.v.x *= -.25; p.v.y *= .3; pos.x = -.22; } else { p.v.x *= -.3; pos.x = -.22; } }
        if (pos.y < gy + .05) { if (p.kind === 'stone') { G.fx.impact(V3(pos.x, gy, pos.z), V3(0, 1, 0), 'sand'); if (G.camera.position.distanceTo(pos) < 60) G.audio.playS('hit_ground', { pos: pos.clone(), vol: .5 }); G.scene.remove(p.m); this.projectiles.splice(i, 1); continue; }
          p.landed = true; pos.y = gy + .04; p.v.set(p.v.x * .15, 0, p.v.z * .15); this.landGas(pos, 1); G.fsound.hiss(pos.clone()); }
      } else if (p.kind === 'gas') {
        p.m.position.addScaledVector(p.v, dt); p.v.multiplyScalar(Math.max(0, 1 - dt * 2));
        const k = 1 - p.t / p.life; if (R() < dt * 16 * k) G.fx.smoke.emit(p.m.position.clone().add(V3(0, .1, 0)), V.set(G.wind.x * .55 + rr(-1.4, 1.4), rr(.4, 1.3), G.wind.z * .55 + rr(-1.4, 1.4)), rr(5, 9), rr(.5, 1), rr(4, 9), [.9, .9, .87, .3], [.93, .93, .9, 0], .12, .04);
        if (p.t > p.life + 30) { G.scene.remove(p.m); this.projectiles.splice(i, 1); }
      }
    }
    // gas clouds (big soft white volume drifting east on the breeze)
    for (const c of G.crowd.gasClouds) { const n = dt * 14 * c.k; for (let q = 0; q < 3; q++) if (R() < n / 3) G.fx.smoke.emit(V3(c.x + rr(-c.r, c.r) * .7, hF(c.x, c.z) + rr(.2, 1.8), c.z + rr(-c.r, c.r) * .7), V.set(G.wind.x * .35 + rr(-.6, .6), rr(.1, .6), G.wind.z * .35 + rr(-.6, .6)), rr(5, 9), rr(1.5, 3), rr(5, 10), [.87, .87, .84, .2 * c.k], [.9, .9, .88, 0], .1, .02); }
    // the player's eyes
    const pg = G.crowd.inGas(G.player.pos.x, G.player.pos.z); this.eyeGas = clamp(lerp(this.eyeGas, pg > .08 ? Math.min(1, pg * 1.5) : 0, Math.min(1, dt * (pg > .08 ? 1.2 : .25))), 0, 1);
    if (this.eyeGas > .35 && R() < dt * .8) G.fsound.cough(G.player.pos, true);
    // gas drones
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      // the operator keeps the drone over a moving target until the drop
      if (d.follow && !d.dropped && d.i <= 2 && d.follow.alive && !d.follow.removed) { const f = d.follow.pos; for (const k of [1, 3]) d.pts[k].set(f.x - G.wind.x * .6, hF(f.x, f.z) + 42, f.z - G.wind.z * .6); d.target.copy(f); }
      const tgt = d.pts[d.i];
      if (tgt === 'drop') { d.wait += dt; if (d.wait > .3 && !d.dropped) { d.dropped = true; for (let k = 0; k < 3; k++) after(k * .5, () => { const o = d.g.position.clone().add(V3(0, -.3, 0)); this.spawnCan(o, V3(rr(-3, 3), -2, rr(-3, 3)), 'drone'); G.audio.playS('dry', { pos: o, vol: .6, rate: 1.4 }); }); } if (d.wait > 2) d.i++; }
      else { V.copy(tgt).sub(d.g.position); const L = V.length(); if (L < .8) { d.i++; if (d.i >= d.pts.length) { G.scene.remove(d.g); G.fsound.droneStop(d.g); this.drones.splice(i, 1); continue; } } else { const sp = Math.min(19, L * 1.5 + 2); d.g.position.addScaledVector(V.normalize(), sp * dt); d.g.rotation.z = -V.x * .12; d.g.rotation.x = V.z * .12; } }
      d.g.children.forEach((c, k) => { if (c.geometry && c.geometry.type === 'CircleGeometry') c.rotation.z += dt * 40; });
    }
    // incendiary balloons: drift east on the wind, climb, then sink into the wheat
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i]; b.t += dt; const g = b.g;
      if (b.falling) { g.position.y -= dt * 6; g.position.x += G.wind.x * dt; if (g.position.y < hF(g.position.x, g.position.z) + .2) { G.scene.remove(g); this.balloons.splice(i, 1); } continue; }
      const toLand = g.position.x > b.land.x - 60; g.position.x += (G.wind.x * 3.4) * dt; g.position.z += G.wind.z * 2 * dt; const gy = hF(g.position.x, g.position.z);
      g.position.y += (toLand ? -2.2 : (g.position.y < gy + 55 ? 2.4 : 0)) * dt; g.rotation.y += dt * .3;
      if (R() < dt * 10) G.fx.glow.emit(b.rag.getWorldPosition(P), V.set(rr(-.2, .2), -.3, rr(-.2, .2)), .4, .25, .05, [3, 1.3, .3, .9], [1, .3, .05, 0]);
      if (g.position.y < gy + 1.5 && toLand) { this.fieldFire(g.position); G.scene.remove(g); this.balloons.splice(i, 1); }
    }
    // smoke columns (destroyed post, breach)
    for (let i = this.columns.length - 1; i >= 0; i--) { const c = this.columns[i]; c.t += dt; if (c.t > c.life) { this.columns.splice(i, 1); continue; } if (R() < dt * 5) G.fx.smoke.emit(c.p.clone().add(V3(rr(-1, 1), 0, rr(-1, 1))), V.set(G.wind.x * .3, rr(1.5, 2.6), G.wind.z * .3), rr(10, 16), 1.5, rr(9, 16), [c.dark * .5, c.dark * .48, c.dark * .45, .75], [.35, .33, .3, 0], .03, .05); }
    // charge LED
    if (this.charge) this.charge.led.visible = Math.floor(G.time * 3) % 2 === 0;
  }
}
