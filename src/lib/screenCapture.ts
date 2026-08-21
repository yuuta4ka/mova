interface ScreenCaptureQuality {
  width: number;
  height: number;
  frameRate: number;
}

interface ExtendedDisplayMediaStreamOptions extends DisplayMediaStreamOptions {
  selfBrowserSurface?: 'exclude' | 'include';
  surfaceSwitching?: 'exclude' | 'include';
  systemAudio?: 'exclude' | 'include';
  windowAudio?: 'exclude' | 'system' | 'window';
}

export function screenCaptureOptions(quality: ScreenCaptureQuality, desktop: boolean): ExtendedDisplayMediaStreamOptions {
  const video = {
    width: { ideal: quality.width },
    height: { ideal: quality.height },
    frameRate: { ideal: quality.frameRate, max: quality.frameRate },
  };
  if (desktop) return { video, audio: false };
  return {
    video,
    audio: true,
    // Capturing Mova itself or the complete system mix sends the call audio
    // back to every participant. Other tabs/windows may still provide their
    // own isolated audio track in browsers that support these hints.
    selfBrowserSurface: 'exclude',
    systemAudio: 'exclude',
    windowAudio: 'window',
    surfaceSwitching: 'include',
  };
}

export const shouldRemoveScreenAudio = (desktop: boolean, displaySurface?: string) =>
  desktop || displaySurface === 'monitor';

export function removeUnsafeScreenAudio(stream: MediaStream, desktop: boolean, displaySurface?: string) {
  if (!shouldRemoveScreenAudio(desktop, displaySurface)) return false;
  for (const track of stream.getAudioTracks()) {
    stream.removeTrack(track);
    track.stop();
  }
  return true;
}
