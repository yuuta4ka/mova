import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAudioSettings, loadAudioSettings, saveAudioSettings, withNoiseSuppressionMode } from './audioSettings';

describe('audio settings', () => {
  beforeEach(() => localStorage.clear());

  it('uses 100% defaults and enabled voice processing', () => {
    expect(loadAudioSettings()).toEqual(defaultAudioSettings);
    expect(loadAudioSettings().inputVolume).toBe(100);
    expect(loadAudioSettings().outputVolume).toBe(100);
    expect(loadAudioSettings().systemVolume).toBe(100);
    expect(loadAudioSettings().noiseSuppressionMode).toBe('enhanced');
  });

  it('migrates the previous noise suppression toggle and keeps the mode in sync', () => {
    localStorage.setItem('mova-audio-settings', JSON.stringify({ noiseSuppression: false }));
    expect(loadAudioSettings()).toMatchObject({ noiseSuppression: false, noiseSuppressionMode: 'off' });
    saveAudioSettings(withNoiseSuppressionMode(loadAudioSettings(), 'standard'));
    expect(loadAudioSettings()).toMatchObject({ noiseSuppression: true, noiseSuppressionMode: 'standard' });
  });

  it('persists 0–200% values and notifies active calls', () => {
    const listener = vi.fn(); window.addEventListener('mova-audio-settings', listener);
    saveAudioSettings(withNoiseSuppressionMode({ ...defaultAudioSettings, inputVolume: 0, outputVolume: 200 }, 'off'));
    expect(loadAudioSettings()).toMatchObject({ inputVolume: 0, outputVolume: 200, noiseSuppression: false });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('mova-audio-settings', listener);
  });

  it('persists and clamps the system sound volume independently', () => {
    saveAudioSettings({ ...defaultAudioSettings, outputVolume: 35, systemVolume: 150 });
    expect(loadAudioSettings()).toMatchObject({ outputVolume: 35, systemVolume: 100 });
  });
});
