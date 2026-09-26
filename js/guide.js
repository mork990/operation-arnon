// Player guidance: objective waypoint (with off-screen arrow), mission stage list, friendly/hostage tags, control hints
import * as THREE from 'three';
import { G, clamp } from './core.js';

const $ = id => document.getElementById(id);
export const STAGES = ['הגעה ליעד', 'עלייה לקומה השלישית', 'פריצה וטיהור הדירה', 'חילוץ החטופים', 'יציאה לרכב תחת אש', 'הגנה על הרכב התקוע', 'מעבר לנגמ״ש', 'פינוי במסוק'];
const HINTS = {
  look: ['הזז את העכבר כדי להסתכל סביב', 'גרור בצד ימין של המסך כדי להסתכל'],
  move: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> תנועה · <kbd>Shift</kbd> ריצה', 'אגודל שמאל: תנועה. דחיפה חזקה קדימה: ריצה'],
  stairs: ['עלה במדרגות. הסמן הכתום מראה כמה קומות נשארו', 'עלה במדרגות. הסמן הכתום מראה כמה קומות נשארו'],
  interact: ['החזק <kbd>E</kbd> כדי לבצע פעולה', 'החזק את כפתור "פעולה" כדי לבצע'],
  shoot: ['לחצן שמאלי: ירי · לחצן ימני: כוונת · <kbd>R</kbd>: טעינה', '"ירי" יורה, ואפשר לגרור עליו כדי לכוון. "כוונת" מדייקת'],
  civ: ['אל תירה בבלתי־מעורבים. חמושים מחזיקים נשק', 'אל תירה בבלתי־מעורבים. חמושים מחזיקים נשק'],
  cover: ['<kbd>C</kbd> כריעה מאחורי הרכב מקטינה את הסיכוי להיפגע', '"כריעה" מאחורי הרכב מקטינה את הסיכוי להיפגע'],
  escort: ['החטופים הולכים אחריך. אל תתרחק מהם', 'החטופים הולכים אחריך. אל תתרחק מהם'],
  vehicle: ['אפשר לירות מהרכב תוך כדי נסיעה', 'אפשר לירות מהרכב תוך כדי נסיעה'],
};

export class Guide {
  constructor(stages = STAGES) {
    this.stages = stages; this.target = null; this.label = ''; this.stage = -1; this.shown = new Set(); this.hintT = 0;
    this.wp = $('wp'); this.wpLbl = $('wplbl'); this.wpDist = $('wpdist'); this.arrow = $('wparrow');
    this.tags = []; const tg = $('tags'); for (let i = 0; i < 12; i++) { const e = document.createElement('div'); e.className = 'tag'; e.hidden = true; tg.appendChild(e); this.tags.push(e); }
    const sl = $('stages'); stages.forEach((s, i) => { const li = document.createElement('li'); li.textContent = s; sl.appendChild(li); });
  }
  setStage(i) { this.stage = i; [...$('stages').children].forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'cur' : ''; }); $('stagen').textContent = i >= this.stages.length ? 'המשימה הושלמה' : `שלב ${i + 1} מתוך ${this.stages.length}`; }
  // target: Vector3 | () => Vector3 | null ; kind: 'go' | 'use' | 'defend'
  setTarget(t, label = '', kind = 'go') { this.target = t; this.label = label; this.kind = kind; }
  hint(key, force = false) {
    if (!force && this.shown.has(key)) return; this.shown.add(key);
    const h = HINTS[key]; if (!h) return; const e = $('hint'); e.innerHTML = h[G.isTouch ? 1 : 0]; e.classList.add('on'); this.hintT = 7;
  }
  update(dt) {
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('hint').classList.remove('on'); }
    const cam = G.camera, W = innerWidth, H = innerHeight;
    const active = G.state === 'play' || G.state === 'cutscene';
    // waypoint
    let tp = typeof this.target === 'function' ? this.target() : this.target;
    if (!tp || !active) { this.wp.hidden = true; this.arrow.hidden = true; }
    else {
      const v = tp.clone().project(cam); const behind = v.z > 1;
      const dist = tp.distanceTo(cam.position); const dy = tp.y - G.player.pos.y;
      let x = (v.x * .5 + .5) * W, y = (-v.y * .5 + .5) * H;
      const on = !behind && x > 30 && x < W - 30 && y > 60 && y < H - 60;
      if (on) {
        this.wp.hidden = false; this.arrow.hidden = true; this.wp.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
        const floors = Math.round(dy / 3); this.wpLbl.textContent = this.label;
        this.wpDist.textContent = Math.abs(floors) >= 1 ? `${Math.abs(floors)} קומות ${floors > 0 ? 'למעלה' : 'למטה'}` : (dist < 2 ? '' : `${Math.round(dist)} מ׳`);
        this.wp.className = 'wp ' + this.kind + (dist < 3 ? ' near' : '');
      } else {
        this.wp.hidden = true; this.arrow.hidden = false;
        let dx = x - W / 2, dyy = y - H / 2; if (behind) { dx = -dx; dyy = -dyy; }
        const a = Math.atan2(dyy, dx); const r = Math.min(W, H) * .38;
        this.arrow.style.transform = `translate(${(W / 2 + Math.cos(a) * r).toFixed(0)}px,${(H / 2 + Math.sin(a) * r).toFixed(0)}px) rotate(${(a * 180 / Math.PI + 90).toFixed(0)}deg)`;
      }
    }
    // friendly + hostage tags
    let k = 0; const placed = [];
    if (active) for (const a of G.actors) {
      if (k >= this.tags.length) break; if (!a.alive || !(a.kind === 'team' || a.kind === 'hostage' || (a.kind === 'idf' && a.down)) || (a.noTag && !a.down)) continue;
      const p = a.pos.clone(); p.y += a.kind === 'hostage' ? 2.0 : 2.1; const d = p.distanceTo(cam.position); if (d > (a.down ? 90 : 45) || d < 1.2) continue;
      const v = p.project(cam); if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      const e = this.tags[k++]; e.hidden = false; e.className = 'tag ' + a.kind + (a.down ? ' down' : ''); const hpv = Math.max(0, Math.min(1, a.health / 100)); const lbl = (a.down ? '✚ ' : '') + (a.kind === 'hostage' ? `חטוף · ${a.name}` : (a.name || 'לוחם')) + (a.down ? ' · מדמם' : ''); if (e._l !== lbl || e._h !== Math.round(hpv * 40)) { e._l = lbl; e._h = Math.round(hpv * 40); e.innerHTML = `${lbl}<b class="hpb"><i style="transform:scaleX(${hpv.toFixed(2)});background:${hpv < .45 ? '#e0533d' : hpv < .75 ? '#f2b84b' : '#7fb07a'}"></i></b>`; }
      // declutter: stack tags that would overlap (teammates standing shoulder to shoulder)
      const sx = (v.x * .5 + .5) * W; let sy = (-v.y * .5 + .5) * H; for (let it = 0; it < 4; it++) { const hit = placed.find(q => Math.abs(q[0] - sx) < 78 && Math.abs(q[1] - sy) < 24); if (!hit) break; sy = hit[1] - 26; } placed.push([sx, sy]);
      e.style.transform = `translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px)`; e.style.opacity = clamp(1.4 - d / 35, .35, 1).toFixed(2);
    }
    for (; k < this.tags.length; k++) this.tags[k].hidden = true;
    // squad panel: health and state of every operator and hostage with you
    this.sqT = (this.sqT || 0) - dt; if (this.sqT <= 0) { this.sqT = .25; const el = $('squad'); const m = G.mission; const list = el && active && m && m.team ? [...m.team, ...(this.stage >= 4 && m.hostages ? m.hostages : [])].filter(a => !a.removed || !a.alive) : [];
      const html = list.map(a => { const hp = Math.max(0, Math.min(1, a.health / 100)); const st = !a.alive ? 'kia' : a.down ? 'dn' : a.kind === 'hostage' ? 'h' : ''; const nm = (a.kind === 'hostage' ? 'חטוף · ' + a.name : (a.name || '').split(' ·')[0]) + (!a.alive ? ' · נהרג' : a.down ? ' · מדמם ✚' : a.treated ? ' · חבוש' : '');
        return `<div class="r ${st}"><span>${nm}</span><span class="b"><i style="transform:scaleX(${hp.toFixed(2)});background:${hp < .45 ? '#e0533d' : hp < .75 ? '#f2b84b' : '#7fb07a'}"></i></span></div>`; }).join('');
      if (el && el._h !== html) { el._h = html; el.innerHTML = html; } }
  }
}
