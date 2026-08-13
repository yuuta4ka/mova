import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopSharePicker } from './DesktopSharePicker';
import type { DesktopSharePickerRequest, DesktopShellApi } from './DesktopTitlebar';

const request: DesktopSharePickerRequest = {
  requestId: 'share-1',
  tabs: ['window', 'screen'],
  sources: [
    { id: 'window:1:0', kind: 'window', name: 'Редактор', displayId: '', thumbnail: 'data:image/png;base64,d2luZG93', appIcon: '' },
    { id: 'screen:0:0', kind: 'screen', name: 'Экран 1', displayId: '1', thumbnail: 'data:image/png;base64,c2NyZWVu', appIcon: '' },
  ],
};

afterEach(() => {
  delete window.movaDesktopShell;
});

describe('desktop share picker overlay', () => {
  it('selects a compact source card inside the current document', () => {
    let open: (payload: DesktopSharePickerRequest) => void = () => undefined;
    const chooseShareSource = vi.fn();
    window.movaDesktopShell = {
      platform: 'win32',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => () => undefined),
      onSharePickerRequest: vi.fn((callback) => {
        open = callback;
        return () => undefined;
      }),
      chooseShareSource,
      cancelSharePicker: vi.fn(),
    } satisfies DesktopShellApi;

    render(<DesktopSharePicker />);
    act(() => open(request));

    expect(screen.getByRole('dialog', { name: 'Демонстрация экрана' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Редактор' })).toHaveClass('is-selected');

    fireEvent.click(screen.getByRole('button', { name: 'Весь экран' }));
    expect(screen.getByRole('option', { name: 'Экран 1' })).toHaveClass('is-selected');
    fireEvent.click(screen.getByRole('button', { name: 'Начать демонстрацию' }));

    expect(chooseShareSource).toHaveBeenCalledWith('share-1', 'screen:0:0');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels the in-window picker with Escape', () => {
    let open: (payload: DesktopSharePickerRequest) => void = () => undefined;
    const cancelSharePicker = vi.fn();
    window.movaDesktopShell = {
      platform: 'darwin',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => () => undefined),
      onSharePickerRequest: (callback) => {
        open = callback;
        return () => undefined;
      },
      chooseShareSource: vi.fn(),
      cancelSharePicker,
    };

    render(<DesktopSharePicker />);
    act(() => open(request));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(cancelSharePicker).toHaveBeenCalledWith('share-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
