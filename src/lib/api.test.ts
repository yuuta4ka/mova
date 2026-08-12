import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, RealtimeClient, session } from './api';

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

describe('realtime reconnect', () => {
  it('reconnects with the same authorization and delivers incoming call events after a brief disconnect', () => {
    vi.useFakeTimers();
    session.set('realtime-token');
    const sockets: MockSocket[] = [];
    class MockSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = MockSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((message: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      sent: string[] = [];
      constructor(readonly url: string) { sockets.push(this); }
      open() { this.readyState = MockSocket.OPEN; this.onopen?.(); }
      receive(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
      send(message: string) { this.sent.push(message); }
      close() { this.readyState = 3; this.onclose?.(); }
    }
    vi.stubGlobal('WebSocket', MockSocket);
    const client = new RealtimeClient();
    const listener = vi.fn();
    client.subscribe(listener);

    client.connect();
    expect(sockets[0].url).toContain('/ws?token=realtime-token');
    sockets[0].open();
    sockets[0].close();
    expect(listener).toHaveBeenCalledWith({ type: 'realtime:disconnected' });
    vi.advanceTimersByTime(500);

    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toContain('/ws?token=realtime-token');
    sockets[1].open();
    sockets[1].receive({ type: 'call:invite', conversationId: 'chat', from: { id: 'friend' }, createdAt: '2026-08-12T00:00:00.000Z' });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'call:invite', conversationId: 'chat' }));
    client.close();
    vi.useRealTimers();
  });
});
