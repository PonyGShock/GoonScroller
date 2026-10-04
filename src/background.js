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
  setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 1200);
}

// Remembers the last hotkey for the panel's "Last hotkey" line, to see where things stop.
async function onHotkey(command, tab) {
  let outcome;
  try {
    const target = await findTargetTab(tab);
    if (!target) outcome = 'no Reddit/X tab showing';
    else outcome = (await sendToTab(target.id, { type: 'command', command }).catch(() => null)) ? 'sent' : 'tab did not answer';
  } catch (err) {
    outcome = `error: ${err?.message || err}`;
  }
  flashBadge(outcome === 'sent' ? '•' : '?');
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
