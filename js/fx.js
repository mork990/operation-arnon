// Visual effects: particles, decals, tracers, muzzle flashes, casings, explosions
import * as THREE from 'three';
import { G, rng, clamp, fogGLSL } from './core.js';
import { GIU, GI_FUNCS } from './gi.js';

// smoke and dust are lit like everything else: the baked sky visibility where the puff is, plus the sun where the static
// sun shadow says it reaches (unlit puffs glowed in dark rooms and washed the whole frame out)
// effects draw from their own generator: a burst of fire must not shift the global R that the world and the AI share
const R = rng(5560), rr = (a, b) => a + (b - a) * R();
// particle budget by quality: phones (1) get about half, low (0) a third; the look is carried by the first few
const QN = () => G.quality >= 2 ? 1 : G.quality === 1 ? .55 : .35, NQ = n => Math.max(1, Math.round(n * QN()));
// light air when the mission has no wind of its own (mission 1): the coast's afternoon sea breeze, west to east
const WIND0 = new THREE.Vector3(.45, 0, .12);
const pVert = `attribute float size;attribute vec4 pc;attribute float rot;varying vec4 vC;varying vec3 vW;varying float vR;varying float vL;uniform float uScale;
${GI_FUNCS}
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=min(size*uScale/max(-mv.z,.1),1400.);vC=pc;vW=position;vR=rot;
  float e=uGIamb+(1.-uGIamb)*clamp(giSample(position,vec3(0.,1.,0.)).a,0.,1.);float sv=uSunOn>.5?giFarSun(position):1.;vL=e*.62+sv*.55;}`;
const pFragN = `varying vec4 vC;varying vec3 vW;varying float vR;varying float vL;uniform vec3 uFog;uniform float uFogD;uniform vec3 uSun;
/*FOG*/void main(){vec2 p=gl_PointCoord-.5;float c=cos(vR),s=sin(vR);p=mat2(c,-s,s,c)*p;float d=length(p);
  float a=smoothstep(.5,.1,d);float n=fract(sin(dot(floor((p+.5)*6.),vec2(12.9,78.2)))*437.);a*=.8+.2*n;
  float lit=.75+.45*clamp(-p.y*2.+.3,0.,1.);vec3 col=vC.rgb*lit*vL;
  float f=1.-exp(-fgTau(vW,uFogD));vec3 fv=vW-cameraPosition;col=mix(col,uFog*fgIn(fv/max(length(fv),1e-3)),f); // the scenery's own height fog: a distant smoke column hazes like the ground behind it
  gl_FragColor=vec4(col,vC.a*a);if(gl_FragColor.a<.004)discard;}`;
const pFragA = `varying vec4 vC;varying vec3 vW;varying float vR;void main(){float d=length(gl_PointCoord-.5);float a=pow(smoothstep(.5,0.,d),1.5);gl_FragColor=vec4(vC.rgb*vC.a*a,1.);}`;

class PS {
  constructor(n, additive) {
    this.n = n; this.i = 0; const G2 = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n); this.rot = new Float32Array(n);
    G2.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    G2.setAttribute('pc', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    G2.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    G2.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.u = { uScale: { value: 500 }, uFog: { value: G.scene.fog.color }, uFogD: { value: G.scene.fog.density }, uSun: { value: G.sunDir }, ...GIU };
    this.mat = new THREE.ShaderMaterial({ vertexShader: pVert, fragmentShader: additive ? pFragA : pFragN.replace('/*FOG*/', fogGLSL()), uniforms: this.u, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.pts = new THREE.Points(G2, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 3 : 2; this.G2 = G2; G.scene.add(this.pts);
    this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.spin = new Float32Array(n); this.wnd = new Float32Array(n);
    this.alive = 0;
  }
  // wind: how much the air carries the particle once its own push has died (0 for callers that already add the wind)
  emit(p, v, life, s0, s1, c0, c1, drag = 0, grav = 0, wind = 0) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z; this.v[i * 3] = v.x; this.v[i * 3 + 1] = v.y; this.v[i * 3 + 2] = v.z;
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.c0.set(c0, i * 4); this.c1.set(c1, i * 4); this.drag[i] = drag; this.grav[i] = grav; this.rot[i] = R() * 6.28; this.spin[i] = rr(-.6, .6); this.wnd[i] = wind;
  }
  update(dt) {
    let alive = 0; const W = G.wind || WIND0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) this.size[i] = 0; continue; }
      alive++; this.life[i] -= dt; const k = 1 - Math.max(0, this.life[i]) / this.max[i]; const j = i * 3, c = i * 4;
      const dr = Math.max(0, 1 - this.drag[i] * dt); this.v[j] *= dr; this.v[j + 1] = this.v[j + 1] * dr + this.grav[i] * dt; this.v[j + 2] *= dr;
      const w = this.wnd[i] * Math.min(1, k * 3) * dt; this.pos[j] += this.v[j] * dt + W.x * w; this.pos[j + 1] += this.v[j + 1] * dt; this.pos[j + 2] += this.v[j + 2] * dt + W.z * w; this.rot[i] += this.spin[i] * dt;
      const e = 1 - Math.pow(1 - k, 2); this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      for (let q = 0; q < 4; q++) this.col[c + q] = this.c0[c + q] + (this.c1[c + q] - this.c0[c + q]) * k;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    this.alive = alive;
    const a = this.G2.attributes; a.position.needsUpdate = a.pc.needsUpdate = a.size.needsUpdate = a.rot.needsUpdate = true;
  }
}

const V = new THREE.Vector3(), V2 = new THREE.Vector3();
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(1, 1, 1), _Z = new THREE.Vector3(0, 0, 1);
// 5.56x45 case, empty: rim, extractor groove, a body that tapers to the shoulder, and the neck (lathe profile, metres)
function casingGeo() {
  const P = [[0, 0], [.0048, 0], [.0048, .0012], [.0041, .0016], [.0041, .0023], [.0048, .0027], [.0046, .0355], [.0032, .0392], [.0031, .045], [.0027, .045]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(P, 7); g.translate(0, -.0225, 0); g.rotateX(Math.PI / 2); return g;
}
export class FX {
  constructor() {
    this.smoke = new PS(3500, false); this.glow = new PS(1600, true);
    // bullet holes: one instanced quad set over a 2x2 atlas (plaster/block twice, painted metal, ground), so every
    // surface gets its own mark in a single draw call
    this.decalMax = 400; this.decalI = 0;
    const dg = new THREE.PlaneGeometry(1, 1); this.decalTile = new THREE.InstancedBufferAttribute(new Float32Array(this.decalMax), 1); dg.setAttribute('aTile', this.decalTile);
    const dm = new THREE.MeshStandardMaterial({ map: this.decalTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    dm.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTile;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * .5 + vec2(mod(aTile, 2.), floor(aTile * .5)) * .5;'); };
    dm.customProgramCacheKey = () => 'decalAtlas';
    this.decals = new THREE.InstancedMesh(dg, dm, this.decalMax);
    this.decals.count = 0; this.decals.frustumCulled = false; G.scene.add(this.decals);
    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(.012, .012, 1, 4); tg.rotateX(Math.PI / 2); tg.translate(0, 0, -.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 1.8), transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracerMatE = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 1.6), transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracerGeo = tg;
    // muzzle flash light pool
    this.flashLights = [0, 1, 2].map(() => { const l = new THREE.PointLight('#ffb870', 0, 9, 2); G.scene.add(l); return { l, t: 0 }; }); this.fi = 0;
    // casings: one instanced draw for all brass in the air and on the floor (was a mesh, and a draw call, per case).
    // Spent brass stays where it lands, as it does in a room after a firefight, until the ring buffer reuses it.
    this.casingMax = 48; this.casings = []; this.casingI = 0;
    this.casingMat = new THREE.MeshStandardMaterial({ color: '#b8893a', metalness: .85, roughness: .32, envMapIntensity: 1.2 });
    this.casingMesh = new THREE.InstancedMesh(casingGeo(), this.casingMat, this.casingMax); this.casingMesh.count = 0; this.casingMesh.frustumCulled = false; G.scene.add(this.casingMesh);
    this.bigLight = new THREE.PointLight('#ffb070', 0, 60, 1.6); G.scene.add(this.bigLight); this.bigT = 0;
  }
  // 2x2 atlas, 128 px tiles (canvas, own seed so the marks are the same every run):
  //  0/1 plaster or block: dark cratered hole, a jagged rim of chipped-off paint showing the lighter render underneath,
  //      radial cracks and a faint halo of dust (two variants so a burst does not stamp the same hole)
  //  2   painted steel: a small punched hole with the paint flaked back to bright metal, and a soot ring
  //  3   ground: a soft dark pockmark with a ring of thrown-out, lighter dry sand
  decalTex() {
    const S = 256, T = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); const r = rng(911), m = T / 2;
    const blob = (cx, cy, r0, jag, col, k = 18) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i <= k; i++) { const a = i / k * 6.283, rad = r0 * (1 - jag + r() * jag * 2); g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } g.fill(); };
    const halo = (cx, cy, r0, a, col) => { const h = g.createRadialGradient(cx, cy, 4, cx, cy, r0); h.addColorStop(0, `rgba(${col},${a})`); h.addColorStop(.5, `rgba(${col},${a * .4})`); h.addColorStop(1, `rgba(${col},0)`); g.fillStyle = h; g.fillRect(cx - m, cy - m, T, T); };
    // tile t sits at uv (t%2, t>>1)/2; the canvas is flipped on upload, so row 0 is the lower half of the canvas
    const at = t => [(t % 2) * T + m, (1 - (t >> 1)) * T + m];
    for (const t of [0, 1]) { const [x, y] = at(t), s = t ? .82 : 1;
      halo(x, y, m, .55, '120,108,94');
      blob(x, y, 30 * s, .4, 'rgba(206,196,178,.95)', 22); blob(x + 2, y - 1, 20 * s, .32, 'rgba(118,108,96,1)'); blob(x, y, 11 * s, .28, 'rgba(22,19,16,1)');
      g.strokeStyle = 'rgba(40,34,28,.55)'; g.lineWidth = 1.2; for (let i = 0; i < 6 + t * 3; i++) { const a = r() * 6.283, l = 30 + r() * 26; g.beginPath(); g.moveTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.lineTo(x + Math.cos(a + (r() - .5) * .3) * l, y + Math.sin(a + (r() - .5) * .3) * l); g.stroke(); }
      for (let i = 0; i < 8; i++) { const a = r() * 6.283, d = 30 + r() * 22; blob(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.5 + r() * 2.5, .4, 'rgba(70,62,54,.6)', 7); } }
    { const [x, y] = at(2); halo(x, y, m * .9, .7, '34,30,26'); blob(x, y, 24, .45, 'rgba(176,172,166,.95)', 16); blob(x, y, 15, .2, 'rgba(120,118,114,1)'); blob(x, y, 8, .12, 'rgba(10,9,8,1)'); }
    { const [x, y] = at(3); halo(x, y, m, .45, '200,182,150'); blob(x, y, 26, .45, 'rgba(92,80,64,.7)', 14); blob(x, y, 12, .3, 'rgba(48,40,32,.9)'); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  setScale(s) { this.smoke.u.uScale.value = this.glow.u.uScale.value = s; }
  decal(p, n, size = .09, tile = 0) {
    const q = _Q.setFromUnitVectors(_Z, n); q.premultiply(new THREE.Quaternion().setFromAxisAngle(n, R() * 6.28));
    _M.compose(V2.copy(p).addScaledVector(n, .004), q, _S.set(size, size, 1));
    this.decals.setMatrixAt(this.decalI, _M); this.decalTile.array[this.decalI] = tile; this.decalTile.needsUpdate = true;
    this.decalI = (this.decalI + 1) % this.decalMax; this.decals.count = Math.min(this.decalMax, this.decals.count + 1); this.decals.instanceMatrix.needsUpdate = true;
  }
  // A strike reads by what it hits (reference: MW2019's impact sets):
  //  - plaster/block: a hot white pop, a jet of pale dust that stalls and hangs, then drifts; chips of render that fall
  //    under gravity, a trickle of grit afterwards, and the occasional spark off the aggregate;
  //  - sand/earth: a column of grains thrown up that falls back, and a low tan cloud that the breeze takes;
  //  - steel: a fan of sparks that bounce down, a puff of paint smoke, and a small bright-edged hole.
  // Fewer particles far away and on phones (QN); the first ones carry the read.
  impact(p, n, surface = 'concrete') {
    if (surface === 'flesh') { for (let i = 0; i < 6; i++) { V.randomDirection().multiplyScalar(rr(.3, 1.2)).addScaledVector(n, .6); this.smoke.emit(p, V, rr(.25, .5), .06, .25, [.28, .04, .03, .7], [.2, .03, .02, 0], 2, -2); } return; }
    const far = G.camera ? G.camera.position.distanceTo(p) : 0, lod = far > 70 ? .3 : far > 35 ? .6 : 1, N = k => Math.max(1, Math.round(k * QN() * lod));
    if (surface === 'metal') {
      this.glow.emit(p, V.set(0, 0, 0), .04, .1, .22, [5, 4, 2.4, 1], [2, 1, .3, 0]);
      for (let i = 0; i < N(14); i++) { V.randomDirection().multiplyScalar(rr(3, 9)).addScaledVector(n, rr(2, 4)); this.glow.emit(p, V, rr(.15, .4), rr(.02, .035), .008, [4, 3, 1.5, 1], [1.6, .45, .08, 0], .7, -9.8); }
      for (let i = 0; i < N(3); i++) { V.randomDirection().multiplyScalar(rr(.2, .6)).addScaledVector(n, rr(.5, 1.2)); this.smoke.emit(p, V, rr(.6, 1.2), .04, rr(.25, .4), [.4, .39, .37, .45], [.5, .49, .47, 0], 2.5, .2, .6); }
      this.decal(p, n, rr(.04, .055), 2); return;
    }
    const ground = surface === 'sand' || surface === 'mud' || (n.y > .75 && p.y < .3);
    if (ground) {
      const d = G.wind ? [.55, .47, .35] : [.5, .45, .37], dd = d.map(c => c * .7);
      for (let i = 0; i < N(14); i++) { V.set(rr(-.7, .7), 0, rr(-.7, .7)).addScaledVector(n, rr(2.5, 6.5)); this.smoke.emit(p, V, rr(.45, .85), rr(.035, .06), rr(.09, .16), [...dd, .95], [...dd, .5], .25, -9.8); }
      for (let i = 0; i < N(6); i++) { V.randomDirection().multiplyScalar(rr(.3, 1.2)).addScaledVector(n, rr(.5, 1.6)); this.smoke.emit(V2.copy(p).addScaledVector(n, .05), V, rr(1.6, 3.2), rr(.1, .18), rr(.7, 1.5), [...d, .6], [...d, 0], 2.4, -.12, .8); }
      if (n.y > .5) this.decal(p, n, rr(.1, .15), 3); return;
    }
    const dust = [.68, .65, .6], chip = R() < .5 ? [.72, .69, .63] : [.36, .33, .29];
    this.glow.emit(V2.copy(p).addScaledVector(n, .02), V.copy(n).multiplyScalar(.4), .035, .06, .14, [3, 2.7, 2.2, 1], [1, .75, .45, 0]);
    for (let i = 0; i < N(8); i++) { V.randomDirection().multiplyScalar(rr(.3, 1.4)).addScaledVector(n, rr(1.5, 4.2)); this.smoke.emit(p, V, rr(.9, 2.4), rr(.04, .08), rr(.4, .95), [...dust, .72], [...dust, 0], 3.2, -.15, .7); }
    for (let i = 0; i < N(7); i++) { V.randomDirection().multiplyScalar(rr(1.2, 3.5)).addScaledVector(n, rr(1, 3)); this.smoke.emit(p, V, rr(.5, 1.1), rr(.012, .024), .012, [...chip, 1], [...chip, 1], .3, -9.8); }
    for (let i = 0; i < N(3); i++) this.smoke.emit(V2.copy(p).addScaledVector(n, .03), V.set(rr(-.1, .1), rr(-.4, -.1), rr(-.1, .1)).addScaledVector(n, .15), rr(1.5, 3), .04, rr(.2, .35), [...dust, .35], [...dust, 0], .6, -.5, .5);
    if (R() < .3) for (let i = 0; i < 2; i++) { V.randomDirection().multiplyScalar(rr(3, 7)).addScaledVector(n, 2.5); this.glow.emit(p, V, rr(.06, .14), .025, .01, [3, 2.3, 1.1, 1], [1, .4, .1, 0], 1, -9.8); }
    this.decal(p, n, rr(.07, .11), R() < .5 ? 0 : 1);
  }
  // Multi-layer flash: a white-hot core, a short forward plume, the A2 birdcage's side jets (its slots are on top and
  // the sides, none underneath, which is why the jets fan up and sideways), unburnt powder sparks, then grey smoke that
  // hangs in the air and drifts off with the breeze. All of it lives two or three frames except the smoke.
  muzzle(p, dir, big = 1) {
    this.glow.emit(V.copy(p).addScaledVector(dir, .02), V2.copy(dir), .03, .12 * big, .22 * big, [6, 4.6, 2.6, 1], [2.5, 1.2, .3, 0]);
    for (let i = 0; i < 3; i++) this.glow.emit(V.copy(p).addScaledVector(dir, .05 + i * .07), V2.copy(dir).multiplyScalar(2), .04, (.2 - i * .045) * big, .05, [4.5, 3.2, 1.6, 1], [2, 1, .3, 0]);
    for (let i = 0, n = NQ(3); i < n; i++) { V.randomDirection(); V.addScaledVector(dir, -V.dot(dir)); if (V.y < 0) V.y = -V.y; V.normalize().multiplyScalar(rr(2.5, 5)); this.glow.emit(V2.copy(p).addScaledVector(dir, .015), V, .03, .07 * big, .02, [4, 2.8, 1.3, 1], [1.5, .6, .1, 0]); }
    if (G.quality > 0) for (let i = 0; i < 2; i++) { V.copy(dir).multiplyScalar(rr(8, 16)).add(V2.randomDirection().multiplyScalar(2)); this.glow.emit(p, V, rr(.05, .12), .014, .007, [3, 2, .8, 1], [1, .3, .05, 0], .5, -4); }
    for (let i = 0, n = NQ(3); i < n; i++) this.smoke.emit(V2.copy(p).addScaledVector(dir, rr(.05, .3)), V.copy(dir).multiplyScalar(rr(.6, 1.5)).add(V2.set(rr(-.2, .2), rr(0, .3), rr(-.2, .2))), rr(1.4, 3), .05, rr(.4, .8), [.62, .6, .57, .2], [.7, .68, .65, 0], 2.2, .25, .9);
    const f = this.flashLights[this.fi]; this.fi = (this.fi + 1) % this.flashLights.length; f.l.position.copy(p); f.l.intensity = 14 * big * rr(.75, 1.2); f.t = .05;
  }
  // a thin wisp off a hot barrel after a long burst (weapon.js calls it while the gun cools)
  barrelSmoke(p, k = 1) { if (G.quality > 0) this.smoke.emit(p, V.set(rr(-.05, .05), rr(.25, .45), rr(-.05, .05)), rr(1.2, 2), .02, rr(.12, .22), [.7, .69, .67, .14 * k], [.75, .74, .72, 0], .6, .35, .6); }
  tracer(from, to, enemy = false) {
    const m = new THREE.Mesh(this.tracerGeo, enemy ? this.tracerMatE : this.tracerMat); m.position.copy(from); m.lookAt(to); m.scale.set(1, 1, rr(1.5, 3)); G.scene.add(m);
    this.tracers.push({ m, from: from.clone(), to: to.clone(), d: from.distanceTo(to), t: 0, speed: 700 });
  }
  casing(p, vel) {
    let c = this.casings[this.casingI]; if (!c) c = this.casings[this.casingI] = { p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), t: 0, floor: null };
    c.p.copy(p); c.v.copy(vel); c.q.setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3)); c.w.set(rr(-25, 25), rr(-8, 8), rr(15, 30)); c.t = 0; c.floor = null; c.i = this.casingI;
    this.casingI = (this.casingI + 1) % this.casingMax; this.casingMesh.count = Math.min(this.casingMax, this.casingMesh.count + 1);
  }
  explosion(p, big = 1) {
    this.glow.emit(p, V.set(0, 0, 0), .22, 6 * big, 14 * big, [6, 5, 3.5, 1], [3, 1.5, .4, 0]);
    for (let i = 0; i < 24 * big; i++) { V.randomDirection().multiplyScalar(rr(2, 9) * big); V.y = Math.abs(V.y); this.glow.emit(p, V, rr(.3, .7), rr(1, 2.5) * big, rr(2, 4) * big, [4, 2, .6, 1], [.8, .2, .05, 0], 2, 1); }
    for (let i = 0; i < 40 * big; i++) { V.randomDirection().multiplyScalar(rr(5, 18)); V.y = Math.abs(V.y) + 2; this.glow.emit(p, V, rr(.4, 1.2), .08, .04, [3, 2, 1, 1], [1, .4, .1, 0], .5, -9.8); }
    // the cloud lingers: dense dark smoke that climbs and spreads for ten seconds or more, then a slow dust haze
    for (let i = 0; i < 44 * big; i++) { V.randomDirection().multiplyScalar(rr(1, 5) * big); V.y = Math.abs(V.y) * 1.5 + 1; this.smoke.emit(V2.copy(p).addScaledVector(V, .2), V, rr(6, 13), rr(1.4, 2.4) * big, rr(6, 11) * big, [.15, .14, .13, .92], [.5, .48, .45, 0], .9, .45); }
    for (let i = 0; i < 16 * big; i++) { V.set(rr(-1, 1), rr(0, .15), rr(-1, 1)).normalize().multiplyScalar(rr(4, 10) * big); this.smoke.emit(V2.copy(p).add(new THREE.Vector3(0, .2, 0)), V, rr(8, 16), rr(1.5, 3) * big, rr(7, 12) * big, [.6, .55, .47, .55], [.66, .62, .55, 0], 1.3, .12); }
    this.bigLight.position.copy(p).y += 1; this.bigLight.intensity = 800 * big; this.bigT = .35;
  }
  dustBurst(p, r, n = 30, col = [.72, .64, .5]) { for (let i = 0; i < n; i++) { V.set(rr(-1, 1), rr(0, .4), rr(-1, 1)).normalize().multiplyScalar(rr(3, 9)); this.smoke.emit(V2.copy(p).add(new THREE.Vector3(rr(-r, r), rr(0, .4), rr(-r, r))), V, rr(1.5, 3), rr(.6, 1.2), rr(3, 6), [...col, .6], [...col, 0], 1.2, .2); } }
  coloredSmoke(p, col) { for (let i = 0; i < 3; i++) this.smoke.emit(V2.copy(p).add(new THREE.Vector3(rr(-.2, .2), 0, rr(-.2, .2))), V.set(rr(-.4, .4) + 1.2, rr(1.2, 2.2), rr(-.4, .4)), rr(5, 8), .4, rr(4, 7), [...col, .85], [...col.map(c => c * 1.2), 0], .3, .3); }
  update(dt) {
    this.smoke.update(dt); this.glow.update(dt);
    for (const f of this.flashLights) { if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.l.intensity = 0; } }
    if (this.bigT > 0) { this.bigT -= dt; this.bigLight.intensity = Math.max(0, this.bigT / .35) * 800; }
    for (let i = this.tracers.length - 1; i >= 0; i--) { const t = this.tracers[i]; t.t += dt * t.speed; if (t.t >= t.d) { G.scene.remove(t.m); this.tracers.splice(i, 1); continue; } t.m.position.copy(t.from).lerp(t.to, t.t / t.d); }
    // brass: ballistic flight with spin, a couple of damped bounces, then it lies on its side where it stopped. While a
    // case is still within 40 cm of the eye it is not drawn: world-scale brass that close fills the screen and the flash
    // light turns it into a gold bar (the view-model hides the ejection anyway)
    let moved = false;
    for (const c of this.casings) { if (!c || c.t > 3) continue; moved = true; c.t += dt; c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt);
      _Q.setFromAxisAngle(V.copy(c.w).normalize(), c.w.length() * dt); c.q.premultiply(_Q);
      if (c.floor === null) c.floor = G.floorAt ? G.floorAt(c.p) : 0;
      if (c.p.y < c.floor + .005) { c.p.y = c.floor + .005; c.v.y *= -.3; c.v.x *= .5; c.v.z *= .5; c.w.multiplyScalar(.5);
        if (Math.abs(c.v.y) < .3) { c.v.set(0, 0, 0); c.t = 9; V.set(0, 0, 1).applyQuaternion(c.q); V.y = 0; if (V.lengthSq() < 1e-4) V.set(1, 0, 0); c.q.setFromUnitVectors(_Z, V.normalize()).premultiply(_Q.setFromAxisAngle(V, R() * 6.28)); } }
      const near = c.t < .3 && G.camera && c.p.distanceToSquared(G.camera.position) < .16;
      this.casingMesh.setMatrixAt(c.i, _M.compose(c.p, c.q, _S.setScalar(near ? 0 : 1))); }
    if (moved) this.casingMesh.instanceMatrix.needsUpdate = true;
  }
}
