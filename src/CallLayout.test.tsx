import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealMessages } from './RealApp';
import type { AppConversation, AppUser } from './lib/api';

const callMedia = vi.hoisted(() => ({ screenStream: null as MediaStream | null }));

vi.mock('./hooks/useVoiceCall', () => ({
  useVoiceCall: () => ({
    state: 'active', muted: false, deafened: false, participants: [], error: '', incomingFrom: null,
    cameraStream: null, screenStream: callMedia.screenStream, remoteVideoStreams: [], remoteMedia: {}, remoteVoiceStates: {},
    call: vi.fn(), accept: vi.fn(), decline: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(), toggleDeafen: vi.fn(),
    toggleCamera: vi.fn(), toggleScreen: vi.fn(), shareScreen: vi.fn(), stopScreen: vi.fn(), updateScreenQuality: vi.fn(),
  }),
}));

const currentUser: AppUser = { id: 'me', name: 'Юта', email: 'me@mova.test', handle: '@yuuta', color: '#74DCCB', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const friend: AppUser = { id: 'friend', name: 'Друг', email: 'friend@mova.test', handle: '@friend', color: '#9B83F4', presence: 'online', createdAt: '2026-08-10T00:00:00.000Z' };
const conversation: AppConversation = { id: 'chat', kind: 'direct', title: 'Друг', members: [currentUser, friend], lastMessage: null, createdAt: '2026-08-10T00:00:00.000Z' };

beforeEach(() => {
  callMedia.screenStream = null;
  window.localStorage.clear();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

describe('call layout', () => {
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
});
