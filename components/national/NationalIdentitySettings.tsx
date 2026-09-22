import React from 'react';
import type { KioskSettings } from '../../types';
import { NationalBanner } from './NationalIdentity';

export default function NationalIdentitySettings({ settings, onChange }: {
  settings: KioskSettings;
  onChange: React.Dispatch<React.SetStateAction<KioskSettings>>;
}) {
  const identity = settings.national_identity ?? {};
  const toggle = (key: 'enabled' | 'app_enabled' | 'reduced_motion', value: boolean) => {
    onChange(current => ({ ...current, national_identity: { ...current.national_identity, [key]: value } }));
  };
  return (
    <section className="national-settings" aria-labelledby="national-settings-title">
      <div className="national-settings__heading">
        <span className="national-eyebrow">هوية موسمية</span>
        <h3 id="national-settings-title">لمسة وطنية، في كل حضور</h3>
        <p>اختر أين تظهر هوية اليوم الوطني، ثم احفظ إعدادات الكشك لتطبيقها.</p>
      </div>
      <div className="national-settings__grid">
        <div className="national-settings__options">
          {([
            ['enabled', 'تفعيل هوية اليوم الوطني في الكشك', 'تصميم وطني لشاشة الحضور والانتظار.'],
            ['app_enabled', 'لمسات وطنية لبقية الواجهات وتسجيل الدخول', 'بنر هادئ في صفحات النظام وصفحة الدخول.'],
            ['reduced_motion', 'حركة هادئة', 'عرض الزخارف الوطنية بثبات، مناسب للأجهزة الأقل قدرة.'],
          ] as const).map(([key, label, hint]) => (
            <label key={key} className="national-setting">
              <span><strong>{label}</strong><small>{hint}</small></span>
              <input type="checkbox" role="switch" checked={identity[key] === true} onChange={event => toggle(key, event.target.checked)} />
            </label>
          ))}
          <p className="national-settings__note">عند إلغاء التفعيل يعود المظهر السابق. مواعيد الحضور والتقويم لا تتغير.</p>
        </div>
        <div className="national-settings__preview"><span>معاينة الهوية</span><NationalBanner variant="hero" quiet={identity.reduced_motion} /></div>
      </div>
    </section>
  );
}
