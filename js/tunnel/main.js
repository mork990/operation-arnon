// "The Shaft" – mission 4: bootstrap, render pipeline (main view + the "Zik" UAV feed), loop. Adapted from mission 2's main.js.
import * as THREE from 'three';
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
import { G, installFog, tickTimers, bus, clamp, V3, detailCullTick } from '../core.js';
import { loadAll, A } from '../assets.js';
import { buildMaterials } from '../materials.js';
import { B } from '../building.js';
import { Audio } from '../audio.js';
import { FX } from '../fx.js';
import { Player, Input, initInput, installQueries } from '../player.js';
import { Weapon } from '../weapon.js';
import { UI } from '../ui.js';
import { Guide } from '../guide.js';
import { VO, SPEAKERS } from '../vo.js';
import { buildTunnelWorld, updateWorld, setThermal, hT, TL } from './world.js';
import { Tablet } from './tablet.js';
import { TunnelMission, TSTAGES, TSPEAKERS } from './mission.js';
import { Command } from './command.js';
import { Feeds } from './shaft.js';
import { speak, stopVoice } from '../voice.js';
import { bakeVolume, bakeSunShadow, occluderFrom, GIU } from '../gi.js';
import { AutoExposure, EXPOSURE_GLSL, GRADE, GRADE_GLSL, GRADE_U, TONE_GLSL, TONE_U, installToneMapping } from '../exposure.js';
import { WIND } from '../materials.js';
import { SunFx, SUN_GLSL, HeatHaze } from '../sunfx.js';
import { UpscalePass, DynRes } from '../resolution.js';

const $ = id => document.getElementById(id);
// build number in the menu and the pause card: tells a play-tester which version (and not a cached older script) is running
const BUILD = 25; $('build').textContent = '· גרסה ' + BUILD;
const canvas = $('c');
function err(msg) { const e = $('err'); e.hidden = false; e.textContent = msg; }
addEventListener('error', e => { if (e.message) err('שגיאה בטעינת המשחק: ' + e.message); });
addEventListener('unhandledrejection', e => { err('שגיאה בטעינת המשחק: ' + (e.reason && e.reason.message || e.reason)); });

// no recorded voice here: radio lines are subtitles (mission.js adds them to VO as they are spoken)
// spoken lines come from voice.js (see say in mission.js); G.settings.voice is the menu's narration switch
for (const k of Object.keys(VO)) delete VO[k]; Object.assign(SPEAKERS, TSPEAKERS);
try { const v = localStorage.getItem('tunnel-voice'); if (v !== null) G.settings.voice = v === '1'; } catch (e) {}
// no target building here
Object.assign(B, { x0: 1e9, x1: 1e9 + 1, z0: 1e9, z1: 1e9 + 1, lights: [], blockers: [] });
G.groundFn = hT;
G.missionClock = 5 * 3600 + 8 * 60;
// dawn: the sun a few degrees over the eastern horizon behind the force (azimuth ~78 deg), so the commander looks west
// at houses lit low and pink with long shadows, and the thermal feed still has the night's contrast
{ const el = THREE.MathUtils.degToRad(7), az = THREE.MathUtils.degToRad(78); G.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize(); }
G.wind = V3(-1.1, 0, .3); // a light land breeze at dawn: smoke drifts west, over the town

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
// a lost GPU context (memory or a driver watchdog on phones) otherwise just freezes the frame: say so and offer a reload
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); err('הגרפיקה של הדפדפן קרסה (בדרך כלל חוסר זיכרון). סגור לשוניות אחרות ורענן את הדף, או בחר איכות נמוכה.'); });
// phones: bigger images are resampled at upload (three.js does it against capabilities.maxTextureSize; the shadow map read
// its limit at construction). A 1024 px texture with mips is 5.3 MB, and on an iPhone it counts against the tab's ceiling
if (G.isTouch) renderer.capabilities.maxTextureSize = Math.min(renderer.capabilities.maxTextureSize, G.lowMem ? 512 : 1024);
installToneMapping(renderer); renderer.toneMappingExposure = 1.08; // gain into the tone curve (exposure.js TONE): holds the build-23 mid-tones under the new shoulder
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
G.renderer = renderer;
// dawn ground mist: dense and shallow (cold air pooled over the fields), warm toward the rising sun, blue-grey away
// from it, so the town 200-400 m west fades into a cool haze while the houses near the force keep their colour
installFog({ ground: .0016, base: .00026, H: 14, toward: [1.45, 1.08, .84], away: [.74, .82, .98], sunPow: 6 });
const scene = new THREE.Scene(); G.scene = scene;
scene.fog = new THREE.FogExp2('#8e98a4', .0008);
const camera = new THREE.PerspectiveCamera(72, 1, .05, 7000); G.camera = camera; scene.add(camera);
G.clock = new THREE.Clock();

const sun = new THREE.DirectionalLight('#ffb27e', 2.6); sun.castShadow = true; sun.shadow.bias = -.0003; sun.shadow.normalBias = .04;
// phones: a tighter live shadow box (fewer casters, a smaller map for the same texel size); the baked shadow of the
// incident area takes over from ~40 m instead of ~54 m
const SHX = G.isTouch ? 44 : 60, SUN_NEAR = G.isTouch ? 40 : 54;
const sc = sun.shadow.camera; sc.left = -SHX; sc.right = SHX; sc.top = SHX; sc.bottom = -SHX; sc.near = 1; sc.far = 500;
scene.add(sun, sun.target); G.sun = sun;
// the sun's glare, shafts and ghosts are a post pass (sunfx.js)
const hemi = new THREE.HemisphereLight('#9fb0c8', '#6a5a4a', .9); scene.add(hemi);
G.audio = new Audio();

// ---------- post ----------
// the scene's depth stays readable (GTAO reconstructs normals from it instead of re-rendering the whole scene)
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
const composer = new EffectComposer(renderer, rt); G.composer = composer;
const mainPass = new RenderPass(scene, camera); composer.addPass(mainPass);
let gtao = null, vmPass = null, fxaa = null, smaa = null, heat = null;
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .3, .5, .97);
const autoExp = G.autoExp = new AutoExposure();
const sunFx = G.sunFx = new SunFx({ strength: .8, color: '#ffb48a' });
const grade = G.grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uHurt: { value: 0 }, uGas: { value: 0 }, uTx: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uSharp: { value: .35 }, uBino: { value: 0 }, uAspect: { value: 1.7 }, tExp: { value: null }, uKey: { value: 0 }, uAlpha: { value: 0 }, uEvLo: { value: 0 }, uEvHi: { value: 0 }, uEvBias: { value: 0 }, tSun: { value: null }, uSunUv: { value: new THREE.Vector2() }, uSunI: { value: 0 }, uSunCol: { value: new THREE.Vector3() }, uSunAsp: { value: 1 }, uOut: { value: 0 } },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  // (sharpening works on x/(1+x): in linear HDR the unsharp mask rang around the sun disc)
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uT,uHurt,uSharp,uGas,uBino,uAspect,uOut;uniform vec2 uTx;varying vec2 vUv;
  ${EXPOSURE_GLSL}
  ${SUN_GLSL}
  ${GRADE_GLSL}
  ${TONE_GLSL}
  void main(){vec2 d=vUv-.5;vec4 c=vec4(lensFetch(tDiffuse,vUv,uHurt*.004),1.);
    vec3 nb=(texture2D(tDiffuse,vUv+vec2(uTx.x,0.)).rgb+texture2D(tDiffuse,vUv-vec2(uTx.x,0.)).rgb+texture2D(tDiffuse,vUv+vec2(0.,uTx.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.,uTx.y)).rgb)*.25;
    vec3 sf=sunFx(vUv);c.rgb+=sf;nb+=sf;float ex=autoExposure();c.rgb*=ex;nb*=ex;
    vec3 cc=c.rgb/(1.+c.rgb),cn=nb/(1.+nb);cc=clamp(cc+(cc-cn)*uSharp,0.,.995);c.rgb=cc/(1.-cc);
    c.rgb=filmGrade(c.rgb,ex);float l=dot(c.rgb,vec3(.299,.587,.114));c.rgb=mix(vec3(l),c.rgb,1.-uHurt*.5);
    // tear gas in the eyes: milky, watering blur and a sting of red
    if(uGas>0.){vec3 bl=(texture2D(tDiffuse,vUv+vec2(.004,.003)).rgb+texture2D(tDiffuse,vUv-vec2(.004,.002)).rgb+texture2D(tDiffuse,vUv+vec2(-.003,.005)).rgb)/3.;c.rgb=mix(c.rgb,bl,uGas*.8);c.rgb=mix(c.rgb,vec3(.86,.84,.8),uGas*.35);c.rgb*=mix(vec3(1.),vec3(1.08,.9,.88),uGas);}
    // binoculars: two overlapping round fields, black outside
    if(uBino>0.){vec2 q=vec2(d.x*uAspect,d.y);float r1=length(q-vec2(-.19,0.)),r2=length(q-vec2(.19,0.));float m=smoothstep(.43,.41,min(r1,r2));c.rgb*=mix(1.,m,uBino);c.rgb*=mix(1.,1.-smoothstep(.2,.43,min(r1,r2))*.35,uBino);}
    c.rgb=filmFinish(c.rgb,vUv,uHurt*1.5+uGas*1.2,uT);gl_FragColor=vec4(toneOut(c.rgb),1.);if(uOut>.5)gl_FragColor=sRGBTransferOETF(gl_FragColor);}` });
// The grade ends with the game's tone curve (toneLook, exposure.js; r170's OutputPass has no CUSTOM_TONE_MAPPING branch)
// and also does the OutputPass's sRGB transfer (one full-screen pass less). The OutputPass stays in the chain for the
// drone feed (its pass works on the tone-mapped linear image between the two) and for a built-in tone curve.
grade.material.toneMapped = false;
let outPass = null;
Object.assign(grade.uniforms, autoExp.uniforms, sunFx.uniforms, GRADE_U, TONE_U); // shared objects: the adapted-exposure texture changes every frame
// dawn: blue shadows and a thin warm key; colour held back (the eye has not woken up), contrast a touch up
Object.assign(GRADE, { con: 1.08, sat: .9, warm: [1.1, .98, .84], cool: [.9, .97, 1.08], roll: .2 });
autoExp.uniforms.uEvBias.value = .8; // dawn should read as early light, not be metered up to midday
// drone feed look: EO (washed, grainy, slightly soft) or IR white-hot (people rendered as hot silhouettes, see Crowd/Tablet)
// mode 2: the robot's night-vision camera (green phosphor, heavy grain, scan lines); mode 3: a helmet camera (cheap
// wide-angle sensor: low resolution, crushed and desaturated toward grey-green, block noise, a dark rounded frame)
const uav = G.uavPass = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uIR: { value: 0 }, uMode: { value: 0 }, uRes: { value: new THREE.Vector2(1280, 720) }, uTx: { value: new THREE.Vector2(1 / 1280, 1 / 720) } },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uT,uIR,uMode;uniform vec2 uTx,uRes;varying vec2 vUv;float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  void main(){
    if(uMode>2.5){vec2 d0=vUv-.5;vec2 u=vUv-d0*dot(d0,d0)*.12;vec2 px=vec2(640.,360.);vec2 uq=(floor(u*px)+.5)/px;vec3 c=texture2D(tDiffuse,uq).rgb;
      float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,.35)*vec3(.92,1.02,.94);c=pow(clamp(c,0.,1.),vec3(1.15))*1.12;
      vec2 bq=floor(u*px/8.);c+=(h(bq+floor(uT*12.))-.5)*.035+(h(u*vec2(733.,511.)+fract(uT*13.))-.5)*.06;
      float r=length(d0*vec2(1.6,1.));c*=1.-smoothstep(.62,.86,r);gl_FragColor=vec4(clamp(c,0.,1.),1.);return;}
    if(uMode>1.5){vec2 d0=vUv-.5;vec3 c=texture2D(tDiffuse,vUv).rgb;float l=dot(c,vec3(.299,.587,.114));l=pow(clamp(l*1.1,0.,1.),.9);
      l+=(h(vUv*vec2(1234.,987.)+fract(uT*9.))-.5)*.16;l*=.9+.1*sin(vUv.y*uRes.y*1.6);l*=1.-smoothstep(.36,.62,length(d0*vec2(1.5,1.)));
      gl_FragColor=vec4(clamp(vec3(.22,1.,.38)*l+vec3(.0,.03,.0),0.,1.),1.);return;}
    vec2 u=vUv;float jit=(h(vec2(floor(u.y*240.),uT))-.5)*.0006;u.x+=jit;
    vec3 c=texture2D(tDiffuse,u).rgb*.5+(texture2D(tDiffuse,u+vec2(uTx.x,0.)).rgb+texture2D(tDiffuse,u-vec2(uTx.x,0.)).rgb+texture2D(tDiffuse,u+vec2(0.,uTx.y)).rgb+texture2D(tDiffuse,u-vec2(0.,uTx.y)).rgb)*.125;
    float l=dot(c,vec3(.299,.587,.114));
    if(uIR>.5){ // white-hot: people, engines and heat leaks bright; at dawn the ground has cooled, so the rest stays dark
      float t=l>.8?mix(.72,1.,smoothstep(.8,1.,l)):pow(clamp(l*1.3,0.,1.),1.6)*.55;c=vec3(t*.94+.03);}
    else{c=mix(vec3(l),c,.62);c=(c-.5)*1.12+.5;c*=vec3(.98,1.,1.02);}
    float g=(h(u*vec2(1234.,987.)+fract(uT*7.))-.5)*(uIR>.5?.05:.04);c+=g;
    vec2 d=vUv-.5;c*=1.-dot(d,d)*.7;
    gl_FragColor=vec4(clamp(c,0.,1.),1.);}` });
uav.enabled = false;

// ---------- quality ----------
function basePR(q) { const dpr = devicePixelRatio || 1; return G.isTouch ? [Math.min(dpr, 1.1), Math.min(dpr, G.lowMem ? 1.4 : 1.7), Math.min(dpr, G.lowMem ? 1.8 : 2.2)][q] : [.75, Math.min(dpr, 1.3), Math.min(dpr, 2)][q]; }
// the canvas keeps the display's resolution; the scene renders at basePR x dynamic scale and UpscalePass resamples it
// Phones: the canvas follows the internal resolution and the browser's compositor stretches it to the screen for free.
// It does that on every phone anyway (the canvas is under the screen's density), and an upscale pass at full canvas
// resolution, switched on by the first step down, ate most of what that step saved: the dynamic-resolution probe then
// judged the drop useless and gave the pixels back.
function displayPR() { return G.isTouch ? internalPR() : Math.max(basePR(G.quality), Math.min(devicePixelRatio || 1, 2)); }
function internalPR() { return basePR(G.quality) * dyn.scale; }
const dyn = new DynRes(G.isTouch ? 'tunnel-dyn' : null); const upscale = new UpscalePass();
function applyQuality(q) {
  G.quality = q;
  renderer.setPixelRatio(displayPR());
  renderer.shadowMap.enabled = q > 0; sun.castShadow = q > 0;
  // low quality has no live shadow map: the baked town shadow covers everything
  GIU.uSunNear.value = q > 0 ? SUN_NEAR : 0;
  const ms = G.isTouch ? (q === 2 ? 2048 : G.lowMem ? 1024 : 1536) : q === 2 ? 4096 : 2048; sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  precompile();
  bloom.enabled = q > 0; if (gtao) gtao.enabled = q === 2 || (q === 1 && !G.isTouch); if (heat) heat.enabled = !!(gtao && gtao.enabled); if (fxaa) fxaa.enabled = q === 0; if (smaa) smaa.enabled = q === 1; grade.uniforms.uSharp.value = [.2, .3, .36][q];
  const ns = q === 2 ? 4 : 0; for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== ns) { t.samples = ns; t.dispose(); }
  document.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.q === q)));
  try { localStorage.setItem('tunnel-q', q); } catch (e) {}
  resize();
}
function precompile() {
  try { const seen = new Set(); scene.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) { const t = m[k]; if (t && !seen.has(t)) { seen.add(t); renderer.initTexture(t); } } }); } catch (e) {}
  try { renderer.setRenderTarget(composer.renderTarget1); renderer.compile(scene, camera); if (G.weapon) renderer.compile(G.weapon.scene, G.weapon.cam); renderer.setRenderTarget(null); } catch (e) { console.warn(e); }
}
G.precompile = () => precompile();
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setPixelRatio(displayPR()); renderer.setSize(w, h, false); composer.setPixelRatio(internalPR()); composer.setSize(w, h);
  upscale.enabled = internalPR() < displayPR() * .98; upscale.uniforms.uSharp.value = G.quality === 2 ? .6 : .45;
  camera.aspect = w / h; G.fovBase0 = w < h ? 66 : (w / h > 1.9 ? 50 : 54); G.player && (G.player.fovBase = G.fovBase0); camera.updateProjectionMatrix();
  if (G.drone) { G.drone.cam.aspect = w / h; G.drone.cam.updateProjectionMatrix(); }
  if (G.feeds) for (const c of [G.feeds.bodyCam, G.feeds.robotCam, G.feeds.under.cam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
  uav.uniforms.uRes.value.set(w, h);
  if (G.weapon) G.weapon.resize(w / h);
  { const pr = internalPR(); if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); grade.uniforms.uTx.value.set(1 / (w * pr), 1 / (h * pr)); uav.uniforms.uTx.value.set(1 / (w * pr), 1 / (h * pr)); grade.uniforms.uAspect.value = w / h; if (smaa) smaa.setSize(w * pr, h * pr); }
  if (G.fx) G.fx.setScale(h * internalPR() / (2 * Math.tan(THREE.MathUtils.degToRad(activeCam().fov / 2))));
}
addEventListener('resize', resize);
function activeCam() { if (G.drone && G.drone.active) return G.drone.cam; const fv = feedView(); return fv ? fv.cam : camera; }

// ---------- boot ----------
async function boot() {
  $('loadtxt').textContent = 'טוען דמויות ורכבים…';
  // the team, a few residents, the armed men; no voice track (a tiny file stands in for it and is dropped)
  await loadAll(p => { $('loadbar').style.transform = `scaleX(${p * .9})`; $('loadpct').textContent = Math.round(p * 90) + '%'; }, {
    chars: ['team', 'team2', 'team3', 'fighter', 'civM1', 'civM2', 'civF1'],
    models: ['m4', 'ak'], anims: ['anims_fence.json'], vo: 'snd/vehicle_engine_godot_truck_town.mp3', banks: [],
    sounds: ['radio_static_doty21_cc0', 'vehicle_engine_godot_truck_town'],
  });
  // the recorded-voice bank never plays here (audio.js would play whatever buffer stands in for it)
  A.snd.vo = null; if (A.late) A.late.then(() => { A.snd.vo = null; });
  $('loadtxt').textContent = 'בונה את השכונה…'; await new Promise(r => setTimeout(r, 30));
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(A.hdr).texture; scene.environmentIntensity = .7;
  A.hdr.colorSpace = THREE.LinearSRGBColorSpace; scene.background = null;
  // photographic sky, dimmed and cooled for dawn, with the bright side over the eastern horizon and a pink-gold band low toward the sun
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
    uniforms: { map: { value: A.hdr }, uInt: { value: .62 }, uRot: { value: -.9 }, uSun: { value: G.sunDir }, uHaze: { value: new THREE.Color('#a9a9b0') } }, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `#include <common>
uniform sampler2D map; uniform float uInt, uRot; uniform vec3 uSun, uHaze; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float a = atan(d.z, d.x) + uRot; vec2 uv = vec2(a * RECIPROCAL_PI2 + .5, asin(clamp(d.y, -1., 1.)) * RECIPROCAL_PI + .5);
  vec3 c = texture2D(map, uv).rgb * uInt; c *= vec3(.86, .92, 1.08);
  c = mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, .85);
  // the sun low in smoky air: a disc of its real size (0.53 deg), dimmed and warmed, inside a wide gold aureole; the old
  // 3-degree disc at 5x blew out into a white blob with a ring
  float s = max(dot(d, uSun), 0.), t2 = 2. * (1. - s); c += vec3(1.25, .92, .6) * (pow(s, 2500.) * .4 + pow(s, 60.) * .18 + pow(s, 6.) * .08) + vec3(1.3, 1., .72) * (1. - smoothstep(2.2e-5, 5e-5, t2)) * 16.;
  float hz = 1. - smoothstep(0., .22, d.y); c = mix(c, uHaze * (.75 + pow(s, 3.) * 1.6 * vec3(1.25, .95, .7)), hz * .85);
  gl_FragColor = vec4(c, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}` }));
  skyDome.renderOrder = -1000; skyDome.frustumCulled = false; skyDome.onBeforeRender = (r, s, cam) => { skyDome.position.copy(cam.position); skyDome.updateMatrixWorld(); };
  scene.add(skyDome); G.skyDome = skyDome;
  buildMaterials();
  buildTunnelWorld();
  const geos = G.colliders.map(g => { let q = g.index ? g.toNonIndexed() : g.clone(); const p = new THREE.BufferGeometry(); p.setAttribute('position', q.attributes.position); return p; });
  const merged = mergeGeometries(geos); merged.boundsTree = new MeshBVH(merged, { maxLeafTris: 8 });
  const occ = occluderFrom(G.colliders);
  G.bvhMesh = new THREE.Mesh(merged); G.colliders.length = 0;
  installQueries();
  // ambient light visibility over the edge of the neighbourhood (candidate houses, the fields, the force), see gi.js
  $('loadtxt').textContent = 'מחשב תאורה…'; await new Promise(r => setTimeout(r, 30));
  const giT0 = performance.now();
  await bakeVolume(renderer, occ, { slot: 'a', min: new THREE.Vector3(-250, 0, -140), max: new THREE.Vector3(150, 16, 170), cell: 2, dirs: G.isTouch ? 40 : 64, res: G.lowMem ? 1024 : G.isTouch ? 1536 : 2048, reach: 900, bounce: .45, strength: .8 });
  bakeSunShadow(renderer, occ, { min: new THREE.Vector3(-480, 0, -380), max: new THREE.Vector3(260, 30, 380), sunDir: G.sunDir, res: G.lowMem ? 1024 : 2048, near: 54 });
  occ.dispose(); G.giBakeMs = Math.round(performance.now() - giT0);
  G.fx = new FX(); G.player = new Player(); G.weapon = new Weapon(); G.ui = new UI(); G.guide = new Guide(TSTAGES);
  // the commander carries no weapon here: a free cursor for the buttons, drag to look, the rifle never drawn
  G.freeCursor = true; document.body.classList.add('cmdmode');
  G.tablet = new Tablet(); G.mission = new TunnelMission(); G.command = new Command(); G.feeds = new Feeds();
  // GTAO from the main pass's depth: its own normal pre-pass re-rendered every mesh (half of all draw calls). The
  // composer's buffers swap an odd number of times per frame, so follow whichever one holds this frame's scene.
  class GTAOFromDepth extends GTAOPass { render(r, w, rb, dt, m) { const d = rb.depthTexture; G.sceneDepth = d; if (d && this.gtaoMaterial.uniforms.tDepth.value !== d) { this.gtaoMaterial.uniforms.tDepth.value = d; this.pdMaterial.uniforms.tDepth.value = d; } super.render(r, w, rb, dt, m); } }
  gtao = new GTAOFromDepth(scene, camera, 1, 1); gtao.setGBuffer(composer.readBuffer.depthTexture); // (after construction: r170's setGBuffer trips over a missing normal target otherwise)
  gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = .8; G.gtao = gtao;
  gtao.updateGtaoMaterial({ radius: .6, distanceExponent: 1.6, thickness: 1.2, scale: 1, samples: G.isTouch ? 8 : 12, distanceFallOff: 1 }); composer.addPass(gtao); // (phones only get GTAO on high; 8 taps there)
  composer.addPass(autoExp); // meter the world before the weapon is drawn over it
  composer.addPass(sunFx);
  heat = new HeatHaze(0.55); composer.addPass(heat); // needs the scene depth GTAO passes on: on with GTAO only
  class VMPass extends RenderPass { render(r, w, rb, dt, m) { r.setRenderTarget(this.renderToScreen ? null : rb); r.clearDepth(); super.render(r, w, rb, dt, m); } }
  vmPass = new VMPass(G.weapon.scene, G.weapon.cam); vmPass.clear = false; vmPass.clearDepth = false; composer.addPass(vmPass);
  composer.addPass(bloom); composer.addPass(grade); composer.addPass(uav); outPass = new OutputPass(); composer.addPass(outPass); fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); smaa = new SMAAPass(innerWidth, innerHeight); composer.addPass(smaa); composer.addPass(upscale);
  initInput(canvas);
  // phones: the commander stands at his vehicle, so there is no walk stick; a drag anywhere turns the view (a layer
  // over ui.js's look zone, which would start the stick on the left half of the screen)
  { const cl = $('cmdlook'); let id = null, lx = 0, ly = 0; const look = (dx, dy) => { const k = 1.55 * (1 + Math.min(1.6, Math.hypot(dx, dy) * .045)); Input.mdx += dx * k; Input.mdy += dy * k; };
    cl.addEventListener('touchstart', e => { const t = e.changedTouches[0]; if (id === null) { id = t.identifier; lx = t.clientX; ly = t.clientY; } e.preventDefault(); }, { passive: false });
    cl.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === id) { look(t.clientX - lx, t.clientY - ly); lx = t.clientX; ly = t.clientY; } e.preventDefault(); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === id) id = null; }; cl.addEventListener('touchend', end); cl.addEventListener('touchcancel', end); }
  let q = G.isTouch ? 1 : 2; try { const s = localStorage.getItem('tunnel-q'); if (s !== null) q = +s; } catch (e) {}
  applyQuality(q);
  // title backdrop: from the command vehicle's rise, looking west over the grove at the first houses
  G.player.setPos(V3(TL.cmd.x, hT(TL.cmd.x, TL.cmd.z), TL.cmd.z), Math.PI / 2 + .05); G.player.pitch = -.04;
  G.mission.backdrop();
  $('loading').hidden = true; $('menu').hidden = false; G.state = 'menu';
  requestAnimationFrame(frame);
}

// ---------- menus ----------
function startBriefing() {
  G.audio.resume(); startSound();
  $('menu').hidden = true; $('briefing').hidden = false; G.state = 'briefing';
  G.mission.briefing();
}
function startMission() {
  G.audio.clearVoice(); $('briefing').hidden = true; $('hud').hidden = false; $('menu').hidden = true;
  G.stats = { shots: 0, hits: 0, kills: 0, civHits: 0, start: performance.now(), end: 0, damage: 0 };
  G.mission.start(); precompile();
}
function lock() {}
G.lock = lock;
// the town's beds go quiet: a dawn neighbourhood, a light wind and the UAV's buzz overhead
function startSound() { const A = G.audio; if (A.beds) return; A.startAmbience(); A.soundscape = () => {}; for (const k of ['market', 'trade', 'traffic', 'sea']) A.bedGain(k, 0, .1); A.bedGain('wind', .22, 1); A.startMusic(); A.setIntensity(.12); }
function pause(on) {
  if (on && (G.state === 'play' || G.state === 'cutscene')) { G.prevState = G.state; G.state = 'paused'; $('pause').hidden = false; G.audio.ctx.suspend(); $('diag').textContent = `גרסה ${BUILD} · ${G.fps || '—'} fps · איכות ${['נמוכה', 'בינונית', 'גבוהה'][G.quality]} · רזולוציה ${Math.round((G.isTouch ? dyn.scale : internalPR() / displayPR()) * 100)}%`; }
  else if (!on && G.state === 'paused') { G.state = G.prevState; $('pause').hidden = true; G.audio.resume(); lock(); G.clock.getDelta(); }
}
$('bstart').addEventListener('click', startBriefing);
$('bgo').addEventListener('click', () => startMission());
$('bskip').addEventListener('click', () => startMission());
$('bresume').addEventListener('click', () => pause(false));
$('brestart').addEventListener('click', () => { stopVoice(); location.hash = '#retry'; location.reload(); });
$('bquit').addEventListener('click', () => { location.hash = ''; location.reload(); });
$('bretry').addEventListener('click', () => { stopVoice(); location.hash = '#retry'; location.reload(); });
$('bagain').addEventListener('click', () => { location.hash = ''; location.reload(); });
$('bhist').addEventListener('click', () => { $('hist').hidden = false; });
$('bhistclose').addEventListener('click', () => { $('hist').hidden = true; });
$('bpause').addEventListener('click', () => pause(true));
document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); applyQuality(+b.dataset.q); }));
$('sens').addEventListener('input', e => { G.settings.sens = +e.target.value; });
$('subs').addEventListener('change', e => { G.settings.subtitles = e.target.checked; });
$('voice').checked = G.settings.voice; $('voice').addEventListener('change', e => { G.settings.voice = e.target.checked; try { localStorage.setItem('tunnel-voice', e.target.checked ? '1' : '0'); } catch (er) {} if (!e.target.checked) stopVoice(); else speak('קריינות פעילה.', { who: 'radio' }); });
function phoneFullscreen() { if (!G.isTouch) return; try { const el = document.documentElement; const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen(); if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => {}); } catch (e) {} }
$('bstart').addEventListener('click', phoneFullscreen);
bus.on('lock', l => { if (!l && !G.isTouch && !G.freeCursor && (G.state === 'play' || G.state === 'cutscene') && !(G.tablet && G.tablet.open) && !G.noPauseOnUnlock) pause(true); });
bus.on('key', k => { if (k === 'KeyP') pause(G.state !== 'paused');
  // with a free cursor (commanding) Esc pauses directly, unless it is closing the tablet or cancelling an aim
  if (k === 'Escape' && !G.isTouch) { if (G.state === 'paused') pause(false); else if (G.freeCursor && G.state === 'play' && !(G.tablet && G.tablet.open) && !(G.command && (G.command.aim || G.command.introOn))) pause(true); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
bus.on('missionFailed', reason => { stopVoice(); G.tablet && G.tablet.close(); $('failtxt').innerHTML = reason; setTimeout(() => { $('fail').hidden = false; document.exitPointerLock && document.exitPointerLock(); }, 1400); G.ui.fadeTo(.75, 1.2); G.state = 'end'; });
bus.on('missionComplete', res => {
  G.tablet && G.tablet.close(); G.state = 'end'; $('hud').hidden = true;
  G.mission.fillEnd(res); $('end').hidden = false;
});
$('bstart').disabled = true;
// browsers keep audio suspended until a gesture (matters after 'try again', which starts the mission by itself)
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => { try { G.audio.resume(); } catch (e) {} }, { passive: true });

// ---------- loop ----------
let fpsN = 0, fpsT = performance.now(), autoQ = false;
// dynamic resolution (resolution.js): keeps ~40 fps by scaling the internal resolution, only while that actually helps
// the tablet's feeds: the UAV (drone tab), the robot's camera and the helmet cameras (feedView); one composer for all
function feedView() { const t = G.tablet; return t && t.open && (t.tab === 'robot' || t.tab === 'body') && G.feeds ? G.feeds.view(t.tab) : null; }
function render() {
  const d = G.drone && G.drone.active; const fv = !d && feedView();
  mainPass.camera = d ? G.drone.cam : fv ? fv.cam : camera; mainPass.scene = fv ? fv.scene : scene; if (gtao) { gtao.camera = mainPass.camera; gtao.scene = mainPass.scene; } sunFx.camera = mainPass.camera; sunFx.enabled = !d && !fv; if (heat) heat.enabled = !d && !fv && !!(gtao && gtao.enabled);
  const gOn = gtao ? gtao.enabled : false; if (gtao && fv && fv.under) gtao.enabled = false;
  uav.enabled = !!d || !!fv; uav.uniforms.uMode.value = fv ? fv.mode : 0; uav.uniforms.uIR.value = d && G.drone.ir ? 1 : 0; uav.uniforms.uT.value = G.time;
  if (fv && fv.self) G.feeds.hideSelf(true);
  // underground the meter would push a lamp-lit shaft up to midday; hold it a little under the dawn bias
  if (fv && fv.under) autoExp.uniforms.uEvBias.value = -1.4;
  if (vmPass) vmPass.enabled = !d && !fv && (G.state === 'play' || G.state === 'cutscene');
  if (d) setHot(!!G.drone.ir);
  if (outPass) { outPass.enabled = uav.enabled || renderer.toneMapping !== THREE.CustomToneMapping || !!G.debug.noMerge; grade.uniforms.uOut.value = outPass.enabled ? 0 : 1; }
  composer.render();
  if (d) setHot(false); if (fv && fv.self) G.feeds.hideSelf(false); if (gtao) gtao.enabled = gOn; autoExp.uniforms.uEvBias.value = .8;
}
// thermal: people and engines drawn as plain bright surfaces, heat patches (IR-only meshes) switched on, the smoke
// hidden (thermal sees through it); everything is put back after the feed's frame
const hotCache = new Map(), warmMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(.62, .62, .62) }); let hotOn = false;
function hotMat(m) { let h = hotCache.get(m); if (h) return h; h = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), map: m.map || null, alphaTest: m.alphaTest || 0, side: m.side });
  h.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = vec3(1.6);'); }; h.customProgramCacheKey = () => 'hot'; hotCache.set(m, h); return h; }
function setHot(on) {
  if (hotOn === on) return; hotOn = on; setThermal(on); if (G.fx) G.fx.smoke.pts.visible = !on;
  const swap = (o, f) => o.traverse(c => { if (!c.isMesh) return; if (on) { c.userData.mat0 = c.material; c.material = f(c.material); } else if (c.userData.mat0) { c.material = c.userData.mat0; c.userData.mat0 = null; } });
  for (const a of G.actors) swap(a.root, m => a.alive ? hotMat(m) : warmMat);
  for (const h of G.hotObjects || []) swap(h, () => warmMat);
}
function frame() {
  requestAnimationFrame(frame);
  const rawDt = G.clock.getDelta(); const dt = Math.min(.05, rawDt);
  if (G.debug.hold) return;
  if ((G.state === 'play' || G.state === 'cutscene') && dyn.update(rawDt * 1000)) resize();
  step(dt); render();
  fpsN++; const now = performance.now(); if (now - fpsT > 1000) { const f = fpsN * 1000 / (now - fpsT); G.fps = Math.round(f); $('fps').textContent = G.fps + ' fps'; fpsN = 0; fpsT = now; if (!autoQ && G.state === 'play' && !G.debug.noAuto) autoQuality(f); }
}
// one automatic step down. Desktop: a single check once the mission runs. Phones: after 4 s of play, three seconds in a
// row under 24 fps (one hitch while shaders warm up must not cost the shadows for the whole session), and only in the
// first 40 s (later, dropping a level recompiles every shader in the middle of the incident)
let playS = 0, slowS = 0;
function autoQuality(f) {
  if (!G.isTouch) { if (G.time > 10) { autoQ = true; if (f < 26 && G.quality > 0) applyQuality(G.quality - 1); } return; }
  if (++playS <= 4) return; if (playS > 40) { autoQ = true; return; } slowS = f < 24 ? slowS + 1 : 0;
  if (slowS >= 3) { autoQ = true; if (G.quality > 0) applyQuality(G.quality - 1); }
}
function step(dt) {
  const active = G.state === 'play' || G.state === 'cutscene';
  if (!(active || G.state === 'menu' || G.state === 'briefing' || G.state === 'end')) return;
  G.time += dt; G.dt = dt;
  if (active) { tickTimers(); G.mission.update(dt); }
  else if (G.mission) G.mission.idle(dt);
  if (G.state === 'menu' || G.state === 'briefing') { G.player.yaw += Math.sin(G.time * .05) * dt * .02; }
  Input.move.set(0, 0); Input.sprint = false; G.player.update(active && !(G.tablet && G.tablet.open) ? dt : 0);
  for (let i = G.actors.length - 1; i >= 0; i--) G.actors[i] && G.actors[i].update(dt);
  // no weapon in hand: a click is an order, never a shot
  Input.fire = false; Input.ads = false; Input.adsToggle = false; G.weapon.update(dt); G.weapon.root.visible = false;
  if (G.isTouch) detailCullTick(scene, activeCam(), dt, !G.debug.noCull);
  if (G.feeds) G.feeds.update(dt); G.viewCam = activeCam();
  G.fx.update(dt); updateWorld(dt); if (G.birds) G.birds.update(dt); WIND.t.value = G.time;
  const cam = activeCam();
  G.audio.updateListener(camera); G.audio.update(dt); G.ui.update(dt); G.guide.update(dt); G.tablet.update(dt); if (active) G.command.update(dt);
  $('cross').style.opacity = 0;
  const fvc = feedView(); const cp = G.drone && G.drone.active ? G.drone.target : fvc && !fvc.under ? fvc.cam.position : camera.position; const ts = (sc.right - sc.left) / sun.shadow.mapSize.x;
  sun.target.position.set(Math.round(cp.x / ts) * ts, 0, Math.round(cp.z / ts) * ts); sun.position.copy(sun.target.position).addScaledVector(G.sunDir, 200);
  grade.uniforms.uT.value = G.time % 10;
  grade.uniforms.uHurt.value = 0; grade.uniforms.uGas.value = 0; grade.uniforms.uBino.value = 0;
  G.fx.setScale(innerHeight * internalPR() / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
  // the sun climbs and whitens a little over the half hour of the mission
  const k = G.mission ? clamp(G.mission.t / 900, 0, 1) : 0; sun.intensity = 2.6 + k * .8; sun.color.setRGB(1, .7 + k * .1, .5 + k * .12); hemi.intensity = .9 + k * .2;
}
if (location.hash.startsWith('#dev')) { window.G = G; G.THREE = THREE; G.debug.sim = (sec, fps = 20) => { for (let i = 0; i < sec * fps; i++) step(1 / fps); }; G.debug.render = () => { autoExp.snap = true; render(); autoExp.snap = false; }; G.debug.GIU = GIU; G.debug.exposure = () => autoExp.read(renderer); G.debug.startMission = startMission; G.debug.quality = applyQuality; G.debug.briefing = startBriefing; G.debug.setHot = setHot; G.debug.info = () => renderer.info.render; }
boot().then(() => { $('bstart').disabled = false; if (location.hash === '#retry') { $('bstart').click(); setTimeout(() => $('bskip').click(), 50); } }).catch(e => { console.error(e); err('שגיאה בטעינת המשחק: ' + e.message); });
