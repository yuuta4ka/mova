import type { AppConversation, AppMessage } from './api';

export function messageNotificationCopy(message: AppMessage, conversation?: AppConversation) {
  const groupTitle = conversation?.kind === 'group' ? conversation.title : '';
  const title = groupTitle ? `${message.author.name} · ${groupTitle}` : message.author.name;
  const content = message.content.trim();
  const body =
    content ||
    (message.attachment?.type.startsWith('image/')
      ? 'Фотография'
      : message.attachment
        ? `Файл: ${message.attachment.name}`
        : 'Новое сообщение');
  return { title, body };
}

export function requestMessageNotificationPermission() {
  if (!('Notification' in window) || window.Notification.permission !== 'default') return Promise.resolve(null);
  return window.Notification.requestPermission();
}

export function showMessageNotification(message: AppMessage, conversation: AppConversation | undefined, onClick: () => void) {
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return null;
  if (document.visibilityState === 'visible' && document.hasFocus()) return null;
  const copy = messageNotificationCopy(message, conversation);
  const notification = new window.Notification(copy.title, {
    body: copy.body,
    icon: message.author.avatarDataUrl || '/icon-192.png',
    tag: `mova-conversation-${message.conversationId}`,
    silent: true,
  });
  notification.onclick = () => {
    onClick();
    window.focus();
    notification.close();
  };
  return notification;
}
