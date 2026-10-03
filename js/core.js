// Shared state, constants and small helpers
import * as THREE from 'three';

export const G = {
  THREE,
  renderer: null, scene: null, camera: null, composer: null,
  clock: null, time: 0, dt: 0,
  isTouch: matchMedia('(pointer:coarse)').matches,
  // iPhone and iPad: every browser there is WebKit, which kills a tab past a fixed memory ceiling (far below desktop
  // Chrome's) and then reloads it in a loop, so textures, audio, render targets and loading are budgeted down there
  lowMem: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || globalThis.LOWMEM === true,
  quality: 2,
  state: 'loading', // loading | menu | briefing | play | cutscene | paused | end
  colliders: [],     // static collider geometries (world space BufferGeometry)
  bvhMesh: null,     // merged collision mesh with boundsTree
  actors: [],        // all live actors
  player: null,
  weapon: null,
  mission: null,
  audio: null,
  ui: null,
  fx: null,
  assets: {},
  settings: { sens: 1, subtitles: true, voice: true, music: true, invertY: false, autoFire: true, gyro: false },
  stats: { shots: 0, hits: 0, kills: 0, civHits: 0, start: 0, end: 0, damage: 0 },
  debug: {},
  difficultyMul: matchMedia('(pointer:coarse)').matches ? .75 : 1, // phones: a bit more forgiving
  inside: false,     // player inside target building (for reverb, lighting)
  missionClock: 10 * 3600 + 58 * 60 + 20, // seconds since midnight, 10:58:20
};

// Sun for 11:00, 8 June, 31.44N: elevation ~68deg, azimuth ~115deg (from north, clockwise)
{
  const el = THREE.MathUtils.degToRad(68), az = THREE.MathUtils.degToRad(115);
  G.sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
}

export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const R = rng(20240608);
export const rr = (a, b) => a + (b - a) * R();
export const ri = (a, b) => Math.floor(rr(a, b + 1));
export const pick = arr => arr[Math.floor(R() * arr.length)];
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export function angleLerp(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
export function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
export function fbm(x, y, o = 5) { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= .5; } return s; }
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export function fmtClock(s) { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }

// tiny event bus
const handlers = {};
export const bus = {
  on(ev, fn) { (handlers[ev] ||= []).push(fn); },
  off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter(f => f !== fn); },
  emit(ev, ...a) { (handlers[ev] || []).forEach(f => f(...a)); },
};

// timers that run on game time (pause-safe)
const timers = [];
export function after(sec, fn) { const t = { at: G.time + sec, fn }; timers.push(t); return t; }
export function cancel(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }
export function tickTimers() { for (let i = timers.length - 1; i >= 0; i--) { if (G.time >= timers[i].at) { const t = timers.splice(i, 1)[0]; t.fn(); } } }
export function clearTimers() { timers.length = 0; }

// Atmosphere for every material with fog: aerial perspective rather than a grey wall at the end of the world.
// Dust, sea salt and smoke hug the ground, so the density falls off exponentially with height and is integrated along
// the view ray (exponential height fog): a street view gains haze from the middle distance on, while a rooftop or a
// drone looking down sees through thinner air. A thin exp2 term (fogDensity) on top still hides the edge of the built
// world. The in-scattered light is the fog colour, brighter and warmer toward the sun (dust scatters forward) and
// cooler and dimmer away from it.
// o: ground = extinction per metre at y = 0, base = the part that does not thin with height, H = scale height (m),
// toward/away = in-scatter tint looking into / away from the sun, sunPow = how tight the forward lobe is.
export const FOG = { ground: .0017, base: .00025, H: 38, toward: [1.2, 1.05, .82], away: [.9, .96, 1.04], sunPow: 5 };
// The fog model as GLSL functions, for shaders that do their own fog (particles): fgTau(world pos, exp2 density) is the
// optical depth from the camera, fgIn(view dir) the in-scatter tint to multiply the fog colour by.
export function fogGLSL() {
  const f = x => (+x).toFixed(5), v3 = a => `vec3(${a.map(f).join(',')})`, s = G.sunDir;
  return `float fgTau(vec3 w, float dens){ vec3 v = w - cameraPosition; float L = length(v), k = clamp(v.y / ${f(FOG.H)}, -30., 30.);
  float i = abs(k) > 1e-4 ? (1. - exp(-k)) / k : 1. - .5 * k; float e = dens * L;
  return L * (${f(FOG.base)} + ${f(FOG.ground)} * exp(-max(cameraPosition.y, 0.) / ${f(FOG.H)}) * i) + e * e * (.35 + .65 * exp(-max(w.y, 0.) * .03)); }
vec3 fgIn(vec3 dir){ return mix(${v3(FOG.away)}, ${v3(FOG.toward)}, pow(max(dot(dir, vec3(${f(s.x)},${f(s.y)},${f(s.z)})), 0.), ${f(FOG.sunPow)})); }
`;
}
export function installFog(o = {}) {
  Object.assign(FOG, o);
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\nvarying float vFogDepth;varying vec3 vFogW;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\nvFogDepth=-mvPosition.z;vFogW=transpose(mat3(viewMatrix))*(mvPosition.xyz-viewMatrix[3].xyz);\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\nuniform vec3 fogColor;varying float vFogDepth;varying vec3 vFogW;\n#ifdef FOG_EXP2\nuniform float fogDensity;\n#else\nuniform float fogNear;uniform float fogFar;\n#endif\n${fogGLSL()}#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
{
#ifdef FOG_EXP2
float fgT=fgTau(vFogW,fogDensity);
#else
float fgT=fgTau(vFogW,0.)+3.*smoothstep(fogNear,fogFar,length(vFogW-cameraPosition));
#endif
vec3 fgV=vFogW-cameraPosition;float fogFactor=1.-exp(-fgT);vec3 fc=fogColor*fgIn(fgV/max(length(fgV),1e-3));
gl_FragColor.rgb=mix(gl_FragColor.rgb,fc,fogFactor);}
#endif`;
}

// Phones: small props far away cost a draw call (and a shadow-pass call) each and cover a few pixels, or none. Every
// half second, static meshes whose bounding sphere would be under ~5 CSS px tall on screen are taken off the camera's
// layer (not .visible, which game code toggles for its own reasons). Anything that has moved since it was first seen
// (doors, vehicles, carried rifles) is left alone from then on, and objects flagged userData.noCull are skipped.
// Instanced and batched meshes, points, skinned meshes and anything with frustumCulled = false are never touched.
const _dc = { v: new THREE.Vector3(), s: new THREE.Vector3() };
export function detailCull(scene, cam, on, px = 5) {
  scene.updateMatrixWorld();
  const H = innerHeight, k = H / (px * Math.tan(THREE.MathUtils.degToRad(cam.fov / (cam.zoom || 1)) / 2)), cp = cam.position; let n = 0;
  const walk = o => {
    if (!o.visible || o.userData.noCull) return;
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.isBatchedMesh && o.frustumCulled !== false && o.geometry) {
      const u = o.userData;
      if (u._dcR === undefined) { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); o.getWorldScale(_dc.s); u._dcR = g.boundingSphere ? g.boundingSphere.radius * Math.max(_dc.s.x, _dc.s.y, _dc.s.z) : 1e9; u._dcM = o.layers.mask; }
      if (u._dcR < 3 && !u._dcDyn) {
        const c = _dc.v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
        if (!u._dcC) u._dcC = c.clone(); else if (u._dcC.distanceToSquared(c) > .0025) { u._dcDyn = true; o.layers.mask = u._dcM; }
        if (!u._dcDyn) { const far = on && c.distanceTo(cp) - u._dcR > Math.max(12, u._dcR * k); o.layers.mask = far ? 0 : u._dcM; if (far) n++; }
      }
    }
    const ch = o.children; for (let i = 0; i < ch.length; i++) walk(ch[i]);
  };
  walk(scene); return n;
}
// every 0.5 s, and sooner (at most every 0.1 s) after a cut (the camera jumped) or when the lens narrowed (binoculars, drone zoom), so nothing
// pops in late; actors and what they carry are flagged first
const _dt = { t: 0, p: new THREE.Vector3(1e9, 0, 0), fov: 0 };
export function detailCullTick(scene, cam, dt, on) {
  _dt.t -= dt; if (_dt.t > 0 && (_dt.t > .4 || cam.position.distanceToSquared(_dt.p) < 64 && cam.fov > _dt.fov * .8)) return;
  _dt.t = .5; _dt.p.copy(cam.position); _dt.fov = cam.fov;
  for (const a of G.actors) for (const o of [a.root, a.rifle, a.band]) if (o) o.userData.noCull = true;
  G.dcN = detailCull(scene, cam, on);
}
