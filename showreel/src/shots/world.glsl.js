// The "oner": one continuous shader world for beats 8–20.
// 2D (top-down) and 3D phases use the same camera + the same floor function,
// so the flat Swiss grid can tilt into a perspective floor with no cut.
import { GLSL_COMMON } from '../gl.js';

export const worldFrag = (defines = '') => `#version 300 es
${defines}
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 o;

uniform vec2 uRes;
uniform vec2 uJitter;
uniform float uBeat;
uniform vec3 uCamPos, uCamF, uCamR, uCamU;
uniform float uTanHalf;
uniform float uRoll;
uniform vec3 uPal[6]; // 0 ink, 1 paper, 2 orange, 3 cobalt, 4 lime, 5 pink

// hero blobs
uniform int uBlobN;
uniform vec4 uBlob[9];      // x, z, scale, rot
uniform vec4 uBlobShape[9]; // typeA, typeB, morph, -
uniform vec3 uBlobCol[9];
uniform float uGoo;
uniform vec2 uBlobSquash;

// designed 3x3 core
uniform vec4 uInner[9];     // type, bgIndex, fgIndex, claim
uniform float uInnerMotif;

// grid choreography
uniform float uGridT0;
uniform vec3 uRotW[3];      // beat, originX, originZ
uniform vec3 uFlipW[2];     // beat, originX, -
uniform vec3 uMorphW[2];    // beat, originX, originZ
uniform vec4 uImpact[4];    // x, z, beat, radius

// hero ball (3D)
uniform vec4 uBall;         // center xyz, radius
uniform vec3 uBallScale;
uniform float uBallOn;
uniform float uMetal;
uniform vec3 uSkyTop, uSkyHor;
uniform float uFog;

${GLSL_COMMON}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdCross(vec2 p, vec2 b) {
  p = abs(p); p = (p.y > p.x) ? p.yx : p.xy;
  vec2 q = p - b; float k = max(q.y, q.x);
  vec2 w = (k > 0.0) ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.0));
}
float easeOutBack(float t) { float s = 1.70158; t -= 1.0; return 1.0 + (s + 1.0) * t * t * t + s * t * t; }
float easeInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
float springf(float t, float f, float z) {
  if (t <= 0.0) return 0.0;
  float w = f * 6.2831853; float wd = w * sqrt(1.0 - z * z);
  return 1.0 - exp(-z * w * t) * (cos(wd * t) + (z * w / wd) * sin(wd * t));
}

// Tile motifs, tile-local q in [-0.5, 0.5]^2
float motif(int type, vec2 q) {
  float box = sdBox(q, vec2(0.5));
  if (type == 0) return length(q) - 0.36;                                        // circle
  if (type == 1) return max(length(q + 0.5) - 1.0, box);                         // quarter
  if (type == 2) return max(length(q - vec2(0.0, -0.5)) - 0.5, box);             // half disc
  if (type == 3) return max((q.x + q.y) * 0.70710678, box);                      // triangle
  if (type == 4) return abs(length(q) - 0.285) - 0.105;                          // ring
  if (type == 5) return sdCross(q, vec2(0.4, 0.125));                            // plus
  if (type == 6) return max(abs(mod(q.y + 0.5, 1.0 / 3.0) - 1.0 / 6.0) - 1.0 / 12.0, box); // stripes
  if (type == 7) return sdSeg(q, vec2(-0.19, 0.0), vec2(0.19, 0.0)) - 0.2;       // pill
  if (type == 8) return (abs(q.x) + abs(q.y) - 0.44) * 0.70710678;               // diamond
  if (type == 9) { vec2 g = mod(q + 0.5, 1.0 / 3.0) - 1.0 / 6.0; return max(length(g) - 0.085, box); } // dots
  if (type == 10) return max(max(length(q + 0.5) - 1.0, length(q - 0.5) - 1.0), box);     // leaf
  return max(min(sdBox(q - vec2(0.0, -0.22), vec2(0.3, 0.28)), length(q - vec2(0.0, 0.06)) - 0.3), box); // arch
}

// ---------------------------------------------------------------- tile grid
const int NCOMBO = 10;
ivec2 combo(int i) {
  if (i == 0) return ivec2(1, 2);
  if (i == 1) return ivec2(2, 1);
  if (i == 2) return ivec2(3, 4);
  if (i == 3) return ivec2(0, 1);
  if (i == 4) return ivec2(4, 3);
  if (i == 5) return ivec2(5, 0);
  if (i == 6) return ivec2(2, 3);
  if (i == 7) return ivec2(1, 3);
  if (i == 8) return ivec2(0, 2);
  return ivec2(3, 1);
}

vec3 tileLayer(vec2 p, float aa, vec3 base) {
  vec2 id = floor(p + 0.5);
  vec2 q = p - id;
  bool inner = abs(id.x) < 1.5 && abs(id.y) < 1.5;
#ifdef CORE_ONLY
  if (!inner) return base;
#endif
  float h1 = hash(id), h2 = hash(id + 17.31), h3 = hash(id + 3.77);
  int type; int bgi; int fgi; float appear; float motifOn = 1.0;
  float dist = length(id);
  if (inner) {
    int k = int(id.y + 1.0) * 3 + int(id.x + 1.0);
    vec4 d = uInner[k];
    type = int(d.x + 0.5); bgi = int(d.y + 0.5); fgi = int(d.z + 0.5);
    appear = d.w; motifOn = uInnerMotif;
  } else {
    type = int(h1 * 11.99);
    ivec2 c = combo(int(h2 * float(NCOMBO) - 0.001));
    bgi = c.x; fgi = c.y;
    float delay = 0.05 + dist * 0.085 + h3 * 0.05;
    float since = (uBeat - uGridT0 - delay) * 0.46875;
    appear = since > 2.5 ? 1.0 : springf(since, 2.4, 0.5);
  }
  if (appear <= 0.001) return base;

  // choreography: rotations, flips (colour swaps), morphs — one loop per kind so
  // SIMD-masked GPUs/CPUs never pay for branches they don't take
  float r = 0.0; float flipScale = 1.0; float swaps = 0.0; float shade = 1.0;
  int cur = type; int nxt = type; float morph = 0.0;
#ifdef HAS_WAVES
  for (int k = 0; k < 3; k++) {
    vec3 wv = uRotW[k];
    float pr = clamp((uBeat - wv.x - length(id - wv.yz) * 0.045) / 0.42, 0.0, 1.0);
    float dir = hash(id + float(k) * 9.1) < 0.5 ? -1.0 : 1.0;
    r += dir * 1.5707963 * easeOutBack(pr);
  }
  for (int k = 0; k < 2; k++) {
    vec3 wv = uFlipW[k];
    float e = easeInOut(clamp((uBeat - wv.x - (id.x - wv.y) * 0.035) / 0.3, 0.0, 1.0));
    float sel = step(hash(id + float(k) * 3.3), 0.55);
    flipScale *= mix(1.0, abs(cos(3.14159265 * e)), sel);
    shade *= 1.0 - 0.35 * sin(3.14159265 * e) * sel;
    swaps += step(0.5, e) * sel;
  }
  for (int k = 0; k < 2; k++) {
    vec3 wv = uMorphW[k];
    float pr = clamp((uBeat - wv.x - length(id - wv.yz) * 0.045) / 0.42, 0.0, 1.0);
    int nt = int(mod(float(cur) + 1.0 + floor(hash(id + float(k) + 5.0) * 4.0), 12.0));
    if (pr >= 1.0) { cur = nt; nxt = nt; morph = 0.0; }
    else if (pr > 0.0) { nxt = nt; morph = easeInOut(pr); }
  }
#endif
#ifdef HAS_IMPACTS
  for (int k = 0; k < 4; k++) {
    vec4 im = uImpact[k];
    float dl = length(id - im.xy);
    float e = easeInOut(clamp((uBeat - im.z - dl * 0.07) / 0.28, 0.0, 1.0)) * step(dl, im.w);
    flipScale *= abs(cos(3.14159265 * e));
    shade *= 1.0 - 0.4 * sin(3.14159265 * e);
    swaps += step(0.5, e);
  }
#endif
  if (mod(swaps, 2.0) > 0.5) { int t = bgi; bgi = fgi; fgi = t; }

  vec2 qf = q; qf.x /= max(flipScale, 0.03);
  float a1 = min(appear, 1.0);
  float hs = 0.5 * appear;
  float cr = 0.5 * (1.0 - a1) * 0.9;
  float dTile = sdBox(qf, vec2(max(hs - cr, 0.0))) - cr;
  if (appear >= 0.999 && flipScale > 0.999) dTile -= 2.0 * aa; // no hairline seams between settled tiles
  if (flipScale < 0.03) dTile = 1.0;
  vec2 qm = rot(-r) * (qf / max(appear, 0.001));
#ifdef HAS_WAVES
  float dm = mix(motif(cur, qm), motif(nxt, qm), morph) * appear;
#else
  float dm = motif(cur, qm) * appear;
#endif
  float aaT = aa;
  vec3 col = mix(base, uPal[bgi] * shade, smoothstep(aaT, -aaT, dTile));
  col = mix(col, uPal[fgi] * shade, smoothstep(aaT, -aaT, max(dm, dTile)) * motifOn);
  return col;
}

vec4 blobLayer(vec2 p, float aa) {
  if (uBlobN <= 0) return vec4(0.0);
  float d = 1e5; vec3 c = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= uBlobN) break;
    vec4 B = uBlob[i];
    if (B.z <= 0.0001) continue;
    vec4 S = uBlobShape[i];
    // bounding-circle early out (motifs fit inside the unit tile => r <= 0.71)
    float bound = 0.72 * B.z * max(uBlobSquash.x, uBlobSquash.y) + uGoo + 4.0 * aa;
    if (length(p - B.xy) > bound) continue;
    vec2 rel = (p - B.xy) / uBlobSquash;
    vec2 q = rot(-B.w) * rel / B.z;
    q.x /= max(S.w, 0.02);
    float di = mix(motif(int(S.x + 0.5), q), motif(int(S.y + 0.5), q), S.z) * B.z * min(uBlobSquash.x, uBlobSquash.y) * max(S.w, 0.02);
    float k = uGoo;
    if (k > 0.001) { float h = clamp(0.5 + 0.5 * (d - di) / k, 0.0, 1.0); d = mix(d, di, h) - k * h * (1.0 - h); }
    else d = min(d, di);
    float w = exp(-max(di, 0.0) * 18.0 / max(k, 0.05));
    c += uBlobCol[i] * w; ws += w;
  }
  c /= max(ws, 1e-5);
  return vec4(c, smoothstep(aa, -aa, d));
}

vec3 floorColor(vec2 p, float aa) {
  return tileLayer(p, aa, uPal[3]);
}

// ---------------------------------------------------------------- 3D helpers
float iEllipsoid(vec3 ro, vec3 rd, vec3 c, vec3 r) {
  vec3 oc = (ro - c) / r; vec3 d = rd / r;
  float a = dot(d, d), b = dot(oc, d), cc = dot(oc, oc) - 1.0;
  float h = b * b - a * cc;
  if (h < 0.0) return -1.0;
  return (-b - sqrt(h)) / a;
}
float sphSoftShadow(vec3 ro, vec3 rd, vec4 sph, float k) {
  vec3 oc = ro - sph.xyz; float b = dot(oc, rd); float c = dot(oc, oc) - sph.w * sph.w; float h = b * b - c;
  return (b > 0.0) ? step(-0.0001, c) : smoothstep(0.0, 1.0, h * k / b);
}
float sphOcclusion(vec3 pos, vec3 nor, vec4 sph) {
  vec3 di = sph.xyz - pos; float l = length(di); float nl = dot(nor, di / l);
  float h = l / sph.w; float h2 = h * h;
  float k2 = 1.0 - h2 * nl * nl;
  float res = max(0.0, nl) / h2;
  if (k2 > 0.001) { res = (nl * h + 1.0) / h2; res = 0.33 * res * res; }
  return clamp(res, 0.0, 1.0);
}
float softbox(vec3 rd, vec3 dir, vec2 size, vec3 up) {
  vec3 right = normalize(cross(dir, up)); vec3 u2 = cross(right, dir);
  float f = dot(rd, dir); if (f <= 0.0) return 0.0;
  vec2 pp = vec2(dot(rd, right), dot(rd, u2)) / f;
  vec2 d = abs(pp) - size;
  return smoothstep(0.02, -0.02, max(d.x, d.y));
}
vec3 sky(vec3 rd) {
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 col = mix(uSkyHor, uSkyTop, pow(y, 0.55));
  col += vec3(1.0, 0.97, 0.92) * 3.2 * softbox(rd, normalize(vec3(-0.55, 0.62, 0.45)), vec2(0.5, 0.22), vec3(0, 1, 0));
  col += vec3(0.92, 0.95, 1.0) * 1.6 * softbox(rd, normalize(vec3(0.7, 0.35, -0.5)), vec2(0.18, 0.5), vec3(0, 1, 0));
  return col;
}
vec4 ballSph() { return vec4(uBall.xyz, uBall.w * max(uBallScale.x, uBallScale.y)); }

vec3 shadeFloorAt(vec3 p, float aa, float dist) {
  vec3 c = floorColor(p.xz, aa);
#ifdef HAS_BALL
  if (uBallOn > 0.5) {
    vec4 sph = ballSph();
    vec3 L = normalize(vec3(-0.35, 1.0, 0.25));
    float sh = sphSoftShadow(p, L, sph, 6.0);
    float oc = sphOcclusion(p, vec3(0, 1, 0), sph);
    c *= mix(0.5, 1.0, sh) * (1.0 - 0.75 * oc);
  }
#endif
  float fog = 1.0 - exp(-max(dist - 5.0, 0.0) * uFog);
  return mix(c, uSkyHor, fog);
}

vec3 envColor(vec3 ro, vec3 rd) {
  if (rd.y < -0.0005) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    return shadeFloorAt(p, 0.02 + t * 0.012, t + 4.0);
  }
  return sky(rd);
}

void main() {
  vec2 frag = gl_FragCoord.xy + uJitter;
  vec2 uv = (frag - 0.5 * uRes) / (0.5 * uRes.y); // y in [-1,1]
  uv = rot(uRoll) * uv;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamF + uv.x * uTanHalf * uCamR + uv.y * uTanHalf * uCamU);

  // primary floor hit (unconditional so derivatives stay valid)
  float tf = rd.y < -1e-5 ? -ro.y / rd.y : 1e6;
  vec3 pf = ro + rd * tf;
  float aa = length(fwidth(pf.xz)) * 0.75 + 1e-4;

#if defined(BLOB_PASS)
  vec4 bl = blobLayer(pf.xz, aa);
  if (bl.a <= 0.0005) discard;
  o = bl;
#elif defined(BALL_PASS)
  vec3 R3 = uBall.w * uBallScale;
  float tb = iEllipsoid(ro, rd, uBall.xyz, R3);
  if (tb <= 0.0 || tb >= tf) discard;
  vec3 p = ro + rd * tb;
  vec3 n = normalize((p - uBall.xyz) / (R3 * R3));
  vec3 V = -rd;
  float ct = clamp(dot(n, V), 0.0, 1.0);
  vec3 R = reflect(rd, n);
  vec3 env = envColor(p + n * 0.003, R);
  vec3 L = normalize(vec3(-0.35, 1.0, 0.25));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 base = uPal[2];
  vec3 below = floorColor(p.xz + n.xz * 0.6, 0.2);
  vec3 lacquer = base * (0.22 + 0.9 * diff) + below * base * 0.55 * clamp(-n.y + 0.2, 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - ct, 5.0);
  lacquer = mix(lacquer, env, F) + env * 0.06;
  vec3 F0 = base * 1.05 + 0.03;
  vec3 metal = env * mix(F0, vec3(1.0), pow(1.0 - ct, 5.0));
  vec3 col = mix(lacquer, metal, uMetal);
  col = mix(col * 0.85, col, smoothstep(0.0, 0.08, ct));
  o = vec4(col, 1.0);
#else
  vec3 col = tf < 1e5 ? shadeFloorAt(pf, aa, tf) : sky(rd);
  o = vec4(col, 1.0);
#endif
}
`;
