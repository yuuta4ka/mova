const tabsHost = document.querySelector('.picker__tabs');
const grid = document.querySelector('.picker__grid');
const status = document.querySelector('.picker__status');
const startButton = document.querySelector('.picker__start');
const cancelButtons = [document.querySelector('.picker__cancel'), document.querySelector('.picker__close')];
const tabMeta = {
  window: { label: 'Приложения', icon: '▣' },
  screen: { label: 'Весь экран', icon: '▰' },
  device: { label: 'Устройства', icon: '●' },
};
let sources = [];
let tabs = [];
let activeTab = '';
let selectedId = '';

function chooseSource(sourceId) {
  selectedId = sourceId;
  renderSources();
}

function renderTabs() {
  tabsHost.replaceChildren(...tabs.map((kind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `picker__tab${activeTab === kind ? ' is-active' : ''}`;
    button.setAttribute('aria-current', activeTab === kind ? 'page' : 'false');
    button.textContent = `${tabMeta[kind].icon}  ${tabMeta[kind].label}`;
    button.addEventListener('click', () => {
      activeTab = kind;
      const selected = sources.find((source) => source.id === selectedId);
      if (!selected || selected.kind !== kind) selectedId = sources.find((source) => source.kind === kind)?.id || '';
      renderTabs();
      renderSources();
    });
    return button;
  }));
}

function sourceCard(source) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `picker__source${selectedId === source.id ? ' is-selected' : ''}`;
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', selectedId === source.id ? 'true' : 'false');
  card.title = source.name;

  const preview = document.createElement('span');
  preview.className = `picker__preview${source.thumbnail ? '' : ' is-empty'}`;
  if (source.thumbnail) {
    const image = document.createElement('img');
    image.src = source.thumbnail;
    image.alt = '';
    preview.append(image);
  }

  const title = document.createElement('span');
  title.className = 'picker__source-title';
  if (source.appIcon) {
    const icon = document.createElement('img');
    icon.src = source.appIcon;
    icon.alt = '';
    title.append(icon);
  } else {
    const icon = document.createElement('i');
    icon.textContent = source.kind === 'screen' ? '▰' : source.kind === 'device' ? '●' : '▣';
    title.append(icon);
  }
  const name = document.createElement('span');
  name.textContent = source.name;
  title.append(name);
  card.append(preview, title);
  card.addEventListener('click', () => chooseSource(source.id));
  card.addEventListener('dblclick', () => window.movaSharePicker.choose(source.id));
  return card;
}

function renderSources() {
  const visibleSources = sources.filter((source) => source.kind === activeTab);
  grid.replaceChildren(...visibleSources.map(sourceCard));
  status.hidden = visibleSources.length > 0;
  status.textContent = visibleSources.length ? '' : 'Источники этого типа не найдены';
  startButton.disabled = !sources.some((source) => source.id === selectedId && source.kind === activeTab);
}

const disposeSources = window.movaSharePicker.onSources((payload) => {
  sources = Array.isArray(payload?.sources) ? payload.sources : [];
  tabs = Array.isArray(payload?.tabs) ? payload.tabs.filter((kind) => tabMeta[kind]) : [];
  activeTab = tabs[0] || '';
  selectedId = sources.find((source) => source.kind === activeTab)?.id || '';
  renderTabs();
  renderSources();
});

startButton.addEventListener('click', () => {
  if (selectedId) window.movaSharePicker.choose(selectedId);
});
cancelButtons.forEach((button) => button.addEventListener('click', () => window.movaSharePicker.cancel()));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.movaSharePicker.cancel();
});
window.addEventListener('beforeunload', () => {
  disposeSources();
  document.querySelectorAll('img').forEach((image) => image.removeAttribute('src'));
  sources = [];
});
