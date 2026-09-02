// =============================================================================
// نظام حاضر (Hader) - Electron API Type Declarations
// =============================================================================

export interface ElectronAPI {
  // App Information
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  getDarkMode: () => Promise<boolean>;
  isElectron: boolean;
  
  // Window Control
  toggleFullscreen: () => Promise<boolean>;

  // Noor read-only desktop session
  openNoorSession: () => Promise<{ opened: boolean }>;
  closeNoorSession: () => Promise<{ closed: boolean }>;
  captureNoorRosterPage: (policy: {
    allowedHosts: string[];
    visibleBrowser: true;
    credentialEntry: 'manual-only';
    challengeHandling: 'manual-only';
  }) => Promise<{
    url: string;
    title: string;
    html: string;
    capturedAt: string;
  }>;
  
  // File Operations
  saveFile: (options: {
    defaultName: string;
    filters?: { name: string; extensions: string[] }[];
    data: string | Buffer;
  }) => Promise<{ success: boolean; path?: string }>;
  
  openFile: (options: {
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ success: boolean; path?: string; content?: string }>;
  
  // Menu Events
  onMenuExport: (callback: () => void) => () => void;
  onMenuImport: (callback: () => void) => () => void;
  onNavigate: (callback: (path: string) => void) => () => void;
  
  // Notifications
  showNotification: (title: string, body: string, options?: NotificationOptions) => Notification | null;
  requestNotificationPermission: () => Promise<NotificationPermission>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
  
  const __IS_ELECTRON__: boolean;
}

export {};
