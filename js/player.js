// First-person player: capsule vs BVH collision, input (keyboard/mouse/touch), camera, health, interactions, vehicle seats
import * as THREE from 'three';
import { G, clamp, lerp, damp, bus, rr, R } from './core.js';
import { B } from './building.js';

const tmpBox = new THREE.Box3(), seg = new THREE.Line3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

export const Input = {
  keys: {}, mdx: 0, mdy: 0, fire: false, ads: false, adsToggle: false, reloadReq: false, crouchReq: false, jumpReq: false, interact: false, sprint: false,
  move: new THREE.Vector2(), locked: false,
};

export class Player {
  constructor() {
    this.isPlayer = true; this.alive = true;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.onGround = false;
    this.yaw = 0; this.pitch = 0; this.radius = .32; this.height = 1.78; this.crouching = false; this.eyeH = 1.64; this.eyePos = new THREE.Vector3();
    this.health = 100; this.lastHit = -99; this.bob = 0; this.bobAmt = 0; this.shake = 0; this.recoil = new THREE.Vector2(); this.recoilVel = new THREE.Vector2();
    this.suppression = 0; this.seat = null; this.frozen = false; this.stepAcc = 0; this.trail = []; this.inCover = false; this.fovBase = 72; this.leanT = 0;
    this.ads = 0; this.sprinting = false; this.hurtDir = [];
  }
  setPos(p, yaw = null) { this.pos.copy(p); this.vel.set(0, 0, 0); if (yaw !== null) this.yaw = yaw; this.trailBase = (this.trailBase || 0) + (this.trail ? this.trail.length : 0); this.trail = [this.pos.clone()]; }
  damage(amount, from) {
    if (!this.alive || G.godMode) return;
    this.health -= amount * (G.difficultyMul || 1); this.lastHit = G.time; this.shake = Math.min(1, this.shake + .35); G.stats.damage += amount;
    if (from) { const a = Math.atan2(from.x - this.pos.x, from.z - this.pos.z) - this.yaw; this.hurtDir.push({ a, t: 1.2 }); }
    this.recoilVel.x += rr(.6, 1.2); this.recoilVel.y += rr(-.8, .8); this.bloodT = Math.min(1.4, (this.bloodT || 0) + amount / 18);
    if (G.audio.playS) { G.audio.playS('hit_flesh', { vol: .9, rev: 0 }); if (R() < .6) G.audio.playS('pain', { vol: .7, rev: 0, rate: rr(.95, 1.05) }); }
    bus.emit('playerHit', amount);
    if (this.health <= 0) { this.health = 0; this.alive = false; bus.emit('playerDied'); }
    else if (!this.bleeding && this.health < 32) { this.bleeding = true; bus.emit('playerBleeding'); }
  }
  suppress(v) { this.suppression = Math.min(1, this.suppression + v); }
  sitIn(obj, local, yawRange = 1.8) { this.seat = { obj, local: local.clone(), yawRange, baseYaw: 0 }; this.vel.set(0, 0, 0); }
  standUp(p) { this.seat = null; if (p) this.setPos(p); }
  // ---------- collision ----------
  collide(dt) {
    const bvh = G.bvhMesh.geometry.boundsTree; const r = this.radius; const h = this.crouching ? 1.15 : this.height;
    seg.start.set(this.pos.x, this.pos.y + r, this.pos.z); seg.end.set(this.pos.x, this.pos.y + h - r, this.pos.z);
    tmpBox.makeEmpty(); tmpBox.expandByPoint(seg.start); tmpBox.expandByPoint(seg.end); tmpBox.min.addScalar(-r); tmpBox.max.addScalar(r);
    bvh.shapecast({
      intersectsBounds: box => box.intersectsBox(tmpBox),
      intersectsTriangle: tri => {
        const d = tri.closestPointToSegment(seg, v1, v2);
        if (d < r) { const depth = r - d; const dir = v2.sub(v1).normalize(); seg.start.addScaledVector(dir, depth); seg.end.addScaledVector(dir, depth); }
      },
    });
    const np = v3.copy(seg.start); np.y -= r;
    const delta = np.sub(this.pos);
    this.onGround = delta.y > Math.abs(dt * this.vel.y * .25);
    const off = Math.max(0, delta.length() - 1e-5); delta.normalize().multiplyScalar(off); this.pos.add(delta);
    if (!this.onGround) { delta.normalize(); this.vel.addScaledVector(delta, -delta.dot(this.vel)); } else this.vel.y = 0;
    // dynamic blockers (closed doors)
    for (const b of B.blockers) {
      if (this.pos.y + 1 < b.y0 || this.pos.y > b.y1) continue;
      const cx = clamp(this.pos.x, b.x0, b.x1), cz = clamp(this.pos.z, b.z0, b.z1); const dx = this.pos.x - cx, dz = this.pos.z - cz; const d = Math.hypot(dx, dz);
      if (d < r) { if (d > 1e-4) { this.pos.x = cx + dx / d * r; this.pos.z = cz + dz / d * r; } else { this.pos.x += (this.pos.x < (b.x0 + b.x1) / 2 ? -1 : 1) * r; } }
    }
    if (this.pos.y < -30) { this.pos.y = 5; this.vel.set(0, 0, 0); }
  }
  update(dt) {
    const I = Input;
    // ---------- look ----------
    const sens = .0022 * G.settings.sens * (this.ads > .5 ? .6 : 1);
    this.yaw -= I.mdx * sens; this.pitch -= I.mdy * sens * (G.settings.invertY ? -1 : 1); I.mdx = I.mdy = 0;
    // aim assist on touch while aiming
    if (G.isTouch && G.weapon && (this.ads > .4 || Input.fire)) G.weapon.aimAssist(dt * (this.ads > .4 ? 1 : .6));
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    if (this.seat) { const s = this.seat; const vy = new THREE.Euler().setFromQuaternion(s.obj.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y; s.baseYaw = vy; const rel = ((this.yaw - vy + Math.PI * 3) % (Math.PI * 2)) - Math.PI; if (Math.abs(rel) > s.yawRange) this.yaw = vy + Math.sign(rel) * s.yawRange; }
    // ---------- move ----------
    if (!this.seat && !this.frozen && this.alive) {
      if (I.crouchReq) { I.crouchReq = false; this.crouching = !this.crouching; }
      let mx = I.move.x, mz = I.move.y;
      if (I.keys.KeyW || I.keys.ArrowUp) mz -= 1; if (I.keys.KeyS || I.keys.ArrowDown) mz += 1; if (I.keys.KeyA || I.keys.ArrowLeft) mx -= 1; if (I.keys.KeyD || I.keys.ArrowRight) mx += 1;
      const L = Math.hypot(mx, mz); if (L > 1) { mx /= L; mz /= L; }
      this.sprinting = (I.keys.ShiftLeft || I.keys.ShiftRight || I.sprint) && mz < -.3 && !this.crouching && this.ads < .3;
      if (this.sprinting && this.crouching) this.crouching = false;
      const sp = this.crouching ? 1.7 : this.sprinting ? 6.0 : (this.ads > .5 ? 2.3 : 3.7);
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const tx = (mx * c + mz * s) * sp, tz = (-mx * s + mz * c) * sp;
      const acc = this.onGround ? 12 : 2;
      this.vel.x = damp(this.vel.x, tx, acc, dt); this.vel.z = damp(this.vel.z, tz, acc, dt);
      if (I.jumpReq && this.onGround) { this.vel.y = 4.2; this.onGround = false; } I.jumpReq = false;
      const steps = 4; const sdt = dt / steps;
      for (let i = 0; i < steps; i++) { this.vel.y += (this.onGround ? -2 : -14) * sdt; this.pos.addScaledVector(this.vel, sdt); this.collide(sdt); }
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.bobAmt = damp(this.bobAmt, this.onGround ? clamp(hs / 4, 0, 1.4) : 0, 10, dt); this.bob += dt * (hs * 1.9 + .01);
      this.stepAcc += hs * dt; const stride = this.sprinting ? 1.6 : 1.25;
      if (this.onGround && this.stepAcc > stride) { this.stepAcc = 0; G.audio.step(this.surface(), this.crouching ? .15 : this.sprinting ? .45 : .3); }
      // breadcrumb trail for followers
      const last = this.trail[this.trail.length - 1]; if (!last || last.distanceTo(this.pos) > .5) { this.trail.push(this.pos.clone()); if (this.trail.length > 200) { this.trail.shift(); this.trailBase = (this.trailBase || 0) + 1; } }
    }
    // ---------- camera ----------
    const eyeT = this.crouching ? 1.05 : 1.64; this.eyeH = damp(this.eyeH, eyeT, 10, dt);
    const cam = G.camera;
    if (this.seat) { const s = this.seat; s.obj.updateMatrixWorld(true); this.pos.copy(s.local).applyMatrix4(s.obj.matrixWorld); this.eyePos.copy(this.pos); }
    else { this.eyePos.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }
    const bobY = Math.sin(this.bob * 2) * .035 * this.bobAmt, bobX = Math.cos(this.bob) * .025 * this.bobAmt * (1 - this.ads * .8);
    this.shake = Math.max(0, this.shake - dt * 2.5); this.suppression = Math.max(0, this.suppression - dt * .35);
    const sh = this.shake * this.shake * .03 + (this.seat ? .004 * (G.vehShake || 0) : 0);
    // recoil spring
    this.recoilVel.x += (-this.recoil.x * 90 - this.recoilVel.x * 14) * dt; this.recoilVel.y += (-this.recoil.y * 90 - this.recoilVel.y * 14) * dt;
    this.recoil.x += this.recoilVel.x * dt; this.recoil.y += this.recoilVel.y * dt;
    cam.position.copy(this.eyePos); cam.position.y += bobY;
    cam.rotation.set(this.pitch + this.recoil.x + rr(-sh, sh), this.yaw + this.recoil.y + rr(-sh, sh), Math.sin(this.bob) * .004 * this.bobAmt, 'YXZ');
    cam.translateX(bobX);
    const fov = lerp(this.fovBase, this.fovBase * .62, this.ads) + (this.sprinting ? 4 : 0);
    if (Math.abs(cam.fov - fov) > .05) { cam.fov = damp(cam.fov, fov, 14, dt); cam.updateProjectionMatrix(); }
    // ---------- health ----------
    if (this.alive && this.bleeding && !G.godMode) { this.health -= 1.3 * dt; this.bloodT = Math.max(this.bloodT || 0, .5); if (this.health <= 0) { this.health = 0; this.alive = false; bus.emit('playerDied'); } }
    else if (this.alive && G.time - this.lastHit > 6 && this.health < 100) this.health = Math.min(100, this.health + 8 * dt);
    this.bloodT = Math.max(0, (this.bloodT || 0) - dt * .6);
    G.audio.heartbeat(this.alive && this.health < 35);
    for (let i = this.hurtDir.length - 1; i >= 0; i--) { this.hurtDir[i].t -= dt; if (this.hurtDir[i].t <= 0) this.hurtDir.splice(i, 1); }
    // inside detection
    const inside = this.pos.x > B.x0 && this.pos.x < B.x1 && this.pos.z > B.z0 && this.pos.z < B.z1 && !this.seat;
    if (inside !== G.inside) { G.inside = inside; G.audio.setInside(inside); for (const l of B.lights) l.intensity = (inside || (this.pos.distanceTo(new THREE.Vector3(40, 9.4, -13)) < 25)) ? l.userData.base : 0; bus.emit('inside', inside); }
    // cover: crouched next to something solid
    this.inCover = this.crouching;
  }
  surface() { return G.inside || this.pos.y > .3 ? 'concrete' : this.pos.x < -296 ? 'sand' : 'mud'; }
}

// ---------- world queries (BVH) ----------
const ray = new THREE.Ray();
export function installQueries() {
  const bvh = G.bvhMesh.geometry.boundsTree;
  G.floorAt = (p, fromY = null) => { ray.origin.set(p.x, (fromY ?? p.y + 1), p.z); ray.direction.set(0, -1, 0); const h = bvh.raycastFirst(ray, THREE.DoubleSide); return h ? h.point.y : null; };
  G.lineOfSight = (a, b) => { const d = b.clone().sub(a); const L = d.length(); ray.origin.copy(a); ray.direction.copy(d.divideScalar(L)); const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, L); return !h || h.distance > L - .25; };
  G.shootRay = (o, dir, max, shooter = null) => {
    ray.origin.copy(o); ray.direction.copy(dir);
    const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, max); let tWorld = h ? h.distance : max;
    let best = null;
    for (const a of G.actors) { if (a === shooter || !a.alive) continue; if (a.pos.distanceToSquared(o) > (tWorld + 2) ** 2) continue; const r = a.raycast(o, dir, tWorld); if (r && (!best || r.t < best.t)) best = { t: r.t, actor: a, part: r.part }; }
    let player = false;
    if (shooter && shooter.hostile && G.player.alive) { const p = G.player; const top = p.eyePos.clone(), bot = p.pos.clone().add(new THREE.Vector3(0, .3, 0)); const t = capsule(o, dir, bot, top, .3); if (t !== null && t < (best ? best.t : tWorld)) { player = true; best = { t, actor: null }; } }
    if (best) { const point = o.clone().addScaledVector(dir, best.t); return { point, normal: dir.clone().negate(), hitWorld: false, actor: best.actor, part: best.part, player, surface: 'flesh' }; }
    if (h) { const n = h.face ? h.face.normal.clone() : dir.clone().negate(); if (n.dot(dir) > 0) n.negate(); const surf = h.point.y < .08 ? 'sand' : 'concrete'; return { point: h.point.clone(), normal: n, hitWorld: true, actor: null, surface: surf }; }
    return { point: o.clone().addScaledVector(dir, max), normal: dir.clone().negate(), hitWorld: false, actor: null };
  };
}
function capsule(ro, rd, pa, pb, r) {
  const ba = pb.clone().sub(pa), oa = ro.clone().sub(pa); const baba = ba.dot(ba), bard = ba.dot(rd), baoa = ba.dot(oa), rdoa = rd.dot(oa), oaoa = oa.dot(oa);
  const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba; const h = b * b - a * c;
  if (h < 0) return null; const t = (-b - Math.sqrt(h)) / a; const y = baoa + t * bard; if (y > 0 && y < baba && t > 0) return t; return null;
}

// ---------- input wiring (keyboard/mouse) ----------
export function initInput(canvas) {
  addEventListener('keydown', e => {
    if (e.repeat) return; Input.keys[e.code] = true;
    if (e.code === 'KeyB' && G.weapon) G.weapon.toggleMode(); if (e.code === 'KeyR') Input.reloadReq = true; if (e.code === 'KeyC' || e.code === 'ControlLeft') Input.crouchReq = true; if (e.code === 'Space') Input.jumpReq = true;
    if (e.code === 'KeyE' || e.code === 'KeyF') Input.interact = true;
    bus.emit('key', e.code);
  });
  addEventListener('keyup', e => { Input.keys[e.code] = false; if (e.code === 'KeyE' || e.code === 'KeyF') Input.interact = false; });
  addEventListener('blur', () => { Input.keys = {}; Input.fire = false; Input.ads = false; Input.interact = false; });
  document.addEventListener('pointerlockchange', () => { Input.locked = document.pointerLockElement === canvas; bus.emit('lock', Input.locked); });
  let drag = false;
  canvas.addEventListener('mousedown', e => { if (G.state !== 'play' && G.state !== 'cutscene') return; if (!Input.locked) { drag = true; if (!G.freeCursor) try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) {} }
    if (e.button === 0) Input.fire = true; if (e.button === 2) Input.ads = true; });
  addEventListener('mouseup', e => { if (e.button === 0) Input.fire = false; if (e.button === 2) Input.ads = false; drag = false; });
  addEventListener('mousemove', e => { if (G.isTouch) return; if (Input.locked || drag) { Input.mdx += e.movementX; Input.mdy += e.movementY; } });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}
