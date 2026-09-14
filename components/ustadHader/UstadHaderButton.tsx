// =============================================================================
// نظام حاضر (Hader) - زر «أستاذ حاضر» مع الهالة الضوئية المتموجة
// =============================================================================

import React from 'react';
import { Mic, Sparkles, Volume2 } from 'lucide-react';

interface UstadHaderButtonProps {
  onClick: () => void;
  isListening: boolean;
  isSpeaking: boolean;
  isWakeWordActive: boolean;
  compact?: boolean;
}

export const UstadHaderButton: React.FC<UstadHaderButtonProps> = ({
  onClick,
  isListening,
  isSpeaking,
  isWakeWordActive,
  compact = false
}) => {
  const isGlowing = isListening || isSpeaking;

  return (
    <div className="relative inline-flex items-center group">
      {/* 🌟 الهالة الضوئية المتموجة المشعة عند التفاعل أو الاستماع */}
      {isGlowing && (
        <>
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-sky-400 via-primary-500 to-emerald-400 blur-md opacity-75 animate-ustad-ripple pointer-events-none" />
          <div className="absolute -inset-1 rounded-2xl bg-primary-500/30 blur-lg animate-pulse pointer-events-none" />
        </>
      )}

      <button
        onClick={onClick}
        type="button"
        className={`relative z-10 flex items-center gap-2 px-3 py-1.5 rounded-xl border font-bold text-xs transition-all duration-300 ${
          isGlowing
            ? 'bg-gradient-to-r from-sky-600 via-primary-600 to-emerald-600 text-white border-sky-400 shadow-[0_0_20px_rgba(14,165,233,0.5)] animate-ustad-aura'
            : isWakeWordActive
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/50'
            : 'bg-white/5 border-white/10 text-slate-200 hover:bg-primary-500/10 hover:border-primary-500/30 hover:text-white'
        }`}
        title="المساعد الصوتي الذكي «أستاذ حاضر» (اضغط أو Alt+H)"
        aria-label="أستاذ حاضر"
      >
        {/* أيقونة الحالة */}
        <div className="relative flex items-center justify-center">
          {isSpeaking ? (
            <Volume2 className="w-4 h-4 text-emerald-300 animate-bounce" />
          ) : isListening ? (
            <Mic className="w-4 h-4 text-sky-200 animate-pulse" />
          ) : (
            <Sparkles className="w-4 h-4 text-primary-400 group-hover:rotate-12 transition-transform" />
          )}

          {/* نقطة مؤشر حالة الميكروفون الحية الدائمة */}
          <span
            className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-slate-900 ${
              isListening
                ? 'bg-sky-400 animate-ping'
                : isWakeWordActive
                ? 'bg-emerald-400'
                : 'bg-slate-500'
            }`}
            title={
              isListening
                ? 'الميكروفون يستمع إليك الآن'
                : isWakeWordActive
                ? 'النداء الصوتي (يا أستاذ حاضر) مفعل'
                : 'المساعد جاهز'
            }
          />
        </div>

        {/* النص الرسمي */}
        <span className="font-sans font-bold tracking-wide">
          أستاذ حاضر
        </span>

        {/* شارة الاختصار في الأجهزة المكتبية */}
        {!compact && (
          <span
            className={`hidden lg:inline-block text-[10px] px-1.5 py-0.5 rounded font-mono ${
              isGlowing
                ? 'bg-black/30 text-white/90'
                : 'bg-white/10 text-slate-300 group-hover:text-white'
            }`}
          >
            Alt+H
          </span>
        )}
      </button>
    </div>
  );
};

export default UstadHaderButton;
