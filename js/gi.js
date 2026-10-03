// Baked ambient visibility ("probe grids"). Sky and bounce light used to reach every surface at full strength, which
// is what made rooms, stairwells and alleys read flat and grey. Here every probe of a 3D grid records how much of the
// outside world it can see: the sky above, and the sunlit ground below (the ground is left out of the occluders, so a
// downward ray that leaves through a window counts as bounce light off the street, exactly as it works in a real flat).
// The bake runs once at load on the GPU: the collision geometry's depth is rendered from N directions (like N shadow
// maps) and every probe is tested against each. A probe stores the visibility-weighted mean direction D and the visible
// fraction A, and a surface with normal n then receives E(n) = A + 2 n·D (the first-order fit of the cosine-weighted
// visibility; it is exact for a fully open point and for an open upper hemisphere).
// Every MeshStandardMaterial picks this up automatically (see the prototype hook below); the first-person weapon lives
// in its own camera space and sets userData.giView, which samples the probes at the eye (uGIcam) instead.
import * as THREE from 'three';
import { G } from './core.js';

// shared by reference with every lit material (render-target textures cannot go through ShaderLib uniform cloning)
const vol = () => ({ tex: { value: null }, o: { value: new THREE.Vector3() }, c: { value: new THREE.Vector3(1, 1, 1) }, n: { value: new THREE.Vector3(1, 1, 1) }, s: { value: 0 } });
const VA = vol(), VB = vol();
export const GIU = {
  tGIa: VA.tex, uGIaO: VA.o, uGIaC: VA.c, uGIaN: VA.n, uGIaS: VA.s,
  tGIb: VB.tex, uGIbO: VB.o, uGIbC: VB.c, uGIbN: VB.n, uGIbS: VB.s,
  uGIamb: { value: .05 }, uGIview: { value: 0 },
  // first-person weapon: drawn in its own camera space, so it is lit from the probes at the eye, along world-space normals
  uGIcam: { value: new THREE.Vector3() }, uGIcamRot: { value: new THREE.Matrix3() },
  // static sun shadow of the whole town, for the ground and walls beyond the reach of the live shadow map
  tSunD: { value: null }, uSunVP: { value: new THREE.Matrix4() }, uSunOn: { value: 0 }, uSunNear: { value: 40 }, uSunTx: { value: 1 / 2048 },
};
const SLOTS = { a: VA, b: VB };
{ const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; VA.tex.value = VB.tex.value = GIU.tSunD.value = t; }

// uniforms and lookups, usable in any shader stage (the particles sample them per vertex)
export const GI_FUNCS = /* glsl */`
uniform float uGIon, uGIamb, uGIview; uniform vec3 uGIcam; uniform mat3 uGIcamRot;
uniform sampler2D tGIa, tGIb;
uniform vec3 uGIaO, uGIaC, uGIaN, uGIbO, uGIbC, uGIbN;
uniform float uGIaS, uGIbS;
uniform sampler2D tSunD; uniform mat4 uSunVP; uniform float uSunOn, uSunNear, uSunTx;
// 4-tap PCF against the static sun depth map (a lit texel counts 1)
float giFarSun(vec3 p) {
  vec4 c = uSunVP * vec4(p, 1.); vec3 q = c.xyz / c.w * .5 + .5;
  if (q.x <= 0. || q.x >= 1. || q.y <= 0. || q.y >= 1.) return 1.;
  float z = q.z - .00035, o = uSunTx * .75;
  return (step(z, texture2D(tSunD, q.xy + vec2(-o, -o)).r) + step(z, texture2D(tSunD, q.xy + vec2(o, -o)).r) + step(z, texture2D(tSunD, q.xy + vec2(-o, o)).r) + step(z, texture2D(tSunD, q.xy + vec2(o, o)).r)) * .25;
}
// probe (i,j,k) sits at o + (i,j,k)*c + c/2; the atlas stacks the y-slices vertically (x across, z down each slice)
vec4 giAtlas(sampler2D t, vec3 p, vec3 o, vec3 c, vec3 n) {
  vec3 g = clamp((p - o) / c - .5, vec3(0.), n - 1.);
  float j0 = floor(g.y), j1 = min(j0 + 1., n.y - 1.), u = (g.x + .5) / n.x, H = n.z * n.y;
  return mix(texture2D(t, vec2(u, (g.z + .5 + j0 * n.z) / H)), texture2D(t, vec2(u, (g.z + .5 + j1 * n.z) / H)), g.y - j0);
}
// 1 inside a volume, fading out over m metres at its sides and top (below it: clamped to the lowest slice)
float giFade(vec3 p, vec3 o, vec3 c, vec3 n, float m) { vec3 lo = (p - o) / m, hi = (o + c * n - p) / m; return clamp(min(lo.x, hi.x), 0., 1.) * clamp(min(lo.z, hi.z), 0., 1.) * clamp(hi.y, 0., 1.); }
vec4 giSample(vec3 p, vec3 nw) {
  vec4 s = vec4(0., 0., 0., 1.);
  float fa = uGIaS > 0. ? giFade(p, uGIaO, uGIaC, uGIaN, 6.) : 0.;
  // sample half a cell off the surface, so a wall reads the air in front of it and not the probes inside it
  if (fa > 0.) s = mix(s, giAtlas(tGIa, p + nw * uGIaC.y * .55, uGIaO, uGIaC, uGIaN), fa * uGIaS);
  float fb = uGIbS > 0. ? giFade(p, uGIbO, uGIbC, uGIbN, .8) : 0.;
  if (fb > 0.) s = mix(s, giAtlas(tGIb, p + nw * uGIbC.y * .6, uGIbO, uGIbC, uGIbN), fb * uGIbS);
  return s;
}
float giE(vec4 s, vec3 d) { return clamp(s.a + 2. * dot(d, s.rgb), 0., 1.); }
`;
const GI_PARS = 'varying vec3 vGIw;\n' + GI_FUNCS;
const GI_APPLY = /* glsl */`
if (uGIon > .5) {
  bool giVM = uGIon > 1.5;
  vec3 giN = giVM ? normalize(uGIcamRot * geometryNormal) : inverseTransformDirection(geometryNormal, viewMatrix);
  vec4 giS = giSample(giVM ? uGIcam : vGIw, giN);
  float giD = uGIamb + (1. - uGIamb) * giE(giS, giN);
  // the weapon: what a surface facing that way would get a little further out (the eye is often in a doorway or against
  // a wall, where the nearest probes are buried), and never so dark it stops reading
  if (giVM) { vec4 giS2 = giSample(uGIcam + giN * .7, giN); giS = giE(giS2, giN) > giE(giS, giN) ? giS2 : giS; giD = max(uGIamb + (1. - uGIamb) * giE(giS, giN), .1); }
  // glossy reflections look along the mirror direction: a polished floor mirrors the dark ceiling, not the sky
  vec3 giR = giVM ? normalize(uGIcamRot * reflect(-geometryViewDir, geometryNormal)) : inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
  float giSp = mix(uGIamb + (1. - uGIamb) * giE(giS, giR), giD, clamp(material.roughness * 1.4 - .2, 0., 1.));
  irradiance *= giD; iblIrradiance *= giD; radiance *= giSp;
  // beyond the live shadow map, sunlight is masked by the static one (it also dims the rare far point light, which is fine)
  if (uSunOn > .5 && !giVM) { float giF = smoothstep(uSunNear - 8., uSunNear, length(vGIw.xz - cameraPosition.xz));
    if (giF > 0.) { float giSv = mix(1., giFarSun(vGIw + giN * .25), giF); reflectedLight.directDiffuse *= giSv; reflectedLight.directSpecular *= giSv; } }
  // debug view: only the baked visibility, on white, with no direct light
  if (uGIview > .5) { reflectedLight.directDiffuse = vec3(0.); reflectedLight.directSpecular = vec3(0.); material.diffuseColor = vec3(1.); material.specularColor = vec3(0.); irradiance = vec3(giD * PI); iblIrradiance = vec3(0.); radiance = vec3(0.); }
}
`;
const GI_VERT = /* glsl */`
{ vec4 giw = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  giw = batchingMatrix * giw;
#endif
#ifdef USE_INSTANCING
  giw = instanceMatrix * giw;
#endif
  vGIw = (modelMatrix * giw).xyz; }
`;

function giCompile(sh) {
  if (sh.fragmentShader.includes('vec4 giSample(')) return; // already applied (a material wrapped twice, e.g. windSway over the hook)
  const m = this; sh.uniforms.uGIon = { get value() { const u = m.userData; return u && u.noGI ? 0 : u && u.giView ? 2 : 1; } }; // read at every upload, so late flagging works
  Object.assign(sh.uniforms, GIU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGIw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + GI_VERT);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GI_PARS).replace('#include <lights_fragment_end>', GI_APPLY + '#include <lights_fragment_end>');
}
// Hook every MeshStandardMaterial/MeshPhysicalMaterial, whether or not it has its own onBeforeCompile: the material's
// function runs first, then the GI code goes in. The program cache key stays the material's own (all of them get the
// same GI code; whether it is active is a per-material uniform, so programs can still be shared).
{
  const P = THREE.MeshStandardMaterial.prototype, K = Symbol('giObc');
  function base(sh) { giCompile.call(this, sh); }
  Object.defineProperty(P, 'onBeforeCompile', {
    configurable: true,
    get() { return this[K] ? this[K].w : base; },
    set(fn) { if (!fn || fn === base) { this[K] = null; return; } const w = function (sh, r) { fn.call(this, sh, r); giCompile.call(this, sh); }; this[K] = { fn, w }; },
  });
  P.customProgramCacheKey = function () { return this[K] ? this[K].fn.toString() : ''; };
}

// ---------- bake ----------
function fib(n) { const out = [], ga = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y), a = i * ga; out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); } return out; }
const quadGeo = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); return g; };
const FSV = 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }';

/**
 * Bake one probe volume. occ: BufferGeometry (world space) of everything that blocks light, without the ground.
 * v: { slot:'a'|'b', min:Vector3, max:Vector3, cell:number|Vector3, dirs, res, bounce, strength }
 */
export async function bakeVolume(renderer, occ, v) {
  const c = typeof v.cell === 'number' ? new THREE.Vector3(v.cell, v.cell, v.cell) : v.cell.clone();
  const size = v.max.clone().sub(v.min); const n = new THREE.Vector3(Math.max(1, Math.round(size.x / c.x)), Math.max(1, Math.round(size.y / c.y)), Math.max(1, Math.round(size.z / c.z)));
  c.set(size.x / n.x, size.y / n.y, size.z / n.z);
  const W = n.x, H = n.z * n.y;
  const rtOpt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
  const acc = new THREE.WebGLRenderTarget(W, H, rtOpt);
  const res = v.res || 1024;
  const drt = new THREE.WebGLRenderTarget(res, res, { depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  drt.depthTexture = new THREE.DepthTexture(res, res); drt.depthTexture.type = THREE.UnsignedIntType;
  const occScene = new THREE.Scene(); const occMesh = new THREE.Mesh(occ, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false })); occMesh.frustumCulled = false; occMesh.matrixAutoUpdate = false; occScene.add(occMesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
  const accMat = new THREE.ShaderMaterial({
    uniforms: { tD: { value: drt.depthTexture }, uVP: { value: new THREE.Matrix4() }, uDir: { value: new THREE.Vector3() }, uO: { value: v.min.clone() }, uC: { value: c.clone() }, uN: { value: n.clone() }, uW: { value: 1 }, uBias: { value: 0 } },
    vertexShader: FSV,
    fragmentShader: `uniform sampler2D tD; uniform mat4 uVP; uniform vec3 uDir, uO, uC, uN; uniform float uW, uBias;
      void main(){ vec2 px = floor(gl_FragCoord.xy); float j = floor(px.y / uN.z); vec3 p = uO + (vec3(px.x, j, px.y - j * uN.z) + .5) * uC;
        vec4 cl = uVP * vec4(p, 1.); vec3 q = cl.xyz / cl.w * .5 + .5; float d = texture2D(tD, q.xy).r;
        float vis = q.z <= d + uBias ? 1. : 0.;
        gl_FragColor = vec4(uDir * vis, vis) * uW; }`,
    depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  const quad = new THREE.Mesh(quadGeo(), accMat); quad.frustumCulled = false; const qScene = new THREE.Scene(); qScene.add(quad); const qCam = new THREE.Camera();
  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), prevSM = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false; renderer.autoClear = false;
  renderer.setRenderTarget(acc); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
  const ctr = v.min.clone().add(v.max).multiplyScalar(.5); const R = v.reach || 400;
  const corners = []; for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? v.min.x : v.max.x, i & 2 ? v.min.y : v.max.y, i & 4 ? v.min.z : v.max.z));
  const dirs = fib(v.dirs || 64); const wgt = 1 / dirs.length; let k = 0;
  // a few directions per task: one burst of every depth pass over the whole town can run past a phone GPU's watchdog,
  // which loses the context and leaves the loading screen frozen
  for (const d of dirs) {
    if (++k % 4 === 0) await new Promise(r => setTimeout(r, 0));
    cam.position.copy(ctr).addScaledVector(d, R); cam.up.set(0, 1, 0); if (Math.abs(d.y) > .98) cam.up.set(1, 0, 0); cam.lookAt(ctr); cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse; let ext = 0; for (const p of corners) { const q = p.clone().applyMatrix4(inv); ext = Math.max(ext, Math.abs(q.x), Math.abs(q.y)); }
    ext += 1; cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.near = .1; cam.far = R * 2; cam.updateProjectionMatrix();
    renderer.setRenderTarget(drt); renderer.clear(true, true, false); renderer.render(occScene, cam);
    accMat.uniforms.uVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); accMat.uniforms.uDir.value.copy(d); accMat.uniforms.uW.value = wgt;
    // a probe counts as seeing past an occluder if it is within ~one depth texel (in metres along the ray) of it
    accMat.uniforms.uBias.value = Math.max(.02, ext * 2 / res * .5) / (R * 2);
    renderer.setRenderTarget(acc); renderer.render(qScene, qCam);
  }
  // resolve: probes buried in solid geometry take their neighbours' light (surfaces interpolate toward them), and
  // every probe gets one diffuse bounce, the mean of its neighbours scaled by the surfaces' albedo
  const out = new THREE.WebGLRenderTarget(W, H, { ...rtOpt, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const resMat = new THREE.ShaderMaterial({
    uniforms: { tA: { value: acc.texture }, uN: { value: n.clone() }, uK: { value: v.bounce ?? .5 } },
    vertexShader: FSV,
    fragmentShader: `uniform sampler2D tA; uniform vec3 uN; uniform float uK;
      vec4 at(vec3 g) { g = clamp(g, vec3(0.), uN - 1.); return texture2D(tA, (vec2(g.x, g.z + g.y * uN.z) + .5) / vec2(uN.x, uN.z * uN.y)); }
      void main(){ vec2 px = floor(gl_FragCoord.xy); float j = floor(px.y / uN.z); vec3 g = vec3(px.x, j, px.y - j * uN.z);
        vec4 s = at(g), sum = vec4(0.); float cnt = 0.;
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) { if (x == 0 && y == 0 && z == 0) continue; vec4 t = at(g + vec3(float(x), float(y), float(z))); if (t.a > .003) { sum += t; cnt += 1.; } }
        vec4 avg = cnt > 0. ? sum / cnt : vec4(0.);
        if (s.a <= .003) s = avg; else s.a = min(1., s.a + uK * avg.a * (1. - s.a));
        gl_FragColor = s; }`,
    depthTest: false, depthWrite: false,
  });
  quad.material = resMat; renderer.setRenderTarget(out); renderer.clear(true, false, false); renderer.render(qScene, qCam);
  // 8-bit copy for the CPU (lighting of the first-person weapon, particles)
  const cpuRT = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const cpuMat = new THREE.ShaderMaterial({ uniforms: { tA: { value: out.texture } }, vertexShader: FSV, depthTest: false, depthWrite: false,
    fragmentShader: 'uniform sampler2D tA; uniform vec2 uS; void main(){ vec4 s = texelFetch(tA, ivec2(gl_FragCoord.xy), 0); gl_FragColor = vec4(s.rgb + .5, sqrt(clamp(s.a, 0., 1.))); }', glslVersion: null });
  quad.material = cpuMat; renderer.setRenderTarget(cpuRT); renderer.render(qScene, qCam);
  const px = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(cpuRT, 0, 0, W, H, px);
  renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto; renderer.setClearColor(prevCol, prevA); renderer.shadowMap.autoUpdate = prevSM;
  for (const t of [acc, drt, cpuRT]) t.dispose(); drt.depthTexture.dispose(); accMat.dispose(); resMat.dispose(); cpuMat.dispose(); occMesh.material.dispose(); quad.geometry.dispose();
  const S = SLOTS[v.slot]; S.tex.value = out.texture; S.o.value.copy(v.min); S.c.value.copy(c); S.n.value.copy(n); S.s.value = v.strength ?? 1;
  const V = { slot: v.slot, min: v.min.clone(), c, n, px, strength: v.strength ?? 1, rt: out };
  (G.gi ||= {})[v.slot] = V;
  return V;
}

// CPU lookup of the same data (nearest probe, 8-bit): visibility for a surface facing n, or the mean when n is omitted
export function giAt(p, n = null) {
  let s = [0, 0, 0, 1];
  for (const k of ['a', 'b']) {
    const V = G.gi && G.gi[k]; if (!V) continue;
    const g = p.clone().sub(V.min); const i = Math.floor(g.x / V.c.x), j = Math.floor(g.y / V.c.y), l = Math.floor(g.z / V.c.z);
    if (i < 0 || l < 0 || i >= V.n.x || l >= V.n.z || j >= V.n.y) continue;
    const jj = Math.max(0, j); const o = ((jj * V.n.z + l) * V.n.x + i) * 4; const P = V.px;
    const a = (P[o + 3] / 255) ** 2; s = [P[o] / 255 - .5, P[o + 1] / 255 - .5, P[o + 2] / 255 - .5, a].map((x, q) => s[q] + (x - s[q]) * V.strength);
  }
  const e = n ? s[3] + 2 * (n.x * s[0] + n.y * s[1] + n.z * s[2]) : s[3];
  return Math.min(1, Math.max(0, e));
}

// ambient for something with no single facing (the first-person weapon): between the mean and the brightest axis
const AX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(a => new THREE.Vector3(...a));
export function giAmbient(p) { let mx = 0; for (const a of AX) mx = Math.max(mx, giAt(p, a)); return (giAt(p) + mx) * .5; }

/** One depth render of the occluders from the sun over a box, kept for the whole session (the town does not move). */
export function bakeSunShadow(renderer, occ, { min, max, sunDir, res = 2048, near = 40 }) {
  const rt = new THREE.WebGLRenderTarget(res, res, { depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  rt.depthTexture = new THREE.DepthTexture(res, res); rt.depthTexture.type = THREE.UnsignedIntType;
  const sc = new THREE.Scene(); const m = new THREE.Mesh(occ, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false })); m.frustumCulled = false; sc.add(m);
  const ctr = min.clone().add(max).multiplyScalar(.5), R = 600; const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, R * 2);
  cam.position.copy(ctr).addScaledVector(sunDir, R); cam.up.set(0, 1, 0); cam.lookAt(ctr); cam.updateMatrixWorld(true);
  let ex = 0, ey = 0; for (let i = 0; i < 8; i++) { const q = new THREE.Vector3(i & 1 ? min.x : max.x, i & 2 ? min.y : max.y, i & 4 ? min.z : max.z).applyMatrix4(cam.matrixWorldInverse); ex = Math.max(ex, Math.abs(q.x)); ey = Math.max(ey, Math.abs(q.y)); }
  cam.left = -ex - 2; cam.right = ex + 2; cam.top = ey + 2; cam.bottom = -ey - 2; cam.updateProjectionMatrix();
  const prev = renderer.getRenderTarget(), prevSM = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(rt); renderer.clear(true, true, false); renderer.render(sc, cam); renderer.setRenderTarget(prev); renderer.shadowMap.autoUpdate = prevSM;
  m.material.dispose();
  GIU.tSunD.value = rt.depthTexture; GIU.uSunVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); GIU.uSunOn.value = 1; GIU.uSunNear.value = near; GIU.uSunTx.value = 1 / res;
  G.sunShadowRT = rt; return rt;
}

/** Occluder geometry from the collision soup: every collider except the ones tagged noOcclude (ground, invisible bounds). */
export function occluderFrom(colliders) {
  const geos = [];
  for (const g of colliders) { if (g.userData && g.userData.noOcclude) continue; const q = g.index ? g.toNonIndexed() : g; const p = new THREE.BufferGeometry(); p.setAttribute('position', q.attributes.position); geos.push(p); }
  let total = 0; for (const g of geos) total += g.attributes.position.count;
  const arr = new Float32Array(total * 3); let o = 0; for (const g of geos) { arr.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return out;
}
