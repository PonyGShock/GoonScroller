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
        // New Reddit: save through Reddit's own API (no menu, works in any language); the "…" menu
        // is only the fallback.
        const message = await redditApiSave(post).catch(() => null);
        if (message) return { message };
        return saveViaMenu(post, words);
      },
    },
  };

  const VIDEO_PLAYERS =
    'shreddit-player, shreddit-player-2, shreddit-embed, iframe[src*="redgifs."], [data-testid="videoPlayer"], [data-testid="videoComponent"]';
  const MEDIA_TARGETS = [
    '[data-testid="tweetPhoto"] img',
    '[data-testid="tweetPhoto"]',
    'img.media-lightbox-img',
    'gallery-carousel img',
    '[slot="post-media-container"] img',
    'gallery-carousel',
    '[slot="post-media-container"]',
    '.expando-button', // old.reddit: expand inline
    'a.thumbnail',
  ];
  const CLOSE_LABEL = /^(close|sluiten|schließen|fermer|cerrar)\b/i;

  // Open the current post's picture in the site's own full-screen viewer, or close it if open.
  function toggleMedia(quiet = false) {
    const viewer = openViewer();
    if (viewer) {
      const close = deepQueryAll(viewer, 'button, [role="button"]').find((b) => CLOSE_LABEL.test(b.getAttribute('aria-label') || ''));
      if (close) close.click();
      else {
        const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, composed: true, cancelable: true };
        for (const target of [document.activeElement ?? document.body, document]) target.dispatchEvent(new KeyboardEvent('keydown', init));
      }
      return 'closed';
    }
    const post = currentPost();
    let target;
    if (site?.name === 'X') {
      // X only has a full-screen viewer for photos; clicking a video (or anything else) opens the
      // post's own page instead, so don't click those.
      const photos = post ? deepQueryAll(post, '[data-testid="tweetPhoto"]').filter((p) => p.getBoundingClientRect().height > 0) : [];
      const photo = photos.find((p) => !p.querySelector('video, [data-testid="videoPlayer"], [data-testid="videoComponent"]'));
      if (!photo) {
        if (post?.querySelector('video, [data-testid="videoPlayer"], [data-testid="videoComponent"]')) {
          hud.toast("Videos can't open full screen on X");
        } else if (!quiet) hud.toast('No picture to open');
        return null;
      }
      target = photo.querySelector('img') ?? photo;
    } else {
      target = post && MEDIA_TARGETS.map((s) => deepQueryAll(post, s).find((el) => el.getBoundingClientRect().height > 0)).find(Boolean);
    }
    if (!target) {
      if (!quiet) hud.toast('No picture to open');
      return null;
    }
    realClick(target);
    return 'opened';
  }

  // ------------------------------------------------------------------ full-screen mode
  // Every post is opened in the site's own full-screen viewer; moving on closes it, scrolls to the
  // next post and opens that one. Posts with nothing to open stay in the feed view.

  let fullscreenOpened = null; // the post we last tried to open, so a closed viewer means "move on"

  async function openCurrent() {
    if (openViewer()) return true;
    fullscreenOpened = cursor;
    if (!toggleMedia(true)) return false;
    for (let i = 0; i < 15; i++) {
      await sleep(100);
      const viewer = openViewer();
      if (viewer) {
        arrivedAt = Date.now();
        autoplay(viewer, navToken);
        return true;
      }
    }
    return false;
  }

  // Never scroll the feed behind an open viewer: you'd lose your place without seeing it.
  async function closeViewer() {
    if (!openViewer()) return;
    toggleMedia(true);
    for (let i = 0; i < 10 && openViewer(); i++) await sleep(100);
  }

  // Moving between posts: always close an open viewer first. Full-screen mode (opening the next
  // post) only applies while auto-scroll runs; by hand it's too much going on.
  async function moveTo(dir) {
    if (settings.fullscreen && auto) return moveFullscreen(dir);
    await closeViewer();
    await navigate(dir);
  }

  async function moveFullscreen(dir) {
    await closeViewer();
    await navigate(dir);
    await sleep(settings.smooth ? 800 : 250); // let the scroll settle before clicking
    await openCurrent();
  }

  // A click with the pointer events around it, for handlers that listen to pointerdown/up.
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, composed: true, cancelable: true, view: window, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 200) };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.dispatchEvent(new MouseEvent('click', at));
  }

  // X (and Reddit) start ignoring or undoing save/like when it's toggled many times quickly, so a
  // second press on the same post within a short time is dropped.
  const ACTION_COOLDOWN = 1500;
  const lastAction = {};

  async function postAction(kind) {
    const post = currentPost();
    const last = lastAction[kind];
    if (post && last?.post === post && Date.now() - last.at < ACTION_COOLDOWN) return hud.toast('Wait a moment…');
    const control = post && (await ACTIONS[site?.name]?.[kind]?.(post));
    if (!control) return hud.toast(kind === 'upvote' ? 'No upvote/like button found' : "Couldn't save this post");
    lastAction[kind] = { post, at: Date.now() }; // only a press that did something starts the cooldown
    if (control.message) return hud.toast(control.message);
    realClick(control.el);
    hud.toast(control.on ? control.words[1] : control.words[0]);
  }

  // Reddit's API with the logged-in session, the same calls the Save button makes. Returns the
  // toast text, or null when it can't (not logged in, no post id, request refused).
  // Two kinds of Reddit login exist: the older session (works with a "modhash") and the newer one
  // (a token_v2 cookie, used with Reddit's OAuth API). Each attempt checks afterwards that the post
  // really changed, because Reddit can answer "OK" without saving.
  let modhash = null;
  async function redditApiSave(post) {
    const raw = [post.getAttribute('id'), post.getAttribute('post-id'), post.getAttribute('thingid'), post.dataset.fullname]
      .find((v) => /^(t3_)?[a-z0-9]+$/i.test(v || ''));
    if (!raw) return null;
    const id = raw.startsWith('t3_') ? raw : `t3_${raw}`;
    return (await legacySave(id).catch(() => null)) ?? (await oauthSave(id).catch(() => null));
  }

  const savedState = (info) => info?.data?.children?.[0]?.data?.saved;

  async function legacySave(id) {
    const json = async (url) => (await fetch(url, { credentials: 'include' })).json();
    modhash ??= (await json('/api/me.json'))?.data?.modhash || null;
    if (!modhash) return null;
    const before = savedState(await json(`/api/info.json?id=${id}`));
    if (typeof before !== 'boolean') return null;
    const res = await fetch(before ? '/api/unsave' : '/api/save', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Modhash': modhash },
      body: new URLSearchParams({ id, uh: modhash }),
    });
    const after = res.ok ? savedState(await json(`/api/info.json?id=${id}`)) : before;
    if (after === before) {
      modhash = null; // may have expired or not apply to this login; fetch a fresh one next time
      return null;
    }
    return after ? 'Saved' : 'Unsaved';
  }

  async function oauthSave(id) {
    const token = document.cookie.match(/(?:^|;\s*)token_v2=([^;]+)/)?.[1];
    if (!token) return null;
    // Sent from the background worker: the page itself isn't allowed to call oauth.reddit.com.
    const call = (method, path, body) => chrome.runtime.sendMessage({ type: 'reddit-oauth', method, path, body, token });
    const before = savedState((await call('GET', `/api/info?id=${id}`))?.json);
    if (typeof before !== 'boolean') return null;
    const res = await call('POST', before ? '/api/unsave' : '/api/save', `id=${encodeURIComponent(id)}`);
    if (!res?.ok) return null;
    const after = savedState((await call('GET', `/api/info?id=${id}`))?.json);
    return after === before || typeof after !== 'boolean' ? null : after ? 'Saved' : 'Unsaved';
  }

  // Fallback: open the post's "…" menu and click Save. Found by Reddit's icon names
  // ("overflow-horizontal", "save") so it doesn't depend on the language; labels as a backup.
  async function saveViaMenu(post, words) {
    const itemOf = (el) => el.closest('[role="menuitem"], button, a') ?? el.closest('li');
    const find = (root) => {
      const icon = deepQueryAll(root, '[icon-name^="save"], [icon-name^="unsave"]').map(itemOf).find(Boolean);
      if (icon) return icon;
      const hits = deepQueryAll(root, BUTTONS).filter((b) => SAVE_LABEL.test(labelOf(b)));
      return hits.find((h) => !hits.some((o) => o !== h && h.contains(o))) ?? null;
    };
    let el = find(post);
    if (!el) {
      const trigger =
        deepQueryAll(post, '[icon-name^="overflow"]').map((i) => i.closest('button, [role="button"]')).find(Boolean) ??
        deepQueryAll(post, '*').filter((x) => x.localName.includes('overflow-menu')).flatMap((x) => deepQueryAll(x, 'button'))[0] ??
        findIn(post, 'button', (b) => /overflow|more|opties|acties|actions/i.test(b.getAttribute('aria-label') || ''));
      if (!trigger) return null;
      realClick(trigger);
      for (let i = 0; i < 30 && !el; i++) {
        await sleep(100);
        el = find(post) ?? find(document);
      }
      if (!el) {
        realClick(trigger); // close the menu again
        return null;
      }
    }
    const icon = deepQueryAll(el, '[icon-name]')[0]?.getAttribute('icon-name') || '';
    return { el, on: /unsave|fill/i.test(icon) || SAVED_LABEL.test(labelOf(el)), words };
  }

  const site = SITES.find((s) => s.host.test(location.hostname)) ?? null;

  // ------------------------------------------------------------------ state

  let settings = { ...DEFAULTS };
  let cursor = null; // the post we last scrolled to
  let inFlight = false; // our own smooth scroll is still running
  let navToken = 0; // bumped by every navigation and user scroll; cancels stale follow-ups
  let arrivedAt = 0;
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
    if (cursor?.isConnected && cursor !== post.el) tellFrames(cursor, 'pause'); // embeds keep playing otherwise
    lastVideoTime = 0;
    videoDueAt = 0;
    cursor = post.el;
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
  // Video state reported by embedded players (redgifs iframes) through src/frame.js.
  const frameVideos = new Map(); // the embed's window -> its latest report
  listen(window, 'message', (e) => {
    if (e.data?.goonscroller !== 'frame-video' || !e.source) return;
    frameVideos.set(e.source, { ...e.data, at: Date.now() });
    for (const [win, state] of frameVideos) if (Date.now() - state.at > 10000) frameVideos.delete(win);
  });

  // Videos inside the post's iframes, shaped like <video> elements (duration, currentTime, ...).
  function embeddedVideos(post) {
    const out = [];
    for (const iframe of deepQueryAll(post, 'iframe')) {
      const win = iframe.contentWindow;
      if (!win) continue;
      for (const [source, state] of frameVideos) {
        if (Date.now() - state.at > 2000) continue;
        if (source === win || source.parent === win) out.push({ ...state, duration: state.duration ?? NaN });
      }
    }
    return out;
  }

  // Sends play/pause to the post's iframes (and frames nested one level inside them).
  function tellFrames(post, what) {
    for (const iframe of deepQueryAll(post, 'iframe')) {
      const win = iframe.contentWindow;
      if (!win) continue;
      // Only "play"/"pause", and only to redgifs embeds (directly or one frame deeper).
      const targets = [win, ...Array.from({ length: win.length }, (_, i) => win[i])];
      for (const target of targets) for (const origin of REDGIFS) target.postMessage({ goonscroller: what }, origin);
    }
  }

  const REDGIFS = ['https://www.redgifs.com', 'https://redgifs.com'];
  let startedFramePosts = [];
  let lastVideoTime = 0; // video position at the previous check, to notice a loop restarting
  let videoDueAt = 0; // when the current post's video should have played through

  // Starts a <video> directly. Blocked with sound until the page has been clicked once; muted is
  // always allowed.
  const playVideo = (v) =>
    v.play().catch(() => {
      v.muted = true;
      return v.play().catch(() => {});
    });

  // X: give X a moment to start the video itself; if it hasn't (it sometimes doesn't, e.g. when the
  // video isn't fully on screen or the window has no focus), start the <video> directly. Never
  // clicks X's play button, which toggles and would pause a video X is just starting.
  let manualVideoPost = null; // post where the play/pause key was last used

  async function autoplayX(post, token) {
    for (let attempt = 0; attempt < 6 && token === navToken; attempt++) {
      await sleep(attempt ? 500 : 1000);
      if (token !== navToken) return;
      if (manualVideoPost === post) return; // the play/pause key was used here: hands off
      const videos = deepQueryAll(post, 'video').filter((v) => !v.ended);
      if (!videos.length || videos.some((v) => !v.paused)) continue;
      // Only a video that never started: one paused partway was paused on purpose (by you or X).
      if (videos[0].currentTime > 0.1) return;
      await playVideo(videos[0]);
      if (!videos[0].paused) startedVideos.push(videos[0]);
    }
  }

  async function autoplay(post, token) {
    if (!settings.autoplayVideos) return;
    if (site?.name === 'X') return autoplayX(post, token);
    for (let attempt = 0; attempt < 8 && token === navToken; attempt++) {
      const embedded = embeddedVideos(post);
      if (embedded.some((v) => !v.paused && !v.ended)) return;
      if (deepQueryAll(post, 'iframe').length && attempt % 2 === 0) {
        tellFrames(post, 'play');
        if (!startedFramePosts.includes(post)) startedFramePosts.push(post);
      }
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
    for (const post of startedFramePosts) if (post.isConnected) tellFrames(post, 'pause');
    startedFramePosts = [];
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
    if (wait) return startCountdown(wait.ms, wait.label);
    if (settings.fullscreen && !openViewer() && fullscreenOpened !== cursor && (await openCurrent())) {
      return startCountdown();
    }
    if (settings.flipGalleries && (await flipImage(1))) return startCountdown();
    await moveTo(1);
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
  // How much longer auto-scroll should stay on the current post so its video plays through once
  // (capped by the "Let videos play" setting). Re-checked on every tick, so it can't skip ahead.
  // Feed videos usually loop, so "once" is measured from when we arrived at the post.
  function videoWait() {
    const limit = settings.videoWait; // seconds; 0 = don't wait, -1 = whole video
    if (!limit || !cursor?.isConnected) return null;
    const r = cursor.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return null; // user scrolled elsewhere
    const elapsed = Date.now() - arrivedAt;
    const left = (limit < 0 ? Infinity : limit * 1000) - elapsed;
    if (left <= 300) return null;

    const viewer = openViewer();
    const scopes = viewer ? [cursor, viewer] : [cursor];
    const videos = scopes.flatMap((s) => [...deepQueryAll(s, 'video'), ...embeddedVideos(s)]);
    const player = videos.length || scopes.some((s) => deepQueryAll(s, VIDEO_PLAYERS).length);
    if (!player) return null;
    const video = videos
      .filter((v) => Number.isFinite(v.duration) && v.duration > 0)
      .sort((a, b) => b.duration - a.duration)[0];
    if (!video || (video.paused && !video.ended)) {
      // Still loading or starting: look again shortly, but don't hang on one that never plays.
      return elapsed < 8000 ? { ms: 1000, label: 'Waiting for video…' } : null;
    }
    if (video.ended) return null;
    // Feed videos loop, so "finished" means: it jumped back to the start, or the time it was due
    // to end has passed (a restart can happen between two checks without being seen).
    const wrapped = video.currentTime + 0.5 < lastVideoTime;
    lastVideoTime = video.currentTime;
    if (wrapped || (videoDueAt && Date.now() >= videoDueAt - 250)) return null;
    const rate = video.playbackRate || 1;
    const remaining = ((video.duration - video.currentTime) * 1000) / rate;
    videoDueAt = Date.now() + remaining;
    const ms = Math.min(remaining + 200, left);
    if (ms <= 300) return null;
    const secs = Math.ceil(ms / 1000);
    return { ms, label: `Video · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left` };
  }

  // ------------------------------------------------------------------ gallery images

  // The post being looked at: the one we scrolled to if it's still on screen, otherwise the one
  // at the anchor line.
  function currentPost() {
    const all = site ? [...site.posts()] : [];
    const ref = cursor?.isConnected ? cursor : all[0];
    if (!ref) return null;
    const anchor = anchorAt(ref.getBoundingClientRect());
    if (cursor?.isConnected) {
      const r = cursor.getBoundingClientRect();
      if (inFlight || Math.abs(r.top - anchor) <= SNAP) return cursor; // still where we put it
    }
    // Scrolled by hand: the post taking up most of the screen below the header.
    let best = null;
    let most = 0;
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const seen = Math.min(r.bottom, innerHeight) - Math.max(r.top, anchor);
      if (seen > most) {
        most = seen;
        best = el;
      }
    }
    return best ?? (cursor?.isConnected ? cursor : null);
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
    if (root.shadowRoot) deepQueryAll(root.shadowRoot, selector, out);
    out.push(...root.querySelectorAll(selector));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out);
    return out;
  }

  // ------------------------------------------------------------------ commands & settings

  function run(command) {
    mouseInside = false; // a hotkey means the mouse is busy elsewhere
    switch (command) {
      case 'next-post':
      case 'previous-post': {
        moveTo(command === 'next-post' ? 1 : -1);
        if (auto) startCountdown();
        break;
      }
      case 'toggle-fullscreen':
        saveSetting({ fullscreen: !settings.fullscreen });
        hud.toast(`Full-screen mode: ${settings.fullscreen ? 'on' : 'off'}`);
        if (settings.fullscreen && auto) openCurrent();
        else if (!settings.fullscreen && auto && openViewer()) toggleMedia(true);
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
      case 'open-media':
        toggleMedia();
        break;
      case 'toggle-video': {
        // The biggest video in the open viewer or the current post.
        const scope = openViewer() ?? currentPost();
        manualVideoPost = currentPost();
        const video = scope && deepQueryAll(scope, 'video')
          .filter((v) => v.getBoundingClientRect().height > 0)
          .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
        if (!video) {
          if (scope && embeddedVideos(scope).length) {
            const paused = embeddedVideos(scope)[0].paused;
            tellFrames(scope, paused ? 'play' : 'pause');
            hud.toast(paused ? '▶ Playing' : '❚❚ Paused');
          } else hud.toast('No video here');
          break;
        }
        if (video.paused || video.ended) {
          playVideo(video);
          hud.toast('▶ Playing');
        } else {
          video.pause();
          hud.toast('❚❚ Paused');
        }
        break;
      }
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
