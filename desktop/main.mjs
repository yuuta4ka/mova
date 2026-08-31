import { app, BrowserWindow, Menu, Notification, Tray, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, powerMonitor, session, shell } from 'electron';
import updater from 'electron-updater';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableSharePickerTabs, buildSharePickerSources } from './share-picker-model.mjs';
import { desktopCallStatusLabel, resolveDesktopCallStatus, shouldKeepDesktopWindowOpen } from './tray-status.mjs';
import {
  desktopCurrentReleaseDate,
  desktopReleaseDownloadUrl,
  desktopUpdateAction,
  desktopUpdateErrorKind,
  normalizeUpdateProgress,
  updateCheckIntervalMs,
  updateRetryDelayMs,
  updateCheckTimeoutMs,
  updateStartupDelayMs,
} from './update-state.mjs';
import { desktopWindowFrameOptions } from './window-shell.mjs';
import { gameActivityPollIntervalMs, installedGameRegistryRefreshMs, listDesktopProcesses, loadInstalledGameRegistry, loadRunningMacGameBundles, resolveGameFromProcesses, runningApplicationsFromProcesses } from './game-activity.mjs';
import { desktopAppPageUrl, desktopAppUrlCandidates, isTrustedDesktopOrigin } from './app-server.mjs';
import { desktopApplicationEditMenu, desktopEditContextMenuTemplate } from './edit-context-menu.mjs';
import { desktopDisplayMediaHandlerOptions, desktopDisplayMediaStreams } from './display-media.mjs';
import { defaultDesktopHotkeys, desktopHotkeyEntries, normalizeDesktopHotkeys, validateDesktopHotkeys } from './hotkeys.mjs';
import { desktopAutoLaunchEnabled, desktopAutoLaunchError, desktopAutoLaunchQueryOptions, desktopAutoLaunchSettings } from './auto-launch.mjs';

const { autoUpdater } = updater;
const desktopRoot = dirname(fileURLToPath(import.meta.url));
const settingsPath = () => join(app.getPath('userData'), 'desktop.json');
const appPreloadPath = join(desktopRoot, 'app-preload.cjs');
const updateDialogPreloadPath = join(desktopRoot, 'update-dialog-preload.cjs');
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
let updateRetryTimer = null;
let updateCheckTimeoutTimer = null;
let activeUpdateDialog = null;
let gameActivityTimer = null;
let gameActivityScanInFlight = false;
let desktopGameActivity = null;
let desktopGameActivityKey = '';
let gameActivityMissingScans = 0;
let installedGameRegistry = [];
let installedGameRegistryLoadedAt = 0;
let desktopHotkeys = { ...defaultDesktopHotkeys };
const gameIconCache = new Map();
let launchHidden = process.argv.includes('--hidden');
const desktopUpdateState = {
  configured: false,
  phase: 'idle',
  version: '',
  progress: 0,
  lastResult: 'idle',
  errorKind: '',
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

function sendDesktopHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop-hotkeys:action', action);
}

function registerDesktopHotkeys(settings) {
  globalShortcut.unregisterAll();
  for (const [action, accelerator] of desktopHotkeyEntries(settings)) {
    try {
      if (globalShortcut.register(accelerator, () => sendDesktopHotkeyAction(action))) continue;
    } catch {
      globalShortcut.unregisterAll();
      return `Сочетание ${accelerator} не поддерживается системой.`;
    }
    globalShortcut.unregisterAll();
    return `Сочетание ${accelerator} уже занято системой или другим приложением.`;
  }
  return '';
}

async function initializeDesktopHotkeys() {
  const stored = normalizeDesktopHotkeys((await readDesktopSettings()).hotkeys);
  const validated = validateDesktopHotkeys(stored);
  desktopHotkeys = validated.error ? { ...defaultDesktopHotkeys } : validated.settings;
  const error = registerDesktopHotkeys(desktopHotkeys);
  if (error) console.warn(`Desktop hotkey registration failed: ${error}`);
}

async function replaceDesktopHotkeys(value) {
  const candidate = validateDesktopHotkeys(value);
  if (candidate.error) throw new Error(candidate.error);
  const previous = desktopHotkeys;
  const suspended = globalShortcut.isSuspended();
  if (suspended) globalShortcut.setSuspended(false);
  const registrationError = registerDesktopHotkeys(candidate.settings);
  if (registrationError) {
    registerDesktopHotkeys(previous);
    if (suspended) globalShortcut.setSuspended(true);
    throw new Error(registrationError);
  }
  try {
    await updateDesktopSettings({ hotkeys: candidate.settings });
    desktopHotkeys = candidate.settings;
  } catch (error) {
    registerDesktopHotkeys(previous);
    if (suspended) globalShortcut.setSuspended(true);
    throw error;
  }
  if (suspended) globalShortcut.setSuspended(true);
  return desktopHotkeys;
}

function normalizedRegisteredGames(settings) {
  if (!Array.isArray(settings?.registeredGames)) return [];
  return settings.registeredGames
    .map((game) => ({
      id: String(game?.id || ''),
      title: String(game?.title || '').trim().slice(0, 80),
      identity: String(game?.identity || '').trim(),
      executableName: String(game?.executableName || '').trim().slice(0, 160),
      createdAt: String(game?.createdAt || ''),
    }))
    .filter((game) => game.id && game.title && game.identity);
}

async function gameActivitySettings() {
  const settings = await readDesktopSettings();
  return {
    enabled: typeof settings.gameActivityEnabled === 'boolean' ? settings.gameActivityEnabled : true,
    registeredGames: normalizedRegisteredGames(settings),
  };
}

async function gameIconDataUrl(path) {
  const key = String(path || '');
  if (!key) return '';
  if (!gameIconCache.has(key)) {
    gameIconCache.set(key, app.getFileIcon(key, { size: 'normal' })
      .then((image) => {
        if (!image || image.isEmpty()) return '';
        const size = image.getSize();
        const resized = size.width > 64 || size.height > 64 ? image.resize({ width: 64, height: 64, quality: 'best' }) : image;
        const dataUrl = resized.toDataURL();
        return dataUrl.length <= 120_000 ? dataUrl : '';
      })
      .catch(() => ''));
  }
  return gameIconCache.get(key);
}

async function refreshInstalledGameRegistry(force = false) {
  if (!force && Date.now() - installedGameRegistryLoadedAt < installedGameRegistryRefreshMs) return installedGameRegistry;
  installedGameRegistry = await loadInstalledGameRegistry(process.platform).catch(() => installedGameRegistry);
  installedGameRegistryLoadedAt = Date.now();
  return installedGameRegistry;
}

async function runningApplications() {
  const settings = await gameActivitySettings();
  const applications = runningApplicationsFromProcesses(await listDesktopProcesses(process.platform), process.platform);
  const registeredIdentities = new Set(settings.registeredGames.map((game) => game.identity));
  return Promise.all(applications.map(async (item) => ({
    id: item.id,
    name: item.name,
    executableName: item.executableName,
    iconDataUrl: await gameIconDataUrl(item.iconPath),
    registered: registeredIdentities.has(item.identity),
  })));
}

async function registeredGameDtos(games) {
  return Promise.all(games.map(async (game) => ({
    id: game.id,
    title: game.title,
    executableName: game.executableName,
    iconDataUrl: await gameIconDataUrl(game.identity),
  })));
}

async function gameActivitySettingsDto() {
  const settings = await gameActivitySettings();
  return { enabled: settings.enabled, registeredGames: await registeredGameDtos(settings.registeredGames) };
}

function supportsAutoLaunch() {
  return process.platform === 'darwin' || process.platform === 'win32';
}

function readSystemAutoLaunch() {
  if (!supportsAutoLaunch() || !app.isPackaged) return { enabled: false, settings: null };
  const settings = app.getLoginItemSettings(desktopAutoLaunchQueryOptions(process.platform, process.execPath));
  return { enabled: desktopAutoLaunchEnabled(process.platform, settings), settings };
}

function applyAutoLaunch(enabled) {
  if (!supportsAutoLaunch() || !app.isPackaged) return { enabled, settings: null };
  const settings = desktopAutoLaunchSettings(process.platform, process.execPath, enabled);
  if (settings) app.setLoginItemSettings(settings);
  return readSystemAutoLaunch();
}

async function initializeAutoLaunch() {
  const settings = await readDesktopSettings();
  const enabled = typeof settings.autoLaunch === 'boolean' ? settings.autoLaunch : true;
  if (typeof settings.autoLaunch !== 'boolean') await updateDesktopSettings({ autoLaunch: true });
  const systemState = applyAutoLaunch(enabled);
  if (enabled && app.isPackaged && !systemState.enabled) console.warn(desktopAutoLaunchError(process.platform, systemState.settings, true));
  if (process.platform === 'darwin' && app.isPackaged) launchHidden ||= systemState.settings?.wasOpenedAtLogin === true;
  return systemState.enabled;
}

async function setAutoLaunch(enabled) {
  const normalized = enabled === true;
  await updateDesktopSettings({ autoLaunch: normalized });
  const systemState = applyAutoLaunch(normalized);
  if (systemState.enabled !== normalized) throw new Error(desktopAutoLaunchError(process.platform, systemState.settings, normalized));
  return systemState.enabled;
}

async function configuredAutoLaunch() {
  const settings = await readDesktopSettings();
  const configured = typeof settings.autoLaunch === 'boolean' ? settings.autoLaunch : true;
  return app.isPackaged && supportsAutoLaunch() ? readSystemAutoLaunch().enabled : configured;
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

function desktopUpdateSnapshot() {
  return {
    currentVersion: app.getVersion(),
    currentReleaseDate: desktopCurrentReleaseDate || undefined,
    availableVersion: desktopUpdateState.version,
    phase: desktopUpdateState.phase,
    progress: normalizeUpdateProgress(desktopUpdateState.progress),
    lastResult: desktopUpdateState.lastResult,
    supported: app.isPackaged && desktopUpdateState.configured,
    installMode: process.platform === 'darwin' ? 'manual' : 'automatic',
    downloadUrl: desktopReleaseDownloadUrl(desktopUpdateState.version, process.platform),
    errorKind: desktopUpdateState.errorKind || undefined,
  };
}

function sendDesktopUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop-update:state', desktopUpdateSnapshot());
}

function desktopUpdateMenuItem() {
  const item = currentUpdateAction();
  return {
    label: item.label,
    enabled: item.enabled,
    click: () => {
      if (item.action === 'install') void promptToInstallUpdate();
      else if (item.action === 'download') void promptToDownloadUpdate();
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

async function refreshGameActivity({ clearImmediately = false } = {}) {
  if (gameActivityScanInFlight) return;
  gameActivityScanInFlight = true;
  try {
    const settings = await gameActivitySettings();
    if (!settings.enabled) {
      desktopGameActivity = null;
      desktopGameActivityKey = '';
      gameActivityMissingScans = 0;
      sendGameActivity();
      return;
    }
    const [processes, registryGames] = await Promise.all([listDesktopProcesses(process.platform), refreshInstalledGameRegistry()]);
    const systemGames = process.platform === 'darwin' ? await loadRunningMacGameBundles(processes) : [];
    const detected = resolveGameFromProcesses(processes, {
      platform: process.platform,
      installedGames: [...registryGames, ...systemGames],
      registeredGames: settings.registeredGames,
    });
    if (!detected) {
      gameActivityMissingScans += 1;
      if (desktopGameActivity && !clearImmediately && gameActivityMissingScans < 2) {
        sendGameActivity();
        return;
      }
      desktopGameActivity = null;
      desktopGameActivityKey = '';
      sendGameActivity();
      return;
    }
    gameActivityMissingScans = 0;
    if (detected.key === desktopGameActivityKey && desktopGameActivity) {
      sendGameActivity();
      return;
    }
    desktopGameActivityKey = detected.key;
    desktopGameActivity = {
      name: detected.name,
      startedAt: new Date().toISOString(),
      iconDataUrl: await gameIconDataUrl(detected.iconPath),
      source: detected.source,
    };
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
        // Electron turns loopback into loopbackWithoutChrome when the renderer
        // requests restrictOwnAudio, keeping Mova's call output out of the share.
        callback(desktopDisplayMediaStreams(source, request.audioRequested));
      } catch {
        callback({});
      }
    },
    // Electron 43 currently produces a silent/dead macOS audio track when a
    // custom picker supplies the source. The native macOS 15+ picker starts the
    // CoreAudio capture session correctly and prompts for the required access.
    desktopDisplayMediaHandlerOptions(),
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

function updaterDialog(options = {}) {
  const buttons = Array.isArray(options.buttons) && options.buttons.length
    ? options.buttons.slice(0, 3).map((button) => String(button).slice(0, 48))
    : ['Понятно'];
  const defaultId = Number.isInteger(options.defaultId) && options.defaultId >= 0 && options.defaultId < buttons.length
    ? options.defaultId
    : 0;
  const cancelId = Number.isInteger(options.cancelId) && options.cancelId >= 0 && options.cancelId < buttons.length
    ? options.cancelId
    : buttons.length - 1;
  const owner = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;

  activeUpdateDialog?.finish(activeUpdateDialog.cancelId);
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      title: String(options.title || 'Обновление Mova'),
      width: 456,
      height: 388,
      parent: owner || undefined,
      modal: Boolean(owner),
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      skipTaskbar: Boolean(owner),
      icon: iconPath,
      webPreferences: {
        preload: updateDialogPreloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    let settled = false;
    const finish = (response = cancelId) => {
      if (settled) return;
      settled = true;
      if (activeUpdateDialog?.window === window) activeUpdateDialog = null;
      if (!window.isDestroyed()) window.destroy();
      resolve({ response, checkboxChecked: false });
    };
    activeUpdateDialog = { window, finish, cancelId, buttons };
    window.once('closed', () => finish(cancelId));
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return;
      window.webContents.send('desktop-update-dialog:payload', {
        tone: ['success', 'update', 'error', 'info'].includes(options.tone) ? options.tone : options.type === 'error' ? 'error' : 'info',
        title: String(options.title || 'Обновление Mova').slice(0, 80),
        message: String(options.message || '').slice(0, 180),
        detail: String(options.detail || '').slice(0, 360),
        meta: String(options.meta || '').slice(0, 100),
        buttons,
        defaultId,
        cancelId,
      });
    });
    void window.loadFile(join(desktopRoot, 'update-dialog.html')).catch(() => finish(cancelId));
  });
}

function refreshDesktopUpdateUi() {
  refreshTrayMenu();
  createMenu();
  setUpdateProgressBar();
  sendDesktopUpdateState();
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
      tone: 'update',
      title: 'Обновление Mova',
      message: version ? `Mova ${version} уже готова` : 'Обновление уже готово',
      detail: 'Можно перезапустить приложение сейчас или установить обновление при следующем выходе из Mova.',
      meta: version ? `Новая версия ${version}` : '',
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

async function promptToDownloadUpdate() {
  if (desktopUpdateState.promptOpen) return;
  desktopUpdateState.promptOpen = true;
  const version = desktopUpdateState.version;
  try {
    const result = await updaterDialog({
      tone: 'update',
      title: 'Обновление Mova',
      message: version ? `Доступна Mova ${version}` : 'Доступна новая версия Mova',
      detail: process.platform === 'darwin'
        ? 'Чтобы обновить Mova на macOS, скачайте DMG и перенесите приложение в папку «Программы».'
        : 'Откройте страницу последнего релиза и скачайте установщик для своей системы.',
      meta: process.platform === 'darwin' ? 'Ручная установка' : '',
      buttons: ['Скачать установщик', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      await shell.openExternal(desktopReleaseDownloadUrl(version, process.platform));
    }
  } finally {
    desktopUpdateState.promptOpen = false;
  }
}

function clearUpdateCheckTimeout() {
  if (!updateCheckTimeoutTimer) return;
  clearTimeout(updateCheckTimeoutTimer);
  updateCheckTimeoutTimer = null;
}

function startUpdateCheckTimeout() {
  clearUpdateCheckTimeout();
  updateCheckTimeoutTimer = setTimeout(() => {
    updateCheckTimeoutTimer = null;
    if (desktopUpdateState.phase !== 'checking') return;
    handleUpdateError(new Error('Desktop update check timed out.'));
  }, updateCheckTimeoutMs);
  updateCheckTimeoutTimer.unref?.();
}

function clearUpdateRetry() {
  if (updateRetryTimer) clearTimeout(updateRetryTimer);
  updateRetryTimer = null;
}

function scheduleUpdateRetry() {
  clearUpdateRetry();
  updateRetryTimer = setTimeout(() => {
    updateRetryTimer = null;
    void checkForDesktopUpdates();
  }, updateRetryDelayMs);
  updateRetryTimer.unref?.();
}

async function checkForDesktopUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) {
      await updaterDialog({
        tone: 'info',
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
  clearUpdateRetry();
  setDesktopUpdateState({ phase: 'checking', manualRequest: manual, version: '', progress: 0, lastResult: 'idle', errorKind: '' });
  startUpdateCheckTimeout();
  void autoUpdater.checkForUpdates().catch((error) => {
    if (desktopUpdateState.phase !== 'idle') handleUpdateError(error);
  });
}

function handleUpdateError(error) {
  const showError = desktopUpdateState.manualRequest;
  const message = error instanceof Error ? error.message : String(error || 'Неизвестная ошибка');
  const errorKind = desktopUpdateErrorKind(error);
  clearUpdateCheckTimeout();
  setDesktopUpdateState({ phase: 'idle', manualRequest: false, progress: 0, lastResult: 'error', errorKind });
  if (errorKind !== 'installation') scheduleUpdateRetry();
  console.warn('Desktop update check failed:', message);
  if (showError) {
    void updaterDialog({
      tone: 'error',
      title: 'Обновление Mova',
      message: 'Не удалось проверить обновления.',
      detail: errorKind === 'network'
        ? 'Сервер обновлений не ответил вовремя. Можно повторить проверку или скачать установщик вручную.'
        : errorKind === 'installation'
          ? 'Автоматическая установка недоступна. Скачайте установщик вручную.'
          : 'Можно повторить проверку или скачать установщик вручную.',
      buttons: ['Скачать установщик', 'Закрыть'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) return shell.openExternal(desktopReleaseDownloadUrl(desktopUpdateState.version, process.platform));
      return undefined;
    });
  }
}

function configureUpdates() {
  if (!app.isPackaged || desktopUpdateState.configured) return;
  desktopUpdateState.configured = true;
  // Unsigned/ad-hoc macOS builds cannot be replaced reliably by Squirrel.Mac.
  // We still check the feed, then send the user to the verified DMG.
  autoUpdater.autoDownload = process.platform !== 'darwin';
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => {
    if (desktopUpdateState.phase !== 'checking') setDesktopUpdateState({ phase: 'checking', lastResult: 'idle' });
  });
  autoUpdater.on('update-available', (info) => {
    clearUpdateCheckTimeout();
    clearUpdateRetry();
    const showDownload = desktopUpdateState.manualRequest && process.platform === 'darwin';
    setDesktopUpdateState({
      phase: process.platform === 'darwin' ? 'available' : 'downloading',
      version: String(info?.version || ''),
      progress: 0,
      lastResult: 'available',
      manualRequest: false,
      errorKind: '',
    });
    if (showDownload) void promptToDownloadUpdate();
  });
  autoUpdater.on('download-progress', (progress) => {
    clearUpdateCheckTimeout();
    setDesktopUpdateState({ phase: 'downloading', progress: normalizeUpdateProgress(progress?.percent), errorKind: '' });
  });
  autoUpdater.on('update-not-available', async () => {
    const showResult = desktopUpdateState.manualRequest;
    clearUpdateCheckTimeout();
    clearUpdateRetry();
    setDesktopUpdateState({ phase: 'idle', manualRequest: false, version: '', progress: 0, lastResult: 'up-to-date', errorKind: '' });
    if (showResult) {
      await updaterDialog({
        tone: 'success',
        title: 'Обновление Mova',
        message: 'Всё обновлено',
        detail: 'У вас установлена актуальная версия Mova.',
        meta: `Версия ${app.getVersion()}`,
        buttons: ['Отлично'],
      });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    clearUpdateCheckTimeout();
    clearUpdateRetry();
    setDesktopUpdateState({
      phase: 'downloaded',
      version: String(info?.version || desktopUpdateState.version || ''),
      progress: 100,
      lastResult: 'available',
      manualRequest: false,
      errorKind: '',
    });
    void promptToInstallUpdate();
  });
  autoUpdater.on('update-cancelled', () => {
    clearUpdateCheckTimeout();
    setDesktopUpdateState({ phase: 'idle', manualRequest: false, version: '', progress: 0, lastResult: 'idle', errorKind: '' });
  });
  autoUpdater.on('error', handleUpdateError);
  refreshDesktopUpdateUi();
  updateStartupTimer = setTimeout(() => void checkForDesktopUpdates(), updateStartupDelayMs);
  updateStartupTimer.unref?.();
  updateIntervalTimer = setInterval(() => void checkForDesktopUpdates(), updateCheckIntervalMs);
  updateIntervalTimer.unref?.();
}

ipcMain.on('desktop-window:minimize', (event) => controlledMainWindow(event)?.minimize());
ipcMain.on('desktop-update-dialog:respond', (event, response) => {
  const active = activeUpdateDialog;
  if (!active || active.window.isDestroyed() || event.sender !== active.window.webContents) return;
  const normalized = Number(response);
  active.finish(Number.isInteger(normalized) && normalized >= 0 && normalized < active.buttons.length ? normalized : active.cancelId);
});
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
ipcMain.handle('desktop-clipboard:write-image', (event, value) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpe?g|webp);base64,/iu.test(value) || value.length > 45_000_000)
    throw new TypeError('Изображение для копирования имеет неподдерживаемый формат.');
  const image = nativeImage.createFromDataURL(value);
  if (image.isEmpty()) throw new Error('Не удалось декодировать изображение.');
  clipboard.writeImage(image);
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
ipcMain.handle('desktop-hotkeys:get', (event) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  return desktopHotkeys;
});
ipcMain.handle('desktop-hotkeys:set', async (event, value) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  return replaceDesktopHotkeys(value);
});
ipcMain.on('desktop-hotkeys:set-capture-active', (event, active) => {
  if (!controlledMainWindow(event)) return;
  globalShortcut.setSuspended(active === true);
});
ipcMain.handle('desktop-update:get-state', (event) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  return desktopUpdateSnapshot();
});
ipcMain.handle('desktop-update:check', async (event) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  await checkForDesktopUpdates({ manual: true });
  return desktopUpdateSnapshot();
});
ipcMain.handle('desktop-update:install', async (event) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  if (desktopUpdateState.phase === 'downloaded') await promptToInstallUpdate();
  else if (desktopUpdateState.phase === 'available') await promptToDownloadUpdate();
  return desktopUpdateSnapshot();
});
ipcMain.handle('desktop-activity:get-system-idle-time', (event) => {
  if (!controlledMainWindow(event)) return 0;
  return Math.max(0, Math.round(powerMonitor.getSystemIdleTime()));
});
ipcMain.handle('desktop-activity:get-game', (event) => (controlledMainWindow(event) ? desktopGameActivity : null));
ipcMain.handle('desktop-activity:get-settings', async (event) => {
  if (!controlledMainWindow(event)) return { enabled: false, registeredGames: [] };
  return gameActivitySettingsDto();
});
ipcMain.handle('desktop-activity:set-enabled', async (event, enabled) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  await updateDesktopSettings({ gameActivityEnabled: enabled === true });
  await refreshGameActivity({ clearImmediately: true });
  return gameActivitySettingsDto();
});
ipcMain.handle('desktop-activity:list-applications', async (event) => {
  if (!controlledMainWindow(event)) return [];
  return runningApplications();
});
ipcMain.handle('desktop-activity:register-game', async (event, applicationId, requestedTitle) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  const applications = runningApplicationsFromProcesses(await listDesktopProcesses(process.platform), process.platform);
  const application = applications.find((item) => item.id === String(applicationId || ''));
  if (!application) throw new Error('Приложение больше не запущено. Обновите список.');
  const settings = await gameActivitySettings();
  const title = String(requestedTitle || application.name).trim().replace(/\s+/gu, ' ').slice(0, 80);
  if (!title) throw new Error('Укажите название игры.');
  const existing = settings.registeredGames.find((game) => game.identity === application.identity);
  const game = {
    id: existing?.id || randomUUID(),
    title,
    identity: application.identity,
    executableName: application.executableName,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  const registeredGames = [...settings.registeredGames.filter((item) => item.identity !== application.identity), game];
  await updateDesktopSettings({ registeredGames });
  await refreshGameActivity({ clearImmediately: true });
  return gameActivitySettingsDto();
});
ipcMain.handle('desktop-activity:unregister-game', async (event, gameId) => {
  if (!controlledMainWindow(event)) throw new Error('Недоверенный источник.');
  const settings = await gameActivitySettings();
  const registeredGames = settings.registeredGames.filter((game) => game.id !== String(gameId || ''));
  await updateDesktopSettings({ registeredGames });
  await refreshGameActivity({ clearImmediately: true });
  return gameActivitySettingsDto();
});

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
    await initializeDesktopHotkeys();
    startGameActivityDetection();
    configureUpdates();
    app.on('activate', () => {
      revealMainWindow();
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (app.isReady()) globalShortcut.unregisterAll();
  if (updateStartupTimer) clearTimeout(updateStartupTimer);
  if (updateIntervalTimer) clearInterval(updateIntervalTimer);
  clearUpdateRetry();
  clearUpdateCheckTimeout();
  if (gameActivityTimer) clearInterval(gameActivityTimer);
});
