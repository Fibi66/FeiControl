"use client";
import { useEffect, useState, useRef, useMemo, useCallback, Fragment, type ChangeEvent } from "react";
import * as THREE from "three";

// ================================================================
// Data types
// ================================================================
interface GraphNode { id: string; agent: string; title: string; color: string; degree: number; date: string; updated_at?: string; snippet?: string; path?: string; }
interface GraphEdge { s: string; t: string; k: string; }
interface AgentInfo { id: string; count: number; color: string; }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; agents: AgentInfo[]; stats: { nodes: number; evidenceEdges: number; agents: number; timeline: number; fromOpenclaw: number }; generatedAt?: string; }

// ================================================================
// GLSL Shaders
// ================================================================
const PLANET_VERT = `varying vec3 vObjPos;varying vec3 vWorldNormal; varying vec3 vWorldPos; uniform float uTime; uniform float uSpin; uniform float uDiff;
void main(){vec3 pos=position;float latf=normalize(position).y;float shear=uTime*uSpin*uDiff*(1.0-latf*latf);float cs=cos(shear),sn=sin(shear);vec3 sp=pos;sp.xz=mat2(cs,-sn,sn,cs)*sp.xz;vObjPos=sp;vec4 wp=modelMatrix*vec4(pos,1.0);vWorldPos=wp.xyz;vWorldNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}`;

const PLANET_FRAG = `varying vec3 vObjPos; varying vec3 vWorldNormal; varying vec3 vWorldPos; uniform float uType; uniform float uSeed; uniform float uTime; uniform vec3 uBase; uniform vec3 uHi; uniform vec3 uLo; uniform vec3 uOcean; uniform vec3 uLand;
const float PI=3.14159265359;
float pHash(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float pNoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=pHash(i),b=pHash(i+vec2(1,0)),c=pHash(i+vec2(0,1)),d=pHash(i+vec2(1,1));vec2 u=f*f*(3.-2.*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float pFbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*pNoise(p);p*=2.;a*=.5;}return v;}
vec3 perturbNormal(vec3 N,vec3 d,float str){vec3 T=normalize(cross(N,vec3(0,1,0))+vec3(1e-3));vec3 B=cross(N,T);float e=.015;float h0=pFbm(d.xy*9.+uSeed*1.7);float hx=pFbm((d.xy+vec2(e,0))*9.+uSeed*1.7);float hy=pFbm((d.xy+vec2(0,e))*9.+uSeed*1.7);vec2 g=vec2(hx-h0,hy-h0)/e;return normalize(N-str*(g.x*T+g.y*B));}
vec2 dirToUV(vec3 d){return vec2(.5+atan(d.z,d.x)/(2.*PI),.5-asin(clamp(d.y,-1.,1.))/PI);}
vec3 planetAlbedo(vec3 d){vec2 uv=dirToUV(d);float u=uv.x,v=uv.y,lat=v-.5;float band=sin((v)*PI*7.+uSeed*6.28);vec3 col;
if(uType<.5){float turb=pFbm(vec2(u*6.,v*3.+uSeed))*.5;float b=sin((v*7.+turb*2.+uSeed)*PI);b=smoothstep(-.35,.35,b);col=mix(uLo,uHi,b);vec2 spotUV=vec2(u-.62,v-.62);float spot=smoothstep(.1,0.,length(spotUV*vec2(2.2,1.)));col=mix(col,vec3(.72,.30,.18),spot*.8);}
else if(uType<1.5){float b=sin((v*2.5+uSeed)*PI)*.3+.5;col=mix(uLo,uHi,b);float cloud=pFbm(vec2(u*8.+uSeed,v*4.));cloud=smoothstep(.62,.72,cloud)*.55;col=mix(col,vec3(.92,.94,1.),cloud);}
else if(uType<2.5){float land=pFbm(vec2(u*5.+uSeed*3.,v*5.));land=smoothstep(.52,.62,land);vec3 ocean=uOcean,landc=mix(uLand*.8,uLand*.95,pNoise(vec2(u*20.,v*20.)));col=mix(ocean,landc,land);float ice=smoothstep(.42,.5,abs(lat));col=mix(col,vec3(.92,.95,1.),ice*.5);float cloud2=pFbm(vec2(u*7.+uSeed*2.,v*5.+uTime*.03));cloud2=smoothstep(.62,.78,cloud2)*.15;col=mix(col,vec3(1.),cloud2);}
else{float base=pFbm(vec2(u*8.+uSeed*5.,v*8.));float dark=pNoise(vec2(u*14.,v*14.));col=mix(uLo,uHi,base*.6+dark*.4);float cr=pNoise(vec2(u*32.,v*32.));cr=smoothstep(.58,.66,cr);col=mix(col,uLo*.6,cr*.5);float iceStr=.08+.62*smoothstep(3.5,4.5,uSeed);float ice=smoothstep(.44,.50,abs(lat))*iceStr;col=mix(col,vec3(.95,.96,.98),ice);}
float _lum=dot(col,vec3(.299,.587,.114));return clamp(mix(vec3(_lum),col,1.18),0.,4.);}
vec3 ACESFilm(vec3 x){float a=2.51,b=.03,c=2.43,d=.59,e=.14;return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.,1.);}
void main(){vec3 N=normalize(vWorldNormal);N=perturbNormal(N,normalize(vObjPos),.5);vec3 toSun=normalize(-vWorldPos),V=normalize(cameraPosition-vWorldPos);float ndl=dot(N,toSun),ndotv=max(dot(N,V),0.);float ndlSoft=smoothstep(-.1,.28,ndl),ambient=.045,diff=ndlSoft*1.04+ambient;vec3 albedo=planetAlbedo(vObjPos);float spec=0.;if(uType<1.5){vec3 H=normalize(toSun+V);spec=pow(max(dot(N,H),0.),24.)*.22;}vec3 color=albedo*diff+spec;vec3 atm;if(uType<.5)atm=mix(uHi,vec3(.95,.85,.65),.4);else if(uType<1.5)atm=vec3(.75,.9,.95);else if(uType<2.5)atm=vec3(.45,.65,1.);else atm=vec3(.8,.75,.7);float fres=pow(1.-ndotv,3.),dayRim=fres*smoothstep(-.15,.5,ndl);float atmStr=uType<2.5?.9:.35;color+=atm*dayRim*atmStr;float limbBloom=pow(ndotv,3.)*smoothstep(.2,1.,ndl);color+=albedo*limbBloom*.2;color*=1.12;color=ACESFilm(color);gl_FragColor=vec4(color,1.);}`;

// ================================================================
// Sun shader (emissive, animated granulation) — matches original makeSun
// ================================================================
const SUN_VERT = `varying vec3 vObj; varying vec3 vN;
  void main(){ vObj = position; vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SUN_FRAG = `uniform float uTime; varying vec3 vObj; varying vec3 vN;
  float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
  void main(){
    vec3 dir = normalize(vObj);
    float n  = fbm(dir*5.0  + vec3(0.0, uTime*0.15, 0.0));
    float n2 = fbm(dir*11.0 - vec3(uTime*0.10, 0.0, 0.0));
    float gran = mix(n, n2, 0.5);
    vec3 cHot  = vec3(1.0, 0.96, 0.78);
    vec3 cMid  = vec3(1.0, 0.62, 0.16);
    vec3 cCool = vec3(0.92, 0.30, 0.05);
    vec3 col = mix(cCool, cMid, smoothstep(0.20,0.55,gran));
    col = mix(col, cHot, smoothstep(0.55,0.92,gran));
    col *= 0.78 + 0.55*gran;
    gl_FragColor = vec4(col, 1.0);
  }`;

// ================================================================
// Solar system data
// ================================================================
const DEG = Math.PI / 180;
const ORBIT_NEAR = 100, ORBIT_SPAN = 700, A_MIN = 0.387, A_MAX = 39.482;
const SPIN_SCALE = 0.014, SPIN_MID = 0.5, SPIN_FLOOR = 0.0009;

const SOLAR_PLANETS = [
  { name:"水星", base:0x6B6560, type:3, relief:0.6, seed:1, tilt:0.03, period:58.65, v:0.003, retro:false, diff:false, a:0.387, ecc:0.206, inc:7.00, hi:0xC4A880, lo:0x5C5040, orbitR:120, rKm:2440 },
  { name:"金星", base:0xE8DCC8, type:3, relief:0.5, seed:2, tilt:177.4, period:243, v:0.0018, retro:true, diff:false, a:0.723, ecc:0.007, inc:3.39, hi:0xF0E8C0, lo:0xD8C880, orbitR:185, rKm:6052 },
  { name:"地球", base:0x1565C0, type:2, relief:0.5, seed:3, tilt:23.44, period:0.9973, v:0.465, retro:false, diff:false, a:1.0, ecc:0.017, inc:0.00, ocean:0x0D47A1, land:0x5A6B3A, orbitR:250, rKm:6371 },
  { name:"火星", base:0xC85A32, type:3, relief:0.5, seed:4, tilt:25.19, period:1.026, v:0.24, retro:false, diff:false, a:1.524, ecc:0.093, inc:1.85, hi:0xE88C5C, lo:0x4A2020, orbitR:315, rKm:3390 },
  { name:"谷神星", base:0x9A9080, type:3, relief:0.6, seed:10, tilt:4, period:0.378, v:0.091, retro:false, diff:false, a:2.767, ecc:0.080, inc:10.59, hi:0x9A9080, lo:0x4C4840, orbitR:380, rKm:473 },
  { name:"木星", base:0xD8A878, type:0, relief:0.35, seed:5, tilt:3.13, period:0.41, v:12.6, retro:false, diff:true, a:5.203, ecc:0.049, inc:1.30, hi:0xF5E6C8, lo:0x7A4A2A, orbitR:455, rKm:69911 },
  { name:"土星", base:0xE3C9A0, type:0, relief:0.40, seed:6, tilt:26.73, period:0.444, v:9.83, retro:false, diff:true, a:9.58, ecc:0.057, inc:2.49, hi:0xF5E6BE, lo:0xC9A866, ring:true, orbitR:530, rKm:58232 },
  { name:"天王星", base:0xB8E0E0, type:1, relief:0.4, seed:7, tilt:97.77, period:0.718, v:2.59, retro:true, diff:true, a:19.22, ecc:0.046, inc:0.77, hi:0xD8F0F0, lo:0x90C8C8, orbitR:605, rKm:25362 },
  { name:"海王星", base:0x2E4FB8, type:1, relief:0.4, seed:8, tilt:28.32, period:0.671, v:2.68, retro:false, diff:true, a:30.05, ecc:0.011, inc:1.77, hi:0x5B9DF5, lo:0x1A2E78, orbitR:680, rKm:24622 },
  { name:"冥王星", base:0xC9B8A8, type:3, relief:0.6, seed:9, tilt:122.5, period:6.387, v:0.0131, retro:true, diff:false, a:39.482, ecc:0.2488, inc:17.16, hi:0xE8D8C8, lo:0x6A5548, orbitR:800, rKm:1188 } // 全参数真实值（倾角17.16°即真实轨道倾角）
];

function spinFromSpeed(v: number, retro: boolean) { const r = SPIN_SCALE * (v / (v + SPIN_MID)); const mag = Math.max(r, SPIN_FLOOR); return retro ? -mag : mag; }
function orbitRFromAU(a: number) { const t = (Math.sqrt(a) - Math.sqrt(A_MIN)) / (Math.sqrt(A_MAX) - Math.sqrt(A_MIN)); return ORBIT_NEAR + Math.max(0, Math.min(1, t)) * ORBIT_SPAN; }
function orbitPos(a: number, e: number, incDeg: number, angle: number) { const b = a * Math.sqrt(Math.max(0, 1 - e * e)); const inc = incDeg * DEG; return [a * Math.cos(angle) - a * e, b * Math.sin(angle) * Math.sin(inc), b * Math.sin(angle) * Math.cos(inc)]; }

// Planet display radius from its REAL mean radius (km). A log compression is used
// so the ~148x range (Ceres 473 km → Jupiter 69911 km) fits on screen while keeping
// the correct size ordering: gas giants clearly largest, terrestrial medium, Ceres
// smallest. Exactly proportional sizing is impossible here — Jupiter would be ~5x the
// inner orbit radius and overflow the scene.
const R_KM_MIN = 473, R_KM_MAX = 69911, PLANET_R_MIN = 12, PLANET_R_MAX = 40;
function radiusFromKm(rKm: number) {
  const t = (Math.log(rKm) - Math.log(R_KM_MIN)) / (Math.log(R_KM_MAX) - Math.log(R_KM_MIN));
  return PLANET_R_MIN + Math.max(0, Math.min(1, t)) * (PLANET_R_MAX - PLANET_R_MIN);
}
// Sun is its own body, not part of SOLAR_PLANETS. True Sun/Jupiter radius ratio is
// ~10x, which would overflow the scene, so it's compressed to a fixed, clearly-largest size.
const SUN_RADIUS = 64;

// Build a soft, dimmed background texture from an uploaded image so it reads as ambient
// Uploaded background image: rendered as a small backdrop patch at the image's NATIVE
// pixel size (never stretched / never scaled to fill). It is placed deepest in the scene
// and feathered into the existing galaxy so it never obscures planets or stars. Everywhere
// the patch doesn't cover stays the original procedural galaxy (scene.background is the space
// color). Blurred + dimmed + cool-tinted so it reads as nebula, not a photo.
const BG_DEPTH = 2000; // world distance used only for native-pixel size math
function makeBgImage(src: string): Promise<{ tex: THREE.Texture; natW: number; natH: number } | null> {
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const natW = img.width, natH = img.height;
      const max = 1024; const scale = Math.min(1, max / Math.max(natW, natH));
      const w = Math.max(2, Math.round(natW * scale)), h = Math.max(2, Math.round(natH * scale));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d"); if (!ctx) { resolve(null); return; }
      ctx.filter = "blur(10px)"; ctx.drawImage(img, 0, 0, w, h); ctx.filter = "none";
      ctx.fillStyle = "rgba(8,8,18,0.60)"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(28,40,92,0.22)"; ctx.fillRect(0, 0, w, h);
      // feather the 4 edges to transparent so the patch melts into the galaxy (no hard rectangle)
      const fw = Math.max(2, Math.round(w * 0.12)), fh = Math.max(2, Math.round(h * 0.12));
      ctx.globalCompositeOperation = "destination-out";
      let g = ctx.createLinearGradient(0, 0, fw, 0); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, fw, h);
      g = ctx.createLinearGradient(w, 0, w - fw, 0); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(w - fw, 0, fw, h);
      g = ctx.createLinearGradient(0, 0, 0, fh); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, fh);
      g = ctx.createLinearGradient(0, h, 0, h - fh); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, h - fh, w, fh);
      ctx.globalCompositeOperation = "source-over";
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      resolve({ tex, natW, natH });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
// Scale a unit plane so it appears at the image's native pixel dimensions on screen.
function layoutBgMesh(mesh: THREE.Object3D, natW: number, natH: number, clientH: number) {
  const fovRad = (55 * Math.PI) / 180;
  const visibleH = 2 * BG_DEPTH * Math.tan(fovRad / 2);
  const worldPerPx = visibleH / Math.max(1, clientH);
  mesh.scale.set(natW * worldPerPx, natH * worldPerPx, 1);
}

// ================================================================
// Helpers
// ================================================================
function fract(x: number) { return x - Math.floor(x); }
function hash2(x: number, y: number) { const px = fract(x * 123.34), py = fract(y * 345.45); const s = px * px + py * py + 34.345 * (px + py); return fract((px + s) * (py + s)); }
function noise2(x: number, y: number) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1); const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy; }
function fbm2(x: number, y: number) { let v = 0; let a = 0.5; for (let i = 0; i < 5; i++) { v += a * noise2(x, y); x *= 2; y *= 2; a *= 0.5; } return v; }
function planetHeight(style: any, u: number, v: number) { const seed = style.seed || 1; const lat = v - 0.5; let h = 0.5; if (style.type === 0) h = 0.5 + 0.5 * Math.sin((v * 7.0 + seed) * Math.PI) * 0.5; else if (style.type === 1) h = 0.5 + 0.5 * Math.sin((v * 5.0 + seed) * Math.PI) * 0.3; else if (style.type === 2) { let land = fbm2(u * 5.0 + seed * 3.0, v * 5.0); land = land > 0.54 ? (land - 0.54) / 0.46 : 0; h = 0.5 + land * 0.5; if (Math.abs(lat) > 0.42) h += (Math.abs(lat) - 0.42) * 0.5; } else { let base = fbm2(u * 8.0 + seed * 5.0, v * 8.0); h = 0.5 + (base - 0.5) * 0.4; let cr = noise2(u * 32.0, v * 32.0); if (cr > 0.62) h -= (cr - 0.62) * 0.6; if (Math.abs(lat) > 0.45) h += (Math.abs(lat) - 0.45) * 0.3; } return h; }
function dirToUV(x: number, y: number, z: number): [number, number] { return [0.5 + Math.atan2(z, x) / (2 * Math.PI), 0.5 - Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI]; }
function makeGlowTexture() { const c = document.createElement("canvas"); c.width = c.height = 128; const ctx = c.getContext("2d")!; const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.85)"); g.addColorStop(0.45, "rgba(255,255,255,0.28)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t; }
function makeRingTexture(baseHex: number) { const S = 256, c = document.createElement("canvas"); c.width = c.height = S; const ctx = c.getContext("2d")!; const cx = S / 2, cy = S / 2; const base = new THREE.Color(baseHex); for (let r = S / 2; r > 0; r -= 2) { if (Math.sin(r * 0.35) > 0.6) continue; const n = Math.sin(r * 0.5) * 0.5 + 0.5; const col = base.clone().offsetHSL(0, 0, (n - 0.5) * 0.25); ctx.fillStyle = col.getStyle(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); } const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex; }
function makeLabelSprite(text: string, color: string) { const c = document.createElement("canvas"); const size = 512; c.width = c.height = size; const ctx = c.getContext("2d")!; const font = '600 52px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif'; ctx.font = font; ctx.clearRect(0, 0, size, size); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.lineWidth = 7; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.strokeText(text, size / 2, size / 2 + 2); ctx.fillStyle = color; ctx.fillText(text, size / 2, size / 2 + 2); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; return t; }
function hexToRgb(hex: number) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
function parseDate(s: string | undefined) { if (!s) return null; const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return null; return new Date(+m[1], +m[2] - 1, +m[3]); }
function clip(s: string | undefined, n: number) { return (s || "").length > n ? s!.slice(0, n) + "…" : s || ""; }
function escHtml(s: string) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as any)[c]); }

function makeFlareRay(len: number, angle: number) {
  const seg = 24, pos = new Float32Array(seg * 2 * 3), col = new Float32Array(seg * 2 * 3);
  const dx = Math.cos(angle), dz = Math.sin(angle);
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const r0 = 14 + t0 * len, r1 = 14 + t1 * len;
    pos[i * 6] = r0 * dx; pos[i * 6 + 1] = 0; pos[i * 6 + 2] = r0 * dz;
    pos[i * 6 + 3] = r1 * dx; pos[i * 6 + 4] = 0; pos[i * 6 + 5] = r1 * dz;
    const f0 = 1 - t0, f1 = 1 - t1;
    col[i * 6] = f0; col[i * 6 + 1] = 0.95 * f0; col[i * 6 + 2] = 0.82 * f0;
    col[i * 6 + 3] = f1; col[i * 6 + 4] = 0.95 * f1; col[i * 6 + 5] = 0.82 * f1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false });
  return new THREE.LineSegments(g, m);
}

// ================================================================
// Main 3D Scene (imperative Three.js in a Canvas container)
// ================================================================
const COLORS = { bg: 0x04050A, bridge: 0xFF8A5C, bridgeDim: 0x4A5A7A };

interface PlanetState { agent: AgentInfo; name: string; mesh?: THREE.Mesh; grp: THREE.Group; radius: number; orbitR: number; angle0: number; angVel: number; label?: THREE.Sprite; ring?: THREE.Mesh; tiltRad: number; spin: number; ecc: number; inc: number; orbitLine?: THREE.LineSegments; }

function ThreeScene({ data, selectedPlanets, setSelectedPlanets, selectedNode, setSelectedNode, autoRotate, setAutoRotate, namesOn, setNamesOn, sidebarPanel, setSidebarPanel, setPlanetPanelId, resetView, bgImageSrc }: {
  data: GraphData; selectedPlanets: Set<string>; setSelectedPlanets: (v: Set<string>) => void; selectedNode: GraphNode | null; setSelectedNode: (n: GraphNode | null) => void;
  autoRotate: boolean; setAutoRotate: (v: boolean) => void; namesOn: boolean; setNamesOn: (v: boolean) => void;
  sidebarPanel: string | null; setSidebarPanel: (v: string | null) => void; setPlanetPanelId: (v: string | null) => void; resetView: number; bgImageSrc: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null!);
  const stateRef = useRef<{
    scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: any; composer: any;
    planets: PlanetState[]; satById: Record<string, GraphNode>; bridgeParticles: THREE.Sprite[]; bridgeHit: THREE.Sprite[];
    hovered: THREE.Sprite | THREE.Mesh | null; hoveredPlanet: PlanetState | null; pointerDragged: boolean; planetNames: Record<string, string>;
    t: number; camTarget: THREE.Vector3 | null; lookTarget: THREE.Vector3; frameAll?: () => void;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const sunRef = useRef<any>({});
  const bgSrcRef = useRef<string | null>(bgImageSrc); bgSrcRef.current = bgImageSrc;
  const bgTexRef = useRef<THREE.Texture | null>(null);
  const bgMeshRef = useRef<THREE.Mesh | null>(null);
  const bgNatRef = useRef<{ w: number; h: number } | null>(null);
  // 选中集合的最新值镜像：3D 事件闭包只挂载一次，直接读 props 会拿到过期 Set（导致清不掉/丢选）
  const selectedRef = useRef<Set<string>>(selectedPlanets); selectedRef.current = selectedPlanets;
  // Add / swap / clear the uploaded background patch (a feathered mesh at the image's
  // native pixel size, placed deepest so the rest of the galaxy stays visible).
  const applyBgImage = (scene: THREE.Scene, camera: THREE.PerspectiveCamera, clientH: number, src: string | null) => {
    if (bgMeshRef.current) { scene.remove(bgMeshRef.current); bgMeshRef.current.geometry.dispose(); (bgMeshRef.current.material as THREE.Material).dispose(); bgMeshRef.current = null; }
    if (bgTexRef.current) { bgTexRef.current.dispose(); bgTexRef.current = null; }
    bgNatRef.current = null;
    if (!src) return;
    makeBgImage(src).then(res => {
      if (!res || stateRef.current?.scene !== scene) { res?.tex.dispose(); return; }
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({ map: res.tex, transparent: true, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = -10; mesh.frustumCulled = false;
      scene.add(mesh); bgMeshRef.current = mesh; bgTexRef.current = res.tex; bgNatRef.current = { w: res.natW, h: res.natH };
      layoutBgMesh(mesh, res.natW, res.natH, clientH);
    });
  };

  // Build scene (runs once on data change)
  useEffect(() => {
    const wrap = wrapRef.current; if (!wrap || !data) return;
    // Clean up previous
    if (stateRef.current) {
      const s = stateRef.current;
      cancelAnimationFrame((s as any)._raf);
      s.renderer.dispose(); s.composer?.renderer?.dispose?.(); s.controls?.dispose?.();
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    }

    const camera = new THREE.PerspectiveCamera(55, wrap.clientWidth / wrap.clientHeight, 0.1, 20000);
    camera.position.set(0, 280, 750);
    const bgColor = new THREE.Color(COLORS.bg);
    const scene = new THREE.Scene(); scene.background = bgColor; scene.fog = new THREE.FogExp2(COLORS.bg, 0.00030);
    // Apply uploaded background image as a native-sized feathered patch (deepest layer).
    // scene.background stays the space color, so everywhere the patch doesn't cover is the
    // original galaxy. Re-applied here so it survives data refreshes (deps are [data] only).
    if (bgSrcRef.current) applyBgImage(scene, camera, wrap.clientHeight, bgSrcRef.current);
    const starTex = makeGlowTexture();
    const planetNames: Record<string, string> = {};

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    wrap.appendChild(renderer.domElement);

    // Controls
    const { OrbitControls } = require("three/examples/jsm/controls/OrbitControls.js");
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate; controls.autoRotateSpeed = 0.18;
    controls.minDistance = 80; controls.maxDistance = 2200;
    controls.addEventListener("start", () => { stateRef.current!.camTarget = null; });

    // Post-processing
    const { EffectComposer } = require("three/examples/jsm/postprocessing/EffectComposer.js");
    const { RenderPass } = require("three/examples/jsm/postprocessing/RenderPass.js");
    const { UnrealBloomPass } = require("three/examples/jsm/postprocessing/UnrealBloomPass.js");
    const { OutputPass } = require("three/examples/jsm/postprocessing/OutputPass.js");
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(wrap.clientWidth, wrap.clientHeight), 0.50, 0.50, 0.95));
    composer.addPass(new OutputPass());

    // ---- Build scene objects ----
    // Far stars
    { const N = 16000; const pos = new Float32Array(N * 3), col = new Float32Array(N * 3); const tints = [0xFFFFFF, 0xFFF4E0, 0xE0F0FF, 0xFFD8C0, 0xD8E8FF]; const c = new THREE.Color(); for (let i = 0; i < N; i++) { const r = 900 + Math.pow(Math.random(), 0.5) * 1600; const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th); c.setHex(tints[Math.floor(Math.random() * tints.length)]); const v = 0.55 + Math.random() * 0.45; col[i * 3] = c.r * v; col[i * 3 + 1] = c.g * v; col[i * 3 + 2] = c.b * v; } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3)); const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); pts.name = "farStars"; scene.add(pts); }

    // Galaxy
    { const pos = new Float32Array(16000 * 3), col = new Float32Array(16000 * 3), siz = new Float32Array(16000); const cW = new THREE.Color(0xFFD0A0), cM = new THREE.Color(0xA080D8), cC = new THREE.Color(0x68B0F0), c = new THREE.Color(); let k = 0; for (let i = 0; i < 11000; i++, k++) { const arm = i % 4; const u = Math.pow(Math.random(), 0.5); const r = 44 + (520 - 44) * u; const ang = arm * Math.PI / 2 + u * 2.7 * Math.PI * 2 + (Math.random() - 0.5) * (0.15 + 0.34 * u); pos[k * 3] = Math.cos(ang) * r; pos[k * 3 + 1] = (Math.random() - 0.5) * ((1 - u) * 30 + 5) / (1 + r * 0.015); pos[k * 3 + 2] = Math.sin(ang) * r; if (u < 0.5) c.copy(cW).lerp(cM, u / 0.5); else c.copy(cM).lerp(cC, (u - 0.5) / 0.5); const b = 0.5 + Math.random() * 0.45; col[k * 3] = c.r * b; col[k * 3 + 1] = c.g * b; col[k * 3 + 2] = c.b * b; siz[k] = 2.0 + Math.random() * 4.0 * (1 - u * 0.4); } for (let i = 0; i < 5000; i++, k++) { const rr = Math.pow(Math.random(), 0.5) * 74; const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); pos[k * 3] = rr * Math.sin(ph) * Math.cos(th); pos[k * 3 + 1] = rr * Math.cos(ph) * 0.5; pos[k * 3 + 2] = rr * Math.sin(ph) * Math.sin(th); c.copy(cW).lerp(cM, Math.random() * 0.5); const b = 0.6 + Math.random() * 0.45; col[k * 3] = c.r * b; col[k * 3 + 1] = c.g * b; col[k * 3 + 2] = c.b * b; siz[k] = 2.2 + Math.random() * 4.6; } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aColor", new THREE.BufferAttribute(col, 3)); g.setAttribute("aSize", new THREE.BufferAttribute(siz, 1)); const mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: wrap.clientHeight * 0.6 } }, vertexShader: "attribute vec3 aColor;attribute float aSize;varying vec3 vColor;uniform float uScale;void main(){vColor=aColor;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=aSize*(uScale/-mv.z);gl_Position=projectionMatrix*mv;}", fragmentShader: "varying vec3 vColor;void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,d);if(a<=.002)discard;gl_FragColor=vec4(pow(vColor,vec3(2.2)),a);}", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); const pts = new THREE.Points(g, mat); pts.name = "galaxy"; scene.add(pts); }

    // Nebula
    { const nebSprites = [{ c: 0x7A1E1E, r: 680, p: [-340, 140, 160], o: 0.10 }, { c: 0x8B4513, r: 760, p: [400, -100, -260], o: 0.08 }, { c: 0x5C1818, r: 600, p: [180, 180, -380], o: 0.09 }, { c: 0xA03000, r: 720, p: [-260, -140, 360], o: 0.07 }, { c: 0x6B2030, r: 580, p: [300, 60, 340], o: 0.06 }, { c: 0x1E3A5F, r: 760, p: [340, 120, 320], o: 0.11 }, { c: 0x2A5A6A, r: 640, p: [-400, -80, -300], o: 0.10 }, { c: 0x1A2E4A, r: 700, p: [220, -180, 260], o: 0.09 }, { c: 0x2E1A4A, r: 620, p: [-120, 220, -200], o: 0.08 }, { c: 0x1A4A3A, r: 620, p: [280, 100, -360], o: 0.07 }, { c: 0x4A1A4A, r: 540, p: [-200, 60, -420], o: 0.07 }, { c: 0xFF4400, r: 560, p: [0, 0, -700], o: 0.03 }]; nebSprites.forEach(d => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: d.c, transparent: true, opacity: d.o, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.set(d.p[0], d.p[1], d.p[2]); s.scale.set(d.r, d.r, 1); s.renderOrder = 5; scene.add(s); }); }

    // Sun
    { const sunGrp = new THREE.Group(); /* duplicate sun disabled: the real sun is the main-agent block below; kept only to avoid touching more code */
      const coreGeo = new THREE.SphereGeometry(16, 48, 48);
      const coreMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: "varying vec3 vObj;void main(){vObj=position;gl_Position=projectionMatrix*modelMatrix*vec4(position,1.0);}", fragmentShader: "uniform float uTime;varying vec3 vObj;float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}float fbm(vec3 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=0.5;}return v;}void main(){vec3 dir=normalize(vObj);float n=fbm(dir*5.0+vec3(0.0,uTime*0.15,0.0));float n2=fbm(dir*11.0-vec3(uTime*0.10,0.0,0.0));float gran=mix(n,n2,0.5);vec3 cH=vec3(1.0,0.96,0.78),cM=vec3(1.0,0.62,0.16),cC=vec3(0.92,0.30,0.05);vec3 col=mix(cC,cM,smoothstep(0.20,0.55,gran));col=mix(col,cH,smoothstep(0.55,0.92,gran));col*=0.78+0.55*gran;gl_FragColor=vec4(col,1.0);}" }); const coreMesh = new THREE.Mesh(coreGeo, coreMat); sunGrp.add(coreMesh); sunRef.current.core = coreMesh;
      const layers = [{ sz: 70, op: 1.00, c: 0xFFCB7A }, { sz: 130, op: 0.82, c: 0xFF9A2B }, { sz: 230, op: 0.52, c: 0xFF6A11 }, { sz: 360, op: 0.16, c: 0xFF4400 }, { sz: 430, op: 0.05, c: 0xE02000 }]; const sunLayers: THREE.Sprite[] = [];
      layers.forEach(L => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: L.c, transparent: true, opacity: L.op, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(L.sz, L.sz, 1); (s.userData as any).baseScale = L.sz; s.renderOrder = 6; sunGrp.add(s); sunLayers.push(s); });
      const sunFlareRays: THREE.LineSegments[] = [];
      for (let i = 0; i < 4; i++) { const angle = i * Math.PI / 4, len = 340, seg = 24; const pos2 = new Float32Array(seg * 6), col2 = new Float32Array(seg * 6); const dx = Math.cos(angle), dz = Math.sin(angle); for (let j = 0; j < seg; j++) { const t0 = j / seg, t1 = (j + 1) / seg; const r0 = 14 + t0 * len, r1 = 14 + t1 * len; pos2[j * 6] = r0 * dx; pos2[j * 6 + 1] = 0; pos2[j * 6 + 2] = r0 * dz; pos2[j * 6 + 3] = r1 * dx; pos2[j * 6 + 4] = 0; pos2[j * 6 + 5] = r1 * dz; const f0 = 1 - t0, f1 = 1 - t1; col2[j * 6] = f0; col2[j * 6 + 1] = 0.95 * f0; col2[j * 6 + 2] = 0.82 * f0; col2[j * 6 + 3] = f1; col2[j * 6 + 4] = 0.95 * f1; col2[j * 6 + 5] = 0.82 * f1; } const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.BufferAttribute(pos2, 3)); g2.setAttribute("color", new THREE.BufferAttribute(col2, 3)); const ray = new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false })); sunGrp.add(ray); sunFlareRays.push(ray); }
      sunRef.current.gr = sunGrp; sunRef.current.layers = sunLayers; sunRef.current.flareRays = sunFlareRays;
    }

    // Planets
    const satById: Record<string, GraphNode> = {};
    const planets: PlanetState[] = [];
    const orbitLines: THREE.LineSegments[] = [];

    if (data.agents.find(a => a.id === "main")) {
      const mainAgent = data.agents.find(a => a.id === "main")!;
      const grp = new THREE.Group(); scene.add(grp);
      const radius = SUN_RADIUS;
      // Sun core: emissive animated shader (original makeSun look)
      const sunMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG });
      const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 64), sunMat); core.userData = { kind: "planet", agentId: "main" }; grp.add(core);
      // Glow halo layers (scaled by core radius to keep the original proportion)
      const gf = Math.min(radius / 16, 1.2);
      const glowLayers = [
        { sz: 36 * gf, op: 1.00, c: 0xFFCB7A },
        { sz: 70 * gf, op: 0.78, c: 0xFF9A2B },
        { sz: 124 * gf, op: 0.5, c: 0xFF6A11 },
        { sz: 190 * gf, op: 0.14, c: 0xFF4400 },
        { sz: 230 * gf, op: 0.04, c: 0xE02000 },
      ];
      const sunLayers: THREE.Sprite[] = [];
      glowLayers.forEach(L => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: L.c, transparent: true, opacity: L.op, blending: THREE.AdditiveBlending, depthWrite: false }));
        s.scale.set(L.sz, L.sz, 1); s.userData = { baseScale: L.sz }; s.renderOrder = 6; grp.add(s); sunLayers.push(s);
      });
      // Soft cross flare rays
      const sunFlares: THREE.LineSegments[] = [];
      for (let i = 0; i < 4; i++) { const r = makeFlareRay(300 * gf, i * Math.PI / 4); grp.add(r); sunFlares.push(r); }
      sunRef.current = { core, layers: sunLayers, flareRays: sunFlares };
      // Sun label
      const sunLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelSprite("太阳", "#FFFFFF"), transparent: true, depthWrite: false, opacity: 0.95 }));
      sunLabel.scale.set(Math.max(radius * 4.2, 72), Math.max(radius * 1.7, 29), 1); sunLabel.position.set(0, radius + 26, 0); scene.add(sunLabel);
      planetNames["main"] = "太阳";
      planets.push({ agent: mainAgent, name: "太阳", mesh: core, grp, radius, orbitR: 0, angle0: 0, angVel: 0, tiltRad: 0, spin: 0.001, ecc: 0, inc: 0, label: sunLabel });
    }

    const others = data.agents.filter(a => a.id !== "main");
    others.slice(0, SOLAR_PLANETS.length).forEach((a, i) => {
      const style = SOLAR_PLANETS[i]; planetNames[a.id] = style.name;
      const grp = new THREE.Group(); scene.add(grp);
      const radius = radiusFromKm(style.rKm);
      const geo = new THREE.SphereGeometry(radius, 200, 200);
      const pos = geo.attributes.position; const v3 = new THREE.Vector3();
      for (let j = 0; j < pos.count; j++) { v3.fromBufferAttribute(pos, j); const n = v3.clone().normalize(); const uv = dirToUV(n.x, n.y, n.z); const h = planetHeight(style, uv[0], uv[1]); const disp = radius * 0.07 * (style.relief || 0.5) * (h - 0.5) * 2.0; v3.addScaledVector(n, disp); pos.setXYZ(j, v3.x, v3.y, v3.z); }
      geo.computeVertexNormals();
      const spin = spinFromSpeed(style.v, style.retro);
      const mat = new THREE.ShaderMaterial({ uniforms: { uType: { value: style.type }, uSeed: { value: style.seed }, uBase: { value: new THREE.Color(style.base).convertSRGBToLinear() }, uHi: { value: new THREE.Color(style.hi).convertSRGBToLinear() }, uLo: { value: new THREE.Color(style.lo).convertSRGBToLinear() }, uOcean: { value: new THREE.Color(style.ocean || "#0E2E6B").convertSRGBToLinear() }, uLand: { value: new THREE.Color(style.land || "#3FA34D").convertSRGBToLinear() }, uTime: { value: 0 }, uSpin: { value: spin }, uDiff: { value: style.diff ? 1 : 0 } }, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG });
      const mesh = new THREE.Mesh(geo, mat); mesh.userData = { kind: "planet", agentId: a.id }; const tiltRad = (style.tilt || 0) * DEG; mesh.rotation.set(0, 0, tiltRad); mesh.rotation.y = Math.random() * Math.PI * 2; grp.add(mesh);
      let ring: THREE.Mesh | undefined;
      if (style.ring) { const rGeo = new THREE.RingGeometry(radius * 1.45, radius * 2.3, 96); const rMat = new THREE.MeshBasicMaterial({ map: makeRingTexture(style.base), side: THREE.DoubleSide, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }); ring = new THREE.Mesh(rGeo, rMat); ring.rotation.x = Math.PI / 2; grp.add(ring); }
      const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelSprite(style.name, "#FFFFFF"), transparent: true, depthWrite: false, opacity: 0.9 })); labelSprite.scale.set(Math.max(radius * 4.2, 72), Math.max(radius * 1.7, 29), 1); labelSprite.position.y = radius + 26; scene.add(labelSprite);
      const rawPeriod = Math.sqrt(Math.pow(style.a, 3)); const minP = Math.sqrt(Math.pow(0.387, 3)), maxP = Math.sqrt(Math.pow(30.05, 3)); const speed01 = 1 - (rawPeriod - minP) / (maxP - minP);
      const angVel = (style.retro ? -1 : 1) * (0.005 + speed01 * 0.015); const angle0 = i * 2.39996 + 0.6; // 黄金角：相邻行星方向错开137°，避免内外行星投影共线
      const orbLine = makeOrbitMesh(style); orbitLines.push(orbLine); scene.add(orbLine);
      planets.push({ agent: a, name: style.name, mesh, grp, radius, orbitR: style.orbitR || orbitRFromAU(style.a), angle0, angVel, label: labelSprite, ring, tiltRad, spin, ecc: style.ecc || 0, inc: style.inc || 0, orbitLine: orbLine });
    });

    // Asteroid belts
    const belts: THREE.Points[] = [];
    [{ i: 2.1, o: 3.3, c: 2200, col: 0x9a8c7a, s: 2.4, op: 0.55 }, { i: 30, o: 39.482, c: 2600, col: 0xbfe0ee, s: 3.0, op: 0.5 }].forEach(b => {
      const inner = orbitRFromAU(b.i), outer = orbitRFromAU(b.o); const pos2 = new Float32Array(b.c * 3), col2 = new Float32Array(b.c * 3); const bc = new THREE.Color(b.col);
      for (let j = 0; j < b.c; j++) { const r = Math.sqrt(Math.random()) * (outer - inner) + inner; const ang = Math.random() * Math.PI * 2; const thick = (outer - inner) * 0.10; pos2[j * 3] = r * Math.cos(ang); pos2[j * 3 + 1] = (Math.random() - 0.5) * thick; pos2[j * 3 + 2] = r * Math.sin(ang); const b2 = 0.5 + Math.random() * 0.5; col2[j * 3] = bc.r * b2; col2[j * 3 + 1] = bc.g * b2; col2[j * 3 + 2] = bc.b * b2; }
      const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.BufferAttribute(pos2, 3)); g2.setAttribute("color", new THREE.BufferAttribute(col2, 3));
      const pts = new THREE.Points(g2, new THREE.PointsMaterial({ map: starTex, vertexColors: true, transparent: true, opacity: b.op, size: b.s, sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(pts); (pts.userData as any).spin = (Math.random() < 0.5 ? -1 : 1) * 0.0006; belts.push(pts);
    });

    // Satellites - keep satById for bridge lookups but no visual sprites
    data.nodes.forEach(n => { satById[n.id] = n; });

    // Bridge particles
    const evLinks: { a: string; b: string; kind: string }[] = [];
    data.edges.forEach(e => { if (e.k === "evidence") { const aid = satById[e.s]?.agent, bid = satById[e.t]?.agent; evLinks.push({ a: e.s, b: e.t, kind: (aid && bid && aid !== bid) ? "bridge" : "inner" }); } });
    const bridgeParticles: THREE.Sprite[] = []; const bridgeHit: THREE.Sprite[] = [];
    evLinks.forEach(e => {
      const m = new THREE.SpriteMaterial({ map: starTex, color: COLORS.bridgeDim, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.34, depthWrite: false }); const sp = new THREE.Sprite(m); sp.scale.set(7, 7, 1); sp.renderOrder = 14; sp.userData = { e, t: Math.random(), speed: 0.0011 + Math.random() * 0.0015, baseOp: 0.34, hit: null, shown: false }; sp.visible = false; scene.add(sp); bridgeParticles.push(sp);
      const hm = new THREE.SpriteMaterial({ map: starTex, transparent: true, opacity: 0, depthWrite: false }); const hs = new THREE.Sprite(hm); hs.scale.set(26, 26, 1); hs.renderOrder = 13; hs.userData = { e }; sp.userData.hit = hs; scene.add(hs); bridgeHit.push(hs);
      // Faint connecting line, only lit when the bridge is active.
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: COLORS.bridge, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); line.visible = false; line.renderOrder = 13; scene.add(line); sp.userData.line = line;
    });

    // Raycaster
    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    let hovered: THREE.Sprite | THREE.Mesh | null = null, hoveredPlanet: PlanetState | null = null, pointerDragged = false;
    let downX = 0, downY = 0;
    const tip = document.getElementById("mg-tip");

    function setHover(obj: THREE.Sprite | THREE.Mesh | null) {
      if (hovered && (hovered as any).userData?.node) hovered.scale.set((hovered as any).userData.baseScale, (hovered as any).userData.baseScale, 1);
      hovered = obj; hoveredPlanet = null;
      if (tip) tip.style.display = "none";
      if (obj && (obj as any).userData?.node) {
        const n = (obj as any).userData.node; hoveredPlanet = null;
        if (tip) { (tip.querySelector(".tk") as any).textContent = planetNames[n.agent] || n.agent; (tip.querySelector(".tt") as any).textContent = n.title || "(无标题)"; tip.style.display = "block"; }
        obj.scale.set((obj as any).userData.baseScale * 1.5, (obj as any).userData.baseScale * 1.5, 1);
      } else if (obj && (obj as any).userData?.kind === "planet") {
        const a = planets.find(p => p.agent.id === (obj as any).userData.agentId)?.agent; if (!a) return;
        hoveredPlanet = planets.find(p => p.agent.id === (obj as any).userData.agentId) || null;
        if (tip) { (tip.querySelector(".tk") as any).textContent = "PLANET"; (tip.querySelector(".tt") as any).textContent = (planetNames[a.id] || a.id) + " · " + a.count + "篇"; tip.style.display = "block"; }
      }
      updateOrbitVisibility(planets, hoveredPlanet, selectedPlanets);
    }

    function updateOrbitVisibility(pl: PlanetState[], hp: PlanetState | null, sel: Set<string>) {
      pl.forEach(p => { if (p.orbitLine) { const hot = hp === p || sel.has(p.agent.id); (p.orbitLine.material as THREE.Material).opacity = hot ? 0.32 : 0.06; } });
    }

    function applyBridgeHighlight(bp: THREE.Sprite[], pl: PlanetState[], sel: Set<string>) {
      const hasSel = sel.size > 0;
      bp.forEach(sp => {
        const e2 = sp.userData.e; const aA = satById[e2.a]?.agent, aB = satById[e2.b]?.agent;
        const show = hasSel && aA && aB && ((aA === "main" && (sel.has(aB) || sel.has("main"))) || (aB === "main" && (sel.has(aA) || sel.has("main"))));
        sp.userData.shown = show;
        if (show) { sp.material.color.setHex(COLORS.bridge); sp.userData.baseOp = 1.0; sp.scale.set(16, 16, 1); if (sp.userData.hit) sp.userData.hit.scale.set(30, 30, 1); if (sp.userData.line) { (sp.userData.line as THREE.Line).visible = true; ((sp.userData.line as THREE.Line).material as THREE.LineBasicMaterial).opacity = 0.22; } }
        else { sp.material.color.setHex(COLORS.bridgeDim); sp.userData.baseOp = 0; sp.scale.set(7, 7, 1); if (sp.userData.hit) sp.userData.hit.scale.set(26, 26, 1); if (sp.userData.line) { (sp.userData.line as THREE.Line).visible = false; } }
      });
      pl.forEach(p => { if (p.label) p.label.material.opacity = (hasSel && sel.has(p.agent.id)) ? 1 : 0.9; });
      updateOrbitVisibility(pl, null, sel);
    }

    // （原 highlightReset 已移除：其闭包捕获过期的 selectedPlanets，clear() 清不掉父组件状态，改用 setSelectedPlanets(new Set())）
    function frameAll() { const c = new THREE.Vector3(0, 0, 0); const maxR = Math.max(...planets.map(p => p.orbitR), ORBIT_NEAR) + 60; frameView(c, maxR); }

    function frameView(center: THREE.Vector3, radius: number) {
      const fovRad = camera.fov * Math.PI / 180; let dist = (radius / Math.sin(fovRad / 2)) * 1.3; dist = Math.min(dist, 1500);
      const dir = new THREE.Vector3(0.3, 0.22, 1).normalize();
      (stateRef.current as any).camTarget = center.clone().add(dir.multiplyScalar(dist));
      (stateRef.current as any).lookTarget = center.clone();
    }

    renderer.domElement.addEventListener("pointerdown", (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; pointerDragged = false; });
    renderer.domElement.addEventListener("pointermove", (e: PointerEvent) => { if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) pointerDragged = true; });
    renderer.domElement.addEventListener("click", (ev: MouseEvent) => {
      if (pointerDragged) return;
      const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const targets: THREE.Object3D[] = [...planets.map(p => p.mesh).filter(Boolean) as THREE.Mesh[], ...bridgeParticles, ...bridgeHit];
      const hits = raycaster.intersectObjects(targets, false);
      if (!hits.length) { selectedRef.current = new Set(); setSelectedPlanets(new Set()); applyBridgeHighlight(bridgeParticles, planets, selectedRef.current); setSelectedNode(null); setSidebarPanel(null); setPlanetPanelId(null); return; }
      const o = hits[0].object;
      if ((o as any).userData?.e) { const e3 = (o as any).userData.e; const aA = satById[e3.a]?.agent, aB = satById[e3.b]?.agent; const ns = new Set(selectedRef.current); if (aA) ns.add(aA); if (aB) ns.add(aB); selectedRef.current = ns; setSelectedPlanets(ns); applyBridgeHighlight(bridgeParticles, planets, ns); return; }
      if ((o as any).userData?.node) { const nd = (o as any).userData.node; setSelectedNode(nd); setSidebarPanel("node"); setPlanetPanelId(null); }
      else if ((o as any).userData?.kind === "planet") { const id = (o as any).userData.agentId; const wasOn = selectedRef.current.has(id); const ns = wasOn ? new Set<string>() : new Set<string>([id]); selectedRef.current = ns; setSelectedPlanets(ns); applyBridgeHighlight(bridgeParticles, planets, ns); if (ns.size === 0) { setSelectedNode(null); setSidebarPanel(null); setPlanetPanelId(null); } else { setSidebarPanel("planet:" + id); setPlanetPanelId(id); } }
    });
    renderer.domElement.addEventListener("mousemove", (ev: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...planets.map(p => p.mesh).filter(Boolean) as THREE.Mesh[], ...bridgeParticles, ...bridgeHit], false);
      setHover(hits.length ? hits[0].object as any : null);
      renderer.domElement.style.cursor = hits.length ? "pointer" : "default";
    });
    renderer.domElement.addEventListener("mouseleave", () => setHover(null));

    window.addEventListener("resize", () => {
      camera.aspect = wrap.clientWidth / wrap.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(wrap.clientWidth, wrap.clientHeight);
      composer.setSize(wrap.clientWidth, wrap.clientHeight);
      const galaxy = scene.getObjectByName("galaxy"); if (galaxy && (galaxy as THREE.Points).material instanceof THREE.ShaderMaterial) ((galaxy as THREE.Points).material as THREE.ShaderMaterial).uniforms.uScale.value = window.innerHeight * 0.6;
      if (bgMeshRef.current && bgNatRef.current) layoutBgMesh(bgMeshRef.current, bgNatRef.current.w, bgNatRef.current.h, wrap.clientHeight);
    });

    // Refresh is handled by the parent (MemoryGraphPage) via React state — no window.location.reload here.

    // State
    stateRef.current = { scene, camera, renderer, controls, composer, planets, satById, bridgeParticles, bridgeHit, hovered: null, hoveredPlanet: null, pointerDragged: false, planetNames, t: 0, camTarget: null, lookTarget: new THREE.Vector3() };
    (stateRef.current as any)._raf = 0;

    // NamesOn defaults
    planets.forEach(p => { if (p.label) p.label.visible = namesOn; });
    applyBridgeHighlight(bridgeParticles, planets, selectedPlanets);
    frameAll();
    (stateRef.current as any).frameAll = frameAll;
    setReady(true);

    const _bgDir = new THREE.Vector3();
    // Animate loop
    function animate() {
      (stateRef.current as any)._raf = requestAnimationFrame(animate);
      const s = stateRef.current!; s.t += 0.016;
      (scene.getObjectByName("galaxy") as THREE.Points)?.rotateY?.(0.0008);
      (scene.getObjectByName("farStars") as THREE.Points)?.rotateY?.(-0.00004);
      // Sun
      const cm = sunRef.current.core as THREE.Mesh; if (cm && (cm.material as THREE.ShaderMaterial).uniforms) (cm.material as THREE.ShaderMaterial).uniforms.uTime.value = s.t;
      const pulse = 1 + 0.060 * Math.sin(s.t * 1.4) + 0.035 * Math.sin(s.t * 2.3 + 1.2);
      (sunRef.current.layers as THREE.Sprite[])?.forEach((sp: THREE.Sprite) => { const bs = (sp.userData as any).baseScale; sp.scale.set(bs * pulse, bs * pulse, 1); });
      (sunRef.current.flareRays as THREE.LineSegments[])?.forEach((r: THREE.LineSegments, i: number) => { (r.material as THREE.LineBasicMaterial).opacity = 0.06 * (0.80 + 0.20 * Math.sin(s.t * 1.4 + i)); r.rotation.z += 0.0009; });
      // Planets
      const tmp = new THREE.Vector3(); // reused for bridge lerp
      planets.forEach(p => {
        if (!p.mesh) return; const ang = p.angle0 + s.t * p.angVel; const [ox, oy, oz] = orbitPos(p.orbitR, p.ecc, p.inc, ang); p.grp.position.set(ox, oy, oz);
        p.mesh.rotation.y += p.spin; if ((p.mesh.material as THREE.ShaderMaterial).uniforms) (p.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = s.t;
        if (p.label) p.label.position.set(ox, oy + p.radius + 26, oz);
      });
      // Bridges - flow between connected planet centers
      bridgeParticles.forEach(sp => { const e4 = sp.userData.e; const aNode = data.nodes.find(n => n.id === e4.a); const bNode = data.nodes.find(n => n.id === e4.b); if (!aNode || !bNode) { sp.visible = false; if (sp.userData.hit) sp.userData.hit.visible = false; return; } const aPlanet = planets.find(p => p.agent.id === aNode.agent); const bPlanet = planets.find(p => p.agent.id === bNode.agent); if (!aPlanet || !bPlanet) { sp.visible = false; if (sp.userData.hit) sp.userData.hit.visible = false; return; } sp.visible = !!sp.userData.shown; sp.userData.t += sp.userData.speed; if (sp.userData.t > 1) sp.userData.t -= 1; tmp.lerpVectors(aPlanet.grp.position, bPlanet.grp.position, sp.userData.t); sp.position.copy(tmp); sp.material.opacity = sp.userData.baseOp * (0.5 + 0.5 * Math.sin(sp.userData.t * Math.PI)); if (sp.userData.hit) { sp.userData.hit.position.copy(sp.position); sp.userData.hit.visible = sp.visible; } if (sp.userData.line && sp.visible) { const arr = (sp.userData.line as THREE.Line).geometry.attributes.position.array as Float32Array; arr[0] = aPlanet.grp.position.x; arr[1] = aPlanet.grp.position.y; arr[2] = aPlanet.grp.position.z; arr[3] = bPlanet.grp.position.x; arr[4] = bPlanet.grp.position.y; arr[5] = bPlanet.grp.position.z; (sp.userData.line as THREE.Line).geometry.attributes.position.needsUpdate = true; } });
      // Asteroid belts slowly orbit
      belts.forEach(b => { b.rotation.y += (b.userData as any).spin; });
      // Keep the uploaded background patch pinned behind the camera at native pixel size
      const bgm = bgMeshRef.current; if (bgm) { camera.getWorldDirection(_bgDir); bgm.position.copy(camera.position).addScaledVector(_bgDir, BG_DEPTH); bgm.quaternion.copy(camera.quaternion); }
      // Camera easing
      if (s.camTarget) { camera.position.lerp(s.camTarget, 0.06); controls.target.lerp(s.lookTarget, 0.06); if (camera.position.distanceTo(s.camTarget) < 0.8) s.camTarget = null; }
      controls.update(); composer.render();
    }
    animate();
    return () => { if (stateRef.current) cancelAnimationFrame((stateRef.current as any)._raf); if (bgMeshRef.current) { bgMeshRef.current.geometry.dispose(); (bgMeshRef.current.material as THREE.Material).dispose(); bgMeshRef.current = null; } if (bgTexRef.current) { bgTexRef.current.dispose(); bgTexRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // React to prop changes without rebuilding the whole scene.
  useEffect(() => { if (stateRef.current) stateRef.current.controls.autoRotate = autoRotate; }, [autoRotate]);
  useEffect(() => { stateRef.current?.planets?.forEach(p => { if (p.label) p.label.visible = namesOn; }); }, [namesOn]);
  useEffect(() => { stateRef.current?.frameAll?.(); }, [resetView]);

  // Swap / clear the uploaded background image without rebuilding the whole scene.
  useEffect(() => {
    const s = stateRef.current; if (!s) return;
    applyBgImage(s.scene, s.camera, wrapRef.current?.clientHeight || 1, bgImageSrc);
  }, [bgImageSrc]);

  return <div ref={wrapRef} id="canvasWrap" style={{
    position: "absolute", inset: 0,
    background: `radial-gradient(1100px 760px at 50% 46%, rgba(40,34,86,.34), transparent 60%),
      radial-gradient(800px 600px at 72% 24%, rgba(70,40,96,.20), transparent 56%),
      radial-gradient(900px 700px at 22% 74%, rgba(40,60,110,.18), transparent 56%), #04050A`
  }} />;
}

function makeOrbitMesh(style: any) {
  const a = style.orbitR, e = style.ecc || 0, b = a * Math.sqrt(Math.max(0, 1 - e * e)); const incRad = (style.inc || 0) * DEG; const cosI = Math.cos(incRad), sinI = Math.sin(incRad);
  const seg = 180; const pos = new Float32Array(seg * 6);
  for (let i = 0; i < seg; i++) { const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 0.5) / seg) * Math.PI * 2; pos[i * 6] = a * Math.cos(a0) - a * e; pos[i * 6 + 1] = b * Math.sin(a0) * sinI; pos[i * 6 + 2] = b * Math.sin(a0) * cosI; pos[i * 6 + 3] = a * Math.cos(a1) - a * e; pos[i * 6 + 4] = b * Math.sin(a1) * sinI; pos[i * 6 + 5] = b * Math.sin(a1) * cosI; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xF0C880, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }));
}

function GalaxyLegend({ data, planets, selectedPlanets, onTogglePlanet, onSelectPlanet, namesOn, onNamesOn }: any) {
  return <div className="absolute left-4 bottom-4 z-10 rounded-xl p-3 text-xs max-h-[46vh] overflow-auto flex flex-col min-w-[236px]" style={{ background: "rgba(18,20,32,.12)", border: "1px solid rgba(58,74,102,.35)", backdropFilter: "blur(14px)" }}>
    <h4 className="text-[10px] uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: "#5A6488" }}>行星 Planets
      <a className="ml-auto text-orange-400 text-[11px] normal-case tracking-normal cursor-pointer" onClick={() => onSelectPlanet("")}>全部星域</a>
    </h4>
    {planets.map((p: any, idx: number) => <div key={p.agent.id} className="flex items-center gap-2 my-[3px] cursor-pointer rounded-md p-[3px] hover:bg-white/5" onClick={() => onSelectPlanet(p.agent.id)}>
      <span className="w-[10px] h-[10px] rounded-full flex-shrink-0" style={{ background: p.agent.color, boxShadow: `0 0 8px ${p.agent.color}` }} />
      <span className={`flex-1 text-white text-xs truncate ${selectedPlanets.has(p.agent.id) ? "font-bold" : ""}`}>{data.planetNames?.[p.agent.id] || p.agent.id}</span>
      <b className="text-[#9AA6C4] text-xs">{p.agent.count}</b>
      <span className="text-[11px] cursor-pointer" style={{ opacity: namesOn ? 1 : 0.35 }} onClick={(e: any) => { e.stopPropagation(); onNamesOn(); }}>{namesOn ? "👁" : "👁"}</span>
    </div>)}
  </div>;
}

function GalaxyOverview({ data }: any) {
  const crossEdges = useMemo(() => data.edges?.filter((e: any) => e.k === "evidence" && (data.nodes.find((n: any) => n.id === e.s)?.agent !== data.nodes.find((n: any) => n.id === e.t)?.agent)).length || 0, [data]);
  return <div className="absolute z-10 w-[250px] rounded-xl p-3 text-xs"
    style={{ background: "rgba(16,18,30,.12)", border: "1px solid rgba(58,74,102,.35)", backdropFilter: "blur(16px)", top: 110, left: 18 }}>
    <div className="flex items-center gap-2 mb-2"><span className="w-[7px] h-[7px] rounded-full" style={{ background: "#FF3B30", boxShadow: "0 0 8px #FF3B30" }} /><span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "#5A6488" }}>Galaxy Overview</span></div>
    <div className="grid grid-cols-2 gap-2">
      {[["卫星星点", data.stats.nodes], ["星桥关联", data.stats.evidenceEdges], ["知识星域", data.stats.agents], ["跨域桥", crossEdges]].map(([l, v], i) => <div key={i} className="rounded-lg p-2" style={{ background: "rgba(28,32,48,.20)", border: "1px solid rgba(58,74,102,.25)" }}><div className="text-lg font-bold text-white">{v as number}</div><div className="text-[10px]" style={{ color: "#5A6488" }}>{l as string}</div></div>)}
    </div>
  </div>;
}

function KnowledgePanel({ data, planets, onOpenNote }: any) {
  const today = useMemo(() => { let max: Date | null = null; data.nodes.forEach((n: any) => { const dt = parseDate(n.date); if (dt && (!max || dt > max)) max = dt; }); return max || new Date(); }, [data]);
  const [last7, last30] = useMemo(() => { let l7 = 0, l30 = 0; data.nodes.forEach((n: any) => { const dt = parseDate(n.date); if (!dt) return; const days = (today.getTime() - dt.getTime()) / 86400000; if (days >= 0 && days <= 7) l7++; if (days >= 0 && days <= 30) l30++; }); return [l7, l30]; }, [data, today]);
  const cross = useMemo(() => data.edges?.filter((e: any) => e.k === "evidence" && (data.nodes.find((n: any) => n.id === e.s)?.agent !== data.nodes.find((n: any) => n.id === e.t)?.agent)).length || 0, [data]);
  const orphans = useMemo(() => { const linked = new Set<string>(); (data.edges || []).forEach((e: any) => { if (e.k !== "evidence") return; linked.add(e.s); linked.add(e.t); }); return data.nodes.filter((n: any) => !linked.has(n.id)).length; }, [data]);
  const dayCounts = useMemo(() => { const d: number[] = []; for (let i = 6; i >= 0; i--) { const dd = new Date(today); dd.setDate(dd.getDate() - i); d.push(data.nodes.filter((n: any) => n.date === dd.toISOString().slice(0, 10)).length); } return d; }, [data, today]);
  const maxDay = useMemo(() => Math.max(1, ...dayCounts), [dayCounts]);
  const recent = useMemo(() => data.nodes.filter((n: any) => n.date).sort((a: any, b: any) => (b.date || "").localeCompare(a.date || "")).slice(0, 9), [data]);
  const [collapsed, setCollapsed] = useState(false);
  return <div className={`absolute z-10 top-16 right-4 rounded-xl text-xs ${collapsed ? "w-auto px-3 py-2" : "w-[250px]"}`} style={{ backdropFilter: "blur(16px)", border: "1px solid rgba(58,74,102,.35)", background: "rgba(16,18,30,.12)", display: "flex", flexDirection: "column", gap: 1, maxHeight: "calc(100vh - 96px)", overflow: "auto" }}>
    <div className="flex items-center gap-2 p-2"><span className="w-[7px] h-[7px] rounded-full" style={{ background: "#FF3B30", boxShadow: "0 0 8px #FF3B30" }} /><span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "#5A6488" }}>Knowledge Health</span><button className="ml-auto cursor-pointer text-sm" style={{ color: "#5A6488" }} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "+" : "–"}</button></div>
    {!collapsed && <>
      <div className="px-3">{[["总记忆", data.stats.nodes, false], ["近7天新增", last7, last7 > 0], ["近30天新增", last30, last30 > 0], ["跨域星桥", cross, false], ["知识孤岛", orphans, false], ["来自 OpenClaw", data.stats.fromOpenclaw || 0, false]].map((r, i) => <div key={i} className="flex justify-between items-center py-1.5 border-b border-dashed border-white/5 text-xs"><span style={{ color: "#9AA6C4" }}>{r[0]}</span><span className={`font-bold ${r[2] ? "text-green-400" : "text-white"}`}>{r[1]}</span></div>)}</div>
      <div className="flex items-center gap-2 px-3 pt-2"><span className="text-[10px] font-bold uppercase" style={{ color: "#5A6488" }}>7-Day Activity</span></div>
      <div className="flex items-end gap-[3px] h-12 px-3">{dayCounts.map((c: number, i: number) => { const dd = new Date(today); dd.setDate(dd.getDate() - (6 - i)); return <div key={i} className="flex-1 flex flex-col items-center justify-end"><div className="w-full max-w-[22px] rounded-t-sm" style={{ height: `${(c / maxDay * 100).toFixed(0)}%`, minHeight: 2, background: "linear-gradient(0deg, #FF6B3D, #FF8A5C)", opacity: .85 }} /><div className="text-[8px] mt-1" style={{ color: "#5A6488" }}>{dd.toISOString().slice(5, 10)}</div></div>; })}</div>
      <div className="flex items-center gap-2 px-3 pt-2"><span className="text-[10px] font-bold uppercase" style={{ color: "#5A6488" }}>Recent Notes</span></div>
      <div className="px-1">{recent.map((n: any) => <div key={n.id} className="flex gap-2 items-start p-1.5 rounded-md cursor-pointer hover:bg-white/5 text-xs rn-item" onClick={() => onOpenNote(n)}><span className="text-[10px] pt-0.5 whitespace-nowrap" style={{ color: "#5A6488" }}>{n.date}</span><span className="text-white leading-tight line-clamp-2"><span className="inline-block w-[7px] h-[7px] rounded-full mr-1.5 align-middle" style={{ background: n.color, boxShadow: `0 0 6px ${n.color}` }} />{n.title || "(无标题)"}</span></div>)}</div>
    </>}
  </div>;
}

function SidePanel({ node, data, onClose, onOpenNode }: { node: GraphNode | null; data: GraphData; onClose: () => void; onOpenNode: (n: GraphNode) => void }) {
  const [content, setContent] = useState<string | null>(null);
  if (!node) return null;
  const related = (data.nodes || []).filter(n => n.agent === node.agent && n.id !== node.id).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  // 出链/入链：只统计星桥（evidence，含 [[双链]]），timeline 链是时间线相邻不算链接
  const byId = new Map((data.nodes || []).map(n => [n.id, n] as const));
  const outLinks: GraphNode[] = []; const inLinks: GraphNode[] = [];
  for (const e of data.edges || []) {
    if (e.k !== "evidence") continue;
    if (e.s === node.id) { const t = byId.get(e.t); if (t && t.id !== node.id && !outLinks.some(x => x.id === t.id)) outLinks.push(t); }
    if (e.t === node.id) { const s = byId.get(e.s); if (s && s.id !== node.id && !inLinks.some(x => x.id === s.id)) inLinks.push(s); }
  }
  const isOrphan = outLinks.length === 0 && inLinks.length === 0;
  const linkRow = (n2: GraphNode, arrow: string) => <div key={arrow + n2.id} className="flex gap-2 items-start p-1.5 rounded-md cursor-pointer hover:bg-white/5 text-xs" onClick={() => onOpenNode(n2)}><span className="text-[10px] pt-0.5 whitespace-nowrap" style={{ color: "#5A6488" }}>{arrow}</span><span className="text-white leading-tight"><span className="inline-block w-[7px] h-[7px] rounded-full mr-1.5 align-middle" style={{ background: n2.color, boxShadow: `0 0 6px ${n2.color}` }} />{n2.title || "(无标题)"}</span></div>;
  return <div className="w-[360px] flex-shrink-0 flex flex-col overflow-hidden" style={{ background: "rgba(18,20,32,.35)", backdropFilter: "blur(18px)", borderLeft: "1px solid rgba(58,74,102,.3)" }}>
    <div className="p-4 border-b border-white/5">
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "#5A6488" }}>NOTE · {node.agent}</div>
      <h2 className="text-base font-bold mt-1 text-white">{node.title || "(无标题)"}</h2>
      <div className="flex flex-wrap gap-1.5 mt-2">{[node.agent, `关联 ${node.degree || 0}`, ...(isOrphan ? ["知识孤岛 · 零链接"] : []), node.updated_at ? `更新 ${node.updated_at}` : ""].filter(Boolean).map((v, i) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-md border border-white/10" style={{ background: "rgba(28,32,48,.3)", color: "#9AA6C4" }}>{v}</span>)}</div>
    </div>
    <div className="flex-1 overflow-auto p-4">
      <p className="text-[13px] leading-relaxed whitespace-pre-wrap mb-4" style={{ color: "#9AA6C4" }}>{clip(node.snippet, 400) || "（暂无摘要）"}</p>
      {outLinks.length + inLinks.length === 0
        ? <div className="text-[11px] rounded-md p-2.5 mb-3 border border-dashed border-white/10 leading-relaxed" style={{ color: "#5A6488" }}>本笔记暂无星桥（双链数为 0）。写这条记忆时若用 <span style={{ color: "#9AA6C4" }}>[[页面名]]</span> 标注相关概念，这里就会出现可点击的出链/入链，并自动脱离「知识孤岛」。</div>
        : <div className="mb-2">
        {outLinks.length > 0 && <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: "#5A6488" }}>出链 · Links Out ({outLinks.length})</div>
          {outLinks.slice(0, 12).map(n2 => linkRow(n2, "→"))}
          {outLinks.length > 12 && <div className="text-[11px] mt-1" style={{ color: "#5A6488" }}>…还有 {outLinks.length - 12} 条</div>}
        </div>}
        {inLinks.length > 0 && <div>
          <div className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: "#5A6488" }}>入链 · Backlinks ({inLinks.length})</div>
          {inLinks.slice(0, 12).map(n2 => linkRow(n2, "←"))}
          {inLinks.length > 12 && <div className="text-[11px] mt-1" style={{ color: "#5A6488" }}>…还有 {inLinks.length - 12} 条</div>}
        </div>}
      </div>}
      {content && <pre className="bg-black/20 border border-white/10 rounded-lg p-3 text-xs mt-4 max-h-[46vh] overflow-auto whitespace-pre-wrap" style={{ color: "#9AA6C4" }}>{content}</pre>}
      {related.length > 0 && <div className="mt-4"><div className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: "#5A6488" }}>Related Notes ({related.length})</div>{related.map(n2 => <div key={n2.id} className="flex gap-2 items-start p-1.5 rounded-md cursor-pointer hover:bg-white/5 text-xs" onClick={() => onOpenNode(n2)}><span className="text-[10px] pt-0.5 whitespace-nowrap" style={{ color: "#5A6488" }}>{n2.date}</span><span className="text-white leading-tight"><span className="inline-block w-[7px] h-[7px] rounded-full mr-1.5 align-middle" style={{ background: n2.color, boxShadow: `0 0 6px ${n2.color}` }} />{n2.title || "(无标题)"}</span></div>)}</div>}
    </div>
    <div className="flex gap-2 p-3 border-t border-white/5">
      <button className="flex-1 py-2 rounded-lg text-xs cursor-pointer hover:bg-white/10" style={{ background: "rgba(28,32,48,.25)", border: "1px solid rgba(58,74,102,.25)", color: "#EAF0FF" }}
        onClick={async () => { if (!node.path) return; try { const r = await fetch(`/api/memory-graph/files?path=${encodeURIComponent(node.path)}`); const d = await r.json(); setContent(d.content || "(无内容)"); } catch { } }}>载入全文</button>
      <button className="flex-1 py-2 rounded-lg text-xs font-bold cursor-pointer" style={{ background: "#FF3B30", border: "none", color: "#0C0C0C" }} onClick={() => { if (node.path) window.open(`/files?path=${encodeURIComponent(node.path)}`, "_blank"); }}>在 Dashboard 打开</button>
    </div>
  </div>;
}

function PlanetPanel({ agentId, data, planets, onClose, onOpenNode }: { agentId: string; data: GraphData; planets: { agent: AgentInfo; name: string }[]; onClose: () => void; onOpenNode: (n: GraphNode) => void }) {
  const planet = planets.find(p => p.agent.id === agentId);
  if (!planet) return null;
  const a = planet.agent;
  const domainNotes = (data.nodes || []).filter(n => n.agent === agentId).sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  return <div className="w-[360px] flex-shrink-0 flex flex-col overflow-hidden" style={{ background: "rgba(18,20,32,.35)", backdropFilter: "blur(18px)", borderLeft: "1px solid rgba(58,74,102,.3)" }}>
    <div className="p-4 border-b border-white/5">
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "#5A6488" }}>PLANET · 知识星域</div>
      <h2 className="text-base font-bold mt-1 text-white">{planet.name}</h2>
      <div className="flex flex-wrap gap-1.5 mt-2">{[a.id, `${a.count} 篇记忆`].map((v, i) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-md border border-white/10" style={{ background: "rgba(28,32,48,.3)", color: "#9AA6C4" }}>{v}</span>)}</div>
    </div>
    <div className="flex-1 overflow-auto p-4">
      <p className="text-[13px] leading-relaxed whitespace-pre-wrap mb-4" style={{ color: "#9AA6C4" }}>该星域包含 {a.count} 条记忆，点击左侧或下方任意笔记可查看具体内容。</p>
      <div className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: "#5A6488" }}>该星域笔记 ({domainNotes.length})</div>
      {domainNotes.slice(0, 12).map(n => <div key={n.id} className="flex gap-2 items-start p-1.5 rounded-md cursor-pointer hover:bg-white/5 text-xs" onClick={() => onOpenNode(n)}><span className="text-[10px] pt-0.5 whitespace-nowrap" style={{ color: "#5A6488" }}>{n.date}</span><span className="text-white leading-tight"><span className="inline-block w-[7px] h-[7px] rounded-full mr-1.5 align-middle" style={{ background: n.color, boxShadow: `0 0 6px ${n.color}` }} />{n.title || "(无标题)"}</span></div>)}
    </div>
  </div>;
}

// ================================================================
// Main Page
// ================================================================
export default function MemoryGraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [namesOn, setNamesOn] = useState(true);
  const [resetView, setResetView] = useState(0);
  const [selectedPlanets, setSelectedPlanets] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [sidebarPanel, setSidebarPanel] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true); // 默认开启 30s 自动刷新
  const [planetPanelId, setPlanetPanelId] = useState<string | null>(null);
  const [bgImageSrc, setBgImageSrc] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const onBgFile = useCallback((e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setBgImageSrc(typeof r.result === "string" ? r.result : null); r.readAsDataURL(f); e.target.value = ""; }, []);
  const lastGenRef = useRef<string | null>(null);

  const openNode = useCallback((n: GraphNode) => { setSelectedNode(n); setPlanetPanelId(null); setSidebarPanel("node"); }, []);
  const closeAll = useCallback(() => { setSelectedNode(null); setPlanetPanelId(null); setSelectedPlanets(new Set()); setSidebarPanel(null); }, [setSelectedPlanets]);
  const toggleFullscreen = useCallback(() => { const el = document.getElementById("canvasWrap"); if (!document.fullscreenElement) el?.requestFullscreen?.(); else document.exitFullscreen?.(); }, []);
  const snapshotDate = useMemo<Date | null>(() => { let max: Date | null = null; (data?.nodes || []).forEach((n: any) => { const dt = parseDate(n.date); if (dt && (!max || dt > max)) max = dt; }); return max; }, [data]);

  // Reload graph data. Only triggers a scene rebuild (setData) when the
  // underlying data actually changed (compared by generatedAt) — avoids
  // needless rebuilds and the old window.location.reload() full-page refresh.
  const refreshData = useCallback((force = false) => {
    fetch("/api/memory-graph/data", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        // Manual refresh (force) always rebuilds the scene. The generatedAt
        // comparison only suppresses needless rebuilds during silent polling.
        if (!force && lastGenRef.current && d.generatedAt && d.generatedAt === lastGenRef.current) return;
        lastGenRef.current = d.generatedAt || null;
        setData(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetch("/api/memory-graph/data", { cache: "no-store" }).then(r => r.json()).then(d => { lastGenRef.current = d.generatedAt || null; setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);

  // Auto-refresh: pull new data on an interval, rebuild the scene only on change.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refreshData, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshData]);

  const planetList = useMemo(() => {
    if (!data) return [];
    const mainAgent = data.agents.find(a => a.id === "main");
    const others = data.agents.filter(a => a.id !== "main").slice(0, SOLAR_PLANETS.length);
    const ordered = mainAgent ? [mainAgent, ...others] : others;
    const names: Record<string, string> = {};
    ordered.forEach((a, i) => { names[a.id] = (mainAgent && i === 0) ? "太阳" : SOLAR_PLANETS[mainAgent ? i - 1 : i].name; });
    return ordered.map(a => ({ agent: a, name: names[a.id] }));
  }, [data]);

  const cross = useMemo(() => data ? data.edges.filter(e => e.k === "evidence" && data.nodes.find(n => n.id === e.s)?.agent !== data.nodes.find(n => n.id === e.t)?.agent).length : 0, [data]);

  if (loading) return <div className="flex items-center justify-center h-screen text-sm" style={{ color: "#5A6488", background: "#04050A" }}>加载记忆星系…</div>;
  if (!data) return <div className="flex items-center justify-center h-screen" style={{ color: "#5A6488", background: "#04050A" }}>数据加载失败</div>;

  return <div className="flex h-screen overflow-hidden" style={{ background: "#04050A", color: "#EAF0FF", fontFamily: "system-ui, sans-serif" }}>
    <div className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
      {/* Top bar */}
      <div className="flex items-center gap-4 px-4 py-3 h-12" style={{ background: "linear-gradient(180deg, rgba(4,5,10,.92), rgba(4,5,10,0))", zIndex: 10 }}>
        <div className="text-sm font-bold tracking-tight">Memory <span style={{ color: "#FF8A5C" }}>Galaxy</span> · 知识星系</div>
        <div className="text-xs" style={{ color: "#9AA6C4" }}>卫星 <b className="text-white">{data.stats.nodes}</b></div>
        <div className="text-xs" style={{ color: "#9AA6C4" }}>星桥 <b className="text-white">{data.stats.evidenceEdges}</b></div>
        {snapshotDate && <span className="text-xs" style={{ color: "#5A6488" }}>快照 {snapshotDate.toISOString().slice(0, 10)}</span>}
        <span className="topbar-status ml-4 text-xs" style={{ color: "#9AA6C4" }}>{selectedPlanets.size > 0 ? `已点亮 · ${[...selectedPlanets].map(id => planetList.find(p => p.agent.id === id)?.name || "中心").join("、")} · ` : "点击星球，点亮它到中心(主星)的星桥 · "}<button onClick={closeAll} className="text-orange-400 hover:text-orange-300 cursor-pointer" style={{ background: "none", border: "none" }}>取消选中</button></span>
        <div className="ml-auto flex gap-2">
          <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={onBgFile} />
          <button onClick={() => bgInputRef.current?.click()} className="px-3 py-1 rounded-lg text-xs cursor-pointer hover:bg-white/10" style={{ background: "rgba(18,20,32,.6)", border: "1px solid rgba(58,74,102,.5)", color: "#9AA6C4" }}>背景图</button>
          {bgImageSrc && <button onClick={() => setBgImageSrc(null)} className="px-3 py-1 rounded-lg text-xs cursor-pointer hover:bg-white/10" style={{ background: "rgba(18,20,32,.6)", border: "1px solid rgba(58,74,102,.5)", color: "#9AA6C4" }}>清除背景</button>}
          <button onClick={() => refreshData(true)} className="px-3 py-1 rounded-lg text-xs cursor-pointer hover:bg-white/10" style={{ background: "rgba(18,20,32,.6)", border: "1px solid rgba(58,74,102,.5)", color: "#9AA6C4" }}>刷新</button>
          <button onClick={() => setAutoRefresh(v => !v)} className={`px-3 py-1 rounded-lg text-xs cursor-pointer hover:bg-white/10${autoRefresh ? " active" : ""}`} style={{ background: autoRefresh ? "rgba(255,138,92,.22)" : "rgba(18,20,32,.6)", border: `1px solid ${autoRefresh ? "rgba(255,138,92,.6)" : "rgba(58,74,102,.5)"}`, color: autoRefresh ? "#FFB088" : "#9AA6C4" }}>自动</button>
        </div>
      </div>
      {/* 3D + overlaid panels */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <ThreeScene data={data} selectedPlanets={selectedPlanets} setSelectedPlanets={setSelectedPlanets} selectedNode={selectedNode} setSelectedNode={setSelectedNode} autoRotate={autoRotate} setAutoRotate={setAutoRotate} namesOn={namesOn} setNamesOn={setNamesOn} sidebarPanel={sidebarPanel} setSidebarPanel={setSidebarPanel} setPlanetPanelId={setPlanetPanelId} resetView={resetView} bgImageSrc={bgImageSrc} />
        {/* Tooltip */}
        <div id="mg-tip" className="absolute z-10 hidden pointer-events-none max-w-[260px] rounded-xl p-3 text-xs" style={{ background: "rgba(20,22,34,.55)", backdropFilter: "blur(12px)", border: "1px solid rgba(58,74,102,.35)", top: 0, left: 0 }}>
          <div className="tk text-[10px] uppercase tracking-wider font-bold" style={{ color: "#5A6488" }} />
          <div className="tt text-[13px] mt-1 text-white" />
        </div>
        {/* Hint */}
        <div className="absolute top-2 left-4 z-10 text-[11px] max-w-[230px] leading-relaxed" style={{ marginTop: 64, color: "#5A6488" }}>点击星球查看领域 · 点击星点查看笔记 · 拖拽旋转 · 滚轮缩放</div>
        {/* Overlay panels */}
        <GalaxyOverview data={data} />
        <KnowledgePanel data={data} planets={planetList} onOpenNote={openNode} />
        {/* Legend */}
        <div className="absolute left-4 bottom-4 z-10 rounded-xl p-3 text-xs max-h-[46vh] overflow-auto flex flex-col min-w-[236px]" style={{ background: "rgba(18,20,32,.12)", border: "1px solid rgba(58,74,102,.35)", backdropFilter: "blur(14px)" }}>
          <h4 className="text-[10px] uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: "#5A6488" }}>行星 Planets</h4>
          {planetList.map((p, idx) => <div key={p.agent.id} className="flex items-center gap-2 my-[3px] cursor-pointer rounded-md p-[3px] hover:bg-white/5" onClick={() => { const ns = new Set(selectedPlanets); if (ns.has(p.agent.id)) ns.delete(p.agent.id); else ns.add(p.agent.id); setSelectedPlanets(ns); if (ns.size === 0) setPlanetPanelId(null); else setPlanetPanelId(p.agent.id); }}>
            <span className="w-[10px] h-[10px] rounded-full flex-shrink-0" style={{ background: p.agent.color, boxShadow: `0 0 8px ${p.agent.color}` }} />
            <span className={`flex-1 text-white text-xs truncate ${selectedPlanets.has(p.agent.id) ? "font-bold" : ""}`}>{p.name}</span>
            <b className="text-[#9AA6C4] text-xs">{p.agent.count}</b>
            <span className="text-[11px] cursor-pointer opacity-55">👁</span>
          </div>)}
        </div>
        {/* Controls */}
        <div className="absolute right-4 bottom-4 z-10 flex gap-2">
          {[["自动旋转", autoRotate, () => setAutoRotate(!autoRotate)], ["标签", namesOn, () => setNamesOn(!namesOn)], ["重置视角", false, () => setResetView(v => v + 1)], ["全屏", false, toggleFullscreen]].map(([l, a, fn], i) => <button key={i} onClick={fn as any} className={`px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all ${a ? "border-orange-400 text-orange-400 bg-orange-400/10" : "text-[#9AA6C4]"}`} style={{ background: a ? "rgba(255,138,92,.1)" : "rgba(18,20,32,.12)", border: `1px solid ${a ? "#FF8A5C" : "rgba(58,74,102,.35)"}` }}>{l as string}</button>)}
        </div>
      </div>
    </div>
    {selectedNode
      ? <SidePanel key={selectedNode.id} node={selectedNode} data={data} onClose={closeAll} onOpenNode={openNode} />
      : planetPanelId
        ? <PlanetPanel key={planetPanelId} agentId={planetPanelId} data={data} planets={planetList} onClose={closeAll} onOpenNode={openNode} />
        : null}
  </div>;
}
