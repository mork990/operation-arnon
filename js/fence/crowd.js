// The crowd: hundreds of protesters drawn as instanced impostors that are baked at load time from the real
// Rocketbox characters (13 poses x 8 view directions x 2 view heights per look), with a light agent simulation.
// Anyone who gets hurt is "promoted" to a full skinned Actor so they can fall, be treated and carried away.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { G, rr, R, ri, clamp, lerp, pick, bus, angleLerp } from '../core.js';
import { A } from '../assets.js';
import { Actor } from '../actors.js';
import { hF } from './world.js';

export const LOOKS = [
  { m: 'pM1', s: 'm', w: .12 }, { m: 'pM2', s: 'm', w: .13 }, { m: 'pM3', s: 'm', w: .07 }, { m: 'pM4', s: 'm', w: .12 }, { m: 'pM5', s: 'm', w: .12 },
  { m: 'hostM1', s: 'm', w: .12 }, { m: 'hostM2', s: 'm', w: .12 }, { m: 'guard2', s: 'm', w: .08 }, { m: 'civM1', s: 'm', w: .05 }, { m: 'civF1', s: 'f', w: .07 },
];
export const FEMALE_LOOK = 9, OLD_LOOK = 8;
function pickLook(looks) { let r = R() * looks.reduce((a, l) => a + l.w, 0); for (let i = 0; i < looks.length; i++) { r -= looks[i].w; if (r <= 0) return i; } return 0; }
// frame table: [name, male clip, female clip, time fraction]
const FR = [
  ['walk0', 'm_walk_neutral_01', 'f_walk_neutral_01', 0], ['walk1', 'm_walk_neutral_01', 'f_walk_neutral_01', .25], ['walk2', 'm_walk_neutral_01', 'f_walk_neutral_01', .5], ['walk3', 'm_walk_neutral_01', 'f_walk_neutral_01', .75],
  ['run0', 'm_run_neutral_01', 'f_run_neutral_01', 0], ['run1', 'm_run_neutral_01', 'f_run_neutral_01', .25], ['run2', 'm_run_neutral_01', 'f_run_neutral_01', .5], ['run3', 'm_run_neutral_01', 'f_run_neutral_01', .75],
  ['idle', 'm_idle_neutral_01', 'f_idle_neutral_01', .3], ['cheerA', 'm_cheer_03', 'f_cheer_01', .22], ['cheerB', 'm_cheer_03', 'f_cheer_01', .62],
  ['angry', 'm_idle_angry_02', 'f_idle_angry_01', .45], ['cough', 'm_idle_cough_01', 'f_idle_cough_01', .4],
];
const F = FR.length, D = 8, E = 2, CW = 40, CH = 80, COLS = 102;
const FI = Object.fromEntries(FR.map((f, i) => [f[0], i]));
const MAXN = 520;

const vs = `
attribute vec3 iPos; attribute vec4 iData; attribute vec3 iTint;
uniform vec2 uAtlas; uniform float uCols, uCellW, uCellH; uniform vec3 uSun;
varying vec2 vUv; varying vec3 vTint; varying float vShade; varying float vHide;
#include <fog_pars_vertex>
void main(){
  float yaw = iData.x, frame = iData.y, look = iData.z, scale = iData.w;
  vHide = step(scale, 0.001);
  vec3 c = iPos + vec3(0., .95 * scale, 0.);
  vec3 toCam = cameraPosition - c; float dh = length(toCam.xz);
  float elevA = atan(toCam.y, dh);
  float el = elevA > .38 ? 1. : 0.;
  float rel = yaw - atan(toCam.x, toCam.z);
  float dir = mod(floor(rel / .785398 + .5), 8.); if (dir < 0.) dir += 8.;
  float idx = ((look * ${F}. + frame) * ${E}. + el) * ${D}. + dir;
  float col = mod(idx, uCols), row = floor(idx / uCols);
  vUv = vec2((col + uv.x) * uCellW, 1. - (row + 1. - uv.y) * uCellH);
  // camera-facing quad (the bake already holds the perspective of each view height)
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  if (el < .5) { up = vec3(0., 1., 0.); right = normalize(vec3(right.x, 0., right.z)); }
  vec3 wp = c + (right * (position.x) + up * (position.y)) * scale;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.);
  gl_Position = projectionMatrix * mvPosition;
  // backlit when looking toward the low sun: darker body, rim light
  vec2 v2 = normalize(-toCam.xz + 1e-4), s2 = normalize(uSun.xz + 1e-4);
  vShade = mix(1.12, .82, clamp(dot(v2, s2) * .5 + .5, 0., 1.));
  vTint = iTint;
  #include <fog_vertex>
}`;
const fs = `
uniform sampler2D uMap; uniform float uHot; varying vec2 vUv; varying vec3 vTint; varying float vShade; varying float vHide;
#include <fog_pars_fragment>
void main(){
  if (vHide > .5) discard;
  vec4 t = texture2D(uMap, vUv);
  if (t.a < .42) discard;
  vec3 col = t.rgb * vTint * vShade;
  if (uHot > .5) col = vec3(1.55);
  gl_FragColor = vec4(col, 1.);
  #include <fog_fragment>
}`;

export class Crowd {
  constructor() {
    this.n = 0; this.agents = []; this.hot = false;
    this.front = -380; this.mood = .3; this.cheer = .3; this.targetN = 0; this.spawnAcc = 0;
    this.gasClouds = []; G.gasClouds = this.gasClouds;
  }
  // ---------- bake ----------
  async bake(renderer, onP) {
    const looks = LOOKS.filter(l => A.chars[l.m]); this.looks = looks;
    const rows = Math.ceil(looks.length * F * E * D / COLS);
    const W = COLS * CW, H = rows * CH;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
    rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter; rt.texture.magFilter = THREE.LinearFilter; rt.texture.anisotropy = 4;
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight('#ffffff', '#8a7660', 1.35));
    const key = new THREE.DirectionalLight('#fff4e6', 2.3); sc.add(key, key.target);
    const cam = new THREE.OrthographicCamera(-.5, .5, 1.0, -1.0, .1, 40);
    const prevRT = renderer.getRenderTarget(), prevTM = renderer.toneMapping, prevSM = renderer.shadowMap.enabled; const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false; renderer.setClearColor(0x000000, 0);
    // allocate the full mip chain now, then keep mip generation off while the cells are drawn (re-enabled for one final pass)
    rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H); rt.scissorTest = false; renderer.setRenderTarget(rt); renderer.clear(true, true, true);
    rt.texture.generateMipmaps = false;
    let done = 0; const total = looks.length * F;
    for (let li = 0; li < looks.length; li++) {
      const L = looks[li]; const root = SkeletonUtils.clone(A.chars[L.m].scene); root.traverse(c => { if (c.isMesh) { c.frustumCulled = false; c.castShadow = false; } }); sc.add(root);
      const mixer = new THREE.AnimationMixer(root);
      for (let fi = 0; fi < F; fi++) {
        const [, cm, cf, frac] = FR[fi]; const clip = A.clips[L.s === 'f' ? cf : cm] || A.clips[cm]; mixer.stopAllAction();
        if (clip) { const a = mixer.clipAction(clip); a.reset().play(); mixer.setTime(clip.duration * frac); }
        for (let e = 0; e < E; e++) {
          const ang = e ? .68 : .07; cam.position.set(0, .95 + Math.sin(ang) * 10, Math.cos(ang) * 10); cam.lookAt(0, .95, 0); cam.updateMatrixWorld();
          key.position.copy(cam.position).add(new THREE.Vector3(-4, 6, 0)); key.target.position.set(0, .9, 0);
          for (let d = 0; d < D; d++) {
            root.rotation.y = d * Math.PI / 4; root.updateMatrixWorld(true);
            const idx = ((li * F + fi) * E + e) * D + d; const col = idx % COLS, row = Math.floor(idx / COLS);
            const x = col * CW, y = H - (row + 1) * CH; rt.viewport.set(x, y, CW, CH); rt.scissor.set(x, y, CW, CH); rt.scissorTest = true;
            renderer.setRenderTarget(rt); renderer.render(sc, cam);
          }
        }
        done++; if (done % 6 === 0) { onP && onP(done / total); await new Promise(r => setTimeout(r, 0)); }
      }
      sc.remove(root);
    }
    // one empty pass with mipmaps enabled builds the chain for the whole atlas
    rt.texture.generateMipmaps = true; rt.viewport.set(0, 0, 1, 1); rt.scissor.set(0, 0, 1, 1); const ac = renderer.autoClear; renderer.autoClear = false; renderer.setRenderTarget(rt); renderer.render(new THREE.Scene(), cam); renderer.autoClear = ac;
    rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H); rt.scissorTest = false;
    renderer.setRenderTarget(prevRT); renderer.toneMapping = prevTM; renderer.shadowMap.enabled = prevSM; renderer.setClearColor(prevClear, prevA);
    this.atlas = rt; this.buildMesh(W, H, rows); onP && onP(1);
  }
  buildMesh(W, H, rows) {
    const quad = new THREE.PlaneGeometry(1, 2);
    const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 3).fill(1), 3);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iData', this.aData); g.setAttribute('iTint', this.aTint); g.instanceCount = 0;
    this.u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uCols: { value: COLS }, uCellW: { value: CW / W }, uCellH: { value: CH / H }, uSun: { value: G.sunDir }, uHot: { value: 0 }, uAtlas: { value: new THREE.Vector2(W, H) } }]);
    this.u.uMap.value = this.atlas.texture;
    const m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: this.u, fog: true });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.layers.enable(1); G.scene.add(this.mesh);
    // long late-afternoon shadows: a soft stretched blot per person, pointing away from the sun
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2); sg.translate(0, 0, .5);
    const st = document.createElement('canvas'); st.width = 32; st.height = 64; const c2 = st.getContext('2d'); const gr = c2.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c2.fillStyle = gr; c2.beginPath(); c2.ellipse(16, 32, 12, 30, 0, 0, 7); c2.fill();
    this.shadow = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(st), transparent: true, depthWrite: false, color: '#000000', opacity: .8, polygonOffset: true, polygonOffsetFactor: -3 }), MAXN);
    this.shadow.count = 0; this.shadow.frustumCulled = false; this.shadow.renderOrder = 1; G.scene.add(this.shadow);
    const sd = G.sunDir; this.shYaw = Math.atan2(-sd.x, -sd.z); this.shLen = Math.min(7, 1.7 / Math.tan(Math.max(.15, Math.asin(sd.y))));
  }
  setHot(on) {
    if (this.hot === on) return; this.hot = on; if (this.u) this.u.uHot.value = on ? 1 : 0; if (this.shadow) this.shadow.visible = !on;
    if (G.fx) G.fx.smoke.pts.visible = !on; // thermal sees through the tyre smoke
    for (const a of G.actors) a.root.traverse(c => { if (!c.isMesh) return; if (on) { c.userData.mat0 = c.material; c.material = hotMat(c.material, a); } else if (c.userData.mat0) { c.material = c.userData.mat0; c.userData.mat0 = null; } });
    for (const h of G.hotObjects || []) h.traverse(c => { if (!c.isMesh) return; if (on) { c.userData.mat0 = c.material; c.material = warmMat; } else if (c.userData.mat0) { c.material = c.userData.mat0; c.userData.mat0 = null; } });
  }
  // ---------- agents ----------
  spawn(x, z, opts = {}) {
    if (this.agents.length >= MAXN) return null;
    const look = opts.look ?? pickLook(this.looks || LOOKS);
    const a = { i: this.agents.length, x, z, y: hF(x, z), yaw: rr(-3, 3), vx: 0, vz: 0, sp: 0, state: opts.state || 'mill', tx: x, tz: z, cx: opts.cx ?? x, cz: opts.cz ?? z, rad: opts.rad ?? 25,
      look: Math.min(look, (this.looks || LOOKS).length - 1), scale: opts.kid ? rr(.72, .82) : rr(.94, 1.06), tint: [rr(.86, 1.1), rr(.86, 1.05), rr(.84, 1.02)], phase: R(), act: 'idle', actT: rr(1, 5),
      gas: 0, bold: opts.bold ?? R(), alive: true, kid: !!opts.kid, t: 0 };
    this.agents.push(a); return a;
  }
  // everyone in the crowd within r of p (optionally only the bold ones) moves to a new area
  sendTo(filter, x, z, rad, state = 'walkto', run = false) {
    // people move in knots: a few gathering points spread over the area, each one a tight cluster
    const K = Math.max(1, Math.round(rad / 13)); const cs = Array.from({ length: K }, (_, i) => [x + rr(-rad, rad) * .25, z + (K > 1 ? -rad + (i + .5) * 2 * rad / K : 0) + rr(-4, 4)]);
    for (const a of this.agents) if (a.alive && filter(a)) { const c = cs[Math.floor(R() * K)]; a.state = state; a.cx = c[0] + rr(-4, 4); a.cz = c[1] + rr(-5, 5); a.rad = 6; a.tx = a.cx; a.tz = a.cz; a.run = run; } }
  inGas(x, z) { let g = 0; for (const c of this.gasClouds) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r) g = Math.max(g, c.k * (1 - d / c.r * .6)); } return g; }
  raycast(o, dir, maxT) { // ray vs a vertical capsule per person (dir normalised)
    let best = null; const h2 = dir.x * dir.x + dir.z * dir.z; if (h2 < 1e-6) return null;
    for (const a of this.agents) { if (!a.alive) continue;
      const t = ((a.x - o.x) * dir.x + (a.z - o.z) * dir.z) / h2; if (t < 0 || t > maxT) continue;
      const px = o.x + dir.x * t, py = o.y + dir.y * t, pz = o.z + dir.z * t; const hh = py - a.y; if (hh < 0 || hh > 1.75 * a.scale) continue;
      if ((px - a.x) ** 2 + (pz - a.z) ** 2 > .075) continue;
      if (!best || t < best.t) best = { t, agent: a, part: hh > 1.45 * a.scale ? 'head' : hh > .9 * a.scale ? 'body' : 'legs' }; }
    return best;
  }
  // turn an impostor into a full character (for casualties, arrests, anyone the story needs up close)
  promote(a, kind = 'civ') {
    if (!a.alive) return null; a.alive = false; const L = this.looks[a.look];
    const act = new Actor(L.m, kind, new THREE.Vector3(a.x, a.y, a.z), a.yaw, {}); act.root.scale.setScalar(a.scale); act.fromCrowd = a; act.crowdLook = a.look;
    return act;
  }
  // ---------- simulation ----------
  update(dt) {
    if (!this.mesh) return;
    for (const c of this.gasClouds) { c.t += dt; c.x += G.wind.x * dt * .35; c.z += G.wind.z * dt * .35; c.r = Math.min(c.rMax, c.r + dt * 3.5); c.k = Math.max(0, 1 - c.t / c.life); }
    for (let i = this.gasClouds.length - 1; i >= 0; i--) if (this.gasClouds[i].k <= 0) this.gasClouds.splice(i, 1);
    // spatial hash for spacing
    const cell = 1.3, hash = this._h || (this._h = new Map()); hash.clear();
    for (const a of this.agents) { if (!a.alive) continue; const k = Math.floor(a.x / cell) * 4096 + Math.floor(a.z / cell); let b = hash.get(k); if (!b) hash.set(k, b = []); b.push(a); }
    const cam = G.drone && G.drone.active ? G.drone.cam.position : G.camera.position;
    let n = 0;
    for (const a of this.agents) {
      if (!a.alive) { continue; }
      a.t += dt; this.brain(a, dt);
      // separation
      const ci = Math.floor(a.x / cell), cj = Math.floor(a.z / cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const b = hash.get((ci + di) * 4096 + cj + dj); if (!b) continue; for (const o of b) { if (o === a) continue; const dx = a.x - o.x, dz = a.z - o.z; const d2 = dx * dx + dz * dz; if (d2 < .36 && d2 > 1e-6) { const d = Math.sqrt(d2), p = (.6 - d) * .5; a.x += dx / d * p; a.z += dz / d * p; } } }
      // the barrier: nobody passes x > -0.55 (wall face / fence); concertina slows people down
      const br = this.breach; if (a.x > -.55 && a.x < .7 && !(br && br.open && Math.abs(a.z - br.z) < 2.3)) a.x = -.55;
      a.y = hF(a.x, a.z);
      // pack instance
      const f = this.frameOf(a, dt);
      this.aPos.setXYZ(n, a.x, a.y, a.z); this.aData.setXYZW(n, a.yaw, f, a.look, a.scale);
      this.aTint.setXYZ(n, a.tint[0], a.tint[1], a.tint[2]);
      a.slot = n; n++;
    }
    this.mesh.geometry.instanceCount = n; this.aPos.needsUpdate = true; this.aData.needsUpdate = true; this.aTint.needsUpdate = true;
    // shadows
    const o = this._o || (this._o = new THREE.Object3D()); let k = 0;
    for (const a of this.agents) { if (!a.alive) continue; if ((a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 > 260 * 260) continue; o.position.set(a.x, a.y + .03, a.z); o.rotation.set(0, this.shYaw, 0); o.scale.set(.55 * a.scale, 1, this.shLen * a.scale); o.updateMatrix(); this.shadow.setMatrixAt(k++, o.matrix); }
    this.shadow.count = k; this.shadow.instanceMatrix.needsUpdate = true;
    this.count = n;
  }
  frameOf(a, dt) {
    const sp = a.sp;
    if (sp > 2.2) { a.phase = (a.phase + dt * sp / 2.6) % 1; return FI.run0 + Math.floor(a.phase * 4) % 4; }
    if (sp > .25) { a.phase = (a.phase + dt * sp / 1.45) % 1; return FI.walk0 + Math.floor(a.phase * 4) % 4; }
    if (a.act === 'cheer') { a.phase = (a.phase + dt * .9) % 1; return a.phase < .5 ? FI.cheerA : FI.cheerB; }
    return FI[a.act] ?? FI.idle;
  }
  brain(a, dt) {
    // gas: cough, then run out of the cloud (away from its centre, and upwind toward Gaza)
    const gas = this.inGas(a.x, a.z); a.gas = clamp(a.gas + (gas > .05 ? gas * dt * 1.6 : -dt * .12), 0, 1.5);
    if (a.gas > .35 && a.state !== 'flee' && a.state !== 'cough' && a.state !== 'leave') { a.state = 'cough'; a.stateT = rr(1.2, 2.8); a.bold *= .8; }
    const goTo = (tx, tz, speed) => { const dx = tx - a.x, dz = tz - a.z; const d = Math.hypot(dx, dz); if (d < .35) { a.sp = lerp(a.sp, 0, Math.min(1, dt * 6)); return true; } a.sp = lerp(a.sp, speed, Math.min(1, dt * 3)); let s = a.sp; if (a.x > -7.2 && a.x < -5.2 && !this.wireCut) s *= .3; a.x += dx / d * s * dt; a.z += dz / d * s * dt; a.yaw = Math.atan2(dx, dz); return false; };
    switch (a.state) {
      case 'cough': a.sp = lerp(a.sp, 0, dt * 5); a.act = 'cough'; a.stateT -= dt; if (a.stateT <= 0) { a.state = 'flee'; const c = this.gasClouds[0]; const ax = c ? a.x - c.x : -1, az = c ? a.z - c.z : 0; const L = Math.hypot(ax, az) || 1; a.tx = a.x - rr(35, 70) + ax / L * 10; a.tz = a.z + az / L * rr(10, 30); } break;
      case 'flee': if (goTo(a.tx, a.tz, a.kid ? 3.4 : 3.8)) { a.state = 'mill'; a.cx = a.x; a.cz = a.z; a.rad = 12; } break;
      case 'walkto': case 'surge': { const arrived = goTo(a.tx, a.tz, a.run || a.state === 'surge' ? rr(2.8, 3.6) : 1.3);
        if (arrived) { if (a.breacher && this.breach && this.breach.open && a.x > -4 && a.x < 0) { a.tx = rr(12, 30); a.tz = this.breach.z + rr(-14, 14); a.run = true; break; } a.state = a.state === 'surge' ? 'press' : 'mill'; a.actT = 0; } break; }
      case 'arrested': a.sp = lerp(a.sp, 0, dt * 6); a.act = 'cough'; break;
      case 'press': // at the barrier: shouting, throwing, pressing
        a.sp = lerp(a.sp, 0, dt * 4); a.actT -= dt; if (a.actT <= 0) { a.act = R() < .5 ? 'cheer' : 'angry'; a.actT = rr(1.5, 4); if (R() < .3) { a.tx = Math.min(-.6, a.x + rr(-2, 2)); a.tz = a.z + rr(-3, 3); a.state = 'shuffle'; } }
        break;
      case 'shuffle': if (goTo(a.tx, a.tz, .9)) a.state = 'press'; break;
      case 'leave': if (goTo(a.tx, a.tz, 1.3) || a.x < -420) { a.alive = false; } break;
      case 'mill': default: {
        a.actT -= dt;
        if (a.moving) { if (goTo(a.tx, a.tz, a.run ? 3 : 1.1)) a.moving = false; }
        else { a.sp = lerp(a.sp, 0, dt * 5); if (a.actT <= 0) { const r = R(); const agit = this.cheer * (.4 + a.bold);
          if (r < .28) { a.moving = true; a.tx = a.cx + rr(-a.rad, a.rad) * .5; a.tz = a.cz + rr(-a.rad, a.rad); a.run = false; a.actT = rr(2, 5); }
          else { a.act = R() < agit ? (R() < .6 ? 'cheer' : 'angry') : 'idle'; a.actT = rr(2, 6); a.yaw = angleLerp(a.yaw, Math.PI / 2 + rr(-.6, .6), .7); } } }
      }
    }
  }
  // crowd-wide helpers used by the scenario
  alive() { return this.agents.filter(a => a.alive); }
  near(x, z, r) { return this.agents.filter(a => a.alive && (a.x - x) ** 2 + (a.z - z) ** 2 < r * r); }
  count2(x0, x1) { let n = 0; for (const a of this.agents) if (a.alive && a.x > x0 && a.x < x1) n++; return n; }
  reset() { this.agents.length = 0; this.gasClouds.length = 0; if (this.mesh) this.mesh.geometry.instanceCount = 0; if (this.shadow) this.shadow.count = 0; this.wireCut = false; }
}

// thermal materials for skinned people (keep the alpha of hair cards) and warm engines
const hotCache = new WeakMap();
function hotMat(m, a) {
  let h = hotCache.get(m); if (h) return h;
  h = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), map: m.map || null, alphaTest: m.alphaTest || 0, side: m.side, fog: true });
  h.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = vec3(1.6);'); };
  h.customProgramCacheKey = () => 'hot'; hotCache.set(m, h); return h;
}
const warmMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(.75, .75, .75) });
