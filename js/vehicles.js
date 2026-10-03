// Vehicles: disguised pickup (with mattresses), IDF APC, UH-60 helicopter, and the paint/grime response of the parked cars
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rr, R, clamp, damp, pick, rng } from './core.js';
import { A } from './assets.js';
import { MAT, boxUV } from './materials.js';
import { groundY } from './world.js';
import { buildHeliInterior, dressHeli } from './heli.js';

// ---------- paint, grime and glass shared by every vehicle ----------
// Cars in the camp are never clean: a sand splash zone below the doors, dust settled on the bonnet and roof, and the
// windscreen only clear where it was wiped. Paint keeps a clearcoat (high quality) so it reads as lacquer, not plastic.
const VNOISE = `float vhH(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}
float vhN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(vhH(i),vhH(i+vec2(1,0)),f.x),mix(vhH(i+vec2(0,1)),vhH(i+1.),f.x),f.y);}
float vhF(vec2 p){return vhN(p)*.55+vhN(p*2.7+3.1)*.3+vhN(p*7.3-1.7)*.15;}
`;
function carShader(sh) {
  Object.assign(sh.uniforms, this.userData.vU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCw;varying vec3 vCn;varying vec3 vCo;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvCw=(modelMatrix*vec4(transformed,1.)).xyz;vCn=normalize(mat3(modelMatrix)*objectNormal);vCo=position;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCw;varying vec3 vCn;varying vec3 vCo;uniform float uY0,uNs,uDust,uTop,uKind,uGlassA,uWr,uWax;uniform vec3 uWc;\n' + VNOISE)
    .replace('#include <map_fragment>', `#include <map_fragment>
float cPaint=0.,cGlass=0.,cDust=0.,cRub=0.;
{
#ifdef USE_MAP
  vec4 sc=sampledDiffuseColor;
#else
  vec4 sc=vec4(1.);
#endif
  float L=dot(sc.rgb,vec3(.299,.587,.114)),sat=max(sc.r,max(sc.g,sc.b))-min(sc.r,min(sc.g,sc.b));
  vec3 op=vCo*uNs; vec3 wn=normalize(vCn); float hh=vCw.y-uY0;
  float n=vhF(op.xz*2.1+op.y*1.3),n2=vhF(vec2(op.x+op.z,op.y)*vec2(6.,1.2));
  float low=1.-smoothstep(.1,.45+.35*n,hh);
  float streak=smoothstep(.55,.85,n2)*(1.-smoothstep(.25,1.,hh));
  if(uKind<.5){
    cGlass=uGlassA>.5?1.-step(.5,sc.a):.6*(1.-smoothstep(.1,.2,L))*(1.-smoothstep(.04,.1,sat));
    cPaint=smoothstep(.4,.62,L)*(1.-smoothstep(.1,.25,sat))*(1.-cGlass);
    float top=smoothstep(.55,.92,wn.y)*uTop*(.35+.65*n);
    cDust=clamp(low*.95+top+streak*.45,0.,1.)*uDust;
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.03,.035,.04),cGlass);
    cDust*=mix(1.,.55+.45*smoothstep(.3,.7,n2),cGlass);
  } else {
    cRub=1.-smoothstep(.22,.42,L);
    if(uWr>0.){ vec3 rl=vCo-uWc; vec2 q=uWax<.5?rl.yz:uWax<1.5?rl.xz:rl.xy; float r=length(q)/uWr,a=atan(q.y,q.x);
      cRub=max(cRub,smoothstep(.6,.64,r));
      float band=smoothstep(.72,.74,r)*(1.-smoothstep(.84,.86,r));
      float glyph=step(.45,vhH(vec2(floor(a*30.),floor(r*40.))))*step(.2,fract(a*30./6.2832*2.))*band*step(0.,sin(a*2.));
      diffuseColor.rgb*=1.+glyph*.35-smoothstep(.6,.62,r)*(1.-smoothstep(.64,.66,r))*.4; }
    diffuseColor.rgb=mix(diffuseColor.rgb*.85,vec3(.05,.048,.045)*(diffuseColor.rgb/max(L,.05)*.3+.7),cRub*.85);
    cDust=clamp(low*.3+.12+streak*.15,0.,.45)*uDust*cRub;
  }
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.56,.49,.38)*(.8+.4*n),cDust*.85);
}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,uKind<.5?.3:.92,uKind<.5?cPaint:cRub);roughnessFactor=mix(roughnessFactor,.06,cGlass);roughnessFactor=mix(roughnessFactor,1.,cDust*.9);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=uKind<.5?metalnessFactor*(1.-cGlass):mix(.55,0.,max(cRub,cDust));')
    .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat*=max(cPaint,cGlass)*(1.-cDust);\n#endif');
}
// Military finish: flat (matte) paint, a dust coat on everything low and every flat top, exhaust soot. aVp is the
// vertex position in the vehicle's own frame (written when the geometry is merged), so the dust line follows the hull.
function milShader(sh) {
  Object.assign(sh.uniforms, this.userData.vU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aVp;varying vec3 vAp;varying vec3 vMn;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvAp=aVp;vMn=normalize(mat3(modelMatrix)*objectNormal);');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAp;varying vec3 vMn;uniform float uDust,uTop,uDustH,uMatte,uBack;uniform vec4 uSoot;uniform vec3 uSootDir;\n' + VNOISE)
    .replace('#include <map_fragment>', `#include <map_fragment>
float mDust=0.;
{ vec3 vp=vAp; vec3 wn=normalize(vMn);
  float n=vhF(vp.xz*1.7+vp.y*.9),n2=vhF(vec2((vp.x+vp.z)*3.,vp.y*.7));
  float low=1.-smoothstep(.25*uDustH,(.8+.55*n)*uDustH,vp.y);
  float top=smoothstep(.55,.9,wn.y)*uTop*(.3+.7*n);
  float streak=smoothstep(.5,.85,n2)*(1.-smoothstep(.3*uDustH,1.7*uDustH,vp.y))*.55;
  mDust=clamp(low+top+streak,0.,1.)*uDust;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.5,.44,.35)*(.82+.36*n),mDust*.6);
  if(uSoot.w>0.){ vec3 d=vp-uSoot.xyz; float al=dot(d,uSootDir); vec3 pr=d-uSootDir*al;
    float s=smoothstep(-.25,.35,al)*exp(-max(al,0.)*.35)*exp(-dot(pr,pr)*(2.5-1.5*n2)/(1.+max(al,0.)*.6));
    diffuseColor.rgb*=1.-clamp(s*uSoot.w*(.55+.45*n2),0.,.85); }
  if(uBack>.5&&!gl_FrontFacing) diffuseColor.rgb=vec3(.13,.135,.12);
}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,max(roughnessFactor,.8),uMatte);roughnessFactor=mix(roughnessFactor,1.,mDust*.85);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,min(metalnessFactor,.04),uMatte)*(1.-mDust);');
}
/** Military grime on a material (per-material uniforms; the shader source is shared so the program is too). */
export function milGrime(mat, { dust = 1, top = .7, dustH = 1, matte = 1, back = 0, soot = null, sootDir = [0, 0, 1] } = {}) {
  mat.userData.vU = { uDust: { value: dust }, uTop: { value: top }, uDustH: { value: dustH }, uMatte: { value: matte }, uBack: { value: back },
    uSoot: { value: soot ? new THREE.Vector4(...soot) : new THREE.Vector4() }, uSootDir: { value: new THREE.Vector3(...sootDir).normalize() } };
  mat.onBeforeCompile = milShader; mat.needsUpdate = true; return mat.userData.vU;
}
// Standard -> Physical keeping every standard property (Physical.copy would read missing clearcoat fields as undefined)
function toPhysical(m) { const p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, m); p.defines = { STANDARD: '', PHYSICAL: '' }; p.clearcoat = 1; p.clearcoatRoughness = .07; return p; }
/**
 * Paint/glass/tyre response and dust for a civilian car model (glTF with a colour atlas; alphaGlass: the atlas alpha marks the windows). Wheels get a sidewall ring
 * and lettering band from their own bounding box. Returns the shared uY0 uniform (ground height under the car).
 */
export function dressCar(root, { dust = .9, top = .8, alphaGlass = false } = {}) {
  root.updateMatrixWorld(true); const uY0 = { value: root.getWorldPosition(new THREE.Vector3()).y };
  const hq = (G.quality ?? 2) >= 2;
  root.traverse(c => {
    if (!c.isMesh || c.userData.vDressed) return; c.userData.vDressed = true;
    const wheel = /wheel/i.test(c.material.name || '') || /wheel|roue/i.test(c.name);
    let m = c.material; m = !wheel && hq ? toPhysical(m) : m.clone(); m.name = c.material.name;
    const U = { uY0, uNs: { value: c.matrixWorld.getMaxScaleOnAxis() }, uDust: { value: dust }, uTop: { value: top }, uKind: { value: wheel ? 1 : 0 },
      uGlassA: { value: alphaGlass ? 1 : 0 },
      uWr: { value: 0 }, uWax: { value: 0 }, uWc: { value: new THREE.Vector3() } };
    if (wheel && /wheel/i.test(c.name)) { const g = c.geometry; g.computeBoundingBox(); const s = g.boundingBox.getSize(new THREE.Vector3()), d = [s.x, s.y, s.z];
      const lo = d.indexOf(Math.min(...d)), hi = d.indexOf(Math.max(...d)); const pair = d[hi] / d[lo] > 1.6; const ax = pair ? hi : lo;
      U.uWax.value = ax; U.uWr.value = Math.max(...d.filter((_, i) => i !== ax)) / 2; g.boundingBox.getCenter(U.uWc.value); }
    m.userData.vU = U; m.onBeforeCompile = carShader; c.material = m;
  });
  return uY0;
}
// The market's parked cars are placed by world.js from the same models; give them the same finish (once each).
function dressParked() {
  const geos = new Set(); for (const k of ['suv', 'hatch']) A.models[k] && A.models[k].scene.traverse(c => c.isMesh && geos.add(c.geometry));
  if (!geos.size) return;
  for (const o of G.scene.children) { if (o.userData.vCar !== undefined) continue; let hit = false; o.traverse(c => { if (c.isMesh && geos.has(c.geometry)) hit = true; }); o.userData.vCar = hit;
    if (hit) { const r = rng(Math.round(o.position.x * 7 + o.position.z * 13)); dressCar(o, { dust: .75 + r() * .35, top: .6 + r() * .4, alphaGlass: true }); } }
}

// merge the direct mesh children of a group per material (one draw call each); aVp = position in root's frame
function mergeKids(grp, root) {
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), toRoot = new THREE.Matrix4().multiplyMatrices(inv, grp.matrixWorld); const by = new Map();
  for (const c of [...grp.children]) {
    if (!c.isMesh || c.userData.keep) continue;
    const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(c.matrix); const vp = g.attributes.position.clone(); vp.applyMatrix4(toRoot); g.setAttribute('aVp', vp);
    if (!by.has(c.material)) by.set(c.material, []); by.get(c.material).push(g); grp.remove(c);
  }
  for (const [mat, gs] of by) { const me = new THREE.Mesh(mergeGeometries(gs, false), mat); me.castShadow = !mat.transparent; me.receiveShadow = true; grp.add(me); }
}

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
  constructor(obj) { this.obj = obj; this.speed = 0; this.target = 0; this.path = null; this.u = 0; this.onEnd = null; this.shakeAmt = 0; G.scene.add(obj); dressParked(); }
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
    if (this.uY0) this.uY0.value = this.obj.position.y;
    if (this.engine) G.audio.setLoopPos(this.engine, this.obj.position);
  }
}

export function makePickup() {
  const src = A.models.pickup; const g = src ? normalizeModel(src, 5.6, { flip: true }) : new THREE.Group();
  // a white pickup that has driven the camp's sand roads: heavy splash zone, dusty bonnet, clearcoat under the dust
  const uY0 = dressCar(g, { dust: 1, top: .75 }); g.traverse(c => { if (c.isMesh) c.material.color.multiply(new THREE.Color('#d9d2c2')); });
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
  mergeKids(bed, g);
  const v = new Vehicle(g); v.bed = bed; v.uY0 = uY0; return v;
}

// ---------- IDF heavy APC (procedural, tank-based hull), front = +z, rear ramp = -z ----------
// Generic heavy APC on a tank hull: engine in front under a steep glacis, crew/troops behind, a ramp at the rear.
// Detail is built once into a template, merged per material (about 20 draw calls instead of ~150) and cloned.
let apcMats = null;
function apcMaterials() {
  if (apcMats) return apcMats;
  const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const r = rng(907);
  // armour plate: flat grey-green paint, faded patches, weld seams, bolt rows, chips down to primer and scuffs
  const plate = cv(512, 512, (g, W, H) => { g.fillStyle = '#7d7a67'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${r() < .5 ? 62 : 168},${r() < .5 ? 60 : 160},${r() < .5 ? 46 : 132},${r() * .07})`; g.fillRect(r() * W, r() * H, 2 + r() * 22, 2 + r() * 22); }
    for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H, rg = g.createRadialGradient(x, y, 2, x, y, 30 + r() * 60); rg.addColorStop(0, 'rgba(150,146,124,.16)'); rg.addColorStop(1, 'rgba(150,146,124,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
    g.strokeStyle = 'rgba(28,26,20,.6)'; g.lineWidth = 2.5; for (let x = 0; x <= W; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y <= H; y += 256) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.strokeStyle = 'rgba(205,198,170,.18)'; g.lineWidth = 1; for (let x = 2; x <= W; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let x = 12; x < W; x += 128) for (let y = 12; y < H; y += 40) for (const dx of [0, 104]) { g.fillStyle = 'rgba(36,34,27,.75)'; g.beginPath(); g.arc(x + dx, y, 3.2, 0, 7); g.fill(); g.fillStyle = 'rgba(200,192,165,.25)'; g.beginPath(); g.arc(x + dx - 1, y - 1, 1.3, 0, 7); g.fill(); }
    for (let i = 0; i < 160; i++) { const x = r() * W, y = r() * H, w = 1 + r() * 7, h = 1 + r() * 4; g.fillStyle = r() < .6 ? 'rgba(58,50,40,.6)' : 'rgba(96,92,70,.6)'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(215,205,180,.25)'; g.fillRect(x, y - 1, w, 1); }
    g.strokeStyle = 'rgba(40,36,28,.18)'; for (let i = 0; i < 60; i++) { g.lineWidth = .5 + r(); g.beginPath(); const x = r() * W, y = r() * H; g.moveTo(x, y); g.lineTo(x + (r() - .5) * 40, y + (r() - .5) * 8); g.stroke(); } });
  // track: steel shoes with rubber pads, end connectors and centre guide horns, sand packed in the gaps
  const track = cv(128, 256, (g, W, H) => { g.fillStyle = '#1f1d19'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 32) { g.fillStyle = '#3a3730'; g.fillRect(3, y + 3, W - 6, 24); g.fillStyle = '#25231f'; g.fillRect(10, y + 7, W / 2 - 18, 16); g.fillRect(W / 2 + 8, y + 7, W / 2 - 18, 16);
      g.fillStyle = '#4a463c'; g.fillRect(0, y + 10, 6, 10); g.fillRect(W - 6, y + 10, 6, 10); g.fillStyle = '#16150f'; g.fillRect(W / 2 - 5, y + 2, 10, 28);
      g.fillStyle = 'rgba(170,148,112,.45)'; g.fillRect(4, y + 27, W - 8, 4); g.fillStyle = 'rgba(150,130,100,.2)'; g.fillRect(10, y + 7, W - 20, 5); } });
  track.repeat.set(1, 6);
  const std = o => new THREE.MeshStandardMaterial(o);
  apcMats = {
    hull: std({ map: plate, roughness: .85, metalness: 0, color: '#ffffff' }),
    dark: std({ color: '#2c2b26', roughness: .6, metalness: .45 }),
    steel: std({ color: '#4a4a44', roughness: .45, metalness: .8 }),
    rubber: std({ color: '#1c1b19', roughness: .92 }),
    track: std({ map: track, roughness: .8, metalness: .35 }),
    olive: std({ color: '#4d5236', roughness: .95 }),
    tan: std({ color: '#7b6f55', roughness: .95 }),
    black: std({ color: '#151514', roughness: .8 }),
    glass: std({ color: '#0d1316', roughness: .05, metalness: .4, envMapIntensity: 1.4 }),
    lens: std({ color: '#b9c0bf', roughness: .08, metalness: .85, emissive: '#fff2d0', emissiveIntensity: .04 }),
    red: std({ color: '#5e0f0b', roughness: .15, emissive: '#ff2010', emissiveIntensity: .25 }),
    inside: std({ color: '#3b3b36', roughness: .9, side: THREE.BackSide }),
  };
  const M = apcMats;
  milGrime(M.hull, { dust: .85, top: .7, soot: [-1.85, 1.75, 2.35, 1.1], sootDir: [-.15, -.25, -1] });
  milGrime(M.track, { dust: .55, top: .5, matte: 0 }); milGrime(M.rubber, { dust: .45, top: .3, matte: 0 }); milGrime(M.dark, { dust: .5, top: .5, matte: 0 });
  milGrime(M.steel, { dust: .6, top: .5, matte: 0 }); milGrime(M.olive, { dust: .5, top: .5 }); milGrime(M.tan, { dust: .4, top: .4 }); milGrime(M.black, { dust: .7, top: .5, matte: 0 });
  return apcMats;
}
let apcTpl = null;
function apcTemplate() {
  if (apcTpl) return apcTpl;
  const M = apcMaterials(); const g = new THREE.Group(); const r = rng(4411); const rn = (a, b) => a + (b - a) * r();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); parent.add(me); return me; };
  const cylX = (rad, len, seg = 12) => new THREE.CylinderGeometry(rad, rad, len, seg).rotateZ(Math.PI / 2);
  const cylZ = (rad, len, seg = 10) => new THREE.CylinderGeometry(rad, rad, len, seg).rotateX(Math.PI / 2);
  const prof = (pts, width, mat) => { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => sh.lineTo(p[0], p[1])); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 1 }); geo.translate(0, 0, -width / 2); geo.rotateY(-Math.PI / 2);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.2, uv.getY(i) / 2.2); return add(geo, mat); };
  // hull: long, low, steep front glacis; the upper hull overhangs the tracks
  prof([[-3.85, .62], [-3.9, 2.02], [1.2, 2.08], [3.95, 1.3], [3.98, .95], [3.35, .55], [-3.4, .5]], 2.36, M.hull);
  prof([[-3.85, 1.0], [-3.9, 1.95], [1.1, 2.0], [3.9, 1.26], [3.9, 1.0]], 3.36, M.hull);
  const deckY = z => z < 1.2 ? 2.02 + (z + 3.9) / 5.1 * .06 : 2.08 - (z - 1.2) / 2.75 * .78;
  for (const sx of [-1, 1]) {
    // modular side skirts with bolt rows, a rubber flap along the bottom and a gap between modules
    for (let i = 0; i < 6; i++) { const z = -3.1 + i * 1.23; const p = add(boxUV(.14, .78, 1.19, 1.1), M.hull, sx * 1.74, 1.18, z); p.rotation.z = sx * .04;
      for (let k = 0; k < 4; k++) for (const y of [.88, 1.48]) add(cylX(.028, .05, 6), M.dark, sx * 1.83, y, z - .45 + k * .3);
      add(new THREE.BoxGeometry(.05, .17, 1.15), M.rubber, sx * 1.71, .72, z); add(new THREE.BoxGeometry(.06, .05, .12), M.dark, sx * 1.83, 1.52, z + .5); }
    add(boxUV(.14, .5, .9, 1), M.hull, sx * 1.74, 1.2, 3.55).rotation.x = -.5;
    // upper side armour modules with lifting eyes, between the skirt line and the deck edge
    for (let i = 0; i < 4; i++) { const z = -3.3 + i * 1.42; add(boxUV(.12, .34, 1.36, 1), M.hull, sx * 1.72, 1.78, z); add(new THREE.TorusGeometry(.04, .012, 4, 8), M.dark, sx * 1.72, 1.98, z); }
    // running gear: rubber-tyred road wheels with painted discs and hubs, toothed sprocket in front, idler at the back
    for (let i = 0; i < 6; i++) { const z = -2.75 + i * 1.08;
      add(cylX(.34, .22, 16), M.rubber, sx * 1.45, .38, z); add(cylX(.275, .24, 16), M.hull, sx * 1.45, .38, z); add(cylX(.11, .3, 10), M.dark, sx * 1.45, .38, z);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; add(cylX(.018, .32, 5), M.steel, sx * 1.45, .38 + Math.cos(a) * .07, z + Math.sin(a) * .07); }
      add(new THREE.BoxGeometry(.12, .1, .7), M.dark, sx * 1.25, .55, z + .2).rotation.x = -.35; }
    for (const z of [-1.8, -.2, 1.4]) add(cylX(.1, .2, 10), M.rubber, sx * 1.45, 1.0, z);
    add(cylX(.36, .26, 16), M.hull, sx * 1.45, .72, 3.35); add(cylX(.13, .32, 10), M.dark, sx * 1.45, .72, 3.35);
    for (let k = 0; k < 13; k++) { const a = k / 13 * Math.PI * 2; const t = add(new THREE.BoxGeometry(.22, .09, .07), M.steel, sx * 1.45, .72 + Math.cos(a) * .41, 3.35 + Math.sin(a) * .41); t.rotation.x = -a; }
    add(cylX(.36, .24, 16), M.hull, sx * 1.45, .7, -3.4); add(cylX(.1, .3, 10), M.dark, sx * 1.45, .7, -3.4);
    // track: lower and upper runs and the wraps around sprocket and idler (one texture scrolls them all)
    add(new THREE.BoxGeometry(.64, .07, 6.5), M.track, sx * 1.45, .04, -.05); add(new THREE.BoxGeometry(.64, .07, 6.2), M.track, sx * 1.45, 1.08, 0);
    for (const [z, y] of [[3.35, .72], [-3.4, .7]]) { const arc = new THREE.CylinderGeometry(.44, .44, .64, 16, 1, true, z > 0 ? 0 : Math.PI, Math.PI); arc.rotateZ(Math.PI / 2); add(arc, M.track, sx * 1.45, y, z); }
    for (let k = 0; k < 18; k++) add(new THREE.BoxGeometry(.05, .08, .1), M.dark, sx * 1.45, .1, -3.1 + k * .36);
    // mud flaps at both ends of the track
    add(new THREE.BoxGeometry(.66, .42, .03), M.rubber, sx * 1.45, .95, 3.97).rotation.x = .25; add(new THREE.BoxGeometry(.66, .5, .03), M.rubber, sx * 1.45, .62, -3.95);
    // stowage baskets on the rear deck: welded rails with bags, a rolled camouflage net, jerrycans and ammo boxes
    const bx = sx * 1.32, bz = -2.25;
    for (const [dx, dy] of [[-.24, .02], [.24, .02], [-.24, .38], [.24, .38]]) add(cylZ(.016, 2.5, 5), M.dark, bx + dx, deckY(bz) + dy, bz);
    for (let k = 0; k < 7; k++) { const z = bz - 1.2 + k * .4; for (const dx of [-.24, .24]) add(new THREE.BoxGeometry(.025, .38, .025), M.dark, bx + dx, deckY(bz) + .2, z); add(new THREE.BoxGeometry(.5, .025, .025), M.dark, bx, deckY(bz) + .02, z); }
    for (let k = 0; k < 3; k++) { const bag = add(new THREE.CapsuleGeometry(.15, .45, 3, 8).rotateX(Math.PI / 2), [M.olive, M.tan, M.black][(k + (sx > 0 ? 0 : 1)) % 3], bx + rn(-.08, .08), deckY(bz) + .2, bz - .9 + k * .6); bag.rotation.y = rn(-.25, .25); bag.rotation.z = rn(-.2, .2); }
    add(new THREE.CylinderGeometry(.17, .17, .55, 10).rotateZ(Math.PI / 2), M.olive, bx, deckY(bz) + .32, bz + 1.0).rotation.y = .1;
    for (let k = 0; k < 2; k++) { add(boxUV(.17, .34, .46, .5), M.olive, sx * 1.42 - k * sx * .2, deckY(-3.5) + .2, -3.62); }
    add(boxUV(.3, .18, .42, .5), M.olive, bx - sx * .05, deckY(bz) + .5, bz - .3);
    // tow cables along the deck edges with eyes at both ends
    add(cylZ(.022, 4.6, 6), M.steel, sx * 1.58, deckY(-1) + .04, -1.2); for (const z of [-3.5, 1.1]) add(new THREE.TorusGeometry(.07, .02, 5, 10), M.steel, sx * 1.58, deckY(z) + .04, z).rotation.x = Math.PI / 2;
    // head lights in guard cages, rear lights, convoy marker
    add(new THREE.BoxGeometry(.32, .18, .14), M.dark, sx * 1.3, 1.36, 3.9); for (const dx of [-.07, .07]) { const l = add(cylZ(.055, .03, 14), M.lens, sx * 1.3 + dx, 1.37, 3.975); l.userData.lamp = 1; }
    for (const dy of [-.1, .02, .14]) add(new THREE.BoxGeometry(.4, .02, .02), M.steel, sx * 1.3, 1.37 + dy, 4.05); for (const dx of [-.19, .19]) add(new THREE.BoxGeometry(.02, .28, .14), M.steel, sx * 1.3 + dx, 1.37, 4.0);
    add(new THREE.BoxGeometry(.24, .16, .1), M.dark, sx * 1.42, 1.8, -3.92); add(new THREE.BoxGeometry(.1, .08, .02), M.red, sx * 1.47, 1.8, -3.975); add(new THREE.BoxGeometry(.06, .06, .02), M.lens, sx * 1.36, 1.8, -3.975);
    for (const dy of [-.09, .09]) add(new THREE.BoxGeometry(.3, .02, .02), M.steel, sx * 1.42, 1.8 + dy, -4.0);
    // smoke grenade dischargers on the front corners
    for (let k = 0; k < 4; k++) { const tube = add(new THREE.CylinderGeometry(.045, .045, .3, 8), M.dark, sx * (1.3 - k * .1), 2.12, 1.25 + k * .02); tube.rotation.x = -.9; tube.rotation.z = sx * .4; }
    add(new THREE.BoxGeometry(.5, .1, .25), M.hull, sx * 1.15, 2.07, 1.25);
    // lift eyes on the hull corners, tow hooks front and rear
    for (const z of [3.7, -3.75]) add(new THREE.TorusGeometry(.08, .025, 5, 10), M.dark, sx * 1.05, z > 0 ? 1.55 : 2.06, z).rotation.y = Math.PI / 2;
    add(new THREE.TorusGeometry(.1, .03, 6, 12), M.dark, sx * .8, .98, 3.98); add(new THREE.BoxGeometry(.12, .16, .14), M.dark, sx * .8, 1.1, 3.95);
  }
  // exhaust louvres on the right of the engine compartment (soot streaks back from them in the shader)
  add(new THREE.BoxGeometry(.08, .34, .8), M.dark, -1.79, 1.72, 2.45); for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(.05, .03, .78), M.black, -1.83, 1.6 + k * .06, 2.45);
  // engine deck: grille bars, inspection panels, spare track shoes across the glacis
  for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(2.2, .03, .06), M.black, 0, 1.62 + k * .08, 2.55 - k * .12).rotation.x = -.33;
  for (const sx of [-1, 1]) { const p = add(boxUV(.9, .03, .8, 1), M.hull, sx * .7, deckY(1.75) + .02, 1.75); p.rotation.x = .28; }
  for (let k = 0; k < 6; k++) { const sh = add(new THREE.BoxGeometry(.6, .06, .16), M.track, -1.0 + (k % 3) * .66 + (k > 2 ? .33 : 0), deckY(3.2 + (k > 2 ? -.3 : 0)) + .05, 3.2 - (k > 2 ? .3 : 0)); sh.rotation.x = .28; }
  // driver's hatch at the top of the glacis with three vision blocks ahead of it
  add(new THREE.CylinderGeometry(.33, .35, .07, 16), M.hull, -.7, deckY(1.45) + .02, 1.45).rotation.x = .1; add(new THREE.BoxGeometry(.1, .05, .2), M.dark, -.7, deckY(1.45) + .07, 1.2);
  for (let k = 0; k < 3; k++) { const a = (k - 1) * .5; const pb = add(new THREE.BoxGeometry(.16, .1, .1), M.dark, -.7 + Math.sin(a) * .38, deckY(1.8) + .04, 1.45 + Math.cos(a) * .38); pb.rotation.y = a; const gl = add(new THREE.BoxGeometry(.13, .06, .01), M.glass, -.7 + Math.sin(a) * .43, deckY(1.8) + .05, 1.45 + Math.cos(a) * .43); gl.rotation.y = a; }
  // commander's cupola with a ring of vision blocks, hatch lid, hinge
  add(new THREE.CylinderGeometry(.44, .48, .18, 20), M.hull, -.6, 2.14, .4); add(new THREE.CylinderGeometry(.36, .37, .06, 20), M.hull, -.6, 2.26, .4); add(new THREE.BoxGeometry(.18, .08, .1), M.dark, -.6, 2.28, .02);
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; const pb = add(new THREE.BoxGeometry(.15, .11, .09), M.dark, -.6 + Math.sin(a) * .41, 2.24, .4 + Math.cos(a) * .41); pb.rotation.y = a; const gl = add(new THREE.BoxGeometry(.12, .065, .01), M.glass, -.6 + Math.sin(a) * .456, 2.245, .4 + Math.cos(a) * .456); gl.rotation.y = a; }
  // troop roof hatches with hinges and grab handles
  for (const [x, z] of [[.8, -1.2], [-.8, -1.8]]) { add(new THREE.CylinderGeometry(.36, .37, .08, 18), M.hull, x, deckY(z) + .04, z); add(new THREE.BoxGeometry(.3, .06, .08), M.dark, x, deckY(z) + .08, z - .36);
    add(new THREE.TorusGeometry(.06, .012, 4, 8, Math.PI), M.steel, x, deckY(z) + .09, z + .1); }
  add(boxUV(.9, .14, .6, 1), M.hull, 0, deckY(-.8) + .07, -.8);
  // remote weapon station with a 7.62 MG, sensor head with glass, armoured cover and ammo box
  const rcws = new THREE.Group(); rcws.name = 'rcws'; rcws.position.set(.55, 2.1, .9); g.add(rcws);
  add(new THREE.CylinderGeometry(.34, .38, .2, 16), M.hull, 0, .1, 0, rcws); add(new THREE.CylinderGeometry(.3, .3, .06, 16), M.dark, 0, .22, 0, rcws);
  const head = new THREE.Group(); head.name = 'rcwsHead'; head.position.y = .42; rcws.add(head);
  add(boxUV(.55, .36, .7, 1), M.hull, 0, 0, 0, head); add(boxUV(.6, .06, .74, 1), M.hull, 0, .2, -.02, head);
  add(boxUV(.24, .24, .3, 1), M.hull, .36, .06, .1, head); add(new THREE.BoxGeometry(.08, .07, .02), M.glass, .32, .1, .26, head); add(new THREE.BoxGeometry(.06, .06, .02), M.glass, .42, .1, .26, head); add(new THREE.BoxGeometry(.28, .03, .1), M.hull, .36, .2, .26, head);
  add(cylZ(.035, 1.25, 10), M.dark, -.12, .04, .78, head); add(cylZ(.06, .18, 10), M.dark, -.12, .04, 1.4, head); add(cylZ(.045, .3, 10), M.dark, -.12, .04, .5, head);
  add(new THREE.BoxGeometry(.12, .1, .3), M.dark, -.12, -.02, .3, head); add(boxUV(.2, .2, .28, 1), M.olive, -.34, -.02, -.1, head); add(new THREE.BoxGeometry(.04, .08, .2), M.dark, -.24, .08, -.1, head);
  // antennas on spring mounts
  for (const [x, z] of [[-1.3, -3.3], [1.3, -3.3], [1.4, .9]]) { add(new THREE.BoxGeometry(.14, .1, .14), M.dark, x, deckY(z) + .05, z); add(new THREE.CylinderGeometry(.03, .03, .16, 6), M.black, x, deckY(z) + .18, z); add(new THREE.CylinderGeometry(.006, .013, 2.8, 4), M.dark, x, deckY(z) + 1.66, z); }
  // rear lockers either side of the ramp
  for (const sx of [-1, 1]) { add(boxUV(.42, .62, .22, 1), M.hull, sx * 1.27, 1.35, -3.98); add(new THREE.BoxGeometry(.06, .04, .02), M.steel, sx * 1.27, 1.55, -4.1); add(new THREE.BoxGeometry(.06, .04, .02), M.steel, sx * 1.27, 1.15, -4.1); }
  add(new THREE.TorusGeometry(.09, .03, 6, 10), M.dark, 0, .5, -3.97).rotation.y = Math.PI / 2;
  // rear ramp (hinged at the bottom) with a personnel door outline, handle and tread bars on the inner face
  const hinge = new THREE.Group(); hinge.name = 'rampHinge'; hinge.position.set(0, .62, -3.9); g.add(hinge);
  add(boxUV(1.7, 1.35, .14, 1.2), M.hull, 0, .675, -.07, hinge);
  for (const [w, h, x, y] of [[.04, 1.0, -.38, .7], [.04, 1.0, .38, .7], [.8, .04, 0, 1.2], [.8, .04, 0, .2]]) add(new THREE.BoxGeometry(w, h, .02), M.black, x, y, -.15, hinge);
  add(new THREE.BoxGeometry(.2, .05, .05), M.steel, .25, .72, -.17, hinge); add(new THREE.BoxGeometry(.08, .1, .04), M.dark, .25, .72, -.15, hinge);
  for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(1.5, .03, .03), M.steel, 0, .2 + k * .25, .015, hinge);
  for (const sx of [-1, 1]) add(cylX(.06, .3, 8), M.dark, sx * .6, 0, -.05, hinge);
  add(new THREE.BoxGeometry(1.65, 1.3, 3.2), M.inside, 0, 1.3, -2.3);
  // doorway into the troop compartment, revealed when the ramp drops (painted depth: benches, floor, dim red light)
  { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
    const bg = x.createRadialGradient(128, 110, 10, 128, 128, 170); bg.addColorStop(0, '#3a1612'); bg.addColorStop(.35, '#1d1a17'); bg.addColorStop(1, '#0b0b0a'); x.fillStyle = bg; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#26241f'; x.beginPath(); x.moveTo(0, 256); x.lineTo(256, 256); x.lineTo(170, 160); x.lineTo(86, 160); x.closePath(); x.fill();
    for (const s of [-1, 1]) { x.fillStyle = '#34322b'; x.beginPath(); x.moveTo(128 + s * 128, 200); x.lineTo(128 + s * 128, 150); x.lineTo(128 + s * 50, 128); x.lineTo(128 + s * 50, 150); x.closePath(); x.fill();
      x.fillStyle = '#4b4a3c'; for (let k = 0; k < 3; k++) x.fillRect(s > 0 ? 190 + k * 18 : 40 - k * 18, 60 + k * 6, 10, 55 - k * 10); }
    x.fillStyle = 'rgba(255,60,40,.8)'; x.fillRect(118, 34, 20, 5);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const door = add(new THREE.PlaneGeometry(1.6, 1.3), new THREE.MeshBasicMaterial({ map: t, color: '#9a9a9a' }), 0, 1.28, -3.93); door.rotation.y = Math.PI; door.userData.keep = true; door.receiveShadow = true; }
  for (const grp of [g, rcws, head, hinge]) mergeKids(grp, g);
  apcTpl = g; return g;
}
export function makeAPC() {
  const M = apcMaterials(); const g = apcTemplate().clone(true); g.rotation.order = 'YXZ';
  const rcws = g.getObjectByName('rcws'), head = g.getObjectByName('rcwsHead'), hinge = g.getObjectByName('rampHinge');
  g.userData.rcws = rcws; g.userData.rcwsHead = head; g.userData.muzzle = new THREE.Vector3(-.12, .04, 1.5); g.userData.hinge = hinge; g.userData.ramp = hinge.children[0];
  const v = new Vehicle(g); v.odo = 0;
  const baseUpdate = v.update.bind(v);
  v.update = (dt) => {
    baseUpdate(dt);
    // parked: sit on the ground and follow its slope (the beach falls toward the sea) instead of floating level at y=0
    if (!v.curve) { const o = v.obj, p = o.position, hd = o.rotation.y, fx = Math.sin(hd) * 3, fz = Math.cos(hd) * 3, sx = Math.cos(hd) * 1.5, sz = -Math.sin(hd) * 1.5;
      p.y = groundY(p.x, p.z); o.rotation.x = -Math.atan2(groundY(p.x + fx, p.z + fz) - groundY(p.x - fx, p.z - fz), 6); o.rotation.z = Math.atan2(groundY(p.x + sx, p.z + sz) - groundY(p.x - sx, p.z - sz), 3); }
    v.odo += v.speed * dt; M.track.map.offset.y = -v.odo / 1.1;
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

// Matte paint, rotor-wash dust on the lower fuselage and exhaust soot streaking back from the engine outlets along the
// upper fuselage and tail boom. aVp (vertex in the helicopter's frame) is written once per source geometry and node.
const heliVp = new Map();
function heliGrime(g, o, mp) {
  g.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), mm = new THREE.Matrix4(); const used = new Set();
  const hub = mp ? mp.pv.position.clone() : new THREE.Vector3(0, 3.6, 0);
  o.traverse(c => {
    if (!c.isMesh || !c.material.userData.heliPaint) return; const key = c.geometry.uuid + '|' + c.name;
    if (!heliVp.has(key)) { const geo = used.has(c.geometry) || c.geometry.attributes.aVp ? c.geometry.clone() : c.geometry; const vp = geo.attributes.position.clone(); mm.multiplyMatrices(inv, c.matrixWorld); vp.applyMatrix4(mm); geo.setAttribute('aVp', vp); heliVp.set(key, geo); }
    c.geometry = heliVp.get(key); used.add(c.geometry);
    milGrime(c.material, { dust: .45, top: .4, dustH: 1.0, back: 1, soot: [hub.x, hub.y - .8, hub.z + 1.5, .85], sootDir: [0, -.12, 1] });
  });
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
  v.model = o; dressHeli(o, v); heliGrime(g, o, mp); buildHeliInterior(o, v);
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
