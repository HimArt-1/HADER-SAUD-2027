import { describe, expect, it } from 'vitest';
import {
  createInMemorySettingsPort,
  createSettingsModule,
  type SettingsPort
} from '../modules/settings';
import type { SystemSettings } from '../types';

describe('settings module interface', () => {
  it('coalesces concurrent loads and protects its snapshot from caller mutation', async () => {
    const memory = createInMemorySettingsPort({
      school_name: 'مدرسة الاختبار',
      kiosk_settings: { main_title: 'العنوان الأصلي' }
    });
    let loads = 0;
    const port: SettingsPort = {
      ...memory,
      async loadSettings() {
        loads += 1;
        return memory.loadSettings();
      }
    };
    const settings = createSettingsModule(port);

    const [first, second] = await Promise.all([settings.load(), settings.load()]);
    first.school_name = 'تعديل خارجي';
    first.kiosk_settings!.main_title = 'عنوان خارجي';

    expect(second.school_name).toBe('مدرسة الاختبار');
    expect(second.kiosk_settings?.main_title).toBe('العنوان الأصلي');
    expect((await settings.load()).school_name).toBe('مدرسة الاختبار');
    expect(loads).toBe(1);
  });

  it('serializes concurrent patches so independent changes are not lost', async () => {
    const settings = createSettingsModule(createInMemorySettingsPort({
      school_name: 'القديمة',
      grace_period: 5,
      attendance_settings: { mode: 'traditional' }
    }));

    await Promise.all([
      settings.execute({ type: 'patch', changes: { school_name: 'الجديدة' } }),
      settings.execute({
        type: 'patch',
        changes: { grace_period: 12, attendance_settings: { auto_mark_time: '07:00' } }
      })
    ]);

    expect(await settings.load()).toMatchObject({
      school_name: 'الجديدة',
      grace_period: 12,
      attendance_settings: { mode: 'traditional', auto_mark_time: '07:00' }
    });
  });

  it('replaces settings intentionally without retaining unrelated fields', async () => {
    const settings = createSettingsModule(createInMemorySettingsPort({
      school_name: 'القديمة',
      grace_period: 5
    }));

    const saved = await settings.execute({
      type: 'replace',
      settings: { school_name: 'نسخة احتياطية' }
    });

    expect(saved).toEqual({ school_name: 'نسخة احتياطية', kiosk_settings: {} });
    expect((await settings.load()).grace_period).toBeUndefined();
  });

  it('delivers each same-tab update once and stops after unsubscribe', async () => {
    const settings = createSettingsModule(createInMemorySettingsPort({ dark_mode: true }));
    const values: Array<boolean | undefined> = [];
    const unsubscribe = settings.subscribe(next => values.push(next.dark_mode));

    await settings.execute({ type: 'patch', changes: { dark_mode: false } });
    unsubscribe();
    await settings.execute({ type: 'patch', changes: { dark_mode: true } });

    expect(values).toEqual([false]);
  });

  it('adopts updates arriving through the adapter and invalidates derived caches', async () => {
    const memory = createInMemorySettingsPort({ school_name: 'الأولى' });
    let invalidations = 0;
    let appearances = 0;
    const port: SettingsPort = {
      ...memory,
      invalidateCaches() {
        invalidations += 1;
      },
      applyAppearance() {
        appearances += 1;
      }
    };
    const settings = createSettingsModule(port);
    await settings.load();

    await memory.saveSettings({ school_name: 'الثانية', dark_mode: false });

    expect(await settings.load()).toMatchObject({ school_name: 'الثانية', dark_mode: false });
    expect(invalidations).toBe(1);
    expect(appearances).toBe(2);
  });

  it('can refresh from storage when realtime delivery is unavailable', async () => {
    let stored: SystemSettings = { school_name: 'الأولى' };
    const port: SettingsPort = {
      async loadSettings() { return stored; },
      async saveSettings(next) { stored = next; },
      subscribeToUpdates() { return () => undefined; },
      invalidateCaches() {},
      applyAppearance() {}
    };
    const settings = createSettingsModule(port);
    await settings.load();
    stored = { school_name: 'الثانية' };

    expect((await settings.load()).school_name).toBe('الأولى');
    expect((await settings.load({ refresh: true })).school_name).toBe('الثانية');
  });

  it('keeps the previous snapshot when persistence fails', async () => {
    const memory = createInMemorySettingsPort({ school_name: 'المحفوظة' });
    const port: SettingsPort = {
      ...memory,
      async saveSettings() {
        throw new Error('storage unavailable');
      }
    };
    const settings = createSettingsModule(port);
    await settings.load();

    await expect(settings.execute({
      type: 'patch',
      changes: { school_name: 'لن تحفظ' }
    })).rejects.toThrow('storage unavailable');

    expect((await settings.load()).school_name).toBe('المحفوظة');
  });
});
