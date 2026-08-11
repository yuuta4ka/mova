import { fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

it('selects, starts, cancels, and releases desktop source previews', async () => {
  document.body.innerHTML = `
    <nav class="picker__tabs"></nav>
    <p class="picker__status"></p>
    <div class="picker__grid"></div>
    <button class="picker__close"></button>
    <button class="picker__cancel"></button>
    <button class="picker__start" disabled></button>
  `;
  const choose = vi.fn();
  const cancel = vi.fn();
  const dispose = vi.fn();
  window.movaSharePicker = {
    onSources(callback) {
      callback({
        tabs: ['window', 'screen'],
        sources: [
          { id: 'window:1:0', kind: 'window', name: 'Редактор', thumbnail: 'data:image/png;base64,d2luZG93', appIcon: '' },
          { id: 'screen:0:0', kind: 'screen', name: 'Экран 1', thumbnail: 'data:image/png;base64,c2NyZWVu', appIcon: '' },
        ],
      });
      return dispose;
    },
    choose,
    cancel,
  };

  await import('./share-picker.js?ui-test');

  const tabs = [...document.querySelectorAll('.picker__tab')];
  const start = document.querySelector('.picker__start');
  expect(tabs.map((tab) => tab.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Приложения'), expect.stringContaining('Весь экран')]));
  expect(document.querySelector('.picker__source.is-selected')).toHaveTextContent('Редактор');
  expect(start).toBeEnabled();

  fireEvent.click(tabs.find((tab) => tab.textContent.includes('Весь экран')));
  expect(document.querySelector('.picker__source.is-selected')).toHaveTextContent('Экран 1');
  fireEvent.click(start);
  expect(choose).toHaveBeenCalledWith('screen:0:0');

  fireEvent.click(document.querySelector('.picker__cancel'));
  fireEvent.click(document.querySelector('.picker__close'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(cancel).toHaveBeenCalledTimes(3);

  window.dispatchEvent(new Event('beforeunload'));
  expect(dispose).toHaveBeenCalledOnce();
  expect([...document.querySelectorAll('img')].every((image) => !image.hasAttribute('src'))).toBe(true);
});
