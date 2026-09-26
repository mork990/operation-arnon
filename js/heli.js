// UH-60 "Yanshuf" cabin + cockpit interior, crew and passengers (built in the model's own space: nose -X, floor y=-1.57, left +Z)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rr } from './core.js';
import { A } from './assets.js';
import { canvasTex } from './materials.js';

export const CAB = { floor: -1.57, ceil: -.12, x0: -5.2, x1: -1.5, w: 1.16, door: [-3.88, -2.16], gwin: [-5.03, -4.25], gwinY: -1.15 };

// ---------- materials (shared by every helicopter) ----------
let M = null;
function mats() {
  if (M) return M;
  const std = o => new THREE.MeshStandardMaterial(o);
  // quilted sound-proofing blankets (olive-grey, puffy diamonds with stitch lines)
  const quilt = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#6a6c5c'; g.fillRect(0, 0, W, H);
    const s = 32;
    for (let y = -s; y < H + s; y += s) for (let x = -s; x < W + s; x += s) {
      const cx = x + ((y / s) % 2 ? s / 2 : 0), cy = y; const r = g.createRadialGradient(cx - 4, cy - 5, 2, cx, cy, s * .75);
      r.addColorStop(0, 'rgba(255,255,240,.13)'); r.addColorStop(1, 'rgba(0,0,0,.16)'); g.fillStyle = r;
      g.beginPath(); g.moveTo(cx, cy - s / 2); g.lineTo(cx + s / 2, cy); g.lineTo(cx, cy + s / 2); g.lineTo(cx - s / 2, cy); g.closePath(); g.fill(); }
    g.strokeStyle = 'rgba(30,31,24,.55)'; g.lineWidth = 1.4;
    for (let k = -H; k < W + H; k += s) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke(); g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 20 : 200},${Math.random() < .5 ? 20 : 195},${Math.random() < .5 ? 15 : 170},${Math.random() * .05})`; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1 + Math.random() * 3); }
    // grime near the bottom edge (boots, kit)
    const d = g.createLinearGradient(0, H * .7, 0, H); d.addColorStop(0, 'rgba(40,36,28,0)'); d.addColorStop(1, 'rgba(40,36,28,.25)'); g.fillStyle = d; g.fillRect(0, 0, W, H);
  });
  // ribbed aluminium floor with non-skid, tie-down rings every 50 cm
  const floor = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#3e403d'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v - 4},.35)`; g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); }
    g.strokeStyle = 'rgba(15,15,14,.7)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
    for (const [x, y] of [[64, 64], [192, 64], [64, 192], [192, 192]]) { g.fillStyle = '#1b1c1a'; g.fillRect(x - 12, y - 12, 24, 24); g.strokeStyle = '#8d8f88'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(150,140,110,.12)'; for (let i = 0; i < 30; i++) { g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 6 + Math.random() * 20, 3 + Math.random() * 8, Math.random() * 3, 0, 7); g.fill(); }
  });
  const web = canvasTex(64, 64, (g, W, H) => { g.fillStyle = '#5a5e46'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(0,0,0,.35)'; for (let x = 0; x < W; x += 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } g.strokeStyle = 'rgba(255,255,230,.08)'; for (let y = 0; y < H; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } });
  // multi-function displays: attitude, moving map, engine page, FLIR
  const mfd = (kind) => canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = '#050806'; g.fillRect(0, 0, W, H);
    if (kind === 0) { g.fillStyle = '#1d4f8a'; g.fillRect(8, 8, 112, 56); g.fillStyle = '#6b4a2a'; g.fillRect(8, 64, 112, 56); g.strokeStyle = '#e8f0e8'; g.lineWidth = 2; g.beginPath(); g.moveTo(8, 64); g.lineTo(120, 64); g.stroke(); g.strokeStyle = '#f2d24b'; g.beginPath(); g.moveTo(40, 64); g.lineTo(56, 64); g.lineTo(64, 72); g.lineTo(72, 64); g.lineTo(88, 64); g.stroke(); g.fillStyle = '#9ef09a'; g.font = '10px monospace'; g.fillText('120', 10, 20); g.fillText('0450', 90, 20); }
    if (kind === 1) { g.strokeStyle = '#2e8a3a'; g.lineWidth = 1; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(Math.random() * W, Math.random() * H); for (let k = 0; k < 4; k++) g.lineTo(Math.random() * W, Math.random() * H); g.stroke(); } g.strokeStyle = '#6ad0ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, 100); g.bezierCurveTo(40, 60, 70, 90, 118, 20); g.stroke(); g.fillStyle = '#f2d24b'; g.beginPath(); g.moveTo(64, 58); g.lineTo(58, 72); g.lineTo(70, 72); g.fill(); g.strokeStyle = '#9ef09a'; g.beginPath(); g.arc(64, 66, 40, 0, 7); g.stroke(); }
    if (kind === 2) { g.strokeStyle = '#9ef09a'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { const x = 18 + i * 30; g.strokeRect(x - 6, 20, 12, 90); g.fillStyle = i === 2 ? '#f2d24b' : '#3ec04a'; const h = 40 + Math.random() * 40; g.fillRect(x - 5, 110 - h, 10, h); } g.fillStyle = '#9ef09a'; g.font = '9px monospace'; g.fillText('TGT  NG  NR  Q', 8, 12); }
    if (kind === 3) { const r = g.createLinearGradient(0, 0, 0, H); r.addColorStop(0, '#2a2a2a'); r.addColorStop(1, '#8a8a8a'); g.fillStyle = r; g.fillRect(8, 8, 112, 112); g.fillStyle = '#e8e8e8'; g.fillRect(30, 70, 70, 8); g.fillRect(50, 50, 12, 20); g.strokeStyle = '#f0f0f0'; g.strokeRect(54, 54, 20, 20); }
    g.strokeStyle = '#3a3d38'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  }, { repeat: false });
  M = {
    quilt: std({ map: quilt, roughness: .95, color: '#ffffff' }),
    floor: std({ map: floor, roughness: .8, metalness: .35, color: '#ffffff' }),
    frame: std({ color: '#8a8c86', roughness: .45, metalness: .8 }),
    dark: std({ color: '#232421', roughness: .7, metalness: .3 }),
    panel: std({ color: '#2b2d2b', roughness: .85, metalness: .1 }),
    web: std({ map: web, roughness: 1, color: '#ffffff', side: THREE.DoubleSide }),
    red: std({ color: '#8a1f16', roughness: .6 }),
    olive: std({ color: '#4c5236', roughness: .95 }),
    canvas: std({ color: '#5d6347', roughness: 1, side: THREE.DoubleSide }),
    blanket: std({ color: '#55544c', roughness: 1, side: THREE.DoubleSide }),
    blanket2: std({ color: '#4d4a44', roughness: 1, side: THREE.DoubleSide }),
    white: std({ color: '#e8e6df', roughness: .8 }),
    ivbag: new THREE.MeshStandardMaterial({ color: '#dfe8ee', roughness: .15, transparent: true, opacity: .6 }),
    tube: std({ color: '#d8dcd8', roughness: .3 }),
    domeRed: new THREE.MeshStandardMaterial({ color: '#3a0a06', emissive: '#ff2a10', emissiveIntensity: 1.6 }),
    domeWhite: new THREE.MeshStandardMaterial({ color: '#dcdcd0', emissive: '#fff4dc', emissiveIntensity: .7 }),
    btn: new THREE.MeshStandardMaterial({ color: '#10120f', emissive: '#8cff7a', emissiveIntensity: .35, roughness: .6 }),
    visor: std({ color: '#0b0d10', roughness: .08, metalness: .6, envMapIntensity: 1.4 }),
    helmet: std({ color: '#4a5038', roughness: .7 }),
    gun: std({ color: '#1c1d1b', roughness: .5, metalness: .6 }),
    brass: std({ color: '#b08a3a', roughness: .35, metalness: .9 }),
    mfd: [0, 1, 2, 3].map(k => new THREE.MeshStandardMaterial({ map: mfd(k), emissive: '#ffffff', emissiveMap: mfd(k), emissiveIntensity: .9, roughness: .3 })),
    glass: new THREE.MeshStandardMaterial({ color: '#27313a', roughness: .04, metalness: .2, transparent: true, opacity: .38, envMapIntensity: 1.6, depthWrite: false }),
  };
  return M;
}

// ---------- tiny merge-builder: many boxes/cylinders -> one mesh per material ----------
class Kit {
  constructor() { this.parts = new Map(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); }
  put(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this._e.set(rx, ry, rz); this._q.setFromEuler(this._e); this._m.compose(new THREE.Vector3(x, y, z), this._q, new THREE.Vector3(1, 1, 1));
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.applyMatrix4(this._m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(g);
  }
  box(w, h, d, mat, x, y, z, rx, ry, rz, m = .5) { this.put(uvBox(w, h, d, m), mat, x, y, z, rx, ry, rz); }
  cyl(r, len, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 8) { this.put(new THREE.CylinderGeometry(r, r, len, seg), mat, x, y, z, rx, ry, rz); }
  tubeX(x0, x1, y, z, r, mat) { this.cyl(r, Math.abs(x1 - x0), mat, (x0 + x1) / 2, y, z, 0, 0, Math.PI / 2); }
  tubeZ(z0, z1, y, x, r, mat) { this.cyl(r, Math.abs(z1 - z0), mat, x, y, (z0 + z1) / 2, Math.PI / 2, 0, 0); }
  tubeY(y0, y1, x, z, r, mat) { this.cyl(r, Math.abs(y1 - y0), mat, x, (y0 + y1) / 2, z); }
  build(parent) {
    for (const [mat, gs] of this.parts) { const g = mergeGeometries(gs, false); const me = new THREE.Mesh(g, mat); me.castShadow = !mat.transparent; me.receiveShadow = true; parent.add(me); }
    this.parts.clear();
  }
}
function uvBox(w, h, d, m) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) { const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)); const a = nx > .5 ? d : w, b = ny > .5 ? d : h; uv.setXY(i, uv.getX(i) * a / m, uv.getY(i) * b / m); }
  return g;
}

// ---------- posed people (static figures with a slow idle, parented to the aircraft) ----------
function findBone(root, name) { let b = null; root.traverse(c => { if (!b && c.name === name) b = c; }); return b; }
export function figure(model, clip, { speed = 1, t0 = rr(0, 8) } = {}) {
  const src = A.chars[model]; if (!src) return null;
  const root = SkeletonUtils.clone(src.scene);
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false; } });
  const mixer = new THREE.AnimationMixer(root); const c = A.clips[clip] || A.clips.m_idle_neutral_01;
  const a = mixer.clipAction(c); a.setLoop(THREE.LoopPingPong); a.timeScale = speed; a.play(); mixer.update(t0);
  root.userData.mixer = mixer; return root;
}
// attach a mesh to a bone so it stays put in the figure's own frame (helmets, bags) — offset given in figure space
function attachToBone(root, boneName, mesh, off) {
  const b = findBone(root, boneName); if (!b) { root.add(mesh); mesh.position.copy(off); return; }
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bm = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld); // bone in figure space
  const hp = new THREE.Vector3().setFromMatrixPosition(bm);
  const q = new THREE.Quaternion().setFromRotationMatrix(bm).invert();
  mesh.position.copy(off.clone().sub(hp).applyQuaternion(q)); mesh.quaternion.copy(q); b.add(mesh);
}
function headPos(root) { const b = findBone(root, 'Bip01_Head'); root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); return b ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld)) : new THREE.Vector3(0, 1.2, 0); }
function flightHelmet(root) {
  const m = mats(); const hp = headPos(root); const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * .62), m.helmet); shell.scale.set(1, 1.02, 1.12); g.add(shell);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(.162, 16, 8, -Math.PI * .32, Math.PI * .64, Math.PI * .28, Math.PI * .26), m.visor); visor.rotation.y = 0; visor.scale.set(1, 1, 1.12); g.add(visor);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .16, 5), m.dark); boom.rotation.set(0, 0, Math.PI / 2); boom.position.set(.07, -.1, .12); boom.rotation.y = .9; g.add(boom);
  g.traverse(c => { if (c.isMesh) c.castShadow = true; });
  attachToBone(root, 'Bip01_Head', g, hp.clone().add(new THREE.Vector3(0, .04, -.01)));
}
function earDefenders(root) {
  const m = mats(); const hp = headPos(root); const g = new THREE.Group();
  for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .035, 10), m.olive); cup.rotation.z = Math.PI / 2; cup.position.set(s * .09, 0, 0); g.add(cup); }
  const band = new THREE.Mesh(new THREE.TorusGeometry(.095, .01, 4, 12, Math.PI), m.dark); band.position.y = .0; g.add(band);
  attachToBone(root, 'Bip01_Head', g, hp.clone().add(new THREE.Vector3(0, .02, 0)));
}

// ---------- the interior ----------
export function buildHeliInterior(o, v) {
  const m = mats(); const k = new Kit(); const F = CAB.floor, C = CAB.ceil, X0 = CAB.x0, X1 = CAB.x1, W = CAB.w;
  const grp = new THREE.Group(); grp.name = 'interior'; o.add(grp);
  // floor (cabin + cockpit)
  k.box(X1 - (-7.0), .04, W * 2, m.floor, (X1 - 7.0) / 2, F - .02, 0, 0, 0, 0, .5);
  // side walls around the door and gunner-window openings, both sides
  for (const s of [-1, 1]) {
    const z = s * W, H = C - F;
    const panel = (x0, x1, y0, y1) => k.box(x1 - x0, y1 - y0, .04, m.quilt, (x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, 0, .6);
    panel(X0, CAB.gwin[0], F, C); panel(CAB.gwin[0], CAB.gwin[1], F, CAB.gwinY); panel(CAB.gwin[1], CAB.door[0], F, C); panel(CAB.door[1], X1, F, C);
    panel(CAB.door[0], CAB.door[1], -.15, C);
    // door frame (bare metal) and the sliding-door rail above the opening
    k.box(.05, H, .07, m.frame, CAB.door[0], F + H / 2, z); k.box(.05, H, .07, m.frame, CAB.door[1], F + H / 2, z);
    k.box(CAB.door[1] - CAB.door[0], .05, .07, m.frame, (CAB.door[0] + CAB.door[1]) / 2, F + .02, z);
    // cockpit lower side lining and door sill
    k.box(1.8, .62, .04, m.panel, -6.1, F + .31, s * 1.07);
    // grab handles and a fire extinguisher / first-aid bag on the forward wall
    k.tubeX(CAB.door[0] - .35, CAB.door[0] - .05, C - .18, z - s * .05, .012, m.frame);
    // cable/hydraulic runs along the ceiling edge
    k.tubeX(X0, X1, C - .05, s * (W - .12), .022, m.dark); k.tubeX(X0, X1, C - .09, s * (W - .18), .014, m.frame);
  }
  // ceiling + transmission hump, dome lights, overhead grab straps
  k.box(X1 - X0, .04, W * 2, m.quilt, (X0 + X1) / 2, C + .02, 0, 0, 0, 0, .6);
  k.box(1.6, .1, 1.2, m.quilt, -3.1, C - .03, 0, 0, 0, 0, .6);
  for (const x of [-4.6, -3.1, -1.9]) { k.box(.18, .03, .1, x === -3.1 ? m.domeWhite : m.domeRed, x, C - .09, 0); }
  for (let i = 0; i < 5; i++) k.box(.03, .22, .02, m.olive, -4.7 + i * .7, C - .12, .35, 0, 0, .1 * (i % 2 ? 1 : -1));
  // aft bulkhead with a row of four forward-facing troop seats
  k.box(.04, C - F, W * 2, m.quilt, X1, (F + C) / 2, 0, 0, 0, 0, .6);
  const seatRow = (x, zs, face) => { // face: +1 = facing -X (toward the nose)
    for (const z of zs) {
      const sx = x - face * .22;
      k.tubeY(F, F + .42, sx - face * .18, z - .2, .014, m.frame); k.tubeY(F, F + .42, sx - face * .18, z + .2, .014, m.frame);
      k.tubeZ(z - .22, z + .22, F + .42, sx - face * .2, .016, m.frame); k.tubeZ(z - .22, z + .22, F + .42, sx + face * .2, .016, m.frame);
      k.box(.4, .03, .42, m.web, sx, F + .415, z);                       // seat pan (webbing)
      k.box(.03, .5, .42, m.web, x - face * .02, F + .75, z);           // back (webbing on the bulkhead)
      k.box(.02, .5, .05, m.red, x - face * .04, F + .72, z - .14); k.box(.02, .5, .05, m.red, x - face * .04, F + .72, z + .14); // harness straps
    }
  };
  seatRow(X1 - .02, [-.87, -.29, .29, .87], 1);
  // gunner / crew-chief stations at the forward corners, facing out of the windows
  for (const s of [-1, 1]) { const z = s * (W - .45), x = -4.64;
    k.box(.42, .08, .42, m.dark, x, F + .42, z); k.box(.42, .55, .06, m.dark, x, F + .72, z - s * .2);
    k.tubeY(F, F + .42, x, z, .03, m.frame); }
  // pilot + copilot armoured seats, centre console, instrument panel with glowing MFDs, glare shield, overhead console
  for (const s of [-1, 1]) { const z = s * .56, x = -5.72;
    k.box(.5, .08, .5, m.dark, x, F + .42, z); k.box(.08, .8, .52, m.dark, x + .27, F + .82, z); k.box(.06, .7, .06, m.panel, x + .3, F + .8, z - .27); k.box(.06, .7, .06, m.panel, x + .3, F + .8, z + .27);
    k.box(.35, .08, .44, m.olive, x - .02, F + .47, z); k.box(.06, .55, .44, m.olive, x + .22, F + .8, z);
    k.tubeY(F, F + .5, x - .35, z, .015, m.dark); k.box(.04, .04, .06, m.dark, x - .35, F + .52, z); // cyclic
    k.box(.3, .35, .05, m.panel, x - .1, F + .2, z + s * .3); }
  k.box(1.1, .3, .36, m.panel, -6.05, F + .45, 0); k.box(.7, .02, .3, m.btn, -6.05, F + .61, 0);
  k.box(.08, .5, 1.8, m.panel, -6.62, -.88, 0, 0, 0, -.18);
  const mfdGeo = new THREE.PlaneGeometry(.2, .2);
  [[-.72, 0], [-.44, 1], [.1 - .1, 2], [.44, 3], [.72, 0]].forEach(([z, kk], i) => { const pm = new THREE.Mesh(mfdGeo, m.mfd[kk]); pm.position.set(-6.57, -.86, z); pm.rotation.set(0, Math.PI / 2, 0); pm.rotateX(-.18); grp.add(pm); });
  k.box(.35, .06, 1.9, m.panel, -6.55, -.6, 0, 0, 0, .15);
  k.box(1.0, .08, .5, m.panel, -6.0, C - .06, 0);
  for (let i = 0; i < 18; i++) k.box(.02, .012, .02, m.btn, -6.3 + (i % 6) * .1, C - .1, -.16 + Math.floor(i / 6) * .16);
  // medevac litter on the cabin floor (poles, canvas, stirrups)
  const lz = .46, lx0 = -4.95, lx1 = -2.9;
  k.tubeX(lx0 - .15, lx1 + .15, F + .16, lz - .28, .018, m.frame); k.tubeX(lx0 - .15, lx1 + .15, F + .16, lz + .28, .018, m.frame);
  k.box(lx1 - lx0, .01, .55, m.canvas, (lx0 + lx1) / 2, F + .15, lz);
  for (const x of [lx0 + .1, lx1 - .1]) { k.tubeY(F, F + .16, x, lz - .28, .012, m.frame); k.tubeY(F, F + .16, x, lz + .28, .012, m.frame); }
  // IV bag hanging from the ceiling over the casualty, with its drip line
  k.box(.12, .18, .04, m.ivbag, -3.55, C - .35, lz - .05); k.box(.014, .014, .3, m.tube, -3.55, C - .23, lz - .05, Math.PI / 2);
  k.put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-3.55, C - .45, lz - .05), new THREE.Vector3(-3.6, -.9, lz - .12), new THREE.Vector3(-3.72, F + .42, lz - .2)]), 12, .004, 4), m.tube);
  // medical kit, bags, helmets and a stretcher strap on the floor; fire extinguisher by the aft wall
  k.box(.45, .22, .3, m.olive, -4.2, F + .11, -.55); k.box(.14, .14, .01, m.white, -4.2, F + .15, -.705);
  k.box(.35, .3, .25, m.olive, -2.2, F + .15, .72, 0, .3); k.cyl(.07, .4, m.red, X1 - .1, F + .5, -1.05);
  k.box(.3, .25, .2, m.dark, -1.9, F + .12, .1);
  // door-gun pintles (FN MAG) poking out of both gunner windows
  for (const s of [-1, 1]) {
    const z = s * (W + .08), x = -4.62, y = CAB.gwinY + .18;
    k.box(.06, .06, .3, m.frame, x, y - .08, z - s * .12);
    const g = new THREE.Group(); g.position.set(x, y + .05, z); g.rotation.y = s > 0 ? 0 : Math.PI; grp.add(g);
    const gk = new Kit();
    gk.box(.075, .11, .42, m.gun, 0, 0, .05); gk.box(.06, .08, .28, m.gun, 0, -.01, -.3); gk.cyl(.013, .62, m.gun, 0, .01, .56, Math.PI / 2); gk.cyl(.024, .3, m.gun, 0, .01, .42, Math.PI / 2, 0, 0, 10);
    gk.box(.1, .12, .16, m.olive, .09, -.05, .02); gk.box(.04, .03, .14, m.brass, .06, .02, .02, 0, 0, .3); gk.box(.03, .07, .05, m.gun, 0, -.08, -.08);
    gk.box(.02, .05, .02, m.gun, 0, .07, .6);
    gk.build(g); g.traverse(c => { if (c.isMesh) c.castShadow = true; });
  }
  k.build(grp);

  // ---------- people ----------
  const people = []; v.people = people; v.seats = {};
  const place = (fig, x, y, z, ry, extra) => { if (!fig) return null; fig.position.set(x, y, z); fig.rotation.y = ry; if (extra) extra(fig); grp.add(fig); people.push(fig); return fig; };
  // pilots (flight helmets over the models, seated, facing the nose)
  place(figure('team3', 'm_sit_chair_idle_neutral_01', { speed: .6 }), -5.62, F + .05, -.56, -Math.PI / 2, flightHelmet);
  place(figure('team2', 'm_sit_chair_idle_neutral_01', { speed: .5 }), -5.62, F + .05, .56, -Math.PI / 2, flightHelmet);
  // door gunners on the forward stations, looking out
  place(figure('team', 'm_sit_chair_idle_nervous_01', { speed: .7 }), -4.66, F + .02, -(W - .5), Math.PI, flightHelmet);
  place(figure('team3', 'm_sit_chair_idle_nervous_01', { speed: .7 }), -4.66, F + .02, W - .5, 0, flightHelmet);
  // the wounded team leader on the litter, and the flight medic working on him
  const cas = figure('team', 'm_idle_neutral_01', { speed: .15 });
  if (cas) { const hold = new THREE.Group(); hold.position.set(-4.82, F + .3, lz); hold.rotation.set(0, -Math.PI / 2, 0); const inner = new THREE.Group(); inner.rotation.x = -Math.PI / 2; hold.add(inner); inner.add(cas); grp.add(hold); people.push(cas); v.casualty = hold;
    // grey wool blanket over him (chest to feet)
    const bl = new THREE.Mesh(new THREE.CylinderGeometry(.25, .23, 1.45, 12, 1, true, -.25, Math.PI + .5), m.blanket); bl.rotation.z = Math.PI / 2; bl.scale.set(.62, 1, 1.02); bl.position.set(-4.08, F + .29, lz); bl.castShadow = true; grp.add(bl); v.blanket = bl; }
  place(figure('team2', 'm_crouch_idle', { speed: .8 }), -3.45, F, lz - .6, .15, flightHelmet);
  // passengers: hostage seats on the aft row (filled as they board); the player takes the right-hand one
  v.seats.aft = [.29, .87, -.29].map(z => new THREE.Vector3(X1 - .02 - .3, F + .02, z));
  v.seats.player = new THREE.Vector3(-3.0, F + .86, -(W - .26)); // sitting on the right door sill, legs out
  v.addPassenger = (model, i) => {
    const s = v.seats.aft[i % v.seats.aft.length]; const f = figure(model, model.startsWith('hostF') ? 'f_sit_chair_idle_neutral_01' : 'm_sit_chair_idle_nervous_01', { speed: .6 });
    const fig = place(f, s.x, s.y, s.z, -Math.PI / 2, earDefenders); if (!fig) return;
    // wrap them in a blanket (shoulders down to the knees)
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(.19, .25, .58, 12, 1, true, Math.PI * .12, Math.PI * 1.76), m.blanket2); wrap.position.set(s.x + .02, F + .92, s.z); wrap.rotation.y = -Math.PI / 2; wrap.castShadow = true; grp.add(wrap);
  };
  v.updatePeople = (dt) => { const cp = G.camera.position; o.getWorldPosition(_w); if (_w.distanceToSquared(cp) > 70 * 70) return; for (const p of people) p.userData.mixer && p.userData.mixer.update(dt); };
  return grp;
}
const _w = new THREE.Vector3();

// ---------- exterior dressing: slide doors, glazing, IAF roundels ----------
export function dressHeli(o, v) {
  const m = mats();
  o.traverse(c => { if (c.isMesh) { const mt = c.material; if (mt.transparent || /transparent/i.test(mt.name)) c.material = m.glass; else { mt.side = THREE.DoubleSide; mt.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb = vec3(.13, .135, .12);'); }; mt.customProgramCacheKey = () => 'heliInner'; } } });
  const doors = ['doorL', 'glaceL', 'doorR', 'glaceR'].map(n => o.getObjectByName(n)).filter(Boolean);
  doors.forEach(d => { d.userData.p0 = d.position.clone(); });
  v.doorOpen = 0; v.doorTarget = 0;
  v.setDoors = (open) => { v.doorTarget = open ? 1 : 0; };
  v.updateDoors = (dt) => { if (v.doorOpen === v.doorTarget) return; v.doorOpen += Math.sign(v.doorTarget - v.doorOpen) * Math.min(Math.abs(v.doorTarget - v.doorOpen), dt * .8);
    const e = v.doorOpen * v.doorOpen * (3 - 2 * v.doorOpen);
    for (const d of doors) { const L = /L$/.test(d.name); d.position.set(d.userData.p0.x + e * 1.74, d.userData.p0.y, d.userData.p0.z + (L ? 1 : -1) * Math.min(1, e * 6) * .07); } };
  // IAF roundel (white disc, blue Star of David) on both sides of the aft fuselage, and a tail number
  const rt = canvasTex(128, 128, (g, W, H) => { g.fillStyle = '#e9e6dc'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#1f3f8a'; g.lineWidth = 8; for (const r of [0, Math.PI]) { g.beginPath(); for (let i = 0; i < 3; i++) { const a = r + i * Math.PI * 2 / 3 - Math.PI / 2; g[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); } g.closePath(); g.stroke(); } }, { repeat: false });
  const rm = new THREE.MeshStandardMaterial({ map: rt, transparent: true, alphaTest: .4, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2 });
  const num = canvasTex(256, 64, (g, W, H) => { g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, W, H); g.fillStyle = '#1a1c18'; g.font = 'bold 44px Arial'; g.fillText('‫' + '934', 60, 48); }, { repeat: false });
  const nm = new THREE.MeshStandardMaterial({ map: num, transparent: true, alphaTest: .4, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2 });
  const fus = o.getObjectByName('fuselage'); const rc = new THREE.Raycaster(); o.updateMatrixWorld(true);
  const place = (mat, x, y, side, size, w = size) => {
    if (!fus) return; const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    const org = new THREE.Vector3(x, y, side * 3).applyMatrix4(o.matrixWorld), dir = new THREE.Vector3(0, 0, -side).transformDirection(o.matrixWorld);
    rc.set(org, dir); const h = rc.intersectObject(fus, true)[0]; if (!h) return;
    const p = h.point.applyMatrix4(inv); const d = new THREE.Mesh(new THREE.PlaneGeometry(w, size), mat); d.position.copy(p).add(new THREE.Vector3(0, 0, side * .012)); d.rotation.y = side > 0 ? 0 : Math.PI; if (side < 0) d.scale.x = 1; o.add(d);
  };
  for (const s of [-1, 1]) { place(rm, .4, -.55, s, .72); place(nm, 5.0, .05, s, .22, .88); }
}
