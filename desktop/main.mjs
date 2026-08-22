import { app, BrowserWindow, Menu, Notification, Tray, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, powerMonitor, session, shell } from 'electron';
import updater from 'electron-updater';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableSharePickerTabs, buildSharePickerSources } from './share-picker-model.mjs';
import { desktopCallStatusLabel, resolveDesktopCallStatus, shouldKeepDesktopWindowOpen } from './tray-status.mjs';
import { desktopUpdateAction, normalizeUpdateProgress, updateCheckIntervalMs, updateStartupDelayMs } from './update-state.mjs';
import { desktopWindowFrameOptions } from './window-shell.mjs';
import { detectRunningGame, gameActivityPollIntervalMs } from './game-activity.mjs';
import { desktopAppPageUrl, desktopAppUrlCandidates, isTrustedDesktopOrigin } from './app-server.mjs';
import { desktopApplicationEditMenu, desktopEditContextMenuTemplate } from './edit-context-menu.mjs';

const { autoUpdater } = updater;
const desktopRoot = dirname(fileURLToPath(import.meta.url));
const settingsPath = () => join(app.getPath('userData'), 'desktop.json');
const appPreloadPath = join(desktopRoot, 'app-preload.cjs');
const iconPath = join(desktopRoot, 'assets', 'icon.png');

let mainWindow = null;
let appUrlCandidates = [];
let tray = null;
let isQuitting = false;
let desktopCallStatus = 'idle';
let sharePickerSequence = 0;
let activeSharePicker = null;
let updateStartupTimer = null;
let updateIntervalTimer = null;
let gameActivityTimer = null;
let gameActivityScanInFlight = false;
let desktopGameActivity = null;
let launchHidden = process.argv.includes('--hidden');
const desktopUpdateState = {
  configured: false,
  phase: 'idle',
  version: '',
  progress: 0,
  manualRequest: false,
  promptOpen: false,
};

async function readDesktopSettings() {
  try {
    const settings = JSON.parse(await readFile(settingsPath(), 'utf8'));
    return settings && typeof settings === 'object' ? settings : {};
  } catch {
    return {};
  }
}

async function updateDesktopSettings(values) {
  const settings = { ...(await readDesktopSettings()), ...values };
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
  return settings;
}

function supportsAutoLaunch() {
  return process.platform === 'darwin' || process.platform === 'win32';
}

function applyAutoLaunch(enabled) {
  if (!supportsAutoLaunch() || !app.isPackaged) return;
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled });
}

async function initializeAutoLaunch() {
  const settings = await readDesktopSettings();
  const enabled = typeof settings.autoLaunch === 'boolean' ? settings.autoLaunch : true;
  if (typeof settings.autoLaunch !== 'boolean') await updateDesktopSettings({ autoLaunch: true });
  applyAutoLaunch(enabled);
  if (process.platform === 'darwin' && app.isPackaged) launchHidden ||= app.getLoginItemSettings().wasOpenedAtLogin === true;
  return enabled;
}

async function setAutoLaunch(enabled) {
  const normalized = enabled === true;
  await updateDesktopSettings({ autoLaunch: normalized });
  applyAutoLaunch(normalized);
  return normalized;
}

async function configuredAutoLaunch() {
  const settings = await readDesktopSettings();
  return typeof settings.autoLaunch === 'boolean' ? settings.autoLaunch : true;
}

function isTrustedOrigin(origin) {
  return isTrustedDesktopOrigin(origin, appUrlCandidates);
}

function statusImage(status, badge = false) {
  const filename = `${badge ? 'overlay' : 'tray'}-${status}.png`;
  return nativeImage.createFromPath(join(desktopRoot, 'assets', 'status', filename)).resize({ width: badge ? 16 : 22, height: badge ? 16 : 22 });
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void showApp();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function currentUpdateAction() {
  return desktopUpdateAction(desktopUpdateState);
}

function setUpdateProgressBar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (desktopUpdateState.phase === 'downloading') {
    mainWindow.setProgressBar(Math.max(0.01, normalizeUpdateProgress(desktopUpdateState.progress) / 100));
    return;
  }
  mainWindow.setProgressBar(-1);
}

function desktopUpdateMenuItem() {
  const item = currentUpdateAction();
  return {
    label: item.label,
    enabled: item.enabled,
    click: () => {
      if (item.action === 'install') void promptToInstallUpdate();
      else if (item.action === 'check') void checkForDesktopUpdates({ manual: true });
    },
  };
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Mova', click: revealMainWindow },
      { type: 'separator' },
      { label: desktopCallStatusLabel(desktopCallStatus), enabled: false },
      { type: 'separator' },
      desktopUpdateMenuItem(),
      { type: 'separator' },
      { label: 'Выйти', click: () => app.quit() },
    ]),
  );
}

function applyDesktopCallStatus(status) {
  desktopCallStatus = status;
  const label = desktopCallStatusLabel(status);
  if (tray) {
    const image = statusImage(status);
    if (!image.isEmpty()) tray.setImage(image);
    tray.setToolTip(`Mova — ${label}`);
    refreshTrayMenu();
  }
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    const image = status === 'idle' ? null : statusImage(status, true);
    mainWindow.setOverlayIcon(image && !image.isEmpty() ? image : null, status === 'idle' ? '' : label);
  }
}

function createTray() {
  if (tray) return;
  const image = statusImage(desktopCallStatus);
  tray = new Tray(image.isEmpty() ? nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 }) : image);
  tray.on('click', revealMainWindow);
  tray.on('double-click', revealMainWindow);
  applyDesktopCallStatus(desktopCallStatus);
}

function sendGameActivity() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop-activity:game-change', desktopGameActivity);
}

async function refreshGameActivity() {
  if (gameActivityScanInFlight) return;
  gameActivityScanInFlight = true;
  try {
    const name = await detectRunningGame();
    if (name === desktopGameActivity?.name || (!name && !desktopGameActivity)) return;
    desktopGameActivity = name ? { name, startedAt: new Date().toISOString() } : null;
    sendGameActivity();
  } finally {
    gameActivityScanInFlight = false;
  }
}

function startGameActivityDetection() {
  if (gameActivityTimer || !['darwin', 'win32'].includes(process.platform)) return;
  void refreshGameActivity();
  gameActivityTimer = setInterval(() => void refreshGameActivity(), gameActivityPollIntervalMs);
  gameActivityTimer.unref?.();
}

async function chooseDesktopSource(sources) {
  const pickerSources = buildSharePickerSources(sources);
  if (!pickerSources.length) return null;
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!owner) return null;
  activeSharePicker?.finish();
  return new Promise((resolve) => {
    const sourceById = new Map(sources.map((source) => [String(source.id), source]));
    const requestId = `share-${Date.now()}-${++sharePickerSequence}`;
    let settled = false;
    const finish = (sourceId = null) => {
      if (settled) return;
      settled = true;
      const source = sourceId ? sourceById.get(String(sourceId)) || null : null;
      owner.removeListener('closed', finish);
      if (activeSharePicker?.requestId === requestId) activeSharePicker = null;
      resolve(source);
    };
    activeSharePicker = { requestId, owner, sourceById, finish };
    owner.once('closed', finish);
    owner.webContents.send('desktop-share-picker:open', {
      requestId,
      sources: pickerSources,
      tabs: availableSharePickerTabs(pickerSources),
    });
  });
}

function configurePermissions() {
  const allowedPermissions = new Set(['media', 'notifications', 'fullscreen', 'pointerLock']);
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    Boolean(isTrustedOrigin(requestingOrigin) && allowedPermissions.has(permission)),
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(Boolean(isTrustedOrigin(webContents.getURL()) && allowedPermissions.has(permission)));
  });
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!isTrustedOrigin(request.frame.url)) return callback({});
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 640, height: 360 },
          fetchWindowIcons: true,
        });
        const source = await chooseDesktopSource(sources);
        // Electron's loopback source is the complete system mix on Windows,
        // including Mova's own call output. Sending it would make every voice
        // return to participants a second time.
        callback(source ? { video: source } : {});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

function createMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: 'Mova',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        desktopUpdateMenuItem(),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: desktopApplicationEditMenu(),
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(webPreferences = {}) {
  return new BrowserWindow({
    title: 'Mova',
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: '#080c12',
    icon: iconPath,
    resizable: true,
    maximizable: true,
    minimizable: true,
    ...desktopWindowFrameOptions(process.platform),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      ...webPreferences,
    },
  });
}

function controlledMainWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return null;
  return mainWindow;
}

function sendMaximizedState(window) {
  if (!window.isDestroyed()) window.webContents.send('desktop-window:maximized-change', window.isMaximized());
}

function configureWindowShell(window) {
  window.on('close', (event) => {
    if (!shouldKeepDesktopWindowOpen(isQuitting)) return;
    event.preventDefault();
    window.hide();
  });
  if (process.platform === 'win32') {
    window.on('maximize', () => sendMaximizedState(window));
    window.on('unmaximize', () => sendMaximizedState(window));
    window.webContents.once('did-finish-load', () => sendMaximizedState(window));
  }
  window.webContents.once('did-finish-load', () => applyDesktopCallStatus(desktopCallStatus));
  window.webContents.once('did-finish-load', sendGameActivity);
  window.webContents.once('did-finish-load', setUpdateProgressBar);
  window.webContents.on('context-menu', (_event, params) => {
    const template = desktopEditContextMenuTemplate(params);
    if (!template.length || window.isDestroyed()) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}

function lockWindowTitle(window) {
  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle('Mova');
  });
}

async function showApp() {
  mainWindow?.destroy();
  mainWindow = createWindow({ preload: appPreloadPath });
  lockWindowTitle(mainWindow);
  configureWindowShell(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedOrigin(url)) return { action: 'allow' };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isTrustedOrigin(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  mainWindow.once('ready-to-show', () => {
    if (!launchHidden) mainWindow?.show();
    launchHidden = false;
  });
  const userAgent = `${mainWindow.webContents.getUserAgent()} MovaDesktop/${app.getVersion()}`;
  let loadError = null;
  for (const candidate of appUrlCandidates) {
    try {
      await mainWindow.loadURL(desktopAppPageUrl(candidate), { userAgent });
      loadError = null;
      break;
    } catch (error) {
      loadError = error;
    }
  }
  createMenu();
  if (!loadError) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Mova недоступна',
    message: 'Не удалось подключиться к Mova.',
    detail: 'Проверены основной адрес hola-mova.ru и резервный сервер Amvera. Проверьте интернет-соединение и попробуйте снова.',
    buttons: ['Повторить', 'Закрыть'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (result.response === 0) return showApp();
  app.quit();
}

function updaterDialog(options) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) return dialog.showMessageBox(mainWindow, options);
  return dialog.showMessageBox(options);
}

function refreshDesktopUpdateUi() {
  refreshTrayMenu();
  createMenu();
  setUpdateProgressBar();
}

function setDesktopUpdateState(values) {
  Object.assign(desktopUpdateState, values);
  refreshDesktopUpdateUi();
}

async function promptToInstallUpdate() {
  if (desktopUpdateState.phase !== 'downloaded' || desktopUpdateState.promptOpen) return;
  desktopUpdateState.promptOpen = true;
  const version = desktopUpdateState.version;
  try {
    const result = await updaterDialog({
      type: 'info',
      title: 'Обновление Mova',
      message: version ? `Mova ${version} готова к установке` : 'Обновление Mova готово к установке',
      detail: 'Перезапустить приложение сейчас? Если выбрать «Позже», обновление установится при следующем выходе из Mova.',
      buttons: ['Перезапустить и обновить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    }
  } finally {
    desktopUpdateState.promptOpen = false;
  }
}

async function checkForDesktopUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) {
      await updaterDialog({
        type: 'info',
        title: 'Обновление Mova',
        message: 'Проверка обновлений доступна в установленной версии Mova.',
        buttons: ['Понятно'],
      });
    }
    return;
  }
  if (!desktopUpdateState.configured) return;
  if (desktopUpdateState.phase === 'downloaded') {
    if (manual) await promptToInstallUpdate();
    return;
  }
  if (desktopUpdateState.phase !== 'idle') return;
  setDesktopUpdateState({ phase: 'checking', manualRequest: manual, progress: 0 });
  void autoUpdater.checkForUpdates().catch((error) => {
    if (desktopUpdateState.phase !== 'idle') handleUpdateError(error);
  });
}

function handleUpdateError(error) {
  const showError = desktopUpdateState.manualRequest;
  const message = error instanceof Error ? error.message : String(error || 'Неизвестная ошибка');
  setDesktopUpdateState({ phase: 'idle', manualRequest: false, progress: 0 });
  console.warn('Desktop update check failed:', message);
  if (showError) {
    void updaterDialog({
      type: 'error',
      title: 'Обновление Mova',
      message: 'Не удалось проверить обновления.',
      detail: 'Проверьте подключение к интернету и попробуйте ещё раз.',
      buttons: ['Понятно'],
    });
  }
}

function configureUpdates() {
  if (!app.isPackaged || desktopUpdateState.configured) return;
  desktopUpdateState.configured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => {
    if (desktopUpdateState.phase !== 'checking') setDesktopUpdateState({ phase: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    setDesktopUpdateState({ phase: 'downloading', version: String(info?.version || ''), progress: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    setDesktopUpdateState({ phase: 'downloading', progress: normalizeUpdateProgress(progress?.percent) });
  });
  autoUpdater.on('update-not-available', async () => {
    const showResult = desktopUpdateState.manualRequest;
    setDesktopUpdateState({ phase: 'idle', manualRequest: false, version: '', progress: 0 });
    if (showResult) {
      await updaterDialog({
        type: 'info',
        title: 'Обновление Mova',
        message: 'У вас установлена актуальная версия Mova.',
        detail: `Текущая версия: ${app.getVersion()}`,
        buttons: ['Понятно'],
      });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    setDesktopUpdateState({
      phase: 'downloaded',
      version: String(info?.version || desktopUpdateState.version || ''),
      progress: 100,
      manualRequest: false,
    });
    void promptToInstallUpdate();
  });
  autoUpdater.on('update-cancelled', () => {
    setDesktopUpdateState({ phase: 'idle', manualRequest: false, version: '', progress: 0 });
  });
  autoUpdater.on('error', handleUpdateError);
  refreshDesktopUpdateUi();
  updateStartupTimer = setTimeout(() => void checkForDesktopUpdates(), updateStartupDelayMs);
  updateStartupTimer.unref?.();
  updateIntervalTimer = setInterval(() => void checkForDesktopUpdates(), updateCheckIntervalMs);
  updateIntervalTimer.unref?.();
}

ipcMain.on('desktop-window:minimize', (event) => controlledMainWindow(event)?.minimize());
ipcMain.on('desktop-window:toggle-maximize', (event) => {
  const window = controlledMainWindow(event);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.on('desktop-window:close', (event) => controlledMainWindow(event)?.close());
ipcMain.on('desktop-call:status', (event, value) => {
  if (!controlledMainWindow(event) || !value || typeof value !== 'object') return;
  applyDesktopCallStatus(
    resolveDesktopCallStatus({
      active: value.active === true,
      speaking: value.speaking === true,
      muted: value.muted === true,
      deafened: value.deafened === true,
    }),
  );
});
ipcMain.on('desktop-notification:show', (event, value) => {
  if (!controlledMainWindow(event) || !Notification.isSupported() || !value || typeof value !== 'object') return;
  const title = String(value.title || 'Mova').slice(0, 120);
  const body = String(value.body || '').slice(0, 500);
  const conversationId = String(value.conversationId || '').slice(0, 120);
  const kind = value.kind === 'call' ? 'call' : 'message';
  const notification = new Notification({ title, body, icon: iconPath, urgency: kind === 'call' ? 'critical' : 'normal' });
  notification.on('click', () => {
    revealMainWindow();
    mainWindow?.webContents.send('desktop-notification:click', { kind, conversationId });
  });
  notification.show();
});
ipcMain.on('desktop-share-picker:choose', (event, requestId, sourceId) => {
  const request = activeSharePicker;
  if (!request || event.sender !== request.owner.webContents || request.requestId !== requestId || !request.sourceById.has(String(sourceId))) return;
  request.finish(String(sourceId));
});
ipcMain.on('desktop-share-picker:cancel', (event, requestId) => {
  const request = activeSharePicker;
  if (!request || event.sender !== request.owner.webContents || request.requestId !== requestId) return;
  request.finish();
});
ipcMain.handle('desktop-window:is-maximized', (event) => controlledMainWindow(event)?.isMaximized() ?? false);
ipcMain.handle('desktop-clipboard:write-text', (event, value) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  if (typeof value !== 'string') throw new TypeError('Текст для копирования должен быть строкой.');
  clipboard.writeText(value);
  return true;
});
ipcMain.handle('desktop-settings:get-auto-launch', async (event) => {
  if (!controlledMainWindow(event)) return false;
  return configuredAutoLaunch();
});
ipcMain.handle('desktop-settings:set-auto-launch', async (event, enabled) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  return setAutoLaunch(enabled === true);
});
ipcMain.handle('desktop-activity:get-system-idle-time', (event) => {
  if (!controlledMainWindow(event)) return 0;
  return Math.max(0, Math.round(powerMonitor.getSystemIdleTime()));
});
ipcMain.handle('desktop-activity:get-game', (event) => (controlledMainWindow(event) ? desktopGameActivity : null));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    revealMainWindow();
  });

  app.whenReady().then(async () => {
    app.setName('Mova');
    await initializeAutoLaunch();
    createTray();
    appUrlCandidates = desktopAppUrlCandidates({
      packaged: app.isPackaged,
      environmentUrl: process.env.MOVA_DESKTOP_URL,
    });
    configurePermissions();
    await showApp();
    startGameActivityDetection();
    configureUpdates();
    app.on('activate', () => {
      revealMainWindow();
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (updateStartupTimer) clearTimeout(updateStartupTimer);
  if (updateIntervalTimer) clearInterval(updateIntervalTimer);
  if (gameActivityTimer) clearInterval(gameActivityTimer);
});
