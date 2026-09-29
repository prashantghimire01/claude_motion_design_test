// Dump the physically-derived event times from the renderer so the soundtrack
// is scored to the exact frames: node tools/events.mjs [--format vertical]
import fs from 'node:fs';
import path from 'node:path';
import { serve, openReel, ROOT, args, FORMATS, formatOf } from './common.mjs';

const format = formatOf(args().format);

const srv = await serve();
const { browser, page } = await openReel(srv.port, { format });
const ev = await page.evaluate(() => window.reelEvents());
await browser.close();
srv.close();
const out = path.join(ROOT, 'showreel', 'audio', `events${FORMATS[format].suffix}.json`);
fs.writeFileSync(out, JSON.stringify(ev, null, 1));
console.log(`${ev.length} events -> ${out}`);
