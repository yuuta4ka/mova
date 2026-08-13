import { describe, expect, it } from 'vitest';
import type { AppConversation, AppMessage, AppUser } from './api';
import { clearPersistentUserData, deletePersistentConversation, loadPersistentClientState, persistConversations, persistMessages, persistOutbox, persistUsers } from './persistentClientStore';

const user: AppUser = { id: 'persistent-user', name: 'Юта', email: 'persistent@mova.test', handle: '@persistent', color: '#74DCCB', presence: 'online', createdAt: '2026-08-13T00:00:00.000Z' };
const friend: AppUser = { ...user, id: 'persistent-friend', email: 'friend@mova.test', handle: '@friend' };
const conversation: AppConversation = { id: 'persistent-chat', kind: 'direct', title: 'Друг', members: [user, friend], lastMessage: null, createdAt: '2026-08-13T00:00:00.000Z' };
const message: AppMessage = {
  id: 'persistent-client',
  clientId: 'persistent-client',
  conversationId: conversation.id,
  authorId: user.id,
  author: user,
  content: 'Сообщение переживёт перезапуск',
  attachment: { name: 'offline.txt', type: 'text/plain', size: 7, dataUrl: 'data:text/plain;base64,b2ZmbGluZQ==' },
  createdAt: '2026-08-13T01:00:00.000Z',
  deliveryState: 'queued',
};

describe('persistent client store', () => {
  it('round-trips cache metadata and an attachment-bearing outbox entry', async () => {
    await persistConversations(user.id, { value: [conversation], updatedAt: 10 });
    await persistUsers(user.id, { value: [friend], updatedAt: 11 });
    await persistMessages(user.id, conversation.id, { value: [message], updatedAt: 12, hasMore: true, nextCursor: 'cursor' });
    await persistOutbox({ clientId: message.clientId!, userId: user.id, conversationId: conversation.id, message, attempts: 2, updatedAt: 13, lastError: 'offline' });

    const restored = await loadPersistentClientState(user.id);

    expect(restored.conversations).toEqual({ value: [conversation], updatedAt: 10, hasMore: undefined, nextCursor: undefined });
    expect(restored.users?.value).toEqual([friend]);
    expect(restored.messages.get(conversation.id)).toMatchObject({ value: [message], hasMore: true, nextCursor: 'cursor' });
    expect(restored.outbox).toEqual([expect.objectContaining({ clientId: message.clientId, attempts: 2, message: expect.objectContaining({ attachment: message.attachment }) })]);
  });

  it('isolates accounts and deletes a conversation together with its outbox', async () => {
    await persistMessages(user.id, conversation.id, { value: [message], updatedAt: 1 });
    await persistOutbox({ clientId: message.clientId!, userId: user.id, conversationId: conversation.id, message, attempts: 0, updatedAt: 1 });
    await persistUsers('other-user', { value: [{ ...friend, id: 'other-user' }], updatedAt: 1 });

    await deletePersistentConversation(user.id, conversation.id);
    const deleted = await loadPersistentClientState(user.id);
    const other = await loadPersistentClientState('other-user');

    expect(deleted.messages.size).toBe(0);
    expect(deleted.outbox).toHaveLength(0);
    expect(other.users?.value[0].id).toBe('other-user');

    await clearPersistentUserData('other-user');
    expect((await loadPersistentClientState('other-user')).users).toBeUndefined();
  });
});
