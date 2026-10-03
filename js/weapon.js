// First-person M4: rigged arms (animated idle/fire/reload), attached rifle, ADS, recoil, spread, hitscan, tracers
import * as THREE from 'three';
import { G, clamp, lerp, damp, rr, R, bus, sstep } from './core.js';
import { A } from './assets.js';
import { Input } from './player.js';
import { makeRifle, angleDiff, twoBoneIK } from './actors.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GIU } from './gi.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

// The rifle's own textures are nearly flat (a mid grey marked metal, a darker grey marked non-metal, an empty normal
// map), and taken literally the "metal" is a mirror with 5 % reflectance: black from every angle that does not catch the
// sky. A service M4's finish is layered on in the shader instead, in the gun's object space so it stays put as it moves:
//  - the receiver and rail are hard-anodised aluminium: the dyed oxide is a dielectric, so it takes light like a dark
//    satin paint (diffuse, a soft sheen), with glossier patches where hands leave oil;
//  - the furniture (stock, grip, handguard) is glass-filled polymer: a shade lighter, matte and even;
//  - machined steel (bolt, pins, muzzle) is real metal;
//  - within 1-3 mm of a convex fold the anodising is rubbed through to grey aluminium in patches (the rail teeth, the
//    magwell lips and receiver edges go first), and concave folds and upward faces hold fine sand dust.
// Edges come from the mesh itself (edgeData), not from screen-space curvature, which fired on every facet of this dense
// model and read as sugar.
function gunWear(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aGunD; attribute vec3 aGunC; varying vec3 vGunP; varying vec3 vGunN; varying vec3 vGunD; varying vec3 vGunC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGunP = position; vGunN = normal; vGunD = aGunD; vGunC = aGunC;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vGunP; varying vec3 vGunN; varying vec3 vGunD; varying vec3 vGunC;
float gh(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float gn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(gh(i), gh(i + vec3(1,0,0)), f.x), mix(gh(i + vec3(0,1,0)), gh(i + vec3(1,1,0)), f.x), f.y), mix(mix(gh(i + vec3(0,0,1)), gh(i + vec3(1,0,1)), f.x), mix(gh(i + vec3(0,1,1)), gh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
{ float n1 = gn(vGunP * 14.) * .6 + gn(vGunP * 32.) * .4, n2 = gn(vGunP * 5. + 7.3), n3 = gn(vGunP * .7 + 3.1);
  vec3 gN = normalize(vGunN); float lum = dot(diffuseColor.rgb, vec3(.333));
  float poly = 1. - step(.5, metalnessFactor), bare = (1. - poly) * smoothstep(.075, .14, lum);
  vec3 alb = diffuseColor.rgb * mix(.7, .83, n1) * vec3(.99, 1., 1.03); float rgh = mix(.3, .5, n3) + (n2 - .5) * .08, met = .08;
  alb = mix(alb, diffuseColor.rgb * 1.12 * mix(.93, 1.05, n1), poly); rgh = mix(rgh, .7 + (n1 - .5) * .1, poly); met *= 1. - poly;
  alb = mix(alb, diffuseColor.rgb * 1.1, bare); rgh = mix(rgh, .34, bare); met = mix(met, 1., bare);
  vec3 ef = 1. - smoothstep(vec3(0.), vec3(.0009 + .0022 * n1), vGunD);
  vec3 cv = smoothstep(.15, .6, vGunC), cc = smoothstep(.15, .6, -vGunC);
  float wear = max(max(ef.x * cv.x, ef.y * cv.y), ef.z * cv.z) * smoothstep(.45, .8, n2 * .7 + n3 * .5);
  float ccv = max(max(ef.x * cc.x, ef.y * cc.y), ef.z * cc.z);
  alb = mix(alb, mix(vec3(.26, .26, .27), alb * 2., poly), wear * .85); rgh = mix(rgh, mix(.38, .62, poly), wear); met = mix(met, .85 * (1. - poly), wear);
  float dust = max(smoothstep(.45, .95, gN.y) * smoothstep(.45, .85, n1) * .55, ccv * .8) * smoothstep(.25, .65, n3);
  alb = mix(alb, vec3(.24, .21, .17), dust * .26); rgh = mix(rgh, .86, dust * .6);
  diffuseColor.rgb = alb; roughnessFactor = clamp(rgh, .3, .88); metalnessFactor = met; }`);
  };
  mat.customProgramCacheKey = () => 'gunWear2';
  return mat;
}

// Per-triangle edge data for the wear mask (the M4 is a triangle soup with hard edges). Every vertex carries its
// triangle's altitude toward the opposite edge, so the interpolated attribute is the distance in metres to each of the
// three edges; a second attribute says how sharply each edge folds and which way (+ convex, - concave), from the
// triangle on the other side of it. openConvex: edges with nothing across them count as convex (thin-walled parts such
// as the optic tube's rims).
// (a mirrored glTF node decomposes to a negative scale, which would put every pixel on an edge)
const absScale = (o, v) => { o.getWorldScale(v); return (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z)) / 3; };
function edgeData(geo, scale, openConvex) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(); const p = g.attributes.position, n = p.count, nt = n / 3 | 0;
  const P = [], K = []; for (let i = 0; i < n; i++) { P.push(new THREE.Vector3().fromBufferAttribute(p, i)); K.push(Math.round(P[i].x * 1e4) + ',' + Math.round(P[i].y * 1e4) + ',' + Math.round(P[i].z * 1e4)); }
  const fn = [], fc = [], E = new Map(), ek = (a, b) => a < b ? a + '|' + b : b + '|' + a, e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), d = new THREE.Vector3();
  for (let t = 0; t < nt; t++) { const a = P[t * 3], b = P[t * 3 + 1], c = P[t * 3 + 2];
    fn.push(e1.subVectors(b, a).cross(e2.subVectors(c, a)).clone()); fc.push(a.clone().add(b).add(c).divideScalar(3));
    for (let k = 0; k < 3; k++) { const s = ek(K[t * 3 + (k + 1) % 3], K[t * 3 + (k + 2) % 3]); let l = E.get(s); if (!l) E.set(s, l = []); l.push(t); } }
  const D = new Float32Array(n * 3), C = new Float32Array(n * 3);
  for (let t = 0; t < nt; t++) { const a2 = fn[t].length(); if (!(a2 > 0)) continue; const nn = fn[t].clone().divideScalar(a2);
    for (let k = 0; k < 3; k++) { const i = t * 3 + (k + 1) % 3, j = t * 3 + (k + 2) % 3, len = P[i].distanceTo(P[j]);
      D[(t * 3 + k) * 3 + k] = len > 0 ? a2 / len * scale : 0;
      let cv = openConvex ? 1 : 0; const o = (E.get(ek(K[i], K[j])) || []).find(u => u !== t && fn[u].lengthSq() > 0);
      if (o !== undefined) cv = Math.min(1 - nn.dot(d.copy(fn[o]).normalize()), 1) * (nn.dot(d.subVectors(fc[o], fc[t])) < 0 ? 1 : -1);
      for (let v = 0; v < 3; v++) C[(t * 3 + v) * 3 + k] = cv; } }
  g.setAttribute('aGunD', new THREE.BufferAttribute(D, 3)); g.setAttribute('aGunC', new THREE.BufferAttribute(C, 3)); return g;
}

// The sleeves and gloves fill a quarter of the screen all game, and at arm's length the stock model reads as smooth
// plastic. A fine twill of ripstop in the normal (from the texture coordinates, so it follows the cloth), slightly
// dusty high points and a matte finish give the fabric its tooth. A film of sand dust greys the olive, and loose fibres
// catch light at grazing angles (the soft rim that tells cloth from painted plastic).
// The stock model has bare olive hands; IDF assaulters wear tactical gloves, so the hands become one in the shader:
// a dark synthetic back with a moulded knuckle guard, a tan synthetic-suede palm with a raised grip-dot print, stitched
// seams down the finger sides and a hook-and-loop wrist strap. Below the cuff the sleeve gathers into soft folds where
// the cloth bunches at the wrist. All of it is placed in the bind pose (aVm: metres from the wrist joint along the arm,
// plus the hand's skin weight; the bind position and normal for the rest: Z up, palms down), so it moves with the
// skin instead of swimming. kn: how far the knuckles sit past the wrist joint.
function armFabric(mat, kn = .085) {
  const K = kn.toFixed(4);
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aVm; varying vec4 vVm; varying vec3 vBn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVm = vec4(aVm.x, position.yz, aVm.y); vBn = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec4 vVm; varying vec3 vBn;
vec3 armBump(vec3 N, float h) { vec3 sp = -vViewPosition, sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, N), r2 = cross(N, sx); float det = dot(sx, r1);
  return normalize(abs(det) * N - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2)); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ float u = vVm.x; vec3 bn = normalize(vBn);
  glove = max(smoothstep(.3, .7, vVm.w), smoothstep(-.032, -.022, u));
  float palm = smoothstep(.15, -.35, bn.z), back = smoothstep(-.1, .45, bn.z);
  strap = smoothstep(-.032, -.028, u) * (1. - smoothstep(-.01, -.006, u)) * back;
  knuck = smoothstep(${K} - .032, ${K} - .02, u) * (1. - smoothstep(${K} + .008, ${K} + .02, u)) * back * (.75 + .25 * abs(sin(vVm.y * 160.)));
  float seam = (1. - smoothstep(.03, .1, abs(bn.z))) * smoothstep(${K} - .02, ${K}, u);
  vec2 gd = fract(vec2(u * 1.3, vVm.y) * 240.) - .5; dots = (1. - smoothstep(.16, .3, length(gd))) * palm * smoothstep(-.015, .0, u);
  palmK = palm;
  float fz = (1. - smoothstep(-.04, -.026, u)) * (.45 + .55 * smoothstep(-.2, -.05, u));
  float fold = sin(u * 150. + sin(vVm.y * 55. + vVm.z * 40.) * 2.4 + sin(u * 31.) * 1.6) * .6 + sin(u * 48. + vVm.y * 70. - vVm.z * 35.) * .4;
  float h = fold * .0048 * fz + dots * .0005 + knuck * .0028 + strap * (.0008 + .0003 * sin(u * 900.)) - seam * .0007 * glove;
  vec2 fu = vMapUv * vec2(260., 260.); float wx = sin(fu.x + sin(fu.y * .5) * .6), wy = sin(fu.y * 1.07 + fu.x * .15);
  float grid = step(.97, fract(vMapUv.x * 40.)) + step(.97, fract(vMapUv.y * 40.));
  vec3 bump = vec3(cos(fu.x) * .12 + grid * .15, cos(fu.y * 1.07) * .12 + grid * .15, 0.) * (1. - glove);
  normal = normalize(normal + (bump.x * normalize(dFdx(-vViewPosition)) + bump.y * normalize(dFdy(-vViewPosition))) * .35);
  normal = armBump(normal, h);
  fabricHi = wx * wy * (1. - glove) + fold * fz * .5;
  roughnessFactor = mix(clamp(roughnessFactor + .05, 0., 1.), mix(mix(.6, .86, palm), .42, knuck), glove); }`)
      .replace('#include <lights_physical_fragment>', `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.3, .27, .22), .07) * (1. + fabricHi * .05 + pow(1. - clamp(dot(normal, normalize(vViewPosition)), 0., 1.), 3.) * .25);
{ vec3 gc = mix(vec3(.02, .019, .018), vec3(.042, .035, .027), palmK); gc = mix(gc, vec3(.012, .012, .012), knuck); gc = mix(gc, vec3(.03, .028, .024), strap); gc *= 1. - dots * .25;
  diffuseColor.rgb = mix(diffuseColor.rgb, gc * (1. + pow(1. - clamp(dot(normal, normalize(vViewPosition)), 0., 1.), 2.) * .35), glove); }
#include <lights_physical_fragment>`)
      .replace('void main() {', 'float fabricHi = 0., glove = 0., strap = 0., knuck = 0., dots = 0., palmK = 0.;\nvoid main() {');
  };
  mat.customProgramCacheKey = () => 'armFabric3';
  return mat;
}

export class Weapon {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(54, 1, .01, 10);
    this.scene.add(this.cam);
    this.hemi = new THREE.HemisphereLight('#dfe8f5', '#6a5a48', 1.2); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3e0', 2.6); this.sun.position.set(.4, 1, .3); this.scene.add(this.sun);
    this.scene.environment = G.scene.environment;
    this.root = new THREE.Group(); this.cam.add(this.root);
    this.mag = 30; this.magSize = 30; this.reserve = 180; this.fireT = 0; this.rpm = 780; this.reloading = 0; this.ads = 0; this.spread = 0; this.shotsInBurst = 0;
    this.sway = new THREE.Vector2(); this.kick = 0; this.enabled = true; this.lower = 0;
    this.rr = new THREE.Vector3(); this.rv = new THREE.Vector3(); this.pr = new THREE.Vector3(); this.pv = new THREE.Vector3(); this.tilt = 0; this.airT = 0; this.heat = 0; this._hs = 0;
    this.buildArms(); G.Input = Input;
  }
  buildArms() {
    // Arms: the olive IDF soldier model, cut down to sleeves + gloves, posed with IK onto the rifle each frame
    const src = A.chars.team; if (!src) return;
    const body = SkeletonUtils.clone(src.scene); this.arms = body;
    const ARM = /UpperArm|Forearm|ForeTwist|Hand|Finger/;
    body.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const nm = (o.material.name || o.name || '').toLowerCase();
      if (!nm.includes('body')) { o.visible = false; return; }
      const g = o.geometry.clone(); const si = g.attributes.skinIndex, sw = g.attributes.skinWeight; const bones = o.skeleton.bones;
      const keepV = new Uint8Array(si.count);
      for (let i = 0; i < si.count; i++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } } keepV[i] = ARM.test(bones[best].name) ? 1 : 0; }
      const idx = g.index.array; const out = [];
      for (let t = 0; t < idx.length; t += 3) if (keepV[idx[t]] && keepV[idx[t + 1]] && keepV[idx[t + 2]]) out.push(idx[t], idx[t + 1], idx[t + 2]);
      g.setIndex(out); o.geometry = g; o.frustumCulled = false; o.castShadow = o.receiveShadow = false;
      // bind-pose landmarks for the glove (bone bind positions are the inverses of the bind matrices)
      const bx = re => { const i = bones.findIndex(bn => re.test(bn.name)); return i < 0 ? null : Math.abs(_v.setFromMatrixPosition(_m.copy(o.skeleton.boneInverses[i]).invert()).x); };
      const wx = bx(/R_Hand$/) ?? .5, kx = bx(/R_Finger2$/), pos = g.attributes.position, VM = new Float32Array(si.count * 2);
      for (let i = 0; i < si.count; i++) { let hw = 0; for (let k = 0; k < 4; k++) if (/Hand|Finger/.test(bones[si.getComponent(i, k)].name)) hw += sw.getComponent(i, k); VM[i * 2] = Math.abs(pos.getX(i)) - wx; VM[i * 2 + 1] = hw; }
      g.setAttribute('aVm', new THREE.BufferAttribute(VM, 2));
      o.material = armFabric(o.material.clone(), kx ? clamp(kx - wx, .05, .12) : .085); o.material.envMapIntensity = .7; o.material.roughness = .9;
    });
    this.b = {}; body.traverse(o => { if (o.isBone) this.b[o.name.replace('Bip01_', '')] = o; });
    this.holder = new THREE.Group(); this.holder.add(body); this.root.add(this.holder);
    body.rotation.y = Math.PI; body.updateMatrixWorld(true);
    // put the eyes at the camera: head bone slightly behind/under the view point
    const head = this.b.Head.getWorldPosition(new THREE.Vector3());
    body.position.set(-head.x + .02, -head.y - .02, -head.z - .17);
    this.rest = {}; for (const [k, bn] of Object.entries(this.b)) this.rest[k] = bn.quaternion.clone();
    // hand frames in T-pose: palms face down; finger axis = wrist -> middle finger base
    this.handFrame = {};
    for (const sd of ['R', 'L']) { const h = this.b[sd + '_Hand'], f = this.b[sd + '_Finger2']; const hq = h.getWorldQuaternion(new THREE.Quaternion()).invert();
      const fl = f.getWorldPosition(new THREE.Vector3()).sub(h.getWorldPosition(new THREE.Vector3())).applyQuaternion(hq).normalize();
      const pl = new THREE.Vector3(0, -1, 0).applyQuaternion(hq); pl.addScaledVector(fl, -pl.dot(fl)).normalize(); this.handFrame[sd] = { fl, pl }; }
    // rifle
    this.rifle = makeRifle('m4');
    this.rifle.updateMatrixWorld(true); const ws = new THREE.Vector3();
    this.rifle.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.geometry = edgeData(o.geometry, absScale(o, ws), false); o.material = gunWear(o.material.clone()); o.material.envMapIntensity = 1.1; if (o.name === 'Sight') o.visible = false; } });
    this.root.add(this.rifle);
    this.magNode = null; this.rifle.traverse(o => { if (o.name === 'Magazine') this.magNode = o; });
    if (this.magNode) { this.magRest = this.magNode.position.clone(); this.magRestQ = this.magNode.quaternion.clone(); }
    this.addOptic(); this.addFlash();
    this.muzzleLocal = this.rifle.userData.muzzle.clone();
    // rifle pose in camera space
    this.hipPos = G.isTouch ? new THREE.Vector3(.14, -.165, -.39) : new THREE.Vector3(.125, -.15, -.33); this.hipRot = new THREE.Euler(.03, .06, -.06, 'YXZ');
    this.adsPos = new THREE.Vector3(); this.adsRot = new THREE.Euler(0, 0, 0, 'YXZ');
    this.computeAds();
    const dot = new THREE.Mesh(new THREE.CircleGeometry(.00075, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, .25, .15), depthTest: false, transparent: true, opacity: 0, toneMapped: false }));
    dot.renderOrder = 10; this.dot = dot; this.cam.add(dot); dot.position.set(0, 0, -.2);
    this.rt = { pos: new THREE.Vector3(), rot: new THREE.Euler(0, 0, 0, 'YXZ') };
    this.reloadT = -1; this.magDrop = null;
  }
  addOptic() {
    // Meprolight-style red dot on the top rail (IDF M4 standard), plus a vertical grip
    const r = this.rifle; const ud = r.userData;
    // anodised housing and a polymer grip, through the same finish as the rifle (metalness marks the class there)
    const black = gunWear(new THREE.MeshStandardMaterial({ color: '#434548', roughness: .5, metalness: 1 })), poly = gunWear(new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: .7, metalness: 0 }));
    const o = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(.034, .014, .06), black); base.position.y = .007; o.add(base);
    // see-through tube sight: open outer tube + dark inner wall, mount block underneath
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .07, 24, 1, true), black); tube.rotation.x = Math.PI / 2; tube.position.set(0, .038, -.004); o.add(tube);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(.0195, .0195, .07, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: .9, side: THREE.BackSide })); inner.rotation.x = Math.PI / 2; inner.position.copy(tube.position); o.add(inner);
    for (const z of [-.039, .031]) { const rim = new THREE.Mesh(new THREE.RingGeometry(.0195, .0235, 24), black); rim.position.set(0, .038, z); o.add(rim); const rb = rim.clone(); rb.rotation.y = Math.PI; o.add(rb); }
    const mount = new THREE.Mesh(new THREE.BoxGeometry(.03, .018, .05), black); mount.position.y = .016; o.add(mount);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .012, 12), black); knob.rotation.z = Math.PI / 2; knob.position.set(.026, .038, .005); o.add(knob);
    // Glass: a red-dot's objective carries a dichroic coat that reflects the red LED back at the eye, so from behind it
    // reads faintly blue-green with a warm amber sheen toward its rim; a real lens also reflects more at grazing angles
    // (Fresnel) and gives back a soft window of the sky. Mostly clear at ADS, so the target is never hidden.
    const lm = new THREE.MeshStandardMaterial({ color: '#7fa0a4', metalness: 0, roughness: .03, transparent: true, opacity: .1, envMapIntensity: 2.2, depthWrite: false });
    lm.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{ float fr = pow(1. - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0., 1.), 3.); float rim = smoothstep(.55, 1., length(vLensP) / .019);
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.2, 1.02, .75), rim * .4) + vec3(.9, .55, .25) * rim * .02 + vec3(.6, .75, .8) * smoothstep(.01, .0, abs(vLensP.x + vLensP.y * .6 - .006)) * .05;
  diffuseColor.a = clamp(diffuseColor.a + fr * .45 + rim * .08, 0., .6); }
#include <opaque_fragment>`).replace('#include <common>', '#include <common>\nvarying vec2 vLensP;'); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLensP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLensP = position.xy;'); };
    lm.customProgramCacheKey = () => 'lensCoat';
    const lens = new THREE.Mesh(new THREE.CircleGeometry(.019, 24), lm);
    lens.position.set(0, .038, -.03); o.add(lens);
    const top = ud.topY ?? .12; o.scale.setScalar(.85); o.position.set(0, top, ud.opticZ ?? .01); r.add(o); this.optic = o;
    this.sightLocal = new THREE.Vector3(0, top + .038 * .85, (ud.opticZ ?? .01));
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(.014, .016, .075, 10), poly); grip.position.set(0, .012, ud.fore.z + .07); r.add(grip); this.vgrip = grip;
    r.updateMatrixWorld(true); const ws = new THREE.Vector3(); for (const m of [...o.children, grip]) if (m.isMesh && (m.material === black || m.material === poly)) m.geometry = edgeData(m.geometry, absScale(m, ws), true);
    ud.fore = new THREE.Vector3(0, .004, ud.fore.z + .07);
  }
  addFlash() {
    // first-person muzzle flash: crossed additive cards with a star texture + a light that hits arms and rifle
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 60); gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(.18, 'rgba(255,200,110,.9)'); gr.addColorStop(.45, 'rgba(255,120,30,.35)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + R() * .4; g.save(); g.translate(64, 64); g.rotate(a); const l = g.createLinearGradient(0, 0, 60, 0); l.addColorStop(0, 'rgba(255,230,170,.9)'); l.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = l; g.beginPath(); g.moveTo(0, -5); g.lineTo(58, 0); g.lineTo(0, 5); g.fill(); g.restore(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(2.2, 1.8, 1.4), side: THREE.DoubleSide });
    const f = new THREE.Group(); const front = new THREE.Mesh(new THREE.PlaneGeometry(.16, .16), m); f.add(front);
    const side1 = new THREE.Mesh(new THREE.PlaneGeometry(.26, .12), m); side1.rotation.y = Math.PI / 2; side1.position.z = -.1; f.add(side1);
    const side2 = side1.clone(); side2.rotation.z = Math.PI / 2; f.add(side2);
    // a tight white-hot core right at the crown, which the eye reads as the brightest point of a real flash
    const core = new THREE.Mesh(new THREE.PlaneGeometry(.06, .06), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(4, 3.6, 3) })); core.position.z = -.02; f.add(core);
    f.position.copy(this.rifle.userData.muzzle).add(new THREE.Vector3(0, 0, -.01)); f.visible = false; this.rifle.add(f); this.flash = f; this.flashT = 0;
    this.flashLight = new THREE.PointLight('#ffb060', 0, 2.5, 2); this.flashLight.position.copy(this.rifle.userData.muzzle); this.rifle.add(this.flashLight);
  }
  computeAds() {
    // place the rifle so the optic centre sits on the view axis
    this.adsRot.set(0, 0, 0); const q = new THREE.Quaternion().setFromEuler(this.adsRot);
    const s = this.sightLocal.clone().applyQuaternion(q); this.adsPos.set(-s.x, -s.y, -.2 - s.z);
  }
  // finger curl for gripping (Rocketbox biped fingers bend about local Z)
  curl(side, amt, thumb) {
    const b = this.b; const Z = new THREE.Vector3(0, 0, 1);
    for (let f = 1; f <= 4; f++) for (const seg of ['', '1', '2']) { const bn = b[`${side}_Finger${f}${seg}`]; if (!bn) continue; bn.quaternion.copy(this.rest[`${side}_Finger${f}${seg}`]).multiply(_q.setFromAxisAngle(Z, (side === 'R' ? 1 : 1) * amt * (seg === '' ? .9 : 1.1))); }
    for (const seg of ['', '1', '2']) { const bn = b[`${side}_Finger0${seg}`]; if (bn) bn.quaternion.copy(this.rest[`${side}_Finger0${seg}`]).multiply(_q.setFromAxisAngle(Z, thumb)); }
  }
  poseArms() {
    const b = this.b; if (!b.R_UpperArm) return;
    for (const k of ['R_Clavicle', 'L_Clavicle', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_UpperArm', 'L_Forearm', 'L_Hand']) if (b[k]) b[k].quaternion.copy(this.rest[k]);
    this.arms.updateMatrixWorld(true); this.rifle.updateMatrixWorld(true);
    const ud = this.rifle.userData; const r = this.rifle; const W = this.hw || (this.hw = {});
    const gripW = r.localToWorld(_v.copy(this.wristR || (this.wristR = new THREE.Vector3(.028, -.03, .085))));
    let foreW = r.localToWorld(_v2.copy(this.wristL || (this.wristL = new THREE.Vector3(-.034, -.028, ud.fore.z + .075))));
    if (this.leftTarget) foreW = this.leftTarget;
    const cw = this.cam.matrixWorld; const toW = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(cw);
    twoBoneIK(b.R_UpperArm, b.R_Forearm, b.R_Hand, gripW, toW(.55, -.55, .15));
    twoBoneIK(b.L_UpperArm, b.L_Forearm, b.L_Hand, foreW, toW(-.6, -.6, .05));
    const rq = r.getWorldQuaternion(new THREE.Quaternion());
    const orient = (sd, dirLocal, palmLocal, useRifle = true) => {
      const h = b[sd + '_Hand']; const F = this.handFrame[sd];
      const d = dirLocal.clone().normalize(); const pn = palmLocal.clone(); if (useRifle) { d.applyQuaternion(rq); pn.applyQuaternion(rq); }
      pn.addScaledVector(d, -pn.dot(d)).normalize();
      const Lm = new THREE.Matrix4().makeBasis(F.fl, F.pl, F.fl.clone().cross(F.pl)); const Wm = new THREE.Matrix4().makeBasis(d, pn, d.clone().cross(pn));
      const q = new THREE.Quaternion().setFromRotationMatrix(Wm.multiply(Lm.transpose()));
      const pw = h.parent.getWorldQuaternion(new THREE.Quaternion()); h.quaternion.copy(pw.invert().multiply(q)); h.updateMatrixWorld(true);
    };
    orient('R', this.dirR || (this.dirR = new THREE.Vector3(-.2, -.45, -.87)), this.palmR || (this.palmR = new THREE.Vector3(-1, -.3, 0)));
    if (!this.leftTarget) orient('L', this.dirL || (this.dirL = new THREE.Vector3(.25, -.4, -.88)), this.palmL || (this.palmL = new THREE.Vector3(1, -.2, 0)));
    else orient('L', new THREE.Vector3(.2, .3, -.9), new THREE.Vector3(.6, 1, 0));
    this.curl('R', this.curlR ?? .9, .5); this.curl('L', this.curlL ?? .8, .4);
    this.arms.updateMatrixWorld(true);
  }
  resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }
  canFire() { return this.enabled && this.reloading <= 0 && !G.player.sprinting && G.player.alive && this.lower < .3; }
  toggleMode() { this.semi = !this.semi; G.audio.playS('dry', { vol: .4, rate: 1.4 }); const wn = document.querySelector('.wname'); if (wn) wn.textContent = 'M4A1 · ' + (this.semi ? 'בודד' : 'אוטומטי'); G.ui.toast(this.semi ? 'ירי בודד' : 'ירי אוטומטי'); }
  reload() {
    if (this.reloading > 0 || this.mag === this.magSize || this.reserve <= 0) return;
    this.reloading = this.mag === 0 ? 2.45 : 2.1; this.reloadDur = this.reloading; this.reloadEmpty = this.mag === 0; this.reloadT = 0; this._rs = 0;
    bus.emit('reload');
  }
  fire() {
    if (this.mag <= 0) { if (!this._dry) { this._dry = true; G.audio.mech(); } this.reload(); return; }
    this.mag--; this.fireT = 60 / this.rpm; this.shotsInBurst++; G.stats.shots++; if (G.isTouch && navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
    const cam = G.camera; const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const moving = Math.hypot(G.player.vel.x, G.player.vel.z);
    const spread = (this.ads > .6 ? .0012 : .012) + this.spread + moving * .004 + (G.player.onGround ? 0 : .03);
    dir.add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(spread)).normalize();
    this.spread = Math.min(.05, this.spread + (this.ads > .6 ? .002 : .005));
    const origin = cam.position.clone();
    const res = G.shootRay(origin, dir, 400, G.player);
    const muzzleW = this.muzzleWorld();
    G.fx.muzzle(muzzleW, dir, 1);
    if (this.shotsInBurst % 3 === 1) G.fx.tracer(muzzleW, res.point, false);
    if (res.hitWorld) G.fx.impact(res.point, res.normal, res.surface);
    if (res.actor) {
      const a = res.actor; const dmg = res.part === 'head' ? 110 : res.part === 'legs' ? 28 : 38;
      if (a.innocent || a.friendly) { bus.emit('friendlyFire', a); if (a.innocent) { G.fx.impact(res.point, res.normal, 'flesh'); a.damage(dmg, origin, res.part); } }
      else { G.fx.impact(res.point, res.normal, 'flesh'); G.audio.impact(res.point, 'flesh'); const wasAlive = a.alive; a.damage(dmg, origin, res.part); G.stats.hits++; bus.emit('hitmarker', !a.alive && wasAlive, res.part === 'head'); if (!a.alive && wasAlive) G.stats.kills++; }
    } else if (res.hitWorld) G.audio.impact(res.point, res.surface === 'sand' ? 'sand' : 'concrete');
    G.audio.shotPlayer(G.inside);
    G.panic = Math.max(G.panic || 0, 1); G.panicAt = G.player.pos.clone();
    // alert hostiles within earshot
    for (const a of G.actors) if (a.hostile && a.pos.distanceTo(G.player.pos) < (G.inside ? 25 : 60)) a.alertT = 99;
    // recoil
    const k = (this.ads > .6 ? .6 : 1) * (G.player.crouching ? .75 : 1); const n = Math.min(this.shotsInBurst, 12); this.drift = (this.drift || 0) * .85 + rr(-.18, .22);
    G.player.recoilVel.x += (.5 + n * .035 + rr(0, .15)) * k; G.player.recoilVel.y += (this.drift * .9 + rr(-.08, .08)) * k;
    G.player.pitch += .004 * k; G.player.yaw += rr(-.002, .002) * k;
    // view-model kick through a spring (pitch up, a random yaw and roll, a shove back into the shoulder), so each
    // shot snaps and settles with a slight overshoot instead of sliding back linearly; aimed fire kicks a third as much
    const vk = (this.ads > .6 ? .35 : 1) * (G.player.crouching ? .8 : 1);
    this.rv.x += rr(.8, 1.05) * vk; this.rv.y += rr(-.3, .3) * vk; this.rv.z += rr(-.7, .7) * vk; this.pv.z += rr(.42, .55) * vk; this.pv.y += .08 * vk;
    this.kick = 1; this.kickRoll = rr(-1, 1); this.flashT = .045; this.flash.rotation.z = R() * 6.28; this.flash.scale.setScalar(rr(.75, 1.2) * (this.ads > .6 ? .8 : 1));
    // no two flashes alike: the side jets and the front star change length and strength from shot to shot
    const fc = this.flash.children; fc[0].scale.setScalar(rr(.7, 1.15)); fc[1].scale.set(rr(.55, 1.3), rr(.8, 1.1), 1); fc[2].scale.set(rr(.55, 1.3), rr(.8, 1.1), 1); fc[3].visible = R() < .6; fc[3].scale.setScalar(rr(.8, 1.3));
    this.flashI = rr(.75, 1.25); this.heat = Math.min(1, (this.heat || 0) + .035);
    // casing
    const ej = this.rifle.localToWorld(new THREE.Vector3(.02, .075, .06)); const ejW = this.vmToWorld(ej);
    G.fx.casing(ejW, new THREE.Vector3(1, 0, 0).applyQuaternion(G.camera.quaternion).multiplyScalar(rr(1.5, 2.5)).add(new THREE.Vector3(0, rr(1.5, 2.5), 0)));
    if (this.mag === 0) this._dry = false;
  }
  vmToWorld(p) { const inCam = this.cam.worldToLocal(p.clone()); inCam.multiplyScalar(1); return G.camera.localToWorld(inCam); }
  muzzleWorld() { return this.vmToWorld(this.rifle.localToWorld(this.muzzleLocal.clone())); }
  enemyUnderCrosshair() {
    const cam = G.camera; const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const res = G.shootRay(cam.position.clone(), f, 80, G.player);
    if (res && res.actor && res.actor.alive && res.actor.hostile) return res.actor;
    // small cone tolerance: a hostile's chest within ~1.6 degrees also counts
    for (const a of G.actors) { if (!a.alive || !a.hostile) continue; const c = a.chest(new THREE.Vector3()); const d = c.clone().sub(cam.position); const L = d.length(); if (L > 70) continue; if (d.normalize().dot(f) > .9996 && G.lineOfSight(cam.position, c)) return a; }
    return null;
  }
  aimAssist(dt) {
    let best = null, bd = .1; const cam = G.camera; const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const a of G.actors) { if (!a.alive || !a.hostile) continue; const c = a.chest(new THREE.Vector3()); const d = c.clone().sub(cam.position); const L = d.length(); if (L > 70) continue; d.normalize(); const ang = Math.acos(clamp(d.dot(f), -1, 1)); if (ang < bd && G.lineOfSight(cam.position, c)) { bd = ang; best = d; } }
    if (best) { const ty = Math.atan2(-best.x, -best.z), tp = Math.asin(best.y); G.player.yaw += angleDiff(ty, G.player.yaw) * Math.min(1, dt * 3.5); G.player.pitch += (tp - G.player.pitch) * Math.min(1, dt * 3.5); }
  }
  reloadPose(dt) {
    // procedural reload: tilt, drop mag, hand to vest, new mag in, slap bolt release (empty), back to grip
    const T = this.reloadDur - this.reloading; const D = this.reloadDur; const r = this.rifle; const ev = (t, f) => { if (this._rs < t && T >= t) f(); };
    const tilt = sstep(0, .35, T) * (1 - sstep(D - .35, D, T));
    const P = this.rt; P.rot.z += tilt * .3; P.rot.x += tilt * .1; P.pos.x -= tilt * .045; P.pos.y -= tilt * .025; P.pos.z += tilt * .03;
    const cw = this.cam.matrixWorld; const W = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(cw);
    const magW = () => r.localToWorld(new THREE.Vector3(-.01, -.07, -.075));
    const pouch = W(-.05, -.45, -.12);
    ev(.42, () => { G.audio.gunMech('mag_out'); this.dropMag(); });
    ev(1.25, () => { if (this.magNode) this.magNode.visible = true; });
    ev(1.45, () => G.audio.gunMech('mag_in'));
    if (this.reloadEmpty) ev(1.85, () => G.audio.gunMech('bolt'));
    let lt = null; this.curlL = .8;
    if (T > .25 && T < .45) lt = r.localToWorld(new THREE.Vector3(0, -.03, -.06)).lerp(magW(), sstep(.25, .45, T));
    else if (T >= .45 && T < 1.0) { lt = magW().lerp(pouch, sstep(.45, .85, T)); this.curlL = .5; }
    else if (T >= 1.0 && T < 1.45) { lt = pouch.clone().lerp(magW().add(W(0, 0, 0).sub(W(0, .05, 0))), sstep(1.0, 1.35, T)); if (this.magNode && T >= 1.25) this.magNode.visible = true; }
    else if (T >= 1.45 && T < (this.reloadEmpty ? 2.0 : 1.7)) { const bolt = r.localToWorld(new THREE.Vector3(-.025, .035, .035)); lt = this.reloadEmpty ? magW().lerp(bolt, sstep(1.55, 1.8, T)) : magW(); this.curlL = this.reloadEmpty ? .3 : .8; }
    else if (T >= (this.reloadEmpty ? 2.0 : 1.7)) { const fore = r.localToWorld(new THREE.Vector3(-.004, -.012, r.userData.fore.z)); const from = this.reloadEmpty ? r.localToWorld(new THREE.Vector3(-.025, .035, .035)) : magW(); lt = from.lerp(fore, sstep(this.reloadEmpty ? 2.0 : 1.7, D - .1, T)); }
    if (this.magNode) { if (T > .42 && T < 1.25) this.magNode.visible = false; }
    this.leftTarget = lt; this._rs = T;
  }
  dropMag() {
    if (!this.magNode) return; this.magNode.visible = false;
    const m = this.magNode.clone(); m.visible = true; const wp = this.magNode.getWorldPosition(new THREE.Vector3()), wq = this.magNode.getWorldQuaternion(new THREE.Quaternion()), ws = this.magNode.getWorldScale(new THREE.Vector3());
    this.root.parent.worldToLocal(wp); m.position.copy(wp); m.quaternion.copy(wq); m.scale.copy(ws); this.cam.add(m); this.cam.worldToLocal(m.position.copy(this.magNode.getWorldPosition(new THREE.Vector3())));
    m.quaternion.premultiply(this.cam.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.magDrop = { m, v: new THREE.Vector3(-.1, -.5, .05), t: 0 };
  }
  update(dt) {
    if (!this.arms) return;
    const p = G.player; const I = Input;
    if (I.reloadReq) { I.reloadReq = false; this.reload(); }
    const wantAds = (I.ads || I.adsToggle) && this.reloading <= 0 && !p.sprinting && this.enabled;
    this.ads = damp(this.ads, wantAds ? 1 : 0, 13, dt); p.ads = this.ads;
    this.fireT -= dt; this.spread = Math.max(0, this.spread - dt * .06);
    // phones: optional auto-fire while the crosshair rests on an armed enemy (checked 10x per second)
    if (G.isTouch && G.settings.autoFire && G.state === 'play') { this._afT = (this._afT || 0) - dt; if (this._afT <= 0) { this._afT = .1; this.autoTarget = this.enemyUnderCrosshair(); } } else this.autoTarget = null;
    const trigger = I.fire || !!this.autoTarget;
    if (trigger && this.fireT <= 0 && this.canFire() && !(this.semi && this.shotsInBurst > 0 && !this.autoTarget)) this.fire(); if (this.semi && this.autoTarget) this.fireT = Math.max(this.fireT, .16); if (!trigger) this.shotsInBurst = 0;
    if (this.reloading > 0) { this.reloading -= dt; if (this.reloading <= 0) { const need = this.magSize - this.mag; const take = Math.min(need, this.reserve); this.mag += take; this.reserve -= take; this.leftTarget = null; if (this.magNode) this.magNode.visible = true; bus.emit('reloaded'); } }
    // sway from look, walk bob, sprint lowering, recoil kick
    this.sway.x = damp(this.sway.x, clamp(-I.mdx * .00045, -.025, .025), 9, dt); this.sway.y = damp(this.sway.y, clamp(I.mdy * .00045, -.025, .025), 9, dt);
    this.kick = Math.max(0, this.kick - dt * 14);
    // recoil spring (zeta ~0.6: one small overshoot), sub-stepped so the 20 fps test sim stays stable
    for (let n = Math.ceil(dt * 90), h = dt / Math.max(1, n), i = 0; i < n; i++) for (const [x, v, k, c] of [[this.rr, this.rv, 170, 15], [this.pr, this.pv, 150, 16]]) { v.x += (-k * x.x - c * v.x) * h; v.y += (-k * x.y - c * v.y) * h; v.z += (-k * x.z - c * v.z) * h; x.addScaledVector(v, h); }
    // strafing leans the gun into the turn; a landing drops it and lets the spring bring it back
    const lat = p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw); this.tilt = damp(this.tilt, clamp(lat * .012, -.05, .05), 6, dt);
    if (!p.onGround) this.airT += dt; else { if (this.airT > .15) { this.pv.y -= .35 * Math.min(1, this.airT); this.rv.x -= .35 * Math.min(1, this.airT); } this.airT = 0; }
    this.heat = Math.max(0, this.heat - dt * .22);
    const bob = p.bobAmt * (1 - this.ads * .88);
    const lowerT = (p.sprinting ? 1 : 0) + (this.enabled ? 0 : 1.4); this.lower = damp(this.lower, lowerT, 7, dt);
    const P = this.rt; const a = this.ads;
    P.pos.copy(this.hipPos).lerp(this.adsPos, a);
    P.rot.set(lerp(this.hipRot.x, this.adsRot.x, a), lerp(this.hipRot.y, this.adsRot.y, a), lerp(this.hipRot.z, this.adsRot.z, a));
    P.pos.x += Math.cos(p.bob) * .011 * bob + this.sway.x * (1 - a * .75) + this.lower * .02;
    P.pos.y += -Math.abs(Math.sin(p.bob)) * .012 * bob + this.sway.y * (1 - a * .75) - this.lower * .06 - (p.crouching ? .004 : 0);
    const br = Math.sin(G.time * 1.55) * (1 - a) * (1 - Math.min(1, p.bobAmt || 0));
    P.pos.x += this.pr.x - this.tilt * .12 * (1 - a); P.pos.y += this.pr.y + br * .0013; P.pos.z += this.pr.z;
    P.rot.x += this.rr.x - this.lower * .45 - p.suppression * .015 + this.sway.y * .6 + br * .003;
    P.rot.y += this.rr.y + this.lower * .65 + this.sway.x * .8; P.rot.z += this.rr.z * .5 - this.tilt * (1 - a * .7) + this.lower * .3 + Math.sin(p.bob) * .012 * bob;
    if (a > .5) { const tb = G.time; P.rot.x += Math.sin(tb * 1.3) * .0018 * a; P.rot.y += Math.sin(tb * .9 + 1) * .0022 * a; }
    this.rifle.position.copy(P.pos); this.rifle.rotation.copy(P.rot);
    if (this.reloading > 0) { this.reloadPose(dt); this.rifle.position.copy(P.pos); this.rifle.rotation.copy(P.rot); }
    this.rifle.updateMatrixWorld(true);
    this.poseArms();
    if (this.magDrop) { const d = this.magDrop; d.t += dt; d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotateX(dt * 2); if (d.t > .8) { this.cam.remove(d.m); this.magDrop = null; } }
    this.dot.material.opacity = clamp((this.ads - .85) * 7, 0, 1);
    this.flashT -= dt; this.flash.visible = this.flashT > 0; this.flashLight.intensity = this.flashT > 0 ? 6 * (this.flashI || 1) : 0;
    // a hot barrel smokes for a few seconds after a long burst (not while firing: the blast clears it)
    if (this.heat > .3 && this.fireT < -.2 && G.fx.barrelSmoke) { this._hs += dt * 14 * (this.heat - .3); if (this._hs >= 1) { this._hs -= 1; G.fx.barrelSmoke(this.muzzleWorld(), this.heat); } }
    if (this.optic) this.optic.visible = true;
    // lit by the world around the eye: the baked ambient visibility there, and the sun only while the eye can see it
    // lit like the world around the eye: ambient through the probes there (gi.js, userData.giView), and the sun only while the eye can see it
    this._giT = (this._giT || 0) - dt; if (this._giT <= 0) { this._giT = .12; const c = G.camera.position; this._sunV = G.lineOfSight ? (G.lineOfSight(c, _v.copy(c).addScaledVector(G.sunDir, 150)) ? 1 : 0) : 1; }
    GIU.uGIcam.value.copy(G.camera.position); GIU.uGIcamRot.value.setFromMatrix4(_m.makeRotationFromQuaternion(G.camera.quaternion)); // (matrixWorld is only refreshed at render)
    this.hemi.intensity = 1.35; this.hemi.position.set(0, 1, 0).applyQuaternion(_q.copy(G.camera.quaternion).invert()); this.scene.environmentIntensity = .85;
    this.sun.intensity = damp(this.sun.intensity, 2.6 * (this._sunV ?? 1), 5, dt);
    if (!this._giView) { this._giView = true; this.scene.traverse(o => { if (o.material) for (const mt of [].concat(o.material)) mt.userData.giView = true; }); }
    const sd = G.sunDir.clone().applyQuaternion(G.camera.quaternion.clone().invert()); this.sun.position.copy(sd);
    this.root.visible = this.enabled || this.lower < 1.2;
  }
}
