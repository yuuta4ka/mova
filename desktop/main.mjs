import { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, session, shell } from 'electron';
import updater from 'electron-updater';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { autoUpdater } = updater;
const desktopRoot = dirname(fileURLToPath(import.meta.url));
const settingsPath = () => join(app.getPath('userData'), 'desktop.json');
const setupPath = join(desktopRoot, 'setup.html');
const setupPreloadPath = join(desktopRoot, 'setup-preload.cjs');
const iconPath = join(desktopRoot, 'assets', 'icon.png');
const developmentUrl = 'http://127.0.0.1:5173';

let mainWindow = null;
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
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      if (!sources.length) return callback({});
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Демонстрация экрана',
        message: 'Что показать собеседникам?',
        buttons: [...sources.slice(0, 12).map((source) => source.name), 'Отмена'],
        cancelId: Math.min(sources.length, 12),
        noLink: true,
      });
      const source = sources[choice.response];
      callback(source ? { video: source, audio: 'loopback' } : {});
    },
    { useSystemPicker: true },
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...webPreferences,
    },
  });
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
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadFile(setupPath);
  createMenu();
}

async function showApp() {
  if (!appUrl) return showSetup();
  mainWindow?.destroy();
  mainWindow = createWindow();
  lockWindowTitle(mainWindow);
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
