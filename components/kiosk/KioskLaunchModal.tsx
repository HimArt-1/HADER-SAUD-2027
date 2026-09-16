import React, { useState, useEffect } from 'react';
import {
  Monitor,
  RotateCw,
  RotateCcw,
  ExternalLink,
  Layers,
  Tv,
  X,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import {
  KioskLaunchTarget,
  KioskRotation,
  getKioskLaunchPreferences,
  executeKioskLaunch,
} from '../../utils/kioskLaunchHelper';

interface KioskLaunchModalProps {
  isOpen: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
}

export const KioskLaunchModal: React.FC<KioskLaunchModalProps> = ({
  isOpen,
  onClose,
  navigate,
}) => {
  const [target, setTarget] = useState<KioskLaunchTarget>('same_window');
  const [rotation, setRotation] = useState<KioskRotation>('none');
  const [autoLaunch, setAutoLaunch] = useState<boolean>(false);
  const [launching, setLaunching] = useState<boolean>(false);

  // تحميل التفضيلات السابقة عند فتح النافذة
  useEffect(() => {
    if (isOpen) {
      const prefs = getKioskLaunchPreferences();
      setTarget(prefs.target);
      setRotation(prefs.rotation);
      setAutoLaunch(prefs.autoLaunch);
      setLaunching(false);
    }
  }, [isOpen]);

  // إغلاق عبر زر الهروب Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirmLaunch = async () => {
    setLaunching(true);
    try {
      await executeKioskLaunch(
        {
          target,
          rotation,
          autoLaunch,
        },
        navigate
      );
      onClose();
    } catch {
      setLaunching(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kiosk-launch-title"
    >
      <div
        className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-slate-900/95 p-6 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.85),0_0_35px_rgba(6,182,212,0.18)] backdrop-blur-2xl text-white transition-all duration-300 transform scale-100"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="relative grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <Monitor className="h-5 w-5" />
              <div className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
              <div className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-cyan-400" />
            </div>
            <div>
              <h2 id="kiosk-launch-title" className="text-base font-bold text-white tracking-wide">
                خيارات تشغيل كشك الحضور
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                حدد مكان الفتح وطريقة العرض المناسبة لشاشتك
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors border border-transparent hover:border-white/10"
            title="إغلاق"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 max-h-[70vh] overflow-y-auto px-0.5 py-1">
          {/* Section 1: مكان فتح النافذة */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">
              مكان فتح النافذة:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Option 1: شاشة خارجية HDMI */}
              <button
                type="button"
                onClick={() => setTarget('external')}
                className={`relative flex flex-col justify-between p-3 rounded-xl border text-right transition-all duration-200 ${
                  target === 'external'
                    ? 'border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_20px_rgba(6,182,212,0.25)] text-white'
                    : 'border-white/10 bg-slate-800/50 hover:bg-slate-800/80 hover:border-white/20 text-slate-300'
                }`}
              >
                {target === 'external' && (
                  <CheckCircle2 className="absolute top-2 left-2 w-4 h-4 text-cyan-400" />
                )}
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`p-2 rounded-lg border ${
                      target === 'external'
                        ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-300'
                        : 'border-white/10 bg-white/5 text-slate-400'
                    }`}
                  >
                    <Tv className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold leading-tight">شاشة خارجية (HDMI)</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal">
                  نافذة مخصصة لشاشة الطلاب الخارجية أو سطح المكتب الثاني
                </p>
                <div className="mt-2 text-[9px] px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-300 border border-cyan-400/20 self-start">
                  سلك HDMI / شاشتين
                </div>
              </button>

              {/* Option 2: علامة تبويب جديدة */}
              <button
                type="button"
                onClick={() => setTarget('new_tab')}
                className={`relative flex flex-col justify-between p-3 rounded-xl border text-right transition-all duration-200 ${
                  target === 'new_tab'
                    ? 'border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_20px_rgba(6,182,212,0.25)] text-white'
                    : 'border-white/10 bg-slate-800/50 hover:bg-slate-800/80 hover:border-white/20 text-slate-300'
                }`}
              >
                {target === 'new_tab' && (
                  <CheckCircle2 className="absolute top-2 left-2 w-4 h-4 text-cyan-400" />
                )}
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`p-2 rounded-lg border ${
                      target === 'new_tab'
                        ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-300'
                        : 'border-white/10 bg-white/5 text-slate-400'
                    }`}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold leading-tight">تبويب جديد</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal">
                  فتح الكشك في تبويب مستقل وإبقاء لوحة التحكم الحالية
                </p>
                <div className="mt-2 text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 border border-white/10 self-start">
                  تبويب متصفح مستقل
                </div>
              </button>

              {/* Option 3: نفس النافذة الحالية */}
              <button
                type="button"
                onClick={() => setTarget('same_window')}
                className={`relative flex flex-col justify-between p-3 rounded-xl border text-right transition-all duration-200 ${
                  target === 'same_window'
                    ? 'border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_20px_rgba(6,182,212,0.25)] text-white'
                    : 'border-white/10 bg-slate-800/50 hover:bg-slate-800/80 hover:border-white/20 text-slate-300'
                }`}
              >
                {target === 'same_window' && (
                  <CheckCircle2 className="absolute top-2 left-2 w-4 h-4 text-cyan-400" />
                )}
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`p-2 rounded-lg border ${
                      target === 'same_window'
                        ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-300'
                        : 'border-white/10 bg-white/5 text-slate-400'
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold leading-tight">النافذة الحالية</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal">
                  الانتقال المباشر للكشك في نفس هذه الصفحة الحالية
                </p>
                <div className="mt-2 text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 border border-white/10 self-start">
                  الوضع الكلاسيكي
                </div>
              </button>
            </div>
          </div>

          {/* Section 2: طريقة عرض وتدوير الكشك */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">
              طريقة عرض وتدوير الشاشة:
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {/* تدوير طبيعي (أفقي) */}
              <button
                type="button"
                onClick={() => setRotation('none')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  rotation === 'none'
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.25)] font-bold'
                    : 'border-white/10 bg-slate-800/50 hover:bg-slate-800/80 text-slate-300'
                }`}
              >
                <Monitor className="w-5 h-5 mb-1" />
                <span className="text-xs">طبيعية (أفقي)</span>
                <span className="text-[10px] opacity-70 mt-0.5">وضع قياسي 0°</span>
              </button>

              {/* إلتفاف يمين (90°) */}
              <button
                type="button"
                onClick={() => setRotation('right')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  rotation === 'right'
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.25)] font-bold'
                    : 'border-white/10 bg-slate-800/50 hover:bg-slate-800/80 text-slate-300'
                }`}
              >
                <RotateCw className="w-5 h-5 mb-1" />
                <span className="text-xs">إلتفاف يمين</span>
                <span className="text-[10px] opacity-70 mt-0.5">رأسي (90°)</span>
              </button>

              {/* إلتفاف يسار (-90°) */}
              <button
                type="button"
                onClick={() => setRotation('left')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  rotation === 'left'
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.25)] font-bold'
                    : 'border-white/10 bg-slate-800/50 hover:bg-slate-800/80 text-slate-300'
                }`}
              >
                <RotateCcw className="w-5 h-5 mb-1" />
                <span className="text-xs">إلتفاف يسار</span>
                <span className="text-[10px] opacity-70 mt-0.5">رأسي (-90°)</span>
              </button>
            </div>
          </div>

          {/* Section 3: التثبيت التلقائي */}
          <div className="rounded-xl border border-white/10 bg-slate-800/40 p-3.5 backdrop-blur-sm">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoLaunch}
                onChange={(e) => setAutoLaunch(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-400/30"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-slate-200">
                  تثبيت هذا الوضع كافتراضي وتخطي هذه النافذة لاحقاً
                </span>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                  عند التفعيل، سيتم فتح الكشك مباشرة وفق هذه الإعدادات عند النقر على زر الكشك. يمكنك دائماً تعديل هذا الخيار من زر ⚙️ أو من لوحة تحكم الكشك.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 mt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={launching}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-xs font-bold text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleConfirmLaunch}
            disabled={launching}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold text-xs shadow-[0_0_20px_rgba(6,182,212,0.35)] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>{launching ? 'جاري الفتح...' : 'تشغيل الكشك الآن'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default KioskLaunchModal;
