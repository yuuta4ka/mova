import { describe, expect, it } from 'vitest';
import type { AppMessage, AppUser } from './api';
import { canGroupMessages, formatMessageDay, getMessageStructure } from './messageGrouping';

const author: AppUser = {
  id: 'author',
  name: 'Автор',
  email: 'author@mova.test',
  handle: '@author',
  color: '#8774e1',
  presence: 'online',
  createdAt: '2026-08-10T00:00:00.000Z',
};

const message = (id: string, createdAt: string, overrides: Partial<AppMessage> = {}): AppMessage => ({
  id,
  conversationId: 'chat',
  authorId: author.id,
  author,
  content: id,
  createdAt,
  ...overrides,
});

describe('message structure', () => {
  it('keeps the same author grouped through exactly five minutes, then starts a new block', () => {
    const first = message('first', '2026-08-10T12:00:00');
    const atFiveMinutes = message('five', '2026-08-10T12:05:00');
    const afterFiveMinutes = message('later', '2026-08-10T12:10:01');

    expect(canGroupMessages(first, atFiveMinutes)).toBe(true);
    expect(canGroupMessages(atFiveMinutes, afterFiveMinutes)).toBe(false);
    expect(getMessageStructure([first, atFiveMinutes, afterFiveMinutes], new Date('2026-08-10T18:00:00'))).toMatchObject([
      { startsGroup: true, endsGroup: false },
      { startsGroup: false, endsGroup: true },
      { startsGroup: true, endsGroup: true },
    ]);
  });

  it('breaks a group and starts a day at the local midnight boundary', () => {
    const beforeMidnight = message('before', '2026-08-10T23:59:00');
    const afterMidnight = message('after', '2026-08-11T00:01:00');
    const structure = getMessageStructure([beforeMidnight, afterMidnight], new Date('2026-08-11T12:00:00'));

    expect(structure).toMatchObject([
      { startsDay: true, dayLabel: 'Вчера', startsGroup: true, endsGroup: true },
      { startsDay: true, dayLabel: 'Сегодня', startsGroup: true, endsGroup: true },
    ]);
  });

  it('uses a calendar label and includes the year only when it differs', () => {
    const now = new Date('2026-08-11T12:00:00');
    expect(formatMessageDay('2026-08-01T09:00:00', now)).toBe('1 августа');
    expect(formatMessageDay('2025-08-11T09:00:00', now)).toMatch(/^11 августа 2025/);
  });

  it('uses call messages as hard block boundaries', () => {
    const first = message('first', '2026-08-10T12:00:00');
    const call = message('call', '2026-08-10T12:01:00', { kind: 'call', call: { status: 'completed', durationSeconds: 10, startedAt: '2026-08-10T12:00:40', endedAt: '2026-08-10T12:00:50' } });
    const last = message('last', '2026-08-10T12:02:00');

    expect(getMessageStructure([first, call, last])).toMatchObject([
      { startsGroup: true, endsGroup: true },
      { startsGroup: true, endsGroup: true },
      { startsGroup: true, endsGroup: true },
    ]);
  });
});
