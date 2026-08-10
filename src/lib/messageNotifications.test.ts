import { describe, expect, it } from 'vitest';
import type { AppConversation, AppMessage, AppUser } from './api';
import { messageNotificationCopy } from './messageNotifications';

const author: AppUser = {
  id: 'friend',
  name: 'Аня',
  email: 'friend@mova.test',
  handle: '@friend',
  color: '#74dccb',
  presence: 'online',
  createdAt: '2026-08-10T00:00:00.000Z',
};
const message: AppMessage = {
  id: 'message',
  conversationId: 'chat',
  authorId: author.id,
  content: 'Увидимся вечером?',
  createdAt: '2026-08-10T12:00:00.000Z',
  author,
};

describe('message notification copy', () => {
  it('uses the sender name in a direct chat', () => {
    expect(messageNotificationCopy(message)).toEqual({ title: 'Аня', body: 'Увидимся вечером?' });
  });

  it('includes a group name and describes an image attachment', () => {
    const group = { kind: 'group', title: 'Команда' } as AppConversation;
    const imageMessage = {
      ...message,
      content: '',
      attachment: { name: 'photo.png', type: 'image/png', size: 100, dataUrl: 'data:image/png;base64,' },
    };
    expect(messageNotificationCopy(imageMessage, group)).toEqual({ title: 'Аня · Команда', body: 'Фотография' });
  });
});
