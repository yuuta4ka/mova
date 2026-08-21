import { describe, expect, it, vi } from 'vitest';
import { removeUnsafeScreenAudio, screenCaptureOptions, shouldRemoveScreenAudio } from './screenCapture';

const quality = { width: 1920, height: 1080, frameRate: 30 };

describe('safe screen capture audio', () => {
  it('does not request the all-system desktop loopback', () => {
    expect(screenCaptureOptions(quality, true)).toMatchObject({ audio: false });
  });

  it('excludes the Mova tab and system mix in browser capture', () => {
    expect(screenCaptureOptions(quality, false)).toMatchObject({
      audio: true,
      selfBrowserSurface: 'exclude',
      systemAudio: 'exclude',
      windowAudio: 'window',
    });
  });

  it('keeps isolated tab/window audio but rejects monitor and desktop loopback audio', () => {
    expect(shouldRemoveScreenAudio(false, 'browser')).toBe(false);
    expect(shouldRemoveScreenAudio(false, 'window')).toBe(false);
    expect(shouldRemoveScreenAudio(false, 'monitor')).toBe(true);
    expect(shouldRemoveScreenAudio(true, 'window')).toBe(true);
  });

  it('stops and removes an unsafe captured audio track', () => {
    const audioTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      removeTrack: vi.fn(),
    } as unknown as MediaStream;

    expect(removeUnsafeScreenAudio(stream, false, 'monitor')).toBe(true);
    expect(stream.removeTrack).toHaveBeenCalledWith(audioTrack);
    expect(audioTrack.stop).toHaveBeenCalledOnce();
  });
});
