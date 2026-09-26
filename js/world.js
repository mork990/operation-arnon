// Nuseirat camp: streets, market, residential blocks, wires, tents, beach and sea
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rng, rr, ri, pick, R, clamp, sstep, fbm, hash } from './core.js';
import { MAT, TEX, SCAR, boxUV, canvasTex, windSway } from './materials.js';
import { tex, A } from './assets.js';

// ---------- layout ----------
export const LAYOUT = {
  market: { z0: -4.5, z1: 4.5, x0: -300, x1: 260 },
  cross: [-230, -170, -110, -50, 10, 70, 130, 190], crossW: 7,
  lanes: [-62, 62, -122, 122], laneW: 6,
  coast: { x: -290, w: 12 }, beachX: -296, shoreX: -382,
  target: { x0: 33, x1: 47, z0: -19, z1: -7 },
  alpha: { x: -160, z: 14 },
  stuck: { x: -58, z: 0.5 },
  lz: { x: -348, z: 28 },
};
const L = LAYOUT;
const B_X0 = LAYOUT.target.x0, B_X1 = LAYOUT.target.x1, B_Z0 = LAYOUT.target.z0, B_Z1 = LAYOUT.target.z1;
export function groundY(x, z = 0) { return G.groundFn ? G.groundFn(x, z) : x < L.beachX ? (x - L.beachX) * 0.016 : 0; }
function onStreet(x, z, pad = 0) {
  if (z > L.market.z0 - pad && z < L.market.z1 + pad && x > L.market.x0 && x < L.market.x1) return true;
  for (const c of L.cross) if (Math.abs(x - c) < L.crossW / 2 + pad && Math.abs(z) < 172) return true;
  for (const c of L.lanes) if (Math.abs(z - c) < L.laneW / 2 + pad && x > -282 && x < 250) return true;
  if (Math.abs(x - L.coast.x) < L.coast.w / 2 + pad) return true;
  return false;
}

// geometry buckets merged per material at the end
const buckets = new Map();
function add(mat, geo, collide = false) { if (curWx) geo.userData.wx = curWx; if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(geo); if (collide) G.colliders.push(geo); }
const _o = new THREE.Object3D();
function place(geo, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) { _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(s); _o.updateMatrix(); return geo.applyMatrix4(_o.matrix); }
function quad(w, h, u0, v0, u1, v1) { const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv; uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); return g; }
export function addCollider(geo) { G.colliders.push(geo); }

// ---------- ground ----------
function surfaceMap() {
  // mask texture over x[-420,300], z[-180,180]; R asphalt, G dirt road, B beach, A tracks/dark patches
  const W = 2048, H = 1024, X0 = -420, X1 = 300, Z0 = -180, Z1 = 180;
  const px = x => (x - X0) / (X1 - X0) * W, pz = z => (z - Z0) / (Z1 - Z0) * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = 'rgb(0,0,0)'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  // asphalt market street + coastal road (red channel), with worn edges
  g.fillStyle = 'rgb(255,0,0)'; g.fillRect(px(L.market.x0), pz(L.market.z0 + .6), px(L.market.x1) - px(L.market.x0), pz(L.market.z1 - .6) - pz(L.market.z0 + .6));
  g.fillRect(px(L.coast.x - L.coast.w / 2), 0, px(L.coast.x + L.coast.w / 2) - px(L.coast.x - L.coast.w / 2), H);
  // dirt roads (green)
  g.fillStyle = 'rgb(0,255,0)';
  for (const cx of L.cross) g.fillRect(px(cx - L.crossW / 2), pz(-172), px(cx + L.crossW / 2) - px(cx - L.crossW / 2), pz(172) - pz(-172));
  for (const cz of L.lanes) g.fillRect(px(-282), pz(cz - L.laneW / 2), px(250) - px(-282), pz(cz + L.laneW / 2) - pz(cz - L.laneW / 2));
  // beach (blue)
  g.fillStyle = 'rgb(0,0,255)'; g.fillRect(0, 0, px(L.beachX), H);
  g.globalCompositeOperation = 'source-over';
  // sand drifts on asphalt: erase red randomly
  const r = rng(77);
  for (let i = 0; i < 420; i++) { const x = rr(L.market.x0, L.market.x1), z = r() < .7 ? (r() < .5 ? rr(-5, -3) : rr(3, 5)) : rr(-5, 5); g.fillStyle = `rgba(0,${r() < .5 ? 180 : 0},0,${.12 + r() * .3})`; g.beginPath(); g.ellipse(px(x), pz(z), 4 + r() * 20, 2 + r() * 6, r(), 0, 7); g.fill(); }
  // potholes & crater patches (alpha channel encoded via separate canvas below)
  const tex2 = new THREE.CanvasTexture(c); tex2.colorSpace = THREE.NoColorSpace; tex2.wrapS = tex2.wrapT = THREE.ClampToEdgeWrapping;
  // detail mask (dark oil stains, tire tracks, potholes)
  const d = document.createElement('canvas'); d.width = W; d.height = H; const h = d.getContext('2d'); h.fillStyle = '#000'; h.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) { const x = rr(L.market.x0, L.market.x1), z = rr(-4, 4); h.fillStyle = `rgba(255,255,255,${.3 + r() * .5})`; h.beginPath(); h.ellipse(px(x), pz(z), 1 + r() * 4, 1 + r() * 2.5, r(), 0, 7); h.fill(); }
  h.strokeStyle = 'rgba(160,160,160,.35)'; h.lineWidth = 1.2; for (const zz of [-1.9, -.3, 1.3, 2.9]) { h.beginPath(); for (let x = L.market.x0; x < L.market.x1; x += 4) h.lineTo(px(x), pz(zz + Math.sin(x * .05) * .3)); h.stroke(); }
  const rl = (a, b) => a + (b - a) * r(); // the mask's own generator: the world RNG must not move (everything after it would)
  // blast scorches and burnt patches around the junction and down its side streets
  for (let i = 0; i < 14; i++) { const x = L.stuck.x + rl(-30, 30), z = L.stuck.z + (r() < .6 ? rl(-4, 4) : rl(-30, 30)); const rad = rl(1.2, 3.8) * W / (X1 - X0);
    const gr = h.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), rad * 2); gr.addColorStop(0, `rgba(255,255,255,${rl(.55, .85)})`); gr.addColorStop(.45, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    h.fillStyle = gr; h.beginPath(); h.ellipse(px(x), pz(z), rad * 2, rad * (1.2 + r()), r() * 3, 0, 7); h.fill(); }
  // vehicle tracks across the beach: the APCs' run from the coastal road down to the landing zone, and older ones
  const track = (ptsW, w = .7, a = .5) => { for (const off of [-1.1, 1.1]) { h.strokeStyle = `rgba(200,200,200,${a})`; h.lineWidth = Math.max(1, w * W / (X1 - X0)); h.beginPath(); ptsW.forEach(([x, z], i) => { const dx = (ptsW[Math.min(i + 1, ptsW.length - 1)][0] - ptsW[Math.max(i - 1, 0)][0]), dz = (ptsW[Math.min(i + 1, ptsW.length - 1)][1] - ptsW[Math.max(i - 1, 0)][1]); const l = Math.hypot(dx, dz) || 1; h[i ? 'lineTo' : 'moveTo'](px(x - dz / l * off), pz(z + dx / l * off)); }); h.stroke(); } };
  track([[-291, 4], [-300, 6], [-310, 9], [-318, 12], [-326, 14]], .75, .55); track([[-292, -8], [-305, -2], [-322, 8], [-345, 24], [-352, 30]], .7, .35);
  for (let i = 0; i < 5; i++) { const z0 = rl(-150, 150), pts = []; let x = -292, z = z0; for (let k = 0; k < 8; k++) { pts.push([x, z]); x -= rl(6, 12); z += rl(-6, 6); } track(pts, .6, .18 + r() * .15); }
  const det = new THREE.CanvasTexture(d); det.colorSpace = THREE.NoColorSpace;
  // wet patches: water thrown out of shops across the pavement, leaks under stalls and water tanks, a gutter trickle
  const wc = document.createElement('canvas'); wc.width = W / 2; wc.height = H / 2; const w2 = wc.getContext('2d'); w2.fillStyle = '#000'; w2.fillRect(0, 0, wc.width, wc.height);
  const wx = x => px(x) / 2, wz = z => pz(z) / 2, ws = (X1 - X0) / wc.width;
  for (let i = 0; i < 70; i++) { const x = rl(-60, 240), z = (r() < .5 ? -1 : 1) * rl(2.4, 4.3); const rad = rl(.6, 2.2) / ws;
    const gr = w2.createRadialGradient(wx(x), wz(z), 0, wx(x), wz(z), rad); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.7, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    w2.fillStyle = gr; w2.save(); w2.translate(wx(x), wz(z)); w2.rotate(r() * 3); w2.scale(1, .35 + r() * .5); w2.translate(-wx(x), -wz(z)); w2.fillRect(wx(x) - rad, wz(z) - rad, rad * 2, rad * 2); w2.restore(); }
  w2.strokeStyle = 'rgba(255,255,255,.55)'; w2.lineWidth = Math.max(1, .35 / ws); for (const zz of [-4.1, 4.1]) { w2.beginPath(); for (let x = -40; x < 200; x += 2) w2[x > -40 ? 'lineTo' : 'moveTo'](wx(x), wz(zz + Math.sin(x * .13) * .15)); w2.stroke(); }
  const wet = new THREE.CanvasTexture(wc); wet.colorSpace = THREE.NoColorSpace;
  return { mask: tex2, det, wet, X0, X1, Z0, Z1 };
}

let groundAO = null;
// soft darkening of the ground around every building footprint (ambient occlusion + dust collecting against walls)
function bakeGroundAO() {
  if (!groundAO) return; const { c, t, sm } = groundAO; const W = c.width, H = c.height;
  const px = x => (x - sm.X0) / (sm.X1 - sm.X0) * W, pz = z => (z - sm.Z0) / (sm.Z1 - sm.Z0) * H, sx = W / (sm.X1 - sm.X0), sz = H / (sm.Z1 - sm.Z0);
  const fp = document.createElement('canvas'); fp.width = W; fp.height = H; const f = fp.getContext('2d'); f.fillStyle = '#fff';
  const rect = (cx, cz, w, d, ry) => { f.save(); f.translate(px(cx), pz(cz)); f.rotate(-ry); f.fillRect(-w / 2 * sx, -d / 2 * sz, w * sx, d * sz); f.restore(); };
  for (const [cx, cz, w, d, ry] of G.footprints || []) rect(cx, cz, w, d, ry || 0);
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(6px)'; g.globalAlpha = .55; g.drawImage(fp, 0, 0); g.filter = 'blur(2px)'; g.globalAlpha = .6; g.drawImage(fp, 0, 0); g.filter = 'none'; g.globalAlpha = 1;
  t.needsUpdate = true;
}
function buildGround() {
  const sm = surfaceMap();
  const S = 1600, N = 200;
  const geo = new THREE.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2); geo.translate(-200, 0, 0);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, groundY(p.getX(i)) + (p.getX(i) < L.beachX ? 0 : (fbm(p.getX(i) * .02, p.getZ(i) * .02, 2) - .5) * .06 * sstep(10, 40, Math.abs(p.getZ(i)))));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: .95, normalMap: tex('gravel_n.jpg', { srgb: false }), normalScale: new THREE.Vector2(.6, .6) });
  const aoC = document.createElement('canvas'); aoC.width = 2048; aoC.height = 1024; const aoT = new THREE.CanvasTexture(aoC); aoT.colorSpace = THREE.NoColorSpace;
  groundAO = { c: aoC, t: aoT, sm };
  const U = { tAO: { value: aoT }, tSand: { value: tex('sand_c.jpg') }, tDirt: { value: tex('dirt2_c.jpg') }, tGrav: { value: tex('gravel_c.jpg') }, tTar: { value: tex('tarmac.jpg') }, tNz: { value: TEX.noise },
    tMask: { value: sm.mask }, tDet: { value: sm.det }, tWet: { value: sm.wet }, uB: { value: new THREE.Vector4(sm.X0, sm.X1, sm.Z0, sm.Z1) }, uT: seaT, uWL: { value: L.beachX - 1.25 / .016 } };
  // low quality skips the second, rotated sample of each ground photo (the de-tiling), which is four texture reads a pixel
  mat.onBeforeCompile = sh => { const hq = !(G.quality === 0);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;uniform sampler2D tSand,tDirt,tGrav,tTar,tMask,tDet,tAO,tWet,tNz;uniform vec4 uB;uniform float uT,uWL;float gWet=0.,gBeach=0.,gPud=0.;')
      .replace('#include <map_fragment>', `vec2 wp=vWP.xz;vec2 muv=vec2((wp.x-uB.x)/(uB.y-uB.x),(wp.y-uB.z)/(uB.w-uB.z));
        vec4 m=texture2D(tMask,muv);float dt=texture2D(tDet,muv).r;
        float n1=texture2D(tDirt,wp/31.).g;float n2=texture2D(tSand,wp/97.+.3).r;
        vec3 sand=mix(texture2D(tSand,wp/4.).rgb,texture2D(tSand,wp/13.).rgb,.5); sand=mix(vec3(dot(sand,vec3(.3,.59,.11))),sand,.55)*vec3(.97,.94,.9);
        // macro and mid-scale variation from the shared weathering noise (blobs of ~20 m, ~7 m and ~2 m here), and a second,
        // rotated sample of every ground photo blended in by it, so no tile repeats down a 500 m street
        vec4 zA=texture2D(tNz,wp/83.), zB=texture2D(tNz,wp/17.+.41); vec2 wr=mat2(.8,-.6,.6,.8)*wp+17.3; float dm=smoothstep(.35,.65,zB.g);
        vec3 dirt=${hq ? 'mix(texture2D(tDirt,wp/6.).rgb,texture2D(tDirt,wr/8.3).rgb,dm)' : 'texture2D(tDirt,wp/6.).rgb'}; dirt=mix(vec3(dot(dirt,vec3(.3,.59,.11))),dirt,.6);
        vec3 grav=${hq ? 'mix(texture2D(tGrav,wp/3.5).rgb,texture2D(tGrav,wr/4.7).rgb,dm)' : 'texture2D(tGrav,wp/3.5).rgb'};
        vec3 tar=${hq ? 'mix(texture2D(tTar,wp/5.).rgb,texture2D(tTar,wr/6.6).rgb,dm)' : 'texture2D(tTar,wp/5.).rgb'}*vec3(.9,.88,.86);
        vec3 lot=mix(sand,dirt,smoothstep(.35,.65,n1*.6+zA.g*.6-.1))*mix(.9,1.08,n2);
        // dirt roads: hard-packed darker earth where the wheels run, loose sand and gravel drifted in between
        vec3 road=mix(dirt*mix(.76,.95,zB.r),mix(grav,sand,.35),smoothstep(.4,.72,zB.b*.7+zA.r*.45));
        // the market street's old asphalt: two tyre-polished lanes down the middle between the stalls, black patches over
        // repaired holes, and wind-blown sand lying over it toward the kerbs and in drifts
        float lz=abs(wp.y)-1.15, lane=exp(-lz*lz/.3)*step(-284.,wp.x); vec2 pc=floor(wp/vec2(3.3,2.1)); float ph=fract(sin(dot(pc,vec2(12.9898,78.233)))*43758.5453);
        vec2 pq=abs(fract(wp/vec2(3.3,2.1))-.5)-(.12+fract(ph*37.3)*.26); float patchA=step(ph,.14)*(1.-smoothstep(-.03,.03,max(pq.x,pq.y)+(zB.b-.5)*.15));
        tar=mix(tar,tar*vec3(.6,.6,.62),patchA)*(1.-lane*.14);
        float cover=clamp(smoothstep(.5,.78,zB.g*.55+zA.b*.55)+smoothstep(2.4,4.3,abs(wp.y))*step(-284.,wp.x)*.85,0.,1.)*(1.-lane*.5);
        tar=mix(tar,sand*.93,cover*.8);
        vec3 col=lot;col=mix(col,road,m.g);col=mix(col,tar*mix(.9,1.1,n1),m.r*.95);
        // oil drips and spilled water darken the roads in blotches; the whole town floor drifts in tone at the large scale
        col*=1.-smoothstep(.66,.8,zB.b*.65+zA.g*.45)*(m.r+m.g*.7)*(1.-m.b)*.3; col*=mix(.9,1.07,zA.r);
        // beach: pale sand with broad drifts; the swash (the reach of the last wave) moves up and down it, leaving dark
        // glossy wet sand below and a line of washed-up wrack above
        float bn=texture2D(tSand,wp/41.+.17).g;
        vec3 beach=mix(texture2D(tSand,wp/2.6).rgb,texture2D(tSand,wp/9.).rgb,.45);beach=mix(vec3(dot(beach,vec3(.3,.59,.11))),beach,.7)*vec3(1.04,.99,.9)*mix(.9,1.08,bn);
        // trampled and wind-scoured patches and the litter of a shore thousands of people live on: specks of dry weed,
        // charcoal from cooking fires and scraps of plastic
        beach*=mix(.9,1.1,smoothstep(.3,.7,zA.b))*mix(vec3(1.),vec3(.88,.88,.9),smoothstep(.5,.7,zB.r)); float bs=texture2D(tNz,wp/2.3+.7).b; beach*=1.-smoothstep(.66,.72,bs)*.5*(1.-smoothstep(.35,.6,zB.g)); beach=mix(beach,vec3(.8,.79,.76),smoothstep(.86,.9,bs)*.6);
        float wl=uWL+3.5+2.2*sin(uT*.55+wp.y*.031)+1.1*sin(uT*.93+wp.y*.107);gWet=smoothstep(wl+5.,wl+.5,wp.x);
        beach=mix(beach,beach*vec3(.52,.5,.47),gWet);float wrack=smoothstep(.5,.9,texture2D(tDirt,wp/5.).r)*(1.-smoothstep(0.,1.2,abs(wp.x-uWL-10.5-2.*sin(wp.y*.05))));beach*=1.-wrack*.45;
        gBeach=m.b;col=mix(col,beach,m.b);col*=1.-dt*mix(.35,.28,m.b);
        // damp street: darker and glossy; the water gathers in the low spots of the texture first
        gPud=smoothstep(.15,.75,texture2D(tWet,muv).r*(.75+.5*texture2D(tDirt,wp/2.3).g))*(1.-m.b);col*=1.-gPud*.42;
        float ao=texture2D(tAO,muv).r;
        // sand and grit blown against the walls, with broken bits of block and scraps of litter in it
        float wb=smoothstep(.03,.22,ao)*(1.-m.b); col=mix(col,sand*1.05,wb*.5*smoothstep(.25,.6,zB.r+.15));
        float gs=texture2D(tNz,wp/1.7+.3).b; col*=1.-smoothstep(.64,.72,gs)*wb*.45; col=mix(col,vec3(.74,.72,.68),smoothstep(.8,.84,gs)*wb*.5);
        col*=1.-ao*.55; // contact shadow / dirt where walls meet the ground
        float gMix=m.r;
        diffuseColor.rgb*=col;`)
      .replace('#include <normal_fragment_maps>', `vec3 mapN=texture2D(normalMap,wp/3.5).xyz*2.-1.;${hq ? 'vec3 nR=texture2D(normalMap,wr/4.7).xyz*2.-1.;nR.xy=nR.xy*mat2(.8,-.6,.6,.8);mapN=mix(mapN,nR,dm);' : ''}mapN.xy*=normalScale*(1.-gMix*.6)*(1.-gWet*.7)*(1.-gPud*.8);
        // wind ripples on the dry beach, fading out with distance before they can shimmer
        float rph=dot(wp,vec2(.93,.37))*21.+texture2D(tDirt,wp/7.).g*9.;float rf=gBeach*(1.-gWet)*(1.-smoothstep(6.,26.,length(vWP-cameraPosition)));mapN.xy+=vec2(.93,.37)*cos(rph)*.32*rf*smoothstep(.38,.62,zB.g);
        normal=normalize(tbn*mapN);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=mix(mix(mix(.97,.85,gMix),.3,gWet*gBeach),.12,gPud);');
  };
  mat.customProgramCacheKey = () => 'ground' + (G.quality === 0 ? 0 : 1);
  const ground = new THREE.Mesh(geo, mat); ground.receiveShadow = true; G.scene.add(ground);
  // collision: coarse ground
  const cg = new THREE.PlaneGeometry(S, S, 40, 40); cg.rotateX(-Math.PI / 2); cg.translate(-200, 0, 0); const cp = cg.attributes.position; for (let i = 0; i < cp.count; i++) cp.setY(i, groundY(cp.getX(i))); cg.userData.noOcclude = true; G.colliders.push(cg);
}

// ---------- sea ----------
// the shared clock of the sea and of the wet band it leaves on the beach
const seaT = { value: 0 };
function buildSea() {
  const geo = new THREE.PlaneGeometry(3000, 3000, 1, 1); geo.rotateX(-Math.PI / 2); geo.translate(L.shoreX - 1500 + 30, -1.25, 0);
  const s = G.sunDir; const beachSlope = .016;
  // Mediterranean off Gaza: a shallow sandy shelf, so the water is pale turquoise over the sand for the first tens of
  // metres and deepens to blue; the swell arrives from the west in long crests parallel to the beach and breaks in
  // lines of foam near the shore. Reflections come from the same sky photograph as the sky dome.
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: false, uniforms: { uT: seaT, uSun: { value: s.clone() }, tSky: { value: A.hdr }, uWL: { value: L.beachX - 1.25 / beachSlope } },
    vertexShader: `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `#include <common>
    varying vec3 vW;uniform float uT,uWL;uniform vec3 uSun;uniform sampler2D tSky;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    // height of the surface: three swell trains from the west plus wind chop
    float H(vec2 p){ float y = .35*sin(p.x*.21+uT*1.1+sin(p.y*.017)*2.) + .18*sin(p.x*.37+p.y*.09+uT*1.6) + .1*sin(p.x*.55-p.y*.21+uT*2.1);
      float c=0.,a=.12; vec2 q=p*.45; for(int i=0;i<4;i++){ c+=a*n(q+vec2(uT*.5,uT*.23)); q=q*2.05+vec2(3.1,1.7); a*=.5; } return y+c; }
    vec3 sky(vec3 d){ d.y=max(d.y,.02); d=normalize(d); vec2 uv=vec2(atan(d.z,d.x)*RECIPROCAL_PI2+.5, asin(clamp(d.y,-1.,1.))*RECIPROCAL_PI+.5); return texture2D(tSky,uv).rgb*1.35; }
    void main(){
      vec2 p=vW.xz; float e=.35; float c=H(p); vec3 N=normalize(vec3(-(H(p+vec2(e,0.))-c)/e*.55, 1., -(H(p+vec2(0.,e))-c)/e*.55));
      float dist=length(cameraPosition-vW); N=normalize(mix(N,vec3(0.,1.,0.),smoothstep(60.,500.,dist)*.7));
      vec3 V=normalize(cameraPosition-vW); float NV=max(dot(N,V),0.); float F=.02+.98*pow(1.-NV,5.);
      float depth=max(uWL-vW.x,0.)*${beachSlope}; // metres of water over the sloping sand
      vec3 shallow=vec3(.16,.56,.52), deep=vec3(.02,.13,.19), sand=vec3(.62,.56,.42);
      vec3 body=mix(shallow,deep,smoothstep(.4,5.,depth)); body=mix(sand*.8,body,smoothstep(0.,.6,depth));
      body*=.75+.35*max(dot(N,uSun),0.); // light scattered back out of the shallow water (it glows turquoise under a high sun)
      vec3 R=reflect(-V,N); vec3 col=mix(body,sky(R)*vec3(.9,.97,1.),min(F,.62));
      col+=vec3(1.,.93,.8)*pow(max(dot(R,uSun),0.),600.)*40.*(.5+n(p*3.+uT*2.));
      // breaking waves: crests that run up the shelf and turn to foam in the last 25 m, and the swash at the edge
      float ph=fract((vW.x-uWL)*.045+uT*.09+n(p*.05)*.3); float crest=smoothstep(.88,.97,ph)*(1.-smoothstep(.97,1.,ph));
      float zone=1.-smoothstep(2.,26.,uWL-vW.x); float foamN=n(p*1.3+vec2(uT*.7,0.))*.6+n(p*4.1-uT*.4)*.4;
      float foam=crest*zone*smoothstep(.35,.7,foamN)+ (1.-smoothstep(0.,2.5,uWL-vW.x))*smoothstep(.45,.8,foamN)*.8;
      col=mix(col,vec3(.9,.93,.92)*(.7+.3*max(uSun.y,0.)),clamp(foam,0.,1.)*.85);
      col=mix(col,vec3(.68,.74,.8),1.-exp(-max(dist-40.,0.)*.0011));
      gl_FragColor=vec4(col,mix(.55,.97,smoothstep(0.,.8,depth)));}`,
  });
  const sea = new THREE.Mesh(geo, mat); G.scene.add(sea); G.sea = sea;
}

// ---------- building generator ----------
const WIN_W = 1.25, WIN_H = 1.3;
let curSkin = null; const soot = []; const posters = [];
// the house being built: its hash, parapet top and per-face window grid, handed to the facade shader as aWx (see weatherize)
let curWx = null;
const laundry = [];
function facadeWindows(face, len, floors, fh0, fh, x, z, rot, variantR, ground = 'res') {
  // face local: x along facade, windows on each floor above ground
  const n = Math.max(1, Math.floor((len - 1) / 3.1));
  const sp = len / n;
  for (let f = 1; f < floors; f++) {
    const y = fh0 + (f - 1) * fh + 1.0;
    for (let i = 0; i < n; i++) {
      const lx = -len / 2 + sp * (i + .5) + (variantR() - .5) * .3;
      const r = variantR(); const cell = r < .42 ? 0 : r < .64 ? 1 : r < .9 ? 2 : 3;
      const g = quad(WIN_W, WIN_H, cell / 4 + .004, 0, (cell + 1) / 4 - .004, 1);
      const m = new THREE.Matrix4().makeRotationY(rot); m.setPosition(x, 0, z);
      g.translate(lx, y + WIN_H / 2, .03); g.applyMatrix4(m); add(MAT.window, g);
      // sill + lintel
      const s = boxUV(WIN_W + .2, .06, .16, 1); s.translate(lx, y - .03, .07); s.applyMatrix4(m); add(MAT.concrete, s);
      const hood = boxUV(WIN_W + .36, .07, .34, 1); hood.translate(lx, y + WIN_H + .12, .17); hood.applyMatrix4(m); add(MAT.slab, hood);
      for (const sx of [-1, 1]) { const fr = boxUV(.07, WIN_H + .1, .09, 1); fr.translate(lx + sx * (WIN_W / 2 + .035), y + WIN_H / 2, .045); fr.applyMatrix4(m); add(MAT.concrete, fr); }
      if (variantR() < .07) laundry.push({ m: m.clone(), lx, y: y + WIN_H + .05 });
      if (variantR() < .18) { const ac = acBox(); ac.translate(lx + WIN_W * .5 + .5, y + .25, .15); ac.applyMatrix4(m); add(MAT.acUnit, ac); ac.computeBoundingBox(); const c = ac.boundingBox.getCenter(new THREE.Vector3()); if (Math.abs(c.z) < 14 && variantR() < .35) (G.soundEmitters ||= []).push({ key: 'ac', pos: c, vol: .35, ref: 1.5, rate: rr(.9, 1.1) }); }
      if (f >= 1 && variantR() < .2) { // balcony: slab + solid plastered parapet (most common in the camp) or steel railing
        const bw = rr(2.2, 3.2); const b = boxUV(bw, .16, 1.15, 1); b.translate(lx, y - 1.0, .575); b.applyMatrix4(m); add(MAT.slab, b, true);
        if (variantR() < .65) { const pw = boxUV(bw, .95, .12, 1); pw.translate(lx, y - .45, 1.1); pw.applyMatrix4(m); add(curSkin, pw); for (const sx of [-1, 1]) { const sw = boxUV(.12, .95, 1.1, 1); sw.translate(lx + sx * (bw / 2 - .06), y - .45, .6); sw.applyMatrix4(m); add(curSkin, sw); } }
        else { const rl = new THREE.BoxGeometry(bw, .05, .05); rl.translate(lx, y - .02, 1.1); rl.applyMatrix4(m); add(MAT.metalDark, rl); for (let q = 0; q <= Math.floor(bw / .14); q++) { const bar = new THREE.BoxGeometry(.018, .92, .018); bar.translate(lx - bw / 2 + q * .14, y - .47, 1.1); bar.applyMatrix4(m); add(MAT.metalDark, bar); } }
        if (variantR() < .35) laundry.push({ m: m.clone(), lx, y: y + .6 });
        if (variantR() < .3) { const tk = new THREE.CylinderGeometry(.3, .3, .8, 10); tk.translate(lx + bw / 2 - .45, y - .52, .6); tk.applyMatrix4(m); add(MAT.black, tk); }
      }
      if (variantR() < .06) { const sh = rr(2, 3.5); soot.push({ pos: new THREE.Vector3(lx, y + WIN_H * .55 + sh / 2, .07).applyMatrix4(m), rot, w: rr(1.6, 2.6), h: sh }); }
    }
  }
}

// an outdoor split-AC condenser: the front face maps to the fan-grille half of its texture, every other face to the
// plain casing half
function acBox() {
  const g = new THREE.BoxGeometry(.8, .5, .3); const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) { const front = n.getZ(i) > .5; uv.setX(i, front ? uv.getX(i) * .5 : .5 + uv.getX(i) * .5); }
  return g;
}
const shopTypes = [];
function shopFront(len, x, z, rot, r, fh0) {
  // each bay is either a closed roller shutter or an open, walk-in shop (3 m deep) with shelves, counter and a fluorescent tube
  const D = 3.0, n = Math.max(1, Math.floor(len / 3.4)); const sp = len / n; const m = new THREE.Matrix4().makeRotationY(rot); m.setPosition(x, 0, z);
  const P = (g, mat, collide = false) => { g.applyMatrix4(m); add(mat, g, collide); };
  const hh = fh0 - .6;
  for (let i = 0; i < n; i++) {
    const lx = -len / 2 + sp * (i + .5); const open = r() < .5; const w = sp - .12;
    // partitions + back wall + floor + ceiling exist for every bay (a closed shutter just hides them)
    for (const sx of [-1, 1]) { const pw = boxUV(.14, hh, D, 1.5); pw.translate(lx + sx * (sp / 2 - .07), hh / 2, -D / 2); P(pw, MAT.plasterGray, true); }
    const bk = boxUV(w, hh, .14, 1.5); bk.translate(lx, hh / 2, -D + .07); P(bk, pick([MAT.plasterWhite, MAT.plasterCream, MAT.plasterGray]), true);
    if (!open) {
      const sh = new THREE.PlaneGeometry(sp - .3, fh0 - .5); const uv = sh.attributes.uv; for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * (sp - .3) / 2, uv.getY(q) * (fh0 - .5) / 2);
      sh.translate(lx, (fh0 - .5) / 2, .02); P(sh, MAT.rustSheet); const sc = new THREE.BoxGeometry(sp - .3, fh0 - .5, .08); sc.translate(lx, (fh0 - .5) / 2, 0); sc.applyMatrix4(m); G.colliders.push(sc);
    } else {
      const fl = new THREE.PlaneGeometry(w, D); fl.rotateX(-Math.PI / 2); fl.translate(lx, .015, -D / 2); P(fl, MAT.tiles);
      const ce = new THREE.PlaneGeometry(w, D); ce.rotateX(Math.PI / 2); ce.translate(lx, hh, -D / 2); P(ce, MAT.ceiling);
      const sh = new THREE.PlaneGeometry(sp - .4, .5); sh.translate(lx, fh0 - .55, .02); P(sh, MAT.rustSheet); // rolled-up shutter box
      // shelves on the back and one side wall, stocked with boxes, bottles and sacks
      const shelfSide = r() < .5 ? -1 : 1;
      for (let k = 0; k < 4; k++) { const y = .35 + k * .55;
        const sb = boxUV(w - .4, .04, .45, 1); sb.translate(lx, y, -D + .32); P(sb, MAT.woodLight);
        for (let q = 0; q < Math.floor((w - .5) / .22); q++) { if (r() < .2) continue; const gw = rr(.1, .2), gh = rr(.12, .38); const gb = boxUV(gw, gh, rr(.12, .3), .5); gb.translate(lx - w / 2 + .35 + q * .22, y + gh / 2 + .02, -D + .32 + rr(-.08, .08)); P(gb, pick(MAT.goods)); }
        if (k < 3) { const ss = boxUV(.4, .04, D - 1.2, 1); ss.translate(lx + shelfSide * (w / 2 - .28), y + .1, -D / 2 + .1); P(ss, MAT.woodLight); for (let q = 0; q < 6; q++) if (r() < .7) { const gh = rr(.15, .3); const gb = boxUV(.2, gh, .18, .5); gb.translate(lx + shelfSide * (w / 2 - .28), y + .12 + gh / 2, -D + 1 + q * .28); P(gb, pick(MAT.goods)); } }
      }
      const sc = new THREE.BoxGeometry(w - .4, 2.4, .5); sc.translate(lx, 1.2, -D + .32); sc.applyMatrix4(m); G.colliders.push(sc);
      const sc2 = new THREE.BoxGeometry(.45, 1.8, D - 1.2); sc2.translate(lx + shelfSide * (w / 2 - .28), .9, -D / 2 + .1); sc2.applyMatrix4(m); G.colliders.push(sc2);
      // counter near the entrance with a scale, sacks of rice/flour on the floor
      const cx = lx - shelfSide * (w / 2 - .55); const ct = boxUV(.7, .95, 1.1, 1); ct.translate(cx, .475, -1.0); P(ct, MAT.wood, true);
      const top = boxUV(.78, .04, 1.18, 1); top.translate(cx, .97, -1.0); P(top, MAT.steel);
      for (let q = 0; q < ri(2, 4); q++) { const sk = new THREE.CapsuleGeometry(.2, .3, 3, 8); sk.scale(1, .9, .7); sk.translate(lx + rr(-.6, .6), .3, -D + 1.1 + rr(0, .5)); P(sk, MAT.tarp[1]); }
      const tube = new THREE.BoxGeometry(1.2, .05, .08); tube.translate(lx, hh - .06, -D / 2); P(tube, MAT.neon);
      if (r() < .5) { const cr = boxUV(.5, .3, .35, .6); cr.translate(lx + rr(-.5, .5), .15, .45); P(cr, MAT.woodLight); } // goods spilling out front
    }
    if (r() < .75) { const sg = new THREE.PlaneGeometry(sp - .3, .75); sg.translate(lx, fh0 - .05, .09); sg.applyMatrix4(m); add(pick(MAT.signs), sg); }
    if (!open && r() < .6) poster(m, lx + rr(-.4, .4), rr(1.2, 1.7), .045, rr(1.6, Math.min(2.6, sp - .5)));
    if (r() < .5) { // fabric awning sloping out over the shop
      const aw = sp - .35, ad = rr(1.1, 1.6), y0 = fh0 - .45; const ag = new THREE.PlaneGeometry(aw, ad, 4, 3); ag.rotateX(-Math.PI / 2 + .42); ag.translate(lx, y0 - Math.sin(.42) * ad / 2, ad / 2 * Math.cos(.42) + .05);
      const ap = ag.attributes.position; for (let q = 0; q < ap.count; q++) ap.setY(q, ap.getY(q) - Math.sin((ap.getX(q) - lx + aw / 2) / aw * Math.PI) * .05);
      ag.applyMatrix4(m); add(pick(MAT.awnings), ag);
      const fr = new THREE.BoxGeometry(aw, .03, .03); fr.translate(lx, y0 - Math.sin(.42) * ad, ad * Math.cos(.42) + .05); fr.applyMatrix4(m); add(MAT.metalDark, fr);
    }
  }
}

const roof = { tanksB: [], tanksW: [], solarP: [], solarT: [], dish: [], rebar: [], panels: [] };
const rubbleQueue = [];
export function residential(cx, cz, w, d, floors, ry, opts = {}) {
  (G.footprints ||= []).push([cx, cz, w, d, ry]);
  const r = rng(Math.floor(cx * 13 + cz * 7 + 999));
  const fh0 = 3.4, fh = 3.0, H = fh0 + (floors - 1) * fh;
  const rs = r(); const skin = opts.skin || (rs < .4 ? MAT.block : rs < .52 ? MAT.sandstone : pick([MAT.plasterCream, MAT.plasterYellow, MAT.plasterWhite, MAT.plasterGray])); curSkin = skin;
  const m = new THREE.Matrix4().makeRotationY(ry); m.setPosition(cx, 0, cz);
  // per face: outward normal, window spacing and the phase that puts a window centre where facadeWindows puts one, in the
  // shader's along-facade coordinate s = dot(xz, (-nz, nx)). From the lot's position, never the RNG, so nothing moves.
  curWx = { h: hash(cx * .173 + 3.1, cz * .291 + 7.7), top: H + .9, faces: [[w, 0, d / 2, 0], [w, 0, -d / 2, Math.PI], [d, w / 2, 0, Math.PI / 2], [d, -w / 2, 0, -Math.PI / 2]].map(([len, fx, fz, fr], i) => {
    const c = new THREE.Vector3(fx, 0, fz).applyMatrix4(m), a = ry + fr, nx = Math.sin(a), nz = Math.cos(a), sp = opts.noWindowsFace === i ? 0 : len / Math.max(1, Math.floor((len - 1) / 3.1));
    return [nx, nz, sp, sp ? ((len / 2 + nz * c.x - nx * c.z) % sp + sp) % sp : 0]; }) };
  const bu = skin === MAT.block ? 2 : 3;
  if (opts.shopFace === 0 || opts.shopFace === 1) { // ground floor is carved out on the market side for walk-in shops
    const SDv = 3.0, sg = opts.shopFace === 0 ? 1 : -1, gh = fh0 - .5;
    const up = boxUV(w, H - gh, d, bu); up.translate(0, gh + (H - gh) / 2, 0); up.applyMatrix4(m); add(skin, up);
    const lo = boxUV(w, gh, d - SDv, bu); lo.translate(0, gh / 2, -sg * SDv / 2); lo.applyMatrix4(m); add(skin, lo);
    for (const sx of [-1, 1]) { const sw = boxUV(.24, gh, SDv, bu); sw.translate(sx * (w / 2 - .12), gh / 2, sg * (d / 2 - SDv / 2)); sw.applyMatrix4(m); add(skin, sw, true); }
  } else { const body = boxUV(w, H, d, bu); body.translate(0, H / 2, 0); body.applyMatrix4(m); add(skin, body); }
  const SD = 3.0; // walk-in shop depth on the market side
  if (opts.shopFace === 0 || opts.shopFace === 1) {
    const up = new THREE.BoxGeometry(w, H - fh0 + .5, d); up.translate(0, (H + fh0 - .5) / 2, 0); up.applyMatrix4(m); G.colliders.push(up);
    const gd = new THREE.BoxGeometry(w, fh0 - .5, d - SD); gd.translate(0, (fh0 - .5) / 2, opts.shopFace === 0 ? -SD / 2 : SD / 2); gd.applyMatrix4(m); G.colliders.push(gd);
  } else { const col = new THREE.BoxGeometry(w, H, d); col.translate(0, H / 2, 0); col.applyMatrix4(m); G.colliders.push(col); }
  // slab edges every floor (Gaza buildings show the concrete floor slabs)
  for (let f = 1; f < floors; f++) { const s = boxUV(w + .12, .22, d + .12, 2); s.translate(0, fh0 + (f - 1) * fh, 0); s.applyMatrix4(m); add(MAT.slab, s); }
  // exposed reinforced-concrete frame: columns at the corners and between window bays
  const colMat = skin === MAT.block || skin === MAT.sandstone ? MAT.concrete : skin;
  [[w, 0, d / 2, 0], [w, 0, -d / 2, Math.PI], [d, w / 2, 0, Math.PI / 2], [d, -w / 2, 0, -Math.PI / 2]].forEach(([len, fx, fz, fr]) => {
    const nb = Math.max(1, Math.floor((len - 1) / 3.1)); const mm = new THREE.Matrix4().makeRotationY(fr).premultiply(m); const p0 = new THREE.Vector3(fx, 0, fz);
    for (let i = 0; i <= nb; i++) { if (i > 0 && i < nb && r() < .35) continue; const cx = -len / 2 + len * i / nb; const cg = boxUV(.32, H - .05, .09, 1); cg.translate(cx + (i === 0 ? .16 : i === nb ? -.16 : 0), (H - .05) / 2, .045); cg.applyMatrix4(new THREE.Matrix4().makeRotationY(fr).setPosition(fx, 0, fz)); cg.applyMatrix4(m); add(colMat, cg); }
  });
  const unfinished = !opts.noTop && floors >= 3 && r() < .3;
  // parapet (unfinished buildings have none: bare slab with columns and rebar)
  if (!unfinished) for (const [pw, pd, px, pz] of [[w, .15, 0, d / 2], [w, .15, 0, -d / 2], [.15, d, w / 2, 0], [.15, d, -w / 2, 0]]) { const p = boxUV(pw, .9, pd, 2); p.translate(px, H + .45, pz); p.applyMatrix4(m); add(skin, p); }
  if (unfinished) { // an extra storey of bare columns, half-built block walls and a partial slab
    const fh2 = 2.9; const cols = []; for (const a of [-1, -.33, .33, 1]) for (const b of [-1, 1]) cols.push([a * (w / 2 - .2), b * (d / 2 - .2)]); for (const b of [-.33, .33]) for (const a of [-1, 1]) cols.push([a * (w / 2 - .2), b * (d / 2 - .2)]);
    for (const [cx, cz] of cols) { const hh = r() < .6 ? fh2 : rr(.6, 2); const c = boxUV(.32, hh, .32, 1); c.translate(cx, H + hh / 2, cz); c.applyMatrix4(m); add(MAT.concrete, c); const tp = new THREE.Vector3(cx, H + hh, cz).applyMatrix4(m); for (let q = 0; q < 4; q++) roof.rebar.push([tp.x + (q % 2 - .5) * .2, tp.y + .45, tp.z + ((q >> 1) - .5) * .2, rr(.6, 1.2)]); }
    if (r() < .6) { const sw = w * rr(.4, .8); const sl = boxUV(sw, .22, d - .2, 2); sl.translate(-w / 2 + sw / 2 + .1, H + fh2, 0); sl.applyMatrix4(m); add(MAT.slab, sl); }
    for (let k = 0; k < ri(1, 3); k++) { const bw = rr(2, w * .6), bh = rr(.6, 1.6); const wl = boxUV(bw, bh, .2, 2); wl.translate(rr(-w / 2 + bw / 2, w / 2 - bw / 2), H + bh / 2, (r() < .5 ? 1 : -1) * (d / 2 - .15)); wl.applyMatrix4(m); add(MAT.block, wl); }
  } else if (r() < .45) { // rooftop stair room with its door
    const rw2 = 3, rd2 = 3, rh2 = 2.6; const px = rr(-w / 2 + rw2 / 2 + .3, w / 2 - rw2 / 2 - .3), pz = rr(-d / 2 + rd2 / 2 + .3, d / 2 - rd2 / 2 - .3);
    const rm = boxUV(rw2, rh2, rd2, 2); rm.translate(px, H + rh2 / 2, pz); rm.applyMatrix4(m); add(skin, rm);
    const dr = new THREE.PlaneGeometry(.9, 2); dr.translate(px, H + 1, pz + rd2 / 2 + .02); dr.applyMatrix4(m); add(MAT.metalDoor, dr);
  }
  // facades: 4 faces (+z is front by default)
  const faces = [[w, 0, d / 2, 0], [w, 0, -d / 2, Math.PI], [d, w / 2, 0, Math.PI / 2], [d, -w / 2, 0, -Math.PI / 2]];
  faces.forEach(([len, fx, fz, fr], i) => {
    const wp = new THREE.Vector3(fx, 0, fz).applyMatrix4(m); const rot = ry + fr;
    if (opts.noWindowsFace === i) return;
    facadeWindows(i, len, floors, fh0, fh, wp.x, wp.z, rot, r);
    const onMarket = opts.shopFace === i;
    if (onMarket) shopFront(len - .4, wp.x, wp.z, rot, r, fh0);
    else if (r() < .8 && len > 6) { // entrance door / ground floor windows
      const mm = new THREE.Matrix4().makeRotationY(rot); mm.setPosition(wp.x, 0, wp.z);
      const dx = (r() - .5) * (len - 3);
      const dg = new THREE.PlaneGeometry(1.1, 2.2); dg.translate(dx, 1.1, .03); dg.applyMatrix4(mm); add(r() < .5 ? MAT.metalDoor : MAT.greenPaint, dg);
      const gw = quad(WIN_W, 1.1, 0 + .004, 0, .25 - .004, 1); gw.translate(dx + (dx > 0 ? -2.2 : 2.2), 1.9, .03); gw.applyMatrix4(mm); add(MAT.window, gw);
      if (r() < .55) poster(mm, dx + (dx > 0 ? -4.5 : 4.5) * rr(.6, 1), rr(1.3, 1.9), .02, rr(1.8, 3));
    }
  });
  // roof stuff
  const rw = new THREE.Vector3();
  const nT = ri(1, 3); for (let k = 0; k < nT; k++) { rw.set(rr(-w / 3, w / 3), H, rr(-d / 3, d / 3)).applyMatrix4(m); (r() < .6 ? roof.tanksB : roof.tanksW).push([rw.x, H + .55, rw.z]); }
  if (r() < .5) { rw.set(rr(-w / 3, w / 3), H, rr(-d / 3, d / 3)).applyMatrix4(m); roof.solarP.push([rw.x, H + .75, rw.z, ry]); roof.solarT.push([rw.x, H + 1.45, rw.z, ry]); }
  if (r() < .45) { rw.set(rr(-w / 3, w / 3), H, rr(-d / 3, d / 3)).applyMatrix4(m); roof.dish.push([rw.x, H + .4, rw.z, r() * 6]); }
  if (!unfinished && r() < .5) { const rows = ri(1, 3), cols = ri(2, 5); const ox = rr(-w / 2 + 1, w / 2 - cols * 1.05 - .5), oz = rr(-d / 2 + 1, d / 2 - rows * 1.9 - .5); for (let a = 0; a < rows; a++) for (let b = 0; b < cols; b++) { rw.set(ox + b * 1.05 + .5, H, oz + a * 1.9 + .8).applyMatrix4(m); roof.panels.push([rw.x, H + .75, rw.z, ry]); } }
  for (let k = 0; k < ri(0, 3); k++) { rw.set(rr(-w / 2.5, w / 2.5), H, rr(-d / 2.5, d / 2.5)).applyMatrix4(m); roof.tanksB.push([rw.x, H + .55, rw.z]); }
  if (r() < .5) for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { rw.set(a * (w / 2 - .3), H, b * (d / 2 - .3)).applyMatrix4(m); const colH = rr(.3, 1.4); const cgeo = boxUV(.35, colH, .35, 1); cgeo.translate(rw.x, H + colH / 2, rw.z); add(MAT.concrete, cgeo); for (let q = 0; q < 4; q++) roof.rebar.push([rw.x + (q % 2 - .5) * .22, H + colH + .4, rw.z + ((q >> 1) - .5) * .22, rr(.6, 1.3)]); }
  // war damage: occasional hole / scorched patch
  if (opts.damage || r() < .16) {
    const nh = r() < .3 ? 2 : 1;
    for (let q = 0; q < nh; q++) { const f = ri(1, floors - 1); const hr = rr(.7, 1.8); const hx = rr(-w / 3, w / 3), hy = fh0 + (f - 1) * fh + rr(.8, 2); const face = r() < .5 ? 1 : -1;
      const hole = new THREE.CircleGeometry(hr, 11); const hp = hole.attributes.position; for (let i = 1; i < hp.count; i++) { const k = rr(.65, 1.15); hp.setXY(i, hp.getX(i) * k, hp.getY(i) * k); }
      if (face < 0) hole.rotateY(Math.PI); hole.translate(hx, hy, face * (d / 2 + .05)); hole.applyMatrix4(m); add(MAT.black, hole);
      const ring = new THREE.RingGeometry(hr * .95, hr * 1.5, 11); if (face < 0) ring.rotateY(Math.PI); ring.translate(hx, hy, face * (d / 2 + .04)); ring.applyMatrix4(m); add(MAT.damaged, ring);
      soot.push({ pos: new THREE.Vector3(hx, hy + hr * 1.3, face * (d / 2 + .07)).applyMatrix4(m), rot: ry + (face < 0 ? Math.PI : 0), w: hr * 2.6, h: hr * 3.4 });
      const base = new THREE.Vector3(hx, 0, face * (d / 2 + 1.2)).applyMatrix4(m); rubbleQueue.push([base.x, base.z, hr * .8]); }
  }
  // drain and water pipes down the facade (roof tanks feed every flat), clamped a hand's width off the wall
  { const np = r() < .75 ? 1 + (r() < .4 ? 1 : 0) : 0;
    for (let k = 0; k < np; k++) { const fi = Math.floor(r() * 4), [len, fx, fz, fr] = faces[fi]; const mm = new THREE.Matrix4().makeRotationY(ry + fr).setPosition(new THREE.Vector3(fx, 0, fz).applyMatrix4(m));
      const px = (r() - .5) * (len - 1), rad = r() < .5 ? .045 : .03, mat = r() < .6 ? MAT.pvcPipe : MAT.rust;
      const v = new THREE.CylinderGeometry(rad, rad, H - .15, 6); v.translate(px, (H - .15) / 2 + .15, .12); v.applyMatrix4(mm); add(mat, v);
      const e = new THREE.CylinderGeometry(rad, rad, .3, 6); e.rotateX(Math.PI / 2); e.translate(px, .15, .25); e.applyMatrix4(mm); add(mat, e);
      for (let f = 1; f < floors; f++) if (r() < .5) { const hz = new THREE.CylinderGeometry(rad * .7, rad * .7, .9 + r() * 1.5, 6); hz.rotateZ(Math.PI / 2); hz.translate(px + (r() < .5 ? -1 : 1) * .6, fh0 + (f - 1) * fh + .35, .1); hz.applyMatrix4(mm); add(mat, hz); } } }
  curWx = null;
  return H;
}

function flushRoof() {
  const inst = (geo, mat, list, f) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { f(p); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); }); im.castShadow = true; im.receiveShadow = true; G.scene.add(im); };
  inst(new THREE.CylinderGeometry(.55, .55, 1.1, 14), new THREE.MeshStandardMaterial({ color: '#1b1a19', roughness: .5 }), roof.tanksB, p => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(0, 0, 0); _o.scale.set(1, 1, 1); });
  inst(new THREE.CylinderGeometry(.6, .6, 1.2, 14), new THREE.MeshStandardMaterial({ color: '#d9d5cc', roughness: .5 }), roof.tanksW, p => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(0, 0, 0); _o.scale.set(1, 1, 1); });
  inst(new THREE.BoxGeometry(2, .06, 1), new THREE.MeshStandardMaterial({ color: '#1e2630', roughness: .15, metalness: .7 }), roof.solarP, p => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(-.7, p[3], 0); _o.scale.set(1, 1, 1); });
  const st = new THREE.CylinderGeometry(.28, .28, 1.7, 12); st.rotateZ(Math.PI / 2);
  inst(st, MAT.steel, roof.solarT, p => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(0, p[3], 0); _o.scale.set(1, 1, 1); });
  inst(new THREE.BoxGeometry(1, .04, 1.7), new THREE.MeshStandardMaterial({ color: '#1a2230', roughness: .2, metalness: .6 }), roof.panels, p => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(-.45, p[3], 0, 'YXZ'); _o.scale.set(1, 1, 1); });
  const dg = new THREE.SphereGeometry(.45, 14, 6, 0, Math.PI * 2, 0, .9); dg.rotateX(-1.2);
  inst(dg, MAT.plastic, roof.dish, p => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(0, p[3], 0); _o.scale.set(1, 1, 1); });
  inst(new THREE.CylinderGeometry(.014, .014, 1, 4), new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: .8, metalness: .6 }), roof.rebar, p => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(rr(-.1, .1), 0, rr(-.1, .1)); _o.scale.set(1, p[3], 1); });
}

function poster(m, lx, y, z, size) {
  const c = pick([0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 7, 0]), u0 = (c % 4) / 4, v0 = c < 4 ? .5 : 0; // canvas row 0 is the top half (v .5..1)
  const g = quad(size, size, u0 + .004, v0 + .004, u0 + .25 - .004, v0 + .5 - .004); g.translate(lx, y, z + .03); g.applyMatrix4(m); add(MAT.posters, g);
}
function flushSoot() {
  if (!soot.length) return;
  const tex = canvasTex(256, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h); const r = rng(4);
    for (let i = 0; i < 90; i++) { const y = h * (.35 + r() * .65) - r() * h * .6, x = w / 2 + (r() - .5) * w * .5 * (1 - y / h * .3); const rad = 20 + r() * 60;
      const gr = g.createRadialGradient(x, y, 1, x, y, rad); gr.addColorStop(0, `rgba(18,15,13,${.08 + r() * .1})`); gr.addColorStop(1, 'rgba(18,15,13,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
    const fade = g.createLinearGradient(0, 0, 0, h); fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(.25, 'rgba(0,0,0,.4)'); fade.addColorStop(1, 'rgba(0,0,0,0)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, 0, w, h);
  }, { repeat: false });
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 1, color: '#ffffff' });
  const geos = soot.map(sq => { const g = new THREE.PlaneGeometry(sq.w, sq.h); g.rotateY(sq.rot); g.translate(sq.pos.x, sq.pos.y, sq.pos.z); return g; });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat); mesh.renderOrder = 1; G.scene.add(mesh);
}

// ---------- blocks ----------
function blocks() {
  const xs = [L.market.x0 + 20, ...L.cross, 250]; // x boundaries
  const zsN = [-172, -122, -62, -4.5], zsS = [4.5, 62, 122, 172];
  const T = L.target;
  const lots = [];
  const addBand = (x0, x1, z0, z1, front) => {
    // lots along the band; front = 'south'|'north' face toward main street
    let x = x0 + .6;
    while (x < x1 - 5) {
      const w = Math.min(rr(9, 17), x1 - .6 - x); if (w < 6) break;
      const d = Math.min(rr(10, 15), z1 - z0 - 1);
      const cz = front === 'n' ? z1 - .8 - d / 2 : z0 + .8 + d / 2;
      lots.push({ cx: x + w / 2, cz, w, d, front });
      x += w + (R() < .35 ? rr(1.5, 3) : .25);
    }
  };
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = (i === 0 ? xs[0] : xs[i] + L.crossW / 2), x1 = xs[i + 1] - (i + 1 < xs.length - 1 ? L.crossW / 2 : 0);
    // north side of market: two bands (front toward market, back toward lane)
    for (const [za, zb] of [[-62 + L.laneW / 2, -4.5], [-122 + L.laneW / 2, -62 - L.laneW / 2], [-172, -122 - L.laneW / 2]]) {
      addBand(x0, x1, za, (za + zb) / 2 - .5, 's_back'); addBand(x0, x1, (za + zb) / 2 + .5, zb, 'n');
    }
    for (const [za, zb] of [[4.5, 62 - L.laneW / 2], [62 + L.laneW / 2, 122 - L.laneW / 2], [122 + L.laneW / 2, 172]]) {
      addBand(x0, x1, za, (za + zb) / 2 - .5, 's'); addBand(x0, x1, (za + zb) / 2 + .5, zb, 'n_back');
    }
  }
  const openLots = [];
  const EXCL = [[T.x0 - 1.2, T.x1 + 1.2, T.z0 - 1.5, T.z1 + 1], [L.alpha.x - 8, L.alpha.x + 8, L.alpha.z - 5, L.alpha.z + 11], [-138, -118, -44, -20]];
  for (const lt of lots) {
    if (EXCL.some(([a0, a1, b0, b1]) => lt.cx + lt.w / 2 > a0 && lt.cx - lt.w / 2 < a1 && lt.cz + lt.d / 2 > b0 && lt.cz - lt.d / 2 < b1)) continue;
    // stuck-vehicle junction keeps sight lines
    const dist = Math.hypot(lt.cx - 20, lt.cz);
    const r = R();
    if (r < .08 && Math.abs(lt.cz) > 8) { openLots.push(lt); continue; }
    const nearRoute = Math.abs(lt.cz) < 30 && lt.cx > -120 && lt.cx < 140;
    const floors = nearRoute ? ri(3, 5) : ri(2, 6);
    const frontToMarket = Math.abs(lt.cz) < 30;
    const face = lt.front === 'n' ? 0 : lt.front === 's' ? 1 : (lt.front === 's_back' ? 1 : 0);
    // residential() uses +z as face 0; market is at z=0 so buildings north (cz<0) face +z (0), south face -z (1)
    const shopFace = frontToMarket ? (lt.cz < 0 ? 0 : 1) : -1;
    if (R() < .06 && !nearRoute) { collapsed(lt); continue; }
    residential(lt.cx, lt.cz, lt.w, lt.d, floors, 0, { shopFace });
  }
  // the market street ends in a T-junction: a block closes the view behind the truck at the start of the ride
  residential(258.5, 0, 11, 20, 5, 0, {}); residential(258.5, -17, 11, 12, 3, 0, {}); residential(258.5, 17, 11, 12, 4, 0, {});
  return openLots;
}

function collapsed(lt) {
  const m = A.models.ruin; if (!m) return;
  const o = m.scene.clone(); o.position.set(lt.cx, 0, lt.cz); o.rotation.y = R() * 6; const s = Math.min(lt.w / 10.8, lt.d / 8.6) * 1.1; o.scale.setScalar(s);
  o.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } }); G.scene.add(o);
  const col = new THREE.BoxGeometry(lt.w * .8, 2.2, lt.d * .8); col.translate(lt.cx, 1.1, lt.cz); G.colliders.push(col);
}

// ---------- tents (displaced families) ----------
function tents(lots) {
  const r = rng(33);
  for (const lt of lots) {
    const n = Math.floor(lt.w * lt.d / 30);
    for (let i = 0; i < n; i++) tent(lt.cx + rr(-lt.w / 2 + 2, lt.w / 2 - 2), lt.cz + rr(-lt.d / 2 + 2, lt.d / 2 - 2), r() * 6, r);
  }
  // beach tent line along coastal road (west of it)
  for (let z = -160; z < 160; z += rr(4.5, 7)) if (Math.abs(z - L.lz.z) > 30) tent(L.coast.x - 14 - rr(0, 10), z, rr(-.3, .3), r);
}
function tent(x, z, ry, r) {
  const w = rr(2.6, 3.6), d = rr(3, 4.2), h = rr(1.8, 2.3);
  // a family tent of tarp over a pole frame: walls that belly in and out, a low ridge, a roof sagging between the poles
  const g = new THREE.BoxGeometry(w, h * .72, d, 6, 3, 8); g.translate(0, h * .36, 0);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    if (py > h * .7) p.setY(i, h - Math.abs(px) / (w / 2) * h * .3 - Math.sin((pz / d + .5) * Math.PI * 3) * .07 - Math.sin((px / w + .5) * Math.PI * 2) * .04);
    else if (py > .05) { const bulge = Math.sin((pz / d + .5) * Math.PI * 4 + x) * .03 + Math.sin(py * 3 + z) * .02; p.setX(i, px + Math.sign(px) * bulge); } }
  g.computeVertexNormals(); place(g, x, groundY(x), z, ry); add(pick(MAT.tarp), g);
  const col = new THREE.BoxGeometry(w, h, d); place(col, x, groundY(x) + h / 2, z, ry); G.colliders.push(col);
}

// ---------- market stalls, props ----------
const produce = { red: [], green: [], orange: [], brown: [] };
// rnd/prod: the ride-in stalls are built after the rest of the town from their own generator (see rideStalls)
function stall(x, z, ry, rnd = R, prod = produce) {
  const rr = (a, b) => a + (b - a) * rnd(), pick = a => a[Math.floor(rnd() * a.length)];
  (G.stalls ||= []).push({ x, z, ry });
  const m = new THREE.Matrix4().makeRotationY(ry); m.setPosition(x, 0, z);
  const tb = boxUV(2.2, .08, 1.1, 1); tb.translate(0, .82, 0); tb.applyMatrix4(m); add(MAT.woodLight, tb, true);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const lg = new THREE.BoxGeometry(.06, .82, .06); lg.translate(a * 1.02, .41, b * .5); lg.applyMatrix4(m); add(MAT.wood, lg); }
  // crates with produce
  for (let i = 0; i < 4; i++) {
    const cx = -.8 + i * .53; const cr = boxUV(.48, .18, .36, .5); cr.translate(cx, .95, 0); cr.applyMatrix4(m); add(MAT.woodLight, cr);
    const kind = pick(['red', 'green', 'orange', 'brown']); const v = new THREE.Vector3();
    for (let k = 0; k < 14; k++) { v.set(cx + rr(-.19, .19), 1.07 + rr(0, .06), rr(-.14, .14)).applyMatrix4(m); prod[kind].push(v.clone()); }
  }
  // canopy (tarp on poles)
  for (const [a, b] of [[-1.15, -.6], [1.15, -.6], [-1.15, .6], [1.15, .6]]) { const pl = new THREE.CylinderGeometry(.025, .025, 2.4, 5); pl.translate(a, 1.2, b); pl.applyMatrix4(m); add(MAT.metalDark, pl); }
  const cp = new THREE.PlaneGeometry(2.6, 1.6, 6, 4); cp.rotateX(-Math.PI / 2 + .12); const pp = cp.attributes.position; for (let i = 0; i < pp.count; i++) pp.setY(i, pp.getY(i) - Math.sin((pp.getX(i) + 1.3) / 2.6 * Math.PI) * .08);
  cp.translate(0, 2.35, 0); cp.applyMatrix4(m); add(pick(MAT.tarp), cp);
  const col = new THREE.BoxGeometry(2.2, 1, 1.1); col.translate(0, .5, 0); col.applyMatrix4(m); G.colliders.push(col);
}
const melons = [];
const PRODUCE = produce, MELONS = melons, RW = () => R();
function melonPile(x, z) { const n = ri(8, 18); for (let i = 0; i < n; i++) { const a = R() * 6.28, d = Math.sqrt(R()) * .7; const layer = i > n * .6 ? 1 : 0; melons.push([x + Math.cos(a) * d * (1 - layer * .4), .14 + layer * .22, z + Math.sin(a) * d * (1 - layer * .4), R() * 6]); } }
function donkeyCart(x, z, ry) {
  const m = new THREE.Matrix4().makeRotationY(ry); m.setPosition(x, 0, z); const P = (g, mat) => { g.applyMatrix4(m); add(mat, g); };
  const hide = MAT.donkey, wood = MAT.woodLight;
  // (the donkey itself is unhitched: a capsule animal read as a toy; the cart rests on its shafts, as they do when parked)
  const bed = boxUV(1.4, .08, 1.1, 1); bed.translate(0, .62, 0); P(bed, wood);
  for (const sz of [-.55, .55]) { const side = boxUV(1.4, .22, .04, 1); side.translate(0, .76, sz); P(side, wood); const wh = new THREE.CylinderGeometry(.32, .32, .08, 14); wh.rotateX(Math.PI / 2); wh.translate(-.05, .32, sz + .07 * Math.sign(sz)); P(wh, MAT.black); const sh = new THREE.BoxGeometry(1.3, .04, .04); sh.rotateZ(-.42); sh.translate(1.2, .42, sz * .45); P(sh, MAT.wood); }
  for (let k = 0; k < 6; k++) { const b = boxUV(rr(.3, .5), rr(.2, .35), rr(.3, .45), 1); b.translate(rr(-.5, .5), .8, rr(-.35, .35)); P(b, pick([MAT.woodLight, MAT.plasticBlue, MAT.tarp[1]])); }
  G.colliders.push(new THREE.BoxGeometry(2.3, 1.0, 1.2).translate(.45, .5, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z))); // cart and shafts only: no invisible wall where the donkey stood
}
function flushProduce(produce = PRODUCE, melons = MELONS, R = RW) {
  const rr = (a, b) => a + (b - a) * R();
  if (melons.length) { const t = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#3f6a2a'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 16) { g.fillStyle = '#1f3f18'; g.beginPath(); for (let y = 0; y <= h; y += 8) g.lineTo(x + Math.sin(y * .2 + x) * 3, y); for (let y = h; y >= 0; y -= 8) g.lineTo(x + 6 + Math.sin(y * .2 + x) * 3, y); g.fill(); } });
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(.2, 14, 10), new THREE.MeshStandardMaterial({ map: t, roughness: .45 }), melons.length); melons.forEach((p, i) => { _o.position.set(p[0], p[1], p[2]); _o.rotation.set(0, p[3], Math.PI / 2); _o.scale.set(.75, 1, .75); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); }); im.castShadow = true; im.receiveShadow = true; G.scene.add(im); }
  const cols = { red: '#b3261e', green: '#4f7a2a', orange: '#e0802a', brown: '#9a7a4a' };
  for (const [k, list] of Object.entries(produce)) {
    if (!list.length) continue;
    // thousands of these: 20 triangles each, with welded vertices so they shade round instead of cut like gems
    let g = k === 'green' ? new THREE.CapsuleGeometry(.035, .12, 2, 5).rotateZ(Math.PI / 2) : new THREE.IcosahedronGeometry(.045, 0); if (k !== 'green') { g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); g.computeVertexNormals(); }
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .5 }), list.length);
    const base = new THREE.Color(cols[k]); const tc = new THREE.Color();
    list.forEach((p, i) => { _o.position.copy(p); _o.rotation.set(R() * 3, R() * 3, R() * 3); _o.scale.setScalar(rr(.85, 1.2)); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); tc.copy(base).offsetHSL(rr(-.02, .02), rr(-.1, .05), rr(-.08, .06)); im.setColorAt(i, tc); });
    im.castShadow = false; G.scene.add(im); // fruit-sized shadows vanish in the crate's own shadow; not worth a shadow pass
  }
}
function plasticChair(x, z, ry, mat) {
  const parts = [];
  const seat = boxUV(.44, .04, .42, 1); seat.translate(0, .45, 0); parts.push(seat);
  const back = boxUV(.44, .42, .04, 1); back.rotateX(-.12); back.translate(0, .68, -.2); parts.push(back);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const lg = new THREE.CylinderGeometry(.018, .025, .45, 5); lg.rotateZ(a * .08); lg.rotateX(b * .08); lg.translate(a * .19, .225, b * .18); parts.push(lg); }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed ? p.toNonIndexed() : p)); place(g, x, 0, z, ry); add(mat, g);
}
function generator(x, z) {
  const m = new THREE.Matrix4().makeRotationY(R() * .4 - .2); m.setPosition(x, 0, z);
  const body = boxUV(.9, .55, .55, 1); body.translate(0, .38, 0); body.applyMatrix4(m); add(MAT.genRed || MAT.plasticBlue, body);
  const fr = boxUV(.96, .06, .6, 1); fr.translate(0, .08, 0); fr.applyMatrix4(m); add(MAT.metalDark, fr);
  const tank = new THREE.CylinderGeometry(.17, .17, .5, 10); tank.rotateZ(Math.PI / 2); tank.translate(0, .76, 0); tank.applyMatrix4(m); add(MAT.metalDark, tank);
  const ex = new THREE.CylinderGeometry(.03, .03, .5, 6); ex.translate(.38, .8, -.18); ex.applyMatrix4(m); add(MAT.rust, ex);
  G.colliders.push(new THREE.BoxGeometry(1, .9, .7).translate(x, .45, z));
}
function gasCylinder(x, z) { const g = new THREE.CylinderGeometry(.16, .16, .6, 10); g.translate(x, .3, z); add(MAT.plasticBlue, g); const t = new THREE.CylinderGeometry(.05, .05, .08, 8); t.translate(x, .64, z); add(MAT.steel, t); }
// a heap of blast rubble: a dusty mound of crushed concrete with slabs, broken blocks and chunks of every size on it
// (many small, few large) and bent rebar sticking out. Advances the world RNG as the old version did (see garbage()).
const rubR = rng(4242);
function rubblePile(x, z, s) {
  const n0 = ri(6, 14); for (let i = 0; i < n0 * 8 + 15; i++) R();
  const r = rubR, rad = 1.35 * s, hgt = .5 * s;
  const mh = (dx, dz) => { const q = Math.hypot(dx, dz) / rad; return q >= 1 ? 0 : hgt * (1 - q * q) * (.8 + .2 * Math.sin(dx * 3.1 + dz * 2.3)); };
  const mound = new THREE.CircleGeometry(rad * 1.08, 20, 0, Math.PI * 2); mound.rotateX(-Math.PI / 2); { const p = mound.attributes.position; for (let i = 0; i < p.count; i++) { const dx = p.getX(i), dz = p.getZ(i); p.setY(i, mh(dx, dz) + (Math.hypot(dx, dz) > .05 ? (r() - .5) * .08 * s : 0)); } }
  mound.computeVertexNormals(); mound.translate(x, .01, z); add(MAT.rubble, mound);
  const n = Math.round(22 * s + 8);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * rad * .95, dx = Math.cos(a) * d, dz = Math.sin(a) * d; const sz = (.06 + Math.pow(r(), 2.6) * .55) * s;
    const g = r() < .3 ? boxUV(sz * 2.2, sz * .9, sz * 1.1, 1) : new THREE.DodecahedronGeometry(sz, 0); g.scale(1, .45 + r() * .5, .7 + r() * .6);
    place(g, x + dx, mh(dx, dz) + sz * .25, z + dz, r() * 6.28, (r() - .5) * .9, (r() - .5) * .9); add(r() < .12 ? MAT.block : MAT.rubble, g);
  }
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) { const L = (.6 + r() * 1.2) * s; const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3((r() - .5) * .3, L * .5, (r() - .5) * .3), new THREE.Vector3((r() - .5) * .8, L * (.6 + r() * .3), (r() - .5) * .8));
    const rb = new THREE.TubeGeometry(c, 6, .007, 4, false); const a = r() * 6.28, d = r() * rad * .7; place(rb, x + Math.cos(a) * d, mh(Math.cos(a) * d, Math.sin(a) * d) - .1, z + Math.sin(a) * d, r() * 6.28, (r() - .5) * .8, (r() - .5) * .8); add(MAT.rust, rb); }
  const col = new THREE.CylinderGeometry(1.1 * s, 1.4 * s, .5 * s, 8); col.translate(x, .25 * s, z); G.colliders.push(col);
}
// rubbish heaps against the walls: tied bin bags, torn cardboard, bottles and cans, all instanced (one draw call each).
// The global world RNG is still advanced exactly as the old blob version did, so everything generated after it keeps
// its place; the heap itself draws from its own generator.
const trash = { bags: [], card: [], bottles: [] }; const trashR = rng(7070);
function garbage(x, z) {
  for (let i = 0; i < 32; i++) R();
  const r = trashR, n = 3 + Math.floor(r() * 5), rad = .5 + r() * .5;
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; trash.bags.push([x + Math.cos(a) * d, z + Math.sin(a) * d, .6 + r() * .6, r() * 6.28, r() < .55 ? 0 : r() < .6 ? 1 : 2, i > n * .6 && r() < .5 ? 1 : 0]); }
  for (let i = 0; i < 1 + Math.floor(r() * 3); i++) { const a = r() * 6.28, d = rad * (.4 + r() * .9); trash.card.push([x + Math.cos(a) * d, z + Math.sin(a) * d, r() * 6.28, (r() - .5) * .5, .7 + r() * .7]); }
  for (let i = 0; i < 3 + Math.floor(r() * 7); i++) { const a = r() * 6.28, d = rad * (.3 + r() * 1.4); trash.bottles.push([x + Math.cos(a) * d, z + Math.sin(a) * d, r() * 6.28, r() < .6 ? Math.PI / 2 : 0, Math.floor(r() * 4)]); }
}
function flushTrash() {
  const o = new THREE.Object3D(), c = new THREE.Color();
  // a bin bag: a squashed, lumpy sphere with a knotted neck
  const bag = new THREE.SphereGeometry(.3, 10, 7); { const p = bag.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), zz = p.getZ(i); const k = 1 + .13 * Math.sin(x * 17 + zz * 11) * Math.cos(y * 13) + .06 * Math.sin(zz * 29 + y * 21); p.setXYZ(i, x * k, (y < 0 ? y * .55 : y * .9) * k + .16, zz * k); } }
  const neck = new THREE.ConeGeometry(.07, .16, 7); neck.translate(0, .5, 0); const bagG = mergeGeometries([bag.toNonIndexed(), neck.toNonIndexed()]); bagG.computeVertexNormals();
  const bagM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .38, metalness: 0 });
  const bags = new THREE.InstancedMesh(bagG, bagM, Math.max(1, trash.bags.length)); const cols = ['#161616', '#23407a', '#c9c7bf'];
  trash.bags.forEach(([x, z, s, ry, col, up], i) => { o.position.set(x, groundY(x, z) + up * .32 * s, z); o.rotation.set((trashR() - .5) * .5, ry, (trashR() - .5) * .5); o.scale.set(s * (1 + (trashR() - .5) * .3), s * (.75 + trashR() * .4), s); o.updateMatrix(); bags.setMatrixAt(i, o.matrix); bags.setColorAt(i, c.set(cols[col]).multiplyScalar(.85 + trashR() * .3)); });
  bags.count = trash.bags.length; bags.castShadow = bags.receiveShadow = true; G.scene.add(bags);
  // cardboard: a flattened, creased carton
  const card = new THREE.BoxGeometry(.6, .025, .45, 3, 1, 3); { const p = card.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.abs(p.getX(i)) * .12 * Math.sin(p.getZ(i) * 9)); } card.computeVertexNormals();
  const cards = new THREE.InstancedMesh(card, MAT.goods[0], Math.max(1, trash.card.length));
  trash.card.forEach(([x, z, ry, tilt, s], i) => { o.position.set(x, groundY(x, z) + .03 + Math.abs(tilt) * .2, z); o.rotation.set(tilt, ry, 0); o.scale.setScalar(s); o.updateMatrix(); cards.setMatrixAt(i, o.matrix); });
  cards.count = trash.card.length; cards.receiveShadow = cards.castShadow = true; G.scene.add(cards);
  // bottles and cans lying about
  const btl = new THREE.CylinderGeometry(.035, .038, .26, 8); btl.translate(0, .13, 0); const cap = new THREE.CylinderGeometry(.014, .016, .05, 6); cap.translate(0, .28, 0); const btlG = mergeGeometries([btl.toNonIndexed(), cap.toNonIndexed()]);
  const bm = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .18, metalness: .1 });
  const btls = new THREE.InstancedMesh(btlG, bm, Math.max(1, trash.bottles.length)); const bc = ['#5f7f63', '#c8d2d6', '#9b2a22', '#b7b2a4'];
  trash.bottles.forEach(([x, z, ry, lie, col], i) => { o.position.set(x, groundY(x, z) + (lie ? .035 : 0), z); o.rotation.set(0, ry, lie); o.scale.setScalar(col === 2 ? .8 : 1); o.updateMatrix(); btls.setMatrixAt(i, o.matrix); btls.setColorAt(i, c.set(bc[col])); });
  btls.count = trash.bottles.length; btls.castShadow = false; G.scene.add(btls);
}

function modelAt(key, x, z, ry, s = 1, collide = null, tint = null) {
  const m = A.models[key]; if (!m) return null;
  const o = m.scene.clone(true); o.position.set(x, groundY(x), z); o.rotation.y = ry; o.scale.setScalar(s);
  o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; if (tint) { c.material = c.material.clone(); c.material.color.multiply(new THREE.Color(tint)); c.material.roughness = Math.max(.6, c.material.roughness); } } });
  G.scene.add(o);
  if (collide) { const [w, h, d] = collide; const cg = new THREE.BoxGeometry(w, h, d); place(cg, x, groundY(x) + h / 2, z, ry); G.colliders.push(cg); }
  return o;
}

function streetLife() {
  // stalls along both sides of the market between x -40..120 (leave the target entrance clear)
  for (let x = -40; x < 125; x += rr(2.8, 4.2)) {
    if (x > 30 && x < 58) continue;
    if (Math.abs(x - 10) < 5 || Math.abs(x - 70) < 5) continue;
    if ([-18, 66, 104, -60, 150].some(c => Math.abs(x - c - .9) < 3.2)) continue; // donkey carts park here
    if (R() < .75) stall(x, -3.2, 0);
    if (R() < .75) stall(x + 1.4, 3.2, Math.PI);
  }
  for (let i = 0; i < 40; i++) { const x = rr(-60, 130), z = R() < .5 ? rr(-4, -3.2) : rr(3.2, 4); if (x > 32 && x < 56) continue; plasticChair(x, z, R() * 6, pick([MAT.plastic, MAT.plasticGreen, MAT.plastic])); }
  for (let i = 0; i < 16; i++) gasCylinder(rr(-50, 120), R() < .5 ? -3.9 : 3.9);
  // diesel generators feeding the shops (most of the camp runs on them) and idling motorbikes
  for (let x = -120; x < 200; x += rr(18, 30)) { if (x > 30 && x < 56) continue; const z = R() < .5 ? -4.1 : 4.1; generator(x, z); G.soundEmitters.push({ key: 'gen', pos: new THREE.Vector3(x, .5, z), vol: .5, ref: 2.5, rate: rr(.85, 1.15) }); }
  // parked / wrecked cars
  const cars = [['hatch', 4.1, 1.5, 1.8, '#a8a296'], ['suv', 4.9, 1.9, 2.1, '#8a8478'], ['hatch', 4.1, 1.5, 1.8, '#c9c3b0'], ['suv', 4.9, 1.9, 2.1, '#6e6a62']];
  const spots = [[-35, 3.1, .02], [95, -3.2, Math.PI], [140, 3.2, .03], [-85, -3.85, Math.PI + .05], [-128, 3.3, 0], [175, -3.3, Math.PI], [-20, 48, 1.5], [70, -40, 1.6], [-50, -28, 1.57]];
  spots.forEach((s, i) => { const c = cars[i % cars.length]; modelAt(c[0], s[0], s[1], s[2] + Math.PI / 2, 1, [c[3], c[2], c[1]], c[4]); }); // collider: length runs along the car
  // rubble and garbage
  for (let i = 0; i < 26; i++) { const x = rr(-280, 240), z = R() < .5 ? rr(-4, 4) : rr(-160, 160); if (Math.abs(z) < 5.5 && x > -215) continue; /* keep the market street and vehicle routes clear */ if (x > 25 && x < 55 && Math.abs(z) < 25) continue; rubblePile(x, z, rr(.8, 1.6)); }
  for (let i = 0; i < 70; i++) { const x = rr(-250, 230), z = R() < .6 ? (R() < .5 ? -4.2 : 4.2) : rr(-150, 150); garbage(x, z); }
  for (const st of G.stalls) if (R() < .3) melonPile(st.x + rr(-1.2, 1.2), st.z + (st.z < 0 ? .9 : -.9));
  for (const [x, z, ry] of [[-18, 3.4, Math.PI], [66, -3.4, 0], [104, 3.4, Math.PI], [-60, -3.4, 0], [150, 3.4, Math.PI]]) donkeyCart(x, z, ry);
  // barrels
  for (let i = 0; i < 10; i++) modelAt('barrel', rr(-120, 140), R() < .5 ? -4 : 4, R() * 6, 1, [.6, .9, .6], '#8a7a6a');
  // jersey barriers near coastal road junction
  for (let i = 0; i < 4; i++) modelAt('jersey', L.coast.x + 9, -8 + i * 4.2, Math.PI / 2, 1, [.6, .9, 4]);
  flushProduce(); flushTrash();
}

// thin cable geometry from segment pairs [a0,b0,a1,b1,...]: a 4-sided tube per segment, so wires keep a true width at
// any distance, catch the sun, cast hair-thin shadows and get antialiased like everything else (GL lines are 1 px)
export function cableGeometry(pts, r = .009) {
  const pos = [], nrm = [], idx = []; const d = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const a = pts[i], b = pts[i + 1]; d.subVectors(b, a); if (d.lengthSq() < 1e-8) continue; d.normalize();
    u.crossVectors(d, Math.abs(d.y) > .9 ? side : up).normalize(); w.crossVectors(d, u).normalize(); const base = pos.length / 3;
    for (let k = 0; k < 4; k++) { const ang = k * Math.PI / 2; const nx = u.x * Math.cos(ang) + w.x * Math.sin(ang), ny = u.y * Math.cos(ang) + w.y * Math.sin(ang), nz = u.z * Math.cos(ang) + w.z * Math.sin(ang);
      pos.push(a.x + nx * r, a.y + ny * r, a.z + nz * r, b.x + nx * r, b.y + ny * r, b.z + nz * r); nrm.push(nx, ny, nz, nx, ny, nz); }
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; const a0 = base + k * 2, b0 = a0 + 1, a1 = base + k2 * 2, b1 = a1 + 1; idx.push(a0, a1, b0, b0, a1, b1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx); return g;
}

// ---------- utility poles & hanging wires ----------
function wires() {
  const pts = [];
  const poles = [];
  for (let x = L.market.x0 + 10; x < L.market.x1; x += rr(22, 30)) for (const z of [-4.3, 4.3]) {
    if (x > 34 && x < 54 && z < 0) continue;
    poles.push([x + rr(-2, 2), z]);
  }
  const pg = []; poles.forEach(([x, z]) => { const g = new THREE.CylinderGeometry(.09, .13, 8, 7); g.translate(x, 4, z); pg.push(g); const cb = new THREE.BoxGeometry(.08, .08, 1.4); cb.translate(x, 7.6, z); pg.push(cb); G.colliders.push(new THREE.CylinderGeometry(.13, .13, 8, 6).translate(x, 4, z)); });
  add(new THREE.MeshStandardMaterial({ color: '#4a4540', roughness: .8 }), mergeGeometries(pg.map(g => g.index ? g.toNonIndexed() : g)));
  const sag = (a, b, s, n = 10) => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n; const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1); p0.y -= Math.sin(t0 * Math.PI) * s; p1.y -= Math.sin(t1 * Math.PI) * s; pts.push(p0, p1); } };
  const side = z => poles.filter(p => Math.sign(p[1]) === Math.sign(z)).sort((a, b) => a[0] - b[0]);
  for (const z of [-4.3, 4.3]) { const ps = side(z); for (let i = 0; i < ps.length - 1; i++) for (let k = 0; k < 4; k++) sag(new THREE.Vector3(ps[i][0], 7.4 - k * .25, ps[i][1] + (k - 1.5) * .3), new THREE.Vector3(ps[i + 1][0], 7.4 - k * .25, ps[i + 1][1] + (k - 1.5) * .3), rr(.4, .9)); }
  // drops to buildings and across the street
  poles.forEach(([x, z]) => { for (let k = 0; k < ri(2, 5); k++) { const tz = z < 0 ? rr(-9, -7) : rr(7, 9); sag(new THREE.Vector3(x, 7.2, z), new THREE.Vector3(x + rr(-6, 6), rr(4, 8), tz), rr(.2, .6), 6); } if (R() < .5) sag(new THREE.Vector3(x, 7.3, z), new THREE.Vector3(x + rr(-4, 4), 7.1, -z), rr(.5, 1.2)); });
  const cables = new THREE.Mesh(cableGeometry(pts, .01), MAT.cable); cables.castShadow = true; cables.receiveShadow = true; G.scene.add(cables);
}

// ---------- distant low-detail fill ----------
function distantFill() {
  const geos = [];
  for (let i = 0; i < 700; i++) {
    const a = R() * Math.PI * 2, d = rr(190, 520); const x = -40 + Math.cos(a) * d * 1.2, z = Math.sin(a) * d;
    if (x < L.beachX + 30) continue;
    const w = rr(8, 18), dd = rr(8, 16), h = rr(6, 20);
    // never inside the playable town: keep clear of every street and of the detailed blocks around the route
    if (onStreet(x, z, Math.max(w, dd) / 2 + 3) || (x > -300 && x < 290 && Math.abs(z) < 60)) continue;
    const g = new THREE.BoxGeometry(w, h, dd); g.translate(x, h / 2, z); g.deleteAttribute('uv');
    // per-building plaster tint (grey block, cream, sand, off-white), baked into vertex colours so the town stays one draw call
    const k = hash(x * .37, z * .21), t = new THREE.Color(k < .35 ? '#9a958c' : k < .6 ? '#cbbd9e' : k < .8 ? '#b8a684' : '#d6d1c4'); const cols = new Float32Array(g.attributes.position.count * 3); for (let q = 0; q < cols.length; q += 3) { cols[q] = t.r; cols[q + 1] = t.g; cols[q + 2] = t.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geos.push(g);
  }
  // seen from 200-500 m: storeys of dark window openings, slab lines and a darker ground floor, all from world position
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: '#ffffff' });
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 wn = normalize(inverseTransformDirection(normal, viewMatrix)); vec3 p = vGIw; float up = step(.5, wn.y);
        float t = abs(wn.x) > .5 ? p.z : p.x; float fy = fract((p.y - .4) / 3.), fx = fract(t / 3.1 + floor(p.y / 3.) * .37);
        float cell = fract(sin(dot(floor(vec2(t / 3.1, p.y / 3.)), vec2(12.9, 78.2)) + floor(p.x * .05) * 3.1) * 4375.5);
        float win = (1. - up) * step(1., p.y) * step(.34, fy) * step(fy, .76) * step(.3, fx) * step(fx, .7);
        vec3 wc = cell < .25 ? vec3(.46, .42, .36) : cell < .35 ? vec3(.3, .36, .44) : vec3(.05, .05, .055);
        diffuseColor.rgb = mix(diffuseColor.rgb, wc, win);
        diffuseColor.rgb *= 1. - (1. - up) * .35 * (1. - step(.035, abs(fract(p.y / 3.) - .02)));   // slab lines
        diffuseColor.rgb *= mix(1., .72, (1. - up) * (1. - step(3.2, p.y)));                          // grimy ground floor
        diffuseColor.rgb *= mix(1., .82, up); }`);
  };
  m.customProgramCacheKey = () => 'farTown';
  const mesh = new THREE.Mesh(mergeGeometries(geos), m); mesh.receiveShadow = true; G.scene.add(mesh);
}

// ---------- Alpha team's building (Diamond) + other landmarks ----------
function landmarks() {
  residential(L.alpha.x, L.alpha.z + 3, 13, 12, 4, 0, { skin: MAT.plasterCream, shopFace: 1 });
  // mosque minaret visible down the street
  const mx = -128, mz = -24; const parts = [];
  const sh = boxUV(3, 26, 3, 3); sh.translate(mx, 13, mz); parts.push(sh);
  const bal = boxUV(4.2, .7, 4.2, 2); bal.translate(mx, 21, mz); parts.push(bal);
  const top = boxUV(2.2, 4, 2.2, 2); top.translate(mx, 28, mz); parts.push(top);
  parts.forEach(p => add(MAT.plasterWhite, p));
  const cone = new THREE.ConeGeometry(1.3, 3, 8); cone.translate(mx, 31.5, mz); add(new THREE.MeshStandardMaterial({ color: '#2a6a5a', roughness: .5, metalness: .3 }), cone);
  residential(-128, -34, 16, 14, 2, 0, { skin: MAT.plasterWhite });
}


// ---------- date palms ----------
function palmTextures() {
  // bark: overlapping diamond leaf bases (the "boots" left where old fronds were cut), grey-brown and fibrous
  const bark = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#5e5242'; g.fillRect(0, 0, w, h); const r = rng(61);
    for (let row = 0; row < 18; row++) for (let c = -1; c < 5; c++) { const x = c * 64 + (row % 2) * 32, y = row * 30;
      const t = .8 + r() * .35; g.fillStyle = `rgb(${118 * t | 0},${100 * t | 0},${78 * t | 0})`; g.beginPath(); g.moveTo(x + 32, y); g.lineTo(x + 62, y + 22); g.lineTo(x + 32, y + 40); g.lineTo(x + 2, y + 22); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,22,15,.7)'; g.lineWidth = 3; g.stroke(); g.fillStyle = 'rgba(25,18,12,.55)'; g.fillRect(x + 12, y + 24, 40, 5);
      for (let k = 0; k < 10; k++) { g.strokeStyle = `rgba(${r() < .5 ? 50 : 170},${r() < .5 ? 40 : 150},30,.35)`; g.lineWidth = 1; g.beginPath(); const fx = x + 8 + r() * 48; g.moveTo(fx, y + 4 + r() * 10); g.lineTo(fx + (r() - .5) * 6, y + 26 + r() * 12); g.stroke(); } }
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(0,0,0,.25)'); gr.addColorStop(.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  bark.repeat.set(2, 5);
  // a frond: midrib with stiff lanceolate leaflets on both sides; greener at the base, dusty grey-green toward the tip
  const frond = (dead) => canvasTex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); const r = rng(dead ? 23 : 17);
    for (let x = 10; x < w - 6; x += 4 + r() * 2) { const u = x / w; const L = (1 - u) * 50 + 10 + r() * 8;
      for (const s of [-1, 1]) { const ang = (.5 + r() * .25) * s; const ex = x + Math.cos(ang) * L * .45 + 10, ey = h / 2 - Math.sin(ang) * L;
        const c = dead ? [140 + r() * 40, 110 + r() * 30, 70 + r() * 20] : [58 + u * 50 + r() * 20, 82 + u * 30 + r() * 20, 38 + u * 30 + r() * 10];
        // wide enough that the leaflets survive mipmapping at a distance (thin slivers average out to nothing and the crown goes bald)
        g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.beginPath(); g.moveTo(x - 2, h / 2); g.quadraticCurveTo(x + (ex - x) * .5 - 4, h / 2 + (ey - h / 2) * .55, ex, ey); g.quadraticCurveTo(x + (ex - x) * .5 + 9, h / 2 + (ey - h / 2) * .45, x + 7, h / 2); g.fill(); } }
    g.strokeStyle = dead ? '#7a6242' : '#6f6a3a'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); }, { repeat: false });
  return { bark, leaf: frond(false), dead: frond(true) };
}
export function palms(spots) {
  const T = palmTextures(); const pr = rng(515);
  const barkM = new THREE.MeshStandardMaterial({ map: T.bark, roughness: 1 });
  // alpha-to-coverage: soft leaflet edges under MSAA instead of a hard stair-stepped cut-out (plain alpha test without it)
  const leafM = windSway(new THREE.MeshStandardMaterial({ map: T.leaf, alphaTest: .3, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .75, color: '#d4d2b0' }), .22);
  const deadM = windSway(new THREE.MeshStandardMaterial({ map: T.dead, alphaTest: .3, alphaToCoverage: true, side: THREE.DoubleSide, roughness: .95, color: '#ffffff' }), .08);
  const trunks = [], fronds = [], deads = [];
  // a frond folded into a V along its midrib (leaflets rise from it), tapering, drooping by its own weight
  const frondGeo = (len, wid, droop, fold) => { const g = new THREE.PlaneGeometry(len, wid, 10, 2); g.translate(len / 2, 0, 0); const fx = new Float32Array(g.attributes.position.count);
    const pp = g.attributes.position; for (let k = 0; k < pp.count; k++) { const u = pp.getX(k) / len, y = pp.getY(k) * (1 - u * .62); pp.setY(k, y * Math.cos(fold)); pp.setZ(k, Math.abs(y) * Math.sin(fold) - u * u * droop * len * .55); fx[k] = u * u; }
    g.setAttribute('flex', new THREE.BufferAttribute(fx, 1)); return g; };
  for (const [x, z, h] of spots) {
    const lean = rr(-.12, .12), lean2 = rr(-.12, .12);
    const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(Math.sin(t * 1.2) * lean * h, t * h, Math.sin(t * 1.2) * lean2 * h)); }
    const curve = new THREE.CatmullRomCurve3(pts); const tg = new THREE.TubeGeometry(curve, 12, .2, 9, false);
    const p = tg.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; const c = curve.getPoint(Math.min(1, Math.max(0, t))); const k = (1 - t * .3) * (1 + .12 * Math.exp(-t * 18)); p.setX(i, c.x + (p.getX(i) - c.x) * k); p.setZ(i, c.z + (p.getZ(i) - c.z) * k); }
    tg.translate(x, groundY(x, z), z); trunks.push(tg);
    const top = pts[8].clone().add(new THREE.Vector3(x, groundY(x, z), z));
    const n = ri(12, 18);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rr(-.2, .2), droop = rr(.15, .9), len = rr(2.4, 3.6);
      const g = frondGeo(len * 1.12, .95, droop, .62 + pr() * .2);
      g.rotateX(-Math.PI / 2 + rr(-.3, .3) - .15); g.rotateZ(rr(-.2, .5)); g.rotateY(a); g.translate(top.x, top.y, top.z); g.computeVertexNormals(); fronds.push(g);
    }
    // young fronds rising from the heart of the crown (a real date palm carries far more than the outer ring)
    for (let i = 0, m = 7 + Math.floor(pr() * 5); i < m; i++) { const g = frondGeo(1.6 + pr() * 1.1, .8, .12 + pr() * .2, .7); g.rotateX(-Math.PI / 2 + .55 + pr() * .5); g.rotateY(pr() * 6.28); g.translate(top.x, top.y + .05, top.z); g.computeVertexNormals(); fronds.push(g); }
    // last year's fronds, dry and hanging against the trunk under the green crown
    for (let i = 0, m = 3 + Math.floor(pr() * 4); i < m; i++) { const g = frondGeo(2.2 + pr() * 1.2, .8, .4, .5); g.rotateX(-Math.PI / 2); g.rotateZ(-1.05 - pr() * .35); g.rotateY(pr() * 6.28); g.translate(top.x, top.y - .35, top.z); g.computeVertexNormals(); deads.push(g); }
    G.colliders.push(new THREE.CylinderGeometry(.25, .25, 3, 6).translate(x, 1.5, z));
  }
  if (!trunks.length) return;
  const tm = new THREE.Mesh(mergeGeometries(trunks), barkM); tm.castShadow = tm.receiveShadow = true; G.scene.add(tm);
  const fm = new THREE.Mesh(mergeGeometries(fronds), leafM); fm.castShadow = true; fm.receiveShadow = true; G.scene.add(fm);
  const dm = new THREE.Mesh(mergeGeometries(deads), deadM); dm.castShadow = true; dm.receiveShadow = true; G.scene.add(dm);
}

// ---------- laundry lines ----------
function flushLaundry() {
  const pts = []; const cloth = [];
  const cols = ['#e9e4d8', '#3a5a8a', '#b8433a', '#e0c070', '#2f2f33', '#6a8a5a', '#d08aa0', '#ffffff'];
  for (const L of laundry) {
    const a = new THREE.Vector3(L.lx - 1.4, L.y, .5).applyMatrix4(L.m), b = new THREE.Vector3(L.lx + 1.4, L.y, .5).applyMatrix4(L.m);
    for (let i = 0; i < 8; i++) { const t0 = i / 8, t1 = (i + 1) / 8; const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1); p0.y -= Math.sin(t0 * Math.PI) * .12; p1.y -= Math.sin(t1 * Math.PI) * .12; pts.push(p0, p1); }
    const n = ri(3, 6); for (let k = 0; k < n; k++) { const t = (k + .5) / n + rr(-.04, .04); const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * .12; const w = rr(.3, .6), h = rr(.4, .8); const g = new THREE.PlaneGeometry(w, h, 1, 3); g.translate(0, -h / 2, 0); { const pp = g.attributes.position, fx = new Float32Array(pp.count); for (let q = 0; q < pp.count; q++) fx[q] = Math.min(1, -pp.getY(q) / h); g.setAttribute('flex', new THREE.BufferAttribute(fx, 1)); } const q = new THREE.Quaternion().setFromRotationMatrix(L.m); g.applyQuaternion(q); g.translate(p.x, p.y, p.z); cloth.push([g, pick(cols)]); }
  }
  if (pts.length) { const m = new THREE.Mesh(cableGeometry(pts, .004), MAT.cable); m.castShadow = true; G.scene.add(m); }
  const byCol = {}; cloth.forEach(([g, c]) => (byCol[c] ||= []).push(g));
  for (const [c, gs] of Object.entries(byCol)) { const m = new THREE.Mesh(mergeGeometries(gs), windSway(new THREE.MeshStandardMaterial({ color: c, roughness: 1, side: THREE.DoubleSide }), .16)); m.castShadow = true; G.scene.add(m); }
}

// ---------- thin high clouds ----------
function skyClouds() {
  const s = G.sunDir;
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 16, 0, Math.PI * 2, 0, Math.PI * .5), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vD;float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<6;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
    void main(){vec3 d=normalize(vD);if(d.y<.01)discard;vec2 uv=d.xz/(d.y+.08);vec2 q=uv*vec2(1.1,1.5);float c=fbm(q*1.1);c+=.3*fbm(q*3.7+c);
      float dens=smoothstep(.7,1.05,c)*smoothstep(.01,.2,d.y)*.32;float sn=max(dot(d,vec3(${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)})),0.);
      vec3 col=vec3(1.)*(4.+6.*pow(sn,8.));gl_FragColor=vec4(col,dens);}`,
  }));
  m.renderOrder = -1; G.scene.add(m); G.clouds = m;
}

export function buildWorld() {
  G.soundEmitters = []; G.stalls = []; G.footprints = [];
  SCAR.value.set(LAYOUT.stuck.x, LAYOUT.stuck.z, 48, 3.5); // the junction where the rescue vehicle stalls has seen fighting before
  buildGround();
  buildSea();
  const open = blocks();
  tents(open);
  landmarks();
  streetLife();
  wires();
  distantFill();
  G.footprints.push([(B_X0 + B_X1) / 2, (B_Z0 + B_Z1) / 2, B_X1 - B_X0, B_Z1 - B_Z0, 0]); bakeGroundAO();
  flushRoof();
  flushLaundry();
  flushSoot();
  for (const [x, z, sc] of rubbleQueue) if (!(Math.abs(z) < 6 && x > -215)) rubblePile(x, z, clamp(sc, .6, 1.4));
  skyClouds();
  const ps = [[L.coast.x + 8, -60, 9], [L.coast.x + 8, -30, 10], [L.coast.x - 7, 5, 11], [L.coast.x + 8, 40, 9], [L.coast.x - 8, 70, 10], [-330, -20, 8], [-362, 60, 9], [-240, 20, 8], [-196, -16, 9], [12, -24, 8], [74, 22, 9], [-54, 20, 7], [-20, -30, 8], [128, -18, 9], [-80, 26, 8], [160, 28, 10], [-150, -30, 9]];
  for (const lt of open) { ps.push([lt.cx - lt.w / 2 + 1.2, lt.cz - lt.d / 2 + 1.2, rr(7, 10)]); if (R() < .5) ps.push([lt.cx + lt.w / 2 - 1.2, lt.cz + lt.d / 2 - 1.2, rr(6, 9)]); }
  palms(ps.filter(([x, z], i) => i >= 17 || i < 7));
  rideStalls();
  sandDrifts();
  wallDebris();
  beachCamp();
  G.birds = makeBirds(new THREE.Vector3(20, 0, 0), 3, 9, 120);
  flushBuckets();
}
// the first stretch of the ride in (x 130-230) had shop fronts but no market: more stalls, with their own generator so
// nothing generated before them moves
function rideStalls() {
  const r = rng(6608), prod = { red: [], green: [], orange: [], brown: [] }, mel = [];
  for (let x = 134; x < 226; x += 2.9 + r() * 1.8) {
    if (r() < .6) stall(x, -3.2, 0, r, prod);
    if (r() < .6) stall(x + 1.4, 3.2, Math.PI, r, prod);
    if (r() < .18) { const z = 2.3; r(); /* melons only on the far side of the pickup's lane (it drives at z = -1) */ const n = 8 + Math.floor(r() * 9); for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * .7, layer = i > n * .6 ? 1 : 0; mel.push([x + Math.cos(a) * d * (1 - layer * .4), .14 + layer * .22, z + Math.sin(a) * d * (1 - layer * .4), r() * 6]); } }
  }
  flushProduce(prod, mel, r);
}
// wind-blown sand banked against the foot of every wall: a low, rounded wedge that comes and goes along the facade
// (own generator; built after the town so nothing else moves)
function sandDrifts() {
  const r = rng(808), pos = [], idx = []; const seg = .6;
  for (const [cx, cz, w, d, ry] of G.footprints || []) {
    const c = Math.cos(ry || 0), sn = Math.sin(ry || 0);
    for (const [len, ox, oz, nx, nz] of [[w, 0, d / 2, 0, 1], [w, 0, -d / 2, 0, -1], [d, w / 2, 0, 1, 0], [d, -w / 2, 0, -1, 0]]) {
      const n = Math.max(2, Math.round(len / seg)); const tx = nz !== 0 ? 1 : 0, tz = nz !== 0 ? 0 : 1; let ph = r() * 100; const amp = .4 + r() * .8;
      const base = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + len * i / n; const k = Math.max(0, Math.sin(t * .9 + ph) * .5 + Math.sin(t * .37 + ph * 1.7) * .5 + .25) * amp;
        const wd = .15 + .85 * k, hh = .015 + .11 * k;
        for (const [o, y] of [[0, hh], [wd * .45, hh * .55], [wd, -.01]]) {
          const lx = ox + tx * t + nx * (o + .005), lz = oz + tz * t + nz * (o + .005); pos.push(cx + lx * c + lz * sn, y, cz - lx * sn + lz * c); }
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { const a = base + i * 3 + j, b = a + 3; if (nx + nz > 0 !== (nz !== 0)) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: tex('sand_c.jpg'), color: '#cfc3ad', roughness: 1, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'vec4 sandC = texture2D(map, vGIw.xz / 2.6); diffuseColor.rgb *= mix(vec3(dot(sandC.rgb, vec3(.3, .59, .11))), sandC.rgb, .45);'); };
  m.customProgramCacheKey = () => 'sandDrift';
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; G.scene.add(mesh);
}

// what collects at the foot of every wall in the camp: chips of block and render knocked off by shrapnel and traffic,
// stones, and scraps of paper and plastic bags the wind has pushed into the corner. In loose clusters, not a border.
// Only along the streets the player walks (|z| < 40); own generator; two instanced draws and no shadow pass (too small).
function wallDebris() {
  const r = rng(5150), bits = [], scraps = [];
  for (const [cx, cz, w, d, ry] of G.footprints || []) {
    if (Math.abs(cz) > 40 || cx < -300 || cx > 262) continue;
    const c = Math.cos(ry || 0), sn = Math.sin(ry || 0);
    for (const [len, ox, oz, nx, nz] of [[w, 0, d / 2, 0, 1], [w, 0, -d / 2, 0, -1], [d, w / 2, 0, 1, 0], [d, -w / 2, 0, -1, 0]]) {
      const tx = nz !== 0 ? 1 : 0, tz = nz !== 0 ? 0 : 1;
      for (let k = 0, nc = 1 + Math.floor(r() * 2.6); k < nc; k++) { const t0 = (r() - .5) * (len - 1.5);
        for (let i = 0, n = 3 + Math.floor(r() * 6); i < n; i++) { const t = t0 + (r() - .5) * 2.2, o = .03 + Math.pow(r(), 1.6) * .9, s = .025 + Math.pow(r(), 2.4) * .15;
          const lx = ox + tx * t + nx * (o + s), lz = oz + tz * t + nz * (o + s); bits.push([cx + lx * c + lz * sn, cz - lx * sn + lz * c, s, r() * 6.28, r(), r()]); }
        for (let i = 0, n = Math.floor(r() * 4); i < n; i++) { const t = t0 + (r() - .5) * 3, o = .05 + r() * 1.1;
          const lx = ox + tx * t + nx * o, lz = oz + tz * t + nz * o; scraps.push([cx + lx * c + lz * sn, cz - lx * sn + lz * c, .06 + r() * .2, r() * 6.28, r(), r()]); } }
    }
  }
  const o = new THREE.Object3D(), col = new THREE.Color();
  const chip = new THREE.OctahedronGeometry(1, 0);
  const bm = new THREE.InstancedMesh(chip, new THREE.MeshStandardMaterial({ map: MAT.rubble.map, roughness: 1, color: '#ffffff' }), bits.length);
  const bc = ['#b9b2a6', '#a39d93', '#c9bfae', '#8e887f', '#d9d3c7', '#6f6a63'];
  bits.forEach(([x, z, s, ry, a, b], i) => { o.position.set(x, groundY(x, z) + s * .2, z); o.rotation.set((a - .5) * 1.2, ry, (b - .5) * 1.2); o.scale.set(s * (1 + a * .8), s * (.35 + b * .4), s * (.7 + a * .5)); o.updateMatrix(); bm.setMatrixAt(i, o.matrix); bm.setColorAt(i, col.set(bc[Math.floor(a * 5.99 * b + b * 3) % bc.length]).multiplyScalar(.8 + a * .3)); });
  bm.castShadow = false; bm.receiveShadow = true; G.scene.add(bm);
  const sq = new THREE.PlaneGeometry(1, 1, 2, 1); sq.rotateX(-Math.PI / 2); { const p = sq.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.abs(p.getX(i)) * .12); } sq.computeVertexNormals();
  const sm = new THREE.InstancedMesh(sq, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), scraps.length);
  const sc = ['#dcd8cc', '#c8c2b2', '#2a4f86', '#1c1c1c', '#b89a6c', '#e6e2d6', '#7a8a5a'];
  scraps.forEach(([x, z, s, ry, a, b], i) => { o.position.set(x, groundY(x, z) + .012, z); o.rotation.set((a - .5) * .15, ry, (b - .5) * .15); o.scale.set(s, s, s * (.5 + b * .6)); o.updateMatrix(); sm.setMatrixAt(i, o.matrix); sm.setColorAt(i, col.set(sc[Math.floor(a * sc.length)]).multiplyScalar(.75 + b * .3)); });
  sm.castShadow = false; sm.receiveShadow = true; G.scene.add(sm);
}

// the beach camp of displaced families that filled the central Gaza shore by June 2024: tarp A-frames, boxy family tents
// with sagging roofs and lean-tos, in loose rows with paths between. Kept out of the landing zone, the APC run and the
// open band between the LZ and the town (the fight from the beach must not change). Own generator, instanced.
function beachCamp() {
  const r = rng(1906), rl = (a, b) => a + (b - a) * r();
  const sag = (g, k) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (y > .15) p.setY(i, y - k * Math.sin((z + 1) * 1.9) * Math.sin((x + 1) * 2.3) * .5); } g.computeVertexNormals(); return g; };
  const aframe = (() => { const pos = [-1, 0, -1.4, 0, 1.6, -1.4, 0, 1.6, 1.4, -1, 0, -1.4, 0, 1.6, 1.4, -1, 0, 1.4, 1, 0, -1.4, 0, 1.6, 1.4, 0, 1.6, -1.4, 1, 0, -1.4, 1, 0, 1.4, 0, 1.6, 1.4, -1, 0, -1.4, 1, 0, -1.4, 0, 1.6, -1.4];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return sag(g, .1); })();
  const box = (() => { const g = new THREE.BoxGeometry(2.2, 1.9, 3, 4, 3, 5); g.translate(0, .95, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 1.85) p.setY(i, 2.2 - Math.abs(p.getX(i)) * .28); return sag(g, .16); })();
  const lean = (() => { const g = new THREE.PlaneGeometry(2.6, 2.4, 4, 4); g.rotateX(-Math.PI / 2 + .7); g.translate(0, .8, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.max(.02, p.getY(i) - Math.sin((p.getX(i) + 1.3) * 1.2) * .08)); g.computeVertexNormals(); return g; })();
  const cols = ['#e7e3d8', '#dcd8cc', '#2f5f8f', '#3b6ea0', '#c9642f', '#7a8a5a', '#b9b3a2', '#8a3b2e', '#d4c39a'];
  const spots = { a: [], b: [], l: [] }; const LZ = LAYOUT.lz;
  const clear = (x, z) => Math.hypot(x - LZ.x, z - LZ.z) < 34 || Math.hypot(x + 318, z - 12) < 15 || (z > -12 && z < 72) || x < L.shoreX + 20 || x > L.beachX - 5;
  for (let z = -168; z < 170; z += rl(3.6, 5.2)) for (let x = L.beachX - 6; x > L.shoreX + 20; x -= rl(3.4, 5)) {
    if (r() < .18) continue; const jx = x + rl(-.8, .8), jz = z + rl(-.8, .8); if (clear(jx, jz)) continue;
    const t = r(); (t < .45 ? spots.a : t < .8 ? spots.b : spots.l).push([jx, jz, rl(-.2, .2) + (r() < .5 ? 0 : Math.PI / 2), .85 + r() * .3, Math.floor(r() * cols.length)]);
  }
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .88, side: THREE.DoubleSide }); const o = new THREE.Object3D(), c = new THREE.Color();
  for (const [key, geo] of [['a', aframe], ['b', box], ['l', lean]]) { const list = spots[key]; if (!list.length) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, z, ry, sc, ci], i) => { o.position.set(x, groundY(x, z) - .03, z); o.rotation.set(0, ry, 0); o.scale.set(sc, sc * (.9 + r() * .2), sc); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(cols[ci]).multiplyScalar(.8 + r() * .25));
      G.colliders.push(new THREE.BoxGeometry(key === 'l' ? 2.4 : 2, key === 'l' ? 1.2 : 1.7, key === 'l' ? 1.6 : 2.8).translate(0, key === 'l' ? .6 : .85, 0).applyMatrix4(o.matrix)); });
    im.castShadow = im.receiveShadow = true; G.scene.add(im); }
}

// pigeons wheeling over the rooftops: a few flocks of flapping V shapes, updated on the CPU (a handful of instances)
export function makeBirds(center, flocks = 3, per = 9, radius = 90) {
  const r = rng(99); const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, .12, -.28, .06, -.02, 0, 0, -.1, 0, 0, .12, 0, 0, -.1, .28, .06, -.02], 3)); geo.computeVertexNormals();
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#3b3a38', roughness: .9, side: THREE.DoubleSide }), flocks * per); im.frustumCulled = false; G.scene.add(im);
  const F = []; for (let f = 0; f < flocks; f++) F.push({ c: new THREE.Vector3(center.x + (r() - .5) * radius, 26 + r() * 22, center.z + (r() - .5) * radius), rad: 18 + r() * 30, sp: (.12 + r() * .12) * (r() < .5 ? -1 : 1), ph: r() * 6.28, b: Array.from({ length: per }, () => [r() * 4 - 2, r() * 3 - 1.5, r() * 4 - 2, r() * 6.28]) });
  const o = new THREE.Object3D(); let t = 0;
  return { mesh: im, update(dt) { t += dt; let i = 0;
    for (const fl of F) { const a = fl.ph + t * fl.sp; for (const [bx, by, bz, bp] of fl.b) { const aa = a + bx * .02;
      o.position.set(fl.c.x + Math.cos(aa) * (fl.rad + bz), fl.c.y + by + Math.sin(t * .7 + bp) * .8, fl.c.z + Math.sin(aa) * (fl.rad + bz));
      o.rotation.set(0, -aa + (fl.sp > 0 ? 0 : Math.PI), Math.sin(t * .9 + bp) * .25); const flap = Math.sin(t * 11 + bp * 3); o.scale.set(1, flap > -.2 ? 1 + flap : .6, 1); o.updateMatrix(); im.setMatrixAt(i++, o.matrix); } }
    im.instanceMatrix.needsUpdate = true; } };
}

// distant/secondary towns for other scenes: residential blocks + their roof clutter, merged
export function townBlocks(list) { G.footprints ||= []; for (const b of list) residential(...b); flushRoof(); flushLaundry(); flushSoot(); flushBuckets(); }
export { palms as palmTrees };
// hand-built, not machined: a smooth displacement field of a couple of centimetres over everything static, so corners,
// parapets and roof lines are never ruler-straight. It depends only on world position, so coincident vertices of
// neighbouring pieces move together and no gaps open (colliders are separate and untouched).
function unplumb(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.sin(x * .83 + z * .31 + y * .27) + Math.sin(z * 1.37 - x * .19 + y * .61) * .6, b = Math.sin(z * .79 + x * .41 - y * .33) + Math.sin(x * 1.21 + y * .53) * .6;
    const k = .012 * Math.min(1, y * 2); p.setXYZ(i, x + a * k, y + (a - b) * .004, z + b * k); }
  return g;
}
// aWx for the weathered wall materials, per vertex: which facade of its house a face belongs to (by its normal) decides the
// window grid; roofs and soffits get none. 16-bit, scaled by 1/32 (the shader multiplies back): 0.5 mm steps up to 32 m.
function wxAttr(g, wx) {
  const n = g.attributes.normal, cnt = g.attributes.position.count, a = new Uint16Array(cnt * 4), k = 65535 / 32;
  for (let i = 0; i < cnt; i++) { if (!wx || !n) { a[i * 4] = .5 * k; continue; }
    let best = .7, f = null; const nx = n.getX(i), nz = n.getZ(i); for (const q of wx.faces) { const d = nx * q[0] + nz * q[1]; if (d > best) { best = d; f = q; } }
    a[i * 4] = wx.h * k; a[i * 4 + 1] = f ? f[2] * k : 0; a[i * 4 + 2] = f ? f[3] * k : 0; a[i * 4 + 3] = Math.min(31.9, wx.top) * k; }
  g.setAttribute('aWx', new THREE.BufferAttribute(a, 4, true));
}
function flushBuckets() {
  for (const [mat, list] of buckets) {
    const wx = !!(mat.defaultAttributeValues && mat.defaultAttributeValues.aWx);
    const geos = list.map(g => { const t = g.userData.wx; const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); if (q.attributes.color) q.deleteAttribute('color'); if (wx) wxAttr(q, t); return unplumb(q); });
    // group into chunks to keep frustum culling useful
    const chunks = new Map();
    geos.forEach(g => { g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); const key = Math.floor(c.x / 80) + ',' + Math.floor(c.z / 80); if (!chunks.has(key)) chunks.set(key, []); chunks.get(key).push(g); });
    for (const arr of chunks.values()) { const mesh = new THREE.Mesh(mergeGeometries(arr), mat); mesh.castShadow = mat !== MAT.window && mat !== MAT.black; mesh.receiveShadow = true; G.scene.add(mesh); }
  }
  buckets.clear();
}
