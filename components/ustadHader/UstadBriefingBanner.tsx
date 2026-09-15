// =============================================================================
// نظام حاضر (Hader) - بطاقة الملخص الصباحي من «أستاذ حاضر»
// =============================================================================
// تظهر مرة واحدة يومياً لكل مستخدم بعد انتهاء مهلة الحضور، ولا تنطق إلا بطلب منه.

import React, { useEffect, useState } from 'react';
import { ChevronLeft, Sparkles, Volume2, X } from 'lucide-react';
import { User } from '../../types';
import { loadMorningBriefing, MorningBriefing } from '../../services/ustadHader/morningBriefing';
import { ustadSpeech } from '../../services/ustadHader/speechService';

export const USTAD_BRIEFING_AUTO_KEY = 'hader:ustad_briefing_auto';
const seenKey = (userId: string) => `hader:ustad_briefing_seen:${userId}`;
const MAX_WAIT_MS = 12 * 60 * 60 * 1000;

type ReadyBriefing = Extract<MorningBriefing, { status: 'ready' }>;

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The banner simply shows again next time.
  }
};

interface UstadBriefingBannerProps {
  user: User | null;
  onOpenDetails: () => void;
}

const Stat: React.FC<{ label: string; value: React.ReactNode; tone: string }> = ({ label, value, tone }) => (
  <div className="rounded-xl bg-white/5 border border-white/5 p-2">
    <div className={`text-lg font-black ${tone}`}>{value}</div>
    <div className="text-[11px] text-slate-400 font-bold">{label}</div>
  </div>
);

export const UstadBriefingBanner: React.FC<UstadBriefingBannerProps> = ({ user, onOpenDetails }) => {
  const [briefing, setBriefing] = useState<ReadyBriefing | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // زر «اسمع الملخص» لا يظهر إلا حين يكون الرد الصوتي مفعّلاً في إعدادات المساعد
  const [voiceReply, setVoiceReply] = useState(() => ustadSpeech.getVoiceReplyPreference());
  const userId = user?.id;

  useEffect(() => ustadSpeech.subscribe({ onVoiceReplyChange: setVoiceReply }), []);

  useEffect(() => {
    if (!user || readStorage(USTAD_BRIEFING_AUTO_KEY) === 'off') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void loadMorningBriefing(user)
      .then(result => {
        if (cancelled || !result || readStorage(seenKey(user.id)) === result.date) return;
        if (result.status === 'pending') {
          // يظهر الملخص تلقائياً لحظة انتهاء مهلة الحضور
          const wait = Math.min(MAX_WAIT_MS, Math.max(1000, result.readyAt - Date.now() + 1000));
          timer = setTimeout(() => setReloadToken(token => token + 1), wait);
          return;
        }
        if (result.status === 'ready') setBriefing(result);
      })
      .catch(() => {
        // الملخص إضافة، وتعذر تجهيزه لا يعطل الصفحة
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, reloadToken]);

  if (!briefing || !user) return null;

  const dismiss = () => {
    writeStorage(seenKey(user.id), briefing.date);
    setBriefing(null);
  };

  const listedRepeated = briefing.repeatedAbsentees.slice(0, 3);
  const moreRepeated = briefing.repeatedCount - listedRepeated.length;

  return (
    <section
      dir="rtl"
      aria-labelledby="ustad-briefing-title"
      className="mb-4 rounded-2xl border border-sky-500/25 bg-slate-900/70 p-4 text-slate-100 shadow-lg shadow-sky-500/10 backdrop-blur animate-fade-in"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-sky-300 shrink-0" />
          <h2 id="ustad-briefing-title" className="text-sm font-black text-white">ملخص اليوم من أستاذ حاضر</h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="إخفاء ملخص اليوم"
          className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label="حضروا" value={`${briefing.attended} / ${briefing.total}`} tone="text-emerald-300" />
        <Stat label="غائبون" value={briefing.absent} tone="text-red-300" />
        <Stat label="متأخرون" value={briefing.late} tone="text-amber-300" />
        <Stat label="نسبة الحضور" value={`${briefing.rate}%`} tone="text-sky-300" />
      </div>

      {briefing.repeatedCount > 0 && (
        <p className="mt-3 text-xs text-amber-200 leading-relaxed">
          <strong>غياب متكرر:</strong> {listedRepeated.map(student => student.name).join('، ')}
          {moreRepeated > 0 ? ` و${moreRepeated} آخرون` : ''}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {voiceReply && (
          <button
            type="button"
            onClick={() => ustadSpeech.speak(briefing.spokenText)}
            className="flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 font-bold text-sky-100 hover:bg-sky-500/25 transition-colors"
          >
            <Volume2 className="h-4 w-4" />
            <span>اسمع الملخص</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            dismiss();
            onOpenDetails();
          }}
          className="flex items-center gap-1 rounded-xl bg-primary-500 px-3 py-1.5 font-bold text-white hover:bg-primary-600 transition-colors"
        >
          <span>التفاصيل</span>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            writeStorage(USTAD_BRIEFING_AUTO_KEY, 'off');
            dismiss();
          }}
          className="px-2 py-1.5 text-slate-400 underline decoration-dotted hover:text-slate-200"
        >
          لا تعرضه تلقائياً
        </button>
      </div>
    </section>
  );
};

export default UstadBriefingBanner;
