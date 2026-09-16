import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getKioskLaunchPreferences,
  saveKioskLaunchPreferences,
  clearKioskAutoLaunch,
  buildKioskUrl,
  executeKioskLaunch,
  KIOSK_STORAGE_KEYS,
} from '../utils/kioskLaunchHelper';

describe('kioskLaunchHelper', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('retrieves default preferences when localStorage is empty', () => {
    const prefs = getKioskLaunchPreferences();
    expect(prefs.target).toBe('same_window');
    expect(prefs.rotation).toBe('none');
    expect(prefs.autoLaunch).toBe(false);
  });

  it('saves and restores custom preferences correctly', () => {
    saveKioskLaunchPreferences({
      target: 'external',
      rotation: 'right',
      autoLaunch: true,
    });

    const prefs = getKioskLaunchPreferences();
    expect(prefs.target).toBe('external');
    expect(prefs.rotation).toBe('right');
    expect(prefs.autoLaunch).toBe(true);
  });

  it('clears autoLaunch preference without resetting target or rotation', () => {
    saveKioskLaunchPreferences({
      target: 'new_tab',
      rotation: 'left',
      autoLaunch: true,
    });

    clearKioskAutoLaunch();

    const prefs = getKioskLaunchPreferences();
    expect(prefs.target).toBe('new_tab');
    expect(prefs.rotation).toBe('left');
    expect(prefs.autoLaunch).toBe(false);
  });

  it('builds kiosk url with rotation parameter when rotation is not none', () => {
    expect(buildKioskUrl('none')).toBe('/kiosk');
    expect(buildKioskUrl('right')).toBe('/kiosk?rotate=right');
    expect(buildKioskUrl('left')).toBe('/kiosk?rotate=left');
  });

  it('executes same_window launch via navigate', async () => {
    const navigate = vi.fn();
    await executeKioskLaunch(
      {
        target: 'same_window',
        rotation: 'none',
        autoLaunch: false,
      },
      navigate
    );

    expect(navigate).toHaveBeenCalledWith('/kiosk');
    expect(localStorage.getItem(KIOSK_STORAGE_KEYS.LAUNCH_TARGET)).toBe('same_window');
  });

  it('executes new_tab launch via window.open', async () => {
    const navigate = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => ({
      focus: vi.fn(),
    } as any));

    await executeKioskLaunch(
      {
        target: 'new_tab',
        rotation: 'right',
        autoLaunch: true,
      },
      navigate
    );

    expect(openSpy).toHaveBeenCalledWith('/kiosk?rotate=right', '_blank');
    expect(localStorage.getItem(KIOSK_STORAGE_KEYS.LAUNCH_AUTO)).toBe('true');
    expect(localStorage.getItem(KIOSK_STORAGE_KEYS.ROTATION)).toBe('right');
  });

  it('executes external screen launch with popup window options', async () => {
    const navigate = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => ({
      focus: vi.fn(),
    } as any));

    await executeKioskLaunch(
      {
        target: 'external',
        rotation: 'left',
        autoLaunch: false,
      },
      navigate
    );

    expect(openSpy).toHaveBeenCalled();
    const callArgs = openSpy.mock.calls[0];
    expect(callArgs[0]).toBe('/kiosk?rotate=left');
    expect(callArgs[1]).toBe('hader_kiosk_external_screen');
  });
});
