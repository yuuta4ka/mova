import { afterEach, describe, expect, it, vi } from 'vitest';
import { movaDocumentTitle, startUnreadTitleBlink, unreadDocumentTitle } from './documentTitle';

afterEach(() => {
  vi.useRealTimers();
  document.title = '';
});

describe('browser document title', () => {
  it('formats singular and plural unread messages', () => {
    expect(unreadDocumentTitle(1)).toBe('1 непрочитанное сообщение');
    expect(unreadDocumentTitle(5)).toBe('5 непрочитанных сообщений');
  });

  it('alternates unread messages with Mova every second and restores the title', () => {
    vi.useFakeTimers();
    const stop = startUnreadTitleBlink(3);

    expect(document.title).toBe(movaDocumentTitle);
    vi.advanceTimersByTime(1_000);
    expect(document.title).toBe('3 непрочитанных сообщений');
    vi.advanceTimersByTime(1_000);
    expect(document.title).toBe(movaDocumentTitle);

    stop();
    expect(document.title).toBe(movaDocumentTitle);
  });
});
