/** Run against an isolated Vite server with empty Supabase env vars and VITE_APP_MODE=local.
 * Example: node scripts/verify-kiosk-layout.mjs http://127.0.0.1:5199
 * Uses a disposable browser profile and synthetic data only.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:5199';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Only run against an isolated local server');
const output = new URL('../output/kiosk-layout/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
    ? route.continue() : route.abort());
  await page.goto(`${base}/#/login`);
  await page.getByLabel('اسم المستخدم', { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { db } = await import('/services/db.ts');
    if (db.getMode() !== 'local') throw new Error('This check requires a local-only server');
    const { appSettings } = await import('/services/settings.ts');
    await appSettings.execute({ type: 'replace', settings: {
      system_ready: true, school_active: true, school_name: 'مدرسة الطموح', dark_mode: true,
      assembly_time: '09:00', absence_time: '23:59',
      attendance_settings: { work_days: [0, 1, 2, 3, 4, 5, 6], academic_holidays: [] },
      kiosk_settings: { main_title: 'تسجيل الحضور', school_name: 'مدرسة الطموح', assembly_time: '09:00', absence_time: '23:59' }
    } });
    localStorage.setItem('hader:students', JSON.stringify([{ id: 'LAYOUT001', name: 'طالب تجريبي', class_name: 'الأول', section: 'أ', is_active: true }]));
    const { auth } = await import('/services/auth.ts');
    const user = { id: 'layout-preview', username: 'preview', name: 'معاينة', role: 'site_admin', is_active: true };
    localStorage.setItem('hader:users', JSON.stringify([user]));
    auth.setSession(user);
  });
  await page.goto(`${base}/#/kiosk`);
  await page.locator('#kiosk-root').waitFor();
  await page.getByText('إظهار حقل الإدخال', { exact: true }).click();
  await page.getByTitle('إخفاء لوحة التحكم', { exact: true }).click();
  let count = 0;
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 768, height: 1366 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const appearance of [{ key: 'standard', theme: 'dark-neon', national: false }, { key: 'light', theme: 'light-clean', national: false }, { key: 'national', theme: 'dark-neon', national: true }]) {
      await page.evaluate(async ({ theme, national: enabled }) => {
        const { appSettings } = await import('/services/settings.ts');
        await appSettings.execute({ type: 'patch', changes: { kiosk_settings: {
          theme, national_identity: { enabled, reduced_motion: true }
        } } });
      }, appearance);
      for (const [rotation, title] of [['none', 'وضع عادي'], ['right', 'تدوير يمين (90°)'], ['left', 'تدوير يسار (-90°)']]) {
        await page.getByTitle('إظهار لوحة التحكم', { exact: true }).click();
        await page.getByTitle(title, { exact: true }).click();
        await page.getByTitle('إخفاء لوحة التحكم', { exact: true }).click();
        await page.waitForTimeout(350); // Wait for the existing rotation transition.
        const geometry = await page.evaluate(() => {
          const root = document.querySelector('#kiosk-root');
          const scroll = document.querySelector('.kiosk-scroll');
          const cards = [...document.querySelectorAll('.kiosk-status-card')];
          const clock = document.querySelector('.kiosk-clock');
          const input = document.querySelector('.kiosk-input');
          const time = document.querySelector('.kiosk-time');
          const rect = root.getBoundingClientRect();
          return {
            root: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            viewport: { width: innerWidth, height: innerHeight },
            overflow: scroll.scrollWidth - scroll.clientWidth,
            cards: cards.map(card => ({ top: card.offsetTop, height: card.offsetHeight, width: card.offsetWidth, left: card.offsetLeft })),
            clockWidth: clock.offsetWidth, inputWidth: input.offsetWidth,
            primaryBottom: input.offsetTop + input.offsetHeight + parseFloat(getComputedStyle(scroll).paddingTop),
            logicalHeight: scroll.clientHeight,
            timeFits: time.offsetWidth <= clock.clientWidth - 32,
            canScroll: scroll.scrollHeight <= scroll.clientHeight || getComputedStyle(scroll).overflowY === 'auto'
          };
        });
        const label = `${viewport.width}x${viewport.height}-${appearance.key}-${rotation}`;
        assert.ok(Math.abs(geometry.root.x) < 2 && Math.abs(geometry.root.y) < 2, `${label}: root origin`);
        assert.ok(Math.abs(geometry.root.width - viewport.width) < 2 && Math.abs(geometry.root.height - viewport.height) < 2, `${label}: rotated viewport bounds`);
        assert.ok(geometry.overflow <= 1, `${label}: horizontal overflow`);
        assert.ok(geometry.timeFits, `${label}: clock clipped`);
        if (viewport.width >= 768 && geometry.logicalHeight >= 768) assert.ok(geometry.primaryBottom <= geometry.logicalHeight, `${label}: scanner is below the initial screen`);
        assert.ok(geometry.canScroll, `${label}: content cannot be reached`);
        assert.equal(geometry.cards.length, 4);
        for (let i = 0; i < geometry.cards.length; i++) {
          const card = geometry.cards[i];
          assert.ok(Math.abs(card.width - geometry.clockWidth) <= 1 && Math.abs(card.width - geometry.inputWidth) <= 1, `${label}: inconsistent card widths`);
          if (i) assert.ok(card.top >= geometry.cards[i - 1].top + geometry.cards[i - 1].height + 8, `${label}: cards overlap or are not stacked`);
        }
        await page.locator('.kiosk-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
        const last = await page.locator('.kiosk-status-card').last().boundingBox();
        assert.ok(last.x >= -1 && last.y >= -1 && last.x + last.width <= viewport.width + 1 && last.y + last.height <= viewport.height + 1, `${label}: last card unreachable`);
        await page.locator('.kiosk-scroll').evaluate(el => { el.scrollTop = 0; });
        if (viewport.width === 1366 || viewport.width === 768) await page.screenshot({ path: `${output}${label}.png` });
        count++;
        console.log(`PASS ${label}`);
      }
    }
  }
  // A saved narrow width must resize the whole stack without clipping the large clock.
  await page.setViewportSize({ width: 768, height: 1366 });
  await page.evaluate(() => {
    localStorage.setItem('hader:kiosk:rotation', 'none');
    localStorage.setItem('hader:kiosk:card-size', JSON.stringify({ width: 60, height: 0 }));
  });
  await page.evaluate(() => { location.hash = '/admin'; });
  await page.locator('#kiosk-root').waitFor({ state: 'detached' });
  await page.evaluate(() => { location.hash = '/kiosk'; });
  await page.locator('#kiosk-root').waitFor();
  const narrowFits = await page.locator('.kiosk-time').evaluate(time =>
    time.offsetWidth <= document.querySelector('.kiosk-clock').clientWidth - 32);
  assert.ok(narrowFits, 'Saved card width clips the clock');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`Verified ${count} layouts with no clipped clock, horizontal overflow, overlapping cards or browser errors.`);
} finally {
  await browser.close();
}
