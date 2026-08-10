import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatPresenceStatus, PendingCallStage, RealMessages, sortConversationsByActivity, updateConversationLastMessage } from './RealApp';
import { realtime, type AppConversation, type AppMessage, type AppUser } from './lib/api';

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

function renderChat(messages: AppMessage[] = []) {
  return render(<RealMessages conversation={conversation} currentUser={currentUser} messages={messages} onSend={vi.fn().mockResolvedValue(undefined)} />);
}

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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    expect(container.querySelector('.mova-message-reply > img')).toHaveAttribute('src', photoAttachment.dataUrl);
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
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[edited]} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={onEdit} />);

    expect(screen.getByText('изменено')).toBeVisible();
    fireEvent.contextMenu(screen.getByText('Текст с опечаткой').closest('article')!);
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.clear(composer);
    await user.type(composer, 'Исправленный текст');
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    expect(onEdit).toHaveBeenCalledWith('own-editable', 'Исправленный текст');
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
});

describe('RealMessages send failures', () => {
  it('keeps the draft editable and shows the server error', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error('Сервер временно недоступен'));
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={onSend} />);

    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.type(composer, 'Не потеряй этот текст');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер временно недоступен');
    expect(composer).toHaveValue('Не потеряй этот текст');
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });
});

describe('RealMessages typing indicator', () => {
  it('shows who is typing in the header and above the composer', () => {
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} typingUserIds={[friend.id]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getAllByText('Друг печатает…')).toHaveLength(2);
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

  it('shows read only with the recipient receipt', () => {
    renderChat([
      ownMessage({
        sentAt: '2026-08-10T00:03:00.100Z',
        readBy: [{ userId: friend.id, readAt: '2026-08-10T00:04:00.000Z' }],
      }),
    ]);
    expect(screen.getByLabelText('Прочитано')).toBeVisible();
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
