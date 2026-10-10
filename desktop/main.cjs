/* eslint-disable @typescript-eslint/no-require-imports -- Electron main entry is intentionally CommonJS. */
const { app, BrowserWindow, dialog, session, utilityProcess } = require('electron');
const { join, isAbsolute } = require('node:path');
const { mkdirSync, appendFileSync } = require('node:fs');
const { BackendLifecycle } = require('./lifecycle.cjs');

let mainWindow;
let backend;
let quitting = false;
// Optional profile isolation for a separate local library or installed-app verification.
if (process.env.OPENMAIC_DESKTOP_PROFILE_DIR) {
  if (!isAbsolute(process.env.OPENMAIC_DESKTOP_PROFILE_DIR)) throw new Error('OPENMAIC_DESKTOP_PROFILE_DIR must be absolute');
  mkdirSync(process.env.OPENMAIC_DESKTOP_PROFILE_DIR, { recursive: true });
  app.setPath('userData', process.env.OPENMAIC_DESKTOP_PROFILE_DIR);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    mkdirSync(app.getPath('userData'), { recursive: true });
    const logPath = join(app.getPath('userData'), 'desktop.log');
    const serverRoot = app.isPackaged
      ? join(process.resourcesPath, 'server')
      : join(__dirname, '..', 'build', 'desktop', 'server');
    backend = new BackendLifecycle(() =>
      utilityProcess.fork(join(__dirname, 'server.cjs'), [], {
        cwd: serverRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
          OPENMAIC_STORAGE_BACKEND: 'sqlite',
          OPENMAIC_DATA_DIR: join(app.getPath('userData'), 'data'),
          OPENMAIC_DESKTOP: '1',
          OWNER_SINGLE_USER: 'true',
          OWNER_SINGLE_USER_ID: 'local',
          DATABASE_URL: '',
          ASSET_S3_BUCKET: '',
          ACCESS_CODE: '',
          OPENMAIC_SERVER_ROOT: serverRoot,
        },
        stdio: 'pipe',
        serviceName: 'ProMAIC local server',
      }),
      { log: chunk => appendFileSync(logPath, chunk) },
    );
    try {
      const origin = await backend.start();
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        let allowed = false;
        try {
          const url = new URL(details.url);
          allowed = url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol);
        } catch {
          /* reject malformed requests */
        }
        callback({ cancel: !allowed });
      });
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
        callback(permission === 'fullscreen' && webContents === mainWindow?.webContents),
      );
      mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 900,
        minHeight: 600,
        title: 'ProMAIC',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      mainWindow.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      mainWindow.on('closed', () => {
        mainWindow = undefined;
      });
      await mainWindow.loadURL(origin);
    } catch (error) {
      console.error('[desktop] startup failed', error);
      appendFileSync(logPath, `${error.stack ?? error.message}\n`);
      dialog.showErrorBox('ProMAIC 启动失败', `${error.message}\n日志：${logPath}`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!backend || quitting) return;
    event.preventDefault();
    quitting = true;
    backend.stop().finally(() => app.quit());
  });
}
