import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, realtime, type RealtimeEvent } from '../lib/api';
import { defaultAudioSettings, saveAudioSettings, withNoiseSuppressionMode } from '../lib/audioSettings';
import { isJoinedCallState, isOutgoingVoiceTransmitted, normalizeCallState, replaceMicrophoneTrack, resolveRemotePlaybackRoute, resolveRemotePlaybackVolume, shouldPlaySelfConnectSound, useVoiceCall, type CallState } from './useVoiceCall';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
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
});
