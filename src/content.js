// GoonScroller content script (Reddit + X).
// Finds the posts on the page and lines them up, one at a time, right under the site's sticky header.
(() => {
  'use strict';

  // Re-injection guard. After the extension is reloaded the old copy is orphaned, so replace it.
  const previous = window.__goonScroller;
  if (previous?.alive()) return;
  previous?.destroy();

  const { DEFAULTS, DELAY_STEPS, nearestStep, formatDelay } = globalThis.GoonShared;

  const TOL = 6; // px a post must sit past the current position to count as the next one
  const SNAP = 30; // px within which the post we last scrolled to still counts as "current"
  const LOAD_TIMEOUT = 6000; // ms to wait for the feed to load more posts
  const MAX_VIDEO_WAIT = 30000; // ms, cap for "wait for videos"
  const HOVER_STALE = 60000; // ms without mouse movement before hovering stops pausing auto mode
  const RESUME_KEY = 'goonscroller:resume-auto';
  // Gallery arrows are matched by their (possibly translated) label, or by a slot name.
  const NEXT_IMAGE = /\b(next|volgende|weiter|nächste|suivant|siguiente|próximo|successiv)/i;
  const PREV_IMAGE = /\b(prev|previous|vorige|zurück|vorherige|précédent|anterior|back)/i;
  const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'j', 'k']);

  // ------------------------------------------------------------------ sites

  const X_MEDIA = [
    '[data-testid="tweetPhoto"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]',
    'video',
    'img[src*="pbs.twimg.com/media/"]',
    'img[src*="video_thumb"]',
  ].join(',');

  const REDDIT_MEDIA_TYPES = new Set(['image', 'gallery', 'video', 'multi_media', 'gif']);
  const REDDIT_MEDIA = [
    'shreddit-player',
    'shreddit-player-2',
    'shreddit-embed',
    'gallery-carousel',
    'video',
    'iframe',
    'img.media-lightbox-img',
    '[slot="post-media-container"] img',
  ].join(',');

  const SITES = [
    {
      name: 'X',
      host: /(^|\.)(x|twitter)\.com$/,
      gap: 0,
      posts: () => document.querySelectorAll('article[data-testid="tweet"]'),
      hasMedia: (el) => !!el.querySelector(X_MEDIA),
    },
    {
      name: 'Reddit',
      host: /(^|\.)reddit\.com$/,
      gap: 4,
      posts: () => {
        const modern = document.querySelectorAll('shreddit-post');
        if (modern.length) return modern;
        return document.querySelectorAll('.linklisting > .thing.link:not(.promoted)'); // old.reddit
      },
      hasMedia: (el) => {
        if (el.localName === 'shreddit-post') {
          const type = (el.getAttribute('post-type') || '').toLowerCase();
          return REDDIT_MEDIA_TYPES.has(type) || !!el.querySelector(REDDIT_MEDIA);
        }
        // old.reddit: everything except text ("self.") posts links to an image, gif or video
        return !(el.dataset.domain || '').startsWith('self.');
      },
      // old.reddit has pages instead of infinite scroll
      nextPage: () => document.querySelector('.nav-buttons .next-button a[href]'),
    },
  ];

  // ------------------------------------------------------------------ upvote / like, save / bookmark

  const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim();
  const findIn = (root, selector, test) => deepQueryAll(root, selector).find(test) ?? null;
  const BUTTONS = 'button, [role="button"], [role="menuitem"], a, li';
  const SAVE_LABEL = /^(save|unsave|remove from saved|opslaan|niet meer opslaan|verwijderen uit opgeslagen)$/i;
  const SAVED_LABEL = /unsave|remove|niet meer|verwijderen/i;

  // Each returns { el, on } for the post: the control to click and whether it's already active.
  const ACTIONS = {
    X: {
      upvote: (post) => {
        const el = post.querySelector('[data-testid="like"], [data-testid="unlike"]');
        return el && { el, on: el.dataset.testid === 'unlike', words: ['Liked', 'Like removed'] };
      },
      save: (post) => {
        const el = post.querySelector('[data-testid="bookmark"], [data-testid="removeBookmark"]');
        return el && { el, on: el.dataset.testid === 'removeBookmark', words: ['Bookmarked', 'Bookmark removed'] };
      },
    },
    Reddit: {
      upvote: (post) => {
        const words = ['Upvoted', 'Upvote removed'];
        const old = post.querySelector('.midcol .arrow.up, .midcol .arrow.upmod');
        if (old) return { el: old, on: old.classList.contains('upmod'), words };
        const el = findIn(post, 'button', (b) => b.hasAttribute('upvote') || /^(upvote|stem omhoog)/i.test(b.getAttribute('aria-label') || ''));
        return el && { el, on: el.getAttribute('aria-pressed') === 'true', words };
      },
      save: async (post) => {
        const words = ['Saved', 'Unsaved'];
        const old = post.querySelector('.save-button a, a.save-button');
        if (old) return { el: old, on: /unsave/i.test(old.textContent), words };
        // New Reddit keeps "Save" in the post's "…" menu, which may need opening first.
        const find = (root) => findIn(root, BUTTONS, (b) => SAVE_LABEL.test(labelOf(b)));
        let el = find(post);
        if (!el) {
          const menu = findIn(post, 'button', (b) => /overflow|more options|meer opties|open user actions/i.test(b.getAttribute('aria-label') || ''));
          if (!menu) return null;
          menu.click();
          for (let i = 0; i < 10 && !el; i++) {
            await sleep(100);
            el = find(post) ?? find(document);
          }
        }
        return el && { el, on: SAVED_LABEL.test(labelOf(el)), words };
      },
    },
  };

  async function postAction(kind) {
    const post = currentPost();
    const control = post && (await ACTIONS[site?.name]?.[kind]?.(post));
    if (!control) return hud.toast(kind === 'upvote' ? 'No upvote/like button found' : 'No save button found');
    control.el.click();
    hud.toast(control.on ? control.words[1] : control.words[0]);
  }

  const site = SITES.find((s) => s.host.test(location.hostname)) ?? null;

  // ------------------------------------------------------------------ state

  let settings = { ...DEFAULTS };
  let cursor = null; // the post we last scrolled to
  let inFlight = false; // our own smooth scroll is still running
  let navToken = 0; // bumped by every navigation and user scroll; cancels stale follow-ups
  let arrivedAt = 0;
  let videoExtended = false;
  let loading = false;
  let auto = false;
  let autoTimer = 0;
  let pausedByMouse = false;
  let mouseInside = false;
  let lastMouseMove = 0;
  let lastUserRestart = 0;

  const ac = new AbortController();
  const listen = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const maxScroll = () => (document.scrollingElement || document.documentElement).scrollHeight - innerHeight;
  const behavior = () => (settings.smooth ? 'smooth' : 'instant');

  const hud = createHud();

  // ------------------------------------------------------------------ geometry

  function collectPosts() {
    if (!site) return [];
    const y = scrollY;
    const all = [];
    for (const el of site.posts()) {
      const rect = el.getBoundingClientRect();
      if (rect.height < 4 || rect.width < 4) continue;
      all.push({ el, rect, top: rect.top + y });
    }
    all.sort((a, b) => a.top - b.top);
    if (!settings.mediaOnly) return all;
    const media = all.filter((p) => site.hasMedia(p.el));
    return media.length ? media : all; // nothing with media loaded at all: don't get stuck
  }

  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function stickyAncestor(el) {
    for (; el && el !== document.body && el !== document.documentElement; ) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') return el;
      el = el.parentElement || el.getRootNode().host || null;
    }
    return null;
  }

  // Bottom edge of whatever sticky/fixed bars cover the top of the post column.
  function headerBottom(x, minWidth) {
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const bar = stickyAncestor(deepElementFromPoint(x, y + 1));
      if (!bar) break;
      const r = bar.getBoundingClientRect();
      if (r.top > y + 2 || r.bottom <= y + 1 || r.height > innerHeight * 0.4 || r.width < minWidth) break;
      y = r.bottom;
    }
    return y;
  }

  // The line (px from the top of the viewport) where the top of a post should land.
  function anchorAt(rect) {
    const x = rect ? clamp(rect.left + rect.width / 2, 1, innerWidth - 1) : innerWidth / 2;
    const minWidth = rect ? rect.width * 0.6 : innerWidth * 0.3;
    return headerBottom(x, minWidth) + (site?.gap ?? 0);
  }

  // Document position we navigate from: the post we last moved to if it's still where we left
  // it (or still on its way there), otherwise whatever is currently at the anchor line.
  function currentBase(anchor) {
    if (cursor?.isConnected) {
      const r = cursor.getBoundingClientRect();
      if (r.height > 0) {
        const atBottom = scrollY >= maxScroll() - 2;
        if (inFlight || Math.abs(r.top - anchor) <= SNAP || (atBottom && r.top > anchor && r.top < innerHeight)) {
          return r.top + scrollY;
        }
      }
    }
    return scrollY + anchor;
  }

  // ------------------------------------------------------------------ navigation

  async function navigate(dir) {
    if (!site) return;
    if (loading) return hud.toast('Loading more posts…');
    const posts = collectPosts();
    if (!posts.length) return pageScroll(dir);

    const ref = posts.find((p) => p.rect.bottom > 0 && p.rect.top < innerHeight) ?? posts[0];
    const anchor = anchorAt(ref.rect);
    const base = currentBase(anchor);
    const target = dir > 0 ? posts.find((p) => p.top > base + TOL) : posts.findLast((p) => p.top < base - TOL);

    if (target) return scrollToPost(target, anchor);
    if (dir < 0) {
      cursor = null;
      window.scrollTo({ top: 0, behavior: behavior() });
      return hud.toast('Top of the page');
    }
    return loadMore(base);
  }

  function scrollToPost(post, anchor) {
    const token = ++navToken;
    pauseStartedVideos();
    cursor = post.el;
    videoExtended = false;
    const top = clamp(post.top - anchor, 0, Math.max(0, maxScroll()));
    const smooth = settings.smooth && Math.abs(top - scrollY) > 1;
    inFlight = smooth;
    window.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
    settle(token, post.el, smooth);
  }

  async function settle(token, el, smooth) {
    if (smooth) await scrollEnd();
    if (token !== navToken) return;
    inFlight = false;
    arrivedAt = Date.now();
    realign(el);
    autoplay(el, token);
    await sleep(500); // images finishing loading can still shift things a bit
    if (token === navToken) realign(el);
  }

  // ------------------------------------------------------------------ autoplay

  let startedVideos = [];
  const PLAY_BUTTON = /^(play|play video|afspelen|video afspelen)$/i;

  // Start the video in the post we landed on. X only autoplays with its own setting on, and often
  // not in a window without focus. Retries briefly because players load lazily.
  async function autoplay(post, token) {
    if (!settings.autoplayVideos) return;
    for (let attempt = 0; attempt < 8 && token === navToken; attempt++) {
      const videos = deepQueryAll(post, 'video');
      if (videos.some((v) => !v.paused && !v.ended)) return; // the site started it
      const video = videos.find((v) => !v.ended);
      if (video) {
        // Blocked with sound until the page has been clicked once; muted is always allowed.
        await video.play().catch(() => {
          video.muted = true;
          return video.play().catch(() => {});
        });
        if (!video.paused) return void startedVideos.push(video);
      } else if (attempt % 3 === 0) {
        const button = findIn(post, 'button, [role="button"], [data-testid="playButton"]', (b) =>
          b.dataset.testid === 'playButton' || PLAY_BUTTON.test(b.getAttribute('aria-label') || ''));
        button?.click();
      }
      await sleep(250);
    }
  }

  function pauseStartedVideos() {
    for (const v of startedVideos) if (!v.paused) v.pause();
    startedVideos = [];
  }

  function realign(el) {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    const delta = r.top - anchorAt(r);
    if (Math.abs(delta) > 2) window.scrollBy({ top: delta, behavior: 'instant' });
  }

  function scrollEnd() {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        document.removeEventListener('scrollend', done);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      document.addEventListener('scrollend', done);
    });
  }

  async function loadMore(base) {
    const next = site.nextPage?.();
    if (next) {
      try {
        if (auto) sessionStorage.setItem(RESUME_KEY, '1');
      } catch {}
      hud.toast('Next page…');
      location.href = next.href;
      return;
    }

    loading = true;
    const token = ++navToken;
    hud.toast('Loading more posts…', LOAD_TIMEOUT);
    try {
      for (const deadline = Date.now() + LOAD_TIMEOUT; Date.now() < deadline; ) {
        window.scrollTo({ top: maxScroll(), behavior: 'instant' });
        await sleep(250);
        if (token !== navToken) return hud.clearToast(); // the user took over
        const target = collectPosts().find((p) => p.top > base + TOL);
        if (target) {
          hud.clearToast();
          return scrollToPost(target, anchorAt(target.rect));
        }
      }
      hud.toast('No more posts');
    } finally {
      loading = false;
    }
  }

  // Fallback for pages without recognisable posts (e.g. X's media grid): scroll a screen at a time.
  function pageScroll(dir) {
    const anchor = headerBottom(innerWidth / 2, innerWidth * 0.3);
    window.scrollBy({ top: dir * Math.max(100, (innerHeight - anchor) * 0.9), behavior: behavior() });
  }

  function onUserScroll() {
    navToken++;
    inFlight = false;
    // Give the user a full delay after scrolling by hand, without restarting on every wheel tick.
    if (auto && !pausedByMouse && Date.now() - lastUserRestart > 250) {
      lastUserRestart = Date.now();
      startCountdown();
    }
  }

  listen(window, 'wheel', onUserScroll, { passive: true, capture: true });
  listen(window, 'touchstart', onUserScroll, { passive: true, capture: true });
  // Backup for when the browser didn't register the hotkeys (it then passes them to the page).
  // Only works while the browser has focus; registered hotkeys never reach the page.
  // Uses whatever keys are set on the browser's shortcuts page (re-read whenever the tab gets focus).
  const { parseShortcut, matchesShortcut } = globalThis.GoonShared;
  let pageShortcuts = Object.entries({
    'previous-post': 'Ctrl+Shift+1',
    'next-post': 'Ctrl+Shift+2',
    'toggle-auto': 'Ctrl+Shift+3',
    'next-image': 'Ctrl+Shift+4',
  }).map(([name, text]) => ({ name, spec: parseShortcut(text) }));

  function loadShortcuts() {
    try {
      chrome.runtime.sendMessage({ type: 'get-shortcuts' }).then((list) => {
        if (!Array.isArray(list)) return;
        pageShortcuts = list.map((c) => ({ name: c.name, spec: parseShortcut(c.shortcut) })).filter((c) => c.spec);
      }, () => {});
    } catch {}
  }
  loadShortcuts();
  listen(window, 'focus', loadShortcuts);
  listen(document, 'visibilitychange', () => document.hidden || loadShortcuts());

  const isTyping = (e) => !!e.composedPath()[0]?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]');

  const matchesPageKey = (spec, e) =>
    spec?.code === e.code && !!spec.ctrl === e.ctrlKey && !!spec.alt === e.altKey && !!spec.shift === e.shiftKey && !!spec.meta === e.metaKey;

  listen(window, 'keydown', (e) => {
    if (!e.isTrusted || e.repeat || isTyping(e)) return; // untrusted: our own arrow key for image viewers
    const command =
      Object.entries(settings.pageKeys || {}).find(([, spec]) => matchesPageKey(spec, e))?.[0] ??
      pageShortcuts.find((c) => matchesShortcut(c.spec, e))?.name;
    if (!command) return;
    e.preventDefault();
    e.stopPropagation();
    ready.then(() => run(command));
  }, { capture: true });

  listen(window, 'keydown', (e) => {
    if (SCROLL_KEYS.has(e.key) && !e.target.closest?.('input, textarea, [contenteditable]')) onUserScroll();
  }, { capture: true });
  listen(window, 'mousedown', (e) => {
    if (e.clientX >= document.documentElement.clientWidth) onUserScroll(); // scrollbar drag
  }, { capture: true });

  // ------------------------------------------------------------------ auto mode

  function setAuto(on) {
    auto = on;
    pausedByMouse = false;
    clearTimeout(autoTimer);
    notify({ type: 'auto-state', on });
    if (!on) {
      hud.hidePill();
      return hud.toast('Auto-scroll off');
    }
    hud.toast(`Auto-scroll on · every ${formatDelay(settings.delay)}`);
    startCountdown();
  }

  function startCountdown(ms = settings.delay * 1000, label = `Auto · ${formatDelay(settings.delay)}`) {
    clearTimeout(autoTimer);
    if (!auto) return;
    pausedByMouse = false;
    autoTimer = setTimeout(tick, ms);
    hud.countdown(label, ms);
  }

  async function tick() {
    if (!auto) return;
    if (mouseOnPage()) return pauseForMouse();
    if (document.hidden) return startCountdown(1000); // tab in the background: wait
    const wait = videoWait();
    if (wait) {
      videoExtended = true;
      return startCountdown(wait, 'Waiting for video…');
    }
    if (settings.flipGalleries && (await flipImage(1))) return startCountdown();
    await navigate(1);
    startCountdown();
  }

  function mouseOnPage() {
    return settings.pauseOnHover && mouseInside && Date.now() - lastMouseMove < HOVER_STALE;
  }

  function pauseForMouse() {
    clearTimeout(autoTimer);
    pausedByMouse = true;
    hud.paused('Paused · mouse on page');
    const poll = () => {
      if (!auto) return;
      if (mouseOnPage()) autoTimer = setTimeout(poll, 500);
      else startCountdown();
    };
    autoTimer = setTimeout(poll, 500);
  }

  listen(document, 'mousemove', (e) => {
    if (!e.movementX && !e.movementY) return; // synthetic moves fired after scrolling
    mouseInside = true;
    lastMouseMove = Date.now();
    if (auto && !pausedByMouse && settings.pauseOnHover) pauseForMouse();
  }, { passive: true, capture: true });

  listen(document, 'mouseout', (e) => {
    if (e.relatedTarget) return; // still inside the page
    mouseInside = false;
    if (auto && pausedByMouse) startCountdown();
  }, { capture: true });

  // Extra time for a video on the current post that's still playing (once per post).
  function videoWait() {
    if (!settings.waitForVideos || videoExtended || !cursor?.isConnected) return 0;
    const r = cursor.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return 0;
    let remaining = 0;
    for (const v of deepQueryAll(cursor, 'video')) {
      if (v.loop || v.paused || v.ended || !Number.isFinite(v.duration)) continue;
      remaining = Math.max(remaining, ((v.duration - v.currentTime) / (v.playbackRate || 1)) * 1000);
    }
    const budget = MAX_VIDEO_WAIT - (Date.now() - arrivedAt);
    return remaining > 500 && budget > 500 ? Math.min(remaining + 300, budget) : 0;
  }

  // ------------------------------------------------------------------ gallery images

  // The post being looked at: the one we scrolled to if it's still on screen, otherwise the one
  // at the anchor line.
  function currentPost() {
    if (cursor?.isConnected) {
      const r = cursor.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) return cursor;
    }
    const posts = collectPosts();
    if (!posts.length) return null;
    const anchor = anchorAt(posts[0].rect) + TOL;
    return (posts.findLast((p) => p.rect.top <= anchor) ?? posts[0]).el;
  }

  // Gallery arrows in the open image viewer or the current post, visible ones first. Sites often
  // only show these while the mouse hovers the image, so hidden ones count too (with the mouse in
  // a game they are never visible).
  // Reddit's full-screen image viewer (or any other big dialog on top of the page), if open.
  function openViewer() {
    const big = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5 && el.checkVisibility();
    };
    const candidates = [
      ...document.querySelectorAll('[aria-modal="true"], dialog[open], [role="dialog"]'),
      ...deepQueryAll(document, '*').filter((el) => el.localName.includes('lightbox') || el.matches('[aria-modal="true"], dialog[open]')),
    ];
    return candidates.filter(big).at(-1) ?? null;
  }

  function imageButtons(dir) {
    const scope = openViewer() ?? currentPost();
    if (!scope) return { scope: null, buttons: [] };
    const want = dir > 0 ? NEXT_IMAGE : PREV_IMAGE;
    const other = dir > 0 ? PREV_IMAGE : NEXT_IMAGE;
    const buttons = deepQueryAll(scope, 'button, [role="button"]').filter((b) => {
      const label = [b.getAttribute('aria-label'), b.title, b.getAttribute('slot'), b.parentElement?.getAttribute('slot')]
        .filter(Boolean)
        .join(' ');
      if (!want.test(label) || other.test(label) || /post|comment|reply|repl/i.test(label)) return false;
      return !b.disabled && b.getAttribute('aria-disabled') !== 'true';
    });
    const visible = (b) => b.getBoundingClientRect().width > 0 && b.checkVisibility({ visibilityProperty: true });
    buttons.sort((a, b) => visible(b) - visible(a));
    return { scope, buttons };
  }

  // Clicks the gallery arrow and reports whether the gallery actually moved. A hidden arrow can
  // still be there on the last/first image, so "clicked" alone doesn't mean anything happened.
  async function flipImage(dir) {
    const { scope, buttons } = imageButtons(dir);
    if (!scope) return false;
    const viewer = scope === openViewer();
    if (buttons.length) {
      const changed = watchForChange(viewer ? document.documentElement : scope);
      buttons[0].click();
      if (await changed(400)) return true;
    }
    if (!viewer) return false;
    // Image viewers flip with the arrow keys; send one (also needed when a page key took the real one).
    const changed = watchForChange(document.documentElement);
    const key = dir > 0 ? 'ArrowRight' : 'ArrowLeft';
    const init = { key, code: key, keyCode: dir > 0 ? 39 : 37, which: dir > 0 ? 39 : 37, bubbles: true, composed: true, cancelable: true };
    const target = scope.contains(document.activeElement) ? document.activeElement : scope;
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    return changed(400);
  }

  // Resolves true as soon as anything inside `root` (shadow roots included) changes or scrolls.
  function watchForChange(root) {
    let hit = false;
    const observers = [];
    const mark = () => (hit = true);
    for (const node of [root, ...deepQueryAll(root, '*').filter((el) => el.shadowRoot).map((el) => el.shadowRoot)]) {
      const mo = new MutationObserver(mark);
      mo.observe(node, { attributes: true, childList: true, subtree: true, characterData: true });
      observers.push(mo);
    }
    const onScroll = (e) => e.composedPath().includes(root) && mark();
    document.addEventListener('scroll', onScroll, true);
    return async (ms) => {
      const until = Date.now() + ms;
      while (!hit && Date.now() < until) await sleep(50);
      for (const mo of observers) {
        if (mo.takeRecords().length) hit = true;
        mo.disconnect();
      }
      document.removeEventListener('scroll', onScroll, true);
      return hit;
    };
  }

  function deepQueryAll(root, selector, out = []) {
    out.push(...root.querySelectorAll(selector));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out);
    return out;
  }

  // ------------------------------------------------------------------ commands & settings

  function run(command) {
    mouseInside = false; // a hotkey means the mouse is busy elsewhere
    switch (command) {
      case 'next-post':
      case 'previous-post':
        navigate(command === 'next-post' ? 1 : -1);
        if (auto) startCountdown();
        break;
      case 'toggle-auto':
        setAuto(!auto);
        break;
      case 'faster':
      case 'slower': {
        const i = nearestStep(settings.delay) + (command === 'faster' ? -1 : 1);
        const delay = DELAY_STEPS[clamp(i, 0, DELAY_STEPS.length - 1)];
        saveSetting({ delay });
        hud.toast(`Auto-scroll delay: ${formatDelay(delay)}`);
        if (auto) startCountdown();
        break;
      }
      case 'next-image':
        // Last image (or no gallery): carry on to the next post so one key does both.
        flipImage(1).then((moved) => moved || (openViewer() ? hud.toast('Last image') : navigate(1)));
        if (auto) startCountdown();
        break;
      case 'previous-image':
        // First image (or no gallery): back to the previous post, mirroring next-image.
        flipImage(-1).then((moved) => moved || (openViewer() ? hud.toast('First image') : navigate(-1)));
        if (auto) startCountdown();
        break;
      case 'upvote':
      case 'save':
        postAction(command);
        break;
      case 'toggle-media-only':
        saveSetting({ mediaOnly: !settings.mediaOnly });
        hud.toast(`Images & videos only: ${settings.mediaOnly ? 'on' : 'off'}`);
        break;
    }
  }

  const getState = () => ({ site: site?.name ?? null, auto, delay: settings.delay });

  function saveSetting(patch) {
    Object.assign(settings, patch);
    try {
      chrome.storage.sync.set(patch);
    } catch {}
  }

  function notify(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {}
  }

  const ready = chrome.storage.sync.get(DEFAULTS).then(
    (stored) => Object.assign(settings, stored),
    () => {},
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) settings[key] = newValue ?? DEFAULTS[key];
    }
    if (!settings.hud) hud.hidePill();
    if (auto && (changes.delay || changes.hud || changes.pauseOnHover)) startCountdown();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'command' && msg?.type !== 'get-state') return;
    ready.then(() => {
      if (msg.type === 'command') run(msg.command);
      sendResponse(getState());
    });
    return true;
  });

  // Keep auto mode running across old.reddit's "next page".
  ready.then(() => {
    try {
      if (!sessionStorage.getItem(RESUME_KEY)) return;
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      return;
    }
    setAuto(true);
  });

  window.__goonScroller = {
    alive: () => {
      try {
        return !!chrome.runtime?.id;
      } catch {
        return false;
      }
    },
    destroy: () => {
      ac.abort();
      auto = false;
      clearTimeout(autoTimer);
      hud.remove();
    },
  };

  // ------------------------------------------------------------------ on-screen indicator

  function createHud() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
          font: 600 12px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f4f4f6; }
        .toast, .pill { background: rgba(17, 17, 23, .9); border: 1px solid rgba(255, 255, 255, .12);
          border-radius: 10px; padding: 7px 12px; box-shadow: 0 6px 20px rgba(0, 0, 0, .35); }
        .toast { opacity: 0; transform: translateY(4px); transition: opacity .15s, transform .15s; }
        .toast.show { opacity: 1; transform: none; }
        .pill { display: none; min-width: 130px; }
        .pill.show { display: block; }
        .bar { margin-top: 6px; height: 3px; border-radius: 3px; background: rgba(255, 255, 255, .15); overflow: hidden; }
        .fill { height: 100%; width: 0; background: #ff4f6d; }
        .pill.paused .fill { background: #8b8f99; }
      </style>
      <div class="wrap">
        <div class="toast"></div>
        <div class="pill"><div class="label"></div><div class="bar"><div class="fill"></div></div></div>
      </div>`;
    const toastEl = root.querySelector('.toast');
    const pill = root.querySelector('.pill');
    const label = root.querySelector('.label');
    const fill = root.querySelector('.fill');
    let toastTimer = 0;

    const mount = () => {
      if (!host.isConnected) document.documentElement.append(host);
    };

    return {
      toast(text, ms = 1500) {
        clearTimeout(toastTimer);
        if (!settings.hud) return;
        mount();
        toastEl.textContent = text;
        toastEl.classList.add('show');
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
      },
      clearToast() {
        clearTimeout(toastTimer);
        toastEl.classList.remove('show');
      },
      countdown(text, ms) {
        if (!settings.hud) return this.hidePill();
        mount();
        pill.className = 'pill show';
        label.textContent = text;
        fill.style.transition = 'none';
        fill.style.width = '0%';
        void fill.offsetWidth; // restart the transition
        fill.style.transition = `width ${ms}ms linear`;
        fill.style.width = '100%';
      },
      paused(text) {
        if (!settings.hud) return this.hidePill();
        mount();
        pill.className = 'pill show paused';
        label.textContent = text;
        fill.style.transition = 'none';
        fill.style.width = '100%';
      },
      hidePill() {
        pill.className = 'pill';
      },
      remove() {
        host.remove();
      },
    };
  }
})();
