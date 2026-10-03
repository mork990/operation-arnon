// Materials and procedural textures for Nuseirat camp
import * as THREE from 'three';
import { G, rng, fbm, hash } from './core.js';
import { tex } from './assets.js';

export function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function noiseField(size, scale, oct, seed = 0) {
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const a = fbm(u * scale + seed, v * scale, oct), b = fbm((u - 1) * scale + seed, v * scale, oct), c = fbm(u * scale + seed, (v - 1) * scale, oct), d = fbm((u - 1) * scale + seed, (v - 1) * scale, oct);
    f[y * size + x] = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  return f;
}
export function normalFromHeight(hf, w, h, strength) {
  return canvasTex(w, h, (g) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; const l = hf[y * w + (x - 1 + w) % w], r = hf[y * w + (x + 1) % w], u = hf[((y - 1 + h) % h) * w + x], d = hf[((y + 1) % h) * w + x];
      const nx = (l - r) * strength, ny = (u - d) * strength, L = Math.hypot(nx, ny, 1);
      im.data[i * 4] = (nx / L * .5 + .5) * 255; im.data[i * 4 + 1] = (ny / L * .5 + .5) * 255; im.data[i * 4 + 2] = (1 / L * .5 + .5) * 255; im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { srgb: false });
}

export const MAT = {};

// tileable RGBA noise: R low, G mid, B high frequency, A vertical streaks
function noiseTex() {
  const S = 256; const r = rng(91);
  const f1 = noiseField(S, 4, 4, 1), f2 = noiseField(S, 12, 3, 7), f3 = noiseField(S, 40, 2, 13);
  // raw data texture: a canvas would premultiply RGB by the streak alpha and wreck the noise channels
  const data = new Uint8Array(S * S * 4);
  const cols = new Float32Array(S); for (let x = 0; x < S; x++) cols[x] = r();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4; const k = y * S + x;
    // streaks: column noise smoothed horizontally, fading downward within the tile
    const c = (cols[x] * .5 + cols[(x + 1) % S] * .25 + cols[(x + S - 1) % S] * .25);
    const st = Math.max(0, c - .45) * 1.8 * (.6 + .4 * f2[k]);
    data[i] = f1[k] * 255; data[i + 1] = f2[k] * 255; data[i + 2] = f3[k] * 255; data[i + 3] = Math.min(255, st * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
// world-space weathering for exterior masonry: ground grime, rain streaks, large-scale discolouration,
// bullet/shrapnel pockmarks and (for plaster) spalled patches exposing the block wall underneath.
// wall: the full treatment for building shells. Coastal Gaza gets its rain in a few winter storms and salty damp all year,
// so walls carry rising damp with a pale salt tide line, dirt washed down from every slab lip, parapet and sill, cooking
// soot over some windows, and grey cement repairs over shrapnel damage. The camp's own houses also carry a per-vertex
// aWx = (building hash, window spacing, window phase, parapet top) from world.js: each house gets its own paint and age,
// and the drips fall from where its sills really are. Anything without it (w < 2) keeps a neutral finish.
export function weatherize(mat, { plaster = false, marks = 1, streak = 1, tint = null, wall = false } = {}) {
  const U = { tN: { value: TEX.noise }, tB: { value: TEX.blockCol }, uMarks: { value: marks }, uStreak: { value: streak }, uScar: SCAR };
  // low quality reads one streak mask instead of two and a fixed streak length (three texture reads a pixel fewer)
  mat.onBeforeCompile = sh => { const hq = !(G.quality === 0);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPw;varying vec3 vWNw;' + (wall ? 'attribute vec4 aWx;varying vec4 vWx;' : ''))
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPw=(modelMatrix*vec4(transformed,1.)).xyz;vWNw=normalize(mat3(modelMatrix)*objectNormal);' + (wall ? 'vWx=aWx*32.;' : ''));
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPw;varying vec3 vWNw;uniform sampler2D tN,tB;uniform float uMarks,uStreak;uniform vec4 uScar;${wall ? 'varying vec4 vWx;' : ''}
float h21(vec2 p){p=fract(p*vec2(233.34,851.73));p+=dot(p,p+23.45);return fract(p.x*p.y);}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ vec3 wp=vWPw; vec3 wn=normalize(vWNw); float vert=1.-abs(wn.y);
  vec2 fp=vec2(dot(wp.xz,normalize(vec2(-wn.z,wn.x)+1e-4)),wp.y); // facade-plane coords
  vec4 nL=texture2D(tN,wp.xz*.011+wp.y*.004); vec4 nM=texture2D(tN,fp*.09); vec4 nH=texture2D(tN,fp*.37);
  ${wall ? `// this house's paint and age: brightness, warm or cool render, and on plaster the faded lime-wash colours of the camp
  float tg=step(2.,vWx.w), bh=vWx.x, age=mix(1.,mix(.55,1.45,fract(bh*5.31)),tg);
  vec3 tnt=vec3(mix(.8,1.17,fract(bh*3.71)))*mix(vec3(1.08,1.,.86),vec3(.93,.97,1.05),fract(bh*7.13));
  ${plaster ? `float pk=fract(bh*13.7); tnt*=pk<.13?vec3(.84,.96,.86):pk<.24?vec3(.86,.93,1.04):pk<.33?vec3(1.04,.88,.84):pk<.46?vec3(1.06,.94,.74):vec3(1.);` : ''}
  diffuseColor.rgb*=mix(vec3(1.),tnt,tg);` : ''}
  ${plaster ? `// plaster spalling: block wall shows through in patches (more near the ground and edges)
  vec4 nS=texture2D(tN,fp*.21+.37); float sp=smoothstep(.735,.765,nS.g*.8+nL.r*.35+(1.-smoothstep(0.,3.,wp.y))*.1${wall ? '-.03' : '-.05'});
  vec3 blk=texture2D(tB,fp*.833).rgb*vec3(.85,.82,.78);
  diffuseColor.rgb=mix(diffuseColor.rgb,blk,sp*vert);
  float edge=smoothstep(.71,.735,nS.g*.8+nL.r*.35${wall ? '-.03' : '-.05'})-sp; diffuseColor.rgb*=1.-edge*.35*vert;` : ''}
  ${plaster && wall ? `// shrapnel damage patched with grey cement render, never repainted: rough-edged rectangles that do not match the wall
  { vec2 pc=floor(fp/vec2(2.3,1.6)), pf=fract(fp/vec2(2.3,1.6)); float ph=h21(pc+vec2(wn.x*3.1+bh*7.3,wn.z*5.7));
    if(ph<.3){ vec2 c=vec2(h21(pc+1.7),h21(pc+4.1))*.4+.3, hs=vec2(.1,.12)+vec2(h21(pc+2.9),h21(pc+5.3))*.2; vec2 q=abs(pf-c)-hs;
      float rp=(1.-smoothstep(-.02,.01,max(q.x,q.y)+(nH.g-.5)*.12))*vert;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.3,.59,.11)))*vec3(.93,.93,.9)*mix(.6,.86,h21(pc+9.1))*mix(.9,1.05,nH.b),rp*.92); } }` : ''}
  // large-scale discolouration / sun bleaching
  diffuseColor.rgb*=mix(.84,1.1,nL.r)*mix(vec3(1.),vec3(1.04,1.,.93),nL.g);
  ${wall ? `// grime patches where dust sticks to the damp render
  diffuseColor.rgb*=1.-smoothstep(.48,.78,nL.g*.55+nM.r*.45+nH.b*.1)*.34*vert*age;
  // street dust coats the lower storeys; the top ones are sun-bleached
  diffuseColor.rgb*=mix(1.,mix(.84,1.03,smoothstep(.5,9.,wp.y)),vert);
  // dirty water: streak columns of uneven length under every slab lip (3.4 m ground floor, then 3 m storeys), the
  // parapet coping and each sill, heaviest off the sill ends where the drips gather
  // at range the streak columns and the drips off the sill ends shrink to a pixel and read as pinstripes: both widen with
  // the pixel footprint (mip bias on the column mask, a wider, fainter gaussian for the drips) and fade into a soft wash
  float sfw=fwidth(fp.x), sB=clamp(log2(sfw/.012),0.,5.);
  float cn=${hq ? 'clamp(texture2D(tN,vec2(fp.x*.13,fp.y*.01),sB).a*.5+texture2D(tN,vec2(fp.x*.047+.3,fp.y*.006),sB).a*1.4,0.,1.)' : 'clamp(texture2D(tN,vec2(fp.x*.047+.3,fp.y*.006),sB).a*1.8,0.,1.)'};
  float cl=${hq ? '.5+1.8*texture2D(tN,vec2(fp.x*.13+.5,.37)).b' : '.5+1.8*nH.r'};
  float ys=3.4+3.*max(ceil((wp.y-3.4)/3.),0.), st=exp(-(ys-wp.y)/(.7*cl))*.8*cn;
  if(tg>.5){ float dr=vWx.w-wp.y; st+=exp(-max(dr,0.)/(1.6*cl+1.2))*step(0.,dr)*1.2*cn;
    if(vWx.y>.5){ float cw=(fp.x+vWx.z)/vWx.y, dx=abs(fract(cw)-.5)*vWx.y, sl=4.4+3.*max(ceil((wp.y-4.4)/3.),0.);
      float ew=max(.11,sfw*3.), e=(dx-.64)/ew; if(sl<vWx.w-2.7) st+=(exp(-e*e)*1.2*.11/ew+(1.-smoothstep(.55,.78,dx))*.55)*(.45+.55*cn)*exp(-(sl-wp.y)/(1.1*cl));
      // soot over a window where a family cooks on a wood fire or a generator exhausts
      float sb=4.4+3.*floor((wp.y-4.4)/3.), a=wp.y-sb-1.3;
      if(sb>4. && sb<vWx.w-2.7 && a>0. && h21(vec2(floor(cw),sb)+bh*31.)<.2){ float so=(1.-smoothstep(.1,1.7,a))*(1.-smoothstep(.3+a*.3,.62+a*.45,dx+(nH.r-.5)*.25));
        diffuseColor.rgb*=1.-so*.72*vert; } } }
  st=clamp(st*uStreak*age,0.,1.)*vert; diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.5,.48,.45),st*.85);
  // rising damp from the ground: darker, cooler render up to a wavy line, with a pale salt tide mark along its top
  float dT=.45+.9*nM.g+.4*nL.r; float damp=(1.-smoothstep(dT-.3,dT+.04,wp.y))*vert;
  diffuseColor.rgb*=mix(vec3(1.),vec3(.6,.61,.58),damp*.85*min(age,1.2));
  float tide=smoothstep(dT-.06,dT+.04,wp.y)*(1.-smoothstep(dT+.04,dT+.26,wp.y))*vert*smoothstep(.3,.7,nH.g);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.3,.59,.11)))*1.12+.04,tide*.5);` : `// rain / water streaks from slabs and sills
  float st=texture2D(tN,vec2(fp.x*.23,fp.y*.018),clamp(log2(fwidth(fp.x)/.008),0.,5.)).a*uStreak; float band=fract(wp.y/3.)*(1.-smoothstep(2.4,3.,fract(wp.y/3.)*3.));
  diffuseColor.rgb*=1.-st*.33*vert*(.5+.5*band);
  // grime at the base
  float gr=(1.-smoothstep(.0,1.3+nM.g*.8,wp.y))*vert; diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.72,.64,.54),gr*.75);`}
  // splashed dust at the very foot
  float dust=(1.-smoothstep(.0,.35+nH.b*.3,wp.y))*vert; diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.62,.54,.43),dust*.6);
  // pockmarks: bullet strikes and shrapnel, clustered by low-frequency "damage" noise
  vec2 cell=floor(fp*6.); vec2 fc=fract(fp*6.)-.5; float hh=h21(cell); float dens=(.008+.16*smoothstep(.66,.9,nL.b*.5+nL.r*.6))*uMarks*vert*(1.+uScar.w*(1.-smoothstep(uScar.z*.4,uScar.z,length(wp.xz-uScar.xy)))*(1.-smoothstep(2.5,7.,wp.y)));
  if(hh<dens){ vec2 o=vec2(h21(cell+3.1),h21(cell+7.7))-.5; float r=length(fc-o*.5); float rad=.07+.13*h21(cell+1.3);
    float hole=1.-smoothstep(rad*.45,rad*.6,r); float rim=smoothstep(rad*.5,rad*.7,r)*(1.-smoothstep(rad*.8,rad*1.4,r));
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.35,hole); diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.18+.04,rim*.7); }
}`);
  };
  mat.customProgramCacheKey = () => 'wz' + (plaster ? 1 : 0) + (wall ? 'w' : '') + (G.quality === 0 ? 'l' : 'h');
  // meshes built without aWx (the target building, the fence scene) read this neutral value instead
  if (wall) mat.defaultAttributeValues = { aWx: [.5, 0, 0, 0] };
  return mat;
}
// Interior finish for the target building: flat paint (two-tone with an oil-painted dado in stairwells), ceramic skirting,
// ambient-occlusion bands at floor/ceiling, daylight falloff from the street windows, scuffs, hand smudges, water stains and hairline cracks.
// Works in world space, so every wall/ceiling/floor piece lines up without UVs.
export function interiorPaint(mat, { upper = '#e8e0d0', lower = null, dado = 1.15, skirt = '#8b8174', stain = 1, floor = false, stair = false } = {}) {
  const U = { tN: { value: TEX.noise }, uUp: { value: new THREE.Color(upper) }, uLow: { value: new THREE.Color(lower || upper) }, uDado: { value: lower ? dado : -1 }, uSkirt: { value: new THREE.Color(skirt) }, uStain: { value: stain } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPi;varying vec3 vWNi;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPi=(modelMatrix*vec4(transformed,1.)).xyz;vWNi=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPi;varying vec3 vWNi;uniform sampler2D tN;uniform vec3 uUp,uLow,uSkirt;uniform float uDado,uStain;float gGloss;
${stair ? `// height of the walking surface under a point of the target building's stair core (landings + both flights)
float stairFloor(vec3 p, vec3 n){ float L[6]; L[0]=0.;L[1]=3.4;L[2]=6.4;L[3]=9.4;L[4]=12.4;L[5]=15.4; bool A=(p.x+n.x*.05)>45.2; float best=-100.;
  for(int f=0;f<5;f++){ float l0=L[f], l1=L[f+1], m=(l0+l1)*.5, h; float t=clamp((-8.4-p.z)/3.8,0.,1.);
    if(p.z>=-8.4) h=l0; else if(p.z<=-12.2) h=m; else h = A ? l0+t*(m-l0) : m+(1.-t)*(l1-m);
    if(h<=p.y+.02 && h>best) best=h; }
  return best; }` : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ vec3 wp=vWPi; vec3 wn=normalize(vWNi); gGloss=0.;
  float hy = wp.y<3.4 ? wp.y : mod(wp.y-3.4,3.0); float top = wp.y<3.2 ? 3.2 : 2.8;
  ${stair ? `if (wp.x>43.3 && wp.x<46.8 && wp.z>-13.7 && wp.z<-6.9) { hy = wp.y - stairFloor(wp, wn); top = 9.; }` : ''}
  vec2 fp = abs(wn.y)>.5 ? wp.xz : vec2(dot(wp.xz,normalize(vec2(-wn.z,wn.x)+1e-4)),wp.y);
  vec4 nL=texture2D(tN,fp*.07); vec4 nM=texture2D(tN,fp*.23); vec4 nH=texture2D(tN,fp*.9);
  float tl = dot(diffuseColor.rgb,vec3(.333));
  ${floor ? `// floor: keep its own texture, add worn/dirty patches and dust along the edges
  diffuseColor.rgb *= mix(.78,1.05,smoothstep(.3,.75,nL.r)) * mix(.9,1.03,nM.g);` : `
  if (wn.y < -.5) { // ceiling: flat white wash, yellowed, water stains
    diffuseColor.rgb = uUp*mix(.9,1.02,nL.g)*(.92+.08*tl);
    float st=smoothstep(.62,.66,nL.b*.7+nM.r*.4)*uStain; float ring=smoothstep(.6,.62,nL.b*.7+nM.r*.4)-st;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.86,.78,.62), st*.6); diffuseColor.rgb*=1.-ring*.25;
  } else {
    // paint over plaster: the plaster texture only shows as a faint relief
    vec3 pc = hy < uDado ? uLow : uUp; if (uDado>0. && hy<uDado) gGloss=1.;
    diffuseColor.rgb = pc*(.95+.05*tl)*mix(.86,1.05,nL.r)*mix(.94,1.03,nH.b)*mix(.97,1.02,nM.g);
    if (uDado>0.) diffuseColor.rgb *= 1.-.55*(smoothstep(uDado-.012,uDado-.006,hy)-smoothstep(uDado+.006,uDado+.012,hy));
    // ceramic skirting with grout joints
    if (hy < .1) { float j=smoothstep(.0,.006,abs(fract(fp.x/.3)-.5)*.3-.144); diffuseColor.rgb = uSkirt*mix(.62,1.,1.-j)*mix(.92,1.05,nM.b); gGloss=1.; }
    diffuseColor.rgb *= mix(1., .8, (1.-smoothstep(.1,.45,hy))*.6);                        // scuffs, dust at the base
    diffuseColor.rgb *= 1.-.18*smoothstep(.6,.8,nM.g)*smoothstep(.7,.9,hy)*(1.-smoothstep(1.5,1.7,hy)); // hand smudges
    float st=smoothstep(.64,.68,nL.b*.7+nM.r*.4)*(1.-smoothstep(.3,.9,top-hy))*uStain;           // leaks from the slab
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.84,.74,.58), st*.7);
    float ck=(1.-smoothstep(.0,.01,abs(nH.g-.5)))*smoothstep(.6,.72,nL.g); diffuseColor.rgb*=1.-ck*.35; // hairline cracks
    ${stair ? `// a stairwell used by five families: the band where hands and shoulders brush the wall along the flights,
    // shoe scuffs above the skirting, paint chipped off in flakes showing the grey render, and dust in the corners
    float rub = smoothstep(.75,.95,hy)*(1.-smoothstep(1.2,1.45,hy))*(.55+.45*nM.r); diffuseColor.rgb*=1.-rub*.22;
    float scuff = (1.-smoothstep(.1,.38,hy))*smoothstep(.55,.75,nH.r); diffuseColor.rgb*=1.-scuff*.3;
    float chip = smoothstep(.7,.74,nM.b*.65+nH.g*.45)*smoothstep(.2,.5,hy); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.56,.54,.5),chip*.85);
    diffuseColor.rgb*=mix(.9,1.02,nL.g);` : ''}
  }`}
  // ambient occlusion bands where walls meet floor and ceiling
  float ao = mix(.62,1.,smoothstep(.0,.45,hy)) * mix(.7,1.,smoothstep(.0,.5,top-hy));
  if (abs(wn.y)>.5) ao = 1.;
  // daylight falls off away from the street (south) and west windows of the building
  float inB = step(33.,wp.x)*step(wp.x,47.)*step(-19.,wp.z)*step(wp.z,-7.);
  float prox = max(exp(-(-7.-wp.z)/4.5), .55*exp(-(wp.x-33.)/3.5));
  diffuseColor.rgb *= ao * mix(1., mix(.62,1.18,prox), inB);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .42, gGloss);');
  };
  mat.customProgramCacheKey = () => 'ip' + (floor ? 1 : 0) + (stair ? 's' : '');
  return mat;
}
export const TEX = {};
// a battle-scarred zone: walls within uScar.z metres of (x, y) carry (1 + w) times the bullet and shrapnel marks
export const SCAR = { value: new THREE.Vector4(0, 0, 1, 0) };

// wind: meshes carrying a per-vertex 'flex' (0 where attached, 1 at the free end) sway with a gusting sea breeze from
// the west. Only the few meshes built with that attribute use it (palm fronds, washing on the lines).
export const WIND = { t: { value: 0 } };
export function windSway(mat, amp = .12) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r); sh.uniforms.uWindT = WIND.t;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float flex; uniform float uWindT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { float ph = uWindT * 1.6 + dot(position.xz, vec2(.11, .07)); float gust = .55 + .45 * sin(uWindT * .37 + position.x * .013);
        transformed += vec3(.85, .18, .4) * (sin(ph) * .6 + sin(ph * 2.3 + 1.3) * .4) * flex * ${amp.toFixed(3)} * gust; }`);
  };
  const key = mat.customProgramCacheKey.bind(mat); mat.customProgramCacheKey = () => key() + '|wind' + amp;
  return mat;
}

// Concrete block wall (unplastered, 40x20cm blocks, 1m = 256px); returns color + normal
function blockWall() {
  const S = 512; // 2m x 2m tile
  const r = rng(11); const hf = new Float32Array(S * S); const n = noiseField(128, 8, 4, 3);
  const col = canvasTex(S, S, (g) => {
    g.fillStyle = '#8f8a82'; g.fillRect(0, 0, S, S);
    const bw = 102.4, bh = 51.2; // 40x20cm at 256px/m
    for (let row = 0; row < S / bh; row++) {
      const off = (row % 2) * bw / 2;
      for (let c = -1; c < S / bw + 1; c++) {
        const x = c * bw + off, y = row * bh; const t = .82 + r() * .22;
        g.fillStyle = `rgb(${142 * t | 0},${137 * t | 0},${128 * t | 0})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(${r() < .5 ? 40 : 230},${r() < .5 ? 40 : 225},${r() < .5 ? 36 : 215},${r() * .09})`; g.fillRect(x + r() * bw, y + r() * bh, 1 + r() * 4, 1 + r() * 4); }
        if (r() < .08) { g.fillStyle = 'rgba(60,55,50,.35)'; g.beginPath(); g.arc(x + r() * bw, y + r() * bh, 3 + r() * 6, 0, 7); g.fill(); } // chip / bullet mark
      }
    }
    // mortar tint & streaks
    g.globalCompositeOperation = 'multiply';
    for (let k = 0; k < 18; k++) { const x = r() * S; const gr = g.createLinearGradient(x, 0, x, S); gr.addColorStop(0, 'rgba(90,80,70,.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, 0, 6 + r() * 20, S * r()); }
    g.globalCompositeOperation = 'source-over';
    const im = g.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4; const nv = n[(y >> 2) * 128 + (x >> 2)];
      const k = .88 + nv * .24; im.data[i] *= k; im.data[i + 1] *= k; im.data[i + 2] *= k;
      const mx = (x + ((Math.floor(y / 51.2) % 2) * 51.2)) % 102.4, my = y % 51.2;
      const mortar = (mx < 2.5 || mx > 99.9 || my < 2.5 || my > 48.7);
      hf[y * S + x] = (mortar ? 0 : 1) * .6 + hash(x * .7, y * .7) * .15 + nv * .3;
    }
    g.putImageData(im, 0, 0);
  });
  return { col, nrm: normalFromHeight(hf, S, S, 2.2) };
}

// plaster with weathering drawn over a real plaster photo (tinted per variant)
function plasterTint(hex) { const t = tex('plaster_cream.jpg'); return t; }

// window atlas for residential facades: 4 cells, one 1.25 x 1.3 m window each (about 4 px per cm). Alpha is what is
// solid: frames, grills, shutters and curtains are opaque, glass is nearly clear and a blown-out window is a hole; the
// window material shows a room behind every clear pixel (interior mapping, see windowInterior below).
function windowAtlas() {
  const W = 2048, H = 512, n = 4, cw = W / n; const r = rng(5);
  return canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const frame = (x0, col = '#8d8981', t = 22) => { g.fillStyle = col; g.fillRect(x0, 0, cw, t); g.fillRect(x0, H - t, cw, t); g.fillRect(x0, 0, t, H); g.fillRect(x0 + cw - t, 0, t, H);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0 + t, t, cw - 2 * t, 3); g.fillRect(x0 + t, t, 3, H - 2 * t); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x0, 0, cw, 2); };
    const glass = (x, y, w, h, dirt = 1) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, `rgba(96,112,120,${.08 * dirt})`); gr.addColorStop(.7, `rgba(120,112,100,${.14 * dirt})`); gr.addColorStop(1, `rgba(140,126,106,${.34 * dirt})`); g.fillStyle = gr; g.fillRect(x, y, w, h);
      for (let k = 0; k < 18 * dirt; k++) { g.fillStyle = `rgba(150,138,118,${.05 + r() * .08})`; g.beginPath(); g.ellipse(x + r() * w, y + h * (.4 + r() * .6), 6 + r() * 30, 3 + r() * 10, 0, 0, 7); g.fill(); } };
    const grill = (x0, col = '#2c2824') => { g.fillStyle = col; for (let k = 1; k < 8; k++) g.fillRect(x0 + k * cw / 8 - 4, 6, 8, H - 12); for (const y of [H * .34, H * .67]) g.fillRect(x0 + 6, y - 4, cw - 12, 8);
      g.fillStyle = 'rgba(120,60,30,.55)'; for (let k = 0; k < 60; k++) g.fillRect(x0 + r() * cw, r() * H, 3, 4 + r() * 16); };
    // 0: aluminium sliding window behind a steel security grill
    { const x0 = 0; glass(x0 + 22, 22, cw - 44, H - 44); frame(x0); g.fillStyle = '#7d7a73'; g.fillRect(x0 + cw / 2 - 12, 22, 24, H - 44); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x0 + cw / 2 + 8, 22, 4, H - 44);
      g.fillStyle = '#8d8981'; g.fillRect(x0 + 22, H / 2 - 5, cw / 2 - 34, 10); grill(x0); }
    // 1: closed roller shutter in its box
    { const x0 = cw; g.fillStyle = '#7a6f62'; g.fillRect(x0, 0, cw, H); for (let y = 40; y < H; y += 13) { g.fillStyle = `rgba(0,0,0,${.2 + r() * .08})`; g.fillRect(x0, y, cw, 3); g.fillStyle = 'rgba(255,240,220,.08)'; g.fillRect(x0, y + 3, cw, 2); }
      g.fillStyle = '#6b6258'; g.fillRect(x0, 0, cw, 40); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x0, 38, cw, 4);
      for (let k = 0; k < 26; k++) { g.fillStyle = `rgba(${110 + r() * 40 | 0},${60 + r() * 20 | 0},30,${.2 + r() * .3})`; g.fillRect(x0 + r() * cw, 40 + r() * (H - 60), 3 + r() * 10, 20 + r() * 60); }
      g.fillStyle = 'rgba(40,34,28,.5)'; g.fillRect(x0 + cw / 2 - 30, H - 26, 60, 10); }
    // 2: plain glass with a curtain half drawn inside and a sheer on the other side
    { const x0 = cw * 2; const cc = ['#7a4f3f', '#566a7c', '#8a7550', '#6e4a5c', '#4f6a4a'][Math.floor(r() * 5)];
      glass(x0 + 22, 22, cw - 44, H - 44, .8);
      g.fillStyle = cc; g.fillRect(x0 + 26, 26, cw * .42, H - 52); for (let k = 0; k < 9; k++) { g.fillStyle = `rgba(0,0,0,${.18 + (k % 2) * .12})`; g.fillRect(x0 + 30 + k * cw * .045, 26, 7, H - 52); g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x0 + 38 + k * cw * .045, 26, 5, H - 52); }
      g.fillStyle = 'rgba(232,226,210,.55)'; g.fillRect(x0 + cw * .6, 26, cw * .4 - 26, H - 52); for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(200,190,170,.25)'; g.fillRect(x0 + cw * .62 + k * 30, 26, 8, H - 52); }
      frame(x0, '#a19c92', 20); g.fillStyle = '#a19c92'; g.fillRect(x0 + cw / 2 - 8, 20, 16, H - 40); }
    // 3: blown out by a blast: no glass, a bent frame, shards in the corners, soot above
    { const x0 = cw * 3; g.fillStyle = '#5b5752'; g.fillRect(x0, 0, cw, 18); g.fillRect(x0, 0, 16, H); g.fillRect(x0 + cw - 16, H * .3, 16, H * .7); g.fillRect(x0, H - 18, cw * .6, 18);
      g.fillStyle = 'rgba(170,185,195,.45)'; for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [cw, 0, -1, 1], [0, H, 1, -1], [cw, H, -1, -1]]) { g.beginPath(); g.moveTo(x0 + cx, cy); g.lineTo(x0 + cx + sx * (40 + r() * 90), cy); g.lineTo(x0 + cx + sx * (10 + r() * 30), cy + sy * (30 + r() * 70)); g.lineTo(x0 + cx, cy + sy * (60 + r() * 90)); g.fill(); }
      const gr = g.createLinearGradient(0, 0, 0, H * .45); gr.addColorStop(0, 'rgba(14,11,9,.95)'); gr.addColorStop(1, 'rgba(14,11,9,0)'); g.fillStyle = gr; g.fillRect(x0, 0, cw, 18); }
  }, { repeat: false });
}
// Interior mapping for the facade windows: each clear pixel of the atlas looks into a box room behind the wall (walls,
// floor, ceiling, a doorway and furniture at the back, sometimes a curtain), lit only by the daylight entering through
// that window, so rooms are darker toward the back like real flats seen from a sunny street. The glass itself is a
// smooth dielectric that reflects the sky; a blown-out window has none.
export function windowInterior(mat) {
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ float see = clamp(1. - diffuseColor.a, 0., 1.); diffuseColor.a = 1.;
  float cell = floor(vMapUv.x * 4.);
  vec3 wn = inverseTransformDirection(normal, viewMatrix), up = vec3(0., 1., 0.), T = normalize(cross(up, wn));
  vec2 lp = vec2((fract(vMapUv.x * 4.) - .5) * 1.25, vMapUv.y * 1.3);
  vec3 ctr = vGIw - T * lp.x - up * (lp.y - .65);
  float h = fract(sin(dot(floor(ctr * 2. + .5), vec3(12.9898, 78.233, 37.719))) * 43758.5453), h2 = fract(h * 7.13 + .37), h3 = fract(h * 13.7 + .11), h4 = fract(h * 29.3 + .61);
  vec3 V = normalize(vGIw - cameraPosition); vec3 d = vec3(dot(V, T), dot(V, up), max(-dot(V, wn), 1e-3));
  vec3 p = vec3(lp, 0.);
  float hw = 1.3 + h2 * .7, D = 2.8 + h3 * 2.6, y0 = -1., y1 = 1.72;
  vec3 tt = vec3(((d.x > 0. ? hw : -hw) - p.x) / (abs(d.x) < 1e-4 ? 1e-4 : d.x), ((d.y > 0. ? y1 : y0) - p.y) / (abs(d.y) < 1e-4 ? 1e-4 : d.y), D / d.z);
  float t = min(min(tt.x, tt.y), tt.z); vec3 q = p + d * t;
  vec3 wallC = h < .35 ? vec3(.74, .69, .6) : h < .6 ? vec3(.62, .66, .62) : h < .8 ? vec3(.78, .74, .68) : vec3(.7, .64, .58);
  wallC *= mix(.8, 1.05, h2);
  vec3 col;
  if (t == tt.z) { // back wall: a dark doorway into the flat, or a wardrobe
    col = wallC * .92; float door = step(abs(q.x - (h4 - .5) * hw), .45) * step(q.y, 1.05);
    float ward = step(abs(q.x + (h4 - .5) * hw * .8), .55) * step(q.y, .95) * step(.5, h3);
    col = mix(col, vec3(.05, .045, .04), door); col = mix(col, vec3(.3, .2, .13), ward * (1. - door));
  } else if (t == tt.x) { col = wallC; float sofa = step(q.y, -.55) * step(D * .35, q.z) * step(q.z, D * .8) * step(.45, h2); col = mix(col, vec3(.28, .22, .2), sofa); }
  else if (d.y < 0.) { col = vec3(.5, .46, .4) * (.85 + .15 * step(.5, fract(q.x * 2.5) + .5 * step(.5, fract(q.z * 2.5)))); }
  else col = vec3(.84, .82, .78);
  // daylight from this window only: bright on the sill-side floor, falling off toward the back and away from the opening
  float fall = 1. / (1. + q.z * q.z * .22 + abs(q.x) * .3);
  vec3 room = col * fall * .11 * mix(.8, 1.25, h4);
  if (h > .93) room += col * vec3(.8, .95, 1.1) * .12;               // a room with the lights on (a battery tube)
  // a heavy curtain pulled across just inside the glass on some windows
  if (h3 > .72 && cell < 2.5) { vec2 cq = p.xy + d.xy * (.14 / d.z); float fold = .75 + .25 * sin(cq.x * 34. + h * 20.);
    float cov = step(cq.x, (h4 - .5) * 1.2); room = mix(room, (h < .5 ? vec3(.34, .22, .18) : vec3(.22, .28, .34)) * fold * .16, cov); }
  totalEmissiveRadiance += room * see;
  diffuseColor.rgb *= 1. - see;
  roughnessFactor = mix(roughnessFactor, cell > 2.5 ? 1. : .04, see); metalnessFactor = mix(metalnessFactor, 0., see);
}`);
  };
  mat.customProgramCacheKey = () => 'winInt';
  return mat;
}

const ARABIC_SIGNS = ['سوبر ماركت', 'صيدلية', 'خضار وفواكه', 'مخبز', 'ملابس', 'حلويات', 'أدوات منزلية', 'اتصالات', 'مواد بناء', 'بقالة', 'عطارة', 'أحذية'];
export function signTexture(i) {
  // printed flex banner / painted sheet sign as it looks after a few summers: faded, dusty, stained, with a phone line
  const r = rng(100 + i);
  const bgs = ['#2a5f86', '#9c3a2e', '#35744a', '#cfa638', '#e6e0d2', '#6a3466', '#2c2c2c', '#b85c28']; const bg = bgs[i % bgs.length];
  const light = bg === '#cfa638' || bg === '#e6e0d2'; const fg = light ? '#1c1a18' : '#f6f1e6';
  return canvasTex(1024, 256, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, bg); grd.addColorStop(1, shade(bg, -.12)); g.fillStyle = grd; g.fillRect(0, 0, W, H);
    if (r() < .5) { g.fillStyle = shade(bg, .18); g.fillRect(0, H * .78, W, H * .22); g.fillStyle = light ? '#6a2a1a' : '#f2e6c8'; g.font = '600 30px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('059' + Math.floor(1e6 + r() * 8e6), W * .5, H * .89); }
    g.fillStyle = fg; g.font = `700 ${r() < .5 ? 118 : 104}px "Noto Kufi Arabic", "Noto Sans Arabic", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
    g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowOffsetY = 3; g.fillText(ARABIC_SIGNS[i % ARABIC_SIGNS.length], W / 2 + (r() - .5) * 80, H * .43); g.shadowColor = 'transparent';
    if (r() < .6) { g.strokeStyle = fg; g.globalAlpha = .6; g.lineWidth = 5; g.strokeRect(14, 14, W - 28, H - 28); g.globalAlpha = 1; }
    // sun fade (strongest at top), dust, water stains, grain, torn/peeling corner
    const px = g.getImageData(0, 0, W, H); const d = px.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4; const n = hash(x * .13, y * .13) * .5 + hash(x * .031, y * .031) * .5;
      const fade = .18 + .22 * (1 - y / H) + n * .12; for (let c = 0; c < 3; c++) d[k + c] = d[k + c] * (1 - fade) + [214, 204, 186][c] * fade * (0.85 + n * .3);
      const grain = (hash(x, y) - .5) * 22; d[k] += grain; d[k + 1] += grain; d[k + 2] += grain; }
    g.putImageData(px, 0, 0);
    g.globalCompositeOperation = 'multiply';
    for (let k = 0; k < 14; k++) { const x = r() * W; const gr = g.createLinearGradient(x, 0, x, H); gr.addColorStop(0, 'rgba(110,90,70,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, 0, 3 + r() * 14, H * (.3 + r() * .7)); }
    for (let k = 0; k < 40; k++) { const x = r() * W, y = r() * H, rad = 6 + r() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(120,100,78,${.1 + r() * .2})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    g.globalCompositeOperation = 'source-over';
    if (r() < .35) { g.fillStyle = 'rgba(70,64,58,.9)'; g.beginPath(); const cx = r() < .5 ? 0 : W; g.moveTo(cx, 0); g.lineTo(cx + (cx ? -1 : 1) * (60 + r() * 120), 0); g.lineTo(cx, 40 + r() * 90); g.fill(); }
  }, { repeat: false });
}
function shade(hex, k) { const c = new THREE.Color(hex); c.offsetHSL(0, -.05, k); return '#' + c.getHexString(); }

// street art / posters atlas (4x2 cells): painted flag, spray-painted Arabic, pasted posters, a mural, ads
const GRAF = ['النصيرات', 'مخيم النصيرات', 'مياه للشرب', 'للبيع ٠٥٩٩', 'صبرًا', 'بيت العائلة', 'غزة', 'ممنوع الوقوف'];
function posterAtlas() {
  const W = 2048, H = 1024, cw = 512, ch = 512; const r = rng(55);
  return canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const spray = (x, y, txt, col, size, rot = 0) => { g.save(); g.translate(x, y); g.rotate(rot); g.font = `700 ${size}px "Noto Kufi Arabic", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
      g.shadowColor = col; g.shadowBlur = 8; g.fillStyle = col; g.fillText(txt, 0, 0); g.shadowBlur = 0; for (let i = 0; i < 40; i++) { g.fillRect((r() - .5) * size * 3, size * .3 + r() * size * .8, 2, 4 + r() * 18); } g.restore(); };
    const cell = (i) => [(i % 4) * cw, Math.floor(i / 4) * ch];
    // 0: painted flag on the wall
    { const [x, y] = cell(0); const fx = x + 40, fy = y + 110, fw = 430, fh = 280; [['#151515', 0], ['#f2efe6', 1], ['#1f7a3a', 2]].forEach(([c, k]) => { g.fillStyle = c; g.fillRect(fx, fy + k * fh / 3, fw, fh / 3 + 1); });
      g.fillStyle = '#c0282d'; g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + fw * .38, fy + fh / 2); g.lineTo(fx, fy + fh); g.fill(); }
    // 1,2: spray-painted words
    { const [x, y] = cell(1); spray(x + 256, y + 200, pick2(r, GRAF), '#161616', 78, -.05); spray(x + 256, y + 350, pick2(r, GRAF), '#1f7a3a', 56, .04); }
    { const [x, y] = cell(2); spray(x + 256, y + 230, pick2(r, GRAF), '#b0221e', 84, .03); spray(x + 256, y + 380, '٠٥٩٧٣٤٥٦٧٨', '#1a3a8a', 44, 0); }
    // 3: pasted posters, torn and sun-faded
    { const [x, y] = cell(3); for (let i = 0; i < 9; i++) { const px = x + 30 + (i % 3) * 155, py = y + 60 + Math.floor(i / 3) * 140; g.save(); g.translate(px + 70, py + 60); g.rotate((r() - .5) * .08); g.fillStyle = ['#e8e0cc', '#d8c89a', '#c8d8c0', '#e0c8c0'][i % 4]; g.fillRect(-70, -62, 140, 124);
        g.fillStyle = ['#1f5a3a', '#6a1a1a', '#1a2a5a', '#3a3a3a'][i % 4]; g.fillRect(-60, -52, 120, 22); g.fillStyle = 'rgba(60,50,40,.55)'; for (let k = 0; k < 5; k++) g.fillRect(-58, -18 + k * 14, 60 + r() * 56, 6);
        g.fillStyle = 'rgba(90,80,70,.4)'; g.beginPath(); g.ellipse(35, 12, 22, 28, 0, 0, 7); g.fill(); if (r() < .4) { g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(-70, 62); g.lineTo(-70 + r() * 90, 62 - r() * 70); g.lineTo(70, 62); g.fill(); g.globalCompositeOperation = 'source-over'; } g.restore(); } }
    // 4: olive tree mural
    { const [x, y] = cell(4); g.fillStyle = '#e7dcc4'; g.fillRect(x + 30, y + 60, 452, 380); g.fillStyle = '#5a3a24'; g.fillRect(x + 236, y + 250, 40, 170); g.fillStyle = '#3f6a32'; for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(x + 256 + (r() - .5) * 300, y + 190 + (r() - .5) * 150, 30 + r() * 30, 14 + r() * 10, r() * 3, 0, 7); g.fill(); } g.fillStyle = '#1f7a3a'; g.fillRect(x + 30, y + 420, 452, 20); }
    // 5: shop ad painted in blue
    { const [x, y] = cell(5); g.fillStyle = '#f0ece2'; g.fillRect(x + 20, y + 120, 472, 260); g.strokeStyle = '#1a4a9a'; g.lineWidth = 10; g.strokeRect(x + 30, y + 130, 452, 240); spray(x + 256, y + 210, 'تصليح جوالات', '#1a4a9a', 60, 0); spray(x + 256, y + 320, '٠٥٩٩٢٣٤٥٦٧', '#1a4a9a', 44, 0); }
    // 6: children's chalk drawings
    { const [x, y] = cell(6); g.strokeStyle = 'rgba(240,240,235,.85)'; g.lineWidth = 6; g.strokeRect(x + 120, y + 250, 140, 110); g.beginPath(); g.moveTo(x + 110, y + 250); g.lineTo(x + 190, y + 180); g.lineTo(x + 270, y + 250); g.stroke(); g.beginPath(); g.arc(x + 380, y + 170, 40, 0, 7); g.stroke(); for (let k = 0; k < 8; k++) { const a = k * .785; g.beginPath(); g.moveTo(x + 380 + Math.cos(a) * 50, y + 170 + Math.sin(a) * 50); g.lineTo(x + 380 + Math.cos(a) * 75, y + 170 + Math.sin(a) * 75); g.stroke(); } g.strokeStyle = 'rgba(230,120,120,.8)'; g.beginPath(); g.moveTo(x + 300, y + 360); g.lineTo(x + 330, y + 290); g.lineTo(x + 360, y + 360); g.stroke(); }
    // 7: tag scribbles
    { const [x, y] = cell(7); spray(x + 256, y + 256, pick2(r, GRAF), '#202020', 70, -.12); g.strokeStyle = 'rgba(20,20,20,.8)'; g.lineWidth = 5; g.beginPath(); for (let k = 0; k < 12; k++) g.lineTo(x + 80 + k * 30, y + 360 + Math.sin(k) * 20); g.stroke(); }
    // weather everything
    const im = g.getImageData(0, 0, W, H); for (let i = 0; i < im.data.length; i += 4) { if (!im.data[i + 3]) continue; const n = r(); im.data[i + 3] *= (n < .08 ? .2 : .78 + n * .22); } g.putImageData(im, 0, 0);
  }, { repeat: false });
}
function pick2(r, a) { return a[Math.floor(r() * a.length)]; }

function tilesTex() { // patterned ceramic floor tiles (common in Gaza homes)
  const r = rng(21);
  return canvasTex(512, 512, (g) => {
    const s = 128;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const x0 = x * s, y0 = y * s; const t = .92 + r() * .08;
      g.fillStyle = `rgb(${206 * t | 0},${196 * t | 0},${178 * t | 0})`; g.fillRect(x0, y0, s, s);
      g.strokeStyle = 'rgba(120,96,70,.55)'; g.lineWidth = 3; g.beginPath(); g.arc(x0 + s / 2, y0 + s / 2, s * .32, 0, 7); g.stroke();
      g.fillStyle = 'rgba(150,110,70,.35)'; for (let k = 0; k < 4; k++) { g.save(); g.translate(x0 + s / 2, y0 + s / 2); g.rotate(k * Math.PI / 2 + Math.PI / 4); g.fillRect(-4, s * .12, 8, s * .3); g.restore(); }
      g.fillStyle = 'rgba(80,60,40,.5)'; [[0, 0], [s, 0], [0, s], [s, s]].forEach(([a, b]) => { g.beginPath(); g.arc(x0 + a, y0 + b, s * .14, 0, 7); g.fill(); });
      g.fillStyle = 'rgba(60,50,40,.6)'; g.fillRect(x0, y0, s, 2); g.fillRect(x0, y0, 2, s);
      for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(90,70,50,${r() * .08})`; g.fillRect(x0 + r() * s, y0 + r() * s, r() * 10, r() * 10); }
    }
  });
}
// realistic 40x40 cm polished floor tiles (beige marble look, per-tile variation, grout); texture covers 2 m
function marbleTiles() {
  const S = 512, n = 5, ts = S / n, r = rng(33);
  return canvasTex(S, S, (g) => {
    const im = g.createImageData(S, S), d = im.data; const tiles = [];
    for (let i = 0; i < n * n; i++) tiles.push({ ox: r() * 50, oy: r() * 50, rot: r() < .5, t: .9 + r() * .12, hue: r() });
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const tx = Math.min(n - 1, Math.floor(x / ts)), ty = Math.min(n - 1, Math.floor(y / ts)); const T = tiles[ty * n + tx];
      let u = (x - tx * ts) / ts, v = (y - ty * ts) / ts; if (T.rot) { const q = u; u = v; v = q; }
      const f = fbm(u * 2.2 + T.ox, v * 2.2 + T.oy, 4); const vein = Math.pow(1 - Math.abs(Math.sin((u * 1.6 + v * .7 + f * 2.8) * 3.1)), 9);
      const cl = fbm(u * 7 + T.oy, v * 7 + T.ox, 2);
      let R = 214, Gc = 203, B = 184; R += (T.hue - .5) * 14; B -= (T.hue - .5) * 10;
      const k = T.t * (.9 + .16 * f + .05 * cl) - vein * .16;
      R *= k; Gc *= k; B *= k * .98;
      const ex = Math.min(x - tx * ts, (tx + 1) * ts - x, y - ty * ts, (ty + 1) * ts - y); // grout & bevel
      if (ex < 1.2) { R = 128; Gc = 120; B = 108; } else if (ex < 3) { const b = .9 + .03 * ex; R *= b; Gc *= b; B *= b; }
      const i = (y * S + x) * 4; d[i] = R; d[i + 1] = Gc; d[i + 2] = B; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}
// persian-style rug: mirrored floral field around a medallion, patterned border, woven noise
function rugTex(seed) {
  const r = rng(seed); const pals = [[[122, 28, 30], [28, 38, 78], [214, 176, 104], [236, 224, 196], [60, 90, 70]], [[30, 52, 84], [140, 34, 34], [206, 170, 96], [232, 220, 192], [90, 60, 40]], [[92, 38, 60], [36, 64, 56], [216, 184, 120], [240, 228, 206], [150, 70, 40]]];
  const P = pals[seed % 3]; const W = 512, H = 768;
  return canvasTex(W, H, (g) => {
    const im = g.createImageData(W, H), d = im.data; const a1 = 3 + r() * 3, a2 = 5 + r() * 4, ph = r() * 6;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const bx = Math.min(x, W - 1 - x), by = Math.min(y, H - 1 - y); const b = Math.min(bx, by);
      let c;
      if (b < 10) c = P[0]; else if (b < 16) c = P[3]; else if (b < 58) { // border: repeating motif
        const t = (bx < by ? y : x) / 26; const m = Math.sin(t * 6.283) * Math.sin((b - 16) / 42 * 3.14); c = m > .35 ? P[2] : m < -.35 ? P[4] : P[1];
      } else if (b < 64) c = P[3]; else {
        const u = (x - W / 2) / (W / 2 - 64), v = (y - H / 2) / (H / 2 - 64); const au = Math.abs(u), av = Math.abs(v);
        const med = Math.hypot(u * 1.25, v * .95); const petal = Math.sin(Math.atan2(v, u) * 8 + ph) * .08;
        if (med < .34 + petal) c = med < .14 ? P[3] : med < .2 ? P[2] : P[1];
        else { const fl = Math.sin(au * a1 * 6.28) * Math.sin(av * a2 * 6.28) + .5 * Math.sin((au + av) * 9.4 + ph); c = fl > .75 ? P[2] : fl < -.8 ? P[4] : fl > .45 ? P[3] : P[0];
          if (au > .92 || av > .94) c = P[1]; }
      }
      const k = .82 + .18 * ((x * 7 + y * 13) % 5) / 5 + (Math.random() - .5) * .12; const i = (y * W + x) * 4; d[i] = c[0] * k; d[i + 1] = c[1] * k; d[i + 2] = c[2] * k; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { repeat: false });
}
function carpetTex(seed) {
  const r = rng(seed); const pal = [['#7a1f1f', '#d8b36a', '#1f2f5a', '#efe3c8'], ['#23405a', '#c8a45a', '#7a2a2a', '#e8dcc0'], ['#5a2a4a', '#d9c08a', '#2a4a3a', '#f0e6d0']][seed % 3];
  return canvasTex(512, 768, (g) => {
    g.fillStyle = pal[0]; g.fillRect(0, 0, 512, 768);
    g.strokeStyle = pal[1]; g.lineWidth = 14; g.strokeRect(24, 24, 464, 720); g.lineWidth = 4; g.strokeRect(52, 52, 408, 664);
    g.fillStyle = pal[2]; g.beginPath(); g.ellipse(256, 384, 150, 230, 0, 0, 7); g.fill();
    g.strokeStyle = pal[3]; g.lineWidth = 3; for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(256, 384, 150 - k * 22, 230 - k * 34, 0, 0, 7); g.stroke(); }
    for (let k = 0; k < 90; k++) { g.fillStyle = pal[1 + (k % 3)]; const a = r() * 7, d = r(); g.fillRect(256 + Math.cos(a) * 140 * d, 384 + Math.sin(a) * 220 * d, 6, 6); }
    for (let x = 60; x < 460; x += 22) { g.fillStyle = pal[3]; g.fillRect(x, 34, 8, 8); g.fillRect(x, 726, 8, 8); }
    const im = g.getImageData(0, 0, 512, 768); for (let i = 0; i < im.data.length; i += 4) { const k = .86 + Math.random() * .16; im.data[i] *= k; im.data[i + 1] *= k; im.data[i + 2] *= k; } g.putImageData(im, 0, 0);
  }, { repeat: false });
}
function fabricTex(base, pattern, seed) {
  const r = rng(seed);
  return canvasTex(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    if (pattern === 'floral') for (let k = 0; k < 40; k++) { const x = r() * 256, y = r() * 256; g.fillStyle = ['#c84a5a', '#e8c86a', '#5a8a4a', '#f0f0f0'][k % 4]; for (let p = 0; p < 5; p++) { g.beginPath(); g.arc(x + Math.cos(p * 1.25) * 6, y + Math.sin(p * 1.25) * 6, 4, 0, 7); g.fill(); } }
    if (pattern === 'stripe') for (let y = 0; y < 256; y += 32) { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y, 256, 10); }
    if (pattern === 'check') for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) if ((x + y) / 32 % 2) { g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x, y, 32, 32); }
    for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(0,0,0,${.03 + r() * .03})`; g.fillRect(0, y, 256, 1); }
  });
}

export function buildMaterials() {
  const bw = blockWall(); TEX.blockCol = bw.col; TEX.blockNrm = bw.nrm; TEX.blockFar = bw.col;
  TEX.windows = windowAtlas(); TEX.noise = noiseTex(); TEX.posters = posterAtlas();
  TEX.tiles = tilesTex();
  const pconcN = tex('pconc_n.jpg', { srgb: false });
  const std = (o) => new THREE.MeshStandardMaterial(o);

  const cb = tex('cblock_c.jpg'), cbn = tex('cblock_n.jpg', { srgb: false }); cb.repeat.set(1.67, 1.67); cbn.repeat.set(1.67, 1.67);
  MAT.block = std({ map: cb, normalMap: cbn, normalScale: new THREE.Vector2(1.1, 1.1), roughness: .95, color: '#f2ebdf' });
  TEX.blockCol = cb;
  MAT.plasterCream = std({ map: tex('plaster_cream.jpg'), normalMap: pconcN, normalScale: new THREE.Vector2(.35, .35), roughness: .92, color: '#e2dacd' });
  MAT.plasterYellow = std({ map: tex('plaster_yellow.jpg'), normalMap: pconcN, normalScale: new THREE.Vector2(.35, .35), roughness: .92, color: '#e2d8c6' });
  MAT.plasterWhite = std({ map: tex('plaster_white.jpg'), normalMap: pconcN, normalScale: new THREE.Vector2(.3, .3), roughness: .9, color: '#d8d3c9' });
  MAT.plasterGray = std({ map: tex('plaster_gray.jpg'), normalMap: pconcN, normalScale: new THREE.Vector2(.3, .3), roughness: .93, color: '#d0cbc2' });
  const wc = tex('wconc_c.jpg'), wcn = tex('wconc_n.jpg', { srgb: false });
  MAT.concrete = std({ map: wc, normalMap: wcn, normalScale: new THREE.Vector2(.7, .7), roughness: .95, color: '#d8d0c2' });
  MAT.slab = std({ map: wc, normalMap: wcn, normalScale: new THREE.Vector2(.5, .5), roughness: .95, color: '#c8bfb0' });
  MAT.greenPaint = std({ map: tex('pconc_c.jpg'), normalMap: pconcN, roughness: .8, color: '#ffffff' });
  MAT.rust = std({ map: tex('rust2_c.jpg'), normalMap: tex('rust2_n.jpg', { srgb: false }), roughness: .75, metalness: .5 });
  MAT.rustSheet = std({ map: tex('metal8_c.jpg'), normalMap: tex('rsheet_n.jpg', { srgb: false }), roughnessMap: tex('metal8_r.jpg', { srgb: false }), roughness: 1, metalness: .45, side: THREE.DoubleSide, color: '#d8d0c8' });
  MAT.metalDark = std({ color: '#2b2926', roughness: .6, metalness: .6 });
  MAT.steel = std({ color: '#8c8a86', roughness: .45, metalness: .85 });
  MAT.window = windowInterior(std({ map: TEX.windows, roughness: .55, metalness: .3, envMapIntensity: 1.6 }));
  MAT.tiles = std({ map: TEX.tiles, roughness: .35, metalness: 0, envMapIntensity: .7 });
  MAT.intWall = std({ map: tex('plaster_white.jpg'), normalMap: pconcN, normalScale: new THREE.Vector2(.2, .2), roughness: .9, color: '#e9e2d2' });
  MAT.intWall2 = std({ map: tex('plaster_white.jpg'), normalMap: pconcN, normalScale: new THREE.Vector2(.2, .2), roughness: .9, color: '#cfdcd6' });
  MAT.intWall3 = std({ map: tex('plaster_white.jpg'), normalMap: pconcN, normalScale: new THREE.Vector2(.2, .2), roughness: .9, color: '#e8d6c4' });
  MAT.ceiling = std({ color: '#e9e5dc', roughness: .95 });
  const wd = tex('wood_c.jpg'), wdn = tex('wood_n.jpg', { srgb: false });
  MAT.wood = std({ map: wd, normalMap: wdn, color: '#8a6a52', roughness: .8 });
  MAT.woodLight = std({ map: wd, normalMap: wdn, color: '#e8d4bc', roughness: .82 });
  MAT.door = std({ map: tex('pconc_c.jpg'), color: '#c9b9a0', roughness: .6, metalness: .3 });
  MAT.metalDoor = std({ map: tex('metal8_c.jpg'), normalMap: tex('metal8_n.jpg', { srgb: false }), color: '#9aa8b4', roughness: .65, metalness: .5 });
  MAT.fabricSofa = std({ map: fabricTex('#6b3a2a', 'stripe', 1), roughness: 1 });
  MAT.fabricSofa2 = std({ map: fabricTex('#3a4a5a', 'check', 2), roughness: 1 });
  MAT.mattress = std({ map: fabricTex('#c9b48a', 'floral', 3), roughness: 1 });
  MAT.mattress2 = std({ map: fabricTex('#8aa0b8', 'floral', 4), roughness: 1 });
  MAT.mattress3 = std({ map: fabricTex('#b88a8a', 'stripe', 5), roughness: 1 });
  MAT.blanket = std({ map: fabricTex('#5a3a4a', 'check', 6), roughness: 1, side: THREE.DoubleSide });
  MAT.blanket2 = std({ map: fabricTex('#3a5a4a', 'stripe', 7), roughness: 1, side: THREE.DoubleSide });
  MAT.carpets = [0, 1, 2].map(i => std({ map: carpetTex(i), roughness: 1 }));
  MAT.plastic = std({ color: '#e8e6e0', roughness: .45 });
  // AC condenser: left half the front (fan behind a spiral grille, louvred side intake), right half the plain casing;
  // sun-yellowed, dusty, with rust weeping from the screws and the drip tray
  const acT = canvasTex(512, 256, (g, w, h) => { const r = rng(88);
    for (const x0 of [0, 256]) { g.fillStyle = '#d9d4c6'; g.fillRect(x0, 0, 256, 256); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,250,235,.08)'); gr.addColorStop(1, 'rgba(120,105,80,.25)'); g.fillStyle = gr; g.fillRect(x0, 0, 256, 256); }
    g.fillStyle = '#2b2a28'; g.beginPath(); g.arc(96, 128, 78, 0, 7); g.fill(); g.strokeStyle = '#8f8b82'; g.lineWidth = 3; for (let k = 10; k < 80; k += 9) { g.beginPath(); g.arc(96, 128, k, 0, 7); g.stroke(); }
    g.lineWidth = 2; for (let a = 0; a < 6.28; a += .52) { g.beginPath(); g.moveTo(96, 128); g.lineTo(96 + Math.cos(a) * 78, 128 + Math.sin(a) * 78); g.stroke(); }
    g.fillStyle = '#6d6a64'; g.beginPath(); g.arc(96, 128, 12, 0, 7); g.fill();
    for (let y = 30; y < 226; y += 9) { g.fillStyle = 'rgba(60,56,50,.55)'; g.fillRect(196, y, 48, 4); }
    g.fillStyle = 'rgba(40,36,30,.5)'; g.fillRect(200, 236, 36, 8); // maker's plate (no real brand)
    for (let k = 0; k < 16; k++) { const x = r() * 512, y = r() * 60 + 190; const gr = g.createLinearGradient(x, y, x, y + 70); gr.addColorStop(0, 'rgba(120,62,24,.55)'); gr.addColorStop(1, 'rgba(120,62,24,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 4, 70); }
    for (let k = 0; k < 90; k++) { g.fillStyle = `rgba(110,98,78,${r() * .12})`; g.fillRect(r() * 512, r() * 256, 2 + r() * 20, 1 + r() * 6); } }, { repeat: false });
  MAT.acUnit = std({ map: acT, roughness: .6 });
  MAT.pvcPipe = std({ color: '#b9b6ad', roughness: .55 });
  MAT.plasticGreen = std({ color: '#3a7a4a', roughness: .45 });
  MAT.plasticBlue = std({ color: '#2a5a9a', roughness: .45 });
  MAT.neon = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f4ff', emissiveIntensity: 2.2 });
  const cardTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#b48c5c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 90 : 210},${Math.random() < .5 ? 70 : 180},40,${Math.random() * .12})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 30, 1 + Math.random() * 3); } g.fillStyle = 'rgba(60,40,20,.5)'; g.fillRect(0, h * .46, w, 10); g.fillStyle = 'rgba(40,40,40,.55)'; g.font = '700 30px sans-serif'; g.fillText('▲▲', 20, 60); });
  MAT.goods = [std({ map: cardTex, roughness: .95 }), std({ map: cardTex, roughness: .95, color: '#d8c8b0' }), std({ map: cardTex, roughness: .95, color: '#9a8a78' }), std({ color: '#e6e2d8', roughness: .5 }), std({ color: '#8a3a30', roughness: .55 }), std({ color: '#3a5a7a', roughness: .5 }), std({ color: '#c8a848', roughness: .55 })];
  MAT.donkey = std({ color: '#7a6e62', roughness: .95 });
  MAT.genRed = std({ color: '#9a2a1e', roughness: .5, metalness: .3 });
  MAT.black = std({ color: '#141312', roughness: .6 });
  MAT.glassDark = std({ color: '#0e1114', roughness: .05, metalness: .9, envMapIntensity: 1.5 });
  MAT.wire = new THREE.LineBasicMaterial({ color: '#141210' });
  MAT.cable = std({ color: '#1a1917', roughness: .55, metalness: 0 });
  MAT.tarp = [
    std({ color: '#2f5f8f', roughness: .85, side: THREE.DoubleSide }), std({ color: '#c9c3b5', roughness: .9, side: THREE.DoubleSide }),
    std({ color: '#7a8a5a', roughness: .9, side: THREE.DoubleSide }), std({ color: '#b8653a', roughness: .85, side: THREE.DoubleSide }),
  ];
  MAT.sand = std({ map: tex('sand_c.jpg'), roughness: .97, color: '#f0e2cc' });
  MAT.sandstone = std({ map: tex('sstone_c.jpg'), normalMap: tex('sstone_n.jpg', { srgb: false }), roughness: .92, color: '#f6ecdc' }); weatherize(MAT.sandstone, { marks: 1, wall: true });
  const pn = tex('plaster_n.jpg', { srgb: false }); for (const k of ['plasterCream', 'plasterYellow', 'plasterWhite', 'plasterGray']) { MAT[k].normalMap = pn; MAT[k].normalScale = new THREE.Vector2(.8, .8); }
  weatherize(MAT.block, { marks: 1.2, wall: true }); for (const k of ['plasterCream', 'plasterYellow', 'plasterWhite', 'plasterGray']) weatherize(MAT[k], { plaster: true, wall: true });
  weatherize(MAT.concrete, { marks: .8, wall: true }); weatherize(MAT.slab, { marks: .4, streak: .6, wall: true });
  MAT.damaged = std({ map: tex('damaged_c.jpg'), normalMap: tex('damaged_n.jpg', { srgb: false }), roughness: .95, color: '#b8b0a4', polygonOffset: true, polygonOffsetFactor: -2 });
  MAT.rubble = std({ map: wc, normalMap: wcn, roughness: 1, color: '#cfc4b2' });
  MAT.posters = std({ map: TEX.posters, transparent: true, alphaTest: .05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: .9 });
  MAT.awnings = [std({ map: fabricTex('#2f6a8a', 'stripe', 11), roughness: .9, side: THREE.DoubleSide }), std({ map: fabricTex('#9a3a2a', 'stripe', 12), roughness: .9, side: THREE.DoubleSide }), std({ map: fabricTex('#3a7a4a', 'stripe', 13), roughness: .9, side: THREE.DoubleSide }), std({ map: fabricTex('#c8a040', 'stripe', 14), roughness: .9, side: THREE.DoubleSide })];
  for (const m of [MAT.plastic, MAT.plasticGreen, MAT.plasticBlue, MAT.genRed, MAT.metalDark, MAT.black, MAT.donkey, ...MAT.tarp, ...MAT.awnings, MAT.wood, MAT.woodLight]) if (m && !m.onBeforeCompile.toString().includes('tN')) weatherize(m, { marks: 0, streak: .35 });
  MAT.signs = ARABIC_SIGNS.map((_, i) => std({ map: signTexture(i), roughness: .6 }));
  // ---- target building interior finishes ----
  interiorPaint(MAT.intWall, { upper: '#e6dac4' });                                     // salon / hall: warm cream
  interiorPaint(MAT.intWall2, { upper: '#cfdcd4', stain: 1.3 });                        // bedrooms: faded mint
  interiorPaint(MAT.intWall3, { upper: '#e9e5dc', lower: '#d9e1e2', dado: 1.5, skirt: '#9aa3a4' }); // kitchen / bath: tiled lower wall
  MAT.stairWall = interiorPaint(std({ roughness: .9 }), { upper: '#ddd4c2', lower: '#5b7672', dado: 1.0, skirt: '#6e665c', stain: 1.5, stair: true });
  interiorPaint(MAT.ceiling, { upper: '#ebe6db' });
  // no plaster photo under the paint (it read as bare exterior render), but its trowel relief still shows through the paint
  for (const k of ['intWall', 'intWall2', 'intWall3']) { MAT[k].map = null; MAT[k].normalMap = pn; MAT[k].normalScale = new THREE.Vector2(.28, .28); }
  MAT.stairWall.normalMap = pn; MAT.stairWall.normalScale = new THREE.Vector2(.5, .5); MAT.ceiling.normalMap = pconcN; MAT.ceiling.normalScale = new THREE.Vector2(.18, .18);
  const tz = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#b3aa9c'; g.fillRect(0, 0, w, h); const r = rng(77);
    for (let i = 0; i < 7000; i++) { const s = .8 + r() * 3; const c = r(); g.fillStyle = c < .4 ? `rgba(95,88,80,${.25 + r() * .3})` : c < .8 ? `rgba(232,226,212,${.4 + r() * .4})` : c < .93 ? `rgba(160,120,90,.45)` : `rgba(60,58,55,.4)`; g.beginPath(); g.ellipse(r() * w, r() * h, s, s * (.5 + r() * .5), r() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(60,55,50,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); });
  MAT.terrazzo = interiorPaint(std({ map: tz, roughness: .5, color: '#ffffff', envMapIntensity: .6 }), { floor: true });
  MAT.tilesB = interiorPaint(std({ map: marbleTiles(), roughness: .28, metalness: 0, envMapIntensity: .9 }), { floor: true });
  MAT.rugs = [0, 1, 2].map(i => std({ map: rugTex(i), roughness: 1 }));
  // steel apartment door: painted, pressed decorative panels, rust at the bottom, handle plate
  const dt = canvasTex(256, 512, (g, w, h) => { g.fillStyle = '#6a4a36'; g.fillRect(0, 0, w, h); const r = rng(5);
    const panel = (x, y, pw, ph) => { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + 3, y + 3, pw, ph); g.fillStyle = 'rgba(255,230,200,.12)'; g.fillRect(x - 2, y - 2, pw, ph); g.fillStyle = '#6e4e3a'; g.fillRect(x, y, pw, ph);
      g.strokeStyle = 'rgba(30,20,12,.5)'; g.lineWidth = 3; g.strokeRect(x + 10, y + 10, pw - 20, ph - 20); g.strokeStyle = 'rgba(255,230,200,.12)'; g.strokeRect(x + 13, y + 13, pw - 26, ph - 26); };
    panel(26, 30, w - 52, 180); panel(26, 250, w - 52, 230);
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${r() < .5 ? 120 : 60},${r() < .5 ? 60 : 35},20,${r() * .35})`; const y = h - r() * r() * 160; g.fillRect(r() * w, y, 2 + r() * 14, 2 + r() * 8); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(200,190,170,${r() * .25})`; g.fillRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 3); }
    g.fillStyle = '#b8b0a0'; g.fillRect(22, 232, 16, 60); g.fillStyle = '#2a2622'; g.fillRect(27, 270, 6, 12); });
  MAT.aptDoor = std({ map: dt, roughness: .55, metalness: .35 });
  for (const m of Object.values(MAT)) if (m && m.isMaterial) m.dithering = true;
  return MAT;
}

// Box with world-scaled UVs (texture density in meters per repeat)
export function boxUV(w, h, d, m = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const a = nx > .5 ? d : w, b = ny > .5 ? d : h;
    uv.setXY(i, uv.getX(i) * a / m, uv.getY(i) * b / m);
  }
  return g;
}
