// "The Shaft": the incident commander finds and demolishes a tunnel shaft on the edge of a Gaza neighbourhood.
// Four phases: search (three candidate houses, clues from the UAV feed), approach (route, a rooftop watcher, an anti-tank
// cell), the shaft (robot, booby trap, charges, evacuating the neighbours, safety radius, the blast) and extraction under fire.
// The commander never shoots: every action is an order, and every order is judged by who it could hurt.
import * as THREE from 'three';
import { G, rr, clamp, V3, bus, after, fmtClock } from '../core.js';
import { Actor } from '../actors.js';
import { VO } from '../vo.js';
import { TL, ROUTES, hT, SHAFT } from './world.js';
import { makeRobot, makeDog } from './shaft.js';
import { speak, stopVoice } from '../voice.js';

export const TSTAGES = ['איתור הבית', 'גישה', 'טיהור ואיתור הפיר', 'פינוי ורדיוס בטיחות', 'פיצוץ הפיר', 'חילוץ'];
export const TSPEAKERS = {
  INT: { name: 'קצינת המודיעין', color: '#f2b84b', radio: false },
  HQ: { name: 'חמ״ל החטיבה', color: '#9ac0e6', radio: true },
  NAH: { name: 'מ״פ "נחש"', color: '#9ac0e6', radio: true },
  PAT: { name: 'צוות הנדסה "פטיש"', color: '#9ac0e6', radio: true },
  ZIK: { name: 'מפעילת "זיק"', color: '#c9a6e6', radio: true },
  TANK: { name: 'טנק', color: '#9ac0e6', radio: true },
  SPK: { name: 'כריזה מהנמר (בערבית)', color: '#f2b84b', radio: false },
  OKZ: { name: 'מפעיל הכלב "עוקץ"', color: '#9ac0e6', radio: true },
};
// who speaks each line (voice.js picks pitch and rate per caller; the radio ones get its squelch)
const WHO = { INT: 'team', HQ: 'hq', NAH: 'radio', PAT: 'פטיש', ZIK: 'זיק', TANK: 'טנק', OKZ: 'עוקץ' };
const voiceQ = new Map();
const $ = id => document.getElementById(id);
let lineN = 0;
// no recorded voice in this mission: radio lines are subtitles with a duration from their length
// the spoken voice starts when the subtitle comes up (audio.js queues the lines; 'sub' fires as each one is shown)
function say(sp, text, vo = null) { const id = 't' + (++lineN); VO[id] = { sp, text, off: 0, dur: clamp(1.2 + text.length * .06, 2.4, 8) }; voiceQ.set(text, vo || { who: WHO[sp] || 'radio', radio: !!(TSPEAKERS[sp] && TSPEAKERS[sp].radio) }); G.audio.say(id, { ttl: 16000 }); }
// the loudspeaker speaks Arabic; the subtitle is the Hebrew
function spk(he, ar) { say('SPK', he, { who: 'spk', lang: 'ar', alt: he }); }
const ok = a => a && a.alive && !a.removed && !a.down;
const P2 = (x, z) => V3(x, hT(x, z), z);
const HN = { A: 'בית א׳', B: 'בית ב׳', C: 'בית ג׳', N1: 'בית השכנים (צפון)', N2: 'בית השכנים (דרום)', H: 'הבית ליד המגרש', W: 'הבית של הצופה' };

export class TunnelMission {
  constructor() {
    this.t = 0; this.stage = -1; this.events = []; this.intel = []; this.units = []; this.risk = 12; this.phase = 'menu';
    this.st = { teamHurt: 0, civHurt: 0, militants: 0, shaft: false, wrong: [], prevented: [], violations: [] };
    this.look = {}; this.clues = { A: {}, B: {}, C: {} }; this.searched = {};
    bus.on('sub', it => { if (!it || !it.text) return; const o = voiceQ.get(it.text); if (!o) return; voiceQ.delete(it.text); if (G.settings.voice) speak(it.text, o); });
    bus.on('actorHit', (a, from, part) => { if (a.friendly && !a._hc) { a._hc = true; this.st.teamHurt++; this.riskAdd(10); this.notify('לוחם נפגע', `${a.name} נפצע. החובש של הכוח מטפל בו.`, true); after(5, () => { if (a.alive && a.down) a.treat(); }); } });
  }
  // ---------- menu backdrop / briefing ----------
  backdrop() { for (let i = 0; i < 120; i++) { G.time += .1; G.fx.update(.1); } }
  idle() { this.clockTick(); }
  briefing() {
    const lines = [
      'מודיעין על פיר מנהרה פעיל בשולי השכונה. פירים מוסתרים בדרך כלל בתוך בתים, מתחת לרצפה, ומחוברים למנהרות בעומק של עשרות מטרים.',
      'שלושה בתים חשודים: א׳, ב׳ ו־ג׳. סימנים לחפירה: ערימות חול טרי, כבלי חשמל שנמשכים לבית, גנרטור שעובד לפני הזריחה ונקודת חום.',
      'הכוח: צוות הקומנדו "נחש" וצוות ההנדסה "פטיש", עם רובוט "חולד" לסריקת הפיר. אתה מפקד מהנמר הפיקודי, דרך מצלמת "זיק" (הרמס 450).',
      'בבתים מסביב גרות משפחות. לפני פיצוץ מפנים את כל הבתים ברדיוס 45 מ׳ ומרחיקים את הכוח. אש רק על זיהוי ודאי של חמוש, והרחק מאזרחים.',
    ];
    const list = $('brieflines'); list.innerHTML = '';
    lines.forEach((t, i) => { const li = document.createElement('li'); li.textContent = t; li.style.animationDelay = (i * .15) + 's'; list.appendChild(li); });
    $('bgo').classList.add('ready');
    const cv = $('map'); const draw = () => { if (G.state !== 'briefing') return; const r = cv.getBoundingClientRect(); if (cv.width !== Math.round(r.width * 1.5)) { cv.width = Math.round(r.width * 1.5); cv.height = Math.round(r.height * 1.5); } this.drawMap(cv.getContext('2d'), cv.width, cv.height, { x0: -260, x1: 150, brief: true }); requestAnimationFrame(draw); }; draw();
  }
  // ---------- start ----------
  start() {
    G.state = 'play'; this.t = 0; this.stageSet(0); this.phase = 'search'; this.threats = {}; this.x2P = P2(TL.X2.x, TL.X2.z);
    G.player.setPos(V3(TL.cmd.x, hT(TL.cmd.x, TL.cmd.z) + .05, TL.cmd.z), Math.PI / 2 + .04); G.player.pitch = -.05;
    this.spawnTeam(); this.units = [
      { id: 'force', name: 'כוח "נחש" + הנדסה "פטיש"', sub: '4 לוחמי קומנדו, 3 חבלנים' },
      { id: 'robot', name: 'רובוט "חולד"', sub: 'זחלים, מצלמה ופנס; יורד לפיר על כננת', used: false },
      { id: 'spk', name: 'אזהרה לשכנים', sub: 'כריזה מהנמר ושיחות טלפון לבתים', cd: 0 },
      { id: 'smoke', name: 'רימוני עשן', sub: 'מסך עשן סביב הכוח', n: 4, cd: 0 },
      { id: 'dog', name: 'כלב "עוקץ"', sub: 'נכנס לבית לפני הלוחמים', used: false },
      { id: 'zik', name: 'תקיפה מכוונת "זיק"', sub: 'חימוש מדויק, ~7 ש׳ לפגיעה, רדיוס 7 מ׳', ammo: 2, cd: 0 },
      { id: 'tank', name: 'טנק', sub: 'פגז, ~4 ש׳ לפגיעה, רדיוס 9 מ׳', cd: 0 },
      { id: 'air', name: 'סיוע אווירי', sub: 'דרך החטיבה, ~40 ש׳ לפגיעה, רדיוס 26 מ׳', cd: 0 },
      { id: 'apc', name: 'נמר · איסוף', sub: 'במאסף', busy: false },
    ];
    this.U = Object.fromEntries(this.units.map(u => [u.id, u]));
    this.objective('איתור הבית', 'בדוק את שלושת הבתים ב"זיק" (גם בתרמי) ובחר לאן לשלוח את הכוח.');
    this.at(2, () => { say('INT', 'בוקר. שלושה בתים חשודים בשולי השכונה. בדוק אותם ב"זיק" לפני שאתה שולח את הכוח.'); this.addIntel('מודיעין', 'שלושה בתים חשודים: א׳ (צפון), ב׳ (מרכז), ג׳ (דרום). הפיר מוסתר באחד מהם.'); });
    this.at(55, () => { if (this.phase === 'search') { this.addIntel('צוות "פטיש"', 'מהתצפית: עקבות של עגלה כבדה בשביל שמוביל לבית ב׳.'); this.clues.B.track = true; } });
    G.audio.setIntensity(.15);
    const go = () => { this.waiting = false; };
    if (location.hash === '#retry' || G.debug.noIntro) go(); else { this.waiting = true; G.command.intro(go); }
  }
  onTabletFirst() { G.tablet.hint('גרור להזזת המצלמה · צביטה או +/− לזום · נגיעה באדם מסמנת אותו'); setTimeout(() => G.tablet.hint('"תרמי" מראה אנשים, מנועים וחום שבורח מחלונות'), 4200); }
  objective(t, sub) { this.calm = { title: t, text: sub }; }
  stageSet(i) { if (this.stage === i) return; this.stage = i; G.guide.setStage(i); }
  at(t, fn) { this.events.push({ at: this.t + t, fn }); }
  clockTick() { G.missionClock = 5 * 3600 + 12 * 60 + this.t * 2; if (G.state === 'menu' || G.state === 'briefing') G.missionClock = 5 * 3600 + 8 * 60; }
  riskAdd(v) { this.risk = clamp(this.risk + v, 0, 100); }
  // ---------- our force ----------
  spawnTeam() {
    const mk = (model, x, z, name, eng) => { const a = new Actor(model, 'idf', P2(x, z), -Math.PI / 2, { rifle: 'm4', accuracy: .9 }); a.name = name; a.eng = eng; a.brain = this.teamBrain(a); return a; };
    this.team = [mk('team', 70, 6, 'נחש 1 · מ״פ'), mk('team3', 70, 10, 'נחש 2'), mk('team', 72, 14, 'נחש 3'), mk('team3', 72, 18, 'נחש 4'), mk('team2', 76, 8, 'פטיש 1 · חבלן', true), mk('team2', 76, 12, 'פטיש 2 · חבלן', true), mk('team2', 77, 16, 'פטיש 3 · חבלן', true)];
    this.where = 'stage';
  }
  teamBrain(a) { return () => { if (a.down) return; if (a.path) { a.aiming = this.route === 'cover' && !a.eng; return; } a.aiming = !a.eng && !!a.lookAt; if (a.lookAt) a.faceTo(a.lookAt); }; }
  alive() { return this.team.filter(a => a.alive && !a.removed); }
  teamPos() { const a = this.alive().filter(x => x.root.visible); const p = V3(); if (!a.length) return P2(TL.B.x, TL.B.z); for (const x of a) p.add(x.pos); return p.multiplyScalar(1 / a.length); }
  // single file along the route, ~1 s apart; the last waypoint fans out so they don't stack
  moveTeam(route, speed, onArrive, who = this.alive().filter(a => !a.down || a.treated)) {
    let n = 0; const pts = route.map(([x, z]) => V3(x, 0, z));
    who.forEach((a, i) => { a.root.visible = true; a.noSnap = false; a.lookAt = null; const end = pts[pts.length - 1].clone().add(V3(((i % 3) - 1) * 1.3, 0, Math.floor(i / 3) * 1.3 - 1.3));
      const path = [...pts.slice(0, -1), end]; let k = 0, bd = 1e9; path.forEach((p, j) => { const d = p.distanceTo(a.pos); if (d < bd) { bd = d; k = j; } });
      after(i * .9, () => a.setPath(path.slice(Math.max(0, k)), a.down ? 1.2 : speed, () => { if (++n === who.length && onArrive) onArrive(); })); });
  }
  // ---------- per frame ----------
  update(dt) {
    if (this.waiting) { this.clockTick(); return; }
    this.t += dt; this.clockTick();
    for (let i = this.events.length - 1; i >= 0; i--) if (this.t >= this.events[i].at) { const e = this.events.splice(i, 1)[0]; e.fn(); }
    for (const u of this.units) if (u.cd > 0) u.cd -= dt;
    if (this.phase !== 'done') this.riskAdd(dt * .045);
    if (this.phase === 'search') this.examine(dt);
    if (this.watcher) this.watchUpdate(dt);
    if (this.cell) this.cellUpdate(dt);
    if (this.shooter) this.shooterUpdate(dt);
    if (this.smokeT > 0) { this.smokeT -= dt; const p = this.smokeP; for (let i = 0; i < 3; i++) if (Math.random() < dt * 9) G.fx.smoke.emit(V3(p.x + rr(-9, 9), hT(p.x, p.z) + rr(.2, 1.5), p.z + rr(-9, 9)), V3(G.wind.x * .4 + rr(-.4, .4), rr(.3, .9), G.wind.z * .4 + rr(-.4, .4)), rr(8, 12), rr(2, 3), rr(6, 9), [.82, .82, .8, .8], [.86, .86, .84, 0], .2, .02); }
    if (this.sniper) this.sniperUpdate(dt);
    // the robot waits at the shaft's lip after sweeping the house, until it is sent down
    if (this.robot) { const r = this.robot; if (r.entry && !r.released && r.t >= 6) { r.t = 6; r.hold = true; } }
    if (this.doorAnim) { const d = this.doorAnim; d.t += dt; G.doorB.rotation.y = -1.75 * clamp(d.t / 1.6, 0, 1) * (2 - clamp(d.t / 1.6, 0, 1)); if (d.t > 2) this.doorAnim = null; }
    if (this.dog) { const d = this.dog, o = d.obj, tg = d.path[d.i]; if (tg) { const v = tg.clone().sub(o.position); v.y = 0; const L = v.length(); if (L < .15) { d.i++; if (d.i >= d.path.length && d.onEnd) { const f = d.onEnd; d.onEnd = null; f(); } } else { const st = Math.min(L, dt * d.v); o.position.addScaledVector(v, st / L); o.rotation.y = Math.atan2(v.x, v.z); d.speed = d.v / 3.4; } } else d.speed = 0;
      const fy = G.floorAt ? G.floorAt(o.position, o.position.y + .9) : null; o.position.y = fy ?? hT(o.position.x, o.position.z); }
    this.taskT = (this.taskT || 0) - dt; if (this.taskT <= 0) { this.taskT = .5; this.refreshTask(); this.updateRisk(); }
  }
  updateRisk() { const el = $('tensbar'); if (el) el.style.width = this.risk.toFixed(0) + '%'; const tv = $('tensv'); if (tv) tv.textContent = this.risk < 30 ? 'נמוך' : this.risk < 55 ? 'בינוני' : this.risk < 75 ? 'גבוה' : 'קיצוני'; G.audio.setIntensity(.1 + this.risk / 200); }
  // ---------- phase 1: search ----------
  // a house counts as examined after ~1.2 s of the feed held on it, zoomed in; thermal and day camera show different things
  examine(dt) {
    const d = G.drone; if (!d || !d.active || d.fov > 11) return;
    for (const id of ['A', 'B', 'C']) {
      const h = G.houses[id]; if (Math.hypot(d.target.x - h.o.x, d.target.z - h.o.z) > 24) continue; const k = (d.ir ? 'ir' : 'eo'); const key = id + k;
      this.look[key] = (this.look[key] || 0) + dt; if (this.look[key] < 1.2 || this.clues[id][k]) continue; this.clues[id][k] = true;
      const txt = {
        Aeo: 'בית א׳ ביום: כביסה על הגג, אופניים של ילד ליד הדלת. בית מגורים רגיל.', Air: 'בית א׳ בתרמי: שישה אנשים בפנים, כנראה משפחה ישנה. אין מקור חום חריג.',
        Beo: 'בית ב׳ ביום: ערימת חול טרי בחצר, שקים מלאים, וכבל חשמל עבה מהעמוד ברחוב לחלון בקומת הקרקע. גנרטור בחצר.', Bir: 'בית ב׳ בתרמי: הגנרטור חם, וחום יוצא מחלון המטבח בקומת הקרקע, כמו מאוורור. שני אנשים בפנים.',
        Ceo: 'בית ג׳ ביום: מבנה מלאכה נטוש, גג פח חלוד, הדלת סגורה. אין סימני חפירה.', Cir: 'בית ג׳ בתרמי: קר. אין אנשים ואין מקור חום.',
      }[key];
      this.addIntel('מפעילת "זיק"', txt); say('ZIK', txt);
    }
  }
  sendTo(id, route = null) {
    if (this.phase !== 'search' && this.phase !== 'choose') return 'הכוח כבר בתנועה';
    if (id === 'B' && !route && this.where === 'stage') { this.phase = 'route'; this.refreshTask(true); return true; }
    this.phase = 'moving'; this.stageSet(1); this.targetId = id;
    const from = this.where; const LEG = { A: { B: [[-92, -38], [-122, -24], [-120, 8], [-118, 11]], C: [[-92, -38], [-75, -10], [-82, 30], [-78, 73]] }, C: { B: [[-78, 73], [-82, 30], [-108, 9], [-118, 11]], A: [[-78, 73], [-82, 30], [-75, -10], [-92, -38]] } };
    const path = from === 'stage' ? (id === 'A' ? ROUTES.toA : id === 'C' ? ROUTES.toC : ROUTES[route]) : LEG[from][id];
    this.route = route || (from === 'stage' ? (id === 'A' ? 'cover' : 'fast') : 'fast'); const sp = this.route === 'cover' ? 2.9 : 3.8;
    say('NAH', `"נחש" יוצאים ל${HN[id]}${route ? (route === 'cover' ? ', דרך המטע.' : ', ברחוב הפתוח.') : '.'}`);
    this.moveTeam(path, sp, () => this.arrive(id));
    this.objective('הכוח בתנועה', `הכוח בדרך ל${HN[id]}. עקוב אחריו ב"זיק" ושים לב לגגות ולסמטאות.`);
    if (!this.approachEvents) { this.approachEvents = true; this.at(this.route === 'cover' ? 8 : 5, () => this.spawnWatcher()); this.at(this.route === 'cover' ? 22 : 10, () => this.spawnCell()); }
    return true;
  }
  arrive(id) {
    this.where = id; const h = G.houses[id]; const door = TL[id].door;
    if (id === 'B') return this.arriveB();
    // two commandos hold the door outside, the rest go in
    const al = this.alive(); al.forEach((a, i) => { if (i === 1 || i === 3) { a.lookAt = P2(h.o.x - 30, h.o.z + (i === 1 ? -20 : 20)); a.readyAim = true; return; } a.setPath([V3(door[0], 0, door[1])], 1.6, () => { a.root.visible = false; a.noSnap = true; a.inside = true; }); });
    this.phase = 'clearing'; this.stageSet(2); say('NAH', `"נחש" ב${HN[id]}. נכנסים לטהר.`);
    this.objective('טיהור הבית', `"נחש" מטהרים את ${HN[id]} ומחפשים את הפיר.`);
    this.at(id === 'A' ? 22 : 16, () => {
      this.searched[id] = true; this.st.wrong.push(id); this.riskAdd(14);
      const txt = id === 'A' ? 'בית א׳ נקי. רק משפחה עם ילדים, מבוהלים. אין פיר. ביזבזנו זמן והשכונה מתעוררת.' : 'בית ג׳ נקי. מבנה ריק, אין פיר. ביזבזנו זמן.';
      say('NAH', txt); this.addIntel('"נחש"', txt, true);
      for (const a of this.alive()) { if (a.inside) { a.inside = false; a.root.visible = true; a.noSnap = false; } }
      this.phase = 'choose'; this.stageSet(0); this.objective('בחר בית אחר', 'הבית הזה נקי. בחר לאן ממשיכים.');
    });
  }
  // ---------- B: breach and entry ----------
  // The team stacks on B's door and two commandos cover the street. The commander picks how the door is opened (quiet
  // or blown) and who goes in first (the dog, the robot, or the men). One digger is still hiding inside.
  arriveB() {
    this.phase = 'breach'; this.stageSet(2); const d = TL.B.door;
    this.alive().forEach((a, i) => { a.lookAt = null; if (i === 1 || i === 3) { a.setPath([P2(d[0] + (i === 1 ? -4.5 : 4.5), d[1] - 3)], 2.2, () => { a.lookAt = P2(d[0] + (i === 1 ? -40 : 30), d[1] - 30); }); return; } a.setPath([P2(d[0] + 1.3 + (i % 2) * .5, d[1] - .9 - i * .5)], 1.8, () => { a.lookAt = P2(d[0], d[1] + 3); }); });
    say('NAH', '"נחש" על הדלת של בית ב׳. דלת פלדה נעולה. איך פורצים?');
    this.objective('כניסה לבית ב׳', 'בחר איך פורצים ומי נכנס ראשון. אפשר לצפות במצלמות הכוח בטאבלט.');
    this.addIntel('"נחש"', 'מבעד לחלון: בבית השכנים מצפון משפחה עם ילדים, ערים ומבוהלים. החצר שלהם צמודה לדלת של בית ב׳.', true);
    const h = new Actor('fighter', 'guard', P2(-113.4, 22.4), -Math.PI / 2 - .4, { rifle: 'ak' }); h.hostile = false; h.role = 'hidden'; h.armed = true; h.militant = true; h.brain = () => {}; h.forceAnim = 'crouch'; this.hidden = h;
  }
  breach(kind) {
    if (this.phase !== 'breach') return 'הדלת כבר נפרצה'; this.phase = 'breaching'; this.breachKind = kind;
    if (kind === 'quiet') { say('NAH', 'פריצה שקטה: חותכים את המנעול, בלי רעש. כמה שניות.'); after(7, () => { this.doorAnim = { t: 0 }; G.audio.playS('dry', { vol: .5, rate: .6 }); this.phase = 'entry'; say('NAH', 'הדלת פתוחה. מי נכנס ראשון?'); }); }
    else { say('NAH', 'מטען פריצה על הדלת. שלוש, שתיים, אחת.'); after(3.5, () => { const p = V3(TL.B.door[0], 1.1, TL.B.door[1] + .7); G.fx.explosion(p, .5); G.audio.explosion(p, .8); G.fx.dustBurst(p, 1.2, 26); G.doorB.visible = false; this.riskAdd(15); this.loud = true;
      this.st.violations.push('פריצה בפיצוץ ליד בית עם ילדים: השכונה התעוררה והצלף הגיע מוקדם'); this.notify('השכונה התעוררה', 'הפיצוץ העיר את השכונה. בבית הצפוני הילדים צורחים, ואנשים עולים לגגות.', true); this.phase = 'entry'; }); }
    return true;
  }
  entry(kind) {
    if (this.phase !== 'entry') return 'כבר בפנים'; this.phase = 'entering'; const h = this.hidden; this.entryKind = kind;
    if (kind === 'dog') { say('OKZ', '"עוקץ": הכלב נכנס ראשון.'); const dog = makeDog(); dog.position.copy(P2(TL.B.door[0] + 1, TL.B.door[1] - 2.2)); G.scene.add(dog);
      this.dog = { obj: dog, path: [P2(TL.B.door[0], TL.B.door[1] - .6), P2(-118, 16.4), P2(-115.8, 18.8), P2(-114.4, 21.6)], i: 0, v: 3.4, speed: 0, onEnd: () => after(1.2, () => this.surrender('dog')) }; }
    else if (kind === 'robot') { this.startRobot(true); say('PAT', '"חולד" נכנס ראשון וסורק את הקומה. הפיד בלשונית "רובוט".'); after(6.5, () => this.surrender('robot')); }
    else { say('NAH', '"נחש" נכנסים.'); this.enterB(); after(5, () => { if (!ok(h)) return; const t = this.alive().filter(a => a.insideB && !a.eng)[0]; const from = h.eye(new THREE.Vector3()); G.fx.muzzle(from, V3(-1, 0, -1).normalize(), 1); G.audio.shotAt(from, 'ak');
      if (t) t.damage(55, from, 'legs'); h.die(from); this.st.militants++; this.st.violations.push('הלוחמים נכנסו ראשונים: חמוש שהסתתר בבית ירה בהם'); say('NAH', 'ירי בפנים! חמוש בחדר המזרחי. נוטרל. יש לנו פצוע.'); }); }
    return true;
  }
  surrender(by) {
    const h = this.hidden; if (!ok(h)) return; h.role = 'detainee'; h.armed = false; h.militant = false; if (h.rifle) h.rifle.visible = false; this.detainee = h;
    const txt = by === 'dog' ? 'הכלב סימן חמוש שהסתתר בחדר המזרחי. הוא זרק את הנשק ונכנע. אין נפגעים.' : 'במצלמת "חולד": חמוש מסתתר בחדר המזרחי. הוא הניח את הנשק ונכנע.';
    say(by === 'dog' ? 'OKZ' : 'PAT', txt); this.addIntel(by === 'dog' ? '"עוקץ"' : 'צוות "פטיש"', txt, true); this.st.prevented.push(by === 'dog' ? 'הכלב איתר את החמוש המסתתר לפני שלוחם נכנס' : 'הרובוט איתר את החמוש המסתתר לפני שלוחם נכנס');
    if (this.dog) { this.dog.path = [P2(-117.8, 16), P2(TL.B.door[0], TL.B.door[1] - .6), P2(TL.B.door[0] + 2.2, TL.B.door[1] - 2.6)]; this.dog.i = 0; this.dog.onEnd = null; }
    this.enterB(); after(4, () => { if (ok(h)) h.setPath([P2(-115.8, 18.6), P2(-118, 16), P2(TL.B.door[0], TL.B.door[1] - .6), P2(-121.5, 9.5)], 1.3, () => { h.forceAnim = 'crouch'; h.faceTo(P2(-121.5, 20)); }); });
  }
  // the men go in: around the shaft, the engineers by the collar, one covering the salon doorway
  enterB() {
    const spots = { 0: [-116.9, 19.8], 2: [-115.4, 18.8], 4: [-122.5, 19.5], 5: [-119.5, 22.5], 6: [-122.7, 22.6] }; const d = TL.B.door;
    this.alive().forEach((a, i) => { const sp = spots[i]; if (!sp) return; a.insideB = true; a.lookAt = null; after(i * .5, () => a.setPath([P2(d[0], d[1] - .3), P2(d[0], d[1] + 2.4), P2(sp[0], sp[1])], 1.8, () => { a.lookAt = V3(SHAFT.x, i === 2 ? .9 : -1, SHAFT.z); if (i === 2) a.lookAt = P2(-113.4, 22.4); })); });
    this.at(7, () => this.foundShaft());
  }
  // ---------- phase 2: the rooftop watcher ----------
  // Who is on that roof is decided when he appears. Only the feed held on him (zoomed in) tells a phone from a rifle.
  spawnWatcher() {
    const armed = G.debug.watcher ? G.debug.watcher === 'armed' : Math.random() < .5; const h = G.houses.W;
    const a = new Actor(armed ? 'fighter' : 'civM1', armed ? 'guard' : 'civ', V3(h.o.x + 3.5, h.top, h.o.z + 2.5), Math.PI / 2, armed ? { rifle: 'ak' } : {});
    a.hostile = false; a.noSnap = true; a.role = 'watcher'; a.armed = armed; a.brain = () => { a.faceTo(this.teamPos()); }; a.idleAnim = armed ? 'look' : 'm_cell_phone_talk_01'; if (!armed) a.forceAnim = 'm_cell_phone_talk_01';
    this.watcher = a; this.watchT = 0; this.setThreat('watcher');
    this.notify('דמות על גג', 'מפעילת "זיק": מישהו על גג של בית שלוש קומות, צפון־מערבית לבית ב׳. צופה לעבר הכוח.', true); say('ZIK', 'דמות על גג, צפון־מערבית לבית ב׳. מסתכל לכיוון הכוח.');
  }
  watchUpdate(dt) {
    const a = this.watcher; if (!a.alive || a.removed) { this.watcher = null; this.setThreat('watcher', false); return; }
    this.watchT += dt; const d = G.drone;
    if (!a.idd && d.active && d.fov < 6 && Math.hypot(d.target.x - a.pos.x, d.target.z - a.pos.z) < 12) { a.idT = (a.idT || 0) + dt; if (a.idT > 2.2) { a.idd = true;
      const txt = a.armed ? 'זיהוי ודאי: רובה קלאצ׳ניקוב על המעקה ומכשיר קשר. תצפיתן חמוש.' : 'זיהוי: אין נשק. אדם עם טלפון, כנראה תושב שעלה לגג. לא איום.';
      this.addIntel('מפעילת "זיק"', txt, a.armed); say('ZIK', txt); if (G.tablet) G.tablet.renderTarget(); } }
    // an armed spotter left alone calls the force in: the anti-tank cell gets moving and the risk climbs
    if (a.armed && !a.reported && this.watchT > 45 && ok(a)) { a.reported = true; this.riskAdd(18); this.notify('התצפיתן דיווח', 'האזנה: התצפיתן העביר את מיקום הכוח. חוליית הנ״ט ממהרת.', true); if (this.cell) for (const c of this.cell.men) if (c.path) c.moveSpeed = 3.4; }
    // the man with the phone goes back down after a while
    if (!a.armed && this.watchT > 80 && !a.gone) { a.gone = true; this.addIntel('מפעילת "זיק"', 'האיש עם הטלפון ירד מהגג.'); a.remove(); }
  }
  // ---------- phase 2: the anti-tank cell ----------
  spawnCell() {
    const pts = [[-262, 128], [-226, 118], [-196, 104], [-182, 72], [-166, 68]].map(([x, z]) => V3(x, 0, z));
    const men = [0, 1].map(i => { const a = new Actor('fighter', 'guard', P2(-322 - i * 2, 150 + i * 1.5), Math.PI / 2, { rifle: 'ak' }); a.hostile = false; a.role = 'rpg'; a.armed = true; a.militant = true; a.brain = () => {}; a.setPath(pts.map(p => p.clone().add(V3(-i * 1.6, 0, i * 1.2))), 2.5, () => { a.atAmbush = true; a.forceAnim = 'crouch'; }); return a; });
    // the launcher on the first man's shoulder: a tube with a warhead cone (reads at the feed's zoom)
    const tube = new THREE.Group(); const tm = new THREE.MeshStandardMaterial({ color: '#3d3f33', roughness: .7 }); tube.add(new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1, 8).rotateX(Math.PI / 2), tm)); const war = new THREE.Mesh(new THREE.ConeGeometry(.07, .3, 8).rotateX(Math.PI / 2), tm); war.position.z = .62; tube.add(war); G.scene.add(tube);
    this.cell = { men, tube, t: 0 }; this.setThreat('rpg');
    this.notify('חוליית נ״ט', 'מודיעין: שני חמושים עם מטול RPG יצאו מסמטה במערב השכונה לעבר הכוח. עקוב אחריהם ב"זיק".', true); say('HQ', 'שני חמושים עם RPG בדרך אליכם ממערב. עקבו ב"זיק".');
    this.addIntel('חמ״ל', 'חוליית נ״ט (שני חמושים, RPG) נעה ממערב לעבר הכוח. תקיפה רק בשטח פתוח, הרחק מבתים מאוכלסים.', true);
  }
  // where the cell is: in the alleys, in the open lot, or by an occupied house (strike there = families hurt)
  cellZone() { const c = this.cell; const a = c.men.find(ok); if (!a) return 'gone'; const p = a.pos; if (a.atAmbush) return 'ambush'; if (this.nearOccupied(p, 16) || this.civsNear(p, 16).length) return 'houses'; if (p.x > -268 && p.x < -190) return 'open'; return 'alley'; }
  cellUpdate(dt) {
    const c = this.cell; const live = c.men.filter(ok); if (!live.length) { G.scene.remove(c.tube); this.cell = null; this.setThreat('rpg', false); return; }
    const g = c.men[0]; if (ok(g)) { const hp = g.chest(new THREE.Vector3()); c.tube.position.copy(hp).add(V3(0, .25, 0)); c.tube.rotation.y = g.root.rotation.y; } else c.tube.visible = false;
    if (live.some(a => a.atAmbush) && !c.fired) { c.ambT = (c.ambT || 0) + dt; for (const a of live) a.faceTo(this.teamPos()); if (c.ambT > (this.risk > 70 ? 4 : 8)) { c.fired = true; this.rpgFire(live[0]); } }
  }
  rpgFire(a) {
    const from = a.eye(new THREE.Vector3()); const tgt = this.alive().filter(x => x.root.visible).sort((p, q) => p.pos.distanceTo(from) - q.pos.distanceTo(from))[0]; if (!tgt) return;
    G.audio.explosion(from, .4); G.fx.muzzle(from, tgt.pos.clone().sub(from).normalize(), 3);
    const to = tgt.pos.clone().add(V3(0, 1, 0)); const smoked = this.smokeT > 0 && to.distanceTo(this.smokeP) < 16; if (smoked) to.add(V3(rr(-7, 7), 0, rr(4, 8)));
    G.fx.tracer(from, to, true);
    after(.7, () => { G.fx.explosion(to, .8); G.audio.explosion(to, .8);
      if (smoked) { this.st.prevented.push('מסך העשן הסתיר את הכוח: טיל ה־RPG החטיא'); this.notify('ה־RPG החטיא', 'מסך העשן הסתיר את הכוח. החוליה נסוגה לסמטאות.', false); }
      else for (const x of this.alive()) if (x.root.visible && x.pos.distanceTo(to) < 5) x.damage(65, to, 'body');
      for (const m of this.cell ? this.cell.men : []) if (m.alive) m.setPath([V3(-300, 0, 150)], 3.4, () => m.remove());
    });
  }
  // ---------- strikes ----------
  // Every strike is checked at the moment it lands: who is within its radius then. Air support takes long enough
  // that targets walk out of the open and into the houses.
  // ---------- the proportionality card ----------
  // Every strike order stops here first: target and identification, the military advantage, who is inside the weapon's
  // radius now (people seen in the feed and occupied houses in thermal), our own men, and the alternatives.
  requestStrike(kind, tgt) {
    const U = this.U; const u = U[kind]; if (G.state !== 'play') return false;
    if (kind === 'zik' && u.ammo <= 0) return 'אין חימוש נוסף ב"זיק"'; if (u.cd > 0 || u.pending) return 'עדיין בטעינה';
    const R = { zik: 7, tank: 9, air: 26 }[kind], delay = { zik: 7, tank: 4, air: 40 }[kind]; const p = this.posOf(tgt); const info = this.identify(tgt);
    const civ = this.civsNear(p, R).filter(a => a !== tgt).length; const houses = Object.keys(G.houses).filter(id => { const h = G.houses[id]; if (!h.blobs || !h.blobs.some(b => !b.userData.gone)) return false; const dx = Math.max(0, Math.abs(p.x - h.o.x) - h.o.w / 2), dz = Math.max(0, Math.abs(p.z - h.o.z) - h.o.d / 2); return Math.hypot(dx, dz) <= R * .7; });
    const inH = houses.reduce((n, id) => n + G.houses[id].blobs.filter(b => !b.userData.gone).length, 0); const own = this.alive().filter(a => a.pos.distanceTo(p) < R).length;
    const adv = { rpg: 'מניעת ירי נ״ט על הכוח', watcher: 'מניעת דיווח על מיקום הכוח', sniper: 'הפסקת ירי הצלף על השומרים', shooter: 'הפסקת הירי על הכוח בחילוץ' }[tgt.role] || (tgt === this.x2P ? 'ניסיון לאטום את הפתח השני מהאוויר (פצצה לא אוטמת פיר בעומק 20 מ׳)' : 'לא ברור');
    const alt = { sniper: 'מסך עשן והכוח למחסה', rpg: 'מסך עשן, או לחכות לשטח פתוח', watcher: 'מעקב עד זיהוי' }[tgt.role] || (tgt === this.x2P ? 'צוות הנדסה ומטען בפתח' : 'מסך עשן, מעקב');
    const harmN = civ + inH; const bad = harmN > 0 || own > 0 || !info.threat;
    const verdict = harmN ? `לא מידתי: צפויה פגיעה ב־${harmN} אזרחים` : own ? 'לא לתקוף: כוחות שלנו בתוך הרדיוס' : !info.threat ? 'אין זיהוי ודאי של חמוש' : 'מידתי: יעד מזוהה, אין אזרחים ברדיוס';
    const rows = [['יעד', `${info.name}${info.threat ? ' · זיהוי ודאי' : ' · אין זיהוי ודאי'}`], ['תועלת צבאית', adv], ['חימוש', `${{ zik: 'תקיפה מכוונת "זיק"', tank: 'פגז טנק', air: 'סיוע אווירי' }[kind]} · רדיוס ${R} מ׳ · ${delay} ש׳ לפגיעה`], ['אזרחים ברדיוס', harmN ? `${civ ? civ + ' בשטח' : ''}${civ && inH ? ', ' : ''}${inH ? inH + ' בתוך ' + houses.map(id => HN[id] || 'בית').join(', ') + ' (תרמי)' : ''}` : 'אין (לפי "זיק" ותרמי)'], ['כוחות שלנו', own ? `${own} בתוך הרדיוס` : 'מחוץ לרדיוס'], ['חלופות', alt]];
    $('propRows').innerHTML = rows.map(([k, v], i) => `<div class="${(i === 3 && harmN) || (i === 4 && own) || (i === 0 && !info.threat) ? 'bad' : ''}"><b>${k}</b><span>${v}</span></div>`).join('');
    const vd = $('propVerdict'); vd.textContent = verdict; vd.className = bad ? 'bad' : 'good';
    const yes = $('propYes'); yes.textContent = bad ? 'לתקוף בכל זאת' : 'אשר תקיפה'; yes.className = 'btn' + (bad ? ' danger' : '');
    $('prop').hidden = false; this.propOpen = true;
    const close = () => { $('prop').hidden = true; this.propOpen = false; };
    yes.onclick = e => { e.stopPropagation(); close(); const r = this.strike(kind, tgt); if (typeof r === 'string') G.ui.toast(r); if (tgt === this.x2P) { this.x2Sent = true; this.x2Air = true; } };
    $('propNo').onclick = e => { e.stopPropagation(); close(); };
    return true;
  }
  strike(kind, tgt) {
    const U = this.U; const u = U[kind]; if (G.state !== 'play') return false;
    if (kind === 'zik' && u.ammo <= 0) return 'אין חימוש נוסף ב"זיק"';
    if (u.cd > 0 || u.pending) return 'עדיין בטעינה';
    const info = this.identify(tgt); if (!info.threat) this.st.violations.push('נתת פקודת תקיפה בלי זיהוי ודאי של חמוש');
    const delay = { zik: 7, tank: 4, air: 40 }[kind], R = { zik: 7, tank: 9, air: 26 }[kind];
    if (kind === 'zik') u.ammo--; u.pending = true; if (tgt.root) tgt.struck = kind; u.cd = { zik: 20, tank: 12, air: 90 }[kind];
    say(kind === 'tank' ? 'TANK' : kind === 'zik' ? 'ZIK' : 'HQ', kind === 'tank' ? 'טנק: מטווח. יורה.' : kind === 'zik' ? 'תקיפה מכוונת "זיק" שוגרה. שבע שניות.' : 'סיוע אווירי אושר. זמן הגעה כ־40 שניות.');
    if (kind === 'tank') { G.audio.explosion(G.tank.obj.position.clone(), .6); G.fx.muzzle(G.tank.obj.position.clone().add(V3(-5, 2.6, 0)), V3(-1, 0, 0), 4); }
    after(delay, () => { u.pending = false; if (tgt.root) tgt.struck = null; const p = this.posOf(tgt).clone(); if (!tgt.root) p.y = hT(p.x, p.z); G.fx.explosion(p.clone().add(V3(0, .4, 0)), kind === 'air' ? 2.2 : 1.2); G.audio.explosion(p, kind === 'air' ? 1.6 : 1);
      if (kind === 'air') G.audio.playS('jet', { vol: .6 });
      const r = this.harm(p, R); const what = kind === 'zik' ? 'תקיפת "זיק"' : kind === 'tank' ? 'פגז הטנק' : 'התקיפה האווירית', hit = kind === 'tank' ? 'פגע' : 'פגעה';
      if (r.civ) this.notify('אזרחים נפגעו', `${what} ${hit} ב־${r.civ} אזרחים. ${r.house ? 'הפגיעה הייתה ליד בית מאוכלס.' : ''}`, true);
      else if (r.mil) { this.notify('פגיעה', `${what}: ${r.mil} חמושים נפגעו. אין פגיעה באזרחים.`, false); this.st.prevented.push(`${what} ${hit} בחמושים בלי לפגוע באזרחים`); }
      else this.notify('החטאה', `${what} לא ${hit} באיש.`, false);
    });
    return true;
  }
  harm(p, R) {
    const r = { civ: 0, mil: 0, team: 0, house: false };
    for (const a of [...G.actors]) { if (!a.alive || a.removed || !a.root.visible && !a.inside) continue; const d = a.pos.distanceTo(p); if (d > R) continue;
      if (a.friendly) { a.damage(d < R * .5 ? 70 : 45, p, 'body'); r.team++; }
      else if (a.militant || (a.role === 'watcher' && a.armed) || a.role === 'shooter') { a.die(p); this.st.militants++; r.mil++; }
      else { this.civHurt(a); r.civ++; } }
    for (const id of Object.keys(G.houses)) { const h = G.houses[id]; if (!h.blobs) continue; const n = h.blobs.filter(b => !b.userData.gone).length; if (!n) continue;
      const dx = Math.max(0, Math.abs(p.x - h.o.x) - h.o.w / 2), dz = Math.max(0, Math.abs(p.z - h.o.z) - h.o.d / 2); if (Math.hypot(dx, dz) > R * .7) continue;
      r.civ += n; r.house = true; this.st.civHurt += n; this.st.violations.push(`${n} אזרחים נפגעו ב${HN[id] || 'בית'}`); for (const b of h.blobs) b.userData.gone = true; }
    if (r.civ) this.riskAdd(20);
    return r;
  }
  civHurt(a) { if (a._hurt) return; a._hurt = true; this.st.civHurt++; this.st.violations.push(a.role === 'watcher' ? 'אזרח עם טלפון על הגג נפגע' : 'אזרח נפגע'); a.stop(); a.brain = () => {}; a.forceAnim = 'crouch'; a.hurt = true; a.down = true; }
  nearOccupied(p, R) { for (const id of Object.keys(G.houses)) { const h = G.houses[id]; if (!h.blobs || !h.blobs.some(b => !b.userData.gone)) continue; const dx = Math.max(0, Math.abs(p.x - h.o.x) - h.o.w / 2), dz = Math.max(0, Math.abs(p.z - h.o.z) - h.o.d / 2); if (Math.hypot(dx, dz) < R) return id; } return null; }
  civsNear(p, R) { return G.actors.filter(a => a.alive && !a.removed && a.kind === 'civ' && !a.militant && !(a.role === 'watcher' && a.armed) && a.pos.distanceTo(p) < R); }
  // ---------- phase 3: the shaft ----------
  foundShaft() {
    this.phase = 'shaft'; this.stageSet(2); this.shaftP = P2(SHAFT.x, SHAFT.z);
    say('PAT', 'מצאנו את הפיר. מתחת לאריחי המטבח: צווארון בטון, סולם ברזל, כננת. כבל החשמל מהרחוב יורד לתוכו.');
    this.addIntel('צוות "פטיש"', 'פיר מתחת לרצפת המטבח: פתח 1 מ׳ בצווארון בטון, סולם ברזל, כננת על חצובה, שקי עפר. עומק משוער 20 מ׳ ויותר.', true);
    this.addIntel('חמ״ל', 'רדיוס בטיחות לפיצוץ: 45 מ׳. בתוכו שני בתים מאוכלסים, צפונה ודרומה לבית ב׳. צריך לפנות אותם ולהרחיק את הכוח לפני הפיצוץ.', true);
    this.objective('הפיר', 'רובוט לפני לוחם, מטענים, פינוי השכנים, הרחקת הכוח, פיצוץ.');
    this.radiusOn = true; if (this.loud) this.at(3, () => this.spawnSniper());
  }
  startRobot(entry = false) { if (this.robot) return; const m = makeRobot(); m.position.copy(P2(TL.B.door[0] + .6, TL.B.door[1] - 1)); G.scene.add(m); this.robot = { m, t: 0, on: true, hold: false, entry }; G.feeds.robot = m; this.U.robot.used = true; G.hotObjects.push(m); }
  // The robot's run is scripted on its own clock (shaft.js Feeds.robotPose); the events here follow that clock
  sendRobot() {
    if (this.phase !== 'shaft' || (this.U.robot.used && !(this.robot && this.robot.hold))) return 'אין צורך ברובוט עכשיו';
    if (this.robot) { this.robot.hold = false; this.robot.released = true; } else this.startRobot();
    this.robotBusy = true; G.tablet && G.tablet.flagTab('robot');
    say('PAT', '"חולד" נוסע לפיר ויורד על הכננת. הפיד בטאבלט, לשונית "רובוט".');
    const t0 = this.robot.t; const at = (t, fn) => after(Math.max(.1, t - t0), fn);
    at(13, () => { this.trapFound = true; say('PAT', '"חולד" עצר בעומק שישה מטרים. חוט מעידה לרוחב הפיר, ומטען על הסולם.'); this.addIntel('צוות "פטיש"', 'מלכוד בפיר: מטען על הסולם וחוט מעידה לרוחב הפיר, בעומק 6 מ׳.', true); });
    at(15.7, () => { say('PAT', 'הזרוע חתכה את החוט. המטען מסומן. ממשיכים למטה.'); this.st.prevented.push('הרובוט מצא את המלכוד וחתך את החוט לפני שלוחם ירד לפיר'); });
    at(33.5, () => { this.robotBusy = false; this.x2Known = true; say('PAT', 'בתחתית, עשרים ושניים מטר: המנהרה מתפצלת. ענף מערבה, וענף צפונה לכיוון המחסן ההרוס. יש פתח שני.');
      this.addIntel('צוות "פטיש"', 'בתחתית הפיר המנהרה מתפצלת: ענף מערבי, וענף צפוני של כ־110 מ׳ לפתח שני במחסן הרוס, 19 מ׳ מבית מאוכלס. גם אותו צריך לאטום.', true);
      this.at(this.loud ? 1 : 4, () => this.spawnSniper()); });
    return true;
  }
  sendSoldierDown() {
    if (this.phase !== 'shaft' || this.trapFound || this.trapBlown) return 'אין צורך'; this.U.robot.used = true; this.robotBusy = true;
    say('PAT', 'לוחם יורד בסולם לבדוק את הפיר.');
    after(9, () => { this.robotBusy = false; this.trapBlown = true; this.trapFound = true; const a = this.alive().find(x => x.eng) || this.alive()[0]; G.audio.explosion(this.shaftP, .7); G.fx.dustBurst(this.shaftP.clone().add(V3(0, 1, 0)), 3, 40);
      a.damage(70, this.shaftP, 'legs'); this.st.violations.push('לוחם ירד לפיר לפני סריקה והפעיל מלכוד');
      say('PAT', 'פיצוץ בפיר! מלכוד על הסולם. יש לנו פצוע. את המנהרה למטה לא ראינו.'); this.at(5, () => this.spawnSniper()); });
    return true;
  }
  placeCharges() {
    if (this.phase !== 'shaft' || !this.trapFound || this.robotBusy) return 'קודם צריך לבדוק את הפיר'; if (this.charging || this.charged) return 'כבר בביצוע';
    this.charging = true; say('PAT', '"פטיש": מורידים את המטענים בכננת לתחתית הפיר ולתחילת שני הענפים. עשרים שניות.');
    // what the bodycams see: charge bags by the collar and the detonation cord running out of the door
    const m = new THREE.MeshStandardMaterial({ color: '#5d6140', roughness: .8 }), cord = new THREE.MeshStandardMaterial({ color: '#c8a020', roughness: .6 }); const g = new THREE.Group();
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.34, .22, .24), m); b.position.set(SHAFT.x + 1.15 + (i % 2) * .38, .22, SHAFT.z - .6 + Math.floor(i / 2) * .3); g.add(b); }
    const pts = [V3(SHAFT.x + .2, .35, SHAFT.z - .3), V3(SHAFT.x + 1.6, .12, SHAFT.z - 1.4), V3(-118, .12, 16.2), V3(-118, .12, 14.6), V3(-118.4, .1, 11.5)]; const c = new THREE.CatmullRomCurve3(pts); g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, .012, 4), cord)); G.scene.add(g); this.chargeMesh = g;
    after(20, () => { this.charging = false; this.charged = true; g.children.slice(0, 2).forEach(x => x.visible = false); say('PAT', 'המטענים בתחתית ובשני הענפים. הפעלה מרחוק, רדיוס בטיחות 45 מטר.'); this.addIntel('צוות "פטיש"', 'מטענים הונחו בתחתית הפיר ובתחילת שני הענפים. הפעלה מרחוק, רדיוס בטיחות 45 מ׳.'); });
    return true;
  }
  // the second exit: two men walk to the ruined shed, rig its mouth with a charge on the same circuit, and come back
  // out of the radius; an air strike there would only scar the surface 19 m from a family
  sealX2() {
    if (!this.x2Known) return 'הפתח השני עוד לא אותר'; if (this.x2Sent) return 'כבר בטיפול'; this.x2Sent = true;
    const two = [this.team[2], this.team[6]].filter(ok); if (!two.length) return 'אין מי ללכת';
    say('NAH', '"נחש 3" ו"פטיש 3" יוצאים לפתח השני, במחסן ההרוס. מטען באותו מעגל.');
    let n = 0; two.forEach((a, i) => { a.x2 = true; a.insideB = false; a.lookAt = null; after(i * 1.2, () => a.setPath(ROUTES.x2.map(([x, z]) => P2(x + i * 1.2, z)), 3.6, () => { a.lookAt = P2(TL.X2.x, TL.X2.z); if (++n < two.length) return;
      say('PAT', '"פטיש 3" בפתח השני. מוריד מטען.'); after(9, () => { this.x2Ready = true; say('PAT', 'הפתח השני ממולכד ומחובר. חוזרים מחוץ לרדיוס.'); this.st.prevented.push('גם הפתח השני של המנהרה נאטם');
        let m = 0; two.forEach((b, j) => { b.lookAt = null; b.setPath(ROUTES.x2back.map(([x, z]) => P2(x + j * 1.3, z + j)), 3.8, () => { b.lookAt = P2(TL.B.x, TL.B.z); if (++m === two.length) this.x2Home = true; }); }); }); })); });
    G.command.pulse(P2(TL.X2.x, TL.X2.z), '#9ac0e6', 8, 2);
    return true;
  }
  // ---------- the sniper ----------
  // On the roof of the house by the lot, over a family of five. A strike there hurts them; smoke and cover end it.
  spawnSniper() {
    if (this.sniper || this.sniperDone || this.blown) return; const h = G.houses.H;
    const a = new Actor('fighter', 'guard', V3(h.o.x + 3.2, h.top, h.o.z - 2.6), Math.PI / 2, { rifle: 'ak' }); a.hostile = false; a.noSnap = true; a.role = 'sniper'; a.armed = true; a.militant = true; a.brain = () => { a.faceTo(P2(TL.B.door[0], TL.B.door[1])); a.aiming = true; };
    this.sniper = a; this.snipT = 0; this.setThreat('sniper');
    say('NAH', 'צלף! יורים על השומרים בדלת, מגג בדרום־מערב!'); this.notify('צלף', 'ירי צלף מגג הבית ליד המגרש, 90 מ׳ דרום־מערבית לבית ב׳, על הלוחמים שמאבטחים את הדלת. בבית מתחתיו גרה משפחה.', true);
    this.addIntel('מפעילת "זיק"', 'הצלף על הגג של הבית ליד המגרש. בתרמי: חמישה אנשים בקומות שמתחתיו, כנראה משפחה.', true);
  }
  sniperUpdate(dt) {
    const a = this.sniper; if (!ok(a)) { this.sniper = null; this.sniperDone = true; this.setThreat('sniper', false); return; }
    this.snipT += dt; a.fireT = (a.fireT ?? 2) - dt; if (a.fireT > 0) return; a.fireT = rr(2.8, 4.4);
    const door = P2(TL.B.door[0], TL.B.door[1]); const tg = this.alive().filter(x => x.root.visible && !x.insideB && !x.x2 && x.pos.distanceTo(door) < 30).sort((p, q) => p.pos.distanceTo(door) - q.pos.distanceTo(door))[0]; if (!tg) return;
    const from = a.eye(new THREE.Vector3()); const to = tg.pos.clone().add(V3(rr(-2.5, 2.5), rr(.3, 1.6), rr(-2.5, 2.5)));
    G.fx.muzzle(from, to.clone().sub(from).normalize(), 1); G.audio.shotAt(from, 'ak'); G.fx.tracer(from, to, true); G.fx.impact(V3(to.x, hT(to.x, to.z), to.z), V3(0, 1, 0), 'sand');
    const smoked = this.smokeT > 0 && tg.pos.distanceTo(this.smokeP) < 16; if (!smoked && this.snipT > 20 && !this._snipHit) { this._snipHit = true; tg.damage(50, from, 'legs'); }
  }
  sniperCover() {
    const r = this.smoke(P2(TL.B.door[0] - 1, TL.B.door[1] - 4)); if (typeof r === 'string') return r;
    for (const i of [1, 3]) { const a = this.team[i]; if (!ok(a) || a.x2) continue; a.insideB = true; a.lookAt = null; a.setPath([P2(-118, 12.8), P2(-118 + (i === 1 ? -.9 : .9), 15.9)], 2.8, () => { a.lookAt = P2(-118, 6); }); }
    say('NAH', 'עשן על הדלת. השומרים נכנסים פנימה ומכסים את הרחוב מהחלונות.');
    after(20, () => { const s = this.sniper; if (!ok(s)) return; this.addIntel('מפעילת "זיק"', 'הצלף ירד מהגג ונעלם בין הבתים. אין לו יותר קו ראייה לכוח.'); this.st.prevented.push('מול צלף על בית מאוכלס: עשן ומחסה במקום תקיפה'); s.remove(); this.sniper = null; this.sniperDone = true; this.setThreat('sniper', false); });
    return true;
  }
  // the neighbours: a warning by loudspeaker (in Arabic) and by phone. One old man in the southern house will not leave.
  warnNeighbours() {
    const u = this.U.spk; if (u.cd > 0) return 'הכריזה כבר משודרת'; u.cd = 20; this.warned = true; this.stageSet(3);
    spk('"לתושבי הבתים ליד הבית הזה: צאו עכשיו מהבתים, מערבה, לכיוון המסגד. יהיה פיצוץ. אל תחזרו עד שנודיע."', 'إلى سكان البيوت المجاورة: اخرجوا من البيوت الآن باتجاه الغرب نحو المسجد. سيكون هناك انفجار. لا تعودوا حتى نبلغكم.');
    say('NAH', 'כריזה בערבית מהנמר ושיחות טלפון לכל בית ברדיוס.'); G.command.pulse(P2(TL.B.x, TL.B.z), '#f2b84b', 45, 2.4);
    if (!this.evacStarted) { this.evacStarted = true;
      const out = (house, model, k, delay) => after(delay, () => { const h = G.houses[house]; const door = TL[house].door; const b = h.blobs.find(x => !x.userData.gone); if (b) b.userData.gone = true;
        const a = new Actor(model, 'civ', P2(door[0], door[1]), 0, {}); a.role = 'resident'; a.brain = () => {}; const g = TL.gather; a.setPath([P2(door[0] + (house === 'N2' ? -10 : -6), door[1] + (house === 'N2' ? 6 : -2)), P2(g.x + k * 1.4 - 3, g.z + (k % 2) * 1.6)], 2, () => { a.idleAnim = 'nervous'; a.faceTo(P2(TL.B.x, TL.B.z)); }); });
      out('N1', 'civM1', 0, 4); out('N1', 'civF1', 1, 5); out('N1', 'civM2', 2, 6); out('N1', 'civF1', 3, 7); out('N2', 'civF1', 4, 7.5); out('N2', 'civM1', 5, 8.5);
      after(11, () => { this.holdoutKnown = 'ground'; this.addIntel('"נחש"', 'מהבית הדרומי יצאו שניים. לפי השכנים, אביהם הקשיש נשאר בפנים. בדוק בתרמי.', true); say('NAH', 'מהבית הדרומי יצאו רק שניים. אומרים שהאבא הקשיש נשאר בפנים.'); });
      // the shaft's own diggers (the warm figures in B) slipped into the tunnel before the force arrived
      const hb = G.houses.B.blobs; if (hb) for (const b of hb) b.userData.gone = true;
    }
    return true;
  }
  holdout() { const h = G.houses.N2; return h.blobs.filter(b => !b.userData.gone).length; }
  escortHoldout() {
    if (!this.warned) return 'קודם להזהיר את השכנים'; if (this.escorting) return 'כבר בביצוע'; if (!this.holdout()) return 'הבית ריק';
    this.escorting = true; const two = this.alive().filter(a => !a.eng && !a.down && !a.x2).slice(0, 2); const door = TL.N2.door;
    say('NAH', 'שניים מ"נחש" הולכים להוציא את הקשיש.');
    two.forEach((a, i) => { a.insideB = false; a.lookAt = null; a.setPath([P2(TL.B.door[0] + 3, TL.B.door[1] - 2), P2(-106, 10), P2(-98, 36), P2(door[0] + i * 1.2, door[1] - 1)], 3.4, () => {
      if (i) return; after(3, () => { for (const b of G.houses.N2.blobs) b.userData.gone = true; const old = new Actor('civM2', 'civ', P2(door[0], door[1]), 0, {}); old.role = 'resident'; old.brain = () => {}; old.hurt = true;
        const dst = [P2(-88, 56), P2(-62, 66)]; old.setPath(dst, 1.7, () => { old.idleAnim = 'nervous'; }); for (const s of two) s.setPath(dst.map(p => p.clone().add(V3(1.2, 0, -1))), 1.8, () => { s.lookAt = P2(TL.B.x, TL.B.z); s.escort = true; if (this.escorted) return; this.escorted = true; this.st.prevented.push('הקשיש שנשאר בבית פונה לפני הפיצוץ'); say('NAH', 'הקשיש בחוץ, רחוק מהרדיוס. הבית הדרומי ריק.'); }); }); }); });
    return true;
  }
  roofKnock() { if (!this.holdout()) return 'הבית ריק'; if (this.knocked) return 'כבר בוצע'; this.knocked = true; const h = G.houses.N2; const p = V3(h.o.x, h.top + .5, h.o.z); after(3, () => { G.audio.explosion(p, .25); G.fx.dustBurst(p, 1.5, 20); });
    say('HQ', 'נקישה על הגג של הבית הדרומי: תחמושת אזהרה קטנה, בלי מטען נפץ. מחכים שייצא.'); this.riskAdd(6);
    after(14, () => { if (!this.holdout()) return; for (const b of h.blobs) b.userData.gone = true; const door = TL.N2.door; const old = new Actor('civM2', 'civ', P2(door[0], door[1]), 0, {}); old.role = 'resident'; old.brain = () => {}; old.hurt = true; old.setPath([P2(-110, 60), P2(-150, 70), P2(TL.gather.x, TL.gather.z + 3)], 1.4, () => { old.idleAnim = 'nervous'; }); this.escorted = true; this.addIntel('מפעילת "זיק"', 'הקשיש יצא מהבית הדרומי והולך מערבה.'); });
    return true;
  }
  withdraw() {
    if (!this.charged) return 'קודם להניח מטענים'; if (this.phase === 'withdraw' || this.out) return 'הכוח כבר יוצא';
    this.phase = 'withdraw'; this.stageSet(3); const who = this.alive().filter(a => (!a.down || a.treated) && !a.x2); for (const a of who) { a.inside = false; a.insideB = false; a.root.visible = true; a.noSnap = false; }
    if (this.dog) { this.dog.path = [P2(-112, 9), P2(-70, 9.5), P2(-42, 10.5)]; this.dog.i = 0; this.dog.v = 4.4; }
    const dt2 = this.detainee; if (ok(dt2)) { dt2.forceAnim = null; dt2.setPath(ROUTES.out.map(([x, z]) => P2(x, z + 2)), 3.4, () => { dt2.forceAnim = 'crouch'; }); }
    say('NAH', '"נחש" ו"פטיש" יוצאים מהרדיוס, לנקודת הכינוס ברחוב. העצור איתנו.'); this.moveTeam(ROUTES.out, 4.4, () => { this.out = true; this.phase = 'ready'; this.stageSet(4); for (const a of this.alive()) a.lookAt = P2(TL.B.x, TL.B.z); say('NAH', 'כולם בחוץ, 78 מטר מהבית. מוכנים.'); }, who);
    return true;
  }
  blast() {
    if (!this.charged) return 'אין מטענים בפיר'; if (this.blown) return 'כבר פוצץ';
    this.blown = true; this.phase = 'blast'; this.stageSet(4); const p = P2(TL.B.x, TL.B.z);
    say('PAT', 'שלוש, שתיים, אחת. הפעלה.');
    after(3, () => { G.fx.explosion(p.clone().add(V3(0, 2, 0)), 3); G.fx.explosion(p.clone().add(V3(-6, 1, 3)), 2); G.audio.explosion(p, 2); G.ui.flash(.25); G.collapse = { t: 0 }; G.genOff = true; if (this.chargeMesh) this.chargeMesh.visible = false; if (this.robot) { this.robot.m.visible = false; this.robot.on = false; }
      const r = this.harm(p, TL.radius); this.st.shaft = true;
      if (this.x2Ready) { const x = P2(TL.X2.x, TL.X2.z); after(.5, () => { G.fx.explosion(x.clone().add(V3(0, 1, 0)), 1.6); G.audio.explosion(x, 1.2); G.fx.dustBurst(x, 3, 40); this.harm(x, 8); this.st.x2 = true; }); }
      if (r.civ) this.notify('אזרחים נפגעו בפיצוץ', `${r.civ} אזרחים היו בתוך רדיוס הבטיחות.`, true);
      if (r.team) this.notify('לוחמים נפגעו בפיצוץ', 'חלק מהכוח היה בתוך רדיוס הבטיחות.', true);
      this.addIntel('מפעילת "זיק"', 'הפיר קרס. הבית שקע לתוך הבור, עמוד אבק גבוה מעל השכונה. המנהרה מתחתיו התמוטטה' + (this.x2Ready ? ', וגם הפתח השני במחסן קרס.' : '. בפתח השני במחסן אין שינוי.')); say('ZIK', this.x2Ready ? 'הפיר קרס, וגם הפתח השני. עמוד אבק מעל השכונה.' : 'הפיר קרס. הבית שקע לבור. עמוד אבק מעל השכונה.');
      this.at(7, () => this.spawnShooter()); });
    return true;
  }
  // ---------- phase 4: extraction under fire ----------
  spawnShooter() {
    this.phase = 'extract'; this.stageSet(5); const h = G.houses.W;
    const a = new Actor('fighter', 'guard', V3(h.o.x + 4, h.top, h.o.z - 2), Math.PI / 2, { rifle: 'ak' }); a.hostile = false; a.noSnap = true; a.role = 'shooter'; a.armed = true; a.militant = true; a.brain = () => { a.faceTo(this.teamPos()); a.aiming = true; };
    this.shooter = a; this.shootT = 0; this.setThreat('fire');
    this.notify('ירי על הכוח', 'ירי מגג הבית בצפון־מערב, 120 מ׳ מנקודת הכינוס. מסך עשן ונמר לאיסוף, או פגז לעמדת הירי.', true); say('NAH', 'יורים עלינו מגג בצפון־מערב! צריכים עשן ואיסוף.');
    this.objective('חילוץ תחת אש', 'להוציא את הכוח: מסך עשן, הנמר לאיסוף, ופגז לעמדת הירי אם צריך.');
  }
  shooterUpdate(dt) {
    const a = this.shooter; if (!ok(a)) { this.shooter = null; this.setThreat('fire', false); if (a && !a.alive) this.st.prevented.push('עמדת הירי נוטרלה'); return; }
    if (this.boarded) return; this.shootT += dt; a.fireT = (a.fireT || 1.5) - dt;
    if (a.fireT <= 0) { a.fireT = rr(1.2, 2.4); const from = a.eye(new THREE.Vector3()); const tgts = this.alive().filter(x => x.root.visible); if (!tgts.length) return; const t = tgts[Math.floor(Math.random() * tgts.length)]; const to = t.pos.clone().add(V3(rr(-3, 3), rr(.2, 1.5), rr(-3, 3)));
      G.fx.muzzle(from, to.clone().sub(from).normalize(), 1); G.audio.shotAt(from, 'ak'); G.fx.tracer(from, to, true); G.fx.impact(V3(to.x, hT(to.x, to.z), to.z), V3(0, 1, 0), 'sand');
      const smoked = this.smokeT > 0 && t.pos.distanceTo(this.smokeP) < 16; if (!smoked && this.shootT > 24 && !this._shotHit) { this._shotHit = true; t.damage(60, from, 'legs'); } }
  }
  smoke(p = null) { const u = this.U.smoke; if (u.n <= 0) return 'נגמרו רימוני העשן'; if (this.smokeT > 4) return 'מסך העשן עדיין פעיל'; u.n--; this.smokeT = 40; this.smokeP = (p || this.teamPos()).clone(); say('NAH', 'זורקים עשן!'); G.audio.playS('dry', { vol: .4, rate: .7 }); return true; }
  pickup() {
    const u = this.U.apc; if (u.busy) return 'הנמר כבר בדרך'; if (this.phase !== 'extract' && this.phase !== 'ready') return 'הנמר יוצא רק לחילוץ';
    u.busy = true; say('NAH', 'נמר יוצא לאיסוף מנקודת הכינוס.');
    const v = G.apc; v.followPath([v.obj.position.clone(), V3(40, 0, 10), V3(-10, 0, 10), V3(-30, 0, 9)], 9, () => {
      v.rampOpen = true; let n = 0; const al = this.alive(); const rear = V3(-24, 0, 9);
      const dt2 = this.detainee; if (ok(dt2)) { dt2.forceAnim = null; dt2.setPath([rear], 2.4, () => { dt2.root.visible = false; dt2.noSnap = true; }); } if (this.dog) { this.dog.path = [rear.clone()]; this.dog.i = 0; this.dog.onEnd = () => { this.dog.obj.visible = false; }; }
      al.forEach((a, i) => after(i * .5, () => { a.lookAt = null; a.setPath([rear], a.down ? 1 : 3, () => { a.root.visible = false; a.noSnap = true; a.inside = true; if (++n === al.length) this.boardDone(); }); }));
    });
    return true;
  }
  boardDone() { this.boarded = true; const v = G.apc; v.rampOpen = false; say('NAH', 'כולם בנמר. יוצאים.'); after(1.5, () => v.followPath([v.obj.position.clone(), V3(10, 0, 10), V3(60, 0, 10), V3(78, 0, 4)], 9, () => this.finish())); }
  // ---------- orders (from the task card, the bar and the tablet) ----------
  order(uid, action, arg) {
    if (G.state !== 'play') return false;
    switch (uid) {
      case 'zik': case 'tank': case 'air': return this.requestStrike(uid, arg);
      case 'smoke': return this.smoke();
      case 'spk': return this.phase === 'shaft' || this.phase === 'withdraw' || this.phase === 'ready' ? this.warnNeighbours() : 'אין עדיין את מי להזהיר';
      case 'apc': return this.pickup();
      case 'robot': return this.sendRobot();
    }
    return false;
  }
  posOf(t) { return t.isVector3 ? t : t.root ? t.pos : V3(t.x, t.y, t.z); }
  lookAt(t, ir = null) { G.tablet && G.tablet.show('drone'); const p = this.posOf(t); G.drone.target.copy(p); G.drone.fov = G.drone.fovT = t.root ? 3.6 : 7; if (ir !== null) G.drone.ir = ir; if (t.root) G.tablet.mark(t, true); }
  // ---------- the task card ----------
  setThreat(id, on = true) { const T = this.threats || (this.threats = {}); if (on) T[id] = T[id] || G.time; else delete T[id]; }
  refreshTask(force = false) {
    if (!G.command || G.state !== 'play') return; const t = this.taskNow(); const sig = t.title + '|' + t.text.length + '|' + t.acts.map(a => a.label).join(',');
    if (sig === this._taskSig && !force) return; this._taskSig = sig; G.command.setTask(t);
  }
  taskNow() {
    const U = this.U; const H = id => G.houses[id];
    const eye = (o, ir = null, label = 'הראה ב"זיק"') => ({ icon: 'eye', label, cls: 'alt', fn: () => this.lookAt(o, ir) });
    const body = (label = 'מצלמות הכוח') => ({ icon: 'eye', label, cls: 'alt', fn: () => G.tablet.show('body') });
    const rob = (label = 'פיד הרובוט') => ({ icon: 'robot', label, fn: () => G.tablet.show('robot') });
    if (this.propOpen) return { kind: 'החלטה', threat: true, title: 'כרטיס מידתיות', text: 'בדוק את הכרטיס לפני אישור התקיפה.', acts: [] };
    // threats first
    if (this.sniper && ok(this.sniper)) { const a = this.sniper; if (a.struck) return { kind: 'איום', threat: true, title: 'תקיפה בדרך לגג', text: 'החימוש בדרך. בבית מתחת לצלף יש משפחה.', acts: [eye(a)] };
      return { kind: 'איום', threat: true, title: 'צלף על גג בית מאוכלס', text: this.smokeT > 4 ? 'מסך העשן מסתיר את הדלת. השומרים בפנים. עקוב אחרי הצלף.' : 'צלף יורה על השומרים בדלת. מתחתיו, בבית, חמישה אנשים (תרמי). עשן ומחסה, לא תקיפה.', hot: 'smoke',
        acts: this.smokeT > 4 ? [eye(a, true, 'עקוב בתרמי')] : [{ icon: 'smoke', label: 'עשן, השומרים למחסה', fn: () => this.sniperCover() }, eye(a, true, 'בתרמי: מי בבית'), { icon: 'zik', label: 'תקיפת "זיק"', cls: 'danger', fn: () => this.requestStrike('zik', a) }] }; }
    if (this.shooter && ok(this.shooter) && !this.boarded) return { kind: 'איום', threat: true, title: 'ירי על הכוח בנקודת הכינוס', text: 'חמוש על גג בצפון־מערב יורה על הכוח. מסך עשן מסתיר אותם והנמר אוסף אותם. הבית שלו ריק, אז אפשר גם פגז.', hot: 'smoke',
      acts: [{ icon: 'smoke', label: this.smokeT > 4 ? 'נמר לאיסוף' : 'עשן ונמר לאיסוף', fn: () => { if (this.smokeT <= 4) this.smoke(); return this.U.apc.busy ? true : this.pickup(); } }, { icon: 'tank', label: 'פגז לעמדת הירי', cls: 'danger', fn: () => this.requestStrike('tank', this.shooter) }, eye(this.shooter)] };
    const inbound = a => ({ kind: 'איום', threat: true, title: 'תקיפה בדרך ליעד', text: a.struck === 'air' ? 'הסיוע האווירי בדרך. עקוב ב"זיק" שהיעד לא נכנס בין בתים.' : 'החימוש בדרך. עקוב ב"זיק".', acts: [eye(a, null, 'עקוב ב"זיק"')] });
    if (this.cell && !this.cell.fired) { const z = this.cellZone(); const a = this.cell.men.find(ok); if (a && this.cell.men.some(m => m.struck && m.struck !== 'air')) return inbound(this.cell.men.find(m => m.struck));
      if (z === 'open') return { kind: 'איום', threat: true, title: 'חוליית ה־RPG בשטח פתוח', text: 'החמושים חוצים מגרש ריק, אין אזרחים בסביבה. זה החלון לתקוף: "זיק" מדויק, או פגז. תקיפה אווירית תגיע מאוחר מדי.', hot: 'zik',
        acts: [...(U.zik.ammo > 0 && !U.zik.pending && U.zik.cd <= 0 ? [{ icon: 'zik', label: 'תקיפת "זיק"', fn: () => this.requestStrike('zik', a) }, { icon: 'tank', label: 'פגז טנק', cls: 'alt', fn: () => this.requestStrike('tank', a) }] : [{ icon: 'tank', label: 'פגז טנק', fn: () => this.requestStrike('tank', a) }]), { icon: 'air', label: 'סיוע אווירי', cls: 'danger', fn: () => this.requestStrike('air', a) }] };
      if (z === 'ambush') return { kind: 'איום', threat: true, title: 'חוליית ה־RPG במארב', text: `החמושים כורעים ליד ${HN[this.nearOccupied(a.pos, 20)] || 'בית'} שיש בו משפחה. תקיפה כאן תפגע בה. מסך עשן יסתיר את הכוח.`, hot: 'smoke',
        acts: [{ icon: 'smoke', label: 'מסך עשן לכוח', fn: () => this.smoke() }, eye(a), { icon: 'zik', label: 'תקיפת "זיק"', cls: 'danger', fn: () => this.requestStrike('zik', a) }] };
      if (z === 'houses') return { kind: 'איום', threat: true, title: 'חוליית ה־RPG ליד בתים', text: 'החמושים עוברים ליד בית מאוכלס. לא תוקפים כאן. אם הם מתמקמים, מסך עשן יגן על הכוח.', acts: [eye(a, null, 'עקוב ב"זיק"'), { icon: 'smoke', label: 'מסך עשן לכוח', cls: 'alt', fn: () => this.smoke() }] };
      if (z === 'alley') return { kind: 'איום', threat: true, title: 'חוליית RPG בסמטאות', text: 'שני חמושים נעים בין הבתים לעבר הכוח. עקוב אחריהם ב"זיק" וחכה שייצאו לשטח פתוח.', acts: [eye(a, null, 'עקוב ב"זיק"')] }; }
    if (this.watcher && ok(this.watcher) && !this.watcher.resolved) { const w = this.watcher;
      if (!w.idd) return { kind: 'זיהוי', threat: true, title: 'מי על הגג?', text: 'דמות על גג וצופה בכוח. אין עדיין זיהוי. קרב את "זיק" אליו וחכה לזיהוי: נשק או טלפון.', acts: [{ icon: 'eye', label: 'זהה ב"זיק"', fn: () => this.lookAt(w, false) }, { icon: 'zik', label: 'תקיפה בלי זיהוי', cls: 'danger', fn: () => this.requestStrike('zik', w) }] };
      if (w.armed && w.struck) return inbound(w);
      if (w.armed) { const z = { icon: 'zik', label: 'תקיפת "זיק"', fn: () => this.requestStrike('zik', w) }, t = { icon: 'tank', label: 'פגז טנק', fn: () => this.requestStrike('tank', w) };
        return { kind: 'איום', threat: true, title: 'תצפיתן חמוש על הגג', text: 'זיהוי ודאי: רובה ומכשיר קשר. אין אזרחים על הגג. "זיק" מדויק או פגז ינטרלו אותו לפני שידווח על הכוח.', hot: 'zik', acts: U.zik.ammo > 0 && !U.zik.pending && U.zik.cd <= 0 ? [z, { ...t, cls: 'alt' }] : [t, { ...z, cls: 'alt' }] }; }
      return { kind: 'זיהוי', title: 'על הגג: אזרח עם טלפון', text: 'אין נשק. אדם שעלה לגג עם הטלפון. לא תוקפים. ממשיכים לעקוב.', acts: [{ icon: 'eye', label: 'המשך מעקב, בלי אש', fn: () => { w.resolved = true; this.st.prevented.push('האדם על הגג זוהה כאזרח ולא הותקף'); this.setThreat('watcher', false); return true; } }, { icon: 'zik', label: 'תקוף בכל זאת', cls: 'danger', fn: () => this.requestStrike('zik', w) }] }; }
    // the phase's own next step
    switch (this.phase) {
      case 'search': case 'choose': {
        const nxt = this.phase === 'search' && ['A', 'B', 'C'].find(id => !this.clues[id].eo);
        if (nxt) return { kind: 'משימה', title: `בדוק את ${HN[nxt]}`, text: 'החזק את "זיק" על הבית ובחן אותו ביום. חפש חול טרי, כבלים וגנרטור.', hot: 'zik', acts: [{ icon: 'eye', label: `הראה ב"זיק": ${HN[nxt]}`, fn: () => this.lookAt(H(nxt).center, false) }, { icon: 'tab', label: 'טאבלט', cls: 'alt', fn: () => G.tablet.show('drone') }] };
        if (this.phase === 'search' && !this.clues.B.ir) return { kind: 'משימה', title: 'בית ב׳ בתרמי', text: 'בבית ב׳ יש חול טרי, כבל וגנרטור. בתרמי רואים אם יש חום מהקרקע.', hot: 'zik', acts: [{ icon: 'eye', label: 'תרמי על בית ב׳', fn: () => this.lookAt(H('B').center, true) }, { icon: 'eye', label: 'תרמי על בית א׳', cls: 'alt', fn: () => this.lookAt(H('A').center, true) }] };
        const opts = ['B', 'A', 'C'].filter(id => !this.searched[id] && id !== this.where);
        return { kind: 'החלטה', title: 'לאן שולחים את הכוח?', text: this.clues.B.ir ? 'בבית ב׳: חול טרי, כבל, גנרטור וחום מחלון המטבח. בבית א׳ משפחה, ובית ג׳ קר וריק.' : 'בחר בית לפשיטה. כל בית שגוי עולה בזמן ומעלה את הסיכון.', acts: opts.map((id, i) => ({ icon: 'force', label: `שלח ל${HN[id]}`, cls: i ? 'alt' : '', fn: () => this.sendTo(id) })) }; }
      case 'moving': return { kind: 'מצב', title: 'הכוח בתנועה', text: (this.calm && this.calm.text) || '', acts: [{ icon: 'eye', label: 'עקוב ב"זיק"', fn: () => this.lookAt(this.teamPos()) }, body('מצלמת גוף')] };
      case 'breach': return { kind: 'החלטה', title: 'פריצת הדלת של בית ב׳', text: 'שקטה: חיתוך המנעול, כמה שניות יותר, השכונה ישנה. בפיצוץ: מהיר, אבל ליד בית עם ילדים ומעיר את כל הרחוב.', acts: [{ icon: 'force', label: 'פריצה שקטה', fn: () => this.breach('quiet') }, { icon: 'blast', label: 'מטען פריצה', cls: 'danger', fn: () => this.breach('loud') }, body()] };
      case 'breaching': return { kind: 'מצב', title: 'פורצים…', text: 'צפה בפריצה דרך מצלמת הגוף.', acts: [body('מצלמת גוף')] };
      case 'entry': return { kind: 'החלטה', title: 'מי נכנס ראשון?', text: 'בבית אמורים להיות שני אנשים (תרמי). כלב "עוקץ" מהיר ומאתר מסתתרים. "חולד" איטי יותר, אבל ממשיך ישר לפיר. לוחמים שנכנסים ראשונים חשופים.', acts: [{ icon: 'force', label: 'כלב "עוקץ"', fn: () => this.entry('dog') }, { icon: 'robot', label: 'רובוט "חולד"', cls: 'alt', fn: () => this.entry('robot') }, { icon: 'force', label: 'הלוחמים נכנסים', cls: 'danger', fn: () => this.entry('men') }] };
      case 'entering': return { kind: 'מצב', title: this.entryKind === 'dog' ? 'הכלב בפנים…' : this.entryKind === 'robot' ? '"חולד" סורק…' : 'הלוחמים נכנסים…', text: 'עקוב במצלמות.', acts: [this.entryKind === 'robot' ? rob() : body('מצלמת גוף')] };
      case 'route': return { kind: 'החלטה', title: 'מסלול לבית ב׳', text: 'דרך המטע: מחופה, ארוכה יותר. ברחוב הפתוח: מהיר, אבל הכוח חשוף לגגות ולסמטאות.', acts: [{ icon: 'force', label: 'דרך המטע (מחופה)', fn: () => { this.phase = 'search'; return this.sendTo('B', 'cover'); } }, { icon: 'force', label: 'ברחוב (מהיר)', cls: 'alt', fn: () => { this.phase = 'search'; return this.sendTo('B', 'fast'); } }] };
      case 'shaft': {
        if (!this.trapFound && !this.robotBusy) return { kind: 'משימה', title: 'הפיר נמצא', text: this.robot && this.robot.hold ? '"חולד" כבר על שפת הפיר. הוא יורד על הכננת ומחפש מלכודים לפני שמישהו יורד.' : 'לפני שמישהו יורד: רובוט "חולד" נכנס, יורד על הכננת ומחפש מלכודים.', hot: 'robot', acts: [{ icon: 'robot', label: this.robot && this.robot.hold ? '"חולד" יורד לפיר' : 'שלח רובוט לפיר', fn: () => this.sendRobot() }, { icon: 'force', label: 'לוחם יורד בסולם', cls: 'danger', fn: () => this.sendSoldierDown() }, body()] };
        if (this.robotBusy) return { kind: 'מצב', title: this.trapFound ? '"חולד" ממשיך לתחתית' : '"חולד" בפיר', text: this.trapFound ? 'המלכוד סומן. הרובוט יורד לתחתית ובודק לאן המנהרה ממשיכה.' : 'הרובוט נוסע לפיר ויורד על הכננת. צפה בפיד שלו.', acts: [rob(), body()] };
        if (this.x2Known && !this.x2Sent) return { kind: 'החלטה', title: 'פתח שני למנהרה', text: 'הענף הצפוני מוביל לפתח שני במחסן הרוס, 19 מ׳ מבית מאוכלס. בלי לאטום אותו, המנהרה ממשיכה לחיות.', acts: [{ icon: 'force', label: 'צוות ומטען לפתח השני', fn: () => this.sealX2() }, eye(P2(TL.X2.x, TL.X2.z), true, 'הראה ב"זיק"'), { icon: 'air', label: 'תקיפה אווירית', cls: 'danger', fn: () => this.requestStrike('air', this.x2P) }] };
        if (!this.charged && !this.charging) return { kind: 'משימה', title: 'מטענים לפיר', text: 'המלכוד מסומן. צוות "פטיש" מוריד מטענים בכננת לתחתית הפיר.', acts: [{ icon: 'force', label: 'הנח מטענים', fn: () => this.placeCharges() }, body()] };
        if (!this.warned) return { kind: 'משימה', title: 'פינוי השכנים', text: 'שני בתים מאוכלסים בתוך רדיוס 45 מ׳. כריזה בערבית ושיחות טלפון לבתים: לצאת מערבה.', hot: 'spk', acts: [{ icon: 'spk', label: 'כריזה ואזהרה בטלפון', fn: () => this.warnNeighbours() }, eye(P2(TL.B.x, TL.B.z), true, 'בתרמי: מי בבתים')] };
        if (this.holdout() && this.holdoutKnown && !this.escorting && !this.knocked) return { kind: 'משימה', title: 'אדם נשאר בבית הדרומי', text: 'בתרמי: אדם אחד עדיין בבית הדרומי, בתוך הרדיוס. שני לוחמים יכולים להוציא אותו בעדינות.', acts: [{ icon: 'force', label: 'שלח לוחמים להוציא אותו', fn: () => this.escortHoldout() }, eye(H('N2').center, true, 'בדוק בתרמי'), { icon: 'air', label: 'נקישה על הגג', cls: 'alt', fn: () => this.roofKnock() }] };
        if (this.charging || (this.holdout() && !this.holdoutKnown) || (this.escorting && !this.escorted) || (this.knocked && !this.escorted) || (this.x2Sent && !this.x2Air && !this.x2Ready)) return { kind: 'מצב', title: this.charging ? 'מורידים מטענים…' : this.x2Sent && !this.x2Ready && !this.x2Air ? 'ממלכדים את הפתח השני…' : 'השכנים יוצאים…', text: 'עקוב במצלמות ובתרמי שהבתים ברדיוס מתרוקנים.', acts: [eye(P2(TL.B.x, TL.B.z), true, 'תרמי על הרדיוס'), body()] };
        return { kind: 'משימה', title: 'להרחיק את הכוח', text: 'המטענים מוכנים והבתים ריקים. הכוח יוצא לנקודת הכינוס, 78 מ׳ מהבית.', acts: [{ icon: 'force', label: 'הוצא את הכוח מהרדיוס', fn: () => this.withdraw() }] }; }
      case 'withdraw': return { kind: 'מצב', title: 'הכוח יוצא מהרדיוס', text: 'מחכים שכולם יגיעו לנקודת הכינוס.', acts: [eye(this.teamPos())] };
      case 'ready': { if (this.x2Sent && !this.x2Air && !this.x2Home) return { kind: 'מצב', title: 'מחכים לצוות מהפתח השני', text: '"נחש 3" ו"פטיש 3" חוזרים מחוץ לרדיוס.', acts: [eye(this.team[2] && this.team[2].pos || this.teamPos())] };
        const inR = this.civsNear(P2(TL.B.x, TL.B.z), TL.radius).length + ['N1', 'N2'].reduce((s, id) => s + G.houses[id].blobs.filter(b => !b.userData.gone).length, 0);
        return { kind: 'החלטה', threat: inR > 0, title: 'לפוצץ את הפיר', text: inR ? `שים לב: ${inR} אנשים עדיין בתוך הרדיוס!` : 'הכוח מחוץ לרדיוס, הבתים ריקים. "זיק" מצלם את הבית.', acts: [{ icon: 'blast', label: 'פוצץ', cls: inR ? 'danger' : '', fn: () => { this.lookAt(P2(TL.B.x, TL.B.z), false); G.drone.fov = G.drone.fovT = 12; return this.blast(); } }, eye(P2(TL.B.x, TL.B.z), true, 'בדוק בתרמי')] }; }
      case 'blast': return { kind: 'מצב', title: 'הפיר פוצץ', text: 'האבק שוקע. הכוח מתכונן לחזור.', acts: [eye(P2(TL.B.x, TL.B.z))] };
      case 'extract': return { kind: 'מצב', title: 'חילוץ', text: this.U.apc.busy ? 'הנמר בדרך לאסוף את הכוח.' : 'הנמר יוצא לאסוף את הכוח.', acts: this.U.apc.busy ? [eye(G.apc.obj.position)] : [{ icon: 'apc', label: 'נמר לאיסוף', fn: () => this.pickup() }] };
    }
    return { kind: 'מצב', title: (this.calm && this.calm.title) || '', text: (this.calm && this.calm.text) || '', acts: [{ icon: 'eye', label: 'עקוב אחרי הכוח', fn: () => this.lookAt(this.teamPos()) }, { icon: 'tab', label: 'טאבלט', cls: 'alt', fn: () => G.tablet.show('drone') }] };
  }
  // ---------- markers in the main view ----------
  markers() {
    const L = [];
    if (this.phase === 'search' || this.phase === 'choose' || this.phase === 'route') for (const id of ['A', 'B', 'C']) if (!this.searched[id]) { const h = G.houses[id]; L.push({ id: 'h' + id, pos: V3(h.o.x, h.top + 2, h.o.z), label: HN[id], kind: 'unit', h: 0 }); }
    if (this.radiusOn && !this.blown) { const h = G.houses.B; L.push({ id: 'hB', pos: V3(h.o.x, h.top + 2, h.o.z), label: 'הפיר', kind: 'unit warn', h: 0 }); }
    const tp = this.teamPos(); if (this.alive().some(a => a.root.visible)) L.push({ id: 'team', pos: tp, label: '"נחש"', kind: 'unit', h: 2.3 });
    if (this.watcher && ok(this.watcher) && !this.watcher.resolved) L.push({ id: 'w', pos: this.watcher.pos, label: this.watcher.idd ? (this.watcher.armed ? 'תצפיתן חמוש' : 'אזרח') : 'דמות על גג', kind: this.watcher.idd && !this.watcher.armed ? 'unit' : 'threat' });
    if (this.cell) { const a = this.cell.men.find(ok); if (a) L.push({ id: 'rpg', pos: a.pos, label: 'RPG', kind: 'threat' }); }
    if (this.sniper && ok(this.sniper)) L.push({ id: 'sn', pos: this.sniper.pos, label: 'צלף', kind: 'threat' });
    if (this.x2Known && !this.blown) L.push({ id: 'x2', pos: V3(TL.X2.x, 0, TL.X2.z), label: this.x2Ready ? 'פתח שני · ממולכד' : 'פתח שני', kind: 'unit warn', h: 2.5 });
    if (this.shooter && ok(this.shooter)) L.push({ id: 'sh', pos: this.shooter.pos, label: 'ירי', kind: 'threat' });
    if (this.U && this.U.apc.busy) L.push({ id: 'apc', pos: G.apc.obj.position, label: 'נמר', kind: 'unit', h: 3.4 });
    return L;
  }
  // ---------- intel & notifications ----------
  addIntel(from, text, red = false) { const it = { t: G.missionClock, from, text, red, isNew: true }; this.intel.unshift(it); G.tablet && G.tablet.onIntel(it); this.notify(from, text, red, true); }
  notify(h, text, red, intel = false) { const n = $('notif'); if (!n) return; $('notifH').textContent = h; $('notifT').textContent = text; n.className = 'on' + (red ? ' red' : ''); n.onclick = () => G.tablet && G.tablet.show(intel ? 'intel' : 'drone'); clearTimeout(this._nt); this._nt = setTimeout(() => n.className = '', red ? 9000 : 6500); if (G.tablet) G.tablet.toast(h, text, red); }
  // ---------- identification (tablet) ----------
  identify(o) {
    if (o === this.x2P) return { name: 'הפתח השני (מחסן הרוס)', desc: 'פיר שני של המנהרה, 19 מ׳ מבית מאוכלס.', threat: false };
    if (o.isVector3) return { name: 'נקודה', desc: '', threat: false };
    if (o.friendly) return { name: o.name || 'כוח שלנו', desc: o.eng ? 'חבלן מצוות ההנדסה.' : 'לוחם קומנדו.', threat: false, unit: true };
    const r = o.role;
    if (r === 'watcher') return o.idd ? (o.armed ? { name: 'תצפיתן חמוש', desc: 'רובה על המעקה ומכשיר קשר. מדווח על הכוח.', threat: true } : { name: 'אזרח עם טלפון', desc: 'אין נשק. תושב שעלה לגג. לא איום.', threat: false }) : { name: 'דמות על גג', desc: 'אין עדיין זיהוי. החזק את "זיק" עליו, בזום, עד לזיהוי.', threat: false };
    if (r === 'rpg') return { name: 'חמוש · חוליית נ״ט', desc: o === (this.cell && this.cell.men[0]) ? 'נושא מטול RPG.' : 'חמוש ברובה, מלווה את נושא המטול.', threat: true };
    if (r === 'shooter') return { name: 'חמוש יורה', desc: 'יורה על הכוח מגג. הבית מתחתיו ריק.', threat: true };
    if (r === 'sniper') return { name: 'צלף', desc: 'יורה על השומרים בדלת של בית ב׳, מגג של בית שגרה בו משפחה.', threat: true };
    if (r === 'hidden') return { name: 'דמות בתוך בית ב׳', desc: 'מסתתר בחדר המזרחי.', threat: false };
    if (r === 'detainee') return { name: 'עצור', desc: 'חמוש שנכנע בבית ב׳. בידי הכוח.', threat: false };
    if (r === 'resident') return { name: 'תושב', desc: 'יצא מהבית אחרי האזהרה. לא איום.', threat: false };
    return { name: 'אזרח', desc: 'לא איום.', threat: false };
  }
  // ---------- tablet map ----------
  drawMap(g, W, H, v = {}) {
    const x0 = v.x0 ?? -300, x1 = v.x1 ?? 150; const zc = v.zc ?? 10; const span = (x1 - x0) * H / W; const z0 = zc - span / 2;
    const px = x => (x - x0) / (x1 - x0) * W, pz = z => (z - z0) / span * H, ps = d => d / (x1 - x0) * W; this._map = { x0, x1, z0, span, W, H };
    g.fillStyle = '#1b1c18'; g.fillRect(0, 0, W, H); g.fillStyle = '#23241c'; g.fillRect(px(-40), 0, W - px(-40), H);
    g.strokeStyle = 'rgba(232,220,196,.06)'; g.lineWidth = 1; for (let x = Math.ceil(x0 / 50) * 50; x < x1; x += 50) { g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), H); g.stroke(); } for (let z = Math.ceil(z0 / 50) * 50; z < z0 + span; z += 50) { g.beginPath(); g.moveTo(0, pz(z)); g.lineTo(W, pz(z)); g.stroke(); }
    // grove and streets
    g.fillStyle = 'rgba(110,130,80,.22)'; g.fillRect(px(-30), pz(-96), px(62) - px(-30), pz(-40) - pz(-96));
    g.strokeStyle = 'rgba(200,190,170,.18)'; g.lineWidth = Math.max(2, ps(6)); g.beginPath(); g.moveTo(px(-62), 0); g.lineTo(px(-62), H); g.moveTo(px(-150), pz(9)); g.lineTo(px(70), pz(9)); g.stroke();
    // houses
    g.fillStyle = 'rgba(160,150,130,.35)'; for (const [x, z, w, d, ry] of G.footprints || []) { g.save(); g.translate(px(x), pz(z)); g.rotate(-(ry || 0)); g.fillRect(-ps(w) / 2, -ps(d) / 2, ps(w), ps(d)); g.restore(); }
    for (const id of Object.keys(G.houses || {})) { const h = G.houses[id]; const occ = h.blobs && h.blobs.some(b => !b.userData.gone); const cand = ['A', 'B', 'C'].includes(id);
      g.fillStyle = id === 'B' && this.blown ? '#5a4e40' : cand ? 'rgba(242,184,75,.55)' : occ && this.radiusOn ? 'rgba(224,83,61,.5)' : 'rgba(170,160,140,.55)'; g.fillRect(px(h.o.x - h.o.w / 2), pz(h.o.z - h.o.d / 2), ps(h.o.w), ps(h.o.d));
      if (cand || (this.radiusOn && (id === 'N1' || id === 'N2'))) { g.fillStyle = '#e8dcc4'; g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText(cand ? HN[id].replace('בית ', '') : (occ ? 'מאוכלס' : 'ריק'), px(h.o.x), pz(h.o.z - h.o.d / 2) - 4); } }
    if (this.radiusOn) { g.strokeStyle = this.blown ? 'rgba(232,220,196,.25)' : '#e0533d'; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.beginPath(); g.arc(px(TL.B.x), pz(TL.B.z), ps(TL.radius), 0, 7); g.stroke(); g.setLineDash([]); }
    if (v.brief) { g.strokeStyle = 'rgba(154,192,230,.6)'; g.setLineDash([4, 4]); for (const r of [ROUTES.cover, ROUTES.fast]) { g.beginPath(); r.forEach(([x, z], i) => i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))); g.stroke(); } g.setLineDash([]); }
    const dot = (p, col, lbl, r = 3) => { g.fillStyle = col; g.beginPath(); g.arc(px(p.x), pz(p.z), r, 0, 7); g.fill(); if (lbl) { g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText(lbl, px(p.x), pz(p.z) - 7); } };
    for (const a of G.actors) { if (!a.alive || a.removed || (!a.root.visible && !a.inside)) continue; if (a.friendly) dot(a.pos, a.down ? '#e0533d' : '#9ac0e6', null, 3); else if (a.kind === 'civ' && a.role === 'resident') dot(a.pos, '#e8dcc4', null, 2.5); }
    for (const m of (G.tablet && G.tablet.marks) || []) { const o = m.obj; if (o.root && (!o.alive || o.removed)) continue; dot(this.posOf(o), m.threat ? '#ff6a50' : '#f2b84b', m.label, 4); }
    for (const v2 of G.vehicles || []) { const p = v2.obj.position; g.strokeStyle = '#9ac0e6'; g.lineWidth = 2; g.strokeRect(px(p.x) - 5, pz(p.z) - 3, 10, 6); }
    g.fillStyle = '#f2b84b'; g.beginPath(); g.arc(px(G.player.pos.x), pz(G.player.pos.z), 5, 0, 7); g.fill(); g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText('אתה', px(G.player.pos.x), pz(G.player.pos.z) + 16);
    if (G.drone) { const d = G.drone.target; g.strokeStyle = '#e8f0e0'; g.lineWidth = 1.5; g.beginPath(); g.arc(px(d.x), pz(d.z), 9, 0, 7); g.stroke(); g.beginPath(); g.moveTo(px(d.x) - 14, pz(d.z)); g.lineTo(px(d.x) + 14, pz(d.z)); g.moveTo(px(d.x), pz(d.z) - 14); g.lineTo(px(d.x), pz(d.z) + 14); g.stroke(); }
    g.fillStyle = 'rgba(232,220,196,.6)'; g.font = '12px Heebo'; g.textAlign = 'right'; g.fillText('שכונה', px(-150), 18); g.textAlign = 'left'; g.fillText('שטח פתוח · מטע', px(-20), 18);
    if (v.brief) { g.fillStyle = '#9ac0e6'; g.textAlign = 'center'; g.fillText('נמר פיקודי', px(TL.cmd.x), pz(TL.cmd.z) + 18); g.fillText('מאסף', px(TL.stage.x), pz(TL.stage.z) + 20); }
  }
  // ---------- end ----------
  finish() {
    if (G.state !== 'play') return; this.phase = 'done'; G.stats.end = performance.now(); stopVoice();
    bus.emit('missionComplete', {});
  }
  fillEnd() {
    const s = this.st; const secs = Math.round((G.stats.end - G.stats.start) / 1000);
    $('st-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; $('st-shaft').textContent = s.shaft ? 'הושמד' : 'לא'; $('st-idf').textContent = s.teamHurt; $('st-civ').textContent = s.civHurt;
    const x2 = !!s.x2; const perfect = s.shaft && x2 && s.teamHurt === 0 && s.civHurt === 0;
    $('endGrade').innerHTML = perfect ? 'הפיר הושמד ואף אחד לא נפגע.<small>הבית הנכון, זיהוי לפני אש, פינוי לפני פיצוץ. זו המטרה.</small>'
      : s.civHurt ? 'הפיר ' + (s.shaft ? 'הושמד' : 'לא הושמד') + ', אבל אזרחים נפגעו.<small>פגיעה באזרחים היא כישלון, גם כשהמשימה הושלמה. בדוק לפני כל אש ולפני כל פיצוץ מי נמצא ברדיוס.</small>'
      : s.teamHurt ? 'הפיר הושמד, אבל לוחמים נפצעו.<small>כלב או רובוט לפני לוחם, עשן מול נ״ט וצלף, ותקיפה רק בחלון הנכון שומרים על הכוח.</small>'
      : s.shaft && !x2 ? 'הפיר הושמד, אבל הפתח השני נשאר פתוח.<small>הרובוט בתחתית הפיר מראה לאן המנהרה ממשיכה. מנהרה עם פתח פתוח חוזרת לפעול.</small>' : 'המשימה הסתיימה.';
    const li = []; for (const p of s.prevented) li.push([p, false]);
    for (const w of s.wrong) li.push([`חיפוש ב${HN[w]}: בית נקי, זמן וסיכון`, true]);
    for (const v of s.violations) li.push([v, true]);
    if (s.militants) li.push([`${s.militants} חמושים נפגעו`, false]);
    li.push(['הפיר והקטע הראשון של המנהרה קרסו. הבית שמעליו נהרס בפיצוץ.', false]); if (!x2) li.push(['הפתח השני של המנהרה לא נאטם', true]);
    $('endList').innerHTML = li.map(([t, b]) => `<li class="${b ? 'bad' : ''}">${t}</li>`).join('');
    $('endEyebrow').textContent = fmtClock(G.missionClock).slice(0, 5) + ' · הכוח חזר למאסף';
  }
}
