interface ScreenCaptureQuality {
  width: number;
  height: number;
  frameRate: number;
}

interface ScreenCaptureAudioConstraints extends MediaTrackConstraints {
  restrictOwnAudio: boolean;
}

interface ExtendedDisplayMediaStreamOptions {
  video: boolean | MediaTrackConstraints;
  audio?: boolean | ScreenCaptureAudioConstraints;
  selfBrowserSurface?: 'exclude' | 'include';
  surfaceSwitching?: 'exclude' | 'include';
  systemAudio?: 'exclude' | 'include';
  windowAudio?: 'exclude' | 'system' | 'window';
}

export function screenCaptureOptions(quality: ScreenCaptureQuality, desktop: boolean, systemAudioEnabled = true): ExtendedDisplayMediaStreamOptions {
  const video = {
    width: { ideal: quality.width },
    height: { ideal: quality.height },
    frameRate: { ideal: quality.frameRate, max: quality.frameRate },
  };
  const audio: ScreenCaptureAudioConstraints | false = systemAudioEnabled ? { restrictOwnAudio: true } : false;
  if (desktop) return { video, audio };
  return {
    video,
    audio,
    // Ask Chromium to omit audio produced by Mova while retaining the shared
    // tab, window, or system sound. The captured track is verified below.
    selfBrowserSurface: 'exclude',
    systemAudio: systemAudioEnabled ? 'include' : 'exclude',
    windowAudio: systemAudioEnabled ? 'window' : 'exclude',
    surfaceSwitching: 'include',
  };
}

export const shouldRemoveScreenAudio = (desktop: boolean, displaySurface: string | undefined, restrictOwnAudio: boolean | undefined) =>
  !desktop && displaySurface === 'monitor' && restrictOwnAudio !== true;

export function removeUnsafeScreenAudio(stream: MediaStream, desktop: boolean, displaySurface?: string) {
  let removed = false;
  for (const track of stream.getAudioTracks()) {
    const settings = track.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean };
    if (track.readyState !== 'ended' && !shouldRemoveScreenAudio(desktop, displaySurface, settings.restrictOwnAudio)) continue;
    stream.removeTrack(track);
    track.stop();
    removed = true;
  }
  return removed;
}
