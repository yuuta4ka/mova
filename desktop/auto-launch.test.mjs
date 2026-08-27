import { describe, expect, it } from 'vitest';
import { desktopAutoLaunchEnabled, desktopAutoLaunchError, desktopAutoLaunchQueryOptions, desktopAutoLaunchSettings } from './auto-launch.mjs';

describe('desktop auto-launch', () => {
  it('uses the same executable and hidden argument when setting and checking Windows auto-launch', () => {
    const path = 'C:\\Program Files\\Mova\\Mova.exe';
    expect(desktopAutoLaunchQueryOptions('win32', path)).toEqual({ path, args: ['--hidden'] });
    expect(desktopAutoLaunchSettings('win32', path, true)).toEqual({
      openAtLogin: true,
      path,
      args: ['--hidden'],
      enabled: true,
    });
    expect(desktopAutoLaunchSettings('win32', path, false)).toEqual({
      openAtLogin: false,
      path,
      args: ['--hidden'],
      enabled: false,
    });
  });

  it('uses the supported main app service on current macOS versions', () => {
    expect(desktopAutoLaunchQueryOptions('darwin', '/Applications/Mova.app/Contents/MacOS/Mova')).toEqual({ type: 'mainAppService' });
    expect(desktopAutoLaunchSettings('darwin', '/Applications/Mova.app/Contents/MacOS/Mova', true)).toEqual({
      openAtLogin: true,
      type: 'mainAppService',
    });
  });

  it('reports the operating system state instead of a stale local preference', () => {
    expect(desktopAutoLaunchEnabled('win32', { openAtLogin: true })).toBe(true);
    expect(desktopAutoLaunchEnabled('win32', { openAtLogin: false, executableWillLaunchAtLogin: true })).toBe(false);
    expect(desktopAutoLaunchEnabled('darwin', { openAtLogin: true, status: 'enabled' })).toBe(true);
    expect(desktopAutoLaunchEnabled('darwin', { openAtLogin: true, status: 'requires-approval' })).toBe(false);
    expect(desktopAutoLaunchError('darwin', { status: 'requires-approval' }, true)).toContain('Системные настройки');
  });
});
