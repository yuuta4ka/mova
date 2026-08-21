import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type AppConversation, type AppMessage, type AppUser } from './api';
import { enableMessageNotifications, messageNotificationCopy, shouldPlayMessageSoundInPage, showIncomingCallNotification } from './messageNotifications';

afterEach(() => {
  delete window.movaDesktopShell;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  it('uses the in-page sound in front or as a fallback without native notifications', () => {
    expect(shouldPlayMessageSoundInPage(true, true, true)).toBe(true);
    expect(shouldPlayMessageSoundInPage(false, false, true)).toBe(false);
    expect(shouldPlayMessageSoundInPage(false, false, false)).toBe(true);
  });

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

  it('asks for browser permission and persists a Web Push subscription', async () => {
    const subscription = { endpoint: 'https://push.example.test/subscription', toJSON: () => ({ endpoint: 'https://push.example.test/subscription', keys: { p256dh: 'key', auth: 'auth' } }) } as unknown as PushSubscription;
    const subscribe = vi.fn().mockResolvedValue(subscription);
    const register = vi.fn().mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe } });
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn().mockImplementation(async () => {
      Object.defineProperty(window.Notification, 'permission', { configurable: true, value: 'granted' });
      return 'granted';
    }) });
    vi.stubGlobal('PushManager', class PushManager {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { register } });
    vi.spyOn(api, 'pushConfig').mockResolvedValue({ publicKey: 'AQID' });
    const save = vi.spyOn(api, 'savePushSubscription').mockResolvedValue({ ok: true });

    await expect(enableMessageNotifications()).resolves.toEqual({ permission: 'granted', pushActive: true });
    expect(register).toHaveBeenCalledWith('/mova-sw.js', { scope: '/' });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(save).toHaveBeenCalledWith(subscription.toJSON());
  });

  it('uses the desktop native notification bridge without prompting', () => {
    const showNotification = vi.fn();
    window.movaDesktopShell = { platform: 'win32', minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(), showNotification };

    showIncomingCallNotification('chat', author, vi.fn());

    expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ kind: 'call', title: 'Входящий звонок · Аня', conversationId: 'chat' }));
  });
});
