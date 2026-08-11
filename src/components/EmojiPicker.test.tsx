import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emojiRecentStorageKey, loadRecentEmoji, recordRecentEmoji } from '../lib/emojiRecent';
import { AppleEmoji } from './AppleEmoji';
import { EmojiPicker } from './EmojiPicker';

beforeEach(() => window.localStorage.removeItem(emojiRecentStorageKey));
afterEach(() => vi.unstubAllGlobals());

describe('EmojiPicker', () => {
  it('switches categories, searches by metadata, clears search, and shows an empty state', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Здесь появятся часто используемые эмодзи')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Путешествия и места' }));
    expect(screen.getByRole('tab', { name: 'Путешествия и места' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('gridcell', { name: 'Earth Globe Europe-Africa' })).toBeVisible();
    expect(screen.queryByText('218')).not.toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Поиск эмодзи' });
    await user.type(search, 'rocket');
    expect(screen.getByRole('gridcell', { name: 'Rocket' })).toBeVisible();
    await user.clear(search);
    await user.type(search, 'definitely missing emoji');
    expect(screen.getByText('Ничего не найдено')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Очистить поиск эмодзи' }));
    expect(search).toHaveValue('');
    expect(screen.getByRole('gridcell', { name: 'Earth Globe Europe-Africa' })).toBeVisible();
  });

  it('keeps recent locally and ranks frequently used emoji first', () => {
    recordRecentEmoji('😀', 100);
    recordRecentEmoji('🚀', 200);
    recordRecentEmoji('😀', 300);

    expect(loadRecentEmoji()).toEqual([
      { emoji: '😀', count: 2, lastUsed: 300 },
      { emoji: '🚀', count: 1, lastUsed: 200 },
    ]);
    expect(window.localStorage.getItem(emojiRecentStorageKey)).toContain('lastUsed');
  });

  it('records selections and exposes them in Recent without closing the picker', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EmojiPicker onSelect={onSelect} onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox', { name: 'Поиск эмодзи' }), 'rocket');
    await user.click(screen.getByRole('gridcell', { name: 'Rocket' }));
    await user.click(screen.getByRole('tab', { name: 'Недавние' }));

    expect(onSelect).toHaveBeenCalledWith('🚀');
    expect(screen.getByRole('gridcell', { name: 'Rocket' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Выбор эмодзи' })).toBeVisible();
  });

  it('uses the mobile bottom-sheet state at a 390px viewport', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 600px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Выбор эмодзи' })).toHaveAttribute('data-layout', 'sheet');
    expect(screen.getByRole('searchbox', { name: 'Поиск эмодзи' })).toBeVisible();
    expect(screen.getAllByRole('tab')).toHaveLength(10);
  });

  it('supports arrow-key navigation between category tabs', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const recent = screen.getByRole('tab', { name: 'Недавние' });
    recent.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Смайлы и эмоции' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Смайлы и эмоции' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('AppleEmoji fallback', () => {
  it('replaces a failed Apple asset with safe readable emoji text', () => {
    const { container } = render(<AppleEmoji text="Готово 😀" />);
    const image = container.querySelector('img.emoji')!;
    expect(image).toHaveAttribute('alt', '😀');

    fireEvent.error(image);

    expect(container.querySelector('img.emoji')).not.toBeInTheDocument();
    expect(container.querySelector('.mova-emoji-fallback')).toHaveTextContent('😀');
    expect(container).toHaveTextContent('Готово 😀');
  });
});
