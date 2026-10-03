// The humanitarian corridor on the Salah al-Din road, central Gaza Strip, mid-November 2023, late morning.
// The road runs north-south along z (north = -z). Civilians walk south (+z). West (-x) is the coast and the sea haze.
// An IDF checkpoint stands across the road at z = 0; the incident commander's post is on an earth berm south-east of it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rng, clamp, sstep, fbm, V3 } from '../core.js';
import { MAT, canvasTex } from '../materials.js';
import { tex, A } from '../assets.js';
import { townBlocks, palmTrees, cableGeometry, makeBirds } from '../world.js';
import { makeAPC } from '../vehicles.js';

export const CL = {
  road: 10, shoulder: 15,
  // checkpoint: two lanes through concrete barriers, a vehicle lane to the east, the screening canopy at the lanes' exit
  laneA: -2.5, laneB: 2.5, gateZ: 0, funnelZ: -26, vehX: 7.5,
  // the commander's post: an earth berm east of the road, south of the checkpoint, looking up the road to the north
  cp: { x: 34, z: 26 }, bermH: 6.2,
  medTent: { x: 12, z: 34 }, pen: { x: -12, z: 9 }, spk: { x: 9, z: -12 },
  // the building the sniper fires from (west of the road) and the open rubble field behind it
  sniper: { x: -46, z: -132, w: 14, d: 12, floors: 5 }, rubbleField: { x: -150, z: -175 },
  hold: -95, spawnZ: -420, exitZ: 110,
  armour: { apcA: [-13, 18, 0], apcB: [16, -10, 0], tank: [27, -50, -Math.PI / 2] },
};

// ---------- height ----------
// flat where the camp and the road are (the buildings stand at y = 0), low dunes to the west toward the coast
export function hC(x, z) {
  let h = (fbm(x * .02 + 3.1, z * .02 + 7.7, 2) - .45) * .25 * sstep(14, 24, Math.abs(x));
  h = Math.max(h, 0);
  const dune = sstep(-260, -520, x); if (dune > 0) h += dune * (fbm(x * .006 + 9, z * .006, 3) * 9);
  return h;
}

const buckets = new Map();
function add(mat, geo, collide = false) { if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(geo); if (collide) G.colliders.push(geo); }
function flush(shadow = true) {
  for (const [mat, list] of buckets) {
    const geos = list.map(g => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; });
    const chunks = new Map();
    geos.forEach(g => { g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); const key = Math.floor(c.x / 140) + ',' + Math.floor(c.z / 140); if (!chunks.has(key)) chunks.set(key, []); chunks.get(key).push(g); });
    for (const arr of chunks.values()) { const mesh = new THREE.Mesh(mergeGeometries(arr), mat); mesh.castShadow = shadow && !mat.userData.noShadow; mesh.receiveShadow = true; G.scene.add(mesh); }
  }
  buckets.clear();
}
function box(w, h, d, m = 2) { // world-scaled UVs
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) { const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)); const a = nx > .5 ? d : w, b = ny > .5 ? d : h; uv.setXY(i, uv.getX(i) * a / m, uv.getY(i) * b / m); }
  return g;
}
const at = (g, x, y, z, ry = 0) => { if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
let _sb = null;
function sbag(q) { if (!_sb) { const g = new THREE.BoxGeometry(.58, .17, .34, 3, 1, 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) / .29, z = p.getZ(i) / .17, y = p.getY(i); const k = (1 - x * x * .35) * (1 - z * z * .45); p.setY(i, y * (.55 + .45 * k)); p.setX(i, p.getX(i) * (1 - Math.abs(y) * 1.2)); p.setZ(i, p.getZ(i) * (1 - Math.abs(y) * 1.4)); } g.computeVertexNormals(); _sb = g; } const g = _sb.clone(); g.scale(.94 + q() * .12, .9 + q() * .2, .95 + q() * .1); return g; }

// ---------- materials ----------
export const CM = {};
function materials() {
  const std = o => new THREE.MeshStandardMaterial(o);
  CM.concrete = std({ map: tex('wconc_c.jpg'), normalMap: tex('wconc_n.jpg', { srgb: false }), normalScale: new THREE.Vector2(.7, .7), roughness: .95, color: '#cfc8bb' });
  CM.block = std({ map: tex('pconc_c.jpg'), normalMap: tex('pconc_n.jpg', { srgb: false }), roughness: .95, color: '#c9c1b2' });
  CM.steel = std({ color: '#5d5f5c', roughness: .55, metalness: .6 });
  CM.steelDark = std({ color: '#2e302e', roughness: .5, metalness: .6 });
  CM.sandbag = std({ map: canvasTex(128, 128, (g, W, H) => { const q = rng(71); g.fillStyle = '#7c7458'; g.fillRect(0, 0, W, H); for (let i = 0; i < 1600; i++) { const v = q(); g.fillStyle = `rgba(${v < .5 ? 60 : 200},${v < .5 ? 55 : 190},${v < .5 ? 40 : 150},.12)`; g.fillRect(q() * W, q() * H, 2, 2); } g.strokeStyle = 'rgba(40,36,28,.35)'; for (let y = 0; y < H; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + q() * 2); g.stroke(); } }), roughness: 1, color: '#b8ae90' });
  // vehicle olive under a film of road dust (blotches, scuffs), world-scaled 1 m tile
  const dust = canvasTex(256, 256, (g, W, H) => { const q = rng(58); g.fillStyle = '#e4e2da'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) { const x = q() * W, y = q() * H, rad = 10 + q() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(205,182,136,${.25 + q() * .3})`); gr.addColorStop(1, 'rgba(205,182,136,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    for (let i = 0; i < 900; i++) { g.fillStyle = q() < .5 ? 'rgba(120,118,104,.22)' : 'rgba(255,248,230,.18)'; g.fillRect(q() * W, q() * H, 1 + q() * 2, 1); } });
  CM.olive = std({ map: dust, color: '#5d6343', roughness: .85 });
  CM.oliveDark = std({ map: dust, color: '#41462f', roughness: .85 });
  CM.black = std({ color: '#151514', roughness: .8 });
  CM.tire = std({ color: '#1a1a19', roughness: .92 });
  CM.glass = MAT.glassDark;
  // tent canvas bleached by the sun, mud splashed up the skirt, seams and patches (4 x 4 m of fabric per tile)
  const tentTex = canvasTex(256, 256, (g, W, H) => { const q = rng(6203); g.fillStyle = '#eeebe4'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) { const x = q() * W, y = q() * H * .8, w = 18 + q() * 40, h = 20 + q() * 50; g.fillStyle = q() < .5 ? 'rgba(255,252,244,.5)' : 'rgba(176,168,150,.35)'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(90,84,70,.4)'; g.strokeRect(x, y, w, h); }
    for (let x = 6; x < W; x += 77) { g.fillStyle = 'rgba(120,112,96,.55)'; g.fillRect(x, 0, 2, H); }
    const mud = g.createLinearGradient(0, H, 0, H - 40); mud.addColorStop(0, 'rgba(122,100,70,.85)'); mud.addColorStop(1, 'rgba(150,130,96,0)'); g.fillStyle = mud; g.fillRect(0, H - 40, W, 40);
    for (let i = 0; i < 1000; i++) { const v = q() < .5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},.05)`; g.fillRect(q() * W, q() * H, 2, 2); } });
  CM.canvasW = std({ map: tentTex, color: '#d8d1c1', roughness: .9, side: THREE.DoubleSide });
  CM.canvasB = std({ map: tentTex, color: '#5a7388', roughness: .85, side: THREE.DoubleSide });
  CM.canvasG = std({ map: tentTex, color: '#7f8161', roughness: .9, side: THREE.DoubleSide });
  // the medical tent: white canvas with the red star of David of the IDF medical corps on the roof and sides
  CM.medic = std({ map: canvasTex(256, 256, (g, W, H) => { g.fillStyle = '#ece9e1'; g.fillRect(0, 0, W, H); g.strokeStyle = '#b8262a'; g.lineWidth = 16; for (const r of [0, Math.PI]) { g.beginPath(); for (let i = 0; i < 3; i++) { const a = r + i * Math.PI * 2 / 3 - Math.PI / 2; g[i ? 'lineTo' : 'moveTo'](W / 2 + Math.cos(a) * 62, H / 2 + Math.sin(a) * 62); } g.closePath(); g.stroke(); } const q = rng(4); for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(120,105,80,${q() * .06})`; g.fillRect(q() * W, q() * H, 3, 3); } }, { repeat: false }), roughness: .9, side: THREE.DoubleSide });
  CM.camo = std({ map: canvasTex(256, 256, (g, W, H) => { const q = rng(9); g.clearRect(0, 0, W, H); const cols = ['#5b5f3f', '#6d6a48', '#4a4d33', '#7e7556', '#3f4230']; for (let i = 0; i < 900; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); const x = q() * W, y = q() * H, r = 3 + q() * 7; g.ellipse(x, y, r, r * .6, q() * 3, 0, 7); g.fill(); } }), alphaTest: .4, roughness: 1, side: THREE.DoubleSide });
  CM.dirt = std({ map: tex('dirt2_c.jpg'), color: '#d8c3a0', roughness: 1, side: THREE.DoubleSide });
  CM.burnt = std({ color: '#2a2724', roughness: 1, metalness: .1 });
  CM.rust = MAT.rust; CM.wood = MAT.wood;
  CM.cloth = [std({ color: '#7d3a34', roughness: 1 }), std({ color: '#3d4f6a', roughness: 1 }), std({ color: '#8a7a55', roughness: 1 }), std({ color: '#5b5048', roughness: 1 })];
  CM.white = std({ color: '#efeee8', roughness: .9, side: THREE.DoubleSide });
  CM.donkey = MAT.donkey || std({ color: '#7a6e62', roughness: .95 });
  return CM;
}

// ---------- ground ----------
// one shader for the whole floor: asphalt of the four-lane road (tarmac photo, cracked, patched, shell-scarred and half
// buried under drifted sand at the edges), sand shoulders, grey rubble dust along the building lines, the ruts of tracked
// vehicles on the east verge, and dunes toward the sea
function groundMaterial() {
  const uni = { tSand: { value: tex('sand_c.jpg') }, tDirt: { value: tex('dirt2_c.jpg') }, tTar: { value: tex('tarmac.jpg') }, tNrm: { value: tex('gravel_n.jpg', { srgb: false }) }, uGQ: { get value() { return G.quality ?? 2; } } };
  const m = new THREE.MeshStandardMaterial({ roughness: 1, color: '#ffffff' });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWp; uniform sampler2D tSand, tDirt, tTar, tNrm; uniform float uGQ;
float cH2(vec2 p) { vec3 p3 = fract(vec3(mod(p, 289.).xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(cH2(i), cH2(i + vec2(1., 0.)), f.x), mix(cH2(i + vec2(0., 1.)), cH2(i + vec2(1., 1.)), f.x), f.y); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uGQ > .5) { vec3 na = texture2D(tNrm, vWp.xz * .24).xyz * 2. - 1.; vec3 gw = inverseTransformDirection(normal, viewMatrix); gw.xz += na.xy * vec2(1., -1.) * .35 * (1. - cRoad * .7); normal = normalize((viewMatrix * vec4(normalize(gw), 0.)).xyz); }`)
      .replace('#include <map_fragment>', `
      vec3 sand = (texture2D(tSand, vWp.xz * .19).rgb * .55 + texture2D(tSand, vWp.xz * .027).rgb * .45) * vec3(1.08, 1., .88);
      vec3 dirt = (texture2D(tDirt, vWp.xz * .23).rgb * .55 + texture2D(tDirt, vWp.xz * .035).rgb * .45) * vec3(.98, .92, .82);
      vec3 tar = texture2D(tTar, vWp.xz * .14).rgb * .6 + texture2D(tTar, vWp.xz * .031 + .4).rgb * .4;
      float ax = abs(vWp.x), n1 = cN(vWp.xz * .08), n2 = cN(vWp.xz * .7 + 5.);
      // the road edge is ragged: sand drifted over it, the shoulder broken off
      float edge = ${CL.road.toFixed(1)} - .6 + (n1 - .5) * 2.6 + (n2 - .5) * .5;
      float cRoad = 1. - smoothstep(edge - .4, edge + .3, ax);
      vec3 col = mix(dirt, sand, smoothstep(.35, .65, cN(vWp.xz * .03 + 2.)));
      // grey concrete dust and rubble grit spreading from the building lines
      float bl = smoothstep(14., 20., ax) * (1. - smoothstep(55., 90., ax)) * smoothstep(.3, .7, cN(vWp.xz * .05 + 9.));
      col = mix(col, vec3(.58, .56, .52) * (.8 + .4 * n2), bl * .55);
      // asphalt: worn, patched, cracked; sand drifts in from the edges and settles in the lane between the wheel paths
      vec3 road = tar * vec3(1.02, 1., .97) * (.85 + .3 * n1);
      road *= 1. - .25 * smoothstep(.62, .7, cN(vWp.xz * vec2(.6, .11) + 1.7)) * (1. - smoothstep(.7, .8, cN(vWp.xz * vec2(.6, .11) + 1.7)));
      road = mix(road, tar * .62, smoothstep(.72, .76, cN(vWp.xz * .09 + 13.)));
      float drift = smoothstep(.72, .98, ax / edge) * .8 + smoothstep(.62, .85, cN(vWp.xz * .15 + 4.)) * .3;
      road = mix(road, sand * vec3(.95, .93, .9), clamp(drift, 0., .8));
      // faded centre line and lane marks, dashed and mostly gone
      float lm = (1. - smoothstep(.06, .1, abs(ax - 4.9))) * step(.5, fract(vWp.z / 9.)) + (1. - smoothstep(.06, .11, ax)) * .8;
      road = mix(road, vec3(.78, .76, .7), lm * .45 * smoothstep(.45, .6, n2) * (1. - drift));
      // shell and track scars: dark rings of churned asphalt
      float cr = cN(vWp.xz * .045 + 21.); road *= 1. - .35 * smoothstep(.78, .82, cr) * (1. - smoothstep(.84, .9, cr));
      col = mix(col, road, cRoad);
      // tracked vehicles drove along the east verge: two parallel ruts
      { float tx = vWp.x - 12.6 - sin(vWp.z * .02) * .6, d = abs(abs(tx) - 1.6); col *= 1. - .18 * exp(-d * d * 18.) * (1. - cRoad) * step(-200., vWp.z); }
      col = mix(col, vec3(dot(col, vec3(.3, .59, .11))) * vec3(1.02, 1., .95), smoothstep(250., 1300., distance(vWp, cameraPosition)) * .35);
      diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'corridorGround';
  return m;
}
function buildGround() {
  const mat = CM.ground = groundMaterial();
  const X0 = -420, X1 = 300, Z0 = -720, Z1 = 600, S = 6;
  const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, Math.round((X1 - X0) / S), Math.round((Z1 - Z0) / S)); geo.rotateX(-Math.PI / 2); geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hC(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; G.scene.add(m); geo.userData.noOcclude = true; G.colliders.push(geo);
  const fg = new THREE.PlaneGeometry(5200, 5200, 90, 90); fg.rotateX(-Math.PI / 2); fg.translate(-600, 0, 0);
  const fp = fg.attributes.position; for (let i = 0; i < fp.count; i++) fp.setY(i, hC(fp.getX(i), fp.getZ(i)) - .1);
  fg.computeVertexNormals(); const far = new THREE.Mesh(fg, mat); far.receiveShadow = true; G.scene.add(far);
  // the sea: a grey-blue sheet past the dunes, mostly lost in the haze; it is what makes the western horizon glow
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2).translate(-7400, -.3, 0), new THREE.MeshStandardMaterial({ color: '#6f8794', roughness: .25, metalness: .1 })); G.scene.add(sea);
}

// ---------- instanced copies of a loaded model (barriers, barrels) ----------
function instModel(key, list, { tint = null, collide = null } = {}) {
  const m = A.models[key]; if (!m || !list.length) return null; const root = m.scene; root.updateMatrixWorld(true);
  const T = new THREE.Matrix4(), q = new THREE.Quaternion(), out = [];
  root.traverse(c => { if (!c.isMesh) return; let mat = c.material; if (tint) { mat = mat.clone(); mat.color.multiply(new THREE.Color(tint)); mat.roughness = Math.max(.7, mat.roughness); }
    const im = new THREE.InstancedMesh(c.geometry, mat, list.length); im.castShadow = im.receiveShadow = true;
    list.forEach(([x, y, z, ry, s = 1], i) => { T.compose(V3(x, y, z), q.setFromAxisAngle(V3(0, 1, 0), ry), V3(s, s, s)).multiply(c.matrixWorld); im.setMatrixAt(i, T); });
    G.scene.add(im); out.push(im); });
  if (collide) for (const [x, y, z, ry] of list) G.colliders.push(at(new THREE.BoxGeometry(...collide), x, y + collide[1] / 2, z, ry));
  return out;
}
// the jersey model's own long axis, so rows can be laid along any line
let JL = null;
function jerseyInfo() { if (JL) return JL; const m = A.models.jersey; if (!m) return JL = { len: 3.8, ax: 0 }; const bb = new THREE.Box3().setFromObject(m.scene), s = bb.getSize(V3()); JL = s.x > s.z ? { len: s.x, ax: 0, w: s.z, h: s.y } : { len: s.z, ax: 1, w: s.x, h: s.y }; return JL; }
function jerseyRow(x0, z0, x1, z1, out, gap = .06) {
  const J = jerseyInfo(), L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / (J.len + gap))); const yaw = Math.atan2(x1 - x0, z1 - z0);
  // the model's long axis along x needs a quarter turn to lie along the row (whose direction is +z at yaw 0)
  const ry = J.ax === 0 ? yaw - Math.PI / 2 : yaw;
  for (let i = 0; i < n; i++) { const t = (i + .5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; out.push([x, hC(x, z), z, ry + (((i * 7919) % 13) / 13 - .5) * .04]); }
}

// ---------- the checkpoint ----------
function checkpoint() {
  const q = rng(1101), rows = [];
  const fz = CL.funnelZ;
  // lane walls: west edge, divider, east edge, then the funnel flaring out to the road edges
  jerseyRow(-4.4, fz, -4.4, 5, rows); jerseyRow(0, fz, 0, 5, rows); jerseyRow(4.4, fz, 4.4, 5, rows);
  jerseyRow(-4.4, fz - .3, -10.5, fz - 22, rows); jerseyRow(4.4, fz - .3, 10.5, fz - 22, rows);
  // the vehicle lane east of the people lanes, and a chicane of blocks in it so nothing drives through fast
  jerseyRow(10.6, -14, 10.6, 8, rows); jerseyRow(4.6, -6, 7.2, -6, rows); jerseyRow(8, 0, 10.4, 0, rows);
  // west side is closed off to the building line
  jerseyRow(-4.6, 5.5, -11, 5.5, rows); jerseyRow(-10.5, fz - 22.5, -16, fz - 30, rows); jerseyRow(10.6, -14.3, 16, fz - 30, rows);
  const J = jerseyInfo(); instModel('jersey', rows, { collide: null });
  for (const [x, y, z, ry] of rows) G.colliders.push(at(new THREE.BoxGeometry(J.ax === 0 ? J.len : (J.w || .6), .9, J.ax === 0 ? (J.w || .6) : J.len), x, y + .45, z, ry));
  // lane B is closed by a barrier across its mouth; opening the lane slides it onto the divider side (see openLaneB)
  const gate = new THREE.Group(); const gm = A.models.jersey ? A.models.jersey.scene.clone(true) : new THREE.Mesh(box(3.6, .9, .6), CM.concrete); gm.rotation.y = J.ax === 0 ? 0 : Math.PI / 2; gm.position.y = A.models.jersey ? 0 : .45; gate.add(gm);
  gate.traverse(c => { if (c.isMesh) c.castShadow = c.receiveShadow = true; }); gate.position.set(CL.laneB, 0, fz - .5); G.scene.add(gate); G.laneGate = gate;
  // screening canopy over the lanes' exit: scaffold poles and a sun-bleached tarp, tables, a turnstile frame
  const cz = 7;
  for (const x of [-4.6, 0, 4.6]) for (const z of [cz - 3, cz + 3]) add(CM.steel, at(new THREE.CylinderGeometry(.05, .05, 3.2, 6), x, 1.6, z));
  { const tarp = new THREE.PlaneGeometry(10.4, 7.2, 10, 6); tarp.rotateX(-Math.PI / 2); const p = tarp.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, -Math.abs(Math.sin(p.getX(i) * .6)) * .18 - (q() * .05)); tarp.computeVertexNormals(); add(CM.canvasG, at(tarp, 0, 3.25, cz)); }
  for (const [x, z] of [[-2.5, cz + 1.6], [2.5, cz + 1.6]]) { add(CM.olive, at(box(1.8, .06, .8, 1), x + 1.2, .78, z)); for (const dx of [-.8, .8]) add(CM.steelDark, at(new THREE.CylinderGeometry(.02, .02, .78, 4), x + 1.2 + dx, .39, z)); }
  // the detention / secondary screening pen on the west: sandbag walls, a bench, a tarp
  const { x: px, z: pz } = CL.pen;
  for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) { add(CM.sandbag, at(sbag(q), px - 3.2, .09 + k * .17, pz - 3 + i * .52 + (k % 2) * .26, Math.PI / 2)); add(CM.sandbag, at(sbag(q), px - 3 + i * .52 + (k % 2) * .26, .09 + k * .17, pz + 3.2, 0)); }
  G.colliders.push(at(new THREE.BoxGeometry(.5, .6, 6.4), px - 3.2, .3, pz), at(new THREE.BoxGeometry(6.4, .6, .5), px, .3, pz + 3.2));
  add(CM.wood, at(box(2.4, .08, .4, 1), px - 2.4, .45, pz)); for (const dz of [-1, 1]) add(CM.wood, at(box(.08, .45, .35, 1), px - 2.4, .22, pz + dz));
  for (const [x, z] of [[px - 3, pz - 3], [px + 3, pz - 3], [px - 3, pz + 3], [px + 3, pz + 3]]) add(CM.steel, at(new THREE.CylinderGeometry(.04, .04, 2.6, 5), x, 1.3, z));
  add(CM.canvasB, at(new THREE.PlaneGeometry(6.4, 6.4).rotateX(-Math.PI / 2 + .05), px, 2.65, pz));
  // a sandbagged machine-gun post at the north-west corner of the funnel, facing up the road
  const mx = -9, mz = -8;
  for (let a = -1.2; a <= 1.25; a += .26) for (let k = 0; k < 4; k++) add(CM.sandbag, at(sbag(q), mx + Math.sin(a + k * .13) * 1.7, .09 + k * .17, mz - Math.cos(a + k * .13) * 1.7, -a));
  G.colliders.push(at(new THREE.BoxGeometry(3.2, .7, 1.2), mx, .35, mz - 1.3));
  // the medical tent (army ridge tent with the red star of David) and a stretcher stand
  medicalTent(CL.medTent.x, CL.medTent.z);
  // shade for people waiting past the checkpoint: tarps on poles over the road edge, water jerricans on pallets
  for (const [x, z, m] of [[-13, 26, CM.canvasW], [14, 52, CM.canvasB], [-13, 44, CM.canvasG]]) { for (const [dx, dz] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2]]) add(CM.wood, at(new THREE.CylinderGeometry(.05, .06, 2.4, 5), x + dx, 1.2, z + dz)); const t = new THREE.PlaneGeometry(6, 5, 6, 5); t.rotateX(-Math.PI / 2); const p = t.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, -Math.pow(Math.abs(p.getX(i)) / 3, 2) * -.15 - Math.sin(p.getX(i) * 1.1 + p.getZ(i)) * .06); t.computeVertexNormals(); add(m, at(t, x, 2.35, z));
    for (let i = 0; i < 8; i++) add(i % 3 ? CM.cloth[1] : CM.white, at(box(.25, .38, .17, 1), x - 1.4 + (i % 4) * .3, .19 + .02, z + 1.2 + Math.floor(i / 4) * .25)); }
  G.gateFront = [V3(CL.laneA, 0, fz + .8), V3(CL.laneB, 0, fz + .8)];
}
function medicalTent(x, z) {
  const L = 7, W = 5, h = 2.6;
  const g = new THREE.BufferGeometry(); const P = [[-W / 2, 0, -L / 2], [-W / 2, 1.7, -L / 2], [0, h, -L / 2], [W / 2, 1.7, -L / 2], [W / 2, 0, -L / 2], [-W / 2, 0, L / 2], [-W / 2, 1.7, L / 2], [0, h, L / 2], [W / 2, 1.7, L / 2], [W / 2, 0, L / 2]];
  const idx = [0, 1, 6, 0, 6, 5, 1, 2, 7, 1, 7, 6, 2, 3, 8, 2, 8, 7, 3, 4, 9, 3, 9, 8, 0, 2, 1, 4, 3, 2, 0, 4, 2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3)); g.setIndex(idx);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(P.map(([a, b, c]) => [(c / L + .5), (b + Math.abs(a)) / 4]).flat(), 2)); g.computeVertexNormals();
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); add(CM.medic, at(ng, x, 0, z), true);
  for (const dz of [-1.2, 1.2]) { add(CM.olive, at(box(1.9, .08, .6, 1), x + 1.4, .55, z + dz)); add(CM.steelDark, at(box(1.9, .5, .04, 1), x + 1.4, .3, z + dz)); }
  G.medPos = V3(x - 3.2, 0, z);
}

// ---------- vehicles ----------
export function humvee(x, z, ry, collide = true) {
  const g = new THREE.Group(), parts = new Map(); const put = (m, geo) => { if (!parts.has(m)) parts.set(m, []); parts.get(m).push(geo); };
  const b = (w, h, d, m, px, py, pz) => put(m, box(w, h, d, 1).translate(px, py, pz));
  b(2.18, .7, 4.7, CM.olive, 0, .95, 0); b(2.0, .75, 2.4, CM.olive, 0, 1.65, -.3); b(1.9, .06, 1.9, CM.oliveDark, 0, 1.3, 1.45);
  put(CM.glass, new THREE.PlaneGeometry(1.8, .55).rotateX(-.15).translate(0, 1.72, .92));
  const wg = new THREE.CylinderGeometry(.46, .46, .38, 12); wg.rotateZ(Math.PI / 2);
  for (const [sx, sz] of [[-1, 1.55], [1, 1.55], [-1, -1.6], [1, -1.6]]) put(CM.tire, wg.clone().translate(sx * .98, .46, sz));
  put(CM.black, new THREE.CylinderGeometry(.01, .015, 3, 4).rotateZ(.08).translate(.8, 3.6, -1.2));
  for (const [m, list] of parts) { const me = new THREE.Mesh(mergeGeometries(list), m); me.castShadow = m !== CM.glass; me.receiveShadow = true; g.add(me); }
  g.position.set(x, hC(x, z), z); g.rotation.y = ry; G.scene.add(g);
  if (collide) G.colliders.push(at(new THREE.BoxGeometry(2.2, 2, 4.8), x, hC(x, z) + 1, z, ry));
  return g;
}
// Merkava Mk4: the Namer hull (vehicles.js) with a wedge turret, a 120 mm gun with its thermal sleeve and the bustle chains
export function makeMerkava() {
  const v = makeAPC(); const g = v.obj; G.scene.remove(g);
  if (g.userData.rcws) g.userData.rcws.visible = false;
  const hullMat = g.children.find(c => c.isMesh && c.material && c.material.map)?.material || CM.olive;
  const tur = new THREE.Group(); tur.position.set(0, 2.1, -.7); g.add(tur); g.userData.turret = tur;
  const sh = new THREE.Shape(); sh.moveTo(-1.55, -1.9); sh.lineTo(1.55, -1.9); sh.lineTo(1.7, .6); sh.lineTo(.55, 2.3); sh.lineTo(-.55, 2.3); sh.lineTo(-1.7, .6); sh.closePath();
  const tg = new THREE.ExtrudeGeometry(sh, { depth: .78, bevelEnabled: true, bevelSize: .06, bevelThickness: .06, bevelSegments: 1 }); tg.rotateX(-Math.PI / 2); tg.translate(0, .06, 0);
  const tm = new THREE.Mesh(tg, hullMat); tur.add(tm);
  const gun = new THREE.Group(); gun.position.set(0, .45, 2.1); tur.add(gun); g.userData.gun = gun;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.085, .1, 5.2, 10), CM.oliveDark); barrel.rotation.x = Math.PI / 2; barrel.position.z = 2.6; gun.add(barrel);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, 2.4, 10), CM.olive); sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 1.6; gun.add(sleeve);
  { const ch = []; for (let i = 0; i < 26; i++) ch.push(new THREE.CylinderGeometry(.018, .018, .55, 4).translate(-1.5 + i * .12, -.25, -1.95)); tur.add(new THREE.Mesh(mergeGeometries(ch), CM.steelDark)); }
  g.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return g;
}
function armour() {
  G.armour = {};
  for (const [id, [x, z, ry]] of Object.entries(CL.armour)) {
    let o; if (id === 'tank') { o = makeMerkava(); G.scene.add(o); } else { o = makeAPC().obj; }
    o.position.set(x, hC(x, z), z); o.rotation.y = ry; o.userData.home = V3(x, 0, z); o.userData.homeRy = ry; G.armour[id] = o; (G.hotObjects || (G.hotObjects = [])).push(o);
  }
  // the loudspeaker Humvee by the checkpoint: two horn speakers on a mast facing up the road
  const sp = humvee(CL.spk.x, CL.spk.z, 0); const horn = new THREE.CylinderGeometry(.34, .09, .7, 10, 1, true); horn.rotateX(-Math.PI / 2);
  const hm = new THREE.MeshStandardMaterial({ color: '#d8d6cc', roughness: .6, side: THREE.DoubleSide });
  for (const dx of [-.36, .36]) { const h = new THREE.Mesh(horn, hm); h.position.set(dx, 3.05, -1.2); h.rotation.y = dx * .5; h.castShadow = true; sp.add(h); }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.1, 6), CM.steelDark); mast.position.set(0, 2.5, -.9); sp.add(mast);
  G.spkPos = V3(CL.spk.x, hC(CL.spk.x, CL.spk.z) + 3.05, CL.spk.z - 1.2);
  humvee(9, 66, Math.PI * .9); humvee(-16, 30, Math.PI * 1.05);
}

// ---------- the commander's berm ----------
function commandPost() {
  const { x, z } = CL.cp; const y = CL.bermH; const q = rng(3101);
  // an earth berm pushed up by a D9: a flat-topped mound, its faces scored by the blade
  const R0 = 19, R1 = 6.5; const g = new THREE.CylinderGeometry(R1, R0, y, 28, 4); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const px = p.getX(i), pz = p.getZ(i), py = p.getY(i); const a = Math.atan2(pz, px), k = 1 + (Math.sin(a * 3 + 1) * .08 + Math.sin(a * 7) * .04) * (py < y / 2 - .01 ? 1 : 0); p.setX(i, px * k * 1.25); p.setZ(i, pz * k); }
  g.translate(x, y / 2 - .02, z); g.computeVertexNormals(); { const u = []; for (let i = 0; i < p.count; i++) u.push(p.getX(i) / 3, (p.getZ(i) + p.getY(i)) / 3); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); }
  add(CM.dirt, g); G.colliders.push(g.clone());
  // sandbag parapet along the north-west lip (low enough to look over)
  for (let a = -2.75; a <= -.55; a += .085) for (let k = 0; k < 3; k++) add(CM.sandbag, at(sbag(q), x + Math.cos(a) * 7.6, y + .09 + k * .17, z + Math.sin(a) * 6.1, -a + Math.PI / 2));
  // camouflage net over the planning table, radio mast
  const cx = x + 2.5, cz = z + 1.5;
  const net = new THREE.Mesh(new THREE.PlaneGeometry(7, 6, 14, 12), CM.camo); net.rotation.x = -Math.PI / 2; { const np = net.geometry.attributes.position; for (let i = 0; i < np.count; i++) { const lx = np.getX(i), ly = np.getY(i); np.setZ(i, -.1 * (lx * lx + ly * ly) / 9 + (q() - .5) * .05); } net.geometry.computeVertexNormals(); }
  net.position.set(cx, y + 2.7, cz); net.castShadow = true; net.receiveShadow = true; G.scene.add(net);
  for (const [dx, dz] of [[-3, -2.6], [3, -2.6], [-3, 2.6], [3, 2.6]]) add(CM.oliveDark, at(new THREE.CylinderGeometry(.04, .05, 2.7, 6), cx + dx, y + 1.35, cz + dz));
  add(CM.olive, at(box(2.2, .06, 1.1, 1), cx, y + .9, cz), true); for (const [dx, dz] of [[-1, -.5], [1, -.5], [-1, .5], [1, .5]]) add(CM.steelDark, at(new THREE.CylinderGeometry(.02, .02, .9, 5), cx + dx, y + .45, cz + dz));
  for (let i = 0; i < 3; i++) add(CM.oliveDark, at(box(.32, .22, .28, 1), cx + .6 - i * .4, y + 1.04, cz + .3));
  add(CM.steelDark, at(new THREE.CylinderGeometry(.03, .05, 9, 6), x + 5, y + 4.5, z + 4));
  for (let i = 0; i < 4; i++) add(CM.olive, at(box(.18, .45, .35, 1), x + 4.5, y + .22, z - 3 + i * .22));
  G.cpTable = V3(cx, y + .95, cz);
}

// ---------- buildings along the road ----------
// Low and mid-rise concrete blocks on both sides of the road, many hit: blown-out corners, shell holes, collapsed lots
// (the collapsed-house model) and rubble spilling toward the road. Lots are placed from their own RNG.
function buildings() {
  const r = rng(2311), list = [], ruins = [], piles = [];
  const S = CL.sniper;
  for (const side of [-1, 1]) {
    let z = -560;
    while (z < 470) {
      const w = 9 + r() * 9, d = 9 + r() * 8, gap = 2 + r() * 6;
      const cz = z + d / 2; z += d + gap;
      if (side < 0 && Math.abs(cz - S.z) < S.d / 2 + 8) continue;
      // keep the checkpoint, the command berm and the pen clear
      if (Math.abs(cz) < 60 && (side > 0 || cz > -20)) continue;
      if (side > 0 && cz > -70 && cz < 70) continue;
      // the side street on the east where a big group joins the road (see the scenario's surge)
      if (side > 0 && cz > -152 && cz < -92) continue;
      const cx = side * (22 + w / 2 + r() * 6);
      if (r() < .2) { ruins.push([cx, cz, w, d]); continue; }
      if (r() < .18) { pancake(cx, cz, w, d, r); piles.push([cx - side * (w / 2 + 2), cz, 1.4 + r()]); continue; }
      const f = 2 + Math.floor(r() * 3) + (r() < .15 ? 2 : 0);
      list.push([cx, cz, w, d, f, (r() - .5) * .12 + (side < 0 ? Math.PI : 0), { damage: r() < .7 }]);
      if (r() < .5) piles.push([cx - side * (w / 2 + 2.5 + r() * 2), cz + (r() - .5) * d, .9 + r() * 1.1]);
      // a second row behind
      if (r() < .75) { const w2 = 10 + r() * 10, d2 = 10 + r() * 8; list.push([side * (60 + r() * 30), cz + (r() - .5) * 6, w2, d2, 2 + Math.floor(r() * 4), (r() - .5) * .3, { damage: r() < .5 }]); }
    }
  }
  // the sniper's building: five floors, west of the road, shell-holed, families sheltering in the ground floor
  list.push([S.x, S.z, S.w, S.d, S.floors, Math.PI / 2, { damage: true }]);
  // farther town toward the coast and to the east, thinning out
  for (let i = 0; i < 70; i++) { const side = r() < .55 ? -1 : 1, cx = side * (110 + r() * 300), cz = (r() - .5) * 1300; list.push([cx, cz, 10 + r() * 12, 10 + r() * 10, 2 + Math.floor(r() * 5), r() * .6, { damage: r() < .4 }]); }
  townBlocks(list);
  // windows of the sniper's floor read dark; the firing point is a window on the east face, fourth floor
  const fy = 3.4 + 3 * 3 + 1.3; G.sniperWin = V3(S.x + S.d / 2 + .1, fy, S.z - 1.5);
  ruinsAt(ruins);
  for (const [x, z, s] of piles) rubblePile(x, z, s, r);
  for (let i = 0; i < 14; i++) rubblePile(CL.rubbleField.x + (r() - .5) * 70, CL.rubbleField.z + (r() - .5) * 60, 1 + r() * 1.6, r);
}
// a building brought down on itself: floor slabs stacked at angles, a stub of wall and a column still standing
function pancake(cx, cz, w, d, r) {
  const n = 2 + Math.floor(r() * 3); let y = .15;
  for (let i = 0; i < n; i++) { const g = box(w * (.85 + r() * .2), .28, d * (.85 + r() * .2), 2); g.rotateX((r() - .5) * .25); g.rotateZ((r() - .5) * .3); g.rotateY((r() - .5) * .2); g.translate(cx + (r() - .5) * 1.5, y + .14, cz + (r() - .5) * 1.5); add(MAT.concrete, g, i === 0); y += .5 + r() * .6; }
  const wh = 3 + r() * 4; add(MAT.block, at(box(w * (.3 + r() * .3), wh, .25, 2), cx + (r() - .5) * w * .4, wh / 2, cz + d / 2 - .2), true);
  add(MAT.concrete, at(box(.35, y + 2 + r() * 3, .35, 1), cx - w / 2 + .4, (y + 2) / 2, cz - d / 2 + .4));
  G.colliders.push(at(new THREE.BoxGeometry(w * .9, y, d * .9), cx, y / 2, cz));
}
function ruinsAt(lots) {
  const m = A.models.ruin; if (!m) return;
  for (const [cx, cz, w, d] of lots) { const o = m.scene.clone(); o.position.set(cx, 0, cz); o.rotation.y = ((cx * 13 + cz * 7) % 6); o.scale.setScalar(Math.min(w / 10.8, d / 8.6) * 1.1); o.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } }); G.scene.add(o);
    G.colliders.push(at(new THREE.BoxGeometry(w * .8, 2.2, d * .8), cx, 1.1, cz)); }
}
// a heap of broken concrete: a low mound and chunks, all merged into the rubble batch
function rubblePile(x, z, s, r) {
  const rad = 1.6 * s, hgt = .6 * s;
  const mh = (dx, dz) => { const q = Math.hypot(dx, dz) / rad; return q >= 1 ? 0 : hgt * (1 - q * q) * (.8 + .2 * Math.sin(dx * 3.1 + dz * 2.3)); };
  const mound = new THREE.CircleGeometry(rad * 1.08, 14); mound.rotateX(-Math.PI / 2); { const p = mound.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, mh(p.getX(i), p.getZ(i))); }
  mound.computeVertexNormals(); mound.translate(x, hC(x, z) + .01, z); add(MAT.rubble, mound);
  const n = Math.round(10 * s + 4);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad * .95, dx = Math.cos(a) * d, dz = Math.sin(a) * d, sz = (.1 + Math.pow(r(), 2.4) * .6) * s;
    const g = r() < .7 ? new THREE.DodecahedronGeometry(sz, 0) : box(sz * 2.4, sz * .5, sz * 1.5, 1); g.rotateX(r() * 3); g.rotateY(r() * 3); g.translate(x + dx, hC(x, z) + mh(dx, dz) + sz * .3, z + dz); add(r() < .15 ? MAT.block : MAT.rubble, g); }
  // a bent rebar or two sticking out
  for (let i = 0; i < 2; i++) { const a = r() * 6.28; add(CM.rust, at(new THREE.CylinderGeometry(.012, .012, 1.4 * s, 3).rotateZ(.6 + r() * .6).rotateY(a), x + Math.cos(a) * rad * .3, hC(x, z) + hgt * .7, z + Math.sin(a) * rad * .3)); }
}

// ---------- set dressing ----------
function dressing() {
  const r = rng(5511);
  // burnt-out and abandoned cars pushed to the road edges
  const cars = ['suv', 'hatch', 'pickup'].filter(k => A.models[k]);
  for (let i = 0; i < 12 && cars.length; i++) { const side = r() < .5 ? -1 : 1, z = -440 + i * 72 + (r() - .5) * 20; if (Math.abs(z) < 70) continue; const src = A.models[cars[Math.floor(r() * cars.length)]]; const o = src.scene.clone(true); const bb = new THREE.Box3().setFromObject(o); const s = bb.getSize(V3()); if (s.x > s.z) o.rotation.y = Math.PI / 2; o.updateMatrixWorld(true); const b2 = new THREE.Box3().setFromObject(o); o.scale.multiplyScalar(4.4 / b2.getSize(V3()).z);
    const burnt = r() < .55, x = side * (11.5 + r() * 3); o.position.set(x, hC(x, z), z); o.rotation.y += (r() - .5) * .8 + (side < 0 ? Math.PI : 0); o.traverse(c => { if (c.isMesh) { c.castShadow = true; if (burnt) c.material = CM.burnt; else { c.material = c.material.clone(); c.material.color.multiply(new THREE.Color(['#d8d4c8', '#8a8680', '#b9b0a0'][i % 3])); } } }); G.scene.add(o);
    G.colliders.push(at(new THREE.BoxGeometry(1.9, 1.4, 4.4), x, .7, z, o.rotation.y)); }
  // leaning power poles with sagging cables along the west verge
  const poles = [], cab = [];
  for (let z = -520; z < 420; z += 38 + r() * 8) { const x = -16.5 + (r() - .5); const lean = (r() - .5) * .25, top = V3(x + Math.sin(lean) * 8.5, 8.5, z); poles.push(at(new THREE.CylinderGeometry(.11, .16, 9, 6).rotateZ(-lean), x + Math.sin(lean) * 4.2, 4.5, z)); poles.push(at(box(1.4, .1, .1, 1), top.x, 8.2, z)); const prev = poles._last; if (prev && r() < .75) for (const o of [-.6, .6]) { for (let i = 0; i < 10; i++) { const a = i / 10, b = (i + 1) / 10, pt = t => V3(prev.x + (top.x - prev.x) * t + o, 8.2 - Math.sin(t * Math.PI) * 1.6 - .1, prev.z + (top.z - prev.z) * t); cab.push(pt(a), pt(b)); } } poles._last = top; }
  for (const g of poles) add(CM.concrete, g);
  if (cab.length) add(CM.black, cableGeometry(cab, .012));
  // palms, some decapitated
  const pl = []; for (let i = 0; i < 26; i++) { const side = r() < .5 ? -1 : 1, z = -480 + r() * 880; if (Math.abs(z) < 50) continue; pl.push([side * (17 + r() * 4), z, 6 + r() * 6]); }
  palmTrees(pl, { r });
  // instanced litter: plastic bags, bottles, clothes dropped along the way
  const geo = new THREE.BoxGeometry(.3, .08, .22), list = [];
  for (let i = 0; i < 260; i++) { const x = (r() - .5) * 2 * (r() < .7 ? 12 : 20), z = -460 + r() * 860; list.push([x, z, r() * 6.28, .5 + r() * 1.2]); }
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .9 }), list.length); const o = new THREE.Object3D(), c = new THREE.Color();
  const cols = ['#e8e4d8', '#3a6ea8', '#b04636', '#2f2f2f', '#c9b36a', '#5d6b45', '#9a8f80'];
  list.forEach(([x, z, ry, s], i) => { o.position.set(x, hC(x, z) + .04 * s, z); o.rotation.set((r() - .5) * .3, ry, (r() - .5) * .3); o.scale.set(s, s * (.4 + r() * .8), s); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(cols[i % cols.length])); });
  im.receiveShadow = true; G.scene.add(im);
  // broken concrete, blocks and scraps of rebar spilled along both verges and the building lines: one instanced batch
  { const chip = new THREE.DodecahedronGeometry(.5, 0), list = [];
    for (let i = 0; i < 900; i++) { const side = r() < .5 ? -1 : 1, x = side * (9.5 + Math.pow(r(), 1.6) * 16), z = -470 + r() * 560; if (Math.abs(z) < 40 && side > 0) continue; list.push([x, z, .08 + Math.pow(r(), 3) * .5]); }
    const im = new THREE.InstancedMesh(chip, new THREE.MeshStandardMaterial({ map: MAT.rubble.map, normalMap: MAT.rubble.normalMap, roughness: 1, color: '#d6cdbd' }), list.length); const o = new THREE.Object3D();
    list.forEach(([x, z, sz], i) => { o.position.set(x, hC(x, z) + sz * .25, z); o.rotation.set(r() * 3, r() * 3, r() * 3); o.scale.set(sz * (.8 + r() * .8), sz * (.4 + r() * .4), sz * (.8 + r() * .6)); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.castShadow = true; im.receiveShadow = true; G.scene.add(im); }
  // a smoke column far to the north, over the city: the war goes on outside the corridor
  G.columns = [V3(-380, 0, -1500), V3(520, 0, -1900)];
}

// ---------- moving props the scenario drives ----------
// a hand cart (two wheels, plank bed, a load of bundles) pushed by a crowd agent
export function makeCart(q, donkey = false) {
  const g = new THREE.Group(), parts = new Map(); const put = (m, geo) => { if (!parts.has(m)) parts.set(m, []); parts.get(m).push(geo); };
  const L = donkey ? 2.1 : 1.5, W = donkey ? 1.3 : 1.0;
  put(CM.wood, box(W, .08, L, 1).translate(0, .62, 0)); put(CM.wood, box(.06, .25, L, 1).translate(-W / 2, .76, 0)); put(CM.wood, box(.06, .25, L, 1).translate(W / 2, .76, 0));
  const wg = new THREE.CylinderGeometry(.34, .34, .07, 12); wg.rotateZ(Math.PI / 2); put(CM.tire, wg.clone().translate(-W / 2 - .06, .34, 0)); put(CM.tire, wg.clone().translate(W / 2 + .06, .34, 0));
  for (const s of [-1, 1]) put(CM.wood, box(.05, .05, 1.4, 1).translate(s * (W / 2 - .1), .62, (donkey ? -1 : 1) * (L / 2 + .6)));
  // the load: mattresses, bundles in blankets, a water jerrican
  for (let i = 0; i < 4 + Math.floor(q() * 3); i++) put(CM.cloth[Math.floor(q() * 4)], box(.4 + q() * .4, .22 + q() * .2, .4 + q() * .5, 1).translate((q() - .5) * W * .6, .82 + i * .07, (q() - .5) * L * .6));
  put(CM.white, box(.25, .38, .17, 1).translate(W * .3, .85, L * .35));
  if (donkey) { // the donkey: barrel body, neck, long head, ears, four legs, all low poly
    const d = CM.donkey; const z0 = -L / 2 - 1.15;
    put(d, new THREE.CylinderGeometry(.27, .25, 1.0, 8).rotateX(Math.PI / 2).translate(0, 1.0, z0));
    put(d, new THREE.CylinderGeometry(.12, .17, .6, 6).rotateX(-.75).translate(0, 1.32, z0 - .58));
    put(d, new THREE.CylinderGeometry(.08, .13, .5, 6).rotateX(-1.25).translate(0, 1.5, z0 - .9));
    for (const s of [-1, 1]) put(d, new THREE.ConeGeometry(.04, .24, 4).translate(s * .07, 1.78, z0 - .76));
    for (const [sx, sz] of [[-.15, -.38], [.15, -.38], [-.15, .38], [.15, .38]]) put(d, new THREE.CylinderGeometry(.045, .04, .78, 5).translate(sx, .42, z0 + sz));
    put(CM.black, box(.04, .04, .9, 1).translate(0, 1.1, z0 + .55));
  }
  for (const [m, list] of parts) { const me = new THREE.Mesh(mergeGeometries(list), m); me.castShadow = true; me.receiveShadow = true; g.add(me); }
  G.scene.add(g); return g;
}
// a white rag tied to a stick on a civilian car: the sign drivers in the corridor used
export function whiteFlag() { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.4, 4), CM.wood); p.position.y = .7; g.add(p); const f = new THREE.Mesh(new THREE.PlaneGeometry(.6, .4, 5, 1), CM.white); f.position.set(.31, 1.2, 0); g.add(f); (G.flags || (G.flags = [])).push(f); return g; }
export function civCar(key, tint) {
  const src = A.models[key]; if (!src) return null; const o = src.scene.clone(true); const bb = new THREE.Box3().setFromObject(o); const s = bb.getSize(V3());
  const inner = new THREE.Group(); inner.add(o); if (s.x > s.z) o.rotation.y = Math.PI / 2; o.updateMatrixWorld(true); const b2 = new THREE.Box3().setFromObject(o); o.scale.multiplyScalar(4.3 / b2.getSize(V3()).z);
  o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.material = c.material.clone(); c.material.color.multiply(new THREE.Color(tint)); } });
  const f = whiteFlag(); f.position.set(.7, 1.3, .6); inner.add(f); G.scene.add(inner); return inner;
}

// ---------- per frame ----------
export function updateWorld(dt) {
  const t = G.time;
  for (const f of G.flags || []) { const p = f.geometry.attributes.position; if (!f.userData.base) f.userData.base = p.array.slice(); const b = f.userData.base; for (let i = 0; i < p.count; i++) { const x = b[i * 3]; const u = (x + .3) / .6; p.setZ(i, Math.sin(x * 9 - t * 7) * .06 * u); } p.needsUpdate = true; }
  // far smoke columns over the city: a few big slow puffs, only where the eye can catch them
  G._colT = (G._colT || 0) - dt;
  if (G._colT <= 0 && G.fx) { G._colT = .5; for (const c of G.columns || []) G.fx.smoke.emit(V3(c.x + (Math.random() - .5) * 8, 4, c.z + (Math.random() - .5) * 8), V3(G.wind.x * .4, 3.2, G.wind.z * .4), 60, 6, 70, [.12, .115, .11, .55], [.5, .48, .46, 0], .005, .02); }
}

export function buildCorridorWorld() {
  G.soundEmitters = []; G.footprints = []; G.flags = [];
  materials();
  buildGround();
  checkpoint();
  commandPost();
  buildings();
  dressing();
  flush();
  armour();
  G.birds = makeBirds(V3(0, 0, -150), 2, 8, 200);
}
