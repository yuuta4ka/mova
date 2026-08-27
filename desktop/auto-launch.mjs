export const desktopHiddenLaunchArgs = ['--hidden'];

export function desktopAutoLaunchQueryOptions(platform, execPath) {
  if (platform === 'win32') return { path: execPath, args: desktopHiddenLaunchArgs };
  if (platform === 'darwin') return { type: 'mainAppService' };
  return {};
}

export function desktopAutoLaunchSettings(platform, execPath, enabled) {
  if (platform === 'win32') {
    return {
      openAtLogin: enabled,
      path: execPath,
      args: desktopHiddenLaunchArgs,
      enabled,
    };
  }
  if (platform === 'darwin') return { openAtLogin: enabled, type: 'mainAppService' };
  return null;
}

export function desktopAutoLaunchEnabled(platform, settings) {
  if (!settings || settings.openAtLogin !== true) return false;
  if (platform === 'darwin') return settings.status !== 'requires-approval' && settings.status !== 'not-registered' && settings.status !== 'not-found';
  return platform === 'win32';
}

export function desktopAutoLaunchError(platform, settings, enabled) {
  if (enabled && platform === 'darwin' && settings?.status === 'requires-approval') {
    return 'Автозапуск добавлен, но macOS ждёт подтверждения. Включите Mova в «Системные настройки → Основные → Объекты входа».';
  }
  if (enabled && platform === 'win32') {
    return 'Windows не включила автозапуск Mova. Разрешите Mova в «Диспетчер задач → Автозагрузка приложений».';
  }
  return `Не удалось ${enabled ? 'включить' : 'выключить'} автозапуск Mova.`;
}
