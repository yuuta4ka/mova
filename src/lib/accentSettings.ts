export const defaultAccentColor = '#8774e1';
export const accentPresets = ['#8774e1', '#4f9cf7', '#35b88f', '#e66b8a', '#e79245', '#c45ee0'];

const accentKey = 'mova-accent-color';
const normalizeColor = (value?: string | null) => (/^#[0-9a-f]{6}$/i.test(value || '') ? String(value).toLowerCase() : defaultAccentColor);

export function loadAccentColor() {
  try {
    return normalizeColor(localStorage.getItem(accentKey));
  } catch {
    return defaultAccentColor;
  }
}

export function saveAccentColor(color: string) {
  const normalized = normalizeColor(color);
  localStorage.setItem(accentKey, normalized);
  window.dispatchEvent(new CustomEvent<string>('mova-accent-color', { detail: normalized }));
  return normalized;
}
