// Orchestrator: frame(f) is a pure function of time.
import * as TL from './timeline.js';
import { loadFonts } from './fonts.js';
import { Compositor } from './gl.js';
import { drawHUD } from './hud.js';
import { makeNoise, hash1, linRGB, PAL } from './lib.js';
import { createIntro } from './shots/intro.js';
import { createWorld } from './shots/world.js';
import { createPrinciples } from './shots/principles.js';
import { createFinale } from './shots/finale.js';

const { W, H, FPS, BEAT } = TL;
const noise = makeNoise(7);

let comp, layer, ctx, segs;

export async function init() {
  await loadFonts('./fonts/');
  const out = document.getElementById('out');
  comp = new Compositor(out, W, H);
  layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  ctx = layer.getContext('2d');
  const deps = { comp, W, H };
  segs = {
    intro: await createIntro(deps),
    world: await createWorld(deps),
    principles: await createPrinciples(deps),
    finale: await createFinale(deps),
  };
}

function segmentForFrame(f) {
  for (const s of TL.SEGMENTS) {
    if (f >= TL.frameOfBeat(s.from) && f < TL.frameOfBeat(s.to)) return s;
  }
  return TL.SEGMENTS[TL.SEGMENTS.length - 1];
}

function postParams(t, seg, env) {
  let shakeAmp = 0;
  let ca = 0;
  let zoom = 1;
  let barrel = 0;
  for (const [bt, s] of TL.IMPACTS) {
    const dt = t - bt * BEAT;
    if (dt < 0) continue;
    shakeAmp += s * Math.exp(-dt * 10);
    ca += s * Math.exp(-dt * 7);
    zoom += s * 0.03 * Math.exp(-dt * 12);
    barrel += s * 0.06 * Math.exp(-dt * 9);
  }
  const shake = [noise.n2(t * 23, 3.1) * 16 * shakeAmp, noise.n2(7.7, t * 23) * 16 * shakeAmp];
  const p = { shake, zoom, ca: 0.14 + ca * 2.4, barrel, flash: [1, 1, 1, 0], vignette: 0.32, time: t };
  if (seg.post) seg.post(env, p);
  return p;
}

export function renderFrame(f, samples = 6, shutter = 0.5) {
  const segDef = segmentForFrame(f);
  const seg = segs[segDef.id];
  comp.beginFrame();
  for (let s = 0; s < samples; s++) {
    const off = samples > 1 ? ((s + 0.5) / samples - 0.5) * shutter : 0;
    const t = (f + off) / FPS;
    const b = t / BEAT;
    const env = {
      t, b, f, s, samples,
      lb: b - segDef.from, // local beats into the segment
      jitter: samples > 1 ? [hash1(f * 31 + s * 7) - 0.5, hash1(f * 17 + s * 13 + 5) - 0.5] : [0, 0],
    };
    comp.beginSample();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    if (seg.gl) seg.gl(comp, env);
    if (seg.draw2d) seg.draw2d(ctx, env);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHUD(ctx, env, seg.hud ? seg.hud(env) : null);
    comp.canvasLayer(layer);
    comp.endSample(1 / samples);
  }
  const tf = f / FPS;
  comp.post(postParams(tf, seg, { t: tf, b: tf / BEAT, f }));
}

export function reelEvents() {
  const ev = [];
  for (const k of Object.keys(segs)) if (segs[k].events) ev.push(...segs[k].events().map((e) => ({ ...e, seg: k })));
  return ev.sort((a, b) => a.t - b.t);
}

export { TL, W, H, FPS, PAL, linRGB };
