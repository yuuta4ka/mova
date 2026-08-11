import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealMessages } from './RealApp';
import type { AppConversation, AppMessage, AppUser } from './lib/api';

const callMedia = vi.hoisted(() => ({ state: 'active', createdAt: '2026-08-10T00:00:00.000Z' as string | null, startedAt: '2026-08-10T00:00:00.000Z' as string | null, error: '', cameraStream: null as MediaStream | null, screenStream: null as MediaStream | null, remoteVideoStreams: [] as Array<{ userId: string; streamId: string; stream: MediaStream }>, remoteMedia: {} as Record<string, { screen?: string }>, remoteVoiceStates: {} as Record<string, { muted?: boolean; deafened?: boolean }>, speakingUsers: {} as Record<string, boolean>, localSpeaking: false, participants: [] as string[], setParticipantVolume: vi.fn(), toggleDeafen: vi.fn(), accept: vi.fn(), conversationIds: [] as string[], diagnostics: {} as Record<string, object> }));

vi.mock('./hooks/useVoiceCall', () => ({
  useVoiceCall: (conversationId: string) => {
    callMedia.conversationIds.push(conversationId);
    return ({
    state: callMedia.state, createdAt: callMedia.createdAt, startedAt: callMedia.startedAt, muted: false, deafened: false, participants: callMedia.participants, error: callMedia.error, incomingFrom: null,
    cameraStream: callMedia.cameraStream, screenStream: callMedia.screenStream, remoteVideoStreams: callMedia.remoteVideoStreams, remoteMedia: callMedia.remoteMedia, remoteVoiceStates: callMedia.remoteVoiceStates, localSpeaking: callMedia.localSpeaking, speakingUsers: callMedia.speakingUsers,
    participantVolumes: {}, screenVolumes: {}, diagnostics: callMedia.diagnostics, setParticipantVolume: callMedia.setParticipantVolume, setScreenVolume: vi.fn(),
    call: vi.fn(), accept: callMedia.accept, decline: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(), toggleDeafen: callMedia.toggleDeafen,
    toggleCamera: vi.fn(), toggleScreen: vi.fn(), shareScreen: vi.fn(), stopScreen: vi.fn(), updateScreenQuality: vi.fn(),
    });
  },
}));

const currentUser: AppUser = { id: 'me', name: 'Юта', email: 'me@mova.test', handle: '@yuuta', color: '#74DCCB', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const friend: AppUser = { id: 'friend', name: 'Друг', email: 'friend@mova.test', handle: '@friend', color: '#9B83F4', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const conversation: AppConversation = { id: 'chat', kind: 'direct', title: 'Друг', members: [currentUser, friend], lastMessage: null, createdAt: '2026-08-10T00:00:00.000Z' };
const screenAudioWarning = 'Экран демонстрируется без звука. В окне выбора включите «Поделиться аудио» (звук доступен не для всех источников).';
const screenAudioToast = 'Демонстрация без звука. Включите «Поделиться аудио» при выборе экрана.';
const incomingMessage = (id: string): AppMessage => ({ id, conversationId: conversation.id, authorId: friend.id, author: friend, content: `Сообщение ${id}`, createdAt: `2026-08-10T00:00:0${id}.000Z`, readBy: [] });
const mediaStream = (id: string) => ({ id, getTracks: () => [], getVideoTracks: () => [{ getSettings: () => ({ width: 1280, height: 720, aspectRatio: 16 / 9 }) }] }) as unknown as MediaStream;
const screenStream = (id: string, settings: MediaTrackSettings = {}) => ({ id, getTracks: () => [], getVideoTracks: () => [{ getSettings: () => settings }] }) as unknown as MediaStream;
const participant = (index: number): AppUser => ({ ...friend, id: `participant-${index}`, name: `Участник ${index}`, email: `participant-${index}@mova.test` });
const renderParticipantCount = (count: number, cameraParticipantIds: string[] = []) => {
  const remoteParticipants = Array.from({ length: Math.max(0, count - 1) }, (_, index) => participant(index + 1));
  callMedia.participants = remoteParticipants.map((user) => user.id);
  callMedia.remoteVideoStreams = remoteParticipants
    .filter((user) => cameraParticipantIds.includes(user.id))
    .map((user) => ({ userId: user.id, streamId: `${user.id}-camera`, stream: mediaStream(`${user.id}-camera`) }));
  const groupConversation: AppConversation = { ...conversation, id: `group-${count}`, kind: 'group', title: `Звонок ${count}`, members: [currentUser, ...remoteParticipants] };
  return render(<RealMessages conversation={groupConversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
};

beforeEach(() => {
  callMedia.state = 'active';
  callMedia.createdAt = '2026-08-10T00:00:00.000Z';
  callMedia.startedAt = '2026-08-10T00:00:00.000Z';
  callMedia.error = '';
  callMedia.cameraStream = null;
  callMedia.screenStream = null;
  callMedia.remoteVideoStreams = [];
  callMedia.remoteMedia = {};
  callMedia.remoteVoiceStates = {};
  callMedia.speakingUsers = {};
  callMedia.localSpeaking = false;
  callMedia.participants = [];
  callMedia.diagnostics = {};
  callMedia.setParticipantVolume.mockReset();
  callMedia.toggleDeafen.mockReset();
  callMedia.accept.mockReset();
  callMedia.conversationIds = [];
  window.localStorage.clear();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('call layout', () => {
  it.each([
    [1, '1'],
    [2, '2'],
    [3, '3'],
    [4, '4'],
    [5, 'many'],
    [7, 'many'],
  ])('uses a deterministic layout for %i participants', (count, layout) => {
    const { container } = renderParticipantCount(count);
    const grid = container.querySelector('.mova-call-grid.is-participants');

    expect(grid).toHaveAttribute('data-participant-count', String(count));
    expect(grid).toHaveAttribute('data-participant-layout', layout);
    expect(grid?.querySelectorAll('.mova-call-tile')).toHaveLength(count);
    if (count === 3) expect(grid?.querySelector('.mova-call-primary-participant .mova-call-tile')).toBeInTheDocument();
  });

  it('keeps the same participant slot when camera switches between on and off', () => {
    const cameraUser = participant(1);
    const view = renderParticipantCount(2, [cameraUser.id]);
    const getRemoteTile = () => screen.getByText(cameraUser.name, { selector: '.mova-call-label' }).closest('.mova-call-tile');

    expect(getRemoteTile()).toHaveClass('has-video', 'is-camera');
    callMedia.remoteVideoStreams = [];
    view.rerender(<RealMessages conversation={{ ...conversation, id: 'group-2', kind: 'group', members: [currentUser, cameraUser] }} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(getRemoteTile()).toHaveClass('is-avatar');
    expect(view.container.querySelector('.mova-call-grid')).toHaveAttribute('data-participant-count', '2');
  });

  it('keeps the control dock icon-only and exposes a headphones mute button', async () => {
    const user = userEvent.setup();
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const controls = container.querySelector('.mova-call-controls');
    expect(controls).not.toBeNull();
    expect(controls?.querySelectorAll(':scope > button')).toHaveLength(7);
    expect(controls?.querySelectorAll('.mova-call-control-icon')).toHaveLength(7);
    expect(controls?.textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Выключить звук в наушниках' }));
    expect(callMedia.toggleDeafen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /свернуть список чатов/i })).not.toBeInTheDocument();
  });

  it('shows an active call under the chat header after leaving and lets the user reconnect', async () => {
    callMedia.state = 'available';
    callMedia.startedAt = new Date(Date.now() - 83_000).toISOString();
    const user = userEvent.setup();
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByRole('region', { name: 'Активный звонок с Друг' })).toBeVisible();
    expect(container.querySelector('.mova-active-call-host')).toHaveTextContent('Звонок идёт · 01:23');
    expect(container.querySelector('.mova-active-call-banner__icon')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Подключиться к звонку' }));
    expect(callMedia.accept).toHaveBeenCalledOnce();
  });

  it('renders a completed call as a system message with its duration', () => {
    callMedia.state = 'idle';
    const callMessage: AppMessage = {
      id: 'call-message',
      conversationId: conversation.id,
      authorId: currentUser.id,
      author: currentUser,
      kind: 'call',
      content: 'Звонок завершён · 12:34',
      call: { status: 'completed', durationSeconds: 754, startedAt: '2026-08-10T11:00:00.000Z', endedAt: '2026-08-10T11:12:34.000Z' },
      createdAt: '2026-08-10T11:12:34.000Z',
      readBy: [],
    };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[callMessage]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(container.querySelector('.mova-call-system-message')).toHaveTextContent('Звонок завершён');
    expect(container.querySelector('.mova-call-system-message')).toHaveTextContent('Длительность 12:34');
    expect(container.querySelector('.mova-call-system-message .lucide-phone-call')).toBeInTheDocument();
    expect(container.querySelector('.mova-call-system-message .lucide-phone-off')).not.toBeInTheDocument();
  });

  it('keeps the active call bound to its original conversation when another chat opens', async () => {
    const secondConversation = { ...conversation, id: 'second-chat', title: 'Другой чат' };
    const { rerender } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    rerender(<RealMessages conversation={secondConversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(callMedia.conversationIds.at(-1)).toBe('chat'));
  });

  it('highlights the participant while their microphone carries speech', async () => {
    callMedia.localSpeaking = true;
    callMedia.diagnostics = { friend: { connectionState: 'connected', outboundAudioBytes: 128, quality: 'good', roundTripTimeMs: 42 } };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await waitFor(() => expect(container.querySelector('.mova-call-tile.is-speaking')).toBeInTheDocument());
    expect(container.querySelector('.mova-call-tile.is-speaking')).toHaveAttribute('data-speaking', 'true');
  });

  it('shows connection quality as bars with latency only', async () => {
    callMedia.diagnostics = { friend: { connectionState: 'connected', outboundAudioBytes: 128, quality: 'fair', roundTripTimeMs: 146 } };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const indicator = container.querySelector('.mova-network-quality');
    expect(indicator).toHaveClass('is-fair');
    expect(indicator).toHaveAttribute('data-tooltip', 'Задержка 146 мс');
    expect(indicator).toHaveAttribute('title', 'Задержка 146 мс');
    expect(indicator).not.toHaveTextContent('Задержка 146 мс');
    expect(indicator?.querySelectorAll('.mova-network-bars > i')).toHaveLength(4);
    expect(screen.queryByText(/Потери|джиттер|Хорошая сеть|Средняя сеть|Слабая сеть/)).not.toBeInTheDocument();
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
    const grid = container.querySelector('.mova-call-grid.has-screen');
    expect(grid).toHaveAttribute('data-call-layout', 'screen-share');
    expect(grid?.querySelector('.mova-call-screen-area .mova-call-tile.is-screen')).toBeInTheDocument();
    expect(grid?.querySelector('.mova-call-participants .mova-call-tile')).toBeInTheDocument();
    expect(container.querySelector('.mova-call-tile.is-screen')).not.toHaveClass('is-speaking');
  });

  it('sizes screen sharing from stream settings and refreshes from video metadata', async () => {
    callMedia.screenStream = screenStream('screen-ratio', { width: 1200, height: 900, aspectRatio: 4 / 3 });
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const tile = await waitFor(() => container.querySelector('.mova-call-tile.is-screen')!);
    const video = tile.querySelector('video')!;

    expect(tile).toHaveAttribute('data-source-aspect-ratio', String(4 / 3));
    expect(tile.getAttribute('style')).toContain('--mova-call-source-ratio: 1.3333333333333333');

    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 900 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1200 });
    fireEvent.loadedMetadata(video);
    expect(tile).toHaveAttribute('data-source-aspect-ratio', '0.75');

    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1600 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 900 });
    fireEvent(video, new Event('resize'));
    expect(tile).toHaveAttribute('data-source-aspect-ratio', String(16 / 9));
  });

  it('uses a calm fallback ratio before screen metadata is available', async () => {
    callMedia.screenStream = screenStream('screen-fallback');
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(await waitFor(() => container.querySelector('.mova-call-tile.is-screen'))).toHaveAttribute('data-source-aspect-ratio', '1.6');
  });

  it('hides and restores the participant rail without removing participants', async () => {
    callMedia.screenStream = mediaStream('screen-rail');
    callMedia.participants = ['friend'];
    const user = userEvent.setup();
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const grid = container.querySelector('.mova-call-grid.has-screen')!;
    const participantCount = grid.querySelectorAll('.mova-call-participants .mova-call-tile').length;
    const hideToggle = await screen.findByRole('button', { name: 'Скрыть участников' });

    expect(hideToggle).toHaveClass('mova-call-participant-rail-toggle');
    expect(hideToggle.parentElement).toHaveClass('mova-call-participant-rail');

    await user.click(hideToggle);
    expect(grid).toHaveAttribute('data-participant-rail', 'hidden');
    expect(grid.querySelector('.mova-call-participants')).toHaveAttribute('aria-hidden', 'true');
    expect(grid.querySelectorAll('.mova-call-participants .mova-call-tile')).toHaveLength(participantCount);

    const showToggle = screen.getByRole('button', { name: 'Показать участников' });
    expect(showToggle.parentElement).toHaveClass('mova-call-participant-rail', 'is-collapsed');
    await user.click(showToggle);
    expect(grid).toHaveAttribute('data-participant-rail', 'visible');
    expect(grid.querySelector('.mova-call-participants')).toHaveAttribute('aria-hidden', 'false');
  });

  it('shows the screen-audio warning once per share session and removes it after six seconds', () => {
    vi.useFakeTimers();
    callMedia.screenStream = mediaStream('screen-no-audio');
    callMedia.error = screenAudioWarning;
    const view = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole('status')).toHaveTextContent(screenAudioToast);
    expect(screen.getByRole('status')).toHaveClass('mova-call-toast', 'is-visible');
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole('status')).toHaveClass('is-hiding');
    act(() => vi.advanceTimersByTime(190));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    view.rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    callMedia.screenStream = mediaStream('screen-no-audio-next');
    view.rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByRole('status')).toHaveClass('is-visible');
  });

  it('removes the screen-audio toast immediately when sharing stops', () => {
    vi.useFakeTimers();
    callMedia.screenStream = mediaStream('screen-no-audio-stop');
    callMedia.error = screenAudioWarning;
    const view = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    callMedia.screenStream = null;
    callMedia.error = '';
    view.rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps muted state explicit and suppresses the speaking frame', () => {
    callMedia.participants = ['friend'];
    callMedia.remoteVoiceStates = { friend: { muted: true } };
    callMedia.speakingUsers = { friend: true };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const remoteTile = screen.getByText('Друг', { selector: '.mova-call-label' }).closest('.mova-call-tile');

    expect(remoteTile?.querySelector('[aria-label="Микрофон выключен"]')).toBeInTheDocument();
    expect(remoteTile).not.toHaveClass('is-speaking');
    expect(container.querySelectorAll('.mova-call-tile')).toHaveLength(2);
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

  it('shows unread call messages and keeps the dock geometry stable while chat is open', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByRole('button', { name: 'Открыть чат' });
    rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[incomingMessage('1'), incomingMessage('2')]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const openButton = await screen.findByRole('button', { name: 'Открыть чат, непрочитанных сообщений: 2' });
    const dock = openButton.closest('.mova-call-controls')!;
    expect(dock.querySelectorAll(':scope > button')).toHaveLength(7);
    expect(openButton.querySelector('.mova-call-chat-unread')).toHaveTextContent('2');
    await user.click(openButton);

    expect(screen.queryByText('Скрыть чат')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Открыть чат/ })).not.toBeInTheDocument();
    const callChatHeader = document.querySelector('.mova-call-chat-header')!;
    const dockClose = dock.querySelector('button[aria-label="Закрыть чат"]');
    expect(dock.querySelectorAll(':scope > button')).toHaveLength(7);
    expect(dockClose).toHaveAttribute('data-control-state', 'active');
    expect(callChatHeader).toBeInTheDocument();

    await user.click(callChatHeader.querySelector('button[aria-label="Закрыть чат"]')!);
    expect(await screen.findByRole('button', { name: 'Открыть чат' })).toBeInTheDocument();
  });

  it('opens and closes screen sharing with one surface click in each direction', async () => {
    callMedia.screenStream = {
      id: 'screen-stream',
      getTracks: () => [],
      getVideoTracks: () => [{ getSettings: () => ({ width: 1920, height: 1080, aspectRatio: 16 / 9 }) }],
    } as unknown as MediaStream;
    const user = userEvent.setup();
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const screenSurface = await screen.findByRole('button', { name: 'Открыть демонстрацию на весь экран' });
    expect(screenSurface).toHaveClass('mova-call-tile', 'is-screen');
    expect(screenSurface.querySelector('.mova-call-fullscreen')).not.toBeInTheDocument();
    await user.click(screenSurface);
    const expanded = await waitFor(() => document.body.querySelector('.mova-call-tile.is-expanded'));

    expect(expanded).not.toBeNull();
    expect(expanded?.parentElement).toBe(document.body);
    expect(expanded?.querySelector('.mova-call-fullscreen')).not.toBeInTheDocument();
    expect(document.querySelector('.mova-call-controls')).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(expanded!);
    expect(expanded).toHaveClass('is-exiting');
    act(() => vi.advanceTimersByTime(190));
    expect(document.body.querySelector('.mova-call-tile.is-expanded')).not.toBeInTheDocument();
  });

  it('autohides expanded media controls and restores them on keyboard activity', async () => {
    callMedia.screenStream = mediaStream('screen-autohide');
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const expand = await screen.findByRole('button', { name: 'Открыть демонстрацию на весь экран' });
    vi.useFakeTimers();

    fireEvent.click(expand);
    const expanded = document.body.querySelector('.mova-call-tile.is-expanded')!;
    expect(expanded).toHaveAttribute('data-expanded-ui', 'visible');
    expect(document.querySelector('.mova-call-controls')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_801));
    expect(expanded).toHaveAttribute('data-expanded-ui', 'hidden');
    expect(expanded).toHaveClass('is-ui-hidden');

    fireEvent.pointerMove(window);
    expect(expanded).toHaveAttribute('data-expanded-ui', 'visible');
    const dockButton = screen.getByRole('button', { name: 'Выключить микрофон' });
    dockButton.focus();
    act(() => vi.advanceTimersByTime(2_801));
    expect(expanded).toHaveAttribute('data-expanded-ui', 'visible');
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(191));
    expect(document.body.querySelector('.mova-call-tile.is-expanded')).not.toBeInTheDocument();
  });

  it('keeps the screen surface keyboard-accessible in both modes', async () => {
    callMedia.screenStream = mediaStream('screen-keyboard');
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const surface = await screen.findByRole('button', { name: 'Открыть демонстрацию на весь экран' });
    fireEvent.keyDown(surface, { key: 'Enter' });
    const expanded = document.body.querySelector('.mova-call-tile.is-expanded')!;
    expect(expanded).toHaveAttribute('aria-label', 'Закрыть полноэкранный режим');
    vi.useFakeTimers();
    fireEvent.keyDown(expanded, { key: ' ' });
    act(() => vi.advanceTimersByTime(190));
    expect(document.body.querySelector('.mova-call-tile.is-expanded')).not.toBeInTheDocument();
  });

  it('keeps fullscreen controls visible while a call menu is open', async () => {
    callMedia.screenStream = mediaStream('screen-menu');
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const surface = await screen.findByRole('button', { name: 'Открыть демонстрацию на весь экран' });
    vi.useFakeTimers();
    fireEvent.click(surface);
    const expanded = document.body.querySelector('.mova-call-tile.is-expanded')!;

    fireEvent.click(screen.getByRole('button', { name: 'Дополнительно' }));
    expect(document.querySelector('.mova-call-more')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_801));
    expect(expanded).toHaveAttribute('data-expanded-ui', 'visible');
  });

  it('exits expanded screen sharing immediately with reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    callMedia.screenStream = mediaStream('screen-reduced-motion');
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть демонстрацию на весь экран' }));
    expect(document.body.querySelector('.mova-call-tile.is-expanded')).toHaveAttribute('data-expanded-motion', 'reduced');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.querySelector('.mova-call-tile.is-expanded')).not.toBeInTheDocument();
  });

  it('keeps remote media primary and expanded media inside the call canvas on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 760px') || query.includes('pointer: coarse'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const cameraUser = participant(1);
    const { container } = renderParticipantCount(2, [cameraUser.id]);

    expect(container.querySelector('.mova-call-primary-participant .mova-call-label')).toHaveTextContent(cameraUser.name);
    expect(container.querySelector('.mova-call-self-view .mova-call-tile')).toHaveAttribute('data-self-view', 'true');
    fireEvent.click(await screen.findByRole('button', { name: `Открыть ${cameraUser.name} на весь экран` }));
    const expanded = container.querySelector('.mova-call-tile.is-expanded');
    expect(expanded).toBeInTheDocument();
    expect(expanded?.parentElement).not.toBe(document.body);
  });

  it('keeps the remote participant primary and the local preview separate', async () => {
    const stream = (id: string) => ({ id, getTracks: () => [], getVideoTracks: () => [{ getSettings: () => ({ width: 1280, height: 720, aspectRatio: 16 / 9 }) }] }) as unknown as MediaStream;
    callMedia.cameraStream = stream('local-camera');
    callMedia.remoteVideoStreams = [{ userId: 'friend', streamId: 'friend-camera', stream: stream('friend-camera') }];
    callMedia.participants = ['friend'];
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const primary = container.querySelector('.mova-call-primary-participant .mova-call-tile');
    const selfView = container.querySelector('.mova-call-self-view .mova-call-tile');
    expect(primary).toHaveTextContent('Друг');
    expect(primary).not.toHaveTextContent('· вы');
    expect(selfView).toHaveTextContent('Юта · вы');
    expect(selfView).toHaveAttribute('data-self-view', 'true');
    expect(screen.queryByRole('button', { name: 'Открыть Юта · вы на весь экран' })).not.toBeInTheDocument();
  });

  it('can expand a remote avatar tile and adjust that participant from its context menu', async () => {
    callMedia.participants = ['friend'];
    const user = userEvent.setup();
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(await screen.findByRole('button', { name: 'Открыть Друг на весь экран' }));
    expect(document.body.querySelector('.mova-call-tile.is-avatar.is-expanded')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Закрыть полноэкранный режим' }));

    const friendLabel = screen.getByText('Друг', { selector: '.mova-call-label' });
    fireEvent.contextMenu(friendLabel.closest('article')! , { clientX: 80, clientY: 90 });
    const volume = await screen.findByRole('slider', { name: 'Громкость Друг' });
    fireEvent.change(volume, { target: { value: '65' } });
    expect(callMedia.setParticipantVolume).toHaveBeenCalledWith('friend', 65);
  });
});
