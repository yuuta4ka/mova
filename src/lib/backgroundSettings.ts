export const defaultBackgroundColor = '#20293c';
export const backgroundPresets = ['#20293c', '#182c34', '#242238', '#30252a', '#202d27', '#2b2b2f'];

const backgroundKey = 'mova-background-color';
const normalizeColor = (value?: string | null) => (/^#[0-9a-f]{6}$/i.test(value || '') ? String(value).toLowerCase() : defaultBackgroundColor);

export function loadBackgroundColor() {
  try {
    return normalizeColor(localStorage.getItem(backgroundKey));
  } catch {
    return defaultBackgroundColor;
  }
}

export function saveBackgroundColor(color: string) {
  const normalized = normalizeColor(color);
  localStorage.setItem(backgroundKey, normalized);
  window.dispatchEvent(new CustomEvent<string>('mova-background-color', { detail: normalized }));
  return normalized;
}
