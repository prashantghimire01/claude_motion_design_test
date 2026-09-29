// Viewfinder HUD: corner marks, running timecode, and a chapter label that
// decodes (scrambles) into each new skill as the reel moves through it.
import { CHAPTERS, FPS, BEAT, DURATION } from './timeline.js';
import { mono } from './fonts.js';
import { clamp, hash1, ease, prog } from './lib.js';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#*+-=<>';

export function scramble(text, p, t, seed = 0) {
  // p: 0..1 reveal progress (left→right). Unrevealed chars flicker.
  const n = text.length;
  const revealed = Math.floor(p * (n + 3));
  const tick = Math.floor(t * 30);
  let out = '';
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch === ' ' || i < revealed - 3) out += ch;
    else if (i < revealed) out += GLYPHS[Math.floor(hash1(i * 131 + tick * 7 + seed) * GLYPHS.length)];
    else out += ' '; // figure space keeps layout stable
  }
  return out;
}

function timecode(t) {
  const f = Math.max(0, Math.round(t * FPS));
  const ff = f % FPS;
  const s = Math.floor(f / FPS);
  const pad = (n) => String(n).padStart(2, '0');
  return `00:00:${pad(s)}:${pad(ff)}`;
}

function chip(ctx, x, y, w, align, color) {
  if (!color) return;
  const pad = 9;
  const x0 = align === 'right' ? x - w - pad : x - pad;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x0, y - 18, w + pad * 2, 27, 4);
  ctx.fill();
  ctx.restore();
}

export function drawHUD(ctx, env, style) {
  const { t } = env;
  const b = t / BEAT;
  const color = style?.color || 'rgba(243,238,227,0.78)';
  const alpha = style?.alpha ?? 1;
  if (alpha <= 0) return;
  const M = 54;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.font = mono(500, 17);
  ctx.letterSpacing = '2.5px';

  const intro = prog(t, 0.05, 0.75);

  // Corner marks (draw on)
  const arm = 18 * ease.outCubic(prog(t, 0.0, 0.5));
  ctx.lineWidth = 1.5;
  const cm = 30;
  const corners = [[cm, cm, 1, 1], [W - cm, cm, -1, 1], [cm, H - cm, 1, -1], [W - cm, H - cm, -1, -1]];
  ctx.beginPath();
  for (const [x, y, sx, sy] of corners) {
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
  }
  ctx.stroke();

  // Legibility chips over busy backgrounds
  if (style?.chip) {
    ctx.font = mono(700, 17);
    const w1 = ctx.measureText('CLAUDE').width;
    ctx.font = mono(400, 17);
    chip(ctx, M, M + 12, 96 + ctx.measureText('MOTION DESIGNER').width, 'left', style.chip);
    chip(ctx, W - M, M + 12, ctx.measureText('SHOWREEL \u201926').width, 'right', style.chip);
    chip(ctx, M, H - M, 164 + 150, 'left', style.chip);
    chip(ctx, W - M, H - M, ctx.measureText('00/00  PRINCIPLES').width + 30, 'right', style.chip);
    ctx.fillStyle = color;
  }

  // Top-left: name
  ctx.textAlign = 'left';
  ctx.font = mono(700, 17);
  ctx.fillText(scramble('CLAUDE', prog(t, 0.05, 0.4), t, 1), M, M + 12);
  ctx.font = mono(400, 17);
  ctx.fillText(scramble('MOTION DESIGNER', prog(t, 0.15, 0.65), t, 2), M + 96, M + 12);

  // Top-right: reel
  ctx.textAlign = 'right';
  ctx.fillText(scramble('SHOWREEL ’26', prog(t, 0.25, 0.7), t, 3), W - M, M + 12);

  // Bottom-left: timecode + progress track
  ctx.textAlign = 'left';
  ctx.fillText(intro < 1 ? scramble(timecode(t), intro, t, 4) : timecode(t), M, H - M);
  const trackW = 150;
  ctx.globalAlpha = alpha * 0.3;
  ctx.fillRect(M + 164, H - M - 6, trackW, 1.5);
  ctx.globalAlpha = alpha;
  ctx.fillRect(M + 164, H - M - 6, trackW * clamp(t / DURATION) * ease.outCubic(intro), 1.5);

  // Bottom-right: chapter label (decodes on change)
  let ci = 0;
  for (let i = 0; i < CHAPTERS.length; i++) if (b >= CHAPTERS[i].from) ci = i;
  const ch = CHAPTERS[ci];
  const since = (b - ch.from) * BEAT;
  const label = `${String(ci + 1).padStart(2, '0')}/${String(CHAPTERS.length).padStart(2, '0')}  ${ch.title}`;
  const p = ci === 0 ? prog(t, 0.3, 0.9) : clamp(since / 0.3);
  ctx.textAlign = 'right';
  ctx.fillText(scramble(label, p, t, 10 + ci), W - M, H - M);
  // tiny beat indicator dot, pulses on each beat
  const bp = Math.exp(-((b % 1) * BEAT) * 10);
  ctx.globalAlpha = alpha * (0.35 + 0.65 * bp) * intro;
  ctx.beginPath();
  ctx.arc(W - M - ctx.measureText(label).width - 22, H - M - 6, 3.5 + 1.5 * bp, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
