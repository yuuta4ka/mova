import { fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

it('renders a branded updater result and returns button choices', async () => {
  document.body.innerHTML = `
    <main class="update-dialog" data-tone="info">
      <strong class="update-dialog__title"></strong>
      <button class="update-dialog__close"></button>
      <h1 id="update-dialog-message"></h1>
      <p id="update-dialog-detail"></p>
      <span class="update-dialog__meta" hidden></span>
      <footer class="update-dialog__actions"></footer>
    </main>
  `;
  const respond = vi.fn();
  const dispose = vi.fn();
  window.movaUpdateDialog = {
    onPayload(callback) {
      callback({
        tone: 'success',
        title: 'Обновление Mova',
        message: 'Всё обновлено',
        detail: 'У вас установлена актуальная версия Mova.',
        meta: 'Версия 0.1.10',
        buttons: ['Отлично'],
        defaultId: 0,
        cancelId: 0,
      });
      return dispose;
    },
    respond,
  };

  await import('./update-dialog.js?ui-test');

  expect(document.querySelector('.update-dialog')).toHaveAttribute('data-tone', 'success');
  expect(document.querySelector('#update-dialog-message')).toHaveTextContent('Всё обновлено');
  expect(document.querySelector('#update-dialog-detail')).toHaveTextContent('актуальная версия');
  expect(document.querySelector('.update-dialog__meta')).toHaveTextContent('Версия 0.1.10');
  expect(document.querySelector('.update-dialog__actions button')).toHaveClass('is-primary');

  fireEvent.click(document.querySelector('.update-dialog__actions button'));
  fireEvent.click(document.querySelector('.update-dialog__close'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(respond).toHaveBeenNthCalledWith(1, 0);
  expect(respond).toHaveBeenCalledTimes(3);

  window.dispatchEvent(new Event('beforeunload'));
  expect(dispose).toHaveBeenCalledOnce();
});
