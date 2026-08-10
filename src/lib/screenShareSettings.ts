export interface ScreenShareSettings {
  width: number;
  height: number;
  frameRate: number;
}

export const defaultScreenShareSettings: ScreenShareSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
};

const key = 'mova-screen-share-settings';
const allowedResolutions = new Set(['1280x720', '1920x1080', '2560x1440']);
const allowedFrameRates = new Set([15, 30, 60]);

function normalize(value: Partial<ScreenShareSettings>): ScreenShareSettings {
  const resolution = `${Number(value.width)}x${Number(value.height)}`;
  const frameRate = Number(value.frameRate);
  const [width, height] = allowedResolutions.has(resolution) ? resolution.split('x').map(Number) : [defaultScreenShareSettings.width, defaultScreenShareSettings.height];
  return {
    width,
    height,
    frameRate: allowedFrameRates.has(frameRate) ? frameRate : defaultScreenShareSettings.frameRate,
  };
}

export function loadScreenShareSettings(): ScreenShareSettings {
  try {
    return normalize(JSON.parse(localStorage.getItem(key) || '{}'));
  } catch {
    return { ...defaultScreenShareSettings };
  }
}

export function saveScreenShareSettings(settings: ScreenShareSettings) {
  const normalized = normalize(settings);
  localStorage.setItem(key, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent<ScreenShareSettings>('mova-screen-share-settings', {
      detail: normalized,
    }),
  );
}
