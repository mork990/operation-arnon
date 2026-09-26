// Characters: model instancing, locomotion, rifle IK, hit boxes, AI (guards, fighters, team, hostages, civilians)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { G, rr, R, pick, clamp, lerp, angleLerp, bus, after } from './core.js';
import { A } from './assets.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const _seg = new THREE.Line3(), _box = new THREE.Box3(); let poolMat = null;

// ---------- rifles ----------
let rifleProto = {};
export function makeRifle(kind) {
  if (!rifleProto[kind]) {
    const src = A.models[kind === 'm4' ? 'm4' : 'ak']; if (!src) return null;
    const g = new THREE.Group(); const m = src.scene.clone(true); g.add(m);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (kind === 'ak') { m.rotation.y = Math.PI / 2; m.position.set(0, .07, -.02); g.userData = { muzzle: new THREE.Vector3(0, .09, -.5), fore: new THREE.Vector3(0, .05, -.26), grip: new THREE.Vector3(0, 0, 0) }; }
    else {
      m.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(m); const size = b.getSize(new THREE.Vector3()); const s = .84 / Math.max(size.x, size.y, size.z); m.scale.setScalar(s);
      m.updateMatrixWorld(true); b.setFromObject(m);
      let stockZ = 0; m.traverse(o => { if (o.name === 'Stock') { const bb = new THREE.Box3().setFromObject(o); stockZ = (bb.min.z + bb.max.z) / 2; } });
      const c = b.getCenter(new THREE.Vector3());
      if (stockZ < c.z) m.rotation.y = Math.PI; // make muzzle point -z
      m.updateMatrixWorld(true); b.setFromObject(m); const L = b.max.z - b.min.z;
      const gripZ = b.max.z - L * .34, boreY = b.max.y - (b.max.y - b.min.y) * .28;
      m.position.set(-(b.min.x + b.max.x) / 2, -(boreY - .085), -gripZ);
      g.userData = { muzzle: new THREE.Vector3(0, .085, b.min.z - gripZ - .02), fore: new THREE.Vector3(0, .05, -L * .42), grip: new THREE.Vector3(0, 0, 0) };
      g.add(m); g.updateMatrixWorld(true); const sb = new THREE.Box3(); m.traverse(o => { if (o.isMesh && o.name === 'Sight') sb.expandByObject(o); });
      if (!sb.isEmpty()) { g.userData.topY = sb.min.y + .004; g.userData.opticZ = (sb.min.z + sb.max.z) / 2 - .045; }
    }
    rifleProto[kind] = g;
  }
  const r = rifleProto[kind].clone(true); r.userData = rifleProto[kind].userData; return r;
}

// ---------- bone helpers ----------
function findBone(root, name) { let b = null; root.traverse(o => { if (!b && o.isBone && o.name === name) b = o; }); return b; }
function worldPos(o, out) { return out.setFromMatrixPosition(o.matrixWorld); }
// rotate bone so that (child world pos - bone world pos) points toward dir, preserving the rest
function aimBone(bone, childPos, target) {
  const bp = worldPos(bone, _v3.clone());
  const a = childPos.clone().sub(bp).normalize(), b = target.clone().sub(bp).normalize();
  const qw = _q.setFromUnitVectors(a, b);
  const pw = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const bw = bone.getWorldQuaternion(new THREE.Quaternion());
  const nw = qw.clone().multiply(bw);
  bone.quaternion.copy(pw.invert().multiply(nw));
  bone.updateMatrixWorld(true);
}
// analytic 2-bone IK (upper, lower, end) toward target with pole hint
export function twoBoneIK(upper, lower, end, target, pole) {
  const a = worldPos(upper, new THREE.Vector3()), b = worldPos(lower, new THREE.Vector3()), c = worldPos(end, new THREE.Vector3());
  const lab = a.distanceTo(b), lcb = b.distanceTo(c); const lat = clamp(a.distanceTo(target), .01, lab + lcb - .002);
  // desired elbow position in plane (a, target, pole)
  const dir = target.clone().sub(a).normalize();
  const p = pole.clone().sub(a); const pn = p.sub(dir.clone().multiplyScalar(p.dot(dir))).normalize();
  const cosA = clamp((lab * lab + lat * lat - lcb * lcb) / (2 * lab * lat), -1, 1); const sinA = Math.sqrt(1 - cosA * cosA);
  const elbow = a.clone().addScaledVector(dir, cosA * lab).addScaledVector(pn, sinA * lab);
  aimBone(upper, worldPos(lower, new THREE.Vector3()), elbow);
  aimBone(lower, worldPos(end, new THREE.Vector3()), target);
}

// ---------- Actor ----------
const CLIPSET = {
  m: { idle: 'm_idle_neutral_01', nervous: 'm_idle_nervous_01', look: 'm_idle_look_around_01', angry: 'm_idle_angry_01', walk: 'm_walk_neutral_01', walkFast: 'm_walk_fast_01', run: 'm_run_neutral_01', sprint: 'm_run_fast_01', crouch: 'm_crouch_idle', limp: 'm_walk_bruised', runHurt: 'm_run_injured' },
  f: { idle: 'f_idle_neutral_01', nervous: 'f_idle_nervous_01', look: 'f_idle_look_around_01', angry: 'f_idle_neutral_01', walk: 'f_walk_neutral_01', walkFast: 'f_walk_neutral_01', run: 'f_run_neutral_01', sprint: 'f_run_neutral_01', crouch: 'f_crouch_idle', limp: 'f_walk_injured', runHurt: 'f_run_injured' },
};

// Gaza, not the Gulf: the stock civilians wear the white thobe and the red-and-white shemagh with an agal. The cloth
// becomes the black-and-white kufiya (or a plain white one), and the thobes are dyed the greys, beiges and browns of the
// everyday galabiya, per person. Only low-saturation bright pixels are recoloured, so skin and prints keep their colour.
const DRESS = ['#ebe7de', '#d3cbba', '#b2a58c', '#8f9396', '#646a6e', '#7d6c57', '#bcb7a2', '#4f5357'];
function localDress(root, seed) {
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tint = new THREE.Color(DRESS[Math.floor(r() * DRESS.length)]), plain = r() < .3;
  root.traverse(o => {
    if (!o.isMesh) return;
    const swap = m => {
      const n = (m.name || '').toLowerCase();
      if (n.includes('keffiyeh')) { const c = m.clone(); c.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { float red = clamp((diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) * 4., 0., 1.); float l = dot(diffuseColor.rgb, vec3(.3, .59, .11));
          diffuseColor.rgb = ${plain ? 'vec3(l * 1.05 + .08)' : 'mix(vec3(l * 1.1 + .05), vec3(.035), red)'}; }`); }; c.customProgramCacheKey = () => plain ? 'kufiyaW' : 'kufiya'; return c; }
      if (n.includes('body')) { const c = m.clone(); const u = { uDress: { value: tint } }; c.onBeforeCompile = sh => { sh.uniforms.uDress = u.uDress; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uDress;').replace('#include <map_fragment>', `#include <map_fragment>
        { float mn = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b), mx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
          float cloth = smoothstep(.1, .28, mn) * (1. - smoothstep(.05, .14, (mx - mn) / max(mx, .01))); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(.33))) * uDress * 1.5, cloth); }`); }; /* linear values: a white thobe's albedo is only ~.3-.6 here */ c.customProgramCacheKey = () => 'galabiya'; return c; }
      return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}
let nextId = 1;
export class Actor {
  constructor(model, kind, pos, yaw = 0, opts = {}) {
    this.id = nextId++; this.kind = kind; this.model = model; this.opts = opts;
    this.sex = model.startsWith('hostF') || model.startsWith('civF') ? 'f' : 'm';
    this.root = SkeletonUtils.clone(A.chars[model].scene);
    if (kind === 'civ' && model.startsWith('civM')) localDress(this.root, 7919 * nextId + 13);
    this.root.position.copy(pos); this.yaw = yaw; this.root.rotation.y = yaw;
    G.scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root); this.actions = {}; this.cur = null;
    this.bones = {};
    for (const n of ['Pelvis', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'R_Clavicle', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Clavicle', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_Finger2', 'L_Finger2', 'L_Foot', 'R_Foot', 'L_Calf', 'R_Calf'])
      this.bones[n] = findBone(this.root, 'Bip01_' + n);
    this.alive = true; this.health = opts.health ?? 100; this.hostile = kind === 'guard' || kind === 'fighter';
    this.friendly = kind === 'team' || kind === 'idf'; this.innocent = kind === 'hostage' || kind === 'civ';
    this.state = opts.state || 'idle'; this.speed = 0; this.target = null; this.path = null; this.pathI = 0; this.moveSpeed = 0;
    this.aimYaw = yaw; this.aimPitch = 0; this.aiming = false; this.crouch = 0;
    this.fireCd = rr(.8, 1.6); this.burst = 0; this.seeT = 0; this.canSee = null; this.reaction = rr(.35, .8); this.alertT = 0;
    this.accuracy = opts.accuracy ?? (kind === 'fighter' ? .22 : kind === 'guard' ? .3 : .75);
    this.hitFlinch = 0; this.dead = null; this.lod = 0;
    if (opts.rifle) { this.rifle = makeRifle(opts.rifle); if (this.rifle) G.scene.add(this.rifle); }
    if (opts.headband && this.bones.Head) { const hb = new THREE.Mesh(new THREE.TorusGeometry(.098, .02, 6, 18), new THREE.MeshStandardMaterial({ color: '#2f7a2a', roughness: .9 })); hb.scale.set(1, 1.15, .8); this.band = hb; G.scene.add(hb); }
    this.play(opts.anim || 'idle', 0);
    this.mixer.update(rr(0, 5));
    G.actors.push(this);
  }
  clip(k) { return A.clips[CLIPSET[this.sex][k] || k]; }
  play(k, fade = .3, speed = 1) {
    if (this.curKey === k) { if (this.cur) this.cur.timeScale = speed; return; }
    const c = this.clip(k); if (!c) return;
    let a = this.actions[k]; if (!a) { a = this.actions[k] = this.mixer.clipAction(c); }
    a.reset(); a.timeScale = speed; a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (this.cur && fade > 0) this.cur.crossFadeTo(a, fade, false); else if (this.cur) this.cur.stop();
    this.cur = a; this.curKey = k;
  }
  get pos() { return this.root.position; }
  eye(out = new THREE.Vector3()) { return this.bones.Head ? worldPos(this.bones.Head, out).add(_v.set(0, .06, 0)) : out.copy(this.pos).add(_v.set(0, 1.6, 0)); }
  chest(out = new THREE.Vector3()) { return this.bones.Spine2 ? worldPos(this.bones.Spine2, out) : out.copy(this.pos).add(_v.set(0, 1.3, 0)); }
  // ray vs hit capsules; returns {t, part}
  raycast(ro, rd, maxT) {
    if (!this.alive || !this.bones.Head) return null;
    const head = worldPos(this.bones.Head, new THREE.Vector3()).add(_v.set(0, .07, 0));
    const neck = worldPos(this.bones.Neck, new THREE.Vector3()); const pel = worldPos(this.bones.Pelvis, new THREE.Vector3());
    const feet = worldPos(this.bones.L_Foot, new THREE.Vector3()).add(worldPos(this.bones.R_Foot, _v2)).multiplyScalar(.5);
    let best = null;
    const s = sphereHit(ro, rd, head, .13); if (s !== null && s < maxT) best = { t: s, part: 'head' };
    const c1 = capsuleHit(ro, rd, pel, neck, .22); if (c1 !== null && c1 < maxT && (!best || c1 < best.t)) best = { t: c1, part: 'body' };
    const c2 = capsuleHit(ro, rd, feet.add(_v.set(0, .1, 0)), pel, .17); if (c2 !== null && c2 < maxT && (!best || c2 < best.t)) best = { t: c2, part: 'legs' };
    return best;
  }
  damage(amount, from, part) {
    if (!this.alive || amount <= 0) return;
    this.lastHit = G.time;
    if (this.friendly || this.kind === 'hostage') { // our soldiers and the hostages: wounds, bleeding, treatment (see goDown / treat)
      this.health -= amount * (this.down ? .3 : 1); this.hitFlinch = .35;
      if (G.audio.voice && R() < .75 && (this.sex !== 'f')) G.audio.voice(this.eye(new THREE.Vector3()), 'pain');
      if (this.health <= 0) { if (this.noDie) this.health = 1; else { this.die(from); return; } }
      if (!this.down && this.health <= 40) this.goDown();
      bus.emit('actorHit', this, from, part); return;
    }
    this.health -= amount; this.hitFlinch = .25; this.alertT = 99;
    if (this.health <= 0) this.die(from);
    else if (this.sex === 'm' && R() < .55 && G.audio.voice) G.audio.voice(this.eye(new THREE.Vector3()), 'pain');
    bus.emit('actorHit', this, from, part);
  }
  // casualty: drops, bleeds (health drains) until someone applies a tourniquet / dressing
  goDown() {
    if (this.down || !this.alive) return; this.down = true; this.downT = G.time; this.treated = false;
    this._follow = this.follow || this._follow; this.follow = null; this.stop(); this._wf = this.weaponsFree; this.weaponsFree = false; this.aiming = false;
    this._fa = this.forceAnim; this.forceAnim = 'crouch'; this.hurt = true; bus.emit('actorDown', this);
    // blood pooling on the floor under the casualty while untreated
    if (!poolMat) poolMat = new THREE.MeshStandardMaterial({ color: '#3a0605', roughness: .25, metalness: 0, transparent: true, opacity: .88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const pg = new THREE.CircleGeometry(.5, 20); const pp = pg.attributes.position; for (let i = 1; i < pp.count; i++) { const k = .75 + R() * .45; pp.setXY(i, pp.getX(i) * k, pp.getY(i) * k); } pg.rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(pg, poolMat); pool.position.set(this.pos.x + rr(-.15, .15), this.pos.y + .012, this.pos.z + rr(-.15, .15)); pool.scale.setScalar(.12); pool.renderOrder = 2; G.scene.add(pool); this.pool = pool;
  }
  treat(by = null) {
    if (!this.down || !this.alive) return; this.down = false; this.treated = true; this.health = Math.max(this.health, 55);
    this.forceAnim = this.keepCrouch ? 'crouch' : (this._fa || null); if (!this.keepCrouch) this.follow = this._follow || null; if (this.follow) this.follow.ci = undefined; this.weaponsFree = this._wf ?? this.weaponsFree;
    if (this.friendly && this._wf) this.fireMul = (this.fireMul || 1) * 1.3; bus.emit('actorTreated', this, by);
  }
  die(from) {
    this.alive = false; this.health = 0;
    const away = from ? this.pos.clone().sub(from).setY(0).normalize() : new THREE.Vector3(0, 0, 1);
    const local = away.applyAxisAngle(UP, -this.root.rotation.y);
    this.dead = { t: 0, dir: Math.abs(local.x) > Math.abs(local.z) ? (local.x > 0 ? 'r' : 'l') : (local.z > 0 ? 'b' : 'f'), baseY: this.root.position.y };
    this.play('crouch', .25, 1.4);
    if (this.rifle) { this.dropRifle = { v: new THREE.Vector3(rr(-1, 1), 1.5, rr(-1, 1)), t: 0 }; }
    if (G.audio.voice) { const ep = this.eye(new THREE.Vector3()); if (this.sex === 'm' && R() < .6) G.audio.voice(ep, R() < .5 ? 'death' : 'gasp'); after(rr(.5, .8), () => G.audio.playS('bodyfall', { pos: this.pos.clone(), vol: .8, rev: .2, ref: 3 })); }
    bus.emit('actorDied', this);
  }
  remove() { if (this.pool) G.scene.remove(this.pool); G.scene.remove(this.root); if (this.rifle) G.scene.remove(this.rifle); if (this.band) G.scene.remove(this.band); const i = G.actors.indexOf(this); if (i >= 0) G.actors.splice(i, 1); this.removed = true; }
  // ---------- movement ----------
  setPath(pts, speed = 1.4, onDone = null) { this.path = pts.map(p => p.clone()); this.pathI = 0; this.moveSpeed = speed; this.onPath = onDone; }
  stop() { this.path = null; this.moveSpeed = 0; }
  // keep bodies out of walls, stalls, cars and props: push the torso segment horizontally out of any collider triangle
  resolveWalls(r = .27) {
    if (this.seat || this.noSnap || !G.bvhMesh) return false;
    const bvh = G.bvhMesh.geometry.boundsTree; const p = this.pos; let pushed = false;
    _seg.start.set(p.x, p.y + .5, p.z); _seg.end.set(p.x, p.y + 1.55, p.z);
    _box.min.set(p.x - r, p.y + .5 - r, p.z - r); _box.max.set(p.x + r, p.y + 1.55 + r, p.z + r);
    bvh.shapecast({
      intersectsBounds: b => b.intersectsBox(_box),
      intersectsTriangle: tri => { const d = tri.closestPointToSegment(_seg, _v, _v2); if (d < r) { const dir = _v2.sub(_v); dir.y = 0; const l = dir.length(); if (l < 1e-5) return; dir.multiplyScalar((r - d) / l); _seg.start.add(dir); _seg.end.add(dir); pushed = true; } },
    });
    if (pushed) { p.x = _seg.start.x; p.z = _seg.start.z; }
    return pushed;
  }
  // nearest trail crumb that is on this floor and in direct line of sight (fallback: nearest)
  pickCrumb(trail, base) {
    let best = -1, bd = 1e9, anyB = 0, anyD = 1e9; const eye = this.pos.clone(); eye.y += 1.2; const c = new THREE.Vector3();
    for (let i = 0; i < trail.length; i++) { const t = trail[i]; const d = t.distanceTo(this.pos); if (d < anyD) { anyD = d; anyB = i; }
      if (d < bd && Math.abs(t.y - this.pos.y) < 1.4 && (!G.lineOfSight || G.lineOfSight(eye, c.copy(t).setY(t.y + 1.2)))) { bd = d; best = i; } }
    return base + (best >= 0 ? best : anyB);
  }
  crumbBehind(trail, dist) { let acc = 0; for (let i = trail.length - 1; i > 0; i--) { acc += trail[i].distanceTo(trail[i - 1]); if (acc >= dist) return i - 1; } return 0; }
  onScreen() { const v = this.pos.clone(); v.y += 1; const cp = G.camera.position; if (v.distanceTo(cp) > 60) return false; v.project(G.camera); if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return false; const e = this.pos.clone(); e.y += 1.2; return !G.lineOfSight || G.lineOfSight(cp, e); }
  faceTo(p) { this.aimYaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  updateMove(dt) {
    let moving = false;
    if (this.path && this.pathI < this.path.length) {
      const t = this.path[this.pathI]; const dx = t.x - this.pos.x, dz = t.z - this.pos.z; const d = Math.hypot(dx, dz);
      if (d < .25 + this.moveSpeed * dt) { this.pathI++; if (this.pathI >= this.path.length) { this.path = null; const f = this.onPath; this.onPath = null; if (f) f(this); } }
      else { const sp = this.moveSpeed; this.pos.x += dx / d * sp * dt; this.pos.z += dz / d * sp * dt; if (!this.aiming) this.aimYaw = Math.atan2(dx, dz); moving = true; this.speed = sp;
        // safety net: a scripted walk blocked by geometry for a while hops to its next waypoint (off-screen right away, on-screen after longer)
        this.pchk = (this.pchk || 0) + dt; if (this.pchk > 1.5) { const mv = this.plast ? this.plast.distanceTo(this.pos) : 1; this.pstuck = mv < .2 ? (this.pstuck || 0) + this.pchk : 0; (this.plast ||= new THREE.Vector3()).copy(this.pos); this.pchk = 0;
          if (this.pstuck > (this.onScreen() ? 6 : 3)) { this.pstuck = 0; this.pos.set(t.x, this.pos.y, t.z); } } }
    }
    if (this.follow) { // walk the leader's own breadcrumb trail crumb by crumb (never cut corners through walls), keep 'gap' behind
      const f = this.follow, Ld = f.leader, trail = Ld.trail, base = Ld.trailBase || 0;
      if (f.via && f.via.length) { // scripted lead-in (e.g. out through the hostages' room door) before joining the trail
        const t = f.via[0]; const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < .4) f.via.shift(); else { const sp = Math.min(f.maxSpeed, 2.6); this.pos.x += dx / d * sp * dt; this.pos.z += dz / d * sp * dt; if (!this.aiming) this.aimYaw = Math.atan2(dx, dz); moving = true; this.speed = sp; }
      } else if (trail && trail.length) {
        const last = base + trail.length - 1;
        if (f.ci === undefined || f.ci < base) f.ci = this.pickCrumb(trail, base);
        if (f.ci > last) f.ci = last;
        let tgt = trail[f.ci - base]; let d = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z);
        while (d < .45 && f.ci < last) { f.ci++; tgt = trail[f.ci - base]; d = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z); }
        let rem = d + Ld.pos.distanceTo(trail[trail.length - 1]); for (let i = f.ci - base; i < trail.length - 1; i++) rem += trail[i].distanceTo(trail[i + 1]);
        f.rem = rem;
        if (rem > f.gap && d > .05) {
          const sp = clamp((rem - f.gap) * 1.7 + 1.1, 0, f.maxSpeed); const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z, dy = tgt.y - this.pos.y;
          const st = Math.min(sp * dt, d); this.pos.x += dx / d * st; this.pos.z += dz / d * st; if (Math.abs(dy) > .5) this.pos.y += dy * Math.min(1, dt * 5);
          if (!this.aiming) this.aimYaw = Math.atan2(dx, dz); moving = sp > .3; this.speed = sp;
        }
        // unstick: no progress for a while (blocked by a body or a prop) -> hop to the crumb, out of sight if possible
        f.chkT = (f.chkT || 0) + dt;
        if (f.chkT > 1.5) { const moved = f.lastP ? f.lastP.distanceTo(this.pos) : 1; f.stuck = (moved < .2 && rem > f.gap + 1.2) ? (f.stuck || 0) + f.chkT : 0; f.lastP = (f.lastP || new THREE.Vector3()).copy(this.pos); f.chkT = 0;
          const seen = this.onScreen(); if (f.stuck > (seen ? 6 : 3) || (rem > 28 && !seen)) { const k = rem > 28 ? this.crumbBehind(trail, f.gap + 2) : f.ci - base; const c = trail[Math.max(0, k)]; this.pos.copy(c); f.ci = base + Math.min(trail.length - 1, Math.max(0, k) + 1); f.stuck = 0; } }
      }
    }
    if (moving) this.resolveWalls();
    if (!moving) this.speed = damp1(this.speed, 0, 8, dt);
    // ground snap
    if (G.floorAt && !this.noSnap && !this.seat && (moving || this.snapT === undefined || (this.snapT -= dt) < 0)) { const y = G.floorAt(this.pos, this.pos.y + .9); if (y !== null && Math.abs(y - this.pos.y) < 1.6) this.pos.y = lerp(this.pos.y, y, Math.min(1, dt * 14)); this.snapT = .5; }
    this.root.rotation.y = angleLerp(this.root.rotation.y, this.aimYaw, Math.min(1, dt * 8));
  }
  pickAnim() {
    if (!this.alive) return;
    const s = this.speed;
    if (this.forceAnim) { this.play(this.forceAnim, .3); return; }
    if (s > 3.2) this.play(this.hurt ? 'runHurt' : 'sprint', .25, s / 5.2);
    else if (s > 1.9) this.play(this.hurt ? 'runHurt' : 'run', .25, s / 2.9);
    else if (s > .25) this.play(this.hurt ? 'limp' : (s > 1.25 ? 'walkFast' : 'walk'), .3, Math.max(.6, s / (s > 1.25 ? 1.5 : 1.0)));
    else this.play(this.idleAnim || (this.rifle ? 'idle' : 'idle'), .4);
  }
  // ---------- rifle hold (IK) ----------
  holdRifle() {
    if (!this.rifle || !this.bones.R_Hand) return;
    const b = this.bones; this.root.updateMatrixWorld(true);
    const chest = worldPos(b.Spine2, new THREE.Vector3()); const neck = worldPos(b.Neck, new THREE.Vector3());
    const yaw = this.root.rotation.y + (this.aiming ? clamp(angleDiff(this.aimYaw, this.root.rotation.y), -.6, .6) : 0);
    const pitch = this.aiming ? this.aimPitch : -.55;
    const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    // rifle butt at right shoulder when aiming; lower and inward at low ready
    const shoulder = neck.clone().lerp(chest, .35).addScaledVector(right, -.17);
    const gripPos = this.aiming ? shoulder.clone().addScaledVector(fwd, .22).add(_v.set(0, -.07, 0)) : chest.clone().addScaledVector(right, -.12).addScaledVector(fwd, .24).add(_v.set(0, -.2, 0));
    const r = this.rifle; r.position.copy(gripPos);
    const look = gripPos.clone().add(this.aiming ? fwd : new THREE.Vector3(Math.sin(yaw) * .8, -.45, Math.cos(yaw) * .8).addScaledVector(right, .35));
    _m.lookAt(gripPos, look, UP); r.quaternion.setFromRotationMatrix(_m); r.rotateZ(this.aiming ? 0 : .5);
    r.updateMatrixWorld(true);
    const ud = r.userData; const gripW = r.localToWorld(ud.grip.clone().add(_v.set(.0, -.03, .02))); const foreW = r.localToWorld(ud.fore.clone().add(_v.set(0, -.04, 0)));
    const elbowPoleR = chest.clone().addScaledVector(right, -.6).add(_v.set(0, -.5, 0)); const elbowPoleL = chest.clone().addScaledVector(right, .5).add(_v.set(0, -.7, 0)).addScaledVector(fwd, .2);
    twoBoneIK(b.R_UpperArm, b.R_Forearm, b.R_Hand, gripW, elbowPoleR);
    twoBoneIK(b.L_UpperArm, b.L_Forearm, b.L_Hand, foreW, elbowPoleL);
    // orient hands along the rifle
    if (b.R_Finger2) aimBone(b.R_Hand, worldPos(b.R_Finger2, new THREE.Vector3()), gripW.clone().addScaledVector(fwd, .05).add(_v.set(0, -.1, 0)));
    if (b.L_Finger2) aimBone(b.L_Hand, worldPos(b.L_Finger2, new THREE.Vector3()), foreW.clone().add(_v.set(0, -.08, 0)).addScaledVector(right, .06));
  }
  aimSpine() {
    const b = this.bones; if (!b.Spine1 || !this.aiming) return;
    const d = clamp(angleDiff(this.aimYaw, this.root.rotation.y), -.8, .8);
    const pitch = clamp(this.aimPitch, -.8, .8);
    _q.setFromAxisAngle(UP, d * .5); b.Spine1.quaternion.premultiply(_q);
    b.Spine1.updateMatrixWorld(true);
  }
  // ---------- per-frame ----------
  update(dt) {
    if (this.removed) return;
    if (this.pool && this.down && !this.treated && this.pool.scale.x < 1.35) this.pool.scale.setScalar(this.pool.scale.x + dt * .035);
    if (this.alive && this.down && !this.treated) { this.health -= dt * (this.bleedRate ?? .75); if (this.health <= 0) { if (this.noDie) this.health = 1; else this.die(null); } }
    else if (this.friendly && this.alive && this.health < (this.treated ? 75 : 100) && G.time - (this.lastHit || 0) > 8) this.health = Math.min(this.treated ? 75 : 100, this.health + dt * 3);
    const distCam = this.pos.distanceTo(G.camera.position);
    this.lod = distCam > 70 ? 2 : distCam > 35 ? 1 : 0;
    if (this.alive) { if (this.brain) this.brain(dt); this.updateMove(dt); this.pickAnim(); }
    this.frameSkip = (this.frameSkip || 0) + 1; const skip = this.lod === 2 ? 3 : this.lod === 1 ? 2 : 1;
    this.animAcc = (this.animAcc || 0) + dt;
    if (this.frameSkip % skip === 0) { this.mixer.update(this.animAcc); this.animAcc = 0; }
    if (this.dead) this.updateDeath(dt);
    this.root.updateMatrixWorld(true);
    if (this.band) { const hp = worldPos(this.bones.Head, new THREE.Vector3()); this.band.position.copy(hp).add(_v.set(0, .07, 0)); this.band.quaternion.copy(this.root.quaternion); this.band.rotateX(Math.PI / 2 - .2); if (this.dead) this.band.visible = false; }
    if (this.alive) { this.aimSpine(); if (this.hitFlinch > 0 && this.bones.Spine1) { this.hitFlinch -= dt; this.bones.Spine1.rotateX(-this.hitFlinch * 1.2); } if (this.lod < 2) this.holdRifle(); else if (this.rifle) this.holdRifle(); }
    else if (this.rifle && this.dropRifle) { const d = this.dropRifle; if (d.t < 1.5) { d.t += dt; d.v.y -= 9.8 * dt; this.rifle.position.addScaledVector(d.v, dt); this.rifle.rotation.z += dt * 3; const fy = (this.dead?.baseY ?? 0) + .05; if (this.rifle.position.y < fy) { this.rifle.position.y = fy; d.v.set(0, 0, 0); } } }
  }
  updateDeath(dt) {
    const d = this.dead; d.t += dt; const k = clamp((d.t - .15) / .55, 0, 1); const e = k * k;
    const ang = e * Math.PI / 2 * .96;
    const r = this.root; r.rotation.set(0, r.rotation.y, 0);
    if (d.dir === 'b') r.rotateX(-ang); else if (d.dir === 'f') r.rotateX(ang); else if (d.dir === 'l') r.rotateZ(ang); else r.rotateZ(-ang);
    r.position.y = d.baseY + (d.dir === 'b' || d.dir === 'f' ? .12 * e : .15 * e);
    if (k >= 1 && !d.done) { d.done = true; this.mixer.timeScale = 0; }
  }
}
function damp1(a, b, k, dt) { return a + (b - a) * (1 - Math.exp(-k * dt)); }
export function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function sphereHit(ro, rd, c, r) { const oc = _v.copy(ro).sub(c); const b = oc.dot(rd), cc = oc.dot(oc) - r * r; const h = b * b - cc; if (h < 0) return null; const t = -b - Math.sqrt(h); return t > 0 ? t : null; }
function capsuleHit(ro, rd, pa, pb, r) {
  const ba = _v2.copy(pb).sub(pa), oa = _v3.copy(ro).sub(pa);
  const baba = ba.dot(ba), bard = ba.dot(rd), baoa = ba.dot(oa), rdoa = rd.dot(oa), oaoa = oa.dot(oa);
  const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h >= 0) { const t = (-b - Math.sqrt(h)) / a; const y = baoa + t * bard; if (y > 0 && y < baba && t > 0) return t;
    const oc = y <= 0 ? oa : _v.copy(ro).sub(pb); const bb = rd.dot(oc), cc2 = oc.dot(oc) - r * r; const hh = bb * bb - cc2; if (hh > 0) { const t2 = -bb - Math.sqrt(hh); if (t2 > 0) return t2; } }
  return null;
}

// ---------- AI helpers ----------
export function hostilesOf(a) { return a.hostile ? [G.player, ...G.actors.filter(x => x.alive && x.friendly && !x.down)] : G.actors.filter(x => x.alive && x.hostile); }
export function visible(fromActor, target) {
  const e = fromActor.eye(new THREE.Vector3()); const t = target.isPlayer ? target.eyePos.clone() : target.chest(new THREE.Vector3());
  return G.lineOfSight(e, t);
}
function nearestVisible(a) {
  let best = null, bd = 1e9; for (const h of hostilesOf(a)) { if (h.isPlayer && !h.alive) continue; const hp = h.isPlayer ? h.pos : h.pos; const d = hp.distanceTo(a.pos); if (d > (a.range || 80) || d >= bd) continue; if (visible(a, h)) { bd = d; best = h; } }
  return best;
}
export function fireAt(a, t) {
  const muzzle = a.rifle ? a.rifle.localToWorld(a.rifle.userData.muzzle.clone()) : a.eye(new THREE.Vector3());
  const tp = t.isPlayer ? t.eyePos.clone().add(_v.set(0, -.25, 0)) : t.chest(new THREE.Vector3());
  const dist = muzzle.distanceTo(tp);
  const dir = tp.clone().sub(muzzle).normalize();
  G.fx.muzzle(muzzle, dir, .8); G.audio.shotAt(muzzle, a.hostile ? 'ak' : 'm4');
  if (a.rifle) a.rifle.userData.kick = .08;
  // hit roll
  let p = a.accuracy * clamp(20 / (dist + 5), .18, 1.35);
  if (t.isPlayer) { p *= t.crouching ? .6 : 1; p *= 1 - clamp(t.vel.length() / 9, 0, .45); p *= G.difficultyMul || 1; if (G.player.inCover) p *= .5; }
  const hit = R() < p;
  const spread = hit ? .004 : rr(.02, .06);
  dir.add(_v.set(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(spread)).normalize();
  const res = G.shootRay(muzzle, dir, 300, a);
  if (R() < .35) G.fx.tracer(muzzle, res.point, a.hostile);
  if (hit && res.actor === null && res.player) { t.damage(a.hostile ? rr(11, 19) : 0, a.pos); }
  else if (res.actor && (hit || (res.actor.kind === 'hostage' && R() < .35))) {
    const v = res.actor; const dmg = !a.hostile ? (v.hostile ? (res.part === 'head' ? 110 : 45) : 0) : v.kind === 'hostage' ? 20 : v.friendly ? rr(10, 18) : 0; // our operators wear plates and helmets
    if (a.hostile && v.kind === 'hostage') v.damage(rr(8, 13), a.pos, res.part); else v.damage(dmg, a.pos, res.part);
    if (dmg > 0) G.fx.impact(res.point, res.normal || new THREE.Vector3(0, 1, 0), 'flesh');
  }
  else if (t.isPlayer) { // near miss: supersonic crack beside the player
    const cl = G.camera.position.clone().add(_v.set(rr(-1.2, 1.2), rr(-.3, .6), rr(-1.2, 1.2))); G.audio.crack(cl); t.suppress(.25);
  }
  if (res.hitWorld) G.fx.impact(res.point, res.normal, res.surface);
}

// guards/fighters brain
export function hostileBrain(a) {
  return (dt) => {
    a.seeT -= dt; if (a.seeT <= 0) { a.seeT = .25 + R() * .15; a.canSee = a.alertT > 0 || a.state === 'engage' ? nearestVisible(a) : null; }
    if (a.state === 'idle') { if (a.alertT > 0) { a.state = 'alert'; a.reactT = a.reaction; } return; }
    if (a.state === 'alert') { a.reactT -= dt; if (a.reactT <= 0) a.state = 'engage'; if (a.canSee) a.faceTo(a.canSee.pos); return; }
    if (a.state === 'engage') {
      const t = a.canSee;
      if (t) {
        a.aiming = true; const tp = t.isPlayer ? t.pos : t.pos; a.faceTo(tp); a.aimPitch = Math.atan2((t.isPlayer ? t.eyePos.y - .3 : t.pos.y + 1.3) - (a.pos.y + 1.45), Math.hypot(tp.x - a.pos.x, tp.z - a.pos.z));
        a.fireCd -= dt;
        if (a.fireCd <= 0) { if (a.burst <= 0) a.burst = Math.floor(rr(2, 6)); fireAt(a, t); a.burst--; a.fireCd = a.burst > 0 ? rr(.09, .14) : rr(.7, 1.6); }
        if (a.peek) { a.peekT = (a.peekT || 0) - dt; if (a.peekT <= 0) { a.crouch = a.crouch ? 0 : 1; a.peekT = a.crouch ? rr(1, 2) : rr(1.8, 3.2); a.idleAnim = a.crouch ? 'crouch' : 'idle'; } }
      } else { a.aiming = false; if (a.hunt && !a.path && R() < dt * .5) a.setPath([a.hunt.clone()], 2.6); }
    }
  };
}
export function teamBrain(a) {
  return (dt) => {
    a.seeT -= dt; if (a.seeT <= 0) { a.seeT = .2 + R() * .1; a.canSee = a.weaponsFree ? nearestVisible(a) : null; }
    const t = a.canSee;
    if (t && a.weaponsFree) {
      a.aiming = true; a.faceTo(t.pos); a.aimPitch = Math.atan2(t.pos.y + 1.3 - (a.pos.y + 1.45), Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z));
      a.fireCd -= dt; if (a.fireCd <= 0) { fireAt(a, t); a.fireCd = rr(.35, .9) * (a.fireMul || 1); }
    } else { a.aiming = a.readyAim || false; if (a.lookAt) a.faceTo(a.lookAt); }
  };
}
export function hostageBrain(a) { return () => {}; }
export function civBrain(a) {
  return (dt) => {
    // step out of the way of moving vehicles (people in the market move aside for the truck)
    if ((a.state === 'ambient' || a.state === 'flee') && G.mission && G.mission.vehicles && (a.dodgeT = (a.dodgeT || 0) - dt) < 0) {
      a.dodgeT = .25;
      for (const v of G.mission.vehicles) { if (v.mp || v.speed < .8) continue; const o = v.obj.position; const fx = Math.sin(v.obj.rotation.y), fz = Math.cos(v.obj.rotation.y);
        const rx = a.pos.x - o.x, rz = a.pos.z - o.z; const ahead = rx * fx + rz * fz, lat = rx * fz - rz * fx; const half = v.obj.userData.rcws ? 2.3 : 1.6;
        if (ahead > -2 && ahead < 6 + v.speed * 1.6 && Math.abs(lat) < half + .5) { const s = lat >= 0 ? 1 : -1; const dest = a.pos.clone(); dest.x += fz * s * (half + 1.3 - Math.abs(lat)); dest.z += -fx * s * (half + 1.3 - Math.abs(lat)); const cont = a.path ? a.path.slice(a.pathI) : null, spd = a.moveSpeed, done = a.onPath;
          a.setPath([dest], Math.max(2.6, spd || 0), cont && cont.length ? () => a.setPath(cont, spd, done) : done); break; } }
    }
    if (a.state === 'ambient' && G.panic > 0 && a.pos.distanceTo(G.camera.position) < 120) {
      a.state = 'flee'; const away = a.pos.clone().sub(G.panicAt || G.camera.position).setY(0).normalize();
      const dest = a.pos.clone().addScaledVector(away, 40); dest.z = clamp(dest.z, -3.5, 3.5) + (Math.abs(a.pos.z) > 4 ? a.pos.z : 0);
      a.setPath([dest], rr(3.6, 5.2), x => x.remove()); a.idleAnim = null;
    }
  };
}
