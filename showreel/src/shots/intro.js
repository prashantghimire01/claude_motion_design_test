// INTRO (beats 0–8): "It all starts with a bouncing ball."
// A physically-timed bouncing ball (restitution 0.5) with onion skins and frame
// ticks → "motıon" rises out of the floor line and the ı lifts the ball into
// place as its tittle → the ball hops into the "o", which opens as a portal,
// and the camera accelerates through the counter into the next world.
import { clamp, lerp, prog, ease, spring, wobble, PAL, rgba, TAU, EASE } from '../lib.js';
import { archivo, serif, mono } from '../fonts.js';
import { BEAT, BOUNCE, LETTER_RISE, HOP, ZOOM, FPS } from '../timeline.js';

const S = 330; // display size (px)
const WEIGHT = 800;
const TRACK = -0.015; // em
const FLOOR = 646;
const WORD = ['m', 'o', 't', 'ı', 'o', 'n'];
const I_IDX = 3;
const O_IDX = 4;
const G = 6400; // px/s² — gravity for the bounce

// -- glyph measurement ---------------------------------------------------------
function inkBox(ch, font) {
  const c = document.createElement('canvas');
  c.width = S * 2;
  c.height = S * 2;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.font = font;
  x.fillStyle = '#fff';
  const ox = S * 0.5, oy = S * 1.5;
  x.fillText(ch, ox, oy);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const ink = (px, py) => d[(py * c.width + px) * 4 + 3] > 127;
  return { ink, ox, oy, w: c.width, h: c.height };
}

function measure() {
  const font = archivo(WEIGHT, 100, S);
  // Tittle: topmost ink blob of "i"
  const I = inkBox('i', font);
  let top = -1, gap = -1, stemTop = -1;
  for (let y = 0; y < I.h; y++) {
    let any = false;
    for (let x = 0; x < I.w; x++) if (I.ink(x, y)) { any = true; break; }
    if (top < 0 && any) top = y;
    else if (top >= 0 && gap < 0 && !any) gap = y;
    else if (gap >= 0 && stemTop < 0 && any) { stemTop = y; break; }
  }
  let l = I.w, r = 0;
  for (let y = top; y < gap; y++) for (let x = 0; x < I.w; x++) if (I.ink(x, y)) { l = Math.min(l, x); r = Math.max(r, x); }
  const dot = {
    cx: (l + r + 1) / 2 - I.ox,
    cy: (top + gap) / 2 - I.oy,
    w: r - l + 1,
    h: gap - top,
    stemTop: stemTop - I.oy,
  };
  // Counter of "o": inner transparent run on the mid row / mid column
  const O = inkBox('o', font);
  const midY = Math.round(O.oy + (stemTop - I.oy) / 2);
  const row = [];
  for (let x = 0; x < O.w; x++) row.push(O.ink(x, midY));
  const first = row.indexOf(true);
  let inL = -1, inR = -1;
  for (let x = first; x < O.w; x++) { if (inL < 0 && !row[x]) inL = x; else if (inL >= 0 && row[x]) { inR = x - 1; break; } }
  const ccx = Math.round((inL + inR) / 2);
  let inT = -1, inB = -1;
  for (let y = midY; y > 0; y--) if (O.ink(ccx, y)) { inT = y + 1; break; }
  for (let y = midY; y < O.h; y++) if (O.ink(ccx, y)) { inB = y - 1; break; }
  const counter = {
    cx: (inL + inR + 1) / 2 - O.ox,
    cy: (inT + inB + 1) / 2 - O.oy,
    rx: (inR - inL + 1) / 2,
    ry: (inB - inT + 1) / 2,
  };
  return { dot, counter };
}

export async function createIntro({ W, H }) {
  const geo = measure();
  const R = Math.max(geo.dot.w, geo.dot.h) * 0.56; // ball radius ≈ tittle (circle reads lighter than a square)
  const tittleDY = geo.dot.cy; // relative to baseline (negative = up)
  const xHeight = -geo.dot.stemTop;
  const mctx = document.createElement('canvas').getContext('2d');

  function layout(width = 100) {
    mctx.font = archivo(WEIGHT, width, S);
    mctx.letterSpacing = `${TRACK * S}px`;
    const s = WORD.join('');
    const total = mctx.measureText(s).width - TRACK * S;
    const xs = [];
    const adv = [];
    for (let i = 0; i < WORD.length; i++) {
      const a = mctx.measureText(WORD[i]).width;
      xs.push(mctx.measureText(s.slice(0, i + 1)).width - a);
      adv.push(a);
    }
    const x0 = W / 2 - total / 2;
    return { xs: xs.map((x) => x + x0), adv, total, x0, width };
  }
  const L0 = layout(100);
  const tittleX = (L) => L.xs[I_IDX] + (L.adv[I_IDX] - TRACK * S) / 2;
  const TITTLE = { x: tittleX(L0), y: FLOOR + tittleDY };
  const PORTAL = {
    x: L0.xs[O_IDX] + geo.counter.cx,
    y: FLOOR + geo.counter.cy,
    rx: geo.counter.rx,
    ry: geo.counter.ry,
  };
  const WORD_C = { x: W / 2, y: FLOOR - xHeight / 2 };

  // -- bounce physics -----------------------------------------------------------
  const lands = BOUNCE.landings.map((b) => b * BEAT);
  const tDrop = BOUNCE.dropStart * BEAT;
  const REST_Y = FLOOR - R;
  const X_START = 250;
  // horizontal: constant speed per airtime, friction 0.72 at each impact, lands exactly on the ı
  const segs = [[tDrop, lands[0]]];
  for (let i = 1; i < lands.length; i++) segs.push([lands[i - 1], lands[i]]);
  let wsum = 0, k = 1;
  const kf = [];
  for (const [a, b] of segs) { kf.push(k); wsum += k * (b - a); k *= 0.72; }
  const rollT = BOUNCE.restAt * BEAT - lands[lands.length - 1];
  wsum += k * rollT * 0.5; // decelerating roll to rest
  const v0 = (TITTLE.x - X_START) / wsum;

  function bounceX(t) {
    let x = X_START;
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i];
      if (t <= a) return x;
      const dt = Math.min(t, b) - a;
      x += v0 * kf[i] * dt;
      if (t <= b) return x;
    }
    const tr = clamp((t - lands[lands.length - 1]) / rollT);
    return x + v0 * k * rollT * (tr - tr * tr / 2);
  }
  function bounceY(t) {
    if (t <= lands[0]) {
      const dt = lands[0] - t;
      return REST_Y - 0.5 * G * dt * dt;
    }
    for (let i = 1; i < lands.length; i++) {
      if (t <= lands[i]) {
        const a = lands[i - 1], b = lands[i];
        const u = t - a, T = b - a;
        return REST_Y - 0.5 * G * u * (T - u);
      }
    }
    return REST_Y;
  }
  // Squash at each impact (strength ∝ impact speed)
  function impactSquash(t) {
    let sq = 0;
    for (let i = 0; i < lands.length; i++) {
      const dt = t - lands[i];
      if (dt < -0.02 || dt > 0.35) continue;
      const vImpact = i === 0 ? G * (lands[0] - tDrop) : G * (lands[i] - lands[i - 1]) / 2;
      const amp = clamp(vImpact / 3000) * 0.42;
      sq += amp * (dt < 0 ? 0 : Math.exp(-dt * 22) * Math.cos(dt * 48));
    }
    return clamp(sq, -0.3, 0.45);
  }

  // --- the ı lifts the ball: carried on the stem, launched by its overshoot ---
  const RISE_SPRING = [2.1, 0.46];
  const riseT = LETTER_RISE[I_IDX] * BEAT;
  function stemTopY(t) {
    const ls = letterState(I_IDX, t);
    if (!ls.vis) return FLOOR + S;
    return FLOOR + ls.dy - xHeight * ls.sy;
  }
  const wS = RISE_SPRING[0] * TAU;
  const tDetach = riseT + Math.PI / (wS * Math.sqrt(1 - RISE_SPRING[1] ** 2)); // first spring peak
  const yDetach = Math.min(REST_Y, stemTopY(tDetach) - R);
  const fall = Math.max(4, TITTLE.y - yDetach);
  const tTit1 = tDetach + Math.sqrt((2 * fall) / G);
  const vTit = G * (tTit1 - tDetach) * 0.3;
  const tTit2 = tTit1 + (2 * vTit) / G;
  const TITTLE_LANDS = [tTit1, tTit2];

  function tittleY(t) {
    if (t < tDetach) return Math.min(REST_Y, stemTopY(t) - R);
    if (t < tTit1) { const u = t - tDetach; return yDetach + 0.5 * G * u * u; }
    if (t < tTit2) { const u = t - tTit1; return TITTLE.y - (vTit * u - 0.5 * G * u * u); }
    return TITTLE.y;
  }

  // Full ball state as a pure function of time (seconds).
  function ballPos(t) {
    const b = t / BEAT;
    if (b < LETTER_RISE[I_IDX]) {
      return { x: bounceX(t), y: bounceY(t), s: 1, layer: 'front', ground: FLOOR };
    }
    if (b < HOP.launch) {
      const ground = t < tDetach ? Math.min(FLOOR, stemTopY(t)) : TITTLE.y + R;
      return { x: TITTLE.x, y: tittleY(t), s: 1, layer: 'front', ground };
    }
    if (b < HOP.dive) {
      // Hop: parabolic arc from tittle to the portal, shrinking into depth.
      const p = prog(b, HOP.launch, HOP.dive);
      const x = lerp(TITTLE.x, PORTAL.x, ease.inOutSine(p));
      const lift = 190;
      const y = lerp(TITTLE.y, PORTAL.y, p * p) - lift * 4 * p * (1 - p);
      return { x, y, s: lerp(1, 0.52, ease.inCubic(p)), layer: 'front', ground: 1e9 };
    }
    // Inside the portal
    const p = prog(b, HOP.dive, ZOOM.from);
    return { x: PORTAL.x, y: PORTAL.y, s: lerp(0.52, 0.42, ease.outCubic(p)), layer: 'portal', ground: 1e9 };
  }

  function ballState(t) {
    const P = ballPos(t);
    const h = 1 / 240;
    const A = ballPos(t - h), B = ballPos(t + h);
    const vx = (B.x - A.x) / (2 * h), vy = (B.y - A.y) / (2 * h);
    const speed = Math.hypot(vx, vy);
    const b = t / BEAT;
    let squash = b < LETTER_RISE[I_IDX] ? impactSquash(t) : 0;
    if (b >= LETTER_RISE[I_IDX] && b < HOP.launch) {
      for (let i = 0; i < TITTLE_LANDS.length; i++) {
        const dt = t - TITTLE_LANDS[i];
        if (dt >= 0 && dt < 0.3) squash += (i ? 0.1 : 0.24) * Math.exp(-dt * 20) * Math.cos(dt * 44);
      }
    }
    const ant = prog(b, HOP.anticipate, HOP.launch);
    if (b >= HOP.anticipate && b < HOP.launch) squash += 0.36 * ease.outCubic(ant);
    const stretch = 1 + clamp(speed / 3200) * 0.42;
    return { ...P, vx, vy, speed, squash, stretch, angle: Math.atan2(vy, vx) };
  }

  function drawBall(ctx, st, alpha = 1, ring = false, floorY = st.ground ?? FLOOR) {
    ctx.save();
    const r = R * st.s;
    // Squash anchors on the contact point (bottom) while grounded.
    const sy = 1 - st.squash;
    const sx = 1 / Math.sqrt(Math.max(0.3, sy));
    let cy = st.y;
    if (Math.abs(st.squash) > 0.01 && st.layer === 'front' && floorY < 1e8) cy = Math.min(st.y, floorY - r) + r * (1 - sy);
    ctx.translate(st.x, cy);
    if (Math.abs(st.squash) > 0.01) ctx.scale(sx, sy);
    else if (st.stretch > 1.01) {
      ctx.rotate(st.angle);
      ctx.scale(st.stretch, 1 / Math.sqrt(st.stretch));
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    if (ring) {
      ctx.lineWidth = 2 / Math.max(sx, 1);
      ctx.strokeStyle = rgba(PAL.orange, alpha);
      ctx.stroke();
    } else {
      ctx.fillStyle = rgba(PAL.orange, alpha);
      ctx.fill();
    }
    ctx.restore();
  }

  // Floor line dip under impacts (a trampoline-like spring).
  function floorDip(x, t) {
    let d = 0;
    for (let i = 0; i < lands.length; i++) {
      const dt = t - lands[i];
      if (dt < 0 || dt > 0.9) continue;
      const lx = bounceX(lands[i]);
      const amp = (i === 0 ? 30 : 30 * Math.pow(0.5, i)) * Math.exp(-dt * 5.5) * Math.cos(dt * 34 - 0.25);
      const sig = 70 + dt * 260;
      d += amp * Math.exp(-((x - lx) ** 2) / (2 * sig * sig));
    }
    return d;
  }

  function camera(b) {
    const p = prog(b, ZOOM.from, ZOOM.to);
    const e = Math.pow(p, 3.2);
    // Open tight on the bounce, then pull back to reveal the word as it rises.
    const open = ease.inOutCubic(prog(b, 3.1, 4.8));
    const tight = lerp(1.55, 1.0, open);
    const s = Math.exp(Math.log(80) * e) * tight * lerp(1, 1.035, prog(b, 4.8, ZOOM.from));
    const pan = ease.inOutSine(prog(b, 0.15, 3.3));
    const bx = lerp(X_START + 330, TITTLE.x, pan), by = FLOOR - 150;
    let F = { x: lerp(bx, WORD_C.x, open), y: lerp(by, WORD_C.y - 30, open) };
    const fp = ease.inOutCubic(prog(b, 6.2, 7.7));
    F = { x: lerp(F.x, PORTAL.x, fp), y: lerp(F.y, PORTAL.y, fp) };
    return { s, F, roll: 0.16 * e };
  }

  function letterState(i, t) {
    const b = t / BEAT;
    const u = t - LETTER_RISE[i] * BEAT;
    const rise = S * 1.05;
    if (u <= 0) return { dy: rise, rot: 0, sy: 1, vis: false };
    const p = spring(u, 2.1, 0.46);
    const pv = spring(u + 1 / 240, 2.1, 0.46);
    const vel = (pv - p) * 240 * rise; // px/s upward
    const stretch = 1 + clamp(vel / 4000, -0.12, 0.2);
    const dir = i < I_IDX ? -1 : i > I_IDX ? 1 : 0;
    const rot = dir * 0.12 * wobble(u, 1.6, 0.35);
    // Anticipation dip of the ı stem just before the hop
    let dip = 0;
    if (i === I_IDX) {
      dip = 10 * ease.outCubic(prog(b, HOP.anticipate, HOP.launch)) * (b < HOP.launch ? 1 : 0);
      if (b >= HOP.launch) dip = 10 * wobble(t - HOP.launch * BEAT, 3, 0.3) - 0;
    }
    return { dy: (1 - p) * rise + dip, rot, sy: stretch, vis: true };
  }

  function draw2d(ctx, env) {
    const { t } = env;
    const b = t / BEAT;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, W, H);

    const cam = camera(b);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(cam.roll);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.F.x, -cam.F.y);

    // Artboard dot grid (constant on-screen dot size; spacing zooms)
    {
      const a = 0.085 * ease.outCubic(prog(t, 0, 0.6)) * (1 - prog(b, 7.2, 7.9));
      if (a > 0) {
        ctx.fillStyle = rgba(PAL.paper, a);
        const step = 48;
        const inv = 1 / cam.s;
        const x0 = cam.F.x - (W / 2 + 200) * inv, x1 = cam.F.x + (W / 2 + 200) * inv;
        const y0 = cam.F.y - (H / 2 + 200) * inv, y1 = cam.F.y + (H / 2 + 200) * inv;
        const dr = 1.35 * inv;
        for (let y = Math.floor((y0 - H / 2) / step) * step + H / 2; y < y1; y += step) {
          for (let x = Math.floor((x0 - W / 2) / step) * step + W / 2; x < x1; x += step) {
            ctx.fillRect(x - dr, y - dr, dr * 2, dr * 2);
          }
        }
      }
    }

    const L = layout(100 + 12 * Math.sin(Math.PI * prog(b, 5.25, 5.95)) * ease.outCubic(prog(b, 5.25, 5.6)));
    const floorOn = ease.outExpo(prog(t, 0.05, 0.9));
    const floorOff = ease.inOutCubic(prog(b, 6.25, 6.9));
    const fx0 = X_START + 330;
    const lineL = lerp(lerp(fx0, W / 2 - 760, floorOn), W / 2, floorOff);
    const lineR = lerp(lerp(fx0, W / 2 + 760, floorOn), W / 2, floorOff);

    // Portal: cobalt iris opening inside the second "o"'s counter.
    const portalOpen = ease.outBack(prog(b, HOP.dive - 0.06, HOP.dive + 0.22), 1.4);
    const px = L.xs[O_IDX] + geo.counter.cx;
    if (portalOpen > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(px, PORTAL.y, (PORTAL.rx + 6) * portalOpen, (PORTAL.ry + 6) * portalOpen, 0, 0, TAU);
      ctx.fillStyle = PAL.cobalt;
      ctx.fill();
      ctx.clip();
      const st = ballState(t);
      if (st.layer === 'portal') {
        // During the zoom, the ball recedes: keep its on-screen size under control.
        const pz = prog(b, ZOOM.from, ZOOM.to);
        const screenR = lerp(R * st.s, 88, Math.pow(pz, 2.2));
        drawBall(ctx, { ...st, x: PORTAL.x, y: PORTAL.y, s: screenR / R / cam.s, squash: 0, stretch: 1 });
      }
      ctx.restore();
    }

    // Letters rising out of the floor slot
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1e5, -1e5, 2e5, 1e5 + FLOOR + 5);
    ctx.clip();
    ctx.fillStyle = PAL.paper;
    ctx.font = archivo(WEIGHT, L.width, S);
    ctx.letterSpacing = '0px';
    for (let i = 0; i < WORD.length; i++) {
      const ls = letterState(i, t);
      if (!ls.vis) continue;
      const cx = L.xs[i] + L.adv[i] / 2;
      ctx.save();
      ctx.translate(cx, FLOOR + ls.dy);
      ctx.rotate(ls.rot);
      ctx.scale(1 / Math.sqrt(ls.sy), ls.sy);
      ctx.fillText(WORD[i], -L.adv[i] / 2, 0);
      ctx.restore();
    }
    ctx.restore();

    // Floor line with impact dips; warms to orange near the ball.
    const st = ballState(t);
    if (lineR - lineL > 1) {
      ctx.save();
      const g = ctx.createLinearGradient(st.x - 220, 0, st.x + 220, 0);
      const near = st.layer === 'front' ? clamp(1 - (REST_Y - st.y) / 260) : 0;
      const warm = rgba(PAL.orange, lerp(0.42, 0.95, near));
      g.addColorStop(0, rgba(PAL.paper, 0.42));
      g.addColorStop(0.5, near > 0.02 ? warm : rgba(PAL.paper, 0.42));
      g.addColorStop(1, rgba(PAL.paper, 0.42));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2 / Math.sqrt(cam.s);
      ctx.beginPath();
      for (let x = lineL; x <= lineR; x += 6) {
        const y = FLOOR + floorDip(x, t);
        x === lineL ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.lineTo(lineR, FLOOR + floorDip(lineR, t));
      ctx.stroke();
      ctx.fillStyle = rgba(PAL.paper, 0.6);
      ctx.fillRect(lineL - 1, FLOOR - 7, 2, 14);
      ctx.fillRect(lineR - 1, FLOOR - 7, 2, 14);
      ctx.restore();
    }

    // Timing chart: ticks + frame numbers at each landing (the animator's notes)
    {
      const fade = 1 - prog(b, 4.2, 4.9);
      ctx.save();
      ctx.font = mono(500, 13);
      ctx.letterSpacing = '1px';
      ctx.textAlign = 'center';
      for (let i = 0; i < lands.length; i++) {
        const age = t - lands[i];
        if (age < 0) continue;
        const a = clamp(age * 12) * fade;
        if (a <= 0) continue;
        const lx = bounceX(lands[i]);
        ctx.fillStyle = rgba(PAL.orange, 0.9 * a);
        ctx.fillRect(lx - 1, FLOOR + 12, 2, 12 + (i === 0 ? 8 : 0));
        if (i < 4) {
          ctx.fillStyle = rgba(PAL.paper, 0.55 * a);
          ctx.fillText(`f${Math.round(lands[i] * FPS)}`, lx, FLOOR + 50);
        }
      }
      ctx.restore();
    }

    // Onion skins: the ball's recent past, drawn as rings (every 3 frames).
    if (b < 4.6) {
      const fade = 1 - prog(b, 3.4, 4.3);
      // onion skins are discrete past *frames*: sample them on the frame grid so
      // the sub-frame motion-blur samples don't smear them into multiple outlines
      const tf = Math.floor(env.f) / FPS;
      for (let k = 12; k >= 1; k--) {
        const tp = tf - k * 3 / FPS;
        if (tp < 0.02) continue;
        const sp = ballState(tp);
        if (sp.layer !== 'front') continue;
        const a = 0.55 * Math.pow(1 - k / 13, 1.3) * fade;
        if (a > 0.01) drawBall(ctx, sp, a, true);
      }
    }

    // The ball itself (in front of the page)
    if (st.layer === 'front') {
      const floorY = b < LETTER_RISE[I_IDX] ? FLOOR + floorDip(st.x, t) : st.ground;
      // soft warm glow
      ctx.save();
      const gr = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, R * 3.2 * st.s);
      gr.addColorStop(0, rgba(PAL.orange, 0.22));
      gr.addColorStop(1, rgba(PAL.orange, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(st.x - R * 4, st.y - R * 4, R * 8, R * 8);
      ctx.restore();
      drawBall(ctx, st, 1, false, floorY);
    }

    // Caption
    {
      const inP = prog(b, 5.0, 5.9);
      const outP = prog(b, 6.3, 6.8);
      if (inP > 0 && outP < 1) {
        const text = 'it all starts with a bouncing ball.';
        ctx.save();
        ctx.font = serif(46);
        ctx.letterSpacing = '0px';
        ctx.textAlign = 'left';
        const tw = ctx.measureText(text).width;
        let x = W / 2 - tw / 2;
        const y = FLOOR + 112;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          const cw = ctx.measureText(ch).width;
          const pi = ease.outCubic(clamp(inP * 1.8 - (i / text.length) * 0.8));
          const a = pi * (1 - ease.inCubic(outP));
          if (a > 0.01) {
            ctx.fillStyle = rgba(PAL.paper, 0.78 * a);
            ctx.fillText(ch, x, y + (1 - pi) * 18 + ease.inCubic(outP) * 24);
          }
          x += cw;
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function events() {
    const ev = [];
    lands.forEach((t, i) => ev.push({ t, type: 'bounce', i, v: i === 0 ? G * (lands[0] - tDrop) : (G * (lands[i] - lands[i - 1])) / 2 }));
    ev.push({ t: tDetach, type: 'lift' });
    TITTLE_LANDS.forEach((t, i) => ev.push({ t, type: 'tittle', i }));
    LETTER_RISE.forEach((b, i) => ev.push({ t: b * BEAT, type: 'letter', i }));
    ev.push({ t: HOP.anticipate * BEAT, type: 'crouch' });
    ev.push({ t: HOP.launch * BEAT, type: 'hop' });
    ev.push({ t: HOP.dive * BEAT, type: 'dive' });
    ev.push({ t: ZOOM.from * BEAT, type: 'zoom', dur: (ZOOM.to - ZOOM.from) * BEAT });
    return ev;
  }

  return {
    draw2d,
    events,
    hud: () => ({ color: rgba(PAL.paper, 0.72) }),
    post: (env, p) => {
      p.vignette = 0.45;
    },
  };
}
