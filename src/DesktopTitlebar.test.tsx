import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopTitlebar, type DesktopShellApi } from './DesktopTitlebar';

const shell = (overrides: Partial<DesktopShellApi> = {}): DesktopShellApi => ({
  platform: 'win32',
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn().mockResolvedValue(false),
  onMaximizedChange: vi.fn(() => () => undefined),
  ...overrides,
});

afterEach(() => {
  delete window.movaDesktopShell;
});

describe('Windows desktop titlebar', () => {
  it('exposes minimize, maximize, double-click, and close actions', async () => {
    const api = shell();
    window.movaDesktopShell = api;
    const { container } = render(<DesktopTitlebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть окно' }));
    fireEvent.doubleClick(container.querySelector('.mova-desktop-titlebar__identity')!);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(api.minimize).toHaveBeenCalledOnce();
    expect(api.toggleMaximize).toHaveBeenCalledTimes(2);
    expect(api.close).toHaveBeenCalledOnce();
  });

  it('tracks maximize and restore state from Electron', async () => {
    let update = (_maximized: boolean) => undefined;
    const api = shell({
      isMaximized: vi.fn().mockResolvedValue(true),
      onMaximizedChange: vi.fn((callback) => {
        update = callback;
        return () => undefined;
      }),
    });
    window.movaDesktopShell = api;
    render(<DesktopTitlebar />);

    expect(await screen.findByRole('button', { name: 'Восстановить окно' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить окно' }));
    expect(api.toggleMaximize).toHaveBeenCalledOnce();
    update(false);
    expect(await screen.findByRole('button', { name: 'Развернуть окно' })).toBeInTheDocument();
  });

  it('does not render outside Windows', () => {
    window.movaDesktopShell = shell({ platform: 'darwin' });
    const { container } = render(<DesktopTitlebar />);
    expect(container).toBeEmptyDOMElement();
  });
});
