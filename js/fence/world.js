// Gaza border, northern sector (east of Gaza City), 21 August 2021, late afternoon.
// West (-X) is Gaza, east (+X) is Israel. North is -Z. The barrier runs along x = 0:
// a concrete T-wall with firing slits at the friction point (|z| < 72), the 6 m steel fence beyond it, concertina wire on the Gaza side.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rng, rr, ri, pick, R, clamp, sstep, fbm, V3 } from '../core.js';
import { MAT, canvasTex } from '../materials.js';
import { tex, A } from '../assets.js';
import { townBlocks, palmTrees, cableGeometry, makeBirds } from '../world.js';
import { makeAPC } from '../vehicles.js';

export const FL = {
  wallZ: 72, slits: [-54, -36, -18, 0, 18, 36, 54], slitY: 1.37,
  wire: -6.2, road: 7.5, bermX: 25, bermZ: 150, bermH: 6.2,
  // the incident commander's post sits on a pad on top of the berm, 20 m behind the wall, so the crowd can be seen over it
  cp: { x: 21.2, z: 6 }, spk: { x: 5, z: 24 }, tanks: [[56, -206], [56, 212]],
  fires: [[-58, -38], [-74, 20], [-96, 54], [-112, -12], [-140, -66], [-86, 88]],
  tents: [-252, -192], tentZ: 125, stage: { x: -184, z: 6 },
  posts: [{ x: -390, z: -236, name: 'עמדת חמאס צפונית' }, { x: -372, z: 262, name: 'עמדת חמאס דרומית' }],
  depot: { x: -1180, z: -40 }, iedZ: -106, balloon: { x: -176, z: 118 },
};

// ---------- height ----------
export function hF(x, z) {
  let h = 0;
  // the land rises gently west toward the Shuja'iyya ridge (so the crowd can be seen over the wall from the berm), then falls to the town
  h += (4.2 * sstep(-10, -320, x) + 2.4 * sstep(-320, -760, x)) * sstep(-1180, -960, x);
  const gz = sstep(-26, -80, x) * sstep(900, 820, -x) * sstep(720, 650, Math.abs(z));
  if (gz > 0) h += ((fbm(x * .0085 + 3.1, z * .0085 + 7.7, 3) - .45) * 3.0 + (fbm(x * .045 + 9, z * .045, 2) - .45) * .55) * gz;
  const iz = sstep(62, 120, x) * sstep(320, 280, x) * sstep(720, 650, Math.abs(z));
  if (iz > 0) h += (fbm(x * .008 + 11, z * .008 + 2, 2) - .45) * 1.6 * iz;
  return h;
}

const buckets = new Map();
function add(mat, geo, collide = false) { if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(geo); if (collide) G.colliders.push(geo); }
function flush(shadow = true) {
  for (const [mat, list] of buckets) {
    const geos = list.map(g => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; });
    const chunks = new Map();
    geos.forEach(g => { g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); const key = Math.floor(c.x / 120) + ',' + Math.floor(c.z / 120); if (!chunks.has(key)) chunks.set(key, []); chunks.get(key).push(g); });
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
// a filled sandbag: a flattened, slightly bulging pillow (not a capsule)
let _sb = null;
// the same bag scaled from a caller's own RNG, for set dressing that must not draw from the global R
function sbag(q) { if (!_sb) sandbag(); const g = _sb.clone(); g.scale(.94 + q() * .12, .9 + q() * .2, .95 + q() * .1); return g; }
function sandbag() { if (!_sb) { const g = new THREE.BoxGeometry(.58, .17, .34, 4, 1, 3); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) / .29, z = p.getZ(i) / .17, y = p.getY(i); const k = (1 - x * x * .35) * (1 - z * z * .45); p.setY(i, y * (.55 + .45 * k)); p.setX(i, p.getX(i) * (1 - Math.abs(y) * 1.2)); p.setZ(i, p.getZ(i) * (1 - Math.abs(y) * 1.4)); } g.computeVertexNormals(); _sb = g; } const g = _sb.clone(); g.scale(rr(.94, 1.06), rr(.9, 1.1), rr(.95, 1.05)); return g; }

// ---------- materials ----------
const FM = {};
function materials() {
  const std = o => new THREE.MeshStandardMaterial(o);
  FM.concrete = std({ map: tex('wconc_c.jpg'), normalMap: tex('wconc_n.jpg', { srgb: false }), normalScale: new THREE.Vector2(.8, .8), roughness: .95, color: '#d2cbbf' });
  FM.concreteDark = std({ map: tex('wconc_c.jpg'), normalMap: tex('wconc_n.jpg', { srgb: false }), roughness: .95, color: '#a59e92' });
  FM.steel = std({ color: '#5d5f5c', roughness: .55, metalness: .7 });
  FM.steelDark = std({ color: '#2e302e', roughness: .5, metalness: .7 });
  FM.rust = MAT.rust;
  FM.sandbag = std({ map: canvasTex(128, 128, (g, W, H) => { g.fillStyle = '#7c7458'; g.fillRect(0, 0, W, H); for (let i = 0; i < 1600; i++) { const v = Math.random(); g.fillStyle = `rgba(${v < .5 ? 60 : 200},${v < .5 ? 55 : 190},${v < .5 ? 40 : 150},.12)`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); } g.strokeStyle = 'rgba(40,36,28,.35)'; for (let y = 0; y < H; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + Math.random() * 2); g.stroke(); } }), roughness: 1, color: '#b8ae90' });
  // vehicle olive: never clean on the border road, a film of fine dust settles in blotches and the paint is scuffed
  // (world-scaled UVs, 1 m tile, mean near white so the material colour still sets the tone)
  const dust = canvasTex(256, 256, (g, W, H) => { const q = rng(58); g.fillStyle = '#e4e2da'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { const x = q() * W, y = q() * H, rad = 10 + q() * 40, c0 = `rgba(${200 + q() * 30 | 0},${176 + q() * 20 | 0},${130 + q() * 20 | 0},${.25 + q() * .3})`;
      for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); gr.addColorStop(0, c0); gr.addColorStop(1, 'rgba(200,176,130,0)'); g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2); } }
    for (let i = 0; i < 900; i++) { const v = q(); g.fillStyle = v < .5 ? 'rgba(120,118,104,.22)' : 'rgba(255,248,230,.18)'; g.fillRect(q() * W, q() * H, 1 + q() * 2, 1); }
    g.strokeStyle = 'rgba(90,88,78,.25)'; g.lineWidth = 1; for (let i = 0; i < 40; i++) { const x = q() * W, y = q() * H, a = q() * 6.28, l = 6 + q() * 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } });
  FM.olive = std({ map: dust, color: '#5d6343', roughness: .85 });
  FM.oliveDark = std({ map: dust, color: '#41462f', roughness: .85 });
  FM.black = std({ color: '#141414', roughness: .8 });
  FM.tire = std({ color: '#191918', roughness: .92 });
  FM.tireBurnt = std({ color: '#0d0d0c', roughness: 1 });
  // tent canvas and tarps bleached by a summer of sun: off-white and a greyed blue, not fresh colours
  // The texture covers 4 x 4 m of fabric (UVs in metres / 4, v = height): stitched panel seams, a band of dust and mud
  // splashed up the bottom half-metre, darker drip lines below the ridge and eaves, sun-faded and patched panels.
  const tentTex = canvasTex(256, 256, (g, W, H) => { const q = rng(6203); g.fillStyle = '#eeebe4'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) { const x = q() * W, y = q() * H * .8, w = 18 + q() * 40, h = 20 + q() * 50; g.fillStyle = q() < .5 ? 'rgba(255,252,244,.5)' : 'rgba(176,168,150,.35)'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(90,84,70,.4)'; g.strokeRect(x, y, w, h); }
    for (let x = 6; x < W; x += 77) { g.fillStyle = 'rgba(120,112,96,.55)'; g.fillRect(x, 0, 2, H); g.fillStyle = 'rgba(255,255,250,.5)'; g.fillRect(x + 3, 0, 1, H); }
    for (let i = 0; i < 70; i++) { const x = q() * W, y = q() * H * .5, l = 20 + q() * 90, gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(110,98,78,.3)'); gr.addColorStop(1, 'rgba(110,98,78,0)'); g.fillStyle = gr; g.fillRect(x, y, 1 + q() * 3, l); }
    const mud = g.createLinearGradient(0, H, 0, H - 40); mud.addColorStop(0, 'rgba(122,100,70,.85)'); mud.addColorStop(.5, 'rgba(140,118,86,.45)'); mud.addColorStop(1, 'rgba(150,130,96,0)'); g.fillStyle = mud; g.fillRect(0, H - 40, W, 40);
    for (let i = 0; i < 260; i++) { const x = q() * W, y = H - Math.pow(q(), 2) * 46; g.fillStyle = `rgba(${100 + q() * 30 | 0},${84 + q() * 20 | 0},${60 + q() * 15 | 0},${.2 + q() * .4})`; g.beginPath(); g.ellipse(x, y, 1 + q() * 3, 1 + q() * 2, 0, 0, 7); g.fill(); }
    for (let i = 0; i < 1200; i++) { const v = q() < .5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},.05)`; g.fillRect(q() * W, q() * H, 2, 2); } });
  FM.canvasW = std({ map: tentTex, color: '#d8d1c1', roughness: .9, side: THREE.DoubleSide });
  FM.canvasB = std({ map: tentTex, color: '#506c84', roughness: .85, side: THREE.DoubleSide });
  FM.canvasG = std({ map: tentTex, color: '#7f8161', roughness: .9, side: THREE.DoubleSide });
  FM.wood = MAT.wood;
  FM.stone = std({ color: '#9b907c', roughness: .95 });
  FM.bush = std({ color: '#6f6a45', roughness: 1 });
  FM.scrub = std({ map: canvasTex(256, 192, (g, W, H) => { g.clearRect(0, 0, W, H); const r = rng(33);
      for (let i = 0; i < 60; i++) { const x0 = W / 2 + (r() - .5) * 60, a = -Math.PI / 2 + (r() - .5) * 2.2, L = 40 + r() * 110; g.strokeStyle = `rgb(${90 + r() * 40 | 0},${76 + r() * 30 | 0},${52 + r() * 20 | 0})`; g.lineWidth = 1 + r() * 1.5; g.beginPath(); g.moveTo(x0, H); g.lineTo(x0 + Math.cos(a) * L, H + Math.sin(a) * L); g.stroke(); }
      for (let i = 0; i < 900; i++) { const a = -Math.PI / 2 + (r() - .5) * 2.4, d = r() * 150, x = W / 2 + Math.cos(a) * d * .8, y = H + Math.sin(a) * d * .95; if (y < 4) continue;
        g.fillStyle = [ '#7d7a4e', '#8c8559', '#6a6a43', '#9a8d62', '#5f623d'][Math.floor(r() * 5)]; g.beginPath(); g.ellipse(x, y, 2 + r() * 3, 1 + r() * 1.5, r() * 3, 0, 7); g.fill(); } }, { repeat: false }),
    alphaTest: .4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 1, color: '#e0dcc8' });
  FM.trash = [std({ color: '#d9d4c8', roughness: .8 }), std({ color: '#3a6ea8', roughness: .6 }), std({ color: '#b04636', roughness: .7 }), std({ color: '#2f2f2f', roughness: .8 }), std({ color: '#c9b36a', roughness: .8 })];
  FM.redRoof = std({ color: '#a4533b', roughness: .8 });
  FM.houseW = std({ color: '#e6e0d2', roughness: .9 });
  // a eucalyptus leaf cluster: narrow grey-green sickle leaves, denser and darker toward the middle, cut out with alpha
  FM.leaf = std({ map: canvasTex(256, 256, (g, W, H) => { g.clearRect(0, 0, W, H); const r = rng(52);
    for (let i = 0; i < 1500; i++) { const a = r() * 6.28, d = Math.pow(r(), .7) * 118, x = W / 2 + Math.cos(a) * d * .95, y = H / 2 + Math.sin(a) * d; const inner = 1 - d / 120;
      const c = [[86, 98, 68], [104, 114, 82], [70, 80, 56], [122, 128, 96]][Math.floor(r() * 4)].map(v => v * (.7 + inner * .25 + r() * .15) | 0);
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.save(); g.translate(x, y); g.rotate(r() * 6.28); g.beginPath(); g.ellipse(0, 0, 7 + r() * 5, 1.6 + r() * 1.2, 0, 0, 7); g.fill(); g.restore(); } }, { repeat: false }),
    alphaTest: .4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .9, color: '#c9ccb4' });
  FM.bark = std({ color: '#b3a792', roughness: 1 });
  FM.glassDark = MAT.glassDark;
  FM.mesh = new THREE.MeshStandardMaterial({ map: canvasTex(64, 256, (g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = '#6f716c'; for (let x = 2; x < W; x += 16) g.fillRect(x, 0, 5, H); g.fillRect(0, 0, W, 6); g.fillRect(0, H * .5, W, 4); }), transparent: false, alphaTest: .5, roughness: .6, metalness: .6, side: THREE.DoubleSide });
  FM.mesh.map.colorSpace = THREE.SRGBColorSpace;
  // concertina: coiled razor wire read as loops on a cylinder
  // Galvanised razor wire left out for a few summers goes a dull, mottled zinc grey with brown rust where the coating has
  // gone; it glints only in specks, never as a polished chrome tube (metalness .8 / roughness .4 lit the whole coil white
  // against the low sun). The tone varies loop to loop so the coil has no uniform sheen.
  const ct = canvasTex(256, 128, (g, W, H) => { g.clearRect(0, 0, W, H); const q = rng(66); g.lineWidth = 2;
    for (let x = -20; x < W + 20; x += 11) { const v = 104 + q() * 40 | 0, ru = q() < .3; g.strokeStyle = ru ? `rgb(${v * .9 | 0},${v * .62 | 0},${v * .42 | 0})` : `rgb(${v},${v + 2},${v - 4})`; g.beginPath(); g.ellipse(x, H / 2, 8, H * .47, .12, 0, Math.PI * 2); g.stroke(); } });
  FM.concertina = new THREE.MeshStandardMaterial({ map: ct, alphaTest: .35, roughness: .66, metalness: .45, color: '#c4c4bc', side: THREE.DoubleSide });
  FM.concertina.userData.noShadow = false;
  // camouflage net
  const cn = canvasTex(256, 256, (g, W, H) => { g.clearRect(0, 0, W, H); const cols = ['#5b5f3f', '#6d6a48', '#4a4d33', '#7e7556', '#3f4230']; for (let i = 0; i < 900; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); const x = Math.random() * W, y = Math.random() * H, r = 3 + Math.random() * 7; g.ellipse(x, y, r, r * .6, Math.random() * 3, 0, 7); g.fill(); } });
  FM.camo = new THREE.MeshStandardMaterial({ map: cn, alphaTest: .4, roughness: 1, side: THREE.DoubleSide });
  // graffiti on the Gaza face of the wall
  FM.graffiti = new THREE.MeshStandardMaterial({ map: graffitiTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: .95 });
  // the barrier's own concrete: the albedo is built in the shader per precast section (see wallShader), so the colour stays white
  FM.wall = std({ map: tex('wconc_c.jpg'), normalMap: tex('wconc_n.jpg', { srgb: false }), normalScale: new THREE.Vector2(.8, .8), roughness: .93, color: '#ffffff' });
  wallShader(FM.wall);
  // slit frames and shutters: olive-grey paint worn through to bare steel where the barrel and the hands touch, rust
  // blooming from the scratches and running down (painted steel, so mostly dielectric; the bare patches are what glints)
  const wornSteel = canvasTex(128, 128, (g, W, H) => { const q = rng(61); g.fillStyle = '#56584d'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) { const v = 70 + q() * 30 | 0; g.fillStyle = `rgba(${v},${v + 2},${v - 8},.25)`; g.fillRect(q() * W, q() * H, 2 + q() * 5, 1 + q() * 2); }
    for (let i = 0; i < 26; i++) { const x = q() * W, y = q() * H, gr = g.createLinearGradient(x, y, x, y + 18 + q() * 50); gr.addColorStop(0, 'rgba(118,58,22,.6)'); gr.addColorStop(1, 'rgba(118,58,22,0)'); g.fillStyle = gr; g.fillRect(x - 1, y, 1.5 + q() * 2.5, 70); }
    for (let i = 0; i < 70; i++) { const b = q() < .55; g.fillStyle = b ? 'rgba(128,124,112,.8)' : 'rgba(92,46,20,.7)'; g.beginPath(); g.ellipse(q() * W, q() * H, 1 + q() * 5, .8 + q() * 2.5, q() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(140,136,124,.7)'; g.lineWidth = 3; g.strokeRect(1, 1, W - 2, H - 2); });
  FM.frame = std({ map: wornSteel, roughness: .68, metalness: .3 });
  // litter at the friction line: cans and bottles take their colour per instance
  FM.can = std({ color: '#ffffff', roughness: .55, metalness: .25 });
  // 7.62/5.56 ammunition cans at the sniper positions: olive paint scuffed at the edges, a yellow stencil band
  FM.ammo = std({ map: canvasTex(64, 64, (g, W, H) => { const q = rng(64); g.fillStyle = '#4c5236'; g.fillRect(0, 0, W, H); for (let i = 0; i < 160; i++) { g.fillStyle = q() < .5 ? 'rgba(30,32,22,.3)' : 'rgba(120,118,98,.3)'; g.fillRect(q() * W, q() * H, 1 + q() * 3, 1); } g.fillStyle = 'rgba(196,170,70,.85)'; g.fillRect(8, 24, 48, 3); g.fillRect(8, 32, 30, 3); g.strokeStyle = 'rgba(128,124,108,.8)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2); }), roughness: .75, metalness: .2 });
  return FM;
}
// section numbers the engineers stencil on each precast piece (plain digits in a 10-cell atlas, sampled per section in the shader)
function digitTex() {
  return canvasTex(1280, 128, (g, W, H) => { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = '700 116px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 10; i++) g.fillText(String(i), i * 128 + 64, H / 2 + 6);
    g.fillStyle = '#000'; for (let i = 0; i < 10; i++) if ([0, 4, 6, 8, 9].includes(i)) { g.fillRect(i * 128 + 61, 0, 6, 34); g.fillRect(i * 128 + 61, 96, 6, 32); } }, { srgb: false, repeat: false });
}
// The T-wall is a row of 1.5 m precast sections, each cast and trucked in on its own: every section gets its own tone and
// patch of the concrete photo, a chamfered joint to its neighbours, knocked arrises, grey runoff from the top, rust
// bleeding from the lifting loop and from rebar stubs, drift sand at the foot and a stencilled number on the Israeli face.
// The photo's own large blotches and bands are divided out (a blurred mip of the same patch), so only its pores remain
// and the large-scale variation comes from the section, which is what reads from the berm.
// Tyres are also burnt right against the Gaza face: a few sections carry a soot plume from the foot, widening as it rises
// (own RNG, clear of the slits; the melted crusts at their feet are added in debris())
const SOOT = (() => { const q = rng(4411), out = []; while (out.length < 8) { const z = (q() - .5) * (FL.wallZ * 2 - 6); if (FL.slits.every(s => Math.abs(z - s) > 2.5) && out.every(o => Math.abs(o - z) > 6)) out.push(z); } return out; })();
function wallShader(m) {
  const U = { tDig: { value: digitTex() }, uWQ: { get value() { return G.quality ?? 2; } }, uSoot: { value: SOOT } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWw; varying vec3 vNw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWw = (modelMatrix * vec4(transformed, 1.0)).xyz; vNw = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWw; varying vec3 vNw; uniform sampler2D tDig; uniform float uWQ; uniform float uSoot[8];
float wH(float n) { return fract(sin(mod(n, 289.) * 91.345) * 47453.53); }
float wH2(vec2 p) { vec3 p3 = fract(vec3(mod(p, 289.).xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(wH2(i), wH2(i + vec2(1., 0.)), f.x), mix(wH2(i + vec2(0., 1.)), wH2(i + vec2(1., 1.)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
float wz = (vWw.z + ${FL.wallZ.toFixed(1)}) / 1.5, wid = floor(wz), wu = fract(wz), wy = vWw.y;
float wr1 = wH(wid + .31), wr2 = wH(wid * 1.73 + 4.1), wr3 = wH(wid * 2.37 + 9.7), wr4 = wH(wid * 3.11 + 2.2);
float wSide = step(.5, abs(vNw.x)), wEnd = step(.5, abs(vNw.z));
vec2 wOff = vec2(wr1 * 5.3, wr2 * 3.7);
vec3 wt = textureGrad(map, vMapUv + wOff, dFdx(vMapUv), dFdy(vMapUv)).rgb, wb = textureLod(map, vMapUv + wOff, 5.5).rgb;
float wd = clamp(dot(wt, vec3(.333)) / max(dot(wb, vec3(.333)), .01), .55, 1.5);
vec3 wc = vec3(.3, .285, .255) * mix(1., wd, .55);
wc *= (.84 + .3 * wr3) * mix(vec3(1.05, 1., .92), vec3(.96, .99, 1.03), wr4) * (wr2 > .9 ? 1.1 : 1.);
wc *= .9 + .2 * wN(vec2(vWw.z * 1.1, wy * .8) + wid * 3.3);
wc *= 1. - .06 * (1. - smoothstep(.0, .035, abs(wy - 1.1 - wr1 * 1.7)));
float wst = wN(vec2(vWw.z * 6.5, wy * .22 + wid)) * wN(vec2(vWw.z * 19., wy * .45));
wc *= 1. - .32 * smoothstep(.18, .5, wst) * smoothstep(.6, 3.4, wy);
float we = min(wu, 1. - wu) * 1.5, wfw = fwidth(wz) * 1.5 + 1e-4;
float wj = (1. - smoothstep(0., .022 + wfw, we)) * (1. - wEnd) * .022 / (.022 + wfw);
float wtop = (1. - smoothstep(0., .02 + fwidth(wy), 3.6 - wy)) * wSide;
float wChip = 0.;
if (uWQ > .5) {
  float cn = wN(vec2(wy * 6., wid * 5.1 + step(.5, wu) * 13.)), ct = wN(vec2(vWw.z * 5., 7.));
  wChip = max(1. - smoothstep(0., .006 + wfw, we - .065 * smoothstep(.56, .85, cn)), wSide * (1. - smoothstep(0., .006 + fwidth(wy), 3.6 - wy - .05 * smoothstep(.6, .85, ct)))) * (1. - wEnd);
  wc = mix(wc, vec3(.33, .31, .27) * (.7 + .6 * wN(vWw.zy * 90.)), wChip);
  float wlx = (wu - .5 - (wr1 - .5) * .03) * 1.5 + (wN(vec2(wy * 2.3, wid)) - .5) * .04, wdy = 3.6 - wy, wlen = .4 + 2.4 * wr2 * wr2, wrw = .016 + wdy * .018;
  float wrs = (1. - smoothstep(wrw * .35, wrw, abs(wlx))) * (1. - smoothstep(wlen * .15, wlen, wdy)) * (.45 + .55 * wN(vec2(vWw.z * 70., wy * 3.)));
  wc = mix(wc, vec3(.3, .12, .045) * (.7 + .5 * wN(vWw.zy * 30.)), wrs * .8 * step(.3, wr4) * wSide);
  for (int k = 0; k < 2; k++) { float fk = float(k), hk = wH(wid * 5.3 + fk * 17.1); if (hk < .45) continue;
    vec2 fp = vec2(.12 + .76 * wH(wid * 7.1 + fk * 3.3), .6 + 2.6 * wH(wid * 2.9 + fk * 5.7)); float dx = abs(wu - fp.x) * 1.5 + (wN(vec2(wy * 3., fk + wid)) - .5) * .02, dy = fp.y - wy, w = .01 + max(dy, 0.) * .015, l = .25 + 1.3 * (hk - .45);
    float s = (1. - smoothstep(w * .3, w, dx)) * step(0., dy) * (1. - smoothstep(0., l, dy)) + (1. - smoothstep(.006, .014, length(vec2(abs(wu - fp.x) * 1.5, dy)))) * 1.5;
    wc = mix(wc, vec3(.25, .1, .035), clamp(s, 0., 1.) * .7 * wSide); }
}
wc *= (1. - wj * .5) * (1. - wtop * .22);
if (vWw.x < -.1) { float so = 0.; for (int k = 0; k < 8; k++) { float dz = vWw.z - uSoot[k], sw = .25 + wy * .32 + .1 * wN(vec2(wy * 3., float(k)));
  so = max(so, exp(-dz * dz / (sw * sw)) * (1. - smoothstep(.3, 2.6 + .9 * wH(float(k) + 3.), wy + (wN(vec2(vWw.z * 2.5, wy * 1.5)) - .5) * .8))); }
  wc *= 1. - .78 * so; }
vec2 wgx = vec2(-dFdx(vWw.z) * .6667, dFdx(wy) * 5.), wgy = vec2(-dFdy(vWw.z) * .6667, dFdy(wy) * 5.);
if (vNw.x > .5 && abs(wy - 2.78) < .1 && abs(wu - .5) * 1.5 < .15) {
  float gx = (.15 - (wu - .5) * 1.5) / .3, num = wid + 1., dg = gx < .5 ? floor(num / 10.) : mod(num, 10.);
  float a = textureGrad(tDig, vec2((dg + fract(gx * 2.)) / 10., (wy - 2.68) / .2), wgx, wgy).r * smoothstep(.15, .55, wN(vWw.zy * 22.) + .25);
  wc = mix(wc, vec3(.018), a * .85);
}
float wdh = .3 + .55 * wN(vec2(vWw.z * 1.3, 2.)) + .12 * wN(vec2(vWw.z * 8., 5.));
float wdu = clamp((1. - smoothstep(wdh * .35, wdh, wy)) * .6 + step(.5, vNw.y) * step(wy, .6) * .75, 0., 1.);
wc = mix(wc, vec3(.4, .31, .2) * (.85 + .3 * wN(vWw.zx * 7.)), wdu);
diffuseColor.rgb *= wc;`)
      .replace('#include <normal_fragment_maps>', `
#ifdef USE_NORMALMAP_TANGENTSPACE
vec3 mapN = textureGrad(normalMap, vNormalMapUv + wOff, dFdx(vNormalMapUv), dFdy(vNormalMapUv)).xyz * 2. - 1.; mapN.xy *= normalScale * (1. - wdu * .6); normal = normalize(tbn * mapN);
#endif
{ vec3 gw = inverseTransformDirection(normal, viewMatrix);
  gw.z += (1. - smoothstep(0., .02 + wfw, we)) * (1. - wEnd) * sign(wu - .5) * .8; gw.y += wtop * .8;
  gw += (vec3(wN(vWw.zy * 40.), wN(vWw.yz * 40. + 5.), wN(vWw.zy * 40. + 9.)) - .5) * wChip * 1.4;
  normal = normalize((viewMatrix * vec4(normalize(gw), 0.)).xyz); }`);
  };
}
function graffitiTex() {
  return canvasTex(2048, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    // soot from years of burning tyres, rising from the foot of the wall
    for (let i = 0; i < 26; i++) { const x = Math.random() * W; const gr = g.createRadialGradient(x, H, 4, x, H, 60 + Math.random() * 110); gr.addColorStop(0, 'rgba(20,18,16,.55)'); gr.addColorStop(1, 'rgba(20,18,16,0)'); g.fillStyle = gr; g.fillRect(x - 170, 0, 340, H); }
    // painted flag bands and slogans
    const flag = (x, w) => { const h = 70, y = 70; g.globalAlpha = .78; [['#1d1d1b', 0], ['#e9e5d8', 1], ['#1f7a3a', 2]].forEach(([c, i]) => { g.fillStyle = c; g.fillRect(x, y + i * h / 3, w, h / 3); }); g.fillStyle = '#b3222a'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * .33, y + h / 2); g.lineTo(x, y + h); g.fill(); g.globalAlpha = 1; };
    flag(120, 130); flag(1180, 150);
    g.font = '700 46px "Noto Kufi Arabic", sans-serif'; g.direction = 'rtl';
    const say = (t, x, y, c, a = .8) => { g.globalAlpha = a; g.fillStyle = c; g.fillText(t, x, y); g.globalAlpha = 1; };
    say('العودة حق', 640, 120, '#1f5f2f'); say('القدس لنا', 1800, 110, '#7a1f1a'); say('لن ننسى', 980, 190, '#1d1d1b', .6);
    g.font = '700 30px "Noto Kufi Arabic", sans-serif'; say('سيف القدس', 1500, 200, '#2b4f7a', .7);
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 160 : 30},${Math.random() < .5 ? 30 : 30},${Math.random() < .5 ? 25 : 30},.5)`; const x = Math.random() * W, y = 90 + Math.random() * 110; g.beginPath(); g.ellipse(x, y, 9, 12, 0, 0, 7); g.fill(); for (let f = 0; f < 4; f++) g.fillRect(x - 8 + f * 5, y - 22, 3, 12); }
  }, { repeat: true });
}

// ---------- ground ----------
function regionMap() {
  const N = 1024, X0 = -1400, X1 = 600, Z0 = -1000, Z1 = 1000; const data = new Uint8Array(N * N * 4);
  const sc = document.createElement('canvas'); sc.width = sc.height = N; const g = sc.getContext('2d'); const px = x => (x - X0) / (X1 - X0) * N, pz = z => (z - Z0) / (Z1 - Z0) * N;
  // scorch marks: old tyre fires, burnt fields from incendiary balloons, trampled strip near the barrier
  const r = rng(21);
  for (let i = 0; i < 260; i++) { const x = -40 - r() * 520, z = (r() - .5) * 1200; const rad = 1 + r() * 4; g.fillStyle = `rgba(255,255,255,${.25 + r() * .5})`; g.beginPath(); g.ellipse(px(x), pz(z), rad, rad * (.6 + r() * .6), r() * 3, 0, 7); g.fill(); }
  // a fire site is a black core of melted rubber and ash, a browner halo, and soot smeared downwind (east, the sea breeze)
  for (const [x, z] of FL.fires) { const cx = px(x), cz = pz(z);
    const sm = g.createRadialGradient(cx + 4, cz, 0, cx + 4, cz, 9); sm.addColorStop(0, 'rgba(255,255,255,.45)'); sm.addColorStop(1, 'rgba(255,255,255,0)'); g.save(); g.translate(cx + 4, cz); g.scale(1, .45); g.translate(-cx - 4, -cz); g.fillStyle = sm; g.fillRect(cx - 6, cz - 10, 20, 20); g.restore();
    const gr = g.createRadialGradient(cx, cz, 0, cx, cz, 7); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cz, 7, 0, 7); g.fill(); }
  for (let i = 0; i < 10; i++) { const x = 140 + r() * 380, z = (r() - .5) * 1400; g.fillStyle = `rgba(255,255,255,${.35 + r() * .3})`; g.beginPath(); g.ellipse(px(x), pz(z), 6 + r() * 16, 4 + r() * 10, r() * 3, 0, 7); g.fill(); }
  const sd = g.getImageData(0, 0, N, N).data;
  // Gaza side: the dirt road parallel to the fence, vehicle tracks from it to the camp and the stage, and the desire lines
  // hundreds of feet wore from the camp to the wall over months of Friday protests (own RNG: the scorch layout stays put)
  const tq = rng(2104), tcv = document.createElement('canvas'); tcv.width = tcv.height = N; const tg = tcv.getContext('2d'); tg.lineCap = 'round';
  const line = (pts, w, a) => { tg.strokeStyle = `rgba(255,255,255,${a})`; tg.lineWidth = w; tg.beginPath(); pts.forEach(([x, z], i) => tg[i ? 'lineTo' : 'moveTo'](px(x), pz(z))); tg.stroke(); };
  const jak = z => -305 + Math.sin(z * .004) * 12 + Math.sin(z * .017) * 3;
  { const pts = []; for (let z = -1000; z <= 1000; z += 20) pts.push([jak(z), z]); line(pts, 3.2, .8); }
  for (const [x1, z1] of [[FL.stage.x + 6, FL.stage.z], [-236, -118], [-214, 104], [-245, 40], [-228, -60], [FL.balloon.x, FL.balloon.z]]) { const z0 = z1 + (tq() - .5) * 80, x0 = jak(z0), mx = (x0 + x1) / 2 + (tq() - .5) * 20, mz = (z0 + z1) / 2 + (tq() - .5) * 30; tg.lineWidth = 1.8; tg.strokeStyle = 'rgba(255,255,255,.55)'; tg.beginPath(); tg.moveTo(px(x0), pz(z0)); tg.quadraticCurveTo(px(mx), pz(mz), px(x1), pz(z1)); tg.stroke(); }
  for (let i = 0; i < 44; i++) { const x0 = -150 - tq() * 110, z0 = (tq() - .5) * 320, x1 = -4 - tq() * 6, z1 = (tq() - .5) * 150, mx = (x0 + x1) / 2 + (tq() - .5) * 30, mz = (z0 + z1) / 2 + (tq() - .5) * 60; tg.lineWidth = .8 + tq() * 1.2; tg.strokeStyle = `rgba(255,255,255,${.18 + tq() * .3})`; tg.beginPath(); tg.moveTo(px(x0), pz(z0)); tg.quadraticCurveTo(px(mx), pz(mz), px(x1), pz(z1)); tg.stroke(); }
  const td = tg.getImageData(0, 0, N, N).data;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = X0 + (i + .5) / N * (X1 - X0), z = Z0 + (j + .5) / N * (Z1 - Z0); const o = (j * N + i) * 4;
    let s = 0, f = 0, t = 0;
    if (x < -1.5) { s = clamp(.72 + (fbm(x * .02, z * .02, 3) - .45) * 1.1, .35, 1) * (1 - td[o] / 255 * .5); f = td[o] / 255; } // Gaza: sand with dirt patches; G = worn tracks
    if (x > FL.bermX - 15 && x < FL.bermX + 15 && Math.abs(z) < FL.bermZ + 10) s = Math.max(s, .75); // pushed-up sand of the berm
    if (x > 4 && x < 11) t = 1;                                                                  // patrol road
    if (Math.abs(z - FL.cp.z - 4) < 3 && x > 36 && x < 60) t = Math.max(t, .8);                   // track to the back of the berm
    if (Math.abs(x - 150) < 3.5) t = Math.max(t, .7);
    if (x > 125) { const plot = Math.floor((z + 2000) / 190) % 3; f = plot === 1 ? .55 : 1; }      // harvested wheat / ploughed plots
    else if (x > 60) f = clamp((x - 60) / 60, 0, .45) * (fbm(x * .03, z * .03, 2) + .3);
    const scorch = sd[o] / 255 * (x < 0 ? .85 : .7) + (x < 0 && x > -18 ? .18 : 0);
    data[o] = s * 255; data[o + 1] = f * 255; data[o + 2] = t * 255; data[o + 3] = clamp(scorch, 0, 1) * 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
// Ground shading. Beyond the photo textures, the low sun needs relief to rake across: wind ripples in loose sand, the
// patrol road's Humvee ruts with the gravel lip they push up, boot prints along the wall and across to the berm, the
// dragged sand strip beside the wall (smoothed so fresh footprints show), and the dozer blade's contour scrapes on the
// berm flanks (the berm shares this material, so it is the same local soil as the ground it was pushed up from, not a
// separate orange sand). Wind streaks elongated east-west (the sea breeze) break up the open sand at every distance, and
// the albedo loses colour with distance (dust). The relief is only computed near the camera and not on low quality.
function groundMaterial() {
  const uni = { tSand: { value: tex('sand_c.jpg') }, tDirt: { value: tex('dirt2_c.jpg') }, tGrav: { value: tex('gravel_c.jpg') }, tReg: { value: regionMap() }, tNrm: { value: tex('gravel_n.jpg', { srgb: false }) }, uGQ: { get value() { return G.quality ?? 2; } } };
  const m = new THREE.MeshStandardMaterial({ roughness: 1, color: '#ffffff' });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWp; uniform sampler2D tSand, tDirt, tGrav, tReg, tNrm; uniform float uGQ;
float gH1(float n) { return fract(sin(mod(n, 289.) * 78.233) * 43758.5453); }
float gH2(vec2 p) { vec3 p3 = fract(vec3(mod(p, 289.).xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(gH2(i), gH2(i + vec2(1., 0.)), f.x), mix(gH2(i + vec2(0., 1.)), gH2(i + vec2(1., 1.)), f.x), f.y); }
vec3 gStep(vec2 p, float x0, float ph, float A) {
  float k = floor(p.y / .36 + ph), zc = (k - ph + .5) * .36 + (gH1(k * 1.3 + ph) - .5) * .05, sd = mod(k, 2.) * 2. - 1.;
  float xc = x0 + sin(p.y * .05 + ph * 5.) * .45 + sin(p.y * .21 + ph) * .08 + sd * .1;
  vec2 sc = vec2(.052, .14), q = (p - vec2(xc, zc)) / sc; float r = max(length(q), 1e-3), keep = step(.22, gH1(k * 1.7 + ph * 3.)) * A;
  float t = clamp((r - .62) / .38, 0., 1.), e = exp(-(r - 1.15) * (r - 1.15) * 30.);
  float h = (-(1. - t * t * (3. - 2. * t)) * .012 + e * .003) * keep, dr = (6. * t * (1. - t) / .38 * .012 * step(r, 1.) - 60. * (r - 1.15) * e * .003) * keep;
  return vec3(h, dr * q / r / sc);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec3 na = texture2D(tNrm, vWp.xz * .24).xyz * 2. - 1., nb = texture2D(tNrm, vWp.xz * .047 + .31).xyz * 2. - 1.; vec4 rg = texture2D(tReg, vec2((vWp.x + 1400.) / 2000., (vWp.z + 1000.) / 2000.));
        vec2 dd = (na.xy * .6 + nb.xy * .5) * mix(.55, .9, rg.b) * (1. - rg.g * .5); vec3 gw = inverseTransformDirection(normal, viewMatrix);
        float bm = (1. - smoothstep(10., 12.5, abs(vWp.x - ${FL.bermX.toFixed(1)}))) * (1. - smoothstep(${(FL.bermZ - 8).toFixed(1)}, ${(FL.bermZ + 1).toFixed(1)}, abs(vWp.z))) * smoothstep(.15, .5, vWp.y) * smoothstep(.03, .12, 1. - gw.y);
        gw += vec3(dd.x, 0., -dd.y) + gRel;
        if (bm > 0. && uGQ > .5) { float bp = vWp.y * 9. + gN(vec2(vWp.z * .07, 1.)) * 5. + gN(vec2(vWp.z * .5, 3.)) * .8, kb = bm * (1. - smoothstep(1., 2.5, gFy * 9.));
          gw.xz += normalize(gw.xz + 1e-4) * sin(bp) * .22 * kb; diffuseColor.rgb *= 1. + sin(bp + .8) * .06 * kb; }
        normal = normalize((viewMatrix * vec4(normalize(gw), 0.)).xyz); }`)
      .replace('#include <map_fragment>', `
      vec4 reg = texture2D(tReg, vec2((vWp.x + 1400.) / 2000., (vWp.z + 1000.) / 2000.));
      vec3 sand = texture2D(tSand, vWp.xz * .19).rgb * .55 + texture2D(tSand, vWp.xz * .027).rgb * .45;
      vec3 dirt = texture2D(tDirt, vWp.xz * .23).rgb * .55 + texture2D(tDirt, vWp.xz * .035).rgb * .45;
      vec3 grav = texture2D(tGrav, vWp.xz * .28).rgb;
      sand *= vec3(1.1, 1.0, .86); dirt *= vec3(.98, .9, .78);
      vec3 col = mix(dirt, sand, reg.r);
      float furrow = .5 + .5 * sin(vWp.x * 6.2832 / 1.1 + sin(vWp.z * .01) * 2.);
      vec3 stubble = mix(vec3(.72, .6, .42), vec3(.86, .76, .55), furrow) * (dirt * 1.6);
      col = mix(col, stubble, reg.g * step(0., vWp.x)); col *= 1. + reg.g * .22 * (1. - step(0., vWp.x));
      col = mix(col, mix(grav, dirt, .45) * vec3(.96, .9, .8), reg.b * .92);
      col *= 1. - reg.a * .7;
      col = mix(col, vec3(dot(col, vec3(.3, .59, .11))) * vec3(1.06, 1., .9), smoothstep(250., 1300., distance(vWp, cameraPosition)) * .4);
      vec3 gRel = vec3(0.); vec2 gFw = fwidth(vWp.xz); float gFy = fwidth(vWp.y), gCam = distance(vWp, cameraPosition), gSd = reg.r * (1. - reg.b) * (1. - reg.a);
      { float fz = gFw.y; col *= 1. + ((gN(vec2(vWp.x * .018, vWp.z * .26)) - .5) * .24 * (1. - smoothstep(.8, 2.5, fz)) + (gN(vec2(vWp.x * .06, vWp.z * .9) + 7.) - .5) * .14 * (1. - smoothstep(.25, .8, fz))) * (.35 + .65 * gSd); }
      if (uGQ > .5 && gCam < 60.) {
        float fade = 1. - smoothstep(35., 60., gCam);
        if (gSd > .05) { float ph = dot(vWp.xz, vec2(1., .2)) * 50. + gN(vWp.xz * .6) * 10. + gN(vWp.xz * 2.3 + 3.) * 2.5, k = gSd * (1. - smoothstep(.9, 2.2, 50. * (gFw.x + .2 * gFw.y))) * .17 * fade;
          gRel.xz -= vec2(1., .2) * (cos(ph) + .45 * cos(2. * ph + .6)) * k; col *= 1. + sin(ph) * k * .4; }
        if (vWp.x > .95 && vWp.x < 3.9 && vWp.y < .5) { float e = smoothstep(.95, 1.25, vWp.x) * (1. - smoothstep(3.55, 3.9, vWp.x)), lp = vWp.x * 140. + gN(vec2(vWp.z * .25, 4.)) * 6.;
          col = mix(col, sand * vec3(1.02, .97, .9), e * .5); gRel.x -= cos(lp) * e * (1. - smoothstep(.8, 2., gFw.x * 140.)) * .1 * fade; }
        if (vWp.x > 2.5 && vWp.x < 12.5 && vWp.y < .5) { float tf = 1. - smoothstep(.5, 1.5, gFw.y * 31.4);
          for (int i = 0; i < 2; i++) { float fi = float(i), A = 1. - fi * .45;
            float tx = vWp.x - 7.3 - fi * .8 - sin(vWp.z * (.031 + fi * .012) + fi * 2.) * .4 - sin(vWp.z * .11 + 1.3 + fi) * .07, d = abs(abs(tx) - .91), sg = sign(tx) * sign(abs(tx) - .91);
            float e1 = exp(-d * d * 60.), e2 = exp(-(d - .21) * (d - .21) * 300.), tp = vWp.z * 31.4 + abs(tx) * 7.;
            gRel.x -= A * (2.4 * d * e1 - 3.6 * (d - .21) * e2) * sg * 2.6 * fade; gRel.z -= A * .15 * cos(tp) * e1 * fade * tf;
            col *= 1. - A * (.22 * e1 - .1 * e2 + .06 * step(0., sin(tp)) * e1 * tf); } }
        if (gCam < 30.) { vec3 f = gStep(vWp.xz, 2.3, 0., 1.) + gStep(vWp.xz, 2.9, .37, .7) + gStep(vWp.xz, 11.6, .71, .8), c = gStep(vWp.zx, -17.4, .2, 1.) + gStep(vWp.zx, 18.6, .55, 1.);
          f += vec3(c.x, c.z, c.y) * step(1., vWp.x) * step(vWp.x, 13.); gRel.xz -= f.yz * .6 * (1. - smoothstep(18., 30., gCam)); col *= 1. + f.x * 20.; }
      }
      diffuseColor.rgb *= col;`);
  };
  return m;
}
function buildGround() {
  const mat = FM.ground = groundMaterial();
  // detailed grid where people walk (collides), flat far plane beyond
  const X0 = -900, X1 = 330, Z0 = -720, Z1 = 720, S = 6;
  const nx = Math.round((X1 - X0) / S), nz = Math.round((Z1 - Z0) / S);
  const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz); geo.rotateX(-Math.PI / 2); geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hF(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; G.scene.add(m); geo.userData.noOcclude = true; G.colliders.push(geo);
  // coarse terrain beyond (same height function), a hair lower so the detailed grid wins where they overlap
  const fg = new THREE.PlaneGeometry(4800, 5400, 120, 135); fg.rotateX(-Math.PI / 2); fg.translate(-750, 0, 0);
  const fp = fg.attributes.position; for (let i = 0; i < fp.count; i++) fp.setY(i, hF(fp.getX(i), fp.getZ(i)) - .08);
  fg.computeVertexNormals(); const far = new THREE.Mesh(fg, mat); far.receiveShadow = true; G.scene.add(far);
  const horizon = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2).translate(0, -.5, 0), mat); G.scene.add(horizon);
  G.groundMesh = m;
}

// ---------- the barrier ----------
// The firing slit is not a hole in bare concrete: a welded steel sleeve lines it through the full wall thickness (it is
// what stops spall from a round hitting the edge), bolted to a 12 mm flange plate on the Israeli face, with an angle
// iron lip on the Gaza face. Built as real plates with thickness so the low sun throws their edges into shadow.
function slitSteel(T, z) {
  const y = FL.slitY, hw = .12, hh = .09, f = (w, h, d, px, py, pz) => add(FM.frame, at(new THREE.BoxGeometry(w, h, d), px, py, z + pz));
  f(T + .03, .008, 2 * hw, 0, y - hh + .004, 0); f(T + .03, .008, 2 * hw, 0, y + hh - .004, 0);
  for (const s of [-1, 1]) f(T + .03, 2 * hh, .008, 0, y, s * (hw - .004));
  const fx = T / 2 + .006; f(.012, .1, .46, fx, y + hh + .05, 0); f(.012, .1, .46, fx, y - hh - .05, 0);
  for (const s of [-1, 1]) f(.012, 2 * hh, .11, fx, y, s * (hw + .055));
  for (const s of [-1, 1]) { f(.03, .006, 2 * hw + .06, -T / 2 - .015, y + s * (hh + .003), 0); f(.03, 2 * hh + .06, .006, -T / 2 - .015, y, s * (hw + .003)); }
  const bolt = new THREE.CylinderGeometry(.013, .013, .016, 6).rotateZ(Math.PI / 2);
  for (const [by, bz] of [[.16, -.19], [.16, .19], [-.16, -.19], [-.16, .19], [0, -.2], [0, .2]]) add(FM.frame, bolt.clone().translate(fx + .012, y + by, z + bz));
  // hinge knuckles welded to the flange either side of the shutter's own knuckle
  const kn = new THREE.CylinderGeometry(.016, .016, .07, 8).rotateX(Math.PI / 2);
  for (const s of [-1, 1]) { add(FM.frame, kn.clone().translate(T / 2 + .04, y + .12, z + s * .1)); f(.03, .02, .06, T / 2 + .024, y + .12, s * .1); }
}
// the shutter: a 20 mm plate with a welded stiffening rim, its knuckle on the hinge axis and a bent-bar handle
let _shut = null;
function shutterGeo() {
  if (_shut) return _shut;
  const b = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  _shut = mergeGeometries([b(.02, .24, .3, 0, -.12, 0), b(.018, .02, .3, .018, -.235, 0), b(.018, .2, .02, .018, -.13, -.14), b(.018, .2, .02, .018, -.13, .14),
    new THREE.CylinderGeometry(.016, .016, .12, 8).rotateX(Math.PI / 2),
    b(.012, .012, .1, .06, -.2, 0), b(.05, .012, .012, .036, -.2, -.05), b(.05, .012, .012, .036, -.2, .05)].map(g => g.index ? g.toNonIndexed() : g));
  return _shut;
}
function barrier() {
  const H = 3.6, T = .3, W = 1.5; const nSec = Math.round(FL.wallZ * 2 / W);
  G.slits = [];
  // set by crane onto a graded strip: plain sections sit a few millimetres out of line and a centimetre proud or short,
  // so the top edge steps against the sky (own RNG; the slit sections stay exact for the snipers' geometry)
  const jq = rng(71);
  for (let i = 0; i < nSec; i++) {
    const z = -FL.wallZ + (i + .5) * W; const slit = FL.slits.find(s => Math.abs(s - z) < W / 2);
    const w = W - .004, jx = (jq() - .5) * .012, jh = (jq() - .5) * .024;
    if (slit === undefined) add(FM.wall, at(box(T, H + jh, w, 2), jx, (H + jh) / 2, z), true);
    else { // section with a firing slit: 24 x 18 cm hole at chest height, steel frame and a hinged shutter on the Israeli side
      const y0 = FL.slitY - .09, y1 = FL.slitY + .09, hw = .12;
      add(FM.wall, at(box(T, y0, w, 2), 0, y0 / 2, z), true);
      add(FM.wall, at(box(T, H - y1, w, 2), 0, y1 + (H - y1) / 2, z), true);
      add(FM.wall, at(box(T, y1 - y0, w / 2 - hw, 2), 0, FL.slitY, z - (hw + (w / 2 - hw) / 2)), true);
      add(FM.wall, at(box(T, y1 - y0, w / 2 - hw, 2), 0, FL.slitY, z + (hw + (w / 2 - hw) / 2)), true);
      slitSteel(T, z);
      const sh = new THREE.Mesh(shutterGeo(), FM.frame); const hinge = new THREE.Group(); hinge.position.set(T / 2 + .04, FL.slitY + .12, z); sh.position.set(0, -.12, 0); hinge.add(sh); hinge.rotation.z = -1.35; G.scene.add(hinge); sh.castShadow = true;
      G.slits.push({ z: slit, pos: V3(T / 2 + .45, 0, slit), hole: V3(0, FL.slitY, slit), shutter: hinge, open: 1 });
    }
    add(FM.wall, at(box(1.35, .5, w, 2), .25, .25, z), true);                                       // T-wall footing (same precast piece)
    // two cast-in lifting loops per section (the crane's spreader takes both), each standing out of a small grouted pocket
    { const lx = slit === undefined ? jx : 0, ly = H + (slit === undefined ? jh : 0); for (const dz of [-.43, .43]) { add(FM.rust, at(new THREE.TorusGeometry(.075, .014, 4, 8, Math.PI), lx, ly - .005, z + dz)); add(FM.concreteDark, at(box(.2, .012, .17, 1), lx, ly - .002, z + dz)); } }
  }
  // graffiti along the Gaza face
  const gp = new THREE.PlaneGeometry(FL.wallZ * 2, 2.6); gp.rotateY(-Math.PI / 2); gp.translate(-T / 2 - .012, 1.45, 0);
  const uv = gp.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * FL.wallZ * 2 / 26);
  const gm = new THREE.Mesh(gp, FM.graffiti); gm.renderOrder = 1; G.scene.add(gm);
  // the steel fence beyond the wall (posts every 3 m, slatted panels), concertina on the Gaza side
  const posts = [], panels = [];
  for (const sgn of [-1, 1]) {
    const z0 = sgn * FL.wallZ, z1 = sgn * 900; const n = Math.floor(Math.abs(z1 - z0) / 3);
    for (let i = 0; i <= n; i++) { const z = z0 + sgn * i * 3; posts.push(at(new THREE.BoxGeometry(.14, 6.2, .14), 0, 3.1, z)); }
    const len = Math.abs(z1 - z0); const pg = new THREE.PlaneGeometry(len, 6); pg.rotateY(Math.PI / 2); pg.translate(0, 3, (z0 + z1) / 2);
    const u = pg.attributes.uv; for (let i = 0; i < u.count; i++) u.setX(i, u.getX(i) * len / 1.6); panels.push(pg);
    G.colliders.push(at(new THREE.BoxGeometry(.3, 6, len), 0, 3, (z0 + z1) / 2));
    for (const y of [.25, 3.1, 5.95]) posts.push(at(new THREE.BoxGeometry(.08, .08, len), 0, y, (z0 + z1) / 2));
  }
  add(FM.steel, mergeGeometries(posts)); const pm = new THREE.Mesh(mergeGeometries(panels), FM.mesh); pm.castShadow = true; pm.receiveShadow = true; G.scene.add(pm);
  const coil = []; for (const [dx, y] of [[-.45, .45], [.45, .45], [0, 1.2]]) { const c = new THREE.CylinderGeometry(.46, .46, 1800, 10, 1, true); c.rotateX(Math.PI / 2); c.translate(FL.wire + dx, y, 0); const u2 = c.attributes.uv; for (let i = 0; i < u2.count; i++) u2.setY(i, u2.getY(i) * 1800 / 1.1); coil.push(c); }
  const cm = new THREE.Mesh(mergeGeometries(coil), FM.concertina); cm.castShadow = true; G.scene.add(cm); G.concertina = cm;
  // sniper positions behind each slit: sandbag cheeks and a firing step
  for (const s of FL.slits) {
    for (const dz of [-.75, .75]) for (let k = 0; k < 7; k++) add(FM.sandbag, at(sandbag(), .95 + rr(-.04, .04), .09 + k * .17, s + dz + rr(-.04, .04), Math.PI / 2 + rr(-.15, .15)));
    add(FM.concreteDark, at(box(.9, .2, 1.2, 2), .95, .1, s), true);
  }
}

// ---------- Israeli side: patrol road, berm, command post, tank ramps ----------
function berm() {
  // bulldozed sand embankment behind the patrol road; widened into a flat pad where the command post stands
  const Hk = FL.bermH / 5; const prof = [[-11.5, 0], [-5.2, 3.9 * Hk], [-2.3, FL.bermH], [2.3, FL.bermH], [5.2, 3.8 * Hk], [11.5, 0]]; const n = 150; const Z = FL.bermZ;
  const pos = [], idx = [], uv = [];
  G.bermPad = z => sstep(11, 7, Math.abs(z - FL.cp.z));
  for (let i = 0; i <= n; i++) {
    const z = -Z + i / n * Z * 2; const end = Math.min(1, (Z - Math.abs(z)) / 14); const w = .15 + .85 * Math.sqrt(Math.max(0, end)); const pad = G.bermPad(z);
    for (let k = 0; k < prof.length; k++) { const [dx, h] = prof[k]; const j = (fbm(z * .08 + k, k * 3.1, 2) - .5) * (1 - pad * .8); const x = FL.bermX + (dx + Math.sign(dx) * 3.2 * pad) * (.9 + w * .1) + j * .8; pos.push(x, h * w + j * .3 * (h > 0 ? 1 : 0), z); uv.push(dx / 3, z / 3); }
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < prof.length - 1; k++) { const a = i * prof.length + k, b = a + prof.length; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, FM.ground); m.castShadow = m.receiveShadow = true; G.scene.add(m); G.colliders.push(g);
  // sniper nests on top of the berm (sandbag horseshoes), away from the command pad
  G.bermNests = []; const top = FL.bermH;
  for (const z of [-58, -28, 36, 64]) { for (let a = -1.2; a <= 1.2; a += .3) for (let k = 0; k < 3; k++) add(FM.sandbag, at(sandbag(), FL.bermX - 1.3 - Math.cos(a) * 1.25, top + .05 + k * .17, z + Math.sin(a) * 1.35, a + Math.PI / 2 + (k % 2) * .15)); G.bermNests.push(V3(FL.bermX - .6, top, z)); }
}
// The grader that keeps the patrol road smooth pushes the spoil to both edges as a low, lumpy windrow of gravel and sand.
// It breaks where the foot traffic crosses to the berm and thins out in places; same ground material, so it carries the
// road's gravel and the sand's ripples; no collider (a 15 cm lump does not need one).
function roadEdges() {
  const pos = [], idx = []; const prof = [-1, -.6, -.25, 0, .3, .65, 1], NP = prof.length;
  for (const [xc, hw, sd] of [[3.45, .55, 1], [11.65, .7, 2]]) {
    let row = 0; const base = () => pos.length / 3;
    for (let z = -142; z <= 142; z += .5) {
      const gap = Math.min(...[-17.4, 18.6, -60, 52].map(c => Math.abs(z - c))), env = sstep(.6, 2.2, gap) * sstep(0, 4, 142 - Math.abs(z));
      const h = .25 * env * (.45 + fbm(z * .09 + sd * 7, sd, 3)) * (.6 + .4 * Math.sin(z * .6 + sd)), w = hw * (.8 + .4 * fbm(z * .05, sd * 3, 2)), xo = (fbm(z * .02, sd * 5, 2) - .5) * .5;
      const b = base(); for (let k = 0; k < NP; k++) { const u = prof[k], bump = Math.pow(Math.max(0, 1 - u * u), 1.3) * (1 + (fbm(z * .7 + k, sd, 2) - .5) * .5); pos.push(xc + xo + u * w, hF(xc + u * w, z) + h * bump - (Math.abs(u) > .99 ? .03 : 0), z); }
      if (row++) for (let k = 0; k < NP - 1; k++) { const a = b - NP + k, c = b + k; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, FM.ground); m.receiveShadow = true; G.scene.add(m);
}
export function hummer(x, z, ry, collide = true) {
  // static parts merged per material inside the group (5 draw calls instead of 14; the group still moves as one)
  const g = new THREE.Group(), parts = new Map(); const put = (m, geo) => { if (!parts.has(m)) parts.set(m, []); parts.get(m).push(geo); };
  const b = (w, h, d, m, px, py, pz) => put(m, box(w, h, d, 1).translate(px, py, pz));
  b(2.18, .7, 4.7, FM.olive, 0, .95, 0); b(2.0, .75, 2.4, FM.olive, 0, 1.65, -.3); b(1.9, .06, 1.9, FM.oliveDark, 0, 1.3, 1.45);
  put(FM.glassDark, new THREE.PlaneGeometry(1.8, .55).rotateX(-.15).translate(0, 1.72, .92));
  for (const s of [-1, 1]) put(FM.glassDark, new THREE.PlaneGeometry(1.1, .45).rotateY(s * Math.PI / 2).translate(s * 1.005, 1.72, -.3));
  const wg = new THREE.CylinderGeometry(.46, .46, .38, 14); wg.rotateZ(Math.PI / 2);
  for (const [sx, sz] of [[-1, 1.55], [1, 1.55], [-1, -1.6], [1, -1.6]]) put(FM.tire, wg.clone().translate(sx * .98, .46, sz));
  b(.1, .1, .1, FM.black, .8, 2.1, -1.2); put(FM.black, new THREE.CylinderGeometry(.01, .015, 3, 4).rotateZ(.08).translate(.8, 3.6, -1.2));
  b(.8, .3, .5, FM.oliveDark, -.6, 2.18, -1.2);
  for (const [m, list] of parts) { const me = new THREE.Mesh(mergeGeometries(list), m); me.castShadow = m !== FM.glassDark; me.receiveShadow = true; g.add(me); }
  g.position.set(x, hF(x, z), z); g.rotation.y = ry; G.scene.add(g);
  if (collide) G.colliders.push(at(new THREE.BoxGeometry(2.2, 2, 4.8), x, hF(x, z) + 1, z, ry));
  return g;
}
function commandPost() {
  const { x, z } = FL.cp; const y = FL.bermH;
  G.resHummer = hummer(8, 64, Math.PI, false); // the standby force's vehicle on the patrol road
  hummer(40, z + 2, -.25); hummer(42, z - 7, .2);  // parked at the back foot of the berm
  // the loudspeaker Humvee on the patrol road, two horn speakers on a mast facing Gaza
  const sp = hummer(FL.spk.x, FL.spk.z, 0); const horn = new THREE.CylinderGeometry(.34, .09, .7, 12, 1, true); horn.rotateZ(Math.PI / 2);
  const hm = new THREE.MeshStandardMaterial({ color: '#d8d6cc', roughness: .6, side: THREE.DoubleSide });
  for (const dz of [-.36, .36]) { const h = new THREE.Mesh(horn, hm); h.position.set(-.25, 3.05, -.9 + dz); h.rotation.y = dz * .4; h.castShadow = true; sp.add(h); }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.1, 6), FM.steelDark); mast.position.set(0, 2.5, -.9); sp.add(mast);
  G.spkPos = V3(FL.spk.x - .4, hF(FL.spk.x, FL.spk.z) + 3.05, FL.spk.z); G.spkHummer = sp;
  // parapet of sandbags along the western lip of the pad (low enough to look over)
  for (let i = -11; i <= 11; i++) for (let k = 0; k < 3; k++) add(FM.sandbag, at(sandbag(), x - 1.2 + rr(-.04, .04), y - .02 + .09 + k * .17, z + i * .56 + (k % 2) * .28, Math.PI / 2 + rr(-.1, .1)));
  G.colliders.push(at(new THREE.BoxGeometry(.6, .6, 12.6), x - 1.2, y + .3, z));
  // camouflage net on poles over the planning table
  const cx = x + 4;
  // the net hangs off the four pole tops and a centre spreader: it sags in catenary between them, and the skirt that
  // overhangs the poles droops toward the ground on the east, north and south (the west skirt stays up: drooping, it
// hung across the commander's view of the wall) (local frame: X east, Y north, Z up before the rotation)
  const net = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 8.2, 22, 18), FM.camo); net.rotation.x = -Math.PI / 2; { const np = net.geometry.attributes.position, nq = rng(3101);
    const tops = [[-3.8, -3.2, 0], [3.8, -3.2, 0], [-3.8, 3.2, 0], [3.8, 3.2, 0], [0, 1.8, .3]];
    for (let i = 0; i < np.count; i++) { const lx = np.getX(i), ly = -np.getY(i); let h = -9;
      for (const [px, py, ph] of tops) { const d = Math.hypot(lx - px, ly - py); h = Math.max(h, ph - .12 * d * d / (1 + .35 * d)); }
      const ox = Math.max(0, lx - 3.8), oy = Math.max(0, Math.abs(ly) - 3.2), over = Math.hypot(ox, oy);
      h = Math.max(h, -.75) - Math.min(over, .8) * .7 + (nq() - .5) * .05; np.setZ(i, h); } net.geometry.computeVertexNormals(); }
  net.position.set(cx + .5, y + 2.7, z); net.castShadow = true; net.receiveShadow = true; G.scene.add(net);
  add(FM.oliveDark, at(new THREE.CylinderGeometry(.035, .045, 3.0, 6), cx + .5, y + 1.5, z + 1.8));
  for (const [dx, dz] of [[-3.3, -3.2], [4.3, -3.2], [-3.3, 3.2], [4.3, 3.2]]) add(FM.oliveDark, at(new THREE.CylinderGeometry(.04, .05, 2.7, 6), cx + dx, y + 1.35, z + dz), true);
  add(FM.olive, at(box(2.2, .06, 1.1, 1), cx, y + .9, z), true); for (const [dx, dz] of [[-1, -.5], [1, -.5], [-1, .5], [1, .5]]) add(FM.steelDark, at(new THREE.CylinderGeometry(.02, .02, .9, 5), cx + dx, y + .45, z + dz));
  const map = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .8), new THREE.MeshStandardMaterial({ map: canvasTex(256, 170, (g, W, H) => { g.fillStyle = '#d8d2bc'; g.fillRect(0, 0, W, H); g.strokeStyle = '#3a5a8a'; g.lineWidth = 3; g.beginPath(); g.moveTo(W * .45, 0); g.lineTo(W * .45, H); g.stroke(); g.strokeStyle = '#b03a2a'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(W * .35, 0); g.lineTo(W * .35, H); g.stroke(); g.fillStyle = '#b03a2a'; for (let i = 0; i < 20; i++) g.fillRect(Math.random() * W * .35, Math.random() * H, 4, 4); g.strokeStyle = 'rgba(0,0,0,.25)'; g.setLineDash([]); g.lineWidth = 1; for (let i = 0; i < W; i += 20) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke(); } }), roughness: .9 }));
  map.rotation.x = -Math.PI / 2; map.position.set(cx - .1, y + .935, z); G.scene.add(map);
  for (let i = 0; i < 3; i++) add(FM.oliveDark, at(box(.32, .22, .28, 1), cx + .6 - i * .4, y + 1.04, z + .3));
  // radio mast with guy wires, jerrycans, an Israeli flag
  add(FM.steelDark, at(new THREE.CylinderGeometry(.03, .05, 9, 6), x + 7.5, y + 4.5, z - 3.5));
  const gw = []; for (const a of [0, 2.1, 4.2]) gw.push(new THREE.Vector3(x + 7.5, y + 8.5, z - 3.5), new THREE.Vector3(x + 7.5 + Math.cos(a) * 2.6, y, z - 3.5 + Math.sin(a) * 2.6)); { const gm = new THREE.Mesh(cableGeometry(gw, .006), new THREE.MeshStandardMaterial({ color: '#2a2a28', roughness: .5, metalness: .4 })); gm.castShadow = true; G.scene.add(gm); }
  for (let i = 0; i < 4; i++) add(FM.olive, at(box(.18, .45, .35, 1), x + 8, y + .22, z + 3 + i * .22));
  const flagT = canvasTex(192, 128, (g, W, H) => { g.fillStyle = '#f3f3f0'; g.fillRect(0, 0, W, H); g.fillStyle = '#1f3f9a'; g.fillRect(0, H * .1, W, H * .13); g.fillRect(0, H * .77, W, H * .13); g.strokeStyle = '#1f3f9a'; g.lineWidth = 6; for (const r of [0, Math.PI]) { g.beginPath(); for (let i = 0; i < 3; i++) { const a = r + i * Math.PI * 2 / 3 - Math.PI / 2; g[i ? 'lineTo' : 'moveTo'](W / 2 + Math.cos(a) * 26, H / 2 + Math.sin(a) * 26); } g.closePath(); g.stroke(); } }, { repeat: false });
  add(FM.steel, at(new THREE.CylinderGeometry(.025, .03, 5, 6), x + 1, y + 2.5, z + 6.4));
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .87, 10, 1), new THREE.MeshStandardMaterial({ map: flagT, side: THREE.DoubleSide, roughness: .8 })); fl.position.set(x + 1, y + 4.5, z + 6.4 + .65); fl.rotation.y = Math.PI / 2; fl.castShadow = true; G.scene.add(fl); G.flags = [fl];
  // pad clutter (own RNG, no colliders, all east of the table so the view west stays clear): the mast stands in a ring of
  // sandbags and carries a crossed dipole; a coax run droops from it to the radios; olive ammunition and ration crates
  // are stacked by the net's back poles; the radios on the table have their whips up
  { const q = rng(3102), mx = x + 7.5, mz = z - 3.5;
    for (let k = 0; k < 2; k++) for (let a = 0; a < 6.28; a += .62) add(FM.sandbag, at(sbag(q), mx + Math.cos(a + k * .3) * .55, y + .08 + k * .16, mz + Math.sin(a + k * .3) * .55, -a + Math.PI / 2));
    for (const a of [0, Math.PI / 2]) add(FM.steelDark, at(new THREE.CylinderGeometry(.012, .012, 1.6, 4).rotateZ(Math.PI / 2), mx, y + 8.3, mz, a));
    add(FM.black, at(box(.12, .12, .08, 1), mx, y + 8.3, mz));
    const cab = []; const P0 = new THREE.Vector3(mx, y + 7.9, mz), P1 = new THREE.Vector3(cx + .6, y + 1.1, z + .45);
    for (let i = 0; i < 12; i++) { const a = i / 12, b = (i + 1) / 12, pt = t => new THREE.Vector3().lerpVectors(P0, P1, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * .9, 0)); cab.push(pt(a), pt(b)); }
    add(FM.black, cableGeometry(cab, .008));
    for (let i = 0; i < 3; i++) add(FM.black, at(new THREE.CylinderGeometry(.004, .007, 1.1, 4), cx + .7 - i * .4, y + 1.7, z + .38));
    for (const [bx, bz, n] of [[x + 7.6, z + 1.2, 6], [x + 7.9, z - .2, 4], [x + 3.2, z - 3.6, 3]]) for (let i = 0; i < n; i++) { const L = i % 2 ? .45 : .62, hy = (i >> 1) * .3; const g = new THREE.BoxGeometry(L, .28, .34); add(FM.ammo, at(g, bx + (q() - .5) * .06, y + .14 + hy, bz + (i % 2) * .36 + (q() - .5) * .06, (q() - .5) * .15)); }
  }
  G.cpTable = V3(cx, y + .95, z);
}
function tankRamps() {
  G.tanks = [];
  for (const [x, z] of FL.tanks) {
    // earth ramp ("dipun"): tank sits hull-down behind a lip, facing Gaza
    const g = new THREE.BufferGeometry(); const pts = [[-7, 0, -5], [-2.5, 2.1, -4], [5, 2.1, -4], [11, 0, -4.5], [-7, 0, 5], [-2.5, 2.1, 4], [5, 2.1, 4], [11, 0, 4.5], [-4.5, 2.9, -4], [-4.5, 2.9, 4]];
    const P = pts.map(([a, b, c]) => [x + a, b + hF(x + a, z + c), z + c]);
    const tri = [[0, 8, 4], [4, 8, 9], [8, 1, 9], [9, 1, 5], [1, 2, 5], [5, 2, 6], [2, 3, 6], [6, 3, 7], [0, 1, 8], [4, 9, 5], [1, 0, 2], [5, 6, 4]].flat();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3)); g.setIndex(tri); g.computeVertexNormals(); const u = []; for (const p of P) u.push(p[0] / 3, p[2] / 3); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex('dirt2_c.jpg'), color: '#d8c3a0', roughness: 1, side: THREE.DoubleSide })); m.castShadow = m.receiveShadow = true; G.scene.add(m); G.colliders.push(g);
    const t = makeMerkava(); t.position.set(x + 1.2, 2.1 + hF(x, z), z); t.rotation.y = -Math.PI / 2; G.scene.add(t); G.tanks.push(t);
  }
}
// Merkava Mk4: the Namer hull with a wedge turret, 120 mm gun with thermal sleeve and the ball-and-chain curtain at the bustle
export function makeMerkava() {
  const v = makeAPC(); const g = v.obj; G.scene.remove(g);
  if (g.userData.rcws) g.userData.rcws.visible = false;
  const hullMat = g.children.find(c => c.isMesh && c.material && c.material.map)?.material || FM.olive;
  const tur = new THREE.Group(); tur.position.set(0, 2.1, -.7); g.add(tur); g.userData.turret = tur;
  const sh = new THREE.Shape(); sh.moveTo(-1.55, -1.9); sh.lineTo(1.55, -1.9); sh.lineTo(1.7, .6); sh.lineTo(.55, 2.3); sh.lineTo(-.55, 2.3); sh.lineTo(-1.7, .6); sh.closePath();
  const tg = new THREE.ExtrudeGeometry(sh, { depth: .78, bevelEnabled: true, bevelSize: .06, bevelThickness: .06, bevelSegments: 1 }); tg.rotateX(-Math.PI / 2); tg.translate(0, .06, 0);
  const tm = new THREE.Mesh(tg, hullMat); tm.castShadow = tm.receiveShadow = true; tur.add(tm);
  const gun = new THREE.Group(); gun.position.set(0, .45, 2.1); tur.add(gun); g.userData.gun = gun;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.085, .1, 5.2, 12), FM.oliveDark); barrel.rotation.x = Math.PI / 2; barrel.position.z = 2.6; barrel.castShadow = true; gun.add(barrel);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, 2.4, 12), FM.olive); sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 1.6; gun.add(sleeve);
  const mz = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .35, 12), FM.oliveDark); mz.rotation.x = Math.PI / 2; mz.position.z = 5.1; gun.add(mz);
  g.userData.muzzleT = V3(0, 0, 5.3);
  // bustle chains
  { const ch = []; for (let i = 0; i < 26; i++) ch.push(new THREE.CylinderGeometry(.018, .018, .55, 4).translate(-1.5 + i * .12, -.25, -1.95), new THREE.SphereGeometry(.05, 6, 4).translate(-1.5 + i * .12, -.55, -1.95)); tur.add(new THREE.Mesh(mergeGeometries(ch), FM.steelDark)); } // one mesh, not 52
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(.35, .38, .25, 14), hullMat); cup.position.set(.7, .95, -.4); tur.add(cup);
  const mg = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1, 6), FM.black); mg.rotation.x = Math.PI / 2; mg.position.set(.7, 1.25, .1); tur.add(mg);
  const box2 = new THREE.Mesh(box(.5, .35, .8, 1), hullMat); box2.position.set(-1.1, .95, -.8); tur.add(box2);
  for (const s of [-1, 1]) { const ant = new THREE.Mesh(new THREE.CylinderGeometry(.008, .012, 2.6, 4), FM.black); ant.position.set(s * 1.2, 2.1, -1.6); tur.add(ant); }
  g.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return g;
}

// ---------- Gaza side ----------
function scatter() {
  const r = rng(812);
  const inst = (geo, mat, n, place, shadow = true) => { const m = new THREE.InstancedMesh(geo, mat, n); const o = new THREE.Object3D(); let k = 0; for (let i = 0; i < n; i++) { if (place(o, i) === false) continue; o.updateMatrix(); m.setMatrixAt(k++, o.matrix); } m.count = k; m.castShadow = shadow; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; G.scene.add(m); return m; };
  const tire = new THREE.TorusGeometry(.33, .13, 6, 12); tire.rotateX(Math.PI / 2);
  inst(tire, FM.tire, 220, o => { const x = -8 - r() * 420, z = (r() - .5) * 900; o.position.set(x, hF(x, z) + .08, z); o.rotation.set(rr(-.25, .25), r() * 6, rr(-.25, .25)); o.scale.setScalar(rr(.85, 1.15)); });
  inst(new THREE.DodecahedronGeometry(.18, 0), FM.stone, 900, o => { const x = -2 - Math.pow(r(), 1.6) * 360, z = (r() - .5) * 700; o.position.set(x, hF(x, z) + .05, z); o.rotation.set(r() * 3, r() * 3, r() * 3); o.scale.set(rr(.4, 1.3), rr(.3, .9), rr(.4, 1.3)); }, false);
  for (let t = 0; t < FM.trash.length; t++) inst(new THREE.PlaneGeometry(.4, .3), FM.trash[t], 160, o => { const x = -4 - r() * 520, z = (r() - .5) * 1000; o.position.set(x, hF(x, z) + .03, z); o.rotation.set(-Math.PI / 2 + rr(-.3, .3), 0, r() * 6); o.scale.setScalar(rr(.5, 1.6)); }, false);
  // dry scrub: crossed cards of twiggy leaves (a solid icosahedron read as a green rock)
  const shrub = mergeGeometries([0, 1, 2].map(k => new THREE.PlaneGeometry(1.1, .8).translate(0, .38, 0).rotateY(k * Math.PI / 3))); const shm = inst(shrub, FM.scrub, 420, o => { const side = r() < .72; const x = side ? -30 - r() * 800 : 60 + r() * 260, z = (r() - .5) * 1300; o.position.set(x, hF(x, z), z); o.scale.set(rr(.5, 1.5), rr(.3, .8), rr(.5, 1.5)); o.rotation.y = r() * 6; });
  // no two bushes the same: some bleached almost white, some still grey-green from the last rain, some dead brown (own RNG)
  { const q = rng(515), c = new THREE.Color(); for (let i = 0; i < shm.count; i++) { const k = q(); shm.setColorAt(i, k < .3 ? c.setRGB(1.12, 1.08, .98) : k < .6 ? c.setRGB(.8, .88, .76) : k < .85 ? c.setRGB(.95, .82, .66) : c.setRGB(.7, .68, .6)); } }
  // tyre piles waiting to be lit and the burning ones: two instanced meshes (burnt / fresh) instead of 54 separate ones,
  // drawn from the same random sequence as before so every pile keeps its shape
  G.fireSpots = []; const pile = [[], []], po = new THREE.Object3D();
  for (const [x, z] of FL.fires) { for (let k = 0; k < 9; k++) { po.position.set(x + rr(-.8, .8), hF(x, z) + .1 + (k % 4) * .2, z + rr(-.8, .8)); po.rotation.set(rr(-.4, .4), r() * 6, rr(-.4, .4)); po.updateMatrix(); pile[k < 5 ? 0 : 1].push(po.matrix.clone()); } G.fireSpots.push({ p: V3(x, hF(x, z) + .4, z), lit: false, t: 0 }); }
  pile.forEach((list, j) => { const m = new THREE.InstancedMesh(tire, j ? FM.tire : FM.tireBurnt, list.length); list.forEach((mx, i) => m.setMatrixAt(i, mx)); m.castShadow = m.receiveShadow = true; G.scene.add(m); });
}
// ---------- clutter at the friction line ----------
// Everything here draws from its own RNG, so no earlier placement moves, and none of it collides. Stones thrown at the
// wall pile up along its Gaza foot and some come over; burnt-out tyres leave a melted crust and the steel bead wire;
// cans and bottles from the camp; ammunition cans beside each sniper position. Small, instanced, no shadows.
function debris() {
  const q = rng(4041), qr = (a, b) => a + (b - a) * q(), o = new THREE.Object3D(), c = new THREE.Color();
  const inst = (geo, mat, n, place, tint, shadow = false) => { const m = new THREE.InstancedMesh(geo, mat, n); let k = 0; for (let i = 0; i < n; i++) { o.rotation.set(0, 0, 0); o.scale.setScalar(1); if (place(o, i) === false) continue; o.updateMatrix(); m.setMatrixAt(k, o.matrix); if (tint) m.setColorAt(k, tint(c)); k++; } m.count = k; m.castShadow = shadow; m.receiveShadow = true; G.scene.add(m); return m; };
  const ground = (o, x, z, y = 0) => o.position.set(x, hF(x, z) + y, z);
  const nearSlit = (x, z) => x > 0 && FL.slits.some(s => Math.abs(z - s) < 1.6) && x < 2.2;
  // stones: limestone and flint, from fist size down to gravel
  const stone = new THREE.IcosahedronGeometry(.1, 0);
  inst(stone, FM.stone, 1100, (o, i) => { let x, z;
    if (i < 420) { x = -.5 - Math.pow(q(), 2.2) * 16; z = qr(-FL.wallZ - 20, FL.wallZ + 20); }
    else if (i < 560) { x = qr(1, 3.8); z = qr(-FL.wallZ, FL.wallZ); if (nearSlit(x, z)) return false; }
    else if (i < 760) { x = q() < .5 ? qr(3.4, 4.3) : qr(10.8, 12.2); z = qr(-140, 140); }
    else { x = -2 - Math.pow(q(), 1.4) * 90; z = qr(-220, 220); }
    ground(o, x, z, .02); o.rotation.set(q() * 6, q() * 6, q() * 6); const s = Math.pow(q(), 2) * .9 + .2; o.scale.set(s * qr(.8, 1.3), s * qr(.5, .9), s * qr(.8, 1.3)); },
  c => { const v = qr(.72, 1.12); return q() < .2 ? c.setRGB(v * .8, v * .78, v * .74) : c.setRGB(v * 1.05, v, v * .9); });
  // burnt tyres: the rubber slumps into a flat crust, the two steel bead rings survive the fire
  const crust = new THREE.TorusGeometry(.3, .08, 4, 12); crust.rotateX(Math.PI / 2); crust.scale(1, .32, 1); { const p = crust.attributes.position, jr = rng(77); for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + (jr() - .5) * .25), p.getY(i) * (.6 + jr() * .8), p.getZ(i) * (1 + (jr() - .5) * .25)); crust.computeVertexNormals(); }
  const bead = mergeGeometries([new THREE.TorusGeometry(.31, .007, 3, 18), new THREE.TorusGeometry(.3, .007, 3, 18).rotateY(.25).translate(0, .06, 0)]); bead.rotateX(Math.PI / 2 - .1);
  const burnt = []; for (let i = 0; i < 140; i++) { const f = i < 60 ? FL.fires[i % FL.fires.length] : null; const x = f ? f[0] + qr(-5, 5) : qr(-45, -6), z = f ? f[1] + qr(-5, 5) : qr(-110, 110); burnt.push([x, z, q() * 6, qr(.8, 1.15)]); }
  { const sq = rng(4412); for (const z of SOOT) for (let k = 0; k < 2; k++) burnt.push([-.5 - sq() * .6, z + (sq() - .5) * .8, sq() * 6, .8 + sq() * .3]); }
  inst(crust, FM.tireBurnt, burnt.length, (o, i) => { const [x, z, a, s] = burnt[i]; ground(o, x, z, .01); o.rotation.y = a; o.scale.setScalar(s); });
  inst(bead, FM.rust, burnt.length, (o, i) => { const [x, z, a, s] = burnt[i]; if (i % 3 === 2 || i >= 140) return false; ground(o, x + .15, z - .1, .03); o.rotation.set(qr(-.15, .15), a, qr(-.15, .15)); o.scale.setScalar(s); });
  // cans and bottles, faded by the sun; mostly on the Gaza side where the crowd gathers, a few on the patrol road
  const can = new THREE.CylinderGeometry(.033, .033, .12, 7); can.rotateZ(Math.PI / 2);
  const pal = ['#a83b2c', '#3c6a3a', '#b9b7ae', '#34598a', '#d8d4c8', '#c9772e', '#e0dccf', '#8fb0b8'];
  inst(can, FM.can, 520, (o, i) => { const x = i < 440 ? -1 - Math.pow(q(), 1.6) * 70 : qr(1.2, 11), z = i < 440 ? qr(-160, 160) : qr(-90, 90); if (i >= 440 && nearSlit(x, z)) return false; ground(o, x, z, .03); o.rotation.set(0, q() * 6, qr(-.2, .2)); if (q() < .35) o.scale.set(2, 1.3, 1.3); },
    c => c.set(pal[Math.floor(q() * pal.length)]).multiplyScalar(qr(.6, 1)));
  // ammunition cans at the sniper positions, against the outer side of each sandbag cheek (clear of the firing step)
  const ammo = mergeGeometries([new THREE.BoxGeometry(.3, .19, .16).translate(0, .095, 0), new THREE.BoxGeometry(.12, .015, .03).translate(0, .2, 0)]);
  const cans = []; for (const s of FL.slits) for (const sg of [-1, 1]) if (q() < .8) cans.push([qr(1.15, 1.5), s + sg * qr(1.12, 1.35), q() * .6 - .3]);
  inst(ammo, FM.ammo, cans.length, (o, i) => { const [x, z, a] = cans[i]; ground(o, x, z); o.rotation.y = Math.PI / 2 + a; }, null, true);
}
function tents() {
  const [x0, x1] = FL.tents; const r = rng(9);
  // A pole-and-rope tent, not an extruded prism: the fabric sags between the ridge poles and bellies in and out on the
  // walls between the uprights, the eave line droops, the gables are flat (stretched by the end poles); guy ropes run
  // from the eaves to pegs. Shapes come from the tent's own size, so the global random sequence is untouched.
  const ropes = [];
  const tentGeo = (w, d, h) => {
    const P = [[-w / 2, 0], [-w / 2 * .98, h * .55], [0, h], [w / 2 * .98, h * .55], [w / 2, 0]], prof = [];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) { const t = k / 3; prof.push([P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t, i === 1 || i === 2 ? 1 : 0, Math.sin(Math.PI * t) * (i === 0 || i === 3 ? 1 : 0)]); }
    prof.push([...P[4], 0, 0]);
    const nb = Math.max(2, Math.round(d / 3.5)), nz = nb * 4, pos = [], uv = [], idx = [], np = prof.length;
    for (let j = 0; j <= nz; j++) { const zz = -d / 2 + d * j / nz, bay = Math.sin(Math.PI * ((j % 4) / 4));
      for (let k = 0; k < np; k++) { const [px, py, roof, wall] = prof[k], ridge = Math.abs(px) < .01 ? .35 : 1, eave = Math.abs(py - h * .55) < .01 ? .5 : 1;
        const sag = roof * bay * .16 * ridge * eave + (eave < 1 ? bay * .06 : 0), bel = wall * bay * .09 * Math.sin(j * 1.7 + k);
        pos.push(px + Math.sign(px) * bel, py - sag, zz); uv.push(zz / 4, py / 4); } }
    for (let j = 0; j < nz; j++) for (let k = 0; k < np - 1; k++) { const a = j * np + k, b = a + np; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const s = new THREE.Shape(); P.forEach(([px, py], i) => s[i ? 'lineTo' : 'moveTo'](px, py)); const caps = [-1, 1].map(sg => { const c = new THREE.ShapeGeometry(s); const u = c.attributes.uv, p = c.attributes.position; for (let i = 0; i < u.count; i++) u.setXY(i, p.getX(i) / 4, p.getY(i) / 4); return c.translate(0, 0, sg * d / 2); });
    return mergeGeometries([g.toNonIndexed(), ...caps.map(c => c.toNonIndexed())]);
  };
  const guy = (x, z, ry, w, d, h) => { const c = Math.cos(ry), s = Math.sin(ry), y0 = hF(x, z); const nb = Math.max(2, Math.round(d / 3.5));
    for (let j = 0; j <= nb; j++) for (const sd of [-1, 1]) { const lz = -d / 2 + d * j / nb, ex = sd * w / 2, gx = sd * (w / 2 + 1.6);
      const A = new THREE.Vector3(x + ex * c + lz * s, y0 + h * .55, z - ex * s + lz * c), B = new THREE.Vector3(x + gx * c + lz * s, y0, z - gx * s + lz * c), M = A.clone().lerp(B, .5); M.y -= .05; ropes.push(A, M, M, B); } };
  for (let i = 0; i < 12; i++) {
    const x = x0 + r() * (x1 - x0), z = -FL.tentZ + i * FL.tentZ * 2 / 11 + rr(-5, 5); const w = rr(5, 9), d = rr(7, 12), h = rr(2.6, 3.6);
    const m = pick([FM.canvasW, FM.canvasW, FM.canvasB, FM.canvasG]), ry = rr(-.2, .2); add(m, at(tentGeo(w, d, h), x, hF(x, z), z, ry)); guy(x, z, ry, w, d, h);
  }
  add(FM.stone, cableGeometry(ropes, .007));
  // stage with a banner and loudspeakers
  const { x, z } = FL.stage; const y = hF(x, z);
  add(FM.wood, at(box(6, 1.1, 10, 2), x, y + .55, z));
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 2), new THREE.MeshStandardMaterial({ map: canvasTex(1024, 228, (g, W, H) => { g.fillStyle = '#e9e5d8'; g.fillRect(0, 0, W, H); [['#1d1d1b', 0], ['#e9e5d8', 1], ['#1f7a3a', 2]].forEach(([c, i]) => { g.fillStyle = c; g.fillRect(0, i * H / 3, 260, H / 3); }); g.fillStyle = '#b3222a'; g.beginPath(); g.moveTo(0, 0); g.lineTo(110, H / 2); g.lineTo(0, H); g.fill(); g.fillStyle = '#1d1d1b'; g.font = '700 78px "Noto Kufi Arabic", sans-serif'; g.direction = 'rtl'; g.textAlign = 'center'; g.fillText('مسيرة العودة الكبرى', 640, 110); g.font = '700 46px "Noto Kufi Arabic", sans-serif'; g.fillStyle = '#7a1f1a'; g.fillText('غزة ٢١-٨', 640, 190); }, { repeat: false }), side: THREE.DoubleSide, roughness: .9 }));
  banner.position.set(x - 2.5, y + 3.2, z); banner.rotation.y = Math.PI / 2; G.scene.add(banner);
  for (const dz of [-4.5, 4.5]) { add(FM.steelDark, at(new THREE.CylinderGeometry(.05, .06, 5, 6), x - 2.8, y + 2.5, z + dz)); add(FM.black, at(box(.6, .9, .6, 1), x - 2.8, y + 5.2, z + dz)); }
  G.stagePos = V3(x, y + 1.1, z);
  // parked cars and a pickup near the camp
  const cars = ['suv', 'hatch', 'pickup'].filter(k => A.models[k]);
  for (let i = 0; i < 9 && cars.length; i++) { const src = A.models[pick(cars)]; const o = src.scene.clone(true); const bb = new THREE.Box3().setFromObject(o); const s = bb.getSize(new THREE.Vector3()); if (s.x > s.z) o.rotation.y = Math.PI / 2; o.updateMatrixWorld(true); const b2 = new THREE.Box3().setFromObject(o); const sc = 4.4 / b2.getSize(new THREE.Vector3()).z; o.scale.multiplyScalar(sc);
    const cx = x0 - 22 - r() * 26, cz = -120 + i * 30 + rr(-6, 6); o.position.set(cx, hF(cx, cz), cz); o.rotation.y += rr(-.5, .5); o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.material = c.material.clone(); c.material.color.multiply(new THREE.Color(pick(['#e0dcd0', '#8a8680', '#c9c0a8', '#6a7078']))); } }); G.scene.add(o); }
}
function hamasPosts() {
  G.posts = [];
  for (const P of FL.posts) {
    const { x, z } = P; const y = hF(x, z);
    add(FM.concrete, at(box(3.2, 7.5, 3.2, 2), x, y + 3.75, z)); add(FM.concreteDark, at(box(4.2, 2.4, 4.2, 2), x, y + 8.7, z));
    for (const [dx, dz] of [[2.11, 0], [-2.11, 0], [0, 2.11], [0, -2.11]]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(dx ? 2.8 : 2.8, .7), FM.glassDark); w.position.set(x + dx * 1.001, y + 9, z + dz * 1.001); w.rotation.y = dx > 0 ? Math.PI / 2 : dx < 0 ? -Math.PI / 2 : dz > 0 ? 0 : Math.PI; G.scene.add(w); }
    add(FM.steelDark, at(new THREE.CylinderGeometry(.04, .05, 4, 6), x + 1.6, y + 11.9, z + 1.6));
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1, 10, 1), new THREE.MeshStandardMaterial({ map: canvasTex(160, 100, (g, W, H) => { g.fillStyle = '#1f7a3a'; g.fillRect(0, 0, W, H); g.fillStyle = '#f2f2ea'; g.font = '700 22px "Noto Kufi Arabic", sans-serif'; g.textAlign = 'center'; g.fillText('لا إله إلا الله', W / 2, H / 2 + 8); }, { repeat: false }), side: THREE.DoubleSide, roughness: .8 }));
    fl.position.set(x + 1.6, y + 13.3, z + 2.4); fl.rotation.y = Math.PI / 2; G.scene.add(fl); G.flags.push(fl);
    // a real bag wall (two skins, staggered courses) in place of solid blocks; a corrugated sheet roof weighted with
    // tyres over the cabin, and a faded tarp screen tied over the Israel-facing windows to hide who is watching (own RNG)
    { const q = rng(7300 + Math.round(z)); for (let k = 0; k < 5; k++) for (let i = 0; i < 11; i++) for (const dx of [-.17, .17]) add(FM.sandbag, at(sbag(q), x + 5 + dx + (q() - .5) * .04, y + .08 + k * .16, z - 3.1 + i * .58 + (k % 2) * .29, Math.PI / 2 + (q() - .5) * .2));
      const rf = new THREE.PlaneGeometry(4.9, 4.9, 28, 1); rf.rotateX(-Math.PI / 2); { const rp = rf.attributes.position; for (let i = 0; i < rp.count; i++) rp.setY(i, Math.abs(Math.sin(rp.getX(i) * Math.PI / .15)) * .03 + rp.getZ(i) * .06); rf.computeVertexNormals(); }
      add(FM.rust, at(rf, x, y + 10.02, z, q() * .2)); for (let i = 0; i < 3; i++) add(FM.tire, at(new THREE.TorusGeometry(.32, .12, 5, 10).rotateX(Math.PI / 2), x + (q() - .5) * 3, y + 10.2, z + (q() - .5) * 3));
      const tp = new THREE.PlaneGeometry(3.6, 1.6, 8, 4); tp.rotateY(Math.PI / 2); { const p2 = tp.attributes.position; for (let i = 0; i < p2.count; i++) { const v = (p2.getY(i) + .8) / 1.6, u = (p2.getZ(i) + 1.8) / 3.6; p2.setX(i, Math.sin(u * Math.PI * 3) * .06 * (1 - v) + (1 - v) * .12); p2.setY(i, p2.getY(i) - Math.sin(u * Math.PI * 3) * .05 * (1 - v)); } tp.computeVertexNormals(); }
      add(FM.canvasG, at(tp, x + 2.13, y + 9.1, z)); }
    G.posts.push({ ...P, pos: V3(x, y + 9, z), alive: true, manned: true });
  }
  // weapons depot compound (the kind of target struck that night)
  const { x, z } = FL.depot; const y = hF(x, z);
  add(FM.concrete, at(box(16, 4.5, 11, 2), x, y + 2.25, z)); add(FM.rust, at(box(16.4, .3, 11.4, 2), x, y + 4.6, z));
  for (let i = 0; i < 4; i++) add(FM.concreteDark, at(box(.4, 2.6, 30, 2), x + (i < 2 ? -14 : 14), y + 1.3, z)); add(FM.concreteDark, at(box(28, 2.6, .4, 2), x, y + 1.3, z - 15)); add(FM.concreteDark, at(box(28, 2.6, .4, 2), x, y + 1.3, z + 15));
  G.depot = { pos: V3(x, y + 2, z), alive: true };
}
// Gaza City sits 1.2-1.8 km off, behind the dust the sea breeze lifts from the fields all afternoon: past ~450 m the town's
// own surfaces lose colour and sink toward the haze before the global fog goes on, so the skyline reads as layered
// silhouettes rather than crisp white boxes. Gated by distance, so a material that is also used up close is untouched there.
// The wrapped materials keep their own shader code; the cache key gets a suffix because the wrapper's source is the same.
const HAZE = `
#ifdef USE_FOG
{ float hzk = smoothstep(450., 1500., length(vViewPosition)), hzl = dot(gl_FragColor.rgb, vec3(.3, .59, .11));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(hzl) * vec3(1.08, 1., .86), hzk * .55); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, hzk * .2); }
#endif
`;
function hazeFar(objs) {
  const seen = new Set();
  const wrap = m => { if (!m || !m.isMeshStandardMaterial || seen.has(m)) return; seen.add(m); const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
    m.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', HAZE + '#include <fog_fragment>'); };
    m.customProgramCacheKey = () => key + '|haze'; };
  for (const o of objs) o.traverse(c => { if (c.isMesh) [].concat(c.material).forEach(wrap); });
}
// What makes the Gaza City skyline read from the border at 1.2-1.8 km is not more boxes but different silhouettes:
// slender minarets with one or two balconies, the concrete "mushroom" water towers and steel tanks on legs, unfinished
// blocks that stop at a bare slab with columns and rebar sticking up (building halted for want of cement), and a tower
// crane or two. Own RNG; merged into one mesh per material (not the 120 m chunks), so the whole lot is a handful of draws.
function skyline() {
  const q = rng(4243), qr = (a, b) => a + (b - a) * q(), parts = new Map(); const put = (m, g) => { if (!parts.has(m)) parts.set(m, []); parts.get(m).push(g.index ? g.toNonIndexed() : g); };
  const spot = () => { const cz = qr(-850, 850); return [-1250 - q() * 480 - Math.abs(cz) * .15, cz]; };
  const free = (x, z) => Math.abs(z - FL.depot.z) > 70 || Math.abs(x - FL.depot.x) > 100;
  for (let i = 0; i < 7; i++) { const [x, z] = spot(); if (!free(x, z)) continue; const y = hF(x, z), H = qr(24, 38), r = qr(.9, 1.3);
    put(MAT.plasterWhite, new THREE.CylinderGeometry(r, r * 1.15, H, 8).translate(x, y + H / 2, z));
    for (const f of q() < .5 ? [.62, .84] : [.8]) put(FM.concrete, new THREE.CylinderGeometry(r + .55, r + .2, .7, 8).translate(x, y + H * f, z));
    put(MAT.plasterWhite, new THREE.CylinderGeometry(r * .7, r * .7, 3, 8).translate(x, y + H + 1.5, z));
    put(q() < .5 ? FM.oliveDark : FM.concreteDark, new THREE.ConeGeometry(r * .85, qr(2.5, 4.5), 8).translate(x, y + H + 3 + 1.5, z));
    if (q() < .6) { const dx = qr(-12, -6); put(FM.concrete, box(qr(12, 18), qr(6, 9), qr(12, 18), 3).translate(x + dx, y + 3.5, z + qr(-4, 4))); put(MAT.plasterWhite, new THREE.SphereGeometry(qr(4, 6), 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x + dx, y + 7.5, z)); } }
  for (let i = 0; i < 8; i++) { const [x, z] = spot(); if (!free(x, z)) continue; const y = hF(x, z), H = qr(16, 26);
    if (q() < .55) { put(FM.concrete, new THREE.CylinderGeometry(1.3, 1.6, H, 8).translate(x, y + H / 2, z)); put(FM.concrete, new THREE.ConeGeometry(4.2, 3, 10).rotateX(Math.PI).translate(x, y + H + 1.5, z)); put(FM.concrete, new THREE.CylinderGeometry(4.4, 4.2, 4, 10).translate(x, y + H + 5, z)); }
    else { const R0 = qr(2.2, 3.2); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(FM.steelDark, box(.25, H, .25, 3).translate(x + a * R0 * .8, y + H / 2, z + b * R0 * .8)); put(FM.steelDark, box(R0 * 1.7, .25, R0 * 1.7, 3).translate(x, y + H * .5, z)); put(FM.rust, new THREE.CylinderGeometry(R0, R0, R0 * 1.4, 10).translate(x, y + H + R0 * .7, z)); } }
  for (let i = 0; i < 12; i++) { const [x, z] = spot(); if (!free(x, z)) continue; const y = hF(x, z), w = qr(12, 20), d = qr(10, 16), nf = 4 + Math.floor(q() * 6), fh = 3.1, ry = q() < .5 ? 0 : Math.PI / 2, done = Math.floor(q() * 3);
    const rot = g => g.rotateY(ry).translate(x, y, z);
    for (let f = 1; f <= nf; f++) put(FM.concreteDark, rot(box(w, .28, d, 3).translate(0, f * fh, 0)));
    if (done) put(FM.concrete, rot(box(w - .2, done * fh, d - .2, 3).translate(0, done * fh / 2, 0)));
    const cx = Math.max(2, Math.round(w / 4.5)), cz = Math.max(2, Math.round(d / 4.5));
    for (let a = 0; a <= cx; a++) for (let b = 0; b <= cz; b++) { const px = -w / 2 + .3 + a * (w - .6) / cx, pz = -d / 2 + .3 + b * (d - .6) / cz; put(FM.concrete, rot(box(.4, nf * fh, .4, 3).translate(px, nf * fh / 2, pz))); if (q() < .8) put(FM.rust, rot(box(.06, 1.1, .06, 3).translate(px, nf * fh + .55, pz))); }
    if (q() < .5) put(FM.concrete, rot(box(.2, fh, d * .6, 3).translate(-w / 2 + .1, nf * fh - fh / 2, 0))); }
  { const [x, z] = [-1330, -360], y = hF(x, z), H = 42; put(FM.rust, box(1.6, H, 1.6, 3).translate(x, y + H / 2, z)); put(FM.rust, box(46, 1.4, 1.2, 3).translate(x + 8, y + H + 1, z)); put(FM.concreteDark, box(4, 2.4, 2, 3).translate(x - 13, y + H, z)); put(FM.steelDark, box(1.8, 1.8, 1.8, 3).translate(x + 1, y + H - 1, z));
    put(FM.steelDark, new THREE.CylinderGeometry(.03, .03, 18, 3).translate(x + 22, y + H - 8, z)); }
  for (const [m, list] of parts) { const g = mergeGeometries(list.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })); const me = new THREE.Mesh(g, m); me.receiveShadow = true; G.scene.add(me); }
}
function town() {
  const n0 = G.scene.children.length;
  const r = rng(40); const list = [];
  // Malaka / Shuja'iyya edge: 3-8 storey blocks in loose clusters, a mosque, water tanks
  for (let i = 0; i < 110; i++) {
    const cz = (r() - .5) * 1800, cx = -1240 - r() * 520 - Math.abs(cz) * .15; if (Math.abs(cz - FL.depot.z) < 60 && Math.abs(cx - FL.depot.x) < 90) continue;
    const w = rr(10, 22), d = rr(10, 20), f = ri(2, 7) + (r() < .12 ? 3 : 0); list.push([cx, cz, w, d, f, rr(-.25, .25) + (r() < .5 ? 0 : Math.PI / 2)]);
  }
  for (let i = 0; i < 26; i++) { const cz = (r() - .5) * 1500, cx = -900 - r() * 300; if (FL.posts.some(p => Math.hypot(p.x - cx, p.z - cz) < 40)) continue; list.push([cx, cz, rr(8, 14), rr(8, 12), ri(1, 3), rr(-.4, .4)]); }
  townBlocks(list);
  const mx = -1270, mz = 180, my = hF(mx, mz);
  add(FM.concrete, at(box(18, 7, 18, 2), mx, my + 3.5, mz)); add(MAT.plasterWhite, at(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mx, my + 7, mz));
  add(MAT.plasterWhite, at(new THREE.CylinderGeometry(1.1, 1.3, 32, 10), mx + 11, my + 16, mz + 8)); add(MAT.plasterWhite, at(new THREE.CylinderGeometry(1.8, 1.8, .6, 12), mx + 11, my + 26, mz + 8)); add(FM.oliveDark, at(new THREE.ConeGeometry(1.2, 4, 10), mx + 11, my + 34, mz + 8));
  skyline();
  palmTrees([[-640, -260, 9], [-655, -232, 10], [-705, 212, 8], [-590, 240, 11], [-760, -40, 9], [-780, 20, 10], [-470, -380, 8], [-520, 330, 9], [-860, 150, 10], [-900, -120, 9], [-980, 300, 10]]);
  flush(); hazeFar(G.scene.children.slice(n0));
}
function israeliSide() {
  const r = rng(77);
  // kibbutz on the horizon (red-roofed houses, water tower) and eucalyptus windbreaks
  const houses = [];
  for (let i = 0; i < 40; i++) { const x = 760 + r() * 260, z = -300 + r() * 600; const w = rr(8, 12), d = rr(7, 10); houses.push([x, z, w, d, r() * .3]); }
  for (const [x, z, w, d, ry] of houses) { add(FM.houseW, at(box(w, 3, d, 3), x, 1.5, z, ry)); const rg = new THREE.CylinderGeometry(.01, w * .75, 2.2, 4, 1); rg.rotateY(Math.PI / 4); rg.scale(1, 1, d / w); add(FM.redRoof, at(rg, x, 4.1, z, ry)); }
  add(FM.concrete, at(new THREE.CylinderGeometry(2.5, 2.5, 5, 12), 820, 16, 60)); add(FM.concreteDark, at(new THREE.CylinderGeometry(.6, .8, 14, 8), 820, 7, 60));
  const trunks = [], crowns = [];
  // eucalyptus crowns as clusters of crossed leaf cards (a lollipop of solid spheres read as a toy tree); the same
  // random draws as before place them, so nothing else in the scene moves
  const tr = rng(177);
  const card = (sz) => { const g = mergeGeometries([0, 1, 2].map(k => new THREE.PlaneGeometry(sz * 2, sz * 2.4).rotateY(k * Math.PI / 3 + tr() * .4).rotateX((tr() - .5) * .5))); return g; };
  const tree = (x, z, h) => { const y = x < 330 ? hF(x, z) : 0; trunks.push(at(new THREE.CylinderGeometry(.18, .32, h * .7, 5), x, y + h * .35, z)); for (let k = 0; k < 5; k++) { const c = card(rr(1.6, 2.6)); c.rotateY(tr() * 6.28); crowns.push(at(c, x + rr(-1.5, 1.5), y + h * rr(.62, .95), z + rr(-1.5, 1.5))); } };
  for (let z = -680; z < 680; z += rr(8, 13)) tree(158 + rr(-2, 2), z, rr(13, 19));
  for (let i = 0; i < 70; i++) tree(700 + r() * 300, -380 + r() * 760, rr(10, 17));
  const tm = new THREE.Mesh(mergeGeometries(trunks), FM.bark); tm.castShadow = true; G.scene.add(tm);
  const cm = new THREE.Mesh(mergeGeometries(crowns), FM.leaf); cm.castShadow = true; cm.receiveShadow = true; G.scene.add(cm);
  // dry grass tufts around the post
  const tuft = new THREE.PlaneGeometry(.5, .35); tuft.translate(0, .17, 0); const t2 = tuft.clone().rotateY(Math.PI / 2); const tg = mergeGeometries([tuft, t2]);
  const gt = canvasTex(64, 64, (g, W, H) => { g.clearRect(0, 0, W, H); for (let i = 0; i < 26; i++) { const x = 4 + Math.random() * 56, h = 20 + Math.random() * 42, lean = (Math.random() - .5) * 18; g.strokeStyle = ['#b19c6c', '#9c8756', '#c4b07e', '#8a7a52'][i % 4]; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + lean * .3, H - h * .6, x + lean, H - h); g.stroke(); } }, { repeat: false });
  const gm = new THREE.MeshStandardMaterial({ map: gt, alphaTest: .4, roughness: 1, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(tg, gm, 1400); const o = new THREE.Object3D(); for (let i = 0; i < 1400; i++) { const x = 20 + r() * 110, z = (r() - .5) * 500; if (Math.abs(x - FL.bermX) < 15 && Math.abs(z) < FL.bermZ + 12) { o.position.set(0, -50, 0); } else o.position.set(x, hF(x, z), z); o.rotation.y = r() * 6; o.scale.setScalar(rr(.6, 1.6)); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); } inst.receiveShadow = true; G.scene.add(inst);
  // invisible bounds for the player
  for (const [x, z, w, d] of [[270, 0, 2, 900], [130, -330, 300, 2], [130, 330, 300, 2]]) { const b = at(new THREE.BoxGeometry(w, 20, d), x, 10, z); b.userData.noOcclude = true; G.colliders.push(b); }
}

// ---------- animated bits: flags, tyre fires (smoke drifts east on the sea breeze) ----------
export function updateWorld(dt) {
  const t = G.time;
  for (const f of G.flags || []) { const p = f.geometry.attributes.position; if (!f.userData.base) f.userData.base = p.array.slice(); const b = f.userData.base; for (let i = 0; i < p.count; i++) { const x = b[i * 3]; const u = (x + .8) / 1.6; p.setZ(i, Math.sin(x * 4 - t * 7) * .09 * u + Math.sin(x * 9 - t * 11) * .03 * u); } p.needsUpdate = true; }
  const W = G.wind; const V = new THREE.Vector3(), P = new THREE.Vector3();
  for (const s of G.fireSpots || []) {
    if (!s.lit) continue; s.t += dt;
    if (R() < dt * 5) G.fx.smoke.emit(P.copy(s.p).add(V.set(rr(-.8, .8), rr(0, .5), rr(-.8, .8))), V.set(W.x * .35 + rr(-.3, .3), rr(2.2, 3.4), W.z * .35 + rr(-.3, .3)), rr(14, 22), rr(1.5, 2.5), rr(14, 24), [.07, .065, .06, .9], [.32, .3, .28, 0], .02, .08);
    if (R() < dt * 14) G.fx.glow.emit(P.copy(s.p).add(V.set(rr(-.6, .6), rr(0, .4), rr(-.6, .6))), V.set(rr(-.3, .3), rr(1.5, 3), rr(-.3, .3)), rr(.3, .7), rr(.8, 1.6), .2, [3, 1.4, .35, .9], [1.2, .3, .05, 0], .5, .8);
  }
}
export function lightFire(i) { const s = G.fireSpots[i]; if (s) s.lit = true; }

export function buildFenceWorld() {
  G.soundEmitters = []; G.footprints = []; G.flags = [];
  materials();
  buildGround();
  barrier();
  berm();
  roadEdges();
  commandPost();
  tankRamps();
  scatter();
  debris();
  tents();
  hamasPosts();
  israeliSide();
  flush();
  town();
  G.birds = makeBirds(V3(-80, 0, 0), 2, 8, 220); // birds wheeling over the fields
}
