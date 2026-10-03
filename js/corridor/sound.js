// Sound for the corridor: the murmur and shuffle of thousands walking (no chanting: these are families on the move),
// a child crying now and then, cart wheels, the Arabic loudspeaker (no recorded voice in this mission: a chime, a
// megaphone-band babble and the Hebrew translation as a subtitle), radio traffic as subtitles, drones and jets.
import * as THREE from 'three';
import { G, rr, R, pick, bus } from '../core.js';
import { FSFX } from '../fence/vo.js';

export class CorridorSound {
  constructor() { this.level = 0; this.target = 0; this.drones = new Map(); this.subT = null; }
  get c() { return G.audio.ctx; }
  start() {
    if (this.started) return; this.started = true; const A = G.audio;
    A.startAmbience(); A.soundscape = dt => this.scape(dt);
    for (const k of ['market', 'trade', 'traffic', 'sea']) A.bedGain(k, 0, .1); A.bedGain('wind', .3, 1);
    A.startMusic(); A.setIntensity(.1);
    this.buildCrowd();
  }
  buildCrowd() {
    const c = this.c, A = G.audio;
    this.out = c.createGain(); this.out.gain.value = 0;
    const pan = c.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 60; pan.rolloffFactor = .9; pan.maxDistance = 5000; this.pan = pan;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.out.connect(lp); lp.connect(pan); pan.connect(A.amb); const rs = c.createGain(); rs.gain.value = .3; pan.connect(rs); rs.connect(A.revSend);
    // murmur: voice-band noise with slow swells; shuffle: high, gritty noise for feet and bundles dragged on asphalt
    const nb = A.noise(4); this.mur = [];
    for (const [f, q, v] of [[380, .9, .45], [900, 1.2, .32], [1900, 1.5, .12], [5200, .7, .08]]) { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = rr(.9, 1.1); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const g = c.createGain(); g.gain.value = v; s.connect(bp); bp.connect(g); g.connect(this.out); s.start(0, R() * 3); this.mur.push({ g, v }); }
    // a few talking voices: buzzes through moving formants, never in unison (scattered conversation, not a chant)
    this.voices = [];
    for (let i = 0; i < 6; i++) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = R() < .5 ? rr(100, 150) : rr(190, 250); const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.value = 600; const g = c.createGain(); g.gain.value = 0; o.connect(f1); f1.connect(g); g.connect(this.out); o.start(); this.voices.push({ o, f1, g, t: rr(0, 2) }); }
    this.murT = 0;
  }
  setCrowd(l) { this.target = l; }
  fsfx(key, { pos = null, vol = 1, rate = 1, ref = 6, roll = 1, rev = .3 } = {}) {
    const k = FSFX[key] ? key : (() => { const b = Object.keys(FSFX).filter(x => x.startsWith(key + '_')); return b.length ? pick(b) : null; })(); if (!k) return null; const buf = G.assets.snd.fsfx || G.assets.snd.vo; if (!buf) return null;
    const c = this.c, A = G.audio, m = FSFX[k]; const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; const g = c.createGain(); g.gain.value = vol; s.connect(g); let out = g;
    if (pos) { const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 4000; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; g.connect(p); out = p; s._panner = p; }
    out.connect(A.sfx); if (rev) { const r = c.createGain(); r.gain.value = rev; out.connect(r); r.connect(A.revSend); }
    s.start(c.currentTime, m.o, m.d); return s;
  }
  jet() { const c = this.c; const s = this.fsfx('jet', { pos: G.camera.position.clone().add(new THREE.Vector3(300, 400, 0)), vol: 1.4, ref: 120, roll: .6, rev: .5 }); if (s && s._panner) { const p = s._panner; const t = c.currentTime; p.positionX.setValueAtTime(-1200, t); p.positionX.linearRampToValueAtTime(1500, t + 5); } }
  // radio traffic and announcements are subtitles (this mission has no recorded voice); the squelch sells the radio
  radio(who, text, color = '#9ac0e6', sec = 5.5, radio = true) {
    if (radio && G.audio.squelch) G.audio.squelch();
    bus.emit('sub', { speaker: { name: who, color }, text, radio }); clearTimeout(this.subT); this.subT = setTimeout(() => bus.emit('sub', null), sec * 1000);
  }
  // the loudspeaker on the Humvee: two-tone chime, then a megaphone-band babble with a slap-back echo off the buildings
  loudspeaker(text) {
    const c = this.c, A = G.audio, t0 = c.currentTime + .05, at = G.spkPos || new THREE.Vector3(9, 3, -12);
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 25; p.rolloffFactor = .8; p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; p.connect(A.sfx);
    const dl = c.createDelay(1); dl.delayTime.value = .32; const dg = c.createGain(); dg.gain.value = .3; dl.connect(dg); dg.connect(p); const r = c.createGain(); r.gain.value = .45; p.connect(r); r.connect(A.revSend);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 520; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; const sh = c.createWaveShaper(); const cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 3); } sh.curve = cv;
    const bus2 = c.createGain(); bus2.gain.value = 1.4; bus2.connect(hp); hp.connect(sh); sh.connect(lp); lp.connect(p); lp.connect(dl);
    [[660, 0], [880, .28]].forEach(([f, d]) => { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(.35, t0 + d + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + d + .5); o.connect(g); g.connect(bus2); o.start(t0 + d); o.stop(t0 + d + .6); });
    // syllables: a voiced buzz through a formant that jumps per syllable, gated in words and phrases
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 128; const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4; const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 6; const g = c.createGain(); g.gain.value = 0; o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(bus2);
    let t = t0 + 1; const VOW = [[760, 1250], [380, 870], [330, 2000], [500, 900], [520, 1700]];
    for (let w = 0; w < 14; w++) { const syl = 2 + Math.floor(R() * 3); for (let s = 0; s < syl; s++) { const [a, b] = pick(VOW), d = rr(.11, .19); f1.frequency.setValueAtTime(a, t); f2.frequency.setValueAtTime(b, t); o.frequency.setValueAtTime(rr(118, 140), t); g.gain.setTargetAtTime(.9, t, .015); g.gain.setTargetAtTime(.15, t + d * .75, .02); t += d; } g.gain.setTargetAtTime(0, t, .03); t += w % 5 === 4 ? .45 : .09; }
    o.start(t0 + 1); o.stop(t + .2);
    this.radio('רמקול · כריזה בערבית', text, '#f2b84b', Math.max(5, t - t0), false);
  }
  droneLoop(g, vol = .3) { const c = this.c, A = G.audio; const out = c.createGain(); out.gain.value = 0; const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 30; p.rolloffFactor = 1; out.connect(p); p.connect(A.sfx); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = .7; bp.connect(out);
    const osc = [96, 192, 290].map((f, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * rr(.99, 1.01); const og = c.createGain(); og.gain.value = [.5, .3, .15][i]; o.connect(og); og.connect(bp); o.start(); return o; });
    out.gain.setTargetAtTime(vol, c.currentTime, .5); this.drones.set(g, { out, p, osc }); }
  droneStop(g) { const d = this.drones.get(g); if (!d) return; const t = this.c.currentTime; d.out.gain.setTargetAtTime(0, t, .3); for (const o of d.osc) o.stop(t + 1.5); this.drones.delete(g); }
  // a child crying somewhere in the column: a thin, wavering, falling tone
  cry() {
    const a = G.crowd && pick(G.crowd.agents.filter(x => x.alive && x.kid)); if (!a) return; const c = this.c, A = G.audio, t = c.currentTime;
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 8; p.positionX.value = a.x; p.positionY.value = 1; p.positionZ.value = a.z; p.connect(A.sfx);
    const o = c.createOscillator(); o.type = 'sawtooth'; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 3; const g = c.createGain(); g.gain.value = 0; o.connect(f); f.connect(g); g.connect(p);
    let tt = t; for (let i = 0; i < 3; i++) { const d = rr(.5, .9); o.frequency.setValueAtTime(rr(480, 560), tt); o.frequency.linearRampToValueAtTime(rr(330, 390), tt + d); g.gain.setTargetAtTime(.12, tt, .03); g.gain.setTargetAtTime(0, tt + d - .1, .05); tt += d + rr(.25, .5); }
    o.start(t); o.stop(tt + .2);
  }
  scape(dt) {
    const A = G.audio; this.level += (this.target - this.level) * Math.min(1, dt * .4);
    if (!this.out) return; const t = this.c.currentTime;
    this.cT = (this.cT || 0) - dt; if (this.cT <= 0 && G.crowd) { this.cT = .5; let sx = 0, sz = 0, sw = 0; const p = A.listener.pos; for (const a of G.crowd.agents) { if (!a.alive) continue; const d = Math.hypot(a.x - p.x, a.z - p.z); const w = 1 / (1 + d * .03); sx += a.x * w; sz += a.z * w; sw += w; }
      if (sw > 0) { this.pan.positionX.setTargetAtTime(sx / sw, t, .5); this.pan.positionY.value = 2; this.pan.positionZ.setTargetAtTime(sz / sw, t, .5); } }
    this.out.gain.setTargetAtTime(this.level * 1.6, t, .5);
    this.murT -= dt; if (this.murT <= 0) { this.murT = rr(.25, .6); for (const m of this.mur) m.g.gain.setTargetAtTime(m.v * rr(.6, 1.4) * (.6 + this.level * .6), t, .25); }
    for (const v of this.voices) { v.t -= dt; if (v.t <= 0) { const talk = R() < .5; v.t = rr(.12, .35); v.f1.frequency.setTargetAtTime(rr(350, 1900), t, .03); v.g.gain.setTargetAtTime(talk ? .05 * this.level : 0, t, .04); } }
    const ev = (k, rate, f) => { this['_' + k] = (this['_' + k] ?? rr(0, 1 / rate)) - dt; if (this['_' + k] <= 0) { this['_' + k] = rr(.5, 1.5) / rate; f(); } };
    if (G.state === 'play') ev('cry', 1 / 28, () => this.cry());
    ev('crows', 1 / 60, () => A.playS('crows', { pos: A.listener.pos.clone().add(new THREE.Vector3(rr(-80, 80), 25, rr(-80, 80))), vol: .3, ref: 12 }));
    // distant thuds of the war outside the corridor, far to the north
    ev('boom', 1 / 50, () => A.explosion && A.explosion(new THREE.Vector3(rr(-900, 900), 10, rr(-2600, -1800)), .5));
    for (const [g, d] of this.drones) { d.p.positionX.value = g.position.x; d.p.positionY.value = g.position.y; d.p.positionZ.value = g.position.z; }
  }
  update(dt) { }
}
