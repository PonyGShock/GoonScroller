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
  },

  DELAY_STEPS: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180, 300],

  SITE_PATTERNS: ['*://*.reddit.com/*', '*://*.x.com/*', '*://*.twitter.com/*'],

  formatDelay(seconds) {
    return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
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
