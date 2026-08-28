import desktopRelease from '../../desktop/release.json';
import type { DesktopUpdateState } from '../DesktopTitlebar';

export const currentDesktopReleaseVersion = desktopRelease.version;
export const desktopReleasePageUrl = `https://github.com/${desktopRelease.repository}/releases/latest`;

const releaseBaseUrl = (version: string) =>
  `https://github.com/${desktopRelease.repository}/releases/download/v${version}`;

export function desktopInstallerUrl(platform: string, version = currentDesktopReleaseVersion) {
  if (platform === 'darwin') return `${releaseBaseUrl(version)}/Mova-${version}-arm64.dmg`;
  if (platform === 'win32') return `${releaseBaseUrl(version)}/Mova.Setup.${version}.exe`;
  return desktopReleasePageUrl;
}

export function desktopVersionFromUserAgent(userAgent: string) {
  return userAgent.match(/(?:^|\s)MovaDesktop\/([0-9A-Za-z.+-]+)/u)?.[1] || '';
}

function numericVersion(version: string) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[.-].*)?$/u);
  return match ? match.slice(1).map(Number) : null;
}

export function compareDesktopVersions(left: string, right: string) {
  const leftParts = numericVersion(left);
  const rightParts = numericVersion(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

export function legacyDesktopUpdateState(platform: string, userAgent: string): DesktopUpdateState {
  const currentVersion = desktopVersionFromUserAgent(userAgent);
  const updateAvailable = !currentVersion || compareDesktopVersions(currentVersion, currentDesktopReleaseVersion) < 0;
  return {
    currentVersion,
    availableVersion: updateAvailable ? currentDesktopReleaseVersion : '',
    phase: updateAvailable ? 'available' : 'idle',
    progress: 0,
    lastResult: updateAvailable ? 'available' : 'up-to-date',
    supported: true,
    installMode: 'manual',
    downloadUrl: desktopInstallerUrl(platform),
  };
}
