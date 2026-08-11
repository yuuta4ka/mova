import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, session } from './api';

const originalUserAgent = navigator.userAgent;

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent });
});

describe('message attachments', () => {
  it('exposes the uploaded URL before posting so a failed message can retry the same upload', async () => {
    const uploadedAttachment = { name: 'retry.txt', type: 'text/plain', size: 5, url: '/uploads/retry.txt' };
    const serverMessage = {
      id: 'server-message',
      clientId: 'client-retry',
      conversationId: 'chat',
      authorId: 'me',
      content: 'Файл',
      attachment: uploadedAttachment,
      createdAt: '2026-08-10T00:00:00.000Z',
      sentAt: '2026-08-10T00:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Blob(['retry'], { type: 'text/plain' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attachment: uploadedAttachment }), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: serverMessage }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onAttachmentUploaded = vi.fn();

    await api.sendMessage('chat', 'Файл', { name: 'retry.txt', type: 'text/plain', size: 5, dataUrl: 'data:text/plain;base64,cmV0cnk=' }, undefined, 'client-retry', onAttachmentUploaded);

    expect(onAttachmentUploaded).toHaveBeenCalledWith(uploadedAttachment);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ content: 'Файл', attachment: uploadedAttachment, clientId: 'client-retry' });
  });
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
