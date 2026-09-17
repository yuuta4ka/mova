import { describe, expect, it } from 'vitest';
import {
  desktopCurrentReleaseDate,
  desktopReleaseDownloadUrl,
  desktopUpdateAction,
  desktopUpdateErrorKind,
  normalizeUpdateProgress,
  updateCheckIntervalMs,
  updateCheckTimeoutMs,
  updateRetryDelayMs,
  updateStartupDelayMs,
} from './update-state.mjs';

describe('desktop update state', () => {
  it('describes each updater phase for the desktop menu', () => {
    expect(desktopUpdateAction()).toEqual({ label: 'Проверить обновления…', enabled: true, action: 'check' });
    expect(desktopUpdateAction({ phase: 'checking' })).toEqual({ label: 'Проверяем обновления…', enabled: false, action: 'none' });
    expect(desktopUpdateAction({ phase: 'downloading', progress: 42.4 })).toEqual({
      label: 'Загрузка обновления… 42%', enabled: false, action: 'none',
    });
    expect(desktopUpdateAction({ phase: 'downloaded', version: '0.2.0' })).toEqual({
      label: 'Установить Mova 0.2.0…', enabled: true, action: 'install',
    });
    expect(desktopUpdateAction({ phase: 'available', version: '0.2.0' })).toEqual({
      label: 'Скачать Mova 0.2.0…', enabled: true, action: 'download',
    });
  });

  it('keeps progress inside the taskbar range', () => {
    expect(normalizeUpdateProgress(-5)).toBe(0);
    expect(normalizeUpdateProgress(51.8)).toBe(52);
    expect(normalizeUpdateProgress(500)).toBe(100);
    expect(normalizeUpdateProgress(undefined)).toBe(0);
  });

  it('checks shortly after launch and then every four hours', () => {
    expect(desktopCurrentReleaseDate).toBe('2026-09-18');
    expect(updateStartupDelayMs).toBe(10_000);
    expect(updateCheckIntervalMs).toBe(14_400_000);
    expect(updateCheckTimeoutMs).toBe(30_000);
    expect(updateRetryDelayMs).toBe(300_000);
  });

  it('builds safe manual update URLs and classifies updater failures', () => {
    expect(desktopReleaseDownloadUrl('1.2.3', 'darwin')).toBe(
      'https://github.com/yuuta4ka/mova/releases/download/v1.2.3/Mova-1.2.3-arm64.dmg',
    );
    expect(desktopReleaseDownloadUrl('1.2.3', 'win32')).toBe(
      'https://github.com/yuuta4ka/mova/releases/download/v1.2.3/Mova.Setup.1.2.3.exe',
    );
    expect(desktopReleaseDownloadUrl('../../bad', 'darwin')).toBe('https://github.com/yuuta4ka/mova/releases/latest');
    expect(desktopUpdateErrorKind(new Error('net::ERR_CONNECTION_TIMED_OUT'))).toBe('network');
    expect(desktopUpdateErrorKind(new Error('code signature did not pass validation'))).toBe('installation');
    expect(desktopUpdateErrorKind(new Error('unexpected updater failure'))).toBe('unknown');
  });
});
