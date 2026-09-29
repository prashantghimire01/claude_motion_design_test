// PRINCIPLES (beats 20–24): four rapid-fire cards. Each word *performs* the
// animation principle it names, and a tiny graph editor plots the actual curve
// driving it, with a live playhead.
import { clamp, lerp, prog, ease, spring, wobble, EASE, PAL, rgba, TAU } from '../lib.js';
import { archivo, mono } from '../fonts.js';
import { BEAT, FPS, PRINCIPLES } from '../timeline.js';

export let drawFollowSettled = null;
export const FOLLOW = { word: 'FOLLOW THROUGH', weight: 900, width: 78, size: 206, baseline: 640 };

export async function createPrinciples({ W, H }) {
  const m = document.createElement('canvas').getContext('2d');
  const adv = (ch, weight, width, size) => { if (ch === ' ') return size * 0.3; m.font = archivo(weight, width, size); m.letterSpacing = '0px'; return m.measureText(ch).width; };
  const T = (b) => b * BEAT;

  function layoutLetters(word, weight, widths, size, track = 0) {
    const a = [...word].map((ch, i) => adv(ch, weight, widths[i], size) + track);
    const total = a.reduce((s, v) => s + v, 0) - track;
    let x = -total / 2;
    return [...word].map((ch, i) => { const o = { ch, x, a: a[i] - track, w: widths[i] }; x += a[i]; return o; });
  }

  // --- tiny graph editor -----------------------------------------------------------
  function graph(ctx, { x, y, w, h, fns, u, color, fg, label, range = [0, 1.2] }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = rgba(fg, 0.28);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w, h);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo(0, (h * i) / 4 + 0.5); ctx.lineTo(w, (h * i) / 4 + 0.5); }
    for (let i = 1; i < 6; i++) { ctx.moveTo((w * i) / 6 + 0.5, 0); ctx.lineTo((w * i) / 6 + 0.5, h); }
    ctx.strokeStyle = rgba(fg, 0.1);
    ctx.stroke();
    const Y = (v) => h - ((v - range[0]) / (range[1] - range[0])) * h;
    fns.forEach((fn, k) => {
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const uu = i / 120;
        const px = uu * w, py = Y(fn(uu));
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.strokeStyle = k === 0 ? color : rgba(fg, 0.35);
      ctx.lineWidth = k === 0 ? 2.5 : 1.25;
      ctx.stroke();
    });
    // playhead
    const px = clamp(u) * w;
    ctx.fillStyle = rgba(fg, 0.55);
    ctx.fillRect(px - 0.75, -6, 1.5, h + 12);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, Y(fns[0](clamp(u))), 6, 0, TAU);
    ctx.fill();
    ctx.font = mono(600, 14);
    ctx.letterSpacing = '2px';
    ctx.fillStyle = rgba(fg, 0.75);
    ctx.fillText(label, 0, -14);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(clamp(u) * 28)}f`, w, -14);
    ctx.restore();
  }

  function annotate(ctx, card, fg, accent, p) {
    ctx.save();
    ctx.font = mono(700, 20);
    ctx.letterSpacing = '3px';
    const a = ease.outCubic(prog(p, 0.0, 0.25));
    ctx.fillStyle = rgba(fg, 0.9 * a);
    ctx.fillText(`Nº${card.no}`, 120, 250 - (1 - a) * 12);
    ctx.font = mono(400, 20);
    ctx.fillStyle = rgba(fg, 0.7 * a);
    ctx.fillText(card.name, 200, 250 - (1 - a) * 12);
    // bullet dot in accent
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(104, 243 - (1 - a) * 12, 5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------
  // Card 1 — SQUASH: drops in, squashes on impact, springs back (orange / ink)
  const SQ = { size: 300, weight: 900, width: 108, base: 700 };
  const sqDrop = (u) => { // u: seconds since card start → y offset & squash
    const tLand = 0.16;
    if (u < tLand) { const k = u / tLand; return { dy: -900 * (1 - k * k), sy: 1 + 0.35 * k, land: 0 }; }
    const v = u - tLand;
    return { dy: 0, sy: 1 - 0.5 * Math.exp(-v * 7) * Math.cos(v * 20), land: v };
  };
  function cardSquash(ctx, u, p) {
    ctx.fillStyle = PAL.orange;
    ctx.fillRect(0, 0, W, H);
    const st = sqDrop(u);
    // floor line
    ctx.fillStyle = rgba(PAL.ink, 0.9);
    const dip = st.land > 0 ? 22 * Math.exp(-st.land * 9) * Math.cos(st.land * 30) : 0;
    ctx.beginPath();
    ctx.moveTo(140, SQ.base);
    ctx.quadraticCurveTo(W / 2, SQ.base + dip * 2, W - 140, SQ.base);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PAL.ink;
    ctx.stroke();
    ctx.save();
    ctx.translate(W / 2, SQ.base + dip);
    const sy = st.sy, sx = 1 / Math.sqrt(Math.max(0.25, sy));
    ctx.scale(sx, sy);
    ctx.font = archivo(SQ.weight, SQ.width, SQ.size);
    ctx.letterSpacing = '-4px';
    ctx.textAlign = 'center';
    ctx.fillStyle = PAL.ink;
    ctx.fillText('SQUASH', 0, st.dy / sy);
    ctx.restore();
    annotate(ctx, PRINCIPLES[0], PAL.ink, PAL.paper, p);
    graph(ctx, {
      x: 120, y: 820, w: 300, h: 120, u: p, color: PAL.paper, fg: PAL.ink, label: 'SCALE Y',
      range: [0.3, 1.5], fns: [(uu) => sqDrop(uu * BEAT).sy],
    });
  }

  // Card 2 — STRETCH: letters stretch their width axis (62 → 125), right to left (paper / ink)
  function cardStretch(ctx, u, p) {
    ctx.fillStyle = PAL.paper;
    ctx.fillRect(0, 0, W, H);
    const word = 'STRETCH';
    const n = word.length;
    const wAt = (uu, i) => {
      const d = (n - 1 - i) * 0.018;
      const s = spring(uu - 0.04 - d, 2.4, 0.42);
      return lerp(62, 125, s);
    };
    const widths = [...word].map((_, i) => wAt(u, i));
    const size = 262;
    const L = layoutLetters(word, 900, widths, size, -3);
    const sxAll = 1 + 0.06 * wobble(u - 0.06, 2.2, 0.35);
    ctx.save();
    ctx.translate(W / 2, 650);
    ctx.scale(sxAll, 1 / sxAll);
    ctx.fillStyle = PAL.ink;
    for (const l of L) {
      ctx.font = archivo(900, l.w, size);
      ctx.letterSpacing = '0px';
      ctx.fillText(l.ch, l.x, 0);
    }
    ctx.restore();
    // measurement arrows under the word (design detail)
    const total = L[L.length - 1].x + L[L.length - 1].a - L[0].x;
    ctx.save();
    ctx.strokeStyle = rgba(PAL.cobalt, 0.9);
    ctx.fillStyle = PAL.cobalt;
    ctx.lineWidth = 2;
    const y = 715, x0 = W / 2 - (total / 2) * sxAll, x1 = W / 2 + (total / 2) * sxAll;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.fillRect(x0 - 1, y - 10, 2, 20); ctx.fillRect(x1 - 1, y - 10, 2, 20);
    ctx.font = mono(600, 16); ctx.letterSpacing = '2px'; ctx.textAlign = 'center';
    ctx.fillText(`wdth ${Math.round(widths[0])}`, W / 2, y + 36);
    ctx.restore();
    annotate(ctx, PRINCIPLES[1], PAL.ink, PAL.orange, p);
    graph(ctx, {
      x: 120, y: 820, w: 300, h: 120, u: p, color: PAL.orange, fg: PAL.ink, label: 'WIDTH AXIS',
      range: [50, 140], fns: [(uu) => wAt(uu * BEAT, n - 1), (uu) => wAt(uu * BEAT, 0)],
    });
  }

  // Card 3 — ANTICIPATION: winds back, then releases (lime / ink)
  const antX = (uu) => {
    const wind = ease.inOutCubic(clamp(uu / 0.17));
    const rel = clamp((uu - 0.17) / 0.06);
    const settle = uu - 0.23;
    if (uu < 0.17) return -150 * wind;
    if (uu < 0.23) return lerp(-150, 110, ease.inQuad(rel));
    return 110 * Math.exp(-settle * 9) * Math.cos(settle * 17);
  };
  function cardAnticipation(ctx, u, p) {
    ctx.fillStyle = PAL.lime;
    ctx.fillRect(0, 0, W, H);
    const x = antX(u);
    const v = (antX(u + 1 / 240) - antX(u - 1 / 240)) * 120; // px/s
    const skew = clamp(-v / 9000, -0.35, 0.35) + (u < 0.17 ? 0.12 * ease.inOutCubic(u / 0.17) : 0);
    const sx = u < 0.17 ? 1 - 0.1 * ease.inOutCubic(u / 0.17) : 1 + clamp(Math.abs(v) / 20000, 0, 0.14);
    ctx.save();
    ctx.translate(W / 2 + x, 640);
    ctx.transform(1, 0, -skew, 1, 0, 0);
    ctx.scale(sx, 1 / Math.sqrt(sx));
    ctx.font = archivo(900, 72, 232);
    ctx.letterSpacing = '-2px';
    ctx.textAlign = 'center';
    ctx.fillStyle = PAL.ink;
    ctx.fillText('ANTICIPATION', 0, 0);
    ctx.restore();
    annotate(ctx, PRINCIPLES[2], PAL.ink, PAL.cobalt, p);
    graph(ctx, {
      x: 120, y: 820, w: 300, h: 120, u: p, color: PAL.cobalt, fg: PAL.ink, label: 'POSITION X',
      range: [-190, 150], fns: [(uu) => antX(uu * BEAT)],
    });
  }

  // Card 4 — FOLLOW THROUGH: the word travels as a group and stops; each letter's
  // top keeps going (inertia ∝ acceleration) and springs back — the tail drags longest.
  const followX = (uu, i) => 1350 * (1 - spring(uu - i * 0.011, 2.7, 1.0)); // critically damped: no pile-ups
  const followLean = (uu, i, n) => {
    const h = 1 / 480, d = uu - i * 0.018;
    const a = (followX(d + h, i) - 2 * followX(d, i) + followX(d - h, i)) / (h * h);
    const tail = 1 + (i / (n - 1)) * 0.8;
    const settle = d - 0.2;
    const ring = settle > 0 ? 0.2 * tail * Math.exp(-settle * 6) * Math.sin(settle * 24) : 0;
    return clamp((a / 0.9e6) * tail + ring, -0.5, 0.5);
  };
  function layoutFollow() {
    const { word, weight, width, size } = FOLLOW;
    return layoutLetters(word, weight, Array(word.length).fill(width), size, 3);
  }
  function cardFollow(ctx, u, p) {
    ctx.fillStyle = PAL.cobalt;
    ctx.fillRect(0, 0, W, H);
    const { word, weight, width, size, baseline } = FOLLOW;
    const n = word.length;
    const L = layoutFollow();
    ctx.save();
    ctx.translate(W / 2, baseline);
    ctx.font = archivo(weight, width, size);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = PAL.paper;
    for (let i = 0; i < n; i++) {
      const l = L[i];
      if (l.ch === ' ') continue;
      ctx.save();
      ctx.translate(l.x + l.a / 2 + followX(u, i), 0);
      ctx.transform(1, 0, followLean(u, i, n), 1, 0, 0);
      ctx.fillText(l.ch, -l.a / 2, 0);
      ctx.restore();
    }
    ctx.restore();
    annotate(ctx, PRINCIPLES[3], PAL.paper, PAL.lime, p);
    graph(ctx, {
      x: 120, y: 820, w: 300, h: 120, u: p, color: PAL.lime, fg: PAL.paper, label: 'SKEW \u00D714',
      range: [-0.55, 0.55], fns: [(uu) => followLean(uu * BEAT, 0, n), (uu) => followLean(uu * BEAT, 6, n), (uu) => followLean(uu * BEAT, n - 1, n)],
    });
  }
  // exposed for the finale: the settled word, drawn exactly as on the card
  drawFollowSettled = (ctx) => {
    const { weight, width, size, baseline } = FOLLOW;
    const L = layoutFollow();
    ctx.save();
    ctx.translate(W / 2, baseline);
    ctx.font = archivo(weight, width, size);
    ctx.letterSpacing = '0px';
    for (const l of L) if (l.ch !== ' ') ctx.fillText(l.ch, l.x, 0);
    ctx.restore();
  };

  const CARDS = [cardSquash, cardStretch, cardAnticipation, cardFollow];

  function events() {
    const t0 = (b) => T(b);
    return [
      { t: t0(20), type: 'cut', i: 0 }, { t: t0(20) + 0.16, type: 'squash' },
      { t: t0(21), type: 'cut', i: 1 }, { t: t0(21) + 0.04, type: 'stretch' },
      { t: t0(22), type: 'cut', i: 2 }, { t: t0(22), type: 'windup', dur: 0.17 }, { t: t0(22) + 0.17, type: 'release' },
      { t: t0(23), type: 'cut', i: 3 }, { t: t0(23), type: 'follow' },
    ];
  }

  return {
    events,
    draw2d(ctx, env) {
      // Card choice and wipe position live on the frame grid (crisp editorial cuts);
      // the animation inside each card uses the sub-frame time (real motion blur).
      const bF = env.f / FPS / BEAT;
      const i = clamp(Math.floor(bF - 20 + 1e-6), 0, 3);
      const u = (env.b - (20 + i)) * BEAT;
      const uF = (bF - (20 + i)) * BEAT;
      const WIPE = 0.075;
      if (i > 0 && uF < WIPE) {
        // skewed wipe: the next card slides over the last one, led by an accent band
        CARDS[i - 1](ctx, BEAT, 1);
        const p = ease.outCubic(clamp(uF / WIPE));
        const SK = 260;
        const edge = lerp(W + SK + 40, -SK - 40, p);
        const accent = [PAL.lime, PAL.orange, PAL.paper][i - 1];
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(edge + SK, 0); ctx.lineTo(W + SK * 2, 0); ctx.lineTo(W + SK * 2, H); ctx.lineTo(edge, H);
        ctx.closePath();
        ctx.clip();
        CARDS[i](ctx, Math.max(0, u), clamp(u / BEAT));
        ctx.restore();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(edge + SK - 34, 0); ctx.lineTo(edge + SK, 0); ctx.lineTo(edge, H); ctx.lineTo(edge - 34, H);
        ctx.closePath();
        ctx.fill();
        return;
      }
      CARDS[i](ctx, Math.max(0, u), clamp(u / BEAT));
    },
    hud: (env) => {
      const i = clamp(Math.floor(env.f / FPS / BEAT - 20 + 1e-6), 0, 3);
      return { color: i === 3 ? rgba(PAL.paper, 0.85) : rgba(PAL.ink, 0.8) };
    },
    post: (env, p) => {
      p.vignette = 0.18;
      const dt = env.t - 20 * BEAT;
      if (dt >= 0 && dt < 0.09) {
        const k = 1 - dt / 0.09;
        p.flash = [1, 0.85, 0.7, 0.85 * k * k];
      }
    },
  };
}
