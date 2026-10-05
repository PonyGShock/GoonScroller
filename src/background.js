// GoonScroller background worker: routes hotkeys (including global ones that fire while another
// app or game has focus) and popup buttons to the right Reddit/X tab.
importScripts('shared.js');

const { SITE_PATTERNS } = globalThis.GoonShared;
const CONTENT_FILES = ['src/shared.js', 'src/content.js'];

// The visible Reddit/X tab to control. With Chrome in the background the hint tab may be
// missing or unrelated, so fall back to the most recently used Reddit/X tab that's showing.
async function findTargetTab(hint) {
  const tabs = await chrome.tabs.query({ active: true, url: SITE_PATTERNS });
  if (!tabs.length) return null;
  const hinted = hint && tabs.find((t) => t.id === hint.id);
  if (hinted) return hinted;
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0];
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Tab was open before the extension was installed or updated: inject and retry.
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function handleCommand(command, hint) {
  const tab = await findTargetTab(hint);
  if (!tab) return null;
  return sendToTab(tab.id, { type: 'command', command }).catch(() => null);
}
globalThis.handleCommand = handleCommand; // used by the tests

// Flash the toolbar badge so it's visible that a hotkey arrived: "•" = sent to a Reddit/X tab,
// "?" = no Reddit/X tab is showing in any window.
async function flashBadge(text) {
  await chrome.action.setBadgeText({ text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ color: text === '?' ? '#8b8f99' : '#ff4f6d' }).catch(() => {});
  setTimeout(async () => showPausedBadge(await isPaused()), 1200);
}

// ------------------------------------------------------------------ pausing all hotkeys
// "Pause hotkeys" lets keys like Ctrl+W do their normal job again. Chrome can't release a global
// hotkey while the extension is installed, so a paused hotkey still arrives here. For the common
// browser shortcuts we then do what the browser would have done, if the browser has focus.

const isPaused = () => chrome.storage.local.get('hotkeysPaused').then((s) => !!s.hotkeysPaused, () => false);

function showPausedBadge(paused) {
  chrome.action.setBadgeText({ text: paused ? 'OFF' : '' }).catch(() => {});
  if (paused) chrome.action.setBadgeBackgroundColor({ color: '#8b8f99' }).catch(() => {});
}

const BROWSER_SHORTCUTS = { W: 'close-tab', 'Shift+W': 'close-window', T: 'new-tab', N: 'new-window', R: 'reload' };

// "Ctrl+W", "Command+W" or the Mac form "⌘W" → the browser action that key normally does.
function browserShortcutAction(shortcut) {
  if (!shortcut) return null;
  const parts = shortcut
    .replace(/⌘/g, 'Command+')
    .replace(/⇧/g, 'Shift+')
    .replace(/⌥/g, 'Alt+')
    .replace(/⌃/g, 'MacCtrl+')
    .split('+')
    .filter(Boolean);
  const key = parts.pop().toUpperCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if (!(mods.has('ctrl') || mods.has('command')) || mods.has('alt') || mods.has('macctrl')) return null;
  return BROWSER_SHORTCUTS[mods.has('shift') ? `Shift+${key}` : key] ?? null;
}
globalThis.browserShortcutAction = browserShortcutAction; // used by the tests

async function doBrowserShortcut(action) {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win?.focused) return false; // another app has focus: nothing to redo
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (action === 'close-tab' && tab) await chrome.tabs.remove(tab.id);
  else if (action === 'close-window') await chrome.windows.remove(win.id);
  else if (action === 'new-tab') await chrome.tabs.create({ windowId: win.id });
  else if (action === 'new-window') await chrome.windows.create({});
  else if (action === 'reload' && tab) await chrome.tabs.reload(tab.id);
  return true;
}

async function whilePaused(command) {
  const shortcut = (await chrome.commands.getAll()).find((c) => c.name === command)?.shortcut;
  const action = browserShortcutAction(shortcut);
  return action && (await doBrowserShortcut(action)) ? `paused, did ${action}` : 'paused, ignored';
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.hotkeysPaused) showPausedBadge(!!changes.hotkeysPaused.newValue);
});
// A pause doesn't outlive the browser session, so hotkeys never stay off by accident.
chrome.runtime.onStartup.addListener(() => chrome.storage.local.set({ hotkeysPaused: false }));

// Remembers the last hotkey for the panel's "Last hotkey" line, to see where things stop.
async function onHotkey(command, tab) {
  let outcome;
  try {
    if (command === 'toggle-hotkeys') {
      const paused = !(await isPaused());
      await chrome.storage.local.set({ hotkeysPaused: paused });
      outcome = paused ? 'hotkeys paused' : 'hotkeys back on';
    } else if (await isPaused()) {
      outcome = await whilePaused(command);
    } else {
      const target = await findTargetTab(tab);
      if (!target) outcome = 'no Reddit/X tab showing';
      else outcome = (await sendToTab(target.id, { type: 'command', command }).catch(() => null)) ? 'sent' : 'tab did not answer';
      flashBadge(outcome === 'sent' ? '•' : '?');
    }
  } catch (err) {
    outcome = `error: ${err?.message || err}`;
  }
  chrome.storage.session.set({ lastHotkey: { command, outcome, at: Date.now() } }).catch(() => {});
  return outcome;
}
globalThis.onHotkey = onHotkey; // used by the tests

chrome.commands.onCommand.addListener((command, tab) => {
  onHotkey(command, tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'auto-state' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: msg.on ? 'ON' : '' }).catch(() => {});
    if (msg.on) chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff4f6d' }).catch(() => {});
    return;
  }
  // Reddit save for the newer login (token_v2): oauth.reddit.com, with the user's own token.
  if (msg?.type === 'reddit-oauth' && sender.tab && /^\/api\/(info|save|unsave)\b/.test(msg.path || '')) {
    fetch(`https://oauth.reddit.com${msg.path}`, {
      method: msg.method === 'POST' ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${msg.token}`,
        ...(msg.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: msg.method === 'POST' ? msg.body : undefined,
    })
      .then(async (res) => sendResponse({ ok: res.ok, status: res.status, json: await res.json().catch(() => null) }))
      .catch(() => sendResponse(null));
    return true;
  }
  if (msg?.type === 'save-report' && Array.isArray(msg.lines)) {
    chrome.storage.session.set({ lastSave: { lines: msg.lines.slice(0, 30), at: msg.at } }).catch(() => {});
    return;
  }
  if (msg?.type === 'get-shortcuts') {
    chrome.commands.getAll().then(
      (cmds) => sendResponse(cmds.filter((c) => c.shortcut && c.name !== '_execute_action')),
      () => sendResponse(null),
    );
    return true;
  }
  if (msg?.type === 'popup' && typeof msg.tabId === 'number') {
    const message = msg.command ? { type: 'command', command: msg.command } : { type: 'get-state' };
    sendToTab(msg.tabId, message).then(sendResponse, () => sendResponse(null));
    return true;
  }
});

// Make it work in tabs that were already open, without having to reload them.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Browsers don't let extensions set hotkeys to Global themselves, so walk the user through it.
  if (reason === 'install') chrome.tabs.create({ url: 'popup/welcome.html' }).catch(() => {});
  for (const tab of await chrome.tabs.query({ url: SITE_PATTERNS })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
  }
});
