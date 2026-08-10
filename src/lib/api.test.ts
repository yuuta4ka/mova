import { afterEach, describe, expect, it } from 'vitest';
import { session } from './api';

const originalUserAgent = navigator.userAgent;

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
});

describe('session storage', () => {
  it('keeps browser sessions isolated per tab', () => {
    session.set('web-token');

    expect(sessionStorage.getItem('mova-session')).toBe('web-token');
    expect(localStorage.getItem('mova-session')).toBeNull();
  });

  it('persists a desktop session across windows and restarts', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'MovaDesktop/0.1.0' });

    session.set('desktop-token');

    expect(localStorage.getItem('mova-session')).toBe('desktop-token');
    expect(sessionStorage.getItem('mova-session')).toBeNull();
    expect(session.get()).toBe('desktop-token');
  });
});
