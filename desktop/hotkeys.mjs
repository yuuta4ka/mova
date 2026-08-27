export const desktopHotkeyActions = ['toggle-microphone', 'toggle-headphones'];

export const defaultDesktopHotkeys = {
  toggleMicrophone: '',
  toggleHeadphones: '',
};

const allowedModifiers = new Set(['CommandOrControl', 'Command', 'Control', 'Super', 'Alt', 'Shift']);
const allowedNamedKeys = new Set([
  'Space', 'Tab', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End',
  'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right',
]);

export function normalizeDesktopHotkeys(value) {
  return {
    toggleMicrophone: String(value?.toggleMicrophone || '').trim().slice(0, 80),
    toggleHeadphones: String(value?.toggleHeadphones || '').trim().slice(0, 80),
  };
}

export function isDesktopAccelerator(value) {
  if (!value) return true;
  const parts = String(value).split('+');
  if (parts.some((part) => !part)) return false;
  const key = parts.at(-1);
  const modifiers = parts.slice(0, -1);
  if (!modifiers.length) return /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(key);
  if (new Set(modifiers).size !== modifiers.length || modifiers.some((part) => !allowedModifiers.has(part))) return false;
  return /^[A-Z0-9]$/u.test(key)
    || /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(key)
    || allowedNamedKeys.has(key);
}

export function validateDesktopHotkeys(value) {
  const settings = normalizeDesktopHotkeys(value);
  if (!isDesktopAccelerator(settings.toggleMicrophone) || !isDesktopAccelerator(settings.toggleHeadphones)) {
    return { settings, error: 'Недопустимое сочетание клавиш.' };
  }
  if (settings.toggleMicrophone && settings.toggleMicrophone.toLowerCase() === settings.toggleHeadphones.toLowerCase()) {
    return { settings, error: 'Одно сочетание нельзя назначить двум действиям.' };
  }
  return { settings, error: '' };
}

export function desktopHotkeyEntries(settings) {
  return [
    ['toggle-microphone', settings.toggleMicrophone],
    ['toggle-headphones', settings.toggleHeadphones],
  ].filter((entry) => entry[1]);
}
