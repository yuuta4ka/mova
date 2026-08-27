const dialog = document.querySelector('.update-dialog');
const title = document.querySelector('.update-dialog__title');
const message = document.querySelector('#update-dialog-message');
const detail = document.querySelector('#update-dialog-detail');
const meta = document.querySelector('.update-dialog__meta');
const actions = document.querySelector('.update-dialog__actions');
const closeButton = document.querySelector('.update-dialog__close');
let cancelId = 0;

function respond(index) {
  window.movaUpdateDialog.respond(index);
}

const disposePayload = window.movaUpdateDialog.onPayload((payload = {}) => {
  const tone = ['success', 'update', 'error', 'info'].includes(payload.tone) ? payload.tone : 'info';
  const buttons = Array.isArray(payload.buttons) && payload.buttons.length ? payload.buttons : ['Понятно'];
  const defaultId = Number.isInteger(payload.defaultId) ? payload.defaultId : 0;
  cancelId = Number.isInteger(payload.cancelId) ? payload.cancelId : buttons.length - 1;
  dialog.dataset.tone = tone;
  document.title = String(payload.title || 'Обновление Mova');
  title.textContent = document.title;
  message.textContent = String(payload.message || 'Обновление Mova');
  detail.textContent = String(payload.detail || '');
  detail.hidden = !detail.textContent;
  meta.textContent = String(payload.meta || '');
  meta.hidden = !meta.textContent;
  actions.replaceChildren(...buttons.map((label, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(label);
    button.classList.toggle('is-primary', index === defaultId);
    button.addEventListener('click', () => respond(index));
    return button;
  }));
  actions.querySelector('.is-primary')?.focus();
});

closeButton.addEventListener('click', () => respond(cancelId));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') respond(cancelId);
});
window.addEventListener('beforeunload', disposePayload);
