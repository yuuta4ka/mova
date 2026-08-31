import { describe, expect, it } from 'vitest';
import {
  compareDesktopVersions,
  currentDesktopReleaseDate,
  currentDesktopReleaseVersion,
  desktopInstallerUrl,
  desktopVersionFromUserAgent,
  formatDesktopReleaseDate,
  legacyDesktopUpdateState,
} from './desktopUpdates';

describe('desktop update compatibility', () => {
  it('reads the installed desktop version from the shell user agent', () => {
    expect(desktopVersionFromUserAgent('Mozilla/5.0 Electron/43.3.0 MovaDesktop/0.1.10')).toBe('0.1.10');
    expect(desktopVersionFromUserAgent('Mozilla/5.0')).toBe('');
  });

  it('compares stable desktop versions numerically', () => {
    expect(compareDesktopVersions('0.1.9', '0.1.12')).toBe(-1);
    expect(compareDesktopVersions('0.1.12', '0.1.12')).toBe(0);
    expect(compareDesktopVersions('0.2.0', '0.1.12')).toBe(1);
  });

  it('formats the release date in Russian without timezone drift', () => {
    expect(currentDesktopReleaseDate).toBe('2026-08-28');
    expect(formatDesktopReleaseDate('2026-08-28')).toBe('28 августа 2026');
    expect(formatDesktopReleaseDate('2026-02-29')).toBe('');
    expect(formatDesktopReleaseDate('not-a-date')).toBe('');
  });

  it('builds direct installer links for both supported desktop platforms', () => {
    expect(desktopInstallerUrl('darwin', '1.2.3')).toBe(
      'https://github.com/yuuta4ka/mova/releases/download/v1.2.3/Mova-1.2.3-arm64.dmg',
    );
    expect(desktopInstallerUrl('win32', '1.2.3')).toBe(
      'https://github.com/yuuta4ka/mova/releases/download/v1.2.3/Mova.Setup.1.2.3.exe',
    );
  });

  it('turns a legacy shell into a usable manual update state', () => {
    expect(legacyDesktopUpdateState('darwin', 'Electron/43.3.0 MovaDesktop/0.1.10')).toMatchObject({
      currentVersion: '0.1.10',
      availableVersion: currentDesktopReleaseVersion,
      phase: 'available',
      lastResult: 'available',
      supported: true,
      installMode: 'manual',
      downloadUrl: desktopInstallerUrl('darwin'),
    });
  });
});
