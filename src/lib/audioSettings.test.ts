import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAudioSettings, loadAudioSettings, saveAudioSettings } from './audioSettings';

describe('audio settings', () => {
  beforeEach(() => localStorage.clear());

  it('uses 100% defaults and enabled voice processing', () => {
    expect(loadAudioSettings()).toEqual(defaultAudioSettings);
    expect(loadAudioSettings().inputVolume).toBe(100);
    expect(loadAudioSettings().outputVolume).toBe(100);
    expect(loadAudioSettings().systemVolume).toBe(100);
  });

  it('persists 0–200% values and notifies active calls', () => {
    const listener = vi.fn(); window.addEventListener('mova-audio-settings', listener);
    saveAudioSettings({ ...defaultAudioSettings, inputVolume: 0, outputVolume: 200, noiseSuppression: false });
    expect(loadAudioSettings()).toMatchObject({ inputVolume: 0, outputVolume: 200, noiseSuppression: false });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('mova-audio-settings', listener);
  });

  it('persists and clamps the system sound volume independently', () => {
    saveAudioSettings({ ...defaultAudioSettings, outputVolume: 35, systemVolume: 150 });
    expect(loadAudioSettings()).toMatchObject({ outputVolume: 35, systemVolume: 100 });
  });
});
