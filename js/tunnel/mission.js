// "The Shaft": the incident commander finds and demolishes a tunnel shaft on the edge of a Gaza neighbourhood.
// Four phases: search (three candidate houses, clues from the UAV feed), approach (route, a rooftop watcher, an anti-tank
// cell), the shaft (robot, booby trap, charges, evacuating the neighbours, safety radius, the blast) and extraction under fire.
// The commander never shoots: every action is an order, and every order is judged by who it could hurt.
import * as THREE from 'three';
import { G, rr, clamp, V3, bus, after, fmtClock } from '../core.js';
import { Actor } from '../actors.js';
import { VO } from '../vo.js';
import { TL, ROUTES, hT } from './world.js';

export const TSTAGES = ['איתור הבית', 'גישה', 'טיהור ואיתור הפיר', 'פינוי ורדיוס בטיחות', 'פיצוץ הפיר', 'חילוץ'];
export const TSPEAKERS = {
  INT: { name: 'קצינת המודיעין', color: '#f2b84b', radio: false },
  HQ: { name: 'חמ״ל החטיבה', color: '#9ac0e6', radio: true },
  NAH: { name: 'מ״פ "נחש"', color: '#9ac0e6', radio: true },
  PAT: { name: 'צוות הנדסה "פטיש"', color: '#9ac0e6', radio: true },
  ZIK: { name: 'מפעילת "זיק"', color: '#c9a6e6', radio: true },
  TANK: { name: 'טנק', color: '#9ac0e6', radio: true },
};
const $ = id => document.getElementById(id);
let lineN = 0;
// no recorded voice in this mission: radio lines are subtitles with a duration from their length
function say(sp, text) { const id = 't' + (++lineN); VO[id] = { sp, text, off: 0, dur: clamp(1.2 + text.length * .055, 2.4, 7.5) }; G.audio.say(id, { ttl: 16000 }); }
const ok = a => a && a.alive && !a.removed && !a.down;
const P2 = (x, z) => V3(x, hT(x, z), z);
const HN = { A: 'בית א׳', B: 'בית ב׳', C: 'בית ג׳', N1: 'בית השכנים (צפון)', N2: 'בית השכנים (דרום)', H: 'הבית ליד המגרש', W: 'הבית של הצופה' };

export class TunnelMission {
  constructor() {
    this.t = 0; this.stage = -1; this.events = []; this.intel = []; this.units = []; this.risk = 12; this.phase = 'menu';
    this.st = { teamHurt: 0, civHurt: 0, militants: 0, shaft: false, wrong: [], prevented: [], violations: [] };
    this.look = {}; this.clues = { A: {}, B: {}, C: {} }; this.searched = {};
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
    G.state = 'play'; this.t = 0; this.stageSet(0); this.phase = 'search'; this.threats = {};
    G.player.setPos(V3(TL.cmd.x, hT(TL.cmd.x, TL.cmd.z) + .05, TL.cmd.z), Math.PI / 2 + .04); G.player.pitch = -.05;
    this.spawnTeam(); this.units = [
      { id: 'force', name: 'כוח "נחש" + הנדסה "פטיש"', sub: '4 לוחמי קומנדו, 3 חבלנים' },
      { id: 'robot', name: 'רובוט "חולד"', sub: 'יורד לפיר לפני הלוחמים', used: false },
      { id: 'spk', name: 'אזהרה לשכנים', sub: 'כריזה מהנמר ושיחות טלפון לבתים', cd: 0 },
      { id: 'smoke', name: 'רימוני עשן', sub: 'מסך עשן סביב הכוח', n: 3, cd: 0 },
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
    if (this.robot) { const r = this.robot; if (r.go) { const d = r.go.clone().sub(r.m.position); d.y = 0; const L = d.length(); if (L > .1) { r.m.position.addScaledVector(d, Math.min(1, dt * .6 / L)); r.m.rotation.y = Math.atan2(d.x, d.z); r.m.position.y = hT(r.m.position.x, r.m.position.z); } else r.m.visible = !r.hide; } }
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
    // two commandos hold the door outside, the rest go in
    const al = this.alive(); al.forEach((a, i) => { if (i === 1 || i === 3) { a.lookAt = P2(h.o.x - 30, h.o.z + (i === 1 ? -20 : 20)); a.readyAim = true; return; } a.setPath([V3(door[0], 0, door[1])], 1.6, () => { a.root.visible = false; a.noSnap = true; a.inside = true; }); });
    this.phase = 'clearing'; this.stageSet(2); say('NAH', `"נחש" ב${HN[id]}. נכנסים לטהר.`);
    this.objective('טיהור הבית', `"נחש" מטהרים את ${HN[id]} ומחפשים את הפיר.`);
    if (id === 'B') this.at(16, () => this.foundShaft());
    else this.at(id === 'A' ? 30 : 22, () => {
      this.searched[id] = true; this.st.wrong.push(id); this.riskAdd(14);
      const txt = id === 'A' ? 'בית א׳ נקי. רק משפחה עם ילדים, מבוהלים. אין פיר. ביזבזנו זמן והשכונה מתעוררת.' : 'בית ג׳ נקי. מבנה ריק, אין פיר. ביזבזנו זמן.';
      say('NAH', txt); this.addIntel('"נחש"', txt, true);
      for (const a of this.alive()) { if (a.inside) { a.inside = false; a.root.visible = true; a.noSnap = false; } }
      this.phase = 'choose'; this.stageSet(0); this.objective('בחר בית אחר', 'הבית הזה נקי. בחר לאן ממשיכים.');
    });
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
    this.phase = 'shaft'; this.stageSet(2); this.shaftP = P2(TL.B.x - 3, TL.B.z + 1);
    say('PAT', 'מצאנו את הפיר. מתחת לאריחי המטבח, פתח של שבעים סנטימטר, סולם ברזל. נראה עמוק.');
    this.addIntel('צוות "פטיש"', 'פיר מתחת לרצפת המטבח בקומת הקרקע: פתח 70 ס״מ, סולם ברזל, עומק משוער 20 מ׳ ויותר. כבל החשמל מהרחוב יורד לתוכו.', true);
    this.addIntel('חמ״ל', 'רדיוס בטיחות לפיצוץ: 45 מ׳. בתוכו שני בתים מאוכלסים, צפונה ודרומה לבית ב׳. צריך לפנות אותם ולהרחיק את הכוח לפני הפיצוץ.', true);
    this.objective('הפיר', 'קודם לבדוק את הפיר (רובוט), להוריד מטענים, לפנות את השכנים ולהרחיק את הכוח.');
    this.radiusOn = true;
  }
  sendRobot() {
    if (this.phase !== 'shaft' || this.U.robot.used) return 'אין צורך ברובוט עכשיו'; this.U.robot.used = true;
    const m = new THREE.Group(); const mt = new THREE.MeshStandardMaterial({ color: '#3a3d34', roughness: .7, metalness: .3 }); m.add(new THREE.Mesh(new THREE.BoxGeometry(.5, .25, .7), mt)); for (const s of [-1, 1]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(.12, .2, .78), new THREE.MeshStandardMaterial({ color: '#151514', roughness: .9 })); tr.position.set(s * .3, -.04, 0); m.add(tr); } const arm = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .5), mt); arm.position.set(0, .22, .2); arm.rotation.x = -.5; m.add(arm);
    m.position.copy(P2(TL.B.door[0] + 2, TL.B.door[1] - 3)); G.scene.add(m); this.robot = { m, go: P2(TL.B.door[0], TL.B.door[1] + .5) };
    after(5, () => { this.robot.hide = true; this.robot.m.visible = false; });
    say('PAT', '"חולד" יורד לפיר. שומרים מרחק.'); this.robotBusy = true;
    after(24, () => { this.robotBusy = false; this.trapFound = true; say('PAT', '"חולד" מצא מלכוד בעומק שישה מטרים: מטען עם חוט מעידה על הסולם. מסמנים ומנטרלים.'); this.addIntel('צוות "פטיש"', 'מלכוד בפיר: מטען עם חוט מעידה בעומק 6 מ׳, על הסולם. ממשיך מנהרה מערבה, בעומק 22 מ׳.', true); this.st.prevented.push('הרובוט מצא את המלכוד לפני שלוחם ירד לפיר'); });
    return true;
  }
  sendSoldierDown() {
    if (this.phase !== 'shaft' || this.trapFound || this.trapBlown) return 'אין צורך'; this.U.robot.used = true; this.robotBusy = true;
    say('PAT', 'לוחם יורד לבדוק את הפיר.');
    after(9, () => { this.robotBusy = false; this.trapBlown = true; this.trapFound = true; const a = this.alive().find(x => x.eng) || this.alive()[0]; G.audio.explosion(this.shaftP, .7); G.fx.dustBurst(this.shaftP.clone().add(V3(0, 1, 0)), 3, 40);
      a.root.visible = true; a.inside = false; a.noSnap = false; a.pos.copy(P2(TL.B.door[0] + 1, TL.B.door[1] - 1)); a.damage(70, this.shaftP, 'legs'); this.st.violations.push('לוחם ירד לפיר לפני סריקה והפעיל מלכוד');
      say('PAT', 'פיצוץ בפיר! מלכוד על הסולם. יש לנו פצוע.'); });
    return true;
  }
  placeCharges() {
    if (this.phase !== 'shaft' || !this.trapFound || this.robotBusy) return 'קודם צריך לבדוק את הפיר'; if (this.charging || this.charged) return 'כבר בביצוע';
    this.charging = true; say('PAT', '"פטיש": מנטרלים את המלכוד ומורידים מטענים לפיר. שלושים שניות.');
    after(28, () => { this.charging = false; this.charged = true; say('PAT', 'המטענים בפיר ובתחילת המנהרה. מוכנים לפיצוץ מרחוק.'); this.addIntel('צוות "פטיש"', 'מטענים הונחו בפיר ובקטע הראשון של המנהרה. הפעלה מרחוק, רדיוס בטיחות 45 מ׳.'); });
    return true;
  }
  // the neighbours: a warning by loudspeaker and by phone. One old man in the southern house will not leave.
  warnNeighbours() {
    const u = this.U.spk; if (u.cd > 0) return 'הכריזה כבר משודרת'; u.cd = 20; this.warned = true; this.stageSet(3);
    say('NAH', 'כריזה בערבית ושיחות לבתים: "צאו מהבתים, מערבה, עכשיו. יהיה פיצוץ."'); G.command.pulse(P2(TL.B.x, TL.B.z), '#f2b84b', 45, 2.4);
    if (!this.evacStarted) { this.evacStarted = true;
      const out = (house, model, k, delay) => after(delay, () => { const h = G.houses[house]; const door = TL[house].door; const b = h.blobs.find(x => !x.userData.gone); if (b) b.userData.gone = true;
        const a = new Actor(model, 'civ', P2(door[0], door[1]), 0, {}); a.role = 'resident'; a.brain = () => {}; const g = TL.gather; a.setPath([P2(door[0] + (house === 'N2' ? -10 : -6), door[1] + (house === 'N2' ? 6 : -2)), P2(g.x + k * 1.4 - 3, g.z + (k % 2) * 1.6)], 1.5, () => { a.idleAnim = 'nervous'; a.faceTo(P2(TL.B.x, TL.B.z)); }); });
      out('N1', 'civM1', 0, 6); out('N1', 'civF1', 1, 7.5); out('N1', 'civM2', 2, 9); out('N1', 'civF1', 3, 10.5); out('N2', 'civF1', 4, 12); out('N2', 'civM1', 5, 13.5);
      after(30, () => { this.holdoutKnown = 'ground'; this.addIntel('"נחש"', 'מהבית הדרומי יצאו שניים. לפי השכנים, אביהם הקשיש נשאר בפנים. בדוק בתרמי.', true); say('NAH', 'מהבית הדרומי יצאו רק שניים. אומרים שהאבא הקשיש נשאר בפנים.'); });
      // the shaft's own two diggers (the warm figures in B) slipped into the tunnel before the force arrived
      const hb = G.houses.B.blobs; if (hb) for (const b of hb) b.userData.gone = true;
    }
    return true;
  }
  holdout() { const h = G.houses.N2; return h.blobs.filter(b => !b.userData.gone).length; }
  escortHoldout() {
    if (!this.warned) return 'קודם להזהיר את השכנים'; if (this.escorting) return 'כבר בביצוע'; if (!this.holdout()) return 'הבית ריק';
    this.escorting = true; const two = this.alive().filter(a => !a.eng && !a.down).slice(0, 2); const door = TL.N2.door;
    say('NAH', 'שניים מ"נחש" הולכים להוציא את הקשיש.');
    two.forEach((a, i) => { a.root.visible = true; a.inside = false; a.noSnap = false; a.lookAt = null; a.setPath([P2(TL.B.door[0] + 3, TL.B.door[1] - 2), P2(-106, 10), P2(-98, 36), P2(door[0] + i * 1.2, door[1] - 1)], 2.4, () => {
      if (i) return; after(6, () => { for (const b of G.houses.N2.blobs) b.userData.gone = true; const old = new Actor('civM2', 'civ', P2(door[0], door[1]), 0, {}); old.role = 'resident'; old.brain = () => {}; old.hurt = true;
        const dst = [P2(-88, 56), P2(-62, 66)]; old.setPath(dst, 1.25, () => { old.idleAnim = 'nervous'; }); for (const s of two) s.setPath(dst.map(p => p.clone().add(V3(1.2, 0, -1))), 1.3, () => { s.lookAt = P2(TL.B.x, TL.B.z); this.escorted = true; this.st.prevented.push('הקשיש שנשאר בבית פונה לפני הפיצוץ'); say('NAH', 'הקשיש בחוץ, רחוק מהרדיוס. הבית הדרומי ריק.'); }); }); }); });
    return true;
  }
  roofKnock() { if (!this.holdout()) return 'הבית ריק'; if (this.knocked) return 'כבר בוצע'; this.knocked = true; const h = G.houses.N2; const p = V3(h.o.x, h.top + .5, h.o.z); after(3, () => { G.audio.explosion(p, .25); G.fx.dustBurst(p, 1.5, 20); });
    say('HQ', 'נקישה על הגג של הבית הדרומי: תחמושת אזהרה קטנה, בלי מטען נפץ. מחכים שייצא.'); this.riskAdd(6);
    after(26, () => { if (!this.holdout()) return; for (const b of h.blobs) b.userData.gone = true; const door = TL.N2.door; const old = new Actor('civM2', 'civ', P2(door[0], door[1]), 0, {}); old.role = 'resident'; old.brain = () => {}; old.hurt = true; old.setPath([P2(-110, 60), P2(-150, 70), P2(TL.gather.x, TL.gather.z + 3)], 1, () => { old.idleAnim = 'nervous'; }); this.escorted = true; this.addIntel('מפעילת "זיק"', 'הקשיש יצא מהבית הדרומי והולך מערבה.'); });
    return true;
  }
  withdraw() {
    if (!this.charged) return 'קודם להניח מטענים'; if (this.phase === 'withdraw' || this.out) return 'הכוח כבר יוצא';
    this.phase = 'withdraw'; this.stageSet(3); for (const a of this.alive()) { a.inside = false; a.root.visible = true; a.noSnap = false; }
    say('NAH', '"נחש" ו"פטיש" יוצאים מהרדיוס, לנקודת הכינוס ברחוב.'); this.moveTeam(ROUTES.out, 3.2, () => { this.out = true; this.phase = 'ready'; this.stageSet(4); for (const a of this.alive()) a.lookAt = P2(TL.B.x, TL.B.z); say('NAH', 'כולם בחוץ, 78 מטר מהבית. מוכנים.'); });
    return true;
  }
  blast() {
    if (!this.charged) return 'אין מטענים בפיר'; if (this.blown) return 'כבר פוצץ';
    this.blown = true; this.phase = 'blast'; this.stageSet(4); const p = P2(TL.B.x, TL.B.z);
    say('PAT', 'שלוש, שתיים, אחת. הפעלה.');
    after(3, () => { G.fx.explosion(p.clone().add(V3(0, 2, 0)), 3); G.fx.explosion(p.clone().add(V3(-6, 1, 3)), 2); G.audio.explosion(p, 2); G.ui.flash(.25); G.collapse = { t: 0 }; G.genOff = true;
      const r = this.harm(p, TL.radius); this.st.shaft = true;
      if (r.civ) this.notify('אזרחים נפגעו בפיצוץ', `${r.civ} אזרחים היו בתוך רדיוס הבטיחות.`, true);
      if (r.team) this.notify('לוחמים נפגעו בפיצוץ', 'חלק מהכוח היה בתוך רדיוס הבטיחות.', true);
      this.addIntel('מפעילת "זיק"', 'הפיר קרס. הבית שקע לתוך הבור, עמוד אבק גבוה מעל השכונה. המנהרה מתחתיו התמוטטה.'); say('ZIK', 'הפיר קרס. הבית שקע לבור. עמוד אבק מעל השכונה.');
      this.at(9, () => this.spawnShooter()); });
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
      al.forEach((a, i) => after(i * .5, () => { a.lookAt = null; a.setPath([rear], a.down ? 1 : 3, () => { a.root.visible = false; a.noSnap = true; a.inside = true; if (++n === al.length) this.boardDone(); }); }));
    });
    return true;
  }
  boardDone() { this.boarded = true; const v = G.apc; v.rampOpen = false; say('NAH', 'כולם בנמר. יוצאים.'); after(1.5, () => v.followPath([v.obj.position.clone(), V3(10, 0, 10), V3(60, 0, 10), V3(78, 0, 4)], 9, () => this.finish())); }
  // ---------- orders (from the task card, the bar and the tablet) ----------
  order(uid, action, arg) {
    if (G.state !== 'play') return false;
    switch (uid) {
      case 'zik': case 'tank': case 'air': return this.strike(uid, arg);
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
    // threats first
    if (this.shooter && ok(this.shooter) && !this.boarded) return { kind: 'איום', threat: true, title: 'ירי על הכוח בנקודת הכינוס', text: 'חמוש על גג בצפון־מערב יורה על הכוח. מסך עשן מסתיר אותם והנמר אוסף אותם. הבית שלו ריק, אז אפשר גם פגז.', hot: 'smoke',
      acts: [{ icon: 'smoke', label: this.smokeT > 4 ? 'נמר לאיסוף' : 'עשן ונמר לאיסוף', fn: () => { if (this.smokeT <= 4) this.smoke(); return this.U.apc.busy ? true : this.pickup(); } }, { icon: 'tank', label: 'פגז לעמדת הירי', cls: 'danger', fn: () => this.strike('tank', this.shooter) }, eye(this.shooter)] };
    const inbound = a => ({ kind: 'איום', threat: true, title: 'תקיפה בדרך ליעד', text: a.struck === 'air' ? 'הסיוע האווירי בדרך. עקוב ב"זיק" שהיעד לא נכנס בין בתים.' : 'החימוש בדרך. עקוב ב"זיק".', acts: [eye(a, null, 'עקוב ב"זיק"')] });
    if (this.cell && !this.cell.fired) { const z = this.cellZone(); const a = this.cell.men.find(ok); if (a && this.cell.men.some(m => m.struck && m.struck !== 'air')) return inbound(this.cell.men.find(m => m.struck));
      if (z === 'open') return { kind: 'איום', threat: true, title: 'חוליית ה־RPG בשטח פתוח', text: 'החמושים חוצים מגרש ריק, אין אזרחים בסביבה. זה החלון לתקוף: "זיק" מדויק, או פגז. תקיפה אווירית תגיע מאוחר מדי.', hot: 'zik',
        acts: [...(U.zik.ammo > 0 && !U.zik.pending && U.zik.cd <= 0 ? [{ icon: 'zik', label: 'תקיפת "זיק"', fn: () => this.strike('zik', a) }, { icon: 'tank', label: 'פגז טנק', cls: 'alt', fn: () => this.strike('tank', a) }] : [{ icon: 'tank', label: 'פגז טנק', fn: () => this.strike('tank', a) }]), { icon: 'air', label: 'סיוע אווירי', cls: 'danger', fn: () => this.strike('air', a) }] };
      if (z === 'ambush') return { kind: 'איום', threat: true, title: 'חוליית ה־RPG במארב', text: `החמושים כורעים ליד ${HN[this.nearOccupied(a.pos, 20)] || 'בית'} שיש בו משפחה. תקיפה כאן תפגע בה. מסך עשן יסתיר את הכוח.`, hot: 'smoke',
        acts: [{ icon: 'smoke', label: 'מסך עשן לכוח', fn: () => this.smoke() }, eye(a), { icon: 'zik', label: 'תקיפת "זיק"', cls: 'danger', fn: () => this.strike('zik', a) }] };
      if (z === 'houses') return { kind: 'איום', threat: true, title: 'חוליית ה־RPG ליד בתים', text: 'החמושים עוברים ליד בית מאוכלס. לא תוקפים כאן. אם הם מתמקמים, מסך עשן יגן על הכוח.', acts: [eye(a, null, 'עקוב ב"זיק"'), { icon: 'smoke', label: 'מסך עשן לכוח', cls: 'alt', fn: () => this.smoke() }] };
      if (z === 'alley') return { kind: 'איום', threat: true, title: 'חוליית RPG בסמטאות', text: 'שני חמושים נעים בין הבתים לעבר הכוח. עקוב אחריהם ב"זיק" וחכה שייצאו לשטח פתוח.', acts: [eye(a, null, 'עקוב ב"זיק"')] }; }
    if (this.watcher && ok(this.watcher) && !this.watcher.resolved) { const w = this.watcher;
      if (!w.idd) return { kind: 'זיהוי', threat: true, title: 'מי על הגג?', text: 'דמות על גג וצופה בכוח. אין עדיין זיהוי. קרב את "זיק" אליו וחכה לזיהוי: נשק או טלפון.', acts: [{ icon: 'eye', label: 'זהה ב"זיק"', fn: () => this.lookAt(w, false) }, { icon: 'zik', label: 'תקיפה בלי זיהוי', cls: 'danger', fn: () => this.strike('zik', w) }] };
      if (w.armed && w.struck) return inbound(w);
      if (w.armed) { const z = { icon: 'zik', label: 'תקיפת "זיק"', fn: () => this.strike('zik', w) }, t = { icon: 'tank', label: 'פגז טנק', fn: () => this.strike('tank', w) };
        return { kind: 'איום', threat: true, title: 'תצפיתן חמוש על הגג', text: 'זיהוי ודאי: רובה ומכשיר קשר. אין אזרחים על הגג. "זיק" מדויק או פגז ינטרלו אותו לפני שידווח על הכוח.', hot: 'zik', acts: U.zik.ammo > 0 && !U.zik.pending && U.zik.cd <= 0 ? [z, { ...t, cls: 'alt' }] : [t, { ...z, cls: 'alt' }] }; }
      return { kind: 'זיהוי', title: 'על הגג: אזרח עם טלפון', text: 'אין נשק. אדם שעלה לגג עם הטלפון. לא תוקפים. ממשיכים לעקוב.', acts: [{ icon: 'eye', label: 'המשך מעקב, בלי אש', fn: () => { w.resolved = true; this.st.prevented.push('האדם על הגג זוהה כאזרח ולא הותקף'); this.setThreat('watcher', false); return true; } }, { icon: 'zik', label: 'תקוף בכל זאת', cls: 'danger', fn: () => this.strike('zik', w) }] }; }
    // the phase's own next step
    switch (this.phase) {
      case 'search': case 'choose': {
        const nxt = this.phase === 'search' && ['A', 'B', 'C'].find(id => !this.clues[id].eo);
        if (nxt) return { kind: 'משימה', title: `בדוק את ${HN[nxt]}`, text: 'החזק את "זיק" על הבית ובחן אותו ביום. חפש חול טרי, כבלים וגנרטור.', hot: 'zik', acts: [{ icon: 'eye', label: `הראה ב"זיק": ${HN[nxt]}`, fn: () => this.lookAt(H(nxt).center, false) }, { icon: 'tab', label: 'טאבלט', cls: 'alt', fn: () => G.tablet.show('drone') }] };
        if (this.phase === 'search' && !this.clues.B.ir) return { kind: 'משימה', title: 'בית ב׳ בתרמי', text: 'בבית ב׳ יש חול טרי, כבל וגנרטור. בתרמי רואים אם יש חום מהקרקע.', hot: 'zik', acts: [{ icon: 'eye', label: 'תרמי על בית ב׳', fn: () => this.lookAt(H('B').center, true) }, { icon: 'eye', label: 'תרמי על בית א׳', cls: 'alt', fn: () => this.lookAt(H('A').center, true) }] };
        const opts = ['B', 'A', 'C'].filter(id => !this.searched[id] && id !== this.where);
        return { kind: 'החלטה', title: 'לאן שולחים את הכוח?', text: this.clues.B.ir ? 'בבית ב׳: חול טרי, כבל, גנרטור וחום מחלון המטבח. בבית א׳ משפחה, ובית ג׳ קר וריק.' : 'בחר בית לפשיטה. כל בית שגוי עולה בזמן ומעלה את הסיכון.', acts: opts.map((id, i) => ({ icon: 'force', label: `שלח ל${HN[id]}`, cls: i ? 'alt' : '', fn: () => this.sendTo(id) })) }; }
      case 'route': return { kind: 'החלטה', title: 'מסלול לבית ב׳', text: 'דרך המטע: מחופה, ארוכה יותר. ברחוב הפתוח: מהיר, אבל הכוח חשוף לגגות ולסמטאות.', acts: [{ icon: 'force', label: 'דרך המטע (מחופה)', fn: () => { this.phase = 'search'; return this.sendTo('B', 'cover'); } }, { icon: 'force', label: 'ברחוב (מהיר)', cls: 'alt', fn: () => { this.phase = 'search'; return this.sendTo('B', 'fast'); } }] };
      case 'shaft': {
        if (!this.trapFound) return { kind: 'משימה', title: 'הפיר נמצא', text: this.robotBusy ? 'בבדיקה…' : 'לפני שמישהו יורד: רובוט "חולד" סורק את הפיר ומחפש מלכודים.', hot: 'robot', acts: this.robotBusy ? [eye(H('B').center)] : [{ icon: 'robot', label: 'שלח רובוט לפיר', fn: () => this.sendRobot() }, { icon: 'force', label: 'לוחם יורד לבדוק', cls: 'danger', fn: () => this.sendSoldierDown() }] };
        if (!this.charged && !this.charging) return { kind: 'משימה', title: 'מטענים לפיר', text: 'המלכוד סומן. צוות "פטיש" מנטרל אותו ומוריד מטענים לפיר ולתחילת המנהרה.', acts: [{ icon: 'force', label: 'הנח מטענים', fn: () => this.placeCharges() }] };
        if (!this.warned) return { kind: 'משימה', title: 'פינוי השכנים', text: 'שני בתים מאוכלסים בתוך רדיוס 45 מ׳. כריזה בערבית ושיחות טלפון לבתים: לצאת מערבה.', hot: 'spk', acts: [{ icon: 'spk', label: 'כריזה ואזהרה בטלפון', fn: () => this.warnNeighbours() }, eye(P2(TL.B.x, TL.B.z), true, 'בתרמי: מי בבתים')] };
        if (this.holdout() && this.holdoutKnown && !this.escorting && !this.knocked) return { kind: 'משימה', title: 'אדם נשאר בבית הדרומי', text: 'בתרמי: אדם אחד עדיין בבית הדרומי, בתוך הרדיוס. שני לוחמים יכולים להוציא אותו בעדינות.', acts: [{ icon: 'force', label: 'שלח לוחמים להוציא אותו', fn: () => this.escortHoldout() }, eye(H('N2').center, true, 'בדוק בתרמי'), { icon: 'air', label: 'נקישה על הגג', cls: 'alt', fn: () => this.roofKnock() }] };
        if (this.charging || (this.holdout() && !this.holdoutKnown) || (this.escorting && !this.escorted) || (this.knocked && !this.escorted)) return { kind: 'מצב', title: this.charging ? 'מורידים מטענים…' : 'השכנים יוצאים…', text: 'עקוב בתרמי שהבתים ברדיוס מתרוקנים.', acts: [eye(P2(TL.B.x, TL.B.z), true, 'תרמי על הרדיוס')] };
        return { kind: 'משימה', title: 'להרחיק את הכוח', text: 'המטענים מוכנים והבתים ריקים. הכוח יוצא לנקודת הכינוס, 78 מ׳ מהבית.', acts: [{ icon: 'force', label: 'הוצא את הכוח מהרדיוס', fn: () => this.withdraw() }] }; }
      case 'withdraw': return { kind: 'מצב', title: 'הכוח יוצא מהרדיוס', text: 'מחכים שכולם יגיעו לנקודת הכינוס.', acts: [eye(this.teamPos())] };
      case 'ready': { const inR = this.civsNear(P2(TL.B.x, TL.B.z), TL.radius).length + ['N1', 'N2'].reduce((s, id) => s + G.houses[id].blobs.filter(b => !b.userData.gone).length, 0);
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
    if (this.shooter && ok(this.shooter)) L.push({ id: 'sh', pos: this.shooter.pos, label: 'ירי', kind: 'threat' });
    if (this.U && this.U.apc.busy) L.push({ id: 'apc', pos: G.apc.obj.position, label: 'נמר', kind: 'unit', h: 3.4 });
    return L;
  }
  // ---------- intel & notifications ----------
  addIntel(from, text, red = false) { const it = { t: G.missionClock, from, text, red, isNew: true }; this.intel.unshift(it); G.tablet && G.tablet.onIntel(it); this.notify(from, text, red, true); }
  notify(h, text, red, intel = false) { const n = $('notif'); if (!n) return; $('notifH').textContent = h; $('notifT').textContent = text; n.className = 'on' + (red ? ' red' : ''); n.onclick = () => G.tablet && G.tablet.show(intel ? 'intel' : 'drone'); clearTimeout(this._nt); this._nt = setTimeout(() => n.className = '', red ? 9000 : 6500); if (G.tablet) G.tablet.toast(h, text, red); if (red) G.audio.squelch && G.audio.squelch(); }
  // ---------- identification (tablet) ----------
  identify(o) {
    if (o.isVector3) return { name: 'נקודה', desc: '', threat: false };
    if (o.friendly) return { name: o.name || 'כוח שלנו', desc: o.eng ? 'חבלן מצוות ההנדסה.' : 'לוחם קומנדו.', threat: false, unit: true };
    const r = o.role;
    if (r === 'watcher') return o.idd ? (o.armed ? { name: 'תצפיתן חמוש', desc: 'רובה על המעקה ומכשיר קשר. מדווח על הכוח.', threat: true } : { name: 'אזרח עם טלפון', desc: 'אין נשק. תושב שעלה לגג. לא איום.', threat: false }) : { name: 'דמות על גג', desc: 'אין עדיין זיהוי. החזק את "זיק" עליו, בזום, עד לזיהוי.', threat: false };
    if (r === 'rpg') return { name: 'חמוש · חוליית נ״ט', desc: o === (this.cell && this.cell.men[0]) ? 'נושא מטול RPG.' : 'חמוש ברובה, מלווה את נושא המטול.', threat: true };
    if (r === 'shooter') return { name: 'חמוש יורה', desc: 'יורה על הכוח מגג. הבית מתחתיו ריק.', threat: true };
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
    if (G.state !== 'play') return; this.phase = 'done'; G.stats.end = performance.now();
    bus.emit('missionComplete', {});
  }
  fillEnd() {
    const s = this.st; const secs = Math.round((G.stats.end - G.stats.start) / 1000);
    $('st-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; $('st-shaft').textContent = s.shaft ? 'הושמד' : 'לא'; $('st-idf').textContent = s.teamHurt; $('st-civ').textContent = s.civHurt;
    const perfect = s.shaft && s.teamHurt === 0 && s.civHurt === 0;
    $('endGrade').innerHTML = perfect ? 'הפיר הושמד ואף אחד לא נפגע.<small>הבית הנכון, זיהוי לפני אש, פינוי לפני פיצוץ. זו המטרה.</small>'
      : s.civHurt ? 'הפיר ' + (s.shaft ? 'הושמד' : 'לא הושמד') + ', אבל אזרחים נפגעו.<small>פגיעה באזרחים היא כישלון, גם כשהמשימה הושלמה. בדוק לפני כל אש ולפני כל פיצוץ מי נמצא ברדיוס.</small>'
      : s.teamHurt ? 'הפיר הושמד, אבל לוחמים נפצעו.<small>רובוט לפני לוחם, עשן מול נ״ט, ותקיפה בחלון הנכון שומרים על הכוח.</small>' : 'המשימה הסתיימה.';
    const li = []; for (const p of s.prevented) li.push([p, false]);
    for (const w of s.wrong) li.push([`חיפוש ב${HN[w]}: בית נקי, זמן וסיכון`, true]);
    for (const v of s.violations) li.push([v, true]);
    if (s.militants) li.push([`${s.militants} חמושים נפגעו`, false]);
    li.push(['הפיר והקטע הראשון של המנהרה קרסו. הבית שמעליו נהרס בפיצוץ.', false]);
    $('endList').innerHTML = li.map(([t, b]) => `<li class="${b ? 'bad' : ''}">${t}</li>`).join('');
    $('endEyebrow').textContent = fmtClock(G.missionClock).slice(0, 5) + ' · הכוח חזר למאסף';
  }
}
