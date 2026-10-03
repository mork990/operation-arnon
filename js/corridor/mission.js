// "The Corridor" scenario: an IDF-coordinated evacuation corridor on the Salah al-Din road, November 2023.
// The player is the incident commander at a forward post over a checkpoint on the corridor. Goal: get the civilians
// through safely and on time, and keep armed men from using the corridor. Decisions, not shooting.
// All characters and call-signs are fictional.
import * as THREE from 'three';
import { G, rr, R, pick, clamp, V3, bus, after, fmtClock, sstep } from '../core.js';
import { Actor } from '../actors.js';
import { CL, hC, makeCart, civCar } from './world.js';

export const CSTAGES = ['פתיחת המסדרון', 'זרם גדל במחסום', 'התראה: חוליה חמושה בטור', 'ירי מבניין ממערב', 'רכב נגד הזרם', 'סגירת המסדרון'];
const $ = id => document.getElementById(id);
const HQ = 'אוגדה · חמ״ל', DEP = 'הסגן · בחפ״ק', SHB = 'שב״כ', OBS = 'תצפיתנית · חמ״ל', CPK = 'מחסום "אלון"', MED = 'צוות רפואה', ARM = 'שריון', UAV = 'כטב״ם', AIR = 'חיל האוויר';
const COL = { [HQ]: '#9ac0e6', [DEP]: '#e8dcc4', [SHB]: '#f28a6b', [OBS]: '#c9a6e6', [CPK]: '#9ac0e6', [MED]: '#9ac0e6', [ARM]: '#9ac0e6', [UAV]: '#9ac0e6', [AIR]: '#9ac0e6' };
const FAIL = (h, p) => `${h}<br><span style="font-size:16px;font-weight:500;line-height:1.6;display:block;margin-top:10px;color:#d6cab2">${p}</span>`;

// ---------- small props on people ----------
function findBone(root, name) { let b = null; root.traverse(c => { if (!b && c.name === name) b = c; }); return b; }
function attach(actor, boneName, mesh, off) {
  const root = actor.root; const b = findBone(root, boneName); root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const bm = new THREE.Matrix4().multiplyMatrices(inv, b ? b.matrixWorld : root.matrixWorld);
  const q = new THREE.Quaternion().setFromRotationMatrix(bm).invert(); const s = 1 / root.scale.x;
  mesh.position.copy(off.clone().multiplyScalar(s)).applyQuaternion(q); mesh.quaternion.copy(q); (b || root).add(mesh); mesh.traverse(c => { if (c.isMesh) c.castShadow = true; }); return mesh;
}
const PM = {};
function pm() { if (PM.ok) return PM; PM.ok = true; const std = o => new THREE.MeshStandardMaterial(o); PM.grey = std({ color: '#6d6c66', roughness: .9 }); PM.dark = std({ color: '#2b2a27', roughness: .9 }); PM.blue = std({ color: '#3e5570', roughness: .9 }); PM.bundle = std({ color: '#8b6a4a', roughness: 1 }); return PM; }
function backpack(a, mat) { const g = new THREE.Mesh(new THREE.BoxGeometry(.32, .42, .17), mat); const b = findBone(a.root, 'Bip01_Spine2'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); return attach(a, 'Bip01_Spine2', g, hp.add(V3(0, -.08, -.2))); }
function bundle(a) { const g = new THREE.Mesh(new THREE.BoxGeometry(.36, .26, .26), pm().bundle); const b = findBone(a.root, 'Bip01_L_Hand'); a.root.updateMatrixWorld(true); const hp = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); a.root.worldToLocal(hp); return attach(a, 'Bip01_L_Hand', g, hp.add(V3(0, -.15, 0))); }

export class CorridorMission {
  constructor() {
    this.t = 0; this.stage = -1; this.events = []; this.intel = []; this.units = []; this.press = 0; this.crushT = 0;
    this.st = { civHurt: 0, civHurtUnjust: 0, idfHurt: 0, militants: 0, wrongDetain: 0, detained: 0, stranded: 0, passed: 0, prevented: [], violations: [], notes: [] };
    this.suspects = []; this.movers = []; this.hurt = [];
    bus.on('actorHit', a => { if (a.friendly && !a._counted) { a._counted = true; this.st.idfHurt++; } });
  }
  // ---------- menu backdrop / briefing ----------
  backdrop() { this.populate(); for (let i = 0; i < 120; i++) { G.time += .1; G.fx.update(.1); G.crowd.update(.1); this.spawnTick(.1); } }
  idle(dt) { if (G.state === 'menu' || G.state === 'briefing') { G.missionClock = 9 * 3600 + 52 * 60; this.spawnTick(dt); } }
  // people already walking the road when the corridor scene opens: a column from the north edge to the queue, a queue,
  // and people walking on south of the checkpoint
  populate() {
    const c = G.crowd; c.reset(); this.rate = this.baseRate();
    for (let z = CL.spawnZ + 10; z < -32; z += (G.isTouch ? 4.2 : 3.4) + R() * .8) c.spawnGroup(z);
    for (let i = 0; i < (G.isTouch ? 36 : 48); i++) { const a = c.spawn(rr(-3.5, 3.5), rr(-28, -20)); if (a) c.joinQueue(a); }
    for (let z = 12; z < CL.exitZ - 10; z += 4 + R() * 2) { const a = c.spawn(rr(-8, 8), z, { state: 'south' }); if (a) { a.tx = a.x; a.tz = CL.exitZ; } }
    c.passed = 0; c.arrived = 0;
  }
  baseRate() { return G.isTouch ? .72 : .9; }
  briefing() {
    const lines = [
      'השעה 10:00. המסדרון על כביש צלאח א־דין נפתח עכשיו, עד השעה 14:00.',
      'אלפי אזרחים, משפחות, קשישים, עגלות ומעט רכבים עם דגלים לבנים, נעים דרומה דרך המחסום.',
      'המחסום: שני נתיבי מעבר ונתיב לרכבים. נתיב 2 סגור כרגע. ליד המחסום צוות רפואה, כריזה ושני נגמ״שים. מרכבה מאבטחת את האגף.',
      'המודיעין מעריך שחמאס ינסה להבריח חמושים בתוך הטור, ואולי לירות על הכוח.',
      'יש לך רחפן תצפית, כטב״ם חמוש, שריון, וחיל האוויר דרך האוגדה. תקיפה ליד אזרחים אסורה.',
      'המטרה: כולם עוברים בבטחה ובזמן, ואף חמוש לא עובר. בהצלחה.',
    ];
    const list = $('brieflines'); list.innerHTML = '';
    lines.forEach((t, i) => { const li = document.createElement('li'); li.textContent = t; li.style.animationDelay = (i * .15) + 's'; list.appendChild(li); });
    setTimeout(() => $('bgo').classList.add('ready'), 1200);
    const cv = $('map'); const draw = () => { if (G.state !== 'briefing') return; const r = cv.getBoundingClientRect(); if (cv.width !== Math.round(r.width * 1.5)) { cv.width = Math.round(r.width * 1.5); cv.height = Math.round(r.height * 1.5); } this.drawMap(cv.getContext('2d'), cv.width, cv.height, { brief: true }); requestAnimationFrame(draw); }; draw();
  }
  // ---------- start ----------
  start() {
    G.state = 'play'; G.time = G.time || 0; this.t = 0; this.stageSet(0); this.threats = {};
    G.player.setPos(V3(CL.cp.x - 4.5, CL.bermH + .05, CL.cp.z - 2.5), .42); G.player.pitch = -.1; G.weapon.enabled = false;
    this.populate(); this.spawnForces(); this.timeline();
    this.objective('המסדרון פתוח', 'האזרחים עוברים בנתיב 1. שמור על זרימה רציפה ובטוחה, ושים לב להתראות.');
    G.csound.setCrowd(.5);
    const go = () => { this.waiting = false; G.lock && G.lock(); after(1.5, () => this.radio(HQ, 'חפ״ק, כאן אוגדה. המסדרון פתוח עד 14:00. עדכן על כל שינוי בזרם.')); after(8, () => this.radio(DEP, 'המפקד, רחפן התצפית באוויר. הטאבלט אצלך.', false)); };
    if (location.hash === '#retry' || G.debug.noIntro) go(); else { this.waiting = true; G.command.intro(go); }
  }
  radio(who, text, radio = true) { G.csound && G.csound.radio(who, text, COL[who] || '#e8dcc4', Math.max(4.5, text.length * .075), radio); }
  onTabletFirst() { G.tablet.hint('גרור להזזת הרחפן · צביטה או +/− לזום · נגיעה באדם מסמנת אותו'); setTimeout(() => G.tablet.hint('בלשונית "כוחות" כל הפקודות, כולל שריון, כטב״ם וחיל האוויר'), 4200); }
  objective(t, sub) { this.obj = t; this.calm = { title: t, text: sub }; this.refreshTask(); }
  stageSet(i) { if (this.stage === i) return; this.stage = i; G.guide.setStage(i); }
  at(t, fn) { this.events.push({ at: t, fn }); }
  // ---------- our forces ----------
  spawnForces() {
    const mk = (model, x, z, yaw, name, opts = {}) => { const a = new Actor(model, 'idf', V3(x, hC(x, z), z), yaw, { rifle: 'm4', accuracy: .9 }); a.name = name; a.readyAim = false; a.idleAnim = 'idle'; a.brain = this.postBrain(a); Object.assign(a, opts); a.post = a.pos.clone(); a.postYaw = yaw; return a; };
    const N = Math.PI;
    this.screeners = [mk('team', CL.laneA - 1.3, 6.2, N, 'בודק · עמית'), mk('team3', CL.laneA + 1.3, 6.6, N, 'בודקת · נועה'), mk('team2', CL.laneB + 1.4, 6.4, N, 'בודק · אבי')];
    this.mg = [mk('team', -9.4, -7.4, N, 'עמדת מקלע · יואב', { readyAim: true }), mk('team3', -8.2, -7.0, N + .3, 'עמדת מקלע · רז')];
    for (const a of this.mg) a.lookAt = V3(-20, 2, -120);
    this.medics = [mk('team2', G.medPos.x, G.medPos.z - .8, -Math.PI / 2, 'חובש · שחר'), mk('team3', G.medPos.x, G.medPos.z + .8, -Math.PI / 2, 'חובשת · מאיה')];
    for (const m of this.medics) { if (m.rifle) m.rifle.visible = false; m.medic = true; }
    // command post crew: radio operator and the deputy at the table
    const cp = CL.cp, y = CL.bermH;
    const op = new Actor('team2', 'idf', V3(cp.x + 4, y, cp.z + 2.8), -Math.PI / 2, {}); op.forceAnim = 'm_cell_phone_talk_01'; op.noTag = true; op.brain = () => {}; op.noSnap = false;
    const dep = new Actor('team3', 'idf', V3(cp.x + 1.4, y, cp.z), -Math.PI / 2 + .4, { rifle: 'm4' }); dep.forceAnim = 'm_documentfile_idle'; dep.noTag = true; dep.brain = () => {}; dep.rifle.visible = false;
    this.cpCrew = [op, dep];
    const A = G.armour;
    this.units = [
      { id: 'cp', name: 'מחסום "אלון"', sub: 'שני נתיבי מעבר, נקודת סינון ומתקן עיכוב', actors: this.screeners, flow: 'open', laneB: false, hold: false },
      { id: 'spk', name: 'כריזה בערבית', sub: 'רמקולים על ההאמר ליד המחסום', cd: 0 },
      { id: 'med', name: 'צוות רפואה', sub: 'חובש וחובשת, אלונקה, אוהל רפואה', actors: this.medics, busy: false },
      { id: 'apcA', name: 'נמ״ר א׳', sub: 'מערבית למחסום · מטילי עשן', obj: A.apcA, pos: 'home', smoke: 3 },
      { id: 'apcB', name: 'נמ״ר ב׳', sub: 'מזרחית למחסום', obj: A.apcB, pos: 'home' },
      { id: 'tank', name: 'מרכבה', sub: 'מאבטחת את האגף המזרחי', obj: A.tank, pos: 'home' },
      { id: 'uav', name: 'כטב״ם חמוש', sub: 'תקיפה מדויקת. רק בזיהוי ודאי ורחוק מאזרחים', cd: 0, shots: 2 },
      { id: 'air', name: 'חיל האוויר', sub: 'דרך האוגדה · אישור ובדיקות נזק אגבי, כדקה', busy: false },
    ];
    this.U = Object.fromEntries(this.units.map(u => [u.id, u]));
  }
  // soldiers hold their post, face their sector, crouch when a sniper is firing and nobody covers them
  postBrain(a) {
    return dt => {
      if (a.down) return; if (a.path) { a.aiming = false; return; }
      if (a.lookAt) { a.faceTo(a.lookAt); a.aiming = a.readyAim; a.aimPitch = 0; } else a.aimYaw = a.postYaw;
      a.forceAnim = this.firing && !this.covered && !a.medicBusy ? 'crouch' : a.task || null;
    };
  }
  // ---------- the timeline ----------
  timeline() {
    this.events = [];
    this.at(26, () => this.spawnOldMan());
    this.at(66, () => this.surge());
    this.at(112, () => this.spawnCell());
    this.at(268, () => this.sniperStart());
    this.at(338, () => this.carStart());
    this.at(392, () => this.closing());
    // two cars with white flags and their families, at walking pace in the vehicle lane
    this.at(10, () => this.flagCar('suv', '#d8d4c8', -150)); this.at(150, () => this.flagCar('hatch', '#8a8680', -200));
  }
  spawnTick(dt) {
    const c = G.crowd; if (!c || this.closed) return;
    this.spawnAcc = (this.spawnAcc || 0) + dt * (this.rate || this.baseRate()) * (this.spkCalm > G.time ? .75 : 1) * (c.hold ? .3 : 1);
    while (this.spawnAcc > 3) { this.spawnAcc -= 3; c.spawnGroup(CL.spawnZ);
      // now and then a hand cart or a donkey cart with the family's belongings (they use the vehicle lane)
      const last = c.agents[c.agents.length - 1], carts = c.agents.filter(a => a.alive && a.cart).length;
      if (last && carts < (G.isTouch ? 4 : 7) && c.gr() < .14) { const dk = c.gr() < .35; last.cart = makeCart(c.gr, dk); last.donkey = dk; last.walk = Math.min(last.walk, 1); } }
  }
  // ---------- 1. the old man ----------
  spawnOldMan() {
    const a = new Actor('civM1', 'civ', V3(-3.2, 0, -96), Math.PI, {}); a.role = 'old'; a.brain = () => {}; a.walkSlow = true; this.oldMan = a; bundle(a);
    a.setPath([V3(-3.4, 0, -60)], .75, () => {
      a.forceAnim = 'crouch'; a.collapsed = G.time; (G.crowdObstacles || (G.crowdObstacles = [])).push(a.obst = { x: a.pos.x, z: a.pos.z, r: 1.6 });
      this.addIntel(OBS, 'קשיש התמוטט על הכביש, כ־60 מטר צפונית למחסום. אנשים עוקפים אותו. הוא זקוק לטיפול.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(a, true) });
      this.setThreat('old'); G.tablet.mark(a);
    });
  }
  // ---------- 2. the surge ----------
  surge() {
    this.stageSet(1); this.surging = G.time;
    // a large group joins the road from a side street on the west, 100 m north of the checkpoint, and walks fast
    const c = G.crowd, n = G.isTouch ? 110 : 150;
    for (let i = 0; i < n; i++) { const a = c.spawn(rr(12, 34), rr(-142, -100), { lx: rr(-8, 8) }); if (a) { a.walk = rr(1.4, 1.9); a.surge = true; } }
    for (const a of c.agents) if (a.alive && a.state === 'flow' && a.z > -200) a.walk = Math.max(a.walk, rr(1.25, 1.6));
    this.addIntel(OBS, 'קבוצה גדולה, כ־150 איש, נכנסת לכביש מרחוב צדדי ממזרח, 100 מטר צפונית למחסום. הולכים מהר: נפוצה שמועה שהמסדרון ייסגר מוקדם.', true);
    this.radio(DEP, 'המפקד, התור מתארך. בנתיב אחד זה לא יעבור. אפשר לפתוח את נתיב 2, ולבקש בכריזה להאט.', false);
  }
  // ---------- 3. the armed cell ----------
  spawnCell() {
    this.stageSet(2);
    // seven young men walking alone or with family that match the description loosely; two of them carry weapons
    const looks = ['pM2', 'pM1', 'hostM1', 'pM4', 'hostM2', 'civM2', 'pM2'], armedIdx = [2, 5], P = pm();
    for (let i = 0; i < 7; i++) {
      const x = rr(-6.5, 6.5), z = -142 + i * 6.5 + rr(-2, 2); const a = new Actor(looks[i], 'civ', V3(x, 0, z), Math.PI, {}); a.role = 'suspect'; a.armed = armedIdx.includes(i); a.sn = i + 1;
      if (i % 2 === 0 || a.armed) backpack(a, a.armed ? (i === 2 ? P.grey : P.dark) : [P.grey, P.blue, P.dark][i % 3]);
      a.idDesc = a.armed ? (i === 2 ? 'בזום ובתרמי: צורה ארוכה ונוקשה בתיק הגב, קנה מקוצר. מתכתב בטלפון ומביט לאחור.' : 'בתרמי: מחסניות על החגורה מתחת למעיל. שומר מרחק מהמשפחות סביבו.')
        : pick(['בתיק: שמיכות ובקבוקי מים. הולך עם אישה ושני ילדים.', 'סוחב תיק בגדים ושקית לחם. ידיו גלויות, מדבר עם קשישה לידו.', 'נושא ילד על הכתפיים. בתיק: מסמכים ותרופות.', 'בתיק מזרן מקופל. הולך עם אחיו ואמו.', 'מעיל כהה, ידיים ריקות. דוחף עגלה עם אישה מבוגרת.']);
      a.brain = this.suspectBrain(a); a.speed0 = rr(.8, .95); this.suspects.push(a);
    }
    this.addIntel(SHB, 'התראה: שני חמושים של חמאס מנסים לעבור דרומה בתוך הטור, ליד המחסום. צעירים, אחד עם תיק גב אפור, השני במעיל כהה. הנשק מוסתר. זהה אותם ברחפן לפני שהם מגיעים לנקודת הסינון. רוב מי שמתאים לתיאור הוא אזרח.', true, { label: 'הראה ברחפן', fn: () => this.identifyNext() });
    this.radio(SHB, 'חפ״ק, כאן שב״כ. שני חמושים בטור, ליד המחסום. זהה ברחפן, ורק אז עכב.');
    for (const s of this.suspects) G.tablet.mark(s);
    this.setThreat('cell');
  }
  suspectBrain(a) {
    a.stage = 0;
    return dt => {
      if (a.detained || a.down) return;
      if (G.crowd.shelter && !a.flagged) { if (!a._sh) { a._sh = true; a.stop(); a.forceAnim = 'crouch'; } return; } if (a._sh) { a._sh = false; a.forceAnim = null; a.stage = Math.max(0, a.stage - 1); }
      if (a.path) return;
      const lx = CL.laneA + rr(-.8, .8);
      if (a.stage === 0) { a.stage = 1; a.setPath([V3(lx, 0, CL.funnelZ - 6)], a.speed0); }
      else if (a.stage === 1) { a.stage = 2; a.setPath([V3(CL.laneA + rr(-.5, .5), 0, CL.funnelZ + 1), V3(CL.laneA + rr(-.4, .4), 0, 3.5)], .5); }
      else if (a.stage === 2) { a.stage = 3; this.screen(a); }
    };
  }
  // the screening point: flagged men are taken aside to the pen; everyone else walks on south
  screen(a) {
    if (a.flagged) { a.detained = true; this.st.detained++; const S = this.screeners[0]; a.setPath([V3(-6, 0, 7.5), V3(CL.pen.x + rr(-1, 1), 0, CL.pen.z + rr(-1.5, 1.5))], 1.1, () => { a.forceAnim = 'crouch'; });
      if (S && !S.down) { S.setPath([V3(-5, 0, 7.6), V3(CL.pen.x + 1.5, 0, CL.pen.z)], 1.3, () => { S.lookAt = a.pos.clone(); S.readyAim = true; after(18, () => { S.lookAt = null; S.readyAim = false; S.setPath([S.post.clone()], 1.3); }); }); }
      if (a.armed) { this.st.prevented.push(`חמוש ${a.sn === 3 ? 'עם תיק הגב' : 'במעיל הכהה'} עוכב בנקודת הסינון, בלי ירייה`); this.notify('חמוש עוכב במחסום', 'הבודקים הפרידו אותו מהטור והעבירו אותו למתקן העיכוב. נמצא עליו נשק. אף אחד לא נפגע.', false); this.radio(CPK, 'חפ״ק, כאן המחסום. עיכבנו את המסומן. נמצא נשק. הטור ממשיך.'); }
      else { this.st.wrongDetain++; this.notify('עוכב אדם לא חמוש', 'הבדיקה לא מצאה עליו דבר. הוא שוחרר אחרי חצי שעה, ובני משפחתו חיכו לו בצד הדרום. עיכוב בלי זיהוי ודאי פוגע באנשים ומאט את המעבר.', true); after(20, () => { if (!a.removed) { a.detained = false; a.forceAnim = null; a.setPath([V3(-4, 0, 14), V3(rr(-6, 6), 0, CL.exitZ)], .9, () => a.remove()); } }); }
      setTimeout(() => this.refreshTask(), 50); return; }
    a.setPath([V3(CL.laneA + rr(-1, 1), 0, 12), V3(rr(-6, 6), 0, 60), V3(rr(-6, 6), 0, CL.exitZ)], .95, () => a.remove());
    if (a.armed) { this.cellPassed = true; after(6, () => { if (G.state === 'play') bus.emit('missionFailed', FAIL('חמוש עבר דרומה בתוך המסדרון.', 'המסדרון נועד לאזרחים. ההתראה הגיעה בזמן: רחפן התצפית מזהה את החמושים, והמחסום מעכב את מי שסומן, בלי ירייה ובלי לעצור את כולם. נסה שוב.')); }); }
  }
  // tablet / task card: zoom the drone on the next suspect that has not been checked yet and start watching him
  identifyNext() {
    const left = this.suspects.filter(s => !s.identified && !s.removed && !s.detained && s.alive);
    if (!left.length) return 'כל החשודים נבדקו';
    const s = left.sort((a, b) => b.pos.z - a.pos.z)[0]; this.lookAt(s, true); return this.identify0(s);
  }
  identify0(s) {
    if (!s || s.identified) return 'הוא כבר נבדק'; if (this.idJob && this.idJob.obj === s) return true;
    this.idJob = { obj: s, t: 0 }; G.drone.track = s; G.drone.fovT = 4.5; G.tablet && G.tablet.hint('תצפית על החשוד… (הרחפן עוקב ומתקרב)'); return true;
  }
  identifyDone(s) {
    s.identified = true; this.idJob = null; const m = G.tablet.marks.find(m => m.obj === s); if (m) m.threat = s.armed;
    this.notify(s.armed ? `יעד ${m ? m.n : ''}: חמוש` : `יעד ${m ? m.n : ''}: לא חמוש`, s.idDesc, s.armed);
    if (s.armed) this.radio(OBS, 'זיהוי ודאי: ' + s.idDesc); G.tablet && G.tablet.select(m); this.refreshTask();
  }
  // mark a man for the checkpoint: the screeners will separate him from the column at the screening point
  flag(s) {
    if (!s || s.flagged) return s && s.flagged ? 'כבר סומן לעיכוב' : 'סמן קודם אדם'; if (s.stage >= 3 && !s.detained) return 'הוא כבר עבר את נקודת הסינון';
    s.flagged = true; if (!s.identified) this.st.notes.push('עיכוב בלי זיהוי ודאי');
    this.notify('סומן לעיכוב', `הבודקים במחסום קיבלו את התיאור ויפרידו אותו מהטור${s.identified ? '' : '. שים לב: הוא עוד לא זוהה בוודאות'}.`, false); this.radio(CPK, 'קיבלתי. נפריד אותו בנקודת הסינון.'); this.refreshTask(); return true;
  }
  // ---------- 4. the sniper ----------
  sniperStart() {
    this.stageSet(3); this.firing = G.time; this.covered = false; this.sniperShots = 0; G.crowd.shelter = true; this.sniperNext = G.time + .4;
    this.addIntel(OBS, 'ירי! צלף בקומה הרביעית של בניין ממערב לכביש, 140 מטר צפונית־מערבית למחסום. בתרמי: משפחות מסתתרות בקומת הקרקע של אותו בניין.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(G.sniperWin) });
    this.radio(CPK, 'ירי על המחסום! האנשים שוכבים. מאיפה זה בא?');
    this.setThreat('sniper'); G.audio.setIntensity(.7);
    // the man and the families below him, for the drone and the thermal view
    const w = G.sniperWin; this.sniper = new Actor('fighter', 'civ', V3(w.x - 1.4, w.y - 1.3, w.z), Math.PI / 2, { rifle: 'ak' }); this.sniper.noSnap = true; this.sniper.role = 'sniper'; this.sniper.armedVisible = true; this.sniper.militant = true; this.sniper.readyAim = true; this.sniper.aiming = true; this.sniper.brain = () => { this.sniper.faceTo(V3(0, 2, 0)); this.sniper.aiming = !this.covered; };
    this.shelterers = []; for (let i = 0; i < 4; i++) { const f = new Actor(pick(['civF1', 'civF2', 'hostF', 'civM1']), 'civ', V3(CL.sniper.x + rr(-3, 3), 0, CL.sniper.z + rr(-3, 3)), rr(0, 6), {}); f.forceAnim = 'crouch'; f.brain = () => {}; f.role = 'sheltering'; f.noTag = true; this.shelterers.push(f); }
  }
  sniperShot() {
    const w = G.sniperWin; this.sniperShots++;
    const targets = [...this.screeners, ...this.mg].filter(s => s.alive && !s.down); const tg = pick(targets) || this.screeners[0];
    const hitP = tg.pos.clone().add(V3(rr(-1.5, 1.5), rr(.2, 1.2), rr(-1.5, 1.5)));
    G.fx.muzzle(w.clone(), hitP.clone().sub(w).normalize(), .5); G.audio.shotAt(w, 'ak'); G.fx.tracer && G.fx.tracer(w.clone(), hitP.clone(), true);
    after(.25, () => { G.fx.impact(hitP, V3(0, 1, 0), 'concrete'); G.audio.impact(hitP, 'concrete'); });
    const since = G.time - this.firing;
    // nobody covered the line of fire: after half a minute a soldier is hit, after a minute a civilian in the queue
    if (since > 30 && !this._soldierHit) { this._soldierHit = true; after(.3, () => { tg.damage(55, w, 'legs'); this.notify('לוחם נפגע מירי הצלף', `${tg.name} נפצע ברגלו. קו האש עדיין פתוח: עשן ושריון חוסמים אותו.`, true); this.radio(CPK, 'נפגע אצלנו! צריך חובש ומסך עשן, עכשיו!'); this.casualty(tg); }); }
    if (since > 60 && !this._civHit) { this._civHit = true; const q = G.crowd.lanes[0].q; const ag = q[Math.min(q.length - 1, 5 + Math.floor(R() * 10))]; if (ag) { const c = this.civHurt(ag, 'אזרחית בתור נפגעה מירי הצלף'); if (c) this.notify('אזרחית נפגעה', 'כדור של הצלף פגע באישה בתור. היא חיה ומטופלת.', true); } }
  }
  // smoke from the APC's dischargers and the APC itself between the building and the checkpoint
  cover() {
    if (!this.firing || this.covered) { const u = this.U.apcA; if (u.pos !== 'cover') return this.moveArmour('apcA', 'cover'); return 'קו האש כבר חסום'; }
    const u = this.U.apcA; if (u.smoke <= 0) return 'נגמרו רימוני העשן'; u.smoke--; this.moveArmour('apcA', 'cover', true);
    this.smokeT = G.time; this.notify('מסך עשן', 'הנמ״ר יורה רימוני עשן ונכנס בין הבניין למחסום. בעוד כמה שניות הצלף לא יראה את המחסום.', false); this.radio(ARM, 'נמ״ר א׳, זז לחסום. עשן באוויר.');
    after(6, () => { this.covered = true; G.crowd.shelter = false; this.setThreat('sniper', false); this.notify('קו האש חסום', 'העשן והנמ״ר מסתירים את המחסום. האנשים קמים וממשיכים. הצלף עלול לסגת.', false); this.radio(CPK, 'העשן עובד, הירי נפסק. ממשיכים להעביר אנשים.'); G.audio.setIntensity(.3);
      after(22, () => this.sniperLeaves()); });
    return true;
  }
  sniperLeaves() {
    const s = this.sniper; if (!s || !s.alive) return; s.noSnap = false; s.pos.set(CL.sniper.x - 6, 0, CL.sniper.z + 2); s.aiming = false; s.readyAim = false; s.brain = () => {};
    s.setPath([V3(CL.sniper.x - 20, 0, CL.sniper.z - 10), V3(CL.rubbleField.x, 0, CL.rubbleField.z)], 2.4, () => { s.hidden = true; s.remove(); this.setThreat('sniperOut', false); if (!this.st.prevented.includes('sniper')) this.st.prevented.push('הצלף נסוג. מסך העשן הגן על הטור ועל המחסום'); });
    this.sniperOutT = G.time; this.setThreat('sniperOut'); G.tablet.mark(s);
    this.addIntel(OBS, 'הצלף יוצא מהבניין מערבה עם הרובה, לכיוון שטח ההריסות. הוא לבד. בעוד כחצי דקה ייעלם בהריסות.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(s, true) });
  }
  // ---------- 5. the car against the flow ----------
  carStart() {
    this.stageSet(4); const car = civCar('hatch', '#c9c3b0'); if (!car) return; car.remove(car.children[1]); // no white flag on this one
    car.position.set(CL.vehX + 1, 0, 170); car.rotation.y = Math.PI; this.car = { o: car, v: 7.5, step: 0, stop: false, warned: 0 };
    (G.crowdObstacles || (G.crowdObstacles = [])).push(this.car.obst = { x: car.position.x, z: car.position.z, r: 3.2 });
    (G.hotObjects || (G.hotObjects = [])).push(car);
    this.addIntel(CPK, 'רכב לבן נוסע צפונה, נגד הזרם, מהר, לכיוון המחסום מדרום. אנשים קופצים הצידה. נוהל עצירת רכב: קריאה וסימון, ירי אזהרה, ורק אז ירי למנוע.', true, { label: 'הראה ברחפן', fn: () => this.lookAt(car.position) });
    this.setThreat('car');
  }
  carWarn(step) {
    const c = this.car; if (!c || c.stop) return 'הרכב כבר עצר';
    if (step === 1) { c.warned = Math.max(c.warned, 1); this.order('spk', 'car'); this.radio(CPK, 'מסמנים לו לעצור, קוראים ברמקול.'); c.v = 4.5; this.refreshTask(); return true; }
    if (step === 2) { c.warned = 2; const s = this.screeners.find(x => x.alive && !x.down) || this.screeners[0]; const e = s.eye(V3()); G.fx.muzzle(e.clone().add(V3(0, .4, .6)), V3(0, 1, .5).normalize(), .7); G.audio.shotAt(e, 'm4'); after(.4, () => G.audio.shotAt(e, 'm4'));
      this.radio(CPK, 'ירי אזהרה באוויר. הוא בולם!'); after(1.2, () => { c.v = 0; c.stop = true; this.carStopped(); }); return true; }
    if (step === 3) { // disabling fire: legal only after the warnings; without them, the driver is hurt for nothing
      const early = c.warned < 2; const s = this.screeners.find(x => x.alive && !x.down) || this.screeners[0]; const e = s.eye(V3()); for (let k = 0; k < 4; k++) after(k * .18, () => { G.fx.muzzle(e.clone().add(V3(0, 0, .6)), c.o.position.clone().sub(e).normalize(), .6); G.audio.shotAt(e, 'm4'); G.fx.impact(c.o.position.clone().add(V3(rr(-.5, .5), .8, -2)), V3(0, 0, -1), 'metal'); });
      c.v = 0; c.stop = true; after(1, () => { if (early) { this.civHurtDriver('הנהג נפצע מירי למנוע בלי שקדמו לו קריאה וירי אזהרה'); } this.carStopped(); }); return true; }
  }
  carStopped() {
    const c = this.car; this.setThreat('car', false); this.setThreat('carCheck');
    this.notify('הרכב עצר', `הרכב עצר ${Math.round(c.o.position.z - 10)} מטר מהמחסום. צריך לבדוק אותו ולהחזיר אותו דרומה.`, false);
  }
  carCheck() {
    const c = this.car; if (!c) return; this.setThreat('carCheck', false); c.checked = true;
    const s = this.screeners[2]; if (s && !s.down) { s.setPath([V3(CL.vehX - 1.5, 0, 12), c.o.position.clone().add(V3(-1.6, 0, -2))], 1.6, () => { s.task = 'm_gestic_listen_angry_01'; after(8, () => { s.task = null; s.setPath([V3(CL.vehX - 1.5, 0, 12), s.post.clone()], 1.4); }); }); }
    after(9, () => { this.notify('בדיקת הרכב', c.hurt ? 'בנהג פגעו רסיסים. החובשים מטפלים בו. הוא חיפש את אשתו וילדיו, שעברו את המחסום בבוקר.' : 'הנהג הוא אזרח שחיפש את אשתו וילדיו, שעברו את המחסום בבוקר. הוא לא שמע את הקריאות. הרכב נבדק, והוא חוזר דרומה בנתיב הרכבים.', !!c.hurt);
      if (!c.hurt) this.st.prevented.push('הרכב שנסע נגד הזרם נעצר בנוהל מלא, בלי נפגעים'); c.back = true; c.v = -3; this.refreshTask(); });
    return true;
  }
  civHurtDriver(why) { const c = this.car; c.hurt = true; this.st.civHurt++; this.st.civHurtUnjust++; this.st.violations.push(why); this.notify('הנהג נפצע', why + '.', true); }
  // ---------- 6. closing ----------
  closing() {
    this.stageSet(5); this.closed = true; this.objective('המסדרון נסגר לבאים חדשים', 'מי שכבר בתור עובר. סיים להעביר את כולם.');
    this.radio(HQ, 'חפ״ק, כאן אוגדה. השעה 14:00. המסדרון נסגר לבאים חדשים. מי שכבר בתור עובר.');
    this.order('spk', 'close');
    this.endAt = G.time + 50;
  }
  // ---------- casualties and care ----------
  // a civilian is hurt: promoted to a full character who sits down; medics come (no blood, no gore)
  civHurt(agent, why, unjust = false) {
    const a = agent.root ? agent : G.crowd.promote(agent, 'civ'); if (!a) return null; a.brain = () => {}; a.forceAnim = 'crouch'; a.hurt = true; a.role = a.role || 'casualty';
    this.st.civHurt++; if (unjust) this.st.civHurtUnjust++; this.st.violations.push(why); this.casualty(a); return a;
  }
  casualty(a) { if (!this.hurt.includes(a)) this.hurt.push(a); this.setThreat('hurt'); }
  // the medics run to a casualty, treat for a while, then walk them to the medical tent
  sendMedics(target) {
    const u = this.U.med; if (u.busy) return 'צוות הרפואה עסוק'; const t = target || this.needsCare(); if (!t) return 'אין כרגע מי שזקוק לטיפול';
    u.busy = true; t.medicComing = true; const ms = this.medics.filter(m => m.alive && !m.down); if (!ms.length) { u.busy = false; return 'אין חובשים זמינים'; }
    // around the barriers: up the vehicle lane for anyone north of the funnel, into a lane from its exit for anyone in it
    const via = t.pos.z < -26 ? [V3(7.8, 0, 8), V3(7.8, 0, -50)] : t.pos.z < 6 ? [V3(5, 0, 10), V3(t.pos.x, 0, 7)] : [V3(5, 0, 10)];
    ms.forEach((m, i) => { m.medicBusy = true; m.setPath([...via, t.pos.clone().add(V3(i ? .8 : -.8, 0, .5))], 3.0, () => { m.faceTo(t.pos); m.task = 'm_crouch_gestic'; if (i === 0) after(8, () => this.treated(t, ms, via)); }); });
    this.notify('צוות הרפואה יוצא', t.friendly ? `החובשים רצים אל ${t.name}.` : 'החובשים רצים אל הפצוע עם אלונקה.', false); this.radio(MED, 'צוות רפואה יוצא.'); this.refreshTask(); return true;
  }
  treated(t, ms, via) {
    t.cared = true; t.medicComing = false; if (t.treat) t.treat(); if (t.obst) { const i = G.crowdObstacles.indexOf(t.obst); if (i >= 0) G.crowdObstacles.splice(i, 1); }
    if (t === this.oldMan) { this.st.prevented.push('הקשיש שהתמוטט טופל ופונה לאוהל הרפואה'); this.setThreat('old', false); }
    t.forceAnim = null; t.hurt = true; t.noSnap = false; const back = [...via].reverse(), dest = G.medPos.clone().add(V3(rr(-1, 1), 0, rr(-2, 2)));
    t.setPath([...back, dest], .7, () => { t.forceAnim = 'crouch'; });
    for (const m of ms) { m.task = null; m.setPath([...back, m.post.clone()], 1.1, () => { m.medicBusy = false; m.faceTo(m.pos.clone().add(V3(-1, 0, 0))); }); }
    after(3, () => { this.U.med.busy = false; this.refreshTask(); });
    this.hurt = this.hurt.filter(x => x !== t);
  }
  needsCare() { const list = [...this.hurt.filter(a => a.alive && !a.cared && !a.medicComing)]; if (this.oldMan && this.oldMan.collapsed && !this.oldMan.cared && !this.oldMan.medicComing) list.unshift(this.oldMan); return list[0] || null; }
  // ---------- orders ----------
  posOf(t) { return t.isVector3 ? t : t.root ? t.pos : t.position ? t.position : V3(t.x, t.y, t.z); }
  order(uid, action, arg) {
    const u = this.U[uid]; if (!u) return; const tab = G.tablet;
    if (uid === 'cp') {
      if (action === 'laneB') { const on = arg ?? !u.laneB; if (u.laneB === on) return on ? 'נתיב 2 כבר פתוח' : 'נתיב 2 כבר סגור'; u.laneB = on; G.crowd.setLaneB(on); this.gateTo = on ? 1 : 0; this.radio(CPK, on ? 'פותחים את נתיב 2. שני בודקים עוברים אליו.' : 'סוגרים את נתיב 2.'); this.notify(on ? 'נתיב 2 נפתח' : 'נתיב 2 נסגר', on ? 'קצב המעבר מוכפל. חצי מהתור עובר לנתיב השני.' : 'כל התור חוזר לנתיב 1.', false); this.refreshTask(); return true; }
      if (action === 'flow') { const f = arg || ({ open: 'slow', slow: 'pause', pause: 'open' })[u.flow]; u.flow = f; G.crowd.flow = f; this.notify('קצב המחסום: ' + ({ open: 'רגיל', slow: 'בדיקה איטית', pause: 'עצירה' })[f], f === 'open' ? 'הבודקים מעבירים אנשים בקצב רגיל.' : f === 'slow' ? 'בדיקה יסודית: קצב המעבר יורד בחצי.' : 'המחסום עצר. התור לא זז, והלחץ בכניסה יגדל.', f === 'pause'); this.refreshTask(); return true; }
      if (action === 'hold') { const on = arg ?? !u.hold; u.hold = on; G.crowd.hold = on; this.notify(on ? 'עצירה בנקודת ההמתנה' : 'נקודת ההמתנה נפתחה', on ? 'הבאים נעצרים 100 מטר לפני המחסום עד שהתור יתקצר. כל דקת עצירה מעכבת אלפים.' : 'הטור ממשיך לזרום אל המחסום.', false); if (on) this.order('spk', 'hold'); this.refreshTask(); return true; }
    }
    if (uid === 'spk') {
      if (u.cd > 0 && action !== 'close') return `הכריזה תהיה זמינה בעוד ${Math.ceil(u.cd)} ש׳`; u.cd = 14; this.spkCalm = G.time + 30; this.press = Math.max(0, this.press - .15);
      const T = this.threats || {};
      const txt = action === 'close' ? 'השעה שתיים. המעבר נסגר לבאים חדשים. מי שכבר בתור יעבור. שמרו על הילדים.' : action === 'car' ? 'הנהג ברכב הלבן: עצור מיד! עצור את הרכב ושים את הידיים מחוץ לחלון!' : action === 'hold' ? 'עצרו כאן וחכו. המחסום פתוח עד שתיים. כולם יעברו. אל תדחפו.'
        : this.firing && !this.covered ? 'רדו לקרקע! התרחקו מהצד המערבי של הכביש! זחלו אל הקירות בצד המזרחי!' : T.crush ? 'לאט! אל תדחפו! נתיב נוסף נפתח. החזיקו את הילדים ביד ותתקדמו לאט.' : 'המסדרון פתוח עד השעה שתיים. המשיכו ללכת דרומה בכביש. החזיקו את הילדים קרוב. אל תסטו מהכביש.';
      G.csound.loudspeaker(txt); this.spkOnAir = G.time + 6; if (!this.firing || this.covered) for (const a of G.crowd.agents) if (a.alive && a.state === 'flow' && a.surge) a.walk = Math.min(a.walk, rr(1.05, 1.3)); return true;
    }
    if (uid === 'med') return this.sendMedics(arg);
    if (uid === 'apcA' || uid === 'apcB' || uid === 'tank') return this.moveArmour(uid, action);
    if (uid === 'uav') return this.uavStrike(arg || (tab && tab.selected()));
    if (uid === 'air') return this.airRequest(arg);
  }
  // ---------- armour ----------
  // routes keep off the people lanes: west vehicles go up the west verge, east ones up the east verge
  armourSpots(id) {
    if (id === 'apcA') return { home: { pts: [V3(-18, 0, 14), V3(-13, 0, 18)], ry: 0, label: 'בבסיס, מערבית למחסום' }, cover: { pts: [V3(-18, 0, 14), V3(-18, 0, -44), V3(-15, 0, -58)], ry: -Math.PI / 2 + .5, label: 'חוסם את קו האש מהמערב' } };
    if (id === 'apcB') return { home: { pts: [V3(16, 0, -10)], ry: 0, label: 'בבסיס, מזרחית למחסום' }, north: { pts: [V3(15, 0, -60), V3(13, 0, -105)], ry: Math.PI, label: 'מאבטח את הכביש מצפון' } };
    return { home: { pts: [V3(27, 0, -50)], ry: -Math.PI / 2, label: 'מאבטחת את האגף המזרחי' }, west: { pts: [V3(20, 0, -70), V3(14, 0, -82)], ry: -Math.PI / 2 - .3, label: 'מכסה את האגף המערבי מצפון' } };
  }
  moveArmour(id, where, smoke = false) {
    const u = this.U[id], S = this.armourSpots(id)[where]; if (!S) return; if (u.drive) return 'הרכב בתנועה'; if (u.pos === where && !smoke) return 'הרכב כבר שם';
    u.pos = where; u.drive = { pts: S.pts.map(p => p.clone()), i: 0, ry: S.ry };
    if (smoke) { const p = V3(-22, 0, -68); u.smokeAt = p; u.smokeUntil = G.time + 75; }
    if (!smoke) this.notify(u.name + ' זז', S.label + '.', false); return true;
  }
  updateArmour(dt) {
    for (const id of ['apcA', 'apcB', 'tank']) { const u = this.U[id]; const o = u.obj; if (!o) continue;
      if (u.drive) { const d = u.drive, t = d.pts[d.i]; const dx = t.x - o.position.x, dz = t.z - o.position.z, L = Math.hypot(dx, dz);
        if (L < .8) { d.i++; if (d.i >= d.pts.length) { u.drive = null; o.userData.ryT = d.ry; } }
        else { const sp = Math.min(6, L * .8 + 1.5); o.position.x += dx / L * sp * dt; o.position.z += dz / L * sp * dt; o.position.y = hC(o.position.x, o.position.z); o.userData.ryT = Math.atan2(dx, dz); } }
      if (o.userData.ryT !== undefined) { let df = o.userData.ryT - o.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df)); o.rotation.y += df * Math.min(1, dt * 1.5); }
      // smoke dischargers: a wall of white smoke along the line of fire while it lasts
      if (u.smokeUntil > G.time && G.fx) { u._st = (u._st || 0) - dt; if (u._st <= 0) { u._st = .12; const p = u.smokeAt; for (let k = 0; k < 3; k++) G.fx.smoke.emit(V3(p.x + rr(-10, 10), rr(.5, 3), p.z + rr(-22, 22)), V3(G.wind.x * .25 + rr(-.3, .3), rr(.3, .9), G.wind.z * .25 + rr(-.3, .3)), rr(10, 16), rr(3, 4), rr(12, 17), [.88, .88, .86, .9], [.82, .82, .8, 0], .2, -.03); } } }
  }
  // ---------- precision strike and air force ----------
  civiliansNear(p, r) { let n = 0; for (const a of G.crowd.agents) if (a.alive && (a.x - p.x) ** 2 + (a.z - p.z) ** 2 < r * r) n++; for (const a of G.actors) if (a.alive && !a.removed && !a.friendly && !a.militant && !a.armed && a.pos.distanceTo(p) < r) n++; return n; }
  uavStrike(t) {
    const u = this.U.uav, tab = G.tablet; if (!t) return 'סמן קודם יעד ברחפן'; if (u.shots <= 0) return 'לכטב״ם לא נשארו חימושים'; if (u.cd > 0) return `הכטב״ם בדרך (${Math.ceil(u.cd)} ש׳)`;
    const p = this.posOf(t).clone(), near = this.civiliansNear(p, 35); const armed = !!(t.armedVisible || (t.armed && t.identified)); const inBldg = t.role === 'sniper' && !this.sniperOutT;
    const why = !armed ? 'אין זיהוי ודאי שהאדם הזה חמוש.' : inBldg ? 'הצלף בבניין שבקומת הקרקע שלו מסתתרות משפחות.' : near ? `יש ${near} אזרחים בטווח 35 מטר מהיעד.` : '';
    const go = () => { u.shots--; u.cd = 25; this.radio(UAV, 'כטב״ם מאשר: יעד ננעל, פגיעה בעוד חמש שניות.'); after(5, () => this.strikeAt(p, t, near || inBldg ? (inBldg ? 4 : near) : 0, armed)); };
    if (tab) tab.confirm(why ? 'תקיפה אסורה לפי הנהלים' : 'תקיפת כטב״ם?', why ? why + ' תקיפה כזאת תפגע באזרחים. לבצע בכל זאת?' : 'זיהוי ודאי של חמוש, הרחק מאזרחים. התקיפה תהרוג אותו.', go, true); else go();
    return true;
  }
  strikeAt(p, t, civ, armed) {
    G.fx.explosion(p.clone().add(V3(0, .5, 0)), 1.1); G.audio.explosion(p, 1.2); G.fx.dustBurst && G.fx.dustBurst(p.clone(), 6, 40);
    if (t && t.alive && t.damage) { t.militant = !!armed; t.damage(300, p, 'body'); if (armed) { this.st.militants++; this.st.prevented.push(t.role === 'sniper' ? 'הצלף נוטרל בשטח פתוח, הרחק מאזרחים' : 'חמוש נוטרל בתקיפה מדויקת'); } }
    if (t === this.sniper) { this.setThreat('sniperOut', false); this.setThreat('sniper', false); }
    if (!armed || civ) bus.emit('missionFailed', FAIL(civ ? 'התקיפה פגעה באזרחים.' : 'התקיפה פגעה באדם שלא זוהה כחמוש.', 'במסדרון הומניטרי תקיפה מותרת רק בזיהוי ודאי של חמוש, הרחק מאזרחים, ולפעמים לא תוקפים בכלל: עשן, שריון ומחסום עושים את העבודה בלי לסכן אף אחד. נסה שוב.'));
  }
  airRequest(where) {
    const u = this.U.air; if (u.busy) return 'בקשה כבר בטיפול באוגדה'; u.busy = true;
    const tgt = where === 'field' ? (this.sniper && this.sniper.alive && this.sniperOutT ? this.sniper : null) : 'bldg';
    this.radio(HQ, 'קיבלתי. בודקים אישור ונזק אגבי. זה ייקח זמן.');
    after(14, () => {
      if (tgt === 'bldg') { u.busy = false; this.notify('האוגדה: התקיפה לא אושרה', 'בבניין מסתתרות משפחות, והוא צמוד למסדרון. אין אישור לתקוף. השתמש בעשן ובשריון.', true); this.radio(HQ, 'שלילי. אזרחים בבניין. אין אישור.'); return; }
      if (!tgt) { u.busy = false; this.notify('האוגדה: אין יעד', 'אין כרגע יעד צבאי מזוהה בשטח פתוח.', false); return; }
      this.radio(AIR, 'מאושר. מטוס בדרך, פגיעה בעוד כארבעים שניות.');
      after(40, () => { u.busy = false; if (!tgt.alive || tgt.removed) { this.notify('התקיפה בוטלה', 'היעד נעלם בהריסות לפני שהמטוס הגיע. תקיפה מהאוויר איטית מדי ליעד שזז.', false); return; }
        G.csound.jet(); after(3, () => this.strikeAt(tgt.pos.clone(), tgt, this.civiliansNear(tgt.pos, 60), true)); });
    });
    return true;
  }
  // ---------- per frame ----------
  update(dt) {
    if (this.waiting) { G.missionClock = 10 * 3600; return; }
    this.t += dt; G.missionClock = 10 * 3600 + this.t * 37;
    for (let i = this.events.length - 1; i >= 0; i--) if (this.t >= this.events[i].at) { const e = this.events.splice(i, 1)[0]; e.fn(); }
    for (const u of this.units) if (u.cd > 0) u.cd -= dt;
    this.spawnTick(dt);
    // the lane B gate barrier slides aside onto the divider when the lane opens
    const g = G.laneGate; if (g) { const tx = this.gateTo ? CL.laneB + 2.3 : CL.laneB, tz = this.gateTo ? CL.funnelZ - 2.5 : CL.funnelZ - .5; g.position.x += (tx - g.position.x) * Math.min(1, dt * 1.5); g.position.z += (tz - g.position.z) * Math.min(1, dt * 1.5); g.rotation.y = this.gateTo ? .9 : 0; }
    // civilians' bodies are obstacles the column flows around
    const obs = G.crowdObstacles || (G.crowdObstacles = []); obs.length = 0;
    for (const a of G.actors) if (a.alive && !a.removed && a.pos.y < 2 && Math.abs(a.pos.x) < 14) obs.push({ x: a.pos.x, z: a.pos.z, r: a.collapsed && !a.cared ? 1.6 : .55 });
    if (this.car) { const c = this.car, o = c.o; obs.push({ x: o.position.x, z: o.position.z, r: 3.2 });
      if (c.v > 0) { o.position.z -= c.v * dt; if (!c.stop && o.position.z < 42 && c.warned < 2) { c.stop = true; c.v = 0; // too late: the checkpoint's own soldiers fire at the engine block
          const s = this.screeners.find(x => x.alive && !x.down) || this.screeners[0]; const e = s.eye(V3()); for (let k = 0; k < 5; k++) after(k * .15, () => { G.fx.muzzle(e.clone().add(V3(0, 0, .6)), o.position.clone().sub(e).normalize(), .6); G.audio.shotAt(e, 'm4'); });
          after(1, () => { this.civHurtDriver('הרכב לא נעצר בזמן, והלוחמים ירו למנוע: הנהג נפצע'); this.carStopped(); }); } }
      else if (c.back) { o.position.z += 4 * dt; if (o.position.z > 200) { G.scene.remove(o); this.car = null; } } }
    for (const m of this.movers) { if (m.done) continue; const o = m.o; const t = m.pts[m.i]; const dx = t.x - o.position.x, dz = t.z - o.position.z, L = Math.hypot(dx, dz);
      if (m.wait > 0) { m.wait -= dt; continue; } if (L < .5) { m.i++; if (m.i === 2) m.wait = 6; if (m.i >= m.pts.length) { m.done = true; G.scene.remove(o); G.crowd.passed++; } continue; }
      const sp = Math.min(m.v, L); o.position.x += dx / L * sp * dt; o.position.z += dz / L * sp * dt; o.rotation.y = Math.atan2(dx, dz); obs.push({ x: o.position.x, z: o.position.z, r: 2.8 }); }
    this.updateArmour(dt);
    // identification: the drone has to stay on the man for a few seconds
    if (this.idJob) { const j = this.idJob, s = j.obj; if (!s.alive || s.removed) this.idJob = null; else if (G.drone.track === s) { j.t += dt; if (j.t > 4) this.identifyDone(s); } }
    // the sniper keeps firing until the line is covered
    if (this.firing && !this.covered && this.sniper && this.sniper.alive && G.time > this.sniperNext) { this.sniperNext = G.time + rr(4, 7); this.sniperShot(); }
    // crowd pressure at the lane mouth: a long queue plus people still pressing in from behind
    const c = G.crowd; const ql = c.queueLen(); const cap = c.lanes[1].open ? 210 : 105;
    const tgtP = clamp((ql - cap * .55) / (cap * .6), 0, 1.6) * (this.spkCalm > G.time ? .8 : 1); this.press += (tgtP - this.press) * Math.min(1, dt * .5); c.press = Math.min(1, this.press);
    if (this.press >= 1 && !this.crushed && !c.shelter) { this.crushT += dt; if (this.crushT > 25) this.crush(); } else this.crushT = Math.max(0, this.crushT - dt * .5);
    // the old man: someone has to get to him
    if (this.oldMan && this.oldMan.collapsed && !this.oldMan.cared && !this.oldMan.medicComing && !this.oldMan._late && G.time - this.oldMan.collapsed > 75) { this.oldMan._late = true; this.st.civHurt++; this.st.violations.push('הקשיש שהתמוטט חיכה יותר מדי לטיפול, ומצבו הידרדר'); this.notify('מצבו של הקשיש הידרדר', 'הוא שוכב על הכביש יותר מדקה. החובשים עדיין יכולים לטפל בו.', true); }
    this.tT = (this.tT || 0) - dt; if (this.tT <= 0) { this.tT = .5; this.checkThreats(); this.updateBars(); }
    if (this.endAt && G.time > this.endAt && !this.done) { if (c.queueLen() < 4 || G.time > this.endAt + 30) this.finish(); }
    this.st.passed = c.passed;
  }
  crush() {
    this.crushed = true; const q = G.crowd.lanes[0].q; const vic = [q[Math.floor(q.length * .7)], q[Math.floor(q.length * .8)], q[Math.floor(q.length * .9)]].filter(Boolean);
    let n = 0; for (const v of vic) if (this.civHurt(v, 'דוחק בכניסה לנתיב: אזרחים נמחצו ונפצעו')) n++;
    this.st.violations = [...new Set(this.st.violations)];
    this.notify('דוחק במחסום! אנשים נפצעו', `${n} אזרחים נפגעו בדוחק בכניסה לנתיב. צריך חובשים, ונתיב נוסף.`, true); this.radio(CPK, 'יש נפגעים בדוחק! אנשים נופלים בכניסה לנתיב!');
  }
  flagCar(key, tint, z) {
    const o = civCar(key, tint); if (!o) return; o.position.set(CL.vehX, 0, z); this.movers.push({ o, pts: [V3(CL.vehX, 0, -48), V3(CL.vehX, 0, -8), V3(CL.vehX + .5, 0, 20), V3(CL.vehX - 1, 0, CL.exitZ)], i: 0, v: 1.3, wait: 0 });
  }
  updateBars() {
    const el = $('tensbar'); if (el) { el.style.width = (Math.min(1, this.press) * 100).toFixed(0) + '%'; }
    const tv = $('tensv'); if (tv) tv.textContent = this.press < .3 ? 'תקין' : this.press < .65 ? 'עומס' : this.press < 1 ? 'צפוף מאוד' : 'סכנת דוחק';
    const pc = $('passc'); if (pc) pc.textContent = G.crowd.passed;
  }
  lookAt(t, mark = false) { G.tablet && G.tablet.show('drone'); G.drone.target.copy(this.posOf(t)); G.drone.fov = G.drone.fovT = 6; if (mark && t.root) G.tablet.mark(t, true); if (t.root) G.drone.track = t; }
  // ---------- the task card ----------
  setThreat(id, on = true) { const T = this.threats || (this.threats = {}); if (on) { if (!T[id]) T[id] = G.time; } else delete T[id]; this.refreshTask(); }
  checkThreats() {
    if (!this.threats) return; const T = this.threats; const set = (id, on) => { if (!!T[id] !== !!on) this.setThreat(id, on); };
    set('crush', !this.crushed && this.press > .5);
    set('hurt', !!this.needsCare() && !this.U.med.busy && !T.old);
    set('old', this.oldMan && this.oldMan.collapsed && !this.oldMan.cared && !this.oldMan.medicComing);
    set('hold', this.U.cp.hold && c0(G.crowd) < 40);
    set('flow', this.U.cp.flow !== 'open' && !(this.firing && !this.covered));
    const left = this.suspects.filter(s => s.alive && !s.removed && !s.detained && s.stage < 3);
    set('cell', !this.cellDone() && left.length > 0);
    if (T.sniperOut && (!this.sniper || !this.sniper.alive || this.sniper.removed)) set('sniperOut', false);
    this.refreshTask();
    function c0(c) { return c.queueLen(); }
  }
  cellDone() { return this.suspects.length && this.suspects.filter(s => s.armed).every(s => s.flagged || s.detained || !s.alive); }
  refreshTask() {
    if (!G.command) return; const T = this.threats || {};
    const id = ['sniper', 'car', 'carCheck', 'crush', 'old', 'hurt', 'sniperOut', 'cell', 'hold', 'flow'].find(k => T[k]);
    const t = id ? this.taskDef(id) : { kind: 'מצב', title: (this.calm && this.calm.title) || 'המסדרון פתוח', text: (this.calm && this.calm.text) || '', acts: [{ icon: 'spk', label: 'כריזה', fn: () => this.order('spk') }, { icon: 'tab', label: 'טאבלט', cls: 'alt', fn: () => G.tablet.show('drone') }] };
    const sig = id + '|' + t.title + '|' + t.acts.map(a => a.label).join(',');
    if (sig === this._taskSig) return; this._taskSig = sig; G.command.setTask(t);
  }
  taskDef(id) {
    const U = this.U; const eye = (o, label = 'הראה ברחפן') => ({ icon: 'eye', label, cls: 'alt', fn: () => this.lookAt(o, !!(o && o.root)) });
    switch (id) {
      case 'old': return { kind: 'אזרח', title: 'קשיש התמוטט על הכביש', text: 'כ־60 מטר צפונית למחסום. האנשים עוקפים אותו. החובשים יגיעו דרך נתיב הרכבים.', hot: 'med', acts: [{ icon: 'med', label: 'שלח חובשים', fn: () => this.sendMedics(this.oldMan) }, eye(this.oldMan)] };
      case 'hurt': { const h = this.needsCare(); return { kind: 'פצוע', threat: true, title: h && h.friendly ? 'לוחם פצוע במחסום' : 'אזרח פצוע', text: 'צוות הרפואה פנוי. הם יטפלו ויפנו לאוהל הרפואה.', hot: 'med', acts: [{ icon: 'med', label: 'שלח חובשים', fn: () => this.sendMedics(h) }, ...(h ? [eye(h)] : [])] }; }
      case 'crush': return { kind: 'המון', threat: this.press > .85, title: this.press > .85 ? 'סכנת דוחק בכניסה לנתיב' : 'התור נדחס במחסום', text: !U.cp.laneB ? 'נתיב אחד לא עומד בזרם. פתיחת נתיב 2 מכפילה את הקצב. כריזה מרגיעה את הדוחפים.' : 'שני הנתיבים פתוחים והלחץ עדיין גבוה. עצירה זמנית בנקודת ההמתנה תשחרר את הכניסה.', hot: !U.cp.laneB ? 'lane' : 'spk',
        acts: !U.cp.laneB ? [{ icon: 'lane', label: 'פתח נתיב 2', fn: () => this.order('cp', 'laneB', true) }, { icon: 'spk', label: 'כריזה: להאט', cls: 'alt', fn: () => this.order('spk') }]
          : [U.cp.hold ? { icon: 'spk', label: 'כריזה: להאט', fn: () => this.order('spk') } : { icon: 'flow', label: 'עצור בנקודת ההמתנה', fn: () => this.order('cp', 'hold', true) }, { icon: 'spk', label: 'כריזה', cls: 'alt', fn: () => this.order('spk') }] };
      case 'hold': return { kind: 'זרימה', title: 'התור התקצר', text: 'הבאים עדיין עומדים בנקודת ההמתנה. כל דקה של עצירה מעכבת את כולם.', acts: [{ icon: 'flow', label: 'פתח את נקודת ההמתנה', fn: () => this.order('cp', 'hold', false) }] };
      case 'flow': return { kind: 'זרימה', title: U.cp.flow === 'pause' ? 'המחסום עצור' : 'המחסום בבדיקה איטית', text: 'התור לא זז כמו שצריך. אם אין סיבה, החזר לקצב רגיל.', acts: [{ icon: 'flow', label: 'קצב רגיל', fn: () => this.order('cp', 'flow', 'open') }] };
      case 'cell': {
        const left = this.suspects.filter(s => s.alive && !s.removed && !s.detained && s.stage < 3); const unk = left.filter(s => !s.identified), armed = left.filter(s => s.armed && s.identified && !s.flagged);
        if (armed.length) return { kind: 'התראה', threat: true, title: `זוהה חמוש בטור (${armed.length})`, text: 'זיהוי ודאי. סמן אותו לבודקים: הם יפרידו אותו בנקודת הסינון. תקיפה בתוך הטור אסורה.', hot: '', acts: [{ icon: 'flag', label: 'סמן לעיכוב במחסום', fn: () => this.flag(armed[0]) }, eye(armed[0])] };
        if (unk.length) return { kind: 'התראה', threat: true, title: `חוליה חמושה בטור · ${unk.length} חשודים לבדיקה`, text: 'שני חמושים בין שבעה צעירים שמתאימים לתיאור. זהה כל אחד ברחפן (כמה שניות של תצפית) לפני שהוא מגיע לנקודת הסינון. רובם אזרחים.', hot: '', acts: [{ icon: 'eye', label: 'זהה חשוד ברחפן', fn: () => this.identifyNext() }] };
        return { kind: 'התראה', title: 'כל החשודים נבדקו', text: 'החמושים שסומנו יעוכבו בנקודת הסינון.', acts: [{ icon: 'tab', label: 'טאבלט', cls: 'alt', fn: () => G.tablet.show('drone') }] };
      }
      case 'sniper': return { kind: 'ירי', threat: true, title: 'צלף יורה מבניין ממערב', text: 'קומה רביעית, 140 מ׳. בקומת הקרקע משפחות: אסור לתקוף את הבניין. עשן ושריון חוסמים את קו האש בלי לסכן אף אחד.', hot: 'cover',
        acts: [{ icon: 'smoke', label: 'עשן ושריון לחסימה', fn: () => this.cover() }, eye(G.sniperWin), { icon: 'uav', label: 'תקיפת כטב״ם בבניין', cls: 'danger', fn: () => this.uavStrike(this.sniper) }] };
      case 'sniperOut': return { kind: 'ירי', title: 'הצלף נסוג מערבה, לבד', text: 'הוא בשטח פתוח עם הרובה, רחוק מאזרחים. תקיפה מותרת עכשיו, אבל המסדרון כבר מוגן. בעוד חצי דקה ייעלם בהריסות.', acts: [eye(this.sniper, 'עקוב ברחפן'), { icon: 'uav', label: 'תקיפת כטב״ם', cls: 'danger', fn: () => this.uavStrike(this.sniper) }] };
      case 'car': { const c = this.car; return { kind: 'רכב', threat: true, title: c && c.warned ? 'הרכב לא עוצר' : 'רכב נוסע נגד הזרם', text: c && c.warned ? 'הוא האט, אבל ממשיך. השלב הבא בנוהל: ירי אזהרה באוויר.' : 'מהר, צפונה, אל המחסום. נוהל עצירה: קודם קריאה וסימון, אחר כך ירי אזהרה באוויר, ורק אז ירי למנוע.', hot: 'spk',
        acts: c && c.warned ? [{ icon: 'rifle', label: 'ירי אזהרה באוויר', fn: () => this.carWarn(2) }, { icon: 'rifle', label: 'ירי למנוע', cls: 'danger', fn: () => this.carWarn(3) }] : [{ icon: 'spk', label: 'קריאה וסימון לעצור', fn: () => this.carWarn(1) }, { icon: 'rifle', label: 'ירי למנוע', cls: 'danger', fn: () => this.carWarn(3) }] }; }
      case 'carCheck': return { kind: 'רכב', title: 'הרכב עצר', text: 'בודק ייגש לרכב. אם הנהג אזרח, הוא יחזור דרומה בנתיב הרכבים.', acts: [{ icon: 'flag', label: 'בדוק את הרכב', fn: () => this.carCheck() }] };
    }
    return { title: '', text: '', acts: [] };
  }
  // ---------- markers over threats and our units (main view) ----------
  markers() {
    const L = []; const T = this.threats || {}; const ok = a => a && a.alive && !a.removed;
    if (this.oldMan && this.oldMan.collapsed && !this.oldMan.cared && ok(this.oldMan)) L.push({ id: 'old', pos: this.oldMan.pos, label: 'קשיש', kind: 'threat', h: 1.6 });
    if (T.crush) L.push({ id: 'crush', pos: V3(-1, 0, CL.funnelZ - 2), label: 'דוחק', kind: 'threat', h: 2.6 });
    for (const s of this.suspects) if (ok(s) && s.identified && s.armed && !s.detained) L.push({ id: 's' + s.sn, pos: s.pos, label: s.flagged ? 'חמוש · מסומן' : 'חמוש', kind: 'threat' });
    if (T.sniper && G.sniperWin) L.push({ id: 'snp', pos: G.sniperWin, label: 'צלף', kind: 'threat', h: .5 });
    if (T.sniperOut && ok(this.sniper)) L.push({ id: 'snp2', pos: this.sniper.pos, label: 'צלף נסוג', kind: 'threat' });
    if (this.car && (T.car || T.carCheck)) L.push({ id: 'car', pos: this.car.o.position, label: 'רכב', kind: 'threat', h: 2.2 });
    for (const h of this.hurt) if (ok(h) && !h.cared) L.push({ id: 'h' + h.id, pos: h.pos, label: h.friendly ? 'לוחם פצוע' : 'פצוע', kind: 'threat', h: 1.5 });
    const U = this.U; if (!U) return L;
    L.push({ id: 'cpk', pos: V3(0, 0, 6), label: 'מחסום · ' + (U.cp.laneB ? '2 נתיבים' : 'נתיב 1') + (U.cp.flow === 'pause' ? ' · עצור' : U.cp.flow === 'slow' ? ' · איטי' : ''), kind: U.cp.flow === 'pause' ? 'unit warn' : 'unit', h: 3.6 });
    if (U.cp.hold) L.push({ id: 'hold', pos: V3(0, 0, CL.hold), label: 'נקודת המתנה · עצירה', kind: 'unit warn', h: 2.5 });
    const mp = this.medics.find(m => m.alive); if (mp && U.med.busy) L.push({ id: 'med', pos: mp.pos, label: 'חובשים', kind: 'unit', h: 2.1 });
    for (const id of ['apcA', 'tank']) { const u = U[id]; if (u.obj && (u.drive || u.pos !== 'home')) L.push({ id, pos: u.obj.position, label: u.name + (u.drive ? ' · בתנועה' : ''), kind: 'unit', h: 3.4 }); }
    if (G.spkPos && this.spkOnAir > G.time) L.push({ id: 'spkH', pos: G.spkPos, label: 'כריזה · משדר', kind: 'unit warn', h: .9 });
    return L;
  }
  // ---------- intel & notifications ----------
  addIntel(from, text, red = false, go = null) { const it = { t: G.missionClock, from, text, red, go, isNew: true }; this.intel.unshift(it); G.tablet && G.tablet.onIntel(it); this.notify(from, text, red, true); }
  notify(h, text, red, intel = false) { const n = $('notif'); if (!n) return; $('notifH').textContent = h; $('notifT').textContent = text; n.className = 'on' + (red ? ' red' : ''); n.onclick = () => G.tablet && G.tablet.show(intel ? 'intel' : 'drone'); clearTimeout(this._nt); this._nt = setTimeout(() => n.className = '', red ? 9000 : 6500); if (G.tablet) G.tablet.toast(h, text, red); if (red) G.audio.squelch && G.audio.squelch(); }
  // ---------- identification for the tablet ----------
  // a person picked out on the drone becomes a full character and keeps going the way he was going
  promote(agent) {
    const a = G.crowd.promote(agent, 'civ'); if (!a) return null; a.role = 'crowd'; a.brain = () => {}; const x = clamp(agent.x, -8, 8), sp = agent.walk || 1;
    if (agent.z > 4) a.setPath([V3(x, 0, CL.exitZ)], sp, () => a.remove());
    else if (agent.z > CL.funnelZ - 4) a.setPath([V3(CL.laneA, 0, 3), V3(CL.laneA, 0, 12), V3(x, 0, CL.exitZ)], .6, () => a.remove());
    else a.setPath([V3(x, 0, CL.funnelZ - 6), V3(CL.laneA, 0, CL.funnelZ + 1), V3(CL.laneA, 0, 3), V3(CL.laneA, 0, 12), V3(x, 0, CL.exitZ)], sp, () => a.remove());
    return a;
  }
  identify(o) {
    if (o.friendly) return { name: o.name || 'כוח שלנו', desc: 'בעמדה.', threat: false, unit: true };
    const r = o.role;
    if (r === 'suspect') return o.identified ? (o.armed ? { name: 'חמוש · זיהוי ודאי', desc: o.idDesc + (o.flagged ? ' · סומן לעיכוב.' : ''), threat: true } : { name: 'אזרח · נבדק', desc: o.idDesc, threat: false }) : { name: 'מתאים לתיאור · לא נבדק', desc: 'צעיר עם תיק או מעיל כהה. כדי לדעת צריך כמה שניות של תצפית קרובה.', threat: false };
    if (r === 'sniper') return { name: 'צלף חמוש', desc: this.sniperOutT ? 'יצא מהבניין עם רובה, בשטח פתוח. לבד.' : 'בקומה הרביעית. בקומת הקרקע של הבניין מסתתרות משפחות.', threat: true };
    if (r === 'old') return { name: 'קשיש', desc: o.cared ? 'טופל. בדרך לאוהל הרפואה.' : 'התמוטט על הכביש. זקוק לטיפול.', threat: false };
    if (r === 'sheltering') return { name: 'משפחה מסתתרת', desc: 'בקומת הקרקע של הבניין.', threat: false };
    if (o.kid) return { name: 'ילד', desc: 'הולך עם משפחתו דרומה.', threat: false };
    return { name: 'אזרח', desc: o.hurt ? 'פצוע.' : 'הולך דרומה במסדרון. לא מזוהה כאיום.', threat: false };
  }
  // ---------- tablet map (north up) ----------
  drawMap(g, W, H, v = {}) {
    const zc = v.zc ?? -70, span = v.brief ? 380 : 330; const xs = span * W / H; const x0 = -xs / 2, x1 = xs / 2, z0 = zc - span / 2;
    const px = x => (x - x0) / (x1 - x0) * W, pz = z => (z - z0) / span * H; this._map = { x0, x1, z0, span, W, H };
    g.fillStyle = '#25231c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3a3528'; g.fillRect(px(-CL.road), 0, px(CL.road) - px(-CL.road), H);
    g.fillStyle = 'rgba(232,220,196,.18)'; for (const [x, z, w, d, ry] of G.footprints || []) { if (Math.abs(x) > xs / 2 + 30) continue; g.save(); g.translate(px(x), pz(z)); g.rotate(-ry); g.fillRect(-w / 2 * W / (x1 - x0), -d / 2 * H / span, w * W / (x1 - x0), d * H / span); g.restore(); }
    const S = CL.sniper; g.strokeStyle = this.firing && !this.covered ? '#ff6a50' : 'rgba(232,220,196,.4)'; g.lineWidth = 2; g.strokeRect(px(S.x - S.d / 2), pz(S.z - S.w / 2), S.d * W / (x1 - x0), S.w * H / span);
    // the checkpoint and its lanes
    g.strokeStyle = '#d8d2c0'; g.lineWidth = 2; g.beginPath(); for (const x of [-4.4, 0, 4.4]) { g.moveTo(px(x), pz(CL.funnelZ)); g.lineTo(px(x), pz(5)); } g.moveTo(px(-4.4), pz(CL.funnelZ)); g.lineTo(px(-10.5), pz(CL.funnelZ - 22)); g.moveTo(px(4.4), pz(CL.funnelZ)); g.lineTo(px(5.6), pz(CL.funnelZ - 20)); g.stroke();
    if (!this.U || !this.U.cp.laneB) { g.strokeStyle = '#e0533d'; g.beginPath(); g.moveTo(px(.3), pz(CL.funnelZ)); g.lineTo(px(4.1), pz(CL.funnelZ)); g.stroke(); }
    if (this.U && this.U.cp.hold) { g.strokeStyle = '#f2d04b'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(px(-CL.road), pz(CL.hold)); g.lineTo(px(CL.road), pz(CL.hold)); g.stroke(); g.setLineDash([]); }
    // people
    g.fillStyle = 'rgba(242,184,75,.6)'; for (const a of G.crowd.agents) if (a.alive) { const X = px(a.x), Y = pz(a.z); if (X > 0 && X < W && Y > 0 && Y < H) g.fillRect(X - 1, Y - 1, 2, 2); }
    const dot = (p, col, lbl) => { g.fillStyle = col; g.beginPath(); g.arc(px(p.x), pz(p.z), 4.5, 0, 7); g.fill(); if (lbl) { g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText(lbl, px(p.x), pz(p.z) - 8); } };
    for (const m of (G.tablet && G.tablet.marks) || []) { const o = m.obj; if (o.removed || o.alive === false) continue; dot(this.posOf(o), m.threat ? '#ff6a50' : '#e8dcc4', m.label); }
    for (const a of G.actors) if (a.friendly && a.alive) { g.fillStyle = a.down ? '#e0533d' : '#9ac0e6'; g.fillRect(px(a.pos.x) - 2.5, pz(a.pos.z) - 2.5, 5, 5); }
    for (const o of Object.values(G.armour || {})) { g.strokeStyle = '#9ac0e6'; g.lineWidth = 2; g.save(); g.translate(px(o.position.x), pz(o.position.z)); g.rotate(-o.rotation.y); g.strokeRect(-4, -6, 8, 12); g.restore(); }
    if (this.car) dot(this.car.o.position, '#ff6a50', 'רכב');
    for (const s of this.U ? [this.U.apcA] : []) if (s.smokeUntil > G.time) { g.fillStyle = 'rgba(230,230,220,.35)'; g.beginPath(); g.ellipse(px(s.smokeAt.x), pz(s.smokeAt.z), 10, 22, 0, 0, 7); g.fill(); }
    g.fillStyle = '#f2b84b'; g.beginPath(); g.arc(px(G.player.pos.x), pz(G.player.pos.z), 5, 0, 7); g.fill(); g.font = '700 11px Heebo'; g.textAlign = 'center'; g.fillText('אתה', px(G.player.pos.x), pz(G.player.pos.z) + 16);
    if (G.drone && !v.brief) { const d = G.drone.target; g.strokeStyle = '#e8f0e0'; g.lineWidth = 1.5; g.beginPath(); g.arc(px(d.x), pz(d.z), 9, 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(232,220,196,.75)'; g.font = '12px Heebo'; g.textAlign = 'center'; g.fillText('צפון ↑', W - 34, 18); g.fillText('ים ←', 26, 18);
    g.fillText('כביש צלאח א־דין', px(0), 14); g.fillStyle = '#9ac0e6'; g.fillText('מחסום', px(-14), pz(2)); g.fillText('חפ״ק', px(CL.cp.x), pz(CL.cp.z) + 26);
    if (v.brief) { g.fillStyle = 'rgba(232,220,196,.8)'; g.fillText('הטור מגיע מצפון', px(0), pz(-200)); g.fillText('נקודת המתנה', px(18), pz(CL.hold)); g.fillText('דרומה', px(0), pz(60)); }
  }
  // ---------- end ----------
  finish() {
    if (G.state !== 'play') return; this.done = true; G.stats.end = performance.now();
    const c = G.crowd; this.st.stranded = c.queueLen(); this.st.passed = c.passed;
    bus.emit('missionComplete', {});
  }
  fillEnd() {
    const s = this.st; const secs = Math.round((G.stats.end - G.stats.start) / 1000);
    $('st-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; $('st-pass').textContent = s.passed; $('st-civ').textContent = s.civHurt; $('st-idf').textContent = s.idfHurt;
    const onTime = s.stranded < 15; const clean = s.civHurt === 0 && s.idfHurt === 0;
    const perfect = clean && s.wrongDetain === 0 && onTime;
    $('endGrade').innerHTML = perfect ? (s.militants ? 'אף אזרח ואף לוחם לא נפגעו.<small>המסדרון עבד בזמן, והחמושים לא עברו.</small>' : 'אף אחד לא נפגע.<small>כולם עברו בזמן, והחמושים לא עברו. זו המטרה.</small>')
      : clean ? 'אף אחד לא נפגע, אבל היו מחירים.<small>' + (s.wrongDetain ? 'אנשים לא חמושים עוכבו בגלל זיהוי לא ודאי. ' : '') + (!onTime ? 'לא כולם הספיקו לעבור לפני הסגירה.' : '') + '</small>'
      : s.civHurtUnjust || (s.civHurt && !s.idfHurt) ? 'אזרחים נפגעו.<small>פגיעה באזרחים היא הכישלון הכבד ביותר במסדרון הומניטרי, גם כשהמשימה הושלמה.</small>' : 'לוחמים נפגעו.<small>הירי נמשך זמן רב מדי בלי מסך עשן. אפשר היה לחסום את קו האש מוקדם יותר.</small>';
    const li = []; li.push([`כ־${s.passed} אנשים עברו את המחסום דרומה`, false]);
    for (const p of [...new Set(s.prevented)]) li.push([p, false]);
    if (s.detained - s.wrongDetain > 0) li.push([`${s.detained - s.wrongDetain} חמושים עוכבו בלי ירייה`, false]);
    if (s.wrongDetain) li.push([`${s.wrongDetain} אזרחים לא חמושים עוכבו בגלל זיהוי לא ודאי`, true]);
    for (const v of [...new Set(s.violations)]) li.push([v, true]);
    if (s.civHurt) li.push([`${s.civHurt} אזרחים נפגעו`, true]); if (s.idfHurt) li.push([`${s.idfHurt} לוחמים נפגעו`, true]);
    if (s.militants) li.push([`${s.militants} חמושים נהרגו בתקיפה מדויקת`, false]);
    if (!onTime) li.push([`${s.stranded} אנשים עדיין עמדו בתור כשהמסדרון נסגר`, true]);
    $('endList').innerHTML = li.map(([t, b]) => `<li class="${b ? 'bad' : ''}">${t}</li>`).join('');
  }
}
