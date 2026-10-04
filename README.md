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
  - lets a video play through once before moving on (up to 30s, 1, 2 or 5 minutes, or the whole video),
    including redgifs videos embedded in Reddit posts,
  - loads more posts when the feed runs out, and goes to the next page on old.reddit.
- **Upvote / like** and **save / bookmark** the post you're on, with a hotkey. On Reddit, saving
  goes straight through Reddit's own save function with your login (no menu needed); the "…" menu
  is only a fallback.
- **Open / close picture**: opens the current post's picture in the site's full-screen viewer, or
  closes the viewer. Next/previous image work inside it.
- **Autoplay videos**: starts the video in the post you land on (X often won't by itself) and
  pauses it when you move on.
- **Global hotkeys** that work while you're in a game.
- A **small indicator** in the bottom-right corner with the auto-scroll countdown. You can turn it off.
- Pages with no posts to snap to, such as X's media grid, scroll one screen at a time.

It only runs on `reddit.com` (including old.reddit) and `x.com` / `twitter.com`, plus a tiny helper
inside redgifs embeds so it can see and start those videos.

## Install (Chrome, Edge, Brave, Opera, Vivaldi)

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
| Open / close picture           | not set         |       |
| Upvote (Reddit) / like (X)     | not set         |       |
| Save (Reddit) / bookmark (X)   | not set         |       |

The hotkeys go to the Reddit/X tab that's showing, even when the browser isn't the focused window.
The ones marked "not set" can be given a key on the shortcuts page (below) or as a page key in the panel.

### Make them work while you're in a game

1. Open `chrome://extensions/shortcuts`, or click **Change hotkeys…** in the GoonScroller panel.
2. Next to each GoonScroller shortcut, set the dropdown to **Global**. The defaults should
   already be Global, but check anyway: Chrome skips a default key if another extension already uses it.
3. To use other keys, click the pencil and press a new combination. It has to include Ctrl or
   Alt. Pick something your game doesn't use.

### Page keys: plain keys like the arrow keys

The browser's hotkeys always need Ctrl or Alt. For single keys, use **Page keys** in the GoonScroller
panel. Click an action and press any key, or click **Use arrow keys**:

- ↓ / ↑ for next / previous post
- → / ← for next / previous image in a gallery. On the last image → goes to the next post; on the
  first image ← goes to the previous post.

Page keys only work while the Reddit/X window is focused, and not while you're typing in a text box.
They can't be global, because that would take those keys away from every other app and game.

The panel also has **◀ Image / Image ▶** buttons for galleries.

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
- **Autoplay videos**
- **Let videos play**: don't wait, up to 30s / 1 / 2 / 5 minutes, or the whole video
- **Smooth scrolling**
- **Show indicator in the corner**

## See NSFW media without blur or warnings

Both sites hide adult media behind a blur or "sensitive content" warning unless you turn that off in
your account. Otherwise every post waits for a click.

- **X:** Settings and privacy → Privacy and safety → Content you see → enable
  **Display media that may contain sensitive content**.
- **Reddit:** Settings → Preferences → turn on **Show mature content (I'm over 18)** and turn off
  **Blur mature (18+) images and media**.
- **X videos:** GoonScroller's **Autoplay videos** option starts them for you. X's own switch is
  under Settings → Accessibility, display, and languages → Data usage → **Autoplay**.

## Known limitations

These come from how browsers, Windows, games or the sites themselves work. The extension can't
fix them, but most have a workaround.

**Hotkeys**

- **Global hotkeys that overlap with your game's controls freeze your movement.** For example, with
  `Ctrl+W/A/S/D` as global hotkeys, pressing Ctrl to crouch while walking hands those keys to the
  scroller instead of the game. Windows takes a global hotkey before the game sees it, so the game
  misses the key press or release and you stop moving for about a second.
  *Workaround:* use combinations your game never uses, such as `Ctrl+Shift+1/2/3/4` or
  `Ctrl+Shift+arrow keys`. Best of all, put them on spare mouse buttons through your mouse software.
- **Global hotkeys always need Ctrl or Alt.** That's a browser rule. Plain keys (like the arrow
  keys alone) only work as page keys, while the Reddit/X window is focused.
- **Only 4 hotkeys come pre-set.** The browser doesn't allow more. Give the rest a key yourself on
  the shortcuts page.
- **After reinstalling or updating, check the Global setting again.** The browser sometimes switches
  hotkeys back to "In Brave" / "In Chrome", so they stop working from other apps.
- **Some games or anti-cheat programs block global hotkeys** while they're running. Use page keys or
  mouse buttons there.
- **On Linux under Wayland**, global hotkeys may not work, depending on your desktop.

**Browser and sites**

- **Chromium browsers only** (Chrome, Edge, Brave, Opera, Vivaldi). Firefox has no global hotkeys.
- **Keep the browser window visible**, for example on your second monitor. Browsers slow down timers
  in minimized windows and background tabs, and auto-scroll waits while its tab is hidden.
- **Videos start muted until you've clicked the Reddit/X page once.** Browsers don't let pages play
  sound on their own before that.
- **After saving on Reddit, Reddit's own Save button may still say "Save"** until you refresh the
  page. The post is saved; check your saved posts.
- **Only Reddit's own videos, X videos and redgifs embeds are waited for.** Other embedded players
  (for example YouTube) are shown, but auto-scroll can't see how long they are.
- **If Reddit or X change their page layout**, post detection or buttons may stop working until the
  extension is updated. The selectors are at the top of `src/content.js`.

## Development

```sh
npm install
npx playwright install chromium
npm test            # HEADED=1 npm test to watch it run
```

The test loads the real extension in Chromium and runs it against mock Reddit (new and old) and X
pages in `tests/fixtures/`. It checks post alignment, skipping, infinite scroll, old.reddit paging,
auto-scroll with hover pause and video waiting, and the popup.
