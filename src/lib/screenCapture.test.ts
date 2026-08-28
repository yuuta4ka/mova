import { describe, expect, it, vi } from 'vitest';
import { removeUnsafeScreenAudio, screenCaptureOptions, shouldRemoveScreenAudio } from './screenCapture';

const quality = { width: 1920, height: 1080, frameRate: 30 };

describe('safe screen capture audio', () => {
  it('requests desktop audio with Mova playback excluded', () => {
    expect(screenCaptureOptions(quality, true)).toMatchObject({
      audio: { restrictOwnAudio: true },
    });
  });

  it('explicitly disables system audio when the desktop setting is off', () => {
    expect(screenCaptureOptions(quality, true, false)).toMatchObject({ audio: false });
    expect(screenCaptureOptions(quality, false, false)).toMatchObject({
      audio: false,
      systemAudio: 'exclude',
      windowAudio: 'exclude',
    });
  });

  it('requests browser system audio with the Mova tab and its playback excluded', () => {
    expect(screenCaptureOptions(quality, false)).toMatchObject({
      audio: { restrictOwnAudio: true },
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
      windowAudio: 'window',
    });
  });

  it('keeps verified system audio and isolated tab/window audio', () => {
    expect(shouldRemoveScreenAudio(false, 'browser', undefined)).toBe(false);
    expect(shouldRemoveScreenAudio(false, 'window', undefined)).toBe(false);
    expect(shouldRemoveScreenAudio(false, 'monitor', true)).toBe(false);
    expect(shouldRemoveScreenAudio(true, 'window', true)).toBe(false);
    expect(shouldRemoveScreenAudio(true, 'monitor', undefined)).toBe(false);
  });

  it('stops and removes loopback audio when own-audio exclusion is not confirmed', () => {
    const audioTrack = { getSettings: () => ({}), stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      removeTrack: vi.fn(),
    } as unknown as MediaStream;

    expect(removeUnsafeScreenAudio(stream, false, 'monitor')).toBe(true);
    expect(stream.removeTrack).toHaveBeenCalledWith(audioTrack);
    expect(audioTrack.stop).toHaveBeenCalledOnce();
  });

  it('keeps a live desktop loopback track even when Chromium omits the constraint from settings', () => {
    const audioTrack = { readyState: 'live', getSettings: () => ({}), stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      removeTrack: vi.fn(),
    } as unknown as MediaStream;

    expect(removeUnsafeScreenAudio(stream, true, 'monitor')).toBe(false);
    expect(stream.removeTrack).not.toHaveBeenCalled();
    expect(audioTrack.stop).not.toHaveBeenCalled();
  });

  it('removes a dead audio track returned by a failed platform capture', () => {
    const audioTrack = { readyState: 'ended', getSettings: () => ({}), stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      removeTrack: vi.fn(),
    } as unknown as MediaStream;

    expect(removeUnsafeScreenAudio(stream, true, 'monitor')).toBe(true);
    expect(stream.removeTrack).toHaveBeenCalledWith(audioTrack);
  });
});
