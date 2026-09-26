// Vehicles: disguised pickup (with mattresses), IDF APC, UH-60 helicopter
import * as THREE from 'three';
import { G, rr, R, clamp, damp, pick } from './core.js';
import { A } from './assets.js';
import { MAT, boxUV } from './materials.js';
import { groundY } from './world.js';
import { buildHeliInterior, dressHeli } from './heli.js';

function normalizeModel(src, length, { flip = false } = {}) {
  const o = src.scene.clone(true); const g = new THREE.Group(); g.add(o);
  o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  o.updateMatrixWorld(true); let b = new THREE.Box3().setFromObject(o); let s = b.getSize(new THREE.Vector3());
  // longest horizontal axis -> z
  if (s.x > s.z) o.rotation.y = Math.PI / 2; if (flip) o.rotation.y += Math.PI;
  o.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(o); s = b.getSize(new THREE.Vector3());
  const k = length / s.z; o.scale.multiplyScalar(k); o.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(o);
  const c = b.getCenter(new THREE.Vector3()); o.position.x -= c.x; o.position.z -= c.z; o.position.y -= b.min.y;
  return g;
}

class Vehicle {
  constructor(obj) { this.obj = obj; this.speed = 0; this.target = 0; this.path = null; this.u = 0; this.onEnd = null; this.shakeAmt = 0; G.scene.add(obj); }
  followPath(pts, speed, onEnd) { this.curve = new THREE.CatmullRomCurve3(pts.map(p => p.clone()), false, 'catmullrom', .2); this.len = this.curve.getLength(); this.u = 0; this.target = speed; this.onEnd = onEnd; }
  update(dt) {
    if (this.curve) {
      this.speed = damp(this.speed, this.stalled ? 0 : this.target, this.stalled ? 3 : 1.2, dt);
      this.u += this.speed * dt / this.len;
      if (this.u >= 1) { this.u = 1; const f = this.onEnd; this.onEnd = null; this.curve = null; this.speed = 0; if (f) f(); }
      else {
        const p = this.curve.getPointAt(this.u), t = this.curve.getTangentAt(this.u);
        this.obj.position.set(p.x, groundY(p.x), p.z); this.obj.rotation.y = Math.atan2(t.x, t.z);
        // body roll/pitch from road roughness
        this.obj.rotation.x = Math.sin(G.time * 7.3 + p.x) * .006 * this.speed; this.obj.rotation.z = Math.sin(G.time * 5.1 + p.z) * .008 * this.speed;
      }
    }
    if (this.engine) G.audio.setLoopPos(this.engine, this.obj.position);
  }
}

export function makePickup() {
  const src = A.models.pickup; const g = src ? normalizeModel(src, 5.6, { flip: true }) : new THREE.Group();
  g.traverse(c => { if (c.isMesh) { c.material = c.material.clone(); c.material.color.multiply(new THREE.Color('#d9d2c2')); c.material.roughness = Math.max(.5, c.material.roughness); } });
  // bed cover frame + tarp (operators hidden underneath), mattresses and household items on top
  const bed = new THREE.Group(); g.add(bed); bed.position.set(0, 0, -2.15);
  const tarpMat = MAT.tarp[0];
  const hoopMat = MAT.metalDark;
  for (const z of [-.75, 0, .75]) { const hp = new THREE.Mesh(new THREE.TorusGeometry(.8, .025, 4, 16, Math.PI), hoopMat); hp.position.set(0, 1.05, z); bed.add(hp); }
  const tg = new THREE.CylinderGeometry(.82, .82, 1.6, 16, 1, true, -Math.PI / 2, Math.PI); tg.rotateX(-Math.PI / 2);
  const tarp = new THREE.Mesh(tg, tarpMat); tarp.position.set(0, 1.05, 0); bed.add(tarp);
  // mattresses and bundles
  const mats = [MAT.mattress, MAT.mattress2, MAT.mattress3];
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(boxUV(1.35, .13, 1.85, .8), mats[i % 3]); m.position.set(rr(-.08, .08), 1.92 + i * .14, rr(-.1, .1) + .15); m.rotation.y = rr(-.06, .06); m.castShadow = true; bed.add(m); }
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.28, 8, 6), pick([MAT.blanket, MAT.blanket2, MAT.tarp[3]])); b.scale.set(1.2, .7, 1); b.position.set(rr(-.4, .4), 2.55, rr(-.7, .7)); bed.add(b); }
  const chairG = new THREE.Mesh(boxUV(.44, .5, .44, 1), MAT.plasticGreen); chairG.position.set(.3, 2.8, .5); chairG.rotation.set(.3, .5, .2); bed.add(chairG);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(.95, .012, 3, 20), MAT.woodLight); rope.rotation.x = Math.PI / 2; rope.scale.set(.8, 1.2, 1); rope.position.set(0, 2.1, 0); bed.add(rope);
  bed.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  const v = new Vehicle(g); v.bed = bed; return v;
}

// ---------- IDF Namer heavy APC (procedural, Merkava-based hull), front = +z, rear ramp = -z ----------
let apcMats = null;
function apcMaterials() {
  if (apcMats) return apcMats;
  const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  // armour plate: sinai grey-green paint, panel seams, bolts, chips and dust
  const plate = cv(512, 512, (g, W, H) => { g.fillStyle = '#7f7c68'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 60 : 170},${Math.random() < .5 ? 58 : 160},${Math.random() < .5 ? 45 : 130},${Math.random() * .08})`; g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 18, 2 + Math.random() * 18); }
    g.strokeStyle = 'rgba(30,28,22,.55)'; g.lineWidth = 3; for (let x = 0; x <= W; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y <= H; y += 256) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let x = 12; x < W; x += 128) for (let y = 12; y < H; y += 40) { g.fillStyle = 'rgba(40,38,30,.7)'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); g.beginPath(); g.arc(x + 104, y, 3, 0, 7); g.fill(); }
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(55,48,40,.5)'; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 6, 1 + Math.random() * 4); }
    const d = g.createLinearGradient(0, H * .55, 0, H); d.addColorStop(0, 'rgba(176,150,112,0)'); d.addColorStop(1, 'rgba(176,150,112,.55)'); g.fillStyle = d; g.fillRect(0, 0, W, H); });
  const track = cv(128, 256, (g, W, H) => { g.fillStyle = '#26241f'; g.fillRect(0, 0, W, H); for (let y = 0; y < H; y += 32) { g.fillStyle = '#3d3a33'; g.fillRect(4, y + 3, W - 8, 22); g.fillStyle = '#1a1916'; g.fillRect(W / 2 - 6, y, 12, 32); g.fillStyle = 'rgba(160,140,110,.35)'; g.fillRect(6, y + 20, W - 12, 3); } });
  track.repeat.set(1, 6);
  apcMats = {
    hull: new THREE.MeshStandardMaterial({ map: plate, roughness: .78, metalness: .3, color: '#ffffff' }),
    dark: new THREE.MeshStandardMaterial({ color: '#2a2925', roughness: .7, metalness: .5 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1c1b19', roughness: .92 }),
    track: new THREE.MeshStandardMaterial({ map: track, roughness: .85, metalness: .4 }),
    olive: new THREE.MeshStandardMaterial({ color: '#4d5236', roughness: .95 }),
    black: new THREE.MeshStandardMaterial({ color: '#141414', roughness: .8 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#e8e2cf', emissive: '#fff4d0', emissiveIntensity: .6, roughness: .2 }),
    red: new THREE.MeshStandardMaterial({ color: '#7a1010', emissive: '#ff2010', emissiveIntensity: .5 }),
    inside: new THREE.MeshStandardMaterial({ color: '#3b3b36', roughness: .9, side: THREE.BackSide }),
  };
  return apcMats;
}
export function makeAPC() {
  const M = apcMaterials(); const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.castShadow = me.receiveShadow = true; parent.add(me); return me; };
  const prof = (pts, width, mat, x = 0) => { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => sh.lineTo(p[0], p[1])); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 1 }); geo.translate(0, 0, -width / 2); geo.rotateY(-Math.PI / 2);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.2, uv.getY(i) / 2.2); return add(geo, mat, x); };
  // hull: long, low, steep front glacis (engine in front, like the Merkava it is built on)
  prof([[-3.85, .62], [-3.9, 2.02], [1.2, 2.08], [3.95, 1.3], [3.98, .95], [3.35, .55], [-3.4, .5]], 2.36, M.hull);
  prof([[-3.85, 1.0], [-3.9, 1.95], [1.1, 2.0], [3.9, 1.26], [3.9, 1.0]], 3.36, M.hull);
  // modular side armour skirts (segmented) over the tracks
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) { const p = add(boxUV(.14, .78, 1.2, 1.1), M.hull, sx * 1.74, 1.18, -3.1 + i * 1.23); p.rotation.z = sx * .04; }
    add(boxUV(.14, .5, .9, 1), M.hull, sx * 1.74, 1.2, 3.55).rotation.x = -.5;
    // running gear: road wheels, sprocket (front), idler (rear), return rollers and the track belt
    const wg = new THREE.CylinderGeometry(.34, .34, .22, 18); wg.rotateZ(Math.PI / 2);
    for (let i = 0; i < 6; i++) { add(wg, M.dark, sx * 1.45, .38, -2.75 + i * 1.08); add(new THREE.CylinderGeometry(.12, .12, .24, 10).rotateZ(Math.PI / 2), M.rubber, sx * 1.47, .38, -2.75 + i * 1.08); }
    add(new THREE.CylinderGeometry(.4, .4, .26, 14).rotateZ(Math.PI / 2), M.dark, sx * 1.45, .72, 3.35); add(new THREE.CylinderGeometry(.36, .36, .24, 14).rotateZ(Math.PI / 2), M.dark, sx * 1.45, .7, -3.4);
    const belt = new THREE.Group(); belt.position.set(sx * 1.45, 0, 0); g.add(belt);
    const bl = add(new THREE.BoxGeometry(.64, .07, 6.5), M.track, 0, .04, -.05, belt); const tp = add(new THREE.BoxGeometry(.64, .07, 6.2), M.track, 0, 1.08, 0, belt);
    for (const [z, y] of [[3.35, .72], [-3.4, .7]]) { const arc = new THREE.CylinderGeometry(.44, .44, .64, 16, 1, true, z > 0 ? 0 : Math.PI, Math.PI); arc.rotateZ(Math.PI / 2); add(arc, M.track, 0, y, z, belt); }
    g.userData.tracks = (g.userData.tracks || []).concat([bl, tp]);
    // stowage baskets along the rear with tarps, bags and jerrycans (every IDF vehicle carries a pile of kit)
    const bk = add(new THREE.BoxGeometry(.5, .38, 2.4), M.dark, sx * 1.45, 2.24, -2.2); bk.material = M.dark;
    for (let k = 0; k < 4; k++) { const bag = add(new THREE.CapsuleGeometry(.16, .5, 3, 8).rotateX(Math.PI / 2), R() < .5 ? M.olive : M.black, sx * 1.45 + rr(-.1, .1), 2.52, -3.1 + k * .6); bag.rotation.y = rr(-.2, .2); }
    add(boxUV(.18, .45, .32, 1), M.olive, sx * 1.72, 1.9, -1.2 + sx * .2);
    // head / tail lights
    add(new THREE.BoxGeometry(.18, .1, .06), M.lamp, sx * 1.35, 1.38, 3.9); add(new THREE.BoxGeometry(.14, .08, .05), M.red, sx * 1.5, 1.8, -3.92);
    // smoke grenade dischargers on the front corners
    for (let k = 0; k < 4; k++) { const tube = add(new THREE.CylinderGeometry(.045, .045, .3, 8), M.dark, sx * (1.3 - k * .1), 2.12, 1.25 + k * .02); tube.rotation.x = -.9; tube.rotation.z = sx * .4; }
  }
  // hatches, periscopes, commander cupola
  add(new THREE.CylinderGeometry(.42, .46, .16, 20), M.hull, -.6, 2.14, .4); add(new THREE.CylinderGeometry(.36, .36, .05, 20), M.hull, -.6, 2.24, .4);
  add(new THREE.CylinderGeometry(.34, .34, .08, 18), M.hull, .8, 2.12, -1.2); add(new THREE.CylinderGeometry(.34, .34, .08, 18), M.hull, -.8, 2.12, -1.8);
  for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(.16, .1, .1), M.black, -.6 + Math.cos(k * 1.25) * .36, 2.25, .4 + Math.sin(k * 1.25) * .36);
  // remote weapon station (Samson) with a 7.62 MG, optics box and ammo can
  const rcws = new THREE.Group(); rcws.position.set(.55, 2.1, .9); g.add(rcws);
  add(new THREE.CylinderGeometry(.34, .38, .2, 16), M.hull, 0, .1, 0, rcws);
  const head = new THREE.Group(); head.position.y = .42; rcws.add(head);
  add(boxUV(.55, .36, .7, 1), M.hull, 0, 0, 0, head); add(boxUV(.24, .24, .3, 1), M.dark, .36, .06, .1, head); add(new THREE.BoxGeometry(.16, .12, .06), M.black, .36, .06, .27, head);
  const gun = add(new THREE.CylinderGeometry(.035, .035, 1.25, 10).rotateX(Math.PI / 2), M.dark, -.12, .04, .78, head); add(new THREE.CylinderGeometry(.06, .06, .18, 10).rotateX(Math.PI / 2), M.dark, -.12, .04, 1.4, head);
  add(boxUV(.2, .2, .28, 1), M.olive, -.34, -.02, -.1, head);
  g.userData.rcws = rcws; g.userData.rcwsHead = head; g.userData.muzzle = new THREE.Vector3(-.12, .04, 1.5);
  // antennas with small flags
  for (const [x, z] of [[-1.3, -3.3], [1.3, -3.3], [1.4, .9]]) { add(new THREE.CylinderGeometry(.008, .014, 2.8, 4), M.dark, x, 3.45, z); }
  // front: engine grilles, tow hooks, glacis plate details
  for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(2.2, .03, .06), M.black, 0, 1.62 + k * .08, 2.55 - k * .12).rotation.x = -.33;
  for (const sx of [-.8, .8]) add(new THREE.TorusGeometry(.1, .03, 6, 12), M.dark, sx, .98, 3.98);
  // rear ramp (hinged at the bottom) and a dim troop compartment behind it
  const hinge = new THREE.Group(); hinge.position.set(0, .62, -3.9); g.add(hinge);
  const ramp = add(boxUV(1.7, 1.35, .14, 1.2), M.hull, 0, .675, -.07, hinge); add(new THREE.BoxGeometry(.4, .06, .02), M.black, 0, 1.1, -.15, hinge);
  add(new THREE.BoxGeometry(1.65, 1.3, 3.2), M.inside, 0, 1.3, -2.3);
  // doorway into the troop compartment, revealed when the ramp drops (painted depth: benches, floor, dim red light)
  { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
    const bg = x.createRadialGradient(128, 110, 10, 128, 128, 170); bg.addColorStop(0, '#3a1612'); bg.addColorStop(.35, '#1d1a17'); bg.addColorStop(1, '#0b0b0a'); x.fillStyle = bg; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#26241f'; x.beginPath(); x.moveTo(0, 256); x.lineTo(256, 256); x.lineTo(170, 160); x.lineTo(86, 160); x.closePath(); x.fill();
    for (const s of [-1, 1]) { x.fillStyle = '#34322b'; x.beginPath(); x.moveTo(128 + s * 128, 200); x.lineTo(128 + s * 128, 150); x.lineTo(128 + s * 50, 128); x.lineTo(128 + s * 50, 150); x.closePath(); x.fill();
      x.fillStyle = '#4b4a3c'; for (let k = 0; k < 3; k++) x.fillRect(s > 0 ? 190 + k * 18 : 40 - k * 18, 60 + k * 6, 10, 55 - k * 10); }
    x.fillStyle = 'rgba(255,60,40,.8)'; x.fillRect(118, 34, 20, 5);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const door = add(new THREE.PlaneGeometry(1.6, 1.3), new THREE.MeshBasicMaterial({ map: t, color: '#9a9a9a' }), 0, 1.28, -3.93); door.rotation.y = Math.PI; door.castShadow = false; }
  g.userData.ramp = ramp; g.userData.hinge = hinge;
  // dust weathering on everything painted
  const v = new Vehicle(g);
  const baseUpdate = v.update.bind(v);
  v.update = (dt) => {
    baseUpdate(dt);
    for (const t of g.userData.tracks) t.material.map.offset.y -= v.speed * dt / 1.1;
    if (v.rampOpen !== undefined) { v.rampA = damp(v.rampA || 0, v.rampOpen ? 2.02 : 0, 1.6, dt); hinge.rotation.x = -v.rampA; }
    // weapon station: slew toward the nearest visible armed enemy and fire short bursts
    v.gunT = (v.gunT || 0) - dt;
    if (v.guns && v.gunT <= 0) {
      v.gunT = .5; const mp = head.localToWorld(g.userData.muzzle.clone()); let best = null, bd = 160;
      for (const a of G.actors) { if (!a.alive || !a.hostile) continue; const d = a.pos.distanceTo(mp); if (d < bd && G.lineOfSight(mp, a.chest(new THREE.Vector3()))) { bd = d; best = a; } }
      v.gunTarget = best; if (best) { v.burst = 5 + Math.floor(R() * 5); }
    }
    if (v.gunTarget && v.gunTarget.alive) {
      const tp = v.gunTarget.chest(new THREE.Vector3()); const lp = rcws.worldToLocal(tp.clone()); const want = Math.atan2(lp.x, lp.z); head.rotation.y += Math.max(-dt * 2.5, Math.min(dt * 2.5, ((want - head.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      v.fireCd = (v.fireCd || 0) - dt;
      if (v.burst > 0 && v.fireCd <= 0 && Math.abs(((want - head.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < .1) {
        v.fireCd = .085; v.burst--; if (v.burst === 0) v.fireCd = rr(.6, 1.2);
        const mp = head.localToWorld(g.userData.muzzle.clone()); const dir = tp.clone().sub(mp).normalize(); dir.x += rr(-.015, .015); dir.y += rr(-.015, .015); dir.normalize();
        G.fx.muzzle(mp, dir, 1.2); G.audio.shotAt(mp, 'm4'); const res = G.shootRay(mp, dir, 200, null);
        if (R() < .6) G.fx.tracer(mp, res.point, false); if (res.hitWorld) G.fx.impact(res.point, res.normal, res.surface);
        if (res.actor && res.actor.hostile) res.actor.damage(60, mp, res.part);
      }
    }
  };
  return v;
}

export function makeHeli() {
  const src = A.models.uh60; if (!src) return null;
  const o = src.scene.clone(true); const g = new THREE.Group(); g.add(o);
  o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.material = c.material.clone(); c.material.color.multiply(new THREE.Color('#8a9180')); c.material.roughness = Math.max(.55, c.material.roughness || .6); } });
  o.rotation.y = -Math.PI / 2; // nose (-X) -> -Z
  o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); o.position.y -= b.min.y; o.position.x -= (b.min.x + b.max.x) / 2; o.position.z -= (b.min.z + b.max.z) / 2;
  o.updateMatrixWorld(true);
  // gather rotor blades and re-parent under spinning pivots
  const main = [], tail = []; o.traverse(c => { if (/MainBlade/i.test(c.name)) main.push(c); if (/TailBlade/i.test(c.name)) tail.push(c); });
  const mkPivot = (blades) => { if (!blades.length) return null; const bb = new THREE.Box3(); blades.forEach(x => bb.expandByObject(x)); const c = bb.getCenter(new THREE.Vector3());
    const pv = new THREE.Group(); pv.position.copy(g.worldToLocal(c.clone())); g.add(pv); pv.updateMatrixWorld(true); blades.forEach(x => pv.attach(x)); return { pv, size: bb.getSize(new THREE.Vector3()) }; };
  const mp = mkPivot(main), tp = mkPivot(tail);
  // rotor disc blur (appears at speed)
  let disc = null; if (mp) { const r = Math.max(mp.size.x, mp.size.z) / 2; disc = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: '#1a1a18', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.copy(mp.pv.position); disc.position.y += .05; g.add(disc); }
  const v = new Vehicle(g); v.rotor = 0; v.mp = mp; v.tp = tp; v.disc = disc; v.tailAxis = tp ? (tp.size.x < tp.size.z ? 'x' : 'z') : 'x';
  v.model = o; dressHeli(o, v); buildHeliInterior(o, v);
  // model-space point (nose -X, floor y=-1.57) -> this vehicle's local frame / world
  v.toLocal = (p) => { o.updateMatrix(); return p.clone().applyMatrix4(o.matrix); };
  v.toWorld = (p) => { g.updateMatrixWorld(true); return p.clone().applyMatrix4(o.matrixWorld); };
  const baseUpdate = v.update.bind(v);
  v.update = (dt) => {
    v.updateDoors(dt); v.updatePeople(dt);
    if (v.flight) { const f = v.flight; f.t += dt; const k = clamp(f.t / f.dur, 0, 1); const e = f.ease ? f.ease(k) : k; v.obj.position.lerpVectors(f.from, f.to, e); if (f.yawTo !== undefined) v.obj.rotation.y = f.yaw0 + (f.yawTo - f.yaw0) * e; v.obj.rotation.x = f.pitch ? f.pitch * Math.sin(k * Math.PI) : 0; if (k >= 1) { v.flight = null; f.done && f.done(); } }
    else baseUpdate(dt);
    const w = v.rotor * 28; if (v.mp) v.mp.pv.rotation.y += w * dt; if (v.tp) v.tp.pv.rotation[v.tailAxis] += w * 4.2 * dt;
    if (v.disc) v.disc.material.opacity = clamp((v.rotor - .5) * .2, 0, .09);
    if (v.rotor > .6) { const gy = groundY(v.obj.position.x); const h = v.obj.position.y - gy; if (h < 28) { const n = Math.floor((1 - h / 28) * 90 * dt * 60 / 60 * 2) + (R() < .5 ? 1 : 0); for (let i = 0; i < n; i++) { const a = R() * 6.28, r = rr(2, 9) + (h * .15); const p = new THREE.Vector3(v.obj.position.x + Math.cos(a) * r, gy + rr(.05, .6), v.obj.position.z + Math.sin(a) * r); const vel = new THREE.Vector3(Math.cos(a), rr(.05, .25), Math.sin(a)).multiplyScalar(rr(6, 13) * (1.2 - h / 28)); G.fx.smoke.emit(p, vel, rr(1.2, 2.6), rr(.6, 1.2), rr(3, 6), [.8, .72, .58, .32], [.85, .78, .64, 0], 1.3, .15); } } }
    if (v.loop) G.audio.setLoopPos(v.loop, v.obj.position);
  };
  v.fly = (to, dur, { yawTo, ease, pitch, done } = {}) => { v.flight = { from: v.obj.position.clone(), to: to.clone(), dur, t: 0, yaw0: v.obj.rotation.y, yawTo, ease, pitch, done }; };
  return v;
}
