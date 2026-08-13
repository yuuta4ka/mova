import { describe, expect, it, vi } from 'vitest';
import { configureScreenShareSender, screenShareContentHint, screenShareMaxBitrate } from './screenShareEncoding';

describe('screen share encoding', () => {
  it('allocates more bitrate for larger and faster captures while keeping safe limits', () => {
    expect(screenShareMaxBitrate({ width: 1280, height: 720, frameRate: 15 })).toBe(1_200_000);
    expect(screenShareMaxBitrate({ width: 1920, height: 1080, frameRate: 30 })).toBe(4_665_600);
    expect(screenShareMaxBitrate({ width: 2560, height: 1440, frameRate: 60 })).toBe(12_000_000);
  });

  it('favours fluid motion at 30 FPS and detail for low-bandwidth 15 FPS', () => {
    expect(screenShareContentHint(15)).toBe('detail');
    expect(screenShareContentHint(30)).toBe('motion');
    expect(screenShareContentHint(60)).toBe('motion');
  });

  it('asks WebRTC to preserve FPS and gives screen video high network priority', async () => {
    const parameters = { encodings: [{}], codecs: [], headerExtensions: [], rtcp: {}, transactionId: 'tx' } as unknown as RTCRtpSendParameters;
    const sender = {
      getParameters: vi.fn(() => parameters),
      setParameters: vi.fn().mockResolvedValue(undefined),
    } as unknown as RTCRtpSender;

    await expect(configureScreenShareSender(sender, { width: 1920, height: 1080, frameRate: 30 })).resolves.toBe(true);
    expect(sender.setParameters).toHaveBeenCalledWith(expect.objectContaining({
      degradationPreference: 'maintain-framerate',
      encodings: [expect.objectContaining({ maxBitrate: 4_665_600, maxFramerate: 30, priority: 'high', networkPriority: 'high' })],
    }));
  });
});
