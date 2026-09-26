// Audio: samples + synthesized ambience, positional sound, reverb, radio voice (speech synthesis) and dynamic music
import * as THREE from 'three';
import { G, clamp, rr, R, pick, bus, sstep } from './core.js';
import { VO, SPEAKERS } from './vo.js';
import { SFX, AMB } from './sprites.js';

export class Audio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = .9;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = .003; this.comp.release.value = .25;
    this.deafen = c.createBiquadFilter(); this.deafen.type = 'lowpass'; this.deafen.frequency.value = 20000;
    this.master.connect(this.deafen); this.deafen.connect(this.comp); this.comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = .8; this.amb.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = .0; this.music.connect(this.master);
    this.radio = c.createGain(); this.radio.gain.value = .9; this.radio.connect(this.master);
    // reverbs: indoor (short, dense) and outdoor (long, sparse slap)
    this.revIn = c.createConvolver(); this.revIn.buffer = this.ir(.45, 3.5, .9);
    this.revOut = c.createConvolver(); this.revOut.buffer = this.ir(1.8, 2.2, .35, .06);
    this.revInG = c.createGain(); this.revOutG = c.createGain(); this.revInG.gain.value = 0; this.revOutG.gain.value = 1;
    this.revSend = c.createGain(); this.revSend.gain.value = 1;
    this.revSend.connect(this.revIn); this.revSend.connect(this.revOut); this.revIn.connect(this.revInG); this.revOut.connect(this.revOutG); this.revInG.connect(this.master); this.revOutG.connect(this.master);
    this.listener = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
    this.voices = []; this.heVoice = null; this.voiceQueue = []; this.speaking = false;
    this.intensity = 0; this.musicOn = false;
    this.loops = {};
  }
  ir(dur, decay, density = 1, pre = 0) {
    const c = this.ctx, n = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) { const t = i / c.sampleRate; if (t < pre) { d[i] = 0; continue; } d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (t - pre) / (dur - pre), decay) * (Math.random() < density ? 1 : 0) * .6; } }
    return b;
  }
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }
  setInside(inside) { const t = this.ctx.currentTime; this.revInG.gain.setTargetAtTime(inside ? .55 : 0, t, .3); this.revOutG.gain.setTargetAtTime(inside ? .08 : .45, t, .3); if (this.bedLP) this.bedLP.frequency.setTargetAtTime(inside ? 700 : 20000, t, .4); if (this.loops.drone) this.loops.drone.g.gain.setTargetAtTime(inside ? .005 : .014, t, .5); }
  updateListener(cam) {
    const l = this.ctx.listener; const p = cam.position; const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.listener.pos.copy(p);
    if (l.positionX) { const t = this.ctx.currentTime; l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t); l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t); l.upX.setValueAtTime(u.x, t); l.upY.setValueAtTime(u.y, t); l.upZ.setValueAtTime(u.z, t); }
    else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
  // play a sample; pos = world position for 3D; returns source
  play(name, { pos = null, vol = 1, rate = 1, rev = .3, lp = 0, loop = false, dest = null, delay = 0, detune = 0 } = {}) {
    const buf = G.assets.snd[name]; if (!buf) return null;
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = buf; s.loop = loop; s.playbackRate.value = rate; if (detune) s.detune.value = detune;
    const g = c.createGain(); g.gain.value = vol; let node = s;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    node.connect(g);
    let out = g;
    if (pos) { const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 2000; p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z); g.connect(p); out = p; s._panner = p; }
    out.connect(dest || this.sfx);
    if (rev > 0) { const rs = c.createGain(); rs.gain.value = rev; out.connect(rs); rs.connect(this.revSend); }
    s.start(c.currentTime + delay); s._gain = g;
    return s;
  }
  // play a clip from the sfx/ambience sprites (key may be a prefix: 'm4' picks m4_0..m4_n at random)
  pick(key) { if (SFX[key] || AMB[key]) return key; const bank = this._banks || (this._banks = {}); if (!bank[key]) bank[key] = [...Object.keys(SFX), ...Object.keys(AMB)].filter(k => k.startsWith(key + '_')); const b = bank[key]; return b.length ? b[Math.floor(R() * b.length)] : null; }
  playS(key, { pos = null, vol = 1, rate = 1, rev = .3, lp = 0, hp = 0, loop = false, dest = null, delay = 0, ref = 3, roll = 1.1, offset = 0 } = {}) {
    const k = this.pick(key); if (!k) return null; const inSfx = !!SFX[k]; const meta = inSfx ? SFX[k] : AMB[k]; const buf = inSfx ? G.assets.snd.sfx : G.assets.snd.amb; if (!buf) return null;
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = vol; let node = s;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    node.connect(g); let out = g;
    if (pos) { const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 3000; p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z); g.connect(p); out = p; s._panner = p; }
    out.connect(dest || this.sfx);
    if (rev > 0) { const rs = c.createGain(); rs.gain.value = rev; out.connect(rs); rs.connect(this.revSend); }
    const t0 = c.currentTime + delay;
    if (loop) { s.loop = true; s.loopStart = meta.o; s.loopEnd = meta.o + meta.d; s.start(t0, meta.o + (offset % meta.d)); }
    else { s.start(t0, meta.o, meta.d); }
    s._gain = g; s._dur = meta.d / rate; return s;
  }
  noise(dur) { const c = this.ctx; const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  // ---------- weapons ----------
  shotPlayer(inside) {
    this.playS('m4', { vol: inside ? 1.05 : 1.0, rate: rr(.97, 1.03), rev: inside ? .75 : .35 });
    const c = this.ctx, t = c.currentTime; const o = c.createOscillator(); const g = c.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + .1); g.gain.setValueAtTime(inside ? .45 : .3, t); g.gain.exponentialRampToValueAtTime(.001, t + .14); o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + .18);
    this.playS('shell', { vol: .22, rate: rr(.9, 1.15), rev: .1, delay: rr(.32, .5) });
  }
  mech() { this.playS('dry', { vol: .7, rev: .1 }); }
  shotAt(pos, kind = 'ak') {
    const d = pos.distanceTo(this.listener.pos); const ak = kind === 'ak';
    const key = d < 35 ? (ak ? 'ak' : 'm4mid') : d < 130 ? (ak ? 'akmid' : 'm4mid') : (ak ? 'akfar' : 'm4far');
    const lp = clamp(20000 - d * 60, 2200, 20000);
    this.playS(key, { pos, vol: (ak ? 1.2 : 1.0) * (d < 35 ? 1 : 1.6), rate: rr(.96, 1.04), lp, rev: G.inside ? .7 : .45, delay: Math.min(.5, d / 343), ref: 6, roll: .9 });
  }
  crack(pos) { this.playS(R() < .7 ? 'whizz' : 'ric', { pos, vol: .7, rate: rr(.85, 1.2), rev: .05, ref: 1.5 }); }
  impact(pos, surface = 'concrete') {
    const d = pos.distanceTo(this.listener.pos); if (d > 60) return;
    const key = surface === 'flesh' ? 'hit_flesh' : surface === 'metal' ? 'hit_metal' : surface === 'sand' || surface === 'mud' ? 'hit_ground' : 'hit_conc';
    this.playS(key, { pos, vol: surface === 'flesh' ? .9 : .6, rate: rr(.9, 1.15), rev: .15, ref: 2 });
    if (surface === 'concrete' && R() < .12) this.playS('ric', { pos, vol: .35, rate: rr(.9, 1.2), rev: .2, ref: 3 });
  }
  explosion(pos, big = 1) {
    const d = pos.distanceTo(this.listener.pos); const delay = Math.min(1.5, d / 343);
    this.playS(d < 150 ? 'expl' : 'expl_far', { pos, vol: 1.5 * big, rate: rr(.88, 1.02), rev: .8, lp: clamp(18000 - d * 30, 900, 18000), delay, ref: 8, roll: .8 });
    if (d < 60) this.playS(R() < .5 ? 'debris' : 'debris2', { pos, vol: .6 * big, rev: .3, delay: delay + .25, ref: 5 });
    const c = this.ctx, t = c.currentTime + delay; const o = c.createOscillator(); const g = c.createGain(); o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(24, t + .9); g.gain.setValueAtTime(Math.min(.9, 40 / (d + 10)) * big, t); g.gain.exponentialRampToValueAtTime(.001, t + 1.2); o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 1.3);
    if (d < 12) this.tinnitus(1.5 * big);
  }
  flashbang(pos) { this.playS('bang', { pos, vol: 1.6, rev: .9, ref: 6 }); }
  voice(pos, kind) { this.playS(kind, { pos, vol: .8, rate: rr(.92, 1.08), rev: .3, ref: 3 }); }
  tinnitus(sec) {
    const c = this.ctx, t = c.currentTime; const o = c.createOscillator(); o.frequency.value = 3400 + rr(-200, 200); const g = c.createGain(); g.gain.setValueAtTime(.08, t); g.gain.exponentialRampToValueAtTime(.0005, t + sec * 2.5); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + sec * 2.6);
    this.deafen.frequency.cancelScheduledValues(t); this.deafen.frequency.setValueAtTime(600, t); this.deafen.frequency.exponentialRampToValueAtTime(20000, t + sec * 2.2);
  }
  gunMech(kind) { this.playS(kind, { vol: .8, rev: .12 }); if (kind === 'mag_out') this.playS('cloth', { vol: .5, delay: .25 }); }
  reload() { this.gunMech('mag_out'); }
  step(surface, vol = .35, pos = null) { const k = surface === 'sand' ? 'step_sand' : surface === 'mud' ? 'step_grav' : 'step_conc'; this.playS(k, { vol: vol * 1.3, rate: rr(.9, 1.1), rev: .15, pos, ref: 2 }); if (R() < .3) this.playS('gear', { vol: vol * .35, rate: rr(.9, 1.1), rev: 0 }); }
  heartbeat(on) { this._hb = on; if (on && !this._br) { this._br = this.playS('breath', { vol: .45, loop: true, rev: 0 }); } else if (!on && this._br) { try { this._br.stop(); } catch (e) {} this._br = null; } }
  // ---------- ambience ----------
  startAmbience() {
    const c = this.ctx; if (this.beds) return;
    // surveillance drone high overhead ("zanana"): steady buzzing whine
    { const g = c.createGain(); g.gain.value = .014; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 1.2;
      [118, 236.5, 355, 472].forEach((fr, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const og = c.createGain(); og.gain.value = [1, .55, .3, .15][i];
        const l = c.createOscillator(); l.frequency.value = .05 + i * .011; const lg = c.createGain(); lg.gain.value = fr * .01; l.connect(lg); lg.connect(o.frequency); l.start(); o.connect(og); og.connect(f); o.start(); });
      const trem = c.createOscillator(); trem.frequency.value = .04; const tg = c.createGain(); tg.gain.value = .006; trem.connect(tg); tg.connect(g.gain); trem.start();
      f.connect(g); g.connect(this.amb); this.loops.drone = { g }; }
    // looping beds from the ambience sprite, each through a shared "inside" low-pass
    this.bedLP = c.createBiquadFilter(); this.bedLP.type = 'lowpass'; this.bedLP.frequency.value = 20000; this.bedLP.connect(this.amb);
    this.beds = {};
    for (const [k, v] of [['market', 0], ['trade', 0], ['traffic', .12], ['wind', .1], ['sea', 0]]) {
      const src = this.playS(k, { vol: v, loop: true, rev: 0, dest: this.bedLP, offset: R() * 20 }); if (src) this.beds[k] = src;
    }
    this.crowdLevel = this.crowdLevel ?? .4; this.movers = []; this.emit = []; this.evT = {};
  }
  setCrowd(level) { this.crowdLevel = level; }
  bedGain(k, v, tc = .8) { const b = this.beds && this.beds[k]; if (b) b._gain.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }
  soundscape(dt) {
    if (!this.beds) return;
    const p = this.listener.pos; const calm = (G.panic || 0) < .5; const cl = this.crowdLevel ?? .4;
    const nearMarket = (1 - sstep(7, 40, Math.abs(p.z))) * (p.x > -300 && p.x < 260 ? 1 : 0);
    const nearSea = 1 - sstep(10, 140, p.x - (-382));
    const ins = G.inside ? .35 : 1;
    this.bedGain('market', (.06 + .5 * nearMarket) * cl * ins);
    this.bedGain('trade', .35 * nearMarket * cl * (calm ? 1 : .2) * ins);
    this.bedGain('traffic', (.1 + .12 * nearMarket) * (calm ? 1 : .5) * ins);
    this.bedGain('wind', (.08 + .25 * nearSea + (p.y > 8 ? .1 : 0)) * ins);
    this.bedGain('sea', .7 * nearSea * ins);
    // random one-shots around the listener
    const ev = (key, rate, f) => { this.evT[key] = (this.evT[key] ?? rr(0, 1 / rate)) - dt; if (this.evT[key] <= 0) { this.evT[key] = rr(.5, 1.5) / rate; f(); } };
    const around = (dmin, dmax, y = 1.5) => { const a = R() * 6.283, d = rr(dmin, dmax); return new THREE.Vector3(p.x + Math.cos(a) * d, y, p.z + Math.sin(a) * d); };
    const inTown = p.x > -290;
    if (inTown && calm) ev('rooster', 1 / 22, () => this.playS('rooster', { pos: around(30, 110, rr(8, 16)), vol: .9, rev: .3, ref: 12 }));
    if (inTown) ev('dog', calm ? 1 / 28 : 1 / 9, () => this.playS('dog', { pos: around(25, 90), vol: .8, rev: .3, ref: 10 }));
    if (inTown && cl > .25) ev('horn', 1 / 7, () => this.playS('horn', { pos: new THREE.Vector3(p.x + rr(-70, 70), 1.2, rr(-4, 4)), vol: .6, rev: .35, ref: 10, rate: rr(.95, 1.05) }));
    if (inTown && cl > .25 && nearMarket > .3) ev('horns_busy', 1 / 40, () => this.playS('horns_busy', { pos: new THREE.Vector3(p.x + rr(-120, 120), 1.2, 0), vol: .5, rev: .4, ref: 20 }));
    if (inTown && calm) ev('kids', 1 / 35, () => this.playS('kids', { pos: around(20, 60), vol: .5, rev: .3, ref: 6 }));
    if (inTown && calm) ev('donkey', 1 / 70, () => this.playS('donkey', { pos: around(20, 70), vol: .6, rev: .3, ref: 8, rate: rr(.8, .95) }));
    if (inTown && calm) ev('hen', 1 / 45, () => this.playS('hen', { pos: around(15, 60, 6), vol: .5, rev: .3, ref: 6 }));
    if (inTown) ev('crows', 1 / 55, () => this.playS('crows', { pos: around(40, 120, 20), vol: .4, rev: .4, ref: 12 }));
    if (nearSea > .2) ev('gulls', 1 / 7, () => this.playS('gulls', { pos: around(20, 80, 12), vol: .6 * nearSea, rev: .2, ref: 12 }));
    // moped passing along the market street
    if (inTown && calm && cl > .3 && nearMarket > .4) ev('moped', 1 / 25, () => { const dir = R() < .5 ? 1 : -1; const from = new THREE.Vector3(p.x - dir * 80, 1, rr(-2.5, 2.5)); const src = this.playS('moped', { pos: from, vol: 1.2, rev: .3, ref: 6, rate: rr(.9, 1.1) }); if (src) this.movers.push({ src, from, v: new THREE.Vector3(dir * rr(9, 13), 0, 0), t: 0, dur: src._dur }); });
    for (let i = this.movers.length - 1; i >= 0; i--) { const m = this.movers[i]; m.t += dt; const q = m.from.clone().addScaledVector(m.v, m.t); const pn = m.src._panner; if (pn && pn.positionX) { pn.positionX.value = q.x; pn.positionY.value = q.y; pn.positionZ.value = q.z; } if (m.t > m.dur) this.movers.splice(i, 1); }
    // positional loops placed by the world (generators, AC units, idling motorbikes): only the ones nearby play
    for (const e of G.soundEmitters || []) {
      const d = e.pos.distanceTo(p);
      if (!e.src && d < 38) { e.src = this.playS(e.key, { pos: e.pos, vol: e.vol, loop: true, rev: .15, ref: e.ref || 2.5, roll: 1.4, dest: this.bedLP, offset: R() * 10, rate: e.rate || 1 }); }
      else if (e.src && d > 46) { try { e.src.stop(); } catch (er) {} e.src = null; }
    }
  }
  distantBattle(level) { this.battle = level; }
  loop(name, key, { vol = 1, pos = null, rate = 1 } = {}) { if (this.loops[key]) return this.loops[key]; const s = this.play(name, { vol, pos, rate, loop: true, rev: .2 }); if (s) this.loops[key] = { s, g: s._gain, p: s._panner }; return this.loops[key]; }
  stopLoop(key, fade = .5) { const l = this.loops[key]; if (!l) return; const t = this.ctx.currentTime; l.g.gain.setTargetAtTime(0, t, fade / 3); l.s.stop(t + fade + .1); delete this.loops[key]; }
  setLoopPos(key, pos) { const l = this.loops[key]; if (l && l.p) { if (l.p.positionX) { l.p.positionX.value = pos.x; l.p.positionY.value = pos.y; l.p.positionZ.value = pos.z; } else l.p.setPosition(pos.x, pos.y, pos.z); } }
  // ---------- music: tension drone with pulse, intensity 0..1 ----------
  startMusic() {
    if (this.musicOn) return; this.musicOn = true; const c = this.ctx;
    const pad = c.createGain(); pad.gain.value = .0; pad.connect(this.music);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.connect(pad);
    [36.71, 55.0, 73.42, 43.65].forEach((fr, i) => { const o = c.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = fr; o.detune.value = rr(-8, 8); const g = c.createGain(); g.gain.value = i === 3 ? .05 : .12; o.connect(g); g.connect(f); o.start(); });
    this.pad = pad; this.padF = f;
    this.pulseT = 0;
    this.music.gain.setTargetAtTime(G.settings.music ? .35 : 0, c.currentTime, 2);
  }
  pulse() { // low pulse for tension, rate follows intensity
    const c = this.ctx, t = c.currentTime; const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(40, t + .3); const g = c.createGain(); g.gain.setValueAtTime(.35 * (.3 + this.intensity), t); g.gain.exponentialRampToValueAtTime(.001, t + .4); o.connect(g); g.connect(this.music); o.start(t); o.stop(t + .45);
    if (this.intensity > .6) { const h = c.createBufferSource(); h.buffer = this._hh || (this._hh = this.noise(.05)); const hf = c.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 7000; const hg = c.createGain(); hg.gain.setValueAtTime(.08, t + .25); hg.gain.exponentialRampToValueAtTime(.001, t + .3); h.connect(hf); hf.connect(hg); hg.connect(this.music); h.start(t + .25); }
  }
  setIntensity(v) { this.intensity = clamp(v, 0, 1); if (this.pad) { const t = this.ctx.currentTime; this.pad.gain.setTargetAtTime(.25 + this.intensity * .4, t, 1.5); this.padF.frequency.setTargetAtTime(400 + this.intensity * 1600, t, 1.5); } }
  update(dt) {
    if (this.musicOn) { this.pulseT -= dt; if (this.pulseT <= 0 && this.intensity > .05) { this.pulse(); this.pulseT = this.intensity > .6 ? .43 : this.intensity > .3 ? .86 : 1.72; } }
    this.soundscape(dt);
    if (this.battle > 0 && R() < dt * this.battle * 1.5) { // distant gunfire bursts / booms
      const a = R() * 6.28, d = rr(250, 900); const p = this.listener.pos.clone().add(new THREE.Vector3(Math.cos(a) * d, 20, Math.sin(a) * d));
      if (R() < .15) this.explosion(p, .7); else this.playS('battle', { pos: p, vol: 2.5, rate: rr(.9, 1.05), lp: 2400, rev: .6, ref: 60, roll: .6 });
    }
    if (this._hb) { this._hbT = (this._hbT || 0) - dt; if (this._hbT <= 0) { this._hbT = .75; const c = this.ctx, t = c.currentTime; for (const [dl, v] of [[0, .5], [.16, .35]]) { const o = c.createOscillator(); o.frequency.setValueAtTime(60, t + dl); o.frequency.exponentialRampToValueAtTime(35, t + dl + .12); const g = c.createGain(); g.gain.setValueAtTime(v, t + dl); g.gain.exponentialRampToValueAtTime(.001, t + dl + .15); o.connect(g); g.connect(this.master); o.start(t + dl); o.stop(t + dl + .2); } } }
  }
  // ---------- radio voice ----------
  pickVoice() {
    if (!('speechSynthesis' in window)) return; const vs = speechSynthesis.getVoices(); this.voices = vs;
    const he = vs.filter(v => /^he|^iw/i.test(v.lang));
    this.heVoice = he.find(v => /natural|online|google/i.test(v.name)) || he[0] || null;
  }
  unlockSpeech() { if (!('speechSynthesis' in window)) return; try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} }
  squelch(open = true) { const c = this.ctx, t = c.currentTime; const s = c.createBufferSource(); s.buffer = this._sq || (this._sq = this.noise(.12)); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = .9; const g = c.createGain(); g.gain.setValueAtTime(.22, t); g.gain.exponentialRampToValueAtTime(.001, t + (open ? .09 : .14)); s.connect(f); f.connect(g); g.connect(this.radio); s.start(t); if (!open) { const o = c.createOscillator(); o.frequency.value = 1200; const og = c.createGain(); og.gain.setValueAtTime(.05, t); og.gain.exponentialRampToValueAtTime(.001, t + .06); o.connect(og); og.connect(this.radio); o.start(t); o.stop(t + .07); } }
  // recorded (pre-synthesized) voice lines: say(id) or say(id, {onend})
  say(id, opts = {}) {
    if (typeof id !== 'string') { const o = opts; id = o && o.id; if (!id) return; }
    this.voiceQueue.push({ id, onend: opts.onend, ttl: opts.ttl, at: performance.now() }); if (!this.speaking) this.nextLine();
  }
  nextLine() {
    const it = this.voiceQueue.shift(); if (!it) { this.speaking = false; bus.emit('sub', null); return; }
    if (it.ttl && performance.now() - it.at > it.ttl) { if (it.onend) it.onend(); this.nextLine(); return; } // stale (only lines that ask for it)
    const meta = VO[it.id]; if (!meta) { this.nextLine(); return; }
    const sp = SPEAKERS[meta.sp]; this.speaking = true; bus.emit('sub', { speaker: sp, text: meta.text, radio: sp.radio });
    if (sp.radio) this.squelch(true);
    const buf = G.assets.snd.vo; let dur = meta.dur;
    if (buf && G.settings.voice) {
      const s = this.ctx.createBufferSource(); s.buffer = buf; const g = this.ctx.createGain(); g.gain.value = sp.radio ? 1.1 : 1.25; s.connect(g); g.connect(this.radio);
      if (!sp.radio) { const r = this.ctx.createGain(); r.gain.value = .12; g.connect(r); r.connect(this.revSend); }
      s.start(0, meta.off, meta.dur); this._cur = s;
      // duck ambience and music under speech
      const t = this.ctx.currentTime; this.amb.gain.setTargetAtTime(.45, t, .1); this.music.gain.setTargetAtTime(G.settings.music ? .18 : 0, t, .1);
    }
    if (sp.radio) this._radioBed(dur);
    clearTimeout(this._vt);
    this._vt = setTimeout(() => {
      const t = this.ctx.currentTime; this.amb.gain.setTargetAtTime(.8, t, .4); this.music.gain.setTargetAtTime(G.settings.music ? .35 : 0, t, .6);
      if (sp.radio) this.squelch(false); if (it.onend) it.onend(); setTimeout(() => this.nextLine(), 220);
    }, dur * 1000 + 60);
  }
  _radioBed(sec) { const s = this.play('radio_static_doty21_cc0', { vol: .05, rev: 0, dest: this.radio }); if (s) s.stop(this.ctx.currentTime + sec); }
  clearVoice() { this.voiceQueue.length = 0; clearTimeout(this._vt); try { this._cur && this._cur.stop(); } catch (e) {} this._cur = null; this.speaking = false; bus.emit('sub', null); }
}
