// Full render: N parallel headless browsers -> PNG frames -> ffmpeg (H.264 + AAC).
//   node tools/render.mjs [--workers 3] [--samples 6] [--from 0] [--to 900] [--skip-existing] [--encode-only] [--no-encode]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serve, openReel, grabFrame, ffmpegPath, args, ROOT } from './common.mjs';

const a = args();
const FRAMES = 900;
const from = +(a.from ?? 0);
const to = +(a.to ?? FRAMES);
const workers = +(a.workers || 3);
const samples = +(a.samples || 6);
const framesDir = path.resolve(a.dir || path.join(ROOT, 'output', 'frames'));
const outFile = path.resolve(a.out || path.join(ROOT, 'output', 'claude-motion-reel-2026.mp4'));
fs.mkdirSync(framesDir, { recursive: true });
const frameFile = (f) => path.join(framesDir, `${String(f).padStart(4, '0')}.png`);

if (!a['encode-only']) {
  const todo = [];
  for (let f = from; f < to; f++) if (!(a['skip-existing'] && fs.existsSync(frameFile(f)))) todo.push(f);
  console.log(`rendering ${todo.length} frames, ${samples} samples/frame, ${workers} workers`);
  const srv = await serve();
  const t0 = Date.now();
  let done = 0;
  await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      const { browser, page } = await openReel(srv.port, { gpu: !!a.gpu });
      for (let i = w; i < todo.length; i += workers) {
        const f = todo[i];
        fs.writeFileSync(frameFile(f), await grabFrame(page, f, samples));
        done++;
        if (done % 25 === 0 || done === todo.length) {
          const el = (Date.now() - t0) / 1000;
          const eta = (el / done) * (todo.length - done);
          console.log(`  ${done}/${todo.length}  ${el.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left`);
        }
      }
      await browser.close();
    }),
  );
  srv.close();
}

if (a['no-encode']) process.exit(0);

// Encode. Optional luma grain (--grain N) is added here rather than in the PNGs;
// it is off by default: temporal grain is near-incompressible and flat motion
// graphics don't need it (the renderer already dithers its gradients).
const audio = path.join(ROOT, 'showreel', 'audio', 'soundtrack.wav');
const hasAudio = fs.existsSync(audio);
const grain = +(a.grain ?? 0);
const vf = [
  'scale=out_color_matrix=bt709:out_range=tv',
  'format=yuv420p',
  ...(grain > 0 ? [`noise=c0s=${grain}:c0f=t+u`] : []),
].join(',');
const cmd = [
  '-y', '-loglevel', 'error', '-stats',
  '-framerate', '60', '-i', path.join(framesDir, '%04d.png'),
  ...(hasAudio ? ['-i', audio] : []),
  '-vf', vf,
  '-c:v', 'libx264', '-preset', a.preset || 'slow', '-crf', String(a.crf ?? 17), '-profile:v', 'high',
  '-tune', grain > 0 ? 'grain' : 'animation',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  ...(hasAudio ? ['-c:a', 'aac', '-b:a', '320k', '-shortest'] : []),
  '-movflags', '+faststart',
  outFile,
];
console.log('encoding ->', outFile);
const r = spawnSync(ffmpegPath(), cmd, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('done');
