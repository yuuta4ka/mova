import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAccentColor, loadAccentColor, saveAccentColor } from './accentSettings';

describe('accent settings', () => {
  beforeEach(() => localStorage.clear());

  it('loads the default and saves a custom accent', () => {
    expect(loadAccentColor()).toBe(defaultAccentColor);
    const listener = vi.fn();
    window.addEventListener('mova-accent-color', listener);
    expect(saveAccentColor('#35B88F')).toBe('#35b88f');
    expect(loadAccentColor()).toBe('#35b88f');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('mova-accent-color', listener);
  });

  it('rejects invalid colors', () => {
    expect(saveAccentColor('purple')).toBe(defaultAccentColor);
  });
});
