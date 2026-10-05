# Releasing GoonScroller

A step-by-step guide to making the project public and putting it in the Chrome Web Store.

## 1. Make the code public on GitHub

1. Get the work onto the `main` branch: open a pull request from
   `claude/reddit-x-auto-scroller-3enxqo` into `main` and merge it. If `main` doesn't exist yet, set
   this branch as the default under **Settings → General → Default branch**, or rename it to `main`.
2. If the repository is private: **Settings → General → Danger Zone → Change visibility → Public**.
3. Optional, under **About** (the gear on the repo page): add a short description, the topics
   `chrome-extension`, `reddit`, `twitter`, `auto-scroll`, and later the store link.

The `LICENSE` file (MIT) is what makes it open source: anyone may use, change and share the code
as long as the copyright notice stays in.

## 2. Build the upload zip

```sh
npm run package      # creates dist/goonscroller-<version>.zip
```

The zip only contains `manifest.json`, `src/`, `popup/` and `icons/`, which is exactly what the
stores want. No tests or tooling.

## 3. A GitHub release (for people who install by hand)

This happens automatically. The **Release** workflow (`.github/workflows/release.yml`) builds the
zip and publishes a release named after the version in `manifest.json`, with the matching section of
`CHANGELOG.md` as release notes. It only runs when that version has no release yet. People can
download the zip, unzip it and use **Load unpacked**.

## 4. Chrome Web Store

1. Go to the **Chrome Web Store Developer Dashboard**, sign in with a Google account and pay the
   one-time **$5** registration fee. Turn on 2-step verification on that Google account (required).
2. **Add new item** → upload the zip.
3. **Store listing:**
   - *Name:* the store uses the `name` from `manifest.json`. A neutral name has a much better chance
     in review (see the note below). To change it, edit `"name"` in `manifest.json` and run
     `npm run package` again.
   - *Description:* see "Store listing text" below.
   - *Category:* Productivity (or Tools). *Language:* English.
   - *Graphics:* the 128×128 icon is `icons/icon-128.png`. Add at least one **1280×800** screenshot
     and a **440×280** small promo tile. Use only safe-for-work content in them.
4. **Privacy practices:**
   - *Single purpose:* "Hands-free, post-by-post scrolling of Reddit and X, controlled by hotkeys."
   - *Permission justifications:* copy them from `PRIVACY.md`.
   - *Remote code:* No.
   - *Data usage:* the extension collects none of the listed data types. Tick the three
     certifications.
   - *Privacy policy URL:* the link to `PRIVACY.md` on GitHub, e.g.
     `https://github.com/PonyGShock/GoonScroller/blob/main/PRIVACY.md`.
5. **Distribution:** Public, all regions.
6. **Submit for review.** Reviews usually take a few days. Extensions with access to many sites
   can take longer.

**Note about content policy.** The Chrome Web Store doesn't allow sexually explicit material, and
reviewers judge the name, description and screenshots. The extension itself contains nothing
explicit, so present it as what it technically is: a hands-free scroller for Reddit and X. A name
like "GoonScroller", an NSFW-focused description or NSFW screenshots will very likely get it
rejected. Keep the GitHub name as you like, but use a neutral store name.

## 5. Microsoft Edge Add-ons (free)

Sign up at **Microsoft Partner Center → Edge program**, create a new extension, upload the same
zip and reuse the listing text and privacy answers. Brave, Opera and Vivaldi users can install from
the Chrome Web Store.

## 6. Updating later

1. Raise `"version"` in `manifest.json` (e.g. `1.0.1`). Each upload needs a higher version.
   Add a `## 1.0.1` section to `CHANGELOG.md` saying what changed.
2. `npm test`, then push. The GitHub release is created on its own. Run `npm run package` for
   the store zip.
3. Upload the new zip under the item's **Package** tab and submit. Installed copies update
   automatically after approval.

## Store listing text

> **Hands-free scrolling for Reddit and X: one post at a time, perfectly lined up.**
>
> Put Reddit or X on your second monitor and keep your hands on your game. A hotkey moves to the
> next post and lines it up exactly under the site's header. Or turn on auto-scroll and let it move
> on by itself.
>
> • Global hotkeys that work while another app or game has focus
> • Auto-scroll with a delay from 1 second to 5 minutes
> • Waits for videos to finish (including redgifs embeds), and can autoplay them
> • Flips through gallery images, and opens pictures full screen
> • Images & videos only mode, skips text posts and ads
> • Upvote / like and save / bookmark with a hotkey
> • Page keys: single keys like the arrow keys while the window is focused
> • Works on new Reddit, old Reddit and X
>
> Free and open source. No tracking, no data collection.
>
> Built with AI: the code was written by Claude (Anthropic's AI model) in Claude Code, and directed
> and tested by PonyGShock.
