// Asset loading: glTF (JSON + external images), textures, HDR (RGBE split into two PNGs), sounds, animation clips
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G } from './core.js';
import { VO } from './vo.js';

const BASE = 'assets/';
const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);
const imgLoader = new THREE.ImageLoader(manager);

export const A = G.assets;
A.chars = {}; A.tex = {}; A.snd = {}; A.clips = {}; A.models = {}; A.img = {};

// Which copy of each image to download. Phones resample every texture at upload anyway (main.js caps them at 1024 px,
// 512 on iPhone), so the full size only costs them download time and memory: iPhones, and phones on a slow or
// data-saving link, get the 512 px set in assets/s/; other phones get the few images over 1024 px pre-fitted in
// assets/m/. Both are built offline from the originals by build_variants.py (rerun it after changing an image);
// window.TEXTIER = '' | 'm' | 's' overrides the choice for tests.
const NET = navigator.connection || {};
export const TIER = typeof globalThis.TEXTIER === 'string' ? globalThis.TEXTIER : (G.lowMem || (G.isTouch && (NET.saveData || /(^|-)2g|^3g/.test(NET.effectiveType || '')))) ? 's' : G.isTouch ? 'm' : '';
const TI = TIER === 's' ? 2 : TIER === 'm' ? 1 : 0; A.tier = TIER;
const OVER1K = new Set(['chars/team2_c.jpg', 'chars/team2_n.jpg', 'chars/team3_c.jpg', 'chars/team_c.jpg', 'chars/team_n.jpg']);
// PNG cut-outs (hair, fringes) ship as WebP with lossless alpha and near-lossless colour: a fifth of the bytes
export function imgPath(p) { const q = p.replace(/\.png$/, '.webp'); return TIER === 's' ? 's/' + q : TIER === 'm' && OVER1K.has(p) ? 'm/' + q : q; }
const url = p => new URL(BASE + p, document.baseURI).href;

// Download sizes in KB per job and tier [desktop, m, s] (JSON counted unpacked, as the stream delivers it), so the bar
// moves with bytes, not with file count: one character is 2 MB, one sound 10 KB.
const SZ = { 'chars/civF1': [812,812,812], 'chars/civF2': [594,594,594], 'chars/civM1': [665,665,665], 'chars/civM2': [680,680,680], 'chars/civM3': [699,699,699], 'chars/fighter': [1265,1265,1158], 'chars/guard1': [625,625,546], 'chars/guard2': [864,864,684], 'chars/hostF': [1297,1297,868], 'chars/hostM1': [1265,1265,788], 'chars/hostM2': [646,646,512], 'chars/hostM3': [1182,1182,732], 'chars/pM1': [788,788,731], 'chars/pM2': [637,637,581], 'chars/pM3': [621,621,573], 'chars/pM4': [514,514,456], 'chars/pM5': [585,585,533], 'chars/team': [1765,1479,1367], 'chars/team2': [1694,1439,1334], 'chars/team3': [1605,1489,1359], 'props/barrel_01_polyhaven': [428,428,428], 'props/collapsed_house': [471,471,471], 'props/furniture': [5807,5807,4982], 'props/jersey_barrier': [83,83,83], 'veh/hatch': [190,190,190], 'veh/pickup': [367,367,264], 'veh/suv': [265,265,265], 'veh/uh60': [4143,4143,3959], 'wpn/ak': [224,224,224], 'wpn/m4': [1391,1391,1224], 'tex/cblock_c.jpg': [539,539,100], 'tex/cblock_n.jpg': [122,122,122], 'tex/damaged_c.jpg': [90,90,90], 'tex/damaged_n.jpg': [169,169,169], 'tex/dirt2_c.jpg': [414,414,95], 'tex/gravel_c.jpg': [260,260,64], 'tex/gravel_n.jpg': [651,651,133], 'tex/metal8_c.jpg': [190,190,46], 'tex/metal8_n.jpg': [53,53,5], 'tex/metal8_r.jpg': [53,53,53], 'tex/pconc_c.jpg': [327,327,73], 'tex/pconc_n.jpg': [84,84,10], 'tex/plaster_cream.jpg': [130,130,36], 'tex/plaster_gray.jpg': [69,69,59], 'tex/plaster_n.jpg': [230,230,32], 'tex/plaster_white.jpg': [253,253,64], 'tex/plaster_yellow.jpg': [145,145,40], 'tex/rsheet_n.jpg': [38,38,4], 'tex/rust2_c.jpg': [225,225,65], 'tex/rust2_n.jpg': [129,129,22], 'tex/sand_c.jpg': [513,513,119], 'tex/sstone_c.jpg': [100,100,20], 'tex/sstone_n.jpg': [72,72,9], 'tex/tarmac.jpg': [507,507,127], 'tex/wconc_c.jpg': [328,328,78], 'tex/wconc_n.jpg': [116,116,116], 'tex/wood_c.jpg': [182,182,43], 'tex/wood_n.jpg': [53,53,53], 'sky': [576,576,576], 'anims.json': [1298,1298,1298], 'anims_fence.json': [450,450,450], 'sfx.mp3': [778,778,778], 'amb.mp3': [2141,2141,2141], 'fsfx.mp3': [598,598,598], 'vo.mp3': [2596,2596,2596], 'fvo.mp3': [1857,1857,1857], 'snd/heli_uh60_fast_rotor_bass_gpl': [138,138,138], 'snd/radio_static_doty21_cc0': [77,77,77], 'snd/vehicle_engine_godot_truck_town': [11,11,11], 'snd/heli_uh60_main_rotor_idle_power_loop_gpl': [144,144,144] };
let progressCb = () => {};
let done = 0, live = 0, total = 0;
const DL = .8; // downloading is this share of the bar; main.js and the loading screen walk the rest through build and light bake
function show() {
  if (!progressCb) return; // the background downloads after the menu must not pull the bar back
  progressCb(Math.min(1, (done + live) / Math.max(total, 1)) * DL);
  const el = document.getElementById('loadmb'); if (el) el.textContent = ((done + live) / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB';
}
// one weighted download: streamed bytes move the bar while it arrives (capped at its weight), the rest lands at the end
function job(key, f) {
  const w = (SZ[key] ? SZ[key][TI] : 200) * 1024; total += w; let got = 0; const cap = w * .97;
  const on = n => { live += Math.min(got + n, cap) - Math.min(got, cap); got += n; show(); };
  return f(on).finally(() => { live -= Math.min(got, cap); done += w; show(); });
}
async function fetchBytes(path, on = () => {}) {
  const r = await fetch(url(path)); if (!r.ok) throw new Error(path + ' ' + r.status);
  if (!r.body || !r.body.getReader) { const b = await r.arrayBuffer(); on(b.byteLength); return b; }
  const rd = r.body.getReader(), parts = []; let n = 0;
  for (;;) { const { done: end, value } = await rd.read(); if (end) break; parts.push(value); n += value.length; on(value.length); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out.buffer;
}
const fetchJSON = (path, on) => fetchBytes(path, on).then(b => JSON.parse(new TextDecoder().decode(b)));

// every texture the materials ask for, fetched with the rest so the bar counts them (they used to arrive after the bar
// had reached the end, while the town was being built)
export const TEX_FILES = ['cblock_c.jpg', 'cblock_n.jpg', 'damaged_c.jpg', 'damaged_n.jpg', 'dirt2_c.jpg', 'gravel_c.jpg', 'gravel_n.jpg', 'metal8_c.jpg', 'metal8_n.jpg', 'metal8_r.jpg', 'pconc_c.jpg', 'pconc_n.jpg', 'plaster_cream.jpg', 'plaster_gray.jpg', 'plaster_n.jpg', 'plaster_white.jpg', 'plaster_yellow.jpg', 'rsheet_n.jpg', 'rust2_c.jpg', 'rust2_n.jpg', 'sand_c.jpg', 'sstone_c.jpg', 'sstone_n.jpg', 'tarmac.jpg', 'wconc_c.jpg', 'wconc_n.jpg', 'wood_c.jpg', 'wood_n.jpg'];
export function tex(name, { srgb = true, repeat = true, aniso = 8 } = {}) {
  if (A.tex[name]) return A.tex[name];
  const im = A.img[name]; let t;
  if (im) { t = new THREE.Texture(im); t.needsUpdate = true; delete A.img[name]; } else t = texLoader.load(url(imgPath('tex/' + name)));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  A.tex[name] = t;
  return t;
}
const preTex = name => job('tex/' + name, () => new Promise(res => imgLoader.load(url(imgPath('tex/' + name)), im => { A.img[name] = im; res(); }, undefined, () => res())));

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
function loadGLTF(path, on) {
  const rel = path.slice(0, path.lastIndexOf('/') + 1);
  return fetchJSON(path, on).then(json => {
    // point each image at this device's copy (absolute URLs pass through GLTFLoader's path resolution untouched)
    for (const im of json.images || []) if (im.uri && !im.uri.startsWith('data:')) { const q = imgPath(rel + im.uri); im.uri = url(q); if (q.endsWith('.webp')) im.mimeType = 'image/webp'; }
    return new Promise((res, rej) => gltfLoader.parse(toGLB(json), BASE + rel, res, rej));
  });
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
  const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url('tex/' + src); });
  const [a, b] = await job('sky', () => Promise.all([load('sky_rgb.png'), load('sky_e.png')]));
  const W = a.width, H = a.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(a, 0, 0); const rgb = g.getImageData(0, 0, W, H).data;
  g.clearRect(0, 0, W, H); g.drawImage(b, 0, 0); const ex = g.getImageData(0, 0, W, H).data;
  // half floats: 32-bit float textures cannot be filtered linearly without OES_texture_float_linear (missing on many
  // phones), and an unfilterable texture samples black, which would blank the sky and the environment lighting
  // iPhone: half the size (a quarter of the 16 MB), averaging each 2x2 block so the sun keeps its energy
  const k = G.lowMem ? 2 : 1, w = W / k, h = H / k;
  const f = new Uint16Array(w * h * 4); const hf = THREE.DataUtils.toHalfFloat, one = hf(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, gg = 0, bb = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const i = (y * k + dy) * W + x * k + dx; const e = ex[i * 4]; const s = e ? Math.pow(2, e - 136) : 0; r += rgb[i * 4] * s; gg += rgb[i * 4 + 1] * s; bb += rgb[i * 4 + 2] * s; }
    const o = (y * w + x) * 4, n = k * k; f[o] = hf(Math.min(r / n, 65000)); f[o + 1] = hf(Math.min(gg / n, 65000)); f[o + 2] = hf(Math.min(bb / n, 65000)); f[o + 3] = one;
  }
  const t = new THREE.DataTexture(f, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.flipY = true; t.needsUpdate = true;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  A.hdr = t;
}

async function loadAnims(file = 'anims.json') {
  const j = await job(file, on => fetchJSON(file, on));
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

// Phones decode at 22 kHz: the banks are minutes of audio held as 32-bit floats, so this halves about 100 MB, and a phone
// speaker does not reproduce what is lost above 11 kHz. An offline context sets the rate; buffers play in any context.
function decodeAudio(buf) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (G.isTouch && OAC) { try { const p = new OAC(1, 1, 22050).decodeAudioData(buf.slice(0)); if (p && p.then) return p.catch(() => G.audio.ctx.decodeAudioData(buf)); } catch (e) {} }
  return G.audio.ctx.decodeAudioData(buf);
}
async function loadSound(name) {
  const buf = await job('snd/' + name, on => fetchBytes('snd/' + name + '.mp3', on));
  try { A.snd[name] = await decodeAudio(buf); } catch (e) { A.snd[name] = null; }
}

export const CHAR_FILES = ['team', 'team2', 'team3', 'hostF', 'hostM1', 'hostM2', 'hostM3', 'guard1', 'guard2', 'fighter', 'civM1', 'civM2', 'civM3', 'civF1', 'civF2'];
export const SOUNDS = ['radio_static_doty21_cc0', 'vehicle_engine_godot_truck_town',
  'heli_uh60_main_rotor_idle_power_loop_gpl', 'heli_uh60_fast_rotor_bass_gpl'];

const MODEL_FILES = [['m4', 'wpn/m4.json'], ['ak', 'wpn/ak.json'], ['pickup', 'veh/pickup.json'], ['uh60', 'veh/uh60.json'],
    ['suv', 'veh/suv.json'], ['hatch', 'veh/hatch.json'], ['barrel', 'props/barrel_01_polyhaven.json'], ['jersey', 'props/jersey_barrier.json'],
    ['ruin', 'props/collapsed_house.json'], ['furniture', 'props/furniture.json']];
// opts (other scenes): chars, models, sounds, vo file, extra animation packs, extra sound banks
// Resolves once everything the menu and the first minute need is in. The voice bank and the helicopter loops (minutes
// away in either mission) follow in the background as A.late; audio.js plays nothing for a buffer that is not there
// yet, and the subtitles carry the lines meanwhile.
export async function loadAll(onProgress, opts = {}) {
  progressCb = onProgress; show();
  const jobs = [];
  // all at once, every model's JSON, base64 text and decoded copies are alive together: the peak an iPhone tab dies at
  // while loading. There they go two at a time.
  const lim = G.lowMem ? 2 : 1e9, wait = []; let busy = 0;
  const slot = (key, f) => job(key, on => new Promise((res, rej) => { const go = () => { busy++; f(on).then(res, rej).finally(() => { busy--; if (wait.length) wait.shift()(); }); }; busy < lim ? go() : wait.push(go); }));
  jobs.push(loadHDR());
  jobs.push(loadAnims());
  for (const f of opts.anims || []) jobs.push(loadAnims(f));
  for (const c of opts.chars || CHAR_FILES) jobs.push(slot('chars/' + c, on => loadGLTF('chars/' + c + '.json', on)).then(g => { fixCharMaterials(g.scene); g.parser = null; A.chars[c] = g; }));
  const want = opts.models; for (const [k, p] of MODEL_FILES) if (!want || want.includes(k))
    jobs.push(slot(p.slice(0, -5), on => loadGLTF(p, on)).then(g => { g.parser = null; A.models[k] = g; }).catch(() => { A.models[k] = null; }));
  for (const t of TEX_FILES) jobs.push(preTex(t));
  const sounds = opts.sounds || SOUNDS, late = sounds.filter(s => s.startsWith('heli'));
  for (const s of sounds) if (!late.includes(s)) jobs.push(loadSound(s).catch(() => {}));
  const bank = (k, file) => job(file, on => fetchBytes(file, on)).then(b => decodeAudio(b)).then(d => { A.snd[k] = d; }).catch(() => {});
  for (const k of ['sfx', 'amb', ...(opts.banks || [])]) jobs.push(bank(k, k + '.mp3'));
  await Promise.all(jobs); progressCb = null;
  // start the rest only now, so it does not share the line with what the menu is waiting for
  A.late = Promise.all([bank('vo', opts.vo || 'vo.mp3'), ...late.map(s => loadSound(s).catch(() => {}))]);
}
