const { DEFAULTS, DELAY_STEPS, nearestStep } = globalThis.GoonShared;
const $ = (id) => document.getElementById(id);

const COMMAND_ORDER = ['next-post', 'previous-post', 'toggle-auto', 'faster', 'slower', 'toggle-media-only', '_execute_action'];

let tabId = null;

async function send(command) {
  if (tabId == null) return null;
  return chrome.runtime.sendMessage({ type: 'popup', tabId, command }).catch(() => null);
}

function render(state) {
  const ok = !!state?.site;
  $('site').textContent = ok ? state.site : 'Not on Reddit/X';
  $('site').classList.toggle('on', ok);
  $('unsupported').hidden = ok;
  for (const id of ['prev', 'next', 'auto']) $(id).disabled = !ok;
  $('auto').classList.toggle('on', !!state?.auto);
  $('auto').textContent = state?.auto ? '❚❚ Stop auto' : '▶ Auto';
}

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;

  const settings = await chrome.storage.sync.get(DEFAULTS);

  for (const box of document.querySelectorAll('input[data-key]')) {
    box.checked = !!settings[box.dataset.key];
    box.addEventListener('change', () => chrome.storage.sync.set({ [box.dataset.key]: box.checked }));
  }

  const slider = $('delay');
  const showDelay = () => ($('delayOut').textContent = `${DELAY_STEPS[slider.value]}s`);
  slider.value = nearestStep(settings.delay);
  showDelay();
  slider.addEventListener('input', showDelay);
  slider.addEventListener('change', () => chrome.storage.sync.set({ delay: DELAY_STEPS[slider.value] }));

  $('prev').addEventListener('click', async () => render(await send('previous-post')));
  $('next').addEventListener('click', async () => render(await send('next-post')));
  $('auto').addEventListener('click', async () => render(await send('toggle-auto')));
  $('editKeys').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

  renderShortcuts();
  render(await send(null));
}

init();
