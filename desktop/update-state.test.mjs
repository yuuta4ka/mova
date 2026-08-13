import { describe, expect, it } from 'vitest';
import { desktopUpdateAction, normalizeUpdateProgress, updateCheckIntervalMs, updateStartupDelayMs } from './update-state.mjs';

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
  });

  it('keeps progress inside the taskbar range', () => {
    expect(normalizeUpdateProgress(-5)).toBe(0);
    expect(normalizeUpdateProgress(51.8)).toBe(52);
    expect(normalizeUpdateProgress(500)).toBe(100);
    expect(normalizeUpdateProgress(undefined)).toBe(0);
  });

  it('checks shortly after launch and then every four hours', () => {
    expect(updateStartupDelayMs).toBe(10_000);
    expect(updateCheckIntervalMs).toBe(14_400_000);
  });
});
