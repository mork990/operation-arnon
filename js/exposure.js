// Eye adaptation. The frame's centre-weighted log-average luminance is measured on the GPU (64x36 -> 8x6 -> 1x1, no
// read-back), smoothed over time in a 1x1 ping-pong target, and the grade pass scales the image by the resulting
// exposure. Walking from the midday street into a stairwell the picture first goes dark and then opens up, and the
// windows of a room blow out the way they do on a real camera. Adaptation is partial (alpha < 1): a dim room still
// reads dimmer than the street.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { G } from './core.js';

const V = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';

export class AutoExposure extends Pass {
  constructor() {
    super(); this.needsSwap = false;
    const o = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.r1 = new THREE.WebGLRenderTarget(64, 36, o); this.r2 = new THREE.WebGLRenderTarget(8, 6, o); this.r3 = new THREE.WebGLRenderTarget(1, 1, o);
    this.a = [new THREE.WebGLRenderTarget(1, 1, o), new THREE.WebGLRenderTarget(1, 1, o)]; this.i = 0; this.first = true;
    // 1: 64x36 cells, each the mean of 4x4 taps of the scene; weighted toward the centre (what the player looks at)
    this.m1 = new THREE.ShaderMaterial({ uniforms: { tD: { value: null } }, vertexShader: V, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tD; varying vec2 vUv;
        void main(){ vec2 cs = vec2(1./64., 1./36.); float s = 0.;
          for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) { vec3 c = texture2D(tD, vUv + (vec2(float(x), float(y)) - 1.5) * cs * .25).rgb; s += min(log2(dot(c, vec3(.2126, .7152, .0722)) + 1e-4), 1.5); }
          // centre-weighted, and the sky at the top of the frame counts for less (it is not what the player is looking at)
          vec2 d = (vUv - .5) * vec2(1.6, 1.); float w = mix(.25, 1., exp(-dot(d, d) * 5.)) * mix(1., .45, smoothstep(.62, .98, vUv.y));
          gl_FragColor = vec4(s / 16. * w, w, 0., 1.); }` });
    // 2 and 3: plain sums of the weighted logs and of the weights
    const sum = (nx, ny, src) => new THREE.ShaderMaterial({ uniforms: { tD: { value: src } }, vertexShader: V, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tD; varying vec2 vUv; void main(){ vec2 s = vec2(0.); vec2 ts = vec2(textureSize(tD, 0)); vec2 base = floor(vUv * ts / vec2(${nx}., ${ny}.)) * vec2(${nx}., ${ny}.);
        for (int y = 0; y < ${ny}; y++) for (int x = 0; x < ${nx}; x++) s += texelFetch(tD, ivec2(base) + ivec2(x, y), 0).rg; gl_FragColor = vec4(s, 0., 1.); }` });
    this.m2 = sum(8, 6, this.r1.texture); this.m3 = sum(8, 6, this.r2.texture);
    // adaptation: brightening (stepping out into the sun) is faster than opening up in the dark
    this.m4 = new THREE.ShaderMaterial({ uniforms: { tC: { value: this.r3.texture }, tP: { value: null }, uUp: { value: .05 }, uDown: { value: .03 }, uSnap: { value: 1 } }, vertexShader: V, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tC, tP; uniform float uUp, uDown, uSnap; varying vec2 vUv;
        void main(){ vec2 c = texture2D(tC, vec2(.5)).rg; float cur = c.x / max(c.y, 1e-4); float prev = texture2D(tP, vec2(.5)).r;
          float k = cur > prev ? uUp : uDown; gl_FragColor = vec4(mix(prev, cur, max(k, uSnap)), 0., 0., 1.); }` });
    this.q = new FullScreenQuad(null);
    // read by the grade pass: exposure = 2^clamp((key - adapted) * alpha, lo, hi)
    // key: the log2 mean luminance of the midday street measured in this renderer, which keeps the street at exposure 1
    this.uniforms = { tExp: { value: this.a[0].texture }, uKey: { value: -3.8 }, uAlpha: { value: .8 }, uEvLo: { value: -1.5 }, uEvHi: { value: 2.8 }, uEvBias: { value: 0 } };
  }
  render(renderer, writeBuffer, readBuffer, dt) {
    const q = this.q;
    this.m1.uniforms.tD.value = readBuffer.texture; q.material = this.m1; renderer.setRenderTarget(this.r1); q.render(renderer);
    q.material = this.m2; renderer.setRenderTarget(this.r2); q.render(renderer);
    q.material = this.m3; renderer.setRenderTarget(this.r3); q.render(renderer);
    const src = this.a[this.i], dst = this.a[1 - this.i]; this.i = 1 - this.i;
    const u = this.m4.uniforms; u.tP.value = src.texture; const d = Math.min(Math.max(dt || 1 / 60, 0), .1);
    u.uUp.value = 1 - Math.exp(-d * 2.6); u.uDown.value = 1 - Math.exp(-d * 1.2); u.uSnap.value = this.first || this.snap ? 1 : 0; this.first = false;
    q.material = this.m4; renderer.setRenderTarget(dst); q.render(renderer);
    this.uniforms.tExp.value = dst.texture;
  }
  setSize() {}
  // debug: adapted log2 luminance and the exposure the grade applies (one 1x1 read-back)
  read(renderer) {
    if (!this.rd) { this.rd = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false }); this.m5 = new THREE.ShaderMaterial({ uniforms: { tA: { value: null } }, vertexShader: V, depthTest: false, depthWrite: false, fragmentShader: 'uniform sampler2D tA; void main(){ float L = texture2D(tA, vec2(.5)).r; gl_FragColor = vec4(clamp((L + 16.) / 24., 0., 1.), fract((L + 16.) / 24. * 255.), 0., 1.); }' }); }
    this.m5.uniforms.tA.value = this.uniforms.tExp.value; this.q.material = this.m5; const prev = renderer.getRenderTarget(); renderer.setRenderTarget(this.rd); this.q.render(renderer); const px = new Uint8Array(4); renderer.readRenderTargetPixels(this.rd, 0, 0, 1, 1, px); renderer.setRenderTarget(prev);
    const L = (px[0] / 255) * 24 - 16; const U = this.uniforms; const ev = Math.min(Math.max((U.uKey.value - L) * U.uAlpha.value, U.uEvLo.value), U.uEvHi.value) + U.uEvBias.value;
    return { log2L: +L.toFixed(2), ev: +ev.toFixed(2), exposure: +Math.pow(2, ev).toFixed(3) };
  }
}
// GLSL for the grade pass (declare the uniforms above in it)
export const EXPOSURE_GLSL = `uniform sampler2D tExp; uniform float uKey, uAlpha, uEvLo, uEvHi, uEvBias;
float autoExposure(){ float L = texture2D(tExp, vec2(.5)).r; return exp2(clamp((uKey - L) * uAlpha, uEvLo, uEvHi) + uEvBias); }`;

// Tone curve. Until build 24 none ran: r170's OutputPass has no CustomToneMapping branch and the scene renders into
// HDR targets, so the frame only got the sRGB transfer and everything above 1.0 (sky, sun, white walls in the sun, a
// muzzle flash) clipped flat. The curve now runs at the end of the grade pass (toneLook, in linear, before the sRGB
// transfer). It is AgX's idea without AgX's sigmoid: the channels go through AgX's inset matrix (in Rec.2020) so a
// bright saturated colour drifts toward white instead of skewing hue (an orange flash goes yellow-white, not pure
// yellow), a per-channel shoulder compresses them, and the exact inverse of the inset brings them back. Measured
// against the clipped build-23 frames, AgX's fixed log sigmoid cannot keep the mid-tones: matched at mid-grey it
// crushes the toe (1 % grey 25 -> 14 of 255) and starts its shoulder so low that a sunlit wall at 0.7 drops from 218
// to 189, which is the flat, washed look plain AgX had. This shoulder is the identity below about 0.25 (shadows and
// mid-tones as before) and rolls off above: x / (1 + (x/white)^knee)^(1/knee), so 1.0 lands near 222/255, 2.0 at 245
// and the sun's 8+ still has a gradient instead of a white plateau.
//   exp: gain before the curve (the renderer's toneMappingExposure multiplies it); knee: shoulder sharpness (higher
//   holds the upper mid-tones longer but compresses the top harder); white: asymptote; sat: saturation after the curve.
export const TONE = Object.assign({ exp: 1, knee: 2.2, white: 1, sat: 1 }, globalThis.TONE_LOOK || {});
const glslM = m => 'mat3(' + m.elements.map(v => v.toFixed(7)).join(',') + ')';
// AgX inset (column-major, as in three's tonemapping chunk) after linear sRGB -> Rec.2020, and its exact inverse
const _toIns = new THREE.Matrix3().fromArray([0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859])
  .multiply(new THREE.Matrix3().fromArray([.6274, .0691, .0164, .3293, .9195, .0880, .0433, .0113, .8956]));
const _fromIns = _toIns.clone().invert();
// uTone: 1 while the renderer is on CustomToneMapping (the game's curve); G.debug.tone('ACESFilmicToneMapping') turns
// it off and the OutputPass applies three's built-in curve instead
export const TONE_U = {
  uTone: { get value() { return G.renderer && G.renderer.toneMapping === THREE.CustomToneMapping ? 1 : 0; } },
  uToneExp: { get value() { return TONE.exp * (G.renderer ? G.renderer.toneMappingExposure : 1); } },
  uToneKnee: { get value() { return TONE.knee; } }, uToneWhite: { get value() { return TONE.white; } }, uToneSat: { get value() { return TONE.sat; } },
};
export const TONE_GLSL = `uniform float uTone, uToneExp, uToneKnee, uToneWhite, uToneSat;
vec3 toneLook(vec3 c){ c = max(${glslM(_toIns)} * (c * uToneExp), 0.);
  c = c / pow(1. + pow(c / uToneWhite, vec3(uToneKnee)), vec3(1. / uToneKnee));
  c = max(${glslM(_fromIns)} * c, 0.); float l = dot(c, vec3(.2126, .7152, .0722)); return clamp(l + uToneSat * (c - l), 0., 1.); }
vec3 toneOut(vec3 c){ return uTone > .5 ? toneLook(c) : c; }`;
// Anything three renders straight to the screen with tone mapping on gets the same shoulder (with the TONE values at
// load); the game itself draws through the composer, where only the grade's toneLook applies it.
export function installToneMapping(renderer) {
  const src = THREE.ShaderChunk.tonemapping_pars_fragment, stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (src.includes(stub)) THREE.ShaderChunk.tonemapping_pars_fragment = src.replace(stub, `vec3 CustomToneMapping( vec3 color ) { color = max( ${glslM(_toIns)} * ( color * toneMappingExposure * ${TONE.exp.toFixed(4)} ), 0. ); color = color / pow( 1. + pow( color / ${TONE.white.toFixed(4)}, vec3( ${TONE.knee.toFixed(4)} ) ), vec3( ${(1 / TONE.knee).toFixed(5)} ) ); return clamp( max( ${glslM(_fromIns)} * color, 0. ), 0., 1. ); }`);
  else console.warn('tone: CustomToneMapping stub not found');
  renderer.toneMapping = THREE.CustomToneMapping;
}

// Film look for the grade pass (linear HDR, after exposure; toneLook follows at the end of the grade). Most of what makes a
// frame read as a camera capture rather than a render is what the lens and the film/sensor do to the light:
//  - veiling glare: a little of the frame's mean light scatters over the whole image inside the glass, so shadows never
//    sit at pure black and a bright street lifts the shade in it;
//  - contrast: a slight log-space slope around mid-grey, on luminance only (hue and saturation stay put);
//  - colour: film dyes and a camera's colour matrix roll off saturated colours (a painted awning, a deep blue sky) far
//    more than skin, plaster and earth; shadows lean cool (lit by the sky) and highlights warm (lit by the sun);
//  - lens: lateral chromatic aberration grows with the field angle (the centre stays clean), the corners fall off;
//  - grain: multiplicative, so after the log tone curve it sits evenly from shadows to highlights, as film grain does.
// Grain and aberration cost nothing worth gating on a desktop GPU, but on phones they are noise on a small screen:
// off on low, lighter on medium. Missions tune GRADE before the first frame.
export const GRADE = Object.assign({ con: 1.05, sat: 1, roll: .18, veil: .035, ca: 1, grain: 1, vig: .3, cool: [.95, .99, 1.06], warm: [1.05, 1, .92] }, globalThis.GRADE_LOOK || {});
export const GRADE_U = {
  uGrain: { get value() { return GRADE.grain * [0, .6, 1][G.quality] || 0; } }, uCA: { get value() { return G.quality > 0 ? GRADE.ca : 0; } },
  uCon: { get value() { return GRADE.con; } }, uVig: { get value() { return GRADE.vig; } }, uSatG: { get value() { return GRADE.sat; } }, uRoll: { get value() { return GRADE.roll; } }, uVeil: { get value() { return GRADE.veil; } },
  uCool: { get value() { return _cool.fromArray(GRADE.cool); } }, uWarm: { get value() { return _warm.fromArray(GRADE.warm); } },
};
const _cool = new THREE.Vector3(), _warm = new THREE.Vector3();
// needs EXPOSURE_GLSL (tExp) and SUN_GLSL (uSunAsp, the frame aspect) declared before it
export const GRADE_GLSL = `uniform float uGrain, uCA, uCon, uVig, uSatG, uRoll, uVeil; uniform vec3 uCool, uWarm;
float gHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 lensFetch(sampler2D t, vec2 uv, float extra){ vec2 d = uv - .5; float k = uCA * .0062 * dot(d, d) + extra;
  if (k < 1e-5) return texture2D(t, uv).rgb;
  return vec3(texture2D(t, uv + d * k).r, texture2D(t, uv).g, texture2D(t, uv - d * k).b); }
vec3 filmGrade(vec3 c, float ex){
  c += uVeil * exp2(texture2D(tExp, vec2(.5)).r) * ex * vec3(1., .96, .9);
  float l = dot(c, vec3(.2126, .7152, .0722)), lc = .18 * pow(max(l, 1e-6) / .18, uCon); c *= lc / max(l, 1e-6); l = lc;
  vec3 ch = c - l; float s = length(ch) / max(l, 1e-4);
  c = max(l + ch * uSatG / (1. + s * uRoll), 0.);
  return c * mix(uCool, uWarm, smoothstep(-3., 3., log2(max(l, 1e-5) / .18))); }
vec3 filmFinish(vec3 c, vec2 uv, float extraVig, float t){
  vec2 d = (uv - .5) * vec2(uSunAsp, 1.); float r2 = dot(d, d) / (.25 * (uSunAsp * uSunAsp + 1.));
  c *= max(1. - uVig * pow(r2, 1.25) - extraVig * dot(uv - .5, uv - .5), 0.);
  if (uGrain > 0.) { float n = gHash(gl_FragCoord.xy + fract(t * 7.13) * 419.); c *= 1. + (n - .5) * uGrain * .1; }
  return c; }`;
