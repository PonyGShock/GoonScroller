document.getElementById('open').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

chrome.commands.getAll().then((commands) => {
  document.getElementById('shortcuts').replaceChildren(
    ...commands
      .filter((c) => c.name !== '_execute_action')
      .map((c) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        const key = document.createElement('kbd');
        name.textContent = c.description || c.name;
        key.textContent = c.shortcut || 'not set';
        key.classList.toggle('unset', !c.shortcut);
        li.append(name, key);
        return li;
      }),
  );
});
