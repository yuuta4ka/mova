import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, realtime, type RealtimeEvent } from '../lib/api';
import { defaultAudioSettings, saveAudioSettings, withNoiseSuppressionMode } from '../lib/audioSettings';
import { isJoinedCallState, isOutgoingVoiceTransmitted, normalizeCallState, replaceMicrophoneTrack, resolveRemotePlaybackRoute, resolveRemotePlaybackVolume, shouldPlaySelfConnectSound, useVoiceCall, type CallState } from './useVoiceCall';

beforeEach(() => {
  vi.spyOn(realtime, 'isConnected').mockReturnValue(true);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  delete window.movaDesktopShell;
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('voice call state model', () => {
  it('maps legacy states without exposing them to the new state machine', () => {
    expect(normalizeCallState('active')).toBe('connected');
    expect(normalizeCallState('error')).toBe('disconnected');
  });

  it.each<CallState>(['connected', 'reconnecting', 'disconnected'])('keeps %s inside the joined call session', (state) => {
    expect(isJoinedCallState(state)).toBe(true);
  });

  it.each<CallState>(['idle', 'ringing', 'incoming', 'connecting', 'available'])('keeps %s outside the joined call session', (state) => {
    expect(isJoinedCallState(state)).toBe(false);
  });

  it('plays the local join sound only when entering an existing group call', () => {
    expect(shouldPlaySelfConnectSound(false, false)).toBe(false);
    expect(shouldPlaySelfConnectSound(true, true)).toBe(false);
    expect(shouldPlaySelfConnectSound(true, false)).toBe(true);
  });

  it('marks local speech only after audio bytes advance on a connected active sender', () => {
    const active = [{ connected: true, senderActive: true, previousBytes: 120, currentBytes: 180 }];
    expect(isOutgoingVoiceTransmitted(true, false, active)).toBe(true);
    expect(isOutgoingVoiceTransmitted(false, false, active)).toBe(false);
    expect(isOutgoingVoiceTransmitted(true, true, active)).toBe(false);
    expect(isOutgoingVoiceTransmitted(true, false, [{ ...active[0], connected: false }])).toBe(false);
    expect(isOutgoingVoiceTransmitted(true, false, [{ ...active[0], senderActive: false }])).toBe(false);
    expect(isOutgoingVoiceTransmitted(true, false, [{ ...active[0], currentBytes: 120 }])).toBe(false);
    expect(isOutgoingVoiceTransmitted(true, false, [{ connected: true, senderActive: true, currentBytes: 180 }])).toBe(false);
  });

  it('deafens participant microphones without muting screen-share audio', () => {
    expect(resolveRemotePlaybackVolume('voice', true, 0.8)).toBe(0);
    expect(resolveRemotePlaybackVolume('screen', true, 0.8)).toBe(0.8);
    expect(resolveRemotePlaybackVolume('voice', false, 0.8)).toBe(0.8);
  });

  it('routes remote audio through the media element while the tab is in the background', () => {
    expect(resolveRemotePlaybackRoute(0.8, true, false)).toEqual({ elementMuted: true, elementVolume: 0.8, gainVolume: 0.8 });
    expect(resolveRemotePlaybackRoute(0.8, true, true)).toEqual({ elementMuted: false, elementVolume: 0.8, gainVolume: 0 });
  });

  it('replaces only microphone senders without renegotiating unrelated media', async () => {
    const previousTrack = { id: 'old-microphone' } as MediaStreamTrack;
    const nextTrack = { id: 'new-microphone' } as MediaStreamTrack;
    const cameraTrack = { id: 'camera' } as MediaStreamTrack;
    const microphoneSender = { track: previousTrack, replaceTrack: vi.fn().mockResolvedValue(undefined) } as unknown as RTCRtpSender;
    const cameraSender = { track: cameraTrack, replaceTrack: vi.fn().mockResolvedValue(undefined) } as unknown as RTCRtpSender;

    await replaceMicrophoneTrack([{ getSenders: () => [microphoneSender, cameraSender] }], previousTrack, nextTrack);

    expect(microphoneSender.replaceTrack).toHaveBeenCalledWith(nextTrack);
    expect(cameraSender.replaceTrack).not.toHaveBeenCalled();
  });

  it('rolls back already replaced senders when another peer rejects the microphone switch', async () => {
    const previousTrack = { id: 'old-microphone' } as MediaStreamTrack;
    const nextTrack = { id: 'new-microphone' } as MediaStreamTrack;
    const firstSender = { track: previousTrack, replaceTrack: vi.fn().mockResolvedValue(undefined) } as unknown as RTCRtpSender;
    const secondSender = { track: previousTrack, replaceTrack: vi.fn().mockRejectedValue(new Error('replace failed')) } as unknown as RTCRtpSender;

    await expect(replaceMicrophoneTrack([{ getSenders: () => [firstSender, secondSender] }], previousTrack, nextTrack)).rejects.toThrow('replace failed');

    expect(firstSender.replaceTrack).toHaveBeenNthCalledWith(1, nextTrack);
    expect(firstSender.replaceTrack).toHaveBeenNthCalledWith(2, previousTrack);
  });

  it.each(['NotFoundError', 'OverconstrainedError'])('does not silently join with a different microphone on %s', async (name) => {
    let emit: (event: RealtimeEvent) => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => { emit = listener; return () => undefined; });
    const send = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Unavailable', name));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    saveAudioSettings({ ...defaultAudioSettings, inputDeviceId: 'usb-mic' });
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));
    act(() => result.current.call());
    await act(async () => emit({ type: 'call:accept', conversationId: 'chat', fromUserId: 'friend', startedAt: '2026-09-17T10:00:00.000Z' }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('available');
    expect(result.current.error).toContain('Выбранный микрофон недоступен');
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'voice:join' }));
  });

  it.each(['connecting', 'switching'])('keeps the latest microphone choice while %s', async (phase) => {
    let emit: (event: RealtimeEvent) => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => { emit = listener; return () => undefined; });
    vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    const track = () => ({ kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn(), applyConstraints: vi.fn().mockResolvedValue(undefined) });
    const first = track(), pending = track(), last = track();
    const stream = (audio: ReturnType<typeof track>) => ({ getTracks: () => [audio], getAudioTracks: () => [audio] }) as unknown as MediaStream;
    let resolveCapture!: (value: MediaStream) => void;
    const delayed = new Promise<MediaStream>((resolve) => { resolveCapture = resolve; });
    const getUserMedia = vi.fn();
    if (phase === 'switching') getUserMedia.mockResolvedValueOnce(stream(first));
    getUserMedia.mockReturnValueOnce(delayed).mockResolvedValueOnce(stream(last));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    saveAudioSettings({ ...defaultAudioSettings, inputDeviceId: 'mic-a' });
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));
    act(() => result.current.call());
    await act(async () => emit({ type: 'call:accept', conversationId: 'chat', fromUserId: 'friend', startedAt: '2026-09-17T10:00:00.000Z' }));
    if (phase === 'switching') {
      act(() => saveAudioSettings({ ...defaultAudioSettings, inputDeviceId: 'mic-b' }));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    } else {
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    }
    const finalId = phase === 'switching' ? 'mic-a' : 'mic-b';
    act(() => saveAudioSettings({ ...defaultAudioSettings, inputDeviceId: finalId }));
    await act(async () => { resolveCapture(stream(pending)); });
    await waitFor(() => expect(pending.stop).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: expect.objectContaining({ deviceId: { exact: finalId } }), video: false });
    expect(last.stop).not.toHaveBeenCalled();
    expect(result.current.state).toBe('connected');
  });

  it('switches the active microphone during a call and preserves mute', async () => {
    let emit: (event: RealtimeEvent) => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => {
      emit = listener;
      return () => undefined;
    });
    vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    const oldTrack = {
      id: 'old-microphone',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    } as unknown as MediaStreamTrack;
    const nextTrack = {
      id: 'new-microphone',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    } as unknown as MediaStreamTrack;
    const stream = (id: string, track: MediaStreamTrack) => ({
      id,
      getTracks: () => [track],
      getAudioTracks: () => [track],
    }) as unknown as MediaStream;
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(stream('old-stream', oldTrack))
      .mockResolvedValueOnce(stream('new-stream', nextTrack));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    saveAudioSettings({ ...defaultAudioSettings, inputDeviceId: 'microphone-a' });
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));

    act(() => result.current.call());
    await act(async () => emit({
      type: 'call:accept',
      conversationId: 'chat',
      fromUserId: 'friend',
      startedAt: '2026-08-13T10:00:00.000Z',
    }));
    expect(result.current.state).toBe('connected');
    // The saved device must be requested on the very first capture, without
    // making the user toggle to another microphone and back.
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: expect.objectContaining({ deviceId: { exact: 'microphone-a' } }),
      video: false,
    });
    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);

    act(() => saveAudioSettings({ ...defaultAudioSettings, inputDeviceId: 'microphone-b' }));
    await waitFor(() => expect(oldTrack.stop).toHaveBeenCalled());

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'microphone-b' } }),
      video: false,
    });
    expect(nextTrack.enabled).toBe(false);
    expect(nextTrack.stop).not.toHaveBeenCalled();

    act(() => saveAudioSettings(withNoiseSuppressionMode({ ...defaultAudioSettings, inputDeviceId: 'microphone-b' }, 'standard')));
    await waitFor(() => expect(nextTrack.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({ noiseSuppression: true })));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(nextTrack.enabled).toBe(false);
  });

  it.each(['resolve', 'reject'])('does not resurrect a call when pending microphone capture finishes after leaving (%s)', async (outcome) => {
    let emit: (event: RealtimeEvent) => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => { emit = listener; return () => undefined; });
    const send = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    let resolveCapture!: (stream: MediaStream) => void;
    let rejectCapture!: (error: Error) => void;
    const capture = new Promise<MediaStream>((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });
    const getUserMedia = vi.fn().mockReturnValue(capture);
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    const stop = vi.fn();
    const track = { stop, enabled: true, kind: 'audio', readyState: 'live' };
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));
    act(() => result.current.call());
    await act(async () => emit({ type: 'call:accept', conversationId: 'chat', fromUserId: 'friend', startedAt: '2026-09-17T10:00:00Z' }));
    expect(getUserMedia).toHaveBeenCalledOnce();
    act(() => result.current.leave());
    await act(async () => {
      if (outcome === 'resolve') resolveCapture({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream);
      else rejectCapture(new DOMException('Permission denied', 'NotAllowedError'));
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBe('');
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'voice:join' }));
    if (outcome === 'resolve') expect(stop).toHaveBeenCalled();
  });

  it('keeps working media connected through signalling loss, clears recovered errors, and ignores old peer callbacks', async () => {
    vi.useFakeTimers();
    let emit: (event: RealtimeEvent) => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => { emit = listener; return () => undefined; });
    vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    const track = { id: 'mic', kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn() };
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
    const instances: FakePeer[] = [];
    class FakePeer {
      connectionState = 'new'; signalingState = 'stable'; iceConnectionState = 'new';
      onconnectionstatechange = () => {};
      senders: { track: typeof track }[] = [];
      constructor() { instances.push(this); }
      addTrack(audioTrack: typeof track) { const sender = { track: audioTrack }; this.senders.push(sender); return sender; }
      getSenders() { return this.senders; }
      getStats = vi.fn().mockResolvedValue(new Map());
      createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: '' });
      setLocalDescription = vi.fn().mockResolvedValue(undefined);
      restartIce = vi.fn();
      close() { this.connectionState = 'closed'; this.signalingState = 'closed'; }
    }
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));
    act(() => result.current.call());
    await act(async () => emit({ type: 'call:accept', conversationId: 'chat', fromUserId: 'friend', startedAt: '2026-09-17T10:00:00Z' }));
    await act(async () => emit({ type: 'voice:peers', conversationId: 'chat', peers: ['friend'] }));
    const peer = instances[0];
    act(() => { peer.connectionState = 'connected'; peer.onconnectionstatechange(); });
    expect(result.current.state).toBe('connected');
    vi.mocked(realtime.isConnected).mockReturnValue(false);
    await act(async () => emit({ type: 'realtime:disconnected' }));
    expect(result.current.state).toBe('connected');
    expect(result.current.error).toBe('');
    expect(result.current.connectionNotice).toContain('Голосовое соединение работает');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.state).toBe('connected');
    vi.mocked(realtime.isConnected).mockReturnValue(true);
    await act(async () => emit({ type: 'ready', user: { id: 'me', name: 'Me', email: 'me@mova.test', handle: '@me', color: '#fff', presence: 'online', createdAt: '2026-09-17T10:00:00Z' } }));
    expect(result.current.connectionNotice).toBe('');
    await act(async () => emit({ type: 'voice:peers', conversationId: 'chat', peers: ['friend'] }));
    expect(peer.createOffer).toHaveBeenCalledTimes(1);

    act(() => { peer.connectionState = 'disconnected'; peer.onconnectionstatechange(); });
    expect(result.current.state).toBe('reconnecting');
    peer.signalingState = 'have-local-offer';
    await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
    expect(result.current.state).toBe('disconnected');
    expect(peer.setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' });
    expect(peer.restartIce.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.error).toContain('Проверьте интернет');
    // Recover even if the browser missed the connectionstatechange event.
    peer.connectionState = 'connected';
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(result.current.state).toBe('connected');
    expect(result.current.error).toBe('');

    act(() => { peer.connectionState = 'disconnected'; peer.onconnectionstatechange(); });
    await act(async () => emit({ type: 'voice:left', conversationId: 'chat', userId: 'friend' }));
    expect(result.current.state).toBe('connected');
    act(() => { peer.connectionState = 'failed'; peer.onconnectionstatechange(); });
    expect(result.current.error).toBe('');
    act(() => result.current.leave());
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBe('');
  });

  it('applies desktop hotkey actions to the active call while Mova is in the background', async () => {
    let emit: (event: RealtimeEvent) => void = () => undefined;
    let emitHotkey: (action: 'toggle-microphone' | 'toggle-headphones') => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => {
      emit = listener;
      return () => undefined;
    });
    const send = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    const microphoneTrack = { enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          id: 'microphone-stream',
          getTracks: () => [microphoneTrack],
          getAudioTracks: () => [microphoneTrack],
        }),
      },
    });
    window.movaDesktopShell = {
      platform: 'win32',
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      onHotkeyAction: vi.fn((callback) => {
        emitHotkey = callback;
        return () => undefined;
      }),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn(() => vi.fn()),
    };
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));

    act(() => result.current.call());
    await act(async () => emit({
      type: 'call:accept',
      conversationId: 'chat',
      fromUserId: 'friend',
      startedAt: '2026-08-26T15:00:00.000Z',
    }));
    act(() => emitHotkey('toggle-microphone'));
    expect(result.current.muted).toBe(true);
    expect(microphoneTrack.enabled).toBe(false);

    act(() => emitHotkey('toggle-headphones'));
    expect(result.current.deafened).toBe(true);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'voice:state',
      muted: true,
      deafened: true,
    }));
  });

  it('restores a server-confirmed room membership as available without creating a duplicate join', async () => {
    let emit: (event: RealtimeEvent) => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => {
      emit = listener;
      return () => undefined;
    });
    const send = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));

    await act(async () => emit({
      type: 'call:state',
      conversationId: 'chat',
      status: 'active',
      createdAt: '2026-08-12T10:00:00.000Z',
      startedAt: '2026-08-12T10:00:03.000Z',
      participants: ['me', 'friend'],
      room: [
        { userId: 'me', connectionState: 'reconnecting', muted: false, deafened: false, media: {} },
        { userId: 'friend', connectionState: 'connected', muted: false, deafened: false, media: {} },
      ],
      joined: false,
    }));

    expect(result.current.state).toBe('available');
    expect(sessionStorage.getItem('mova-active-call')).toBe('chat');
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'voice:join' }));
    act(() => result.current.call());
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'call:invite' }));
  });

  it('recovers from a reload snapshot and permits a new call after the room ends', async () => {
    let emit: (event: RealtimeEvent) => void = () => undefined;
    vi.spyOn(realtime, 'subscribe').mockImplementation((listener) => {
      emit = listener;
      return () => undefined;
    });
    const send = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    sessionStorage.setItem('mova-active-call', 'chat');
    const { result } = renderHook(() => useVoiceCall('chat', 'me'));

    await act(async () => emit({
      type: 'voice:snapshot',
      conversationId: 'chat',
      participants: [{ userId: 'me', connectionState: 'reconnecting', muted: true, deafened: false, media: {} }],
    }));
    expect(result.current.state).toBe('available');
    expect(result.current.muted).toBe(true);

    await act(async () => emit({
      type: 'call:state',
      conversationId: 'chat',
      status: 'idle',
      participants: [],
      room: [],
      joined: false,
    }));
    expect(result.current.state).toBe('idle');
    expect(sessionStorage.getItem('mova-active-call')).toBeNull();

    act(() => result.current.call());
    expect(result.current.state).toBe('ringing');
    expect(send).toHaveBeenCalledWith({ type: 'call:invite', conversationId: 'chat' });
  });

  it('keeps an unanswered outgoing call open as a one-person room', async () => {
    vi.useFakeTimers();
    vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => undefined);
    const send = vi.spyOn(realtime, 'send').mockImplementation(() => undefined);
    vi.spyOn(api, 'rtcConfig').mockResolvedValue({ iceServers: [] });
    const microphoneTrack = { enabled: true, readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack;
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          id: 'solo-microphone-stream',
          getTracks: () => [microphoneTrack],
          getAudioTracks: () => [microphoneTrack],
        }),
      },
    });
    const { result } = renderHook(() => useVoiceCall('chat', 'me', { direct: true }));

    act(() => result.current.call());
    expect(result.current.state).toBe('ringing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(result.current.state).toBe('connected');
    expect(result.current.joined).toBe(true);
    expect(result.current.participants).toEqual([]);
    expect(result.current.startedAt).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: 'call:accept', conversationId: 'chat' });
    expect(send).toHaveBeenCalledWith({ type: 'voice:join', conversationId: 'chat' });
    expect(send).not.toHaveBeenCalledWith({ type: 'call:decline', conversationId: 'chat' });
    expect(sessionStorage.getItem('mova-active-call')).toBe('chat');
  });
});
