import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Role } from '../types';

const mocks = vi.hoisted(() => ({ workers: [] as any[], preload: vi.fn(), find: vi.fn(), mark: vi.fn(), settings: vi.fn(), settingsListener: vi.fn(), syncListener: vi.fn(), toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('../services/db', () => ({ db: {
  preloadForKiosk: mocks.preload, getStudentByAnyId: mocks.find, markAttendanceFast: mocks.mark,
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
vi.mock('../utils/barcodeWorker?worker', () => ({ default: class { onmessage: any; constructor() { mocks.workers.push(this); } postMessage() {} terminate() {} } }));
import Kiosk from '../pages/Kiosk';

const ready = { ok: true, cloudAvailable: true, usedLocalSnapshot: false, studentCount: 20 };
const student = (id: string) => ({ id, name: `طالب ${id}`, class_name: 'الأول', section: 'أ', is_active: true });
const camera = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-06T05:00:00Z'));
  vi.clearAllMocks();
  localStorage.clear();
  camera.mockReset();
  mocks.workers.length = 0;
  mocks.preload.mockResolvedValue(ready);
  mocks.settings.mockResolvedValue({ system_ready: true, school_active: true, kiosk_settings: { camera_scan_enabled: true } });
  mocks.find.mockImplementation(async id => student(id));
  mocks.mark.mockImplementation(async id => ({ ok: true, code: 'ok', status: 'present', student: student(id), message: `سُجل ${id}` }));
  vi.stubGlobal('BarcodeDetector', class {});
  vi.stubGlobal('Audio', class { play() { return Promise.resolve(); } });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: camera } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function openKiosk() {
  await act(async () => { render(<MemoryRouter><Kiosk /></MemoryRouter>); });
}
async function scan(code: string) {
  const input = screen.getByRole('textbox');
  await act(async () => {
    fireEvent.change(input, { target: { value: code } });
  });
  await act(async () => { fireEvent.submit(input.closest('form')!); });
}
async function openCamera() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'مسح بالكاميرا', exact: true })); });
}

describe('kiosk scan lifecycle', () => {
  it.each([false, 0])('rejects an inactive student (%s) before attendance is written', async isActive => {
    mocks.find.mockResolvedValue({ ...student('S1'), is_active: isActive });
    await openKiosk();
    await scan('S1');
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(screen.getByText(/الطالب غير مفعّل/)).toBeTruthy();
  });

  it('keeps the newest attendance result visible for its own full duration', async () => {
    await openKiosk();
    await scan('s1');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await scan('s2');
    expect(screen.getByText('سُجل S2')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(screen.getByText('سُجل S2')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByText('سُجل S2')).toBeNull();
  });

  it('stops a late camera stream when the dialog closed before permission resolved', async () => {
    let resolveCamera!: (stream: MediaStream) => void;
    camera.mockReturnValue(new Promise(resolve => { resolveCamera = resolve; }));
    await openKiosk();
    await openCamera();
    const closeButton = screen.getByRole('button', { name: 'إغلاق الكاميرا' });
    await act(async () => { fireEvent.click(closeButton); });
    const stop = vi.fn();
    await act(async () => { resolveCamera({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('video')).toBeNull();
  });

  it('does not request camera permission twice after permission is denied', async () => {
    camera.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await openKiosk();
    await openCamera();
    expect(camera).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/تعذر تشغيل الكاميرا/)).toBeTruthy();
  });

  it('does not report camera scanning ready until the detector has initialized', async () => {
    camera.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    await openKiosk();
    await openCamera();
    expect(screen.queryByText('جاهز للمسح')).toBeNull();
    await act(async () => { mocks.workers[0].onmessage({ data: { type: 'INIT_SUCCESS' } }); });
    expect(screen.getByText('جاهز للمسح')).toBeTruthy();
  });

  it('serializes a camera scan and a gun submission arriving in the same render', async () => {
    camera.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    let resolveStudent!: (value: object) => void;
    mocks.find.mockImplementation(() => new Promise(resolve => { resolveStudent = resolve; }));
    await openKiosk();
    const input = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(input, { target: { value: 'S1' } }); });
    await openCamera();
    await act(async () => {
      mocks.workers[0].onmessage({ data: { type: 'INIT_SUCCESS' } });
      mocks.workers[0].onmessage({ data: { type: 'DETECT_SUCCESS', barcodes: ['S1'] } });
      fireEvent.submit(input.closest('form')!);
    });
    expect(mocks.find).toHaveBeenCalledTimes(1);
    await act(async () => { resolveStudent(student('S1')); });
    expect(mocks.mark).toHaveBeenCalledTimes(1);
  });

  it('releases the camera and shows an error if both detectors fail to initialize', async () => {
    const stop = vi.fn();
    camera.mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('BarcodeDetector', class { constructor() { throw new Error('unsupported formats'); } });
    await openKiosk();
    await openCamera();
    await act(async () => { mocks.workers[0].onmessage({ data: { type: 'INIT_ERROR' } }); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/تعذر تهيئة قارئ الباركود/)).toBeTruthy();
    expect(screen.queryByText('جاهز للمسح')).toBeNull();
  });

  it('uses the main detector when the worker cannot load', async () => {
    camera.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    await openKiosk();
    await openCamera();
    await act(async () => { mocks.workers[0].onerror({ preventDefault: vi.fn() }); });
    expect(screen.getByText('جاهز للمسح')).toBeTruthy();
  });

  it('still falls back to the available camera when an exact rear camera is absent', async () => {
    const stop = vi.fn();
    camera.mockRejectedValueOnce(new DOMException('no rear camera', 'OverconstrainedError'));
    camera.mockResolvedValueOnce({ getTracks: () => [{ stop }] });
    await openKiosk();
    await openCamera();
    expect(camera).toHaveBeenCalledTimes(2);
    expect(document.querySelector('video')?.srcObject).toBeTruthy();
    await act(async () => { cleanup(); });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
