import { describe, expect, it } from 'vitest';
import { formatDesktopHotkey, hotkeyAcceleratorFromEvent } from './desktopHotkeys';

const event = (values: Partial<KeyboardEvent>) => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...values,
}) as KeyboardEvent;

describe('desktop hotkey recorder', () => {
  it('records portable command/control accelerators from physical keys', () => {
    expect(hotkeyAcceleratorFromEvent(event({ code: 'KeyM', ctrlKey: true, shiftKey: true }), 'win32'))
      .toBe('CommandOrControl+Shift+M');
    expect(hotkeyAcceleratorFromEvent(event({ code: 'KeyM', metaKey: true, shiftKey: true }), 'darwin'))
      .toBe('CommandOrControl+Shift+M');
  });

  it('rejects ordinary typing but permits function keys', () => {
    expect(hotkeyAcceleratorFromEvent(event({ code: 'KeyM' }), 'win32')).toBe('');
    expect(hotkeyAcceleratorFromEvent(event({ code: 'F8' }), 'darwin')).toBe('F8');
  });

  it('formats shortcuts for each desktop platform', () => {
    expect(formatDesktopHotkey('CommandOrControl+Shift+M', 'darwin')).toBe('⌘ ⇧ M');
    expect(formatDesktopHotkey('CommandOrControl+Shift+M', 'win32')).toBe('Ctrl + Shift + M');
  });
});
