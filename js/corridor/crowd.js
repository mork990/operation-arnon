// The people walking the corridor: hundreds of instanced impostors baked at load time from the Rocketbox characters
// (11 poses x 8 view directions x 2 view heights per look; the technique of mission 2's crowd, see fence/crowd.js),
// with a flow simulation: walk south, queue at the checkpoint lanes, pass the screening point, walk on.
// Anyone the story needs up close (a collapse, a casualty, a suspect) is "promoted" to a full skinned Actor.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { G, rr, R, ri, rng, clamp, lerp, sstep, pick, bus, angleLerp } from '../core.js';
import { A } from '../assets.js';
import { Actor } from '../actors.js';
import { hC as hF, CL } from './world.js';
import { GIU, GI_FUNCS } from '../gi.js';

// families on the move: about half women, older men, young men; children are the same looks scaled down
export const LOOKS = [
  { m: 'pM1', s: 'm', w: .08 }, { m: 'pM2', s: 'm', w: .07 }, { m: 'pM4', s: 'm', w: .08 }, { m: 'hostM1', s: 'm', w: .09 }, { m: 'hostM2', s: 'm', w: .08 },
  { m: 'civM2', s: 'm', w: .07 }, { m: 'civM1', s: 'm', w: .09 }, { m: 'civF1', s: 'f', w: .16 }, { m: 'civF2', s: 'f', w: .16 }, { m: 'hostF', s: 'f', w: .12 },
];
export const FEMALE_LOOKS = [7, 8, 9], OLD_LOOK = 6;
function pickLook(looks) { let r = R() * looks.reduce((a, l) => a + l.w, 0); for (let i = 0; i < looks.length; i++) { r -= looks[i].w; if (r <= 0) return i; } return 0; }
// frame table: [name, male clip, female clip, time fraction]
const FR = [
  ['walk0', 'm_walk_neutral_01', 'f_walk_neutral_01', 0], ['walk1', 'm_walk_neutral_01', 'f_walk_neutral_01', .25], ['walk2', 'm_walk_neutral_01', 'f_walk_neutral_01', .5], ['walk3', 'm_walk_neutral_01', 'f_walk_neutral_01', .75],
  ['run0', 'm_run_neutral_01', 'f_run_neutral_01', 0], ['run1', 'm_run_neutral_01', 'f_run_neutral_01', .25], ['run2', 'm_run_neutral_01', 'f_run_neutral_01', .5], ['run3', 'm_run_neutral_01', 'f_run_neutral_01', .75],
  ['idle', 'm_idle_neutral_01', 'f_idle_neutral_01', .3], ['wait', 'm_idle_nervous_01', 'f_idle_nervous_01', .4], ['crouch', 'm_crouch_idle', 'f_crouch_idle', .5],
];
const F = FR.length, D = 8, E = 2;
const FI = Object.fromEntries(FR.map((f, i) => [f[0], i]));
const MAXN = 680;
// cycles crossfade into their next frame (4 frames per stride pop at binocular range)
const CYC = { walk0: 1, walk1: 1, walk2: 1, walk3: 1, run0: 1, run1: 1, run2: 1, run3: 1 };
// clothes: the baked looks are only ten outfits, so each person's shirt and trousers are re-dyed in the shader
// (luminance kept, chroma replaced; skin and hair are detected and left alone). Muted, sun-faded working clothes.
const SHIRTS = [[1, 1, 1, 1.5], [1, 1, 1, 1.15], [1, 1, 1, .75], [1, 1, 1, .4], [.62, .78, 1.45, .8], [.95, 1.05, .62, .95], [1.5, .78, .72, .8], [1.25, .97, .74, 1], [1.12, 1.03, .82, 1.2], [.72, .92, 1.3, 1], [.78, 1.12, .84, .85], [1.05, 1, 1.05, 1.3]];
const PANTS = 4, DUST0 = [.74, .66, .52, .32], DUST1 = [.74, .66, .52, 0];

const vs = `
attribute vec3 iPos; attribute vec4 iData; attribute vec4 iAnim; attribute vec3 iTint; attribute vec3 iCloth;
uniform float uCols, uCellW, uCellH; uniform vec3 uSun;
varying vec4 vUvA, vUvB; varying vec2 vW, vQ, vLit; varying vec3 vTint, vCloth, vSunB; varying float vHide, vPant;
${GI_FUNCS}
#include <fog_pars_vertex>
vec2 cellUv(float look, float frame, float el, float dir, vec2 q) {
  float idx = ((look * ${F}. + frame) * ${E}. + el) * ${D}. + dir;
  float col = mod(idx, uCols), row = floor(idx / uCols);
  return vec2((col + q.x) * uCellW, 1. - (row + 1. - q.y) * uCellH);
}
void main(){
  float yaw = iData.x, f0 = iData.y, look = iData.z, scale = iData.w;
  vHide = step(scale, 0.001);
  vec3 c = iPos + vec3(0., .95 * scale, 0.);
  vec3 toCam = cameraPosition - c; float dh = length(toCam.xz);
  float el = atan(toCam.y, dh) > .38 ? 1. : 0.;
  float rel = (yaw - atan(toCam.x, toCam.z)) / .785398;
#ifdef CR_BLEND
  // crossfade between the two nearest baked directions: a person turning, or the drone orbiting, no longer pops
  float d0 = floor(rel), dw = smoothstep(.22, .78, rel - d0);
#else
  float d0 = floor(rel + .5), dw = 0.;
#endif
  float dA = mod(d0, 8.), dB = mod(d0 + 1., 8.);
  vUvA = vec4(cellUv(look, f0, el, dA, uv), cellUv(look, f0, el, dB, uv));
  vUvB = vec4(cellUv(look, iAnim.x, el, dA, uv), cellUv(look, iAnim.x, el, dB, uv));
  vW = vec2(dw, iAnim.y); vQ = uv; vPant = iAnim.z;
  // camera-facing quad (the bake already holds the perspective of each view height)
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  if (el < .5) { up = vec3(0., 1., 0.); right = normalize(vec3(right.x, 0., right.z)); }
  vec3 fwd = normalize(cross(right, up));
  vec3 wp = c + (right * (position.x) + up * (position.y)) * scale;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.);
  gl_Position = projectionMatrix * mvPosition;
  // the sun in the sprite's own frame (x right, y up, z toward the camera), so the fragment can light a silhouette normal
  vSunB = vec3(dot(uSun, right), dot(uSun, up), dot(uSun, fwd));
  // same light the scenery gets: sky visibility from the GI probes, and the static sun shadow (tents, berms, the town)
  vLit = vec2(uGIamb + (1. - uGIamb) * clamp(giSample(c + vec3(0., .4, 0.), vec3(0., 1., 0.)).a, 0., 1.), uSunOn > .5 ? giFarSun(c + vec3(0., .3, 0.)) : 1.);
  vTint = iTint; vCloth = iCloth;
  #include <fog_vertex>
}`;
const fs = `
uniform sampler2D uMap; uniform float uHot; uniform vec2 uTx; uniform vec3 uSunC, uSky, uGnd;
varying vec4 vUvA, vUvB; varying vec2 vW, vQ, vLit; varying vec3 vTint, vCloth, vSunB; varying float vHide, vPant;
#include <fog_pars_fragment>
void main(){
  if (vHide > .5) discard;
  vec4 t = texture2D(uMap, vUvA.xy);
#ifdef CR_BLEND
  t = mix(t, texture2D(uMap, vUvA.zw), vW.x);
#endif
#ifdef CR_FRAMES
  if (vW.y > .01) t = mix(t, mix(texture2D(uMap, vUvB.xy), texture2D(uMap, vUvB.zw), vW.x), vW.y);
#endif
  if (t.a < .42) discard;
  if (uHot > .5) { gl_FragColor = vec4(1.55, 1.55, 1.55, 1.); return; }
  // the cells are premultiplied (rendered over transparent black, then mipmapped)
  vec3 alb = t.rgb / max(t.a, .05);
#ifdef CR_GRAD
  // silhouette normal from the blurred coverage: edges face outward, the middle of the body faces the camera
  vec2 o = uTx * 2.5; vec2 u0 = mix(vUvA.xy, vUvA.zw, step(.5, vW.x));
  float gx = texture2D(uMap, u0 + vec2(o.x, 0.), 1.5).a - texture2D(uMap, u0 - vec2(o.x, 0.), 1.5).a;
  float gy = texture2D(uMap, u0 + vec2(0., o.y), 1.5).a - texture2D(uMap, u0 - vec2(0., o.y), 1.5).a;
  vec3 n = normalize(vec3(-gx * 2.2, -gy * 1.6 + .15, 1.));
#else
  float cx = clamp((vQ.x - .5) / .26, -1., 1.); vec3 n = normalize(vec3(cx, .15, sqrt(max(1. - cx * cx, .08))));
#endif
  // re-dye the clothes: chroma far from skin, not hair-dark; trousers below the hips
  float L = dot(alb, vec3(.3, .59, .11)); vec3 ch = alb / max(L, 1e-3);
  float cloth = smoothstep(.2, .34, length(ch - vec3(1.5, .84, .56))) * smoothstep(.025, .07, L);
  vec3 pant = vPant < .5 ? vec3(.62, .8, 1.35) * .9 : vPant < 1.5 ? vec3(.38) : vPant < 2.5 ? vec3(1.12, 1.02, .78) * 1.1 : vec3(.85);
  vec3 dye = (vQ.y < .47 ? pant : vCloth) * L;
  alb = mix(alb, dye, cloth * .72) * vTint;
  // light: sky/ground ambient scaled by GI visibility, wrapped sun, and a rim where a low sun sits behind the person
  float ndl = dot(n, vSunB);
  // x1.7: the sunlit sand all around bounces far more light onto a standing figure than the hemisphere term models
  // for the scenery's mostly horizontal surfaces (backlit people otherwise read as black cut-outs)
  vec3 amb = mix(uGnd, uSky, n.y * .5 + .5) * vLit.x * 1.7;
  float rim = smoothstep(.15, .7, 1. - n.z) * clamp(-vSunB.z, 0., 1.) * .9;
  vec3 col = alb * (amb + uSunC * vLit.y * (clamp((ndl + .2) / 1.2, 0., 1.) + rim));
  gl_FragColor = vec4(col, 1.);
  #include <fog_fragment>
}`;

export class Crowd {
  constructor() {
    this.n = 0; this.agents = []; this.hot = false;
    this.passed = 0; this.arrived = 0; this.spawnAcc = 0;
    this.gasClouds = []; G.gasClouds = this.gasClouds;
    // own random stream for the look and the knots, so the scenario's draws from R stay exactly where they were
    this.gr = rng(51177); this.grp = null; this.grpN = 0; this.stamp = 0;
  }
  // ---------- bake ----------
  async bake(renderer, onP) {
    const looks = LOOKS.filter(l => A.chars[l.m]); this.looks = looks;
    // cell size vs memory: binoculars (7x) on desktop show a person ~130 px tall, so 96 px cells; an iPhone tab dies past a
    // fixed memory ceiling and its screen never shows a protester above ~40 px, so 48 px cells (5x less memory)
    const [CW, CH] = G.lowMem ? [24, 48] : G.isTouch ? [32, 64] : [48, 96];
    const cells = looks.length * F * E * D, COLS = Math.ceil(Math.sqrt(cells * CH / CW)), rows = Math.ceil(cells / COLS);
    const W = COLS * CW, H = rows * CH; this.cols = COLS; this.cw = CW;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
    rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter; rt.texture.magFilter = THREE.LinearFilter; rt.texture.anisotropy = 4;
    const sc = new THREE.Scene();
    // bake albedo with only a soft sky/ground term (some form and occlusion, no direction): the sun is applied per pixel
    // at draw time, so a crowd seen against the low western sun is backlit and one seen from the drone is lit from the side
    sc.add(new THREE.HemisphereLight('#ffffff', '#d2c9bc', Math.PI));
    const cam = new THREE.OrthographicCamera(-.5, .5, 1.0, -1.0, .1, 40);
    const prevRT = renderer.getRenderTarget(), prevTM = renderer.toneMapping, prevSM = renderer.shadowMap.enabled; const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false; renderer.setClearColor(0x000000, 0);
    // allocate the full mip chain now, then keep mip generation off while the cells are drawn (re-enabled for one final pass)
    rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H); rt.scissorTest = false; renderer.setRenderTarget(rt); renderer.clear(true, true, true);
    rt.texture.generateMipmaps = false;
    let done = 0; const total = looks.length * F;
    for (let li = 0; li < looks.length; li++) {
      const L = looks[li]; const root = SkeletonUtils.clone(A.chars[L.m].scene); const noGI = [];
      // the shared materials must not pick up the town's GI probes at the bake origin (that is the wall)
      root.traverse(c => { if (c.isMesh) { c.frustumCulled = false; c.castShadow = false; for (const m of [].concat(c.material)) if (!m.userData.noGI) { m.userData.noGI = true; noGI.push(m); } } }); sc.add(root);
      const mixer = new THREE.AnimationMixer(root);
      for (let fi = 0; fi < F; fi++) {
        const [, cm, cf, frac] = FR[fi]; const clip = A.clips[L.s === 'f' ? cf : cm] || A.clips[cm]; mixer.stopAllAction();
        if (clip) { const a = mixer.clipAction(clip); a.reset().play(); mixer.setTime(clip.duration * frac); }
        for (let e = 0; e < E; e++) {
          const ang = e ? .68 : .07; cam.position.set(0, .95 + Math.sin(ang) * 10, Math.cos(ang) * 10); cam.lookAt(0, .95, 0); cam.updateMatrixWorld();
          for (let d = 0; d < D; d++) {
            root.rotation.y = d * Math.PI / 4; root.updateMatrixWorld(true);
            const idx = ((li * F + fi) * E + e) * D + d; const col = idx % COLS, row = Math.floor(idx / COLS);
            const x = col * CW, y = H - (row + 1) * CH; rt.viewport.set(x, y, CW, CH); rt.scissor.set(x, y, CW, CH); rt.scissorTest = true;
            renderer.setRenderTarget(rt); renderer.render(sc, cam);
          }
        }
        done++; if (done % 6 === 0) { onP && onP(done / total); await new Promise(r => setTimeout(r, 0)); }
      }
      sc.remove(root); for (const m of noGI) m.userData.noGI = false;
    }
    // one empty pass with mipmaps enabled builds the chain for the whole atlas
    rt.texture.generateMipmaps = true; rt.viewport.set(0, 0, 1, 1); rt.scissor.set(0, 0, 1, 1); const ac = renderer.autoClear; renderer.autoClear = false; renderer.setRenderTarget(rt); renderer.render(new THREE.Scene(), cam); renderer.autoClear = ac;
    rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H); rt.scissorTest = false;
    renderer.setRenderTarget(prevRT); renderer.toneMapping = prevTM; renderer.shadowMap.enabled = prevSM; renderer.setClearColor(prevClear, prevA);
    this.atlas = rt; this.buildMesh(W, H, CW, CH); onP && onP(1);
  }
  buildMesh(W, H, CW, CH) {
    const quad = new THREE.PlaneGeometry(1, 2);
    const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    const ia = (k, n, dyn = true) => { const b = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * n), n); if (dyn) b.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, b); return b; };
    this.aPos = ia('iPos', 3); this.aData = ia('iData', 4); this.aAnim = ia('iAnim', 4); this.aTint = ia('iTint', 3); this.aCloth = ia('iCloth', 3); g.instanceCount = 0;
    this.u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uCols: { value: this.cols }, uCellW: { value: CW / W }, uCellH: { value: CH / H }, uTx: { value: new THREE.Vector2(1 / W, 1 / H) }, uHot: { value: 0 },
      uSunC: { value: new THREE.Color(1.1, .95, .75) }, uSky: { value: new THREE.Color(.3, .32, .35) }, uGnd: { value: new THREE.Color(.25, .2, .14) } }]);
    // shared by reference: the sun direction and the GI volumes are filled in (or replaced) after this material exists
    Object.assign(this.u, GIU, { uSun: { value: G.sunDir } }); this.u.uMap.value = this.atlas.texture;
    const m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: this.u, fog: true });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.layers.enable(1); G.scene.add(this.mesh);
    G.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) this.sunL = o; else if (o.isHemisphereLight) this.hemiL = o; });
    // one instanced mesh, two quads per person: the long late-afternoon shadow pointing away from the sun, and a dark
    // contact blot under the feet that grounds a figure even when the long shadow is lost in the haze
    const sd = G.sunDir; this.shYaw = Math.atan2(-sd.x, -sd.z); const sl = Math.min(7, 1.7 / Math.tan(Math.max(.15, Math.asin(sd.y))));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([-.27, 0, -.12, .27, 0, -.12, -.27, 0, sl, .27, 0, sl, -.42, 0, -.42, .42, 0, -.42, -.42, 0, .42, .42, 0, .42], 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, .5, 1, 0, 0, .5, 0, .5, 1, 1, 1, .5, 0, 1, 0], 2)); sg.setIndex([0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]);
    const st = document.createElement('canvas'); st.width = 64; st.height = 64; const c2 = st.getContext('2d');
    const gr = c2.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(.5, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c2.fillStyle = gr; c2.beginPath(); c2.ellipse(16, 32, 11, 31, 0, 0, 7); c2.fill();
    const rg = c2.createRadialGradient(48, 32, 0, 48, 32, 15); rg.addColorStop(0, 'rgba(0,0,0,.75)'); rg.addColorStop(.45, 'rgba(0,0,0,.4)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); c2.fillStyle = rg; c2.fillRect(32, 0, 32, 64);
    const tex = new THREE.CanvasTexture(st); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.shadow = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: '#000000', opacity: .8, polygonOffset: true, polygonOffsetFactor: -3 }), MAXN);
    this.shadow.count = 0; this.shadow.frustumCulled = false; this.shadow.renderOrder = 1; G.scene.add(this.shadow);
  }
  // per-pixel cost follows the quality level: low = one texel and a cylinder normal; medium blends directions;
  // high also blends animation frames and derives the normal from the silhouette
  setQ(q) {
    this._q = q; const d = {}; if (q >= 1) d.CR_BLEND = ''; if (q >= 2) { d.CR_FRAMES = ''; d.CR_GRAD = ''; }
    this.mesh.material.defines = d; this.mesh.material.needsUpdate = true;
  }
  setHot(on) {
    if (this.hot === on) return; this.hot = on; if (this.u) this.u.uHot.value = on ? 1 : 0; if (this.shadow) this.shadow.visible = !on;
    if (G.fx) G.fx.smoke.pts.visible = !on; // thermal sees through the smoke screen
    for (const a of G.actors) a.root.traverse(c => { if (!c.isMesh) return; if (on) { c.userData.mat0 = c.material; c.material = hotMat(c.material, a); } else if (c.userData.mat0) { c.material = c.userData.mat0; c.userData.mat0 = null; } });
    for (const h of G.hotObjects || []) h.traverse(c => { if (!c.isMesh) return; if (on) { c.userData.mat0 = c.material; c.material = warmMat; } else if (c.userData.mat0) { c.material = c.userData.mat0; c.userData.mat0 = null; } });
  }
  // ---------- agents ----------
  spawn(x, z, opts = {}) {
    if (this.agents.length >= MAXN) return null;
    const looks = this.looks || LOOKS; let look = opts.look ?? pickLook(looks);
    if (opts.kid && FEMALE_LOOKS.includes(look) && R() < .5) look = 0;
    const a = { i: this.agents.length, x, z, y: hF(x, z), yaw: Math.PI + rr(-.3, .3), vx: 0, vz: 0, sp: 0, state: opts.state || 'flow', tx: x, tz: z, cx: x, cz: z, rad: 6,
      look: Math.min(look, looks.length - 1), scale: opts.kid ? rr(.66, .8) : rr(.94, 1.05), tint: [rr(.88, 1.08), rr(.86, 1.04), rr(.84, 1.02)], phase: R(), act: 'idle', actT: rr(1, 5),
      alive: true, kid: !!opts.kid, t: 0, walk: opts.walk ?? (look === OLD_LOOK ? rr(.7, .9) : rr(.95, 1.3)), lx: opts.lx ?? x, jx: rr(-.18, .18), jz: rr(-.12, .12) };
    // families walk in knots (2-7), close together; the knot's members share a lateral line on the road
    const q = this.gr; if (this.grpN <= 0 || !this.grp || Math.hypot(x - this.grp.x, z - this.grp.z) > 10) { this.grp = { ox: q() * 2 - 1, oz: q() * 2 - 1, sp: .6 + q() * 1.2, x, z, lx: x }; this.grpN = q() < .15 ? 1 : 2 + Math.floor(q() * 6); }
    this.grpN--; a.grp = this.grp; a.lx = this.grp.lx + (q() - .5) * 1.6; a.ps = (opts.kid ? .4 : .48) + q() * .22; a.yawT = a.yaw; a.fCur = FI.idle; a.fPrev = FI.idle; a.fBl = 1;
    const sh = SHIRTS[Math.floor(q() * SHIRTS.length)], l = .3 * sh[0] + .59 * sh[1] + .11 * sh[2]; a.cloth = [sh[0] / l * sh[3], sh[1] / l * sh[3], sh[2] / l * sh[3]]; a.pant = Math.floor(q() * PANTS);
    this.agents.push(a); this.arrived++; return a;
  }
  // a family group entering the corridor at its northern end
  spawnGroup(z0) {
    const q = this.gr, n = 1 + Math.floor(q() * 5), lx = (q() - .5) * 2 * (CL.road - 1.2);
    for (let i = 0; i < n; i++) { const kid = i > 1 && q() < .55; this.spawn(lx + (q() - .5) * 1.8, z0 - q() * 4, { kid, lx }); }
  }
  inGas() { return 0; }
  raycast(o, dir, maxT) { // ray vs a vertical capsule per person (dir normalised)
    let best = null; const h2 = dir.x * dir.x + dir.z * dir.z; if (h2 < 1e-6) return null;
    for (const a of this.agents) { if (!a.alive) continue;
      const t = ((a.x - o.x) * dir.x + (a.z - o.z) * dir.z) / h2; if (t < 0 || t > maxT) continue;
      const px = o.x + dir.x * t, py = o.y + dir.y * t, pz = o.z + dir.z * t; const hh = py - a.y; if (hh < 0 || hh > 1.75 * a.scale) continue;
      if ((px - a.x) ** 2 + (pz - a.z) ** 2 > .075) continue;
      if (!best || t < best.t) best = { t, agent: a, part: hh > 1.45 * a.scale ? 'head' : hh > .9 * a.scale ? 'body' : 'legs' }; }
    return best;
  }
  promote(a, kind = 'civ') {
    if (!a.alive) return null; a.alive = false; this.unqueue(a); const L = this.looks[a.look];
    const act = new Actor(L.m, kind, new THREE.Vector3(a.x, a.y, a.z), a.yaw, {}); act.root.scale.setScalar(a.scale); act.fromCrowd = a; act.crowdLook = a.look; act.kid = a.kid;
    return act;
  }
  // ---------- the checkpoint queue ----------
  // Two lanes through the barriers. People queue three abreast inside a lane, and past the lane mouth the queue spills
  // into the funnel and up the road as a widening blob. The slot table holds every queue position for one lane setup.
  initQueue() {
    this.lanes = [{ x: CL.laneA, open: true, q: [], t: 0 }, { x: CL.laneB, open: false, q: [], t: 0 }];
    this.flow = 'open'; this.hold = false; this.shelter = false; this.press = 0; this._slots = {};
  }
  slots(li) {
    const both = this.lanes[1].open, key = li + (both ? 'b' : 's'); if (this._slots[key]) return this._slots[key];
    const L = this.lanes[li], out = [], fz = CL.funnelZ;
    for (let z = 3; z > fz + .3; z -= .62) for (let c = -1; c <= 1; c++) out.push([L.x + c * .85, z]);
    // the spill: from the lane mouth north, as wide as the funnel (then the road) allows; with two lanes open each queue takes its own half
    for (let r = 0; out.length < MAXN; r++) { const z = fz - 1 - r * .7, hw = Math.min(CL.road - .8, 4.0 + (fz - z) * .28);
      const x0 = both ? (li ? .5 : -hw) : -hw, x1 = both ? (li ? hw : -.5) : hw, n = Math.max(1, Math.floor((x1 - x0) / .72));
      for (let k = 0; k < n; k++) out.push([x0 + (k + .5) * (x1 - x0) / n, z]); }
    return this._slots[key] = out;
  }
  joinQueue(a) {
    const open = this.lanes.filter(l => l.open); const L = open.reduce((b, l) => l.q.length < b.q.length ? l : b, open[0]);
    L.q.push(a); a.lane = L; a.state = 'queue';
  }
  unqueue(a) { if (a.lane) { const i = a.lane.q.indexOf(a); if (i >= 0) a.lane.q.splice(i, 1); a.lane = null; } }
  // open lane B: half of lane A's spill moves over (the back half, so nobody in the lane is pushed around)
  setLaneB(on) {
    const A = this.lanes[0], B = this.lanes[1]; if (B.open === on) return; B.open = on; this._slots = {};
    if (on) { const move = A.q.splice(Math.floor(A.q.length * .5)); for (let i = 0; i < move.length; i++) { const a = move[i]; if (i % 2) A.q.push(a); else { B.q.push(a); a.lane = B; } } }
    else { for (const a of B.q) { A.q.push(a); a.lane = A; } B.q.length = 0; }
  }
  queueLen() { return this.lanes[0].q.length + this.lanes[1].q.length; }
  backZ(L) { const s = this.slots(this.lanes.indexOf(L)); const p = s[Math.min(s.length - 1, L.q.length)]; return p[1]; }
  updateQueue(dt) {
    const period = this.flow === 'slow' ? 2.1 : .95;
    for (const L of this.lanes) {
      const s = this.slots(this.lanes.indexOf(L));
      L.q.forEach((a, i) => { const p = s[Math.min(i, s.length - 1)]; a.tx = p[0] + a.jx; a.tz = p[1] + a.jz; });
      if (!L.open || this.flow === 'pause' || this.shelter) continue;
      L.t -= dt; const f = L.q[0];
      if (L.t <= 0 && f && Math.hypot(f.x - s[0][0], f.z - s[0][1]) < 1.8) { L.q.shift(); f.lane = null; f.state = 'through'; f.tx = L.x + rr(-.6, .6); f.tz = 10; this.passed++; L.t = period * rr(.75, 1.25); if (this.onPass) this.onPass(f); }
    }
  }
  // ---------- simulation ----------
  update(dt) {
    if (!this.mesh) return;
    if (this._q !== G.quality) this.setQ(G.quality);
    const u = this.u, ip = 1 / Math.PI; if (this.sunL) u.uSunC.value.copy(this.sunL.color).multiplyScalar(this.sunL.intensity * ip);
    if (this.hemiL) { u.uSky.value.copy(this.hemiL.color).multiplyScalar(this.hemiL.intensity * ip); u.uGnd.value.copy(this.hemiL.groundColor).multiplyScalar(this.hemiL.intensity * ip); }
    if (this.lanes) this.updateQueue(dt);
    // spatial hash for spacing
    const cell = 1.3, hash = this._h || (this._h = new Map()); hash.clear();
    for (const a of this.agents) { if (!a.alive) continue; const k = Math.floor(a.x / cell) * 4096 + Math.floor(a.z / cell); let b = hash.get(k); if (!b) hash.set(k, b = []); b.push(a); }
    const cam = G.drone && G.drone.active ? G.drone.cam.position : G.camera.position;
    const obs = G.crowdObstacles || [];
    let n = 0;
    for (const a of this.agents) {
      if (!a.alive) continue;
      a.t += dt; this.brain(a, dt);
      const ci = Math.floor(a.x / cell), cj = Math.floor(a.z / cell);
      // queued people stand closer than walkers (and the press of a surge squeezes them further)
      const qk = a.state === 'queue' ? .8 - this.press * .15 : 1;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const b = hash.get((ci + di) * 4096 + cj + dj); if (!b) continue; for (const o of b) { if (o === a) continue; const dx = a.x - o.x, dz = a.z - o.z; const d2 = dx * dx + dz * dz, md = (a.ps + o.ps) * (a.grp === o.grp ? .42 : .55) * qk; if (d2 < md * md && d2 > 1e-6) { const d = Math.sqrt(d2), p = (md - d) * .5; a.x += dx / d * p; a.z += dz / d * p; } } }
      for (const o of obs) { const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz); if (d < o.r && d > 1e-3) { a.x = o.x + dx / d * o.r; a.z = o.z + dz / d * o.r; } }
      // lane walls: inside the barrier lanes nobody crosses into the next lane
      // (by the lane they queue for, eased: someone entering the mouth from the other half slides over instead of jumping)
      if (a.z > CL.funnelZ && a.z < 5.5 && (a.state === 'queue' || a.state === 'through' || a.state === 'shelter')) { const lx = a.lane ? a.lane.x : a.x < 0 ? CL.laneA : CL.laneB; a.x += (clamp(a.x, lx - 1.6, lx + 1.6) - a.x) * Math.min(1, dt * 6); }
      a.yaw = angleLerp(a.yaw, a.yawT, Math.min(1, dt * (a.sp > 1.5 ? 7 : 3.5)));
      a.y = hF(a.x, a.z);
      const f = this.frameOf(a, dt);
      this.aPos.setXYZ(n, a.x, a.y, a.z); this.aData.setXYZW(n, a.yaw, f[0], a.look, a.scale); this.aAnim.setXYZW(n, f[1], f[2], a.pant, 0);
      this.aTint.setXYZ(n, a.tint[0], a.tint[1], a.tint[2]); this.aCloth.setXYZ(n, a.cloth[0], a.cloth[1], a.cloth[2]);
      a.slot = n; n++;
    }
    this.mesh.geometry.instanceCount = n; for (const b of [this.aPos, this.aData, this.aAnim, this.aTint, this.aCloth]) b.needsUpdate = true;
    const o = this._o || (this._o = new THREE.Object3D()); let k = 0;
    for (const a of this.agents) { if (!a.alive) continue; if ((a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 > 220 * 220) continue; o.position.set(a.x, a.y + .03, a.z); o.rotation.set(0, this.shYaw, 0); o.scale.setScalar(a.scale); o.updateMatrix(); this.shadow.setMatrixAt(k++, o.matrix); }
    this.shadow.count = k; this.shadow.instanceMatrix.needsUpdate = true;
    this.count = n;
    // drop the dead entries now and then so the array (and every loop over it) stays short
    this._gc = (this._gc || 0) + dt; if (this._gc > 4) { this._gc = 0; const live = this.agents.filter(a => a.alive || a.keep); if (live.length < this.agents.length) { this.agents.length = 0; this.agents.push(...live); } }
  }
  frameOf(a, dt) {
    const sp = a.sp; let f0, f1, w;
    if (sp > 2.2) { a.phase = (a.phase + dt * sp / 2.6) % 1; const p = a.phase * 4, i = Math.floor(p) % 4; f0 = FI.run0 + i; f1 = FI.run0 + (i + 1) % 4; w = p - Math.floor(p); }
    else if (sp > .2) { a.phase = (a.phase + dt * sp / 1.45) % 1; const p = a.phase * 4, i = Math.floor(p) % 4; f0 = FI.walk0 + i; f1 = FI.walk0 + (i + 1) % 4; w = p - Math.floor(p); }
    else { f0 = f1 = FI[a.act] ?? FI.idle; w = 0; }
    const base = CYC[FR[f0][0]] ? FR[f0][0][0] : f0;
    if (base !== a.fKey) { a.fKey = base; a.fPrev = a.fCur; a.fBl = 0; }
    a.fCur = f0; a.fBl = Math.min(1, a.fBl + dt * 4);
    if (a.fBl < 1 && a.fPrev !== f0) return [a.fPrev, f0, a.fBl];
    return [f0, f1, w];
  }
  brain(a, dt) {
    const goTo = (tx, tz, speed) => { const dx = tx - a.x, dz = tz - a.z; const d = Math.hypot(dx, dz); if (d < .3) { a.sp = lerp(a.sp, 0, Math.min(1, dt * 6)); return true; } a.sp = lerp(a.sp, Math.min(speed, d * 1.5 + .2), Math.min(1, dt * 3)); a.x += dx / d * a.sp * dt; a.z += dz / d * a.sp * dt; a.yawT = Math.atan2(dx, dz); return false; };
    if (this.shelter && a.state !== 'shelter' && a.state !== 'south' && a.z < 8 && a.z > -160) { a.prev = a.state; a.state = 'shelter';
      // in the lanes: crouch where they stand, behind the barriers; on the open road: run for the east verge
      if (a.prev === 'queue') { a.tx = a.x; a.tz = a.z; } else { a.tx = rr(11.5, 15.5); a.tz = a.z + rr(-4, 6); } }
    switch (a.state) {
      case 'flow': {
        const L = this.lanes; const holdZ = CL.hold;
        if (this.hold && a.z < holdZ && a.z > holdZ - 40) { a.state = 'hold'; a.tx = a.lx + rr(-1, 1); a.tz = holdZ - rr(1, 30); break; }
        if (a.cart && a.z > -60) { a.state = 'vlane'; a.tx = CL.vehX + .3; a.tz = -8; break; }
        let back = -1e9; if (L) for (const l of L) if (l.open) back = Math.max(back, this.backZ(l));
        if (L && a.z > back - 2.5) { this.joinQueue(a); break; }
        a.lx = clamp(a.lx, -CL.road + 1, CL.road - 1);
        goTo(a.lx + Math.sin(a.t * .2 + a.phase * 6) * .3, a.z + 6, a.walk); break; }
      case 'hold': if (!this.hold) { a.state = 'flow'; break; } a.actT -= dt; if (goTo(a.tx, a.tz, a.walk * .8)) { a.act = a.actT % 7 < 4 ? 'wait' : 'idle'; if (a.actT <= 0) { a.actT = rr(4, 9); const g = a.grp; if (g && this.gr() < .35) a.yawT = Math.atan2(g.x - a.x, g.z - a.z); } } break;
      case 'queue': { const d = Math.hypot(a.tx - a.x, a.tz - a.z); goTo(a.tx, a.tz, d > 2 ? a.walk : .55); if (d < .4) { a.act = 'wait'; a.yawT = angleLerp(a.yawT, 0, .02); } break; }
      case 'through': if (goTo(a.tx, a.tz, a.walk)) { a.state = 'south'; a.tx = clamp(a.x * 2 + rr(-3, 3), -CL.road + 1.5, CL.road - 1.5); a.tz = CL.exitZ; } break;
      case 'south': if (goTo(a.tx, a.tz, a.walk) || a.z > CL.exitZ - 3) a.alive = false; break;
      case 'shelter': if (!this.shelter) { a.state = a.prev === 'queue' && a.lane ? 'queue' : a.prev === 'hold' ? 'hold' : a.prev === 'through' ? 'through' : 'flow'; if (a.state === 'through') { a.tx = a.x; a.tz = 10; } break; }
        if (goTo(a.tx, a.tz, a.prev === 'queue' ? .5 : 3.2)) a.act = 'crouch'; break;
      case 'vlane': // carts and cars use the vehicle lane: stop at the inspection point, then roll on
        if (a.stopT > 0) { a.stopT -= dt; a.sp = lerp(a.sp, 0, dt * 4); a.act = 'idle'; break; }
        if (goTo(a.tx, a.tz, a.walk)) { if (a.tz < 0) { a.tz = -8; a.tx = CL.vehX; if (Math.abs(a.z + 8) < .5) { a.stopT = 4; a.tz = 20; } } else if (a.tz < 25) { a.tx = CL.vehX + rr(-1, 1); a.tz = CL.exitZ; this.passed++; } else a.alive = false; }
        break;
      default: a.sp = lerp(a.sp, 0, dt * 5);
    }
    if (a.cart) { const c = a.cart, s = Math.sin(a.yaw), co = Math.cos(a.yaw); c.position.set(a.x + s * (a.donkey ? 2.6 : 1.4), a.y, a.z + co * (a.donkey ? 2.6 : 1.4)); c.rotation.y = a.yaw + (a.donkey ? 0 : Math.PI); if (!a.alive) { G.scene.remove(c); a.cart = null; } }
  }
  alive() { return this.agents.filter(a => a.alive); }
  near(x, z, r) { return this.agents.filter(a => a.alive && (a.x - x) ** 2 + (a.z - z) ** 2 < r * r); }
  countZ(z0, z1) { let n = 0; for (const a of this.agents) if (a.alive && a.z > z0 && a.z < z1) n++; return n; }
  reset() { this.agents.length = 0; if (this.mesh) this.mesh.geometry.instanceCount = 0; if (this.shadow) this.shadow.count = 0; this.passed = 0; this.arrived = 0; this.initQueue(); }
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
