// GoonScroller helper inside embedded video players (redgifs on Reddit). The page around the
// embed can't look inside it, so this reports the video's length and progress to the page and
// plays/pauses it on request. Only does anything inside an iframe.
(() => {
  if (window === window.top || window.__goonFrame) return;
  // Only help when the embed sits on Reddit or X, and only talk to that page.
  const host = [...(location.ancestorOrigins || [])].at(-1) || '';
  if (!/^https:\/\/([a-z0-9-]+\.)*(reddit|x|twitter)\.com$/.test(host)) return;
  window.__goonFrame = true;

  const video = () =>
    [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];

  setInterval(() => {
    const v = video();
    if (!v) return;
    window.top.postMessage(
      {
        goonscroller: 'frame-video',
        duration: Number.isFinite(v.duration) ? v.duration : null,
        currentTime: v.currentTime,
        paused: v.paused,
        ended: v.ended,
        loop: v.loop,
        playbackRate: v.playbackRate,
      },
      host,
    );
  }, 500);

  addEventListener('message', (e) => {
    const v = video();
    if (!v) return;
    if (e.data?.goonscroller === 'play') {
      // Blocked with sound until the page has been clicked once; muted is always allowed.
      v.play().catch(() => {
        v.muted = true;
        return v.play().catch(() => {});
      });
    }
    if (e.data?.goonscroller === 'pause') v.pause();
  });
})();
