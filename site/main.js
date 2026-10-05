// Chrome Web Store page. Paste the listing URL here once it's live; until then the "Add to Chrome"
// buttons fall back to the GitHub release download.
const STORE_URL = 'https://chromewebstore.google.com/detail/oblelonljmpblebbampfpilblmeobdgb';
const RELEASE_URL = 'https://github.com/PonyGShock/GoonScroller/releases/latest';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- store links ----------

for (const a of $$('[data-store]')) {
  a.href = STORE_URL || RELEASE_URL;
  a.target = '_blank';
  a.rel = 'noopener';
  if (!STORE_URL && a.dataset.zipLabel) a.textContent = a.dataset.zipLabel;
}
for (const el of $$('[data-store-only]')) el.hidden = !STORE_URL;
for (const el of $$('[data-zip-only]')) el.hidden = !!STORE_URL;

// ---------- demo feed ----------

const SITES = {
  reddit: {
    name: 'Reddit',
    url: 'reddit.com',
    users: ['r/EarthPics', 'r/wallpapers', 'r/itookapicture', 'r/CozyPlaces', 'r/oddlysatisfying', 'r/gaming', 'r/aww', 'r/SkyPics'],
    meta: () => `${2 + Math.floor(Math.random() * 20)}h`,
    actions: ['⬆ Upvote', '💬 Comments', '🔖 Save'],
  },
  x: {
    name: 'X',
    url: 'x.com',
    users: ['@skylinesdaily', '@cozyvibes', '@clipsofgames', '@sunsetsonly', '@wallpaperbot', '@satisfying'],
    meta: () => `${1 + Math.floor(Math.random() * 59)}m`,
    actions: ['♥ Like', '↻ Repost', '🔖 Bookmark'],
  },
};

const PALETTES = [
  { sky: 'linear-gradient(#ff9a8b, #ff6a88)', sun: '#ffe29a', hill: '#3a1c4a' },
  { sky: 'linear-gradient(#5ee7df, #3b82f6)', sun: '#fef9c3', hill: '#123a5a' },
  { sky: 'linear-gradient(#fbc2eb, #a18cd1)', sun: '#fff1f2', hill: '#3b2a63' },
  { sky: 'linear-gradient(#f6d365, #fda085)', sun: '#fffbeb', hill: '#7c2d12' },
  { sky: 'linear-gradient(#0f172a, #4c1d95)', sun: '#e0e7ff', hill: '#020617' },
  { sky: 'linear-gradient(#84fab0, #8fd3f4)', sun: '#fefce8', hill: '#14532d' },
  { sky: 'linear-gradient(#ff4f6d, #ffb199)', sun: '#fff7ed', hill: '#4a044e' },
];

const TITLES = [
  'Caught this on my walk home',
  'Golden hour hit different today',
  'My setup after 3 years of tweaking',
  'Not edited, I promise',
  'This view at 6am was worth it',
  'Found this spot by accident',
  'Rate my wallpaper',
  'The colors tonight 🤯',
];
const TEXT_TITLES = ['Anyone else think…? (long text post)', 'Discussion thread: what are you playing?', 'Unpopular opinion, hear me out'];

// Kinds of posts in the loop. Text posts are skipped, like "images & videos only" does.
const PATTERN = ['image', 'gallery', 'text', 'image', 'video', 'image', 'text', 'gallery', 'image', 'video'];

const feed = $('#feed');
const demo = $('#demo');
const screen = $('.screen', demo);
const head = $('#demoHead');
let siteKey = 'reddit';
let posts = []; // { el, kind, slides, slide }
let current = -1;
let made = 0;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makePost(kind) {
  const site = SITES[siteKey];
  const el = document.createElement('article');
  el.className = `post ${kind}`;
  const avatarColor = PALETTES[made % PALETTES.length];
  const top = `<div class="post-top"><span class="avatar" style="background:${avatarColor.sky}"></span>
    <span class="post-name">${pick(site.users)}</span><span class="post-meta">· ${site.meta()}</span>
    <span class="skip-tag">skipped · text only</span></div>`;
  let body = '';
  let slides = 1;
  if (kind === 'text') {
    el.innerHTML = `${top}<div class="post-title">${pick(TEXT_TITLES)}</div>`;
  } else {
    slides = kind === 'gallery' ? 3 : 1;
    const h = kind === 'video' ? 200 : 210 + ((made * 37) % 90);
    const slideHtml = Array.from({ length: slides }, (_, i) => {
      const p = PALETTES[(made + i * 2) % PALETTES.length];
      return `<div class="slide" style="background:${p.sky};--sun:${p.sun};--hill:${p.hill};--sun-x:${20 + ((made * 23 + i * 31) % 55)}%"></div>`;
    }).join('');
    if (kind === 'gallery') {
      body = `<div class="count">1/${slides}</div><div class="dots">${'<i></i>'.repeat(slides)}</div>`;
    } else if (kind === 'video') {
      body = '<div class="play">▶</div><div class="vbar"><div class="vfill"></div></div>';
    }
    el.innerHTML = `${top}<div class="post-title">${pick(TITLES)}</div>
      <div class="media" style="height:${h}px"><div class="slides">${slideHtml}</div>${body}</div>
      <div class="actions">${site.actions.map((a) => `<span>${a}</span>`).join('')}</div>`;
  }
  made++;
  feed.append(el);
  const post = { el, kind, slides, slide: 0 };
  posts.push(post);
  updateGallery(post);
  return post;
}

function ensurePosts(upTo) {
  while (posts.length <= upTo + 3) makePost(PATTERN[made % PATTERN.length]);
}

function updateGallery(post) {
  if (post.kind !== 'gallery') return;
  $('.slides', post.el).style.transform = `translateX(${-post.slide * 100}%)`;
  $('.count', post.el).textContent = `${post.slide + 1}/${post.slides}`;
  $$('.dots i', post.el).forEach((d, i) => d.classList.toggle('on', i === post.slide));
}

const isMedia = (p) => p.kind !== 'text';

function scrollToPost(i) {
  ensurePosts(i);
  const prev = posts[current];
  if (prev) {
    prev.el.classList.remove('current', 'playing');
    stopVideo(prev);
  }
  current = i;
  const post = posts[i];
  post.el.classList.add('current');
  feed.style.transform = `translateY(${-(post.el.offsetTop - 44)}px)`;
  // Keep the DOM small: drop posts far above once we're deep in the feed.
  if (current > 12) recycle();
}

function recycle() {
  const drop = posts.splice(0, 6);
  drop.forEach((p) => p.el.remove());
  current -= 6;
  feed.style.transition = 'none';
  feed.style.transform = `translateY(${-(posts[current].el.offsetTop - 44)}px)`;
  void feed.offsetWidth;
  feed.style.transition = '';
}

// Move to the next/previous media post, flagging the text posts we jump over.
function move(dir) {
  let i = current + dir;
  if (i < 0) return toast('Top of the page');
  ensurePosts(i + 1);
  while (posts[i] && !isMedia(posts[i])) {
    const skipped = posts[i].el;
    skipped.classList.add('skipped');
    setTimeout(() => skipped.classList.remove('skipped'), 1400);
    i += dir;
    if (i < 0) return toast('Top of the page');
  }
  scrollToPost(i);
  const post = posts[i];
  if (post.kind === 'video') startVideo(post);
  return post;
}

function flip(dir) {
  const post = posts[current];
  if (post?.kind !== 'gallery') return false;
  const next = post.slide + dir;
  if (next < 0 || next >= post.slides) return false;
  post.slide = next;
  updateGallery(post);
  return true;
}

// ---------- video ----------

const VIDEO_MS = 4200;
function startVideo(post) {
  post.el.classList.add('playing');
  const fill = $('.vfill', post.el);
  fill.style.transition = 'none';
  fill.style.width = '0%';
  void fill.offsetWidth;
  fill.style.transition = `width ${VIDEO_MS}ms linear`;
  fill.style.width = '100%';
  post.videoEnds = performance.now() + VIDEO_MS;
}

function stopVideo(post) {
  if (post.kind !== 'video') return;
  const fill = $('.vfill', post.el);
  fill.style.transition = 'none';
  fill.style.width = getComputedStyle(fill).width;
}

// ---------- HUD ----------

const toastEl = $('#toast');
const pill = $('#pill');
const pillLabel = $('#pillLabel');
const pillFill = $('#pillFill');
let toastTimer = 0;

function toast(text, ms = 1300) {
  clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function countdown(text, ms) {
  pill.className = 'pill';
  pillLabel.textContent = text;
  pillFill.style.transition = 'none';
  pillFill.style.width = '0%';
  void pillFill.offsetWidth;
  pillFill.style.transition = `width ${ms}ms linear`;
  pillFill.style.width = '100%';
}

function pausedPill(text) {
  pill.className = 'pill paused';
  pillLabel.textContent = text;
  pillFill.style.transition = 'none';
}

const keyPop = $('#keyPop');
function showKeys(...keys) {
  keyPop.innerHTML = keys.map((k) => `<kbd>${k}</kbd>`).join('');
  keyPop.classList.remove('show');
  void keyPop.offsetWidth;
  keyPop.classList.add('show');
}

// ---------- auto-scroll loop ----------

const DELAY = 2600;
let auto = true;
let hovering = false;
let holdUntil = 0; // manual input pauses auto for a moment (touch screens have no hover)
let timer = 0;
let loops = 0;

function schedule(ms, label) {
  clearTimeout(timer);
  if (!auto) return;
  if (hovering) return pausedPill('Paused · mouse on page');
  countdown(label, ms);
  timer = setTimeout(tick, ms);
}

function tick() {
  if (!auto) return;
  if (hovering) return pausedPill('Paused · mouse on page');
  const wait = holdUntil - performance.now();
  if (wait > 0) return schedule(wait, 'Auto · resuming');
  const post = posts[current];
  if (post?.kind === 'video' && post.videoEnds > performance.now() + 50) {
    return schedule(post.videoEnds - performance.now(), 'Video · letting it play');
  }
  if (flip(1)) {
    showKeys('Auto', 'next image');
    return schedule(DELAY, 'Auto · next image');
  }
  const next = move(1);
  showKeys('Auto', 'next post');
  // Swap between Reddit and X every so often, to show both.
  if (++loops % 9 === 0) switchSite();
  if (next?.kind === 'video') return schedule(VIDEO_MS, 'Video · letting it play');
  schedule(DELAY, next?.kind === 'gallery' ? 'Auto · gallery' : 'Auto · every 3s');
}

function setAuto(on) {
  auto = on;
  const btn = $('#autoBtn');
  btn.classList.toggle('on', on);
  btn.textContent = on ? '❚❚ Auto' : '▶ Auto';
  if (on) {
    toast('Auto-scroll on · every 3s');
    schedule(DELAY, 'Auto · every 3s');
  } else {
    clearTimeout(timer);
    pill.className = 'pill off';
    toast('Auto-scroll off');
  }
}

function switchSite() {
  siteKey = siteKey === 'reddit' ? 'x' : 'reddit';
  const site = SITES[siteKey];
  $('#demoSite').textContent = site.name;
  $('#demoUrl').textContent = site.url;
  head.classList.toggle('x', siteKey === 'x');
  // Posts already loaded below keep their look; new ones use the new site.
  for (const p of posts.slice(current + 1)) p.el.remove();
  posts = posts.slice(0, current + 1);
}

// ---------- input ----------

const ACTIONS = {
  next: () => (showKeys('↓'), move(1)),
  prev: () => (showKeys('↑'), move(-1)),
  nextImg: () => {
    showKeys('→');
    if (!flip(1)) move(1);
  },
  prevImg: () => {
    showKeys('←');
    if (!flip(-1)) move(-1);
  },
  auto: () => setAuto(!auto),
};

function act(name) {
  ACTIONS[name]();
  if (name !== 'auto') {
    holdUntil = performance.now() + 4000;
    if (auto && !hovering) schedule(4000, 'Auto · resuming');
  }
  const btn = $(`.demo-controls [data-act="${name}"]`);
  btn?.classList.add('press');
  setTimeout(() => btn?.classList.remove('press'), 120);
}

$$('.demo-controls button').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));

const KEYMAP = { ArrowDown: 'next', ArrowUp: 'prev', ArrowRight: 'nextImg', ArrowLeft: 'prevImg', Space: 'auto' };

demo.addEventListener('mouseenter', () => {
  hovering = true;
  demo.classList.add('hover');
  if (auto) {
    clearTimeout(timer);
    pausedPill('Paused · mouse on page');
  }
});
demo.addEventListener('mouseleave', () => {
  hovering = false;
  demo.classList.remove('hover');
  if (auto) schedule(DELAY, 'Auto · every 3s');
});

document.addEventListener('keydown', (e) => {
  const name = KEYMAP[e.code];
  if (!name || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!hovering && document.activeElement !== demo) return;
  e.preventDefault();
  act(name);
});

// ---------- hotkey list ----------

// Pre-set keys show as they are; every other slot is open. Hovering a slot flips through
// example keys, to show you can pick anything.
const isMac = /Mac/.test(navigator.platform);
const EXAMPLES = ['Alt Q', 'F8', 'Ctrl ↓', 'Alt Shift S', '→', 'Ctrl Space', 'Alt 1', 'F2', 'Ctrl Shift L', 'Alt E'];
const keysHtml = (keys) => keys.split(' ').map((k) => `<b>${k}</b>`).join('');

for (const [i, action] of $$('.action').entries()) {
  const slot = $('.slot', action);
  const preset = isMac ? action.dataset.mac : action.dataset.default;
  const rest = () => {
    slot.classList.toggle('open', !preset);
    slot.innerHTML = preset ? keysHtml(preset) : 'your key';
  };
  rest();
  action.style.setProperty('--i', i);
  let timer = 0;
  let n = i;
  const spin = () => {
    slot.classList.remove('open');
    slot.classList.remove('flip');
    void slot.offsetWidth;
    slot.classList.add('flip');
    slot.innerHTML = keysHtml(EXAMPLES[n++ % EXAMPLES.length]);
  };
  action.addEventListener('mouseenter', () => {
    spin();
    timer = setInterval(spin, 650);
  });
  action.addEventListener('mouseleave', () => {
    clearInterval(timer);
    slot.classList.remove('flip');
    rest();
  });
}

// ---------- reveal on scroll ----------

$$('.grid .feat').forEach((f, i) => f.style.setProperty('--i', i));
$$('.after .scroll-sim li').forEach((li, i) => li.style.setProperty('--i', i));

const io = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      io.unobserve(en.target);
    }
  },
  { threshold: 0.15 },
);
$$('.reveal').forEach((el) => io.observe(el));

// Only animate the demo while it's on screen.
new IntersectionObserver(([en]) => {
  if (!auto) return;
  if (en.isIntersecting) schedule(DELAY, 'Auto · every 3s');
  else clearTimeout(timer);
}).observe(screen);

// ---------- start ----------

ensurePosts(4);
let first = 0;
while (!isMedia(posts[first])) first++;
scrollToPost(first);
if (reduceMotion) setAuto(false);
else schedule(DELAY, 'Auto · every 3s');
