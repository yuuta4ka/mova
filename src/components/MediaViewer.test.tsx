import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppMessage, AppUser, MessageAttachment } from '../lib/api';
import { buildMediaGallery, MediaViewer, mediaViewerMaxZoom, mediaViewerMinZoom, type MediaViewerItem } from './MediaViewer';

const attachment = (name: string): MessageAttachment => ({
  name,
  type: 'image/png',
  size: 128,
  dataUrl: `data:image/png;base64,${name}`,
});

const items: MediaViewerItem[] = [
  { id: 'first', attachment: attachment('first.png') },
  { id: 'second', attachment: attachment('second.png') },
  { id: 'third', attachment: attachment('third.png') },
];

const viewer = (props: Partial<ComponentProps<typeof MediaViewer>> = {}) =>
  render(<MediaViewer items={items} activeId="first" onClose={vi.fn()} {...props} />);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MediaViewer controls', () => {
  it('closes with Escape using the closing transition', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    viewer({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toHaveClass('is-closing');
    act(() => vi.advanceTimersByTime(211));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the dimmed background is clicked', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = viewer({ onClose });

    fireEvent.click(container.querySelector('.mova-media-viewer__stage')!);
    act(() => vi.advanceTimersByTime(211));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clamps zoom and resets scale and pan state', () => {
    const { container } = viewer();
    const dialog = screen.getByRole('dialog');
    const zoomIn = screen.getByRole('button', { name: 'Увеличить' });

    for (let index = 0; index < 10; index += 1) fireEvent.click(zoomIn);
    expect(dialog).toHaveAttribute('data-zoom', mediaViewerMaxZoom.toFixed(2));
    expect(zoomIn).toBeDisabled();

    fireEvent.pointerDown(container.querySelector('.mova-media-viewer__surface')!, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(container.querySelector('.mova-media-viewer__surface')!, { pointerId: 1, pointerType: 'mouse', clientX: 180, clientY: 145 });
    fireEvent.pointerUp(container.querySelector('.mova-media-viewer__surface')!, { pointerId: 1, pointerType: 'mouse', clientX: 180, clientY: 145 });

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить масштаб' }));
    expect(dialog).toHaveAttribute('data-zoom', mediaViewerMinZoom.toFixed(2));
    expect(screen.queryByRole('button', { name: 'Сбросить масштаб' })).not.toBeInTheDocument();
  });

  it('moves to next and previous images with controls', () => {
    viewer();

    fireEvent.click(screen.getByRole('button', { name: 'Следующее изображение' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Просмотр изображения second.png');
    expect(screen.getByText('2 / 3')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущее изображение' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Просмотр изображения first.png');
  });

  it('supports keyboard gallery navigation', () => {
    viewer();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Просмотр изображения second.png');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Просмотр изображения first.png');
  });
});

describe('MediaViewer gallery and mobile state', () => {
  it('excludes non-images, missing sources, and call/system messages from gallery navigation', () => {
    const author: AppUser = { id: 'u', name: 'User', email: 'u@test', handle: '@u', color: '#000', presence: 'online', createdAt: '2026-08-12T00:00:00.000Z' };
    const message = (id: string, candidate?: MessageAttachment, kind?: AppMessage['kind']): AppMessage => ({
      id,
      conversationId: 'chat',
      authorId: author.id,
      author,
      content: '',
      attachment: candidate,
      kind,
      createdAt: '2026-08-12T00:00:00.000Z',
    });
    const gallery = buildMediaGallery([
      message('image', attachment('included.png')),
      message('file', { name: 'notes.txt', type: 'text/plain', size: 4, dataUrl: 'data:text/plain,notes' }),
      message('call-image', attachment('system.png'), 'call'),
      message('missing-source', { name: 'missing.png', type: 'image/png', size: 1 }),
    ]);

    expect(gallery.map((item) => item.id)).toEqual(['image']);
  });

  it('uses fullscreen mobile state and swipes between images', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 700px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const { container } = viewer();
    const dialog = screen.getByRole('dialog');
    const surface = container.querySelector('.mova-media-viewer__surface')!;
    expect(dialog).toHaveAttribute('data-layout', 'mobile');

    fireEvent.pointerDown(surface, { pointerId: 7, pointerType: 'touch', clientX: 320, clientY: 300 });
    fireEvent.pointerMove(surface, { pointerId: 7, pointerType: 'touch', clientX: 210, clientY: 304 });
    fireEvent.pointerUp(surface, { pointerId: 7, pointerType: 'touch', clientX: 210, clientY: 304 });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Просмотр изображения second.png');
  });
});
