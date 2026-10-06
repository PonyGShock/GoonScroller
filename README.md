# GoonScroller

**🌐 [Website](https://ponygshock.github.io/GoonScroller/)** · **🧩 [Chrome Web Store](https://chromewebstore.google.com/detail/oblelonljmpblebbampfpilblmeobdgb)** · **⬇ [Latest release](https://github.com/PonyGShock/GoonScroller/releases/latest)**

> **🤖 Made with AI.** This whole project (the extension, its tests and these docs) was written by
> Claude, Anthropic's AI model, in Claude Code. PonyGShock came up with the idea, directed it, and
> tested every version on the real sites together with friends.

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
- **Full-screen auto-scroll**: while auto-scroll runs, every post opens in the site's full-screen
  viewer; it flips through it, waits for videos, closes it, moves to the next post and opens that
  one. Posts with nothing to open stay in the feed view. Manual next/previous keep scrolling the
  normal feed.
- The feed never scrolls behind an open viewer: moving on always closes it first, so you don't end
  up 50 posts further when you close it.
- **Autoplay videos**: starts the video in the post you land on and pauses it when you move on. On
  X it first gives X a second to start it, then starts the video itself if X didn't. It never clicks
  X's play button and never restarts a video that was paused partway.
- **Play / pause video**: a key (and panel button) for the video in the current post or viewer.
- **Global hotkeys** that work while you're in a game.
- A **small indicator** in the bottom-right corner with the auto-scroll countdown. You can turn it off.
- Pages with no posts to snap to, such as X's media grid, scroll one screen at a time.

It only runs on `reddit.com` (including old.reddit) and `x.com` / `twitter.com`, plus a tiny helper
inside redgifs embeds so it can see and start those videos.

## Install (Chrome, Edge, Brave, Opera, Vivaldi)

**Easiest:** get it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/oblelonljmpblebbampfpilblmeobdgb) and
click **Add to Chrome**. It updates itself. Website: https://ponygshock.github.io/GoonScroller/

**Or install it by hand:**

1. Download this repo (**Code → Download ZIP**, then unzip) or `git clone` it.
2. Open `chrome://extensions` (in Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped **GoonScroller** folder: the one that has
   `manifest.json` directly inside it. Windows sometimes unzips into a folder inside a folder;
   pick the inner one.
4. Pin the GoonScroller icon to your toolbar if you want quick access to the settings.

Reddit/X tabs that are already open work straight away, without a reload.

On first install a setup page opens. Follow it to set every hotkey to **Global**: the browser
doesn't let extensions do that themselves.

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
| Play / pause video             | not set         |       |
| Full-screen mode on / off      | not set         |       |
| Upvote (Reddit) / like (X)     | not set         |       |
| Save (Reddit) / bookmark (X)   | not set         |       |
| Pause / resume all hotkeys     | not set         |       |

The hotkeys go to the Reddit/X tab that's showing, even when the browser isn't the focused window.
The ones marked "not set" can be given a key on the shortcuts page (below) or as a page key in the panel.

> [!WARNING]
> **A global hotkey is taken away from every other program.** Whatever key you give GoonScroller
> stops doing its normal job everywhere else (games, Discord, your editor…) for as long as the
> browser is running and GoonScroller is switched on. Closing Reddit/X doesn't free it, and
> neither does "Pause all hotkeys". You get the key back by turning GoonScroller off in
> `chrome://extensions` / `brave://extensions`, by closing the browser completely, or by moving the
> hotkey to another key. So pick keys you never use for anything else.

> [!NOTE]
> **League of Legends blocks all global browser hotkeys** while it's running in the foreground.
> GoonScroller can't get around that; use auto-scroll, or click the browser and use page keys.

### Make them work while you're in a game

1. Open `chrome://extensions/shortcuts`, or click **Change hotkeys…** in the GoonScroller panel.
2. Next to each GoonScroller shortcut, set the dropdown to **Global**. The defaults should
   already be Global, but check anyway: Chrome skips a default key if another extension already uses it.
3. To use other keys, click the pencil and press a new combination. It has to include Ctrl or
   Alt. Pick something your game doesn't use.

> ⚠️ Reminder: a global hotkey stops working in every other program while GoonScroller is on (see the warning under [Hotkeys](#hotkeys)).

### Pause all hotkeys (get Ctrl+W back)

Give **Pause / resume all hotkeys** a key on the shortcuts page (set it to Global too), or tick
**Pause all hotkeys** in the panel. While paused:

- GoonScroller ignores all its hotkeys and page keys, so the arrow keys scroll normally again.
- The toolbar icon shows a grey **OFF**.
- A hotkey sitting on a browser shortcut does that shortcut's normal job while the browser window is
  focused: **Ctrl+W** closes the tab, **Ctrl+Shift+W** the window, **Ctrl+T** opens a tab,
  **Ctrl+N** a window, **Ctrl+R** reloads (⌘ on Mac).

Press the pause key again to switch GoonScroller back on. A pause ends when the browser restarts.

> ⚠️ **Pausing only helps inside the browser.** In other programs and games the paused keys
> **stay blocked**, because the browser keeps a global hotkey for itself while GoonScroller is on.
> To free them there, turn GoonScroller off in `chrome://extensions` / `brave://extensions`.

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

### Saving on Reddit doesn't work?

**First: refresh the page.** This catches almost everyone, especially on **macOS**. GoonScroller
saves the post straight through Reddit, so **Reddit's own screen doesn't notice right away**:

- Reddit does **not** show its own "Post saved" message.
- The post's **"…" menu still says "Save"** (not "Remove from saved") **until you refresh**.

The post **is** saved. Check **reddit.com/user/me/saved**, or refresh the page and open the
"…" menu again. Trust GoonScroller's own message in the corner ("Saved ✓"): it only appears after
Reddit has confirmed the save. Pressing the key on a post that's already saved won't unsave it; it
says "Already saved ✓". Press again within 4 seconds if you really want to unsave.

Still not in your saved posts? Open the GoonScroller panel: under **Last Reddit save** it shows what the last save attempt tried
and why each way failed (it never contains login data). **Copy report** and include it when you
report the problem.

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
- **Full-screen auto-scroll: open every post full screen** (only while auto-scroll runs)
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
- **X videos:** turn on X's own autoplay too: Settings → Accessibility, display, and languages → Data
  usage → **Autoplay**. If X doesn't start a video (it sometimes won't when the video isn't fully on
  screen or the window has no focus), GoonScroller starts it, and the play/pause key is there too.

## Known limitations

These come from how browsers, Windows, games or the sites themselves work. The extension can't
fix them, but most have a workaround.

**Hotkeys**

- **A global hotkey is blocked in every other program.** As long as the browser runs and
  GoonScroller is on, its global keys don't reach other apps or games, even with no Reddit/X tab
  open. Turn GoonScroller off, close the browser completely, or move the hotkey to free a key.
- **Pausing doesn't hand keys back to other apps.** While paused, GoonScroller redoes the common
  browser shortcuts (see "Pause all hotkeys"), but in other apps and games the key still doesn't
  arrive. To free it there, turn GoonScroller off or remove the key on the shortcuts page.
- **League of Legends blocks all global browser hotkeys** while it's in the foreground. Use
  auto-scroll there, or click the browser and use page keys.
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
- **Some other games or anti-cheat programs block global hotkeys too** while they're running. Use page keys or
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
- **On X, only pictures open full screen.** X has no full-screen viewer for videos (clicking one
  opens the post's page), so GoonScroller shows a message instead and auto-scroll leaves it in the feed.
- **Only Reddit's own videos, X videos and redgifs embeds are waited for.** Other embedded players
  (for example YouTube) are shown, but auto-scroll can't see how long they are.
- **Reddit only shows a save after a refresh** (all systems, most noticed on macOS). Reddit's own
  "Post saved" message doesn't appear and the "…" menu keeps saying "Save" until you refresh, but
  the post is saved: see reddit.com/user/me/saved.
- **X (and Reddit) limit how fast you can save/like the same post.** Toggling it many times quickly
  makes the site ignore or undo it. GoonScroller ignores a second press on the same post within 1.5
  seconds to avoid that, but the site's own limit can still kick in.
- **If Reddit or X change their page layout**, post detection or buttons may stop working until the
  extension is updated. The selectors are at the top of `src/content.js`.

## License and privacy

Free and open source under the [MIT license](LICENSE). No tracking and no data collection; see the
[privacy policy](PRIVACY.md). Publishing steps are in [RELEASING.md](RELEASING.md).

## Development

```sh
npm install
npx playwright install chromium
npm test            # HEADED=1 npm test to watch it run
```

The website lives in `site/` (plain HTML/CSS/JS, open `site/index.html` to preview) and is
published to GitHub Pages by `.github/workflows/pages.yml`. Paste the Chrome Web Store link into
`STORE_URL` at the top of `site/main.js` once the listing is live.

The test loads the real extension in Chromium and runs it against mock Reddit (new and old) and X
pages in `tests/fixtures/`. It checks post alignment, skipping, infinite scroll, old.reddit paging,
auto-scroll with hover pause and video waiting, and the popup.
