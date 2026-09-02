// =============================================================================
// نظام حاضر (Hader) - Desktop App Info Component
// =============================================================================

import React from 'react';
import { Monitor, Apple, Laptop, Globe, Maximize2, Minimize2 } from 'lucide-react';
import { useElectron, isElectron } from '../hooks/useElectron';

/**
 * Component that displays desktop app information
 * Only visible when running in Electron
 */
export const DesktopAppInfo: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { platform, version, isFullscreen, toggleFullscreen } = useElectron();

  if (!isElectron()) {
    return null;
  }

  const getPlatformIcon = () => {
    switch (platform) {
      case 'darwin':
        return <Apple className="w-4 h-4" />;
      case 'win32':
        return <Laptop className="w-4 h-4" />;
      case 'linux':
        return <Monitor className="w-4 h-4" />;
      default:
        return <Globe className="w-4 h-4" />;
    }
  };

  const getPlatformName = () => {
    switch (platform) {
      case 'darwin':
        return 'macOS';
      case 'win32':
        return 'Windows';
      case 'linux':
        return 'Linux';
      default:
        return 'سطح المكتب';
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/50">
        {getPlatformIcon()}
        <span>v{version}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
      <div className="flex items-center gap-2 text-white/70">
        {getPlatformIcon()}
        <span className="text-sm">{getPlatformName()}</span>
      </div>
      
      <div className="w-px h-4 bg-white/20" />
      
      <span className="text-xs text-white/50">v{version}</span>
      
      <button
        onClick={toggleFullscreen}
        className="p-1.5 rounded-md hover:bg-white/10 text-white/50 hover:text-white transition-colors"
        title={isFullscreen ? 'خروج من ملء الشاشة' : 'ملء الشاشة'}
      >
        {isFullscreen ? (
          <Minimize2 className="w-4 h-4" />
        ) : (
          <Maximize2 className="w-4 h-4" />
        )}
      </button>
    </div>
  );
};

/**
 * Badge showing desktop mode
 */
export const DesktopBadge: React.FC = () => {
  if (!isElectron()) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-500/20 text-secondary-300 border border-secondary-500/30">
      <Monitor className="w-3 h-3" />
      سطح المكتب
    </span>
  );
};

export default DesktopAppInfo;
