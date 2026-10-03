// "The Shaft" – the eastern edge of a Gaza neighbourhood at dawn: open fields and an olive grove on the east (+X), where
// the force stages, and the first rows of houses on the west (-X). North is -Z.
// Three candidate houses (A, B, C) stand apart on the edge; B hides the shaft. Everything the commander can learn from
// the UAV feed is real geometry here: the sand pile, the cable, the generator and the heat leaking from a window.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rng, clamp, sstep, fbm, V3 } from '../core.js';
import { MAT } from '../materials.js';
import { tex } from '../assets.js';
import { townBlocks, cableGeometry, makeBirds } from '../world.js';
import { makeAPC } from '../vehicles.js';

export const TL = {
  // the forward command vehicle on a low dirt rise 240 m east of house B; the staging area and the tank in the field
  cmd: { x: 132, z: -8 }, stage: { x: 74, z: 12 }, tank: { x: 98, z: 64 },
  B: { x: -118, z: 20, w: 12, d: 10, f: 3, door: [-118, 13.2] },
  A: { x: -92, z: -46, w: 11, d: 9, f: 2, door: [-92, -40.4] },
  C: { x: -78, z: 82, w: 18, d: 12, f: 1, door: [-78, 75] },
  N1: { x: -141, z: -3, w: 10, d: 9, f: 2, door: [-141, 2.4] },
  N2: { x: -100, z: 47, w: 10, d: 9, f: 2, door: [-100, 41.4] },
  W: { x: -168, z: -40, w: 11, d: 10, f: 3 },
  H: { x: -176, z: 82, w: 10, d: 9, f: 2, door: [-170, 82] },
  lot: { x: -226, z: 118 }, radius: 45, gather: { x: -205, z: 20 },
  // the tunnel's second exit: a collapsed shed 110 m north of B, 19 m from a family house (S)
  X2: { x: -140, z: -86 }, S: { x: -150, z: -105, w: 11, d: 9, f: 2, door: [-150, -100.2] },
};
// the shaft in B's kitchen (world x/z); the ground shader cuts the hole there and at the second exit
export const SHAFT = { x: TL.B.x - 3, z: TL.B.z + 1 };
// routes for the team (ground points; y comes from the terrain)
export const ROUTES = {
  cover: [[74, 12], [40, -34], [-20, -66], [-78, -66], [-122, -24], [-120, 8], [-118, 11]],
  fast: [[74, 12], [10, 9], [-70, 9], [-108, 9], [-118, 11]],
  toA: [[74, 12], [40, -34], [-20, -40], [-80, -36], [-92, -38]],
  toC: [[74, 12], [30, 50], [-40, 70], [-72, 72], [-78, 73]],
  out: [[-118, 11], [-108, 9], [-70, 9], [-40, 9]],
  x2: [[-118, 11], [-122, -24], [-132, -60], [-139, -82]],
  x2back: [[-139, -82], [-132, -60], [-110, -30], [-90, -4], [-70, 9], [-40, 9]],
  home: [[-40, 9], [10, 9], [62, 12]],
};

// ---------- height ----------
// the town sits on level ground (the house generator builds from y = 0); the fields east of it roll a little, and the
// command vehicle stands on a bulldozed rise so the commander sees over the grove
export function hT(x, z) {
  const f = sstep(-50, 10, x);
  let h = f * (fbm(x * .012 + 3.1, z * .012 + 7.7, 3) - .45) * 2.2;
  const dx = (x - TL.cmd.x) / 26, dz = (z - TL.cmd.z) / 40; h += 3.4 * (1 - sstep(.45, 1, Math.sqrt(dx * dx + dz * dz)));
  return h;
}

const buckets = new Map();
function add(mat, geo, collide = false) { if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(geo); if (collide) G.colliders.push(geo); }
function strip(g) { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; }
function flush(parent = G.scene, shadow = true) {
  const out = [];
  for (const [mat, list] of buckets) { const mesh = new THREE.Mesh(mergeGeometries(list.map(strip)), mat); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); out.push(mesh); }
  buckets.clear(); return out;
}
// world-scaled UVs (m metres per texture repeat)
function box(w, h, d, m = 2) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) { const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)); const a = nx > .5 ? d : w, b = ny > .5 ? d : h; uv.setXY(i, uv.getX(i) * a / m, uv.getY(i) * b / m); }
  return g;
}
const at = (g, x, y, z, ry = 0) => { if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };

// ---------- materials ----------
const TM = {};
function materials() {
  const std = o => new THREE.MeshStandardMaterial(o);
  TM.dirt = std({ map: tex('dirt2_c.jpg'), color: '#cdb594', roughness: 1 });
  TM.olive = std({ color: '#4a4f36', roughness: .85, metalness: .1 });
  TM.leaf = std({ color: '#55603f', roughness: .95, flatShading: true });
  TM.bark = std({ color: '#5a4d3e', roughness: 1 });
  TM.tank = std({ color: '#1c1c1b', roughness: .55 });
  TM.solar = std({ color: '#26303a', roughness: .3, metalness: .6 });
  TM.pole = std({ color: '#6d665c', roughness: .9 });
  TM.sandFresh = std({ map: tex('sand_c.jpg'), color: '#e8d2ae', roughness: 1 });
  TM.bag = std({ color: '#b9ad8f', roughness: 1 });
  TM.tyre = std({ color: '#1b1a19', roughness: .9 });
  // heat as the thermal camera sees it: plain bright surfaces drawn only into the IR feed
  TM.scrub = std({ color: '#5b5d43', roughness: .95, flatShading: true });
  TM.stone = std({ color: '#9c9386', roughness: .95, flatShading: true });
  TM.trash = std({ color: '#7f7a70', roughness: .8 });
  TM.winIn = new THREE.MeshBasicMaterial({ color: new THREE.Color(.36, .38, .41) });
  TM.gas = std({ color: '#5d6b58', roughness: .55, metalness: .4 });
  TM.tankBeige = std({ color: '#c9bfa6', roughness: .5 });
  TM.sheet = std({ color: '#6f6d66', roughness: .65, side: THREE.DoubleSide });
  TM.net = std({ color: '#545839', roughness: 1, side: THREE.DoubleSide });
  TM.wood = std({ color: '#7a6a55', roughness: .95 });
  TM.charge = std({ color: '#5a5e3c', roughness: .8 });
  TM.liner = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  TM.heat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5), transparent: true, opacity: .9, depthWrite: false, fog: false });
  TM.warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(.7, .7, .7), transparent: true, opacity: .75, depthWrite: false, fog: false });
}

// ---------- ground ----------
function groundMaterial() {
  const uni = { tSand: { value: tex('sand_c.jpg') }, tDirt: { value: tex('dirt2_c.jpg') }, tGrav: { value: tex('gravel_c.jpg') }, uHoles: { value: new THREE.Vector4(SHAFT.x, SHAFT.z, TL.X2.x, TL.X2.z) } };
  const m = new THREE.MeshStandardMaterial({ roughness: 1, color: '#ffffff' });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWp; uniform sampler2D tSand, tDirt, tGrav; uniform vec4 uHoles;
float gH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(gH(i), gH(i + vec2(1., 0.)), f.x), mix(gH(i + vec2(0., 1.)), gH(i + vec2(1., 1.)), f.x), f.y); }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }`)
      .replace('#include <map_fragment>', `
      vec2 p = vWp.xz;
      // the two shaft mouths: the ground is cut open so the concrete liner below shows
      if (length(p - uHoles.xy) < .5 || length(p - uHoles.zw) < .45) discard;
      vec3 sand = texture2D(tSand, p * .17).rgb * .55 + texture2D(tSand, p * .023).rgb * .45;
      vec3 dirt = texture2D(tDirt, p * .21).rgb * .55 + texture2D(tDirt, p * .031).rgb * .45;
      vec3 grav = texture2D(tGrav, p * .26).rgb;
      sand *= vec3(1.06, 1.0, .9); dirt *= vec3(.96, .9, .8);
      float n = gN(p * .03) * .6 + gN(p * .11) * .4;
      vec3 col = mix(dirt, sand, smoothstep(.35, .75, n));
      // ploughed field east of the town: furrows running north-south
      float field = smoothstep(-40., -20., p.x) * (1. - smoothstep(110., 130., p.x));
      float fur = .5 + .5 * sin(p.x * 6.2832 / 1.3 + gN(p * .02) * 3.);
      col = mix(col, dirt * mix(.82, 1.08, fur), field * .55);
      // packed earth streets of the town and the tracks of the force's vehicles from the staging area
      float road = 1. - smoothstep(3., 5.5, abs(p.x + 62.));
      road = max(road, (1. - smoothstep(2.5, 4.5, abs(p.y - 9.))) * step(p.x, 70.) * step(-150., p.x));
      road = max(road, (1. - smoothstep(3., 5., abs(p.y - 140.))) * step(p.x, -60.));
      road = max(road, (1. - smoothstep(3., 5., abs(p.y + 92.))) * step(p.x, -60.));
      float trk = 1. - smoothstep(.5, 1.2, abs(abs(seg(p, vec2(132., -8.), vec2(74., 12.)) - 1.6)));
      trk = max(trk, 1. - smoothstep(.5, 1.2, abs(abs(seg(p, vec2(74., 12.), vec2(98., 64.)) - 1.6))));
      col = mix(col, mix(grav, dirt, .5) * vec3(.92, .88, .82), road * .85);
      col *= 1. - trk * .18;
      col *= .9 + gN(p * .5) * .2;
      diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'tunnelGround';
  return m;
}
function buildGround() {
  const mat = groundMaterial();
  const X0 = -560, X1 = 300, Z0 = -460, Z1 = 460, S = 5;
  const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, Math.round((X1 - X0) / S), Math.round((Z1 - Z0) / S)); geo.rotateX(-Math.PI / 2); geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hT(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; G.scene.add(m); geo.userData.noOcclude = true; G.colliders.push(geo);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2).translate(0, -.3, 0), mat); G.scene.add(far);
  G.groundMesh = m;
}

// ---------- houses the mission needs a handle on ----------
// dressing that is not part of a house's collapse goes into one more set of buckets, merged per material over the
// whole edge of the neighbourhood (a few draw calls for all of it)
const deco = new Map();
function dadd(mat, geo) { if (!deco.has(mat)) deco.set(mat, []); deco.get(mat).push(geo); }
// only the big pieces cast into the live shadow map (each caster is one more draw call in the shadow pass)
function flushDeco() { const big = new Set([MAT.concrete, MAT.block, MAT.rubble, TM.dirt, MAT.rustSheet]); for (const [mat, list] of deco) { const m = new THREE.Mesh(mergeGeometries(list.map(strip)), mat); m.castShadow = big.has(mat); m.receiveShadow = true; G.scene.add(m); } deco.clear(); }
// a round bar between two points (tripod legs, poles, rebar)
function rod(a, b, r, seg = 6) { const dv = b.clone().sub(a); const L = dv.length(); const g = new THREE.CylinderGeometry(r, r, L, seg); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dv.normalize())); const m = a.clone().add(b).multiplyScalar(.5); return g.translate(m.x, m.y, m.z); }
// a filled sack (sandbags, spoil sacks): a box pinched toward its edges
function sackGeo(w = .6, h = .26, d = .38) { const g = new THREE.BoxGeometry(w, h, d, 2, 1, 2); const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) { const k = 1 - Math.abs(pp.getY(i)) / h * .5; pp.setX(i, pp.getX(i) * k); pp.setZ(i, pp.getZ(i) * k); } g.computeVertexNormals(); return g; }
// A plain Gaza concrete-frame house: block or plaster skin, slab edges at each floor, parapet, steel shutters, a water
// tank or two and a solar heater on the roof. Merged per material inside its own group, so B can collapse as a unit.
// opts.hollow (B): a real ground floor (walls, door gap, ceiling, tiled floor) that the force walks into.
function house(id, o, skin, opts = {}) {
  const r = rng(o.x * 31 + o.z * 7 + 5); const q = rng(o.x * 13 - o.z * 17 + 3); const g = new THREE.Group(); g.name = id;
  const H = 3.4 + (o.f - 1) * 3, w = o.w, d = o.d;
  const loc = (geo, x, y, z) => geo.translate(x, y, z);
  if (opts.hollow) hollowShell(w, d, H, skin); else add(skin, loc(box(w, H + .6, d, 2.5), 0, (H - .6) / 2, 0));
  for (let k = 1; k <= o.f; k++) add(MAT.concrete, loc(box(w + .16, .22, d + .16, 2), 0, 3.4 + (k - 1) * 3 - .11, 0));
  // parapet with a gap for the roof door
  for (const [pw, pd, px, pz] of [[w, .2, 0, d / 2 - .1], [w, .2, 0, -d / 2 + .1], [.2, d, w / 2 - .1, 0], [.2, d, -w / 2 + .1, 0]]) add(skin, loc(box(pw, .9, pd, 2.5), px, H + .45, pz));
  // windows: dark glass with half-closed steel shutters, one row per floor on all four faces; bars on the ground floor
  const faces = [[w, 0, d / 2, 0], [w, 0, -d / 2, Math.PI], [d, w / 2, 0, Math.PI / 2], [d, -w / 2, 0, -Math.PI / 2]];
  faces.forEach(([len, fx, fz, ry], fi) => {
    const n = Math.max(1, Math.floor((len - 1) / 3.1)), sp = len / n;
    for (let k = 0; k < o.f; k++) for (let i = 0; i < n; i++) {
      const s = -len / 2 + sp * (i + .5); if (opts.door === fi && k === 0 && i === Math.floor(n / 2)) continue;
      const y = 1.5 + k * 3 + (k ? .3 : 0), ww = 1.2, wh = 1.25, shut = r();
      const lx = Math.cos(ry) * s + fx + Math.sin(ry) * .03, lz = -Math.sin(ry) * s + fz + Math.cos(ry) * .03;
      add(MAT.glassDark, at(new THREE.PlaneGeometry(ww, wh), 0, 0, 0, ry).translate(lx, y, lz));
      if (shut > .35) add(MAT.metalDark, at(box(ww + .06, wh * (shut > .75 ? 1 : .55), .04, 1), 0, 0, 0, ry).translate(lx + Math.sin(ry) * .02, y + (shut > .75 ? 0 : wh * .22), lz + Math.cos(ry) * .02));
      add(MAT.concrete, at(box(ww + .3, .08, .14, 1), 0, 0, 0, ry).translate(lx + Math.sin(ry) * .05, y - wh / 2 - .05, lz + Math.cos(ry) * .05));
      if (k === 0 && q() < .65) for (let b = 0; b < 5; b++) add(MAT.metalDark, at(box(.025, wh + .1, .025, 1), (b - 2) * .26, 0, 0, ry).translate(lx + Math.sin(ry) * .09, y, lz + Math.cos(ry) * .09));
      // from inside B the ground-floor windows read as daylight through dirty glass
      if (k === 0 && opts.hollow) add(TM.winIn, at(new THREE.PlaneGeometry(ww, wh), 0, 0, 0, ry + Math.PI).translate(lx - Math.sin(ry) * .3, y, lz - Math.cos(ry) * .3));
    }
  });
  if (opts.door !== undefined && !opts.hollow) { const [len, fx, fz, ry] = faces[opts.door]; add(MAT.metalDoor, at(box(1.1, 2.15, .08, 1), fx + Math.sin(ry) * .04, 1.07, fz + Math.cos(ry) * .04, ry)); }
  // roof: black water tanks on a stand and a solar heater
  const nt = 1 + Math.floor(r() * 2); for (let i = 0; i < nt; i++) { const tx = (r() - .5) * (w - 3), tz = (r() - .5) * (d - 3); add(TM.tank, new THREE.CylinderGeometry(.55, .55, 1.1, 10).translate(tx, H + .95, tz)); add(MAT.metalDark, box(1.2, .4, 1.2, 1).translate(tx, H + .2, tz)); }
  if (r() < .7) { const sx = (r() - .5) * (w - 3), sz = (r() - .5) * (d - 3); add(TM.solar, new THREE.BoxGeometry(1.8, .06, 1).rotateX(-.6).translate(sx, H + .7, sz)); add(TM.tank, new THREE.CylinderGeometry(.22, .22, 1.8, 8).rotateZ(Math.PI / 2).translate(sx, H + 1.1, sz - .5)); }
  // dressing: B keeps it in its own group (it goes down with the house), the others share the deco buckets
  dress(opts.hollow ? add : (mat, geo) => dadd(mat, geo.translate(o.x, 0, o.z)), o, H, faces, q, skin, opts);
  if (opts.extra) opts.extra(H);
  const meshes = flush(g); g.position.set(o.x, 0, o.z); G.scene.add(g); g.updateMatrixWorld(true);
  // B's rooms are only drawn when a camera is near them (updateWorld), and never cast into the sun's shadow map
  if (opts.hollow) { const IN = new Set([MAT.terrazzo, MAT.intWall, MAT.ceiling, TM.winIn, MAT.wood, MAT.mattress, MAT.mattress2, MAT.neon, MAT.cable, MAT.genRed, TM.sandFresh, TM.bag, TM.gas]); g.userData.interior = meshes.filter(m => IN.has(m.material)); for (const m of g.userData.interior) m.castShadow = false; }
  if (opts.hollow) { for (const [cw, ch, cd, cx, cy, cz] of [[w, 4, .25, 0, 1.4, d / 2 - .125], [.25, 4, d, -w / 2 + .125, 1.4, 0], [.25, 4, d, w / 2 - .125, 1.4, 0], [w / 2 - .6, 4, .25, -(w / 2 + .6) / 2, 1.4, -d / 2 + .125], [w / 2 - .6, 4, .25, (w / 2 + .6) / 2, 1.4, -d / 2 + .125], [w, H - 3.4 + .9, d, 0, (H + 3.4 + .9) / 2, 0], [w - .5, .1, d - .5, 0, .05, 0]]) G.colliders.push(new THREE.BoxGeometry(cw, ch, cd).translate(o.x + cx, cy, o.z + cz)); }
  else { const col = new THREE.BoxGeometry(w, H + .9, d); col.translate(o.x, (H + .9) / 2, o.z); G.colliders.push(col); }
  const info = { id, o, group: g, H, top: H + .02, meshes, center: V3(o.x, 0, o.z) };
  (G.houses ||= {})[id] = info; return info;
}
// B's ground floor: block walls (a door gap on the street side), plastered inside, a ceiling, a tiled floor broken open
// around the shaft. Walls run from below grade so no light leaks under them.
function hollowShell(w, d, H, skin) {
  const t = .25, dg = .6, iw = w - 2 * t, id = d - 2 * t;
  const wall = (gw, gd, x, z) => add(skin, box(gw, 4, gd, 2.5).translate(x, 1.4, z));
  wall(w, t, 0, d / 2 - t / 2); wall(t, d - 2 * t, -w / 2 + t / 2, 0); wall(t, d - 2 * t, w / 2 - t / 2, 0);
  wall(w / 2 - dg, t, -(w / 2 + dg) / 2, -d / 2 + t / 2); wall(w / 2 - dg, t, (w / 2 + dg) / 2, -d / 2 + t / 2);
  add(skin, box(2 * dg, 1.2, t, 2.5).translate(0, 2.8, -d / 2 + t / 2));
  add(skin, box(w, H - 3.4, d, 2.5).translate(0, (H + 3.4) / 2, 0));
  const pl = (pw, ph, x, y, z, ry) => add(MAT.intWall, at(new THREE.PlaneGeometry(pw, ph), x, y, z, ry));
  pl(iw, 3.3, 0, 1.65, d / 2 - t - .01, Math.PI); pl(id, 3.3, -w / 2 + t + .01, 1.65, 0, Math.PI / 2); pl(id, 3.3, w / 2 - t - .01, 1.65, 0, -Math.PI / 2);
  const sw = iw / 2 - dg; pl(sw, 3.3, -(dg + sw / 2), 1.65, -d / 2 + t + .01, 0); pl(sw, 3.3, dg + sw / 2, 1.65, -d / 2 + t + .01, 0); pl(2 * dg, 1.1, 0, 2.75, -d / 2 + t + .01, 0);
  add(MAT.ceiling, new THREE.PlaneGeometry(iw, id).rotateX(Math.PI / 2).translate(0, 3.3, 0));
  // the floor around a 1.8 m square where the tiles were lifted for the dig
  const sx = SHAFT.x - TL.B.x, sz = SHAFT.z - TL.B.z, hx0 = sx - .9, hx1 = sx + .9, hz0 = sz - .9, hz1 = sz + .9, X0 = -iw / 2, X1 = iw / 2, Z0 = -id / 2, Z1 = id / 2;
  const fl = (x0, x1, z0, z1) => add(MAT.terrazzo, box(x1 - x0, .1, z1 - z0, 1.6).translate((x0 + x1) / 2, .05, (z0 + z1) / 2));
  fl(X0, hx0, Z0, Z1); fl(hx1, X1, Z0, Z1); fl(hx0, hx1, Z0, hz0); fl(hx0, hx1, hz1, Z1);
}
// what B's kitchen looks like after weeks of digging: the shaft collar, sandbags, a winch tripod, spoil sacks, a lamp
// on a cable, the diggers' mattresses, and the power cable from the street window running down the hole
function shaftRoom() {
  const q = rng(2407); const sx = SHAFT.x - TL.B.x, sz = SHAFT.z - TL.B.z;
  const A = (m, geo) => add(m, geo);
  // broken tiles and packed spoil around the opening
  A(TM.sandFresh, new THREE.RingGeometry(.5, 1.15, 18, 1).rotateX(-Math.PI / 2).translate(sx, .035, sz));
  for (let i = 0; i < 16; i++) { const a = q() * 6.28, rr2 = .78 + q() * .3; A(MAT.terrazzo, box(.3 + q() * .15, .035, .3 + q() * .15, .6).rotateX((q() - .5) * .5).rotateZ((q() - .5) * .5).rotateY(q() * 3).translate(sx + Math.cos(a) * rr2, .06 + q() * .05, sz + Math.sin(a) * rr2)); }
  // the precast collar the diggers cast around the mouth, and the ladder's top
  A(MAT.concrete, new THREE.CylinderGeometry(.72, .74, .5, 18, 1, true).translate(sx, .07, sz)); A(MAT.concrete, new THREE.RingGeometry(.5, .72, 18, 1).rotateX(-Math.PI / 2).translate(sx, .32, sz));
  for (const s of [-.2, .2]) A(MAT.rust, box(.04, 1.6, .04, 1).translate(sx - .44, -.4, sz + s));
  for (let k = 0; k < 4; k++) A(MAT.rust, box(.04, .03, .44, 1).translate(sx - .44, .25 - k * .3, sz));
  // sandbags in a ring, two layers on the street side
  const bag = sackGeo(); for (let i = 0; i < 13; i++) { const a = i / 13 * 6.28 + .2, l = i < 7 ? 2 : 1; for (let j = 0; j < l; j++) A(TM.bag, bag.clone().rotateY(-a + Math.PI / 2 + (q() - .5) * .2).translate(sx + Math.cos(a) * 1.05, .23 + j * .24, sz + Math.sin(a) * 1.05)); }
  // winch tripod over the mouth: three steel legs, a pulley and the cable running down
  const apex = V3(sx, 2.75, sz); const feet = [0, 2.1, 4.2].map(a => V3(sx + Math.cos(a + .5) * 1.45, .1, sz + Math.sin(a + .5) * 1.45));
  for (const f of feet) A(MAT.steel, rod(f, apex, .035, 6));
  A(MAT.metalDark, new THREE.TorusGeometry(.11, .03, 5, 10).translate(sx, 2.62, sz)); A(MAT.cable, rod(V3(sx + .1, 2.6, sz), V3(sx + .1, -3, sz), .01, 4));
  const f0 = feet[0], wp = f0.clone().lerp(apex, .35); A(MAT.genRed, new THREE.CylinderGeometry(.13, .13, .36, 10).rotateZ(Math.PI / 2).translate(wp.x, wp.y, wp.z)); A(MAT.metalDark, box(.3, .26, .2, 1).translate(wp.x, wp.y - .2, wp.z));
  // the power cable from the east window down the hole, and a lamp on it over the dig
  const c = []; const pts = [V3(5.9, 2.2, -2), V3(5.6, 1.4, -2), V3(5.5, .12, -1.8), V3(2, .12, -1.2), V3(sx + 1, .12, sz - .4), V3(sx + .45, .3, sz - .1), V3(sx + .42, -2.5, sz - .1)]; for (let i = 1; i < pts.length; i++) c.push(pts[i - 1], pts[i]);
  c.push(V3(1.5, 3.29, -1), V3(sx + .3, 2.4, sz - 1.2)); A(MAT.cable, cableGeometry(c, .018));
  A(MAT.neon, new THREE.SphereGeometry(.06, 8, 6).translate(sx + .3, 2.33, sz - 1.2)); A(MAT.metalDark, new THREE.CylinderGeometry(.05, .14, .12, 10, 1, true).translate(sx + .3, 2.42, sz - 1.2));
  // spoil sacks and buckets waiting by the wall, a wheelbarrow
  const sk = sackGeo(.55, .3, .4); for (let i = 0; i < 9; i++) A(TM.bag, sk.clone().rotateY(q() * .5).translate(-5.2 + (i % 3) * .58, .25 + Math.floor(i / 3) * .28, -3.9 + q() * .1));
  for (let i = 0; i < 3; i++) A(i ? TM.tank : MAT.plasticBlue, new THREE.CylinderGeometry(.17, .13, .32, 10).translate(sx + 1.4 + i * .4, .26, sz + 1.3 - i * .2));
  A(MAT.metalDark, box(.62, .32, .9, 1).rotateY(.6).translate(sx + 1.9, .45, sz - .9));
  // the kitchen itself: counter and sink along the south wall, a fridge, a gas bottle; the diggers' mattresses in the salon
  A(MAT.wood, box(4.2, .86, .6, 1).translate(-3.6, .53, 4.4)); A(MAT.concrete, box(4.3, .05, .64, 1).translate(-3.6, .98, 4.4)); A(MAT.plastic, box(.7, 1.75, .65, 1).translate(-.9, .97, 4.35));
  A(TM.gas, new THREE.CylinderGeometry(.16, .16, .62, 10).translate(-.2, .41, 4.4));
  A(MAT.intWall, box(.15, 3.3, 5.2, 1).translate(1.6, 1.75, -2.1));
  A(MAT.mattress, box(1.9, .13, .8, 1).translate(3.9, .17, 3.9)); A(MAT.mattress2, box(1.9, .13, .8, 1).rotateY(.1).translate(4.2, .17, 2.9)); A(MAT.blanket, box(1.2, .05, .9, 1).rotateY(.4).translate(3.7, .26, 3.4));
  A(MAT.plastic, box(.45, .45, .45, 1).translate(2.6, .33, 1.2)); A(MAT.plasticBlue, box(.45, .45, .45, 1).rotateZ(1.4).translate(3.1, .3, .2));
}
// the shaft's concrete liner as seen from the house: lighter at the lip, black a few metres down
function shaftLiner(info, cx, cz, top = .32) {
  const geo = new THREE.CylinderGeometry(.5, .5, 4.5, 16, 6, true); geo.translate(0, top - 2.25, 0); const p = geo.attributes.position; const col = [];
  for (let i = 0; i < p.count; i++) { const k = Math.exp((p.getY(i) - top) * 1.4); col.push(.3 * k + .004, .28 * k + .004, .25 * k + .004); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, TM.liner); m.position.set(cx, 0, cz); m.renderOrder = -1; if (info) info.group.userData.interior.push(m);
  // a black floor where the liner ends: past it the sky dome (drawn without depth) would show through the hole
  const cap = new THREE.Mesh(new THREE.CircleGeometry(.5, 16).rotateX(-Math.PI / 2).translate(0, top - 4.45, 0), new THREE.MeshBasicMaterial({ color: '#000000' })); m.add(cap);
  (info ? info.group : G.scene).add(m); return m;
}
// Gaza house dressing: what makes a block house read as lived in, from 250 m and from the feed. Balconies with a low
// wall, AC boxes, the unfinished next storey (column stubs with rebar), plastic tanks and dishes on the roof, a walled
// yard with a steel gate and a tree, a heap of rubble from the last war. All from the house's own rng.
function dress(A, o, H, faces, q, skin, opts) {
  const w = o.w, d = o.d, f = o.f;
  const P = (fi, s, e, y, geo, rot = 0) => { const [, fx, fz, ry] = faces[fi]; return at(geo, Math.cos(ry) * s + fx + Math.sin(ry) * e, y, -Math.sin(ry) * s + fz + Math.cos(ry) * e, ry + rot); };
  // a darker plinth splashed with mud, and a coping on the parapet
  faces.forEach(([len], fi) => { A(MAT.concrete, P(fi, 0, .05, .3, box(len + .12, .6, .1, 2))); A(MAT.concrete, P(fi, 0, -.1, H + .93, box(len + .14, .07, .32, 1))); });
  for (let k = 1; k < f; k++) {
    const fi = q() < .65 ? 2 : (opts.door === 0 ? 1 : 0), len = faces[fi][0], bw = 2.6 + q() * 1.2, s = (q() - .5) * (len - bw - .6), y = 3.4 + (k - 1) * 3;
    A(MAT.concrete, P(fi, s, .56, y - .07, box(bw, .14, 1.12, 1)));
    A(MAT.concrete, P(fi, s, 1.07, y + .48, box(bw, .9, .1, 1.5))); A(MAT.concrete, P(fi, s - bw / 2 + .05, .56, y + .48, box(.1, .9, 1.12, 1))); A(MAT.concrete, P(fi, s + bw / 2 - .05, .56, y + .48, box(.1, .9, 1.12, 1)));
    A(MAT.steel, P(fi, s, 1.07, y + 1.02, box(bw, .04, .05, 1)));
    if (q() < .6) A(MAT.plastic, P(fi, s + (q() - .5) * bw * .6, .5, y + .25, box(.45, .5, .45, 1)));
    if (q() < .5) A(TM.gas, P(fi, s - bw * .3, .45, y + .3, new THREE.CylinderGeometry(.15, .15, .6, 8)));
    if (q() < .5) A(MAT.blanket, P(fi, s + bw * .2, 1.13, y + .7, new THREE.PlaneGeometry(1.1, .8)));
  }
  for (let i = 0; i < 1 + f; i++) { const fi = q() < .6 ? 2 : 0, len = faces[fi][0], s = (q() < .5 ? -1 : 1) * (len / 2 - .8), k = Math.floor(q() * f); A(MAT.acUnit, P(fi, s, .17, 2.3 + k * 3, box(.82, .52, .3, 1))); }
  // the next storey was never built: column stubs with their rebar standing up, and plastic tanks and dishes
  if (q() < .75) for (const [cx, cz] of [[w / 2 - .3, d / 2 - .3], [-w / 2 + .3, d / 2 - .3], [w / 2 - .3, -d / 2 + .3], [-w / 2 + .3, -d / 2 + .3]]) {
    A(MAT.concrete, box(.32, 1.1, .32, 1).translate(cx, H + .55, cz));
    for (const [ox, oz] of [[-.09, -.09], [.09, -.09], [-.09, .09], [.09, .09]]) A(MAT.rust, box(.025, .95, .025, 1).rotateZ((q() - .5) * .35).rotateX((q() - .5) * .35).translate(cx + ox, H + 1.55, cz + oz));
  }
  for (let i = 0; i < 1 + Math.floor(q() * 2); i++) { const tx = (q() - .5) * (w - 3), tz = (q() - .5) * (d - 3); A(q() < .5 ? MAT.plasticBlue : MAT.plastic, new THREE.CylinderGeometry(.5, .5, 1.05, 12).translate(tx, H + .93, tz)); A(MAT.metalDark, box(1.1, .4, 1.1, 1).translate(tx, H + .2, tz)); }
  if (q() < .75) { const dx = (q() - .5) * (w - 2), dz = (q() - .5) * (d - 2); A(MAT.plastic, new THREE.SphereGeometry(.45, 10, 4, 0, Math.PI * 2, 0, .8).rotateX(-1.15).rotateY(-2.2 + q()).translate(dx, H + 1.25, dz)); A(MAT.steel, box(.04, 1.1, .04, 1).translate(dx, H + .55, dz)); }
  if (q() < .55) { const lz = (q() - .5) * (d - 3); A(MAT.steel, box(.04, 1.6, .04, 1).translate(-w / 2 + 1, H + .8, lz)); A(MAT.steel, box(.04, 1.6, .04, 1).translate(w / 2 - 1, H + .8, lz)); for (let i = 0; i < 5; i++) if (q() < .8) A(MAT.blanket, new THREE.PlaneGeometry(.55 + q() * .4, .7 + q() * .4).translate(-w / 2 + 1.6 + i * (w - 3) / 5, H + 1.15, lz)); }
  // a walled yard with a steel gate, a lemon tree and the family's plastic chairs
  if (opts.yard !== undefined) {
    const fi = opts.yard, len = faces[fi][0], yd = 4.2 + q() * 1.5, yw = Math.min(len, 9);
    A(MAT.block, P(fi, -yw / 2, yd / 2, 1.05, box(.22, 2.1, yd, 2.5))); A(MAT.block, P(fi, yw / 2, yd / 2, 1.05, box(.22, 2.1, yd, 2.5)));
    const gs = (q() - .5) * (yw - 4); A(MAT.block, P(fi, (-yw / 2 + gs - 1.2) / 2, yd, 1.05, box(gs - 1.2 + yw / 2, 2.1, .22, 2.5))); A(MAT.block, P(fi, (yw / 2 + gs + 1.2) / 2, yd, 1.05, box(yw / 2 - gs - 1.2, 2.1, .22, 2.5)));
    A(MAT.greenPaint, P(fi, gs, yd, 1, box(2.4, 1.95, .05, 1)));
    const tx = gs + (q() < .5 ? -2 : 2); A(TM.bark, P(fi, tx, yd * .5, .9, new THREE.CylinderGeometry(.07, .11, 1.8, 5))); for (let k = 0; k < 3; k++) A(TM.leaf, P(fi, tx + (q() - .5) * .8, yd * .5 + (q() - .5) * .8, 2.1 + q() * .5, new THREE.IcosahedronGeometry(.8 + q() * .3, 0)));
    for (let k = 0; k < 2; k++) A(MAT.plastic, P(fi, (q() - .5) * yw * .6, 1 + q() * 2, .25, box(.45, .5, .45, 1), q()));
  }
  // rubble from an earlier strike, pushed against one corner
  if (q() < .6) { const fi = Math.floor(q() * 4), len = faces[fi][0], s = (q() < .5 ? -1 : 1) * (len / 2 + .5); for (let i = 0; i < 9; i++) A(MAT.rubble, P(fi, s + (q() - .5) * 2.4, .8 + q() * 1.8, .15 + q() * .3, box(.4 + q() * .9, .2 + q() * .35, .3 + q() * .7, 1), q() * 3)); A(MAT.sand, P(fi, s, 1.4, .25, new THREE.ConeGeometry(1.3, .6, 8, 1))); }
}
// people inside a house, as the thermal camera sees them: warm patches in the windows (IR only)
function occupantBlobs(info, n, seed) {
  const r = rng(seed); const o = info.o; const list = [];
  for (let i = 0; i < n; i++) {
    const face = Math.floor(r() * 4), fl = Math.floor(r() * Math.min(2, o.f)); const len = face < 2 ? o.w : o.d; const s = (r() - .5) * (len - 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(.5, 1.1), TM.heat); m.renderOrder = 5;
    const y = .9 + fl * 3 + .3;
    if (face === 0) m.position.set(o.x + s, y, o.z + o.d / 2 + .06); else if (face === 1) { m.position.set(o.x + s, y, o.z - o.d / 2 - .06); m.rotation.y = Math.PI; }
    else if (face === 2) { m.position.set(o.x + o.w / 2 + .06, y, o.z + s); m.rotation.y = Math.PI / 2; } else { m.position.set(o.x - o.w / 2 - .06, y, o.z + s); m.rotation.y = -Math.PI / 2; }
    m.visible = false; G.scene.add(m); G.irOnly.push(m); list.push(m);
  }
  info.blobs = list; return list;
}

// ---------- the candidates and their clues ----------
function candidates() {
  const T = TL;
  // B: a three-storey block house with a walled yard on its south side; the shaft is under the ground-floor kitchen
  const b = house('B', T.B, MAT.block, { door: 1, hollow: true, extra: () => shaftRoom() });
  shaftLiner(b, SHAFT.x - T.B.x, SHAFT.z - T.B.z);
  // B's steel door on a hinge: it is opened quietly or blown in, as the commander decides
  { const pv = new THREE.Group(); pv.position.set(-.55, 0, -T.B.d / 2 + .06); const dm = new THREE.Mesh(box(1.1, 2.15, .06, 1).translate(.55, 1.08, 0), MAT.metalDoor); dm.castShadow = true; pv.add(dm); b.group.add(pv); G.doorB = pv; }
  // the diggers' work lamp: the one warm light inside (desktop only: on phones every light costs every pixel)
  if (!G.isTouch) { const L = new THREE.PointLight('#ffc98a', 2.2, 9, 2); L.position.set(SHAFT.x - T.B.x + .3, 2.2, SHAFT.z - T.B.z - 1.2); b.group.add(L); G.lampB = L; }
  const yx = T.B.x, yz = T.B.z + T.B.d / 2 + 6.5;
  for (const [w, d, x, z] of [[.25, 13, yx - 6, yz], [.25, 13, yx + 6, yz], [12.2, .25, yx, yz + 6.5]]) add(MAT.block, at(box(w, 2.3, d, 2.5), x, 1.15, z), true);
  // fresh sand from the dig: lighter and finer than the ground, heaped against the yard wall, some still in sacks
  const sp = new THREE.ConeGeometry(2.6, 1.7, 14, 3); const pp = sp.attributes.position; const q = rng(808);
  for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); if (y > -.84) { const k = 1 + (q() - .5) * .25; pp.setX(i, pp.getX(i) * k); pp.setZ(i, pp.getZ(i) * k * 1.3); } } sp.computeVertexNormals();
  add(TM.sandFresh, at(sp, yx - 2.6, .8, yz + 2.6)); add(TM.sandFresh, at(new THREE.ConeGeometry(1.5, .9, 10, 1).scale(1.4, 1, 1), yx + 1.2, .42, yz + 4));
  for (let i = 0; i < 9; i++) add(TM.bag, at(box(.6, .26, .36, 1), yx - 4.6 + (i % 3) * .62, .13 + Math.floor(i / 3) * .26, yz - 3 + q() * .2, q() * .3));
  // a wheelbarrow and buckets by the heap: how the spoil comes up
  add(MAT.metalDark, at(box(.6, .3, .9, 1), yx + 3, .45, yz + 1.5, .4)); add(TM.tank, at(new THREE.CylinderGeometry(.16, .13, .3, 8), yx + 2.2, .15, yz + 2.6)); add(TM.tank, at(new THREE.CylinderGeometry(.16, .13, .3, 8), yx + 2.5, .15, yz + 3.1));
  // generator in the yard, exhaust pipe up the wall
  add(MAT.genRed, at(box(1.3, .85, .75, 1), yx + 4, .43, yz - 3.8)); add(MAT.metalDark, at(new THREE.CylinderGeometry(.05, .05, 3.2, 6), yx + 4.9, 1.6, yz - 5.1));
  G.genPos = V3(yx + 4, 1.2, yz - 3.8);
  // electric pole on the street and a thick cable sagging from it into a ground-floor window of B
  const px = T.B.x + 9, pz = T.B.z - 11; add(TM.pole, at(new THREE.CylinderGeometry(.11, .15, 8, 6), px, 4, pz));
  const a = V3(px, 7.6, pz), c = V3(T.B.x + T.B.w / 2 - .1, 2.2, T.B.z - 2); const pts = []; let prev = a;
  for (let i = 1; i <= 12; i++) { const t = i / 12; const pnt = a.clone().lerp(c, t); pnt.y -= Math.sin(t * Math.PI) * 1.4; pts.push(prev, pnt); prev = pnt; }
  add(MAT.cable, cableGeometry(pts, .025));
  flush();
  // thermal: the generator runs hot and heat leaks from the kitchen window over the shaft (the ventilation of the dig)
  const gen = new THREE.Mesh(new THREE.BoxGeometry(1.34, .9, .8), TM.heat); gen.position.set(yx + 4, .45, yz - 3.8); gen.visible = false; G.scene.add(gen); G.irOnly.push(gen);
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), TM.heat); vent.position.set(T.B.x - 2.5, 1.4, T.B.z + T.B.d / 2 + .07); vent.visible = false; G.scene.add(vent); G.irOnly.push(vent);
  const plume = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), TM.warm); plume.position.set(T.B.x - 2.5, .02, T.B.z + T.B.d / 2 + 1.2); plume.rotation.x = -Math.PI / 2; plume.visible = false; G.scene.add(plume); G.irOnly.push(plume);
  occupantBlobs(b, 2, 21);
  // A: a family house: laundry on the roof, a child's bicycle at the door, warm people inside
  const ha = house('A', T.A, MAT.plasterCream, { door: 0, yard: 1 });
  add(MAT.metalDark, at(box(.04, .6, 1.4, 1), T.A.x + 2, .55, T.A.z + T.A.d / 2 + 1.2)); add(TM.tyre, at(new THREE.TorusGeometry(.3, .04, 5, 12), T.A.x + 2, .32, T.A.z + T.A.d / 2 + .6, Math.PI / 2)); add(TM.tyre, at(new THREE.TorusGeometry(.3, .04, 5, 12), T.A.x + 2, .32, T.A.z + T.A.d / 2 + 1.8, Math.PI / 2));
  for (let i = 0; i < 6; i++) add(MAT.tarp[i % MAT.tarp.length] || MAT.plasticBlue, at(new THREE.PlaneGeometry(.6, .8), T.A.x - 3 + i * .9, ha.H + 1.4, T.A.z, 0));
  flush(); occupantBlobs(ha, 6, 22);
  // C: a disused block workshop with a rusted sheet roof, cold in thermal
  const cw = T.C; const hc = house('C', cw, MAT.concrete, { door: 1 });
  add(MAT.rustSheet, at(new THREE.PlaneGeometry(cw.w + .8, cw.d + .8).rotateX(-Math.PI / 2 + .06), cw.x, hc.H + .55, cw.z)); flush();
  // neighbours inside the blast radius of B, and the two houses that matter later (the rooftop watcher, the family by the lot)
  const n1 = house('N1', T.N1, MAT.plasterYellow, { door: 0, yard: 3 }); occupantBlobs(n1, 4, 23);
  const n2 = house('N2', T.N2, MAT.plasterWhite, { door: 1, yard: 0 }); occupantBlobs(n2, 3, 24);
  house('W', T.W, MAT.block, { yard: 0 });
  const hh = house('H', T.H, MAT.plasterGray, { door: 2, yard: 0 }); occupantBlobs(hh, 5, 25);
  // the family house 19 m from the tunnel's second exit
  const hs = house('S', T.S, MAT.plasterCream, { door: 0, yard: 3 }); occupantBlobs(hs, 4, 26);
  secondExit();
}

// The tunnel's second exit: a half-collapsed block shed in a scrap yard north of B. Under a pallet and a tarp, a
// smaller shaft with its own collar; the diggers' fresh sand gives it away from the air, and it breathes warm air in IR.
function secondExit() {
  const X = TL.X2, q = rng(3101); const A = (m, g) => dadd(m, g.translate(X.x, 0, X.z));
  A(MAT.block, box(5.2, 2.4, .22, 2.5).translate(0, 1.2, -2.2)); A(MAT.block, box(.22, 2.4, 4.4, 2.5).translate(-2.5, 1.2, 0)); A(MAT.block, box(.22, 1.4, 2.6, 2.5).rotateZ(.08).translate(2.5, .7, -.9));
  A(MAT.rustSheet, new THREE.PlaneGeometry(5.6, 3.2).rotateX(-Math.PI / 2 + .35).rotateZ(.12).translate(-.2, 2.05, -.8)); A(MAT.rustSheet, new THREE.PlaneGeometry(2.4, 1.6).rotateX(-Math.PI / 2 + 1.2).translate(1.6, .6, 1.6));
  for (let i = 0; i < 10; i++) A(MAT.rubble, box(.4 + q() * .7, .2 + q() * .3, .3 + q() * .6, 1).rotateY(q() * 3).rotateX((q() - .5) * .5).translate(2 + q() * 2.5, .15, -1 + q() * 3.5));
  A(MAT.concrete, new THREE.CylinderGeometry(.62, .64, .4, 14, 1, true).translate(0, .1, 0)); A(MAT.concrete, new THREE.RingGeometry(.45, .62, 14, 1).rotateX(-Math.PI / 2).translate(0, .3, 0));
  A(TM.sandFresh, new THREE.RingGeometry(.45, 1.6, 16, 1).rotateX(-Math.PI / 2).translate(0, .03, 0)); A(TM.sandFresh, new THREE.ConeGeometry(1.4, .8, 10, 1).scale(1.3, 1, 1).translate(-1.2, .38, 1.9));
  A(TM.wood, box(1.2, .12, 1, 1).rotateZ(1.1).translate(.9, .55, .2)); A(MAT.cable, cableGeometry([V3(-2.3, 1.9, -2), V3(-1, .08, -.8), V3(-1, .08, -.8), V3(-.3, .25, -.2), V3(-.3, .25, -.2), V3(-.35, -2, -.2)], .016));
  shaftLiner(null, X.x, X.z, .3).scale.set(.9, 1, .9);
  // thermal: the tunnel's air leaving through the mouth
  const v = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12).rotateX(-Math.PI / 2), TM.warm); v.position.set(X.x, .35, X.z); v.visible = false; G.scene.add(v); G.irOnly.push(v);
  G.footprints.push([X.x, X.z, 5, 4.4, 0]);
}
// The open ground between the force and the town, which the commander looks across all mission: the bulldozed berm and
// sandbags of the forward position, a burnt car, a field of wrecked greenhouse frames, a pump house and its pool, the
// power line along the road, concrete barriers and spoil heaps. Merged per material (the deco buckets), own rng.
function fieldDressing() {
  const q = rng(6061); const A = dadd; const Y = (x, z) => hT(x, z);
  // the force's berm: two pushed-up banks of earth either side of the vehicle track
  for (const [z0, z1] of [[-34, -7], [4, 24]]) { const L = z1 - z0; const g = new THREE.CylinderGeometry(1.5, 1.7, L, 9, 10, false); g.rotateX(Math.PI / 2); g.scale(1, .5, 1); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = 113 + p.getX(i) + Math.sin(p.getZ(i) * .3) * .6, z = (z0 + z1) / 2 + p.getZ(i); p.setXYZ(i, x, Math.max(-.2, p.getY(i) + (fbm(x * .5, z * .5, 2) - .5) * .4) + Y(x, z) - .25, z); } g.computeVertexNormals(); A(TM.dirt, g); }
  // the forward position at the command vehicle: sandbag wall, crates, jerrycans, a camouflage net on poles, a mast
  const bag = sackGeo(); const cx = TL.cmd.x, cz = TL.cmd.z;
  for (let i = 0; i < 16; i++) { const a = .3 + i / 16 * 1.3, R0 = 5; const x = cx + 4 + Math.cos(a) * R0, z = cz + 6 + Math.sin(a) * R0; for (let j = 0; j < 2; j++) A(TM.bag, bag.clone().rotateY(-a + (q() - .5) * .2).translate(x + (j % 2) * .1, Y(x, z) + .1 + j * .24, z)); }
  for (let i = 0; i < 6; i++) { const x = cx - 2 + q() * 3, z = cz + 4 + q() * 3; A(TM.olive, box(.6, .25, .32, 1).rotateY(q() * .4).translate(x, Y(x, z) + .13 + (i > 3 ? .25 : 0), z)); }
  for (let i = 0; i < 4; i++) { const x = cx + 1 + i * .25, z = cz + 9.4; A(TM.charge, box(.17, .46, .34, 1).translate(x, Y(x, z) + .23, z)); }
  { const nx = cx + 1.5, nz = cz + 7.5, ny = Y(nx, nz); const g = new THREE.PlaneGeometry(7, 5, 8, 6).rotateX(-Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 2.4 - (x * x / 14 + z * z / 7) * .5 + (q() - .5) * .25); } g.computeVertexNormals(); A(TM.net, g.translate(nx, ny, nz)); for (const [dx, dz] of [[-2.5, -1.6], [2.5, -1.6], [-2.5, 1.6], [2.5, 1.6]]) A(TM.pole, new THREE.CylinderGeometry(.04, .04, 2.2, 5).translate(nx + dx, ny + 1.1, nz + dz)); }
  A(MAT.steel, new THREE.CylinderGeometry(.03, .05, 7, 5).translate(cx + 6, Y(cx + 6, cz - 2) + 3.5, cz - 2));
  // a burnt-out car on the field track, sitting on its rims
  { const x = 58, z = 29, y = Y(x, z), ry = .7; const g = (geo) => A(MAT.rust, geo.rotateY(ry).translate(x, y, z)); g(box(4.1, .7, 1.75, 1.5).translate(0, .62, 0)); g(box(2.1, .55, 1.6, 1.5).translate(-.2, 1.25, 0)); A(MAT.black, box(2.15, .5, 1.5, 1).rotateY(ry).translate(x, y + 1.25, z)); for (const [wx, wz] of [[1.3, .8], [1.3, -.8], [-1.3, .8], [-1.3, -.8]]) A(MAT.metalDark, new THREE.CylinderGeometry(.25, .25, .18, 10).rotateX(Math.PI / 2).translate(wx, .25, wz).rotateY(ry).translate(x, y, z)); }
  // wrecked greenhouses: rows of steel hoops, some bent over, rags of plastic sheeting still hanging
  for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) {
    const x = 28 + i * 3, z = 18 + row * 5.5, y = Y(x, z); if (q() < .12) continue; const tilt = q() < .25 ? (q() - .5) * 1.4 : (q() - .5) * .12;
    A(MAT.steel, new THREE.TorusGeometry(2.3, .03, 3, 10, Math.PI).rotateY(Math.PI / 2).rotateX(tilt).translate(x, y - .2, z));
    if (q() < .3) A(TM.sheet, new THREE.PlaneGeometry(2.6, 1.2 + q() * 1.4, 3, 2).rotateY(Math.PI / 2 + (q() - .5) * .4).rotateZ((q() - .5) * .3).translate(x + 1.5, y + .9 + q() * .6, z + (q() - .5) * 3));
  }
  for (let i = 0; i < 3; i++) A(TM.sheet, new THREE.PlaneGeometry(3 + q() * 3, 1.5 + q() * 2, 4, 2).rotateX(-Math.PI / 2 + .1).translate(30 + q() * 24, Y(40, 25) + .08 + i * .01, 16 + q() * 14));
  // the pump house and its concrete pool
  { const x = 96, z = -44, y = Y(x, z); A(MAT.block, box(3, 2.6, 3, 2.5).translate(x, y + 1.2, z)); A(MAT.rustSheet, new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2 + .12).translate(x, y + 2.6, z)); A(MAT.metalDoor, box(.9, 1.9, .05, 1).translate(x + .4, y + .95, z + 1.52));
    A(MAT.concrete, box(7, 1, .25, 2).translate(x + 6, y + .3, z - 2)); A(MAT.concrete, box(7, 1, .25, 2).translate(x + 6, y + .3, z + 2)); A(MAT.concrete, box(.25, 1, 4, 2).translate(x + 9.4, y + .3, z)); A(MAT.concrete, box(.25, 1, 4, 2).translate(x + 2.6, y + .3, z)); A(MAT.glassDark, new THREE.PlaneGeometry(6.6, 3.7).rotateX(-Math.PI / 2).translate(x + 6, y + .5, z));
    A(MAT.pvcPipe, rod(V3(x + 1.5, y + .3, z), V3(x + 2.6, y + .7, z), .06, 6)); }
  // the power line along the road into town, the cables sagging pole to pole
  const poles = [64, 30, -4, -38].map(x => V3(x, Y(x, 14.5), 14.5)); const wires = [];
  for (const p of poles) { A(TM.pole, new THREE.CylinderGeometry(.1, .14, 8, 6).translate(p.x, p.y + 4, p.z)); A(TM.pole, box(1.6, .1, .1, 1).translate(p.x, p.y + 7.6, p.z)); }
  for (let i = 1; i < poles.length; i++) for (const o of [-.7, .7]) { const a = poles[i - 1].clone().add(V3(0, 7.65, o)), b = poles[i].clone().add(V3(0, 7.65, o)); let prev = a; for (let k = 1; k <= 10; k++) { const t = k / 10, p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * .9; wires.push(prev, p); prev = p; } }
  A(MAT.cable, cableGeometry(wires, .012));
  // concrete barriers along the road, two knocked over
  const bar = new THREE.Shape(); bar.moveTo(-.3, 0); bar.lineTo(.3, 0); bar.lineTo(.12, .3); bar.lineTo(.08, .8); bar.lineTo(-.08, .8); bar.lineTo(-.12, .3); bar.closePath(); const barG = new THREE.ExtrudeGeometry(bar, { depth: 3, bevelEnabled: false, curveSegments: 1 }); barG.translate(0, 0, -1.5);
  for (let i = 0; i < 6; i++) { const x = 6 + i * 3.4 + q(), z = 3.2 + (q() - .5) * .4, fall = i === 2 || i === 4; A(MAT.concrete, barG.clone().rotateZ(fall ? 1.45 : 0).rotateY(Math.PI / 2 + (q() - .5) * .2).translate(x, Y(x, z) + (fall ? .3 : 0), z)); }
  // spoil heaps from the force's bulldozer and rubble dumped at the edge of the town
  for (const [x, z, s] of [[60, -6, 1], [86, 28, 1.2], [-50, -25, .9], [-52, 36, .8], [84, -28, .7]]) { const g = new THREE.SphereGeometry(3 * s, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = .8 + q() * .35; p.setXYZ(i, p.getX(i) * k * 1.3, p.getY(i) * k * .45, p.getZ(i) * k); } g.computeVertexNormals(); A(x < 0 ? MAT.rubble : TM.dirt, g.translate(x, Y(x, z) - .2, z)); if (x < 0) for (let i = 0; i < 7; i++) A(MAT.concrete, box(.6 + q(), .25, .5 + q() * .8, 1).rotateY(q() * 3).rotateX((q() - .5) * .8).translate(x + (q() - .5) * 5, Y(x, z) + .5 + q() * .6, z + (q() - .5) * 4)); }
  // a few old tyres and a wooden cable drum in the field
  for (let i = 0; i < 9; i++) { const x = -20 + q() * 120, z = -30 + q() * 70; if (Math.abs(z - 9) < 5) continue; A(TM.tyre, new THREE.TorusGeometry(.32, .11, 5, 10).rotateX(Math.PI / 2 + (q() - .5) * .4).translate(x, Y(x, z) + .1, z)); }
  A(TM.wood, new THREE.CylinderGeometry(.75, .75, .8, 12).rotateX(Math.PI / 2).translate(48, Y(48, -4) + .75, -4));
}
// ---------- the neighbourhood ----------
function town() {
  const r = rng(404); const list = []; const B = TL.B;
  const clear = (x, z, R) => Math.hypot(x - B.x, z - B.z) < 60 || ['A', 'C', 'N1', 'N2', 'W', 'H', 'S'].some(k => Math.hypot(x - TL[k].x, z - TL[k].z) < R) ||
    (x > -262 && x < -192 && z > 96 && z < 150) || (x < -200 && Math.abs(z - 128) < 12) || Math.abs(z - 140) < 9 || Math.abs(z + 92) < 9;
  // ~230 lots: dense enough to read as a town from the force's rise and from the feed, beyond ~450 m the haze takes it
  for (let gx = -192; gx > -450; gx -= 24) for (let gz = -320; gz < 320; gz += 22) {
    const x = gx + (r() - .5) * 6, z = gz + (r() - .5) * 5; if (r() < .1) continue;
    const w = 10 + r() * 9, d = 9 + r() * 7; if (clear(x, z, 20)) continue;
    const near = x > -330 && Math.abs(z) < 240; const f = near ? 1 + Math.floor(r() * 4) : 2 + Math.floor(r() * 4);
    list.push([x, z, w, d, f, (r() - .5) * .12 + (r() < .25 ? Math.PI / 2 : 0)]);
  }
  // a few scattered houses on the edge itself, away from the routes
  for (const [x, z] of [[-80, -128], [-118, -122], [-92, 150], [-134, 156], [-60, 126], [-150, 118]]) list.push([x, z, 10 + r() * 4, 9 + r() * 3, 1 + Math.floor(r() * 3), (r() - .5) * .1]);
  townBlocks(list);
  // a mosque minaret on the skyline to the west
  add(MAT.plasterWhite, at(new THREE.CylinderGeometry(1.1, 1.3, 30, 10), -390, 15, -60)); add(MAT.plasterWhite, at(new THREE.CylinderGeometry(1.7, 1.7, .6, 10), -390, 24, -60)); add(TM.olive, at(new THREE.ConeGeometry(1.2, 4, 10), -390, 32, -60));
  add(MAT.concrete, at(box(18, 7, 18), -400, 3.5, -76)); add(MAT.plasterWhite, at(new THREE.SphereGeometry(6, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), -400, 7, -76));
}
// olive grove between the staging area and the town: the covered route runs along it
function grove() {
  const r = rng(77); const trunks = [], crowns = [];
  const card = (s) => { const g = new THREE.IcosahedronGeometry(s, 0); g.scale(1, .7, 1); g.rotateY(r() * 3); return g; };
  for (let x = -30; x < 62; x += 7.5) for (let z = -96; z < -40; z += 7) {
    if (r() < .12) continue; const px = x + (r() - .5) * 2, pz = z + (r() - .5) * 2, y = hT(px, pz), h = 2.6 + r() * 1.2;
    if (Math.hypot(px - 40, pz + 34) < 6 || Math.abs(pz + 66) < 3.5) continue;
    trunks.push(at(new THREE.CylinderGeometry(.12, .2, h * .55, 5), px, y + h * .27, pz));
    for (let k = 0; k < 2; k++) { const c = card(1.3 + r() * .6); c.rotateY(r() * 6.28); crowns.push(at(c, px + (r() - .5), y + h * (.6 + r() * .3), pz + (r() - .5))); }
  }
  add(TM.bark, mergeGeometries(trunks)); add(TM.leaf, mergeGeometries(crowns));
  // a cactus hedge (sabra) along the field edge
  const hedge = []; for (let z = -120; z < 120; z += 2.2) { if (Math.abs(z - 9) < 6 || Math.abs(z + 34) < 5) continue; hedge.push(at(new THREE.IcosahedronGeometry(.9 + r() * .4, 0).scale(1, 1.3, 1), -30 + (r() - .5), .9 + hT(-30, z), z)); }
  add(TM.olive, mergeGeometries(hedge));
}
// the open ground between the force and the town: scrub, stones, rubbish blown against the town's edge, a few
// furrow-side ridges of earth. Instanced (two meshes each), from their own RNG, never on the routes or the tracks.
function fieldClutter() {
  const r = rng(515); const o = new THREE.Object3D();
  const onRoute = (x, z) => Object.values(ROUTES).some(rt => rt.some((p, i) => { if (!i) return false; const [ax, az] = rt[i - 1], [bx, bz] = p; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1); return Math.hypot(x - ax - dx * t, z - az - dz * t) < 4; }));
  const blocked = (x, z) => onRoute(x, z) || Math.abs(x + 62) < 6 || Math.abs(z - 9) < 4 || Object.values(G.houses).some(h => Math.abs(x - h.o.x) < h.o.w / 2 + 3 && Math.abs(z - h.o.z) < h.o.d / 2 + 3) || Math.hypot(x - TL.cmd.x, z - TL.cmd.z) < 34 || Math.hypot(x - TL.stage.x - 6, z - TL.stage.z) < 16 || Math.hypot(x - TL.tank.x, z - TL.tank.z) < 9;
  const inst = (geo, mat, n, place) => { const im = new THREE.InstancedMesh(geo, mat, n); let k = 0; for (let i = 0; i < n * 3 && k < n; i++) { if (!place(o)) continue; o.updateMatrix(); im.setMatrixAt(k++, o.matrix); } im.count = k; im.castShadow = true; im.receiveShadow = true; G.scene.add(im); return im; };
  const spot = (x0, x1, z0, z1) => { for (let t = 0; t < 8; t++) { const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0); if (!blocked(x, z)) return [x, z]; } return null; };
  const bush = new THREE.IcosahedronGeometry(.7, 0); bush.scale(1, .6, 1);
  inst(bush, TM.scrub, 420, q => { const p = spot(-150, 260, -260, 260); if (!p) return false; const s = .5 + r() * 1.1; q.position.set(p[0], hT(p[0], p[1]) + .15 * s, p[1]); q.scale.set(s * (.8 + r() * .5), s * (.6 + r() * .6), s * (.8 + r() * .5)); q.rotation.set(0, r() * 6.28, 0); return true; });
  const stone = new THREE.DodecahedronGeometry(.22, 0);
  inst(stone, TM.stone, 500, q => { const p = spot(-160, 260, -260, 260); if (!p) return false; const s = .4 + r() * 1.4; q.position.set(p[0], hT(p[0], p[1]) + .04, p[1]); q.scale.set(s, s * (.4 + r() * .4), s * (.7 + r() * .5)); q.rotation.set(r(), r() * 6.28, r()); return true; });
  // rubbish at the edge of the town: sacks, crates and torn plastic in drifts along the first street
  const sack = new THREE.BoxGeometry(.5, .32, .38, 2, 1, 2); { const pp = sack.attributes.position; for (let i = 0; i < pp.count; i++) { const k = 1 - Math.abs(pp.getY(i)) * .8; pp.setX(i, pp.getX(i) * k); pp.setZ(i, pp.getZ(i) * k); } sack.computeVertexNormals(); }
  inst(sack, TM.trash, 220, q => { const p = spot(-175, -40, -200, 200); if (!p) return false; const s = .6 + r() * .8; q.position.set(p[0], .12 * s, p[1]); q.scale.setScalar(s); q.rotation.set((r() - .5) * .6, r() * 6.28, (r() - .5) * .6); return true; });
}
// the force: the command vehicle (the player stands at it), two APCs at the staging area, a tank in the field
function force() {
  G.vehicles = [];
  const cv = makeAPC(); cv.obj.position.set(TL.cmd.x + 3.6, hT(TL.cmd.x + 3.6, TL.cmd.z + 2), TL.cmd.z + 2); cv.obj.rotation.y = -Math.PI / 2 - .15; G.vehicles.push(cv); G.cmdVeh = cv;
  const a1 = makeAPC(); a1.obj.position.set(TL.stage.x + 6, hT(TL.stage.x + 6, TL.stage.z - 5), TL.stage.z - 5); a1.obj.rotation.y = -Math.PI / 2 + .1; G.vehicles.push(a1); G.apc = a1;
  const a2 = makeAPC(); a2.obj.position.set(TL.stage.x + 9, hT(TL.stage.x + 9, TL.stage.z + 6), TL.stage.z + 6); a2.obj.rotation.y = -Math.PI / 2 - .2; G.vehicles.push(a2);
  // the tank: the same heavy hull with a wedge turret and a long gun
  const tk = makeAPC(); const g = tk.obj; if (g.userData.rcws) g.userData.rcws.visible = false;
  const tur = new THREE.Group(); tur.position.set(0, 2.1, -.4); g.add(tur);
  const sh = new THREE.Shape(); sh.moveTo(-1.55, -1.9); sh.lineTo(1.55, -1.9); sh.lineTo(1.7, .6); sh.lineTo(.55, 2.3); sh.lineTo(-.55, 2.3); sh.lineTo(-1.7, .6); sh.closePath();
  const tg = new THREE.ExtrudeGeometry(sh, { depth: .75, bevelEnabled: false }); tg.rotateX(-Math.PI / 2); tur.add(new THREE.Mesh(tg, TM.olive));
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, 5.2, 8).rotateX(Math.PI / 2), TM.olive); gun.position.set(0, .45, 4.6); tur.add(gun);
  g.position.set(TL.tank.x, hT(TL.tank.x, TL.tank.z), TL.tank.z); g.rotation.y = -Math.PI / 2 - .3; tur.rotation.y = .3; G.vehicles.push(tk); G.tank = tk; G.tankTurret = tur;
  for (const v of G.vehicles) v.obj.traverse(c => { if (c.isMesh) { c.castShadow = true; } });
  // engines idle warm in thermal
  G.hotObjects = [cv.obj, a1.obj, a2.obj, g];
  // camo net and a folding table with radios beside the command vehicle
  { const tx = TL.cmd.x + 1.5, tz = TL.cmd.z + 7.5, ty = hT(tx, tz); add(TM.olive, at(box(1.6, .05, .8, 1), tx, ty + .8, tz)); add(MAT.metalDark, at(box(.4, .3, .3, 1), tx - .3, ty + .98, tz)); for (const [dx, dz] of [[-.7, -.3], [.7, -.3], [-.7, .3], [.7, .3]]) add(MAT.metalDark, at(box(.04, .8, .04, 1), tx + dx, ty + .4, tz + dz)); }
  flush();
}

// ---------- the shaft and the demolition ----------
// After the charges fire the ground floor drops into the dug-out chamber: B settles and tilts into a crater, and a
// column of dust and smoke climbs over the neighbourhood. The rubble mound is built now and shown then.
function rubbleMound() {
  const B = TL.B; const q = rng(909);
  const g = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = .75 + q() * .5; p.setXYZ(i, p.getX(i) * 11 * k, p.getY(i) * 3.6 * k, p.getZ(i) * 9.5 * k); } g.computeVertexNormals();
  const m = new THREE.Mesh(g, MAT.rubble); m.position.set(B.x, -.4, B.z); m.visible = false; m.receiveShadow = m.castShadow = true; G.scene.add(m);
  const chunks = []; for (let i = 0; i < 26; i++) chunks.push(at(box(.8 + q() * 2.4, .25 + q() * .5, .6 + q() * 1.6, 1).rotateX((q() - .5) * 1.2).rotateZ((q() - .5) * 1.2), B.x + (q() - .5) * 18, .3 + q() * 1.8, B.z + (q() - .5) * 15, q() * 6));
  const cm = new THREE.Mesh(mergeGeometries(chunks.map(strip)), MAT.concrete); cm.visible = false; cm.castShadow = true; G.scene.add(cm);
  const ring = new THREE.Mesh(new THREE.RingGeometry(9, 15, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3b3630', roughness: 1, transparent: true, opacity: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  ring.position.set(B.x, .05, B.z); ring.visible = false; G.scene.add(ring);
  G.rubble = [m, cm, ring];
}
export function collapseB(dt) {
  const c = G.collapse; if (!c) return; c.t += dt; const h = G.houses.B; const k = sstep(0, 2.2, c.t);
  h.group.position.y = -k * (h.H - 1.6); h.group.rotation.z = k * .09; h.group.rotation.x = -k * .05; h.group.scale.y = 1 - k * .25;
  if (c.t > .3) for (const m of G.rubble) m.visible = true;
  if (h.blobs) for (const b of h.blobs) b.visible = false;
  for (const m of G.irOnly) if (m.position.distanceTo(h.center) < 14) m.userData.gone = true;
}

// ---------- per frame ----------
const _v = new THREE.Vector3(), _p = new THREE.Vector3();
export function updateWorld(dt) {
  for (const v of G.vehicles || []) v.update(dt);
  { const b = G.houses && G.houses.B, c = G.viewCam || G.camera; if (b && c) { const near = Math.hypot(c.position.x - TL.B.x, c.position.z - TL.B.z) < 42 && !G.collapse; for (const m of b.group.userData.interior) m.visible = near; if (G.lampB) G.lampB.visible = true; } }
  // the generator's exhaust (while the dig is running)
  if (G.genPos && !G.genOff && Math.random() < dt * 3) G.fx.smoke.emit(_p.copy(G.genPos).add(_v.set(.8, 2.3, -.3)), _v.set(G.wind.x * .3, .6, G.wind.z * .3), 4, .2, 1.2, [.2, .2, .2, .35], [.4, .4, .4, 0], .3, .05);
  if (G.collapse) { collapseB(dt); const c = G.collapse; if (c.t < 16 && Math.random() < dt * 22) { const B = TL.B; G.fx.smoke.emit(_p.set(B.x + (Math.random() - .5) * 14, 1 + Math.random() * 4, B.z + (Math.random() - .5) * 12), _v.set(G.wind.x * .4 + (Math.random() - .5), 2.5 + Math.random() * 3.5, G.wind.z * .4 + (Math.random() - .5)), 14 + Math.random() * 8, 3, 10 + Math.random() * 8, [.52, .47, .4, .75], [.62, .58, .52, 0], .25, .03); } }
}
// thermal view: IR-only patches on, people and engines rendered hot (see main.js render)
export function setThermal(on) {
  for (const m of G.irOnly) m.visible = on && !m.userData.gone;
}

export function buildTunnelWorld() {
  G.irOnly = []; G.footprints = [];
  materials();
  buildGround();
  candidates();
  grove();
  force();
  rubbleMound();
  flush();
  fieldClutter();
  fieldDressing();
  town();
  flush();
  flushDeco();
  G.birds = makeBirds(V3(-150, 0, 0), 2, 8, 200);
}
