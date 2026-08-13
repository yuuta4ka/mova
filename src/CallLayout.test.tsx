import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealMessages, VoiceDock } from './RealApp';
import type { AppConversation, AppMessage, AppUser } from './lib/api';

const callMedia = vi.hoisted(() => ({ state: 'connected', createdAt: '2026-08-10T00:00:00.000Z' as string | null, startedAt: '2026-08-10T00:00:00.000Z' as string | null, error: '', muted: false, deafened: false, joined: true, cameraStream: null as MediaStream | null, screenStream: null as MediaStream | null, remoteVideoStreams: [] as Array<{ userId: string; streamId: string; stream: MediaStream }>, remoteMedia: {} as Record<string, { camera?: string; screen?: string }>, remoteVoiceStates: {} as Record<string, { muted?: boolean; deafened?: boolean }>, reconnectingUsers: {} as Record<string, boolean>, speakingUsers: {} as Record<string, boolean>, localSpeaking: false, participants: [] as string[], setParticipantVolume: vi.fn(), toggleMute: vi.fn(), toggleDeafen: vi.fn(), leave: vi.fn(), accept: vi.fn(), conversationIds: [] as string[], diagnostics: {} as Record<string, { connectionState?: string; outboundAudioBytes?: number; inboundAudioBytes?: number; quality?: string; roundTripTimeMs?: number; candidateType?: string; protocol?: string; outboundScreenFramesPerSecond?: number; outboundScreenBitrateKbps?: number; screenQualityLimitationReason?: string }> }));

vi.mock('./hooks/useVoiceCall', () => ({
  normalizeCallState: (state: string) => state === 'active' ? 'connected' : state === 'error' ? 'disconnected' : state,
  isJoinedCallState: (state: string) => ['connected', 'reconnecting', 'disconnected'].includes(state),
  useVoiceCall: (conversationId: string) => {
    callMedia.conversationIds.push(conversationId);
    return ({
    state: callMedia.state, createdAt: callMedia.createdAt, startedAt: callMedia.startedAt, muted: callMedia.muted, deafened: callMedia.deafened, joined: callMedia.joined, participants: callMedia.participants, error: callMedia.error, incomingFrom: null,
    cameraStream: callMedia.cameraStream, screenStream: callMedia.screenStream, remoteVideoStreams: callMedia.remoteVideoStreams, remoteMedia: callMedia.remoteMedia, remoteVoiceStates: callMedia.remoteVoiceStates, reconnectingUsers: callMedia.reconnectingUsers, localSpeaking: callMedia.localSpeaking, speakingUsers: callMedia.speakingUsers,
    participantVolumes: {}, screenVolumes: {}, diagnostics: callMedia.diagnostics, setParticipantVolume: callMedia.setParticipantVolume, setScreenVolume: vi.fn(),
    call: vi.fn(), accept: callMedia.accept, decline: vi.fn(), leave: callMedia.leave, toggleMute: callMedia.toggleMute, toggleDeafen: callMedia.toggleDeafen,
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
  callMedia.state = 'connected';
  callMedia.createdAt = '2026-08-10T00:00:00.000Z';
  callMedia.startedAt = '2026-08-10T00:00:00.000Z';
  callMedia.error = '';
  callMedia.muted = false;
  callMedia.deafened = false;
  callMedia.joined = true;
  callMedia.cameraStream = null;
  callMedia.screenStream = null;
  callMedia.remoteVideoStreams = [];
  callMedia.remoteMedia = {};
  callMedia.remoteVoiceStates = {};
  callMedia.reconnectingUsers = {};
  callMedia.speakingUsers = {};
  callMedia.localSpeaking = false;
  callMedia.participants = [];
  callMedia.diagnostics = {};
  callMedia.setParticipantVolume.mockReset();
  callMedia.toggleMute.mockReset();
  callMedia.toggleDeafen.mockReset();
  callMedia.leave.mockReset();
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
    expect(getRemoteTile()?.querySelector('[aria-label="Камера включена"]')).not.toBeInTheDocument();
    expect(getRemoteTile()?.querySelector('[aria-label="Микрофон включён"]')).not.toBeInTheDocument();
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

  it('keeps the current call canvas visible while the connection is recovering', () => {
    callMedia.state = 'reconnecting';
    callMedia.error = 'Восстанавливаем соединение…';
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(container.querySelector('.mova-call-stage')).toBeInTheDocument();
    expect(container.querySelector('.mova-call-grid.is-participants')).toBeInTheDocument();
    expect(container.querySelector('.mova-call-error')).toHaveTextContent('Восстанавливаем соединение…');
  });

  it('shows an active call under the chat header after leaving and lets the user reconnect', async () => {
    callMedia.state = 'available';
    callMedia.joined = false;
    callMedia.startedAt = new Date(Date.now() - 83_000).toISOString();
    const user = userEvent.setup();
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByRole('region', { name: 'Активный звонок с Друг' })).toBeVisible();
    expect(container.querySelector('.mova-active-call-host')).toHaveTextContent('Звонок идёт · 01:23');
    expect(container.querySelector('.mova-active-call-banner__icon')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Подключиться к звонку' }));
    expect(callMedia.accept).toHaveBeenCalledOnce();
  });

  it('mounts the return banner into the current chat host after the call canvas closes', async () => {
    callMedia.state = 'connected';
    const view = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    expect(view.container.querySelector('.mova-call-stage')).toBeInTheDocument();

    callMedia.state = 'available';
    callMedia.joined = false;
    view.rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const host = view.container.querySelector('.mova-active-call-host');
    const banner = await screen.findByRole('region', { name: 'Активный звонок с Друг' });
    expect(banner.parentElement).toBe(host);
    expect(screen.getByRole('button', { name: 'Подключиться к звонку' })).toBeVisible();
  });

  it.each([
    ['connecting', 'Подключение…'],
    ['connected', 'Подключено'],
    ['reconnecting', 'Переподключение…'],
    ['disconnected', 'Соединение потеряно'],
  ])('shows the %s state in the global voice dock', (state, label) => {
    const call = {
      state,
      muted: false,
      deafened: false,
      toggleMute: callMedia.toggleMute,
      toggleDeafen: callMedia.toggleDeafen,
      leave: callMedia.leave,
    } as unknown as Parameters<typeof VoiceDock>[0]['call'];
    const { container } = render(<VoiceDock conversation={conversation} call={call} onReturn={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Активный звонок с Друг' })).toHaveAttribute('data-call-state', state);
    expect(container.querySelector('.mova-voice-dock__summary')).toHaveTextContent(label);
    expect(container.querySelector('.mova-voice-dock__summary i')).not.toBeInTheDocument();
  });

  it('uses the call session controls from the global voice dock', async () => {
    const user = userEvent.setup();
    const onReturn = vi.fn();
    const call = {
      state: 'connected',
      muted: false,
      deafened: false,
      toggleMute: callMedia.toggleMute,
      toggleDeafen: callMedia.toggleDeafen,
      leave: callMedia.leave,
    } as unknown as Parameters<typeof VoiceDock>[0]['call'];
    render(<VoiceDock conversation={conversation} call={call} onReturn={onReturn} />);

    await user.click(screen.getByRole('button', { name: 'Выключить микрофон' }));
    await user.click(screen.getByRole('button', { name: 'Выключить звук в наушниках' }));
    await user.click(screen.getByRole('button', { name: 'Вернуться в звонок' }));
    await user.click(screen.getByRole('button', { name: 'Выйти из звонка' }));

    expect(callMedia.toggleMute).toHaveBeenCalledOnce();
    expect(callMedia.toggleDeafen).toHaveBeenCalledOnce();
    expect(onReturn).toHaveBeenCalledOnce();
    expect(callMedia.leave).toHaveBeenCalledOnce();
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

  it('shows participant connection and media presence directly on two-user tiles', () => {
    callMedia.participants = ['friend'];
    callMedia.diagnostics = { friend: { connectionState: 'connected' } };
    callMedia.remoteVoiceStates = { friend: { muted: true, deafened: true } };
    callMedia.remoteMedia = { friend: { screen: 'friend-screen' } };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const remoteTile = container.querySelector('[data-participant-id="friend"]')!;

    expect(remoteTile).toHaveAttribute('data-participant-connection', 'connected');
    expect(remoteTile.querySelector('.mova-call-participant-state')).not.toBeInTheDocument();
    expect(remoteTile.querySelector('[aria-label="Микрофон выключен"]')).toBeInTheDocument();
    expect(remoteTile.querySelector('[aria-label="Звук выключен"]')).toBeInTheDocument();
    expect(remoteTile.querySelector('[aria-label="Камера выключена"]')).not.toBeInTheDocument();
    expect(remoteTile.querySelector('[aria-label="Микрофон включён"]')).not.toBeInTheDocument();
    expect(remoteTile.querySelector('[aria-label="Демонстрация экрана включена"]')).toBeInTheDocument();
  });

  it('shows a connecting state until the peer connection is established', () => {
    callMedia.participants = ['friend'];
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(container.querySelector('[data-participant-id="friend"]')).toHaveAttribute('data-participant-connection', 'connecting');
    expect(container.querySelector('[data-participant-id="friend"] [aria-label="Подключается"]')).toBeInTheDocument();
  });

  it('prioritizes the active speaker and keeps reconnecting participants last', () => {
    const first = participant(1);
    const speaker = participant(2);
    const reconnecting = participant(3);
    callMedia.participants = [first.id, reconnecting.id, speaker.id];
    callMedia.speakingUsers = { [speaker.id]: true };
    callMedia.reconnectingUsers = { [reconnecting.id]: true };
    callMedia.diagnostics = {
      [first.id]: { connectionState: 'connected' },
      [speaker.id]: { connectionState: 'connected' },
      [reconnecting.id]: { connectionState: 'disconnected' },
    };
    const groupConversation: AppConversation = { ...conversation, id: 'presence-order', kind: 'group', members: [currentUser, first, speaker, reconnecting] };
    const { container } = render(<RealMessages conversation={groupConversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);
    const remoteOrder = Array.from(container.querySelectorAll('.mova-call-primary-participant [data-participant-id],.mova-call-secondary-participants [data-participant-id]')).map((tile) => tile.getAttribute('data-participant-id'));

    expect(remoteOrder).toEqual([speaker.id, first.id, reconnecting.id]);
    expect(container.querySelector(`[data-participant-id="${speaker.id}"]`)).toHaveClass('is-speaking');
    expect(container.querySelector(`[data-participant-id="${reconnecting.id}"]`)).toHaveAttribute('data-participant-connection', 'reconnecting');
    expect(container.querySelector(`[data-participant-id="${reconnecting.id}"] [aria-label="Переподключается"]`)).toBeInTheDocument();
  });

  it('keeps a participant tile while reconnecting and restores its connected state', () => {
    callMedia.participants = ['friend'];
    callMedia.reconnectingUsers = { friend: true };
    callMedia.diagnostics = { friend: { connectionState: 'disconnected' } };
    const view = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(view.container.querySelector('[data-participant-id="friend"]')).toHaveAttribute('data-participant-connection', 'reconnecting');
    callMedia.reconnectingUsers = {};
    callMedia.diagnostics = { friend: { connectionState: 'connected' } };
    view.rerender(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(view.container.querySelectorAll('[data-participant-id="friend"]')).toHaveLength(1);
    expect(view.container.querySelector('[data-participant-id="friend"]')).toHaveAttribute('data-participant-connection', 'connected');
  });

  it('shows connection quality as bars with latency and route diagnostics', async () => {
    callMedia.diagnostics = { friend: { connectionState: 'connected', outboundAudioBytes: 128, quality: 'fair', roundTripTimeMs: 146, candidateType: 'host → srflx' } };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    const indicator = container.querySelector('.mova-network-quality');
    expect(indicator).toHaveClass('is-fair');
    expect(indicator).toHaveAttribute('data-tooltip', 'Задержка 146 мс · Прямой маршрут');
    expect(indicator).not.toHaveAttribute('title');
    expect(indicator).not.toHaveTextContent('Задержка 146 мс');
    expect(indicator?.querySelectorAll('.mova-network-bars > i')).toHaveLength(4);
    expect(screen.queryByText(/Потери|джиттер|Хорошая сеть|Средняя сеть|Слабая сеть/)).not.toBeInTheDocument();
  });

  it('copies an anonymized call report for support', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    callMedia.diagnostics = { friend: { connectionState: 'connected', outboundAudioBytes: 128, quality: 'fair', roundTripTimeMs: 146, candidateType: 'host → relay' } };
    render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    await userEvent.click(screen.getByRole('button', { name: 'Скопировать отчёт о звонке' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"peer": "peer-1"'));
    expect(writeText.mock.calls[0][0]).not.toContain('friend');
    expect(await screen.findByRole('button', { name: 'Отчёт о звонке скопирован' })).toBeInTheDocument();
  });

  it('reports TURN routing and the actual outbound screen FPS', () => {
    callMedia.screenStream = screenStream('local-screen', { width: 1920, height: 1080, aspectRatio: 16 / 9 });
    callMedia.diagnostics = {
      friend: {
        connectionState: 'connected',
        outboundAudioBytes: 128,
        quality: 'poor',
        roundTripTimeMs: 320,
        candidateType: 'relay → relay',
        protocol: 'udp',
        outboundScreenFramesPerSecond: 28,
        outboundScreenBitrateKbps: 4100,
        screenQualityLimitationReason: 'bandwidth',
      },
    };
    const { container } = render(<RealMessages conversation={conversation} currentUser={currentUser} messages={[]} onSend={vi.fn().mockResolvedValue(undefined)} />);

    expect(container.querySelector('.mova-network-quality')).toHaveAttribute(
      'data-tooltip',
      'Задержка 320 мс · Маршрут через TURN · UDP · Демонстрация 28 FPS · 4.1 Мбит/с · ограничено сетью',
    );
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
    const controls = document.querySelector('.mova-call-controls');
    expect(controls).toBeInTheDocument();
    expect(controls?.parentElement).toBe(document.body);

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
    const menu = document.querySelector('.mova-call-more');
    expect(menu).toBeInTheDocument();
    expect(menu?.parentElement).toBe(document.body);
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
    const selfViewContainer = container.querySelector('.mova-call-self-view') as HTMLDivElement;
    const selfView = container.querySelector('.mova-call-self-view .mova-call-tile');
    expect(selfViewContainer).toHaveAttribute('data-pinch-resizable', 'true');
    expect(selfView).toHaveAttribute('data-self-view', 'true');
    expect(selfView?.querySelector('.mova-call-label')).not.toBeInTheDocument();
    expect(selfView).not.toHaveTextContent('· вы');
    vi.spyOn(selfViewContainer, 'getBoundingClientRect').mockReturnValue({ width: 112, height: 63, x: 0, y: 0, top: 0, left: 0, right: 112, bottom: 63, toJSON: () => ({}) });
    fireEvent.pointerDown(selfViewContainer, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerDown(selfViewContainer, { pointerId: 2, pointerType: 'touch', clientX: 112, clientY: 0 });
    fireEvent.pointerMove(selfViewContainer, { pointerId: 2, pointerType: 'touch', clientX: 224, clientY: 0 });
    expect(selfViewContainer).toHaveStyle({ width: '224px' });
    fireEvent.pointerMove(selfViewContainer, { pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 0 });
    expect(selfViewContainer).toHaveStyle({ width: '72px' });
    fireEvent.pointerUp(selfViewContainer, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerUp(selfViewContainer, { pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 0 });
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
