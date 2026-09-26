// Sound for the border: a synthesized protest crowd (chanting voices through vowel formants over a murmur),
// coughing in the gas, the gas launcher, canister hiss, the gas drone, jets, firecrackers, the Arabic loudspeaker.
import * as THREE from 'three';
import { G, rr, R, clamp, pick, bus } from '../core.js';
import { FSFX, FVO } from './vo.js';

const VOW = { a: [760, 1250, 2500], u: [380, 870, 2300], i: [330, 2000, 2800], o: [500, 900, 2400], e: [520, 1700, 2500] };
// chants as syllable vowels + relative lengths ("al-la-hu ak-bar", "bir-ruh bid-dam", "yah-ya fi-las-teen")
const CHANTS = [[['a', 1], ['a', 1], ['u', 1.4], ['a', 1], ['a', 2]], [['i', 1], ['u', 1.6], ['i', 1], ['a', 2]], [['a', 1], ['a', 1.4], ['i', 1], ['a', 1], ['i', 2]]];

export class FenceSound {
  constructor() { this.level = 0; this.target = 0; this.coughT = 0; this.drones = new Map(); this.fires = []; }
  get c() { return G.audio.ctx; }
  start() {
    if (this.started) return; this.started = true; const A = G.audio, c = this.c;
    A.startAmbience(); // keeps the high "zanana" drone buzz; the town beds are silenced below
    A.soundscape = dt => this.scape(dt);
    for (const k of ['market', 'trade', 'traffic', 'sea']) A.bedGain(k, 0, .1); A.bedGain('wind', .32, 1);
    A.startMusic(); A.setIntensity(.12);
    this.buildCrowd();
  }
  // ---------- crowd ----------
  buildCrowd() {
    const c = this.c, A = G.audio;
    this.out = c.createGain(); this.out.gain.value = 0;
    const pan = c.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 90; pan.rolloffFactor = .9; pan.maxDistance = 5000; this.pan = pan;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; this.lp = lp;
    this.out.connect(lp); lp.connect(pan); pan.connect(A.amb); const rs = c.createGain(); rs.gain.value = .35; pan.connect(rs); rs.connect(A.revSend);
    // murmur: three noise bands with slow random swells
    const nb = A.noise(4); this.mur = [];
    for (const [f, q, v] of [[420, .8, .5], [1050, 1.1, .38], [2300, 1.4, .16]]) { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = rr(.9, 1.1); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const g = c.createGain(); g.gain.value = v; s.connect(bp); bp.connect(g); g.connect(this.out); s.start(0, R() * 3); this.mur.push({ g, v }); }
    // chanting voices: many detuned, vibrato'd buzzes through two moving formants
    this.chantG = c.createGain(); this.chantG.gain.value = 0;
    this.f1 = c.createBiquadFilter(); this.f1.type = 'bandpass'; this.f1.Q.value = 5; this.f1.frequency.value = 700;
    this.f2 = c.createBiquadFilter(); this.f2.type = 'bandpass'; this.f2.Q.value = 7; this.f2.frequency.value = 1200;
    const mix = c.createGain(); mix.gain.value = 1; mix.connect(this.f1); mix.connect(this.f2); const g1 = c.createGain(); g1.gain.value = 1.4; const g2 = c.createGain(); g2.gain.value = .8; this.f1.connect(g1); this.f2.connect(g2); g1.connect(this.chantG); g2.connect(this.chantG); this.chantG.connect(this.out);
    for (let i = 0; i < 22; i++) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = R() < .85 ? rr(105, 175) : rr(190, 260); const v = c.createOscillator(); v.frequency.value = rr(4, 6.5); const vg = c.createGain(); vg.gain.value = rr(1.5, 4); v.connect(vg); vg.connect(o.frequency); const og = c.createGain(); og.gain.value = rr(.02, .045); o.connect(og); og.connect(mix); o.start(); v.start(); }
    // breath noise in the chant
    const bn = c.createBufferSource(); bn.buffer = nb; bn.loop = true; const bng = c.createGain(); bng.gain.value = .25; bn.connect(bng); bng.connect(mix); bn.start();
    this.chantT = 3; this.murT = 0;
  }
  setCrowd(l) { this.target = l; }
  chantPhrase() {
    const c = this.c, t0 = c.currentTime + .05; const ch = pick(CHANTS); const beat = rr(.26, .34); let t = t0; const reps = 2 + Math.floor(R() * 3); const amp = .9 * (.5 + this.level);
    for (let r = 0; r < reps; r++) { for (const [v, len] of ch) { const [F1, F2] = VOW[v]; const d = beat * len; this.f1.frequency.setTargetAtTime(F1, t, .03); this.f2.frequency.setTargetAtTime(F2, t, .03);
      this.chantG.gain.setTargetAtTime(amp, t, .025); this.chantG.gain.setTargetAtTime(amp * .35, t + d * .7, .04); t += d; } this.chantG.gain.setTargetAtTime(.02, t, .08); t += beat * 1.2; }
    this.chantG.gain.setTargetAtTime(0, t, .2); return t - t0;
  }
  // ---------- one-shots ----------
  fsfx(key, { pos = null, vol = 1, rate = 1, ref = 6, roll = 1, rev = .3 } = {}) {
    const k = FSFX[key] ? key : (() => { const b = Object.keys(FSFX).filter(x => x.startsWith(key + '_')); return b.length ? pick(b) : null; })(); if (!k) return null; const buf = G.assets.snd.fsfx; if (!buf) return null;
    const c = this.c, A = G.audio, m = FSFX[k]; const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; const g = c.createGain(); g.gain.value = vol; s.connect(g); let out = g;
    if (pos) { const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 4000; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; g.connect(p); out = p; s._panner = p; }
    out.connect(A.sfx); if (rev) { const r = c.createGain(); r.gain.value = rev; out.connect(r); r.connect(A.revSend); }
    s.start(c.currentTime, m.o, m.d); return s;
  }
  cough(pos, player = false) { this.fsfx('cough', { pos: player ? null : pos, vol: player ? .55 : .9, rate: rr(.92, 1.1), ref: 5 }); }
  thump(pos, near = false) { const c = this.c, t = c.currentTime, A = G.audio; const o = c.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(40, t + .18); const g = c.createGain(); g.gain.setValueAtTime(near ? .9 : .5, t); g.gain.exponentialRampToValueAtTime(.001, t + .25); o.connect(g);
    const n = c.createBufferSource(); n.buffer = A._thn || (A._thn = A.noise(.2)); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; const ng = c.createGain(); ng.gain.setValueAtTime(near ? .6 : .35, t); ng.gain.exponentialRampToValueAtTime(.001, t + .12); n.connect(bp); bp.connect(ng);
    let dest = A.sfx; if (!near && pos) { const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 8; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; p.connect(A.sfx); dest = p; } g.connect(dest); ng.connect(dest); o.start(t); o.stop(t + .3); n.start(t); A.playS('dry', { pos, vol: .5, rate: .8 }); }
  hiss(pos) { const c = this.c, t = c.currentTime, A = G.audio; const n = c.createBufferSource(); n.buffer = A._hsn || (A._hsn = A.noise(3)); n.loop = true; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.22, t + .15); g.gain.exponentialRampToValueAtTime(.001, t + 7);
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 4; p.rolloffFactor = 1.3; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; n.connect(hp); hp.connect(g); g.connect(p); p.connect(A.sfx); n.start(t); n.stop(t + 7.2); }
  droneLoop(g) { const c = this.c, A = G.audio; const out = c.createGain(); out.gain.value = .0; const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 10; p.rolloffFactor = 1; out.connect(p); p.connect(A.sfx); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = .7; bp.connect(out);
    const osc = [190, 381, 572, 760].map((f, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * rr(.99, 1.01); const og = c.createGain(); og.gain.value = [.5, .3, .18, .1][i]; o.connect(og); og.connect(bp); o.start(); return o; });
    out.gain.setTargetAtTime(.45, c.currentTime, .3); this.drones.set(g, { out, p, osc }); }
  droneStop(g) { const d = this.drones.get(g); if (!d) return; const t = this.c.currentTime; d.out.gain.setTargetAtTime(0, t, .2); for (const o of d.osc) o.stop(t + 1); this.drones.delete(g); }
  fireAt(pos) { const s = G.audio.playS('fire', { pos, vol: 1.4, loop: true, ref: 12, rev: .2 }); if (s) { this.fires.push(s); setTimeout(() => { try { s.stop(); } catch (e) {} }, 60000); } }
  jet() { const c = this.c; const s = this.fsfx('jet', { pos: G.camera.position.clone().add(new THREE.Vector3(300, 400, 0)), vol: 1.6, ref: 120, roll: .6, rev: .5 }); if (s && s._panner) { const p = s._panner; const t = c.currentTime; p.positionX.setValueAtTime(900, t); p.positionX.linearRampToValueAtTime(-1500, t + 5); } }
  // the Arabic warning from the loudspeaker on the humvee by the patrol road: megaphone band, slap-back echo
  loudspeaker() {
    const A = G.audio, c = this.c; const v = FVO.spk_ar; const buf = G.assets.snd.vo; if (!v || !buf) return;
    const s = c.createBufferSource(); s.buffer = buf; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400; const sh = c.createWaveShaper(); const cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 3.2); } sh.curve = cv;
    const g = c.createGain(); g.gain.value = 1.8; const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 25; p.rolloffFactor = .8; const at = G.spkPos || new THREE.Vector3(8, 3, 24); p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z;
    const dl = c.createDelay(1); dl.delayTime.value = .38; const dg = c.createGain(); dg.gain.value = .35; s.connect(hp); hp.connect(sh); sh.connect(lp); lp.connect(g); g.connect(p); p.connect(A.sfx); g.connect(dl); dl.connect(dg); dg.connect(p); const r = c.createGain(); r.gain.value = .5; p.connect(r); r.connect(A.revSend);
    s.start(c.currentTime + .2, v.off, v.dur); bus.emit('sub', { speaker: { name: 'רמקול · כריזה בערבית', color: '#f2b84b' }, text: v.text, radio: false }); setTimeout(() => bus.emit('sub', null), (v.dur + .4) * 1000);
  }
  // ---------- ambience ----------
  scape(dt) {
    const A = G.audio; this.level += (this.target - this.level) * Math.min(1, dt * .4);
    if (!this.out) return; const t = this.c.currentTime;
    // crowd centroid (weighted to the nearest people) for the panner
    this.cT = (this.cT || 0) - dt; if (this.cT <= 0 && G.crowd) { this.cT = .5; let sx = 0, sz = 0, sw = 0; const p = A.listener.pos; for (const a of G.crowd.agents) { if (!a.alive) continue; const d = Math.hypot(a.x - p.x, a.z - p.z); const w = 1 / (1 + d * .02); sx += a.x * w; sz += a.z * w; sw += w; }
      if (sw > 0) { this.pan.positionX.setTargetAtTime(sx / sw, t, .5); this.pan.positionY.value = 3; this.pan.positionZ.setTargetAtTime(sz / sw, t, .5); } this.lp.frequency.setTargetAtTime(G.inside ? 900 : 3200, t, .5); }
    this.out.gain.setTargetAtTime(this.level * 1.8, t, .5);
    this.murT -= dt; if (this.murT <= 0) { this.murT = rr(.25, .6); for (const m of this.mur) m.g.gain.setTargetAtTime(m.v * rr(.6, 1.4) * (.6 + this.level * .6), t, .25); }
    this.chantT -= dt; if (this.chantT <= 0) { const d = R() < .15 + this.level * .7 ? this.chantPhrase() : 0; this.chantT = d + rr(2, 7) * (1.4 - this.level); }
    const ev = (k, rate, f) => { this['_' + k] = (this['_' + k] ?? rr(0, 1 / rate)) - dt; if (this['_' + k] <= 0) { this['_' + k] = rr(.5, 1.5) / rate; f(); } };
    // coughing chorus where people are in the gas
    if (G.crowd && G.crowd.gasClouds.length) { this.coughT -= dt; if (this.coughT <= 0) { const inGas = G.crowd.agents.filter(a => a.alive && (a.state === 'cough' || a.gas > .3)); this.coughT = inGas.length ? rr(.12, .5) * 30 / (inGas.length + 10) : 1; if (inGas.length) { const a = pick(inGas); this.cough(new THREE.Vector3(a.x, a.y + 1.5, a.z)); } } }
    if (this.level > .5 && G.state === 'play') ev('pop', .05 * this.level, () => { const a = G.crowd && pick(G.crowd.agents.filter(x => x.alive && x.x > -80)); if (a) this.fsfx('pop', { pos: new THREE.Vector3(a.x, 2, a.z), vol: .9, ref: 25, roll: .7, rev: .5 }); });
    if (this.level > .3) ev('whistle', .15 * this.level, () => this.whistle());
    ev('crows', 1 / 60, () => A.playS('crows', { pos: A.listener.pos.clone().add(new THREE.Vector3(rr(-80, 80), 25, rr(-80, 80))), vol: .35, ref: 12 }));
    ev('dogs', 1 / 45, () => A.playS('dog', { pos: new THREE.Vector3(rr(-900, -600), 5, rr(-300, 300)), vol: 1.2, ref: 60, roll: .5, rev: .5 }));
    for (const [g, d] of this.drones) { d.p.positionX.value = g.position.x; d.p.positionY.value = g.position.y; d.p.positionZ.value = g.position.z; }
  }
  whistle() { const c = this.c, t = c.currentTime; const o = c.createOscillator(); o.type = 'sine'; const f0 = rr(1800, 2600); o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * rr(1.05, 1.25), t + .25); o.frequency.linearRampToValueAtTime(f0 * .9, t + .5); const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.045 * this.level, t + .05); g.gain.setValueAtTime(.045 * this.level, t + .4); g.gain.linearRampToValueAtTime(0, t + .55); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + .6); }
  update(dt) { }
}
