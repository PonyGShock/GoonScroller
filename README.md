# GoonScroller

A browser extension that scrolls Reddit and X **one post at a time, hands-free**. Put the feed on
your second monitor and keep your hands on your mouse and WASD. A hotkey moves to the next post,
or auto-scroll moves on its own every few seconds. The hotkeys keep working while a game or another app
has focus.

## What it does

- **Next / previous post.** The next post is placed right under the site's sticky header, every
  time. This works on new Reddit, old.reddit and X/Twitter.
- **Images & videos only** (on by default). Text-only posts, plain links, Reddit ads and X's
  "Who to follow" boxes are skipped.
- **Next image.** On a gallery post, a hotkey clicks the gallery's "next" arrow. After the last
  image it moves on to the next post, so one key does both.
- **Auto-scroll.** It moves to the next post every 1 second to 5 minutes. It also:
  - flips through all images of a gallery first,
  - pauses while your mouse is on the page, and carries on when the mouse leaves,
  - lets a playing video finish first (up to 30s),
  - loads more posts when the feed runs out, and goes to the next page on old.reddit.
- **Global hotkeys** that work while you're in a game.
- A **small indicator** in the bottom-right corner with the auto-scroll countdown. You can turn it off.
- Pages with no posts to snap to, such as X's media grid, scroll one screen at a time.

It only runs on `reddit.com` (including old.reddit) and `x.com` / `twitter.com`.

## Install (Chrome, Edge, Brave, Opera, Vivaldi)

Using Firefox? See [Firefox](#firefox) below.

1. Download this repo (**Code → Download ZIP**, then unzip) or `git clone` it.
2. Open `chrome://extensions` (in Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped **GoonScroller** folder: the one that has
   `manifest.json` directly inside it. Windows sometimes unzips into a folder inside a folder;
   pick the inner one.
4. Pin the GoonScroller icon to your toolbar if you want quick access to the settings.

Reddit/X tabs that are already open work straight away, without a reload.

## Hotkeys

| Action                         | Windows / Linux | Mac   |
| ------------------------------ | --------------- | ----- |
| Previous post                  | `Ctrl+Shift+1`  | `⌘⇧7` |
| Next post                      | `Ctrl+Shift+2`  | `⌘⇧8` |
| Next image (gallery)           | `Ctrl+Shift+4`  | `⌘⇧0` |
| Previous image (gallery)       | not set         |       |
| Start / stop auto-scroll       | `Ctrl+Shift+3`  | `⌘⇧9` |
| Shorter / longer auto delay    | not set         |       |
| Toggle "images & videos only"  | not set         |       |

The hotkeys go to the Reddit/X tab that's showing, even when the browser isn't the focused window.

### Make them work while you're in a game

1. Open `chrome://extensions/shortcuts`, or click **Change hotkeys…** in the GoonScroller panel.
2. Next to each GoonScroller shortcut, set the dropdown to **Global**. The defaults should
   already be Global, but check anyway: Chrome skips a default key if another extension already uses it.
3. To use other keys, click the pencil and press a new combination. It has to include Ctrl or
   Alt. Pick something your game doesn't use.

### Hotkeys don't do anything?

- Open the GoonScroller panel. If it says the hotkeys weren't assigned, or shows **not set**, click
  **Change hotkeys…** and set them yourself. In Brave that page is `brave://extensions/shortcuts`.
- Watch the GoonScroller icon when you press a hotkey. A pink **•** means the key arrived and was sent
  to your Reddit/X tab. A grey **?** means the key arrived, but no Reddit/X tab is showing in any
  window. No badge at all means the browser never got the key: check the shortcuts page and the
  **Global** setting.
- After changing shortcuts, restart the browser once. Global hotkeys are sometimes only registered on startup.

### Put it on a mouse button (recommended)

Chrome can't bind mouse buttons itself, but your mouse software can. In Logitech G HUB,
Razer Synapse, SteelSeries GG, Corsair iCUE and similar tools, set a spare side button (or G-key) to send
the keystroke **Ctrl+Shift+2**. Your thumb then moves to the next post without leaving the game.
Bind another button to **Ctrl+Shift+3** to start and stop auto-scroll.

## Settings

Click the toolbar icon:

- **Prev / Auto / Next** buttons
- **Auto-scroll delay**, 1 second to 5 minutes per post (or per gallery image)
- **Auto-scroll flips through galleries**
- **Only stop on images & videos**
- **Pause while mouse is on the page**
- **Let videos finish** (up to 30s)
- **Smooth scrolling**
- **Show indicator in the corner**

## See NSFW media without blur or warnings

Both sites hide adult media behind a blur or "sensitive content" warning unless you turn that off in
your account. Otherwise every post waits for a click.

- **X:** Settings and privacy → Privacy and safety → Content you see → enable
  **Display media that may contain sensitive content**.
- **Reddit:** Settings → Preferences → turn on **Show mature content (I'm over 18)** and turn off
  **Blur mature (18+) images and media**.

## Good to know

- Keep the browser window visible, for example on your second monitor. Chrome slows down timers in
  minimized windows and background tabs, and auto-scroll waits while its tab is hidden.
- If Reddit or X change their page layout and posts stop being detected, look at the selectors
  at the top of `src/content.js`.
- On Linux under Wayland, global hotkeys may not work, depending on your desktop.

## Firefox

The extension also runs in Firefox (140 or newer): next/previous, auto-scroll, images-only and
all the settings work. **Except global hotkeys**: Firefox has no way for an extension to catch
keys while another app (your game) has focus. In Firefox the hotkeys only work while Firefox
itself is focused.

What that means in practice:

- **Auto-scroll is fine.** Click ▶ Auto in the panel once and leave it running; it doesn't need
  any keys after that.
- **For hotkeys from inside a game**, install Microsoft Edge (already on Windows) or Brave
  next to Firefox and use it only for this on your second monitor. Keep Firefox for everything else.

Installing in Firefox:

- **Quick test:** open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
  pick `manifest.json`. It's removed when Firefox restarts.
- **To keep it:** regular Firefox only installs signed add-ons. Signing is free: make an account on
  [addons.mozilla.org](https://addons.mozilla.org/developers/), zip the *contents* of the
  GoonScroller folder, submit it as **"On your own"** (unlisted), and install the signed `.xpi` it
  gives you back. Or use Firefox Developer Edition / Nightly and set
  `xpinstall.signatures.required` to `false` in `about:config`.
- Firefox may ask you to allow access to reddit.com and x.com. Allow it (or right-click the icon
  → Manage Extension → Permissions), otherwise nothing happens on those sites.
- If the toolbar panel shows up tiny or empty, open the settings as a page instead: about:addons →
  GoonScroller → **Preferences**. If it still fails, open `about:debugging#/runtime/this-firefox`,
  click **Inspect** next to GoonScroller and send a screenshot of the Console errors.
- Change hotkeys via **Change hotkeys…** in the panel (or about:addons → ⚙ → Manage Extension Shortcuts).

## Development

```sh
npm install
npx playwright install chromium
npm test            # HEADED=1 npm test to watch it run
```

The test loads the real extension in Chromium and runs it against mock Reddit (new and old) and X
pages in `tests/fixtures/`. It checks post alignment, skipping, infinite scroll, old.reddit paging,
auto-scroll with hover pause and video waiting, and the popup.
