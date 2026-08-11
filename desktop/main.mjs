import { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, session, shell } from 'electron';
import updater from 'electron-updater';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { availableSharePickerTabs, buildSharePickerSources } from './share-picker-model.mjs';
import { desktopWindowFrameOptions } from './window-shell.mjs';

const { autoUpdater } = updater;
const desktopRoot = dirname(fileURLToPath(import.meta.url));
const settingsPath = () => join(app.getPath('userData'), 'desktop.json');
const setupPath = join(desktopRoot, 'setup.html');
const setupPreloadPath = join(desktopRoot, 'setup-preload.cjs');
const appPreloadPath = join(desktopRoot, 'app-preload.cjs');
const sharePickerPath = join(desktopRoot, 'share-picker.html');
const sharePickerPreloadPath = join(desktopRoot, 'share-picker-preload.cjs');
const iconPath = join(desktopRoot, 'assets', 'icon.png');
const developmentUrl = 'http://127.0.0.1:5173';

let mainWindow = null;
let sharePickerWindow = null;
let appUrl = null;

function normalizeAppUrl(value, { allowLocal = false } = {}) {
  try {
    const url = new URL(String(value || '').trim());
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function readConfiguredUrl() {
  const environmentUrl = normalizeAppUrl(process.env.MOVA_DESKTOP_URL, { allowLocal: true });
  if (environmentUrl) return environmentUrl;
  if (!app.isPackaged) return developmentUrl;
  try {
    const settings = JSON.parse(await readFile(settingsPath(), 'utf8'));
    return normalizeAppUrl(settings.appUrl);
  } catch {
    return null;
  }
}

async function saveConfiguredUrl(value) {
  const normalized = normalizeAppUrl(value, { allowLocal: !app.isPackaged });
  if (!normalized) throw new Error('Укажите корректный HTTPS-адрес Mova.');
  await writeFile(settingsPath(), JSON.stringify({ appUrl: normalized }, null, 2));
  return normalized;
}

function isTrustedOrigin(origin) {
  if (!appUrl) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

async function chooseDesktopSource(sources) {
  const pickerSources = buildSharePickerSources(sources);
  if (!pickerSources.length) return null;

  sharePickerWindow?.destroy();

  return new Promise((resolve) => {
    const sourceById = new Map(sources.map((source) => [String(source.id), source]));
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const picker = new BrowserWindow({
      title: 'Выбор источника демонстрации',
      width: 980,
      height: 760,
      minWidth: 680,
      minHeight: 520,
      parent,
      modal: Boolean(parent),
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#17191f',
      icon: iconPath,
      resizable: true,
      ...desktopWindowFrameOptions(process.platform),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: sharePickerPreloadPath,
      },
    });
    sharePickerWindow = picker;

    let settled = false;
    const pickerUrl = pathToFileURL(sharePickerPath).toString();
    const cleanup = () => {
      ipcMain.removeListener('share-picker:choose', handleChoose);
      ipcMain.removeListener('share-picker:cancel', handleCancel);
      if (sharePickerWindow === picker) sharePickerWindow = null;
    };
    const finish = (sourceId = null, closeWindow = true) => {
      if (settled) return;
      settled = true;
      const source = sourceId ? sourceById.get(String(sourceId)) || null : null;
      cleanup();
      if (closeWindow && !picker.isDestroyed()) picker.destroy();
      resolve(source);
    };
    const isPickerSender = (event) => !picker.isDestroyed() && event.sender === picker.webContents;
    function handleChoose(event, sourceId) {
      if (!isPickerSender(event) || !sourceById.has(String(sourceId))) return;
      finish(sourceId);
    }
    function handleCancel(event) {
      if (isPickerSender(event)) finish();
    }

    ipcMain.on('share-picker:choose', handleChoose);
    ipcMain.on('share-picker:cancel', handleCancel);
    picker.on('closed', () => finish(null, false));
    picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    picker.webContents.on('will-navigate', (event, url) => {
      if (url !== pickerUrl) event.preventDefault();
    });
    picker.webContents.once('did-finish-load', () => {
      if (picker.isDestroyed()) return;
      picker.webContents.send('share-picker:sources', {
        sources: pickerSources,
        tabs: availableSharePickerTabs(pickerSources),
      });
    });
    picker.once('ready-to-show', () => picker.show());
    void picker.loadFile(sharePickerPath).catch(() => finish());
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
        callback(source ? { video: source, audio: 'loopback' } : {});
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
        {
          label: 'Изменить адрес сервера…',
          click: async () => {
            await rm(settingsPath(), { force: true });
            appUrl = null;
            await showSetup();
          },
        },
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
  if (process.platform !== 'win32') return;
  window.on('maximize', () => sendMaximizedState(window));
  window.on('unmaximize', () => sendMaximizedState(window));
  window.webContents.once('did-finish-load', () => sendMaximizedState(window));
}

function lockWindowTitle(window) {
  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle('Mova');
  });
}

async function showSetup() {
  mainWindow?.destroy();
  mainWindow = createWindow({ preload: setupPreloadPath });
  lockWindowTitle(mainWindow);
  configureWindowShell(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadFile(setupPath);
  createMenu();
}

async function showApp() {
  if (!appUrl) return showSetup();
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
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  const userAgent = `${mainWindow.webContents.getUserAgent()} MovaDesktop/${app.getVersion()}`;
  const desktopUrl = new URL(appUrl);
  if (desktopUrl.pathname === '/') desktopUrl.pathname = '/app';
  await mainWindow.loadURL(desktopUrl.toString(), { userAgent });
  createMenu();
}

function configureUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Обновление Mova',
      message: 'Новая версия загружена',
      detail: 'Перезапустить Mova и установить обновление?',
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (error) => console.warn('Desktop update check failed:', error.message));
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 10_000);
}

ipcMain.handle('desktop:save-url', async (event, value) => {
  if (event.sender.getURL() !== new URL(`file://${setupPath}`).toString()) throw new Error('Недоверенный источник.');
  appUrl = await saveConfiguredUrl(value);
  configurePermissions();
  await showApp();
  return appUrl;
});

ipcMain.on('desktop-window:minimize', (event) => controlledMainWindow(event)?.minimize());
ipcMain.on('desktop-window:toggle-maximize', (event) => {
  const window = controlledMainWindow(event);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.on('desktop-window:close', (event) => controlledMainWindow(event)?.close());
ipcMain.handle('desktop-window:is-maximized', (event) => controlledMainWindow(event)?.isMaximized() ?? false);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    app.setName('Mova');
    appUrl = await readConfiguredUrl();
    configurePermissions();
    await showApp();
    configureUpdates();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void showApp();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
