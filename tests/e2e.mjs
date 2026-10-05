// End-to-end test: loads the real extension in Chromium, serves mock Reddit/X pages and drives
// it through the background worker, the same path a (global) hotkey takes.
//   npm test            (HEADED=1 npm test to watch it)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Let context.route() also see requests made by the extension's background worker.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

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

// Fake redgifs embed: a looping video that doesn't autoplay (the scroller has to start it).
await context.route(/^https:\/\/www\.redgifs\.com\/ifr\//, (r) =>
  r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><body style="margin:0"><video id="v" loop muted src="https://media.test/clip.webm" style="width:100%"></video>
      <script>
        // MediaRecorder clips report no duration until read through once.
        v.onloadedmetadata = () => {
          if (Number.isFinite(v.duration)) return;
          v.currentTime = 1e9;
          v.ontimeupdate = () => { v.ontimeupdate = null; v.currentTime = 0; };
        };
      </script></body>`,
  }),
);

// Fake Reddit API for saving: logged in (or not), remembers what's saved, checks the modhash.
// legacyNoop: the old session endpoint answers OK but doesn't save (seen with the newer login).
const redditApi = { loggedIn: true, legacyNoop: false, saved: new Set(), calls: [] };
await context.route(/^https:\/\/www\.reddit\.com\/api\//, async (r) => {
  const url = new URL(r.request().url());
  const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  redditApi.calls.push(url.pathname);
  if (url.pathname === '/api/me.json') return json(redditApi.loggedIn ? { kind: 't2', data: { modhash: 'mh123' } } : {});
  if (url.pathname === '/api/info.json') {
    const id = url.searchParams.get('id');
    return json({ data: { children: [{ data: { name: id, saved: redditApi.saved.has(id) } }] } });
  }
  if (url.pathname === '/api/save' || url.pathname === '/api/unsave') {
    if (r.request().headers()['x-modhash'] !== 'mh123') return json({}, 403);
    if (redditApi.legacyNoop) return json({});
    const id = new URLSearchParams(r.request().postData()).get('id');
    if (url.pathname === '/api/save') redditApi.saved.add(id);
    else redditApi.saved.delete(id);
    return json({});
  }
  return json({}, 404);
});
// Reddit's OAuth API, used with the newer login's token_v2 cookie.
await context.route(/^https:\/\/oauth\.reddit\.com\/api\//, async (r) => {
  const url = new URL(r.request().url());
  const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (r.request().headers().authorization !== 'Bearer tok123') return json({}, 401);
  redditApi.calls.push(`oauth${url.pathname}`);
  if (url.pathname === '/api/info') {
    const id = url.searchParams.get('id');
    return json({ data: { children: [{ data: { name: id, saved: redditApi.saved.has(id) } }] } });
  }
  const id = new URLSearchParams(r.request().postData()).get('id');
  if (url.pathname === '/api/save') redditApi.saved.add(id);
  else if (url.pathname === '/api/unsave') redditApi.saved.delete(id);
  return json({});
});

const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
// The setup page opens on install and becomes the active tab; wait for it, then work in our own tab.
for (let i = 0; i < 50 && !context.pages().some((p) => p.url().endsWith('/popup/welcome.html')); i++) await wait(100);
const page = context.pages().find((p) => !p.url().startsWith('chrome-extension://')) ?? (await context.newPage());
await page.bringToFront();
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

await setSettings({ smooth: false, mediaOnly: true, delay: 6, pauseOnHover: true, videoWait: 60 });
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

await test('pause hotkeys: hotkeys and page keys step aside, the pause key brings them back', async () => {
  await setSettings({ smooth: false, pageKeys: { 'next-post': { code: 'ArrowDown' }, 'toggle-hotkeys': { code: 'KeyP' } } });
  await open('https://www.reddit.com/r/test/');
  const hotkey = (c) => sw.evaluate((c) => globalThis.onHotkey(c), c);
  assert.equal(await hotkey('toggle-hotkeys'), 'hotkeys paused');
  assert.equal(await hotkey('next-post'), 'paused, ignored');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+Shift+Digit2');
  await wait(600);
  assert.notEqual(await postAt('shreddit-post', 61), 'p0'); // the arrow key just scrolled the page natively
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), 'OFF');
  await page.keyboard.press('KeyP'); // the pause key itself keeps working
  await wait(300);
  assert.equal((await sw.evaluate(() => chrome.storage.local.get('hotkeysPaused'))).hotkeysPaused, false);
  await page.keyboard.press('ArrowDown');
  await wait(600);
  assert.equal(await postAt('shreddit-post', 61), 'p0');
  assert.equal(await hotkey('next-post'), 'sent');
  // While paused, a hotkey sitting on a browser shortcut does that shortcut's normal job.
  const action = (s) => sw.evaluate((s) => globalThis.browserShortcutAction(s), s);
  assert.equal(await action('Ctrl+W'), 'close-tab');
  assert.equal(await action('⌘W'), 'close-tab');
  assert.equal(await action('Ctrl+Shift+W'), 'close-window');
  assert.equal(await action('Ctrl+T'), 'new-tab');
  assert.equal(await action('Ctrl+A'), null);
  assert.equal(await action('Alt+W'), null);
  await setSettings({ pageKeys: {} });
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

await test('reddit: upvote, and save via the API or the "…" menu', async () => {
  await setSettings({ smooth: false });
  await open('https://www.reddit.com/r/test/');
  await cmd('next-post');
  await cmd('next-post'); // p2
  await wait(600);
  await cmd('upvote');
  assert.equal(await page.evaluate(() => document.querySelector('#p2').shadowRoot.querySelector('button[upvote]').getAttribute('aria-pressed')), 'true');
  assert.equal(await page.evaluate(() => document.querySelector('#p0').shadowRoot.querySelector('button[upvote]').getAttribute('aria-pressed')), 'false');
  await cmd('upvote'); // too soon after the last press on this post: ignored
  assert.equal(await page.evaluate(() => document.querySelector('#p2').shadowRoot.querySelector('button[upvote]').getAttribute('aria-pressed')), 'true');
  await wait(1600);
  await cmd('upvote');
  assert.equal(await page.evaluate(() => document.querySelector('#p2').shadowRoot.querySelector('button[upvote]').getAttribute('aria-pressed')), 'false');

  // Logged in: saved through Reddit's API, no menu involved.
  await cmd('save');
  await wait(500);
  assert.deepEqual([...redditApi.saved], ['t3_p2']);
  await wait(1600);
  await cmd('save'); // again: already saved, so it's left alone (no silent unsave)
  await wait(500);
  assert.deepEqual([...redditApi.saved], ['t3_p2']);
  assert.match(await sw.evaluate(async () => (await chrome.storage.session.get('lastSave')).lastSave.lines.join('\n')), /already saved, left as it is/);
  await cmd('save'); // pressed again right away: unsave
  await wait(500);
  assert.deepEqual([...redditApi.saved], []);

  // Scrolled back up by hand (the post we were on still peeks in at the bottom): save the post
  // that takes up most of the screen, not the one below.
  await page.evaluate(() => scrollBy(0, document.querySelector('#p2').getBoundingClientRect().top - (innerHeight - 80)));
  await wait(300);
  const mostVisible = await page.evaluate(() =>
    [...document.querySelectorAll('shreddit-post')]
      .map((el) => [el.id, Math.min(el.getBoundingClientRect().bottom, innerHeight) - Math.max(el.getBoundingClientRect().top, 61)])
      .sort((a, b) => b[1] - a[1])[0][0]);
  assert.notEqual(mostVisible, 'p2');
  await cmd('save');
  await wait(500);
  assert.deepEqual([...redditApi.saved], [`t3_${mostVisible}`]);
  redditApi.saved.clear();
  assert.equal(await page.getAttribute('#p2', 'data-saved'), null, 'menu should not have been used');

  // Newer login: the old endpoint says OK but doesn't save; the check notices and the token_v2
  // (OAuth) route saves it.
  redditApi.legacyNoop = true;
  await context.addCookies([{ name: 'token_v2', value: 'tok123', domain: '.reddit.com', path: '/' }]);
  await open('https://www.reddit.com/r/test/');
  await cmd('next-post');
  await cmd('next-post'); // p2
  await wait(600);
  redditApi.calls.length = 0;
  await cmd('save');
  await wait(800);
  assert.deepEqual([...redditApi.saved], ['t3_p2']);
  assert.ok(redditApi.calls.includes('oauth/api/save'), redditApi.calls.join(', '));
  assert.equal(await page.getAttribute('#p2', 'data-saved'), null, 'menu should not have been used');
  redditApi.saved.clear();
  redditApi.legacyNoop = false;
  await context.clearCookies();

  // API not available: falls back to the "…" menu, found by icon names (labels are Dutch here).
  redditApi.loggedIn = false;
  await open('https://www.reddit.com/r/test/');
  await cmd('next-post');
  await cmd('next-post'); // p2
  await wait(600);
  await cmd('save');
  await wait(800);
  assert.equal(await page.getAttribute('#p2', 'data-saved'), '1');
  await wait(1600); // cooldown after a save that worked
  await cmd('save'); // already saved: left alone
  await wait(2000);
  assert.equal(await page.getAttribute('#p2', 'data-saved'), '1');
  await cmd('save'); // pressed again right away: unsave
  await wait(2000);
  assert.equal(await page.getAttribute('#p2', 'data-saved'), null);
  assert.equal(await page.evaluate(() => document.querySelector('#p2').shadowRoot.querySelector('ul').children.length), 0, 'menu closed');
  const report = () => sw.evaluate(async () => (await chrome.storage.session.get('lastSave')).lastSave?.lines.join('\n') ?? '');
  assert.match(await report(), /old login: not available[\s\S]*new login: token_v2 cookie not readable[\s\S]*menu: clicking[\s\S]*result: Unsaved/);

  // A menu that ignores the extension's clicks: no fake "Saved", and the report says why.
  await page.evaluate(() => (window.ignoreScriptClicks = true));
  await wait(1600);
  await cmd('save');
  await wait(2500);
  assert.equal(await page.getAttribute('#p2', 'data-saved'), null);
  assert.match(await report(), /didn't change, so Reddit ignored the click[\s\S]*result: not saved/);
  assert.equal(await page.evaluate(() => document.querySelector('#p2').shadowRoot.querySelector('ul').children.length), 0, 'menu closed again');
  redditApi.loggedIn = true;
});

await test('reddit: looping videos play through once, up to the "let videos play" limit', async () => {
  await open('https://www.reddit.com/r/test/');
  await page.evaluate(async () => {
    const v = Object.assign(document.createElement('video'), { muted: true, loop: true, src: 'https://media.test/clip.webm' });
    document.querySelector('#p2').append(v);
    await new Promise((r) => (v.onloadedmetadata = r));
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9;
      await new Promise((r) => (v.ontimeupdate = r));
      v.currentTime = 0;
    }
  });
  const duration = await page.evaluate(() => document.querySelector('#p2 video').duration);
  // Time spent on p2 with a 1s delay.
  async function timeOnP2() {
    await open('https://www.reddit.com/r/test/');
    await page.evaluate(async () => {
      const v = Object.assign(document.createElement('video'), { muted: true, loop: true, src: 'https://media.test/clip.webm' });
      document.querySelector('#p2').append(v);
      await new Promise((r) => (v.onloadedmetadata = r));
      if (!Number.isFinite(v.duration)) {
        v.currentTime = 1e9;
        await new Promise((r) => (v.ontimeupdate = r));
        v.currentTime = 0;
      }
    });
    await cmd('next-post'); // p0
    await wait(600);
    await cmd('toggle-auto');
    let arrived = 0;
    for (let i = 0; i < 200; i++) {
      const at = await postAt('shreddit-post', 61);
      if (at === 'p2' && !arrived) arrived = Date.now();
      if (arrived && at !== 'p2') break;
      await wait(100);
    }
    await cmd('toggle-auto');
    return (Date.now() - arrived) / 1000;
  }
  await setSettings({ delay: 1, videoWait: -1, flipGalleries: false }); // p2 is also a gallery
  const whole = await timeOnP2();
  assert.ok(whole >= duration - 0.3 && whole < duration + 2.5, `whole video: stayed ${whole}s for a ${duration}s clip`);
  await setSettings({ videoWait: 2 });
  const capped = await timeOnP2();
  assert.ok(capped >= 1.7 && capped < 3.5, `2s limit: stayed ${capped}s`);
  await setSettings({ videoWait: 0 });
  const off = await timeOnP2();
  assert.ok(off < 2, `off: stayed ${off}s`);
  await setSettings({ videoWait: 60, flipGalleries: true });
});

await test('reddit: redgifs embeds count as videos: started, and waited for', async () => {
  await setSettings({ delay: 1, videoWait: -1, flipGalleries: false, smooth: false });
  await open('https://www.reddit.com/r/test/');
  await page.evaluate(() => {
    const embed = document.createElement('shreddit-embed');
    embed.innerHTML = '<iframe src="https://www.redgifs.com/ifr/abc" style="width:400px;height:220px;border:0"></iframe>';
    document.querySelector('#p2').append(embed);
  });
  await wait(1500); // let the embed load its clip
  const frame = page.frames().find((f) => f.url().includes('redgifs.com/ifr'));
  const duration = await frame.evaluate(() => v.duration);
  assert.equal(await frame.evaluate(() => v.paused), true);
  await cmd('next-post'); // p0
  await wait(600);
  await cmd('toggle-auto');
  let arrived = 0;
  let wasPlaying = false;
  for (let i = 0; i < 200; i++) {
    const at = await postAt('shreddit-post', 61);
    if (at === 'p2' && !arrived) arrived = Date.now();
    if (arrived && at === 'p2' && !(await frame.evaluate(() => v.paused))) wasPlaying = true;
    if (arrived && at !== 'p2') break;
    await wait(100);
  }
  const stayed = (Date.now() - arrived) / 1000;
  await cmd('toggle-auto');
  assert.equal(wasPlaying, true, 'redgifs video should have been started');
  assert.ok(stayed >= duration - 0.3 && stayed < duration + 2.5, `stayed ${stayed}s for a ${duration}s redgifs clip`);

  // Already playing partway through when we arrive: only the rest is waited for.
  await cmd('previous-post'); // back to p2
  await wait(600);
  await frame.evaluate(() => { v.currentTime = v.duration - 1.5; return v.play(); }); // as if the site started it
  await cmd('toggle-auto');
  let arrived2 = 0;
  for (let i = 0; i < 200; i++) {
    const at = await postAt('shreddit-post', 61);
    if (at === 'p2' && !arrived2) arrived2 = Date.now();
    if (arrived2 && at !== 'p2') break;
    await wait(100);
  }
  const stayed2 = (Date.now() - arrived2) / 1000;
  await cmd('toggle-auto');
  // The clip's position at arrival varies, but it must move on within one play-through, not loop forever.
  assert.ok(stayed2 < duration + 2, `stayed ${stayed2}s for a ${duration}s clip that was already playing`);
  await wait(300);
  assert.equal(await frame.evaluate(() => v.paused), true, 'paused after moving on');
  await setSettings({ videoWait: 60, flipGalleries: true, delay: 6 });
});

await test('reddit: open / close picture key opens the gallery in the full-screen viewer', async () => {
  await setSettings({ smooth: false, delay: 6 });
  await open('https://www.reddit.com/r/test/');
  await cmd('next-post');
  await cmd('next-post'); // p2 (gallery)
  await wait(600);
  await cmd('open-media');
  await wait(300);
  assert.equal(await page.locator('#lightbox').count(), 1);
  await cmd('next-image');
  await wait(500);
  assert.equal(await page.getAttribute('#lightbox', 'data-index'), '1');
  await cmd('open-media'); // closes it again
  await wait(300);
  assert.equal(await page.locator('#lightbox').count(), 0);
});

await test('reddit: auto-scroll closes a picture you opened yourself before moving on', async () => {
  await setSettings({ smooth: false, delay: 1, fullscreen: false, flipGalleries: true, videoWait: 0 });
  await open('https://www.reddit.com/r/test/');
  await cmd('next-post'); // p0
  await wait(600);
  await cmd('open-media'); // opened by hand (full-screen mode off)
  await wait(300);
  assert.equal(await page.locator('#lightbox').count(), 1);
  await cmd('toggle-auto');
  await wait(2200);
  await cmd('toggle-auto');
  assert.equal(await page.locator('#lightbox').count(), 0, 'viewer should be closed');
  assert.equal(await postAt('shreddit-post', 61), 'p2', 'moved exactly one post, visibly');

  await cmd('open-media');
  await wait(300);
  await cmd('next-post'); // the manual key closes it too
  await wait(800);
  assert.equal(await page.locator('#lightbox').count(), 0);
  assert.equal(await postAt('shreddit-post', 61), 'p4');
  await setSettings({ delay: 6, videoWait: 60 });
});

await test('reddit: full-screen auto-scroll opens each post, flips through it, closes it and moves on; manual keys stay in the feed', async () => {
  await setSettings({ smooth: false, delay: 1, fullscreen: true, flipGalleries: true, videoWait: 0 });
  await open('https://www.reddit.com/r/test/');
  const viewer = () => page.evaluate(() => {
    const box = document.getElementById('lightbox');
    return box ? `${box.dataset.post}:${box.dataset.index}` : null;
  });

  await cmd('next-post'); // by hand: full-screen mode does nothing, just the feed
  await wait(1000);
  assert.equal(await viewer(), null);
  assert.equal(await postAt('shreddit-post', 61), 'p0');

  await cmd('toggle-auto'); // auto-scroll: opens the current post first
  const seen = [];
  for (let i = 0; i < 150 && !seen.includes('p5:0'); i++) {
    const v = (await viewer()) ?? `feed:${await postAt('shreddit-post', 61)}`;
    if (seen.at(-1) !== v) seen.push(v);
    await wait(100);
  }
  await cmd('toggle-auto');
  // p0 (1 image) → p2 (gallery, 3 images) → p4 (video player, nothing to open: feed view) → p5
  const expected = ['p0:0', 'p2:0', 'p2:1', 'p2:2', 'feed:p4', 'p5:0'];
  const steps = seen.filter((v) => expected.includes(v));
  assert.deepEqual(steps, expected, seen.join(' → '));

  await cmd('previous-post'); // by hand: closes the viewer, goes back, doesn't open anything
  await wait(1200);
  assert.equal(await viewer(), null);
  assert.equal(await postAt('shreddit-post', 61), 'p4');
  await cmd('toggle-fullscreen'); // turning it off leaves the feed as it is
  await setSettings({ fullscreen: false, delay: 6, videoWait: 60 });
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

await test("x: starts videos X didn't start (without clicking X's buttons), play/pause key; videos never open", async () => {
  await open('https://x.com/home');
  const playing = (id) => page.evaluate((id) => {
    const v = document.querySelector(`#${id} video`);
    return v ? !v.paused : null;
  }, id);
  await cmd('next-post'); // t0
  await cmd('next-post'); // t2: a <video> X didn't start
  await wait(1800);
  assert.equal(await postAt('article', 54), 't2');
  assert.equal(await playing('t2'), true, 'should have been started');
  await cmd('toggle-video');
  await wait(200);
  assert.equal(await playing('t2'), false, 'play/pause key pauses');
  await cmd('toggle-video');
  await wait(300);
  assert.equal(await playing('t2'), true, 'and plays again');
  await cmd('next-post'); // t3: only X's play button, no <video> yet
  await wait(1800);
  assert.equal(await playing('t2'), false, 'previous video paused when moving on');
  assert.equal(await playing('t3'), null, "X's play button must not be clicked");
  await cmd('open-media'); // a video: refuse instead of opening the post page
  await wait(400);
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.locator('#viewer').count(), 0);
  await cmd('previous-post');
  await cmd('previous-post'); // back to t0
  await wait(800);
});

await test('x: open / close picture key opens the photo viewer, slides flip inside it', async () => {
  await cmd('open-media');
  await wait(300);
  assert.equal(await page.locator('#viewer').count(), 1);
  await cmd('next-image');
  await wait(300);
  assert.equal(await page.getAttribute('#viewer', 'data-slide'), '1');
  await cmd('previous-image');
  await wait(300);
  assert.equal(await page.getAttribute('#viewer', 'data-slide'), '0');
  await cmd('open-media');
  await wait(300);
  assert.equal(await page.locator('#viewer').count(), 0);
});

await test('x: like and bookmark the current tweet', async () => {
  await cmd('upvote');
  await cmd('save');
  const current = await postAt('article', 54);
  assert.equal(await page.locator(`#${current} [data-testid="unlike"]`).count(), 1);
  assert.equal(await page.locator(`#${current} [data-testid="removeBookmark"]`).count(), 1);
  assert.equal(await page.locator('[data-testid="unlike"]').count(), 1);
  await wait(1600); // presses on the same post within 1.5s are ignored
  await cmd('upvote');
  assert.equal(await page.locator('[data-testid="unlike"]').count(), 0);
  await wait(1600);
  await cmd('upvote');
  await cmd('upvote'); // spammed: only the first one counts
  assert.equal(await page.locator('[data-testid="unlike"]').count(), 1);
  await wait(1600);
  await cmd('upvote');
});

// ---------------------------------------------------------------- old Reddit

await test('old reddit: walks the listing, skips self/promoted posts, then opens the next page', async () => {
  await open('https://old.reddit.com/r/test/');
  await expectSequence('.thing', 4, ['pg1-0', 'pg1-2']);
  await cmd('upvote');
  await cmd('save');
  assert.equal(await page.locator('#pg1-2 .arrow.upmod').count(), 1);
  assert.equal(await page.textContent('#pg1-2 .save-button a'), 'unsave');
  assert.equal(await page.locator('.arrow.upmod').count(), 1);
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

await test('setup page opened on install lists the hotkeys', async () => {
  const welcome = context.pages().find((p) => p.url().endsWith('/popup/welcome.html'));
  assert.ok(welcome, 'welcome page should open on first install');
  const keys = await welcome.$$eval('#shortcuts li', (lis) => lis.map((li) => li.textContent));
  assert.ok(keys.some((k) => k.includes('Next post') && k.includes('Ctrl+Shift+2')), keys.join(' | '));
});

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
  // The hotkey path (what a global hotkey triggers) records what happened for the panel.
  await sw.evaluate(() => globalThis.onHotkey('next-post'));
  await wait(300);
  assert.match(await popup.textContent('#lastHotkey'), /next-post, \d+s ago → no Reddit\/X tab showing/);
  assert.deepEqual(popupErrors, []);
  await popup.close();
});

assert.deepEqual(errors, [], 'page errors');
console.log(`\n${passed} passed`);
await context.close();
