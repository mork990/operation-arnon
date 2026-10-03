// Render resolution. The scene renders at an internal pixel ratio (the quality level times a dynamic scale) and, when
// that is below the display's, a last pass resamples it to the canvas with a Catmull-Rom filter plus contrast-adaptive
// sharpening (the idea of AMD's FSR 1: upscale, then restore edge contrast), instead of the browser stretching a small
// canvas bilinearly. Dynamic resolution also checks that lowering the resolution actually bought frame time: on a
// phone that is limited by draw calls it does not, and then it gives the pixels back rather than blur for nothing.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export class UpscalePass extends Pass {
  constructor() {
    super();
    this.uniforms = { tDiffuse: { value: null }, uSrc: { value: new THREE.Vector2(1, 1) }, uSharp: { value: .5 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSrc; uniform float uSharp; varying vec2 vUv;
        vec3 cr(vec2 uv) { // 5-tap Catmull-Rom (the four corner taps dropped and the weights renormalised)
          vec2 sp = uv * uSrc, t1 = floor(sp - .5) + .5, f = sp - t1;
          vec2 w0 = f * (-.5 + f * (1. - .5 * f)), w1 = 1. + f * f * (-2.5 + 1.5 * f), w2 = f * (.5 + f * (2. - 1.5 * f)), w3 = f * f * (-.5 + .5 * f);
          vec2 w12 = w1 + w2, t12 = (t1 + w2 / w12) / uSrc, t0 = (t1 - 1.) / uSrc, t3 = (t1 + 2.) / uSrc;
          vec3 c = texture2D(tDiffuse, vec2(t12.x, t0.y)).rgb * w12.x * w0.y + texture2D(tDiffuse, vec2(t0.x, t12.y)).rgb * w0.x * w12.y + texture2D(tDiffuse, t12).rgb * w12.x * w12.y
                 + texture2D(tDiffuse, vec2(t3.x, t12.y)).rgb * w3.x * w12.y + texture2D(tDiffuse, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
          return c / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y); }
        void main() {
          vec3 c = max(cr(vUv), 0.); vec2 px = 1. / uSrc;
          // contrast-adaptive sharpening against the source neighbourhood: strong on soft edges, gentle where the
          // local contrast is already high (no halos around bright windows)
          vec3 n = texture2D(tDiffuse, vUv + vec2(0., px.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0., px.y)).rgb, e = texture2D(tDiffuse, vUv + vec2(px.x, 0.)).rgb, w = texture2D(tDiffuse, vUv - vec2(px.x, 0.)).rgb;
          vec3 mn = min(min(min(n, s), min(e, w)), c), mx = max(max(max(n, s), max(e, w)), c);
          vec3 amp = sqrt(clamp(min(mn, 1. - mx) / max(mx, 1e-3), 0., 1.));
          vec3 wt = -amp * mix(.08, .2, uSharp);
          gl_FragColor = vec4(clamp((c + (n + s + e + w) * wt) / (1. + 4. * wt), 0., 1.), 1.); }` });
    this.q = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture; this.uniforms.uSrc.value.set(readBuffer.width, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.q.render(renderer);
  }
}

/**
 * Dynamic resolution with a check that it helps. Call update(frameMs); it returns true when the scale changed.
 * key (phones): the scale the last session settled on is kept in localStorage and the next one starts there, so a slow
 * phone does not stutter through its first ten seconds of play stepping down again (it still climbs back when it can).
 */
export class DynRes {
  constructor(key = null) { this.scale = 1; this.ft = 16; this.t = 0; this.probe = null; this.hold = 0; this.key = key;
    if (key) try { const v = parseFloat(localStorage.getItem(key)); if (v >= .55 && v < 1) this.scale = Math.round(v * 20) / 20; } catch (e) {} }
  update(ms) {
    this.ft += (ms - this.ft) * .05; this.t += ms; if (this.t < 1500) return false; this.t = 0; this.hold = Math.max(0, this.hold - 1.5);
    const prev = this.scale;
    if (this.probe) { // did the last step down pay off? if not, the frame is bound elsewhere (draw calls, scripts)
      if (this.ft > this.probe.ft * .92) { this.scale = this.probe.from; this.hold = 25; }
      this.probe = null;
    } else if (this.ft > 27 && this.hold <= 0 && this.scale > .55) { this.probe = { from: this.scale, ft: this.ft }; this.scale = Math.max(.55, this.scale - .1); }
    else if (this.ft < 18 && this.scale < 1) this.scale = Math.min(1, this.scale + .05);
    if (this.key && !this.probe && this.saved !== this.scale) { this.saved = this.scale; try { localStorage.setItem(this.key, this.scale); } catch (e) {} }
    return prev !== this.scale;
  }
}
