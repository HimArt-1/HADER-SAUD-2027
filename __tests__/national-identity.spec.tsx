import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KioskSettings } from '../types';

vi.mock('../services/settings', async () => {
  const { createSettingsModule, createInMemorySettingsPort } = await import('../modules/settings');
  return { appSettings: createSettingsModule(createInMemorySettingsPort()) };
});
import { appSettings } from '../services/settings';
import { AppNationalBanner, NationalIdentityProvider } from '../components/national/NationalIdentity';
import NationalIdentitySettings from '../components/national/NationalIdentitySettings';

beforeEach(async () => { await appSettings.execute({ type: 'replace', settings: {} }); });
afterEach(cleanup);

function SettingsScreen() {
  const [settings, setSettings] = useState<KioskSettings>({ theme: 'light-clean', assembly_time: '07:15', camera_scan_enabled: true });
  return <>
    <NationalIdentitySettings settings={settings} onChange={setSettings} />
    <button onClick={() => void appSettings.execute({ type: 'patch', changes: { kiosk_settings: settings } })}>حفظ الإعدادات</button>
  </>;
}

describe('national identity settings integration', () => {
  it('applies only saved choices, preserves operational settings and restores the previous appearance on disable', async () => {
    render(<NationalIdentityProvider><SettingsScreen /><div data-testid="app-banner"><AppNationalBanner /></div></NationalIdentityProvider>);
    const appBanner = screen.getByTestId('app-banner');
    expect(appBanner.children.length).toBe(0);
    fireEvent.click(screen.getByRole('switch', { name: /لمسات وطنية لبقية/ }));
    expect(appBanner.children.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الإعدادات' }));
    await waitFor(() => expect(appBanner.children.length).toBe(1));
    const saved = await appSettings.load();
    expect(saved.kiosk_settings).toMatchObject({ theme: 'light-clean', assembly_time: '07:15', camera_scan_enabled: true, national_identity: { app_enabled: true } });
    expect(saved.kiosk_settings?.national_identity?.enabled).toBeUndefined();
    fireEvent.click(screen.getByRole('switch', { name: /لمسات وطنية لبقية/ }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الإعدادات' }));
    await waitFor(() => expect(appBanner.children.length).toBe(0));
  });

  it('loads saved identity on login and receives settings updates while mounted', async () => {
    await appSettings.execute({ type: 'patch', changes: { kiosk_settings: { national_identity: { app_enabled: true, reduced_motion: true } } } });
    render(<NationalIdentityProvider><AppNationalBanner variant="login" /></NationalIdentityProvider>);
    await waitFor(() => expect(screen.getByRole('region', { name: 'هوية اليوم الوطني' }).getAttribute('data-quiet')).toBe('true'));
    await act(async () => { await appSettings.execute({ type: 'patch', changes: { kiosk_settings: { national_identity: { app_enabled: false } } } }); });
    expect(screen.queryByRole('region', { name: 'هوية اليوم الوطني' })).toBeNull();
  });
});
