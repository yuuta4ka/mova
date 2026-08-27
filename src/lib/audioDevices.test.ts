import { describe, expect, it } from 'vitest';
import { audioDeviceLabel, cleanAudioDeviceLabel } from './audioDevices';

describe('audio device labels', () => {
  it('hides Chromium USB vendor and product identifiers', () => {
    expect(cleanAudioDeviceLabel('Microphone (USB PnP Audio Device) (0c76:161f)')).toBe('Microphone (USB PnP Audio Device)');
    expect(cleanAudioDeviceLabel('HyperX QuadCast S (0951:1718)')).toBe('HyperX QuadCast S');
  });

  it('keeps normal model names and provides a fallback for hidden labels', () => {
    expect(cleanAudioDeviceLabel('MacBook Pro Microphone')).toBe('MacBook Pro Microphone');
    expect(audioDeviceLabel({ label: '' } as MediaDeviceInfo, 'Микрофон 2')).toBe('Микрофон 2');
  });
});
