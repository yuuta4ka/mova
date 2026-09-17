import { describe, expect, it } from 'vitest';
import { createMicrophoneSilenceDetector } from './microphoneSignal';

describe('microphone signal warning', () => {
  const silence = new Float32Array(64);
  it('warns only after twelve seconds of continuous digital silence and clears as soon as a signal returns', () => {
    const sample = createMicrophoneSilenceDetector();
    for (let time = 0; time < 12_000; time += 250) expect(sample(silence, time, true)).toBe(false);
    expect(sample(silence, 12_000, true)).toBe(true);
    const quietSignal = new Float32Array(64); quietSignal[10] = 0.0001;
    expect(sample(quietSignal, 12_250, true)).toBe(false);
    expect(sample(silence, 12_500, true)).toBe(false);
  });
  it('does not confuse quiet room noise with a missing signal', () => {
    const sample = createMicrophoneSilenceDetector();
    for (let time = 0; time <= 30_000; time += 250) expect(sample(new Float32Array([0.00001, -0.00002]), time, true)).toBe(false);
  });
  it('resets on mute, suspended context and background timer gaps', () => {
    const sample = createMicrophoneSilenceDetector();
    for (let time = 0; time <= 12_000; time += 250) sample(silence, time, true);
    expect(sample(silence, 12_250, false)).toBe(false);
    expect(sample(silence, 12_500, true)).toBe(false);
    expect(sample(silence, 30_000, true)).toBe(false);
  });
});
