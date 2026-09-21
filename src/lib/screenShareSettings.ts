export interface ScreenShareSettings {
  width: number;
  height: number;
  frameRate: number;
  systemAudioEnabled: boolean;
}

export const defaultScreenShareSettings: ScreenShareSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  systemAudioEnabled: true,
};

const key = 'mova-screen-share-settings';
const allowedResolutions = new Set(['1280x720', '1920x1080', '2560x1440']);
const allowedFrameRates = new Set([15, 30, 60]);

export function normalizeScreenShareSettings(value: Partial<ScreenShareSettings>): ScreenShareSettings {
  const resolution = `${Number(value.width)}x${Number(value.height)}`;
  const frameRate = Number(value.frameRate);
  const [width, height] = allowedResolutions.has(resolution) ? resolution.split('x').map(Number) : [defaultScreenShareSettings.width, defaultScreenShareSettings.height];
  return {
    width,
    height,
    frameRate: allowedFrameRates.has(frameRate) ? frameRate : defaultScreenShareSettings.frameRate,
    systemAudioEnabled: value.systemAudioEnabled !== false,
  };
}

export function loadScreenShareSettings(): ScreenShareSettings {
  try {
    return normalizeScreenShareSettings(JSON.parse(localStorage.getItem(key) || '{}'));
  } catch {
    return { ...defaultScreenShareSettings };
  }
}

export function saveScreenShareSettings(settings: ScreenShareSettings) {
  const normalized = normalizeScreenShareSettings(settings);
  localStorage.setItem(key, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent<ScreenShareSettings>('mova-screen-share-settings', {
      detail: normalized,
    }),
  );
}
