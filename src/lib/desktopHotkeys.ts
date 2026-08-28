import type { DesktopHotkeyAction, DesktopHotkeySettings } from '../DesktopTitlebar';

export const defaultDesktopHotkeySettings: DesktopHotkeySettings = {
  toggleMicrophone: '',
  toggleHeadphones: '',
};

export const desktopHotkeyActionLabels: Record<DesktopHotkeyAction, string> = {
  'toggle-microphone': 'Переключить микрофон',
  'toggle-headphones': 'Переключить наушники',
};

export const desktopHotkeySettingKey: Record<DesktopHotkeyAction, keyof DesktopHotkeySettings> = {
  'toggle-microphone': 'toggleMicrophone',
  'toggle-headphones': 'toggleHeadphones',
};

type HotkeyKeyboardEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const specialKeys: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
  MediaPlayPause: 'MediaPlayPause',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
};

export function hotkeyAcceleratorFromEvent(event: HotkeyKeyboardEvent, platform: string) {
  const modifiers: string[] = [];
  if (platform === 'darwin' ? event.metaKey : event.ctrlKey) modifiers.push('CommandOrControl');
  if (platform === 'darwin' && event.ctrlKey) modifiers.push('Control');
  if (platform !== 'darwin' && event.metaKey) modifiers.push('Super');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');

  const key = /^Key[A-Z]$/u.test(event.code)
    ? event.code.slice(3)
    : /^Digit[0-9]$/u.test(event.code)
      ? event.code.slice(5)
      : /^Numpad[0-9]$/u.test(event.code)
        ? `num${event.code.slice(6)}`
        : /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(event.code)
          ? event.code
          : specialKeys[event.code] || '';
  if (!key) return '';
  return [...modifiers, key].join('+');
}

export function formatDesktopHotkey(accelerator: string, platform: string) {
  if (!accelerator) return 'Не назначено';
  const macLabels: Record<string, string> = {
    CommandOrControl: '⌘',
    Command: '⌘',
    Control: '⌃',
    Super: '⌘',
    Alt: '⌥',
    Shift: '⇧',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
    Space: 'Пробел',
    Escape: 'Esc',
  };
  const otherLabels: Record<string, string> = {
    CommandOrControl: 'Ctrl',
    Command: 'Cmd',
    Control: 'Ctrl',
    Super: 'Win',
    Alt: 'Alt',
    Shift: 'Shift',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
    Space: 'Пробел',
    Escape: 'Esc',
  };
  const labels = platform === 'darwin' ? macLabels : otherLabels;
  return accelerator.split('+').map((part) => labels[part] || part).join(platform === 'darwin' ? ' ' : ' + ');
}
