// Procedural soundtrack: every sample synthesized from scratch (no samples, no libs).
// 128 BPM nu-disco in C major, scored to the renderer's own event times.
//   node tools/events.mjs && node showreel/audio/synth.mjs
//   vertical: node tools/events.mjs --format vertical && FORMAT=vertical node showreel/audio/synth.mjs
import fs from 'node:fs';
import { BEAT, DURATION, CHORDS } from '../src/timeline.js';

const SR = 48000;
const LEN = Math.round(DURATION * SR);
const PAD = SR * 3; // room for tails (trimmed at the end)
const SUFFIX = process.env.FORMAT === 'vertical' ? '-vertical' : '';
const events = JSON.parse(fs.readFileSync(new URL(`./events${SUFFIX}.json`, import.meta.url), 'utf8'));
const ev = (type) => events.filter((e) => e.type === type);
const b2s = (b) => b * BEAT;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- utilities
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(7);
const noise = () => R() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

class Bus {
  constructor() { this.L = new Float32Array(LEN + PAD); this.R = new Float32Array(LEN + PAD); }
  // add a mono buffer at time t with equal-power pan (-1..1)
  add(t, buf, gain = 1, pan = 0) {
    const off = Math.round(t * SR);
    const a = (pan + 1) * Math.PI / 4;
    const gl = Math.cos(a) * gain * Math.SQRT2, gr = Math.sin(a) * gain * Math.SQRT2;
    for (let i = 0; i < buf.length; i++) {
      const j = off + i;
      if (j < 0 || j >= this.L.length) continue;
      this.L[j] += buf[i] * gl;
      this.R[j] += buf[i] * gr;
    }
  }
  addStereo(t, l, r, gain = 1) {
    const off = Math.round(t * SR);
    for (let i = 0; i < l.length; i++) {
      const j = off + i;
      if (j < 0 || j >= this.L.length) continue;
      this.L[j] += l[i] * gain;
      this.R[j] += r[i] * gain;
    }
  }
  mix(other, gain = 1) { for (let i = 0; i < this.L.length; i++) { this.L[i] += other.L[i] * gain; this.R[i] += other.R[i] * gain; } }
}

// Zavalishin TPT state-variable filter (stable under fast modulation)
class SVF {
  constructor() { this.a = 0; this.b = 0; }
  run(x, fc, q) {
    const g = Math.tan(Math.PI * clamp(fc, 10, SR * 0.49) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.b;
    const v1 = a1 * this.a + a2 * v3;
    const v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a;
    this.b = 2 * v2 - this.b;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  }
}

// PolyBLEP saw
function sawBuf(n, freqFn, phase0 = 0) {
  const out = new Float32Array(n);
  let ph = phase0;
  for (let i = 0; i < n; i++) {
    const f = freqFn(i / SR);
    const dt = f / SR;
    let v = 2 * ph - 1;
    if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; }
    else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
    out[i] = v;
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
  return out;
}
function sineSweep(n, freqFn, ampFn, phase0 = 0) {
  const out = new Float32Array(n);
  let ph = phase0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = Math.sin(ph) * ampFn(t);
    ph += TAU * freqFn(t) / SR;
  }
  return out;
}
const N = (sec) => Math.max(1, Math.round(sec * SR));
const expEnv = (tau) => (t) => Math.exp(-t / tau);

// ---------------------------------------------------------------- buses
const drums = new Bus(), bass = new Bus(), music = new Bus(), sfx = new Bus(), verbSend = new Bus(), delaySend = new Bus();

// ---------------------------------------------------------------- drums
function kick(t, gain = 1) {
  const n = N(0.5);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const f = 47 + 125 * Math.exp(-tt * 32);
    ph += TAU * f / SR;
    const amp = Math.min(1, tt / 0.001) * Math.exp(-tt * 5.2);
    let v = Math.sin(ph) * amp;
    v += (tt < 0.006 ? noise() * 0.35 * Math.exp(-tt * 700) : 0) + Math.sin(TAU * 1800 * tt) * 0.25 * Math.exp(-tt * 260);
    b[i] = Math.tanh(v * 1.7) / Math.tanh(1.7);
  }
  drums.add(t, b, 0.95 * gain);
}
function clap(t, gain = 1) {
  const n = N(0.4);
  const f1 = new SVF(), f2 = new SVF();
  const l = new Float32Array(n), r = new Float32Array(n);
  const bursts = [0, 0.009, 0.019, 0.03];
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let env = 0;
    for (const o of bursts) if (tt >= o) env = Math.max(env, Math.exp(-(tt - o) / 0.0045));
    if (tt >= 0.03) env = Math.max(env, 0.7 * Math.exp(-(tt - 0.03) / 0.085));
    const x = noise() * env;
    const y = f1.run(x, 1250, 1.1).bp;
    const z = f2.run(noise() * env, 1500, 0.9).bp;
    l[i] = y * 2.4; r[i] = (y * 0.6 + z * 0.4) * 2.4;
  }
  drums.addStereo(t, l, r, 0.5 * gain);
  verbSend.addStereo(t, l, r, 0.22 * gain);
}
function hat(t, open = false, gain = 1, pan = 0) {
  const n = N(open ? 0.35 : 0.08);
  const f = new SVF(), f2 = new SVF();
  const b = new Float32Array(n);
  const partials = [205.3, 304.4, 369.6, 522.7, 540, 800].map((x) => x * 1.72);
  const ph = partials.map(() => R());
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let m = 0;
    for (let k = 0; k < partials.length; k++) m += (((ph[k] + partials[k] * tt) % 1) < 0.5 ? 1 : -1);
    const x = (m / 6) * 0.55 + noise() * 0.6;
    const env = Math.exp(-tt / (open ? 0.12 : 0.022));
    const y = f2.run(f.run(x, 7200, 0.8).hp, 12000, 0.7).lp;
    b[i] = y * env;
  }
  drums.add(t, b, 0.3 * gain, pan);
}
function snare(t, gain = 1, pitch = 1) {
  const n = N(0.25);
  const f = new SVF();
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    ph += TAU * (190 * pitch - 30 * Math.exp(-tt * 40)) / SR;
    const tone = Math.sin(ph) * Math.exp(-tt / 0.045) * 0.6;
    const nz = f.run(noise(), 2100 * pitch, 0.8).bp * Math.exp(-tt / 0.07) * 1.8;
    b[i] = tone + nz;
  }
  drums.add(t, b, 0.42 * gain, (R() - 0.5) * 0.3);
  verbSend.add(t, b, 0.15 * gain);
}
function crash(t, gain = 1, dur = 1.6) {
  const n = N(dur);
  const fl = new SVF(), fr = new SVF();
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = Math.min(1, tt / 0.002) * Math.exp(-tt / (dur * 0.33));
    l[i] = fl.run(noise(), 5200, 0.6).hp * env;
    r[i] = fr.run(noise(), 5600, 0.6).hp * env;
  }
  drums.addStereo(t, l, r, 0.33 * gain);
  verbSend.addStereo(t, l, r, 0.12 * gain);
}

// ---------------------------------------------------------------- tonal
function bassNote(t, midi, dur, gain = 1) {
  const n = N(dur + 0.05);
  const f0 = mtof(midi);
  const saw = sawBuf(n, () => f0);
  const flt = new SVF();
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = Math.min(1, tt / 0.004) * (tt < dur ? 0.75 + 0.25 * Math.exp(-tt / 0.08) : Math.exp(-(tt - dur) / 0.015) * 0.75);
    const cut = 260 + 1900 * Math.exp(-tt / 0.07);
    const s = flt.run(saw[i], cut, 1.1).lp;
    ph += TAU * f0 / SR;
    const sub = Math.sin(ph);
    b[i] = Math.tanh((s * 0.55 + sub * 0.85) * 1.3) * env;
  }
  bass.add(t, b, 0.62 * gain);
}
// FM electric piano
function ep(t, midi, dur, gain = 1, pan = 0) {
  const n = N(dur + 0.7);
  const f = mtof(midi);
  const l = new Float32Array(n), r = new Float32Array(n);
  let pc1 = 0, pm1 = 0, pc2 = 0, pm2 = 0, pt = 0;
  const det = Math.pow(2, 4 / 1200);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const idx = 1.9 * Math.exp(-tt * 8) + 0.35;
    const tine = 0.55 * Math.exp(-tt * 45);
    pm1 += TAU * f / SR; pm2 += TAU * f * det / SR; pt += TAU * f * 14 / SR;
    pc1 += TAU * f / SR; pc2 += TAU * f * det / SR;
    const env = Math.min(1, tt / 0.002) * Math.exp(-tt / 0.55) * (tt < dur ? 1 : Math.exp(-(tt - dur) / 0.07));
    const tn = Math.sin(pt) * tine;
    l[i] = Math.sin(pc1 + idx * Math.sin(pm1) + tn) * env;
    r[i] = Math.sin(pc2 + idx * Math.sin(pm2) + tn) * env;
  }
  const a = (pan + 1) * Math.PI / 4;
  const gl = Math.cos(a) * Math.SQRT2, gr = Math.sin(a) * Math.SQRT2;
  for (let i = 0; i < n; i++) { l[i] *= gl; r[i] *= gr; }
  music.addStereo(t, l, r, 0.12 * gain);
  verbSend.addStereo(t, l, r, 0.05 * gain);
}
// Supersaw pad voice with cutoff automation (absolute time function)
function pad(t0, midi, dur, gain, cutoffAt, attack = 0.25) {
  const n = N(dur + 0.6);
  const f = mtof(midi);
  const voices = 5;
  const fl = new SVF(), fr = new SVF();
  const l = new Float32Array(n), r = new Float32Array(n);
  const saws = [];
  for (let v = 0; v < voices; v++) {
    const d = Math.pow(2, ((v - (voices - 1) / 2) * 11) / 1200);
    saws.push(sawBuf(n, () => f * d, R()));
  }
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let sl = 0, sr = 0;
    for (let v = 0; v < voices; v++) { if (v % 2) sl += saws[v][i]; else sr += saws[v][i]; if (v === 2) { sl += saws[v][i] * 0.5; sr += saws[v][i] * 0.5; } }
    const env = Math.min(1, tt / attack) * (tt < dur ? 1 : Math.exp(-(tt - dur) / 0.18));
    const c = cutoffAt(t0 + tt);
    l[i] = fl.run(sl, c, 0.8).lp * env * 0.3;
    r[i] = fr.run(sr, c, 0.8).lp * env * 0.3;
  }
  music.addStereo(t0, l, r, gain);
  verbSend.addStereo(t0, l, r, gain * 0.25);
}
// Marimba-ish pluck
function marimba(t, midi, gain = 1, pan = 0, verb = 0.3, dly = 0.2) {
  const n = N(0.9);
  const f = mtof(midi);
  const b = new Float32Array(n);
  const P = [[1, 1, 0.42], [3.93, 0.32, 0.07], [9.2, 0.08, 0.025]];
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let v = 0;
    for (const [m, a, tau] of P) v += Math.sin(TAU * f * m * tt) * a * Math.exp(-tt / tau);
    v += (tt < 0.003 ? noise() * 0.3 * (1 - tt / 0.003) : 0);
    b[i] = v * Math.min(1, tt / 0.0015);
  }
  sfx.add(t, b, 0.2 * gain, pan);
  verbSend.add(t, b, 0.2 * gain * verb, pan);
  delaySend.add(t, b, 0.2 * gain * dly, pan);
}
function bell(t, midi, gain = 1, pan = 0, dur = 2.2) {
  const n = N(dur);
  const f = mtof(midi);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const idx = 2.2 * Math.exp(-tt * 3.5);
    b[i] = Math.sin(TAU * f * tt + idx * Math.sin(TAU * f * 3.5 * tt)) * Math.exp(-tt / (dur * 0.3)) * Math.min(1, tt / 0.002);
  }
  sfx.add(t, b, 0.12 * gain, pan);
  verbSend.add(t, b, 0.1 * gain, pan);
  delaySend.add(t, b, 0.05 * gain, pan);
}

// ---------------------------------------------------------------- sound design
function tok(t, gain = 1, pitch = 1, pan = 0) { // rubber ball on a hard floor
  const n = N(0.25);
  const b = new Float32Array(n);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    p1 += TAU * (930 * pitch * (0.78 + 0.22 * Math.exp(-tt * 60))) / SR;
    p2 += TAU * (150 * pitch * (0.7 + 0.3 * Math.exp(-tt * 40))) / SR;
    const click = tt < 0.002 ? noise() * (1 - tt / 0.002) * 0.5 : 0;
    b[i] = Math.sin(p1) * 0.5 * Math.exp(-tt / 0.03) + Math.sin(p2) * 0.9 * Math.exp(-tt / 0.07) + click;
  }
  sfx.add(t, b, 0.55 * gain, pan);
  verbSend.add(t, b, 0.12 * gain, pan);
}
function whoosh(t, dur, f1, f2, gain = 1, panFrom = -0.6, panTo = 0.6, q = 1.4, shape = 0.6) {
  const n = N(dur);
  const fl = new SVF(), fr = new SVF();
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = Math.pow(Math.sin(Math.PI * Math.pow(u, shape)), 2);
    const fc = f1 * Math.pow(f2 / f1, u);
    const pan = panFrom + (panTo - panFrom) * u;
    const a = (pan + 1) * Math.PI / 4;
    const x = fl.run(noise(), fc, q).bp * env * 2.2;
    const y = fr.run(noise(), fc * 1.05, q).bp * env * 2.2;
    l[i] = (x * 0.8 + y * 0.2) * Math.cos(a) * Math.SQRT2;
    r[i] = (y * 0.8 + x * 0.2) * Math.sin(a) * Math.SQRT2;
  }
  sfx.addStereo(t, l, r, 0.3 * gain);
  verbSend.addStereo(t, l, r, 0.1 * gain);
}
function riser(t, dur, gain = 1, f1 = 300, f2 = 9000) {
  const n = N(dur);
  const fl = new SVF(), fr = new SVF();
  const l = new Float32Array(n), r = new Float32Array(n);
  const sa = sawBuf(n, (tt) => 180 * Math.pow(8, tt / dur));
  const sb = sawBuf(n, (tt) => 181.5 * Math.pow(8, tt / dur));
  const fs = new SVF();
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = Math.pow(u, 2.2);
    const fc = f1 * Math.pow(f2 / f1, u);
    const ns = fl.run(noise(), fc, 2.2).bp, nr = fr.run(noise(), fc * 1.07, 2.2).bp;
    const tone = fs.run((sa[i] + sb[i]) * 0.5, fc * 0.8, 1.5).lp * 0.35;
    l[i] = (ns * 1.6 + tone) * env;
    r[i] = (nr * 1.6 + tone) * env;
  }
  sfx.addStereo(t, l, r, 0.32 * gain);
  verbSend.addStereo(t, l, r, 0.12 * gain);
}
function reverseCymbal(tEnd, dur, gain = 1) {
  const n = N(dur);
  const fl = new SVF(), fr = new SVF();
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = Math.exp((u - 1) * 4.5) * (u > 0.985 ? (1 - u) / 0.015 : 1);
    l[i] = fl.run(noise(), 4500, 0.7).hp * env;
    r[i] = fr.run(noise(), 4800, 0.7).hp * env;
  }
  sfx.addStereo(tEnd - dur, l, r, 0.4 * gain);
}
function impact(t, gain = 1, big = false) {
  const n = N(big ? 2.4 : 1.5);
  const b = new Float32Array(n);
  let ph = 0;
  const f = new SVF();
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    ph += TAU * (32 + 42 * Math.exp(-tt * 9)) / SR;
    const sub = Math.sin(ph) * Math.exp(-tt / (big ? 0.9 : 0.55));
    const body = f.run(noise(), 900 * Math.exp(-tt * 3) + 120, 0.7).lp * Math.exp(-tt / 0.12) * 1.6;
    b[i] = Math.tanh((sub * 1.2 + body) * 1.4);
  }
  sfx.add(t, b, 0.62 * gain);
  verbSend.add(t, b, 0.1 * gain);
  crash(t, gain * (big ? 1.2 : 1), big ? 2.6 : 1.8);
}
function bloop(t, gain = 1, f0 = 900, f1 = 280, dur = 0.16, pan = 0) {
  const n = N(dur);
  const b = sineSweep(n, (tt) => f1 + (f0 - f1) * Math.exp(-tt * 22), (tt) => Math.min(1, tt / 0.002) * Math.exp(-tt / (dur * 0.35)));
  sfx.add(t, b, 0.4 * gain, pan);
  verbSend.add(t, b, 0.12 * gain, pan);
}
function blip(t, freq, gain = 1, pan = 0, tau = 0.03) {
  const n = N(tau * 6);
  const b = sineSweep(n, (tt) => freq * (1 + 0.08 * Math.exp(-tt * 80)), (tt) => Math.min(1, tt / 0.001) * Math.exp(-tt / tau));
  sfx.add(t, b, 0.2 * gain, pan);
  delaySend.add(t, b, 0.07 * gain, pan);
  verbSend.add(t, b, 0.05 * gain, pan);
}
function zip(t, gain = 1, f0 = 220, f1 = 2600, dur = 0.1, pan = 0) {
  const n = N(dur);
  const s = sawBuf(n, (tt) => f0 * Math.pow(f1 / f0, tt / dur));
  const flt = new SVF();
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const tt = i / SR; b[i] = flt.run(s[i], f0 * Math.pow(f1 / f0, tt / dur) * 1.5, 3).bp * Math.sin(Math.PI * i / n); }
  sfx.add(t, b, 0.3 * gain, pan);
}
function flick(t, gain = 1, pan = 0) {
  const n = N(0.05);
  const f = new SVF();
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const tt = i / SR; b[i] = f.run(noise(), 3200, 2).bp * Math.exp(-tt / 0.01) * 2 + Math.sin(TAU * 1900 * tt) * 0.4 * Math.exp(-tt / 0.015); }
  sfx.add(t, b, 0.3 * gain, pan);
}
function boing(t, gain = 1, f0 = 180, f1 = 520, dur = 0.35, pan = 0) {
  const n = N(dur);
  const b = sineSweep(n, (tt) => (f0 + (f1 - f0) * (1 - Math.exp(-tt * 14))) * (1 + 0.06 * Math.sin(TAU * 22 * tt) * Math.exp(-tt * 6)),
    (tt) => Math.min(1, tt / 0.003) * Math.exp(-tt / (dur * 0.4)));
  sfx.add(t, b, 0.32 * gain, pan);
  verbSend.add(t, b, 0.1 * gain, pan);
}
function thonk(t, gain = 1, pan = 0) { // lacquered ball hitting the tile floor
  const n = N(0.6);
  const b = new Float32Array(n);
  let p1 = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    p1 += TAU * (62 + 60 * Math.exp(-tt * 30)) / SR;
    b[i] = Math.sin(p1) * Math.exp(-tt / 0.11) * 1.1 + Math.sin(TAU * 2637 * tt + 1.5 * Math.sin(TAU * 7300 * tt) * Math.exp(-tt * 30)) * 0.22 * Math.exp(-tt / 0.18);
  }
  sfx.add(t, b, 0.55 * gain, pan);
  verbSend.add(t, b, 0.15 * gain, pan);
}
function shutter(t, gain = 1) {
  const n = N(0.06);
  const f = new SVF();
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const tt = i / SR; const e = Math.exp(-tt / 0.006) + (tt > 0.028 ? 0.6 * Math.exp(-(tt - 0.028) / 0.005) : 0); b[i] = f.run(noise(), 2600, 1.2).bp * e * 2.5; }
  sfx.add(t, b, 0.28 * gain);
}
function shatter(t, gain = 1) {
  const r2 = rng(99);
  for (let k = 0; k < 70; k++) {
    const dt = Math.pow(r2(), 1.6) * 0.16;
    blip(t + dt, 2600 + r2() * 7000, 0.55 * gain * (1 - dt * 3), (r2() - 0.5) * 1.6, 0.012 + r2() * 0.05);
  }
  const n = N(0.3);
  const f = new SVF();
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const tt = i / SR; b[i] = f.run(noise(), 3000, 0.7).hp * Math.exp(-tt / 0.06); }
  sfx.add(t, b, 0.5 * gain);
  verbSend.add(t, b, 0.2 * gain);
}
function whirl(t, dur, gain = 1) { // the vortex: filtered air, AM'd at the spin rate
  const n = N(dur);
  const fl = new SVF(), fr = new SVF();
  const l = new Float32Array(n), r = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const rate = 2 + 16 * u * u;
    ph += TAU * rate / SR;
    const am = 0.55 + 0.45 * Math.sin(ph);
    const fc = 500 * Math.pow(6, u);
    const env = Math.min(1, u * 4) * (0.35 + 0.65 * u);
    const pan = Math.sin(ph) * 0.8;
    const a = (pan + 1) * Math.PI / 4;
    const x = fl.run(noise(), fc, 3).bp * am * env * 2;
    const y = fr.run(noise(), fc * 1.1, 3).bp * am * env * 2;
    l[i] = x * Math.cos(a) * Math.SQRT2;
    r[i] = y * Math.sin(a) * Math.SQRT2;
  }
  sfx.addStereo(t, l, r, 0.22 * gain);
}
function typeTicks(t, count, span, gain = 1) {
  const r2 = rng(5);
  for (let k = 0; k < count; k++) {
    const tt = t + (k / count) * span + r2() * 0.01;
    const n = N(0.02);
    const f = new SVF();
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = f.run(noise(), 4200 + r2() * 1500, 2.5).bp * Math.exp(-(i / SR) / 0.004) * 2;
    sfx.add(tt, b, 0.18 * gain, (r2() - 0.5) * 0.8);
  }
}

// ==================================================================== ARRANGEMENT
const chordAt = (b) => CHORDS.find((c) => b >= c.from && b < c.to) || CHORDS[CHORDS.length - 1];

// --- Intro pad (bars 1–2): filtered, opening
{
  const cut = (t) => 380 + 2400 * Math.pow(clamp(t / b2s(8), 0, 1), 2.2);
  for (const c of CHORDS.slice(0, 2)) {
    for (const m of c.notes) pad(b2s(c.from), m, b2s(c.to - c.from), 0.1, cut, c.from === 0 ? 1.2 : 0.05);
  }
}
// --- Drop pads (bars 3–7), sidechained later
{
  const cut = (t) => 1400 + 800 * Math.sin(t * 0.9);
  for (const c of CHORDS.filter((c) => c.from >= 8 && c.from < 28)) {
    for (const m of c.notes) pad(b2s(c.from), m, b2s(c.to - c.from), 0.07, c.from >= 24 ? (t) => 900 + 5000 * Math.pow(clamp((t - b2s(24)) / b2s(4), 0, 1), 2) : cut, 0.02);
  }
}
// --- Final chord: Cmaj9, lush
{
  const c = CHORDS[CHORDS.length - 1];
  for (const m of c.notes) {
    pad(b2s(28), m, b2s(3.2), 0.13, (t) => 600 + 3200 * Math.exp(-(t - b2s(28)) * 1.2), 0.005);
    ep(b2s(28), m + 12, 1.6, 1.1, (m % 5) / 5 - 0.4);
  }
  bassNote(b2s(28), 36, 1.6, 1.1);
  bassNote(b2s(28), 24, 1.6, 0.6);
}

// --- Drums
for (let b = 8; b < 26; b++) kick(b2s(b));
kick(b2s(28), 1.15);
for (let b = 9; b < 26; b += 2) clap(b2s(b));
for (let b = 8; b < 26; b += 0.5) {
  if (b % 1 === 0.5) hat(b2s(b), (Math.floor(b) % 4 === 1 || Math.floor(b) % 4 === 3) && b % 2 > 1, 1, 0.15);
}
for (let b = 8; b < 26; b += 0.25) if (b % 0.5 !== 0) hat(b2s(b), false, 0.35, -0.25);
for (let b = 5; b < 8; b += 0.25) hat(b2s(b), false, 0.2 + 0.5 * ((b - 5) / 3), -0.2);
// snare rolls
for (let b = 7; b < 8; b += 0.25) snare(b2s(b), 0.3 + 0.7 * (b - 7), 1 + (b - 7) * 0.25);
for (let b = 7.5; b < 8; b += 0.125) snare(b2s(b), 0.4 + 0.6 * ((b - 7.5) * 2), 1.2);
{
  let b = 26;
  while (b < 27.9) {
    const step = b < 27 ? 0.5 : b < 27.5 ? 0.25 : 0.125;
    snare(b2s(b), 0.25 + 0.75 * ((b - 26) / 2), 1 + (b - 26) * 0.18);
    b += step;
  }
}
crash(b2s(16), 0.5, 1.2);

// --- Bass: offbeat house pattern + pickup, following the chord roots
for (let b = 8; b < 26; b += 1) {
  const c = chordAt(b);
  const root = c.root + (c.root < 40 ? 12 : 0);
  bassNote(b2s(b + 0.5), root, BEAT * 0.4, 1);
  if (Math.floor(b) % 2 === 1) bassNote(b2s(b + 0.75), root + 12, BEAT * 0.18, 0.7);
}

// --- EP chord stabs (syncopated)
const STAB = [0.5, 1.25, 2.5, 3.25];
for (let bar = 8; bar < 26; bar += 4) {
  for (const s of STAB) {
    const b = bar + s;
    if (b >= 26) continue;
    const c = chordAt(b);
    c.notes.forEach((m, k) => ep(b2s(b), m + 12, BEAT * 0.35, 0.85, (k - 1.5) * 0.25));
  }
}
// --- Arp from bar 4, sparkle over the grid
{
  for (let b = 12; b < 24; b += 0.25) {
    const c = chordAt(b);
    const k = Math.round((b - 12) * 4);
    const seq = [0, 2, 1, 3, 2, 0, 3, 1];
    const note = c.notes[seq[k % 8] % c.notes.length] + 24;
    marimba(b2s(b), note, 0.28 + (k % 4 === 0 ? 0.12 : 0), ((k % 2) - 0.5) * 0.7, 0.2, 0.35);
  }
}

// ==================================================================== SOUND DESIGN (from renderer events)
const pan = (x) => clamp((x - 0.5) * 1.6, -0.9, 0.9);

// Intro: the bouncing ball
ev('bounce').forEach((e) => tok(e.t, clamp(e.v / 3000, 0.08, 1) ** 0.8, 1, -0.3 + e.i * 0.06));
ev('lift').forEach((e) => boing(e.t - 0.2, 0.35, 140, 320, 0.3));
ev('tittle').forEach((e) => tok(e.t, e.i ? 0.18 : 0.35, 1.6));
{
  // letters ripple up from the ı: rising arpeggio on G6 (G B D E)
  const notes = { 3: [76], 2: [79], 4: [83], 1: [86], 5: [88], 0: [91] };
  ev('letter').forEach((e) => (notes[e.i] || [84]).forEach((m) => marimba(e.t, m, 0.9, (e.i - 2.5) * 0.25, 0.35, 0.35)));
}
ev('crouch').forEach((e) => { if (e.seg === 'intro') zip(e.t, 0.25, 700, 250, 0.12); });
ev('hop').forEach((e) => boing(e.t, 0.8, 200, 700, 0.3, 0.2));
ev('dive').forEach((e) => { bloop(e.t, 1.0, 1400, 180, 0.3, 0.3); whoosh(e.t, 0.5, 120, 600, 0.6, 0.3, 0, 0.8); });
ev('zoom').forEach((e) => { riser(e.t, e.dur, 1.1); whoosh(e.t + e.dur * 0.4, e.dur * 0.6, 300, 6000, 0.8, -0.3, 0.3, 0.9, 0.35); reverseCymbal(e.t + e.dur, 0.9, 0.9); });

// World
impact(b2s(8), 1.0);
ev('split').forEach((e) => { bloop(e.t, 0.9, 520, 1100, 0.18, -0.3); bloop(e.t + 0.03, 0.7, 520, 1300, 0.18, 0.3); });
ev('morph').forEach((e) => zip(e.t, 0.35, 300 + e.i * 60, 1800 + e.i * 200, 0.08, ((e.i % 3) - 1) * 0.6));
ev('dance').forEach((e, k) => { if (k % 3 === 0) flick(e.t, 0.6, ((e.i % 3) - 1) * 0.6); });
ev('flip').forEach((e) => flick(e.t, 0.9, ((e.i % 3) - 1) * 0.6));
ev('zoomout').forEach((e) => whoosh(e.t, 0.7, 2500, 250, 0.9, 0.5, -0.5, 1.2, 0.3));
{
  const penta = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93];
  ev('pop').forEach((e, k) => blip(e.t, mtof(penta[(k * 3) % penta.length]), 0.55, ((k * 37) % 17) / 8.5 - 1, 0.035));
}
ev('wave').forEach((e) => whoosh(e.t, 0.45, e.kind === 1 ? 4000 : 800, e.kind === 1 ? 1500 : 3000, 0.35, -0.7, 0.7, 2, 0.5));
ev('tilt').forEach((e) => whoosh(e.t, 1.0, 180, 2400, 1.1, -0.2, 0.4, 0.9, 0.45));
ev('balldrop').forEach((e) => whoosh(e.t, e.dur + 0.05, 900, 220, 0.5, 0.1, 0, 1.6, 0.8));
ev('land3d').forEach((e) => thonk(e.t, [1, 0.6, 0.38, 0.22][e.i], 0.15));
ev('crouch3d').forEach((e) => zip(e.t, 0.3, 500, 180, 0.12));
ev('launch').forEach((e) => { boing(e.t, 0.7, 150, 900, 0.4); whoosh(e.t, BEAT * 0.95, 300, 5000, 0.9, 0.2, -0.2, 1, 0.3); });
ev('lens').forEach((e) => { thonk(e.t, 0.9, 0); shutter(e.t, 1.2); });

// Principles
ev('cut').forEach((e) => { if (e.i > 0) shutter(e.t, 0.8); });
ev('squash').forEach((e) => { thonk(e.t, 0.8, 0); bloop(e.t, 0.6, 400, 90, 0.2); });
ev('stretch').forEach((e) => boing(e.t, 0.9, 160, 620, 0.42, -0.2));
ev('windup').forEach((e) => zip(e.t, 0.45, 900, 180, e.dur + 0.02, 0.3));
ev('release').forEach((e) => { zip(e.t, 0.6, 250, 4000, 0.07, -0.2); whoosh(e.t, 0.25, 800, 5000, 0.7, 0.5, -0.5, 1.5, 0.3); });
ev('follow').forEach((e) => { whoosh(e.t, 0.3, 4000, 900, 0.8, 0.7, -0.4, 1.2, 0.3); typeTicks(e.t + 0.12, 7, 0.16, 1.1); });

// Finale
ev('shatter').forEach((e) => shatter(e.t, 1));
ev('ballpop').forEach((e) => bloop(e.t, 0.8, 300, 900, 0.2));
ev('vortex').forEach((e) => whirl(e.t, e.dur + 0.5, 1));
ev('launchup').forEach((e) => { boing(e.t, 0.5, 250, 1200, 0.3, 0); });
ev('converge').forEach((e) => { riser(e.t - BEAT, e.dur + BEAT, 0.9, 500, 11000); reverseCymbal(e.t + e.dur, 1.4, 1.1); });
impact(b2s(28), 1.25, true);
ev('subtitle').forEach((e) => { [84, 88, 91, 96, 100].forEach((m, k) => bell(e.t + k * 0.045, m, 0.5, (k - 2) * 0.3, 1.4)); });
ev('details').forEach((e) => typeTicks(e.t + 0.1, 14, 0.5, 0.8));
ev('perioddrop').forEach((e) => whoosh(e.t, e.dur, 2400, 600, 0.35, 0, 0, 2, 0.8));
ev('period').forEach((e) => tok(e.t, [0.9, 0.35, 0.18, 0.09][e.i], 1.25, 0.1));
ev('period').filter((e) => e.i === 0).forEach((e) => { bell(e.t, 84, 0.9, -0.2, 3.0); bell(e.t + 0.012, 91, 0.6, 0.2, 3.0); });

// ==================================================================== FX + MIX
// Sidechain ducking from kicks
function sidechain(bus, depth, release = 0.16) {
  const kicks = [];
  for (let b = 8; b < 26; b++) kicks.push(b2s(b));
  kicks.push(b2s(28));
  for (let i = 0; i < bus.L.length; i++) {
    const t = i / SR;
    let g = 1;
    for (let k = kicks.length - 1; k >= 0; k--) {
      const dt = t - kicks[k];
      if (dt < -0.003) continue;
      if (dt > 0.5) break;
      const att = dt < 0 ? (dt + 0.003) / 0.003 : 1;
      g = Math.min(g, 1 - depth * att * Math.exp(-Math.max(0, dt) / release));
      break;
    }
    bus.L[i] *= g; bus.R[i] *= g;
  }
}
sidechain(music, 0.55);
sidechain(bass, 0.35, 0.1);

// Freeverb-style reverb
function freeverb(bus, room = 0.84, damp = 0.35, wet = 1) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const scale = SR / 44100;
  const out = new Bus();
  for (const [ch, spread] of [['L', 0], ['R', 23]]) {
    const inp = bus[ch];
    const acc = new Float32Array(inp.length);
    for (const c of combs) {
      const len = Math.round((c + spread) * scale);
      const buf = new Float32Array(len);
      let idx = 0, store = 0;
      for (let i = 0; i < inp.length; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = inp[i] * 0.015 + store * room;
        idx = (idx + 1) % len;
        acc[i] += y;
      }
    }
    for (const a of aps) {
      const len = Math.round((a + spread) * scale);
      const buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < acc.length; i++) {
        const bo = buf[idx];
        const y = -acc[i] + bo;
        buf[idx] = acc[i] + bo * 0.5;
        idx = (idx + 1) % len;
        acc[i] = y;
      }
    }
    out[ch] = acc;
  }
  for (let i = 0; i < out.L.length; i++) { out.L[i] *= wet; out.R[i] *= wet; }
  return out;
}
// Ping-pong delay (dotted 8th): L, R, L… with a darkening feedback path
function pingpong(bus, time = BEAT * 0.75, fb = 0.38, lpHz = 3800) {
  const d = Math.round(time * SR);
  const out = new Bus();
  const fl = new SVF(), fr = new SVF();
  for (let i = d; i < bus.L.length; i++) {
    const j = i - d;
    const x = (bus.L[j] + bus.R[j]) * 0.5;
    out.L[i] = x + fb * fl.run(out.R[j], lpHz, 0.7).lp;
    out.R[i] = fb * fr.run(out.L[j], lpHz, 0.7).lp;
  }
  return out;
}

if (process.env.DEBUG_BUS) {
  const rms = (bus, t0, t1) => { let e = 0; const s0 = Math.round(t0 * SR), s1 = Math.round(t1 * SR); for (let i = s0; i < s1; i++) e += bus.L[i] ** 2 + bus.R[i] ** 2; return 10 * Math.log10(e / (2 * (s1 - s0)) + 1e-12); };
  const W = { intro: [0.4, 1.5], letters: [1.8, 3.0], drop: [4.0, 7.0], principles: [9.4, 11.2], build: [12.0, 13.1], end: [13.2, 14.6] };
  console.log('bus (dB RMS)'.padEnd(12), Object.keys(W).map((k) => k.padStart(11)).join(''));
  for (const [name, bus] of Object.entries({ drums, bass, music, sfx })) {
    console.log(name.padEnd(12), Object.values(W).map(([a, b]) => rms(bus, a, b).toFixed(1).padStart(11)).join(''));
  }
}
const master = new Bus();
master.mix(drums, 1.0);
master.mix(bass, 1.15);
master.mix(music, 1.9);
master.mix(sfx, 1.0);
master.mix(freeverb(verbSend, 0.86, 0.3), 0.9);
master.mix(pingpong(delaySend), 0.8);

// gentle high-pass on the master to clear sub rumble < 25 Hz
{
  const fl = new SVF(), fr = new SVF();
  for (let i = 0; i < master.L.length; i++) { master.L[i] = fl.run(master.L[i], 24, 0.7).hp; master.R[i] = fr.run(master.R[i], 24, 0.7).hp; }
}

// Fade the very end to silence at 15.000 s
for (let i = 0; i < master.L.length; i++) {
  const t = i / SR;
  const g = t > DURATION - 0.9 ? Math.pow(clamp((DURATION - t) / 0.9, 0, 1), 1.5) : 1;
  master.L[i] *= g; master.R[i] *= g;
}

// Bus compressor (glue) + look-ahead brickwall limiter at -1 dBFS
function glue(bus, thresh = 0.35, ratio = 2.5, att = 0.01, rel = 0.15) {
  let env = 0;
  const ka = Math.exp(-1 / (att * SR)), kr = Math.exp(-1 / (rel * SR));
  for (let i = 0; i < bus.L.length; i++) {
    const x = Math.max(Math.abs(bus.L[i]), Math.abs(bus.R[i]));
    env = x > env ? ka * env + (1 - ka) * x : kr * env + (1 - kr) * x;
    let g = 1;
    if (env > thresh) g = Math.pow(env / thresh, 1 / ratio - 1);
    bus.L[i] *= g; bus.R[i] *= g;
  }
}
function limiter(bus, ceiling = Math.pow(10, -1.5 / 20), look = 0.005, rel = 0.08) {
  const la = Math.round(look * SR);
  const n = bus.L.length;
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pk = Math.max(Math.abs(bus.L[i]), Math.abs(bus.R[i]));
    req[i] = pk > ceiling ? ceiling / pk : 1;
  }
  // running minimum over the look-ahead window
  const minAhead = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1;
    for (let k = 0; k <= la && i + k < n; k += 4) m = Math.min(m, req[i + k]);
    minAhead[i] = m;
  }
  const ka = 1 - Math.exp(-1 / (la / 3)), kr = Math.exp(-1 / (rel * SR));
  let g = 1;
  for (let i = 0; i < n; i++) {
    const target = minAhead[i];
    g = target < g ? g + (target - g) * ka : kr * g + (1 - kr) * target;
    bus.L[i] = clamp(bus.L[i] * g, -ceiling, ceiling);
    bus.R[i] = clamp(bus.R[i] * g, -ceiling, ceiling);
  }
}

const preGain = +(process.env.GAIN || 0.42);
for (let i = 0; i < master.L.length; i++) { master.L[i] *= preGain; master.R[i] *= preGain; }
glue(master, 0.45, 2.2);
limiter(master);

// ---------------------------------------------------------------- write 24-bit WAV
function writeWav(path, L, R, n) {
  const bytes = 3, ch = 2;
  const data = Buffer.alloc(n * ch * bytes);
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (const s of [L[i], R[i]]) {
      let v = Math.round(clamp(s, -1, 1) * 8388607);
      if (v < 0) v += 16777216;
      data[o++] = v & 255; data[o++] = (v >> 8) & 255; data[o++] = (v >> 16) & 255;
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * ch * bytes, 28); h.writeUInt16LE(ch * bytes, 32); h.writeUInt16LE(bytes * 8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path, Buffer.concat([h, data]));
}
const out = process.env.OUT ? process.env.OUT : new URL(`./soundtrack${SUFFIX}.wav`, import.meta.url);
writeWav(out, master.L, master.R, LEN);
let pk = 0;
for (let i = 0; i < LEN; i++) pk = Math.max(pk, Math.abs(master.L[i]), Math.abs(master.R[i]));
console.log(`${String(out).split('/').pop()}  ${DURATION.toFixed(3)} s  @${SR} Hz  peak ${(20 * Math.log10(pk)).toFixed(2)} dBFS`);
