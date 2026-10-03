// "The Shaft": what the commander sees through other eyes. The engineers' tracked robot "Holed" (a visible model that
// drives into B and is winched down the shaft, with its own camera), the dog of the "Oketz" unit, and the helmet
// cameras of the force. The shaft and the tunnel below it are a small scene of their own (shaftScene): 22 m of precast
// rings with a ladder, a booby trap on the ladder at 6 m, a chamber at the bottom and two branches. It is lit only by
// the robot's lamp and a little daylight from the mouth, and drawn with Lambert materials so the baked daylight
// volumes of the town (gi.js, MeshStandardMaterial only) never reach underground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rng, clamp, lerp, V3, fmtClock } from '../core.js';
import { canvasTex } from '../materials.js';
import { cableGeometry } from '../world.js';
import { TL, SHAFT, hT } from './world.js';

const $ = id => document.getElementById(id);
const D = 22; // shaft depth, m
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
function merge(list, mat, parent) { const m = new THREE.Mesh(mergeGeometries(list.map(g => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; })), mat); parent.add(m); return m; }
function rod(a, b, r, seg = 6) { const dv = b.clone().sub(a); const L = dv.length(); const g = new THREE.CylinderGeometry(r, r, L, seg); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dv.normalize())); const m = a.clone().add(b).multiplyScalar(.5); return g.translate(m.x, m.y, m.z); }

// ---------- the robot ----------
// A small tracked UGV of the kind engineers lower into shafts: two track units, a low hull, a folding arm with the
// camera head and lamp, a whip antenna. Three draw calls.
export function makeRobot() {
  const g = new THREE.Group(); const olive = [], black = [], steel = [];
  olive.push(new THREE.BoxGeometry(.36, .14, .58).translate(0, .16, 0), new THREE.BoxGeometry(.28, .07, .3).translate(0, .265, -.06), new THREE.BoxGeometry(.1, .08, .1).translate(0, .62, .26));
  for (const s of [-1, 1]) { black.push(new THREE.BoxGeometry(.09, .12, .5).translate(s * .23, .1, 0)); for (const z of [-.25, .25]) black.push(new THREE.CylinderGeometry(.065, .065, .09, 10).rotateZ(Math.PI / 2).translate(s * .23, .1, z)); }
  steel.push(rod(V3(0, .3, -.1), V3(0, .5, .14), .022), rod(V3(0, .5, .14), V3(0, .6, .25), .02), rod(V3(-.12, .25, -.22), V3(-.12, .75, -.24), .005, 4), new THREE.CylinderGeometry(.025, .025, .04, 8).rotateX(Math.PI / 2).translate(0, .62, .32));
  const mo = new THREE.MeshStandardMaterial({ color: '#4b4d39', roughness: .7, metalness: .2 }), mb = new THREE.MeshStandardMaterial({ color: '#141413', roughness: .9 }), ms = new THREE.MeshStandardMaterial({ color: '#2a2a28', roughness: .4, metalness: .7 });
  merge(olive, mo, g); merge(black, mb, g); merge(steel, ms, g);
  const led = new THREE.Mesh(new THREE.BoxGeometry(.07, .03, .01).translate(0, .64, .315), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.9, 1.6) })); g.add(led);
  g.traverse(c => { if (c.isMesh) c.castShadow = true; }); g.userData.head = V3(0, .62, .34);
  return g;
}
// ---------- the dog ----------
// A Malinois in a dark vest: capsule body, wedge head, ears, tail and four legs on hip pivots that swing as it trots.
export function makeDog() {
  const g = new THREE.Group(); const fur = new THREE.MeshStandardMaterial({ color: '#5a3f26', roughness: .95 }), dark = new THREE.MeshStandardMaterial({ color: '#1d1a16', roughness: .9 });
  const body = [new THREE.CapsuleGeometry(.13, .42, 4, 8).rotateX(Math.PI / 2).scale(1, 1.05, 1).translate(0, .52, 0), new THREE.BoxGeometry(.13, .14, .24).translate(0, .7, .36), new THREE.BoxGeometry(.08, .08, .14).translate(0, .66, .53), new THREE.ConeGeometry(.04, .12, 4).translate(-.05, .82, .32), new THREE.ConeGeometry(.04, .12, 4).translate(.05, .82, .32), new THREE.CylinderGeometry(.02, .035, .36, 5).rotateX(-.9).translate(0, .62, -.42)];
  const neck = new THREE.CylinderGeometry(.07, .09, .22, 6).rotateX(.7).translate(0, .62, .26); body.push(neck);
  merge(body, fur, g); merge([new THREE.BoxGeometry(.28, .2, .34).translate(0, .56, .02), new THREE.BoxGeometry(.06, .02, .05).translate(0, .69, .6)], dark, g);
  const legs = []; for (const [x, z] of [[-.08, .22], [.08, .22], [-.08, -.2], [.08, -.2]]) { const p = new THREE.Group(); p.position.set(x, .5, z); const l = new THREE.Mesh(new THREE.CylinderGeometry(.028, .022, .48, 5).translate(0, -.24, 0), fur); p.add(l); g.add(p); legs.push(p); }
  g.userData.legs = legs; g.traverse(c => { if (c.isMesh) c.castShadow = true; });
  return g;
}

// ---------- the shaft and the tunnel ----------
function concreteTex(seed, seams) {
  const q = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8c857a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const v = 100 + q() * 70 | 0; g.fillStyle = `rgba(${v},${v - 6},${v - 14},${.15 + q() * .3})`; g.fillRect(q() * w, q() * h, 1 + q() * 5, 1 + q() * 5); }
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(60,52,44,${.08 + q() * .15})`; g.beginPath(); g.arc(q() * w, q() * h, 4 + q() * 26, 0, 7); g.fill(); }
    // seams between precast segments and a damp tide line
    if (seams) { g.fillStyle = 'rgba(30,26,22,.85)'; g.fillRect(0, 0, w, 3); g.fillStyle = 'rgba(30,26,22,.35)'; g.fillRect(0, 3, w, 3); g.fillStyle = 'rgba(70,64,55,.4)'; g.fillRect(0, h - 22, w, 22); }
    for (let i = 0; i < 8; i++) { g.strokeStyle = `rgba(40,34,28,${.3 + q() * .3})`; g.lineWidth = 1; g.beginPath(); let x = q() * w, y = q() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (q() - .5) * 30; y += q() * 20; g.lineTo(x, y); } g.stroke(); }
  });
}
export function buildShaftScene() {
  const S = new THREE.Scene(); S.background = new THREE.Color('#000000');
  const q = rng(5150);
  const tR = concreteTex(11, true), tT = concreteTex(12, true), tF = concreteTex(13, false);
  const lam = (o) => new THREE.MeshLambertMaterial(Object.assign({ side: THREE.DoubleSide }, o));
  const mRing = lam({ map: tR, color: '#b9b1a4' }), mTun = lam({ map: tT, color: '#aaa294' }), mFloor = lam({ map: tF, color: '#8a7a62' }), mSteel = lam({ color: '#5a4636' }), mCable = lam({ color: '#1b1a18' }), mBag = lam({ color: '#9d9278' }), mWood = lam({ color: '#6b5a44' }), mCharge = lam({ color: '#5d6140' }), mTape = lam({ color: '#b0a050' });
  const rings = [], tun = [], floor = [], steel = [], cable = [], bags = [], wood = [];
  // the shaft: 22 precast rings (the texture's seam once per metre), the ladder bolted to one side
  { const g = new THREE.CylinderGeometry(.55, .55, D - 2.3, 18, 1, true); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * (D - 2.3)); rings.push(g.translate(0, -(D - 2.3) / 2, 0)); }
  for (const s of [-.2, .2]) steel.push(new THREE.BoxGeometry(.035, D - 1.5, .035).translate(-.46, -(D - 1.5) / 2, s));
  for (let y = -.3; y > -D + 2.4; y -= .3) steel.push(new THREE.BoxGeometry(.03, .025, .42).translate(-.46, y, 0));
  // the power and phone cables down the wall, clipped every couple of metres, sagging between
  { const pts = []; let prev = V3(.38, 0, .38); for (let y = -.5; y > -D + 2.3; y -= .7) { const p = V3(.37 + Math.sin(y * 3.1) * .03, y, .38 + Math.cos(y * 2.3) * .03); pts.push(prev, p); prev = p; } cable.push(cableGeometry(pts, .02)); const p2 = []; prev = V3(.42, 0, .3); for (let y = -.5; y > -D + 2.3; y -= .9) { const p = V3(.42 + Math.sin(y) * .04, y, .3); p2.push(prev, p); prev = p; } cable.push(cableGeometry(p2, .012)); }
  // the chamber at the bottom (2.6 m square, 2.3 m high) with the two tunnel mouths, west and north
  const y0 = -D, yc = -D + 2.3, half = 1.3, tw = .45, wallH = 1.45;
  floor.push(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2).translate(0, y0, 0));
  for (const [w, d, x, z] of [[2.6, .75, 0, -.925], [2.6, .75, 0, .925], [.75, 1.1, -.925, 0], [.75, 1.1, .925, 0]]) tun.push(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(x, yc, z));
  const wall = (w, h, x, y, z, ry) => tun.push(new THREE.PlaneGeometry(w, h).rotateY(ry).translate(x, y, z));
  wall(2.6, 2.3, half, y0 + 1.15, 0, -Math.PI / 2); wall(2.6, 2.3, 0, y0 + 1.15, half, Math.PI);
  for (const [axis, ry] of [['x', Math.PI / 2], ['z', 0]]) { const side = (half - tw) / 2 + tw; for (const s of [-1, 1]) axis === 'x' ? wall(half - tw, 2.3, -half, y0 + 1.15, s * side, ry) : wall(half - tw, 2.3, s * side, y0 + 1.15, -half, ry); axis === 'x' ? wall(2 * tw, 2.3 - wallH - tw, -half, yc - (2.3 - wallH - tw) / 2, 0, ry) : wall(2 * tw, 2.3 - wallH - tw, 0, yc - (2.3 - wallH - tw) / 2, -half, ry); }
  // tunnels: walls of precast segments, an arched roof, a packed floor with the spoil cart's rails in the west branch
  const tunnel = (dir, L) => {
    const along = (a) => dir === 'x' ? V3(-half - a, 0, 0) : V3(0, 0, -half - a);
    const seg = (g, a) => { const c = along(a); return g.translate(c.x, 0, c.z); };
    const uvs = (g, u, v) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v); return g; };
    if (dir === 'x') { floor.push(seg(uvs(new THREE.PlaneGeometry(L, 2 * tw), L / 2, 1).rotateX(-Math.PI / 2).translate(-L / 2, y0, 0), 0)); for (const s of [-1, 1]) tun.push(seg(uvs(new THREE.PlaneGeometry(L, wallH), L, 1).translate(-L / 2, y0 + wallH / 2, s * tw), 0)); tun.push(seg(uvs(new THREE.CylinderGeometry(tw, tw, L, 10, 1, true, 0, Math.PI), 2, L).rotateZ(Math.PI / 2).translate(-L / 2, y0 + wallH, 0), 0)); }
    else { floor.push(seg(uvs(new THREE.PlaneGeometry(2 * tw, L), 1, L / 2).rotateX(-Math.PI / 2).translate(0, y0, -L / 2), 0)); for (const s of [-1, 1]) tun.push(seg(uvs(new THREE.PlaneGeometry(L, wallH), L, 1).rotateY(Math.PI / 2).translate(s * tw, y0 + wallH / 2, -L / 2), 0)); tun.push(seg(uvs(new THREE.CylinderGeometry(tw, tw, L, 10, 1, true, Math.PI / 2, Math.PI), 2, L).rotateX(Math.PI / 2).translate(0, y0 + wallH, -L / 2), 0)); }
    // cables hooked along the wall, dead bulbs every four metres
    const pts = []; let prev = null; for (let a = 0; a < L; a += .8) { const c = along(a); const p = V3(c.x + (dir === 'x' ? 0 : tw - .04), y0 + 1.5 - (Math.abs(Math.sin(a * 3.9)) * .08), c.z + (dir === 'x' ? -tw + .04 : 0)); if (prev) pts.push(prev, p); prev = p; } cable.push(cableGeometry(pts, .015));
    for (let a = 1; a < L; a += 4) { const c = along(a); steel.push(new THREE.SphereGeometry(.035, 6, 4).translate(c.x, y0 + 1.8, c.z)); }
  };
  tunnel('x', 34); tunnel('z', 30);
  for (const s of [-.28, .28]) steel.push(new THREE.BoxGeometry(30, .03, .04).translate(-half - 15, y0 + .02, s));
  wood.push(new THREE.BoxGeometry(1.1, .5, .62).translate(-half - 9, y0 + .38, 0)); for (const x of [-.4, .4]) steel.push(new THREE.CylinderGeometry(.08, .08, .66, 8).rotateX(Math.PI / 2).translate(-half - 9 + x, y0 + .1, 0));
  // sandbags and spoil sacks in the chamber, a plank across them
  for (let i = 0; i < 8; i++) bags.push(new THREE.BoxGeometry(.55, .25, .36).rotateY(q() * .5).translate(.55 + (i % 2) * .5, y0 + .13 + Math.floor(i / 4) * .25, .5 - (i % 4) * .3));
  wood.push(new THREE.BoxGeometry(1.4, .04, .22).rotateY(.4).translate(.6, y0 + .55, .2));
  merge(rings, mRing, S); merge(tun, mTun, S); merge(floor, mFloor, S); merge(steel, mSteel, S); merge(cable, mCable, S); merge(bags, mBag, S); merge(wood, mWood, S);
  // the booby trap on the ladder at 6 m: a charge taped to the rail and a tripwire across the shaft
  const trap = new THREE.Group(); merge([new THREE.BoxGeometry(.16, .26, .12).translate(-.4, -6.1, .2), new THREE.CylinderGeometry(.05, .05, .2, 8).translate(-.4, -6.32, .2)], mCharge, trap); merge([new THREE.BoxGeometry(.17, .04, .13).translate(-.4, -6.0, .2), new THREE.BoxGeometry(.17, .04, .13).translate(-.4, -6.16, .2)], mTape, trap); S.add(trap);
  const wire = new THREE.Mesh(rod(V3(-.4, -5.96, .2), V3(.52, -5.9, -.18), .008, 4), new THREE.MeshBasicMaterial({ color: '#f0ead0' })); S.add(wire);
  // light: the robot's lamp, a little daylight from the mouth and almost nothing else
  S.add(new THREE.AmbientLight('#8090a0', .05));
  const day = new THREE.PointLight('#c8d4e0', 3, 12, 1.4); day.position.set(0, .3, 0); S.add(day);
  // one work bulb still burning a few metres into the north branch: it shows where the branch goes
  const bulb = new THREE.PointLight('#ffd49a', 2.2, 9, 1.6); bulb.position.set(0, y0 + 1.7, -half - 6); S.add(bulb);
  S.add(new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6).translate(0, y0 + 1.78, -half - 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.8) })));
  const cam = new THREE.PerspectiveCamera(74, 4 / 3, .03, 80); S.add(cam);
  const lamp = new THREE.SpotLight('#fff4e0', 7, 22, .62, .55, 1.6); lamp.position.set(0, 0, 0); cam.add(lamp); lamp.target.position.set(0, 0, -1); cam.add(lamp.target);
  return { scene: S, cam, wire, trap, D, half, y0 };
}

// ---------- the feeds ----------
// mode 'robot': the robot's camera (the main scene while it is above ground, the shaft scene below)
// mode 'body': the helmet camera of one soldier of the force (the main scene from his eye)
export class Feeds {
  constructor() {
    this.under = buildShaftScene(); this.bodyCam = new THREE.PerspectiveCamera(84, 16 / 9, .08, 3000); this.robotCam = new THREE.PerspectiveCamera(70, 16 / 9, .05, 2000);
    this.idx = 0; this.t = 0; this.robot = null; this.labels = []; this.hidden = null;
    G.scene.add(this.bodyCam, this.robotCam);
  }
  // the robot's script, seconds since it was sent (see mission.sendRobot): drive in, look into the hole, winch down,
  // stop above the tripwire, cut it, go on to the bottom, look along both branches
  robotPose(t) {
    const R = this.robot; const S = this.under; const out = { under: false, pos: V3(), look: V3(), label: null, depth: 0 };
    const P = [V3(-118, 0, 12.4), V3(-118, 0, 16.4), V3(SHAFT.x + .25, 0, SHAFT.z - 1.15)];
    if (t < 6) { const k = t / 6, L1 = P[0].distanceTo(P[1]), L2 = P[1].distanceTo(P[2]), s = k * (L1 + L2); const p = s < L1 ? P[0].clone().lerp(P[1], s / L1) : P[1].clone().lerp(P[2], (s - L1) / L2); const nx = s < L1 ? P[1] : P[2];
      R.position.set(p.x, .1, p.z); R.rotation.y = Math.atan2(nx.x - p.x, nx.z - p.z); out.pos.copy(R.position).add(_v.set(0, .62, 0)); out.look.set(nx.x, .45, nx.z).sub(p).setY(0).normalize().multiplyScalar(3).add(out.pos).setY(.35); R.visible = true; return out; }
    if (t < 8.5) { const k = (t - 6) / 2.5; R.position.set(lerp(P[2].x, SHAFT.x, k * .55), .1, lerp(P[2].z, SHAFT.z, k * .55)); R.visible = true; out.pos.copy(R.position).add(_v.set(0, .62, 0)); out.look.set(SHAFT.x, -2 * k, SHAFT.z); out.label = k > .5 ? 'פי הפיר · עומק משוער 22 מ׳' : null; return out; }
    // winched down the middle of the shaft (the main-scene model follows it into the liner for the first metres)
    let y;
    if (t < 14) y = -(t - 8.5) * 1.0; else if (t < 17) y = -5.5; else if (t < 27) y = -5.5 - (t - 17) * 1.55; else y = -D + .45;
    R.position.set(SHAFT.x, Math.max(-3, y), SHAFT.z); R.visible = y > -2.5; out.under = true; out.depth = -y;
    if (t < 27) { out.pos.set(.05, y + .25, .05); const a = t * .5;
      if (t > 12.5 && t < 17.2) { out.look.set(-.3, -6.02, .08); out.label = t < 15.5 ? 'חוט מעידה · מטען על הסולם' : 'החוט נחתך · המטען סומן'; out.warn = t < 15.5; }
      else out.look.set(Math.cos(a) * .5, y - 1.3, Math.sin(a) * .5); return out; }
    // at the bottom: drive into the chamber, look down the west branch, then turn to the north one
    const k = clamp((t - 27) / 3, 0, 1), turn0 = clamp((t - 30.5) / 2, 0, 1); out.pos.set(-.6 * k * (1 - turn0), -D + .45, .1 * (1 - turn0)); const turn = clamp((t - 30.5) / 2, 0, 1); const ang = lerp(Math.PI, Math.PI * 1.5, turn);
    out.look.set(out.pos.x + Math.cos(ang) * 4, -D + .55, out.pos.z + Math.sin(ang) * 4); out.label = t < 30 ? 'מנהרה מערבה · קטעי בטון טרומי, כבלים' : 'פיצול: ענף צפוני'; return out;
  }
  update(dt) {
    const M = G.mission; const r = M && M.robot;
    if (r && r.on) { if (!r.hold) r.t += dt; const pose = this.robotPose(r.t); this.pose = pose; if (pose.under) { this.under.cam.position.copy(pose.pos); this.under.cam.lookAt(pose.look); } else { this.robotCam.position.copy(pose.pos); this.robotCam.lookAt(pose.look); }
      if (r.t > 15.5 && this.under.wire.visible) this.under.wire.visible = false; }
    // the dog trots: legs swing with its speed
    if (M && M.dog) { const d = M.dog; const sp = d.speed || 0; d.ph = (d.ph || 0) + dt * sp * 9; d.obj.userData.legs.forEach((l, i) => { l.rotation.x = Math.sin(d.ph + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * .55 * clamp(sp, 0, 1); }); }
    // helmet camera of the chosen soldier: at his eye, looking where he looks, with the bob of his walk
    const a = this.soldier();
    if (a) { const ry = a.root.rotation.y; const moving = !!a.path; this.bt = (this.bt || 0) + dt * (moving ? 9 : 1.4);
      a.eye(_v); const fwd = _w.set(Math.sin(ry), 0, Math.cos(ry)); _v.addScaledVector(fwd, .16); _v.y += .04 + (moving ? Math.abs(Math.sin(this.bt)) * .035 : 0);
      this.bodyCam.position.copy(_v);
      if (a.lookAt) { this.bodyCam.lookAt(a.lookAt.x, (a.lookAt.y ?? 0) + .8, a.lookAt.z); } else this.bodyCam.lookAt(_v.x + fwd.x * 5, _v.y - .45, _v.z + fwd.z * 5);
      this.bodyCam.rotateZ(Math.sin(this.bt * .5) * (moving ? .03 : .006)); this.bodyCam.rotateX(Math.sin(this.bt * 1.1) * (moving ? .02 : .004)); this.bodyCam.rotateY(Math.sin(this.bt * .37) * (moving ? .025 : .008));
      this.bodyCam.updateMatrixWorld(); }
    this.robotCam.updateMatrixWorld();
  }
  team() { return G.mission && G.mission.team ? G.mission.team.filter(a => !a.removed) : []; }
  soldier() { const t = this.team(); if (!t.length) return null; this.idx = ((this.idx % t.length) + t.length) % t.length; return t[this.idx]; }
  // what to render: { scene, cam, mode } (mode 2 = robot night vision, 3 = helmet camera)
  view(kind) {
    if (kind === 'robot') { const r = G.mission.robot; if (r && r.on && this.pose && this.pose.under) return { scene: this.under.scene, cam: this.under.cam, mode: 2, under: true }; return { scene: G.scene, cam: this.robotCam, mode: 3 }; }
    return { scene: G.scene, cam: this.bodyCam, mode: 3, self: true };
  }
  // hide the soldier wearing the camera (his own head and rifle would fill the frame) for this frame only
  hideSelf(on) { if (on) { const a = this.soldier(); if (!a) return; this.hidden = [[a.root, a.root.visible], ...(a.rifle ? [[a.rifle, a.rifle.visible]] : [])]; for (const [o] of this.hidden) o.visible = false; } else if (this.hidden) { for (const [o, v] of this.hidden) o.visible = v; this.hidden = null; } }
  // the feed's burnt-in text (DOM over the canvas): call-sign, camera id, heading, clock; the robot's depth and labels
  hud(kind) {
    const now = fmtClock(G.missionClock);
    if (kind === 'body') { const a = this.soldier(); const t = this.team(); if (!a) return; const c = this.bodyCam; c.getWorldDirection(_v); const hdg = ((Math.atan2(_v.x, -_v.z) * 180 / Math.PI) + 360) % 360; const off = !a.root.visible && !a.inside; const sig = a.inside && !a.root.visible ? 'אות חלש · בתוך מבנה' : '';
      $('bhTL').innerHTML = `<span class="rec">● REC</span> BWC-0${this.idx + 1}<br><bdi dir="rtl">${a.name}</bdi>`; $('bhTR').innerHTML = `HDG ${hdg.toFixed(0).padStart(3, '0')}°<br>${now}`; $('bhBL').innerHTML = `${a.down ? 'פצוע · ' : ''}${sig || (a.path ? 'בתנועה' : 'נייח')}`;
      $('bodyNo').classList.toggle('on', off || (a.inside && !a.root.visible));
      const box = $('bodyPick'); if (box._n !== t.length || box._i !== this.idx) { box._n = t.length; box._i = this.idx; box.innerHTML = t.map((s, i) => `<button data-i="${i}" aria-pressed="${i === this.idx}">${(s.name || '').split(' · ')[0]}</button>`).join(''); }
      return; }
    const r = G.mission.robot; const p = this.pose;
    $('rhTL').innerHTML = `<span class="rec">● REC</span> "חולד" · CAM1 · ${p && p.under ? 'NV' : 'DAY'}<br>${now}`;
    $('rhTR').innerHTML = r && r.on ? `עומק ${(p && p.depth || 0).toFixed(1)} מ׳<br>${p && p.under ? 'כבל כננת · 30 מ׳' : 'זחלים · 0.4 מ׳/ש׳'}` : '';
    const lab = $('rLabel'); const txt = p && p.label || ''; if (lab.textContent !== txt) lab.textContent = txt; lab.classList.toggle('on', !!txt); lab.classList.toggle('warn', !!(p && p.warn));
    $('robotNo').classList.toggle('on', !(r && r.on));
  }
}
