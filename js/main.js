// Operation Arnon – bootstrap, render pipeline, game loop, menus
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { G, installFog, FOG, tickTimers, bus, clamp, fmtClock } from './core.js';
import { loadAll, A } from './assets.js';
import { buildMaterials } from './materials.js';
import { buildWorld } from './world.js';
import { buildTarget, flushTarget, updateDoors, B } from './building.js';
import { Audio } from './audio.js';
import { FX } from './fx.js';
import { Player, Input, initInput, installQueries } from './player.js';
import { Weapon } from './weapon.js';
import { UI } from './ui.js';
import { Mission, BRIEFING } from './mission.js';
import { Guide } from './guide.js';
import { VO } from './vo.js';
import { bakeVolume, bakeSunShadow, occluderFrom, GIU, giAt } from './gi.js';
import { AutoExposure, EXPOSURE_GLSL, GRADE_GLSL, GRADE_U, installToneMapping } from './exposure.js';
import { WIND } from './materials.js';
import { SunFx, SUN_GLSL, HeatHaze } from './sunfx.js';
import { UpscalePass, DynRes } from './resolution.js';

const $ = id => document.getElementById(id);
// build number in the menu and the pause card: tells a play-tester which version (and not a cached older script) is running
const BUILD = 22; $('build').textContent = '· גרסה ' + BUILD;
const canvas = $('c');

function err(msg) { const e = $('err'); e.hidden = false; e.textContent = msg; }
addEventListener('error', e => { if (e.message) err('שגיאה בטעינת המשחק: ' + e.message); });
addEventListener('unhandledrejection', e => { err('שגיאה בטעינת המשחק: ' + (e.reason && e.reason.message || e.reason)); });

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
// a lost GPU context (memory or a driver watchdog on phones) otherwise just freezes the frame: say so and offer a reload
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); err('הגרפיקה של הדפדפן קרסה (בדרך כלל חוסר זיכרון). סגור לשוניות אחרות ורענן את הדף, או בחר איכות נמוכה.'); });
// phones: bigger images are resampled at upload (three.js does it against capabilities.maxTextureSize; the shadow map read
// its limit at construction). A 1024 px texture with mips is 5.3 MB, and on an iPhone it counts against the tab's ceiling
if (G.isTouch) renderer.capabilities.maxTextureSize = Math.min(renderer.capabilities.maxTextureSize, G.lowMem ? 512 : 1024);
installToneMapping(renderer); renderer.toneMappingExposure = 1.06; // AgX with a contrast/saturation look (exposure.js)
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
G.renderer = renderer;
installFog();
const scene = new THREE.Scene(); G.scene = scene;
// the height-fog term (core.js FOG) carries the aerial perspective; the exp2 density only closes off the far town
scene.fog = new THREE.FogExp2('#d3c5ab', .003);
const camera = new THREE.PerspectiveCamera(72, 1, .05, 6000); G.camera = camera; scene.add(camera);
G.clock = new THREE.Clock();

const sky = new Sky(); sky.scale.setScalar(5000); scene.add(sky);
Object.assign(sky.material.uniforms, {});
sky.material.uniforms.turbidity.value = 9; sky.material.uniforms.rayleigh.value = 1.1; sky.material.uniforms.mieCoefficient.value = .006; sky.material.uniforms.mieDirectionalG.value = .8;
sky.material.uniforms.sunPosition.value.copy(G.sunDir);

const sun = new THREE.DirectionalLight('#ffe8c8', 4.3); sun.castShadow = true; sun.shadow.bias = -.0002; sun.shadow.normalBias = .03;
const sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
scene.add(sun, sun.target); G.sun = sun;
// the sun's glare, shafts and ghosts are a post pass (sunfx.js)
const hemi = new THREE.HemisphereLight('#c4d6ec', '#b9a286', 1.2); scene.add(hemi); // ground: sunlit sand and plaster bounce, warm but not orange

G.audio = new Audio();

// ---------- post ----------
// the scene's depth stays readable (GTAO reconstructs normals from it instead of re-rendering the whole scene)
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
const composer = new EffectComposer(renderer, rt); G.composer = composer;
const mainPass = new RenderPass(scene, camera); composer.addPass(mainPass);
let gtao = null, vmPass = null, fxaa = null, smaa = null, heat = null;
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .28, .5, .98);
const autoExp = G.autoExp = new AutoExposure();
const sunFx = G.sunFx = new SunFx({ strength: 0.6, color: '#fff0dc' });
const grade = G.grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uHurt: { value: 0 }, uTx: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uSharp: { value: .35 }, tExp: { value: null }, uKey: { value: 0 }, uAlpha: { value: 0 }, uEvLo: { value: 0 }, uEvHi: { value: 0 }, uEvBias: { value: 0 }, tSun: { value: null }, uSunUv: { value: new THREE.Vector2() }, uSunI: { value: 0 }, uSunCol: { value: new THREE.Vector3() }, uSunAsp: { value: 1 } },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  // (sharpening works on x/(1+x): in linear HDR the unsharp mask rang around the sun and bright windows)
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uT,uHurt,uSharp;uniform vec2 uTx;varying vec2 vUv;
  ${EXPOSURE_GLSL}
  ${SUN_GLSL}
  ${GRADE_GLSL}
  void main(){vec4 c=vec4(lensFetch(tDiffuse,vUv,uHurt*.004),1.);
    vec3 nb=(texture2D(tDiffuse,vUv+vec2(uTx.x,0.)).rgb+texture2D(tDiffuse,vUv-vec2(uTx.x,0.)).rgb+texture2D(tDiffuse,vUv+vec2(0.,uTx.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.,uTx.y)).rgb)*.25;
    vec3 sf=sunFx(vUv);c.rgb+=sf;nb+=sf;float ex=autoExposure();c.rgb*=ex;nb*=ex;
    vec3 cc=c.rgb/(1.+c.rgb),cn=nb/(1.+nb);cc=clamp(cc+(cc-cn)*uSharp,0.,.995);c.rgb=cc/(1.-cc);
    c.rgb=filmGrade(c.rgb,ex);float l=dot(c.rgb,vec3(.299,.587,.114));c.rgb=mix(vec3(l),c.rgb,1.-uHurt*.5);
    c.rgb=filmFinish(c.rgb,vUv,uHurt*1.5,uT);gl_FragColor=c;}` });
Object.assign(grade.uniforms, autoExp.uniforms, sunFx.uniforms, GRADE_U); // shared objects: the adapted-exposure texture changes every frame

// ---------- quality ----------
// render resolution per quality level; phones have dense screens and get a higher cap (dynamic resolution protects the frame rate)
function basePR(q) { const dpr = devicePixelRatio || 1; return G.isTouch ? [Math.min(dpr, 1.1), Math.min(dpr, G.lowMem ? 1.5 : 1.8), Math.min(dpr, G.lowMem ? 1.8 : 2.4)][q] : [.75, Math.min(dpr, 1.3), Math.min(dpr, 2)][q]; }
// the canvas keeps the display's resolution; the scene renders at basePR x dynamic scale and UpscalePass resamples it
// (phones: only when dynamic resolution has dropped; an always-on full-res pass costs fill rate they don't have)
function displayPR() { return G.isTouch ? basePR(G.quality) : Math.max(basePR(G.quality), Math.min(devicePixelRatio || 1, 2)); }
function internalPR() { return basePR(G.quality) * dyn.scale; }
const dyn = new DynRes(); const upscale = new UpscalePass();
function applyQuality(q) {
  G.quality = q; const dpr = devicePixelRatio || 1;
  renderer.setPixelRatio(displayPR());
  renderer.shadowMap.enabled = q > 0; sun.castShadow = q > 0;
  // low quality has no live shadow map: the baked town shadow covers everything
  GIU.uSunNear.value = q > 0 ? 40 : 0;
  const ms = (q === 2 ? 4096 : 2048) / (G.lowMem ? 2 : 1); sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  // compile every shader now so nothing hitches the first time it comes into view (entering the building, first explosion...)
  precompile();
  bloom.enabled = q > 0; if (gtao) gtao.enabled = q === 2 || (q === 1 && !G.isTouch); if (heat) heat.enabled = !!(gtao && gtao.enabled); if (fxaa) fxaa.enabled = q === 0; if (smaa) smaa.enabled = q === 1; grade.uniforms.uSharp.value = [.2, .3, .38][q];
  const ns = q === 2 ? 4 : 0; for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== ns) { t.samples = ns; t.dispose(); }
  document.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.q === q)));
  try { localStorage.setItem('arnon-q', q); } catch (e) {}
  resize();
}
function precompile() {
  // compile into the composer's HDR target: program keys differ from on-screen rendering (no tone mapping / linear output)
  try { const seen = new Set(); scene.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'emissiveMap']) { const t = m[k]; if (t && !seen.has(t)) { seen.add(t); renderer.initTexture(t); } } }); } catch (e) {}
  try { renderer.setRenderTarget(composer.renderTarget1); renderer.compile(scene, camera); if (G.weapon) renderer.compile(G.weapon.scene, G.weapon.cam); renderer.setRenderTarget(null); } catch (e) { console.warn(e); }
}
G.precompile = () => precompile();
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setPixelRatio(displayPR()); renderer.setSize(w, h, false); composer.setPixelRatio(internalPR()); composer.setSize(w, h);
  upscale.enabled = internalPR() < displayPR() * .98; upscale.uniforms.uSharp.value = G.quality === 2 ? .6 : .45;
  camera.aspect = w / h; G.player && (G.player.fovBase = w < h ? 80 : 72); camera.updateProjectionMatrix();
  if (G.weapon) G.weapon.resize(w / h);
  { const pr = internalPR(); if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); grade.uniforms.uTx.value.set(1 / (w * pr), 1 / (h * pr)); if (smaa) smaa.setSize(w * pr, h * pr); }
  if (G.fx) G.fx.setScale(h * internalPR() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
}
addEventListener('resize', resize);

// ---------- boot ----------
async function boot() {
  $('loadtxt').textContent = 'טוען דמויות, נשק ורכבים…';
  await loadAll(p => { $('loadbar').style.transform = `scaleX(${p})`; $('loadpct').textContent = Math.round(p * 100) + '%'; });
  $('loadtxt').textContent = 'בונה את נוסייראת…'; await new Promise(r => setTimeout(r, 30));
  // environment lighting from the sunny HDRI
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(A.hdr).texture; scene.environmentIntensity = .85;
  // photographic sky dome (Poly Haven, sun removed; the directional light + flare provide the sun)
  // sampled directly per pixel (no equirect→cube conversion, which left a visible seam wedge at the top cube face)
  A.hdr.colorSpace = THREE.LinearSRGBColorSpace; scene.background = null; sky.visible = false;
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
    uniforms: { map: { value: A.hdr }, uInt: { value: 1.35 }, uSun: { value: G.sunDir }, uHaze: { value: new THREE.Vector3(...scene.fog.color.toArray().map((v, i) => v * FOG.away[i])) } }, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }',
    // the photograph's sun was removed (the light carries it); put back a disc of the sun's real size (0.53 deg) with an
    // aureole, so looking up at it blazes without a white blob. The photo is a clear-day sky: it is greyed a little and
    // melts into the same dusty haze the fog puts on the far town at the horizon, so skyline and sky meet in one air;
    // a thin veil of the same dust greys the whole dome (the photo's deep zenith blue read as a polarised postcard).
    fragmentShader: '#include <common>\nuniform sampler2D map; uniform float uInt; uniform vec3 uSun, uHaze; varying vec3 vDir; void main(){ vec3 d = normalize(vDir); vec2 uv = vec2(atan(d.z, d.x) * RECIPROCAL_PI2 + .5, asin(clamp(d.y, -1., 1.)) * RECIPROCAL_PI + .5); vec3 c = texture2D(map, uv).rgb * uInt; c = mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, .84); float s = max(dot(d, uSun), 0.), t2 = 2. * (1. - s); c += vec3(1.3, 1.15, .95) * ((1. - smoothstep(2.2e-5, 5e-5, t2)) * 40. + pow(s, 900.) * .8 + pow(s, 60.) * .12 + pow(s, 8.) * .05); c = mix(c, uHaze, .1 + exp(-max(d.y + .01, 0.) * 16.) * .8); gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
  }));
  skyDome.renderOrder = -1000; skyDome.frustumCulled = false; skyDome.onBeforeRender = (r, s, cam) => { skyDome.position.copy(cam.position); skyDome.updateMatrixWorld(); };
  skyDome.name = 'skyDome'; scene.add(skyDome); G.skyDome = skyDome;
  try { await Promise.race([document.fonts.load('700 64px "Noto Kufi Arabic"'), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
  buildMaterials();
  buildWorld();
  const byMat = buildTarget(); flushTarget(byMat);
  // tiny props (cups, bottles, shoes, fruit) cast shadows nobody can see next to the ambient occlusion, and each one
  // costs a draw call in the shadow pass
  scene.traverse(o => { if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.castShadow) return; const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); const sc = o.getWorldScale(new THREE.Vector3()); if (g.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z) < .22) o.castShadow = false; });
  // collision BVH
  const geos = G.colliders.map(g => { let q = g.index ? g.toNonIndexed() : g.clone(); const p = new THREE.BufferGeometry(); p.setAttribute('position', q.attributes.position); return p; });
  const merged = mergeGeometries(geos); merged.boundsTree = new MeshBVH(merged, { maxLeafTris: 8 });
  const occ = occluderFrom(G.colliders);
  G.bvhMesh = new THREE.Mesh(merged); G.colliders.length = 0;
  installQueries();
  // ambient light visibility: the town at 2 m, the target building at 40 cm (see gi.js)
  $('loadtxt').textContent = 'מחשב תאורה…'; await new Promise(r => setTimeout(r, 30));
  const giT0 = performance.now();
  await bakeVolume(renderer, occ, { slot: 'a', min: new THREE.Vector3(-300, 0, -176), max: new THREE.Vector3(264, 24, 176), cell: 2, dirs: G.isTouch ? 40 : 64, res: G.lowMem ? 1024 : G.isTouch ? 1536 : 2048, reach: 700, bounce: .45, strength: .8 });
  await bakeVolume(renderer, occ, { slot: 'b', min: new THREE.Vector3(31.6, 0, -20.4), max: new THREE.Vector3(48.4, 19.2, -5.6), cell: .4, dirs: G.isTouch ? 64 : 96, res: 1024, reach: 600, bounce: 1.6, strength: 1 });
  bakeSunShadow(renderer, occ, { min: new THREE.Vector3(-300, 0, -176), max: new THREE.Vector3(264, 30, 176), sunDir: G.sunDir, res: G.lowMem ? 1024 : 2048, near: 40 });
  occ.dispose(); G.giBakeMs = Math.round(performance.now() - giT0);
  G.fx = new FX(); G.player = new Player(); G.weapon = new Weapon(); G.ui = new UI(); G.guide = new Guide(); G.mission = new Mission();
  // passes that need the viewmodel/scene ready
  // GTAO from the main pass's depth: its own normal pre-pass re-rendered every mesh (half of all draw calls). The
  // composer's buffers swap an odd number of times per frame, so follow whichever one holds this frame's scene.
  class GTAOFromDepth extends GTAOPass { render(r, w, rb, dt, m) { const d = rb.depthTexture; G.sceneDepth = d; if (d && this.gtaoMaterial.uniforms.tDepth.value !== d) { this.gtaoMaterial.uniforms.tDepth.value = d; this.pdMaterial.uniforms.tDepth.value = d; } super.render(r, w, rb, dt, m); } }
  gtao = new GTAOFromDepth(scene, camera, 1, 1); gtao.setGBuffer(composer.readBuffer.depthTexture); // (after construction: r170's setGBuffer trips over a missing normal target otherwise)
  gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = .9; G.gtao = gtao;
  gtao.updateGtaoMaterial({ radius: .6, distanceExponent: 1.6, thickness: 1.2, scale: 1, samples: 12, distanceFallOff: 1 }); composer.addPass(gtao);
  class VMPass extends RenderPass { render(r, w, rb, dt, m) { r.setRenderTarget(this.renderToScreen ? null : rb); r.clearDepth(); super.render(r, w, rb, dt, m); } }
  composer.addPass(autoExp); // meter the world before the weapon is drawn over it
  composer.addPass(sunFx);
  heat = new HeatHaze(1.0); composer.addPass(heat); // needs the scene depth GTAO passes on: on with GTAO only
  vmPass = new VMPass(G.weapon.scene, G.weapon.cam); vmPass.clear = false; vmPass.clearDepth = false; composer.addPass(vmPass);
  // bloom sees absolute light (windows, flashes), then exposure scales both
  composer.addPass(bloom); composer.addPass(grade); composer.addPass(new OutputPass());
  fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); smaa = new SMAAPass(innerWidth, innerHeight); composer.addPass(smaa); composer.addPass(upscale);
  initInput(canvas);
  let q = G.isTouch ? 1 : 2; try { const s = localStorage.getItem('arnon-q'); if (s !== null) q = +s; } catch (e) {}
  applyQuality(q);
  // title backdrop: camera looking down the market at the target
  // a wide shot west down the market toward the Sapir building (it drifts gently; a steady turn ends up facing a wall)
  G.menuYaw = Math.PI / 2 + .13; G.player.setPos(new THREE.Vector3(82, 0, .2), G.menuYaw); G.player.pitch = .06;
  $('loading').hidden = true; $('menu').hidden = false; G.state = 'menu';
  requestAnimationFrame(frame);
}

// ---------- menus ----------
function startBriefing() {
  G.audio.resume(); G.audio.startAmbience(); G.audio.startMusic(); G.audio.setIntensity(.1); G.audio.setCrowd(.4);
  $('menu').hidden = true; $('briefing').hidden = false; G.state = 'briefing';
  const cv = $('map'); const ctx = { t: 0, focus: 0 };
  const draw = () => { if (G.state !== 'briefing') return; const r = cv.getBoundingClientRect(); if (cv.width !== Math.round(r.width * 1.5)) { cv.width = Math.round(r.width * 1.5); cv.height = Math.round(r.height * 1.5); } ctx.t = Math.min(1, ctx.t + .01); G.ui.drawMap(cv, ctx.t, ctx.focus); requestAnimationFrame(draw); };
  draw();
  const list = $('brieflines'); list.innerHTML = '';
  BRIEFING.forEach(([id, focus], i) => {
    G.audio.say(id, { onend: () => { if (i === BRIEFING.length - 1) $('bgo').classList.add('ready'); } });
  });
  bus.on('sub', it => { if (!it || G.state !== 'briefing') return; const f = BRIEFING.find(b => VO[b[0]].text === it.text); if (f) { ctx.focus = f[1]; ctx.t = 0; const li = document.createElement('li'); li.textContent = it.text; list.appendChild(li); list.scrollTop = list.scrollHeight; } });
}
function startMission(cp = 0) {
  G.audio.clearVoice(); $('briefing').hidden = true; $('hud').hidden = false; $('menu').hidden = true;
  G.stats = { shots: 0, hits: 0, kills: 0, civHits: 0, start: performance.now(), end: 0, damage: 0 };
  G.mission.start(cp); precompile(); lock();
}
function lock() { if (!G.isTouch) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } }
function pause(on) {
  if (on && (G.state === 'play' || G.state === 'cutscene')) { G.prevState = G.state; G.state = 'paused'; $('pause').hidden = false; G.audio.ctx.suspend(); $('diag').textContent = `גרסה ${BUILD} · ${G.fps || '—'} fps · איכות ${['נמוכה', 'בינונית', 'גבוהה'][G.quality]} · רזולוציה ${Math.round(internalPR() / displayPR() * 100)}%`; }
  else if (!on && G.state === 'paused') { G.state = G.prevState; $('pause').hidden = true; G.audio.resume(); lock(); G.clock.getDelta(); }
}
$('bstart').addEventListener('click', startBriefing);
$('bgo').addEventListener('click', () => startMission(0));
$('bskip').addEventListener('click', () => startMission(0));
$('bresume').addEventListener('click', () => pause(false));
$('brestart').addEventListener('click', () => { pause(false); $('pause').hidden = true; G.mission.restart(); });
$('bquit').addEventListener('click', () => location.reload());
$('bretry').addEventListener('click', () => { $('fail').hidden = true; G.mission.restart(); G.ui.fadeTo(0, .3); lock(); });
$('bagain').addEventListener('click', () => location.reload());
$('bhist').addEventListener('click', () => { $('hist').hidden = false; });
$('bhistclose').addEventListener('click', () => { $('hist').hidden = true; });
$('bpause').addEventListener('click', () => pause(true));
document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); applyQuality(+b.dataset.q); }));
$('sens').addEventListener('input', e => { G.settings.sens = +e.target.value; });
$('subs').addEventListener('change', e => { G.settings.subtitles = e.target.checked; });
$('voice').addEventListener('change', e => { G.settings.voice = e.target.checked; });
$('autofire').addEventListener('change', e => { G.settings.autoFire = e.target.checked; });
$('gyro').addEventListener('change', e => { G.settings.gyro = e.target.checked; G.ui && G.ui.enableGyro(e.target.checked); });
// phones: go fullscreen and lock landscape on the first tap that starts the game (silently ignored where unsupported)
function phoneFullscreen() { if (!G.isTouch) return; try { const el = document.documentElement; const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen(); if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => {}); } catch (e) {} }
$('bstart').addEventListener('click', phoneFullscreen);
bus.on('lock', l => { if (!l && !G.isTouch && (G.state === 'play' || G.state === 'cutscene')) pause(true); });
bus.on('key', k => { if (k === 'KeyP') pause(G.state !== 'paused'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
bus.on('missionFailed', reason => { $('failtxt').textContent = reason; setTimeout(() => { $('fail').hidden = false; document.exitPointerLock && document.exitPointerLock(); }, 1400); G.ui.fadeTo(.7, 1.2); G.state = 'end'; });
bus.on('missionComplete', () => {
  G.state = 'end'; $('hud').hidden = true; document.exitPointerLock && document.exitPointerLock();
  const s = G.stats; const secs = Math.round((s.end - s.start) / 1000);
  $('st-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; $('st-acc').textContent = s.shots ? Math.round(s.hits / s.shots * 100) + '%' : '—';
  $('st-kills').textContent = s.kills; $('st-civ').textContent = s.civHits; G.audio.setIntensity(.1); G.audio.distantBattle(0);
  // memorial for Arnon Zmora first, then the mission stats
  const mem = $('memorial'); const im = $('memimg'); if (!im.getAttribute('src')) im.src = 'assets/arnon.jpg'; mem.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => mem.classList.add('on')));
  $('bmem').onclick = () => { mem.hidden = true; mem.classList.remove('on'); $('end').hidden = false; };
});
$('bstart').disabled = true;

// far-off smoke columns (see step)
const FAR_SMOKE = [[200, 0, -300, 1.6], [-20, 0, 330, 1.3], [380, 0, 150, 1.1]].map(([x, y, z, rate]) => ({ p: new THREE.Vector3(x, y, z), rate, acc: 0 }));

// ---------- loop ----------
let fpsN = 0, fpsT = performance.now(), autoQ = false;
// dynamic resolution (resolution.js): keeps ~40 fps by scaling the internal resolution, only while that actually helps
function frame() {
  requestAnimationFrame(frame);
  const rawDt = G.clock.getDelta(); const dt = Math.min(.05, rawDt);
  if (G.debug.hold) return;
  if ((G.state === 'play' || G.state === 'cutscene') && dyn.update(rawDt * 1000)) resize();
  step(dt);
  if (vmPass) vmPass.enabled = G.state === 'play' || G.state === 'cutscene';
  composer.render();
  const active = G.state === 'play' || G.state === 'cutscene';
  fpsN++; const now = performance.now(); if (now - fpsT > 1000) { const f = fpsN * 1000 / (now - fpsT); G.fps = Math.round(f); $('fps').textContent = G.fps + ' fps'; fpsN = 0; fpsT = now; if (!autoQ && active && G.time > 8 && !G.debug.noAuto) { autoQ = true; if (f < 26 && G.quality > 0) applyQuality(G.quality - 1); } }
}
function step(dt) {
  const active = G.state === 'play' || G.state === 'cutscene';
  if (active || G.state === 'menu' || G.state === 'briefing' || G.state === 'end') {
    G.time += dt; G.dt = dt;
    if (active) { tickTimers(); G.mission.update(dt); }
    if (G.state === 'menu' || G.state === 'briefing') { G.player.yaw = G.menuYaw + Math.sin(G.time * .06) * .1; }
    G.player.update(active ? dt : 0);
    for (let i = G.actors.length - 1; i >= 0; i--) G.actors[i] && G.actors[i].update(dt);
    // people beyond ~35 m drop out of the shadow pass (their shadow is a few pixels; each costs a call per material)
    if ((G._shT = (G._shT || 0) - dt) <= 0) { G._shT = .5; const cp = camera.position; for (const a of G.actors) { if (!a.root) continue; const far = a.root.position.distanceToSquared(cp) > 35 * 35; if (a._farSh !== far) { a._farSh = far; a.root.traverse(o => { if (o.isMesh) o.castShadow = !far; }); if (a.rifle) a.rifle.traverse(o => { if (o.isMesh) o.castShadow = !far; }); } } }
    G.weapon.update(dt); G.weapon.root.visible = active && G.weapon.root.visible;
    G.fx.update(dt); updateDoors(dt);
    G.audio.updateListener(camera); G.audio.update(dt); G.ui.update(dt); G.guide.update(dt);
    if (G.sea) G.sea.material.uniforms.uT.value = G.time;
    if (G.birds) G.birds.update(dt);
    // smoke columns on the horizon: strikes elsewhere in the Strip, leaning east on the sea breeze
    for (const c of FAR_SMOKE) { c.acc += dt * c.rate; while (c.acc >= 1) { c.acc--; const j = new THREE.Vector3((Math.random() - .5) * 6, Math.random() * 3, (Math.random() - .5) * 6);
      G.fx.smoke.emit(c.p.clone().add(j), new THREE.Vector3(.9 + Math.random() * .6, 3.2 + Math.random() * 1.5, (Math.random() - .5) * .6), 26 + Math.random() * 14, 10 + Math.random() * 6, 38 + Math.random() * 20, [.12, .11, .1, .82], [.42, .4, .38, 0], .03, .02); } }
    WIND.t.value = G.time;
    // interior light: less sky fill inside rooms so windows read bright and rooms keep contrast
    const ins = G.inside ? 1 : 0; G.inAmt = (G.inAmt || 0) + (ins - (G.inAmt || 0)) * Math.min(1, dt * 2.5);
    // (indoor darkening comes from the baked ambient visibility and the eye adaptation, not from dimming the sky light)
    // sun shadow follows the camera (snapped to texels to avoid swimming)
    const cp = camera.position; const ts = (sc.right - sc.left) / sun.shadow.mapSize.x;
    sun.target.position.set(Math.round(cp.x / ts) * ts, 0, Math.round(cp.z / ts) * ts); sun.position.copy(sun.target.position).addScaledVector(G.sunDir, 150);
    grade.uniforms.uT.value = G.time % 10;
    if (G.flareHolder) { G.flareHolder.position.copy(camera.position).addScaledVector(G.sunDir, 2500); for (const c of G.flareHolder.children) c.visible = !G.inside; }
    if (G.clouds) G.clouds.position.copy(camera.position);
    if (G.inAmt > .5 && Math.random() < dt * 25) { const c = camera.position; G.fx.glow.emit(new THREE.Vector3(c.x + (Math.random() - .5) * 5, c.y + (Math.random() - .5) * 2, c.z + (Math.random() - .5) * 5), new THREE.Vector3((Math.random() - .5) * .05, .02, (Math.random() - .5) * .05), 6, .012, .012, [1, .95, .85, .7], [1, .95, .85, 0]); }
    if (B.shafts) for (const sh of B.shafts) sh.visible = G.inAmt > .05 || camera.position.distanceTo(sh.position) < 14; grade.uniforms.uHurt.value = G.player.alive ? clamp((60 - G.player.health) / 60, 0, 1) * .8 : 1;
    G.fx.setScale(innerHeight * internalPR() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  }
}
if (location.hash === '#dev') { window.G = G; G.debug.advance = (sec, fps = 20) => { for (let i = 0; i < sec * fps; i++) step(1 / fps); vmPass.enabled = G.state === 'play' || G.state === 'cutscene'; autoExp.snap = true; composer.render(); autoExp.snap = false; }; G.debug.sim = (sec, fps = 20) => { for (let i = 0; i < sec * fps; i++) step(1 / fps); }; G.debug.render = () => { vmPass.enabled = G.state === 'play' || G.state === 'cutscene'; autoExp.snap = true; composer.render(); autoExp.snap = false; }; G.debug.GIU = GIU; G.debug.giAt = (x, y, z, n) => +giAt(new THREE.Vector3(x, y, z), n ? new THREE.Vector3(...n) : null).toFixed(3); G.debug.exposure = () => autoExp.read(renderer); G.debug.tone = (k, e) => { renderer.toneMapping = THREE[k]; if (e !== undefined) renderer.toneMappingExposure = e; }; G.debug.startMission = startMission; G.debug.quality = applyQuality; G.debug.briefing = startBriefing; }

boot().then(() => { $('bstart').disabled = false; }).catch(e => { console.error(e); err('שגיאה בטעינת המשחק: ' + e.message); });
