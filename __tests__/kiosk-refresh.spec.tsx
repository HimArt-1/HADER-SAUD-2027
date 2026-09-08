import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Role } from '../types';

const mocks = vi.hoisted(() => ({ preload: vi.fn(), settings: vi.fn(), settingsListener: vi.fn(), syncListener: vi.fn(), toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('../services/db', () => ({ db: {
  preloadForKiosk: mocks.preload,
  getSyncStatus: () => ({ status: 'online', pending: 0, conflicts: 0, isOnline: true }),
  onSyncStatusChange: (callback: unknown) => { mocks.syncListener(callback); return () => {}; },
  getMode: () => 'cloud'
} }));
vi.mock('../services/settings', () => ({ appSettings: { load: mocks.settings, subscribe: (callback: unknown) => { mocks.settingsListener(callback); return () => {}; } } }));
vi.mock('../services/auth', () => ({ auth: { getSession: () => ({ id: 'admin', role: Role.SITE_ADMIN }) } }));
vi.mock('../services/notifications', () => ({ notificationCenter: { subscribe: () => ({ unsubscribe: () => {} }) } }));
vi.mock('../services/syncService', () => ({ syncService: { on: () => () => {} } }));
vi.mock('../services/kioskPresenceService', () => ({ kioskPresenceService: { startBroadcasting: vi.fn(), stopBroadcasting: vi.fn() } }));
vi.mock('../services/academicCalendarService', async importOriginal => ({ ...await importOriginal<typeof import('../services/academicCalendarService')>(), cacheHolidays: vi.fn() }));
vi.mock('../components/Toast', () => ({ useToast: () => mocks.toast }));
vi.mock('../components/BadgeShowcase', () => ({ default: () => null }));
vi.mock('../utils/barcodeWorker?worker', () => ({ default: class { terminate() {} } }));
import Kiosk from '../pages/Kiosk';

const ready = { ok: true, cloudAvailable: true, usedLocalSnapshot: false, studentCount: 20 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-06T05:00:00Z'));
  vi.clearAllMocks();
  localStorage.clear();
  mocks.preload.mockResolvedValue(ready);
  mocks.settings.mockResolvedValue({ system_ready: true, school_active: true, kiosk_settings: { camera_scan_enabled: false } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openReadyKiosk() {
  await act(async () => { render(<MemoryRouter><Kiosk /></MemoryRouter>); });
  expect(document.getElementById('kiosk-root')).not.toBeNull();
}

describe('kiosk refresh stability', () => {
  it('opens from complete cached settings without waiting for a settings cloud request', async () => {
    mocks.preload.mockResolvedValue({ ...ready, usedLocalSnapshot: true, cloudAvailable: false,
      settings: { system_ready: true, school_active: true } });
    mocks.settings.mockReturnValue(new Promise(() => {}));
    await openReadyKiosk();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('waits for school settings before accepting the first scan', async () => {
    let resolveSettings!: (value: object) => void;
    mocks.settings.mockReturnValue(new Promise(resolve => { resolveSettings = resolve; }));
    await act(async () => { render(<MemoryRouter><Kiosk /></MemoryRouter>); });
    expect(screen.queryByRole('textbox')).toBeNull();
    await act(async () => { resolveSettings({ system_ready: true, school_active: false }); });
    expect(screen.getAllByText('المدرسة متوقفة مؤقتًا').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('blocks first startup when settings fail and recovers on retry', async () => {
    mocks.settings.mockRejectedValue(new Error('settings unavailable'));
    await act(async () => { render(<MemoryRouter><Kiosk /></MemoryRouter>); });
    expect(screen.getByText('تعذر تهيئة وضع الكشك')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    mocks.settings.mockResolvedValue({ system_ready: true, school_active: true });
    await act(async () => { fireEvent.click(screen.getByText('إعادة المحاولة')); });
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('keeps the ready scanner mounted while refreshing after focus returns', async () => {
    await openReadyKiosk();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'partial-barcode' } });
    mocks.preload.mockReturnValue(new Promise(() => {}));
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(350); });
    expect(mocks.preload).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('جاري تهيئة وضع الكشك...')).toBeNull();
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveProperty('value', 'partial-barcode');
  });

  it('coalesces focus, visibility and reconnect events while a refresh is pending', async () => {
    await openReadyKiosk();
    mocks.preload.mockReturnValue(new Promise(() => {}));
    for (const event of ['focus', 'online', 'visibilitychange']) {
      await act(async () => {
        (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
        await vi.advanceTimersByTimeAsync(350);
      });
    }
    expect(mocks.preload).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('جاري تهيئة وضع الكشك...')).toBeNull();
  });

  it.each(['returned', 'thrown'])('keeps a working kiosk available after a %s refresh failure', async failure => {
    await openReadyKiosk();
    const input = screen.getByRole('textbox');
    if (failure === 'returned') mocks.preload.mockResolvedValue({ ...ready, ok: false, message: 'network unavailable' });
    else mocks.preload.mockRejectedValue(new Error('network unavailable'));
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(350); });
    expect(screen.getByRole('textbox')).toBe(input);
    expect(screen.queryByText('تعذر تهيئة وضع الكشك')).toBeNull();
    expect(screen.getByText(/تعذر تحديث بيانات الكشك/)).toBeTruthy();
  });

  it('still blocks a first startup without usable data and allows retry', async () => {
    mocks.preload.mockResolvedValue({ ...ready, ok: false, message: 'لا توجد نسخة محلية' });
    await act(async () => { render(<MemoryRouter><Kiosk /></MemoryRouter>); });
    expect(screen.getByText('تعذر تهيئة وضع الكشك')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    mocks.preload.mockResolvedValue(ready);
    await act(async () => { fireEvent.click(screen.getByText('إعادة المحاولة')); });
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('does not preload on ordinary settings, clock or sync-state updates', async () => {
    await openReadyKiosk();
    await act(async () => {
      mocks.settingsListener.mock.calls[0][0]({ system_ready: true, school_active: true });
      mocks.syncListener.mock.calls[0][0]({ status: 'offline', pending: 0, conflicts: 0, isOnline: false });
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(mocks.preload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('جاري تهيئة وضع الكشك...')).toBeNull();
  });
});
