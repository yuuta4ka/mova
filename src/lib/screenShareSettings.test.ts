import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultScreenShareSettings, loadScreenShareSettings, saveScreenShareSettings } from './screenShareSettings';

describe('screen share settings', () => {
  beforeEach(() => localStorage.clear());

  it('enables system audio by default and for settings saved before the toggle existed', () => {
    expect(loadScreenShareSettings()).toEqual(defaultScreenShareSettings);
    localStorage.setItem('mova-screen-share-settings', JSON.stringify({ width: 1280, height: 720, frameRate: 15 }));
    expect(loadScreenShareSettings()).toMatchObject({ systemAudioEnabled: true });
  });

  it('persists the disabled system-audio choice', () => {
    const listener = vi.fn();
    window.addEventListener('mova-screen-share-settings', listener);
    saveScreenShareSettings({ ...defaultScreenShareSettings, systemAudioEnabled: false });

    expect(loadScreenShareSettings().systemAudioEnabled).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('mova-screen-share-settings', listener);
  });
});
