import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen, formatPresenceStatus, loadConversationDrafts, mergeMessageHistory, PendingCallStage, presenceUpdateForSystemIdle, Product, ProfileEditor, RealMessages, reconcileClientMessage, SettingsModal, sortConversationsByActivity, updateConversationLastMessage, updateConversationUser } from './RealApp';
import { api, realtime, type AppConversation, type AppMessage, type AppUser } from './lib/api';
import { ToastProvider } from './components/Primitives';

afterEach(() => {
  delete window.movaDesktopShell;
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
  emailVerifiedAt: '2026-08-10T00:00:00.000Z',
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
  relationship: 'friend',
};
const conversation: AppConversation = {
  id: 'chat',
  kind: 'direct',
  title: 'Друг',
  members: [currentUser, friend],
  lastMessage: null,
  createdAt: '2026-08-10T00:00:00.000Z',
};

describe('email authentication interface', () => {
  it('requires the emailed code before completing registration', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    const onAuth = vi.fn();
    const challenge = { challengeId: 'registration-challenge', email: 'new@mova.test', expiresAt: '2026-08-20T10:10:00.000Z', resendAfterSeconds: 60 };
    const register = vi.spyOn(api, 'register').mockResolvedValue(challenge);
    const verify = vi.spyOn(api, 'verifyRegistration').mockResolvedValue({ token: 'verified-token', user: { ...currentUser, email: challenge.email } });
    render(<AuthScreen onAuth={onAuth} />);

    await user.click(screen.getByRole('tab', { name: 'Регистрация' }));
    await user.type(screen.getByRole('textbox', { name: 'Имя' }), 'Новый пользователь');
    await user.type(screen.getByRole('textbox', { name: 'Почта' }), challenge.email);
    await user.type(screen.getByLabelText('Пароль'), 'strongpass1');
    await user.click(screen.getByRole('button', { name: 'Получить код' }));

    expect(register).toHaveBeenCalledWith({ name: 'Новый пользователь', email: challenge.email, password: 'strongpass1' });
    expect(await screen.findByText(`Код отправлен на ${challenge.email}`)).toBeVisible();
    expect(screen.getByText(/Письмо с кодом может попасть в «Спам»/)).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Код из письма' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Подтвердить и войти' }));

    expect(verify).toHaveBeenCalledWith(challenge.challengeId, '123456');
    expect(sessionStorage.getItem('mova-session')).toBe('verified-token');
    expect(onAuth).toHaveBeenCalledWith(expect.objectContaining({ email: challenge.email }));
  });

  it('lets a user request a code and set a new forgotten password', async () => {
    const user = userEvent.setup();
    const requestReset = vi.spyOn(api, 'requestPasswordReset').mockResolvedValue({ challengeId: 'reset-challenge', email: currentUser.email, expiresAt: '2026-08-20T10:10:00.000Z', resendAfterSeconds: 60 });
    const confirmReset = vi.spyOn(api, 'confirmPasswordReset').mockResolvedValue({ ok: true });
    render(<AuthScreen onAuth={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Забыли пароль?' }));
    await user.type(screen.getByRole('textbox', { name: 'Почта' }), currentUser.email);
    await user.click(screen.getByRole('button', { name: 'Отправить код' }));
    expect(requestReset).toHaveBeenCalledWith(currentUser.email);
    expect(await screen.findByText(/Письмо с кодом может попасть в «Спам»/)).toBeVisible();

    await user.type(await screen.findByRole('textbox', { name: 'Код из письма' }), '654321');
    await user.type(screen.getByLabelText('Новый пароль'), 'newstrongpass');
    await user.click(screen.getByRole('button', { name: 'Изменить пароль' }));

    expect(confirmReset).toHaveBeenCalledWith('reset-challenge', '654321', 'newstrongpass');
    expect(await screen.findByText('Пароль изменён. Теперь можно войти.')).toBeVisible();
  });
});

describe('voice processing settings', () => {
  it('changes the account email only after checking the password and code', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    const onUserUpdate = vi.fn();
    const changedUser = { ...currentUser, email: 'changed@mova.test' };
    const requestChange = vi.spyOn(api, 'requestEmailChange').mockResolvedValue({ challengeId: 'email-change', email: changedUser.email, expiresAt: '2026-08-20T10:10:00.000Z', resendAfterSeconds: 60 });
    const confirmChange = vi.spyOn(api, 'confirmEmailChange').mockResolvedValue({ token: 'renewed-token', user: changedUser });
    render(<SettingsModal user={currentUser} open onClose={vi.fn()} onEditProfile={vi.fn()} onUserUpdate={onUserUpdate} />);

    await user.click(screen.getByRole('button', { name: 'Аккаунт' }));
    expect(screen.getByText(currentUser.email)).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Новая почта' }), changedUser.email);
    await user.type(screen.getByLabelText('Текущий пароль'), 'strongpass2');
    await user.click(screen.getByRole('button', { name: 'Отправить код' }));
    expect(requestChange).toHaveBeenCalledWith(changedUser.email, 'strongpass2');
    expect(await screen.findByText(/Письмо с кодом может попасть в «Спам»/)).toBeVisible();

    await user.type(await screen.findByRole('textbox', { name: 'Код из письма' }), '345678');
    await user.click(screen.getByRole('button', { name: 'Подтвердить почту' }));
    expect(confirmChange).toHaveBeenCalledWith('email-change', '345678');
    expect(sessionStorage.getItem('mova-session')).toBe('renewed-token');
    expect(onUserUpdate).toHaveBeenCalledWith(changedUser);
  });

  it('notifies an existing user and confirms their current email with a code', async () => {
    const user = userEvent.setup();
    const onUserUpdate = vi.fn();
    const unverifiedUser = { ...currentUser, emailVerifiedAt: undefined };
    const verifiedUser = { ...currentUser, emailVerifiedAt: '2026-08-20T12:00:00.000Z' };
    const requestVerification = vi.spyOn(api, 'requestEmailVerification').mockResolvedValue({ challengeId: 'current-email', email: currentUser.email, expiresAt: '2026-08-20T12:10:00.000Z', resendAfterSeconds: 60 });
    const confirmVerification = vi.spyOn(api, 'confirmEmailVerification').mockResolvedValue({ user: verifiedUser });
    render(<SettingsModal user={unverifiedUser} open onClose={vi.fn()} onEditProfile={vi.fn()} onUserUpdate={onUserUpdate} />);

    expect(screen.getByRole('button', { name: 'Аккаунт' })).toHaveClass('has-notice');
    await user.click(screen.getByRole('button', { name: 'Аккаунт' }));
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Подтвердите текущую почту');
    expect(screen.getByText('Требуется подтверждение')).toBeVisible();

    await user.click(within(notice).getByRole('button', { name: 'Отправить код' }));
    expect(requestVerification).toHaveBeenCalledTimes(1);
    expect(within(notice).getByText(/Письмо с кодом может попасть в «Спам»/)).toBeVisible();
    await user.type(await screen.findByRole('textbox', { name: 'Код подтверждения текущей почты' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(confirmVerification).toHaveBeenCalledWith('current-email', '123456');
    expect(onUserUpdate).toHaveBeenCalledWith(verifiedUser);
  });

  it('offers enhanced RNNoise, standard and disabled modes and persists the selection', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsModal user={currentUser} open onClose={onClose} onEditProfile={vi.fn()} />);

    const mode = screen.getByRole('combobox', { name: 'Шумоподавление' });
    expect(mode).toHaveValue('enhanced');
    expect(within(mode).getByRole('option', { name: 'Усиленное — голосовой фильтр RNNoise' })).toBeInTheDocument();
    expect(within(mode).getByRole('option', { name: 'Стандартное — обработка браузера' })).toBeInTheDocument();
    expect(within(mode).getByRole('option', { name: 'Выключено' })).toBeInTheDocument();

    await user.selectOptions(mode, 'standard');
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    expect(JSON.parse(localStorage.getItem('mova-audio-settings') || '{}')).toMatchObject({
      noiseSuppression: true,
      noiseSuppressionMode: 'standard',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows and persists auto-launch only in the desktop application', async () => {
    const setAutoLaunch = vi.fn().mockResolvedValue(false);
    window.movaDesktopShell = {
      platform: 'win32',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      getAutoLaunch: vi.fn().mockResolvedValue(true),
      setAutoLaunch,
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => vi.fn()),
    };
    const user = userEvent.setup();
    render(<SettingsModal user={currentUser} open onClose={vi.fn()} onEditProfile={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Приложение' }));
    const autoLaunch = await screen.findByRole('checkbox', { name: /Запускать Mova с системой/ });
    await waitFor(() => expect(autoLaunch).toBeChecked());
    await user.click(autoLaunch);
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));

    expect(setAutoLaunch).toHaveBeenCalledWith(false);
  });
});

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
    expect(formatPresenceStatus({ ...friend, isOnline: true, activity: { type: 'game', name: 'Minecraft', startedAt: '2026-08-10T11:00:00.000Z' } }, now)).toBe('играет в Minecraft');
    expect(formatPresenceStatus({ ...friend, presence: 'idle', isOnline: true }, now)).toBe('неактивен');
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
  it('uses operating-system idle time without overriding manual statuses', () => {
    expect(presenceUpdateForSystemIdle('online', 899)).toBeNull();
    expect(presenceUpdateForSystemIdle('online', 900)).toBe('idle');
    expect(presenceUpdateForSystemIdle('idle', 30)).toBe('online');
    expect(presenceUpdateForSystemIdle('idle', 60)).toBeNull();
    expect(presenceUpdateForSystemIdle('dnd', 0)).toBeNull();
    expect(presenceUpdateForSystemIdle('invisible', 0)).toBeNull();
  });
});

describe('profile editor polish', () => {
  it('opens avatar cropping and applies the selected square preview', async () => {
    const user = userEvent.setup();
    const bitmap = { width: 1200, height: 800, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => callback(new Blob([new Uint8Array(60_000)], { type })));
    const { container } = render(<ToastProvider><ProfileEditor user={currentUser} open onClose={vi.fn()} onSaved={vi.fn()} /></ToastProvider>);
    const file = new File([new Uint8Array(180_000)], 'avatar.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText('Изменить аватар'), file);

    expect(await screen.findByRole('heading', { name: 'Кадрирование аватара' })).toBeVisible();
    const zoom = screen.getByRole('slider', { name: 'Масштаб аватара' });
    expect(zoom).toHaveValue('1');
    fireEvent.change(zoom, { target: { value: '1.5' } });
    expect(screen.getByText('150%')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Применить' }));

    await screen.findByRole('heading', { name: 'Редактировать профиль' });
    expect(container.querySelector('.mova-profile-preview .mova-avatar img')).toHaveAttribute('src', expect.stringMatching(/^data:image\/webp;base64,/));
    expect(bitmap.close).toHaveBeenCalled();
  });

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

    act(() => vi.advanceTimersByTime(220));
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
    const result = updateConversationLastMessage([newerConversation, { ...olderConversation, isDraft: true }], latestMessage);
    expect(result.map((item) => item.id)).toEqual(['older', 'newer']);
    expect(result[0].lastMessage?.content).toBe('Новое сообщение');
    expect(result[0].isDraft).toBe(false);
  });

  it('does not replace a preview when an older message is edited', () => {
    const current = updateConversationLastMessage([olderConversation], latestMessage);
    const olderEdit = { ...latestMessage, id: 'older-message', content: 'Исправлено' };
    expect(updateConversationLastMessage(current, olderEdit, true)[0].lastMessage?.content).toBe('Новое сообщение');
  });

  it('sorts conversations by message activity', () => {
    expect(sortConversationsByActivity([olderConversation, newerConversation]).map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('keeps conversations with friends above newer conversations with other users', () => {
    const stranger: AppUser = { ...friend, id: 'stranger', name: 'Незнакомец', relationship: 'none' };
    const strangerConversation: AppConversation = {
      ...newerConversation,
      id: 'stranger-chat',
      title: stranger.name,
      members: [currentUser, stranger],
    };
    expect(sortConversationsByActivity([strangerConversation, olderConversation]).map((item) => item.id)).toEqual(['older', 'stranger-chat']);
  });

  it('places incoming friend requests between friends and other users', () => {
    const requester: AppUser = { ...friend, id: 'requester-rank', relationship: 'incoming' };
    const stranger: AppUser = { ...friend, id: 'stranger-rank', relationship: 'none' };
    const requestConversation: AppConversation = { ...newerConversation, id: 'request-chat', members: [currentUser, requester] };
    const strangerConversation: AppConversation = { ...newerConversation, id: 'stranger-rank-chat', members: [currentUser, stranger] };

    expect(sortConversationsByActivity([strangerConversation, requestConversation, olderConversation]).map((item) => item.id)).toEqual(['older', 'request-chat', 'stranger-rank-chat']);
  });

  it('updates only the direct chat that contains the changed user', () => {
    const other: AppUser = { ...friend, id: 'other', name: 'Другой', handle: '@other' };
    const otherConversation: AppConversation = { ...newerConversation, id: 'other-chat', title: other.name, members: [currentUser, other] };
    const renamedFriend = { ...friend, name: 'Новое имя', bio: 'Новое описание', avatarDataUrl: '/uploads/new-avatar.png' };

    const updatedFriendChat = updateConversationUser(olderConversation, renamedFriend, currentUser.id);
    const untouchedOtherChat = updateConversationUser(otherConversation, renamedFriend, currentUser.id);

    expect(updatedFriendChat).toMatchObject({ title: renamedFriend.name, members: [currentUser, renamedFriend] });
    expect(untouchedOtherChat).toBe(otherConversation);
  });
});

describe('message history pagination', () => {
  const historyMessage = (id: string, createdAt: string, clientId?: string): AppMessage => ({
    id,
    clientId,
    conversationId: conversation.id,
    authorId: currentUser.id,
    author: currentUser,
    content: id,
    createdAt,
  });

  it('merges overlapping pages by server or client id and keeps chronological order', () => {
    const result = mergeMessageHistory(
      [historyMessage('new', '2026-08-13T10:02:00.000Z'), historyMessage('optimistic', '2026-08-13T10:01:00.000Z', 'same-client')],
      [historyMessage('old', '2026-08-13T10:00:00.000Z'), historyMessage('confirmed', '2026-08-13T10:01:00.000Z', 'same-client')],
    );

    expect(result.map((message) => message.id)).toEqual(['old', 'confirmed', 'new']);
  });

  it('exposes manual loading and retry states for older messages', async () => {
    const onLoadOlder = vi.fn().mockResolvedValue(undefined);
    const rendered = render(
      <RealMessages conversation={conversation} currentUser={currentUser} messages={[historyMessage('new', '2026-08-13T10:02:00.000Z')]} hasOlderMessages onLoadOlder={onLoadOlder} onSend={vi.fn()} />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Загрузить ранние сообщения' }));
    expect(onLoadOlder).toHaveBeenCalledOnce();

    rendered.rerender(
      <RealMessages conversation={conversation} currentUser={currentUser} messages={[historyMessage('new', '2026-08-13T10:02:00.000Z')]} hasOlderMessages olderHistoryError onLoadOlder={onLoadOlder} onSend={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Не удалось загрузить ранние сообщения · Повторить' })).toBeVisible();
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
  it('asks for notification permission after authentication in the web app', async () => {
    const promptUser: AppUser = { ...currentUser, id: 'notification-prompt-user', email: 'notification-prompt@mova.test' };
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [] });

    const rendered = render(<Product currentUser={promptUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Не пропускайте сообщения и звонки' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Разрешить уведомления' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }));
    expect(screen.queryByRole('heading', { name: 'Не пропускайте сообщения и звонки' })).not.toBeInTheDocument();
    rendered.unmount();
  });

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

  it('keeps an incoming message from a non-friend silent', async () => {
    const notificationUser: AppUser = { ...currentUser, id: 'silent-user', email: 'silent-user@mova.test' };
    const stranger: AppUser = { ...friend, id: 'silent-stranger', name: 'Незнакомец', email: 'silent-stranger@mova.test', relationship: 'none' };
    const silentConversation: AppConversation = {
      ...conversation,
      id: 'silent-chat',
      title: stranger.name,
      members: [notificationUser, stranger],
    };
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock() {
      return { volume: 1, play: audioPlay };
    });
    vi.stubGlobal('Audio', AudioMock);
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [silentConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [stranger] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] });
    vi.spyOn(api, 'markConversationRead').mockResolvedValue({ conversationId: silentConversation.id, userId: notificationUser.id, messageIds: [], readAt: '2026-08-10T12:00:00.000Z' });
    const rendered = render(<Product currentUser={notificationUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);
    expect(await screen.findByText(`Это начало вашей переписки с ${stranger.name}.`)).toBeVisible();

    act(() => realtime.listeners.forEach((listener) => listener({
      type: 'message:new',
      message: {
        id: 'silent-message',
        conversationId: silentConversation.id,
        authorId: stranger.id,
        author: stranger,
        content: 'Бесшумное входящее сообщение',
        createdAt: '2026-08-10T12:00:00.000Z',
        readBy: [],
      },
    })));

    expect((await screen.findAllByText('Бесшумное входящее сообщение')).length).toBeGreaterThan(0);
    expect(AudioMock).not.toHaveBeenCalled();
    expect(audioPlay).not.toHaveBeenCalled();
    rendered.unmount();
  });
});

describe('Product typing surfaces', () => {
  it('shows typing above the composer and instead of the last message in the chat list', async () => {
    const typingUser: AppUser = { ...currentUser, id: 'typing-user', email: 'typing-user@mova.test' };
    const typingFriend: AppUser = { ...friend, id: 'typing-friend', name: 'Печатающий друг', email: 'typing-friend@mova.test' };
    const lastMessage: AppMessage = {
      id: 'typing-last-message',
      conversationId: 'typing-chat',
      authorId: typingFriend.id,
      author: typingFriend,
      content: 'Предыдущее сообщение',
      createdAt: '2026-08-10T12:00:00.000Z',
      readBy: [],
    };
    const typingConversation: AppConversation = {
      ...conversation,
      id: lastMessage.conversationId,
      title: typingFriend.name,
      members: [typingUser, typingFriend],
      lastMessage: { ...lastMessage, author: undefined } as unknown as AppConversation['lastMessage'],
    };
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [typingConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [typingFriend] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [lastMessage] });
    vi.spyOn(api, 'markConversationRead').mockResolvedValue({ conversationId: typingConversation.id, userId: typingUser.id, messageIds: [lastMessage.id], readAt: '2026-08-10T12:01:00.000Z' });
    const { container, unmount } = render(<Product currentUser={typingUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);

    await screen.findByText(lastMessage.content);
    const sidebarPreview = container.querySelector('.mova-real-chat-list small');
    expect(sidebarPreview).toHaveTextContent(lastMessage.content);

    act(() => realtime.listeners.forEach((listener) => listener({ type: 'typing', conversationId: typingConversation.id, userId: typingFriend.id, active: true })));

    await waitFor(() => expect(sidebarPreview).toHaveTextContent('Печатающий друг печатает…'));
    expect(sidebarPreview).toHaveClass('mova-typing-status');
    expect(container.querySelector('.mova-real-typing')).toHaveTextContent('Печатающий друг печатает…');
    expect(screen.getByText('в сети')).toBeVisible();

    act(() => realtime.listeners.forEach((listener) => listener({ type: 'typing', conversationId: typingConversation.id, userId: typingFriend.id, active: false })));

    await waitFor(() => expect(sidebarPreview).toHaveTextContent(lastMessage.content));
    expect(sidebarPreview).not.toHaveClass('mova-typing-status');
    expect(container.querySelector('.mova-real-typing')).toHaveClass('is-empty');
    unmount();
  });
});

describe('Product incoming friend requests', () => {
  it('shows a counter, request label, and system-card preview', async () => {
    const user: AppUser = { ...currentUser, id: 'request-counter-user', email: 'request-counter-user@mova.test' };
    const requester: AppUser = { ...friend, id: 'request-counter-friend', name: 'Новый знакомый', email: 'request-counter-friend@mova.test', relationship: 'incoming' };
    const requestMessage: AppMessage = {
      id: 'request-counter-message',
      conversationId: 'request-counter-chat',
      authorId: requester.id,
      author: requester,
      kind: 'friend_request',
      content: 'Заявка в друзья',
      friendRequest: { requestedBy: requester.id, status: 'pending' },
      createdAt: '2026-08-13T12:00:00.000Z',
      readBy: [],
    };
    const { author: _author, ...lastMessage } = requestMessage;
    const requestConversation: AppConversation = {
      ...conversation,
      id: requestMessage.conversationId,
      title: requester.name,
      members: [user, requester],
      lastMessage,
    };
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [requestConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [requester] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [requestMessage] });
    vi.spyOn(api, 'markConversationRead').mockResolvedValue({ conversationId: requestConversation.id, userId: user.id, messageIds: [requestMessage.id], readAt: '2026-08-13T12:01:00.000Z' });
    const rendered = render(<Product currentUser={user} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);

    expect(await screen.findByRole('article', { name: `${requester.name} хочет добавить тебя в друзья` })).toBeVisible();
    expect(screen.getByLabelText('Входящих заявок в друзья: 1')).toHaveTextContent('1');
    expect(rendered.container.querySelector('.mova-chat-friend-request-label')).toHaveTextContent('Заявка');
    expect(rendered.container.querySelector('.mova-real-chat-list small')).toHaveTextContent('Хочет добавить тебя в друзья');
    rendered.unmount();
  });
});

describe('Product direct-chat drafts and deletion', () => {
  it('keeps an untouched direct chat out of the list and deletes it through the API', async () => {
    const user = userEvent.setup();
    const draftUser: AppUser = { ...currentUser, id: 'draft-owner', email: 'draft-owner@mova.test' };
    const draftContact: AppUser = { ...friend, id: 'draft-contact', name: 'Черновой собеседник', email: 'draft-contact@mova.test', relationship: 'none' };
    const draftConversation: AppConversation = {
      ...conversation,
      id: 'draft-conversation',
      title: draftContact.name,
      members: [draftUser, draftContact],
      lastMessage: null,
      createdBy: draftUser.id,
      isDraft: true,
    };
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [draftContact] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] });
    vi.spyOn(api, 'createConversation').mockResolvedValue({ conversation: draftConversation });
    const deleteConversation = vi.spyOn(api, 'deleteConversation').mockResolvedValue({ conversationId: draftConversation.id });
    const rendered = render(<Product currentUser={draftUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);

    const search = screen.getByRole('textbox', { name: 'Глобальный поиск' });
    await user.click(search);
    await user.type(search, 'Черновой');
    await user.click(await screen.findByRole('button', { name: new RegExp(draftContact.name) }));

    expect(await screen.findByText(`Это начало вашей переписки с ${draftContact.name}.`)).toBeVisible();
    expect(rendered.container.querySelector('.mova-real-chat-list>button')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Подробнее' }));
    await user.click(screen.getByRole('menuitem', { name: 'Удалить чат' }));
    await user.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith(draftConversation.id));
    expect(screen.getByText('Выберите разговор или создайте новый')).toBeVisible();
    rendered.unmount();
  });
});

describe('Product unread message counters', () => {
  it('shows the unread count on a conversation that is not open', async () => {
    window.localStorage.clear();
    const user: AppUser = { ...currentUser, id: 'unread-owner', email: 'unread-owner@mova.test' };
    const openContact: AppUser = { ...friend, id: 'open-contact', name: 'Открытый чат' };
    const unreadContact: AppUser = { ...friend, id: 'unread-contact', name: 'Непрочитанный чат' };
    const openConversation: AppConversation = { ...conversation, id: 'open-chat', title: openContact.name, members: [user, openContact], unreadCount: 0 };
    const unreadConversation: AppConversation = {
      ...conversation,
      id: 'unread-chat',
      title: unreadContact.name,
      members: [user, unreadContact],
      unreadCount: 12,
      lastMessage: { id: 'unread-last', conversationId: 'unread-chat', authorId: unreadContact.id, content: 'Новое сообщение', createdAt: '2026-08-13T12:00:00.000Z' },
    };
    window.localStorage.setItem('mova-selected-conversation', openConversation.id);
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [unreadConversation, openConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [openContact, unreadContact] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] });
    const rendered = render(<Product currentUser={user} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);

    await screen.findByText(`Это начало вашей переписки с ${openContact.name}.`);
    const unreadRow = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.mova-real-chat-list>button')).find((button) => button.textContent?.includes(unreadContact.name))!;
    expect(within(unreadRow).getByLabelText('Непрочитанных сообщений: 12')).toHaveTextContent('9+');
    rendered.unmount();
  });
});

describe('Product global voice dock', () => {
  it('keeps one call session across chats, blocks a second call, returns without a new invite, and leaves only the current participant', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const user = userEvent.setup();
    const voiceUser: AppUser = { ...currentUser, id: 'voice-dock-user', email: 'voice-dock-user@mova.test' };
    const firstFriend: AppUser = { ...friend, id: 'voice-dock-first', name: 'Первый собеседник', email: 'voice-dock-first@mova.test' };
    const secondFriend: AppUser = { ...friend, id: 'voice-dock-second', name: 'Второй собеседник', email: 'voice-dock-second@mova.test' };
    const firstChat: AppConversation = { ...conversation, id: 'voice-dock-first-chat', title: firstFriend.name, members: [voiceUser, firstFriend] };
    const secondChat: AppConversation = { ...conversation, id: 'voice-dock-second-chat', title: secondFriend.name, members: [voiceUser, secondFriend], createdAt: '2026-08-10T00:01:00.000Z' };
    const audioTrack = { id: 'voice-dock-track', enabled: true, stop: vi.fn() };
    const microphoneStream = {
      id: 'voice-dock-stream',
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(microphoneStream) } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    const send = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [secondChat, firstChat] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [firstFriend, secondFriend] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] });
    vi.spyOn(api, 'markConversationRead').mockImplementation(async (conversationId) => ({ conversationId, userId: voiceUser.id, messageIds: [], readAt: '2026-08-10T12:00:00.000Z' }));
    window.localStorage.setItem('mova-selected-conversation', firstChat.id);
    const rendered = render(<ToastProvider><Product currentUser={voiceUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} /></ToastProvider>);

    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'call:sync', conversationId: firstChat.id }));
    act(() => realtime.listeners.forEach((listener) => listener({
      type: 'call:state',
      conversationId: firstChat.id,
      status: 'active',
      createdAt: '2026-08-10T12:00:00.000Z',
      startedAt: '2026-08-10T12:00:03.000Z',
      participants: [voiceUser.id, firstFriend.id],
      room: [
        { userId: voiceUser.id, connectionState: 'reconnecting', muted: false, deafened: false, media: {} },
        { userId: firstFriend.id, connectionState: 'connected', muted: false, deafened: false, media: {} },
      ],
      joined: true,
    })));

    const dock = await screen.findByRole('region', { name: `Активный звонок с ${firstFriend.name}` });
    expect(dock).toHaveAttribute('data-call-state', 'disconnected');
    const secondChatButton = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.mova-real-chat-list>button')).find((button) => button.textContent?.includes(secondFriend.name))!;
    await user.click(secondChatButton);
    expect(dock).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Позвонить' }));
    expect(await screen.findByRole('status')).toHaveTextContent(`Вы уже находитесь в звонке «${firstFriend.name}»`);
    expect(send).not.toHaveBeenCalledWith({ type: 'call:invite', conversationId: secondChat.id });

    await user.click(screen.getByRole('button', { name: `Вернуться в звонок с ${firstFriend.name}` }));
    await waitFor(() => expect(rendered.container.querySelector('.mova-call-stage')).toBeInTheDocument());
    expect(send).not.toHaveBeenCalledWith({ type: 'call:invite', conversationId: firstChat.id });
    await user.click(screen.getByRole('button', { name: 'Свернуть звонок' }));
    const restoredDock = await screen.findByRole('region', { name: `Активный звонок с ${firstFriend.name}` });
    expect(restoredDock).toHaveAttribute('data-call-state', 'connected');

    await user.click(screen.getByRole('button', { name: 'Выключить микрофон' }));
    expect(screen.getByRole('button', { name: 'Включить микрофон' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Выключить звук в наушниках' }));
    expect(screen.getByRole('button', { name: 'Включить звук в наушниках' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Выйти из звонка' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: `Активный звонок с ${firstFriend.name}` })).not.toBeInTheDocument());
    expect(send).toHaveBeenCalledWith({ type: 'voice:leave', conversationId: firstChat.id });

    act(() => realtime.listeners.forEach((listener) => listener({
      type: 'call:state',
      conversationId: firstChat.id,
      status: 'active',
      createdAt: '2026-08-10T12:00:00.000Z',
      startedAt: '2026-08-10T12:00:03.000Z',
      participants: [firstFriend.id],
      room: [{ userId: firstFriend.id, connectionState: 'connected', muted: false, deafened: false, media: {} }],
      joined: false,
    })));
    expect(await screen.findByRole('button', { name: 'Подключиться к звонку' })).toBeVisible();
    rendered.unmount();
  });
});

const stubMobileNavigationViewport = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('max-width: 760px') || query.includes('max-width:760px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
};

const dispatchTouchPointer = (target: EventTarget, type: string, init: { pointerId: number; clientX: number; clientY: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries({ ...init, pointerType: 'touch' }).forEach(([key, value]) => Object.defineProperty(event, key, { configurable: true, value }));
  target.dispatchEvent(event);
};

const dispatchTouch = (target: EventTarget, type: 'touchstart' | 'touchmove' | 'touchend', init: { identifier: number; clientX: number; clientY: number }) => {
  const touch = { ...init, target };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { configurable: true, value: type === 'touchend' ? [] : [touch] },
    changedTouches: { configurable: true, value: [touch] },
  });
  target.dispatchEvent(event);
};

async function renderMobileProduct(suffix: string, extraUsers: AppUser[] = []) {
  stubMobileNavigationViewport();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/app');
  const user: AppUser = { ...currentUser, id: `mobile-user-${suffix}`, email: `mobile-user-${suffix}@mova.test` };
  const contact: AppUser = { ...friend, id: `mobile-friend-${suffix}`, email: `mobile-friend-${suffix}@mova.test` };
  const chat: AppConversation = { ...conversation, id: `mobile-chat-${suffix}`, title: `Друг ${suffix}`, members: [user, contact] };
  const connect = vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
  const close = vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
  vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [chat] });
  vi.spyOn(api, 'users').mockResolvedValue({ users: [contact, ...extraUsers] });
  vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] });
  vi.spyOn(api, 'markConversationRead').mockResolvedValue({ conversationId: chat.id, userId: user.id, messageIds: [], readAt: '2026-08-10T12:00:00.000Z' });
  const rendered = render(<Product currentUser={user} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);
  await waitFor(() => expect(rendered.container.querySelector('.mova-real-chat-list>button')).toBeInTheDocument());
  return { ...rendered, user, contact, chat, connect, close };
}

describe('Product mobile chat navigation', () => {
  it('does not enable mobile navigation or render a back button in the desktop app', async () => {
    window.movaDesktopShell = {
      platform: 'darwin',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => vi.fn()),
    };
    const setup = await renderMobileProduct('desktop-shell');

    expect(setup.container.querySelector('.mova-tg-app')).not.toHaveClass('is-mobile-navigation');
    expect(screen.queryByRole('button', { name: 'К списку диалогов' })).not.toBeInTheDocument();

    setup.unmount();
  });

  it('keeps the voice dock mounted in both the mobile list and chat views', async () => {
    const user = userEvent.setup();
    const setup = await renderMobileProduct('voice-dock');
    await user.click(setup.container.querySelector<HTMLButtonElement>('.mova-real-chat-list>button')!);
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 50)));
    await user.click(screen.getByRole('button', { name: 'К списку диалогов' }));

    act(() => realtime.listeners.forEach((listener) => listener({
      type: 'call:state',
      conversationId: setup.chat.id,
      status: 'active',
      createdAt: '2026-08-10T12:00:00.000Z',
      startedAt: '2026-08-10T12:00:03.000Z',
      participants: [setup.user.id, setup.contact.id],
      room: [
        { userId: setup.user.id, connectionState: 'reconnecting', muted: false, deafened: false, media: {} },
        { userId: setup.contact.id, connectionState: 'connected', muted: false, deafened: false, media: {} },
      ],
      joined: true,
    })));

    const app = setup.container.querySelector('.mova-tg-app')!;
    const dock = await screen.findByRole('region', { name: `Активный звонок с ${setup.chat.title}` });
    expect(app).toHaveAttribute('data-mobile-view', 'list');
    expect(dock).toBeVisible();
    await user.click(setup.container.querySelector<HTMLButtonElement>('.mova-real-chat-list>button')!);
    expect(app).toHaveAttribute('data-mobile-view', 'chat');
    expect(dock).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'К списку диалогов' }));
    expect(app).toHaveAttribute('data-mobile-view', 'list');
    expect(dock).toBeVisible();
    setup.unmount();
  });

  it('starts on the list and preserves the mounted composer while navigating back', async () => {
    const user = userEvent.setup();
    const setup = await renderMobileProduct('navigation');
    const app = setup.container.querySelector('.mova-tg-app')!;
    const chatButton = setup.container.querySelector<HTMLButtonElement>('.mova-real-chat-list>button')!;

    expect(app).toHaveAttribute('data-mobile-view', 'list');
    expect(setup.container.querySelector('.mova-real-thread')).toHaveAttribute('aria-hidden', 'true');

    await user.click(chatButton);
    expect(app).toHaveAttribute('data-mobile-view', 'chat');
    const composer = screen.getByRole('textbox', { name: `Сообщение в ${setup.chat.title}` });
    await user.type(composer, 'Черновик остаётся');
    expect(composer).toHaveValue('Черновик остаётся');

    await user.click(screen.getByRole('button', { name: 'К списку диалогов' }));
    await waitFor(() => expect(app).toHaveAttribute('data-mobile-view', 'list'));
    expect(composer).toHaveValue('Черновик остаётся');
    expect(within(chatButton).getByText('Черновик:')).toBeVisible();
    expect(chatButton).toHaveTextContent('Черновик остаётся');
    expect(loadConversationDrafts(setup.user.id)[setup.chat.id].text).toBe('Черновик остаётся');

    await user.click(chatButton);
    expect(app).toHaveAttribute('data-mobile-view', 'chat');
    expect(composer).toHaveValue('Черновик остаётся');
    expect(setup.close).not.toHaveBeenCalled();
  });

  it('accepts a touch edge swipe without capturing composer or vertical scroll gestures', async () => {
    const user = userEvent.setup();
    const setup = await renderMobileProduct('swipe');
    const app = setup.container.querySelector('.mova-tg-app')!;
    const chatButton = setup.container.querySelector<HTMLButtonElement>('.mova-real-chat-list>button')!;
    await user.click(chatButton);
    const composer = screen.getByRole('textbox', { name: `Сообщение в ${setup.chat.title}` });
    const messages = setup.container.querySelector('.mova-real-messages')!;

    dispatchTouch(composer, 'touchstart', { identifier: 1, clientX: 8, clientY: 700 });
    dispatchTouch(composer, 'touchend', { identifier: 1, clientX: 130, clientY: 704 });
    expect(app).toHaveAttribute('data-mobile-view', 'chat');

    dispatchTouch(messages, 'touchstart', { identifier: 2, clientX: 8, clientY: 280 });
    dispatchTouch(messages, 'touchmove', { identifier: 2, clientX: 12, clientY: 350 });
    dispatchTouch(messages, 'touchend', { identifier: 2, clientX: 130, clientY: 354 });
    expect(app).toHaveAttribute('data-mobile-view', 'chat');

    dispatchTouch(messages, 'touchstart', { identifier: 3, clientX: 8, clientY: 280 });
    dispatchTouch(messages, 'touchend', { identifier: 3, clientX: 130, clientY: 286 });
    await waitFor(() => expect(app).toHaveAttribute('data-mobile-view', 'list'));
  });

  it('keeps the PointerEvent fallback for touch-capable embedded browsers', async () => {
    const user = userEvent.setup();
    const setup = await renderMobileProduct('pointer-swipe');
    const app = setup.container.querySelector('.mova-tg-app')!;
    await user.click(setup.container.querySelector<HTMLButtonElement>('.mova-real-chat-list>button')!);
    const messages = setup.container.querySelector('.mova-real-messages')!;

    dispatchTouchPointer(messages, 'pointerdown', { pointerId: 4, clientX: 8, clientY: 280 });
    dispatchTouchPointer(messages, 'pointerup', { pointerId: 4, clientX: 130, clientY: 286 });
    await waitFor(() => expect(app).toHaveAttribute('data-mobile-view', 'list'));
  });

  it('closes a list overlay on browser back without opening the selected chat', async () => {
    const user = userEvent.setup();
    const setup = await renderMobileProduct('overlay');
    const app = setup.container.querySelector('.mova-tg-app')!;

    await user.click(screen.getByRole('button', { name: 'Новый разговор' }));
    expect(screen.getByRole('menu', { name: 'Создание разговора' })).toBeVisible();
    const channel = screen.getByRole('menuitem', { name: 'Создать канал — в разработке' });
    expect(channel).toBeDisabled();
    expect(channel).toHaveAttribute('aria-disabled', 'true');
    expect(channel).toHaveTextContent('В разработке');
    expect(screen.getByRole('menuitem', { name: 'Создать группу' })).not.toHaveAttribute('aria-disabled');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Создание разговора' })).not.toBeInTheDocument());
    expect(app).toHaveAttribute('data-mobile-view', 'list');
  });

  it('creates a group from friends in two steps with a title and photo', async () => {
    const user = userEvent.setup();
    const stranger: AppUser = {
      ...friend,
      id: 'mobile-group-stranger',
      name: 'Не в друзьях',
      email: 'mobile-group-stranger@mova.test',
      handle: '@not_friend',
      relationship: 'none',
    };
    const setup = await renderMobileProduct('create-group', [stranger]);
    const createdGroup: AppConversation = {
      id: 'created-group',
      kind: 'group',
      title: 'Наша группа',
      avatarDataUrl: '/uploads/group-avatar.png',
      members: [setup.user, setup.contact],
      lastMessage: null,
      createdAt: '2026-08-20T12:00:00.000Z',
      createdBy: setup.user.id,
    };
    const createConversation = vi.spyOn(api, 'createConversation').mockResolvedValue({ conversation: createdGroup });

    await user.click(screen.getByRole('button', { name: 'Новый разговор' }));
    await user.click(screen.getByRole('menuitem', { name: 'Создать группу' }));

    expect(screen.getByRole('heading', { name: 'Добавить участников' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: new RegExp(setup.contact.name) })).toBeVisible();
    expect(screen.queryByText(stranger.name)).not.toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Перейти к названию группы' });
    expect(next).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: new RegExp(setup.contact.name) }));
    expect(next).toBeEnabled();
    await user.click(next);

    expect(screen.getByRole('heading', { name: 'Создать группу' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Участники группы' })).getByText(setup.contact.name)).toBeVisible();
    const photo = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'group.png', { type: 'image/png' });
    const photoInput = document.querySelector<HTMLInputElement>('.mova-group-photo input')!;
    await user.upload(photoInput, photo);
    expect(await screen.findByAltText('Фото группы')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Название группы' }), createdGroup.title);
    await user.click(screen.getByRole('button', { name: 'Создать группу' }));

    await waitFor(() => expect(createConversation).toHaveBeenCalledWith({
      kind: 'group',
      title: createdGroup.title,
      memberIds: [setup.contact.id],
      avatarDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    }));
    expect((await screen.findAllByText(createdGroup.title)).length).toBeGreaterThan(0);
    setup.unmount();
  });

  it('opens focused global search from the compose menu and searches users, chats, and links', async () => {
    const user = userEvent.setup();
    const setup = await renderMobileProduct('global-search');
    const linkedMessage: AppMessage = {
      id: 'search-link-message',
      conversationId: setup.chat.id,
      authorId: setup.user.id,
      author: setup.user,
      content: 'Документы: https://mova.test/help',
      createdAt: '2026-08-13T10:00:00.000Z',
    };
    act(() => realtime.listeners.forEach((listener) => listener({ type: 'message:new', message: linkedMessage })));
    const messageRequestsBeforeSearch = vi.mocked(api.messages).mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Новый разговор' }));
    await user.click(screen.getByRole('menuitem', { name: 'Начать личный чат' }));

    const search = screen.getByRole('textbox', { name: 'Глобальный поиск' });
    expect(search).toHaveFocus();
    expect(screen.queryByRole('menu', { name: 'Создание разговора' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Пользователи' })).toHaveAttribute('aria-selected', 'true');
    const tabs = screen.getByRole('tablist', { name: 'Область поиска' });
    tabs.scrollLeft = 0;
    fireEvent.wheel(tabs, { deltaY: 48 });
    expect(tabs.scrollLeft).toBe(48);
    expect(screen.queryByText('Введите минимум 2 символа')).not.toBeInTheDocument();
    expect(screen.queryByText('Результаты появятся только после ввода запроса')).not.toBeInTheDocument();
    expect(setup.container.querySelector('.mova-search-result')).not.toBeInTheDocument();
    expect(api.messages).toHaveBeenCalledTimes(messageRequestsBeforeSearch);

    await user.type(search, 'friend');
    expect(screen.getByRole('button', { name: new RegExp(setup.contact.name) })).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Чаты' }));
    await user.clear(search);
    await user.type(search, 'global-search');
    expect(screen.getByRole('button', { name: new RegExp(setup.chat.title) })).toBeVisible();

    await user.clear(search);
    await user.type(search, 'mova.test/help');
    await user.click(screen.getByRole('tab', { name: 'Ссылки' }));
    expect(screen.getByRole('button', { name: /https:\/\/mova\.test\/help/ })).toBeVisible();
  });

  it('gives an incoming call priority over list and browser back navigation', async () => {
    const setup = await renderMobileProduct('call');
    const app = setup.container.querySelector('.mova-tg-app')!;
    expect(app).toHaveAttribute('data-mobile-view', 'list');

    act(() => realtime.listeners.forEach((listener) => listener({ type: 'call:invite', conversationId: setup.chat.id, from: setup.contact, createdAt: '2026-08-10T12:00:00.000Z' })));
    await waitFor(() => expect(app).toHaveAttribute('data-mobile-view', 'chat'));
    expect(await screen.findByRole('region', { name: 'Входящий звонок' })).toBeVisible();

    act(() => window.history.back());
    await waitFor(() => expect(app).toHaveAttribute('data-mobile-view', 'chat'));

    act(() => realtime.listeners.forEach((listener) => listener({ type: 'call:end', conversationId: setup.chat.id, fromUserId: setup.contact.id })));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Входящий звонок' })).not.toBeInTheDocument());
    act(() => window.history.back());
    await waitFor(() => expect(app).toHaveAttribute('data-mobile-view', 'list'));
  });
});

function renderChat(messages: AppMessage[] = []) {
  return render(<RealMessages conversation={conversation} currentUser={currentUser} messages={messages} onSend={vi.fn().mockResolvedValue(undefined)} />);
}

describe('RealMessages friendship controls', () => {
  const stranger: AppUser = { ...friend, id: 'stranger-controls', name: 'Незнакомец', relationship: 'none' };
  const strangerConversation: AppConversation = {
    ...conversation,
    id: 'stranger-controls-chat',
    title: stranger.name,
    members: [currentUser, stranger],
  };

  it('adds a friend from the beginning of a dialog and enables calls after confirmation', async () => {
    const user = userEvent.setup();
    const updated = { ...stranger, relationship: 'outgoing' as const };
    const requestFriend = vi.spyOn(api, 'requestFriend').mockResolvedValue({ user: updated });
    const onRelationshipChange = vi.fn();
    render(<RealMessages conversation={strangerConversation} currentUser={currentUser} messages={[]} onSend={vi.fn()} onRelationshipChange={onRelationshipChange} />);

    const callButton = screen.getByRole('button', { name: 'Звонки доступны только друзьям' });
    const callTooltip = screen.getByRole('tooltip', { name: 'Вы не в друзьях' });
    expect(callButton).toBeDisabled();
    expect(callButton).toHaveAttribute('aria-describedby', callTooltip.id);
    expect(callButton.parentElement).toHaveClass('mova-tooltip', 'mova-tooltip--bottom');

    await user.click(screen.getByRole('button', { name: 'Подробнее' }));
    const detailsMenu = screen.getByRole('menu', { name: 'Действия с чатом' });
    const voiceCallItem = within(detailsMenu).getByRole('menuitem', { name: 'Позвонить' });
    const videoCallItem = within(detailsMenu).getByRole('menuitem', { name: 'Видеозвонок' });
    const menuTooltips = within(detailsMenu).getAllByRole('tooltip', { name: 'Вы не в друзьях' });
    expect(voiceCallItem).toBeDisabled();
    expect(videoCallItem).toBeDisabled();
    expect(menuTooltips).toHaveLength(2);
    expect(voiceCallItem).toHaveAttribute('aria-describedby', menuTooltips[0].id);
    expect(videoCallItem).toHaveAttribute('aria-describedby', menuTooltips[1].id);
    await user.click(screen.getByRole('button', { name: 'Подробнее' }));

    await user.click(screen.getByRole('button', { name: 'Добавить в друзья' }));

    await waitFor(() => expect(requestFriend).toHaveBeenCalledWith(stranger.id));
    expect(onRelationshipChange).toHaveBeenCalledWith(updated);
    expect(screen.getByRole('button', { name: 'Отменить заявку в друзья' })).toBeVisible();
  });

  it('accepts an incoming request in the opened profile', async () => {
    const user = userEvent.setup();
    const requester: AppUser = { ...stranger, relationship: 'incoming' };
    const incomingConversation: AppConversation = { ...strangerConversation, members: [currentUser, requester] };
    const accepted = { ...requester, relationship: 'friend' as const };
    const acceptFriend = vi.spyOn(api, 'acceptFriend').mockResolvedValue({ user: accepted });
    render(<RealMessages conversation={incomingConversation} currentUser={currentUser} messages={[]} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: `Открыть информацию о ${incomingConversation.title}` }));
    const profile = screen.getByRole('complementary', { name: `Информация о ${incomingConversation.title}` });
    await user.click(within(profile).getByRole('button', { name: 'Принять заявку в друзья' }));

    await waitFor(() => expect(acceptFriend).toHaveBeenCalledWith(requester.id));
    expect(within(profile).getByRole('button', { name: 'Удалить из друзей' })).toBeVisible();
  });

  it('accepts an incoming request from its system card', async () => {
    const user = userEvent.setup();
    const requester: AppUser = { ...stranger, relationship: 'incoming' };
    const incomingConversation: AppConversation = { ...strangerConversation, members: [currentUser, requester] };
    const requestMessage: AppMessage = {
      id: 'friend-request-card',
      conversationId: incomingConversation.id,
      authorId: requester.id,
      author: requester,
      kind: 'friend_request',
      content: 'Заявка в друзья',
      friendRequest: { requestedBy: requester.id, status: 'pending' },
      createdAt: '2026-08-13T12:00:00.000Z',
    };
    const accepted = { ...requester, relationship: 'friend' as const };
    const acceptFriend = vi.spyOn(api, 'acceptFriend').mockResolvedValue({ user: accepted });
    render(<RealMessages conversation={incomingConversation} currentUser={currentUser} messages={[requestMessage]} onSend={vi.fn()} />);

    expect(screen.getByRole('article', { name: `${requester.name} хочет добавить тебя в друзья` })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Принять' }));

    await waitFor(() => expect(acceptFriend).toHaveBeenCalledWith(requester.id));
    expect(screen.getByRole('article', { name: 'Теперь вы друзья' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Отклонить' })).not.toBeInTheDocument();
  });

  it('declines an incoming request from its system card', async () => {
    const user = userEvent.setup();
    const requester: AppUser = { ...stranger, relationship: 'incoming' };
    const incomingConversation: AppConversation = { ...strangerConversation, members: [currentUser, requester] };
    const requestMessage: AppMessage = {
      id: 'friend-request-decline-card',
      conversationId: incomingConversation.id,
      authorId: requester.id,
      author: requester,
      kind: 'friend_request',
      content: 'Заявка в друзья',
      friendRequest: { requestedBy: requester.id, status: 'pending' },
      createdAt: '2026-08-13T12:00:00.000Z',
    };
    const rejected = { ...requester, relationship: 'none' as const };
    const rejectFriend = vi.spyOn(api, 'rejectFriend').mockResolvedValue({ user: rejected });
    render(<RealMessages conversation={incomingConversation} currentUser={currentUser} messages={[requestMessage]} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() => expect(rejectFriend).toHaveBeenCalledWith(requester.id));
    expect(screen.getByRole('article', { name: 'Заявка отклонена' })).toBeVisible();
    expect(screen.getByText('Повторную заявку можно будет отправить через 24 часа')).toBeVisible();
  });

  it('blocks a user from the beginning of a dialog and disables messaging', async () => {
    const user = userEvent.setup();
    const blocked = { ...stranger, relationship: 'blocked' as const };
    const blockUser = vi.spyOn(api, 'blockUser').mockResolvedValue({ user: blocked });
    render(<RealMessages conversation={strangerConversation} currentUser={currentUser} messages={[]} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Заблокировать' }));

    await waitFor(() => expect(blockUser).toHaveBeenCalledWith(stranger.id));
    expect(screen.getByRole('button', { name: 'Разблокировать' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: `Сообщение в ${strangerConversation.title}` })).toBeDisabled();
  });
});

describe('RealMessages unread navigation', () => {
  it('shows a counted jump-to-latest button while the message list is scrolled up', async () => {
    const incoming: AppMessage = {
      id: 'unread-navigation-message',
      conversationId: conversation.id,
      authorId: friend.id,
      author: friend,
      content: 'Непрочитанное сообщение',
      createdAt: '2026-08-13T12:00:00.000Z',
      readBy: [],
    };
    const rendered = render(<RealMessages conversation={{ ...conversation, unreadCount: 3 }} currentUser={currentUser} messages={[incoming]} unreadCount={3} onSend={vi.fn()} />);
    const messageList = rendered.container.querySelector<HTMLElement>('.mova-real-messages')!;
    Object.defineProperties(messageList, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
    });
    messageList.scrollTop = 200;
    fireEvent.scroll(messageList);

    const jump = screen.getByRole('button', { name: 'Перейти к последним сообщениям, непрочитанных: 3' });
    expect(jump).toHaveTextContent('3');
    const scrollTo = vi.fn();
    Object.defineProperty(messageList, 'scrollTo', { configurable: true, value: scrollTo });
    await userEvent.setup().click(jump);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });
});

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

  it('renders audio attachments as voice messages with waveform and playback speed', async () => {
    const user = userEvent.setup();
    const message: AppMessage = {
      id: 'voice-message',
      conversationId: conversation.id,
      authorId: friend.id,
      content: '',
      attachment: {
        name: 'Голосовое сообщение.webm',
        type: 'audio/webm;codecs=opus',
        size: 2048,
        url: '/uploads/voice.webm',
        durationMs: 12_400,
        waveform: [0.2, 0.6, 0.35, 0.8, 0.45, 1, 0.4, 0.7],
      },
      createdAt: '2026-08-10T00:01:00.000Z',
      author: friend,
    };
    const { container } = renderChat([message]);

    expect(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' })).toBeVisible();
    expect(screen.getByText('0:12')).toBeVisible();
    expect(screen.getByRole('img', { name: 'Голосовое сообщение ещё не прослушано' })).toBeVisible();
    expect(container.querySelector('.mova-real-bubble')).toHaveClass('has-voice');
    expect(screen.queryByRole('link', { name: /Голосовое сообщение/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Скорость воспроизведения 1×' }));
    expect(screen.getByRole('button', { name: 'Скорость воспроизведения 1.5×' })).toBeVisible();
  });

  it('opens one functional top player with volume, mute, seek, speed and close controls', async () => {
    window.localStorage.removeItem('mova-voice-message-volume');
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const message: AppMessage = {
      id: 'voice-player-message',
      conversationId: conversation.id,
      authorId: friend.id,
      content: '',
      attachment: {
        name: 'Голосовое сообщение.webm',
        type: 'audio/webm;codecs=opus',
        size: 2048,
        url: '/uploads/player-voice.webm',
        durationMs: 12_400,
        waveform: [0.2, 0.6, 0.35, 0.8, 0.45, 1, 0.4, 0.7],
      },
      createdAt: new Date().toISOString(),
      author: friend,
    };
    const { container } = renderChat([message]);

    await user.click(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' }));
    expect(play).toHaveBeenCalledOnce();
    expect(await screen.findByRole('region', { name: 'Проигрыватель голосового сообщения' })).toBeVisible();
    expect(screen.getByText(friend.name, { selector: '.mova-voice-player__identity strong' })).toBeVisible();

    const audio = container.querySelector<HTMLAudioElement>('.mova-voice-player__audio')!;
    expect(audio.volume).toBe(1);
    const mute = screen.getByRole('button', { name: 'Выключить звук голосового сообщения' });
    await user.click(mute);
    expect(audio.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Включить звук голосового сообщения' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.mova-voice-player__volume')).toHaveClass('is-open');

    fireEvent.change(screen.getByRole('slider', { name: 'Громкость голосового сообщения' }), { target: { value: '0.35' } });
    expect(audio.volume).toBe(0.35);
    expect(audio.muted).toBe(false);
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500, pointerType: 'mouse' });
    expect(container.querySelector('.mova-voice-player__volume')).not.toHaveClass('is-open');

    await user.click(screen.getByRole('button', { name: 'Скорость голосового сообщения 1X' }));
    expect(screen.getByRole('menu', { name: 'Скорость воспроизведения' })).toBeVisible();
    await user.click(screen.getByRole('menuitemradio', { name: '2x' }));
    expect(audio.playbackRate).toBe(2);
    expect(screen.getByRole('button', { name: 'Скорость голосового сообщения 2X' })).toHaveTextContent('2X');
    await user.click(screen.getByRole('button', { name: 'Скорость голосового сообщения 2X' }));
    expect(screen.getByRole('menu', { name: 'Скорость воспроизведения' })).toBeVisible();
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500, pointerType: 'mouse' });
    expect(screen.queryByRole('menu', { name: 'Скорость воспроизведения' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Вперёд на 10 секунд' }));
    expect(audio.currentTime).toBe(10);
    await user.click(screen.getByRole('button', { name: 'Закрыть голосовое сообщение' }));
    expect(screen.queryByRole('region', { name: 'Проигрыватель голосового сообщения' })).not.toBeInTheDocument();
    expect(container.querySelector('.mova-voice-player')).toHaveClass('is-closing');
    expect(container.querySelector('.mova-real-thread')).not.toHaveClass('has-voice-player');
    await waitFor(() => expect(container.querySelector('.mova-voice-player')).not.toBeInTheDocument());
    expect(pause).toHaveBeenCalled();
  });

  it('closes the top player automatically when voice playback ends', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const message: AppMessage = {
      id: 'finished-voice-player-message',
      conversationId: conversation.id,
      authorId: friend.id,
      content: '',
      attachment: {
        name: 'Голосовое сообщение.webm',
        type: 'audio/webm;codecs=opus',
        size: 2048,
        url: '/uploads/finished-voice.webm',
        durationMs: 4_000,
        waveform: [0.2, 0.6, 0.35, 0.8],
      },
      createdAt: new Date().toISOString(),
      author: friend,
    };
    const { container } = renderChat([message]);

    await user.click(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' }));
    expect(await screen.findByRole('region', { name: 'Проигрыватель голосового сообщения' })).toBeVisible();

    fireEvent.ended(container.querySelector<HTMLAudioElement>('.mova-voice-player__audio')!);

    expect(screen.queryByRole('region', { name: 'Проигрыватель голосового сообщения' })).not.toBeInTheDocument();
    expect(container.querySelector('.mova-voice-player')).toHaveClass('is-closing');
    await waitFor(() => expect(container.querySelector('.mova-voice-player')).not.toBeInTheDocument());
  });

  it('keeps voice playback and its top player active when another conversation opens', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const voiceMessage: AppMessage = {
      id: 'persistent-voice-player-message',
      conversationId: conversation.id,
      authorId: friend.id,
      content: '',
      attachment: {
        name: 'Голосовое сообщение.webm',
        type: 'audio/webm;codecs=opus',
        size: 2048,
        url: '/uploads/persistent-voice.webm',
        durationMs: 8_000,
        waveform: [0.2, 0.6, 0.35, 0.8],
      },
      createdAt: new Date().toISOString(),
      author: friend,
    };
    const otherFriend = { ...friend, id: 'other-voice-friend', name: 'Другой контакт' };
    const otherConversation: AppConversation = {
      ...conversation,
      id: 'other-voice-chat',
      title: otherFriend.name,
      members: [currentUser, otherFriend],
    };
    const rendered = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[voiceMessage]} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' }));
    expect(await screen.findByRole('region', { name: 'Проигрыватель голосового сообщения' })).toBeVisible();
    const pausesBeforeSwitch = pause.mock.calls.length;

    rendered.rerender(<RealMessages conversation={otherConversation} currentUser={currentUser} messages={[]} onSend={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Проигрыватель голосового сообщения' })).toBeVisible();
    expect(rendered.container.querySelector('.mova-voice-player__audio')).toHaveAttribute('data-voice-message-id', voiceMessage.id);
    expect(pause).toHaveBeenCalledTimes(pausesBeforeSwitch);
  });

  it('hides the voice dot after the current user has listened', () => {
    const message: AppMessage = {
      id: 'listened-voice-message',
      conversationId: conversation.id,
      authorId: friend.id,
      content: '',
      attachment: {
        name: 'Голосовое сообщение.webm',
        type: 'audio/webm;codecs=opus',
        size: 2048,
        url: '/uploads/listened-voice.webm',
        durationMs: 4_000,
        waveform: [0.2, 0.6, 0.35, 0.8, 0.45, 1, 0.4, 0.7],
      },
      listenedBy: [{ userId: currentUser.id, listenedAt: '2026-08-14T00:00:00.000Z' }],
      createdAt: '2026-08-10T00:01:00.000Z',
      author: friend,
    };

    renderChat([message]);

    expect(screen.queryByRole('img', { name: 'Голосовое сообщение ещё не прослушано' })).not.toBeInTheDocument();
  });
});

describe('RealMessages composer behavior', () => {
  it('restores a persisted draft and clears it when the message is submitted', async () => {
    const onDraftChange = vi.fn();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} draftText="Сохранённый черновик" onDraftChange={onDraftChange} onSend={onSend} />);
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    await waitFor(() => expect(composer).toHaveValue('Сохранённый черновик'));
    fireEvent.change(composer, { target: { value: 'Обновлённый черновик' } });
    expect(onDraftChange).toHaveBeenLastCalledWith('Обновлённый черновик');
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Обновлённый черновик', undefined, undefined));
    expect(onDraftChange).toHaveBeenLastCalledWith('');
  });

  it('uses the reference mic action for an empty composer and switches to send for text', () => {
    renderChat();
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    expect(screen.getByRole('button', { name: 'Записать голосовое сообщение' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Отправить' })).not.toBeInTheDocument();
    fireEvent.change(composer, { target: { value: 'Готово' } });
    expect(screen.queryByRole('button', { name: 'Записать голосовое сообщение' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });

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
    expect(composer).toHaveStyle({ height: '40px', overflowY: 'hidden' });
  });

  it('renders Apple emoji in the composer while keeping the textarea editable', () => {
    const { container } = renderChat();
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });

    fireEvent.change(composer, { target: { value: 'Привет 😀' } });

    expect(composer).toHaveValue('Привет 😀');
    expect(container.querySelector('.mova-composer-textarea')).toHaveClass('has-value');
    const renderedEmoji = container.querySelector('.mova-composer-textarea__mirror img.emoji');
    expect(renderedEmoji).toHaveAttribute('alt', '😀');
    expect(renderedEmoji).toHaveAttribute('src', expect.stringContaining('emoji-datasource-apple'));
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
    await user.click(screen.getByRole('button', { name: 'Редактировать сообщение' }));
    const composer = screen.getByRole('textbox', { name: 'Сообщение в Друг' });
    await user.clear(composer);
    await user.type(composer, 'Исправленный текст');
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    expect(onEdit).toHaveBeenCalledWith('own-editable', 'Исправленный текст');
  });

  it('cancels editing with Escape and keeps the established empty composer state', async () => {
    const user = userEvent.setup();
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[own]} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole('button', { name: 'Редактировать сообщение' }));
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

describe('RealMessages group management', () => {
  const teammate: AppUser = { ...friend, id: 'group-teammate', name: 'Участник', handle: '@teammate' };
  const candidate: AppUser = { ...friend, id: 'group-candidate', name: 'Новый друг', handle: '@candidate' };
  const groupConversation: AppConversation = {
    ...conversation,
    id: 'managed-group',
    kind: 'group',
    title: 'Команда',
    createdBy: currentUser.id,
    members: [currentUser, teammate],
    memberRoles: { [currentUser.id]: 'owner', [teammate.id]: 'member' },
  };

  it('shows the full member list without a duplicate owner card and edits the group in the side panel', async () => {
    const user = userEvent.setup();
    const renamed = { ...groupConversation, title: 'Новая команда' };
    const updateConversation = vi.spyOn(api, 'updateConversation').mockResolvedValue({ conversation: renamed });
    const onConversationChange = vi.fn();
    render(<RealMessages conversation={groupConversation} currentUser={currentUser} messages={[]} availableUsers={[candidate]} onConversationChange={onConversationChange} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: `Открыть информацию о ${groupConversation.title}` }));
    const info = screen.getByRole('complementary', { name: `Информация о ${groupConversation.title}` });
    expect(within(info).queryByText('Владелец группы')).not.toBeInTheDocument();
    expect(within(info).getByRole('region', { name: 'Участники группы' })).toHaveTextContent(currentUser.name);
    expect(within(info).getByRole('region', { name: 'Участники группы' })).toHaveTextContent(teammate.name);
    expect(within(info).getByRole('button', { name: `Открыть информацию о ${currentUser.name}` })).toHaveTextContent('Владелец');

    await user.click(within(info).getByRole('button', { name: 'Изменить группу' }));
    const editor = screen.getByRole('complementary', { name: `Редактирование группы ${groupConversation.title}` });
    expect(screen.queryByRole('dialog', { name: 'Изменить' })).not.toBeInTheDocument();
    const title = within(editor).getByRole('textbox', { name: 'Название группы' });
    await user.clear(title);
    await user.type(title, renamed.title);
    await user.click(within(editor).getByRole('button', { name: 'Готово' }));

    await waitFor(() => expect(updateConversation).toHaveBeenCalledWith(groupConversation.id, { title: renamed.title }));
    expect(onConversationChange).toHaveBeenCalledWith(renamed);
  });

  it('does not show the edit action to an ordinary member', async () => {
    const user = userEvent.setup();
    const memberView = { ...groupConversation, memberRoles: { [currentUser.id]: 'member', [teammate.id]: 'owner' } as AppConversation['memberRoles'], createdBy: teammate.id };
    render(<RealMessages conversation={memberView} currentUser={currentUser} messages={[]} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: `Открыть информацию о ${memberView.title}` }));
    const info = screen.getByRole('complementary', { name: `Информация о ${memberView.title}` });
    expect(within(info).queryByRole('button', { name: 'Изменить группу' })).not.toBeInTheDocument();
    expect(within(info).queryByText('Владелец группы')).not.toBeInTheDocument();
    expect(within(info).getByRole('button', { name: `Открыть информацию о ${teammate.name}` })).toHaveTextContent('Владелец');
  });

  it('opens a participant profile in the same panel and exposes message and call actions', async () => {
    const user = userEvent.setup();
    const onOpenDirectConversation = vi.fn();
    const onStartDirectCall = vi.fn();
    render(<RealMessages conversation={groupConversation} currentUser={currentUser} messages={[]} onOpenDirectConversation={onOpenDirectConversation} onStartDirectCall={onStartDirectCall} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: `Открыть информацию о ${groupConversation.title}` }));
    await user.click(screen.getByRole('button', { name: `Открыть информацию о ${teammate.name}` }));

    const memberInfo = screen.getByRole('complementary', { name: `Информация о ${teammate.name}` });
    expect(within(memberInfo).getByRole('button', { name: 'Назад к информации о группе' })).toBeVisible();
    expect(within(memberInfo).getByText(teammate.handle.replace(/^@/, ''))).toBeVisible();

    await user.click(within(memberInfo).getByRole('button', { name: 'Написать' }));
    expect(onOpenDirectConversation).toHaveBeenCalledWith(teammate);

    await user.click(within(memberInfo).getByRole('button', { name: `Действия с ${teammate.name}` }));
    await user.click(within(memberInfo).getByRole('menuitem', { name: 'Позвонить' }));
    expect(onStartDirectCall).toHaveBeenCalledWith(teammate, false);

    await user.click(within(memberInfo).getByRole('button', { name: `Действия с ${teammate.name}` }));
    await user.click(within(memberInfo).getByRole('menuitem', { name: 'Видеозвонок' }));
    expect(onStartDirectCall).toHaveBeenCalledWith(teammate, true);

    await user.click(within(memberInfo).getByRole('button', { name: 'Назад к информации о группе' }));
    expect(screen.getByRole('complementary', { name: `Информация о ${groupConversation.title}` })).toBeVisible();
  });

  it('shows the edit action to a promoted administrator', async () => {
    const user = userEvent.setup();
    const adminView = { ...groupConversation, memberRoles: { [currentUser.id]: 'admin', [teammate.id]: 'owner' } as AppConversation['memberRoles'], createdBy: teammate.id };
    render(<RealMessages conversation={adminView} currentUser={currentUser} messages={[]} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: `Открыть информацию о ${adminView.title}` }));
    const info = screen.getByRole('complementary', { name: `Информация о ${adminView.title}` });
    expect(within(info).getByRole('button', { name: 'Изменить группу' })).toBeVisible();
  });

  it('lets the owner promote administrators and add or remove members from the editor', async () => {
    const user = userEvent.setup();
    const promoted = { ...groupConversation, memberRoles: { ...groupConversation.memberRoles, [teammate.id]: 'admin' as const } };
    const withCandidate = { ...promoted, members: [...promoted.members, candidate], memberRoles: { ...promoted.memberRoles, [candidate.id]: 'member' as const } };
    const withoutTeammate = { ...withCandidate, members: withCandidate.members.filter((member) => member.id !== teammate.id) };
    const setRole = vi.spyOn(api, 'setConversationMemberRole').mockResolvedValue({ conversation: promoted });
    const addMember = vi.spyOn(api, 'addConversationMembers').mockResolvedValue({ conversation: withCandidate });
    const removeMember = vi.spyOn(api, 'removeConversationMember').mockResolvedValue({ conversation: withoutTeammate, removedUserId: teammate.id });
    render(<RealMessages conversation={groupConversation} currentUser={currentUser} messages={[]} availableUsers={[candidate]} onSend={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: `Открыть информацию о ${groupConversation.title}` }));
    await user.click(screen.getByRole('button', { name: 'Изменить группу' }));
    await user.click(screen.getByRole('button', { name: /Администраторы/ }));
    await user.click(screen.getByRole('button', { name: 'Назначить' }));
    await waitFor(() => expect(setRole).toHaveBeenCalledWith(groupConversation.id, teammate.id, 'admin'));

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await user.click(screen.getByRole('button', { name: /Участники/ }));
    await user.click(screen.getByRole('button', { name: /Добавить участников/ }));
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(addMember).toHaveBeenCalledWith(groupConversation.id, [candidate.id]));

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await user.click(screen.getByRole('button', { name: `Удалить ${teammate.name} из группы` }));
    await user.click(screen.getByRole('button', { name: 'Удалить из группы' }));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith(groupConversation.id, teammate.id));
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

  it('keeps only Edit in visible actions and moves Reply to the context menu', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incoming, own]} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={onEdit} />);

    expect(screen.queryByRole('button', { name: 'Ответить на сообщение' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Редактировать сообщение' }));
    expect(screen.getByText('Редактирование сообщения')).toBeVisible();
  });

  it('shows the requested context actions and keeps them keyboard-accessible', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incoming, own]} onSend={vi.fn().mockResolvedValue(undefined)} onEdit={onEdit} />);

    fireEvent.contextMenu(container.querySelectorAll('.mova-real-message')[0]);
    expect(within(screen.getByRole('menu', { name: 'Действия с сообщением' })).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Ответить',
      'Копировать',
      'Перевести',
      'Закрепить',
      'Переслать',
      'Выбрать',
      'Удалить',
    ]);
    const replyAction = screen.getByRole('menuitem', { name: 'Ответить' });
    replyAction.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('В ответ Друг')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Отменить ответ' }));
    const editAction = screen.getByRole('button', { name: 'Редактировать сообщение' });
    editAction.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Редактирование сообщения')).toBeVisible();
  });

  it('hides the message context menu after the pointer moves sufficiently far away', () => {
    const { container } = renderChat([incoming]);
    fireEvent.contextMenu(container.querySelector('.mova-real-message')!, { clientX: 120, clientY: 120 });
    expect(screen.getByRole('menu', { name: 'Действия с сообщением' })).toBeVisible();

    fireEvent.pointerMove(window, { clientX: 170, clientY: 160, pointerType: 'mouse' });
    expect(screen.getByRole('menu', { name: 'Действия с сообщением' })).toBeVisible();
    fireEvent.pointerMove(window, { clientX: 700, clientY: 650, pointerType: 'mouse' });
    expect(screen.queryByRole('menu', { name: 'Действия с сообщением' })).not.toBeInTheDocument();
  });

  it('copies, pins and selects a message from the context menu', async () => {
    const user = userEvent.setup();
    const onPinMessage = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incoming]} onSend={vi.fn().mockResolvedValue(undefined)} onPinMessage={onPinMessage} />);
    const article = container.querySelector('.mova-real-message')!;
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');

    fireEvent.contextMenu(article);
    await user.click(screen.getByRole('menuitem', { name: 'Копировать' }));
    expect(writeText).toHaveBeenCalledWith(incoming.content);

    fireEvent.contextMenu(article);
    await user.click(screen.getByRole('menuitem', { name: 'Закрепить' }));
    expect(onPinMessage).toHaveBeenCalledWith(incoming.id, true);

    fireEvent.contextMenu(article);
    await user.click(screen.getByRole('menuitem', { name: 'Выбрать' }));
    expect(article).toHaveClass('is-selectable', 'is-selected');
    expect(screen.getByText('1 сообщение')).toBeVisible();
  });

  it('shows bottom bulk actions, deletes own selections for everyone and exits with Escape', async () => {
    const user = userEvent.setup();
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    const secondOwn = { ...own, id: 'quick-own-second', content: 'Второе своё сообщение' };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[own, secondOwn]} onSend={vi.fn().mockResolvedValue(undefined)} onDeleteMessage={onDeleteMessage} onForwardMessage={vi.fn().mockResolvedValue(undefined)} />);
    const articles = container.querySelectorAll('.mova-real-message');

    fireEvent.contextMenu(articles[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Выбрать' }));
    await user.click(articles[1]);
    expect(screen.getByRole('toolbar', { name: 'Действия с выбранными сообщениями' })).toBeVisible();
    expect(screen.getByText('2 сообщения')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Удалить выбранные сообщения' }));
    expect(screen.getByRole('menu', { name: 'Как удалить сообщения' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Удалить у всех' }));
    await user.click(screen.getByRole('button', { name: 'Удалить у всех' }));
    expect(onDeleteMessage).toHaveBeenCalledTimes(2);
    expect(onDeleteMessage).toHaveBeenNthCalledWith(1, own.id, 'everyone');
    expect(onDeleteMessage).toHaveBeenNthCalledWith(2, secondOwn.id, 'everyone');
    expect(screen.queryByRole('toolbar', { name: 'Действия с выбранными сообщениями' })).not.toBeInTheDocument();

    fireEvent.contextMenu(articles[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Выбрать' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Действия с выбранными сообщениями' })).not.toBeInTheDocument();
    expect(articles[0]).not.toHaveClass('is-selectable', 'is-selected');
  });

  it('forwards every selected message from the bottom action bar', async () => {
    const user = userEvent.setup();
    const destination: AppConversation = { ...conversation, id: 'bulk-destination', kind: 'group', title: 'Команда', members: [currentUser, friend] };
    const onForwardMessage = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incoming, own]} availableConversations={[conversation, destination]} onSend={vi.fn().mockResolvedValue(undefined)} onForwardMessage={onForwardMessage} />);
    const articles = container.querySelectorAll('.mova-real-message');

    fireEvent.contextMenu(articles[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Выбрать' }));
    await user.click(articles[1]);
    await user.click(screen.getByRole('button', { name: 'Переслать выбранные сообщения' }));
    expect(screen.getByRole('dialog', { name: 'Переслать 2 сообщения' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Команда/ }));

    expect(onForwardMessage).toHaveBeenCalledTimes(2);
    expect(onForwardMessage).toHaveBeenNthCalledWith(1, incoming.id, destination.id);
    expect(onForwardMessage).toHaveBeenNthCalledWith(2, own.id, destination.id);
    expect(screen.queryByRole('toolbar', { name: 'Действия с выбранными сообщениями' })).not.toBeInTheDocument();
  });

  it('renders the pinned message bar with the reference thumbnail and numbered title', () => {
    const pinnedImage: AppMessage = {
      ...incoming,
      id: 'pinned-image',
      content: 'Фотография',
      pinnedAt: '2026-08-20T18:10:00.000Z',
      attachment: { name: 'photo.png', type: 'image/png', size: 1024, url: '/uploads/photo.png' },
    };
    const olderPinned: AppMessage = {
      ...incoming,
      id: 'older-pinned',
      content: 'Ссылка',
      pinnedAt: '2026-08-20T18:00:00.000Z',
    };
    const { container } = renderChat([olderPinned, pinnedImage]);

    const pinned = screen.getByLabelText('Закреплённое сообщение');
    expect(pinned).toHaveTextContent('Закреплённое сообщение #1');
    expect(pinned).toHaveTextContent('Фотография');
    expect(container.querySelector('.mova-pinned-message__thumbnail img')).toHaveAttribute('src', '/uploads/photo.png');
  });

  it('forwards to a chosen chat and confirms deletion', async () => {
    const user = userEvent.setup();
    const destination: AppConversation = { ...conversation, id: 'destination', kind: 'group', title: 'Команда', members: [currentUser, friend] };
    const onForwardMessage = vi.fn().mockResolvedValue(undefined);
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <RealMessages
        conversation={conversation}
        currentUser={currentUser}
        messages={[incoming]}
        availableConversations={[conversation, destination]}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onForwardMessage={onForwardMessage}
        onDeleteMessage={onDeleteMessage}
      />,
    );
    const article = container.querySelector('.mova-real-message')!;

    fireEvent.contextMenu(article);
    await user.click(screen.getByRole('menuitem', { name: 'Переслать' }));
    await user.click(screen.getByRole('button', { name: /Команда/ }));
    expect(onForwardMessage).toHaveBeenCalledWith(incoming.id, destination.id);

    fireEvent.contextMenu(article);
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    expect(screen.getByRole('dialog', { name: 'Удалить сообщение?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Удалить у себя' }));
    expect(onDeleteMessage).toHaveBeenCalledWith(incoming.id, 'self');
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

    await user.click(screen.getAllByRole('button', { name: 'Редактировать сообщение' })[0]);
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
    expect(screen.getByRole('button', { name: 'Записать голосовое сообщение' })).toBeVisible();
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
  it('keeps presence in the header and shows typing above the composer', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} typingUserIds={[]} onSend={onSend} />);

    expect(screen.getByText('в сети')).toBeVisible();
    expect(screen.queryByText('Друг печатает…')).not.toBeInTheDocument();

    rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} typingUserIds={[friend.id]} onSend={onSend} />);
    expect(screen.getByText('в сети')).toBeVisible();
    expect(screen.getByText('Друг печатает…')).toBeVisible();
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

describe('Product persistent offline outbox', () => {
  it('restores edited offline messages after remount and resolves queued reply dependencies without duplicates', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const offlineUser: AppUser = { ...currentUser, id: 'offline-user', email: 'offline-user@mova.test' };
    const offlineFriend: AppUser = { ...friend, id: 'offline-friend', email: 'offline-friend@mova.test' };
    const offlineConversation: AppConversation = { ...conversation, id: 'offline-chat', members: [offlineUser, offlineFriend] };
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [offlineConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [offlineFriend] });
    vi.spyOn(api, 'messages').mockResolvedValue({ messages: [] });
    const sendMessage = vi.spyOn(api, 'sendMessage');
    const editMessage = vi.spyOn(api, 'editMessage');

    const first = render(<Product currentUser={offlineUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);
    const composer = await screen.findByRole('textbox', { name: 'Сообщение в Друг' });
    await userEvent.setup().type(composer, 'Сообщение из офлайна{Enter}');

    expect(await screen.findByLabelText('В очереди — отправится после подключения')).toBeVisible();
    expect(screen.getByText('Нет соединения · новые сообщения останутся в очереди')).toBeVisible();
    expect(sendMessage).not.toHaveBeenCalled();

    const queuedArticle = screen.getAllByText('Сообщение из офлайна').map((element) => element.closest('article')).find(Boolean)!;
    await userEvent.setup().click(within(queuedArticle).getByRole('button', { name: 'Редактировать сообщение' }));
    await userEvent.setup().clear(composer);
    await userEvent.setup().type(composer, 'Отредактировано в офлайне{Enter}');
    expect((await screen.findAllByText('Отредактировано в офлайне')).length).toBeGreaterThan(0);
    expect(editMessage).not.toHaveBeenCalled();

    const editedArticle = screen.getAllByText('Отредактировано в офлайне').map((element) => element.closest('article')).find(Boolean)!;
    fireEvent.contextMenu(editedArticle);
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Ответить' }));
    await userEvent.setup().type(composer, 'Offline-ответ на queued-сообщение{Enter}');
    expect((await screen.findAllByText('Offline-ответ на queued-сообщение')).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('В очереди — отправится после подключения')).toHaveLength(2);
    first.unmount();

    online = true;
    sendMessage.mockImplementation(async (conversationId, content, attachment, replyToId, clientId) => {
      if (content === 'Offline-ответ на queued-сообщение') expect(replyToId).toBe('offline-server-parent');
      return { message: {
        id: content === 'Offline-ответ на queued-сообщение' ? 'offline-server-reply' : 'offline-server-parent',
        clientId,
        conversationId,
        authorId: offlineUser.id,
        author: offlineUser,
        content,
        attachment,
        replyToId,
        createdAt: '2026-08-13T02:00:00.000Z',
        sentAt: '2026-08-13T02:00:01.000Z',
      } };
    });
    render(<Product currentUser={offlineUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);

    expect((await screen.findAllByText('Offline-ответ на queued-сообщение')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByLabelText('Отправлено')).toHaveLength(2));
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][1]).toBe('Отредактировано в офлайне');
    const sentClientId = sendMessage.mock.calls[0][4];
    expect(sentClientId).toMatch(/^client_/u);
    expect(document.querySelectorAll('article.mova-real-message')).toHaveLength(2);
    expect(screen.queryByLabelText('В очереди — отправится после подключения')).not.toBeInTheDocument();
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

describe('Product reconnect history sync', () => {
  it('merges messages missed while the active chat websocket was disconnected', async () => {
    const reconnectUser: AppUser = { ...currentUser, id: 'reconnect-user', email: 'reconnect-user@mova.test' };
    const reconnectFriend: AppUser = { ...friend, id: 'reconnect-friend', email: 'reconnect-friend@mova.test' };
    const reconnectConversation: AppConversation = { ...conversation, id: 'reconnect-chat', members: [reconnectUser, reconnectFriend] };
    const initial: AppMessage = { id: 'before-disconnect', conversationId: reconnectConversation.id, authorId: reconnectUser.id, author: reconnectUser, content: 'До разрыва', createdAt: '2026-08-13T10:00:00.000Z' };
    const missed: AppMessage = { id: 'missed-during-disconnect', conversationId: reconnectConversation.id, authorId: reconnectFriend.id, author: reconnectFriend, content: 'Пропущено во время разрыва', createdAt: '2026-08-13T10:01:00.000Z' };
    vi.spyOn(realtime, 'connect').mockImplementation(() => undefined);
    vi.spyOn(realtime, 'close').mockImplementation(() => undefined);
    vi.spyOn(api, 'conversations').mockResolvedValue({ conversations: [reconnectConversation] });
    vi.spyOn(api, 'users').mockResolvedValue({ users: [reconnectFriend] });
    const messages = vi.spyOn(api, 'messages').mockResolvedValueOnce({ messages: [initial] }).mockResolvedValue({ messages: [initial, missed] });
    vi.spyOn(api, 'markConversationRead').mockResolvedValue({ conversationId: reconnectConversation.id, userId: reconnectUser.id, messageIds: [missed.id], readAt: '2026-08-13T10:02:00.000Z' });
    const rendered = render(<Product currentUser={reconnectUser} onUserUpdate={vi.fn()} onLogout={vi.fn()} />);
    expect(await screen.findByText(initial.content)).toBeVisible();

    act(() => realtime.listeners.forEach((listener) => listener({ type: 'ready', user: reconnectUser })));
    act(() => realtime.listeners.forEach((listener) => listener({ type: 'ready', user: reconnectUser })));

    expect(await screen.findByText(missed.content)).toBeVisible();
    expect(messages).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('article.mova-real-message')).toHaveLength(2);
    rendered.unmount();
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
