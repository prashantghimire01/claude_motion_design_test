// Shared helpers for the render tools: static server, browser, ffmpeg lookup.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.png': 'image/png',
};

export function serve(root = ROOT) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => srv.close() }));
  });
}

export function playwright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    const g = execSync('npm root -g').toString().trim();
    return require(path.join(g, 'playwright'));
  }
}

export const FORMATS = {
  landscape: { W: 1920, H: 1080, suffix: '' },
  vertical: { W: 1080, H: 1920, suffix: '-vertical' },
};
export const formatOf = (name) => (FORMATS[name] ? name : 'landscape');

export async function openReel(port, { gpu = false, format = 'landscape' } = {}) {
  const F = FORMATS[formatOf(format)];
  const { chromium } = playwright();
  const args = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--ignore-gpu-blocklist'];
  if (!gpu) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport: { width: F.W, height: F.H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) console.error('[console]', m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/showreel/index.html?render&format=${formatOf(format)}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  return { browser, page };
}

export async function grabFrame(page, f, samples, shutter = 0.5) {
  const url = await page.evaluate(([f, s, sh]) => window.renderFrameToPNG(f, s, sh), [f, samples, shutter]);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

export function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  try {
    return execSync(`python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`).toString().trim();
  } catch {}
  throw new Error('ffmpeg not found: install ffmpeg or `pip install imageio-ffmpeg`, or set FFMPEG=/path/to/ffmpeg');
}

export function args(argv = process.argv.slice(2)) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      o[k] = v;
    }
  }
  return o;
}
