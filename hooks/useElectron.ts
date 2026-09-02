// =============================================================================
// نظام حاضر (Hader) - Electron Integration Hook
// =============================================================================

import { useState, useEffect, useCallback } from 'react';

/**
 * Check if running in Electron environment
 */
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && 
         window.electronAPI !== undefined && 
         window.electronAPI.isElectron === true;
};

/**
 * Platform type
 */
export type Platform = 'darwin' | 'win32' | 'linux' | 'web';

/**
 * Electron state interface
 */
interface ElectronState {
  isElectron: boolean;
  platform: Platform;
  version: string;
  isDarkMode: boolean;
  isFullscreen: boolean;
}

/**
 * Hook for Electron integration
 * Provides access to Electron APIs and state
 */
export function useElectron() {
  const [state, setState] = useState<ElectronState>({
    isElectron: false,
    platform: 'web',
    version: '',
    isDarkMode: true,
    isFullscreen: false
  });

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      if (!isElectron()) {
        return;
      }

      try {
        const [platform, version, isDarkMode] = await Promise.all([
          window.electronAPI!.getPlatform(),
          window.electronAPI!.getAppVersion(),
          window.electronAPI!.getDarkMode()
        ]);

        setState({
          isElectron: true,
          platform: platform as Platform,
          version,
          isDarkMode,
          isFullscreen: false
        });
      } catch (error) {
        console.error('Failed to initialize Electron state:', error);
      }
    };

    void init();
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!isElectron()) return false;
    
    try {
      const isFullscreen = await window.electronAPI!.toggleFullscreen();
      setState(prev => ({ ...prev, isFullscreen }));
      return isFullscreen;
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error);
      return false;
    }
  }, []);

  // Save file using native dialog
  const saveFile = useCallback(async (
    data: string,
    defaultName: string,
    filters?: { name: string; extensions: string[] }[]
  ) => {
    if (!isElectron()) {
      // Fallback to browser download
      const blob = new Blob([data], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      return { success: true, path: defaultName };
    }

    try {
      return await window.electronAPI!.saveFile({
        data,
        defaultName,
        filters
      });
    } catch (error) {
      console.error('Failed to save file:', error);
      return { success: false };
    }
  }, []);

  // Open file using native dialog
  const openFile = useCallback(async (
    filters?: { name: string; extensions: string[] }[]
  ) => {
    if (!isElectron()) {
      // Fallback to browser file input
      return new Promise<{ success: boolean; path?: string; content?: string }>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (filters && filters.length > 0) {
          input.accept = filters.flatMap(f => f.extensions.map(e => `.${e}`)).join(',');
        }
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            const content = await file.text();
            resolve({ success: true, path: file.name, content });
          } else {
            resolve({ success: false });
          }
        };
        input.click();
      });
    }

    try {
      return await window.electronAPI!.openFile({ filters });
    } catch (error) {
      console.error('Failed to open file:', error);
      return { success: false };
    }
  }, []);

  // Show native notification
  const showNotification = useCallback((title: string, body: string) => {
    if (isElectron()) {
      window.electronAPI!.showNotification(title, body);
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }, []);

  // Request notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (isElectron()) {
      return await window.electronAPI!.requestNotificationPermission();
    } else if ('Notification' in window) {
      return await Notification.requestPermission();
    }
    return 'denied' as NotificationPermission;
  }, []);

  return {
    ...state,
    toggleFullscreen,
    saveFile,
    openFile,
    showNotification,
    requestNotificationPermission
  };
}

/**
 * Hook for handling Electron menu events
 */
export function useElectronMenu(handlers: {
  onExport?: () => void;
  onImport?: () => void;
  onNavigate?: (path: string) => void;
}) {
  useEffect(() => {
    if (!isElectron()) return;

    const cleanups: (() => void)[] = [];

    if (handlers.onExport) {
      cleanups.push(window.electronAPI!.onMenuExport(handlers.onExport));
    }

    if (handlers.onImport) {
      cleanups.push(window.electronAPI!.onMenuImport(handlers.onImport));
    }

    if (handlers.onNavigate) {
      cleanups.push(window.electronAPI!.onNavigate(handlers.onNavigate));
    }

    return () => {
      cleanups.forEach(cleanup => cleanup());
    };
  }, [handlers.onExport, handlers.onImport, handlers.onNavigate]);
}

export default useElectron;
