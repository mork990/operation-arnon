// Asset loading: glTF (JSON + external images), textures, HDR (RGBE split into two PNGs), sounds, animation clips
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G } from './core.js';
import { VO } from './vo.js';

const BASE = 'assets/';
const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);

export const A = G.assets;
A.chars = {}; A.tex = {}; A.snd = {}; A.clips = {}; A.models = {};

let progressCb = () => {};
let loaded = 0, total = 0;
function track(p) { total++; return p.then(v => { loaded++; progressCb(loaded / total); return v; }); }

export function tex(name, { srgb = true, repeat = true, aniso = 8 } = {}) {
  if (A.tex[name]) return A.tex[name];
  const t = texLoader.load(BASE + 'tex/' + name);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  A.tex[name] = t;
  return t;
}

// The artifact sandbox refuses fetch() of data: URIs, so embedded buffers are decoded here and the model is repacked as GLB in memory
function b64ToBytes(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function toGLB(json) {
  let bin = new Uint8Array(0);
  const b = json.buffers && json.buffers[0];
  if (b && b.uri && b.uri.startsWith('data:')) { bin = b64ToBytes(b.uri.slice(b.uri.indexOf(',') + 1)); delete b.uri; b.byteLength = bin.length; }
  const enc = new TextEncoder(); let js = enc.encode(JSON.stringify(json));
  const jpad = (4 - js.length % 4) % 4, bpad = (4 - bin.length % 4) % 4;
  const jl = js.length + jpad, bl = bin.length + bpad;
  const total = 12 + 8 + jl + (bin.length ? 8 + bl : 0);
  const out = new Uint8Array(total); const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true); out.set(js, 20); for (let i = 0; i < jpad; i++) out[20 + js.length + i] = 0x20;
  if (bin.length) { const o = 20 + jl; dv.setUint32(o, bl, true); dv.setUint32(o + 4, 0x004E4942, true); out.set(bin, o + 8); }
  return out.buffer;
}
function loadGLTF(path) {
  const dir = BASE + path.slice(0, path.lastIndexOf('/') + 1);
  return track(fetch(BASE + path).then(r => { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); })
    .then(json => new Promise((res, rej) => gltfLoader.parse(toGLB(json), dir, res, rej))));
}

function fixCharMaterials(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const mats = [].concat(o.material);
    mats.forEach(m => {
      m.envMapIntensity = 0.9;
      if (m.map) m.map.anisotropy = 4;
      // hair, eyelashes, keffiyeh fringes: alpha-to-coverage turns the hard cut-out into a soft edge under MSAA
      if (m.transparent || (m.name || '').includes('opacity')) { m.transparent = false; m.alphaTest = 0.4; m.alphaToCoverage = true; m.side = THREE.DoubleSide; m.depthWrite = true; }
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.55);
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.2);
    });
  });
}

async function loadHDR() {
  const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = BASE + 'tex/' + src; });
  const [a, b] = await track(Promise.all([load('sky_rgb.png'), load('sky_e.png')]));
  const W = a.width, H = a.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(a, 0, 0); const rgb = g.getImageData(0, 0, W, H).data;
  g.clearRect(0, 0, W, H); g.drawImage(b, 0, 0); const ex = g.getImageData(0, 0, W, H).data;
  // half floats: 32-bit float textures cannot be filtered linearly without OES_texture_float_linear (missing on many
  // phones), and an unfilterable texture samples black, which would blank the sky and the environment lighting
  const f = new Uint16Array(W * H * 4); const hf = THREE.DataUtils.toHalfFloat, one = hf(1);
  for (let i = 0; i < W * H; i++) {
    const e = ex[i * 4]; const s = e ? Math.pow(2, e - 136) : 0;
    f[i * 4] = hf(Math.min(rgb[i * 4] * s, 65000)); f[i * 4 + 1] = hf(Math.min(rgb[i * 4 + 1] * s, 65000)); f[i * 4 + 2] = hf(Math.min(rgb[i * 4 + 2] * s, 65000)); f[i * 4 + 3] = one;
  }
  const t = new THREE.DataTexture(f, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.flipY = true; t.needsUpdate = true;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  A.hdr = t;
}

async function loadAnims(file = 'anims.json') {
  const j = await track(fetch(BASE + file).then(r => r.json()));
  for (const [name, c] of Object.entries(j.clips)) {
    const rot = new Int16Array(Uint8Array.from(atob(c.rot), ch => ch.charCodeAt(0)).buffer);
    const root = new Int16Array(Uint8Array.from(atob(c.root), ch => ch.charCodeAt(0)).buffer);
    const n = c.n, nb = c.bones.length;
    const times = new Float32Array(n); for (let i = 0; i < n; i++) times[i] = i * c.dur / (n - 1);
    const tracks = [];
    c.bones.forEach((b, bi) => {
      const v = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) v[i * 4 + k] = rot[(i * nb + bi) * 4 + k] / 32767;
      tracks.push(new THREE.QuaternionKeyframeTrack(b + '.quaternion', times, v));
    });
    // root motion: keep bob (y) and sway (x), drop forward travel so clips play in place
    const rv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rv[i * 3] = root[i * 3] / 32767 * c.rs; rv[i * 3 + 1] = root[i * 3 + 1] / 32767 * c.rs; rv[i * 3 + 2] = 0; }
    const rz = root[(n - 1) * 3 + 2] / 32767 * c.rs;
    tracks.push(new THREE.VectorKeyframeTrack('Bip01.position', times, rv));
    const clip = new THREE.AnimationClip(name, c.dur, tracks);
    clip.userData = { speed: rz / c.dur }; // meters per second the clip was authored to travel
    A.clips[name] = clip;
  }
}

async function loadSound(name) {
  const buf = await track(fetch(BASE + 'snd/' + name + '.mp3').then(r => r.arrayBuffer()));
  try { A.snd[name] = await G.audio.ctx.decodeAudioData(buf); } catch (e) { A.snd[name] = null; }
}

export const CHAR_FILES = ['team', 'team2', 'team3', 'hostF', 'hostM1', 'hostM2', 'hostM3', 'guard1', 'guard2', 'fighter', 'civM1', 'civM2', 'civM3', 'civF1', 'civF2'];
export const SOUNDS = ['radio_static_doty21_cc0', 'vehicle_engine_godot_truck_town',
  'heli_uh60_main_rotor_idle_power_loop_gpl', 'heli_uh60_fast_rotor_bass_gpl'];

const MODEL_FILES = [['m4', 'wpn/m4.json'], ['ak', 'wpn/ak.json'], ['pickup', 'veh/pickup.json'], ['uh60', 'veh/uh60.json'],
    ['suv', 'veh/suv.json'], ['hatch', 'veh/hatch.json'], ['barrel', 'props/barrel_01_polyhaven.json'], ['jersey', 'props/jersey_barrier.json'],
    ['ruin', 'props/collapsed_house.json'], ['furniture', 'props/furniture.json']];
// opts (other scenes): chars, models, sounds, vo file, extra animation packs, extra sound banks
export async function loadAll(onProgress, opts = {}) {
  progressCb = onProgress;
  const jobs = [];
  jobs.push(loadHDR());
  jobs.push(loadAnims());
  for (const f of opts.anims || []) jobs.push(loadAnims(f));
  for (const c of opts.chars || CHAR_FILES) jobs.push(loadGLTF('chars/' + c + '.json').then(g => { fixCharMaterials(g.scene); A.chars[c] = g; }));
  const want = opts.models; for (const [k, p] of MODEL_FILES) if (!want || want.includes(k))
    jobs.push(loadGLTF(p).then(g => { A.models[k] = g; }).catch(() => { A.models[k] = null; }));
  for (const s of opts.sounds || SOUNDS) jobs.push(loadSound(s).catch(() => {}));
  for (const k of ['sfx', 'amb', ...(opts.banks || [])]) jobs.push(track(fetch(BASE + k + '.mp3').then(r => r.arrayBuffer())).then(b => G.audio.ctx.decodeAudioData(b)).then(d => { A.snd[k] = d; }).catch(() => {}));
  jobs.push(track(fetch(BASE + (opts.vo || 'vo.mp3')).then(r => r.arrayBuffer())).then(b => G.audio.ctx.decodeAudioData(b)).then(d => { A.snd.vo = d; }).catch(() => {}));
  await Promise.all(jobs);
}
