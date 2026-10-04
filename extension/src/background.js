// GoonScroller background worker: routes hotkeys (including global ones that fire while another
// app or game has focus) and popup buttons to the right Reddit/X tab.
// Chrome runs this as a service worker; Firefox loads shared.js itself (manifest background.scripts).
if (!globalThis.GoonShared) importScripts('shared.js');

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

chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'auto-state' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: msg.on ? 'ON' : '' }).catch(() => {});
    if (msg.on) chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff4f6d' }).catch(() => {});
    return;
  }
  if (msg?.type === 'popup' && typeof msg.tabId === 'number') {
    const message = msg.command ? { type: 'command', command: msg.command } : { type: 'get-state' };
    sendToTab(msg.tabId, message).then(sendResponse, () => sendResponse(null));
    return true;
  }
});

// Make it work in tabs that were already open, without having to reload them.
chrome.runtime.onInstalled.addListener(async () => {
  for (const tab of await chrome.tabs.query({ url: SITE_PATTERNS })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
  }
});
