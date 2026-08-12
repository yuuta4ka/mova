import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realtime, type RealtimeEvent } from '../lib/api';
import { isJoinedCallState, normalizeCallState, useVoiceCall, type CallState } from './useVoiceCall';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => {
  sessionStorage.clear();
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
