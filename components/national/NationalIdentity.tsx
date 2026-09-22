import React, { createContext, useContext, useEffect, useState } from 'react';
import type { KioskSettings } from '../../types';
import heritageUrl from '../../assets/national/heritage.png';
import growthUrl from '../../assets/national/growth.png';
import './national-identity.css';

type IdentitySettings = NonNullable<KioskSettings['national_identity']>;
const IdentityContext = createContext<IdentitySettings>({});

/** Presentation only: uses the existing settings channel, without changing attendance or themes. */
export function NationalIdentityProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<IdentitySettings>({});
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void import('../../services/settings').then(async ({ appSettings }) => {
      if (!active) return;
      const adopt = (settings: { kiosk_settings?: KioskSettings }) => {
        if (active) setIdentity(settings.kiosk_settings?.national_identity ?? {});
      };
      unsubscribe = appSettings.subscribe(adopt);
      adopt(await appSettings.load());
    }).catch(() => { /* Optional decoration must never block entry to the app. */ });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}

export function useNationalIdentity() { return useContext(IdentityContext); }

export function NationalArtwork({ quiet = false }: { quiet?: boolean }) {
  return (
    <div className="national-artwork" data-quiet={quiet} aria-hidden="true">
      <img src={heritageUrl} alt="" className="national-artwork__heritage" />
      <img src={growthUrl} alt="" className="national-artwork__growth" />
    </div>
  );
}

export function NationalBanner({ variant = 'compact', quiet = false }: {
  variant?: 'compact' | 'hero' | 'login'; quiet?: boolean;
}) {
  return (
    <section className={`national-banner national-banner--${variant}`} data-quiet={quiet} dir="rtl" aria-label="هوية اليوم الوطني">
      <div className="national-banner__copy">
        <span className="national-eyebrow"><span aria-hidden="true" /> اليوم الوطني السعودي</span>
        <h2>{variant === 'compact' ? 'بهمّتنا نبني، وبوطننا نعتزّ.' : <>بهمّتنا<span>نصنع الغد.</span></>}</h2>
        {variant !== 'compact' && <p>من مقاعد العلم، تبدأ حكايات الطموح.</p>}
        <div className="national-values" aria-hidden="true"><span>برؤيتنا</span><i /><span>بأصالتنا</span><i /><span>بكرمنا</span></div>
      </div>
      <NationalArtwork quiet={quiet} />
    </section>
  );
}

export function AppNationalBanner({ variant = 'compact' }: { variant?: 'compact' | 'login' }) {
  const identity = useNationalIdentity();
  return identity.app_enabled ? <NationalBanner variant={variant} quiet={identity.reduced_motion} /> : null;
}

/** Thin, non-interactive trim also reaches full-screen routes outside Layout. */
export function NationalAppTrim() {
  const identity = useNationalIdentity();
  return identity.app_enabled ? <div className="national-app-trim" aria-hidden="true" /> : null;
}
