export const movaDocumentTitle = 'Mova';

export const unreadDocumentTitle = (unreadCount: number) =>
  unreadCount === 1 ? '1 непрочитанное сообщение' : `${unreadCount} непрочитанных сообщений`;

export function startUnreadTitleBlink(unreadCount: number) {
  document.title = movaDocumentTitle;
  if (unreadCount <= 0) return () => {
    document.title = movaDocumentTitle;
  };

  let showUnread = false;
  const timer = window.setInterval(() => {
    showUnread = !showUnread;
    document.title = showUnread ? unreadDocumentTitle(unreadCount) : movaDocumentTitle;
  }, 1_000);

  return () => {
    window.clearInterval(timer);
    document.title = movaDocumentTitle;
  };
}
