export const updateStartupDelayMs = 10_000;
export const updateCheckIntervalMs = 4 * 60 * 60 * 1_000;

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
