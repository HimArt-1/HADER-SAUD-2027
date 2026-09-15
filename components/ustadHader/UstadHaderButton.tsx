// =============================================================================
// نظام حاضر (Hader) - زر «أستاذ حاضر» في الشريط العلوي
// =============================================================================
// كرة ضوئية صغيرة تعكس حالة المساعد: ساكنة، أو تستمع، أو تتحدث، مع مؤشر النداء الصوتي.

import React from 'react';
import { UstadOrb } from './UstadOrb';

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
  const orbState = isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle';
  const title = isListening
    ? 'أستاذ حاضر يستمع إليك الآن'
    : isWakeWordActive
    ? 'النداء الصوتي مفعّل: قل «يا أستاذ حاضر» (أو Alt+H)'
    : 'المساعد الذكي «أستاذ حاضر» (Alt+H)';

  return (
    <div className="relative inline-flex items-center group" data-ustad-ignore-outside="true">
      {/* الهالة الضوئية المتموجة عند الاستماع أو الرد */}
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
        title={title}
        aria-label="أستاذ حاضر"
      >
        <span className="relative flex items-center justify-center">
          <UstadOrb state={orbState} size="xs" />
          {/* نقطة حالة النداء الصوتي */}
          <span
            className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-slate-900 ${
              isListening ? 'bg-sky-400 animate-ping' : isWakeWordActive ? 'bg-emerald-400' : 'bg-slate-500'
            }`}
          />
        </span>

        <span className="font-sans font-bold tracking-wide">أستاذ حاضر</span>

        {!compact && (
          <span
            className={`hidden lg:inline-block text-[10px] px-1.5 py-0.5 rounded font-mono ${
              isGlowing ? 'bg-black/30 text-white/90' : 'bg-white/10 text-slate-300 group-hover:text-white'
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
