// =============================================================================
// نظام حاضر (Hader) - Production Logger
// =============================================================================
// Toggle debug logging:  localStorage.setItem('hader:debug', 'true')
// Disable debug logging: localStorage.removeItem('hader:debug')
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: 'color: #6b7280',   // gray
    info: 'color: #06b6d4',    // cyan
    warn: 'color: #f59e0b',    // amber
    error: 'color: #ef4444',   // red
};

const LEVEL_ICONS: Record<LogLevel, string> = {
    debug: '🔍',
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
};

class Logger {
    private minLevel: LogLevel = 'info';
    private modules = new Set<string>();

    constructor() {
        this.loadConfig();
    }

    private loadConfig(): void {
        if (typeof localStorage === 'undefined') return;
        const debugFlag = localStorage.getItem('hader:debug');
        if (debugFlag === 'true' || debugFlag === '*') {
            this.minLevel = 'debug';
        }
        // Module-specific debug: 'hader:debug' = 'Kiosk,Sync'
        if (debugFlag && debugFlag !== 'true' && debugFlag !== '*') {
            this.minLevel = 'debug';
            debugFlag.split(',').forEach(m => this.modules.add(m.trim()));
        }
    }

    private shouldLog(level: LogLevel, module?: string): boolean {
        if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return false;
        if (this.modules.size > 0 && module && level === 'debug') {
            return this.modules.has(module);
        }
        return true;
    }

    private log(level: LogLevel, module: string, message: string, ...args: any[]): void {
        if (!this.shouldLog(level, module)) return;

        const prefix = `${LEVEL_ICONS[level]} [${module}]`;
        const style = LEVEL_COLORS[level];

        switch (level) {
            case 'debug':
                console.log(`%c${prefix} ${message}`, style, ...args);
                break;
            case 'info':
                console.log(`%c${prefix} ${message}`, style, ...args);
                break;
            case 'warn':
                console.warn(`${prefix} ${message}`, ...args);
                break;
            case 'error':
                console.error(`${prefix} ${message}`, ...args);
                break;
        }
    }

    /** Debug logs — only show when hader:debug is enabled */
    debug(module: string, message: string, ...args: any[]): void {
        this.log('debug', module, message, ...args);
    }

    /** Info logs — always show in production */
    info(module: string, message: string, ...args: any[]): void {
        this.log('info', module, message, ...args);
    }

    /** Warning logs — always show */
    warn(module: string, message: string, ...args: any[]): void {
        this.log('warn', module, message, ...args);
    }

    /** Error logs — always show */
    error(module: string, message: string, ...args: any[]): void {
        this.log('error', module, message, ...args);
    }

    /** Reload config (call after changing localStorage) */
    reload(): void {
        this.minLevel = 'info';
        this.modules.clear();
        this.loadConfig();
    }
}

export const logger = new Logger();

// Attach to window for easy access: window.__haderLogger.reload()
if (typeof window !== 'undefined') {
    (window as any).__haderLogger = logger;
}
