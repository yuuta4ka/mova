import { api, type AppConversation, type AppMessage, type AppUser } from './api';

let serverPushActive = false;

export function messageNotificationCopy(message: AppMessage, conversation?: AppConversation) {
  const groupTitle = conversation?.kind === 'group' ? conversation.title : '';
  const title = groupTitle ? `${message.author.name} · ${groupTitle}` : message.author.name;
  const content = message.content.trim();
  const body =
    content ||
    (message.attachment?.type.startsWith('image/')
      ? 'Фотография'
      : message.attachment?.type.startsWith('audio/') && message.attachment.durationMs
        ? 'Голосовое сообщение'
      : message.attachment
        ? `Файл: ${message.attachment.name}`
        : 'Новое сообщение');
  return { title, body };
}

const desktopShell = () => Boolean(window.movaDesktopShell);
export const shouldPlayMessageSoundInPage = (pageVisible: boolean, pageFocused: boolean, nativeNotificationSoundAvailable: boolean) =>
  (pageVisible && pageFocused) || !nativeNotificationSoundAvailable;
const pushSupported = () => !desktopShell() && 'serviceWorker' in navigator && 'PushManager' in window;
const base64Key = (value: string) => {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};

async function registerServerPush() {
  if (!pushSupported() || window.Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.register('/mova-sw.js', { scope: '/' });
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64Key((await api.pushConfig()).publicKey),
  });
  await api.savePushSubscription(subscription.toJSON());
  serverPushActive = true;
  return true;
}

export const shouldPromptForNotifications = () =>
  !desktopShell()
  && 'Notification' in window
  && window.Notification.permission === 'default';

export async function enableMessageNotifications() {
  if (desktopShell()) return { permission: 'granted' as NotificationPermission, pushActive: false };
  if (!('Notification' in window)) return { permission: 'denied' as NotificationPermission, pushActive: false };
  const permission = window.Notification.permission === 'default'
    ? await window.Notification.requestPermission()
    : window.Notification.permission;
  if (permission !== 'granted') return { permission, pushActive: false };
  let pushActive = false;
  try {
    pushActive = await registerServerPush();
  } catch (error) {
    console.warn('Web Push registration failed:', error);
  }
  return { permission, pushActive };
}

export async function restoreMessageNotifications() {
  if (desktopShell() || !('Notification' in window) || window.Notification.permission !== 'granted') return false;
  try {
    return await registerServerPush();
  } catch (error) {
    console.warn('Web Push restoration failed:', error);
    return false;
  }
}

export async function unregisterMessageNotifications() {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await api.deletePushSubscription(subscription.endpoint);
  } catch (error) {
    console.warn('Web Push unregistration failed:', error);
  } finally {
    serverPushActive = false;
  }
}

const showLocalNotification = (title: string, options: NotificationOptions, onClick: () => void, force = false) => {
  if (desktopShell()) {
    window.movaDesktopShell?.showNotification?.({
      kind: options.tag?.startsWith('mova-call-') ? 'call' : 'message',
      title,
      body: options.body || '',
      conversationId: options.tag?.replace(/^mova-(?:call|conversation)-/, '') || '',
    });
    return null;
  }
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return null;
  if (!desktopShell() && serverPushActive) return null;
  if (!force && document.visibilityState === 'visible' && document.hasFocus()) return null;
  const notification = new window.Notification(title, options);
  notification.onclick = () => {
    onClick();
    window.focus();
    notification.close();
  };
  return notification;
};

export function showMessageNotification(message: AppMessage, conversation: AppConversation | undefined, onClick: () => void) {
  const copy = messageNotificationCopy(message, conversation);
  return showLocalNotification(copy.title, {
    body: copy.body,
    icon: message.author.avatarDataUrl || '/icon-192.png',
    tag: `mova-conversation-${message.conversationId}`,
  }, onClick);
}

export function showIncomingCallNotification(conversationId: string, caller: AppUser, onClick: () => void) {
  return showLocalNotification(`Входящий звонок · ${caller.name}`, {
    body: 'Нажмите, чтобы открыть Mova',
    icon: caller.avatarDataUrl || '/icon-192.png',
    tag: `mova-call-${conversationId}`,
    requireInteraction: true,
  }, onClick, true);
}
