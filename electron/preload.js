// =============================================================================
// نظام حاضر (Hader) - Electron Preload Script
// =============================================================================
// This script runs in the renderer process before the web page loads
// It exposes safe APIs to the renderer process

const { contextBridge, ipcRenderer } = require('electron');

// =============================================================================
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// =============================================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // ==========================================================================
  // App Information
  // ==========================================================================
  
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getDarkMode: () => ipcRenderer.invoke('get-dark-mode'),
  
  // Check if running in Electron
  isElectron: true,
  
  // ==========================================================================
  // Window Control
  // ==========================================================================
  
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  
  // ==========================================================================
  // File Operations
  // ==========================================================================
  
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  openFile: (options) => ipcRenderer.invoke('open-file', options),

  // Noor stays in a separate visible browser window. Credentials and
  // verification challenges are always completed manually by the user.
  openNoorSession: () => ipcRenderer.invoke('noor-open-session'),
  closeNoorSession: () => ipcRenderer.invoke('noor-close-session'),
  captureNoorRosterPage: (policy) => ipcRenderer.invoke('noor-capture-roster', policy),
  
  // ==========================================================================
  // Menu Events (from main process)
  // ==========================================================================
  
  onMenuExport: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu-export', listener);
    return () => ipcRenderer.removeListener('menu-export', listener);
  },
  
  onMenuImport: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu-import', listener);
    return () => ipcRenderer.removeListener('menu-import', listener);
  },
  
  onNavigate: (callback) => {
    const listener = (event, path) => callback(path);
    ipcRenderer.on('navigate', listener);
    return () => ipcRenderer.removeListener('navigate', listener);
  },
  
  // ==========================================================================
  // Notifications (Native OS notifications)
  // ==========================================================================
  
  showNotification: (title, body, options = {}) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      return new Notification(title, { body, ...options });
    }
    return null;
  },
  
  requestNotificationPermission: async () => {
    if ('Notification' in window) {
      return await Notification.requestPermission();
    }
    return 'denied';
  }
});

// =============================================================================
// Console banner for Electron
// =============================================================================

console.log('%c🖥️ نظام حاضر - نسخة سطح المكتب', 'color: #8b5cf6; font-size: 16px; font-weight: bold;');
console.log('%c   Hader Desktop Application', 'color: #6366f1; font-size: 12px;');
