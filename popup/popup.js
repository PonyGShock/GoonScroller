const { DEFAULTS, DELAY_STEPS, PAGE_KEY_ACTIONS, nearestStep, formatDelay, formatKey } = globalThis.GoonShared;
const $ = (id) => document.getElementById(id);

const COMMAND_ORDER = ['next-post', 'previous-post', 'next-image', 'previous-image', 'toggle-auto', 'faster', 'slower', 'toggle-media-only', '_execute_action'];

let tabId = null;
let pageKeys = {};
let recording = null; // command whose key is being recorded

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

function renderPageKeys() {
  $('pageKeys').replaceChildren(
    ...PAGE_KEY_ACTIONS.map(([command, label]) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const button = document.createElement('button');
      name.textContent = label;
      button.dataset.command = command;
      button.textContent = recording === command ? 'press a key…' : formatKey(pageKeys[command]) || 'set';
      button.classList.toggle('unset', !pageKeys[command] && recording !== command);
      button.classList.toggle('recording', recording === command);
      button.addEventListener('click', () => {
        recording = recording === command ? null : command;
        renderPageKeys();
      });
      li.append(name, button);
      return li;
    }),
  );
}

function savePageKeys() {
  chrome.storage.sync.set({ pageKeys });
  renderPageKeys();
}

document.addEventListener('keydown', (e) => {
  if (!recording || MODIFIER_CODES.test(e.code)) return;
  e.preventDefault();
  if (e.code === 'Escape') {
    recording = null;
    return renderPageKeys();
  }
  if (e.code === 'Backspace' || e.code === 'Delete') {
    delete pageKeys[recording];
  } else {
    const spec = { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    // One key per action: take it away from any other action that had it.
    for (const [cmd, other] of Object.entries(pageKeys)) {
      if (formatKey(other) === formatKey(spec)) delete pageKeys[cmd];
    }
    pageKeys[recording] = spec;
  }
  recording = null;
  savePageKeys();
});

async function send(command) {
  if (tabId == null) return null;
  return chrome.runtime.sendMessage({ type: 'popup', tabId, command }).catch(() => null);
}

function render(state) {
  const ok = !!state?.site;
  $('site').textContent = ok ? state.site : 'Not on Reddit/X';
  $('site').classList.toggle('on', ok);
  $('unsupported').hidden = ok;
  for (const id of ['prev', 'next', 'auto', 'prevImage', 'nextImage']) $(id).disabled = !ok;
  $('auto').classList.toggle('on', !!state?.auto);
  $('auto').textContent = state?.auto ? '❚❚ Stop auto' : '▶ Auto';
}

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  $('keysMissing').hidden = commands.some((c) => c.name === 'next-post' && c.shortcut);
  commands.sort((a, b) => COMMAND_ORDER.indexOf(a.name) - COMMAND_ORDER.indexOf(b.name));
  $('shortcuts').replaceChildren(
    ...commands.map((c) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const key = document.createElement('kbd');
      name.textContent = c.name === '_execute_action' ? 'Open this panel' : c.description || c.name;
      key.textContent = c.shortcut || 'not set';
      key.classList.toggle('unset', !c.shortcut);
      li.append(name, key);
      return li;
    }),
  );
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  tabId = tab?.id ?? null;

  const settings = await chrome.storage.sync.get(DEFAULTS).catch(() => ({ ...DEFAULTS }));

  for (const box of document.querySelectorAll('input[data-key]')) {
    box.checked = !!settings[box.dataset.key];
    box.addEventListener('change', () => chrome.storage.sync.set({ [box.dataset.key]: box.checked }));
  }

  const slider = $('delay');
  const showDelay = () => ($('delayOut').textContent = formatDelay(DELAY_STEPS[slider.value]));
  slider.max = DELAY_STEPS.length - 1;
  slider.value = nearestStep(settings.delay);
  showDelay();
  slider.addEventListener('input', showDelay);
  slider.addEventListener('change', () => chrome.storage.sync.set({ delay: DELAY_STEPS[slider.value] }));

  $('prev').addEventListener('click', async () => render(await send('previous-post')));
  $('next').addEventListener('click', async () => render(await send('next-post')));
  $('auto').addEventListener('click', async () => render(await send('toggle-auto')));
  $('prevImage').addEventListener('click', async () => render(await send('previous-image')));
  $('nextImage').addEventListener('click', async () => render(await send('next-image')));

  pageKeys = { ...(settings.pageKeys || {}) };
  renderPageKeys();
  $('arrowPreset').addEventListener('click', () => {
    pageKeys = {
      ...pageKeys,
      'next-post': { code: 'ArrowDown' },
      'previous-post': { code: 'ArrowUp' },
      'next-image': { code: 'ArrowRight' },
      'previous-image': { code: 'ArrowLeft' },
    };
    savePageKeys();
  });
  $('editKeys').addEventListener('click', () => {
    if (chrome.commands.openShortcutSettings) chrome.commands.openShortcutSettings(); // Firefox
    else chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  renderShortcuts().catch(() => {});
  render(await send(null));
}

init().catch((err) => {
  // Keep the panel usable and show what went wrong instead of an empty box.
  $('unsupported').hidden = false;
  $('unsupported').textContent = `Something went wrong: ${err?.message || err}`;
});
