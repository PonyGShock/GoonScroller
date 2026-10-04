// End-to-end test: loads the real extension in Chromium, serves mock Reddit/X pages and drives
// it through the background worker, the same path a (global) hotkey takes.
//   npm test            (HEADED=1 npm test to watch it)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(here, '..');
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

let videoBody = null;
await context.route(/^https:\/\/(www\.)?reddit\.com\//, (r) => r.fulfill({ contentType: 'text/html', body: fixture('reddit.html') }));
await context.route(/^https:\/\/old\.reddit\.com\//, (r) => r.fulfill({ contentType: 'text/html', body: fixture('old-reddit.html') }));
await context.route(/^https:\/\/x\.com\//, (r) => r.fulfill({ contentType: 'text/html', body: fixture('x.html') }));
await context.route('https://media.test/clip.webm', (r) => r.fulfill({ contentType: 'video/webm', body: videoBody }));

const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const cmd = (command) => sw.evaluate((c) => globalThis.handleCommand(c), command);
const setSettings = (s) => sw.evaluate((s) => chrome.storage.sync.set(s), s);
const state = () => sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, url: globalThis.GoonShared.SITE_PATTERNS });
  return chrome.tabs.sendMessage(tab.id, { type: 'get-state' });
});
const topOf = (id) => page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), id);

// Id of the post whose top sits on the anchor line.
const postAt = (selector, line) => page.evaluate(([selector, line]) => {
  const el = [...document.querySelectorAll(selector)].find((p) => Math.abs(p.getBoundingClientRect().top - line) <= 1);
  return el?.id ?? null;
}, [selector, line]);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

async function expectSequence(selector, line, ids, settleMs = 700) {
  for (const id of ids) {
    await cmd('next-post');
    await wait(settleMs);
    assert.equal(await postAt(selector, line), id, `expected ${id} at y=${line}`);
  }
}

async function open(url) {
  await page.goto(url);
  await wait(400);
}

// ---------------------------------------------------------------- new Reddit

await setSettings({ smooth: false, mediaOnly: true, delay: 6, pauseOnHover: true, waitForVideos: true });
await open('https://www.reddit.com/r/test/');

await test('reddit: first post lands right under the sticky header', async () => {
  await cmd('next-post');
  await wait(700);
  assert.equal(await topOf('p0'), 61); // 56px header + 1px border + 4px gap
});

await test('reddit: skips text and plain link posts', async () => {
  await expectSequence('shreddit-post', 61, ['p2', 'p4']); // p4 is post-type="link" with a player inside
});

await test('reddit: previous post', async () => {
  await cmd('previous-post');
  await wait(700);
  assert.equal(await postAt('shreddit-post', 61), 'p2');
});

await test('reddit: two quick presses with smooth scrolling move two posts', async () => {
  await setSettings({ smooth: true });
  await cmd('next-post');
  await cmd('next-post');
  await wait(1800);
  assert.equal(await postAt('shreddit-post', 61), 'p5');
});

await test('reddit: keeps going into posts loaded by infinite scroll', async () => {
  await setSettings({ smooth: false });
  await expectSequence('shreddit-post', 61, ['p7', 'p9', 'p10', 'p12', 'p14', 'p15', 'p17']);
});

await test('reddit: media-only off stops on text posts too', async () => {
  await setSettings({ mediaOnly: false });
  await expectSequence('shreddit-post', 61, ['p18', 'p19']);
  await setSettings({ mediaOnly: true });
});

await test('reddit: auto mode advances, pauses on mouse, resumes when it leaves', async () => {
  await open('https://www.reddit.com/r/test/');
  await setSettings({ delay: 1 });
  await cmd('toggle-auto');
  assert.equal((await state()).auto, true);
  const badge = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, url: globalThis.GoonShared.SITE_PATTERNS });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
  assert.equal(badge, 'ON');

  await wait(1500);
  assert.equal(await postAt('shreddit-post', 61), 'p0');

  await page.mouse.move(400, 400);
  await page.mouse.move(420, 420);
  await wait(2500);
  assert.equal(await postAt('shreddit-post', 61), 'p0', 'should be paused while the mouse is on the page');

  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })));
  await wait(1600);
  assert.equal(await postAt('shreddit-post', 61), 'p2');

  await cmd('toggle-auto');
  assert.equal((await state()).auto, false);
});

await test('reddit: auto mode lets a playing video finish', async () => {
  // Record a ~4s clip in the browser (the bundled ffmpeg can't synthesize one).
  const recorder = await context.newPage();
  const b64 = await recorder.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    const ctx = canvas.getContext('2d');
    const rec = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const draw = setInterval(() => {
      ctx.fillStyle = `hsl(${Math.random() * 360} 80% 50%)`;
      ctx.fillRect(0, 0, 64, 64);
    }, 60);
    rec.start();
    await new Promise((r) => setTimeout(r, 4000));
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    clearInterval(draw);
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  await recorder.close();
  videoBody = Buffer.from(b64, 'base64');

  await open('https://www.reddit.com/r/test/');
  await page.bringToFront();
  // Put a real, playing video into the first media post (MediaRecorder webm has no duration
  // until it has been read through once, so fix that up first).
  await page.evaluate(async () => {
    const v = Object.assign(document.createElement('video'), { muted: true, src: 'https://media.test/clip.webm' });
    document.querySelector('#p2').append(v);
    await new Promise((r) => (v.onloadedmetadata = r));
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9;
      await new Promise((r) => (v.ontimeupdate = r));
      v.currentTime = 0;
    }
  });
  await cmd('next-post'); // p0
  await wait(700);
  await setSettings({ delay: 1 });
  await cmd('toggle-auto');
  await wait(1500);
  assert.equal(await postAt('shreddit-post', 61), 'p2');
  await page.evaluate(() => document.querySelector('#p2 video').play());
  await wait(2000); // the 1s delay is long gone, but the clip is still playing
  assert.equal(await postAt('shreddit-post', 61), 'p2', 'should wait for the video');
  let videoDone = null;
  for (let i = 0; i < 60 && (await postAt('shreddit-post', 61)) === 'p2'; i++) {
    videoDone = await page.evaluate(() => {
      const v = document.querySelector('#p2 video');
      return v.ended || v.currentTime >= v.duration - 0.4;
    });
    await wait(100);
  }
  assert.equal(await postAt('shreddit-post', 61), 'p4', 'should move on once the video ended');
  assert.equal(videoDone, true, 'moved on before the video finished');
  await cmd('toggle-auto');
});

await test('reddit: next-image clicks through a gallery, then moves to the next post', async () => {
  await setSettings({ smooth: false, delay: 6 });
  await open('https://www.reddit.com/r/test/');
  await page.mouse.move(1275, 795); // away from the gallery: arrows stay hidden, like when you're in a game
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#p2 gallery-carousel').shadowRoot.querySelector('button')).visibility), 'hidden');
  await cmd('next-post');
  await cmd('next-post'); // p2 is a 3-image gallery
  await wait(700);
  const index = () => page.evaluate(() => document.querySelector('#p2 gallery-carousel').dataset.index);
  await cmd('next-image');
  assert.equal(await index(), '1');
  await cmd('next-image');
  assert.equal(await index(), '2');
  await cmd('previous-image');
  assert.equal(await index(), '1');
  await cmd('next-image');
  await cmd('next-image'); // last image: on to the next post
  await wait(700);
  assert.equal(await postAt('shreddit-post', 61), 'p4');
});

await test('reddit: auto mode flips through gallery images before moving on', async () => {
  await open('https://www.reddit.com/r/test/');
  await cmd('next-post');
  await cmd('next-post'); // p2
  await wait(700);
  await setSettings({ delay: 1 });
  await cmd('toggle-auto');
  await wait(1400);
  assert.equal(await postAt('shreddit-post', 61), 'p2');
  await wait(1000);
  assert.equal(await page.evaluate(() => document.querySelector('#p2 gallery-carousel').dataset.index), '2');
  await wait(1200);
  assert.equal(await postAt('shreddit-post', 61), 'p4');
  await cmd('toggle-auto');
});

await test('shortcut text from the shortcuts page is understood', async () => {
  const parsed = await sw.evaluate(() => {
    const { parseShortcut: p } = globalThis.GoonShared;
    return ['Ctrl+Shift+Down Arrow', 'Ctrl+Shift+Right', 'Alt+K', 'Ctrl+Shift+2', 'Ctrl+Comma', 'Ctrl+Shift+Page Down', 'Command+Shift+8']
      .map((s) => p(s));
  });
  assert.deepEqual(parsed.map((s) => s.key ?? s.code), ['ArrowDown', 'ArrowRight', 'KeyK', 'Digit2', ',', 'PageDown', 'Digit8']);
  assert.equal(parsed[0].ctrl && parsed[0].shift && !parsed[0].alt, true);
  assert.equal(parsed[6].meta, true);
});

await test('reddit: pressing Ctrl+Shift+2 / Ctrl+Shift+1 in the page works', async () => {
  await setSettings({ smooth: false });
  await open('https://www.reddit.com/r/test/');
  await page.keyboard.press('Control+Shift+Digit2');
  await wait(700);
  assert.equal(await postAt('shreddit-post', 61), 'p0');
  await page.keyboard.press('Control+Shift+Digit2');
  await wait(700);
  assert.equal(await postAt('shreddit-post', 61), 'p2');
  await page.keyboard.press('Control+Shift+Digit1');
  await wait(700);
  assert.equal(await postAt('shreddit-post', 61), 'p0');
});

await test('reddit: plain arrow keys as page keys, incl. previous image back to the previous post', async () => {
  await setSettings({
    smooth: false,
    pageKeys: {
      'next-post': { code: 'ArrowDown' },
      'previous-post': { code: 'ArrowUp' },
      'next-image': { code: 'ArrowRight' },
      'previous-image': { code: 'ArrowLeft' },
    },
  });
  await open('https://www.reddit.com/r/test/');
  const index = () => page.evaluate(() => document.querySelector('#p2 gallery-carousel').dataset.index);
  await page.keyboard.press('ArrowDown');
  await wait(600);
  assert.equal(await postAt('shreddit-post', 61), 'p0');
  await page.keyboard.press('ArrowDown');
  await wait(600);
  assert.equal(await postAt('shreddit-post', 61), 'p2');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await index(), '2');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await index(), '1');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await index(), '0');
  await page.keyboard.press('ArrowLeft'); // first image: previous post
  await wait(600);
  assert.equal(await postAt('shreddit-post', 61), 'p0');
  await page.keyboard.press('ArrowUp'); // top of the page
  await wait(600);

  // Not while typing.
  await page.evaluate(() => {
    const input = Object.assign(document.createElement('input'), { id: 'typing' });
    document.querySelector('main').prepend(input);
  });
  const before = await page.evaluate(() => scrollY);
  await page.focus('#typing');
  await page.keyboard.press('ArrowDown');
  await wait(600);
  assert.equal(await page.evaluate(() => scrollY), before);
  await setSettings({ pageKeys: {} });
});

await test('reddit: gallery hotkeys work inside the full-screen image viewer', async () => {
  await setSettings({ smooth: false, pageKeys: { 'next-image': { code: 'ArrowRight' }, 'previous-image': { code: 'ArrowLeft' } } });
  await open('https://www.reddit.com/r/test/');
  await cmd('next-post');
  await cmd('next-post'); // p2 (gallery)
  await wait(600);
  await page.click('#p2 gallery-carousel', { position: { x: 200, y: 60 } });
  const index = () => page.evaluate(() => document.getElementById('lightbox').dataset.index);
  assert.equal(await index(), '0');

  await cmd('next-image'); // global hotkey path
  await wait(500);
  assert.equal(await index(), '1');
  await page.keyboard.press('ArrowRight'); // page key: must move exactly one image, not two
  await wait(500);
  assert.equal(await index(), '2');
  await cmd('next-image'); // last image: stays in the viewer, doesn't scroll the feed behind it
  await wait(600);
  assert.equal(await index(), '2');
  assert.equal(await postAt('shreddit-post', 61), 'p2');
  await page.keyboard.press('ArrowLeft');
  await wait(500);
  assert.equal(await index(), '1');
  await cmd('previous-image');
  await wait(500);
  assert.equal(await index(), '0');
  await page.keyboard.press('Escape');
  await setSettings({ pageKeys: {} });
});

// ---------------------------------------------------------------- X

await test('x: lines tweets up under the header, ignores the "new posts" pill and non-tweets', async () => {
  await setSettings({ smooth: false, delay: 6 });
  await open('https://x.com/home');
  // 53px header + 1px border; media tweets: n % 3 !== 1, every 7th cell is "Who to follow"
  await expectSequence('article', 54, ['t0', 't2', 't3', 't5', 't8', 't9', 't11', 't12', 't14', 't15', 't17', 't18', 't21', 't23', 't24']);
});

await test('x: previous post', async () => {
  await cmd('previous-post');
  await wait(700);
  assert.equal(await postAt('article', 54), 't23');
});

// ---------------------------------------------------------------- old Reddit

await test('old reddit: walks the listing, skips self/promoted posts, then opens the next page', async () => {
  await open('https://old.reddit.com/r/test/');
  await expectSequence('.thing', 4, ['pg1-0', 'pg1-2']);
  await cmd('next-post'); // pg1-4 can't reach the top (end of page)
  await wait(500);
  await cmd('next-post');
  await page.waitForURL(/page=2/);
});

await test('old reddit: auto mode carries over to the next page', async () => {
  await wait(400);
  await setSettings({ delay: 1 });
  await cmd('toggle-auto');
  await page.waitForURL(/page=3/, { timeout: 15000 });
  await wait(600);
  assert.equal((await state()).auto, true);
  await cmd('toggle-auto');
});

// ---------------------------------------------------------------- popup

await test('popup renders with hotkeys listed', async () => {
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (e) => popupErrors.push(e.message));
  await popup.setViewportSize({ width: 334, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await wait(500);
  const keys = await popup.$$eval('#shortcuts li', (lis) => lis.map((li) => li.textContent));
  assert.ok(keys.some((k) => k.includes('Next post') && k.includes('Ctrl+Shift+2')), keys.join(' | '));
  assert.ok(keys.some((k) => k.includes('Next image') && k.includes('Ctrl+Shift+4')), keys.join(' | '));
  assert.equal(await popup.isVisible('#keysMissing'), false);
  await popup.$eval('#delay', (s) => { s.value = s.max; s.dispatchEvent(new Event('input')); });
  assert.equal(await popup.textContent('#delayOut'), '5 min');
  assert.equal(await popup.textContent('#site'), 'Not on Reddit/X'); // the popup tab itself is active here
  // Record a page key: click the button, press a key.
  await popup.click('#pageKeys button[data-command="toggle-auto"]');
  await popup.keyboard.press('KeyP');
  const stored = await sw.evaluate(() => chrome.storage.sync.get('pageKeys'));
  assert.deepEqual(stored.pageKeys['toggle-auto'], { code: 'KeyP', ctrl: false, alt: false, shift: false, meta: false });
  await popup.click('#arrowPreset');
  assert.equal(await popup.textContent('#pageKeys button[data-command="next-image"]'), '→');
  if (process.env.SCREENSHOT) await popup.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
  await popup.click('#pageKeys button[data-command="toggle-auto"]');
  await popup.keyboard.press('Backspace');
  assert.equal(await popup.textContent('#pageKeys button[data-command="toggle-auto"]'), 'set');
  await sw.evaluate(() => chrome.storage.sync.set({ pageKeys: {} }));
  assert.deepEqual(popupErrors, []);
  await popup.close();
});

assert.deepEqual(errors, [], 'page errors');
console.log(`\n${passed} passed`);
await context.close();
