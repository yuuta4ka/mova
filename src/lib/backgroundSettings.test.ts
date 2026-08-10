import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBackgroundColor, loadBackgroundColor, saveBackgroundColor } from './backgroundSettings';

describe('background settings', () => {
  beforeEach(() => localStorage.clear());

  it('uses a safe default for missing or malformed colors', () => {
    expect(loadBackgroundColor()).toBe(defaultBackgroundColor);
    localStorage.setItem('mova-background-color', 'red; background:url(x)');
    expect(loadBackgroundColor()).toBe(defaultBackgroundColor);
  });

  it('persists normalized colors and announces changes', () => {
    const listener = vi.fn();
    window.addEventListener('mova-background-color', listener);
    expect(saveBackgroundColor('#AABBCC')).toBe('#aabbcc');
    expect(loadBackgroundColor()).toBe('#aabbcc');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('mova-background-color', listener);
  });
});
