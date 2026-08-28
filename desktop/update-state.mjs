import desktopRelease from './release.json' with { type: 'json' };

export const updateStartupDelayMs = 10_000;
export const updateCheckIntervalMs = 4 * 60 * 60 * 1_000;
export const updateCheckTimeoutMs = 30_000;

export function desktopReleaseDownloadUrl(version, platform) {
  const normalizedVersion = String(version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(normalizedVersion)) {
    return `https://github.com/${desktopRelease.repository}/releases/latest`;
  }
  const base = `https://github.com/${desktopRelease.repository}/releases/download/v${normalizedVersion}`;
  if (platform === 'darwin') return `${base}/Mova-${normalizedVersion}-arm64.dmg`;
  if (platform === 'win32') return `${base}/Mova.Setup.${normalizedVersion}.exe`;
  return `https://github.com/${desktopRelease.repository}/releases/latest`;
}

export function desktopUpdateErrorKind(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/sign(?:ed|ature)|code object|shipit|install|permission|access denied/iu.test(message)) return 'installation';
  if (/network|internet|timed?(?:\s|_)*out|timeout|ENOTFOUND|ECONN|EAI_AGAIN|HTTP error|status code/iu.test(message)) return 'network';
  return 'unknown';
}

export function normalizeUpdateProgress(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function desktopUpdateAction({ phase = 'idle', version = '', progress = 0 } = {}) {
  if (phase === 'downloaded') {
    return {
      label: version ? `Установить Mova ${version}…` : 'Установить обновление…',
      enabled: true,
      action: 'install',
    };
  }
  if (phase === 'available') {
    return {
      label: version ? `Скачать Mova ${version}…` : 'Скачать обновление…',
      enabled: true,
      action: 'download',
    };
  }
  if (phase === 'downloading') {
    return {
      label: `Загрузка обновления… ${normalizeUpdateProgress(progress)}%`,
      enabled: false,
      action: 'none',
    };
  }
  if (phase === 'checking') {
    return { label: 'Проверяем обновления…', enabled: false, action: 'none' };
  }
  return { label: 'Проверить обновления…', enabled: true, action: 'check' };
}
