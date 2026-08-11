import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPresenceStatus, PendingCallStage, Product, ProfileEditor, RealMessages, reconcileClientMessage, sortConversationsByActivity, updateConversationLastMessage } from './RealApp';
import { api, realtime, type AppConversation, type AppMessage, type AppUser } from './lib/api';
import { ToastProvider } from './components/Primitives';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const currentUser: AppUser = {
  id: 'me',
  name: 'Юта',
  email: 'me@mova.test',
  handle: '@yuuta',
  color: '#74DCCB',
  presence: 'online',
  createdAt: '2026-08-10T00:00:00.000Z',
};
const friend: AppUser = {
  id: 'friend',
  name: 'Друг',
  email: 'friend@mova.test',
  handle: '@friend',
  color: '#9B83F4',
  presence: 'online',
  createdAt: '2026-08-10T00:00:00.000Z',
};
const conversation: AppConversation = {
  id: 'chat',
  kind: 'direct',
  title: 'Друг',
  members: [currentUser, friend],
  lastMessage: null,
  createdAt: '2026-08-10T00:00:00.000Z',
};

describe('presence status', () => {
  const now = new Date('2026-08-10T12:00:00.000Z').getTime();
  it('uses the live connection state instead of a stale presence value', () => {
    expect(
      formatPresenceStatus(
        {
          ...friend,
          presence: 'online',
          isOnline: false,
          lastActiveAt: '2026-08-10T11:55:00.000Z',
        },
        now,
      ),
    ).toBe('был(а) 5 минут назад');
    expect(formatPresenceStatus({ ...friend, isOnline: true }, now)).toBe('в сети');
  });
  it('formats hours and days with Russian plural forms', () => {
    expect(
      formatPresenceStatus(
        {
          ...friend,
          isOnline: false,
          lastActiveAt: '2026-08-10T09:00:00.000Z',
        },
        now,
      ),
    ).toBe('был(а) 3 часа назад');
    expect(
      formatPresenceStatus(
        {
          ...friend,
          isOnline: false,
          lastActiveAt: '2026-08-08T12:00:00.000Z',
        },
        now,
      ),
    ).toBe('был(а) 2 дня назад');
  });
});

describe('profile editor polish', () => {
  it('uses one username shell and edits the value without @ while preserving profile data', async () => {
    const user = userEvent.setup();
    const profileUser: AppUser = { ...currentUser, bio: 'О себе', activity: { name: 'Minecraft', startedAt: '2026-08-10T10:00:00.000Z' } };
    const updated = { ...profileUser, handle: '@new_name' };
    const update = vi.spyOn(api, 'updateProfile').mockResolvedValue({ user: updated });
    const onSaved = vi.fn();
    render(<ProfileEditor user={profileUser} open onClose={vi.fn()} onSaved={onSaved} />);

    expect(screen.getByLabelText('Имя')).toHaveValue('Юта');
    const handle = screen.getByLabelText('Имя пользователя');
    expect(handle).toHaveValue('yuuta');
    const usernameShell = handle.closest('.mova-profile-username-field');
    expect(usernameShell).toContainElement(screen.getByText('@', { selector: '.mova-profile-username-field>span' }));
    expect(usernameShell?.querySelectorAll('input')).toHaveLength(1);
    expect(getComputedStyle(handle).borderTopStyle).toBe('none');
    expect(['', 'none']).toContain(getComputedStyle(handle).boxShadow);
    expect(screen.queryByText('3–24 латинских символа, цифры, точка или подчёркивание.')).not.toBeInTheDocument();
    expect(screen.queryByText('Текущая активность')).not.toBeInTheDocument();

    await user.clear(handle);
    await user.type(handle, '@New_Name');
    expect(handle).toHaveValue('new_name');
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ handle: '@new_name', bio: 'О себе', activity: profileUser.activity }));
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it('removes the status indicator only from the large profile preview', () => {
    const { container } = render(<ProfileEditor user={currentUser} open onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(container.querySelector('.mova-profile-preview .mova-avatar')).toBeInTheDocument();
    expect(container.querySelector('.mova-profile-preview .mova-status-indicator')).not.toBeInTheDocument();
  });

  it('auto-grows and shrinks the bio, caps its height, and removes native resize', () => {
    let scrollHeight = 148;
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    render(<ProfileEditor user={{ ...currentUser, bio: 'Существующее описание' }} open onClose={vi.fn()} onSaved={vi.fn()} />);
    const bio = screen.getByLabelText('О себе');
    expect(bio).toHaveValue('Существующее описание');
    expect(bio).toHaveStyle({ height: '148px', overflowY: 'hidden' });

    fireEvent.change(bio, { target: { value: 'Строка\n'.repeat(8) } });
    expect(bio).toHaveStyle({ height: '148px', overflowY: 'hidden' });

    scrollHeight = 70;
    fireEvent.change(bio, { target: { value: 'Коротко' } });
    expect(bio).toHaveStyle({ height: '96px', overflowY: 'hidden' });

    scrollHeight = 300;
    fireEvent.change(bio, { target: { value: 'Длинное описание '.repeat(10) } });
    expect(bio).toHaveStyle({ height: '224px', overflowY: 'auto' });
    expect(getComputedStyle(bio).resize).toBe('none');
  });

  it('shows the bio counter and prevents exceeding the existing 240-character limit', () => {
    render(<ProfileEditor user={currentUser} open onClose={vi.fn()} onSaved={vi.fn()} />);
    const bio = screen.getByLabelText('О себе');

    fireEvent.change(bio, { target: { value: 'а'.repeat(245) } });

    expect(bio).toHaveValue('а'.repeat(240));
    expect(bio).toHaveAttribute('maxlength', '240');
    expect(screen.getByText('240 / 240 · лимит')).toHaveClass('is-near-limit', 'is-at-limit');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows save errors as a shared toast and resets dismissal after the latest error', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'updateProfile').mockRejectedValue(new Error('Юзернейм начинается с @ и содержит 3–24 латинских символа'));
    render(<ToastProvider><ProfileEditor user={currentUser} open onClose={vi.fn()} onSaved={vi.fn()} /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
    await act(async () => Promise.resolve());
    expect(screen.getByRole('alert')).toHaveTextContent('Имя пользователя должно содержать 3–24 латинских символа, цифры, точку или подчёркивание.');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/юзернейм|начинается с @/iu);

    act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
    await act(async () => Promise.resolve());
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(101));
    expect(screen.getByRole('alert')).toHaveClass('is-closing');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(190));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('conversation overview updates', () => {
  const olderConversation: AppConversation = { ...conversation, id: 'older', createdAt: '2026-08-10T09:00:00.000Z' };
  const newerConversation: AppConversation = { ...conversation, id: 'newer', createdAt: '2026-08-10T10:00:00.000Z' };
  const latestMessage: AppMessage = {
    id: 'latest',
    conversationId: 'older',
    authorId: friend.id,
    content: 'Новое сообщение',
    createdAt: '2026-08-10T11:00:00.000Z',
    author: friend,
  };

  it('updates the last-message preview and raises its conversation', () => {
    const result = updateConversationLastMessage([newerConversation, olderConversation], latestMessage);
    expect(result.map((item) => item.id)).toEqual(['older', 'newer']);
    expect(result[0].lastMessage?.content).toBe('Новое сообщение');
  });

  it('does not replace a preview when an older message is edited', () => {
    const current = updateConversationLastMessage([olderConversation], latestMessage);
    const olderEdit = { ...latestMessage, id: 'older-message', content: 'Исправлено' };
    expect(updateConversationLastMessage(current, olderEdit, true)[0].lastMessage?.content).toBe('Новое сообщение');
  });

  it('sorts conversations by message activity', () => {
    expect(sortConversationsByActivity([olderConversation, newerConversation]).map((item) => item.id)).toEqual(['newer', 'older']);
  });
});

describe('optimistic message reconciliation', () => {
  it('keeps one bubble when realtime and a later retry acknowledge the same client id', () => {
    const optimistic: AppMessage = {
      id: 'client-reconcile',
      clientId: 'client-reconcile',
      conversationId: conversation.id,
      authorId: currentUser.id,
      content: 'Одна копия',
      createdAt: '2026-08-10T00:00:00.000Z',
      deliveryState: 'failed',
      author: currentUser,
    };
    const stored = { ...optimistic, id: 'server-reconcile', sentAt: '2026-08-10T00:00:01.000Z', deliveryState: undefined };

    const afterRealtime = reconcileClientMessage([optimistic], stored);
    const afterRetryAck = reconcileClientMessage(afterRealtime, stored);

    expect(afterRetryAck).toHaveLength(1);
    expect(afterRetryAck[0]).toMatchObject({ id: 'server-reconcile', clientId: 'client-reconcile', sentAt: stored.sentAt });
  });
});

describe('Product realtime notification sound', () => {
  it('plays once for a user message and keeps a completed-call plaque silent', async () => {
    const notificationUser: AppUser = { ...currentUser, id: 'notification-user', email: 'notification-user@mova.test' };
    const notificationFriend: AppUser = { ...friend, id: 'notification-friend', name: 'Звуковой друг', email: 'notification-friend@mova.test' };
    const notificationConversation: AppConversation = {
      ...conversation,
      id: 'notification-chat',
      title: notificationFriend.name,
      members: [notificationUser, notificationFriend],
    };
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock() {
      return { volume: 1, play: audioPlay };
    });
    vi.stubGlobal('Audio', AudioMock);
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [notificationConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [notificationFriend] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] });
    const markRead = vi.spyOn(api, 'markConversationRead').mockResolvedValue({ conversationId: notificationConversation.id, userId: notificationUser.id, messageIds: [], readAt: '2026-08-10T12:00:00.000Z' });
    const { container, unmount } = render(<Product currentUser={notificationUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);
    expect(await screen.findByText(`Это начало вашей переписки с ${notificationFriend.name}.`)).toBeVisible();

    const userMessage: AppMessage = {
      id: 'notification-user-message',
      conversationId: notificationConversation.id,
      authorId: notificationFriend.id,
      author: notificationFriend,
      content: 'Обычное входящее сообщение',
      createdAt: '2026-08-10T12:00:00.000Z',
      readBy: [],
    };
    act(() => realtime.listeners.forEach((listener) => listener({ type: 'message:new', message: userMessage })));
    await waitFor(() => expect(audioPlay).toHaveBeenCalledOnce());
    await waitFor(() => expect(container.querySelector('.mova-real-bubble')).toHaveTextContent(userMessage.content));

    act(() => realtime.listeners.forEach((listener) => listener({ type: 'message:new', message: userMessage })));
    expect(audioPlay).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('article.mova-real-message')).toHaveLength(1);

    const callMessage: AppMessage = {
      id: 'notification-call-message',
      conversationId: notificationConversation.id,
      authorId: notificationFriend.id,
      author: notificationFriend,
      kind: 'call',
      content: 'Звонок завершён · 00:20',
      call: { status: 'completed', durationSeconds: 20, startedAt: '2026-08-10T12:00:00.000Z', endedAt: '2026-08-10T12:00:20.000Z' },
      createdAt: '2026-08-10T12:00:20.000Z',
      readBy: [],
    };
    act(() => realtime.listeners.forEach((listener) => listener({ type: 'message:new', message: callMessage })));

    expect(await screen.findByText('Длительность 00:20')).toBeVisible();
    expect(audioPlay).toHaveBeenCalledOnce();
    await waitFor(() => expect(markRead).toHaveBeenCalled());
    unmount();
  });
});

function renderChat(messages: AppMessage[] = []) {
  return render(<RealMessages conversation={conversation} currentUser={currentUser} messages={messages} onSend={vi.fn().mockResolvedValue(undefined)} />);
}

describe('RealMessages links', () => {
  const linkMessage = (id: string, content: string): AppMessage => ({
    id,
    conversationId: conversation.id,
    authorId: friend.id,
    author: friend,
    content,
    createdAt: '2026-08-10T00:01:00.000Z',
  });

  it('shows a short URL without the protocol while keeping the full external href', () => {
    renderChat([linkMessage('only-url', 'https://discord.com/')]);

    const link = screen.getByRole('link', { name: 'discord.com' });
    expect(link).toHaveTextContent('discord.com');
    expect(link).not.toHaveTextContent('https://');
    expect(link).toHaveAttribute('href', 'https://discord.com/');
    expect(link).toHaveAttribute('title', 'https://discord.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    link.focus();
    expect(link).toHaveFocus();
  });

  it('preserves Cyrillic text and punctuation around a URL', () => {
    const { container } = renderChat([linkMessage('surrounded-url', 'Смотри https://example.com/news?q=1, это интересно.')]);

    expect(container.querySelector('.mova-real-bubble p')).toHaveTextContent('Смотри example.com/news?q=1, это интересно.');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/news?q=1');
  });

  it('shortens a very long query while keeping the hostname, path and full href', () => {
    const fullUrl = 'https://www.google.com/search?q=telegram+desktop+messenger+with+a+very+long+query&sourceid=chrome&client=desktop&extra=more';
    renderChat([linkMessage('long-url', fullUrl)]);

    const link = screen.getByRole('link', { name: 'google.com/search?…' });
    expect(link).toHaveTextContent('google.com/search?…');
    expect(link.textContent!.length).toBeLessThanOrEqual(48);
    expect(link).toHaveAttribute('href', fullUrl);
    expect(link).toHaveAttribute('title', fullUrl);
  });

  it('renders several URLs independently and leaves trailing punctuation outside links', () => {
    const { container } = renderChat([linkMessage('several-urls', 'http://one.test и https://two.test/path?x=1).')]);
    const links = screen.getAllByRole('link');

    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'http://one.test');
    expect(links[1]).toHaveAttribute('href', 'https://two.test/path?x=1');
    expect(container.querySelector('.mova-real-bubble p')).toHaveTextContent('one.test и two.test/path?x=1).');
  });

  it('does not interpret surrounding message content as HTML', () => {
    const { container } = renderChat([linkMessage('safe-url', '<img src=x onerror=alert(1)> https://safe.test')]);
    const bubble = container.querySelector('.mova-real-bubble')!;

    expect(bubble).toHaveTextContent('<img src=x onerror=alert(1)> safe.test');
    expect(bubble.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://safe.test');
  });
});

describe('RealMessages attachments', () => {
  it('attaches an image pasted from the clipboard', async () => {
    renderChat();
    const image = new File(['image'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Сообщение в Друг' }), {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => image }],
        files: [image],
      },
    });
    expect(await screen.findByText('pasted.png')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });

  it('attaches a dropped image and shows the drop target', async () => {
    const { container } = renderChat();
    const thread = container.querySelector('.mova-open-chat')!;
    const image = new File(['image'], 'dropped.png', { type: 'image/png' });
    fireEvent.dragEnter(thread, {
      dataTransfer: { types: ['Files'], files: [image] },
    });
    expect(screen.getByText('Отпустите, чтобы прикрепить')).toBeVisible();
    fireEvent.drop(thread, {
      dataTransfer: { types: ['Files'], files: [image] },
    });
    expect(await screen.findByText('dropped.png')).toBeVisible();
  });

  it('removes a compact attachment draft without affecting the message text', async () => {
    const user = userEvent.setup();
    renderChat();
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.type(composer, 'Подпись');
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['draft'], 'draft.txt', { type: 'text/plain' })] } });

    expect(await screen.findByText('draft.txt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Убрать вложение' }));

    expect(screen.queryByText('draft.txt')).not.toBeInTheDocument();
    expect(composer).toHaveValue('Подпись');
  });

  it('opens an image in the viewer instead of downloading it', async () => {
    const user = userEvent.setup();
    const attachment = {
      name: 'photo.png',
      type: 'image/png',
      size: 68,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    };
    const message: AppMessage = {
      id: 'message',
      conversationId: conversation.id,
      authorId: friend.id,
      content: '',
      attachment,
      createdAt: '2026-08-10T00:01:00.000Z',
      author: friend,
    };
    renderChat([message]);
    await user.click(screen.getByRole('button', { name: 'Открыть изображение photo.png' }));
    const viewer = screen.getByRole('dialog', {
      name: 'Просмотр изображения photo.png',
    });
    expect(viewer).toBeVisible();
    expect(viewer.parentElement).toBe(document.body);
    expect(screen.getByRole('link', { name: 'Скачать изображение' })).toHaveAttribute('download', 'photo.png');
    await user.click(screen.getByRole('button', { name: 'Закрыть изображение' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('RealMessages composer behavior', () => {
  it('auto-grows, caps, scrolls, and shrinks the textarea', () => {
    let scrollHeight = 82;
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    renderChat();
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    fireEvent.change(composer, { target: { value: 'Несколько\nстрок' } });
    expect(composer).toHaveStyle({ height: '82px', overflowY: 'hidden' });

    scrollHeight = 180;
    fireEvent.change(composer, { target: { value: 'Очень длинный текст\n'.repeat(20) } });
    expect(composer).toHaveStyle({ height: '120px', overflowY: 'auto' });

    scrollHeight = 24;
    fireEvent.change(composer, { target: { value: 'Коротко' } });
    expect(composer).toHaveStyle({ height: '44px', overflowY: 'hidden' });
  });

  it('sends with Enter and leaves Shift+Enter for a new line', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={onSend} />);
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    fireEvent.change(composer, { target: { value: 'Первая строка' } });
    expect(fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(composer, { target: { value: 'Готово' } });
    expect(fireEvent.keyDown(composer, { key: 'Enter' })).toBe(false);
    expect(onSend).toHaveBeenCalledWith('Готово', undefined, undefined);
  });

  it('opens and toggles the picker, closes it with Escape and click outside', async () => {
    const user = userEvent.setup();
    renderChat();
    const trigger = screen.getByRole('button', { name: 'Эмодзи' });

    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Выбор эмодзи' })).toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    expect(screen.queryByRole('dialog', { name: 'Выбор эмодзи' })).not.toBeInTheDocument();

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Выбор эмодзи' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Сообщение в Друг' }));
    expect(screen.queryByRole('dialog', { name: 'Выбор эмодзи' })).not.toBeInTheDocument();
  });

  it('inserts an emoji at the cursor and restores textarea focus after a sequence', async () => {
    const user = userEvent.setup();
    renderChat();
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Слева справа' } });
    composer.setSelectionRange(5, 5);
    fireEvent.select(composer);

    await user.click(screen.getByRole('button', { name: 'Эмодзи' }));
    await user.click(screen.getByRole('tab', { name: 'Смайлы и эмоции' }));
    await user.click(screen.getByRole('gridcell', { name: 'Grinning Face' }));

    await waitFor(() => expect(composer).toHaveValue('Слева😀 справа'));
    expect(composer).toHaveFocus();
    expect(composer.selectionStart).toBe(7);

    await user.click(screen.getByRole('gridcell', { name: 'Smiling Face With Open Mouth' }));
    await waitFor(() => expect(composer).toHaveValue('Слева😀😃 справа'));
  });

  it('replaces the selected text with the complete emoji sequence', async () => {
    const user = userEvent.setup();
    renderChat();
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'До замены после' } });
    composer.setSelectionRange(3, 9);
    fireEvent.select(composer);

    await user.click(screen.getByRole('button', { name: 'Эмодзи' }));
    await user.type(screen.getByRole('searchbox', { name: 'Поиск эмодзи' }), 'woman technologist');
    await user.click(screen.getByRole('gridcell', { name: 'Woman Technologist' }));

    await waitFor(() => expect(composer).toHaveValue('До 👩‍💻 после'));
    expect(composer.selectionStart).toBe('До 👩‍💻'.length);
  });
});

describe('RealMessages bubble grouping', () => {
  const makeMessage = (id: string, author: AppUser, minute: number, content = id, attachment?: AppMessage['attachment']): AppMessage => ({
    id,
    conversationId: conversation.id,
    authorId: author.id,
    content,
    attachment,
    createdAt: `2026-08-10T00:${String(minute).padStart(2, '0')}:00.000Z`,
    author,
  });

  it('marks only the end of a long sequence for a message tail', () => {
    const messages = [0, 1, 2, 3, 4].map((minute) => makeMessage(`own-${minute}`, currentUser, minute));
    const { container } = renderChat(messages);
    const items = [...container.querySelectorAll('.mova-real-message')];

    expect(items[0]).toHaveClass('is-group-start');
    expect(items[0]).not.toHaveClass('is-group-end');
    expect(items[2]).toHaveClass('is-grouped');
    expect(items[2]).not.toHaveClass('is-group-end');
    expect(items[4]).toHaveClass('is-grouped', 'is-group-end');
  });

  it('does not render message avatars in a direct conversation', () => {
    const { container } = renderChat([0, 1, 2].map((minute) => makeMessage(`incoming-${minute}`, friend, minute)));

    expect(container.querySelectorAll('.mova-real-message .mova-avatar')).toHaveLength(0);
    expect(container.querySelectorAll('.mova-message-avatar-slot')).toHaveLength(0);
  });

  it('reserves one stable avatar column in a group and renders the avatar at the block end', () => {
    const groupConversation: AppConversation = { ...conversation, id: 'group', kind: 'group', title: 'Команда' };
    const messages = [0, 1, 2].map((minute) => ({ ...makeMessage(`group-${minute}`, friend, minute), conversationId: groupConversation.id }));
    const { container } = render(<RealMessages conversation={groupConversation} currentUser={currentUser} messages={messages} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const items = [...container.querySelectorAll('.mova-real-message')];

    expect(container.querySelectorAll('.mova-message-avatar-slot')).toHaveLength(3);
    expect(container.querySelectorAll('.mova-real-message .mova-avatar')).toHaveLength(1);
    expect(items[0].querySelector('.mova-message-body > strong')).toHaveTextContent(friend.name);
    expect(items[1].querySelector('.mova-message-body > strong')).toBeNull();
    expect(items[2].querySelector('.mova-message-avatar-slot > .mova-avatar')).toHaveAccessibleName(friend.name);
  });

  it('starts a separate named block when the author changes in a group', () => {
    const teammate: AppUser = { ...friend, id: 'teammate', name: 'Коллега', email: 'teammate@mova.test' };
    const groupConversation: AppConversation = { ...conversation, id: 'group-authors', kind: 'group', title: 'Команда', members: [currentUser, friend, teammate] };
    const messages = [
      { ...makeMessage('friend-message', friend, 0), conversationId: groupConversation.id },
      { ...makeMessage('teammate-message', teammate, 1), conversationId: groupConversation.id },
    ];
    const { container } = render(<RealMessages conversation={groupConversation} currentUser={currentUser} messages={messages} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const items = [...container.querySelectorAll('.mova-real-message')];

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveClass('is-group-start', 'is-group-end');
    expect(items[1]).toHaveClass('is-group-start', 'is-group-end');
    expect(items[0].querySelector('.mova-message-body > strong')).toHaveTextContent(friend.name);
    expect(items[1].querySelector('.mova-message-body > strong')).toHaveTextContent(teammate.name);
    expect(container.querySelectorAll('.mova-message-avatar-slot > .mova-avatar')).toHaveLength(2);
  });

  it('renders day separators and breaks an author block across local midnight', () => {
    const beforeMidnight = { ...makeMessage('before-midnight', friend, 0), createdAt: '2026-08-10T23:59:00' };
    const afterMidnight = { ...makeMessage('after-midnight', friend, 1), createdAt: '2026-08-11T00:01:00' };
    const { container } = renderChat([beforeMidnight, afterMidnight]);
    const items = [...container.querySelectorAll('.mova-real-message')];

    expect(container.querySelectorAll('.mova-message-day-separator')).toHaveLength(2);
    expect(items[0]).toHaveClass('is-group-start', 'is-group-end');
    expect(items[1]).toHaveClass('is-group-start', 'is-group-end');
  });

  it('starts a new block after a pause longer than five minutes', () => {
    const { container } = renderChat([makeMessage('first', friend, 0), makeMessage('later', friend, 6)]);
    const items = [...container.querySelectorAll('.mova-real-message')];

    expect(items[0]).toHaveClass('is-group-start', 'is-group-end');
    expect(items[1]).toHaveClass('is-group-start', 'is-group-end');
  });

  it('keeps a real bubble around an image caption and distinguishes image-only messages', () => {
    const attachment = { name: 'photo.png', type: 'image/png', size: 10, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
    const { container } = renderChat([
      makeMessage('caption', currentUser, 0, 'Подпись под фотографией', attachment),
      makeMessage('image-only', friend, 10, '', attachment),
    ]);
    const bubbles = [...container.querySelectorAll('.mova-real-bubble')];
    expect(bubbles[0]).toHaveClass('has-image', 'has-caption');
    expect(bubbles[1]).toHaveClass('has-image', 'is-image-only');
    expect(bubbles[0].closest('.mova-real-message')).toHaveClass('is-group-end');
    expect(bubbles[1].closest('.mova-real-message')).toHaveClass('is-group-end');
  });
});

describe('RealMessages navigation', () => {
  const searchMessages: AppMessage[] = [
    {
      id: 'oldest',
      conversationId: conversation.id,
      authorId: friend.id,
      content: 'Важная старая запись',
      createdAt: '2026-08-10T00:01:00.000Z',
      author: friend,
    },
    {
      id: 'middle',
      conversationId: conversation.id,
      authorId: friend.id,
      content: 'Обычное сообщение',
      createdAt: '2026-08-10T00:02:00.000Z',
      author: friend,
    },
    {
      id: 'newest',
      conversationId: conversation.id,
      authorId: currentUser.id,
      content: 'Важная новая запись',
      createdAt: '2026-08-10T00:03:00.000Z',
      author: currentUser,
    },
  ];

  it('starts at the newest result and navigates toward older results', async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollTo = vi.fn();
    const { container } = renderChat(searchMessages);
    await user.click(screen.getByRole('button', { name: 'Поиск' }));
    await user.type(screen.getByRole('textbox', { name: 'Поиск в переписке' }), 'важная');

    expect(screen.getByText('1 из 2')).toBeVisible();
    expect(container.querySelector('[class~="is-active-search-match"]')).toHaveTextContent('Важная новая запись');
    await user.click(screen.getByRole('button', { name: 'К более старому сообщению' }));
    expect(screen.getByText('2 из 2')).toBeVisible();
    expect(container.querySelector('[class~="is-active-search-match"]')).toHaveTextContent('Важная старая запись');
  });
});

describe('RealMessages replies and editing', () => {
  const incoming: AppMessage = {
    id: 'incoming',
    conversationId: conversation.id,
    authorId: friend.id,
    content: 'Исходный вопрос',
    createdAt: '2026-08-10T00:01:00.000Z',
    author: friend,
  };
  const own: AppMessage = {
    id: 'own-editable',
    conversationId: conversation.id,
    authorId: currentUser.id,
    content: 'Текст с опечаткой',
    createdAt: '2026-08-10T00:02:00.000Z',
    author: currentUser,
  };

  it('sends a reply tied to the selected message', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incoming]} onSend={onSend} />);

    fireEvent.contextMenu(screen.getByText('Исходный вопрос').closest('article')!);
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }));
    expect(screen.getByText('В ответ Друг')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Сообщение в Друг' }), 'Мой ответ');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(onSend).toHaveBeenCalledWith('Мой ответ', undefined, 'incoming');
  });

  it('shows an image thumbnail in reply drafts and sent quotes', async () => {
    const user = userEvent.setup();
    const photoAttachment = { name: 'album.png', type: 'image/png', size: 120, dataUrl: 'data:image/png;base64,aW1hZ2U=' };
    const photo: AppMessage = {
      ...incoming,
      id: 'photo',
      content: 'Альбом',
      attachment: photoAttachment,
    };
    const answer: AppMessage = {
      ...own,
      id: 'answer',
      content: '123',
      replyToId: photo.id,
      replyTo: {
        id: photo.id,
        authorId: friend.id,
        author: friend,
        content: photo.content,
        attachmentName: photoAttachment.name,
        attachment: photoAttachment,
      },
    };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[photo, answer]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const replyPreview = container.querySelector('.mova-message-reply')!;
    expect(replyPreview.querySelector('img')).toHaveAttribute('src', photoAttachment.dataUrl);
    expect(replyPreview.closest('.mova-real-bubble')?.querySelector('.mova-message-meta')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Перейти к сообщению Друг' }));
    expect(container.querySelector('article.mova-real-message')).toHaveClass('is-reply-target');
    fireEvent.contextMenu(container.querySelector('article.mova-real-message')!);
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }));
    expect(container.querySelector('.mova-composer-context__preview > img')).toHaveAttribute('src', photoAttachment.dataUrl);
    expect(screen.getByText('В ответ Друг')).toBeVisible();
  });

  it('edits an own message and marks rendered edits', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const edited = { ...own, editedAt: '2026-08-10T00:03:00.000Z' };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[edited]} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={onEdit} />);

    expect(screen.getByText('изменено')).toBeVisible();
    expect(container.querySelector('.mova-message-meta .mova-message-edited')).toHaveTextContent('изменено');
    fireEvent.contextMenu(screen.getByText('Текст с опечаткой').closest('article')!);
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.clear(composer);
    await user.type(composer, 'Исправленный текст');
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    expect(onEdit).toHaveBeenCalledWith('own-editable', 'Исправленный текст');
  });

  it('cancels editing with Escape and keeps the established empty composer state', async () => {
    const user = userEvent.setup();
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[own]} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.contextMenu(container.querySelector('.mova-real-message')!);
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    expect(composer).toHaveValue('Текст с опечаткой');
    fireEvent.keyDown(composer, { key: 'Escape' });

    expect(screen.queryByText('Редактирование сообщения')).not.toBeInTheDocument();
    expect(composer).toHaveValue('');
  });
});

describe('RealMessages popover menus', () => {
  it('closes the details menu after clicking outside it', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole('button', { name: 'Подробнее' }));
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Сообщение в Друг' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('requires an explicit dangerous confirmation before deleting a chat', async () => {
    const user = userEvent.setup();
    const onDeleteConversation = vi.fn();
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} onDeleteConversation={onDeleteConversation} />);

    await user.click(screen.getByRole('button', { name: 'Подробнее' }));
    await user.click(screen.getByRole('menuitem', { name: 'Удалить чат' }));
    expect(screen.getByRole('dialog', { name: 'Удалить чат?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus();
    expect(onDeleteConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onDeleteConversation).toHaveBeenCalledOnce();
  });
});

describe('RealMessages context actions and selection', () => {
  const incoming: AppMessage = {
    id: 'quick-incoming',
    conversationId: conversation.id,
    authorId: friend.id,
    author: friend,
    content: 'Входящее сообщение',
    createdAt: '2026-08-10T00:01:00.000Z',
  };
  const own: AppMessage = {
    ...incoming,
    id: 'quick-own',
    authorId: currentUser.id,
    author: currentUser,
    content: 'Собственное сообщение',
  };

  it('does not render quick actions after message hover or focus', () => {
    const { container } = renderChat([incoming]);
    const article = container.querySelector('.mova-real-message')!;

    fireEvent.mouseEnter(article);
    fireEvent.focus(article);

    expect(container.querySelector('.mova-message-quick-actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ответить на сообщение' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Редактировать сообщение' })).not.toBeInTheDocument();
  });

  it('keeps Reply and Edit keyboard-accessible in the existing context menu', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incoming, own]} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={onEdit} />);

    fireEvent.contextMenu(container.querySelectorAll('.mova-real-message')[0]);
    const replyAction = screen.getByRole('menuitem', { name: 'Ответить' });
    expect(screen.queryByRole('menuitem', { name: 'Редактировать' })).not.toBeInTheDocument();
    replyAction.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('В ответ Друг')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Отменить ответ' }));
    fireEvent.contextMenu(container.querySelectorAll('.mova-real-message')[1]);
    const editAction = screen.getByRole('menuitem', { name: 'Редактировать' });
    editAction.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Редактирование сообщения')).toBeVisible();
  });

  it('keeps selected and search-highlight as separate states', async () => {
    const user = userEvent.setup();
    const { container } = renderChat([incoming]);
    const article = container.querySelector('.mova-real-message')!;

    await user.click(screen.getByRole('button', { name: 'Подробнее' }));
    await user.click(screen.getByRole('menuitem', { name: 'Выбрать сообщения' }));
    await user.click(article);
    expect(article).toHaveClass('is-selected', 'is-selectable');
    expect(article.querySelector('.mova-message-selector svg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Поиск' }));
    await user.type(screen.getByRole('textbox', { name: 'Поиск в переписке' }), 'входящее');
    expect(article).toHaveClass('is-selected', 'is-search-match', 'is-active-search-match');
  });
});

describe('RealMessages ArrowUp editing', () => {
  const olderOwn: AppMessage = {
    id: 'arrow-own-older',
    conversationId: conversation.id,
    authorId: currentUser.id,
    author: currentUser,
    content: 'Предыдущее своё сообщение',
    createdAt: '2026-08-10T00:01:00.000Z',
  };
  const latestOwn: AppMessage = {
    ...olderOwn,
    id: 'arrow-own-latest',
    content: 'Последнее своё сообщение',
    createdAt: '2026-08-10T00:03:00.000Z',
  };
  const incoming: AppMessage = {
    ...olderOwn,
    id: 'arrow-incoming',
    authorId: friend.id,
    author: friend,
    content: 'Последнее входящее сообщение',
    createdAt: '2026-08-10T00:04:00.000Z',
  };
  const renderEditable = (messages: AppMessage[]) =>
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={messages} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn().mockResolvedValue(undefined)} />);

  it('opens the latest own editable message and skips a later incoming message', async () => {
    renderEditable([olderOwn, latestOwn, incoming]);
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    composer.focus();
    await userEvent.setup().keyboard('{ArrowUp}');

    expect(screen.getByText('Редактирование сообщения')).toBeVisible();
    expect(composer).toHaveValue(latestOwn.content);
    await waitFor(() => {
      expect(composer).toHaveFocus();
      expect(composer).toHaveProperty('selectionStart', latestOwn.content.length);
      expect(composer).toHaveProperty('selectionEnd', latestOwn.content.length);
    });
  });

  it('does not open edit when the composer contains text', async () => {
    const user = userEvent.setup();
    renderEditable([latestOwn]);
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    await user.type(composer, 'Черновик');
    await user.keyboard('{ArrowUp}');

    expect(composer).toHaveValue('Черновик');
    expect(screen.queryByText('Редактирование сообщения')).not.toBeInTheDocument();
  });

  it('does not open edit while a reply is active', async () => {
    const user = userEvent.setup();
    const { container } = renderEditable([latestOwn, incoming]);

    fireEvent.contextMenu(container.querySelectorAll('.mova-real-message')[1]);
    await user.click(screen.getByRole('menuitem', { name: 'Ответить' }));
    await user.keyboard('{ArrowUp}');

    expect(screen.getByText('В ответ Друг')).toBeVisible();
    expect(screen.queryByText('Редактирование сообщения')).not.toBeInTheDocument();
  });

  it('does not open edit while an attachment draft is selected', async () => {
    renderEditable([latestOwn]);
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    const attachment = new File(['draft'], 'draft.txt', { type: 'text/plain' });

    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [attachment] } });
    expect(await screen.findByText('draft.txt')).toBeVisible();
    composer.focus();
    await userEvent.setup().keyboard('{ArrowUp}');

    expect(screen.getByText('draft.txt')).toBeVisible();
    expect(screen.queryByText('Редактирование сообщения')).not.toBeInTheDocument();
  });

  it('does not switch messages when an edit is already active', async () => {
    const user = userEvent.setup();
    const { container } = renderEditable([olderOwn, latestOwn]);

    fireEvent.contextMenu(container.querySelectorAll('.mova-real-message')[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.clear(composer);
    await user.keyboard('{ArrowUp}');

    expect(screen.getByText('Редактирование сообщения')).toBeVisible();
    expect(composer).toHaveValue('');
  });

  it('does not select a call/system message', async () => {
    const callMessage: AppMessage = {
      ...latestOwn,
      id: 'arrow-call',
      content: 'Звонок завершён',
      kind: 'call',
      call: {
        status: 'completed',
        durationSeconds: 20,
        startedAt: '2026-08-10T00:02:00.000Z',
        endedAt: '2026-08-10T00:02:20.000Z',
      },
    };
    renderEditable([callMessage]);
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    composer.focus();
    await userEvent.setup().keyboard('{ArrowUp}');

    expect(composer).toHaveValue('');
    expect(screen.queryByText('Редактирование сообщения')).not.toBeInTheDocument();
  });
});

describe('RealMessages send failures', () => {
  it('clears the composer immediately and shows the server error separately', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error('Сервер временно недоступен'));
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={onSend} />);

    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.type(composer, 'Не потеряй этот текст');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(composer).toHaveValue('');
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер временно недоступен');
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });

  it('does not keep text in the composer while the request is pending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => new Promise<void>(() => undefined));
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={onSend} />);

    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.type(composer, 'Отправляется сразу');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(composer).toHaveValue('');
  });
});

describe('RealMessages typing indicator', () => {
  it('keeps presence in the header and shows typing only above the composer', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} typingUserIds={[]} onSend={onSend} />);

    expect(screen.getByText('в сети')).toBeVisible();
    expect(screen.queryByText('Друг печатает…')).not.toBeInTheDocument();

    rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} typingUserIds={[friend.id]} onSend={onSend} />);
    expect(screen.getByText('в сети')).toBeVisible();
    expect(screen.getAllByText('Друг печатает…')).toHaveLength(1);
    expect(screen.getByText('Друг печатает…').closest('.mova-real-typing')).toBeVisible();

    rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} typingUserIds={[]} onSend={onSend} />);
    expect(screen.getByText('в сети')).toBeVisible();
    expect(screen.queryByText('Друг печатает…')).not.toBeInTheDocument();
  });

  it('stops broadcasting typing after inactivity', () => {
    vi.useFakeTimers();
    const sendSpy = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение в Друг' }), { target: { value: 'Черновик' } });
    expect(sendSpy).toHaveBeenCalledWith({ type: 'typing', conversationId: conversation.id, active: true });
    vi.advanceTimersByTime(2_500);
    expect(sendSpy).toHaveBeenCalledWith({ type: 'typing', conversationId: conversation.id, active: false });

    sendSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('RealMessages delivery status', () => {
  const ownMessage = (overrides: Partial<AppMessage> = {}): AppMessage => ({
    id: 'own',
    conversationId: conversation.id,
    authorId: currentUser.id,
    content: 'Статус',
    createdAt: '2026-08-10T00:03:00.000Z',
    author: currentUser,
    ...overrides,
  });

  it('does not claim that a message was sent without a server acknowledgement', () => {
    renderChat([ownMessage()]);
    expect(screen.queryByLabelText('Отправлено')).not.toBeInTheDocument();
  });

  it('shows sent only after sentAt is present', () => {
    renderChat([ownMessage({ sentAt: '2026-08-10T00:03:00.100Z', readBy: [] })]);
    expect(screen.getByLabelText('Отправлено')).toBeVisible();
    expect(screen.queryByLabelText('Прочитано')).not.toBeInTheDocument();
  });

  it('shows a clock while an optimistic message is sending', () => {
    renderChat([ownMessage({ deliveryState: 'sending' })]);
    expect(screen.getByLabelText('Отправляется')).toBeVisible();
  });

  it('shows a failed state without pretending the message was sent', () => {
    renderChat([ownMessage({ deliveryState: 'failed' })]);
    expect(screen.getByLabelText('Не отправлено')).toBeVisible();
    expect(screen.queryByLabelText('Отправлено')).not.toBeInTheDocument();
  });

  it('shows Repeat for a failed message and guards against a double click', async () => {
    const onRetry = vi.fn(() => new Promise<void>(() => undefined));
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[ownMessage({ clientId: 'retry-client', deliveryState: 'failed' })]} onSend={vi.fn().mockResolvedValue(undefined)} onRetry={onRetry} />);

    const retryButton = screen.getByRole('button', { name: 'Повторить' });
    expect(retryButton).toBeVisible();
    await userEvent.setup().dblClick(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'retry-client' }));
    expect(retryButton).toBeDisabled();
  });

  it('shows read only with the recipient receipt', () => {
    renderChat([
      ownMessage({
        sentAt: '2026-08-10T00:03:00.100Z',
        readBy: [{ userId: friend.id, readAt: '2026-08-10T00:04:00.000Z' }],
      }),
    ]);
    expect(screen.getByLabelText('Прочитано')).toBeVisible();
  });

  it('keeps the same bubble and compact meta slot through sending, sent and read', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const sending = ownMessage({ clientId: 'stable-status', deliveryState: 'sending' });
    const { container, rerender } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[sending]} onSend={onSend} />);
    const bubble = container.querySelector('.mova-real-bubble');
    const meta = container.querySelector('.mova-message-meta');
    const statusSlot = container.querySelector('.mova-message-status-slot');

    expect(meta).toContainElement(screen.getByLabelText('Отправляется'));
    expect(statusSlot).not.toHaveClass('has-retry');
    rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[{ ...sending, deliveryState: undefined, sentAt: '2026-08-10T00:03:00.100Z', readBy: [] }]} onSend={onSend} />);
    expect(container.querySelector('.mova-real-bubble')).toBe(bubble);
    expect(container.querySelector('.mova-message-meta')).toBe(meta);
    expect(container.querySelector('.mova-message-status-slot')).toBe(statusSlot);
    expect(meta).toContainElement(screen.getByLabelText('Отправлено'));

    rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[{ ...sending, deliveryState: undefined, sentAt: '2026-08-10T00:03:00.100Z', readBy: [{ userId: friend.id, readAt: '2026-08-10T00:04:00.000Z' }] }]} onSend={onSend} />);
    expect(container.querySelector('.mova-real-bubble')).toBe(bubble);
    expect(container.querySelector('.mova-message-meta')).toBe(meta);
    expect(container.querySelector('.mova-message-status-slot')).toBe(statusSlot);
    expect(meta).toContainElement(screen.getByLabelText('Прочитано'));
  });

  it('does not render delivery status for incoming messages', () => {
    const incoming = { ...ownMessage({ sentAt: '2026-08-10T00:03:00.100Z' }), id: 'incoming-status', authorId: friend.id, author: friend };
    const { container } = renderChat([incoming]);

    expect(container.querySelector('.mova-message-meta time')).toBeVisible();
    expect(container.querySelector('.mova-message-status')).not.toBeInTheDocument();
  });
});

describe('Product message retry', () => {
  const setupRetry = async (suffix: string, sendResult: Promise<{ message: AppMessage }>) => {
    const retryUser = { ...currentUser, id: `me-${suffix}`, email: `me-${suffix}@mova.test` };
    const retryFriend = { ...friend, id: `friend-${suffix}`, email: `friend-${suffix}@mova.test` };
    const clientId = `client-${suffix}`;
    const attachment = { name: 'retry.txt', type: 'text/plain', size: 5, url: `/uploads/${suffix}.txt` };
    const replyTo: AppMessage['replyTo'] = { id: `reply-${suffix}`, authorId: retryFriend.id, content: 'Исходное сообщение', author: retryFriend };
    const failedMessage: AppMessage = {
      id: clientId,
      clientId,
      conversationId: `chat-${suffix}`,
      authorId: retryUser.id,
      author: retryUser,
      content: 'Тот же payload',
      attachment,
      replyToId: replyTo.id,
      replyTo,
      createdAt: '2026-08-10T00:03:00.000Z',
      readBy: [],
      deliveryState: 'failed',
    };
    const retryConversation: AppConversation = {
      id: failedMessage.conversationId,
      kind: 'direct',
      title: retryFriend.name,
      members: [retryUser, retryFriend],
      lastMessage: { ...failedMessage, author: undefined } as unknown as AppConversation['lastMessage'],
      createdAt: '2026-08-10T00:00:00.000Z',
    };
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [retryConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [retryFriend] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [failedMessage] });
    const sendSpy = vi.spyOn(api, 'sendMessage').mockReturnValue(sendResult);
    render(<Product currentUser={retryUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);
    return { retryUser, retryFriend, failedMessage, attachment, sendSpy, retryButton: await screen.findByRole('button', { name: 'Повторить' }) };
  };

  it('reuses the same client id and bubble while moving failed to sending to sent', async () => {
    let resolveSend!: (value: { message: AppMessage }) => void;
    const pendingSend = new Promise<{ message: AppMessage }>((resolve) => {
      resolveSend = resolve;
    });
    const setup = await setupRetry('success', pendingSend);
    const user = userEvent.setup();

    await user.click(setup.retryButton);
    expect(setup.sendSpy).toHaveBeenCalledWith(setup.failedMessage.conversationId, setup.failedMessage.content, setup.attachment, setup.failedMessage.replyToId, setup.failedMessage.clientId, expect.any(Function));
    expect(screen.getByLabelText('Отправляется')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('article.mova-real-message')).toHaveLength(1);

    const sentMessage: AppMessage = {
      ...setup.failedMessage,
      id: 'server-success',
      sentAt: '2026-08-10T00:03:01.000Z',
      deliveryState: undefined,
    };
    await act(async () => resolveSend({ message: sentMessage }));
    expect(await screen.findByLabelText('Отправлено')).toBeVisible();
    expect(document.querySelectorAll('article.mova-real-message')).toHaveLength(1);
    expect(screen.queryByLabelText('Не отправлено')).not.toBeInTheDocument();
  });

  it('returns the same bubble to failed after another error', async () => {
    let rejectSend!: (reason: Error) => void;
    const pendingSend = new Promise<{ message: AppMessage }>((_resolve, reject) => {
      rejectSend = reject;
    });
    const setup = await setupRetry('failure', pendingSend);

    await userEvent.setup().click(setup.retryButton);
    expect(screen.getByLabelText('Отправляется')).toBeVisible();
    await act(async () => rejectSend(new Error('Сеть снова недоступна')));
    expect(await screen.findByLabelText('Не отправлено')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible();
    expect(document.querySelectorAll('article.mova-real-message')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Сеть снова недоступна'));
  });
});

describe('Product message history errors', () => {
  it('keeps cached history visible and retries the existing history request', async () => {
    let now = new Date('2026-08-10T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const historyUser: AppUser = { ...currentUser, id: 'history-user', email: 'history-user@mova.test' };
    const historyFriend: AppUser = { ...friend, id: 'history-friend', email: 'history-friend@mova.test' };
    const historyConversation: AppConversation = {
      ...conversation,
      id: 'history-chat',
      members: [historyUser, historyFriend],
    };
    const cachedMessage: AppMessage = {
      id: 'cached-history-message',
      conversationId: historyConversation.id,
      authorId: historyUser.id,
      author: historyUser,
      content: 'Сообщение из cache',
      createdAt: '2026-08-10T11:55:00.000Z',
      sentAt: '2026-08-10T11:55:01.000Z',
    };
    const refreshedMessage: AppMessage = {
      ...cachedMessage,
      id: 'refreshed-history-message',
      content: 'История после повтора',
    };
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [historyConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [historyFriend] });
    const messagesSpy = vi.spyOn(api, 'messages').mockResolvedValueOnce({ messages: [cachedMessage] });

    const firstRender = render(<Product currentUser={historyUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);
    expect(await screen.findByText(cachedMessage.content)).toBeVisible();
    firstRender.unmount();

    now += 61_000;
    messagesSpy.mockRejectedValueOnce(new Error('Сеть недоступна'));
    render(<Product currentUser={historyUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);

    expect(await screen.findByText('Не удалось загрузить сообщения')).toBeVisible();
    expect(screen.getByText(cachedMessage.content)).toBeVisible();
    expect(messagesSpy).toHaveBeenCalledTimes(2);

    messagesSpy.mockResolvedValueOnce({ messages: [refreshedMessage] });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText(refreshedMessage.content)).toBeVisible();
    expect(messagesSpy).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Не удалось загрузить сообщения')).not.toBeInTheDocument();
  });
});

describe('PendingCallStage', () => {
  it('clearly identifies an incoming caller and exposes both decisions', async () => {
    const user = userEvent.setup();
    const accept = vi.fn();
    const decline = vi.fn();
    render(<PendingCallStage state="incoming" conversation={conversation} currentUser={currentUser} caller={friend} onAccept={accept} onEnd={decline} />);

    expect(screen.getByRole('region', { name: 'Входящий звонок' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Друг' })).toBeVisible();
    expect(screen.getByText('@friend')).toBeVisible();
    expect(screen.getByText('Ответьте, чтобы начать разговор')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Принять' }));
    await user.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(accept).toHaveBeenCalledOnce();
    expect(decline).toHaveBeenCalledOnce();
  });

  it('shows an outgoing call as waiting for this specific person', () => {
    render(<PendingCallStage state="ringing" conversation={conversation} currentUser={currentUser} caller={null} onAccept={vi.fn()} onEnd={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Исходящий звонок' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Друг' })).toBeVisible();
    expect(screen.getByText('Ждём, когда Друг ответит…')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeVisible();
  });
});
