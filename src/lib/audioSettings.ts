export interface AudioSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  inputVolume: number;
  outputVolume: number;
  systemVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export const defaultAudioSettings: AudioSettings = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  inputVolume: 100,
  outputVolume: 100,
  systemVolume: 100,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

const key = 'mova-audio-settings';
const normalize = (value: Partial<AudioSettings>): AudioSettings => ({
  ...defaultAudioSettings,
  ...value,
  inputVolume: Math.max(0, Math.min(200, Number(value.inputVolume ?? 100))),
  outputVolume: Math.max(0, Math.min(200, Number(value.outputVolume ?? 100))),
  systemVolume: Math.max(0, Math.min(100, Number(value.systemVolume ?? 100))),
});
export function loadAudioSettings(): AudioSettings {
  try { return normalize(JSON.parse(localStorage.getItem(key) || '{}')); } catch { return { ...defaultAudioSettings }; }
}
export function saveAudioSettings(settings: AudioSettings) {
  const normalized = normalize(settings); localStorage.setItem(key, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent<AudioSettings>('mova-audio-settings', { detail: normalized }));
}
