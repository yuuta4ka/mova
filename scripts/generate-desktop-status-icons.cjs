const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

app.whenReady().then(async () => {
  const { desktopStatusSvg } = await import('../desktop/tray-status.mjs');
  const outputDirectory = join(__dirname, '..', 'desktop', 'assets', 'status');
  const statuses = ['idle', 'silent', 'speaking', 'mic-off', 'headphones-off'];
  await mkdir(outputDirectory, { recursive: true });

  const renderer = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });

  for (const status of statuses) {
    for (const badge of [false, true]) {
      if (badge && status === 'idle') continue;
      const svg = desktopStatusSvg(status, { size: 64, badge });
      const html = `<style>html,body{margin:0;width:64px;height:64px;background:transparent;overflow:hidden}svg{display:block}</style>${svg}`;
      await renderer.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
      const image = await renderer.webContents.capturePage({ x: 0, y: 0, width: 64, height: 64 });
      await writeFile(join(outputDirectory, `${badge ? 'overlay' : 'tray'}-${status}.png`), image.toPNG());
    }
  }

  renderer.destroy();
  app.quit();
});
