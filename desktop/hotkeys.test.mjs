import { describe, expect, it } from 'vitest';
import { desktopHotkeyEntries, isDesktopAccelerator, normalizeDesktopHotkeys, validateDesktopHotkeys } from './hotkeys.mjs';

describe('desktop hotkeys', () => {
  it('accepts Electron accelerators produced by the settings recorder', () => {
    expect(isDesktopAccelerator('CommandOrControl+Shift+M')).toBe(true);
    expect(isDesktopAccelerator('Alt+F12')).toBe(true);
    expect(isDesktopAccelerator('F8')).toBe(true);
    expect(isDesktopAccelerator('CommandOrControl+Space')).toBe(true);
    expect(isDesktopAccelerator('M')).toBe(false);
    expect(isDesktopAccelerator('CommandOrControl+Unknown')).toBe(false);
  });

  it('normalizes persisted values and rejects duplicate shortcuts', () => {
    expect(normalizeDesktopHotkeys({ toggleMicrophone: '  Control+M  ', toggleHeadphones: null })).toEqual({
      toggleMicrophone: 'Control+M',
      toggleHeadphones: '',
    });
    expect(validateDesktopHotkeys({ toggleMicrophone: 'Control+M', toggleHeadphones: 'Control+M' }).error)
      .toBe('Одно сочетание нельзя назначить двум действиям.');
  });

  it('maps saved settings to renderer actions', () => {
    expect(desktopHotkeyEntries({ toggleMicrophone: 'Control+M', toggleHeadphones: 'Control+D' })).toEqual([
      ['toggle-microphone', 'Control+M'],
      ['toggle-headphones', 'Control+D'],
    ]);
  });
});
