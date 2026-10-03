// Mission 3, extended scenario: more forces to dispatch, more incidents, a strike card with a proportionality and
// legal check, a mid-mission report and a score breakdown. Installed onto CorridorMission.prototype (mission.js), so
// `this` is the mission everywhere below. All characters and call-signs are fictional; civilians are never targets.
import * as THREE from 'three';
import { G, rr, pick, clamp, V3, bus, after } from '../core.js';
import { Actor } from '../actors.js';
import { CL, hC, makeD9, makeRobot, tunnelMouth, ambulance, makeBag } from './world.js';

const $ = id => document.getElementById(id);
const HQ = 'אוגדה · חמ״ל', OBS = 'תצפיתנית · חמ״ל', CPK = 'מחסום "אלון"', MED = 'צוות רפואה', UAV = 'כטב״ם', AIR = 'חיל האוויר';
const ENG = 'הנדסה · "פטיש"', INF = 'צוות חי״ר · "ברק"', D9N = 'דחפור · "ענק"', LEG = 'יועמ״ש האוגדה', MOR = 'מרגמות · "רעם"', HELI = 'מסוק קרב · "צפע"', ARM = 'שריון';
const FAIL = (h, p) => `${h}<br><span style="font-size:16px;font-weight:500;line-height:1.6;display:block;margin-top:10px;color:#d6cab2">${p}</span>`;
// Arabic loudspeaker lines (the Hebrew translation is the subtitle)
export const SPK = {
  calm: ['המסדרון פתוח עד השעה שתיים. המשיכו ללכת דרומה בכביש. החזיקו את הילדים קרוב. אל תסטו מהכביש.', 'الممر مفتوح حتى الساعة الثانية. استمروا بالسير جنوباً على الشارع. أبقوا الأطفال قريبين منكم. لا تبتعدوا عن الشارع.'],
  crush: ['לאט! אל תדחפו! נתיב נוסף נפתח. החזיקו את הילדים ביד ותתקדמו לאט.', 'على مهل! لا تدفعوا! فُتح مسار إضافي. أمسكوا أيدي الأطفال وتقدموا ببطء.'],
  hold: ['עצרו כאן וחכו. המחסום פתוח עד שתיים. כולם יעברו. אל תדחפו.', 'توقفوا هنا وانتظروا. المعبر مفتوح حتى الساعة الثانية. الجميع سيعبر. لا تدفعوا.'],
  sniper: ['רדו לקרקע! התרחקו מהצד המערבי של הכביש! זחלו אל הקירות בצד המזרחי!', 'انبطحوا على الأرض! ابتعدوا عن الجانب الغربي من الشارع! ازحفوا نحو الجدران في الجانب الشرقي!'],
  car: ['הנהג ברכב הלבן: עצור מיד! עצור את הרכב ושים את הידיים מחוץ לחלון!', 'سائق السيارة البيضاء: توقف فوراً! أوقف السيارة وأخرج يديك من النافذة!'],
  close: ['השעה שתיים. המעבר נסגר לבאים חדשים. מי שכבר בתור יעבור. שמרו על הילדים.', 'الساعة الثانية. المعبر مغلق أمام القادمين الجدد. من في الطابور سيعبر. انتبهوا للأطفال.'],
  bag: ['התרחקו מהתיק על הכביש! אל תיגעו בו! המשיכו ללכת בצד.', 'ابتعدوا عن الحقيبة على الشارع! لا تلمسوها! استمروا بالسير على الجانب.'],
  mortar: ['רדו לקרקע עכשיו! שכבו ליד הקירות! אל תרוצו!', 'انبطحوا الآن! استلقوا قرب الجدران! لا تركضوا!'],
  rumor: ['המסדרון לא נסגר מוקדם. הוא פתוח עד שתיים. אין צורך לרוץ.', 'الممر لن يُغلق مبكراً. إنه مفتوح حتى الساعة الثانية. لا داعي للركض.'],
  lost: ['ילד קטן מחכה ליד המחסום, בצד הדרומי. הוריו מתבקשים לגשת לחיילת ליד האוהל.', 'طفل صغير ينتظر قرب المعبر من الجهة الجنوبية. على أهله التوجه إلى المجندة قرب الخيمة.'],
};
// munitions on the strike card: danger radius (m), time to impact (s) and what the commander should know
const MUN = {
  uav: { name: 'טיל מדויק · כטב״ם', r: 15, delay: 6, note: 'ראש קרב קטן. פגיעה תוך שניות.' },
  tank: { name: 'פגז 120 מ״מ · מרכבה', r: 22, delay: 3, note: 'מהיר. צריך קו ראייה מהטנק, עד כ־1.5 ק״מ.' },
  heli: { name: 'מסוק קרב · תותח 30 מ״מ', r: 20, delay: 30, note: 'מגיע תוך חצי דקה ורואה את היעד. גיחה אחת.' },
  air: { name: 'חיל האוויר · חימוש מונחה', r: 60, delay: 50, note: 'דרך האוגדה. טווח פגיעה רחב, כדקה עד הפגיעה.' },
};
function findBone(root, name) { let b = null; root.traverse(c => { if (!b && c.name === name) b = c; }); return b; }
// an RPG launcher slung on the back (same bone-space trick as the backpacks in mission.js)
function rpgTube(a) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1.0, 6), new THREE.MeshStandardMaterial({ color: '#3d3f30', roughness: .7 })); const b = findBone(a.root, 'Bip01_Spine2'); if (!b) return;
  a.root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(a.root.matrixWorld).invert(); const bm = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld); const q = new THREE.Quaternion().setFromRotationMatrix(bm).invert();
  const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); hp.add(V3(.08, .05, -.18)); const s = 1 / a.root.scale.x;
  m.position.copy(hp.multiplyScalar(s)).applyQuaternion(q); m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.5, 0, .9))); m.scale.setScalar(s); b.add(m); m.castShadow = true;
}

export const OPS = {
  // ---------- voice ----------
  // the commander's own order on the net (short, before the unit answers); sound.js speaks it in the 'cmd' voice
  cmdSay(text) { G.csound && G.csound.radio('אתה · חפ״ק', text, '#f2b84b', Math.max(3, text.length * .07), false, 'cmd'); },
  announce(key, interrupt = false) { const [he, ar] = SPK[key] || SPK.calm; G.csound.loudspeaker(he, ar, interrupt); this.spkOnAir = G.time + 6; },
  // ---------- forces ----------
  opsForces() {
    // the infantry team rides inside the eastern Namer and the engineer beside it with his robot: they appear
    // (dismount) only when sent out, so idle they cost no draw calls (each skinned soldier is several, twice with shadows)
    this.inf = []; this.engr = null;
    this.robot = makeRobot(); this.robot.position.set(18.6, hC(18.6, -3.2), -3.2); this.robot.rotation.y = Math.PI; this.robot.userData.home = this.robot.position.clone();
    this.d9 = makeD9(); this.d9.position.set(24, hC(24, -28), -28); this.d9.rotation.y = Math.PI; this.d9.userData.home = this.d9.position.clone();
    this.drivers = [];
    return [
      { id: 'inf', name: 'צוות חי״ר "ברק"', sub: 'בנמ״ר ב׳ · ליווי, סריקה, אבטחה', busy: false },
      { id: 'eng', name: 'הנדסה קרבית', sub: 'לוחם הנדסה ורובוט לבדיקת חפץ חשוד', busy: false },
      { id: 'd9', name: 'D9 משוריין', sub: 'פינוי הריסות, סוללות עפר ואטימת פירים', obj: this.d9, busy: false },
      { id: 'mp', name: 'משטרה צבאית', sub: 'תגבור הבודקים: קצב מעבר מהיר יותר, אותה בדיקה', on: false, busy: false },
      { id: 'mor', name: 'מרגמות 81 מ״מ', sub: 'פצצות עשן בלבד ליד אזרחים · זמן מעוף כ־12 ש׳', ammo: 3, busy: false },
      { id: 'heli', name: 'מסוק קרב', sub: 'דרך כרטיס התקיפה · כחצי דקה · גיחה אחת', used: false },
    ];
  },
  soldier(model, x, z, yaw, name) { const a = new Actor(model, 'idf', V3(x, hC(x, z), z), yaw, { rifle: 'm4', accuracy: .9 }); a.name = name; a.readyAim = false; a.brain = this.postBrain(a); a.post = a.pos.clone(); a.postYaw = yaw; return a; },
  dismount() { if (this.inf.length) return this.inf; const o = this.U.apcB.obj.position, N = Math.PI; this.inf = [this.soldier('team', o.x + 2.6, o.z + 3, N, 'לוחם · אלעד'), this.soldier('team2', o.x + 3.4, o.z + 3.8, N, 'לוחם · דניאל')]; if (!G.isTouch) this.inf.push(this.soldier('team3', o.x + 1.8, o.z + 4, N, 'לוחמת · ליה')); return this.inf; },
  mountUp() { const list = this.inf; this.inf = []; const h = this.U.apcB.obj.userData.home || V3(16, 0, -10); list.forEach(a => { a.lookAt = null; a.readyAim = false; if (a.alive && !a.down) a.setPath([V3(h.x + 2.6, 0, h.z + 3)], 1.8, () => a.remove()); }); },
  engOut() { if (!this.engr || this.engr.removed) this.engr = this.soldier('team2', 19.6, -2.6, Math.PI, 'הנדסה · עידו'); return this.engr; },
  drive(o, pts, v, done = null, rev = false) { const d = { o, pts: pts.map(p => p.clone()), i: 0, v, done, rev }; this.drivers.push(d); return d; },
  updDrivers(dt, obs) {
    for (const d of this.drivers) { if (d.fin) continue; const o = d.o; if (d.wait > 0) { d.wait -= dt; obs.push({ x: o.position.x, z: o.position.z, r: 2.6 }); continue; } const t = d.pts[d.i]; const dx = t.x - o.position.x, dz = t.z - o.position.z, L = Math.hypot(dx, dz);
      if (L < .6) { d.i++; if (d.i >= d.pts.length) { d.fin = true; d.done && d.done(); } continue; }
      const sp = Math.min(d.v * (d.slow || 1), L * 1.2 + .4); o.position.x += dx / L * sp * dt; o.position.z += dz / L * sp * dt; o.position.y = hC(o.position.x, o.position.z);
      let df = Math.atan2(dx, dz) + (d.rev ? Math.PI : 0) - o.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df)); o.rotation.y += df * Math.min(1, dt * 2.5);
      obs.push({ x: o.position.x, z: o.position.z, r: o === this.robot ? .8 : 2.8 }); }
    this.drivers = this.drivers.filter(d => !d.fin);
  },
  walk(list, pts, sp, done) { list.filter(a => a.alive && !a.down).forEach((a, i) => { const off = V3((i - 1) * 1.1, 0, (i % 2) * .9); a.setPath(pts.map(p => p.clone().add(off)), sp, i === 0 ? done : null); }); },
  home(list) { list.forEach(a => { if (a.alive && !a.down) a.setPath([a.post.clone()], 1.6, () => { a.task = null; }); }); },
  // ---------- the timeline of the extended scenario ----------
  opsTimeline() {
    this.at(92, () => this.bagStart()); this.at(170, () => this.convoyStart()); this.at(218, () => this.childStart()); this.at(252, () => this.rpgStart());
    this.at(292, () => this.midReport()); this.at(372, () => this.mortarAlert(1)); this.at(452, () => this.tunnelStart()); this.at(486, () => this.lostStart());
    this.at(150, () => { if (!this.closed) this.addIntel(OBS, 'שמועה עוברת בטור שהמסדרון ייסגר בעוד שעה. אנשים מאיצים. כריזה יכולה להרגיע.', false); });
  },
  evOk(id, txt) { this.st.ev[id] = 'ok'; if (txt) this.st.prevented.push(txt); },
  evBad(id, txt) { if (this.st.ev[id] !== 'ok') this.st.ev[id] = 'bad'; if (txt) this.st.violations.push(txt); },
  // ---------- 1. a suspicious bag at the lane mouth ----------
  bagStart() {
    const p = V3(-2.4, 0, CL.funnelZ - 7); const o = makeBag(); o.position.set(p.x, hC(p.x, p.z), p.z); o.rotation.y = .6; this.bag = { o, p, t0: G.time, st: 'open' }; this.st.ev.bag = 'open';
    this.addIntel(CPK, 'תיק נטוש על הכביש, שבעה מטר לפני הנתיבים. אף אחד לא לוקח אותו, ואנשים עוברים צמוד אליו.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(p) });
    this.radio(CPK, 'חפ״ק, כאן המחסום. יש תיק נטוש בכניסה. מה עושים?'); this.setThreat('bag');
  },
  bagRespond() {
    const B = this.bag, u = this.U.eng; if (!B || B.st !== 'open' && B.st !== 'panic') return 'אין תיק לבדיקה'; if (u.busy) return 'ההנדסה כבר בדרך';
    u.busy = true; B.st = 'cordon'; B.cordon = true; this.cmdSay('הנדסה, כאן חפ״ק. רובוט לתיק בכניסה. המחסום, הרחיקו אנשים.'); this.announce('bag');
    after(2.5, () => this.radio(ENG, 'הנדסה יוצאת. הרובוט בדרך בנתיב הרכבים.'));
    const en = this.engOut(); en.setPath([V3(12.5, 0, -10), V3(9.2, 0, -14)], 2.2, () => { en.task = 'm_crouch_gestic'; });
    this.drive(this.robot, [V3(12, 0, -12), V3(8.6, 0, -20), V3(8.0, 0, -48), V3(2.5, 0, -46), V3(B.p.x + 1.2, 0, B.p.z - 1.5)], 2.8, () => after(7, () => this.bagCleared()));
    this.setThreat('bag', false); this.setThreat('bagWait'); return true;
  },
  bagCleared() {
    const B = this.bag; if (!B) return; B.st = 'done'; B.cordon = false; G.scene.remove(B.o); this.setThreat('bagWait', false);
    this.notify('התיק נבדק', 'הרובוט פתח אותו: בגדים, מסמכים ותרופות. בעליו, קשיש מהטור, חזר לחפש אותו.', false); this.radio(ENG, 'התיק נקי. בגדים ותרופות. הרובוט חוזר.');
    this.evOk('bag', 'התיק החשוד נבדק ברובוט, בלי לעצור את המחסום ובלי בהלה');
    this.drive(this.robot, [V3(2.5, 0, -46), V3(8.0, 0, -48), V3(8.6, 0, -20), V3(12, 0, -12), this.robot.userData.home], 2.8, () => { this.U.eng.busy = false; this.robot.rotation.y = Math.PI; });
    const en = this.engr; if (en) { en.task = null; en.setPath([V3(12.5, 0, -10), en.post.clone()], 1.8, () => { en.remove(); }); }
  },
  bagPanic() {
    const B = this.bag; B.st = 'panic'; this.press = Math.min(1.6, this.press + .55); this.evBad('bag', 'התיק החשוד לא טופל: בהלה בכניסה למחסום, ואישה נפלה ונפצעה');
    const q = G.crowd.lanes[0].q; const ag = q[Math.floor(q.length * .85)]; if (ag) this.civHurt(ag, 'בהלה סביב תיק חשוד שלא טופל');
    this.notify('בהלה סביב התיק!', 'מישהו צעק "פצצה". אנשים נדחפו אחורה, ואישה נפלה. עדיין צריך לבדוק את התיק.', true); this.radio(CPK, 'בהלה בכניסה! אנשים בורחים מהתיק!'); this.setThreat('bag');
  },
  // ---------- 2. the medical convoy and the rubble on the vehicle lane ----------
  convoyStart() {
    const amb = []; for (let i = 0; i < 3; i++) { const o = ambulance(); if (!o) continue; o.position.set(CL.vehX, 0, -300 - i * 9); o.rotation.y = 0; amb.push(o); }
    this.stageSet(3); this.convoy = { amb, st: 'coming', t0: G.time }; this.st.ev.convoy = 'open';
    amb.forEach((o, i) => this.drive(o, [V3(CL.vehX, 0, -134 - i * 8)], 5, () => { if (i === 0) this.convoyArrived(); }));
    this.addIntel(HQ, 'שיירת פינוי רפואי מתואמת: שלושה אמבולנסים עם פצועים מבית חולים בצפון, בנתיב הרכבים דרומה. הריסות של קיר חוסמות את הנתיב 120 מ׳ צפונית למחסום.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(V3(CL.vehX, 0, -128)) });
    this.radio(HQ, 'חפ״ק, כאן אוגדה. שיירת אמבולנסים מתואמת בדרך אליך. פנה להם את הדרך.'); this.setThreat('convoy');
  },
  convoyArrived() { const C = this.convoy; if (!C || C.st !== 'coming') return; C.st = this.block ? 'blocked' : 'wait'; C.tWait = G.time; this.refreshTask(); },
  d9Clear() {
    const u = this.U.d9; if (!this.block) return 'הנתיב כבר פנוי'; if (u.busy) return 'הדחפור עסוק'; u.busy = true;
    this.cmdSay('ענק, כאן חפ״ק. פנה את ההריסות מנתיב הרכבים, 120 מטר צפונה.'); after(2.5, () => this.radio(D9N, 'ענק, קיבלתי. נע צפונה בשוליים.'));
    this.drive(this.d9, [V3(15, 0, -60), V3(CL.vehX + .4, 0, -110)], 4, () => {
      const b = this.block, t0 = G.time; this.notify('הדחפור דוחף את ההריסות', 'ה־D9 מזיז את הבלוקים אל השוליים המזרחיים.', false);
      this.drive(this.d9, [V3(CL.vehX + 4, 0, -117)], 1.4, () => {});
      const push = () => { if (!b.parent) return; const k = Math.min(1, (G.time - t0) / 6); b.position.x = CL.vehX + .4 + k * 9; b.rotation.y = k * .6; if (G.fx && Math.random() < .3) G.fx.dustBurst(b.position.clone(), 2, 4); if (k < 1) after(.1, push); else this.blockCleared(); }; push();
    }); return true;
  },
  blockCleared() {
    this.block = null; this.notify('נתיב הרכבים פנוי', 'ההריסות בשוליים. השיירה יכולה לעבור.', false); this.radio(D9N, 'הנתיב פתוח. חוזר לעמדה.');
    this.drive(this.d9, [V3(15, 0, -70), this.d9.userData.home], 4, () => { this.U.d9.busy = false; this.d9.rotation.y = Math.PI; });
    if (this.convoy && this.convoy.st === 'blocked') this.convoy.st = 'wait'; this.refreshTask();
  },
  convoyGo(escort = true) {
    const C = this.convoy; if (!C || (C.st !== 'wait' && C.st !== 'coming')) return this.block ? 'קודם צריך לפנות את ההריסות' : 'השיירה כבר בתנועה';
    if (this.block) return 'קודם צריך לפנות את ההריסות';
    C.st = 'moving'; C.escort = escort; this.drivers = this.drivers.filter(d => !C.amb.includes(d.o));
    if (escort) { this.cmdSay('ברק, כאן חפ״ק. ליוו את השיירה דרך הטור עד המחסום. נמ״ר ב׳, צפונה.'); after(2.5, () => this.radio(INF, 'ברק, קיבלתי. יוצאים לשיירה.')); this.U.inf.busy = true; this.walk(this.dismount(), [V3(9.5, 0, -40), V3(9.2, 0, -95)], 2.6, () => {}); this.moveArmour('apcB', 'north'); }
    const v = escort ? 2.6 : 1.1, path = [V3(CL.vehX, 0, -48), V3(CL.vehX, 0, -8), V3(CL.vehX + .5, 0, 20), V3(CL.vehX - 1, 0, CL.exitZ + 30)];
    C.amb.forEach((o, i) => after(escort ? 8 + i * 2.5 : i * 3, () => { const d = this.drive(o, path, v, () => { G.scene.remove(o); if (i === C.amb.length - 1) this.convoyDone(); }); d.stopAt = 1; }));
    if (!escort) this.notify('השיירה נעה לבד', 'בלי ליווי האנשים מתקבצים סביב האמבולנסים. היא מתקדמת לאט מאוד.', true);
    this.refreshTask(); return true;
  },
  convoyDone() {
    const C = this.convoy; C.st = 'done'; this.setThreat('convoy', false); const late = G.time - (C.tWait || G.time) > 90;
    if (C.escort && !late) this.evOk('convoy', 'שיירת הפינוי הרפואי עברה בליווי, בלי לעצור את הטור'); else this.evBad('convoy', C.escort ? 'שיירת הפינוי הרפואי חיכתה זמן רב מול ההריסות' : 'שיירת הפינוי עברה בלי ליווי, לאט, דרך ההמון');
    this.radio(CPK, 'השיירה עברה את המחסום. כל הפצועים בדרך דרומה.');
    if (C.escort) { this.mountUp(); after(5, () => { this.U.inf.busy = false; }); this.moveArmour('apcB', 'home'); }
  },
  // ---------- 3. a father carrying a hurt child in the queue ----------
  childStart() {
    const a = new Actor('civM2', 'civ', V3(-1.5, 0, CL.funnelZ - 16), Math.PI, {}); a.role = 'father'; a.brain = () => {}; this.father = a; this.st.ev.child = 'open'; a.t0 = G.time;
    const kid = new THREE.Mesh(new THREE.BoxGeometry(.5, .26, .28), new THREE.MeshStandardMaterial({ color: '#b9a98a', roughness: 1 })); const b = findBone(a.root, 'Bip01_Spine2'); if (b) { a.root.updateMatrixWorld(true); const s = 1 / a.root.scale.x; kid.scale.setScalar(s); kid.position.set(0, 0, .25 * s); b.add(kid); }
    a.setPath([V3(-1.2, 0, CL.funnelZ - 9)], .6);
    this.addIntel(CPK, 'אב עם ילד פצוע בזרועות, עטוף בשמיכה, בתור, 15 מ׳ לפני הנתיבים. הילד פצוע ברגלו ומאבד הכרה. האב מבקש לעבור קודם.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(a, true) });
    G.tablet.mark(a); this.setThreat('child');
  },
  childPriority() {
    const a = this.father; if (!a || a.priority) return 'כבר בטיפול'; a.priority = true; this.setThreat('child', false);
    this.cmdSay('המחסום, כאן חפ״ק. העבירו את האב והילד בעדיפות דרך נתיב הרכבים. רפואה, קבלו אותם.');
    a.setPath([V3(2.5, 0, -46), V3(7.8, 0, -47), V3(7.8, 0, -6), V3(7.8, 0, 9), G.medPos.clone().add(V3(1.2, 0, -1))], 1.6, () => { a.forceAnim = 'crouch'; });
    const ms = this.medics.filter(m => m.alive && !m.down && !m.medicBusy); if (ms[0]) { ms[0].medicBusy = true; ms[0].setPath([V3(8.5, 0, 12)], 2.6, () => { ms[0].faceTo(V3(7.8, 0, 0)); after(10, () => { ms[0].setPath([ms[0].post.clone()], 1.2, () => { ms[0].medicBusy = false; }); }); }); }
    after(2.5, () => this.radio(MED, 'מקבלים את הילד בנתיב הרכבים.'));
    after(14, () => { if (!this.father.late) this.evOk('child', 'ילד פצוע הועבר בעדיפות דרך נתיב הרכבים וטופל מיד'); this.notify('הילד בטיפול', 'החובשת חבשה את רגלו. הוא בהכרה, והאב איתו באוהל הרפואה.', false); });
    return true;
  },
  // ---------- 4. an anti-tank team moving through the ruins to the west ----------
  rpgStart() {
    this.rpg = []; this.st.ev.rpg = 'open';
    for (let i = 0; i < 2; i++) { const a = new Actor('fighter', 'civ', V3(-128 - i * 2.5, 0, -50 - i * 3), Math.PI / 2, { rifle: 'ak' }); a.role = 'rpg'; a.armedVisible = true; a.militant = true; a.brain = () => {}; a.readyAim = false; if (i === 0) rpgTube(a); this.rpg.push(a);
      a.setPath([V3(-90 - i * 2, 0, -40 - i * 2), V3(-42 - i * 2, 0, -24 - i * 2)], 1.1, () => { if (i === 0) this.rpgFire(); }); }
    this.addIntel(OBS, 'שני חמושים, אחד עם מטול RPG, נעים בין ההריסות ממערב, 130 מ׳ מהכביש, לכיוון נמ״ר א׳ והמחסום. אין אזרחים סביבם.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(this.rpg[0], true) });
    this.radio(OBS, 'חפ״ק, חוליית נ״ט ממערב. בעוד דקה וחצי הם בטווח ירי על הנמ״ר.'); for (const a of this.rpg) G.tablet.mark(a); this.setThreat('rpg');
  },
  rpgAlive() { return (this.rpg || []).filter(a => a.alive && !a.removed); },
  rpgWithdraw(why) {
    const L = this.rpgAlive(); if (!L.length || this.rpgOut) return; this.rpgOut = true; this.setThreat('rpg', false);
    L.forEach((a, i) => a.setPath([V3(-110 - i * 3, 0, -70), V3(-170, 0, -110)], 2.4, () => a.remove()));
    this.notify('חוליית הנ״ט נסוגה', why, false); this.radio(OBS, 'החוליה ירדה למחסה ונסוגה לעומק ההריסות.'); this.evOk('rpg', 'חוליית הנ״ט נסוגה מול המרכבה, בלי ירי ליד הטור');
  },
  rpgFire() {
    const L = this.rpgAlive(); if (!L.length || this.rpgOut) return; const a = L[0], tg = (this.U.apcA.obj || {}).position || V3(-13, 0, 18);
    const from = a.pos.clone().add(V3(0, 1.5, 0)), to = tg.clone().add(V3(0, 1.6, 0)); G.fx.muzzle(from, to.clone().sub(from).normalize(), 1.2); G.audio.shotAt(from, 'ak'); G.fx.tracer && G.fx.tracer(from, to, true);
    after(.8, () => { G.fx.explosion(to, .8); G.audio.explosion(to, .9); const s = this.mg.find(m => m.alive && !m.down) || this.screeners[0]; if (s) { s.damage(55, to, 'legs'); this.casualty(s); }
      this.notify('טיל פגע בנמ״ר א׳', 'הנמ״ר ספג את הפגיעה. לוחם בעמדה הסמוכה נפצע מרסיסים. החוליה נמלטה.', true); this.radio(ARM, 'נפגענו מטיל! יש פצוע, צריך חובש!'); });
    this.evBad('rpg', 'חוליית הנ״ט הגיעה לטווח וירתה על הכוח'); this.rpgOut = true; this.setThreat('rpg', false);
    after(3, () => L.forEach(x => x.alive && x.setPath([V3(-120, 0, -70), V3(-170, 0, -110)], 2.6, () => x.remove())));
  },
  // ---------- mid-mission report to division ----------
  midReport() {
    if (this.done) return; const rows = this.scoreRows(false), tot = rows.reduce((s, r) => s + r.pts, 0), max = rows.reduce((s, r) => s + r.max, 0);
    const el = $('midrep'); if (el) { el.innerHTML = `<div class="mh"><span>דו״ח ביניים לאוגדה · ${(G.missionClock / 3600 | 0)}:${String((G.missionClock / 60 | 0) % 60).padStart(2, '0')}</span><b>${tot}/${max}</b></div>` + rows.map(r => `<div class="mr${r.pts < r.max ? ' low' : ''}"><span>${r.k}</span><em>${r.why}</em><b>${r.pts}/${r.max}</b></div>`).join('') + '<p>החצי השני קשה יותר. האוגדה מעריכה ירי על המחסום.</p>'; el.classList.add('on'); clearTimeout(this._mr); this._mr = setTimeout(() => el.classList.remove('on'), 11000); el.onclick = () => el.classList.remove('on'); }
    this.addIntel(HQ, `דו״ח ביניים: עברו ${G.crowd.passed}, אזרחים פצועים ${this.st.civHurt}, לוחמים פצועים ${this.st.idfHurt}, עיכובים ${this.st.detained}. ציון ביניים ${tot}/${max}.`, false);
    this.radio(HQ, 'חפ״ק, כאן אוגדה. קיבלנו את הדו״ח. המשך כך, ושים לב לאגף המערבי.');
  },
  // ---------- 5. mortar fire on the checkpoint ----------
  mortarAlert(n) {
    if (this.closed && n > 1) return; if (n === 1) this.stageSet(5); this.mortarOn = n; this.mortarSh = false; this.st.ev.mortar = this.st.ev.mortar || 'open'; G.audio.setIntensity(.7);
    this.addIntel(HQ, n === 1 ? 'צבע אדום: שיגור מרגמות מצפון לעבר אזור המחסום. נפילות בעוד כ־15 שניות.' : 'צבע אדום שוב! אותו צוות מרגמה. נפילות בעוד כ־15 שניות.', true);
    this.radio(HQ, 'צבע אדום, צבע אדום! מרגמות לעבר המחסום!'); this.setThreat('mortar');
    after(15, () => this.mortarImpact(n));
  },
  mortarShelter() {
    if (!this.mortarOn || this.mortarSh) return 'כבר במחסה'; this.mortarSh = true; this.order('cp', 'flow', 'pause'); G.crowd.shelter = true; this.announce('mortar', true);
    this.cmdSay('כל הכוחות, מחסה! המחסום, עצרו את המעבר.'); this.refreshTask(); return true;
  },
  mortarImpact(n) {
    const pts = n === 1 ? [V3(-48, 0, -62), V3(-15, 0, -74), V3(-60, 0, -30)] : [V3(-38, 0, -50), V3(-14, 0, -40), V3(-52, 0, -88)];
    pts.forEach((p, i) => after(i * 1.3, () => { p.y = hC(p.x, p.z); G.fx.explosion(p.clone().add(V3(0, .4, 0)), .9); G.audio.explosion(p, 1); G.fx.dustBurst && G.fx.dustBurst(p.clone(), 4, 24); }));
    after(3, () => {
      if (!this.mortarSh) { let k = 0; for (const a of G.crowd.agents) if (a.alive && a.x < -3 && Math.abs(a.z + 70) < 25 && k < 2) { if (this.civHurt(a, 'הטור לא הוזעק למחסה בזמן ירי המרגמות')) k++; } this.evBad('mortar'); this.notify('רסיסים פגעו בטור', `${k || 1} אזרחים נפצעו קל מרסיסים בצד המערבי של הכביש. הם לא הספיקו לשכב.`, true); }
      else this.notify('נפילות בדיונות', 'שלוש פצצות נפלו ממערב לכביש. האנשים שכבו ליד הקירות. אף אחד לא נפגע.', false);
      after(8, () => this.mortarClear(n));
    });
  },
  mortarClear(n) {
    this.mortarOn = 0; this.setThreat('mortar', false); if (!(this.firing && !this.covered)) G.crowd.shelter = false; G.audio.setIntensity(.3);
    if (this.mortarSh && this.st.ev.mortar !== 'bad') this.evOk('mortar', n === 1 ? 'הטור הוזעק למחסה בזמן ירי המרגמות, ואף אחד לא נפגע' : null);
    if (n === 1 && !this.mortarTeam) { this.mortarTeam = { position: V3(-70, 0, -1450), alive: true, role: 'mortar', armedVisible: true, name: 'צוות מרגמה' }; this.mortarTeam.position.y = hC(-70, -1450);
      this.addIntel(OBS, 'צוות המרגמה אותר: שלושה אנשים ומרגמה בפרדס, 1.4 ק״מ צפונה וממערב לכביש. אין אזרחים בטווח 200 מ׳. בעוד כדקה הם עלולים לירות שוב.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(this.mortarTeam.position) });
      this.setThreat('mortarTeam'); this.mortarNext = G.time + 75; }
    this.radio(CPK, 'הנפילות פסקו. אפשר לחדש את המעבר?');
  },
  // ---------- 6. a tunnel shaft next to the road ----------
  tunnelStart() {
    const p = V3(19, 0, -66); this.tunnel = { o: tunnelMouth(p.x, p.z), p, st: 'open', t0: G.time }; this.st.ev.tunnel = 'open';
    this.addIntel(OBS, 'פתח פיר נחשף בחצר ממזרח לכביש, 70 מ׳ צפונית למחסום. ייתכן שישמש להוצאת חמושים אל מאחורי המחסום.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(p) }); this.setThreat('tunnel');
  },
  tunnelSearch() {
    const T = this.tunnel, u = this.U.inf; if (!T || T.st !== 'open') return 'הפיר כבר מטופל'; if (u.busy) return 'צוות החי״ר עסוק'; u.busy = true; T.st = 'search';
    this.cmdSay('ברק, כאן חפ״ק. סרקו ואבטחו את הפיר בחצר, 70 מטר צפונה.'); after(2.5, () => this.radio(INF, 'ברק, יוצאים לפיר.'));
    this.walk(this.dismount(), [V3(21, 0, -40), V3(T.p.x - 1.5, 0, T.p.z + 3.5)], 2.6, () => { this.inf.forEach(a => { a.lookAt = T.p.clone(); a.readyAim = true; }); after(8, () => { T.st = 'secured'; this.setThreat('tunnel', false); this.setThreat('tunnelSeal'); this.notify('הפיר מאובטח', 'הפיר ריק. הצוות מאבטח אותו. צריך לאטום אותו.', false); this.radio(INF, 'הפיר ריק, מאבטחים. צריך דחפור.'); }); });
    this.setThreat('tunnel', false); this.setThreat('tunnelWait'); return true;
  },
  tunnelSeal() {
    const T = this.tunnel, u = this.U.d9; if (!T || T.st !== 'secured') return 'קודם צריך לאבטח את הפיר'; if (u.busy) return 'הדחפור עסוק'; u.busy = true; T.st = 'sealing';
    this.cmdSay('ענק, כאן חפ״ק. אטום את הפיר בחצר.'); this.setThreat('tunnelSeal', false);
    this.drive(this.d9, [V3(27, 0, -60), V3(T.p.x + 1, 0, T.p.z + 6)], 4, () => { const t0 = G.time; const sink = () => { const k = Math.min(1, (G.time - t0) / 5); T.o.scale.set(1, 1 - k * .9, 1); T.o.position.y = hC(T.p.x, T.p.z) - k * .3; if (Math.random() < .4) G.fx.dustBurst(T.p.clone(), 2, 5); if (k < 1) after(.1, sink); else this.tunnelSealed(); }; sink(); });
    return true;
  },
  tunnelSealed() {
    const T = this.tunnel; T.st = 'done'; G.scene.remove(T.o); this.evOk('tunnel', 'פיר המנהרה ליד הכביש אובטח ונאטם, בלי ירייה'); this.notify('הפיר נאטם', 'ה־D9 כיסה את הפיר בעפר ובבטון.', false); this.radio(D9N, 'הפיר סגור. חוזר.');
    this.drive(this.d9, [V3(27, 0, -60), this.d9.userData.home], 4, () => { this.U.d9.busy = false; this.d9.rotation.y = Math.PI; });
    this.mountUp(); after(4, () => { this.U.inf.busy = false; }); this.setThreat('tunnelWait', false);
  },
  // ---------- 7. a lost child past the checkpoint ----------
  lostStart() {
    const k = new Actor('civF1', 'civ', V3(2.5, 0, 16), Math.PI * .8, {}); k.root.scale.multiplyScalar(.68); k.role = 'lost'; k.kid = true; k.forceAnim = 'crouch'; k.brain = () => {}; this.lost = k; k.t0 = G.time; this.st.ev.lost = 'open';
    this.addIntel(CPK, 'ילדה קטנה לבד מעבר למחסום, בוכה. כנראה איבדה את המשפחה בדוחק. כולם ממשיכים ללכת.', false, { label: 'הראה ברחפן', fn: () => this.lookAt(k, true) }); this.setThreat('lost');
  },
  lostHelp() {
    const k = this.lost; if (!k || k.helped) return 'כבר מטפלים בה'; k.helped = true; this.setThreat('lost', false); this.announce('lost');
    this.cmdSay('נועה, כאן חפ״ק. שמרי על הילדה ליד האוהל עד שהמשפחה תגיע.'); const s = this.screeners[1]; if (s && !s.down) s.setPath([V3(3.4, 0, 15.2)], 1.6, () => { s.task = 'm_crouch_gestic'; s.faceTo(k.pos); });
    after(20, () => { const m = new Actor('civF2', 'civ', V3(1, 0, 52), Math.PI, {}); m.role = 'mother'; m.brain = () => {}; this.mother = m; m.setPath([V3(2.2, 0, 17)], 1.8, () => { k.forceAnim = null; this.notify('הילדה מצאה את אמה', 'האם חזרה מהצד הדרומי אחרי הכריזה. הן ממשיכות יחד.', false);
      this.evOk('lost', 'ילדה אבודה הושגחה במחסום ואוחדה עם אמה'); if (s) { s.task = null; s.setPath([s.post.clone()], 1.4); }
      after(3, () => { k.setPath([V3(1.5, 0, CL.exitZ)], .9, () => k.remove()); m.setPath([V3(2.3, 0, CL.exitZ)], .9, () => m.remove()); }); }); });
    return true;
  },
  // ---------- military police and mortar smoke ----------
  mpReinforce() {
    const u = this.U.mp; if (u.on || u.busy) return 'התגבור כבר במחסום'; u.busy = true; this.cmdSay('משטרה צבאית, כאן חפ״ק. תגברו את הבודקים במחסום.');
    after(2.5, () => this.radio('משטרה צבאית', 'שני שוטרים בדרך מהאחור, עוד כחצי דקה.')); after(30, () => { u.on = true; u.busy = false; G.crowd.rateMul = .72; this.notify('תגבור במחסום', 'שני שוטרים צבאיים מצטרפים לבודקים. הקצב עולה בכרבע, והבדיקה נשארת אותה בדיקה.', false); });
    return true;
  },
  mortarSmoke(p, why) {
    const u = this.U.mor; if (u.ammo <= 0) return 'אין עוד פצצות עשן'; if (u.busy) return 'מטח בדרך'; u.busy = true; u.ammo--; const at = p.clone();
    this.cmdSay('רעם, כאן חפ״ק. עשן בלבד, ' + (why || 'בנקודה שסימנתי') + '.'); after(2.5, () => this.radio(MOR, 'רעם, עשן בדרך. 12 שניות.'));
    after(12, () => { u.busy = false; for (let k = 0; k < 3; k++) after(k * .6, () => { const q = at.clone().add(V3(rr(-6, 6), 0, rr(-6, 6))); q.y = hC(q.x, q.z); G.fx.explosion(q.clone().add(V3(0, .3, 0)), .35); G.audio.explosion(q, .4); });
      (this.smokes || (this.smokes = [])).push({ p: at, until: G.time + 70 });
      if (this.firing && !this.covered && at.distanceTo(V3(CL.sniper.x, 0, CL.sniper.z)) < 60) after(4, () => this.coveredBy('פצצות העשן של המרגמות מסתירות את המחסום מהצלף.')); });
    return true;
  },
  updSmokes(dt) { for (const s of this.smokes || []) { if (s.until < G.time) continue; s._t = (s._t || 0) - dt; if (s._t > 0) continue; s._t = .15; for (let k = 0; k < 2; k++) G.fx.smoke.emit(V3(s.p.x + rr(-9, 9), rr(.5, 3), s.p.z + rr(-9, 9)), V3(G.wind.x * .25 + rr(-.3, .3), rr(.3, .9), G.wind.z * .25), rr(10, 16), rr(3, 4), rr(12, 17), [.86, .86, .84, .9], [.8, .8, .78, 0], .2, -.03); } },
  // ---------- the strike card: proportionality and the legal check before anything lethal ----------
  strikeInfo(t) {
    if (!t) return null; const p = this.posOf(t).clone(); const r = t.role;
    if (r === 'rpg') return { p, name: 'חוליית נ״ט · שני חמושים', id: true, gain: 'מונע ירי טילים על הנמ״ר ועל המחסום', moving: true };
    if (r === 'sniper') return this.sniperOutT ? { p, name: 'הצלף · בשטח פתוח', id: true, gain: 'מונע חזרה לירי', moving: true } : { p, name: 'הצלף · קומה רביעית', id: true, gain: 'עוצר את הירי על המחסום', bldg: true };
    if (r === 'mortar') return { p, name: 'צוות מרגמה · פרדס, 1.4 ק״מ', id: true, gain: 'מונע מטח נוסף על הטור', far: true };
    if (r === 'suspect') return { p, name: t.identified && t.armed ? 'חמוש בתוך הטור' : 'חשוד בתוך הטור', id: !!(t.identified && t.armed), gain: 'עוצר חמוש, אבל המחסום יכול לעכב אותו בלי ירייה' };
    return { p, name: t.friendly ? 'כוח שלנו' : 'אזרח', id: false, gain: 'אין', civ: !t.friendly };
  },
  munOk(k, I) {
    const U = this.U; if (k === 'uav') return U.uav.shots <= 0 ? 'אין חימושים' : U.uav.cd > 0 ? `בדרך (${Math.ceil(U.uav.cd)} ש׳)` : '';
    if (k === 'tank') { const tp = U.tank.obj.position; return U.tank.drive ? 'הטנק בתנועה' : I.bldg || I.far || tp.distanceTo(I.p) > 1500 ? 'אין קו ראייה מהטנק' : ''; }
    if (k === 'heli') return U.heli.used ? 'הגיחה נוצלה' : ''; if (k === 'air') return U.air.busy ? 'בקשה אחרת בטיפול' : ''; return '';
  },
  collateral(I, k) { const r = MUN[k].r; let n = this.civiliansNear(I.p, r); if (I.bldg) n += Math.max(4, (this.shelterers || []).length); if (I.civ) n = Math.max(n, 1); return n; },
  legal(I, k) {
    const n = this.collateral(I, k);
    if (!I.id) return { ok: false, t: I.civ ? 'אסור: היעד אזרח. אזרחים אינם יעד, בשום מצב.' : 'אסור: אין זיהוי ודאי שהיעד חמוש.' };
    if (I.bldg) return { ok: false, t: 'לא מאשר: בקומת הקרקע של הבניין מסתתרות משפחות. הנזק לאזרחים מופרז ביחס לתועלת. יש חלופה: עשן ושריון.' };
    if (n > 0) return { ok: false, t: `לא מאשר: ${n} אזרחים בטווח הסכנה של החימוש (${MUN[k].r} מ׳). בחר חימוש קטן יותר או חכה שהיעד יתרחק.` };
    return { ok: true, t: 'מאשר: יעד צבאי בזיהוי ודאי, אין אזרחים בטווח הסכנה.' + (I.moving && MUN[k].delay > 20 ? ' שים לב: היעד בתנועה, ועד הפגיעה הוא עלול לזוז.' : '') };
  },
  strikeCard(t) {
    if (!t) return 'סמן קודם יעד ברחפן'; if (t._strike) return 'תקיפה כבר בדרך ליעד הזה'; if (t.alive === false) return 'היעד כבר לא בשטח'; if (this._sc && this._sc.t === t) return true;
    const I = this.strikeInfo(t); if (!I) return 'אין יעד'; const el = $('scard'); if (!el) return 'אין כרטיס תקיפה';
    this._sc = { t, I }; const order = ['uav', 'tank', 'heli', 'air'];
    let def = order.find(k => !this.munOk(k, I) && this.legal(I, k).ok) || order.find(k => !this.munOk(k, I)) || 'uav'; this._sc.k = def;
    this.renderStrike(); el.hidden = false; document.body.classList.add('scopen'); return true;
  },
  renderStrike() {
    const S = this._sc; if (!S) return; const { I, k } = S; const order = ['uav', 'tank', 'heli', 'air'];
    $('scT').textContent = I.name;
    $('scMun').innerHTML = ''; for (const m of order) { const no = this.munOk(m, I); const b = document.createElement('button'); b.innerHTML = `<b>${MUN[m].name}</b><small>${no || `רדיוס ${MUN[m].r} מ׳ · ${MUN[m].delay} ש׳`}</small>`; b.disabled = !!no; b.setAttribute('aria-pressed', String(m === k)); b.onclick = () => { S.k = m; this.renderStrike(); }; $('scMun').appendChild(b); }
    const n = this.collateral(I, k), L = this.legal(I, k);
    $('scRows').innerHTML = [['זיהוי', I.id ? 'ודאי: חמוש' : (I.civ ? 'אזרח' : 'לא ודאי')], ['תועלת צבאית', I.gain], ['חימוש', MUN[k].note], ['אזרחים בטווח הסכנה', n ? `<span class="bad">${n}</span>` : '0'], ['הערכת נזק אגבי', I.bldg ? 'בניין מגורים מאוכלס' : n ? 'פגיעה צפויה באזרחים' : 'אין צפי לפגיעה באזרחים']].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const lg = $('scLeg'), go = $('scGo'); lg.className = 'sleg wait'; lg.innerHTML = `<b>${LEG}</b> בודק…`; go.disabled = true; go.className = 'go'; go.textContent = 'אשר תקיפה';
    clearTimeout(this._lt); this._lt = setTimeout(() => { if (this._sc !== S) return; lg.className = 'sleg ' + (L.ok ? 'ok' : 'no'); lg.innerHTML = `<b>${LEG}</b> ${L.t}`; go.disabled = false; go.className = L.ok ? 'go' : 'danger'; go.textContent = L.ok ? 'אשר תקיפה' : 'בצע בניגוד לחוות הדעת'; S.ok = L.ok; }, 800);
  },
  strikeClose() { const el = $('scard'); if (el) el.hidden = true; document.body.classList.remove('scopen'); this._sc = null; },
  strikeGo() {
    const S = this._sc; if (!S) return; this.strikeClose(); const { t, I, k } = S; const U = this.U, M = MUN[k];
    if (!S.ok) this.st.violations.push('תקיפה בניגוד לחוות הדעת המשפטית');
    const civ0 = this.collateral(I, k); t._strike = true; for (const a of this.rpg || []) if (t.role === 'rpg') a._strike = true;
    if (k === 'uav') { U.uav.shots--; U.uav.cd = 25; this.cmdSay('כטב״ם, כאן חפ״ק. מאושר, תקוף.'); after(2, () => this.radio(UAV, 'יעד ננעל. פגיעה בעוד שש שניות.')); }
    if (k === 'tank') { this.cmdSay('מרכבה, כאן חפ״ק. מאושר. אש.'); const o = U.tank.obj; o.userData.ryT = Math.atan2(I.p.x - o.position.x, I.p.z - o.position.z); after(2.2, () => { const gp = o.position.clone().add(V3(0, 2.6, 0)); G.fx.muzzle(gp, I.p.clone().sub(gp).normalize(), 2.2); G.audio.explosion(gp, .7); }); }
    if (k === 'heli') { U.heli.used = true; this.cmdSay('צפע, כאן חפ״ק. מאושר. היעד מסומן.'); after(2.5, () => this.radio(HELI, 'צפע בדרך. שלושים שניות.')); }
    if (k === 'air') { U.air.busy = true; this.cmdSay('אוגדה, כאן חפ״ק. מבקש תקיפה מהאוויר ביעד המסומן.'); after(3, () => this.radio(AIR, 'מאושר. פגיעה בעוד כחמישים שניות.')); after(M.delay - 4, () => G.csound.jet()); }
    after(M.delay, () => { if (k === 'air') U.air.busy = false; t._strike = false; for (const a of this.rpg || []) a._strike = false; this.blast(t, I, k, civ0); });
    return true;
  },
  // the impact: militants inside the radius are hit; anyone else inside it is a civilian casualty and the mission fails
  blast(t, I, k, civ0) {
    const r = MUN[k].r; const p = t.alive === false || t.removed ? I.p : this.posOf(t).clone(); p.y = p.y || hC(p.x, p.z);
    if (k === 'heli') for (let i = 0; i < 6; i++) after(i * .12, () => { const q = p.clone().add(V3(rr(-3, 3), 0, rr(-3, 3))); G.fx.impact(q, V3(0, 1, 0), 'concrete'); G.audio.shotAt(q.clone().add(V3(0, 80, 0)), 'm4'); });
    G.fx.explosion(p.clone().add(V3(0, .5, 0)), k === 'air' ? 2.2 : k === 'uav' ? 1.1 : 1.4); G.audio.explosion(p, k === 'air' ? 2 : 1.2); G.fx.dustBurst && G.fx.dustBurst(p.clone(), k === 'air' ? 14 : 6, k === 'air' ? 70 : 40);
    let hit = 0;
    if (I.far && t.role === 'mortar') { if (t.alive) { t.alive = false; hit = 3; this.setThreat('mortarTeam', false); this.st.militants += 3; this.evOk('mortarTeam', 'צוות המרגמה נוטרל בפרדס, הרחק מאזרחים'); } }
    else for (const a of [...G.actors]) { if (!a.alive || a.removed || a.friendly) continue; if (a.pos.distanceTo(p) > r) continue; if (a.militant || a.armedVisible || (a.armed && a.identified)) { a.militant = true; a.damage(400, p, 'body'); hit++; this.st.militants++; } }
    if (hit && t.role === 'rpg') { this.setThreat('rpg', false); this.rpgOut = true; this.evOk('rpg', 'חוליית הנ״ט נוטרלה בשטח פתוח, לפני שהגיעה לטווח'); }
    if (hit && t === this.sniper) { this.setThreat('sniperOut', false); this.setThreat('sniper', false); if (this.sniperOutT) this.st.prevented.push('הצלף נוטרל בשטח פתוח, הרחק מאזרחים'); }
    const civ = Math.max(this.civiliansNear(p, r), I.bldg ? civ0 : 0);
    if (!hit && !civ) this.notify('התקיפה החטיאה', 'היעד זז מנקודת הפגיעה לפני שהחימוש הגיע.', false);
    if (hit && !civ) this.notify('היעד נפגע', 'החמושים נוטרלו. אין פגיעה באזרחים.', false);
    if (civ || !I.id) { let n = 0; for (const a of G.crowd.agents) if (a.alive && n < 4 && (a.x - p.x) ** 2 + (a.z - p.z) ** 2 < r * r) { if (this.civHurt(a, 'תקיפה שפגעה באזרחים', true)) n++; }
      for (const a of [...G.actors]) if (a.alive && !a.friendly && !a.militant && a.pos.distanceTo(p) < r && n < 6) { this.st.civHurt++; this.st.civHurtUnjust++; n++; a.forceAnim = 'crouch'; a.hurt = true; }
      bus.emit('missionFailed', FAIL(civ ? 'התקיפה פגעה באזרחים.' : 'התקיפה פגעה באדם שלא זוהה כחמוש.', 'אזרחים אינם יעד. תקיפה מותרת רק בזיהוי ודאי של חמוש, כשאין אזרחים בטווח הסכנה של החימוש. כרטיס התקיפה והיועמ״ש הראו את זה לפני האישור. לפעמים לא תוקפים בכלל: עשן, שריון ומחסום עושים את העבודה. נסה שוב.')); }
  },
  // ---------- per frame ----------
  opsUpdate(dt, obs) {
    this.updDrivers(dt, obs); this.updSmokes(dt);
    if (this.bag && this.bag.st !== 'done') obs.push({ x: this.bag.p.x, z: this.bag.p.z, r: this.bag.cordon ? 4.2 : .5 });
    if (this.block) obs.push({ x: this.block.position.x, z: this.block.position.z, r: 3 });
    // timeouts: what happens when nobody acts
    if (this.bag && this.bag.st === 'open' && G.time - this.bag.t0 > 60) this.bagPanic();
    if (this.convoy && this.convoy.st === 'blocked' && G.time - this.convoy.tWait > 110 && !this.convoy.late) { this.convoy.late = true; this.st.notes.push('השיירה חיכתה מול ההריסות'); this.notify('השיירה עדיין תקועה', 'האמבולנסים מחכים מול ההריסות כמעט שתי דקות. בתוכם פצועים קשה.', true); }
    const F = this.father; if (F && F.alive && !F.priority && !F.late && G.time - F.t0 > 70) { F.late = true; this.st.civHurt++; this.evBad('child', 'ילד פצוע המתין בתור בלי עדיפות, ומצבו הידרדר'); this.notify('מצבו של הילד הידרדר', 'הוא עדיין בתור. אפשר עדיין להעביר אותו בעדיפות.', true); }
    if (this.rpg && !this.rpgOut) { const tk = this.U.tank; if (tk.pos === 'west' && !tk.drive && this.rpgAlive().length) this.rpgWithdraw('המרכבה תפסה עמדה מול ההריסות. החוליה ראתה אותה, ירדה למחסה ונסוגה.'); if (!this.rpgAlive().length) this.setThreat('rpg', false); }
    if (this.mortarTeam && this.mortarTeam.alive && this.mortarNext && G.time > this.mortarNext && !this.mortarOn && !this.done) { this.mortarNext = 0; this.st.ev.mortarTeam = 'bad'; this.mortarAlert(2); }
    const T = this.tunnel; if (T && T.st === 'open' && G.time - T.t0 > 75) { T.st = 'missed'; this.setThreat('tunnel', false); this.evBad('tunnel', 'אף אחד לא נשלח לפיר: חמושים יצאו ממנו ונעלמו בין הבתים'); this.notify('תנועה בפיר', 'התצפיתנית ראתה שלושה אנשים יוצאים מהפיר ונעלמים בין הבתים ממזרח. הפיר לא אובטח בזמן.', true); }
    const K = this.lost; if (K && K.alive && !K.helped && !K.late && G.time - K.t0 > 70) { K.late = true; this.setThreat('lost', false); this.evBad('lost', 'ילדה אבודה נשארה לבד ליד המחסום'); }
    // the convoy without an escort crawls: people crowd the ambulances
    if (this.convoy && this.convoy.st === 'moving') for (const d of this.drivers) if (this.convoy.amb.includes(d.o)) d.slow = this.convoy.escort ? 1 : .5;
  },
  opsThreats(set) {
    set('convoy', !!this.convoy && this.convoy.st !== 'done' && this.convoy.st !== 'moving');
  },
  // ---------- task cards ----------
  opsTask(id) {
    const U = this.U, eye = (o, l = 'הראה ברחפן') => ({ icon: 'eye', label: l, cls: 'alt', fn: () => this.lookAt(o, !!(o && o.root)) });
    switch (id) {
      case 'bag': return { kind: 'חפץ חשוד', threat: true, title: this.bag.st === 'panic' ? 'בהלה סביב התיק' : 'תיק נטוש בכניסה למחסום', text: 'אנשים עוברים צמוד אליו. הנוהל: להרחיק אנשים ולשלוח רובוט הנדסה, בלי לסגור את המחסום. התעלמות עלולה להוליד בהלה.', hot: '', acts: [{ icon: 'flag', label: 'הרחק אנשים ושלח רובוט', fn: () => this.bagRespond() }, eye(this.bag.p)] };
      case 'bagWait': return { kind: 'חפץ חשוד', title: 'הרובוט בדרך לתיק', text: 'האנשים מורחקים ממנו בכריזה. הבדיקה תיקח פחות מדקה.', acts: [eye(this.robot.position, 'עקוב ברחפן')] };
      case 'convoy': { const C = this.convoy; if (!C) return null; if (this.block) return { kind: 'שיירה', title: 'הריסות חוסמות את שיירת הפינוי', text: 'שלושה אמבולנסים עם פצועים. קיר שקרס חוסם את נתיב הרכבים 120 מ׳ צפונה. D9 יפנה אותו בלי לעצור את הטור.', acts: [{ icon: 'flow', label: 'D9: פנה את ההריסות', fn: () => this.d9Clear() }, eye(V3(CL.vehX, 0, -125))] };
        return { kind: 'שיירה', title: C.st === 'coming' ? 'השיירה מתקרבת' : 'השיירה מחכה לליווי', text: 'בלי ליווי האנשים יתקבצו סביב האמבולנסים. צוות החי״ר ונמ״ר ב׳ יפתחו להם דרך.', acts: [{ icon: 'flag', label: 'ליווי: חי״ר ונמ״ר ב׳', fn: () => this.convoyGo(true) }, { icon: 'flow', label: 'שיעברו לבד', cls: 'alt', fn: () => this.convoyGo(false) }] }; }
      case 'child': return { kind: 'פצוע', threat: true, title: 'אב עם ילד פצוע בתור', text: 'הילד מאבד הכרה. העברה בעדיפות דרך נתיב הרכבים, והחובשים מקבלים אותו בצד השני.', hot: 'med', acts: [{ icon: 'med', label: 'העבר בעדיפות + חובשים', fn: () => this.childPriority() }, eye(this.father)] };
      case 'rpg': { const L = this.rpgAlive(); return { kind: 'נ״ט', threat: true, title: 'חוליית RPG מתקרבת ממערב', text: `בשטח פתוח בין ההריסות, בדרך לטווח ירי על נמ״ר א׳. אין אזרחים סביבם. אפשר לתקוף אחרי בדיקת מידתיות, או להציב את המרכבה מולם.`, hot: '', acts: [{ icon: 'uav', label: 'כרטיס תקיפה', fn: () => this.strikeCard(L[0]) }, { icon: 'flow', label: 'מרכבה לאגף המערבי', cls: 'alt', fn: () => this.moveArmour('tank', 'west') }] }; }
      case 'mortar': return this.mortarSh ? { kind: 'צבע אדום', threat: true, title: 'במחסה · ממתינים לנפילות', text: 'המחסום עצור והאנשים שוכבים ליד הקירות. אחרי הנפילות תחדש את המעבר.', acts: [eye(V3(-40, 0, -60), 'הראה ברחפן')] }
        : { kind: 'צבע אדום', threat: true, title: 'ירי מרגמות לעבר המחסום', text: 'נפילות בעוד שניות. עצור את המעבר והורה לאנשים לשכב ליד הקירות.', hot: 'spk', acts: [{ icon: 'spk', label: 'עצור והורה למחסה', fn: () => this.mortarShelter() }] };
      case 'mortarTeam': return { kind: 'מרגמה', threat: true, title: 'צוות המרגמה אותר', text: 'פרדס 1.4 ק״מ צפונה, אין אזרחים בטווח 200 מ׳. בלי תקיפה הם יירו שוב בעוד כדקה. בדוק מידתיות ובחר חימוש.', acts: [{ icon: 'uav', label: 'כרטיס תקיפה', fn: () => this.strikeCard(this.mortarTeam) }, { icon: 'flow', label: 'קצב רגיל', cls: 'alt', fn: () => this.order('cp', 'flow', 'open') }] };
      case 'tunnel': return { kind: 'מנהרה', threat: true, title: 'פתח פיר ליד הכביש', text: 'חצר ממזרח לכביש, 70 מ׳ צפונה. צוות החי״ר יסרוק ויאבטח, ואחר כך ה־D9 יאטום.', acts: [{ icon: 'flag', label: 'חי״ר: סרוק ואבטח', fn: () => this.tunnelSearch() }, eye(this.tunnel.p)] };
      case 'tunnelWait': return { kind: 'מנהרה', title: 'צוות החי״ר בדרך לפיר', text: 'כחצי דקה הליכה, ואז סריקה.', acts: [eye(this.tunnel.p)] };
      case 'tunnelSeal': return { kind: 'מנהרה', title: 'הפיר מאובטח', text: 'הפיר ריק. ה־D9 יכסה אותו בעפר ובבטון.', acts: [{ icon: 'flow', label: 'D9: אטום את הפיר', fn: () => this.tunnelSeal() }] };
      case 'lost': return { kind: 'אזרח', title: 'ילדה אבודה אחרי המחסום', text: 'לבד, בוכה, והטור עובר לידה. חיילת תשגיח עליה, וכריזה תקרא למשפחה לחזור.', acts: [{ icon: 'spk', label: 'השגחה + כריזה למשפחה', fn: () => this.lostHelp() }, eye(this.lost)] };
    }
    return null;
  },
  opsMarkers(L) {
    const ok = a => a && a.alive && !a.removed, T = this.threats || {};
    if (this.bag && this.bag.st !== 'done') L.push({ id: 'bag', pos: this.bag.p, label: 'תיק חשוד', kind: 'threat', h: 1.2 });
    if (this.convoy && this.convoy.st !== 'done' && this.convoy.amb[0] && this.convoy.amb[0].parent) L.push({ id: 'conv', pos: this.convoy.amb[0].position, label: 'שיירת אמבולנסים', kind: 'unit', h: 3 });
    if (this.block) L.push({ id: 'blk', pos: this.block.position, label: 'הריסות', kind: 'threat', h: 2.4 });
    if (T.child && ok(this.father)) L.push({ id: 'chd', pos: this.father.pos, label: 'ילד פצוע', kind: 'threat', h: 2.1 });
    for (const a of this.rpgAlive()) if (!this.rpgOut) L.push({ id: 'rpg' + a.id, pos: a.pos, label: 'RPG', kind: 'threat' });
    if (this.tunnel && (T.tunnel || T.tunnelSeal || T.tunnelWait)) L.push({ id: 'tun', pos: this.tunnel.p, label: 'פיר', kind: 'threat', h: 1.4 });
    if (T.lost && ok(this.lost)) L.push({ id: 'lost', pos: this.lost.pos, label: 'ילדה אבודה', kind: 'threat', h: 1.4 });
    const U = this.U; if (U.d9.busy) L.push({ id: 'd9', pos: this.d9.position, label: 'D9', kind: 'unit', h: 4 }); if (U.inf.busy && ok(this.inf[0])) L.push({ id: 'inf', pos: this.inf[0].pos, label: 'חי״ר', kind: 'unit', h: 2.3 });
    if (U.eng.busy) L.push({ id: 'rob', pos: this.robot.position, label: 'רובוט', kind: 'unit', h: 1.2 });
  },
  opsMap(g, px, pz) {
    const sq = (p, col, lbl, s = 4) => { g.fillStyle = col; g.fillRect(px(p.x) - s, pz(p.z) - s, s * 2, s * 2); if (lbl) { g.font = '700 10px Heebo'; g.textAlign = 'center'; g.fillText(lbl, px(p.x), pz(p.z) - s - 3); } };
    if (this.block) sq(this.block.position, '#b8ad96', 'הריסות', 5);
    if (this.bag && this.bag.st !== 'done') sq(this.bag.p, '#ff6a50', 'תיק', 3);
    if (this.tunnel && this.tunnel.st !== 'done') sq(this.tunnel.p, '#ff6a50', 'פיר', 4);
    sq(this.d9.position, '#9ac0e6', 'D9', 4); if (this.U.eng.busy) sq(this.robot.position, '#9ac0e6', '', 2);
    if (this.convoy && this.convoy.st !== 'done') for (const o of this.convoy.amb) if (o.parent) sq(o.position, '#f2f0ea', '', 3);
    for (const s of this.smokes || []) if (s.until > G.time) { g.fillStyle = 'rgba(230,230,220,.35)'; g.beginPath(); g.arc(px(s.p.x), pz(s.p.z), 14, 0, 7); g.fill(); }
    if (this.mortarTeam && this.mortarTeam.alive) { g.fillStyle = '#ff6a50'; g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText('▲ מרגמה · 1.4 ק״מ', px(-70), 28); }
  },
  // ---------- score ----------
  scoreRows(final = true) {
    const s = this.st, ev = s.ev, done = Object.values(ev).filter(v => v !== 'open'), okN = done.filter(v => v === 'ok').length;
    const rows = [
      { k: 'הגנה על אזרחים', max: 40, pts: Math.max(0, 40 - 14 * s.civHurtUnjust - 7 * (s.civHurt - s.civHurtUnjust)), why: s.civHurt ? `${s.civHurt} נפגעו` : 'אף אזרח לא נפגע' },
      { k: 'הגנה על הכוחות', max: 15, pts: Math.max(0, 15 - 8 * s.idfHurt), why: s.idfHurt ? `${s.idfHurt} לוחמים נפגעו` : 'אף לוחם לא נפגע' },
      { k: 'זרימה ועמידה בזמנים', max: 20, pts: Math.max(0, 20 - (final && s.stranded >= 15 ? 8 : 0) - 3 * s.notes.filter(n => n.includes('חיכתה')).length - (this.crushed ? 4 : 0)), why: final ? `${s.passed} עברו${s.stranded >= 15 ? `, ${s.stranded} נשארו בתור` : ''}` : `${G.crowd.passed} עברו עד עכשיו` },
      { k: 'סינון ומודיעין', max: 15, pts: this.cellPassed ? 0 : Math.max(0, 15 - 5 * s.wrongDetain), why: this.cellPassed ? 'חמוש עבר' : s.wrongDetain ? `${s.wrongDetain} עיכובים שגויים` : s.detained ? `${s.detained} חמושים עוכבו` : 'אין עיכובים שגויים' },
      { k: 'טיפול באירועים', max: 10, pts: done.length ? Math.round(10 * okN / done.length) : 10, why: `${okN} מתוך ${done.length} טופלו נכון` },
    ];
    return rows;
  },
};
