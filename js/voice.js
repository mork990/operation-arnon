// Spoken radio and loudspeaker lines for missions without a recorded voice bank (missions 3 and 4).
// API (stable):
//   speak(text, { who = 'radio' | 'cmd' | 'spk' | 'team' | 'hq' | <any call-sign>, lang = 'he' | 'ar', interrupt = false, radio, alt })
//     -> Promise that resolves when the line is done, skipped or cut off (never rejects)
//   voiceReady() -> boolean, stopVoice()
// Why the browser's own speech (Web Speech API) and not pre-rendered files: the BlueTTS models are not on this machine,
// the free Hebrew neural voices we could find are non-commercial (MMS) or not natural enough, and the lines still change
// every round. Every target platform ships a Hebrew voice: iOS "Carmit", Android Google TTS (he/iw), Windows "Asaf"
// (and Edge's online "Avri"/"Hila"). The speech cannot be routed through Web Audio, so the radio colour comes from a
// squelch click before and after the line, and the ambience ducks under it.
// Arabic: the loudspeaker lines are usually written in Hebrew (the subtitle). The voice follows the script of the text:
// Arabic letters need an Arabic voice; without one the Hebrew `alt` text is spoken instead, or the line stays silent.
import { G } from './core.js';

const SS = typeof window !== 'undefined' && window.speechSynthesis && window.SpeechSynthesisUtterance ? window.speechSynthesis : null;
// per-speaker colour: one Hebrew voice is the common case, so pitch and rate are what tell the callers apart
const PROF = {
  cmd: { pitch: .86, rate: 1.04, vol: 1, radio: false, male: true },
  team: { pitch: 1.06, rate: 1.12, vol: .95, radio: false, male: true },
  radio: { pitch: .96, rate: 1.1, vol: .95, radio: true, male: true },
  hq: { pitch: .78, rate: 1.0, vol: .95, radio: true, male: true },
  spk: { pitch: .92, rate: .9, vol: 1, radio: false, male: true }
};
const MALE = /avri|asaf|male|גבר|maged|naayf|hamed|shakir|tarik|omar/i, FEMALE = /hila|carmit|female|hoda|zariyah|laila|salma|mariam/i;
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
// unknown call-signs (the missions pass names like 'אוגדה' or 'מחסום') get a stable radio voice of their own
const prof = who => PROF[who] || (who && /^(he|ar)$/.test(who) ? PROF.radio : who ? { pitch: .8 + hash(String(who)) * .32, rate: 1.0 + hash(who + '#') * .16, vol: .95, radio: true, male: true } : PROF.radio);

let voices = [], stalls = 0, primed = false, cur = null, queue = [], pausedByUs = false, duck = 0;
const langOf = v => String(v.lang || '').toLowerCase().replace('_', '-');
const isLang = (v, l) => { const x = langOf(v); return l === 'he' ? x.startsWith('he') || x.startsWith('iw') : x.startsWith(l); };
// natural/online voices first (Edge, Android network), then enhanced/premium (iOS), then the platform default
const score = v => (/natural|neural/i.test(v.name) ? 6 : 0) + (/online/i.test(v.name) ? 3 : 0) + (/enhanced|premium|siri/i.test(v.name) ? 2 : 0) + (/-(il|sa|eg)$/.test(langOf(v)) ? 1 : 0) + (v.default ? .5 : 0);
function loadVoices() { if (!SS) return; try { voices = SS.getVoices() || []; } catch (e) { voices = []; } if (voices.length) stalls = 0; }
/** The best voice for a language, preferring a male timbre when there is a choice (all callers are soldiers). */
function voiceFor(lang, male = true, salt = 0) {
  const vs = voices.filter(v => isLang(v, lang)).sort((a, b) => score(b) - score(a)); if (!vs.length) return null;
  const top = score(vs[0]), best = vs.filter(v => score(v) >= top - 1), want = best.filter(v => male ? !FEMALE.test(v.name) : !MALE.test(v.name)); const pool = want.length ? want : best;
  return pool[Math.min(pool.length - 1, salt % Math.min(2, pool.length))];
}
const enabled = () => { const s = G.settings || {}; return (s.tts ?? s.voice) !== false; };
const hasArabic = t => /[؀-ۿ]/.test(t), hasHebrew = t => /[֐-׿]/.test(t);
// the subtitle style (· separators, call-sign dashes, quotes) reads as pauses and noise when spoken
const clean = t => String(t || '').replace(/[«»"“”]/g, '').replace(/\s*[·•|]\s*/g, ', ').replace(/\s+[-–—]\s+/g, ', ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim();

function audioCtx() { const A = G.audio; return A && A.ctx && A.ctx.state === 'running' ? A : null; }
/** Radio key-up/key-down: the engine's squelch when it has one, otherwise a short band-passed noise click. */
function click(open) {
  const A = audioCtx(); if (!A) return;
  try {
    if (A.squelch) return A.squelch(open);
    const c = A.ctx, t = c.currentTime, n = Math.floor(c.sampleRate * .1), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = .9; const g = c.createGain(); g.gain.setValueAtTime(.18, t); g.gain.exponentialRampToValueAtTime(.001, t + (open ? .08 : .13)); s.connect(f); f.connect(g); g.connect(A.master || c.destination); s.start(t);
  } catch (e) {}
}
/** Dips the ambience and music under speech so the browser voice (which bypasses Web Audio) stays intelligible. */
function setDuck(on) {
  const A = audioCtx(); if (!A || !A.amb || (on ? duck : !duck)) return; duck = on ? 1 : 0;
  try { const t = A.ctx.currentTime; A.amb.gain.setTargetAtTime(on ? .45 : .8, t, on ? .1 : .4); if (A.music) A.music.gain.setTargetAtTime(G.settings.music ? (on ? .18 : .35) : 0, t, on ? .1 : .6); } catch (e) {}
}

function finish(job) { if (!job || job.done) return; job.done = true; clearTimeout(job.tmo); if (job.radio && job.started) click(false); if (cur === job) cur = null; job.resolve(); setTimeout(next, job.radio ? 160 : 60); }
function next() {
  if (cur) return; const job = queue.shift(); if (!job) { setDuck(false); return; }
  if (!SS || !enabled()) { job.resolve(); return next(); }
  cur = job; setDuck(true);
  const u = new SpeechSynthesisUtterance(job.text); u.lang = job.lang === 'ar' ? (job.voice ? job.voice.lang : 'ar-SA') : (job.voice ? job.voice.lang : 'he-IL');
  if (job.voice) u.voice = job.voice; u.pitch = job.p.pitch; u.rate = job.p.rate; u.volume = job.p.vol;
  job.u = u;
  u.onstart = () => { job.started = true; stalls = 0; clearTimeout(job.tmo); job.tmo = setTimeout(() => { try { SS.cancel(); } catch (e) {} finish(job); }, (2500 + job.text.length * 110 / job.p.rate)); };
  u.onend = () => finish(job); u.onerror = () => finish(job);
  const go = () => { if (job.done) return; try { SS.resume(); SS.speak(u); } catch (e) { return finish(job); } job.tmo = setTimeout(() => { if (!job.started) { stalls++; try { SS.cancel(); } catch (e) {} finish(job); } }, 3000); };
  // key the radio first: the click lands just before the voice, like a real handset
  if (job.radio) { click(true); setTimeout(go, 140); } else go();
}

/** Speaks one line in the voice of `who`; queued behind earlier lines unless `interrupt`. Never throws. */
export function speak(text, opts = {}) {
  return new Promise(resolve => {
    try {
      const { who = 'radio', lang = 'he', interrupt = false } = opts; let t = clean(text);
      if (!SS || !enabled() || !t) return resolve();
      if (!voices.length) loadVoices();
      const p = prof(who); let l = hasArabic(t) ? 'ar' : hasHebrew(t) ? 'he' : lang;
      let v = voiceFor(l, p.male, Math.floor(hash(String(who)) * 4));
      if (!v && l === 'ar') { const alt = clean(opts.alt); if (alt) { t = alt; l = 'he'; v = voiceFor('he', p.male); } else return resolve(); }
      // no installed voice for the language: the browser may still speak with its default by `lang` (Android does);
      // if it can't, the start timeout skips the line, and after one such stall voiceless lines are skipped at once so
      // the queue never lags behind the subtitles
      if (!v && stalls > 0) return resolve();
      const job = { text: t, lang: l, voice: v, p, radio: opts.radio ?? p.radio, resolve };
      if (interrupt) { const q = queue; queue = []; q.forEach(j => j.resolve()); if (cur) { const c = cur; c.done = true; clearTimeout(c.tmo); cur = null; try { SS.cancel(); } catch (e) {} c.resolve(); } }
      queue.push(job); if (!cur) interrupt ? setTimeout(next, 60) : next();
    } catch (e) { resolve(); }
  });
}
/** True when lines will actually be heard: speech exists, the setting is on and a Hebrew voice is installed. */
export function voiceReady() { if (!SS) return false; if (!voices.length) loadVoices(); return enabled() && voices.some(v => isLang(v, 'he')); }
/** Cuts the current line and drops everything queued (mission end, retry, menu). */
export function stopVoice() { const q = queue; queue = []; q.forEach(j => j.resolve()); if (cur) { const c = cur; c.done = true; clearTimeout(c.tmo); cur = null; try { SS.cancel(); } catch (e) {} c.resolve(); } setDuck(false); }
/** Which voices were picked (for the diagnostics line and tests). */
export function voiceInfo() { if (!voices.length) loadVoices(); const n = v => v ? `${v.name} (${v.lang})` : null; return { supported: !!SS, enabled: enabled(), he: n(voiceFor('he')), ar: n(voiceFor('ar')), count: voices.length, primed, queued: queue.length, speaking: !!cur }; }

if (SS && typeof addEventListener === 'function') {
  loadVoices(); try { SS.addEventListener ? SS.addEventListener('voiceschanged', loadVoices) : (SS.onvoiceschanged = loadVoices); } catch (e) {}
  // iOS Safari only lets speech start from a user gesture once; a silent utterance on the first tap unlocks it for the session
  const prime = () => { if (primed) return; primed = true; stalls = 0; try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'he-IL'; SS.speak(u); } catch (e) {} loadVoices(); for (const ev of ['pointerdown', 'touchend', 'keydown']) removeEventListener(ev, prime, true); };
  for (const ev of ['pointerdown', 'touchend', 'keydown']) addEventListener(ev, prime, { capture: true, passive: true });
  // speech is not on the Web Audio clock: hold it while the game is paused or the tab is hidden, and drop it if the
  // player turns voice off mid-line
  setInterval(() => {
    try {
      if (cur && !enabled()) return stopVoice();
      const hold = (typeof document !== 'undefined' && document.hidden) || G.state === 'paused';
      if (hold && cur && !pausedByUs) { pausedByUs = true; clearTimeout(cur.tmo); SS.pause(); }
      else if (!hold && pausedByUs) { pausedByUs = false; SS.resume(); if (cur) { const c = cur; c.tmo = setTimeout(() => { try { SS.cancel(); } catch (e) {} finish(c); }, 2500 + c.text.length * 110 / c.p.rate); } }
    } catch (e) {}
  }, 250);
}
