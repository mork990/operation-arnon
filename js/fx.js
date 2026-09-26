// Visual effects: particles, decals, tracers, muzzle flashes, casings, explosions
import * as THREE from 'three';
import { G, rr, R, clamp, fogGLSL } from './core.js';
import { GIU, GI_FUNCS } from './gi.js';

// smoke and dust are lit like everything else: the baked sky visibility where the puff is, plus the sun where the static
// sun shadow says it reaches (unlit puffs glowed in dark rooms and washed the whole frame out)
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
    this.c0 = new Float32Array(n * 4); this.c1 = new Float32Array(n * 4); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.spin = new Float32Array(n);
    this.alive = 0;
  }
  emit(p, v, life, s0, s1, c0, c1, drag = 0, grav = 0) {
    const i = this.i; this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z; this.v[i * 3] = v.x; this.v[i * 3 + 1] = v.y; this.v[i * 3 + 2] = v.z;
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.c0.set(c0, i * 4); this.c1.set(c1, i * 4); this.drag[i] = drag; this.grav[i] = grav; this.rot[i] = R() * 6.28; this.spin[i] = rr(-.6, .6);
  }
  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) this.size[i] = 0; continue; }
      alive++; this.life[i] -= dt; const k = 1 - Math.max(0, this.life[i]) / this.max[i]; const j = i * 3, c = i * 4;
      const dr = Math.max(0, 1 - this.drag[i] * dt); this.v[j] *= dr; this.v[j + 1] = this.v[j + 1] * dr + this.grav[i] * dt; this.v[j + 2] *= dr;
      this.pos[j] += this.v[j] * dt; this.pos[j + 1] += this.v[j + 1] * dt; this.pos[j + 2] += this.v[j + 2] * dt; this.rot[i] += this.spin[i] * dt;
      const e = 1 - Math.pow(1 - k, 2); this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      for (let q = 0; q < 4; q++) this.col[c + q] = this.c0[c + q] + (this.c1[c + q] - this.c0[c + q]) * k;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    this.alive = alive;
    const a = this.G2.attributes; a.position.needsUpdate = a.pc.needsUpdate = a.size.needsUpdate = a.rot.needsUpdate = true;
  }
}

const V = new THREE.Vector3(), V2 = new THREE.Vector3();
export class FX {
  constructor() {
    this.smoke = new PS(3500, false); this.glow = new PS(1600, true);
    // decals (bullet holes / scorch) via instanced quads
    this.decalMax = 400; this.decalI = 0;
    const dt = this.decalTex();
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }), this.decalMax);
    this.decals.count = 0; this.decals.frustumCulled = false; G.scene.add(this.decals);
    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(.012, .012, 1, 4); tg.rotateX(Math.PI / 2); tg.translate(0, 0, -.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 1.8), transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracerMatE = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 1.6), transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracerGeo = tg;
    // muzzle flash light pool
    this.flashLights = [0, 1, 2].map(() => { const l = new THREE.PointLight('#ffb870', 0, 9, 2); G.scene.add(l); return { l, t: 0 }; }); this.fi = 0;
    // casings
    this.casings = []; this.casingGeo = new THREE.CylinderGeometry(.005, .005, .045, 6); this.casingMat = new THREE.MeshStandardMaterial({ color: '#c89a3a', metalness: .9, roughness: .3 });
    this.bigLight = new THREE.PointLight('#ffb070', 0, 60, 1.6); G.scene.add(this.bigLight); this.bigT = 0;
  }
  // a bullet strike in plaster/block: dark cratered hole, jagged rim of chipped-off paint showing the lighter render
  // underneath, radial cracks and a faint halo of dust
  decalTex() {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); const m = S / 2;
    const halo = g.createRadialGradient(m, m, 6, m, m, m); halo.addColorStop(0, 'rgba(120,108,94,.55)'); halo.addColorStop(.5, 'rgba(140,128,112,.22)'); halo.addColorStop(1, 'rgba(140,128,112,0)'); g.fillStyle = halo; g.fillRect(0, 0, S, S);
    const blob = (r0, jag, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i <= 18; i++) { const a = i / 18 * 6.283, r = r0 * (1 - jag + Math.random() * jag * 2); g[i ? 'lineTo' : 'moveTo'](m + Math.cos(a) * r, m + Math.sin(a) * r); } g.fill(); };
    blob(30, .35, 'rgba(206,196,178,.95)');   // chipped paint ring (fresh, lighter render)
    blob(19, .3, 'rgba(120,110,98,1)');       // crater wall
    blob(11, .25, 'rgba(22,19,16,1)');        // hole
    g.strokeStyle = 'rgba(40,34,28,.55)'; g.lineWidth = 1.2; for (let i = 0; i < 7; i++) { const a = Math.random() * 6.283; g.beginPath(); g.moveTo(m + Math.cos(a) * 14, m + Math.sin(a) * 14); g.lineTo(m + Math.cos(a + (Math.random() - .5) * .3) * (30 + Math.random() * 26), m + Math.sin(a + (Math.random() - .5) * .3) * (30 + Math.random() * 26)); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  setScale(s) { this.smoke.u.uScale.value = this.glow.u.uScale.value = s; }
  decal(p, n, size = .09) {
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const q2 = new THREE.Quaternion().setFromAxisAngle(n, R() * 6.28); q.premultiply(q2);
    m.compose(p.clone().addScaledVector(n, .004), q, new THREE.Vector3(size, size, 1));
    this.decals.setMatrixAt(this.decalI, m); this.decalI = (this.decalI + 1) % this.decalMax; this.decals.count = Math.min(this.decalMax, this.decals.count + 1); this.decals.instanceMatrix.needsUpdate = true;
  }
  impact(p, n, surface = 'concrete') {
    if (surface === 'flesh') { for (let i = 0; i < 6; i++) { V.randomDirection().multiplyScalar(rr(.3, 1.2)).addScaledVector(n, .6); this.smoke.emit(p, V, rr(.25, .5), .06, .25, [.28, .04, .03, .7], [.2, .03, .02, 0], 2, -2); } return; }
    const dust = surface === 'sand' ? [.62, .54, .42] : [.66, .63, .58];
    for (let i = 0; i < 7; i++) { V.randomDirection().multiplyScalar(rr(.4, 2.2)).addScaledVector(n, rr(1, 2.5)); this.smoke.emit(p, V, rr(.5, 1.3), rr(.05, .12), rr(.35, .8), [...dust, .75], [...dust, 0], 2.2, -1.2); }
    for (let i = 0; i < 6; i++) { V.randomDirection().multiplyScalar(rr(2, 6)).addScaledVector(n, 2.5); this.glow.emit(p, V, rr(.08, .2), .03, .01, surface === 'metal' ? [3, 2.4, 1.2, 1] : [1.4, 1.2, 1, .8], [1, .5, .2, 0], 1, -9.8); }
    this.decal(p, n, surface === 'metal' ? .05 : rr(.07, .11));
  }
  muzzle(p, dir, big = 1) {
    for (let i = 0; i < 3; i++) this.glow.emit(V.copy(p).addScaledVector(dir, i * .06), V2.copy(dir).multiplyScalar(2), .045, (.22 - i * .05) * big, .05, [4.5, 3.2, 1.6, 1], [2, 1, .3, 0]);
    for (let i = 0; i < 2; i++) this.smoke.emit(p, V.copy(dir).multiplyScalar(rr(.8, 1.6)).add(V2.set(rr(-.2, .2), rr(0, .3), rr(-.2, .2))), rr(.4, .8), .05, .35, [.6, .58, .55, .25], [.7, .68, .65, 0], 2, .3);
    const f = this.flashLights[this.fi]; this.fi = (this.fi + 1) % this.flashLights.length; f.l.position.copy(p); f.l.intensity = 14 * big; f.t = .05;
  }
  tracer(from, to, enemy = false) {
    const m = new THREE.Mesh(this.tracerGeo, enemy ? this.tracerMatE : this.tracerMat); m.position.copy(from); m.lookAt(to); m.scale.set(1, 1, rr(1.5, 3)); G.scene.add(m);
    this.tracers.push({ m, from: from.clone(), to: to.clone(), d: from.distanceTo(to), t: 0, speed: 700 });
  }
  casing(p, vel) { const m = new THREE.Mesh(this.casingGeo, this.casingMat); m.position.copy(p); m.rotation.set(R() * 3, R() * 3, R() * 3); G.scene.add(m); this.casings.push({ m, v: vel.clone(), t: 0, floor: null }); if (this.casings.length > 40) { const c = this.casings.shift(); G.scene.remove(c.m); } }
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
    for (const c of this.casings) { if (c.t > 3) continue; c.t += dt; c.v.y -= 9.8 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += dt * 20; c.m.rotation.z += dt * 13;
      if (c.floor === null) c.floor = G.floorAt ? G.floorAt(c.m.position) : 0; if (c.m.position.y < c.floor + .01) { c.m.position.y = c.floor + .01; c.v.y *= -.3; c.v.x *= .5; c.v.z *= .5; if (Math.abs(c.v.y) < .3) { c.v.set(0, 0, 0); c.t = 9; } } }
  }
}
