import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealMessages } from './RealApp';
import type { AppConversation, AppMessage, AppUser } from './lib/api';

const callMedia = vi.hoisted(() => ({ screenStream: null as MediaStream | null, localSpeaking: false, participants: [] as string[], setParticipantVolume: vi.fn(), conversationIds: [] as string[] }));

vi.mock('./hooks/useVoiceCall', () => ({
  useVoiceCall: (conversationId: string) => {
    callMedia.conversationIds.push(conversationId);
    return ({
    state: 'active', muted: false, deafened: false, participants: callMedia.participants, error: '', incomingFrom: null,
    cameraStream: null, screenStream: callMedia.screenStream, remoteVideoStreams: [], remoteMedia: {}, remoteVoiceStates: {}, localSpeaking: callMedia.localSpeaking, speakingUsers: {},
    participantVolumes: {}, screenVolumes: {}, setParticipantVolume: callMedia.setParticipantVolume, setScreenVolume: vi.fn(),
    call: vi.fn(), accept: vi.fn(), decline: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(), toggleDeafen: vi.fn(),
    toggleCamera: vi.fn(), toggleScreen: vi.fn(), shareScreen: vi.fn(), stopScreen: vi.fn(), updateScreenQuality: vi.fn(),
    });
  },
}));

const currentUser: AppUser = { id: 'me', name: 'Юта', email: 'me@mova.test', handle: '@yuuta', color: '#74DCCB', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const friend: AppUser = { id: 'friend', name: 'Друг', email: 'friend@mova.test', handle: '@friend', color: '#9B83F4', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const conversation: AppConversation = { id: 'chat', kind: 'direct', title: 'Друг', members: [currentUser, friend], lastMessage: null, createdAt: '2026-08-10T00:00:00.000Z' };
const incomingMessage = (id: string): AppMessage => ({ id, conversationId: conversation.id, authorId: friend.id, author: friend, content: `Сообщение ${id}`, createdAt: `2026-08-10T00:00:0${id}.000Z`, readBy: [] });

beforeEach(() => {
  callMedia.screenStream = null;
  callMedia.localSpeaking = false;
  callMedia.participants = [];
  callMedia.setParticipantVolume.mockReset();
  callMedia.conversationIds = [];
  window.localStorage.clear();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

describe('call layout', () => {
  it('keeps the active call bound to its original conversation when another chat opens', async () => {
    const secondConversation = { ...conversation, id: 'second-chat', title: 'Другой чат' };
    const { rerender } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    rerender(<RealMessages conversation={secondConversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(callMedia.conversationIds.at(-1)).toBe('chat'));
  });

  it('highlights the participant while their microphone carries speech', async () => {
    callMedia.localSpeaking = true;
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(container.querySelector('.mova-call-tile.is-speaking')).toBeInTheDocument());
    expect(container.querySelector('.mova-call-tile.is-speaking')).toHaveAttribute('data-speaking', 'true');
  });

  it('does not highlight a screen share when its owner speaks', async () => {
    callMedia.localSpeaking = true;
    callMedia.screenStream = {
      id: 'screen-stream',
      getTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ width: 1920, height: 1080, aspectRatio: 16 / 9 }) }],
    } as unknown as MediaStream;
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByText('Ваш экран');
    expect(container.querySelector('.mova-call-tile.is-screen')).not.toHaveClass('is-speaking');
  });

  it('lets the call chat width be changed from its left edge', async () => {
    const user = userEvent.setup();
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(await screen.findByRole('button', { name: 'Открыть чат' }));
    const resizer = screen.getByRole('separator', { name: 'Изменить ширину чата звонка' });
    expect(resizer).toHaveAttribute('aria-valuenow', '420');

    fireEvent.pointerDown(resizer, { button: 0, clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window, { clientX: 400 });

    expect(resizer).toHaveAttribute('aria-valuenow', '520');
    expect(window.localStorage.getItem('mova-call-chat-width')).toBe('520');
  });

  it('shows unread call messages and leaves closing to the chat header', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('button', { name: 'Открыть чат' });
    rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incomingMessage('1'), incomingMessage('2')]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const openButton = await screen.findByRole('button', { name: 'Открыть чат, непрочитанных сообщений: 2' });
    expect(openButton.querySelector('.mova-call-chat-unread')).toHaveTextContent('2');
    await user.click(openButton);

    expect(screen.queryByText('Скрыть чат')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Открыть чат/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закрыть чат' })).toBeInTheDocument();
    expect(document.querySelector('.mova-call-chat-header')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Закрыть чат' }));
    expect(await screen.findByRole('button', { name: 'Открыть чат' })).toBeInTheDocument();
  });

  it('renders expanded screen sharing above the entire application', async () => {
    callMedia.screenStream = {
      id: 'screen-stream',
      getTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ width: 1920, height: 1080, aspectRatio: 16 / 9 }) }],
    } as unknown as MediaStream;
    const user = userEvent.setup();
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(await screen.findByRole('button', { name: 'Открыть демонстрацию на весь экран' }));
    const expanded = await waitFor(() => document.body.querySelector('.mova-call-tile.is-expanded'));

    expect(expanded).not.toBeNull();
    expect(expanded?.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Закрыть полноэкранный режим' })).toBeVisible();
  });

  it('can expand an avatar tile and adjust a participant from its context menu', async () => {
    callMedia.participants = ['friend'];
    const user = userEvent.setup();
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(await screen.findByRole('button', { name: 'Открыть Юта · вы на весь экран' }));
    expect(document.body.querySelector('.mova-call-tile.is-avatar.is-expanded')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Закрыть полноэкранный режим' }));

    const friendLabel = screen.getByText('Друг', { selector: '.mova-call-label' });
    fireEvent.contextMenu(friendLabel.closest('article')! , { clientX: 80, clientY: 90 });
    const volume = await screen.findByRole('slider', { name: 'Громкость Друг' });
    fireEvent.change(volume, { target: { value: '65' } });
    expect(callMedia.setParticipantVolume).toHaveBeenCalledWith('friend', 65);
  });
});
