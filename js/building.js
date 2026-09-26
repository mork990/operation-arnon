// The target building ("Sapir"): 5-storey residential block with a full stair core and the 3rd-floor apartment where the hostages are held.
import * as THREE from 'three';
import { G, rr, R, pick, rng } from './core.js';
import { MAT, boxUV, canvasTex, TEX } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { A } from './assets.js';

export const B = {
  x0: 33, x1: 47, z0: -19, z1: -7,
  levels: [0, 3.4, 6.4, 9.4, 12.4, 15.4],
  core: { x0: 43.4, x1: 47, z0: -13.6, z1: -7 },
  hostFloor: 3,
  aptDoor: { x: 43.4, z0: -8.3, z1: -7.3 },
  entrance: { x0: 44.2, x1: 45.8 },
  points: {}, blockers: [], lights: [], doors: {},
};
const T = 0.25; // exterior wall thickness
const std2 = (color, roughness = .8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const meshes = [];
function box(mat, x0, x1, y0, y1, z0, z1, { collide = true, uv = 2, cast = true } = {}) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0; if (w <= 0.001 || h <= 0.001 || d <= 0.001) return null;
  const g = boxUV(w, h, d, uv); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  meshes.push([mat, g, cast]); if (collide) G.colliders.push(g.clone());
  return g;
}
function addMesh(mat, g, cast = true, collide = false) { meshes.push([mat, g, cast]); if (collide) G.colliders.push(g.clone()); }

// wall rectangle along X (at z) or Z (at x) with rectangular openings, filled with boxes
function wall(axis, c, a0, a1, y0, y1, openings, mat, t = 0.14, opts = {}) {
  const as = [a0, a1], ys = [y0, y1];
  openings.forEach(o => { as.push(o[0], o[1]); ys.push(o[2], o[3]); });
  const A = [...new Set(as)].filter(v => v >= a0 && v <= a1).sort((p, q) => p - q), Y = [...new Set(ys)].filter(v => v >= y0 && v <= y1).sort((p, q) => p - q);
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < Y.length - 1; j++) {
    const ma = (A[i] + A[i + 1]) / 2, my = (Y[j] + Y[j + 1]) / 2;
    if (openings.some(o => ma > o[0] && ma < o[1] && my > o[2] && my < o[3])) continue;
    if (axis === 'x') box(mat, A[i], A[i + 1], Y[j], Y[j + 1], c - t / 2, c + t / 2, opts);
    else box(mat, c - t / 2, c + t / 2, Y[j], Y[j + 1], A[i], A[i + 1], opts);
  }
}

// window: aluminium frame + glass + optional grill, set in an opening
function windowUnit(axis, c, a0, a1, y0, y1, inward, { grill = true, cover = null, open = false } = {}) {
  const fw = 0.05;
  const frame = (x0, x1, yy0, yy1) => axis === 'x' ? box(MAT.steel, x0, x1, yy0, yy1, c - .04, c + .04, { collide: false }) : box(MAT.steel, c - .04, c + .04, yy0, yy1, x0, x1, { collide: false });
  frame(a0, a1, y0, y0 + fw); frame(a0, a1, y1 - fw, y1); frame(a0, a0 + fw, y0, y1); frame(a1 - fw, a1, y0, y1); frame((a0 + a1) / 2 - .02, (a0 + a1) / 2 + .02, y0, y1);
  const gw = open ? (a1 - a0) / 2 : a1 - a0;
  const pane = new THREE.PlaneGeometry(gw - .06, y1 - y0 - .1);
  if (axis === 'x') pane.translate(a0 + gw / 2, (y0 + y1) / 2, c); else { pane.rotateY(Math.PI / 2); pane.translate(c, (y0 + y1) / 2, a0 + gw / 2); }
  addMesh(glassMat, pane, false);
  if (grill) { const n = Math.round((a1 - a0) / .14); for (let i = 1; i < n; i++) { const a = a0 + i * (a1 - a0) / n; if (axis === 'x') box(MAT.metalDark, a - .008, a + .008, y0, y1, c + inward * .1 - .008, c + inward * .1 + .008, { collide: false, cast: true }); else box(MAT.metalDark, c + inward * .1 - .008, c + inward * .1 + .008, y0, y1, a - .008, a + .008, { collide: false }); } }
  if (cover) { const cg = new THREE.PlaneGeometry(a1 - a0 + .3, y1 - y0 + .3, 6, 6); const p = cg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 6) * .03);
    if (axis === 'x') cg.translate((a0 + a1) / 2, (y0 + y1) / 2, c + inward * .2); else { cg.rotateY(Math.PI / 2); cg.translate(c + inward * .2, (y0 + y1) / 2, (a0 + a1) / 2); }
    addMesh(cover, cg, true); }
}
let glassMat;
// steel door frame on the stairwell side of an apartment door (wall at x = cx, door span B.aptDoor)
function doorFrame(cx, y) {
  const { z0, z1 } = B.aptDoor; const o = { collide: false, uv: 1 };
  box(MAT.metalDark, cx + .07, cx + .12, y, y + 2.18, z0 - .08, z0, o); box(MAT.metalDark, cx + .07, cx + .12, y, y + 2.18, z1, z1 + .08, o); box(MAT.metalDark, cx + .07, cx + .12, y + 2.1, y + 2.18, z0 - .08, z1 + .08, o);
}
// flat fluorescent fixture / bare bulb (emissive only; lighting comes from the room lights)
let tubeMat, bulbMat;
function tube(x, y, z, ry = 0, lit = false) {
  const g = new THREE.BoxGeometry(1.25, .05, .1); g.rotateY(ry); g.translate(x, y - .03, z); meshes.push([MAT.plastic, g, false]);
  const t = new THREE.CylinderGeometry(.018, .018, 1.18, 8); t.rotateZ(Math.PI / 2); t.rotateY(ry); t.translate(x, y - .075, z); meshes.push([lit ? tubeMat : MAT.plastic, t, false]);
}
function bulb(x, y, z) { const w = new THREE.CylinderGeometry(.005, .005, .3, 4); w.translate(x, y - .15, z); meshes.push([MAT.black, w, false]); const b = new THREE.SphereGeometry(.045, 10, 8); b.translate(x, y - .34, z); meshes.push([bulbMat, b, false]); }

function stairs(level0, level1) {
  const { x0, x1, z0, z1 } = B.core; const xm = (x0 + x1) / 2;
  const landN = z0 + .1, landS = z1 - .1; // landings: south (floor) z1-1.4..z1, north (mid) z0..z0+1.4
  const fS = z1 - 1.4, fN = z0 + 1.4; const mid = (level0 + level1) / 2; const n = 12;
  const run = (fS - fN) / n;
  // flight A (east half) from level0 at fS north to mid at fN
  const TZ = MAT.terrazzo, nose = (xa, xb, y, z, dir) => box(MAT.metalDark, xa, xb, y - .025, y + .004, dir > 0 ? z - .03 : z, dir > 0 ? z : z + .03, { collide: false, cast: false });
  for (let i = 0; i < n; i++) { const y = level0 + (mid - level0) * (i + 1) / n; box(TZ, xm + .05, x1 - T, y - .04, y, fS - (i + 1) * run, fS - i * run + .02, { collide: false, uv: 1 }); box(MAT.stairWall, xm + .05, x1 - T, level0 > .5 ? y - (mid - level0) / n - .04 : level0 - .1, y - .04, fS - (i + 1) * run, fS - i * run, { collide: false, uv: 2 }); nose(xm + .05, x1 - T, y, fS - (i + 1) * run, -1); }
  // upper floors: flight A is a sloped slab too (a solid mass would poke into the head-room of the flight below)
  if (level0 > .5) { const L = Math.hypot(fS - fN, mid - level0), sg = boxUV(x1 - T - xm - .05, .16, L + .1, 2); sg.rotateX(Math.atan2(mid - level0, fS - fN)); sg.translate((xm + .05 + x1 - T) / 2, (level0 + mid) / 2 - .14, (fN + fS) / 2); meshes.push([MAT.ceiling, sg, true]); }
  // flight B (west half) from mid at fN south to level1 at fS, on a sloped slab with a plastered soffit
  for (let i = 0; i < n; i++) { const y = mid + (level1 - mid) * (i + 1) / n; box(TZ, x0 + .1, xm - .05, y - .04, y, fN + i * run - .02, fN + (i + 1) * run, { collide: false, uv: 1 }); box(MAT.stairWall, x0 + .1, xm - .05, y - (level1 - mid) / n - .04, y - .04, fN + i * run, fN + (i + 1) * run, { collide: false, uv: 2 }); nose(x0 + .1, xm - .05, y, fN + (i + 1) * run, 1); }
  { const L = Math.hypot(fS - fN, level1 - mid), sg = boxUV(xm - .05 - x0 - .1, .16, L + .1, 2); sg.rotateX(-Math.atan2(level1 - mid, fS - fN)); sg.translate((x0 + .1 + xm - .05) / 2, (mid + level1) / 2 - (level1 - mid) / n - .16, (fN + fS) / 2); meshes.push([MAT.ceiling, sg, true]); }
  // mid landing
  box(TZ, x0 + .1, x1 - T, mid - .04, mid, z0 + .1, fN, { uv: 1 }); box(MAT.concrete, x0 + .1, x1 - T, mid - .2, mid - .04, z0 + .1, fN, { uv: 1 });
  box(MAT.ceiling, x0 + .1, x1 - T, mid - .215, mid - .2, z0 + .1, fN, { collide: false, cast: false });
  // wall-mounted steel handrails following both flights (brackets every metre)
  const hr = (x, za, ya, zb, yb) => { const L = Math.hypot(zb - za, yb - ya); const g = new THREE.CylinderGeometry(.022, .022, L, 8); g.rotateX(Math.atan2(zb - za, yb - ya)); g.translate(x, (ya + yb) / 2 + .9, (za + zb) / 2); meshes.push([MAT.steel, g, true]);
    for (let k = .3; k < 1; k += .35) { const bz = za + (zb - za) * k, by = ya + (yb - ya) * k; const wx = x > xm ? x1 - T : x0 + .07; const br = new THREE.BoxGeometry(Math.abs(x - wx) + .02, .02, .02); br.translate((x + wx) / 2, by + .86, bz); meshes.push([MAT.steel, br, false]); } };
  hr(x1 - T - .07, fS, level0, fN, mid); hr(x0 + .15, fN, mid, fS, level1);
  // collision ramps (invisible)
  const ramp = (xa, xb, za, zb, ya, yb) => { const g = new THREE.BufferGeometry(); const v = new Float32Array([xa, ya, za, xb, ya, za, xa, yb, zb, xb, ya, za, xb, yb, zb, xa, yb, zb]); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); G.colliders.push(g); const g2 = g.clone(); g2.index = null; };
  ramp(xm + .05, x1 - T, fS, fN, level0, mid); ramp(x0 + .1, xm - .05, fN, fS, mid, level1);
  // central wall between flights + railings
  box(MAT.stairWall, xm - .05, xm + .05, level0, level1 - .2, fN, fS, { uv: 2 });
  const rail = (xa, za, ya, zb, yb) => { const n2 = 14; for (let i = 0; i <= n2; i++) { const t = i / n2; const z = za + (zb - za) * t, y = ya + (yb - ya) * t; box(MAT.metalDark, xa - .012, xa + .012, y, y + .9, z - .012, z + .012, { collide: false }); }
    const g = new THREE.CylinderGeometry(.025, .025, Math.hypot(zb - za, yb - ya), 6); g.rotateX(Math.atan2(zb - za, yb - ya)); g.translate(xa, (ya + yb) / 2 + .9, (za + zb) / 2); addMesh(MAT.wood, g); };
}

// ---------- furniture ----------
function sofa(x, z, ry, len, mat) {
  const g = new THREE.Group(); const add = (w, h, d, px, py, pz, m = mat) => { const b = new THREE.Mesh(boxUV(w, h, d, .6), m); b.position.set(px, py, pz); b.castShadow = b.receiveShadow = true; g.add(b); };
  add(len, .42, .85, 0, .21, 0); add(len, .5, .2, 0, .62, -.33); add(.18, .6, .85, -len / 2 + .09, .3, 0); add(.18, .6, .85, len / 2 - .09, .3, 0);
  for (let i = 0; i < Math.round(len / .6); i++) { const c = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .3, 3, 8).rotateZ(Math.PI / 2).scale(1, .8, 1), mat); c.position.set(-len / 2 + .35 + i * .6, .52, -.15); c.castShadow = true; g.add(c); }
  g.position.set(x, B.levels[3], z); g.rotation.y = ry; G.scene.add(g);
  const cb = new THREE.BoxGeometry(len, .8, .85); cb.rotateY(ry); cb.translate(x, B.levels[3] + .4, z); G.colliders.push(cb);
}
// soft furnishings and small props go into the per-material merged buckets: one draw call per fabric instead of one per piece
function floorMattress(x, z, ry, w, d, mat, collide = false, yb = B.levels[3]) { const g = new THREE.BoxGeometry(w, .12, d, 4, 1, 4); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 9 + p.getZ(i) * 5) * .012); g.computeVertexNormals(); g.rotateY(ry); g.translate(x, yb + .06, z); addMesh(mat, g, true); }
function blanketPile(x, z, mat) { for (let i = 0; i < 3; i++) { const w = rr(.8, 1.2), d = rr(.5, .7); const g = new THREE.BoxGeometry(w, .1, d, 3, 1, 3); const p = g.attributes.position; for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) + Math.sin(p.getX(k) * 7) * .02); g.computeVertexNormals(); const px = x + rr(-.1, .1), pz = z + rr(-.1, .1); g.rotateY(rr(-.3, .3)); g.translate(px, B.levels[3] + .05 + i * .1, pz); addMesh(mat, g, true); } }
function table(x, z, w, d, h, mat) { const g = new THREE.Group(); const top = new THREE.Mesh(boxUV(w, .04, d, 1), mat); top.position.y = h; g.add(top); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(.04, h, .04), mat); l.position.set(a * (w / 2 - .05), h / 2, b * (d / 2 - .05)); g.add(l); } g.traverse(c => { if (c.isMesh) c.castShadow = c.receiveShadow = true; }); g.position.set(x, B.levels[3], z); G.scene.add(g); const cb = new THREE.BoxGeometry(w, h, d); cb.translate(x, B.levels[3] + h / 2, z); G.colliders.push(cb); return g; }
// monobloc chair: the one-piece white resin chair of every Gaza home and mourning tent (seat, raked back, arms, splayed legs)
function monoGeo() { const ps = []; const bx = (w, h, d, x, y, z, rx = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z); ps.push(g); };
  bx(.46, .03, .44, 0, .42, .02); bx(.44, .4, .022, 0, .65, -.225, -.17); bx(.46, .05, .035, 0, .86, -.262, -.17);
  for (const sx of [-1, 1]) { bx(.036, .44, .036, sx * .205, .21, .2, -.12, sx * .1); bx(.036, .44, .036, sx * .205, .21, -.18, .12, sx * .1); bx(.045, .028, .44, sx * .238, .63, .01); bx(.03, .2, .03, sx * .238, .525, .2); }
  return mergeGeometries(ps); }
function chair(x, z, ry, mat, n = 1, yb = B.levels[3]) { for (let k = 0; k < n; k++) { const g = monoGeo(); g.translate(0, k * .058, -k * .018); g.rotateY(ry); g.translate(x, yb, z); addMesh(mat, g, true); } }
function bottle(x, y, z, big = false) { const g = new THREE.CylinderGeometry(big ? .13 : .04, big ? .13 : .04, big ? .45 : .26, 10); g.translate(x, y + (big ? .225 : .13), z); addMesh(bottleMat, g, false); }
let bottleMat;

// ---------- real furniture (AWS RoboMaker residential set, MIT-0) ----------
// front of every model faces +z; y = floor level. opts: s (scale [x,y,z] or number), tint (color multiply), collide (default true), rough
function furn(name, x, y, z, ry = 0, opts = {}) {
  const F = A.models.furniture; if (!F) return null; const src = F.scene.getObjectByName(name); if (!src) return null;
  const o = src.clone(true); o.position.set(x, y, z); o.rotation.set(0, ry, 0);
  const s = opts.s ?? 1; if (Array.isArray(s)) o.scale.set(s[0], s[1], s[2]); else o.scale.setScalar(s);
  o.traverse(m => { if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true; m.material = m.material.clone(); const mt = m.material; mt.roughness = opts.rough ?? .72; mt.metalness = Math.min(mt.metalness, .2); mt.envMapIntensity = .8; if (opts.tint) mt.color.multiply(new THREE.Color(opts.tint)); if (opts.darken) mt.color.multiplyScalar(opts.darken); mt.dithering = true; });
  G.scene.add(o); o.updateMatrixWorld(true);
  if (opts.collide !== false) { const b = new THREE.Box3().setFromObject(o); b.min.addScalar(.03); b.max.addScalar(-.03); const sz = b.getSize(new THREE.Vector3()); const c = b.getCenter(new THREE.Vector3()); if (sz.x > .05 && sz.y > .05 && sz.z > .05) G.colliders.push(new THREE.BoxGeometry(sz.x, sz.y, sz.z).translate(c.x, c.y, c.z)); }
  return o;
}
// wooden architrave on both faces of an interior door opening in a wall along z (at x = cx), opening z0..z1, height h
function casing(cx, y, z0, z1, h = 2.1, t = .12) {
  const o = { collide: false, uv: 1 }; for (const sd of [-1, 1]) { const fx = cx + sd * (t / 2 + .012);
    box(MAT.woodLight, fx - .012, fx + .012, y, y + h + .07, z0 - .07, z0, o); box(MAT.woodLight, fx - .012, fx + .012, y, y + h + .07, z1, z1 + .07, o); box(MAT.woodLight, fx - .012, fx + .012, y + h, y + h + .07, z0 - .07, z1 + .07, o); }
}
// interior door leaf from the model, hinge at the origin, leaf running along +z when closed
function doorLeaf(w, h, t = .044) {
  const F = A.models.furniture; const src = F && F.scene.getObjectByName('Door_01'); if (!src) return null;
  const gs = []; let mat = null; src.updateMatrixWorld(true); src.traverse(m => { if (m.isMesh) { const g = m.geometry.clone(); g.applyMatrix4(m.matrix); gs.push(g); mat = mat || m.material; } });
  const g = mergeGeometries(gs.map(q => q.index ? q.toNonIndexed() : q)); g.computeBoundingBox(); const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.scale(w / (b.max.x - b.min.x), h / (b.max.y - b.min.y), t / (b.max.z - b.min.z)); g.rotateY(-Math.PI / 2); g.translate(0, 0, w / 2);
  const mt = mat.clone(); mt.roughness = .6; mt.color.multiplyScalar(.85); return new THREE.Mesh(g, mt);
}

// ---------- wear: a world-space layer over the interior finishes (interiorPaint in materials.js), added at build time ----------
// Rising damp with its salt tide mark, grime where hands and furniture meet the walls, repaired plaster, leak stains under the
// window sills and settlement cracks from the top corners of openings, soot on the ceiling over the burner and the candle,
// dust swept against the skirting. It uses this building's own windows, doors, switches and rooms so the wear sits where
// a real flat wears. Low quality skips the layer; the stains and cracks at openings (a texture fetch per opening) need high.
const CI_PARS = `varying vec3 vWPc;varying vec3 vWNc;uniform sampler2D tNc;uniform float uCiQ;
float ciH(float n){return fract(sin(n*12.9898)*43758.5453);}
float ciLine(float d,float px){return (1.-smoothstep(0.,px*1.3+.0012,abs(d)))*clamp(.005/px,.3,1.);}
float ciStair(vec3 p,vec3 n){float best=-100.;bool A=(p.x+n.x*.05)>45.2;
 for(int f=0;f<5;f++){float l0=f==0?0.:3.4+3.*float(f-1);float l1=3.4+3.*float(f);float m=(l0+l1)*.5;float h;float t=clamp((-8.4-p.z)/3.8,0.,1.);
  if(p.z>=-8.4)h=l0;else if(p.z<=-12.2)h=m;else h=A?l0+t*(m-l0):m+(1.-t)*(l1-m);
  if(h<=p.y+.02&&h>best)best=h;}
 return best;}
const vec4 CI_WZ[7]=vec4[7](vec4(34.2,35.8,1.,2.3),vec4(37.4,39.,1.,2.3),vec4(40.4,42.,1.,2.3),vec4(44.6,45.8,1.,1.9),vec4(34.4,35.8,1.,2.2),vec4(38.2,39.4,1.,2.2),vec4(44.2,45.6,1.1,2.2));
const float CI_PZ[7]=float[7](-7.26,-7.26,-7.26,-7.26,-18.74,-18.74,-18.74);
const vec4 CI_WX[10]=vec4[10](vec4(-17.8,-16.6,1.,2.2),vec4(-14.2,-13.,1.,2.2),vec4(-10.4,-9.,1.,2.3),vec4(-17.4,-16.2,1.1,2.2),vec4(-9.8,-7.6,-1.,2.4),vec4(-14.3,-13.4,-1.,2.1),vec4(-17.3,-16.4,-1.,2.1),vec4(-12.6,-11.8,-1.,2.1),vec4(-16.2,-15.2,-1.,2.1),vec4(-8.3,-7.3,-1.,2.1));
const float CI_PX[10]=float[10](33.26,33.26,33.26,46.74,39.4,40.2,40.2,41.8,41.8,43.4);
const vec3 CI_SW[6]=vec3[6](vec3(39.33,-9.5,1.3),vec3(40.26,-13.1,1.3),vec3(41.74,-12.95,1.3),vec3(33.3,-8.3,1.3),vec3(43.33,-9.,1.3),vec3(43.5,-8.62,1.32));
uniform float uTile;
const vec4 CI_RM[8]=vec4[8](vec4(33.26,39.34,-12.34,-7.26),vec4(39.46,43.32,-9.94,-7.26),vec4(40.26,41.74,-18.74,-9.94),vec4(41.86,43.32,-13.54,-10.06),vec4(41.86,46.74,-18.74,-13.66),vec4(33.26,40.14,-15.34,-12.46),vec4(33.26,40.14,-18.74,-15.46),vec4(43.47,46.74,-13.53,-7.26));
`;
const CI_MAIN = `
{ vec3 wp=vWPc; vec3 wn=normalize(vWNc); vec3 fw=fwidth(vWPc); float pxs=max(max(fw.x,fw.y),fw.z)+1e-5;
 if(uCiQ>.5&&wp.x>33.1&&wp.x<46.9&&wp.z>-18.9&&wp.z<-7.1&&wp.y<15.3){
  bool core=wp.x>43.42&&wp.z>-13.6;
  float hy=core?wp.y-ciStair(wp,wn):(wp.y<3.4?wp.y:mod(wp.y-3.4,3.));
  bool zf=abs(wn.z)>.5; float al=zf?wp.x:wp.z;
  vec3 c=diffuseColor.rgb;
  if(abs(wn.y)<.5){
   vec2 fp=vec2(al,wp.y); vec4 n1=texture2D(tNc,fp*.13+.31); vec4 n2=texture2D(tNc,fp*.53+.17); vec4 n3=texture2D(tNc,fp*2.1+.71);
   float wet=(core?.3:0.)+((wp.x>41.8&&wp.z<-10.)?.2:0.); float dm=smoothstep(.32,.56,n1.g+wet);
   float dd=hy-(mix(.1,.62,n1.r)+.12*(n2.g-.5)+wet*.5);
   c*=mix(vec3(1.),vec3(.72,.67,.58),(1.-smoothstep(-.09,0.,dd))*dm*(.6+.4*n2.b));
   c=mix(c,c*1.16+vec3(.03),exp(-(dd+.012)*(dd+.012)/.00016)*dm*.5);
   c*=1.-.3*exp(-(dd+.03)*(dd+.03)/.0004)*dm;
   c*=1.-.12*(1.-smoothstep(.15,1.1,hy))*smoothstep(.35,.75,n2.r);
   if(uTile>.5&&hy<1.5&&hy>.09&&wp.x>41.8&&wp.z<-10.&&wp.y>9.&&wp.y<12.){
    vec2 tc=vec2(al,hy-.09)/vec2(.2,.2); vec2 ti=floor(tc); vec2 tf=abs(fract(tc)-.5);
    float gw=.5-(.0035+pxs*.5)/.2; float gq=smoothstep(gw-.012,gw,max(tf.x,tf.y));
    float tv=ciH(ti.x*3.7+ti.y*17.1); c*=mix(.93,1.05,tv)*(1.-.05*smoothstep(.3,.5,max(tf.x,tf.y)));
    if(ti.y>=6.) c=mix(c,vec3(.34,.46,.52)*(.9+.2*tv),.8);
    c=mix(c,vec3(.44,.42,.38)*(.8+.4*n2.r)*(1.-.35*(1.-smoothstep(.1,.6,hy))),gq);
   }
   float pv=texture2D(tNc,fp*.045+.53).b+n3.g*.05;
   c*=mix(1.,.95+.08*n1.b,smoothstep(.655,.665,pv)); c*=1.-.16*smoothstep(.645,.655,pv)*(1.-smoothstep(.665,.675,pv));
   float sc=smoothstep(.6,.72,texture2D(tNc,vec2(al*.8,hy*9.)+.13).g)*(1.-smoothstep(.32,.5,hy))*step(.1,hy)+smoothstep(.64,.74,texture2D(tNc,vec2(al*.6,hy*7.)+.61).b)*smoothstep(.72,.78,hy)*(1.-smoothstep(.9,.97,hy))*.7;
   c*=1.-.3*clamp(sc,0.,1.);
   if(uCiQ>.5){
    float gh=0.;
    if(!zf&&hy>.5&&hy<1.95){ for(int i=4;i<10;i++){ if(abs(wp.x-CI_PX[i])>.2)continue; float d=min(abs(al-CI_WX[i].x),abs(al-CI_WX[i].y)); gh+=exp(-d*d/.025)*smoothstep(.5,.95,hy)*(1.-smoothstep(1.5,1.95,hy)); } }
    if(abs(hy-1.3)<.3) for(int i=0;i<6;i++){ vec2 q=vec2(length(wp.xz-CI_SW[i].xy),(hy-CI_SW[i].z)*.8); gh+=.85*exp(-dot(q,q)/.007); }
    c*=mix(vec3(1.),vec3(.73,.71,.68),clamp(gh,0.,1.)*(.5+.5*n3.b));
    if(uCiQ>1.5) for(int i=0;i<10;i++){
     vec4 W; float P;
     if(zf){ if(i>=7)break; W=CI_WZ[i]; P=CI_PZ[i]; if(abs(wp.z-P)>.3)continue; }
     else { W=CI_WX[i]; P=CI_PX[i]; if(abs(wp.x-P)>.3)continue; }
     float u=(al-W.x)/(W.y-W.x); if(u<-1.5||u>2.5)continue;
     float hs=ciH(W.x*7.13+P*3.31);
     if(W.z>0.&&hy<W.z&&u>-.2&&u<1.2){
      float cl=textureLod(tNc,vec2(al*.7,.37+hs),0.).r; float L=.15+1.1*cl*cl*(.45+.55*hs); float t=(W.z-hy)/L;
      float e=smoothstep(-.2,.05,u)*(1.-smoothstep(.95,1.2,u));
      c*=mix(vec3(1.),vec3(.83,.75,.61),(1.-smoothstep(.72,1.,t))*e*(.45+.3*n2.g));
      c*=1.-.22*exp(-(t-.96)*(t-.96)/.004)*e;
     }
     for(int k=0;k<2;k++){ float sx=k==0?-1.:1.; float ax=k==0?W.x:W.y; float hk=ciH(hs*17.3+float(k)*5.1); if(hk<.3)continue;
      float dx=(al-ax)*sx; float dy=hy-W.w; float s=(dx+dy)*.7071; float Lc=.3+.9*ciH(hk*31.7); if(s<0.||s>Lc)continue;
      float pp=(dx-dy)*.7071+(textureLod(tNc,vec2(s*.9,hs+float(k)*.3),0.).g-.5)*.18+(textureLod(tNc,vec2(s*4.3,hs*2.+.5),0.).b-.5)*.05;
      c*=1.-.6*ciLine(pp,pxs)*(1.-smoothstep(Lc*.55,Lc,s)); }
    }
   }
  } else if(wn.y<-.5){
   vec4 n1=texture2D(tNc,wp.xz*.19+.4);
   vec2 k1=wp.xz-vec2(46.25,-18.3); vec2 k2=wp.xz-vec2(33.45,-18.5);
   float so=exp(-dot(k1,k1)/.45)*.8+exp(-dot(k2,k2)/.3)*.55;
   c*=1.-clamp(so,0.,1.)*(.65+.35*n1.r);
   if(uCiQ>.5){ float cz=wp.z+10.9+(texture2D(tNc,vec2(wp.x*.23,.61)).g-.5)*.4; float cx=wp.x-37.2+(texture2D(tNc,vec2(wp.z*.21,.13)).b-.5)*.35;
    c*=1.-.45*ciLine(cz,pxs)*smoothstep(.42,.52,n1.g)-.4*ciLine(cx,pxs)*smoothstep(.45,.55,n1.b); }
  } else {
   vec4 n1=texture2D(tNc,wp.xz*.29+.2); vec4 n2=texture2D(tNc,wp.xz*1.3+.6);
   float de=-1.; for(int i=0;i<8;i++){ vec4 r=CI_RM[i]; de=max(de,min(min(wp.x-r.x,r.y-wp.x),min(wp.z-r.z,r.w-wp.z))); }
   if(de<0.)de=.6;
   c=mix(c,c*vec3(.78,.74,.66),(1.-smoothstep(0.,.06+.24*n1.r,de))*.85);
   c*=1.-.16*smoothstep(.6,.72,n1.b)*n2.g;
  }
  diffuseColor.rgb=c;
 }
}
`;
const CIU = { tNc: { value: null }, uCiQ: { get value() { return G.quality || 0; } } };
// intWall3 is the kitchen and bathroom paint: its lower wall gets the tile grid
function ciWear(mat, tile = 0) {
  if (!mat || mat.userData.ciWear) return; mat.userData.ciWear = true; CIU.tNc.value = TEX.noise; const uTile = { value: tile };
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); Object.assign(sh.uniforms, CIU, { uTile });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPc;varying vec3 vWNc;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPc=(modelMatrix*vec4(transformed,1.)).xyz;vWNc=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CI_PARS).replace('#include <color_fragment>', '#include <color_fragment>\n' + CI_MAIN); };
  mat.customProgramCacheKey = () => key() + '|ciw';
}

// Decals with authored shapes (cracks, leak stains, mould, soot, hand grime, a filled hole, a child's drawing, scuffs), all
// in one atlas and one merged mesh. They multiply the frame (white = no change), so they darken correctly under any light.
let decalM;
function wearAtlas() {
  return canvasTex(1024, 512, (g, w, h) => { const r = rng(4417); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const cell = (i, f) => { g.save(); g.translate((i % 4) * 256, Math.floor(i / 4) * 256); g.beginPath(); g.rect(4, 4, 248, 248); g.clip(); f(); g.restore(); };
    const crack = (x, y, a, len, wd, dep) => { const pts = [[x, y]], br = []; for (let s = 0; s < len; s += 5) { a += (r() - .5) * .7; x += Math.cos(a) * 5; y += Math.sin(a) * 5; pts.push([x, y]); if (dep > 0 && r() < .06) br.push([x, y, a + (r() < .5 ? .9 : -.9), len * (.2 + r() * .3), wd * .6, dep - 1]); }
      for (const [lw, st] of [[wd * 4, 'rgba(170,160,145,.35)'], [wd, 'rgba(62,56,50,.92)']]) { g.lineWidth = lw; g.strokeStyle = st; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.stroke(); }
      br.forEach(b => crack(...b)); };
    cell(0, () => crack(14, 242, -.8, 330, 2.2, 2));
    // leak run hanging from the top edge, dried back in stages: each stage leaves a darker tide line
    cell(1, () => { for (let k = 0; k < 3; k++) { const b = 110 + k * 45 + r() * 20, pts = []; for (let x = 26 + k * 14; x <= 230 - k * 14; x += 5) pts.push([x, b * (.55 + .45 * Math.sin((x - 26) / 204 * Math.PI)) + r() * 12]);
      g.filter = 'blur(3px)'; g.beginPath(); g.moveTo(26 + k * 14, 0); pts.forEach(([x, yy]) => g.lineTo(x, yy)); g.lineTo(230 - k * 14, 0); g.closePath(); g.fillStyle = `rgba(206,180,138,${.26 - k * .06})`; g.fill();
      g.filter = 'blur(.8px)'; g.strokeStyle = 'rgba(150,120,84,.38)'; g.lineWidth = 1.6; g.beginPath(); pts.forEach(([x, yy], i) => (i && r() > .08) ? g.lineTo(x, yy) : g.moveTo(x, yy)); g.stroke(); } g.filter = 'none'; });
    cell(2, () => { const gr = g.createRadialGradient(0, 0, 10, 0, 0, 250); gr.addColorStop(0, 'rgba(186,176,146,.6)'); gr.addColorStop(1, 'rgba(186,176,146,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 1500; k++) { const d = Math.pow(r(), 2.2) * 245, a = r() * Math.PI / 2; g.fillStyle = `rgba(${38 + r() * 22 | 0},${44 + r() * 22 | 0},${32 + r() * 12 | 0},${.25 + r() * .5})`; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, .8 + r() * 2.6 * (1 - d / 260), 0, 7); g.fill(); } });
    cell(3, () => { for (let k = 0; k < 16; k++) { const t = k / 15, cy = 244 - t * 225, rad = 16 + t * 100; const gr = g.createRadialGradient(128, cy, 0, 128, cy, rad); gr.addColorStop(0, `rgba(52,48,44,${.24 * (1 - t * .75)})`); gr.addColorStop(1, 'rgba(52,48,44,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); } });
    cell(4, () => { for (let k = 0; k < 18; k++) { const x = 60 + r() * 136, y = 60 + r() * 140; g.fillStyle = `rgba(112,102,90,${.06 + r() * .1})`; g.beginPath(); g.ellipse(x, y, 14 + r() * 10, 18 + r() * 10, r() * .6 - .3, 0, 7); g.fill(); for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(x - 12 + f * 8, y - 26 - r() * 6, 3.5, 9, 0, 0, 7); g.fill(); } } });
    cell(5, () => { const poly = (cx, cy, rad, n, jit) => { g.beginPath(); for (let i = 0; i <= n; i++) { const a = i / n * 6.283, q = rad * (1 - jit + r() * jit * 2); i ? g.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q * .8) : g.moveTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q * .8); } g.closePath(); };
      poly(128, 128, 80, 22, .22); g.fillStyle = 'rgb(192,190,184)'; g.fill(); g.strokeStyle = 'rgba(112,104,92,.65)'; g.lineWidth = 3; g.stroke();
      for (let k = 0; k < 30; k++) { g.strokeStyle = `rgba(150,146,140,${r() * .3})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const x = 70 + r() * 100, y = 70 + r() * 110; g.moveTo(x, y); g.lineTo(x + 20 + r() * 30, y + (r() - .5) * 8); g.stroke(); }
      for (let k = 0; k < 9; k++) { poly(128 + (r() - .5) * 220, 128 + (r() - .5) * 220, 6 + r() * 14, 8, .45); g.fillStyle = 'rgb(204,198,188)'; g.fill(); g.strokeStyle = 'rgba(86,80,72,.7)'; g.lineWidth = 1.5; g.stroke(); } });
    // a child's crayon drawing low on the wall: house, sun, flowers
    cell(6, () => { g.lineCap = g.lineJoin = 'round'; const cr = (c, lw, f) => { g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); f(); g.stroke(); };
      cr('rgba(196,66,52,.85)', 4, () => { g.moveTo(60, 200); g.lineTo(60, 130); g.lineTo(150, 130); g.lineTo(150, 200); g.lineTo(60, 200); g.moveTo(50, 135); g.lineTo(105, 86); g.lineTo(160, 135); });
      cr('rgba(66,96,186,.85)', 3.5, () => { g.rect(78, 150, 22, 22); g.moveTo(118, 200); g.lineTo(118, 160); g.lineTo(136, 160); g.lineTo(136, 200); });
      cr('rgba(226,156,40,.9)', 4, () => { g.moveTo(227, 55); g.arc(205, 55, 22, 0, 6.3); for (let a = 0; a < 6.28; a += .8) { g.moveTo(205 + Math.cos(a) * 30, 55 + Math.sin(a) * 30); g.lineTo(205 + Math.cos(a) * 42, 55 + Math.sin(a) * 42); } });
      cr('rgba(58,136,66,.85)', 3.5, () => { for (const x of [180, 205, 228]) { g.moveTo(x, 226); g.lineTo(x + 3, 186); } g.moveTo(10, 228); g.lineTo(246, 226); });
      cr('rgba(186,58,118,.8)', 5, () => { for (const x of [186, 211, 234]) { g.moveTo(x + 6, 180); g.arc(x, 180, 6, 0, 6.3); } }); });
    cell(7, () => { g.lineCap = 'round'; for (let k = 0; k < 26; k++) { g.strokeStyle = `rgba(40,38,36,${.15 + r() * .4})`; g.lineWidth = 1 + r() * 3.5; g.beginPath(); const x = 10 + r() * 190, y = 40 + r() * 180; g.moveTo(x, y); g.quadraticCurveTo(x + 20 + r() * 20, y + (r() - .5) * 10, x + 30 + r() * 50, y + (r() - .5) * 14); g.stroke(); } });
  }, { srgb: false, repeat: false });
}
// one decal quad: atlas cell, centre, facing ('x','-x','z','-z','y','-y'), size; flip mirrors it (mould must sit in its corner)
function dec(cell, x, y, z, n, w, h, rot = 0, flip = false) { const g = new THREE.PlaneGeometry(w, h); if (rot) g.rotateZ(rot);
  const uv = g.attributes.uv, c = cell % 4, rw = Math.floor(cell / 4); for (let i = 0; i < uv.count; i++) { const u = flip ? 1 - uv.getX(i) : uv.getX(i); uv.setXY(i, (c + .016 + u * .968) / 4, (1 - rw + .016 + uv.getY(i) * .968) / 2); }
  if (n === 'x') g.rotateY(Math.PI / 2); else if (n === '-x') g.rotateY(-Math.PI / 2); else if (n === '-z') g.rotateY(Math.PI); else if (n === 'y') g.rotateX(-Math.PI / 2); else if (n === '-y') g.rotateX(Math.PI / 2);
  const o = .004, d = { x: [o, 0, 0], '-x': [-o, 0, 0], z: [0, 0, o], '-z': [0, 0, -o], y: [0, o, 0], '-y': [0, -o, 0] }[n]; g.translate(x + d[0], y + d[1], z + d[2]); meshes.push([decalM, g, false]); }

// 12 kg LPG cylinder: body, domed shoulder, foot ring, valve and the handle ring that guards it
function gasCyl(x, z, yb) { const b = new THREE.CylinderGeometry(.15, .15, .5, 12); b.translate(x, yb + .3, z); addMesh(MAT.plasticBlue, b, true);
  const tp = new THREE.SphereGeometry(.15, 12, 3, 0, Math.PI * 2, 0, Math.PI / 2); tp.scale(1, .45, 1); tp.translate(x, yb + .55, z); addMesh(MAT.plasticBlue, tp, true);
  const ft = new THREE.CylinderGeometry(.13, .14, .06, 12, 1, true); ft.translate(x, yb + .03, z); addMesh(MAT.plasticBlue, ft, true);
  const v = new THREE.CylinderGeometry(.02, .025, .09, 6); v.translate(x, yb + .66, z); addMesh(MAT.steel, v, true);
  const ring = new THREE.TorusGeometry(.085, .012, 4, 10); ring.rotateX(Math.PI / 2); ring.translate(x, yb + .71, z); addMesh(MAT.plasticBlue, ring, true); }

// Floor 3 and the stair core, lived in: tile skirting, wear decals, and what a crowded family flat holds after months of war
// (guests' mattresses stacked by day, laundry on a line, water in bottles, aid cartons, a burner on a gas cylinder because
// there is no electricity, the LED strip's car battery). Own generator: the building's other random choices must not move.
function dressFloor3(y, yc) {
  const q = rng(2406), qr = (a, b) => a + (b - a) * q(), Lv = B.levels;
  // skirting: the floor's own marble cut into 9 cm strips, the usual Levantine wall base (axis 'x' = wall along x at z = c)
  const skirt = (axis, c, side, a0, a1, cuts = []) => { const s = [a0, ...cuts.flat(), a1]; for (let i = 0; i < s.length; i += 2) { const p0 = s[i], p1 = s[i + 1]; if (p1 - p0 < .04) continue; const f0 = Math.min(c, c + side * .012), f1 = Math.max(c, c + side * .012);
    if (axis === 'x') box(MAT.tilesB, p0, p1, y, y + .09, f0, f1, { collide: false, uv: 2 }); else box(MAT.tilesB, f0, f1, y, y + .09, p0, p1, { collide: false, uv: 2 }); } };
  skirt('z', 39.34, -1, -12.34, -7.26, [[-9.8, -7.6]]); skirt('z', 39.46, 1, -12.4, -7.26, [[-9.8, -7.6]]);
  skirt('x', -12.34, 1, 33.26, 40.2); skirt('x', -12.46, -1, 33.26, 40.14); skirt('x', -15.34, 1, 33.26, 40.14); skirt('x', -15.46, -1, 33.26, 40.14);
  skirt('z', 40.14, -1, -18.74, -12.46, [[-17.3, -16.4], [-14.3, -13.4]]); skirt('z', 40.26, 1, -18.74, -12.4, [[-17.3, -16.4], [-14.3, -13.4]]);
  skirt('z', 41.74, -1, -18.74, -9.94, [[-16.2, -15.2], [-12.6, -11.8]]); skirt('z', 41.86, 1, -18.74, -10.06, [[-16.2, -15.2], [-12.6, -11.8]]);
  skirt('x', -9.94, 1, 41.8, 43.32); skirt('x', -10.06, -1, 41.86, 43.32); skirt('x', -13.54, 1, 41.86, 43.32); skirt('x', -13.66, -1, 41.86, 43.4);
  skirt('z', 43.317, -1, -13.54, -7.26, [[-8.3, -7.3]]); skirt('x', -13.683, -1, 43.4, 46.74);
  skirt('x', -7.263, -1, 33.26, 43.32); skirt('x', -18.737, 1, 33.26, 46.74); skirt('z', 33.263, 1, -18.74, -7.26); skirt('z', 46.737, -1, -18.74, -13.68);

  // interior sills: a marble slab under every window, proud of the wall by a few centimetres
  for (const [a0, a1, s] of [[34.2, 35.8, 1], [37.4, 39.0, 1], [40.4, 42.0, 1]]) box(MAT.tilesB, a0 - .05, a1 + .05, y + s - .03, y + s + .012, -7.31, -7.13, { collide: false, uv: 1 });
  for (const [a0, a1, s] of [[34.4, 35.8, 1], [38.2, 39.4, 1], [44.2, 45.6, 1.1]]) box(MAT.tilesB, a0 - .05, a1 + .05, y + s - .03, y + s + .012, -18.87, -18.69, { collide: false, uv: 1 });
  for (const [a0, a1, s] of [[-17.8, -16.6, 1], [-14.2, -13.0, 1], [-10.4, -9.0, 1]]) box(MAT.tilesB, 33.13, 33.31, y + s - .03, y + s + .012, a0 - .05, a1 + .05, { collide: false, uv: 1 });
  box(MAT.tilesB, 46.69, 46.87, y + 1.1 - .03, y + 1.1 + .012, -17.45, -16.15, { collide: false, uv: 1 });

  // ----- wear decals -----
  // salon: a crack from the ceiling, mould in the damp north-west corner, a leak under the flat above, a patch, sofa scuffs, a drawing
  dec(0, 33.263, y + 2.3, -11.4, 'x', .9, .8, .3); dec(2, 33.263, y + 2.46, -12.02, 'x', .66, .66, 0, true); dec(1, 37.9, y + 2.33, -12.34, 'z', .85, .95);
  dec(5, 38.85, y + 1.5, -12.34, 'z', .42, .36); dec(7, 36.4, y + .78, -12.34, 'z', 1.0, .36); dec(0, 36.6, y + 2.45, -7.263, '-z', .7, .7, 1.2); dec(6, 33.263, y + .6, -8.8, 'x', .62, .62);
  dec(4, 39.34, y + 1.25, -10.07, '-x', .4, .5); dec(3, 33.263, y + 1.9, -7.9, 'x', .5, .9);
  // kitchen: soot over the burner, greasy hand marks by the sink, mould in the corner
  dec(3, 46.25, y + 1.6, -18.737, 'z', .8, 1.3); dec(4, 43.7, y + 1.3, -18.737, 'z', .55, .5); dec(2, 46.737, y + 2.45, -18.47, '-x', .62, .62); dec(1, 44.9, y + 2.35, -13.683, '-z', .8, .9);
  dec(7, 42.6, y + .3, -18.737, 'z', .8, .3); dec(5, 41.86, y + 1.1, -14.4, 'x', .38, .34);
  dec(0, 41.86, y + 1.95, -17.55, 'x', .8, .8, .6); dec(1, 41.86, y + 2.36, -18.3, 'x', .7, .85); dec(4, 41.86, y + 1.15, -16.42, 'x', .34, .5);
  dec(1, 46.737, y + 2.33, -15.3, '-x', .85, .95); dec(5, 46.737, y + 1.55, -14.55, '-x', .45, .4); dec(7, 46.737, y + .3, -15.9, '-x', .9, .32);
  // ceilings: the roof and the flat above leak through the slab joints; stains, a mould bloom in the corner, shrinkage cracks
  const cy = Lv[4] - .21;
  dec(1, 34.4, cy, -11.4, '-y', 1.2, 1.0, 2.2); dec(0, 37.7, cy, -8.6, '-y', 1.3, 1.1, .9); dec(2, 33.62, cy, -7.62, '-y', .75, .75, -1.57);
  dec(1, 35.4, cy, -17.7, '-y', 1.1, 1.1, .5); dec(2, 33.62, cy, -18.38, '-y', .7, .7); dec(0, 38.2, cy, -16.4, '-y', 1.1, .9, 2.6); dec(1, 44.9, cy, -16.8, '-y', 1.0, .9, -.6);
  // hostages' room: candle soot, corner mould, scuffs and hand marks over the mattresses, a leak, a crack, a patch
  dec(3, 33.263, y + .7, -18.45, 'x', .5, 1.25); dec(2, 33.263, y + 2.46, -18.42, 'x', .66, .66, 0, true); dec(0, 33.263, y + 1.95, -15.95, 'x', .8, .8, -.4);
  dec(7, 35.6, y + .32, -18.737, 'z', 1.3, .4); dec(4, 37.7, y + .95, -18.737, 'z', .55, .5); dec(1, 36.9, y + 2.38, -18.737, 'z', .95, .85);
  dec(5, 36.1, y + 1.25, -15.46, '-z', .45, .4); dec(0, 38.6, y + 2.3, -15.46, '-z', .7, .7, .5); dec(7, 38.2, y + .35, -15.46, '-z', .9, .35);
  // stair landing outside the flat: hand grime at the handle side, a crack over the frame, kick marks, a leak under the window
  dec(4, 43.47, y + 1.05, -8.55, 'x', .32, .55); dec(0, 43.47, y + 2.5, -8.95, 'x', .7, .6, .2); dec(7, 43.47, y + .24, -8.85, 'x', .7, .3); dec(1, 44.1, y + 2.35, -7.263, '-z', .7, .85);
  // stair core, every storey: palms along the handrail wall, cracks, leaks from the landing slab, mould, patches and kicks
  for (let f = 0; f < 4; f++) { const l0 = Lv[f], m = (Lv[f] + Lv[f + 1]) / 2, zA = -9.2 - q() * 2.2, hA = l0 + (m - l0) * Math.min(1, (-8.4 - zA) / 3.8);
    dec(4, 46.737, hA + 1.0, zA, '-x', 1.0, .45, 0, q() < .5); dec(0, 46.737, hA + 1.7 + q() * .4, zA - .8, '-x', .9, .9, q() * 1.5 - .75);
    dec(7, 45.25, hA + .25, zA + .3, 'x', .9, .32); if (q() < .7) dec(5, 45.25, hA + 1.3 + q() * .4, zA - .6, 'x', .42, .38);
    dec(1, 45.25, hA + 2.25, zA - .2, 'x', 1.1, 1.15); dec(0, 45.25, hA + 1.05, zA + .9, 'x', 1.0, .9, q() * 1.2 - .6); dec(4, 45.25, hA + 1.02, zA + 1.5, 'x', .9, .42, 0, true);
    dec(1, 45.9 + q() * .5, m + 2.35, -13.53, 'z', .9, .85); if (q() < .6) dec(2, 46.737, m + 2.45, -13.2, '-x', .6, .6);
    const zs = 44.5 + q() * 1.5; if (f > 0) dec(7, zs, l0 + .25, -7.263, '-z', .8, .3);
    // the flats' supply cables climb the stairwell exposed, clipped to the outer wall parallel to the flight, sagging between clips
    for (let k = 0; k < 3; k++) { const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8, zz = -8.2 - t * 4.2, hh = l0 + (m - l0) * Math.min(1, Math.max(0, (-8.4 - zz) / 3.8)); pts.push(new THREE.Vector3(46.72 - k * .022, hh + 2.05 + k * .03 - Math.sin(t * 8 * Math.PI) * .012 * (i % 2), zz)); }
      addMesh(MAT.black, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, .007 + k * .002, 4), false); }
    { const pv = new THREE.CylinderGeometry(.012, .012, Math.hypot(3.8, m - l0) + .3, 6); pv.rotateX(Math.atan2(m - l0, 3.8) - Math.PI / 2); pv.translate(45.28, (l0 + m) / 2 + 1.75, -10.3); addMesh(MAT.plastic, pv, false); }
    // rubbish waits on the half landing in knotted black bags: collection stopped with the war
    for (let k = 0, nb = 1 + (q() * 2 | 0); k < nb; k++) { const g = new THREE.SphereGeometry(.2 + q() * .06, 8, 6), p = g.attributes.position, ph = q() * 6;
      for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), n = 1 + .12 * Math.sin(X * 17 + ph) * Math.sin(Z * 13 + Y * 9); p.setXYZ(i, X * n, (Y < 0 ? Y * .45 : Y * 1.05) * n, Z * n); }
      g.computeVertexNormals(); g.translate(46.42 - k * .3, m + .1, -13.28 + k * .05); addMesh(MAT.black, g, true);
      const kn = new THREE.ConeGeometry(.035, .1, 5); kn.translate(46.42 - k * .3, m + .36, -13.28 + k * .05); addMesh(MAT.black, kn, true); } }

  // ----- salon -----
  for (let k = 0; k < 4; k++) floorMattress(34.12 + qr(-.04, .04), -7.78 + qr(-.03, .03), qr(-.04, .04), 1.6, .74, [MAT.mattress, MAT.mattress2, MAT.mattress3, MAT.mattress2][k], false, y + k * .115);
  const fold = (x, yy, z, w, d, n, mats, ry = 0) => { for (let k = 0; k < n; k++) { const g = new THREE.BoxGeometry(w + qr(-.05, .05), .07, d + qr(-.04, .04), 3, 1, 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 8 + k) * .008); g.computeVertexNormals(); g.rotateY(ry + qr(-.12, .12)); g.translate(x + qr(-.03, .03), yy + .035 + k * .066, z + qr(-.03, .03)); addMesh(mats[k % mats.length], g, true); } };
  const pillow = (x, yy, z, ry, m) => { const g = new THREE.SphereGeometry(1, 8, 5); g.scale(.25, .07, .16); g.rotateY(ry); g.translate(x, yy + .06, z); addMesh(m, g, true); };
  fold(34.0, y + .46, -7.8, .8, .56, 3, [MAT.blanket, MAT.blanket2, MAT.fabricSofa2]); pillow(34.62, y + .47, -7.72, .2, MAT.mattress3); pillow(34.6, y + .6, -7.85, -.3, MAT.blanket);
  chair(34.55, -9.5, Math.PI / 2 + .45, MAT.plastic);
  // laundry drying on a line strung between the south and west window grilles
  { const la = new THREE.Vector3(35.75, y + 2.05, -7.38), lb = new THREE.Vector3(33.36, y + 2.14, -9.04), L = la.distanceTo(lb), th = Math.atan2(-(lb.z - la.z), lb.x - la.x);
    const ln = new THREE.CylinderGeometry(.004, .004, L, 3); ln.rotateZ(Math.PI / 2); ln.rotateY(th); ln.translate((la.x + lb.x) / 2, (la.y + lb.y) / 2 - .02, (la.z + lb.z) / 2); addMesh(MAT.black, ln, false);
    const gm = [MAT.tarp[0], MAT.blanket2, MAT.tarp[3], MAT.tarp[1], MAT.blanket, MAT.tarp[0]];
    // garments: T-shirts (sleeves out, hem sagging), a towel folded over the line, trousers hung by the hem; hung from the
    // line with pegs, so the top edge follows the line and the cloth pleats between the pegs
    const tee = (w, h) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2 - .12, -.05); sh.lineTo(-w / 2 - .1, -.2); sh.lineTo(-w / 2, -.17); sh.lineTo(-w / 2 + .01, -h); sh.lineTo(w / 2 - .01, -h); sh.lineTo(w / 2, -.17); sh.lineTo(w / 2 + .1, -.2); sh.lineTo(w / 2 + .12, -.05); sh.lineTo(w / 2, 0); sh.lineTo(.07, 0); sh.quadraticCurveTo(0, -.06, -.07, 0); sh.closePath(); return new THREE.ShapeGeometry(sh, 3); };
    const kinds = ['tee', 'towel', 'tee', 'pants', 'towel', 'tee'];
    for (let k = 0, t = .06; k < 6 && t < .9; k++) { const kd = kinds[k]; const w = kd === 'towel' ? qr(.4, .55) : kd === 'pants' ? .34 : qr(.36, .44), h = kd === 'towel' ? qr(.45, .6) : kd === 'pants' ? .85 : qr(.5, .6);
      let g; if (kd === 'tee') g = tee(w, h); else { g = new THREE.PlaneGeometry(w, h, 6, 8); g.translate(0, -h / 2, 0); if (kd === 'pants') { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -h * .9) p.setX(i, p.getX(i) * .85); } }
      g = g.index ? g.toNonIndexed() : g;
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i); p.setZ(i, Math.sin(X * 26 + k * 1.7) * .012 * (1 + -Y * 2) + Math.sin(Y * 7 + X * 3) * .02 + (Y < 0 ? -Y * Y * .06 : 0)); p.setY(i, Y - Math.abs(Math.sin(X / w * Math.PI)) * .015); }
      g.computeVertexNormals();
      const tm = t + w / 2 / L, P = la.clone().lerp(lb, tm); g.rotateY(th); g.translate(P.x, P.y - .02 - Math.sin(tm * Math.PI) * .06, P.z); addMesh(gm[k], g, true);
      if (kd === 'towel') { const b = new THREE.PlaneGeometry(w, h * .45, 1, 1); b.translate(0, -h * .225, -.012); b.rotateY(th); b.translate(P.x, P.y - .02 - Math.sin(tm * Math.PI) * .06, P.z); addMesh(gm[k], b, true); }
      for (const sx of [-.4, .4]) { const pg = new THREE.BoxGeometry(.012, .05, .018); pg.translate(sx * w, -.005, 0); pg.rotateY(th); pg.translate(P.x, P.y - .02 - Math.sin(tm * Math.PI) * .06, P.z); addMesh(MAT.plasticGreen, pg, true); }
      t += (w + (kd === 'tee' ? .24 : 0)) / L + qr(.04, .09); } }
  // the LED strip's car battery on the floor, its leads taped up the wall
  box(MAT.black, 37.22, 37.48, y, y + .2, -12.33, -12.16, { collide: false, uv: 1 });
  for (const dx of [-.07, .07]) { const t = new THREE.CylinderGeometry(.013, .013, .03, 6); t.translate(37.35 + dx, y + .215, -12.245); addMesh(MAT.steel, t, false); }
  { const ld = new THREE.CylinderGeometry(.005, .005, yc - .05 - (y + .2), 4); ld.translate(37.47, (yc - .05 + y + .2) / 2, -12.328); addMesh(MAT.black, ld, false); }

  // ----- hostages' room -----
  // a floral bedsheet nailed over the one uncovered window: it droops between the nails and bellies out at the bottom
  { const g = new THREE.PlaneGeometry(1.55, 1.45, 10, 8); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), yy = p.getY(i), tt = (.725 - yy) / 1.45, nail = Math.abs(Math.sin((x + .775) / 1.55 * Math.PI * 2));
      p.setZ(i, Math.sin(x * 9 + yy * 2) * .02 * tt + tt * tt * .09 + (1 - tt) * nail * .03); if (tt < .05) p.setY(i, yy - nail * .07); }
    g.computeVertexNormals(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 2); g.translate(38.8, y + 1.58, -18.737 + .12); addMesh(MAT.mattress, g, true); }
  const rag = (x, yy, z, w, d, ry, m) => { const g = new THREE.BoxGeometry(w, .05, d, 6, 1, 4); const p = g.attributes.position, ph = q() * 6; for (let i = 0; i < p.count; i++) { const X = p.getX(i), Z = p.getZ(i); p.setY(i, p.getY(i) + Math.sin(X * 7 + ph) * .03 + Math.sin(Z * 9 + ph * 2) * .025 + Math.sin((X + Z) * 15) * .012 + .03); } g.computeVertexNormals(); g.rotateY(ry); g.translate(x, yy, z); addMesh(m, g, true); };
  rag(35.25, y + .13, -18.02, .85, .78, .15, MAT.blanket2); rag(36.38, y + .13, -16.6, .78, .7, -.1, MAT.blanket); rag(39.0, y + .13, -18.08, .7, .72, .3, MAT.blanket2);
  pillow(33.95, y + .12, -18.05, 0, MAT.mattress3); pillow(36.42, y + .12, -17.95, 1.57, MAT.blanket); pillow(37.75, y + .12, -18.12, .1, MAT.mattress2);
  chair(37.6, -15.8, Math.PI + .2, MAT.plastic);
  // water: a shrink-wrapped six, and the empties
  const bot = (x, yy, z, lay = null) => { const b = new THREE.CylinderGeometry(.043, .043, .26, 8), nk = new THREE.CylinderGeometry(.016, .043, .06, 8), cp = new THREE.CylinderGeometry(.017, .017, .02, 6); nk.translate(0, .16, 0); cp.translate(0, .2, 0);
    for (const g of [b, nk, cp]) { g.translate(0, .13, 0); if (lay !== null) { g.rotateZ(Math.PI / 2); g.rotateY(lay); g.translate(0, .043, 0); } g.translate(x, yy, z); } addMesh(bottleMat, mergeGeometries([b, nk]), false); addMesh(MAT.plasticBlue, cp, true); };
  for (let k = 0; k < 6; k++) bot(36.6 + (k % 3) * .088, y, -18.6 + Math.floor(k / 3) * .088);
  for (let k = 0; k < 4; k++) bot(qr(34, 39.5), y, qr(-16.3, -15.7), q() * 6);
  // rations: a carton, tins and a bread bag by the door, a candle stub on a saucer in the corner
  { const ct = boxUV(.42, .3, .32, .5); ct.translate(39.72, y + .15, -17.86); addMesh(MAT.goods[0], ct, false);
    for (let k = 0; k < 3; k++) { const tn = new THREE.CylinderGeometry(.038, .038, .11, 8); tn.translate(39.35 + k * .085, y + .055, -18.15 + (k & 1) * .06); addMesh(MAT.steel, tn, true); }
    const bb = new THREE.BoxGeometry(.34, .07, .24, 4, 1, 3); const p = bb.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 - Math.abs(p.getX(i)) * 1.8) + Math.sin(p.getZ(i) * 20) * .006); bb.computeVertexNormals(); bb.rotateY(.3); bb.translate(39.72, y + .335, -17.86); addMesh(MAT.plastic, bb, false);
    const sc = new THREE.CylinderGeometry(.065, .05, .014, 10); sc.translate(33.45, y + .007, -18.5); addMesh(MAT.plastic, sc, false); const cd = new THREE.CylinderGeometry(.012, .013, .05, 6); cd.translate(33.45, y + .039, -18.5); addMesh(MAT.plastic, cd, false); }

  // ----- kitchen -----
  gasCyl(45.62, -17.9, y);
  { const bn = new THREE.CylinderGeometry(.1, .12, .08, 10); bn.translate(46.25, y + .96, -18.33); addMesh(MAT.metalDark, bn, true);
    const pt = new THREE.CylinderGeometry(.14, .125, .16, 12); pt.translate(46.25, y + 1.08, -18.33); addMesh(MAT.steel, pt, true);
    const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(45.62, y + .7, -17.9), new THREE.Vector3(45.72, y + .9, -18.02), new THREE.Vector3(45.95, y + .97, -18.2), new THREE.Vector3(46.2, y + .96, -18.31)]), 10, .007, 4); addMesh(MAT.black, hose, false);
    const kt = new THREE.CylinderGeometry(.075, .1, .2, 10); kt.translate(45.6, y + 1.02, -18.45); addMesh(MAT.metalDark, kt, true); const pt2 = new THREE.CylinderGeometry(.12, .11, .12, 12); pt2.translate(45.93, y + .98, -18.4); addMesh(MAT.steel, pt2, true);
    for (let k = 0; k < 2; k++) { const jc = boxUV(.19, .42, .3, 1); jc.rotateY(qr(-.12, .12)); jc.translate(46.54, y + .21, -14.95 + k * .33); addMesh([MAT.plasticBlue, MAT.plasticGreen][k], jc, true); }
    const sk = new THREE.CapsuleGeometry(.2, .3, 3, 8); sk.rotateZ(Math.PI / 2); sk.scale(1, .7, .8); sk.translate(45.85, y + .15, -13.98); addMesh(MAT.tarp[1], sk, true);
    for (let k = 0; k < 2; k++) { const ct = boxUV(.48, .3, .34, .5); ct.rotateY(qr(-.1, .1)); ct.translate(45.2, y + .15 + k * .3, -13.9); addMesh(MAT.goods[0], ct, false); }
    const bb = new THREE.BoxGeometry(.36, .08, .26, 4, 1, 3); const p = bb.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 - Math.abs(p.getX(i)) * 1.7) + Math.sin(p.getZ(i) * 20) * .006); bb.computeVertexNormals(); bb.rotateY(-.4); bb.translate(42.75, y + .8, -17.4); addMesh(MAT.plastic, bb, false);
    for (let k = 0; k < 3; k++) { const tn = new THREE.CylinderGeometry(.038, .038, .11, 8); tn.translate(43.15 + k * .08, y + .81, -17.62 + (k & 1) * .05); addMesh(MAT.steel, tn, true); }
    chair(42.32, -18.35, .1, MAT.plastic, 4);
    for (let k = 0; k < 5; k++) { const r0 = qr(.035, .055), hh = qr(.1, .2); const j = new THREE.CylinderGeometry(r0, r0, hh, 8); j.translate(43.35 + k * .11, y + .92 + hh / 2, -18.55 + qr(-.02, .02)); addMesh(k % 3 ? bottleMat : MAT.steel, j, k % 3 === 0); } }
}

export function buildTarget() {
  for (const m of [MAT.intWall, MAT.intWall2, MAT.intWall3, MAT.stairWall, MAT.ceiling, MAT.tilesB, MAT.terrazzo]) ciWear(m, m === MAT.intWall3 ? 1 : 0);
  decalM = new THREE.MeshBasicMaterial({ map: wearAtlas(), blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false });
  glassMat =new THREE.MeshStandardMaterial({ color: '#9fb4c4', roughness: .05, metalness: .1, transparent: true, opacity: .28, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
  bottleMat = new THREE.MeshStandardMaterial({ color: '#bcd4e0', roughness: .15, transparent: true, opacity: .6 });
  tubeMat = new THREE.MeshBasicMaterial({ color: '#f2f6ff' }); bulbMat = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffdca0', emissiveIntensity: .5, roughness: .2 });
  const { x0, x1, z0, z1, levels: Lv, core } = B; const H = Lv[5];
  const ext = MAT.plasterYellow;

  // ----- exterior walls with openings -----
  // south (street) facade z=z1: entrance, stair windows, floor-3 salon windows; other floors get real openings with dark interiors behind curtains
  const opsFor = (face, f) => {
    const ops = []; const y = Lv[f];
    {
      if (face === 'S') {
        if (f === 0) { ops.push([B.entrance.x0, B.entrance.x1, 0, 2.3]); ops.push([34, 42.6, .1, 2.8]); } // entrance + shop shutter opening
        else { ops.push([44.6, 45.8, y + 1.0, y + 1.9]); // stair window (half landing is at +1.5; window centred)
          ops.push([34.2, 35.8, y + 1.0, y + 2.3]); ops.push([37.4, 39.0, y + 1.0, y + 2.3]); ops.push([40.4, 42.0, y + 1.0, y + 2.3]); }
      } else if (face === 'N' && f > 0) { ops.push([34.4, 35.8, y + 1.0, y + 2.2]); ops.push([38.2, 39.4, y + 1.0, y + 2.2]); ops.push([44.2, 45.6, y + 1.1, y + 2.2]); }
      else if (face === 'W' && f > 0) { ops.push([-17.8, -16.6, y + 1.0, y + 2.2]); ops.push([-14.2, -13.0, y + 1.0, y + 2.2]); ops.push([-10.4, -9.0, y + 1.0, y + 2.3]); }
      else if (face === 'E' && f > 0) { ops.push([-17.4, -16.2, y + 1.1, y + 2.2]); }
    }
    return ops;
  };
  const Wsal = MAT.intWall, Wbed = MAT.intWall2, Wkit = MAT.intWall3, Wst = MAT.stairWall;
  // painted lining on the inside of the exterior walls (otherwise the weathered street plaster shows indoors)
  const lining = {
    S: f => f === 3 ? [[x0 + T, 43.4, Wsal], [43.4, x1 - T, Wst]] : [[43.4, x1 - T, Wst]],
    N: f => f === 3 ? [[x0 + T, 40.2, Wbed], [40.2, 41.8, Wsal], [41.8, x1 - T, Wkit]] : [],
    W: f => f === 3 ? [[z0 + T, -12.4, Wbed], [-12.4, z1 - T, Wsal]] : [],
    E: f => f === 3 ? [[z0 + T, -13.6, Wkit], [-13.6, z1 - T, Wst]] : [[-13.6, z1 - T, Wst]],
  };
  for (const face of ['S', 'N', 'W', 'E']) {
    const axis = (face === 'S' || face === 'N') ? 'x' : 'z';
    const c = face === 'S' ? z1 - T / 2 : face === 'N' ? z0 + T / 2 : face === 'W' ? x0 + T / 2 : x1 - T / 2;
    const a0 = axis === 'x' ? x0 : z0, a1 = axis === 'x' ? x1 : z1;
    const ops = []; for (let f = 0; f < 5; f++) ops.push(...opsFor(face, f));
    wall(axis, c, a0, a1, 0, H, ops, ext, T, { uv: 3 });
    const inward = (face === 'S' || face === 'E') ? -1 : 1; const ci = c + inward * (T / 2 + .007);
    for (let f = 0; f < 5; f++) for (const [la, lb, lm] of lining[face](f)) wall(axis, ci, la, lb, Lv[f], lm === Wst ? Lv[f + 1] : (f === 0 ? 3.2 : Lv[f + 1] - .2), opsFor(face, f), lm, .012, { collide: false, uv: 2, cast: false });
  }
  // slab edges and parapet
  for (let f = 1; f < 6; f++) { box(MAT.slab, x0 - .06, x1 + .06, Lv[f] - .2, Lv[f], z1 - .05, z1 + .06, { collide: false }); box(MAT.slab, x0 - .06, x1 + .06, Lv[f] - .2, Lv[f], z0 - .06, z0 + .05, { collide: false }); }
  box(ext, x0, x1, H, H + .9, z1 - .15, z1, { uv: 3 }); box(ext, x0, x1, H, H + .9, z0, z0 + .15, { uv: 3 }); box(ext, x0, x0 + .15, H, H + .9, z0, z1, { uv: 3 }); box(ext, x1 - .15, x1, H, H + .9, z0, z1, { uv: 3 });
  box(MAT.concrete, x0, x1, H - .2, H, z0, z1, { uv: 3 }); // roof slab

  // ----- floor slabs (with stair core cut-out) -----
  for (let f = 0; f < 5; f++) {
    const y = Lv[f], mat = f === 3 ? MAT.tilesB : f === 0 ? MAT.concrete : MAT.slab;
    const uv = f === 3 ? 2 : 3;
    box(mat, x0 + T, core.x0, y - .2, y, z0 + T, z1 - T, { uv });            // west part
    box(mat, core.x0, x1 - T, y - .2, y, z0 + T, core.z0, { uv });           // north-east (kitchen)
    box(MAT.terrazzo, core.x0, x1 - T, y - .2, y, core.z1 - 1.4, z1 - T, { uv: 1 }); // stair landing (south)
    if (f > 0) { box(MAT.ceiling, x0 + T, core.x0, y - .21, y - .2, z0 + T, z1 - T, { collide: false, cast: false }); box(MAT.ceiling, core.x0, x1 - T, y - .21, y - .2, z0 + T, core.z0, { collide: false, cast: false }); box(MAT.ceiling, core.x0, x1 - T, y - .21, y - .2, core.z1 - 1.4, z1 - T, { collide: false, cast: false }); }
  }
  box(MAT.terrazzo, core.x0, x1 - T, -.05, .01, core.z0, core.z1 - 1.4, { uv: 1 }); // lobby floor under the stairs
  // core walls
  box(MAT.intWall3, core.x0 - .07, core.x0 + .07, 0, H, core.z0, core.z1 - T, { uv: 2 }); // placeholder, replaced per floor below
  meshes.pop(); G.colliders.pop();
  for (let f = 0; f < 5; f++) {
    const y = Lv[f], y2 = Lv[f + 1] - .2;
    const door = f > 0 ? [[B.aptDoor.z0, B.aptDoor.z1, y, y + 2.1]] : [];
    wall('z', core.x0, core.z0, core.z1 - T, y, Lv[f + 1], door, Wst, .14, { uv: 2 }); // full height: no slab-edge stripe in the stairwell
    if (f === 3) wall('z', core.x0 - .077, core.z0, core.z1 - T, y, y2, door, Wsal, .012, { uv: 2, collide: false, cast: false });
    wall('x', core.z0, core.x0, x1 - T, y, Lv[f + 1], [], Wst, .14, { uv: 2 });
    if (f === 3) wall('x', core.z0 - .077, core.x0, x1 - T, y, y2, [], Wkit, .012, { uv: 2, collide: false, cast: false });
    if (f < 4) stairs(y, Lv[f + 1]);
    // closed apartment doors on other floors
    if (f > 0 && f !== 3) { const dg = new THREE.BoxGeometry(.05, 2.08, 1.0); dg.translate(core.x0 + .005, y + 1.04, (B.aptDoor.z0 + B.aptDoor.z1) / 2); meshes.push([MAT.aptDoor, dg, true]); G.colliders.push(dg.clone()); doorFrame(core.x0, y); }
    // dark interiors behind other floors' windows (so openings don't look hollow)
    // (painted walls, not black boards: the baked visibility lights them dimly through the window like a real back room)
    if (f > 0 && f !== 3) { box(MAT.intWall2, x0 + T + .02, core.x0 - .1, y + .01, y + 2.7, z1 - T - 3, z1 - T - 2.9, { collide: false, cast: false }); box(MAT.intWall, x0 + T + .02, x1 - T - .1, y + .01, y + 2.7, z0 + T + 2.9, z0 + T + 3, { collide: false, cast: false }); box(MAT.intWall2, x0 + T + 2.9, x0 + T + 3, y + .01, y + 2.7, z0 + T, z1 - T, { collide: false, cast: false });
      // curtains in those windows
      for (const [a, b] of [[34.2, 35.8], [37.4, 39.0], [40.4, 42.0]]) windowUnit('x', z1 - T / 2, a, b, y + 1.0, y + 2.3, -1, { grill: R() < .5, cover: R() < .6 ? pick([MAT.blanket, MAT.blanket2, MAT.tarp[1]]) : null });
      for (const [a, b] of [[34.4, 35.8], [38.2, 39.4]]) windowUnit('x', z0 + T / 2, a, b, y + 1.0, y + 2.2, 1, { cover: pick([MAT.blanket, MAT.tarp[1], null]) });
      windowUnit('z', x0 + T / 2, -10.4, -9.0, y + 1.0, y + 2.3, 1, { cover: MAT.blanket2 }); windowUnit('z', x0 + T / 2, -14.2, -13.0, y + 1.0, y + 2.2, 1, { cover: null }); windowUnit('z', x0 + T / 2, -17.8, -16.6, y + 1.0, y + 2.2, 1, { cover: MAT.tarp[1] });
      windowUnit('x', z0 + T / 2, 44.2, 45.6, y + 1.1, y + 2.2, 1, { cover: MAT.blanket }); windowUnit('z', x1 - T / 2, -17.4, -16.2, y + 1.1, y + 2.2, -1, { cover: null });
    }
    if (f > 0) windowUnit('x', z1 - T / 2, 44.6, 45.8, y + 1.0, y + 1.9, -1, { grill: false, open: true });
  }
  // ----- stairwell dressing: what every Gaza stairwell has on each landing (own generator: the building's other random
  // choices, some of them collision, must not move) -----
  { const sr = rng(314), sp = a => a[Math.floor(sr() * a.length)], sx = core.x0 + .07;
    const pvc = std2('#d9d6cc', .5), meterM = std2('#8d918f', .45, .6), shoeM = ['#2a2522', '#6b4a33', '#1f2a3a', '#8a1f1f', '#c9c2b0', '#3f5f3a', '#b3782f'].map(c => std2(c, .8));
    const scrib = canvasTex(512, 256, (g, w, h) => { g.clearRect(0, 0, w, h); const r = rng(9);
      g.strokeStyle = 'rgba(40,40,60,.75)'; g.lineWidth = 3; for (let k = 0; k < 9; k++) { g.beginPath(); let x = 30 + r() * 420, y = 40 + r() * 170; g.moveTo(x, y); for (let q = 0; q < 6; q++) { x += (r() - .3) * 40; y += (r() - .5) * 26; g.lineTo(x, y); } g.stroke(); }
      g.fillStyle = 'rgba(30,30,80,.8)'; g.font = '600 34px "IBM Plex Mono", monospace'; g.fillText('059' + Math.floor(1e6 + r() * 8e6), 70, 210); g.font = '700 46px "Noto Kufi Arabic", sans-serif'; g.direction = 'rtl'; g.fillText(sp(['محمد', 'أبو أحمد', 'الله أكبر', 'غزة']), 440, 90);
      g.strokeStyle = 'rgba(120,20,20,.7)'; g.beginPath(); g.arc(380, 170, 30, 0, 6.2); g.stroke(); }, { repeat: false });
    const scribM = new THREE.MeshStandardMaterial({ map: scrib, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: .9 });
    for (let f = 0; f < 5; f++) {
      const y = Lv[f];
      // PVC conduit along the core wall under the ceiling, down to the switch by the door and up to the bulb
      const cy = Lv[f + 1] - .45, c1 = new THREE.CylinderGeometry(.013, .013, 5.2, 6); c1.rotateX(Math.PI / 2); c1.translate(sx + .03, cy, -10.0); addMesh(pvc, c1, false);
      const c2 = new THREE.CylinderGeometry(.013, .013, cy - (y + 1.35), 6); c2.translate(sx + .03, (cy + y + 1.35) / 2, -8.62); addMesh(pvc, c2, false);
      box(pvc, sx, sx + .04, y + 1.27, y + 1.37, -8.68, -8.56, { collide: false, cast: false, uv: 1 });
      if (f > 0) { // electricity meters in a steel box beside the flat's door, cables into the slab
        box(meterM, sx, sx + .16, y + 1.45, y + 2.05, -9.45, -8.85, { collide: false, uv: 1 }); box(MAT.black, sx + .161, sx + .165, y + 1.72, y + 1.9, -9.35, -9.0, { collide: false, cast: false, uv: 1 });
        const c3 = new THREE.CylinderGeometry(.02, .02, Lv[f + 1] - (y + 2.05), 6); c3.translate(sx + .08, (Lv[f + 1] + y + 2.05) / 2, -9.15); addMesh(MAT.black, c3, false);
        if (f !== 3) { const n = 3 + Math.floor(sr() * 6); // shoes and sandals left on the landing beside the door (no colliders: the team walks through here)
          for (let k = 0; k < n; k++) { const col = sp(shoeM); for (const side of [-1, 1]) { const g = new THREE.BoxGeometry(.1, .06, .26); g.rotateY(sr() * .5 - .25); g.translate(44.45 + (k % 3) * .24 + side * .06, y + .03, -8.15 + Math.floor(k / 3) * .32 + sr() * .06); addMesh(col, g, true); } }
          if (sr() < .6) { const cr = boxUV(.4, .3, .3, .5); cr.translate(46.4, y + .15, -7.6); addMesh(sp([MAT.plasticBlue, MAT.plasticGreen, MAT.plastic]), cr, true); }
          else { const gc = new THREE.CylinderGeometry(.15, .15, .55, 12); gc.translate(46.45, y + .275, -7.6); addMesh(MAT.plasticBlue, gc, true); } }
      }
      if (sr() < .7) { const q = new THREE.PlaneGeometry(1.2, .6); q.rotateY(Math.PI / 2); q.translate(sx + .006, y + 1.25 + sr() * .3, -10.6 - sr() * 1.2); addMesh(scribM, q, false); }
    }
  }

  // ground floor: shop with closed shutter, entrance door frame (open metal door)
  box(MAT.rustSheet, 34, 42.6, .1, 2.8, z1 - .08, z1 - .02, { uv: 2 });
  box(MAT.black, x0 + T, core.x0 - .08, 0, 3.2, z0 + T, z1 - T - .1, { collide: false, cast: false });
  const gDoor = new THREE.Mesh(boxUV(.05, 2.25, 1.55, 1), MAT.metalDoor); gDoor.position.set(B.entrance.x0 - .02, 1.13, z1 - .8); gDoor.rotation.y = .1; gDoor.castShadow = true; G.scene.add(gDoor);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8.4, .8), MAT.signs[6]); sign.position.set(38.3, 3.05, z1 + .06); G.scene.add(sign);

  // ----- floor 3 apartment -----
  const y = Lv[3], yc = Lv[4] - .2, iw = .12;
  const W = MAT.intWall, W2 = MAT.intWall2, W3 = MAT.intWall3;
  // interior partition walls
  wall('z', 39.4, -12.4, -7 - T, y, yc, [[-9.8, -7.6, y, y + 2.4]], W, iw);          // salon | hall (wide arch)
  wall('x', -12.4, 33 + T, 40.2, y, yc, [], W, iw);                                // salon | bedroom1
  wall('z', 40.2, -19 + T, -12.4, y, yc, [[-14.3, -13.4, y, y + 2.1], [-17.3, -16.4, y, y + 2.1]], W2, iw); // bedrooms | corridor
  wall('x', -15.4, 33 + T, 40.2, y, yc, [], W2, iw);                               // bedroom1 | bedroom2
  wall('z', 41.8, -19 + T, -10, y, yc, [[-12.6, -11.8, y, y + 2.1], [-16.2, -15.2, y, y + 2.1]], W3, iw); // corridor | bath & kitchen
  wall('x', -10, 41.8, core.x0, y, yc, [], W3, iw);                                // hall | bath
  wall('x', -13.6, 41.8, core.x0, y, yc, [], W3, iw);                              // bath | kitchen
  // windows for floor 3 (real, with interiors)
  windowUnit('x', z1 - T / 2, 34.2, 35.8, y + 1.0, y + 2.3, -1, {}); windowUnit('x', z1 - T / 2, 37.4, 39.0, y + 1.0, y + 2.3, -1, { open: true });
  windowUnit('x', z1 - T / 2, 40.4, 42.0, y + 1.0, y + 2.3, -1, {});
  windowUnit('x', z0 + T / 2, 34.4, 35.8, y + 1.0, y + 2.2, 1, { cover: MAT.blanket });  // hostages room: covered
  windowUnit('z', x0 + T / 2, -17.8, -16.6, y + 1.0, y + 2.2, 1, { cover: MAT.blanket2 });
  windowUnit('x', z0 + T / 2, 38.2, 39.4, y + 1.0, y + 2.2, 1, {});                    // bedroom1 north? (belongs to bedroom2 region -> covered)
  windowUnit('z', x0 + T / 2, -14.2, -13.0, y + 1.0, y + 2.2, 1, {});                  // bedroom1
  windowUnit('z', x0 + T / 2, -10.4, -9.0, y + 1.0, y + 2.3, 1, { open: true });       // salon west
  windowUnit('x', z0 + T / 2, 44.2, 45.6, y + 1.1, y + 2.2, 1, {});                    // kitchen north
  windowUnit('z', x1 - T / 2, -17.4, -16.2, y + 1.1, y + 2.2, -1, {});                 // kitchen east
  // curtains in salon
  if (A.models.furniture) { for (const [a, b] of [[34.2, 35.8], [37.4, 39.0]]) for (const sx of [-1, 1]) furn('Curtain_01', (a + b) / 2 + sx * (b - a) / 2 + sx * .02, y + .18, z1 - T - .1, Math.PI / 2, { s: [1, .95, .36], collide: false, rough: 1 });
    furn('Curtain_01', x0 + T + .1, y + .18, -8.55, 0, { s: [1, .95, .36], collide: false, rough: 1 }); }
  else for (const [a, b] of [[34.2, 35.8], [40.4, 42.0]]) { const c = new THREE.PlaneGeometry(.55, 1.6, 8, 1); const p = c.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 22) * .035); c.computeVertexNormals(); c.translate(a + .2, y + 1.55, z1 - T - .12); addMesh(MAT.fabricSofa2, c, true); }
  // salon furniture
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.8), MAT.rugs[0]); carpet.rotation.x = -Math.PI / 2; carpet.rotation.z = Math.PI / 2; carpet.position.set(36.2, y + .012, -9.8); carpet.receiveShadow = true; G.scene.add(carpet);
  const REAL = !!A.models.furniture;
  if (REAL) {
    furn('Sofa_01', 34.5, y, -11.13, 0, { tint: '#9a6a52', rough: .95 });            // L-shaped sofa in the corner (upholstery tinted to a worn brown)
    furn('SofaB_01', 38.55, y, -11.45, -Math.PI / 2 - .35, { tint: '#9a6a52', rough: .95 });
    furn('CoffeeTable_01', 36.0, y, -10.0, 0, { darken: .8 });
    furn('TVCabinet_01', 36.5, y, -7.68, Math.PI / 2, { s: [1, 1, .85], darken: .75 });
    furn('TV_01', 36.5, y + .49, -7.68, Math.PI / 2, { s: .8, collide: false });
    floorMattress(38.4, -12.0, 0, 1.6, .7, MAT.mattress2);
  } else {
    sofa(35.9, -12.0, 0, 2.2, MAT.fabricSofa); sofa(33.75, -9.6, Math.PI / 2, 1.8, MAT.fabricSofa);
    floorMattress(38.4, -12.0, 0, 1.6, .7, MAT.mattress2); floorMattress(36.4, -7.55, 0, 2.6, .6, MAT.mattress);
    table(36.3, -9.7, 1.1, .6, .42, MAT.wood);
    const tv = new THREE.Mesh(boxUV(1.1, .65, .08, 1), MAT.black); tv.position.set(39.2, y + 1.25, -11.3); tv.rotation.y = -Math.PI / 2; G.scene.add(tv);
    table(39.1, -11.3, .4, 1.2, .55, MAT.wood);
  }
  chair(38.2, -8.3, 2.4, MAT.plastic); chair(38.9, -9.2, -2.2, MAT.plastic);
  blanketPile(REAL ? 38.6 : 33.8, REAL ? -12.9 : -12.0, MAT.blanket); bottle(36.0, y + (REAL ? .42 : .44), -9.95); bottle(36.3, y + (REAL ? .42 : .44), -9.8); bottle(38.9, y, -7.6, true); bottle(39.1, y, -7.9, true);
  // battery-powered LED strip in salon (the only light apart from windows). A weak battery strip's colour: at the dark
  // room's exposure a full white read as a laser.
  // Tape taped along the top of the wall: individual SMD dots on a dark backing, so up close it reads as a cheap 12 V strip,
  // and the dots are a dim amber (a sagging car battery) rather than a white line.
  const ledT = canvasTex(256, 8, (g, w, h) => { g.fillStyle = '#1c1a17'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { const gr = g.createRadialGradient(i * 16 + 8, 4, 0, i * 16 + 8, 4, 5); gr.addColorStop(0, '#fff'); gr.addColorStop(.5, 'rgba(255,236,200,.8)'); gr.addColorStop(1, 'rgba(255,220,170,0)'); g.fillStyle = gr; g.fillRect(i * 16, 0, 16, 8); } });
  ledT.repeat.set(2.5 / .267, 1);
  const led = new THREE.Mesh(new THREE.PlaneGeometry(2.5, .012), new THREE.MeshBasicMaterial({ map: ledT, color: '#b98a52', toneMapped: false })); led.position.set(36.2, yc - .045, -12.333); G.scene.add(led);
  // wall details: framed pictures, clock, shelf with household items
  const pic = canvasTex(256, 192, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9ec3d8'); gr.addColorStop(.55, '#e8dcc0'); gr.addColorStop(1, '#6f8a4a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#3f5a2a'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(30 + i * 40, 120 + Math.sin(i) * 8, 26, 0, 7); g.fill(); } g.fillStyle = '#c9b48a'; g.fillRect(150, 90, 50, 40); g.fillStyle = '#8a4a3a'; g.beginPath(); g.moveTo(145, 90); g.lineTo(175, 66); g.lineTo(205, 90); g.fill(); }, { repeat: false });
  const frameM = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: .6 }), picM = new THREE.MeshStandardMaterial({ map: pic, roughness: .4 });
  const picture = (x, yy, z, ry, w, h) => { const f = new THREE.BoxGeometry(w + .08, h + .08, .03); f.rotateY(ry); f.translate(x, yy, z); addMesh(frameM, f, false); const pm = new THREE.PlaneGeometry(w, h); pm.translate(0, 0, .017); pm.rotateY(ry); pm.translate(x, yy, z); addMesh(picM, pm, false); };
  picture(36.2, y + 1.75, -12.33, 0, .9, .6); picture(33.32, y + 1.7, -10.9, Math.PI / 2, .5, .4); picture(36.5, y + 1.6, -15.32, 0, .45, .6);
  const clockF = canvasTex(128, 128, (g) => { g.fillStyle = '#f4efe4'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 5; g.stroke(); for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; g.fillStyle = '#222'; g.fillRect(64 + Math.cos(a) * 48 - 2, 64 + Math.sin(a) * 48 - 2, 5, 5); } g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 30); g.moveTo(64, 64); g.lineTo(64 + 28, 64); g.stroke(); }, { repeat: false });
  const clock = new THREE.Mesh(new THREE.CircleGeometry(.16, 24), new THREE.MeshStandardMaterial({ map: clockF, roughness: .5 })); clock.position.set(39.33, y + 2.15, -9.0); clock.rotation.y = -Math.PI / 2; G.scene.add(clock);
  box(MAT.wood, 33.26, 33.55, y + 1.3, y + 1.34, -8.5, -7.5, { collide: false, uv: 1 });
  for (let i = 0; i < 6; i++) { const hh = rr(.1, .25), dd = rr(.08, .2); const it = new THREE.BoxGeometry(.12, hh, dd); const m = pick([MAT.plasticBlue, MAT.plastic, MAT.woodLight, MAT.fabricSofa2]); it.translate(33.42, y + 1.34 + .08, -8.4 + i * .16); addMesh(m, it, true); }
  for (let i = 0; i < 5; i++) { const pl = new THREE.CylinderGeometry(.12, .1, .02, 14); pl.translate(44.3 + i * .05, y + .93 + i * .02, z0 + T + .45); addMesh(MAT.plastic, pl, false); }
  for (let i = 0; i < 3; i++) { const cup = new THREE.CylinderGeometry(.04, .03, .09, 10); cup.translate(42.95 + (i - 1) * .1, y + .8, -17.7 + i * .15); addMesh(MAT.plasticGreen, cup, true); }
  const prayer = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1.2), MAT.rugs[1]); prayer.rotation.x = -Math.PI / 2; prayer.position.set(38.6, y + .014, -13.8); G.scene.add(prayer);
  for (let i = 0; i < 4; i++) { const cw = rr(.4, .6), cd = rr(.3, .5); const cl = new THREE.BoxGeometry(cw, .08, cd, 3, 1, 3); const m = pick([MAT.blanket, MAT.fabricSofa2, MAT.tarp[0], MAT.tarp[3]]); const px = 39.3 + rr(-.2, .2), pz = -14.5 + rr(-.1, .1); cl.rotateY(rr(-.5, .5)); cl.translate(px, y + .05 + i * .07, pz); addMesh(m, cl, true); }
  // hall: shoes, clothes hooks
  for (let i = 0; i < 7; i++) { const s = new THREE.BoxGeometry(.1, .08, .26); const m = pick([MAT.black, MAT.woodLight, MAT.plasticBlue]); const px = 42.9 + rr(-.1, .1); s.rotateY(rr(-.3, .3)); s.translate(px, y + .04, -9.5 + i * .18); addMesh(m, s, true); }
  for (let i = 0; i < 4; i++) { const c = new THREE.BoxGeometry(.05, .8, .4); c.translate(43.3, y + 1.3, -8.9 - i * .35); addMesh(pick([MAT.blanket, MAT.fabricSofa2, MAT.tarp[0]]), c, true); }
  // kitchen
  if (REAL) {
    furn('KitchenCabinet_01', 45.33, y, -17.12, 0, { s: [-1, 1, 1], darken: .92 });
    furn('Refrigerator_01', 42.3, y, -14.2, Math.PI / 2, { s: [.72, .95, .9], darken: .95 });
  } else {
    box(MAT.woodLight, 44.0, x1 - T, y, y + .88, z0 + T, z0 + T + .6, { uv: 1 }); box(MAT.concrete, 43.95, x1 - T, y + .88, y + .92, z0 + T, z0 + T + .65, { uv: 1 });
    box(MAT.woodLight, x1 - T - .6, x1 - T, y, y + .88, z0 + T + .6, -15.4, { uv: 1 });
    box(MAT.plastic, 42.0, 42.75, y, y + 1.7, -14.4, -13.8, { uv: 1 }); // fridge (no power)
    box(MAT.woodLight, 44.1, x1 - T - .1, y + 1.5, y + 2.2, z0 + T, z0 + T + .35, { uv: 1, collide: false });
    const stove = new THREE.Mesh(boxUV(.6, .12, .4, 1), MAT.steel); stove.position.set(45.6, y + .98, z0 + T + .3); G.scene.add(stove);
  }
  gasCyl(46.35, -14.1, y);
  for (let i = 0; i < 4; i++) bottle(43.9 + i * .3, y, -14.2, true);
  if (REAL) { furn('KitchenTable_01', 42.95, y, -17.5, 0, { s: [1, .95, .7], darken: .85 }); furn('ChairA_01', 42.35, y, -17.6, Math.PI / 2, { collide: false }); furn('ChairA_01', 43.55, y, -17.2, -Math.PI / 2, { collide: false }); }
  else { table(44.3, -16.2, 1.0, .7, .75, MAT.woodLight); chair(44.3, -15.6, Math.PI, MAT.plasticGreen); chair(43.6, -16.3, Math.PI / 2, MAT.plastic);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.14, .12, .16, 12), MAT.steel); pot.position.set(45.4, y + 1.08, z0 + T + .3); G.scene.add(pot); }
  // bathroom
  box(MAT.plastic, 42.0, 42.5, y, y + .42, -12.1, -11.3, { uv: 1 }); const buck = new THREE.CylinderGeometry(.16, .13, .3, 10); buck.translate(43.0, y + .15, -10.4); addMesh(MAT.plasticBlue, buck, true);
  // bedroom 1 (family): bed + wardrobe + mattress
  if (REAL) {
    furn('Bed_01', 35.3, y, -14.33, 0, { darken: .9 }); furn('NightStand_01', 33.72, y, -15.1, 0, { darken: .85 });
    furn('Wardrobe_01', 38.9, y, -15.0, 0, { darken: .85 });
    furn('ShoeRack_01', 42.6, y, -9.8, 0, { darken: .85 });
    furn('Trash_01', 46.3, y, -15.3, 0, { collide: false });
    // interior doors (open) and architraves
    const dl = (w, x, z, ry) => { const d = doorLeaf(w, 2.06); if (d) { d.position.set(x, y, z); d.rotation.y = ry; d.castShadow = d.receiveShadow = true; G.scene.add(d); } };
    dl(.9, 40.14, -13.4, -Math.PI / 2 - 1.45); dl(.8, 41.86, -11.8, Math.PI / 2 - .1); dl(1.0, 41.86, -15.2, Math.PI / 2 + .15);
    casing(40.2, y, -14.3, -13.4); casing(40.2, y, -17.3, -16.4); casing(41.8, y, -12.6, -11.8); casing(41.8, y, -16.2, -15.2);
  } else {
    box(MAT.wood, 33 + T, 34.9, y, y + .45, -15.2, -13.2, { uv: 1 }); floorMattress(34.1, -14.2, Math.PI / 2, 1.8, 1.6, MAT.mattress3);
    box(MAT.wood, 37.6, 39.9, y, y + 2.0, -15.25, -14.7, { uv: 1 });
    blanketPile(36.2, -12.9, MAT.blanket2);
  }
  // bedroom 2 (hostages): mattresses on the floor, blanket-covered windows, water, bucket; dim
  floorMattress(34.6, -18.0, 0, 1.9, .8, MAT.mattress); floorMattress(36.4, -17.2, Math.PI / 2 + .1, 1.9, .8, MAT.mattress2); floorMattress(38.4, -18.1, .05, 1.9, .8, MAT.mattress3);
  blanketPile(33.9, -16.1, MAT.blanket); bottle(35.8, y, -18.5, true); bottle(37.1, y, -18.6); bottle(37.3, y, -18.55);
  const bucket = new THREE.CylinderGeometry(.17, .14, .32, 10); bucket.translate(39.6, y + .16, -18.4); addMesh(MAT.plasticGreen, bucket, true);
  const pl = new THREE.CylinderGeometry(.15, .15, .03, 10); pl.translate(37.8, y + .015, -16.4); addMesh(MAT.steel, pl, true);
  dressFloor3(y, yc);

  // ----- doors -----
  // breach door: apartment entrance from the stair landing (hinge at north edge, opens inward/west)
  const dg = new THREE.BoxGeometry(.05, 2.08, 1.0); dg.translate(0, 1.04, -.5);
  const door = new THREE.Mesh(dg, MAT.aptDoor); doorFrame(core.x0, y); door.position.set(core.x0 + .04, y, B.aptDoor.z1); door.castShadow = true; G.scene.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), MAT.steel); knob.position.set(-.05, 1.0, -.88); door.add(knob);
  B.doors.apt = { mesh: door, open: false, blocker: { x0: core.x0 - .12, x1: core.x0 + .12, z0: B.aptDoor.z0, z1: B.aptDoor.z1, y0: y, y1: y + 2.1 } };
  B.blockers.push(B.doors.apt.blocker);
  // hostages room door (wooden, closed; opened by interaction)
  const hd = boxUV(.04, 2.05, .9, 1); hd.translate(0, 1.025, .45);
  const hdoor = doorLeaf(.9, 2.05) || new THREE.Mesh(hd, MAT.wood); hdoor.position.set(40.2, y, -17.3); hdoor.castShadow = true; G.scene.add(hdoor);
  B.doors.host = { mesh: hdoor, open: false, blocker: { x0: 40.1, x1: 40.3, z0: -17.3, z1: -16.4, y0: y, y1: y + 2.1 } };
  B.blockers.push(B.doors.host.blocker);

  // ----- fixtures and small details (floor 3) -----
  tube(36.4, yc, -9.4, 0); tube(42.6, yc, -11.2, Math.PI / 2); tube(36.6, yc, -13.9, 0); tube(36.6, yc, -17.1, 0); tube(44.6, yc, -16.4, 0); bulb(42.9, yc, -12.9);
  { // ceiling fan over the salon (no power: still)
    const fx = 36.3, fz = -9.9; const rod = new THREE.CylinderGeometry(.015, .015, .35, 6); rod.translate(fx, yc - .17, fz); meshes.push([MAT.metalDark, rod, false]);
    const hub = new THREE.CylinderGeometry(.11, .09, .12, 14); hub.translate(fx, yc - .4, fz); meshes.push([MAT.plastic, hub, true]);
    for (let k = 0; k < 3; k++) { const bl = new THREE.BoxGeometry(.62, .012, .12); bl.translate(.42, 0, 0); bl.rotateX(.08); bl.rotateY(k * 2.094 + .3); bl.translate(fx, yc - .42, fz); meshes.push([MAT.plastic, bl, true]); }
  }
  // surface-run conduit and switches (typical retrofitted wiring)
  const conduit = (xa, xb, za, zb, yy) => { const g = new THREE.BoxGeometry(Math.max(.025, Math.abs(xb - xa)), .025, Math.max(.025, Math.abs(zb - za))); g.translate((xa + xb) / 2, yy, (za + zb) / 2); meshes.push([MAT.plastic, g, false]); };
  conduit(33.3, 39.3, -12.32, -12.32, yc - .12); conduit(39.33, 39.33, -12.3, -7.3, yc - .12); conduit(39.33, 39.33, -9.7, -9.7, y + 1.3); conduit(40.26, 40.26, -18.7, -12.5, yc - .12); conduit(41.74, 41.74, -18.7, -10.1, yc - .14);
  for (const [sx, sz, ry] of [[39.33, -9.5, 1], [40.26, -13.1, 1], [41.74, -12.95, 1], [33.3, -8.3, 1], [43.33, -9.0, 1]]) { const sw = new THREE.BoxGeometry(.03, .1, .08); sw.translate(sx, y + 1.3, sz); meshes.push([MAT.plastic, sw, false]); }
  // stairwell: cable bundle and a water pipe running up the full height (retrofitted services)
  for (let k = 0; k < 4; k++) { const cg = new THREE.CylinderGeometry(.012, .012, H, 5); cg.translate(46.55 - k * .035, H / 2, -7.4); meshes.push([MAT.black, cg, false]); }
  { const wp = new THREE.CylinderGeometry(.03, .03, H, 8); wp.translate(46.55, H / 2, -13.45); meshes.push([MAT.plasticGreen, wp, true]); }
  // mid-landings: a bare bulb and old posters / a sticker on the facing wall, a meter box on the lower ones
  for (let f = 0; f < 5; f++) { const m = (Lv[f] + Lv[f + 1]) / 2; bulb(45.2, m + 2.78, -12.9);
    const c = (f * 3 + 1) % 8, u0 = (c % 4) / 4, v0 = c < 4 ? .5 : 0; const pg = new THREE.PlaneGeometry(.55, .75); const uv = pg.attributes.uv; uv.setXY(0, u0 + .004, v0 + .5 - .004); uv.setXY(1, u0 + .25 - .004, v0 + .5 - .004); uv.setXY(2, u0 + .004, v0 + .004); uv.setXY(3, u0 + .25 - .004, v0 + .004);
    pg.translate(44.2 + (f % 2) * 1.6, m + 1.55, core.z0 + .075); meshes.push([MAT.posters, pg, false]); }
  // stairwell: bare bulbs on each landing, meter board and clutter in the ground-floor lobby, shoes outside the other flats
  for (let f = 0; f < 5; f++) { bulb(45.9, Lv[f + 1] - .2, -7.9); if (f > 0 && f !== 3) for (let i = 0; i < 5; i++) { const s = new THREE.BoxGeometry(.1, .08, .26); s.rotateY(rr(-.4, .4)); s.translate(43.7 + rr(0, .5), Lv[f] + .04, -8.4 + rr(-.1, .5)); meshes.push([pick([MAT.black, MAT.woodLight, MAT.plasticBlue]), s, true]); } }
  { const mb = (x0b, x1b, y0b, y1b, z0b, z1b, m) => box(m, x0b, x1b, y0b, y1b, z0b, z1b, { collide: false, uv: 1 });
    mb(43.48, 43.52, 1.1, 2.1, -10.9, -9.5, MAT.steel); for (let i = 0; i < 6; i++) mb(43.52, 43.62, 1.3 + (i >> 1) * .28, 1.52 + (i >> 1) * .28, -10.8 + (i & 1) * .6, -10.4 + (i & 1) * .6, MAT.plastic);
    for (let i = 0; i < 5; i++) mb(43.53, 43.55, 2.1, 3.15, -10.7 + i * .12, -10.68 + i * .12, MAT.black);
    // flour sacks, jerrycans, gas cylinder, stacked plastic chairs under the stairs
    for (let i = 0; i < 5; i++) { const sk = new THREE.CapsuleGeometry(.22, .35, 3, 8); sk.rotateZ(Math.PI / 2); sk.scale(1, .7, .8); sk.translate(43.95 + (i % 2) * .05, .18 + Math.floor(i / 2) * .26, -11.6 + (i % 3) * .55); meshes.push([MAT.tarp[1], sk, true]); }
    for (let i = 0; i < 3; i++) { const jc = boxUV(.3, .42, .18, 1); jc.translate(44.3 + i * .34, .21, -12.6); meshes.push([pick([MAT.plasticBlue, MAT.plasticGreen, MAT.plastic]), jc, true]); }
    const gc = new THREE.CylinderGeometry(.16, .16, .6, 12); gc.translate(44.9, .3, -11.2); meshes.push([MAT.plasticBlue, gc, true]);
    for (let i = 0; i < 4; i++) { const ch = boxUV(.44, .04, .42, 1); ch.translate(44.5, .45 + i * .07, -10.2); meshes.push([MAT.plastic, ch, true]); } const cl = new THREE.BoxGeometry(.46, .45, .44); cl.translate(44.5, .225, -10.2); meshes.push([MAT.plastic, cl, true]);
    G.colliders.push(new THREE.BoxGeometry(1.4, 1.1, 2.4).translate(44.2, .55, -11.4)); }

  // ----- exterior dressing: RC frame, sills and hoods, balconies, AC units, pipes, roof tanks and solar panels -----
  { const conc = MAT.concrete, o = { collide: false, uv: 1 };
    const fb = (face, a0, a1, y0, y1, d0, d1, m, opt = o) => { // box in facade coords: a along facade, d outward from the wall surface
      if (face === 'S') box(m, a0, a1, y0, y1, z1 + d0, z1 + d1, opt); else if (face === 'N') box(m, a0, a1, y0, y1, z0 - d1, z0 - d0, opt);
      else if (face === 'W') box(m, x0 - d1, x0 - d0, y0, y1, a0, a1, opt); else box(m, x1 + d0, x1 + d1, y0, y1, a0, a1, opt); };
    const wins = { S: [[34.2, 35.8, 1.0, 2.3], [37.4, 39.0, 1.0, 2.3], [40.4, 42.0, 1.0, 2.3], [44.6, 45.8, 1.0, 1.9]], N: [[34.4, 35.8, 1.0, 2.2], [38.2, 39.4, 1.0, 2.2], [44.2, 45.6, 1.1, 2.2]], W: [[-17.8, -16.6, 1.0, 2.2], [-14.2, -13.0, 1.0, 2.2], [-10.4, -9.0, 1.0, 2.3]], E: [[-17.4, -16.2, 1.1, 2.2]] };
    for (const face in wins) for (let f = 1; f < 5; f++) for (const [a0, a1, h0, h1] of wins[face]) { const yy = Lv[f]; fb(face, a0 - .1, a1 + .1, yy + h0 - .07, yy + h0, 0, .14, conc); fb(face, a0 - .18, a1 + .18, yy + h1 + .06, yy + h1 + .14, 0, .3, MAT.slab); }
    // corner columns and frame columns on the street face (exposed concrete, slightly proud of the plaster)
    for (const [cx, cz] of [[x0, z1], [x1, z1], [x0, z0], [x1, z0]]) { const sx = cx === x0 ? 1 : -1, sz = cz === z1 ? -1 : 1; box(conc, Math.min(cx - sx * .07, cx + sx * .34), Math.max(cx - sx * .07, cx + sx * .34), 0, H + .95, Math.min(cz - sz * .07, cz + sz * .34), Math.max(cz - sz * .07, cz + sz * .34), o); }
    for (const a of [36.6, 39.7]) fb('S', a - .16, a + .16, 3.2, H + .9, 0, .06, conc); fb('S', 43.1, 43.45, 0, H + .9, 0, .06, conc);
    for (const a of [37.05, 44.1]) fb('N', a - .16, a + .16, 0, H + .9, 0, .06, conc); fb('W', -12.0, -11.7, 0, H + .9, 0, .06, conc);
    // entrance surround and a step
    fb('S', B.entrance.x0 - .2, B.entrance.x0, 0, 2.5, 0, .1, conc); fb('S', B.entrance.x1, B.entrance.x1 + .2, 0, 2.5, 0, .1, conc); fb('S', B.entrance.x0 - .2, B.entrance.x1 + .2, 2.3, 2.5, 0, .1, conc);
    // balconies (floors 2 and 4) on the street face: slab, plastered parapet or steel railing, a water tank, laundry line
    for (const f of [2, 4]) { const yy = Lv[f]; const a0 = 37.1, a1 = 42.3; fb('S', a0, a1, yy - .2, yy, 0, 1.15, MAT.slab, { collide: true, uv: 1 });
      if (f === 2) { fb('S', a0, a1, yy, yy + .95, 1.03, 1.15, ext, { collide: true, uv: 3 }); fb('S', a0, a0 + .12, yy, yy + .95, 0, 1.15, ext, { collide: true, uv: 3 }); fb('S', a1 - .12, a1, yy, yy + .95, 0, 1.15, ext, { collide: true, uv: 3 }); }
      else { fb('S', a0, a1, yy + .92, yy + .97, 1.08, 1.13, MAT.metalDark); for (let a = a0 + .05; a < a1; a += .14) fb('S', a, a + .018, yy, yy + .92, 1.09, 1.11, MAT.metalDark); }
      const tk = new THREE.CylinderGeometry(.3, .3, .8, 12); tk.translate(a1 - .5, yy + .4, z1 + .55); meshes.push([MAT.black, tk, true]);
      const ln = new THREE.CylinderGeometry(.005, .005, a1 - a0 - .3, 4); ln.rotateZ(Math.PI / 2); ln.translate((a0 + a1) / 2, yy + 1.9, z1 + .9); meshes.push([MAT.black, ln, false]);
      for (let k = 0; k < 6; k++) { const cw = rr(.35, .7), ch = rr(.4, .9); const cg = new THREE.PlaneGeometry(cw, ch, 3, 3); const p = cg.attributes.position; for (let q = 0; q < p.count; q++) p.setZ(q, Math.sin(p.getX(q) * 9 + k) * .025); cg.translate(a0 + .4 + k * .75, yy + 1.9 - ch / 2, z1 + .9); meshes.push([pick([MAT.blanket, MAT.blanket2, MAT.fabricSofa2, MAT.tarp[0], MAT.mattress2]), cg, true]); } }
    // split-AC outdoor units
    const ac = (face, a, yy) => { fb(face, a - .4, a + .4, yy, yy + .52, .02, .32, MAT.plastic); fb(face, a - .3, a + .3, yy + .08, yy + .46, .32, .325, MAT.metalDark); };
    ac('S', 36.2, Lv[1] + .3); ac('S', 43.0, Lv[4] + .4); ac('W', -11.4, Lv[3] + .5); ac('E', -15.2, Lv[2] + .6); ac('N', 41.5, Lv[1] + .5);
    // PVC drain pipes from the roof
    for (const [px, pz] of [[x1 + .1, -7.6], [x0 - .1, -18.4], [46.3, z0 - .1]]) { const pg = new THREE.CylinderGeometry(.05, .05, H + .9, 8); pg.translate(px, (H + .9) / 2, pz); meshes.push([MAT.black, pg, true]); }
    // roof: tanks, solar panels on a frame, a dish, rebar stubs
    for (const [tx, tz, white] of [[35, -9, 0], [36.4, -9, 0], [44.5, -17, 1]]) { const tk = new THREE.CylinderGeometry(white ? .6 : .55, white ? .6 : .55, white ? 1.2 : 1.1, 16); tk.translate(tx, H + (white ? .6 : .55), tz); meshes.push([white ? MAT.plastic : MAT.black, tk, true]); }
    for (let k = 0; k < 4; k++) { const pn = new THREE.BoxGeometry(1.0, .04, 1.7); pn.rotateX(-.45); pn.translate(38.2 + k * 1.1, H + .75, -15.5); meshes.push([MAT.glassDark, pn, true]); const leg = new THREE.BoxGeometry(.04, .7, .04); leg.translate(38.2 + k * 1.1, H + .35, -14.9); meshes.push([MAT.metalDark, leg, true]); }
    const dish = new THREE.SphereGeometry(.45, 14, 6, 0, Math.PI * 2, 0, .9); dish.rotateX(-1.2); dish.translate(42, H + .5, -8); meshes.push([MAT.plastic, dish, true]);
  }

  // ----- interior light (daylight through openings) -----
  // daylight through the windows comes from the baked ambient visibility (gi.js); area lights here used to shine through walls
  // the strip's light sits below and in front of it: a point 20 cm under the slab burnt a hot spot into the ceiling
  // a weak warm fill, a metre out from the wall: close to the strip it burnt a hot spot into the wall and ceiling
  const ledL = new THREE.PointLight('#ffc98e', .32, 6, 2); ledL.position.set(36.2, yc - .75, -11.3); G.scene.add(ledL); B.lights.push(ledL);
  // sun shafts through the salon and stairwell windows (dusty air)
  const shaftTex = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,240,210,.55)'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(.2, 'rgba(0,0,0,0)'); gx.addColorStop(.8, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, w, h); }, { repeat: false });
  const shaftM = new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .22, side: THREE.DoubleSide, fog: false });
  B.shafts = [];
  for (const [x0w, x1w] of [[34.2, 35.8], [37.4, 39.0], [40.4, 42.0]]) {
    const w = x1w - x0w, len = 3.2; const g = new THREE.PlaneGeometry(w, len); g.translate(0, -len / 2, 0);
    const m = new THREE.Mesh(g, shaftM); m.position.set((x0w + x1w) / 2, y + 2.25, z1 - T - .05);
    m.rotation.set(-Math.PI / 2 + .55, 0, 0); m.renderOrder = 5; G.scene.add(m); B.shafts.push(m);
  }
  // lights stay in the scene permanently (toggling visibility recompiles every shader = multi-second freeze); only intensity changes
  for (const l of B.lights) { l.userData.base = l.intensity; l.intensity = 0; }

  // ----- key positions -----
  const P = B.points;
  P.stack = [new THREE.Vector3(44.3, y, -7.7), new THREE.Vector3(45.3, y, -7.6), new THREE.Vector3(46.2, y, -7.8), new THREE.Vector3(45.8, y + 1.2, -10.5)];
  P.guards = [
    { p: new THREE.Vector3(35.2, y, -9.0), yaw: -Math.PI / 2 + .3, model: 'guard1' },  // salon (faces +x toward hall)
    { p: new THREE.Vector3(44.1, y, -14.9), yaw: -2.2, model: 'guard2' },           // kitchen
    { p: new THREE.Vector3(41.0, y, -15.9), yaw: -Math.PI, model: 'guard1' },       // corridor near hostages' door
  ];
  P.upstairsGuard = { p: new THREE.Vector3(45.0, Lv[4], -7.9), yaw: -Math.PI / 2, model: 'guard2' };
  P.family = [{ p: new THREE.Vector3(37.4, y, -13.0), yaw: 2.4, model: 'civF1' }, { p: new THREE.Vector3(36.7, y, -12.85), yaw: -2.6, model: 'civM2' }];
  P.hostages = [{ p: new THREE.Vector3(34.6, y, -18.0), yaw: Math.PI / 2, model: 'hostM1' }, { p: new THREE.Vector3(36.4, y, -17.4), yaw: Math.PI / 2 + .3, model: 'hostM2' }, { p: new THREE.Vector3(38.3, y, -18.2), yaw: Math.PI / 2 - .2, model: 'hostM3' }];
  P.hostRoom = { x0: 33.2, x1: 40.1, z0: -18.8, z1: -15.5, y };
  P.aptZone = { x0: 33, x1: 43.4, z0: -19, z1: -7, y0: y - .5, y1: y + 2.5 };
  P.entrance = new THREE.Vector3(45, 0, -6.4);
  P.street = new THREE.Vector3(45, 0, -2.6);
  // path breadcrumbs used by team/hostages from the hostages' room to the street
  P.exitPath = [new THREE.Vector3(38, y, -16.9), new THREE.Vector3(41, y, -16.9), new THREE.Vector3(41, y, -11), new THREE.Vector3(42.4, y, -8.6), new THREE.Vector3(44.3, y, -7.8),
    // down: floor3 -> mid -> floor2 ...
    ...[3, 2, 1].flatMap(f => [new THREE.Vector3(44.3, Lv[f] - .2, -9.2), new THREE.Vector3(44.3, (Lv[f] + Lv[f - 1]) / 2, -12.6), new THREE.Vector3(46.1, (Lv[f] + Lv[f - 1]) / 2, -12.6), new THREE.Vector3(46.1, Lv[f - 1] + .2, -9.0), new THREE.Vector3(45.4, Lv[f - 1], -7.8)]),
    new THREE.Vector3(45, 0, -6.3), new THREE.Vector3(45, 0, -3.2)];
  P.upPath = [...P.exitPath].reverse();

  // ----- flush meshes merged per material -----
  const byMat = new Map();
  for (const [m, g, cast] of meshes) { const k = m.uuid + (cast ? 'c' : 'n'); if (!byMat.has(k)) byMat.set(k, { m, cast, gs: [] }); byMat.get(k).gs.push(g.index ? g.toNonIndexed() : g); }
  return byMat;
}

export function flushTarget(byMat) {
  for (const { m, cast, gs } of byMat.values()) {
    gs.forEach(g => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (g.attributes.color) g.deleteAttribute('color'); });
    const mesh = new THREE.Mesh(mergeGeometries(gs), m); mesh.castShadow = cast; mesh.receiveShadow = true; G.scene.add(mesh);
  }
  meshes.length = 0;
}

// door animations
export function openDoor(key, angle, dur = .35) {
  const d = B.doors[key]; if (!d || d.open) return; d.open = true; d.anim = { t: 0, dur, from: d.mesh.rotation.y, to: angle };
  const i = B.blockers.indexOf(d.blocker); if (i >= 0) B.blockers.splice(i, 1);
}
export function updateDoors(dt) {
  for (const d of Object.values(B.doors)) if (d.anim) { d.anim.t += dt; const k = Math.min(1, d.anim.t / d.anim.dur); const e = 1 - Math.pow(1 - k, 3); d.mesh.rotation.y = d.anim.from + (d.anim.to - d.anim.from) * e; if (k >= 1) d.anim = null; }
}
export function insideTarget(p) { return p.x > B.x0 && p.x < B.x1 && p.z > B.z0 && p.z < B.z1; }
