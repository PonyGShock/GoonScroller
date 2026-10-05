// Renders the Chrome Web Store images into store/: the 128px store icon, five 1280x800
// screenshots and the promo tiles. Uses the website's demo feed and the real settings panel.
//   npm run store-assets        (needs ImageMagick's `convert` to strip the alpha channel)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'store');
const tmp = path.join(out, '.tmp');
mkdirSync(tmp, { recursive: true });
const url = (p) => pathToFileURL(path.join(root, p)).href;
const fontUrl = url('store/space-grotesk.woff2');
const iconSvg = readFileSync(path.join(root, 'site/icon.svg'), 'utf8');

const browser = await chromium.launch();
// Block web fonts from the network; the scenes use the local copy.
const page = async (viewport, scale = 2) => {
  const p = await browser.newPage({ viewport, deviceScaleFactor: scale });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return p;
};

// ---------- 1. demo window captures from the website ----------

const site = await page({ width: 1366, height: 860 });
await site.goto(url('site/index.html'));
await site.addStyleTag({ content: `@font-face { font-family: 'Space Grotesk'; src: url('${fontUrl}'); font-weight: 300 700; }` });
await site.waitForTimeout(400);
const demo = site.locator('#demo');

async function demoState(fn, file) {
  await site.evaluate(fn);
  await site.waitForTimeout(1500);
  await demo.screenshot({ path: path.join(tmp, file) });
}

// Stop the loop so we control what's on screen.
await site.evaluate(() => setAuto(false));
await site.waitForTimeout(1600);
// A gallery on its 2nd image, auto-scroll counting down, hotkey shown.
await demoState(() => {
  clearTimeout(timer);
  auto = true;
  let i = posts.findIndex((p, n) => n > current && p.kind === 'gallery');
  scrollToPost(i);
  flip(1);
  countdown('Auto · next image', 3000);
  showKeys('Ctrl', 'Shift', '2');
  clearTimeout(timer);
}, 'demo-gallery.png');
// A video playing on X, with the "waiting for the video" indicator.
await demoState(() => {
  clearTimeout(timer);
  switchSite();
  let i = current + 1;
  ensurePosts(i + 8);
  while (posts[i].kind !== 'video') i++;
  scrollToPost(i);
  startVideo(posts[i]);
  countdown('Video · letting it play', 4200);
  toast('Auto-scroll on · every 6s', 5000);
  clearTimeout(timer);
}, 'demo-video.png');
// Paused because the mouse is on the page, with a like.
await demoState(() => {
  clearTimeout(timer);
  let i = current + 1;
  ensurePosts(i + 8);
  while (posts[i].kind !== 'image') i++;
  scrollToPost(i);
  pausedPill('Paused · mouse on page');
  const like = posts[i].el.querySelector('.actions span');
  like.classList.add('liked');
  like.textContent = '♥ Liked';
  toast('♥ Liked', 5000);
  clearTimeout(timer);
}, 'demo-paused.png');

// ---------- 2. the real settings panel ----------

const panel = await page({ width: 310, height: 1000 });
await panel.addInitScript(() => {
  const ok = (v) => Promise.resolve(v);
  const shortcuts = {
    'next-post': 'Ctrl+Shift+2', 'previous-post': 'Ctrl+Shift+1', 'toggle-auto': 'Ctrl+Shift+3', 'next-image': 'Ctrl+Shift+4',
    'previous-image': 'Ctrl+Shift+5', 'open-media': 'Alt+F', save: 'Alt+S', upvote: 'Alt+L',
  };
  const names = {
    'next-post': 'Next post', 'previous-post': 'Previous post', 'next-image': 'Next image in a gallery', 'previous-image': 'Previous image in a gallery',
    'toggle-auto': 'Start / stop auto-scroll', 'open-media': 'Open / close the current picture full screen', upvote: 'Upvote (Reddit) / like (X) the current post',
    save: 'Save (Reddit) / bookmark (X) the current post',
  };
  globalThis.chrome = {
    storage: {
      sync: {
        get: (d) => ok({ ...d, delay: 6, videoWait: 60, pageKeys: { 'next-post': { code: 'ArrowDown' }, 'previous-post': { code: 'ArrowUp' }, 'next-image': { code: 'ArrowRight' }, 'previous-image': { code: 'ArrowLeft' } } }),
        set: () => ok(),
      },
      session: { get: () => ok({ lastHotkey: { command: 'next-post', at: Date.now() - 4000, outcome: 'sent to the Reddit tab' } }), onChanged: { addListener() {} } },
    },
    tabs: { query: () => ok([{ id: 1 }]), create() {} },
    runtime: { sendMessage: () => ok({ site: 'Reddit', auto: true }) },
    commands: { getAll: () => ok(Object.keys(names).map((name) => ({ name, description: names[name], shortcut: shortcuts[name] || '' }))) },
  };
});
await panel.goto(url('popup/popup.html'));
await panel.waitForTimeout(400);
await panel.screenshot({ path: path.join(tmp, 'panel.png'), fullPage: true });

// ---------- 3. compose the store images ----------

const BASE = `
  @font-face { font-family: 'Space Grotesk'; src: url('${fontUrl}'); font-weight: 300 700; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { width: var(--w); height: var(--h); overflow: hidden; background: #121318; color: #ecedf1;
    font: 18px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; position: relative; }
  h1, h2 { font-family: 'Space Grotesk', system-ui, sans-serif; letter-spacing: -0.02em; line-height: 1.08; margin: 0 0 18px; }
  .accent { color: #ff4f6d; }
  .eyebrow { color: #ff4f6d; font-weight: 700; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 14px; }
  .glow { position: absolute; width: 900px; height: 900px; border-radius: 50%; background: radial-gradient(circle, rgba(255,79,109,.18), transparent 60%); pointer-events: none; }
  .brand { position: absolute; left: 72px; bottom: 52px; display: flex; align-items: center; gap: 10px;
    font: 700 20px 'Space Grotesk', system-ui, sans-serif; color: #8b8f99; }
  .brand svg { width: 28px; height: 28px; }
  .shot { display: grid; grid-template-columns: 470px 1fr; align-items: center; gap: 48px; height: 100%; padding: 0 64px 0 72px; position: relative; }
  .shot h1 { font-size: 56px; }
  .shot p { color: #b9bcc6; font-size: 21px; margin: 0 0 14px; }
  ul.ticks { list-style: none; margin: 22px 0 0; padding: 0; }
  ul.ticks li { position: relative; padding: 6px 0 6px 32px; font-size: 19px; color: #d6d8de; }
  ul.ticks li::before { content: '✓'; position: absolute; left: 0; color: #ff4f6d; font-weight: 800; }
  .visual { display: flex; justify-content: center; align-items: center; height: 100%; }
  .visual img.demo { width: 640px; border-radius: 18px; box-shadow: 0 40px 90px -30px rgba(0,0,0,.9); }
  kbd { display: inline-block; min-width: 44px; padding: 8px 14px; border: 1px solid #2a2d36; border-bottom-width: 4px; border-radius: 10px;
    background: #1b1d24; font: 700 19px ui-monospace, Menlo, Consolas, monospace; text-align: center; color: #ecedf1; }
  kbd.down { border-color: #ff4f6d; color: #ff4f6d; border-bottom-width: 1px; transform: translateY(3px); }
`;
const brand = `<div class="brand">${iconSvg} GoonScroller</div>`;

const keyRow = (keys, label, lit) => `
  <div style="display:flex;align-items:center;gap:22px;padding:18px 22px;border:1px solid ${lit ? '#ff4f6d' : '#2a2d36'};border-radius:16px;
    background:${lit ? 'linear-gradient(90deg,rgba(255,79,109,.16),#1b1d24)' : '#1b1d24'}">
    <span style="display:flex;gap:8px;min-width:250px">${keys.map((k) => `<kbd class="${lit ? 'down' : ''}">${k}</kbd>`).join('')}</span>
    <span style="font-size:20px">${label}</span></div>`;

const SHOTS = {
  'screenshot-1.png': `
    <div class="glow" style="right:-200px;top:-300px"></div>
    <div class="shot">
      <div>
        <div class="eyebrow">Reddit &amp; X</div>
        <h1>One post at a time.<br /><span class="accent">Perfectly lined up.</span></h1>
        <p>Every press snaps the next post right under the header. No half posts, no scrolling back.</p>
        <ul class="ticks"><li>Works on new Reddit, old.reddit and X</li><li>Flips through galleries</li><li>Skips text posts and ads</li></ul>
      </div>
      <div class="visual"><img class="demo" src="demo-gallery.png" /></div>
    </div>${brand}`,
  'screenshot-2.png': `
    <div class="glow" style="left:-300px;bottom:-400px"></div>
    <div class="shot">
      <div>
        <div class="eyebrow">Global hotkeys</div>
        <h1>Keeps working<br /><span class="accent">while you game.</span></h1>
        <p>Put your feed on the second monitor. The hotkeys reach it even when your game has focus. No alt-tab.</p>
        <ul class="ticks"><li>Change them to whatever you like</li><li>Or use plain arrow keys on the page</li></ul>
      </div>
      <div class="visual" style="flex-direction:column;align-items:stretch;gap:14px">
        ${keyRow(['Ctrl', 'Shift', '2'], 'Next post', true)}
        ${keyRow(['Ctrl', 'Shift', '1'], 'Previous post')}
        ${keyRow(['Ctrl', 'Shift', '3'], 'Start / stop auto-scroll')}
        ${keyRow(['Ctrl', 'Shift', '4'], 'Next image in a gallery')}
        ${keyRow(['↑', '↓', '←', '→'], 'Optional page keys')}
      </div>
    </div>${brand}`,
  'screenshot-3.png': `
    <div class="glow" style="right:-250px;bottom:-350px"></div>
    <div class="shot">
      <div>
        <div class="eyebrow">Auto-scroll</div>
        <h1>Sit back.<br /><span class="accent">It scrolls for you.</span></h1>
        <p>Moves on every 1 second to 5 minutes, and lets videos play to the end first.</p>
        <ul class="ticks"><li>Waits for videos, redgifs included</li><li>Pauses while your mouse is on the page</li><li>Optional full-screen mode</li></ul>
      </div>
      <div class="visual"><img class="demo" src="demo-video.png" /></div>
    </div>${brand}`,
  'screenshot-4.png': `
    <div class="glow" style="left:-300px;top:-400px"></div>
    <div class="shot" style="grid-template-columns:470px 1fr">
      <div>
        <div class="eyebrow">Settings</div>
        <h1>Everything in<br /><span class="accent">one small panel.</span></h1>
        <p>Click the toolbar icon to change the speed, video waiting, page keys and more.</p>
        <ul class="ticks"><li>Upvote / like and save / bookmark</li><li>Open pictures full screen</li><li>Play / pause videos</li></ul>
      </div>
      <div class="visual" style="flex-direction:column;justify-content:flex-start;padding-top:56px">
        <div style="display:flex;align-items:center;gap:14px;width:480px;padding:10px 16px;border-radius:14px 14px 0 0;background:#1b1d24;border:1px solid #2a2d36">
          <span style="flex:1;height:30px;border-radius:8px;background:#121318;color:#8b8f99;font-size:14px;line-height:30px;padding:0 12px">reddit.com</span>
          <span style="width:34px;height:34px;border-radius:9px;padding:5px;background:rgba(255,79,109,.2);box-shadow:0 0 0 2px #ff4f6d">${iconSvg.replace('<svg ', '<svg width="24" height="24" ')}</span>
        </div>
        <div style="position:relative;width:480px;height:640px;display:flex;justify-content:flex-end;padding-right:6px;background:#16171d;border:1px solid #2a2d36;border-top:0;border-radius:0 0 14px 14px;overflow:hidden">
          <div style="width:340px;height:632px;overflow:hidden;border-radius:0 0 14px 14px;border:1px solid #2a2d36;border-top:0;box-shadow:0 30px 70px -20px rgba(0,0,0,.9);
            -webkit-mask-image:linear-gradient(#000 85%,transparent)"><img src="panel.png" style="width:340px;display:block" /></div>
        </div>
      </div>
    </div>${brand}`,
  'screenshot-5.png': `
    <div class="glow" style="right:-300px;top:-300px"></div>
    <div class="shot">
      <div>
        <div class="eyebrow">Privacy</div>
        <h1>Runs on your computer.<br /><span class="accent">That's it.</span></h1>
        <ul class="ticks"><li>No tracking, no analytics, no accounts</li><li>Your settings stay in your browser</li><li>Free and open source (MIT)</li><li>🤖 Made with AI, out in the open</li></ul>
      </div>
      <div class="visual">
        <div style="position:relative;width:260px;height:300px">
          <div style="position:absolute;top:0;left:55px;width:150px;height:170px;border:26px solid #ff4f6d;border-bottom:0;border-radius:90px 90px 0 0"></div>
          <div style="position:absolute;bottom:0;width:260px;height:170px;border-radius:36px;background:#ff4f6d"></div>
          <div style="position:absolute;bottom:62px;left:113px;width:34px;height:56px;border-radius:17px;background:#121318"></div>
        </div>
      </div>
    </div>${brand}`,
};

const TILE = (w, h, big) => `
  <div class="glow" style="right:-${w / 3}px;top:-${h}px"></div>
  <div style="display:flex;align-items:center;gap:${big ? 48 : 22}px;height:100%;padding:0 ${big ? 110 : 34}px;position:relative">
    <div style="flex:none;width:${big ? 200 : 96}px;height:${big ? 200 : 96}px">${iconSvg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    <div>
      <h1 style="font-size:${big ? 76 : 38}px;margin:0 0 ${big ? 14 : 6}px">GoonScroller</h1>
      <div style="font-size:${big ? 30 : 17}px;color:#b9bcc6;line-height:1.3">Reddit &amp; X, one post<br />at a time. <span class="accent" style="font-weight:700">Hands-free.</span></div>
    </div>
  </div>`;

async function render(file, w, h, body) {
  const html = path.join(tmp, file.replace('.png', '.html'));
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>:root{--w:${w}px;--h:${h}px}${BASE}</style>${body}`);
  const p = await page({ width: w, height: h }, 1);
  await p.goto(pathToFileURL(html).href);
  await p.waitForTimeout(300);
  const raw = path.join(tmp, file);
  await p.screenshot({ path: raw });
  // The store wants 24-bit PNGs without an alpha channel.
  execFileSync('convert', [raw, '-background', '#121318', '-alpha', 'remove', '-alpha', 'off', `PNG24:${path.join(out, file)}`]);
  await p.close();
}

for (const [file, body] of Object.entries(SHOTS)) await render(file, 1280, 800, body);
await render('promo-small-440x280.png', 440, 280, TILE(440, 280, false));
await render('promo-marquee-1400x560.png', 1400, 560, TILE(1400, 560, true));

// Store icon: 96px artwork with 16px of transparent padding, as the image guidelines ask.
const icon = await page({ width: 128, height: 128 }, 1);
await icon.setContent(`<style>html,body{margin:0;background:transparent}</style><div style="padding:16px">${iconSvg.replace('<svg ', '<svg width="96" height="96" ')}</div>`);
await icon.screenshot({ path: path.join(out, 'store-icon-128.png'), omitBackground: true });

await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log('Store images written to store/');
