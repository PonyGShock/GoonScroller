// Constants shared by the content script, the background worker and the popup.
globalThis.GoonShared = {
  DEFAULTS: {
    delay: 6, // seconds per post in auto mode
    mediaOnly: true, // skip posts without images or videos
    smooth: true, // animate the scroll
    pauseOnHover: true, // pause auto mode while the mouse is on the page
    waitForVideos: true, // let a playing video finish before moving on (capped at 30s)
    flipGalleries: true, // auto mode clicks through gallery images before moving on
    hud: true, // small on-screen indicator in the corner
    // Keys set in the panel that work on the page while the browser is focused, without Ctrl/Alt.
    // { command: { code, ctrl, alt, shift, meta } }
    pageKeys: {},
  },

  PAGE_KEY_ACTIONS: [
    ['next-post', 'Next post'],
    ['previous-post', 'Previous post'],
    ['next-image', 'Next image'],
    ['previous-image', 'Previous image'],
    ['toggle-auto', 'Start / stop auto'],
  ],

  formatKey(spec) {
    if (!spec?.code) return '';
    const NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Escape: 'Esc' };
    const key = NAMES[spec.code] ?? spec.code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
    return [spec.ctrl && 'Ctrl', spec.alt && 'Alt', spec.shift && 'Shift', spec.meta && 'Meta', key].filter(Boolean).join('+');
  },

  DELAY_STEPS: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180, 300],

  SITE_PATTERNS: ['*://*.reddit.com/*', '*://*.x.com/*', '*://*.twitter.com/*'],

  formatDelay(seconds) {
    return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
  },

  // Turns a shortcut as the browser shows it ("Ctrl+Shift+Down Arrow", "Alt+K", "Ctrl+Comma")
  // into something a keydown event can be matched against. Returns null if it can't be read.
  parseShortcut(text) {
    if (!text) return null;
    const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
    const spec = { ctrl: false, alt: false, shift: false, meta: false, key: null };
    for (const part of parts.slice(0, -1)) {
      const mod = part.toLowerCase();
      if (mod === 'ctrl' || mod === 'macctrl' || mod === 'control' || mod === '⌃') spec.ctrl = true;
      else if (mod === 'alt' || mod === 'option' || mod === '⌥') spec.alt = true;
      else if (mod === 'shift' || mod === '⇧') spec.shift = true;
      else if (mod === 'command' || mod === 'cmd' || mod === 'search' || mod === '⌘') spec.meta = true;
      else return null;
    }
    const raw = parts.at(-1)?.toLowerCase().replace(/\s*arrow\s*/, '').replace(/\s+/g, '');
    const NAMED = {
      up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
      comma: ',', ',': ',', period: '.', '.': '.', space: ' ', home: 'Home', end: 'End',
      pageup: 'PageUp', pgup: 'PageUp', pagedown: 'PageDown', pgdn: 'PageDown',
      insert: 'Insert', ins: 'Insert', delete: 'Delete', del: 'Delete', tab: 'Tab',
    };
    if (!raw) return null;
    if (NAMED[raw]) spec.key = NAMED[raw];
    else if (/^[a-z]$/.test(raw)) spec.code = `Key${raw.toUpperCase()}`;
    else if (/^[0-9]$/.test(raw)) spec.code = `Digit${raw}`;
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(raw)) spec.key = raw.toUpperCase();
    else return null;
    return spec;
  },

  matchesShortcut(spec, e) {
    if (!spec || e.ctrlKey !== spec.ctrl || e.altKey !== spec.alt || e.shiftKey !== spec.shift || e.metaKey !== spec.meta) {
      return false;
    }
    if (spec.code) return e.code === spec.code || (spec.code.startsWith('Digit') && e.code === `Numpad${spec.code.slice(5)}`);
    return e.key === spec.key;
  },

  nearestStep(seconds) {
    const steps = globalThis.GoonShared.DELAY_STEPS;
    let best = 0;
    steps.forEach((s, i) => {
      if (Math.abs(s - seconds) < Math.abs(steps[best] - seconds)) best = i;
    });
    return best;
  },
};
