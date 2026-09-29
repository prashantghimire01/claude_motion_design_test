// Render selected frames for design review, optionally as a contact sheet.
//   node tools/stills.mjs --frames 0,30,60 [--range 100:200:10] [--samples 1] [--out dir] [--sheet name.png --cols 4] [--format vertical]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, openReel, grabFrame, ffmpegPath, args, ROOT, formatOf } from './common.mjs';

const a = args();
const frames = [];
if (a.frames) frames.push(...String(a.frames).split(',').map(Number));
if (a.range) {
  const [s, e, st] = String(a.range).split(':').map(Number);
  for (let f = s; f <= e; f += st || 1) frames.push(f);
}
if (!frames.length) frames.push(0);
const samples = +(a.samples || 1);
const out = path.resolve(a.out || path.join(ROOT, 'output', 'stills'));
fs.mkdirSync(out, { recursive: true });

const srv = await serve();
const { browser, page } = await openReel(srv.port, { gpu: !!a.gpu, format: formatOf(a.format) });
const files = [];
const t0 = Date.now();
for (const f of frames) {
  const buf = await grabFrame(page, f, samples);
  const file = path.join(out, `f${String(f).padStart(4, '0')}.png`);
  fs.writeFileSync(file, buf);
  files.push(file);
}
console.log(`rendered ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
await browser.close();
srv.close();

if (a.sheet) {
  const cols = +(a.cols || 4);
  const rows = Math.ceil(files.length / cols);
  const list = path.join(out, '_list.txt');
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  const sheet = path.resolve(a.sheet.includes('/') ? a.sheet : path.join(out, a.sheet));
  const tw = +(a.tw || 480);
  execFileSync(ffmpegPath(), [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `scale=${tw}:-1:flags=lanczos,pad=iw+6:ih+6:3:3:color=0x202024,tile=${cols}x${rows}`,
    '-frames:v', '1', '-update', '1', sheet,
  ]);
  console.log('sheet ->', sheet);
}
