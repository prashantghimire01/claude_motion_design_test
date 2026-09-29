// WORLD (beats 8–20): mitosis → Swiss grid → tilt into 3D → lacquered hero ball.
// JS computes the choreography as uniforms; world.glsl.js renders it.
import { clamp, lerp, prog, ease, spring, wobble, EASE, PAL, rgba, linRGB, TAU, hash1 } from '../lib.js';
import { BEAT, WORLD } from '../timeline.js';
import { worldFrag } from './world.glsl.js';

const DEG = Math.PI / 180;
const G = 60; // world units / s² (1 unit = 1 tile)
const BALL_R = 0.5;

// Designed 3×3 core (row-major from bottom row z=-1 to top z=+1).
// [type, bg, fg]   palette: 0 ink, 1 paper, 2 orange, 3 cobalt, 4 lime, 5 pink
const CORE = [
  [4, 0, 1], [10, 5, 0], [1, 2, 3],
  [5, 4, 3], [0, 3, 2], [3, 1, 0],
  [1, 1, 2], [2, 2, 1], [9, 0, 4],
];
const PAL_KEYS = ['ink', 'paper', 'orange', 'cobalt', 'lime', 'pink'];

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function orbitCam(target, pitch, yaw, D, vfov) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [cp * Math.sin(yaw), sp, cp * Math.cos(yaw)];
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = cross(f, r);
  const pos = [target[0] - f[0] * D, target[1] - f[1] * D, target[2] - f[2] * D];
  return { pos, f, r, u, tanHalf: Math.tan(vfov / 2) };
}
const mixRGB = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

export async function createWorld({ comp, W, H }) {
  // Phase-specialised programs (dead code compiled out per phase)
  const PROGS = {
    A: comp.program(worldFrag('#define CORE_ONLY')),
    Ablobs: comp.program(worldFrag('#define CORE_ONLY\n#define BLOB_PASS')),
    B: comp.program(worldFrag('#define HAS_WAVES')),
    C: comp.program(worldFrag('#define HAS_WAVES\n#define HAS_BALL\n#define HAS_IMPACTS')),
    Cball: comp.program(worldFrag('#define HAS_WAVES\n#define HAS_BALL\n#define HAS_IMPACTS\n#define BALL_PASS')),
  };

  // project a world point to GL pixel coords (origin bottom-left); null if behind
  function project(cam, P) {
    const d = [P[0] - cam.pos[0], P[1] - cam.pos[1], P[2] - cam.pos[2]];
    const z = d[0] * cam.f[0] + d[1] * cam.f[1] + d[2] * cam.f[2];
    if (z <= 1e-3) return null;
    let x = (d[0] * cam.r[0] + d[1] * cam.r[1] + d[2] * cam.r[2]) / (z * cam.tanHalf);
    let y = (d[0] * cam.u[0] + d[1] * cam.u[1] + d[2] * cam.u[2]) / (z * cam.tanHalf);
    const c = Math.cos(-cam.roll), s = Math.sin(-cam.roll);
    [x, y] = [c * x - s * y, s * x + c * y];
    return { x: W / 2 + x * H / 2, y: H / 2 + y * H / 2, z };
  }
  function scissorFromCircles(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py, pr] of list) { x0 = Math.min(x0, px - pr); y0 = Math.min(y0, py - pr); x1 = Math.max(x1, px + pr); y1 = Math.max(y1, py + pr); }
    x0 = Math.max(0, Math.floor(x0 - 24)); y0 = Math.max(0, Math.floor(y0 - 24));
    x1 = Math.min(W, Math.ceil(x1 + 24)); y1 = Math.min(H, Math.ceil(y1 + 24));
    if (x1 <= x0 || y1 <= y0) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }
  const aspect = W / H;
  const palLin = PAL_KEYS.map((k) => linRGB(PAL[k]));
  const T = (b) => b * BEAT;

  // ------------------------------------------------------------ hero ball (3D)
  const lands = WORLD.ballLand; // beats
  const landPos = [[0, 0], [1.15, -0.35], [1.7, -0.55], [1.98, -0.64]];
  const dropStart = 16.3;
  const DROP_Y = 5.2;
  const G_DROP = (2 * (DROP_Y - BALL_R)) / Math.pow(T(17.0 - dropStart), 2);
  function ball3(b) {
    const t = T(b);
    // vertical
    let y = BALL_R, vy = 0, x = 0, z = 0, grounded = false;
    if (b < lands[0]) {
      const dt = T(lands[0]) - t;
      y = BALL_R + 0.5 * G_DROP * dt * dt; vy = -G_DROP * dt;
      const p = prog(b, dropStart, lands[0]);
      x = lerp(-0.45, landPos[0][0], p); z = lerp(0.2, landPos[0][1], p);
    } else {
      let found = false;
      for (let i = 1; i < lands.length; i++) {
        if (b < lands[i]) {
          const a = T(lands[i - 1]), e = T(lands[i]);
          const u = t - a, Tt = e - a;
          y = BALL_R + 0.5 * G * u * (Tt - u); vy = 0.5 * G * (Tt - 2 * u);
          const p = u / Tt;
          x = lerp(landPos[i - 1][0], landPos[i][0], p); z = lerp(landPos[i - 1][1], landPos[i][1], p);
          found = true; break;
        }
      }
      if (!found) { x = landPos[3][0]; z = landPos[3][1]; y = BALL_R; grounded = true; }
    }
    // squash on impacts
    let sq = 0;
    for (let i = 0; i < lands.length; i++) {
      const dt = t - T(lands[i]);
      if (dt < 0 || dt > 0.4) continue;
      const amp = [0.36, 0.22, 0.12, 0.07][i];
      sq += amp * Math.exp(-dt * 16) * Math.cos(dt * 38);
    }
    // anticipation before launch
    const ant = prog(b, lands[3] + 0.02, WORLD.launch);
    if (b >= lands[3] && b < WORLD.launch) sq += 0.3 * ease.outCubic(ant);
    const st = 1 + clamp(Math.abs(vy) / 30) * 0.22;
    let sy, sxz;
    if (Math.abs(sq) > 0.005) { sy = 1 - sq; sxz = 1 / Math.sqrt(sy); y = BALL_R * sy; if (b < lands[0]) y = Math.max(y, BALL_R * sy); }
    else { sy = st; sxz = 1 / Math.sqrt(st); }
    if (b >= lands[0] && Math.abs(sq) > 0.005 && !grounded) {
      // near-contact frames: keep bottom on the floor
      y = Math.max(y - BALL_R + BALL_R * sy, BALL_R * sy);
    }
    return { x, y, z, sy, sxz };
  }

  // ------------------------------------------------------------ camera
  function camera(b) {
    let target, Vw, roll = 0;
    if (b < 12) {
      Vw = b < 8.6 ? lerp(6.2, 5.4, ease.outCubic(prog(b, 8, 8.6))) : lerp(5.4, 5.15, prog(b, 8.6, 12));
      target = [0, 0, 0];
      roll = 0;
    } else {
      const z1 = EASE.snap(prog(b, 12.0, 13.1));
      Vw = lerp(5.15, 12.8, z1) + lerp(0, 1.2, ease.inOutSine(prog(b, 13.1, 16.2)));
      target = [lerp(0, 0.5, ease.inOutSine(prog(b, 12.5, 16.2))), 0, lerp(0, 0.25, ease.inOutSine(prog(b, 12.5, 16.2)))];
      roll = -5 * DEG * z1 + 2 * DEG * ease.inOutSine(prog(b, 13.1, 16));
    }
    const vfov0 = 30 * DEG;
    const D0 = Vw / (2 * Math.tan(vfov0 / 2) * aspect);
    if (b < 16) return { ...orbitCam(target, -90 * DEG, 0, D0, vfov0), roll };

    // Tilt into 3D (dolly-zoom flavoured)
    const bp = ball3(Math.min(b, WORLD.launch));
    const k = EASE.snap(prog(b, 16.0, 16.7));
    const orbit = ease.inOutSine(prog(b, 16.0, 20.0));
    const pitch = lerp(-90, -24, k) * DEG + lerp(0, 5, orbit) * DEG;
    const yaw = lerp(0, 16, k) * DEG + lerp(0, 26, orbit) * DEG;
    const vfov = lerp(30, 46, k) * DEG;
    const follow = ease.inOutSine(prog(b, 16.6, 19.2));
    const tgt3 = [lerp(0.2, bp.x * 0.8 + 0.1, follow), lerp(0, 0.95, k), lerp(0.4, bp.z * 0.8 + 0.3, follow)];
    const tgt = [lerp(target[0], tgt3[0], k), tgt3[1] * k, lerp(target[2], tgt3[2], k)];
    const D = lerp(D0, 5.5, k) - 0.7 * ease.inOutSine(prog(b, 17, 20));
    return { ...orbitCam(tgt, pitch, yaw, D, vfov), roll: roll * (1 - k) };
  }

  // Ball launch toward the lens (beats 19 → 20)
  function ballFinal(b) {
    if (b < WORLD.launch) return ball3(b);
    const start = ball3(WORLD.launch - 1e-4);
    const cam = camera(WORLD.lensHit);
    const K = BALL_R * 1.3;
    const end = [cam.pos[0] + cam.f[0] * K, cam.pos[1] + cam.f[1] * K, cam.pos[2] + cam.f[2] * K];
    const p = prog(b, WORLD.launch, WORLD.lensHit);
    const e = ease.inOutCubic(p);
    const arc = 2.2 * Math.sin(Math.PI * Math.min(1, p * 1.25)) * (1 - p);
    const st = 1 + 0.08 * Math.sin(Math.PI * p);
    return {
      x: lerp(start.x, end[0], e), y: lerp(BALL_R, end[1], e) + arc, z: lerp(start.z, end[2], e),
      sy: st, sxz: 1 / Math.sqrt(st),
    };
  }

  // ------------------------------------------------------------ mitosis → core
  const r0 = 88 / (W / 6.2);
  const DANCE = CORE.map(([type, bg, fg]) => (bg === 3 ? fg : bg));
  function blobs(b) {
    const t = T(b);
    const pos = [], shape = [], col = [];
    const inflate = spring(t - T(8.0), 2.4, 0.38);
    const d1 = spring(t - T(WORLD.split3), 1.6, 0.58);
    const d2 = spring(t - T(WORLD.split9), 1.6, 0.58);
    let r = lerp(r0, 0.35, inflate);
    r = lerp(r, 0.225, clamp(d1 * 1.1));
    r = lerp(r, 0.16, clamp(d2 * 1.1));
    const baseScale = r / 0.36;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const k = (j + 1) * 3 + (i + 1);
        const [type, bgi, fgi] = CORE[k];
        const delay = (i + 1 + (1 - j)) * 0.075;
        const m = ease.inOutCubic(prog(b, WORLD.morph + delay, WORLD.morph + delay + 0.4));
        const claim = spring(t - T(WORLD.claim + delay * 0.8), 2.1, 0.62);
        const pop = 1 + 0.28 * Math.sin(Math.PI * m);
        const s = lerp(baseScale * pop, 1.0, clamp(claim));
        const dance = ease.outBack(prog(b, 10.5 + delay * 0.6, 10.5 + delay * 0.6 + 0.38));
        const rotv = -Math.PI / 2 * (1 - ease.outBack(m)) + (Math.PI / 2) * dance * (1 - ease.inOutCubic(clamp(claim)));
        const x = i * d1, z = j * d2;
        // coin-flip colour change as the tile is claimed (no muddy colour blends)
        const needFlip = DANCE[k] !== fgi;
        const fp = ease.inOutCubic(prog(b, WORLD.claim + delay * 0.8, WORLD.claim + delay * 0.8 + 0.32));
        const flip = needFlip ? Math.abs(Math.cos(Math.PI * fp)) : 1;
        pos.push(x, z, b > 11.96 ? 1.0 : s, rotv);
        shape.push(0, type, m, flip);
        const c1 = mixRGB(palLin[2], palLin[DANCE[k]], clamp(m * 2.5));
        col.push(...(needFlip && fp >= 0.5 ? palLin[fgi] : c1));
      }
    }
    const jelly = wobble(t - T(8.0), 2.6, 0.22);
    return {
      uBlobN: b < 12.0 ? 9 : 0,
      uBlob: pos, uBlobShape: shape, uBlobCol: col,
      uGoo: 0.3 * prog(b, 8.3, 8.5) * (1 - prog(b, 9.9, 10.35)),
      uBlobSquash: [1 + 0.16 * jelly, 1 - 0.16 * jelly],
    };
  }

  function inner(b) {
    const t = T(b);
    const out = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const k = (j + 1) * 3 + (i + 1);
      const delay = (i + 1 + (1 - j)) * 0.075;
      const claim = b >= 12 ? 1 : clamp(spring(t - T(WORLD.claim + delay * 0.8), 2.1, 0.62), 0, 1.08);
      out.push(CORE[k][0], CORE[k][1], CORE[k][2], claim);
    }
    return { uInner: out, uInnerMotif: b >= 12 ? 1 : 0 };
  }

  const ROT_W = [[13.0, 0, 0], [14.5, 3, -2], [16.0, 0, 0]];
  const FLIP_W = [[13.5, -9, 0], [15.0, -9, 0]];
  const MORPH_W = [[14.0, 0, 0], [15.5, -3, 2]];

  function uniforms(env) {
    const b = env.b;
    const cam = camera(b);
    const ballOn = b >= dropStart ? 1 : 0;
    const bl = ballFinal(Math.min(b, WORLD.lensHit));
    const imp = [];
    const radii = [15, 9, 6, 4];
    for (let i = 0; i < 4; i++) imp.push(landPos[i][0], landPos[i][1], lands[i], radii[i]);
    return {
      uRes: [W, H],
      uJitter: env.jitter,
      uBeat: b,
      uCamPos: cam.pos, uCamF: cam.f, uCamR: cam.r, uCamU: cam.u,
      uTanHalf: cam.tanHalf, uRoll: cam.roll,
      uPal: palLin.flat(),
      ...blobs(b),
      ...inner(b),
      uGridT0: WORLD.zoomOut,
      uRotW: ROT_W.flat(), uFlipW: FLIP_W.flat(), uMorphW: MORPH_W.flat(),
      uImpact: imp,
      uBall: [bl.x, bl.y, bl.z, BALL_R],
      uBallScale: [bl.sxz, bl.sy, bl.sxz],
      uBallOn: ballOn,
      uMetal: 0.0,
      uSkyTop: linRGB('#070A3A'),
      uSkyHor: linRGB('#4150FF'),
      uFog: 0.085 * ease.inOutCubic(prog(b, 16.0, 16.9)),
    };
  }

  function draw2d(ctx, env) {
    const b = env.b, t = env.t;
    // Drop shockwave + burst lines
    const dt = t - T(WORLD.drop);
    if (dt >= 0 && dt < 0.7) {
      const p = dt / 0.7;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      const R = lerp(90, 1100, ease.outCubic(p));
      ctx.lineWidth = lerp(28, 0.5, ease.outQuad(p));
      ctx.strokeStyle = rgba(PAL.paper, 1 - p);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(PAL.lime, (1 - p) * 0.9);
      ctx.lineWidth = 6 * (1 - p);
      ctx.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.13;
        const r1 = lerp(130, 520, ease.outCubic(p)), r2 = lerp(170, 700, ease.outExpo(p));
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function events() {
    const ev = [];
    const E = (b, type, o = {}) => ev.push({ t: T(b), type, ...o });
    E(WORLD.split3, 'split', { n: 3 });
    E(WORLD.split9, 'split', { n: 9 });
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const delay = (i + 1 + (1 - j)) * 0.075;
      E(WORLD.morph + delay, 'morph', { i: (j + 1) * 3 + i + 1 });
      E(10.5 + delay * 0.6, 'dance', { i: (j + 1) * 3 + i + 1 });
      if (DANCE[(j + 1) * 3 + i + 1] !== CORE[(j + 1) * 3 + i + 1][2]) E(WORLD.claim + delay * 0.8 + 0.16, 'flip', { i: (j + 1) * 3 + i + 1 });
    }
    E(WORLD.zoomOut, 'zoomout');
    // tile pop-ins (mirrors the shader's hash/delay) for tiles in view
    const fr = (x) => x - Math.floor(x);
    const hash = (x, y) => { let px = fr(x * 123.34), py = fr(y * 456.21); const d = px * (px + 45.32) + py * (py + 45.32); px += d; py += d; return fr(px * py); };
    const pops = [];
    for (let y = -4; y <= 4; y++) for (let x = -7; x <= 7; x++) {
      if (Math.abs(x) <= 1 && Math.abs(y) <= 1) continue;
      const dist = Math.hypot(x, y);
      pops.push(WORLD.zoomOut + 0.05 + dist * 0.085 + hash(x + 3.77, y + 3.77) * 0.05);
    }
    pops.sort((a, b) => a - b).forEach((b, k) => { if (k % 3 === 0) E(b, 'pop', { k }); });
    ROT_W.forEach((w) => E(w[0], 'wave', { kind: 0 }));
    FLIP_W.forEach((w) => E(w[0], 'wave', { kind: 1 }));
    MORPH_W.forEach((w) => E(w[0], 'wave', { kind: 2 }));
    E(WORLD.tilt, 'tilt');
    E(dropStart, 'balldrop', { dur: T(17 - dropStart) });
    lands.forEach((b, i) => E(b, 'land3d', { i }));
    E(lands[3] + 0.02, 'crouch3d');
    E(WORLD.launch, 'launch');
    E(WORLD.lensHit, 'lens');
    return ev;
  }

  return {
    events,
    gl(comp, env) {
      const b = env.b;
      const u = uniforms(env);
      if (b < 12) {
        comp.sceneLayer(PROGS.A, u);
        // blobs: one alpha pass, scissored to their projected bounds
        const cam = camera(b);
        const circles = [];
        for (let i = 0; i < 9; i++) {
          const x = u.uBlob[i * 4], z = u.uBlob[i * 4 + 1], sc = u.uBlob[i * 4 + 2];
          const q = project(cam, [x, 0, z]);
          const edge = project(cam, [x + 1, 0, z]);
          if (!q || !edge) continue;
          const ppu = Math.hypot(edge.x - q.x, edge.y - q.y);
          circles.push([q.x, q.y, (0.75 * sc * Math.max(...u.uBlobSquash) + u.uGoo + 0.05) * ppu]);
        }
        const sc = scissorFromCircles(circles);
        if (sc) comp.sceneLayer(PROGS.Ablobs, u, { blend: true, scissor: sc });
      } else if (b < 16.2) {
        comp.sceneLayer(PROGS.B, u);
      } else {
        comp.sceneLayer(PROGS.C, u);
        const cam = camera(b);
        const R = BALL_R * Math.max(u.uBallScale[0], u.uBallScale[1]);
        const c = [u.uBall[0], u.uBall[1], u.uBall[2]];
        const q = project(cam, c);
        let sc;
        if (!q || q.z < R * 1.6) sc = [0, 0, W, H];
        else {
          const rpx = (R / Math.sqrt(Math.max(1e-4, q.z * q.z - R * R))) / cam.tanHalf * (H / 2) * 1.15;
          sc = scissorFromCircles([[q.x, q.y, rpx]]);
        }
        if (sc) comp.sceneLayer(PROGS.Cball, u, { scissor: sc });
      }
    },
    draw2d,
    hud: (env) => ({ color: rgba(PAL.paper, 0.9), chip: env.b >= 12 ? rgba(PAL.ink, 0.78) : null }),
    post: (env, p) => { p.vignette = env.b >= 16 ? 0.4 : 0.22; },
  };
}
