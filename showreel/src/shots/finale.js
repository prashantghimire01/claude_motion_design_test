// FINALE (beats 24–32): the last principle shatters into ~6k particles that spiral
// into a tilted galaxy around the hero ball, accelerate with the riser, then slam
// into the wordmark on the final downbeat. The ball returns as the full stop.
import { clamp, lerp, prog, ease, spring, wobble, PAL, rgba, TAU, mulberry32, makeNoise, hexRGB } from '../lib.js';
import { archivo, serif, mono } from '../fonts.js';
import { BEAT, FINALE } from '../timeline.js';
import { drawFollowSettled, followCenterY } from './principles.js';
import { scramble } from '../hud.js';

const N = 6200;

function samplePoints(ctx, W, H, step, rnd) {
  const d = ctx.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (d[(y * W + x) * 4 + 3] > 140) pts.push([x + (rnd() - 0.5) * step * 0.9, y + (rnd() - 0.5) * step * 0.9]);
    }
  }
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts;
}

export async function createFinale({ W, H }) {
  // Per-format layout (landscape = the original design).
  const V = H > W;
  const fitWM = () => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = archivo(800, 100, 100);
    c.letterSpacing = '-2px';
    const w = c.measureText('Claude').width;
    c.letterSpacing = '0px';
    return (100 * (W - 200)) / (w + c.measureText('.').width);
  };
  const WM = V
    ? { text: 'Claude', weight: 800, width: 100, size: Math.round(fitWM()), baseline: Math.round(H * 0.5) }
    : { text: 'Claude', weight: 800, width: 100, size: 300, baseline: 598 };
  const CENTER = V ? { x: W / 2, y: Math.round(H * 0.46) } : { x: 960, y: 520 };
  const GAL = V ? { scale: 0.74, tilt: -0.32, flat: 0.66, speed: 0.85, ball: 42 } : { scale: 1, tilt: -0.2, flat: 0.36, speed: 1, ball: 34 };
  const SUB = V ? { size: 104, dy: 138 } : { size: 118, dy: 150 };
  const rnd = mulberry32(2026);
  const noise = makeNoise(11);
  const T = (b) => b * BEAT;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const o = off.getContext('2d', { willReadFrequently: true });

  // Origins: the settled FOLLOW THROUGH word.
  o.fillStyle = '#fff';
  drawFollowSettled(o);
  const origins = samplePoints(o, W, H, 4, rnd);

  // Wordmark layout (period is the ball, so centre "Claude" + ".")
  o.clearRect(0, 0, W, H);
  o.font = archivo(WM.weight, WM.width, WM.size);
  o.letterSpacing = `${-0.02 * WM.size}px`;
  const wText = o.measureText(WM.text).width;
  o.letterSpacing = '0px';
  const dot = (() => {
    // measure the real period glyph for size/offset
    const c = document.createElement('canvas'); c.width = 400; c.height = 400;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.font = archivo(WM.weight, WM.width, WM.size);
    x.fillStyle = '#fff'; x.fillText('.', 100, 300);
    const d = x.getImageData(0, 0, 400, 400).data;
    let l = 400, r = 0, t = 400, bt = 0;
    for (let yy = 0; yy < 400; yy++) for (let xx = 0; xx < 400; xx++) if (d[(yy * 400 + xx) * 4 + 3] > 127) { l = Math.min(l, xx); r = Math.max(r, xx); t = Math.min(t, yy); bt = Math.max(bt, yy); }
    return { adv: x.measureText('.').width, cx: (l + r + 1) / 2 - 100, size: Math.max(r - l + 1, bt - t + 1), bottom: bt + 1 - 300 };
  })();
  const total = wText + dot.adv;
  const WM_X = W / 2 - total / 2;
  const R = dot.size * 0.6;
  const PERIOD = { x: WM_X + wText + dot.cx - 4, y: WM.baseline + dot.bottom - R };
  o.fillStyle = '#fff';
  o.letterSpacing = `${-0.02 * WM.size}px`;
  o.fillText(WM.text, WM_X, WM.baseline);
  o.letterSpacing = '0px';
  const targets = samplePoints(o, W, H, 3, rnd);

  // Particle table
  const COLS = [PAL.paper, PAL.paper, PAL.paper, PAL.orange, PAL.orange, PAL.lime, PAL.lime, PAL.pink, PAL.sky];
  const P = [];
  const n = Math.min(N, targets.length);
  for (let i = 0; i < n; i++) {
    const og = origins[i % origins.length];
    const tg = targets[i];
    const dx = og[0] - W / 2, dy = og[1] - followCenterY;
    const ang = Math.atan2(dy, dx) + (rnd() - 0.5) * 1.2;
    const sp = (250 + rnd() * 1300) * GAL.speed;
    const Rr = (110 + Math.pow(rnd(), 0.8) * 640) * GAL.scale;
    P.push({
      ox: og[0], oy: og[1], tx: tg[0], ty: tg[1],
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 260,
      R: Rr, th: rnd() * TAU, spd: (0.75 + rnd() * 0.5) * Math.pow((360 * GAL.scale) / Rr, 0.5),
      col: hexRGB(COLS[Math.floor(rnd() * COLS.length)]),
      size: 1.6 + rnd() * 2.6,
      d: rnd() * 0.42, w: rnd() * 0.5, ph: rnd() * TAU,
    });
  }

  // integrated vortex angle (rad) — angular velocity ramps up with the riser
  const w0 = 0.9, w1 = 6.2;
  const Omega = (b) => { const x = clamp(b - 24, 0, 4); return w0 * x + ((w1 - w0) * x * x * x) / 27; };
  const TILT = GAL.tilt, FLAT = GAL.flat;

  function particlePos(p, b) {
    const t = T(b - FINALE.shatter);
    // 1) explosion (with drag)
    const k = 4.2;
    const e = (1 - Math.exp(-k * Math.max(0, t))) / k;
    const ex = p.ox + p.vx * e, ey = p.oy + p.vy * e + 120 * e * e;
    // 2) vortex
    const R = p.R * lerp(1, 0.7, ease.inOutSine(prog(b, 24.6, 27.2))) + 14 * Math.sin(b * 3 + p.ph);
    const th = p.th + Omega(b) * p.spd;
    const cx = R * Math.cos(th), cy = R * Math.sin(th) * FLAT;
    const vx = CENTER.x + cx * Math.cos(TILT) - cy * Math.sin(TILT);
    const vy = CENTER.y + cx * Math.sin(TILT) + cy * Math.cos(TILT);
    const nw = noise.n2(p.tx * 0.004, b * 0.7) * 26;
    const wv = ease.inOutCubic(prog(b, 24.25 + p.w * 0.35, 25.5 + p.w * 0.4));
    let x = lerp(ex, vx + nw, wv), y = lerp(ey, vy + nw * 0.5, wv);
    const depth = Math.sin(th); // >0 = in front
    // 3) convergence to the wordmark (slam on the downbeat)
    const c = ease.inOutCubic(prog(b, FINALE.converge + p.d * 0.9, FINALE.impact - 0.1 + p.d * 0.2));
    x = lerp(x, p.tx, c); y = lerp(y, p.ty, c);
    return { x, y, depth: lerp(depth * wv, 0, c), c };
  }

  // Hero ball
  function ballState(b) {
    const t = T(b);
    if (b < 24.4) return null;
    if (b < 27.0) {
      const s = spring(t - T(24.4), 2.2, 0.4);
      const bob = Math.sin(b * Math.PI * 0.5) * 8;
      const ant = ease.inOutCubic(prog(b, 26.6, 27.0));
      return { x: CENTER.x, y: CENTER.y + bob + ant * 10, r: GAL.ball * s * (1 + 0.08 * Math.sin(b * Math.PI * 2)), sq: 0.25 * ant, glow: 1 };
    }
    if (b < FINALE.periodDrop) {
      const p = prog(b, 27.0, 27.35);
      if (p >= 1) return null;
      return { x: CENTER.x, y: lerp(CENTER.y + 10, -120, ease.inQuad(p)), r: GAL.ball, st: 1 + 0.6 * p, glow: 1 };
    }
    // period drop & bounces
    const L = FINALE.periodLandings.map(T);
    const G = 2 * (PERIOD.y + 80) / Math.pow(L[0] - T(FINALE.periodDrop), 2);
    let y, vy = 0;
    if (t < L[0]) { const dt = L[0] - t; y = PERIOD.y - 0.5 * G * dt * dt; vy = G * dt; }
    else {
      y = PERIOD.y;
      for (let i = 1; i < L.length; i++) {
        if (t < L[i]) { const u = t - L[i - 1], Tt = L[i] - L[i - 1]; y = PERIOD.y - 0.5 * G * u * (Tt - u); break; }
      }
    }
    let sq = 0;
    L.forEach((l, i) => { const dt = t - l; if (dt >= 0 && dt < 0.4) sq += [0.42, 0.22, 0.12, 0.06][i] * Math.exp(-dt * 20) * Math.cos(dt * 44); });
    const st = vy > 0 ? 1 + clamp(vy / 4000) * 0.4 : 1;
    const breathe = b > 31 ? 1 + 0.03 * Math.sin((b - 31) * Math.PI * 2) : 1;
    return { x: PERIOD.x, y, r: R * breathe, sq, st, ground: PERIOD.y + R, glow: 0.8 };
  }

  function drawBall(ctx, s) {
    if (!s || s.r <= 0.1) return;
    ctx.save();
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3.6);
    g.addColorStop(0, rgba(PAL.orange, 0.3 * s.glow));
    g.addColorStop(1, rgba(PAL.orange, 0));
    ctx.fillStyle = g;
    ctx.fillRect(s.x - s.r * 4, s.y - s.r * 4, s.r * 8, s.r * 8);
    let cy = s.y;
    let sx = 1, sy = 1;
    if (s.sq && Math.abs(s.sq) > 0.005) {
      sy = 1 - s.sq; sx = 1 / Math.sqrt(sy);
      if (s.ground) cy = s.ground - s.r * sy;
    } else if (s.st && s.st > 1.005) { sy = s.st; sx = 1 / Math.sqrt(s.st); }
    ctx.translate(s.x, cy);
    ctx.scale(sx, sy);
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, TAU);
    ctx.fillStyle = PAL.orange;
    ctx.fill();
    ctx.restore();
  }

  const bloom = document.createElement('canvas');
  bloom.width = W / 2; bloom.height = H / 2;
  const bctx = bloom.getContext('2d');
  const bloomBlur = document.createElement('canvas');
  bloomBlur.width = W / 2; bloomBlur.height = H / 2;
  const bbctx = bloomBlur.getContext('2d');
  let bloomFrame = -1;

  const sparks = [];
  for (let i = 0; i < 320; i++) {
    const tg = targets[Math.floor(rnd() * targets.length)];
    const a = rnd() * TAU, sp = 200 + rnd() * 1500;
    sparks.push({ x: tg[0], y: tg[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 200, col: COLS[Math.floor(rnd() * COLS.length)], s: 1.5 + rnd() * 3, life: 0.35 + rnd() * 0.5 });
  }

  function drawWordmark(ctx, b) {
    const t = T(b);
    const punch = 1 + 0.07 * wobble(t - T(FINALE.impact), 2.4, 0.35) * 0.9 + 0.03 * Math.exp(-(t - T(FINALE.impact)) * 8);
    ctx.save();
    const pc = WM.baseline - WM.size / 3;
    ctx.translate(W / 2, pc);
    ctx.scale(punch, punch);
    ctx.translate(-W / 2, -pc);
    ctx.font = archivo(WM.weight, WM.width, WM.size);
    ctx.letterSpacing = `${-0.02 * WM.size}px`;
    ctx.fillStyle = PAL.paper;
    ctx.fillText(WM.text, WM_X, WM.baseline);
    ctx.restore();
    ctx.letterSpacing = '0px';
  }

  function drawDetails(ctx, b, t) {
    // Subtitle: "Motion Designer" — masked rise, per letter
    const sub = 'Motion Designer';
    ctx.save();
    ctx.font = serif(SUB.size);
    const sw = ctx.measureText(sub).width;
    let x = W / 2 - sw / 2;
    const y = WM.baseline + SUB.dy;
    ctx.beginPath();
    ctx.rect(0, 0, W, y + SUB.size * 0.44);
    ctx.clip();
    for (let i = 0; i < sub.length; i++) {
      const ch = sub[i];
      const cw = ctx.measureText(ch).width;
      const p = spring(t - T(FINALE.subtitle) - i * 0.018, 2.3, 0.55);
      if (p > 0) {
        ctx.fillStyle = PAL.orange;
        ctx.fillText(ch, x, y + (1 - p) * SUB.size * 1.27);
      }
      x += cw;
    }
    ctx.restore();

    // rule + details
    const rp = ease.outExpo(prog(b, FINALE.details, FINALE.details + 1.2));
    if (rp > 0) {
      ctx.save();
      const ry = WM.baseline + SUB.dy + 78;
      const half = V ? 380 : 520;
      ctx.fillStyle = rgba(PAL.paper, 0.35);
      ctx.fillRect(W / 2 - half * rp, ry, 2 * half * rp, 1.5);
      ctx.font = mono(500, V ? 20 : 17);
      ctx.letterSpacing = '3px';
      ctx.fillStyle = rgba(PAL.paper, 0.75);
      const tp = prog(b, FINALE.details + 0.2, FINALE.details + 1.4);
      const skills = 'TIMING / TYPE / SHAPE / SYSTEMS / 3D / GENERATIVE';
      if (V) {
        // stacked and centred for the narrow frame
        ctx.textAlign = 'center';
        ctx.fillText(scramble('REEL 2026', tp, t, 91), W / 2, ry + 50);
        ctx.fillStyle = rgba(PAL.paper, 0.55);
        ctx.fillText(scramble(skills, tp, t, 92), W / 2, ry + 90);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(scramble('REEL 2026', tp, t, 91), W / 2 - half, ry + 42);
        ctx.textAlign = 'right';
        ctx.fillText(scramble(skills, tp, t, 92), W / 2 + half, ry + 42);
      }
      ctx.restore();
    }
  }

  function draw2d(ctx, env) {
    const b = env.b, t = env.t;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, W, H);

    // Flash from the cobalt card
    const fl = 1 - prog(b, 24.0, 24.25);
    if (fl > 0) { ctx.fillStyle = rgba(PAL.cobalt, 0.55 * fl * fl); ctx.fillRect(0, 0, W, H); }

    // End-card push-in
    const push = 1 + 0.035 * ease.outCubic(prog(b, 28, 32));
    ctx.save();
    ctx.translate(W / 2, H / 2 - 20);
    ctx.scale(push, push);
    ctx.translate(-W / 2, -(H / 2 - 20));

    // artboard dots (bookend with the intro)
    const ga = 0.08 * ease.outCubic(prog(b, 28, 29.5));
    if (ga > 0) {
      ctx.fillStyle = rgba(PAL.paper, ga);
      for (let y = 36; y < H; y += 48) for (let x = 24; x < W; x += 48) ctx.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
    }

    const ball = ballState(b);
    const impactT = T(FINALE.impact);
    if (t < impactT) {
      // orbit guide rings (the diagram behind the galaxy)
      const ra = ease.outCubic(prog(b, 24.5, 25.5)) * (1 - prog(b, 27, 27.8));
      if (ra > 0) {
        ctx.save();
        ctx.translate(CENTER.x, CENTER.y);
        ctx.rotate(TILT);
        ctx.strokeStyle = rgba(PAL.paper, 0.22 * ra);
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 10]);
        ctx.lineDashOffset = -Omega(b) * 60;
        for (const rr of [240, 430, 640]) { ctx.beginPath(); ctx.ellipse(0, 0, rr * GAL.scale, rr * GAL.scale * FLAT, 0, 0, TAU); ctx.stroke(); }
        ctx.restore();
      }
      // particles: back half, ball, front half
      const pos = new Array(P.length);
      for (let i = 0; i < P.length; i++) pos[i] = particlePos(P[i], b);
      const drawSet = (front) => {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < P.length; i++) {
          const q = pos[i];
          if ((q.depth >= 0) !== front) continue;
          const p = P[i];
          const dz = q.depth;
          const sz = p.size * (1 + 0.35 * dz) * lerp(1, 0.85, q.c);
          const a = clamp(0.55 + 0.4 * dz) * lerp(1, 1, q.c);
          const cr = lerp(p.col[0], 243, q.c), cg = lerp(p.col[1], 238, q.c), cb = lerp(p.col[2], 227, q.c);
          ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a})`;
          ctx.fillRect(q.x - sz / 2, q.y - sz / 2, sz, sz);
        }
        ctx.restore();
      };
      drawSet(false);
      drawBall(ctx, ball);
      drawSet(true);
      // bloom: built once per output frame at half res (it is soft anyway)
      if (bloomFrame !== env.f) {
        bloomFrame = env.f;
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.globalCompositeOperation = 'source-over';
        bctx.clearRect(0, 0, W / 2, H / 2);
        bctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < P.length; i += 2) {
          const q = pos[i];
          const c = P[i].col;
          bctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.5)`;
          bctx.fillRect(q.x / 2 - 1.5, q.y / 2 - 1.5, 3, 3);
        }
        if (ball) { bctx.fillStyle = 'rgba(255,91,31,0.9)'; bctx.beginPath(); bctx.arc(ball.x / 2, ball.y / 2, ball.r / 2, 0, TAU); bctx.fill(); }
        bbctx.clearRect(0, 0, W / 2, H / 2);
        bbctx.filter = 'blur(3.5px)';
        bbctx.drawImage(bloom, 0, 0);
        bbctx.filter = 'none';
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(bloomBlur, 0, 0, W, H);
      ctx.restore();
    } else {
      drawWordmark(ctx, b);
      // impact sparks
      const st = t - impactT;
      if (st < 0.9) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const s of sparks) {
          const k = st / s.life;
          if (k >= 1) continue;
          const x = s.x + s.vx * (1 - Math.exp(-st * 5)) / 5;
          const y = s.y + s.vy * (1 - Math.exp(-st * 5)) / 5 + 300 * st * st;
          ctx.fillStyle = rgba(s.col, (1 - k) * 0.9);
          ctx.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
        }
        ctx.restore();
        // shockwave
        const p = clamp(st / 0.6);
        ctx.save();
        ctx.strokeStyle = rgba(PAL.paper, 0.8 * (1 - p));
        ctx.lineWidth = 18 * (1 - p) + 0.5;
        ctx.beginPath();
        const e = ease.outCubic(p);
        if (V) ctx.ellipse(W / 2, WM.baseline - WM.size * 0.3, 170 + 900 * e, 120 + 1150 * e, 0, 0, TAU);
        else ctx.ellipse(W / 2, WM.baseline - 110, 200 + 1300 * e, 90 + 700 * e, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      drawDetails(ctx, b, t);
      drawBall(ctx, ball);
      // contact rings when the period lands
      FINALE.periodLandings.forEach((l, i) => {
        const dt = t - T(l);
        if (dt < 0 || dt > 0.45 || i > 1) return;
        const p = dt / 0.45;
        ctx.save();
        ctx.strokeStyle = rgba(PAL.orange, (1 - p) * (i ? 0.4 : 0.8));
        ctx.lineWidth = 2.5 * (1 - p) + 0.5;
        ctx.beginPath();
        ctx.ellipse(PERIOD.x, PERIOD.y + R, R + 90 * ease.outCubic(p), (R + 90 * ease.outCubic(p)) * 0.28, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      });
    }
    ctx.restore();
  }

  return {
    draw2d,
    hud: () => ({ color: rgba(PAL.paper, 0.72) }),
    post: (env, p) => {
      p.vignette = 0.42;
      const dt = env.t - T(FINALE.impact);
      if (dt >= 0 && dt < 0.1) { const k = 1 - dt / 0.1; p.flash = [1, 0.96, 0.9, 0.72 * k * k]; }
    },
    events: () => [
      { t: T(FINALE.shatter), type: 'shatter' },
      { t: T(24.4), type: 'ballpop' },
      { t: T(24.5), type: 'vortex', dur: T(27.0) - T(24.5) },
      { t: T(26.6), type: 'crouch' },
      { t: T(27.0), type: 'launchup' },
      { t: T(FINALE.converge), type: 'converge', dur: T(FINALE.impact) - T(FINALE.converge) },
      { t: T(FINALE.impact), type: 'impact' },
      { t: T(FINALE.subtitle), type: 'subtitle' },
      { t: T(FINALE.details), type: 'details' },
      { t: T(FINALE.periodDrop), type: 'perioddrop', dur: T(FINALE.periodLandings[0] - FINALE.periodDrop) },
      ...FINALE.periodLandings.map((b, i) => ({ t: T(b), type: 'period', i })),
    ],
  };
}
