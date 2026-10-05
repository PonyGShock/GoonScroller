# Changelog

## 1.1.0

**New: pause all hotkeys.** One key (or the switch in the panel) turns all GoonScroller hotkeys
and page keys off, so keys like Ctrl+W do their normal job again. Press it again to switch back.

- Set it under "Pause / resume all hotkeys" on the shortcuts page, and set it to Global.
- While paused the toolbar icon shows a grey OFF.
- Hotkeys on browser shortcuts (Ctrl+W, Ctrl+Shift+W, Ctrl+T, Ctrl+N, Ctrl+R) do their normal job
  while the browser is focused.
- A pause ends when the browser restarts.

## 1.0.0

First release. 🤖 Made with AI: the whole extension was written by Claude (Anthropic) in Claude Code.

**Install (Chrome, Edge, Brave, Opera, Vivaldi)**

1. Download `goonscroller-1.0.0.zip` below and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder (the one with `manifest.json` in it).
4. Follow the setup page that opens to set the hotkeys to **Global**.

**What it does**

- Scrolls Reddit (new and old) and X one post at a time, placing each post right under the header.
- Global hotkeys that work while a game has focus, plus plain "page keys" such as the arrow keys.
- Auto-scroll from 1 second to 5 minutes per post. It flips through galleries, waits for videos
  (including redgifs) and pauses while your mouse is on the page.
- Optional full-screen auto-scroll: every post opens in the site's own viewer.
- Next/previous gallery image, open/close picture, play/pause video, upvote/like and save/bookmark.
- Skips text posts, ads and "Who to follow" boxes.

Runs completely locally: no tracking, no data collection. Free and open source (MIT).
On Reddit, a save made with the hotkey only shows on Reddit's own screen after a refresh.
