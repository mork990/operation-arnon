// Sun on screen: glare, light shafts and lens ghosts, all from the frame itself (no read-back). three's Lensflare
// copies the framebuffer around the sun to test occlusion, which fails on a multisampled target (GL_INVALID_OPERATION)
// and drew a black disc where the sun should blaze. Here the bright sky around the sun is masked at quarter resolution
// and blurred radially toward the sun (GPU Gems 3, ch. 13); smoke columns, walls and people in front of the sun cut
// dark wedges out of the shafts. The grade pass adds the result before exposure.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { G } from './core.js';

const V = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';

export class SunFx extends Pass {
  constructor(opts = {}) {
    super(); this.needsSwap = false;
    const o = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
    this.a = new THREE.WebGLRenderTarget(4, 4, o); this.b = new THREE.WebGLRenderTarget(4, 4, o);
    this.strength = opts.strength ?? 1; this.color = new THREE.Color(opts.color || '#ffd9a8');
    // the mask keeps the sun and the hottest sky beside it; from .9 up the whole aureole went in and the shafts doubled it
    // into a flat disc
    this.mMask = new THREE.ShaderMaterial({ uniforms: { tD: { value: null }, uSun: { value: new THREE.Vector2() }, uAsp: { value: 1 }, uTh: { value: new THREE.Vector2(1.3, 4.5) } }, vertexShader: V, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tD; uniform vec2 uSun, uTh; uniform float uAsp; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tD, vUv).rgb; float l = dot(c, vec3(.2126, .7152, .0722));
          vec2 d = (vUv - uSun) * vec2(uAsp, 1.); float near = exp(-dot(d, d) * 5.);
          gl_FragColor = vec4(c * smoothstep(uTh.x, uTh.y, l) * near, 1.); }` });
    this.mBlur = new THREE.ShaderMaterial({ uniforms: { tD: { value: this.a.texture }, uSun: { value: new THREE.Vector2() } }, vertexShader: V, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tD; uniform vec2 uSun; varying vec2 vUv;
        void main(){ vec2 st = (uSun - vUv) / 44. * .85; vec2 p = vUv; float w = 1., wsum = 0.; vec3 s = vec3(0.);
          for (int i = 0; i < 44; i++) { s += texture2D(tD, p).rgb * w; wsum += w; w *= .955; p += st; }
          gl_FragColor = vec4(s / wsum, 1.); }` });
    this.q = new FullScreenQuad(null);
    // read by the grade pass
    this.uniforms = { tSun: { value: this.b.texture }, uSunUv: { value: new THREE.Vector2(-9, -9) }, uSunI: { value: 0 }, uSunCol: { value: new THREE.Vector3(1, .85, .66) }, uSunAsp: { value: 1 } };
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3();
  }
  setSize(w, h) { const qw = Math.max(4, Math.round(w / 4)), qh = Math.max(4, Math.round(h / 4)); this.a.setSize(qw, qh); this.b.setSize(qw, qh); this.uniforms.uSunAsp.value = w / h; this.mMask.uniforms.uAsp.value = w / h; }
  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera || G.camera; const U = this.uniforms;
    cam.getWorldDirection(this._f); const facing = this._f.dot(G.sunDir);
    // only when the sun is somewhere ahead: shafts reach in from just off-screen too
    if (!this.enabled || facing < .35 || G.inside) { U.uSunI.value = 0; return; }
    const p = this._v.copy(cam.position).addScaledVector(G.sunDir, 1000).project(cam); const uv = new THREE.Vector2(p.x * .5 + .5, p.y * .5 + .5);
    U.uSunUv.value.copy(uv); U.uSunI.value = this.strength * THREE.MathUtils.smoothstep(facing, .35, .75);
    U.uSunCol.value.set(this.color.r, this.color.g, this.color.b);
    const q = this.q;
    this.mMask.uniforms.tD.value = readBuffer.texture; this.mMask.uniforms.uSun.value.copy(uv); q.material = this.mMask; renderer.setRenderTarget(this.a); q.render(renderer);
    this.mBlur.uniforms.uSun.value.copy(uv); q.material = this.mBlur; renderer.setRenderTarget(this.b); q.render(renderer);
  }
}
// GLSL for the grade: shafts plus a glare halo and three ghosts along the line through the centre, all scaled by how
// much of the sun is actually unobstructed (the blurred mask sampled at the sun)
export const SUN_GLSL = `uniform sampler2D tSun; uniform vec2 uSunUv; uniform float uSunI, uSunAsp; uniform vec3 uSunCol;
// dust and smudges on the lens: invisible until the sun is in front of it, then they catch the light
float lensDirt(vec2 uv) { vec2 p = uv * vec2(uSunAsp, 1.) * 7.; float d = 0.;
  for (int i = 0; i < 3; i++) { vec2 c = floor(p), f = fract(p) - .5; float hh = fract(sin(dot(c, vec2(12.9898, 78.233)) + float(i) * 3.7) * 43758.5453);
    vec2 o = vec2(fract(hh * 13.1), fract(hh * 7.7)) - .5; d += smoothstep(.2 + hh * .1, 0., length(f - o * .5)) * step(.86, hh) * (.3 + hh); p = p * 1.93 + 11.3; }
  return d; }
vec3 sunFx(vec2 uv){ if (uSunI <= 0.) return vec3(0.);
  vec3 sh = texture2D(tSun, uv).rgb; float vis = clamp(dot(texture2D(tSun, clamp(uSunUv, .001, .999)).rgb, vec3(.33)) * .6, 0., 1.);
  vec2 d = (uv - uSunUv) * vec2(uSunAsp, 1.); float r = length(d);
  // a tight core and a faint wide veil: the broad .5 halo stacked on the sky's own aureole and bloom read as a white blob
  vec3 glare = uSunCol * (exp(-r * 16.) * .3 + exp(-r * 4.) * .06) * vis;
  vec3 gh = vec3(0.); for (int i = 1; i <= 3; i++) { float k = float(i) * .42; vec2 gp = uSunUv + (vec2(.5) - uSunUv) * (1. + k); vec2 e = (uv - gp) * vec2(uSunAsp, 1.);
    gh += vec3(.55, .7, 1.) * smoothstep(.07 + k * .03, .0, length(e)) * .04 / float(i); }
  vec3 dirt = uSunCol * lensDirt(uv) * exp(-r * 3.2) * vis * .07;
  return (sh * 1.1 + glare + gh * vis + dirt) * uSunI; }`;

// Heat shimmer: over sun-baked ground the air near the horizon wavers. Distant pixels (by the scene depth) in a band
// around the horizon are displaced by slow rising noise; drawn before the first-person weapon so it never ripples.
// It draws into a target of its own and copies back: the scene's depth texture is attached to one of the composer's
// buffers, and writing into that buffer while sampling its depth is a feedback loop the driver rejects.
export class HeatHaze extends Pass {
  constructor(strength = 1) {
    super(); this.strength = strength; this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tD: { value: this.rt.texture } }, vertexShader: V, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tD; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tD, vUv); }' }));
    this.uniforms = { tD: { value: null }, tDepth: { value: null }, uT: { value: 0 }, uNear: { value: .05 }, uFar: { value: 6000 }, uHY: { value: .5 }, uStr: { value: strength } };
    this.q = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: V,
      fragmentShader: `uniform sampler2D tD, tDepth; uniform float uT, uNear, uFar, uHY, uStr; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.), f.x), f.y); }
        void main(){ float z = texture2D(tDepth, vUv).r * 2. - 1.; float dep = 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
          float band = 1. - smoothstep(.015, .11, abs(vUv.y - uHY + .02));
          float k = smoothstep(35., 190., dep) * band * uStr;
          vec2 o = vec2(n(vUv * vec2(26., 64.) + vec2(0., uT * 1.6)), n(vUv * vec2(31., 70.) + vec2(4.2, uT * 1.3))) - .5;
          gl_FragColor = texture2D(tD, vUv + o * vec2(.0009, .0017) * k); }` }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const U = this.uniforms, cam = G.camera; U.tD.value = readBuffer.texture; U.tDepth.value = G.sceneDepth || null; U.uT.value = G.time; U.uNear.value = cam.near; U.uFar.value = cam.far;
    // screen height of the horizon from the camera's pitch
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ'); U.uHY.value = .5 - .5 * Math.tan(e.x) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    renderer.setRenderTarget(this.rt); this.q.render(renderer);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer); this.copy.render(renderer);
  }
  setSize(w, h) { this.rt.setSize(w, h); }
}
