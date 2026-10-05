// Renders the promo video: frames from scene.html (driven by timeline.json) piped into ffmpeg,
// plus the soundtrack from music.py.
//   node promo/render.mjs [--stills 3,9,15,...]   (needs ffmpeg and python3 with numpy + scipy)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'out');
mkdirSync(out, { recursive: true });
const T = JSON.parse(readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
const stillsArg = process.argv.indexOf('--stills');
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript((t) => (window.TIMELINE = t), T);
await page.goto(pathToFileURL(path.join(dir, 'scene.html')).href);
await page.evaluate(() => document.fonts.ready);

if (stills) {
  for (const s of stills) {
    await page.evaluate(([t, f]) => render(t, f), [s, Math.round(s * T.fps)]);
    await page.screenshot({ path: path.join(out, `still-${s}.png`) });
  }
  await browser.close();
  process.exit(0);
}

execFileSync('python3', [path.join(dir, 'music.py'), path.join(out, 'music.wav')], { stdio: 'inherit' });

const video = path.join(out, 'goonscroller-promo.mp4');
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(T.fps), '-i', '-',
  '-i', path.join(out, 'music.wav'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = Math.round(T.duration * T.fps);
for (let f = 0; f < frames; f++) {
  await page.evaluate(([t, i]) => render(t, i), [f / T.fps, f]);
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 150 === 0) console.log(`frame ${f}/${frames}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log('wrote', video);
