import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PendingCallStage, RealMessages } from './RealApp';
import type { AppConversation, AppMessage, AppUser } from './lib/api';

const currentUser: AppUser = { id: 'me', name: 'Юта', email: 'me@mova.test', handle: '@yuuta', color: '#74DCCB', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const friend: AppUser = { id: 'friend', name: 'Друг', email: 'friend@mova.test', handle: '@friend', color: '#9B83F4', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const conversation: AppConversation = { id: 'chat', kind: 'direct', title: 'Друг', members: [currentUser, friend], lastMessage: null, createdAt: '2026-08-10T00:00:00.000Z' };

function renderChat(messages: AppMessage[] = []) {
  return render(<RealMessages conversation={conversation} currentUser={currentUser} messages={messages} onSend={vi.fn().mockResolvedValue(undefined)} />);
}

describe('RealMessages attachments', () => {
  it('attaches an image pasted from the clipboard', async () => {
    renderChat();
    const image = new File(['image'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Сообщение в Друг' }), { clipboardData: { items: [{ kind: 'file', getAsFile: () => image }], files: [image] } });
    expect(await screen.findByText('pasted.png')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });

  it('attaches a dropped image and shows the drop target', async () => {
    const { container } = renderChat();
    const thread = container.querySelector('.mova-open-chat')!;
    const image = new File(['image'], 'dropped.png', { type: 'image/png' });
    fireEvent.dragEnter(thread, { dataTransfer: { types: ['Files'], files: [image] } });
    expect(screen.getByText('Отпустите, чтобы прикрепить')).toBeVisible();
    fireEvent.drop(thread, { dataTransfer: { types: ['Files'], files: [image] } });
    expect(await screen.findByText('dropped.png')).toBeVisible();
  });

  it('opens an image in the viewer instead of downloading it', async () => {
    const user = userEvent.setup();
    const attachment = { name: 'photo.png', type: 'image/png', size: 68, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
    const message: AppMessage = { id: 'message', conversationId: conversation.id, authorId: friend.id, content: '', attachment, createdAt: '2026-08-10T00:01:00.000Z', author: friend };
    renderChat([message]);
    await user.click(screen.getByRole('button', { name: 'Открыть изображение photo.png' }));
    const viewer = screen.getByRole('dialog', { name: 'Просмотр изображения photo.png' });
    expect(viewer).toBeVisible();
    expect(viewer.parentElement).toBe(document.body);
    expect(screen.getByRole('link', { name: 'Скачать изображение' })).toHaveAttribute('download', 'photo.png');
    await user.click(screen.getByRole('button', { name: 'Закрыть изображение' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('RealMessages navigation', () => {
  const searchMessages: AppMessage[] = [
    { id: 'oldest', conversationId: conversation.id, authorId: friend.id, content: 'Важная старая запись', createdAt: '2026-08-10T00:01:00.000Z', author: friend },
    { id: 'middle', conversationId: conversation.id, authorId: friend.id, content: 'Обычное сообщение', createdAt: '2026-08-10T00:02:00.000Z', author: friend },
    { id: 'newest', conversationId: conversation.id, authorId: currentUser.id, content: 'Важная новая запись', createdAt: '2026-08-10T00:03:00.000Z', author: currentUser },
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

describe('RealMessages delivery status', () => {
  const ownMessage = (overrides: Partial<AppMessage> = {}): AppMessage => ({ id: 'own', conversationId: conversation.id, authorId: currentUser.id, content: 'Статус', createdAt: '2026-08-10T00:03:00.000Z', author: currentUser, ...overrides });

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
    renderChat([ownMessage({ sentAt: '2026-08-10T00:03:00.100Z', readBy: [{ userId: friend.id, readAt: '2026-08-10T00:04:00.000Z' }] })]);
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
