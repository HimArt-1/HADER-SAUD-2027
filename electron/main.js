// =============================================================================
// نظام حاضر (Hader) - Electron Main Process
// =============================================================================

const { app, BrowserWindow, Menu, shell, ipcMain, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const {
  assertSafeCapturePolicy,
  isAllowedNoorResourceUrl,
  isAllowedNoorSessionUrl
} = require('./noor-session-policy.cjs');
const MAX_IPC_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NOOR_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const NOOR_LOGIN_URL = 'https://noor.moe.gov.sa/Noor/Login.aspx';
const NOOR_CAPTURE_HOST = 'noor.moe.gov.sa';
const APP_DEVELOPMENT_ORIGIN = 'http://localhost:5173';
const APP_ENTRY_FILE = path.resolve(__dirname, '../dist/index.html');

// Keep a global reference of the window object
let mainWindow = null;
let noorWindow = null;
let noorSessionSequence = 0;
let noorNavigationVersion = 0;

// Check if we're in development mode
const isDev = !app.isPackaged;

// =============================================================================
// Window Creation
// =============================================================================

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'نظام حاضر - Hader System',
    icon: getIconPath(),
    backgroundColor: '#0f172a', // Dark slate background
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      devTools: isDev
    },
    // macOS specific
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 }
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    // Use hash-based routing for file:// protocol compatibility
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    closeNoorSessionWindow();
    mainWindow = null;
  });

  // Create application menu
  createMenu();
}

function closeNoorSessionWindow() {
  if (!noorWindow || noorWindow.isDestroyed()) return { closed: false };
  const windowToClose = noorWindow;
  noorWindow = null;
  windowToClose.destroy();
  return { closed: true };
}

function isTrustedAppUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (isDev) return parsedUrl.origin === APP_DEVELOPMENT_ORIGIN;
    return parsedUrl.protocol === 'file:' && path.resolve(fileURLToPath(parsedUrl)) === APP_ENTRY_FILE;
  } catch {
    return false;
  }
}

function openExternalSafely(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (!['https:', 'mailto:'].includes(parsedUrl.protocol)) return;
    void shell.openExternal(parsedUrl.toString());
  } catch {
    // Invalid and custom-protocol links remain blocked.
  }
}

function isNoorWebContents(contents) {
  return Boolean(
    noorWindow &&
    !noorWindow.isDestroyed() &&
    noorWindow.webContents.id === contents.id
  );
}

function blockUnsafeNoorNavigation(event, targetUrl) {
  if (isAllowedNoorSessionUrl(targetUrl)) {
    return;
  }

  event.preventDefault();
}

async function openNoorSessionWindow() {
  if (noorWindow && !noorWindow.isDestroyed()) {
    noorWindow.show();
    noorWindow.focus();
    return { opened: true };
  }

  const partition = `hader-noor-readonly-${++noorSessionSequence}`;
  const createdWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'جلسة نور الآمنة - قراءة فقط',
    backgroundColor: '#ffffff',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      devTools: isDev,
      partition
    }
  });
  noorWindow = createdWindow;

  const isolatedSession = createdWindow.webContents.session;
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  isolatedSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => callback({ cancel: !isAllowedNoorResourceUrl(details.url) })
  );
  isolatedSession.on('will-download', event => event.preventDefault());

  createdWindow.webContents.on('will-navigate', blockUnsafeNoorNavigation);
  createdWindow.webContents.on('will-redirect', blockUnsafeNoorNavigation);
  createdWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) noorNavigationVersion += 1;
  });
  createdWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNoorSessionUrl(url)) {
      void noorWindow?.loadURL(url);
    }
    return { action: 'deny' };
  });

  createdWindow.on('closed', () => {
    if (noorWindow === createdWindow) noorWindow = null;
    noorNavigationVersion += 1;
    void Promise.allSettled([
      isolatedSession.clearStorageData(),
      isolatedSession.clearCache(),
      isolatedSession.clearAuthCache()
    ]);
  });

  try {
    await createdWindow.loadURL(NOOR_LOGIN_URL);
  } catch (error) {
    if (!createdWindow.isDestroyed()) createdWindow.destroy();
    if (noorWindow === createdWindow) noorWindow = null;
    throw error;
  }
  createdWindow.focus();
  return { opened: true };
}

// =============================================================================
// Icon Path Helper
// =============================================================================

function getIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 
                   process.platform === 'darwin' ? 'icon.icns' : 'icon.png';
  
  if (isDev) {
    return path.join(__dirname, '../build', iconName);
  }
  return path.join(process.resourcesPath, iconName);
}

function sanitizeFilters(filters) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return [{ name: 'All Files', extensions: ['*'] }];
  }

  return filters
    .filter(filter => filter && typeof filter === 'object')
    .map(filter => ({
      name: typeof filter.name === 'string' && filter.name.trim() ? filter.name.trim() : 'Files',
      extensions: Array.isArray(filter.extensions) && filter.extensions.length > 0
        ? filter.extensions
          .filter(ext => typeof ext === 'string' && /^[a-zA-Z0-9*]+$/.test(ext))
          .slice(0, 20)
        : ['*']
    }));
}

function normalizeDefaultPath(defaultName) {
  if (typeof defaultName !== 'string' || !defaultName.trim()) {
    return undefined;
  }
  return path.basename(defaultName.trim());
}

function normalizeWritableData(data) {
  if (typeof data === 'string') {
    if (Buffer.byteLength(data, 'utf8') > MAX_IPC_FILE_BYTES) {
      throw new Error('File payload exceeds IPC size limit');
    }
    return data;
  }

  if (Buffer.isBuffer(data)) {
    if (data.byteLength > MAX_IPC_FILE_BYTES) {
      throw new Error('File payload exceeds IPC size limit');
    }
    return data;
  }

  throw new Error('Unsupported file payload type');
}

// =============================================================================
// Application Menu
// =============================================================================

function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // App Menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: 'عن نظام حاضر' },
        { type: 'separator' },
        { role: 'services', label: 'الخدمات' },
        { type: 'separator' },
        { role: 'hide', label: 'إخفاء' },
        { role: 'hideOthers', label: 'إخفاء الآخرين' },
        { role: 'unhide', label: 'إظهار الكل' },
        { type: 'separator' },
        { role: 'quit', label: 'إنهاء' }
      ]
    }] : []),

    // File Menu
    {
      label: 'ملف',
      submenu: [
        {
          label: 'تصدير البيانات',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu-export')
        },
        {
          label: 'استيراد البيانات',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu-import')
        },
        { type: 'separator' },
        {
          label: 'طباعة',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.print()
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'إغلاق' } : { role: 'quit', label: 'خروج' }
      ]
    },

    // Edit Menu
    {
      label: 'تحرير',
      submenu: [
        { role: 'undo', label: 'تراجع' },
        { role: 'redo', label: 'إعادة' },
        { type: 'separator' },
        { role: 'cut', label: 'قص' },
        { role: 'copy', label: 'نسخ' },
        { role: 'paste', label: 'لصق' },
        { role: 'selectAll', label: 'تحديد الكل' }
      ]
    },

    // View Menu
    {
      label: 'عرض',
      submenu: [
        { role: 'reload', label: 'إعادة تحميل' },
        { role: 'forceReload', label: 'إعادة تحميل إجباري' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'إعادة تعيين التكبير' },
        { role: 'zoomIn', label: 'تكبير' },
        { role: 'zoomOut', label: 'تصغير' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'ملء الشاشة' },
        ...(isDev ? [
          { type: 'separator' },
          { role: 'toggleDevTools', label: 'أدوات المطور' }
        ] : [])
      ]
    },

    // Navigation Menu
    {
      label: 'تنقل',
      submenu: [
        {
          label: 'لوحة التحكم',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('navigate', '/dashboard')
        },
        {
          label: 'الكشك',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('navigate', '/kiosk')
        },
        {
          label: 'الإشراف',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('navigate', '/supervision')
        },
        {
          label: 'الإدارة',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow?.webContents.send('navigate', '/admin')
        },
        { type: 'separator' },
        {
          label: 'رجوع',
          accelerator: 'CmdOrCtrl+[',
          click: () => mainWindow?.webContents.goBack()
        },
        {
          label: 'تقدم',
          accelerator: 'CmdOrCtrl+]',
          click: () => mainWindow?.webContents.goForward()
        }
      ]
    },

    // Window Menu
    {
      label: 'نافذة',
      submenu: [
        { role: 'minimize', label: 'تصغير' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: 'إحضار للأمام' }
        ] : [
          { role: 'close', label: 'إغلاق' }
        ])
      ]
    },

    // Help Menu
    {
      label: 'مساعدة',
      submenu: [
        {
          label: 'الدعم الفني',
          click: () => mainWindow?.webContents.send('navigate', '/support')
        },
        {
          label: 'الموقع الرسمي',
          click: () => shell.openExternal('https://hader.sa')
        },
        { type: 'separator' },
        {
          label: 'عن نظام حاضر',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'عن نظام حاضر',
              message: 'نظام حاضر - Hader System',
              detail: `الإصدار: ${app.getVersion()}\n\nنظام متكامل لإدارة حضور الطلاب\n\n© 2024 جميع الحقوق محفوظة`,
              buttons: ['حسناً']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// =============================================================================
// IPC Handlers
// =============================================================================

// Handle file save dialog
ipcMain.handle('save-file', async (event, { defaultName, filters, data } = {}) => {
  const filePayload = normalizeWritableData(data);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: normalizeDefaultPath(defaultName),
    filters: sanitizeFilters(filters)
  });
  
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, filePayload);
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

// Handle file open dialog
ipcMain.handle('open-file', async (event, { filters } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: sanitizeFilters(filters)
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_IPC_FILE_BYTES) {
      throw new Error('Selected file exceeds IPC size limit');
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, path: filePath, content };
  }
  return { success: false };
});

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Get platform
ipcMain.handle('get-platform', () => {
  return process.platform;
});

// Toggle fullscreen
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  }
  return false;
});

// Get dark mode
ipcMain.handle('get-dark-mode', () => {
  return nativeTheme.shouldUseDarkColors;
});

ipcMain.handle('noor-open-session', async event => {
  if (!event.senderFrame || !isTrustedAppUrl(event.senderFrame.url)) {
    throw new Error('مصدر طلب فتح جلسة نور غير موثوق.');
  }
  return openNoorSessionWindow();
});

ipcMain.handle('noor-close-session', event => {
  if (!event.senderFrame || !isTrustedAppUrl(event.senderFrame.url)) {
    throw new Error('مصدر طلب إغلاق جلسة نور غير موثوق.');
  }
  return closeNoorSessionWindow();
});

ipcMain.handle('noor-capture-roster', async (event, requestedPolicy) => {
  const policy = assertSafeCapturePolicy(requestedPolicy);

  if (!noorWindow || noorWindow.isDestroyed()) {
    throw new Error('افتح جلسة نور أولًا، ثم انتقل يدويًا إلى صفحة كشف الطلاب.');
  }

  if (
    event.sender !== mainWindow?.webContents
    || !event.senderFrame
    || !isTrustedAppUrl(event.senderFrame.url)
  ) {
    throw new Error('مصدر طلب الالتقاط غير موثوق.');
  }

  if (noorWindow.webContents.isLoading()) {
    throw new Error('انتظر حتى يكتمل تحميل صفحة نور ثم أعد المحاولة.');
  }

  const currentUrl = noorWindow.webContents.getURL();
  const captureNavigationVersion = noorNavigationVersion;
  if (!isAllowedNoorSessionUrl(currentUrl)) {
    throw new Error('لا يمكن القراءة إلا من نطاقات نور الرسمية المشفرة.');
  }

  const currentHost = new URL(currentUrl).hostname.toLowerCase();
  const currentPath = new URL(currentUrl).pathname.toLowerCase();
  if (
    currentHost !== NOOR_CAPTURE_HOST
    || !policy.allowedHosts.includes(currentHost)
    || /(?:login|signin|account)/.test(currentPath)
  ) {
    throw new Error('انتقل إلى صفحة كشف الطلاب داخل نظام نور قبل الالتقاط.');
  }

  const html = await noorWindow.webContents.executeJavaScript(`(() => {
    const container = document.createElement('main');
    document.querySelectorAll('table').forEach((table) => {
      const clone = table.cloneNode(true);
      clone.querySelectorAll(
        'script,style,link,iframe,object,embed,form,input,button,select,textarea,img,svg'
      ).forEach((element) => element.remove());
      clone.querySelectorAll('*').forEach((element) => {
        [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      });
      container.appendChild(clone);
    });
    return container.outerHTML;
  })()`, true);
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_NOOR_SNAPSHOT_BYTES) {
    throw new Error('حجم صفحة نور أكبر من الحد الآمن للمعالجة.');
  }

  const capturedTitle = noorWindow.webContents.getTitle();
  const capturedUrl = noorWindow.webContents.getURL();
  if (
    noorWindow.webContents.isLoading()
    || captureNavigationVersion !== noorNavigationVersion
    || capturedUrl !== currentUrl
  ) {
    throw new Error('تغيرت صفحة نور أثناء القراءة؛ انتظر اكتمالها ثم أعد الفحص.');
  }

  return {
    url: `${new URL(capturedUrl).origin}${new URL(capturedUrl).pathname}`,
    title: capturedTitle,
    html,
    capturedAt: new Date().toISOString()
  };
});

// =============================================================================
// App Events
// =============================================================================

// This method will be called when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, apps usually stay active until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle certificate errors (for local development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  let isLocalDevelopmentUrl = false;
  try {
    const parsedUrl = new URL(url);
    isLocalDevelopmentUrl = parsedUrl.hostname === 'localhost';
  } catch {
    isLocalDevelopmentUrl = false;
  }

  if (isDev && isLocalDevelopmentUrl) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// =============================================================================
// Security: Prevent new window creation
// =============================================================================

app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      new URL(navigationUrl);
    } catch {
      event.preventDefault();
      return;
    }

    if (isNoorWebContents(contents)) {
      if (!isAllowedNoorSessionUrl(navigationUrl)) {
        event.preventDefault();
      }
      return;
    }

    if (contents === mainWindow?.webContents && isTrustedAppUrl(navigationUrl)) {
      return;
    }

    event.preventDefault();
    if (contents === mainWindow?.webContents) openExternalSafely(navigationUrl);
  });
});
