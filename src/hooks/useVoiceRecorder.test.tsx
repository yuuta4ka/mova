import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeVoiceWaveform, useVoiceRecorder, type VoiceRecording } from './useVoiceRecorder';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('voice recorder', () => {
  it('normalizes captured levels into a compact, bounded waveform', () => {
    const waveform = normalizeVoiceWaveform([0, 0.2, 0.7, 2, 0.4], 8);
    expect(waveform).toHaveLength(8);
    expect(waveform.every((value) => value >= 0.12 && value <= 1)).toBe(true);
  });

  it('spreads a short recording across the complete waveform width', () => {
    const waveform = normalizeVoiceWaveform([0.12, 1], 8);
    expect(waveform).toHaveLength(8);
    expect(waveform[0]).toBe(0.12);
    expect(waveform.at(-1)).toBe(1);
    expect(new Set(waveform).size).toBeGreaterThan(4);
  });

  it('records opus audio and returns an offline-safe attachment', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    class MockMediaRecorder {
      static isTypeSupported = () => true;
      state: RecordingState = 'inactive';
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) { this.mimeType = options?.mimeType || 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('recording');
    now = 1_450;

    let finishResult: VoiceRecording | null | undefined;
    await act(async () => { finishResult = await result.current.finish(); });
    const recording = finishResult as VoiceRecording | null;

    expect(recording?.attachment).toMatchObject({
      name: 'Голосовое сообщение.webm',
      type: 'audio/webm;codecs=opus',
      durationMs: 1_350,
    });
    expect(recording?.attachment.dataUrl).toMatch(/^data:audio\/webm;codecs=opus;base64,/);
    expect(recording?.attachment.waveform).toHaveLength(40);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('idle');
  });
});
