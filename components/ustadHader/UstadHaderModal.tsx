// =============================================================================
// نظام حاضر (Hader) - نافذة المساعد الذكي «أستاذ حاضر»
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic,
  MicOff,
  VolumeX,
  X,
  Send,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Check
} from 'lucide-react';
import { User } from '../../types';
import { ustadSpeech, UstadListeningMode } from '../../services/ustadHader/speechService';
import {
  ustadIntentEngine,
  UstadActionPayload,
  UstadConversationContext,
  UstadPendingAction,
  UstadStudentFollowUp,
  UstadSuggestion
} from '../../services/ustadHader/intentEngine';
import { playSuccessChime } from '../../services/ustadHader/audioEffects';
import { applyColorMode } from '../../utils/colorMode';
import { forgetLearnedPhrases, learnedPhraseCount } from '../../services/ustadHader/learnedPhrases';
import { USTAD_BRIEFING_AUTO_KEY } from './UstadBriefingBanner';

interface UstadHaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  // يمر تغيير المظهر عبر الشريط العلوي ليُحفظ في إعدادات المدرسة ويتحدث زر الوضع
  onThemeChange?: (mode: 'dark' | 'light') => void;
  // أمر يُنفَّذ فور فتح النافذة، مثل «ملخص اليوم» من البطاقة الصباحية
  initialCommand?: string | null;
  onInitialCommandHandled?: () => void;
}

const UNSUPPORTED_SPEECH_NOTICE = 'هذا المتصفح لا يدعم التعرّف على الكلام. يمكنك كتابة أمرك.';

export const UstadHaderModal: React.FC<UstadHaderModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onThemeChange,
  initialCommand,
  onInitialCommandHandled
}) => {
  const navigate = useNavigate();

  // حالات التعرف والصوت
  const [isListening, setIsListening] = useState(() => ustadSpeech.getIsListening());
  const [listeningMode, setListeningMode] = useState<UstadListeningMode>(() => ustadSpeech.getListeningMode());
  const [isSpeaking, setIsSpeaking] = useState(() => ustadSpeech.getIsSpeaking());
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => ustadSpeech.getWakeWordPreference());
  const [showWakeWordConsent, setShowWakeWordConsent] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');

  // النصوص والنتائج
  const [liveTranscript, setLiveTranscript] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [activeResult, setActiveResult] = useState<UstadActionPayload | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [learnedCount, setLearnedCount] = useState(() => learnedPhraseCount());
  const [briefingAuto, setBriefingAuto] = useState(() => {
    try {
      return localStorage.getItem(USTAD_BRIEFING_AUTO_KEY) !== 'off';
    } catch {
      return true;
    }
  });

  // مراجع DOM والحالة
  const inputRef = useRef<HTMLInputElement>(null);
  const processCommandRef = useRef<(text: string) => void>(() => undefined);
  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  wakeWordEnabledRef.current = wakeWordEnabled;
  const wasOpenRef = useRef(false);
  // سياق المحادثة الجارية، ليُفهم «وفي رابع أ؟» و«سجله حاضر»
  const conversationRef = useRef<UstadConversationContext | null>(null);
  const recognitionSupported = ustadSpeech.isRecognitionSupported();

  const presentResult = useCallback((result: UstadActionPayload) => {
    setActiveResult(result);
    if (result.context) conversationRef.current = result.context;

    if (result.type === 'theme_changed' && (result.data?.mode === 'dark' || result.data?.mode === 'light')) {
      if (onThemeChange) {
        onThemeChange(result.data.mode);
      } else {
        applyColorMode(result.data.mode, true);
      }
    }

    // إذا كان هناك رد صوتي مطلوب
    if (result.spokenText) {
      ustadSpeech.speak(result.spokenText);
    } else if (result.type === 'silence') {
      ustadSpeech.stopSpeaking(true);
    }

    if (result.type !== 'error' && result.type !== 'silence' && result.type !== 'info') {
      playSuccessChime();
    }
  }, [onThemeChange]);

  // تنفيذ الأمر الصوتي أو المكتوب
  const handleProcessCommand = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsProcessing(true);
    setCommandInput('');

    try {
      const result = await ustadIntentEngine.executeCommand(trimmed, currentUser, (path) => {
        navigate(path);
        onClose();
      }, conversationRef.current);
      presentResult(result);
    } catch {
      presentResult({
        type: 'error',
        title: 'حدث خطأ غير متوقع',
        spokenText: 'عفواً، تعذر تنفيذ الطلب حالياً.'
      });
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser, navigate, onClose, presentResult]);
  processCommandRef.current = (text) => {
    void handleProcessCommand(text);
  };

  // تنفيذ إجراء بعد التأكيد الصريح (حضور، نداء خروج، تنبيهات غياب)
  const handleConfirmAction = async (action: UstadPendingAction) => {
    setIsProcessing(true);
    try {
      presentResult(await ustadIntentEngine.executeConfirmedAction(action, currentUser));
    } catch {
      presentResult({
        type: 'error',
        title: 'تعذر تنفيذ الإجراء',
        spokenText: 'عفواً، تعذر تنفيذ الإجراء حالياً.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // اختيار اقتراح ينفّذ الأمر ويعلّم المساعد صياغة المستخدم على هذا الجهاز
  const handleSuggestion = async (suggestion: UstadSuggestion, utterance: string) => {
    setIsProcessing(true);
    try {
      presentResult(await ustadIntentEngine.executeSuggestion(suggestion, utterance, currentUser, (path) => {
        navigate(path);
        onClose();
      }));
      setLearnedCount(learnedPhraseCount());
    } catch {
      presentResult({
        type: 'error',
        title: 'تعذر تنفيذ الاقتراح',
        spokenText: 'عفواً، تعذر تنفيذ الأمر حالياً.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleForgetLearned = () => {
    forgetLearnedPhrases();
    setLearnedCount(0);
  };

  const enableBriefingAuto = () => {
    try {
      localStorage.setItem(USTAD_BRIEFING_AUTO_KEY, 'on');
    } catch {
      // Preference applies to this session only.
    }
    setBriefingAuto(true);
  };

  // اختيار طالب من قائمة الأسماء المتشابهة يُكمل الطلب الأصلي نفسه
  const handleStudentChoice = async (followUp: UstadStudentFollowUp, studentId: string, utterance?: string) => {
    setIsProcessing(true);
    try {
      presentResult(await ustadIntentEngine.executeStudentFollowUp(followUp, studentId, currentUser, utterance));
    } catch {
      presentResult({
        type: 'error',
        title: 'تعذر متابعة الطلب',
        spokenText: 'عفواً، تعذر متابعة الطلب حالياً.'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // الاشتراك في خدمة الصوت دون إلغاء اشتراك الشريط العلوي
  useEffect(() => ustadSpeech.subscribe({
    onTranscript: (transcript) => {
      setLiveTranscript(transcript);
    },
    onCommand: (commandText) => {
      processCommandRef.current(commandText);
    },
    onWakeWordDetected: () => {
      // عند التقاط كلمة «يا أستاذ حاضر»
      setActiveResult(null);
      setLiveTranscript('يا أستاذ حاضر...');
    },
    onSpeakingChange: (speaking) => {
      setIsSpeaking(speaking);
    },
    onListeningStateChange: (listening, mode) => {
      setIsListening(listening);
      setListeningMode(mode);
    },
    onError: (message, fatal) => {
      setIsProcessing(false);
      if (fatal) setSpeechNotice(message);
    }
  }), []);

  // عند فتح النافذة، ابدأ الاستماع التلقائي للأمر
  useEffect(() => {
    if (!isOpen) return;
    if (recognitionSupported) {
      setSpeechNotice('');
      ustadSpeech.startActiveListening();
    } else {
      setSpeechNotice(UNSUPPORTED_SPEECH_NOTICE);
    }
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(focusTimer);
  }, [isOpen, recognitionSupported]);

  // فتح المساعد من البطاقة الصباحية ينفذ الأمر المطلوب مباشرة
  useEffect(() => {
    if (!isOpen || !initialCommand) return;
    processCommandRef.current(initialCommand);
    onInitialCommandHandled?.();
  }, [isOpen, initialCommand, onInitialCommandHandled]);

  // عند الإغلاق: عُد لوضع النداء أو أغلق الميكروفون.
  // لا يُقطع الرد الصوتي هنا حتى يُسمع تأكيد أوامر التنقل؛ الإغلاق اليدوي يوقفه.
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;

    if (wakeWordEnabledRef.current) {
      ustadSpeech.startWakeWordStandby();
    } else {
      ustadSpeech.stopListening();
    }
    setLiveTranscript('');
    setShowWakeWordConsent(false);
    conversationRef.current = null;
  }, [isOpen]);

  const handleUserClose = useCallback(() => {
    ustadSpeech.stopSpeaking(false);
    onClose();
  }, [onClose]);

  // معالجة اختصار لوحة المفاتيح Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleUserClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleUserClose]);

  // تبديل حالة الميكروفون يدويًا
  const toggleListening = () => {
    if (isListening && listeningMode === 'active_command') {
      ustadSpeech.stopListening();
      if (wakeWordEnabled) {
        ustadSpeech.startWakeWordStandby();
      }
      return;
    }
    setSpeechNotice('');
    if (!ustadSpeech.startActiveListening()) {
      setSpeechNotice(UNSUPPORTED_SPEECH_NOTICE);
    }
  };

  // إيقاف الرد الصوتي فوراً («اسكت»)
  const handleStopSpeaking = () => {
    ustadSpeech.stopSpeaking(true);
  };

  // تفعيل النداء الصوتي يتطلب موافقة صريحة بعد توضيح أثره على الخصوصية
  const handleWakeWordCheckbox = (checked: boolean) => {
    if (checked) {
      setShowWakeWordConsent(true);
      return;
    }
    setShowWakeWordConsent(false);
    setWakeWordEnabled(false);
    ustadSpeech.setWakeWordPreference(false);
  };

  const confirmWakeWord = () => {
    setShowWakeWordConsent(false);
    setWakeWordEnabled(true);
    ustadSpeech.setWakeWordPreference(true);
  };

  if (!isOpen) return null;

  const isActivelyListening = isListening && listeningMode === 'active_command';
  const pendingAction = activeResult?.pendingAction;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ustad-title"
    >
      {/* خلفية معتمة بصرية بتأثير الزجاج */}
      <button
        type="button"
        aria-label="إغلاق"
        onClick={handleUserClose}
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity"
      />

      {/* نافذة المساعد الزجاجية الذكية */}
      <div
        className="relative w-full max-w-2xl bg-slate-900/90 border border-primary-500/30 rounded-3xl shadow-[0_0_50px_rgba(14,165,233,0.25)] backdrop-blur-2xl p-5 sm:p-7 overflow-hidden text-slate-100 flex flex-col gap-5 animate-fade-in-up"
      >
        {/* هالة خلفية متحركة */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-sky-500/20 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-emerald-500/15 rounded-full blur-[90px] pointer-events-none" />

        {/* رأس النافذة مع هوية «أستاذ حاضر» */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 relative z-10">
          <div className="flex items-center gap-3">
            {/* الشعار والأيقونة مع الهالة المتموجة */}
            <div className="relative flex items-center justify-center">
              {(isActivelyListening || isSpeaking) && (
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-sky-400 to-emerald-400 blur-md opacity-60 animate-ustad-ripple" />
              )}
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 via-primary-600 to-emerald-600 flex items-center justify-center shadow-lg shadow-sky-500/30 border border-sky-300/30">
                <Sparkles className="w-6 h-6 text-white animate-pulse" />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 id="ustad-title" className="text-xl sm:text-2xl font-black text-white tracking-wide">
                  أستاذ حاضر
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold">
                  المساعد الذكي
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                رفيق المدرسة الذكي لإدارة الحضور، الغياب، التقارير، والرسائل
              </p>
            </div>
          </div>

          {/* أزرار الإجراءات السريعة (إسكات الصوت، إغلاق) */}
          <div className="flex items-center gap-2">
            {isSpeaking && (
              <button
                type="button"
                onClick={handleStopSpeaking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-bold hover:bg-red-500/30 transition-all animate-pulse"
                title="إيقاف الرد الصوتي"
              >
                <VolumeX className="w-4 h-4" />
                <span>اسكت</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleUserClose}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors border border-white/10"
              aria-label="إغلاق نافذة المساعد"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* شريط حالة الاستماع والميكروفون */}
        <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-xs" aria-live="polite">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                speechNotice
                  ? 'bg-amber-400'
                  : isActivelyListening
                  ? 'bg-sky-400 animate-ping'
                  : wakeWordEnabled
                  ? 'bg-emerald-400'
                  : 'bg-slate-500'
              }`}
            />
            <span className="font-bold text-slate-200">
              {speechNotice
                ? speechNotice
                : isActivelyListening
                ? 'الميكروفون نشط - أستمع إليك الآن...'
                : wakeWordEnabled
                ? 'النداء الصوتي نشط: قل «يا أستاذ حاضر»'
                : 'جاهز للاستماع - اضغط زر التحدث'}
            </span>
          </div>

          {/* الموجات الصوتية الحية */}
          {isActivelyListening && (
            <div className="flex items-center gap-1 h-5 px-2">
              <span className="w-1 bg-sky-400 rounded-full animate-soundwave-1" />
              <span className="w-1 bg-sky-300 rounded-full animate-soundwave-2" />
              <span className="w-1 bg-emerald-400 rounded-full animate-soundwave-3" />
              <span className="w-1 bg-sky-400 rounded-full animate-soundwave-4" />
              <span className="w-1 bg-emerald-300 rounded-full animate-soundwave-5" />
            </div>
          )}
        </div>

        {/* عرض تفريغ الكلام المنطوق لحظة بلحظة (Live Transcript) */}
        {(liveTranscript || isActivelyListening) && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/10 via-primary-500/10 to-emerald-500/10 border border-sky-500/20 text-sm">
            <div className="flex items-center justify-between text-xs text-sky-400 font-bold mb-1">
              <span>الكلام المنطوق (مباشر):</span>
              {isProcessing && <span className="animate-pulse">جاري التحليل والتنفيذ...</span>}
            </div>
            <p className="text-white font-medium text-base min-h-[1.5rem]">
              {liveTranscript || 'تفضل بالتحدث، أستمع إليك...'}
            </p>
          </div>
        )}

        {/* بطاقة عرض النتائج التفاعلية */}
        {activeResult && (
          <div className="rounded-2xl bg-slate-800/80 border border-white/10 p-5 flex flex-col gap-4 animate-fade-in" aria-live="polite">
            {/* عنوان النتيجة */}
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {activeResult.type === 'error' ? (
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                ) : activeResult.type === 'info' ? (
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                )}
                <span>{activeResult.title}</span>
              </h3>

              {activeResult.actionButton && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeResult.actionButton?.path) {
                      navigate(activeResult.actionButton.path);
                      onClose();
                    } else if (activeResult.actionButton?.onClickKey === 'help') {
                      void handleProcessCommand('مساعدة');
                    } else if (activeResult.actionButton?.onClickKey === 'briefing') {
                      void handleProcessCommand('ملخص اليوم');
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold transition-all shadow-md shadow-primary-500/20 shrink-0"
                >
                  <span>{activeResult.actionButton.label}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* نص الرد للنتائج التي لا تحمل بطاقة تفصيلية */}
            {(activeResult.type === 'success' || activeResult.type === 'info' || activeResult.type === 'error') && activeResult.spokenText && (
              <p className="text-sm text-slate-300 leading-relaxed">{activeResult.spokenText}</p>
            )}

            {/* اقتراحات «هل تقصد؟» لجملة لم تُفهم */}
            {activeResult.type === 'suggestions' && activeResult.data && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">بعد اختيارك سيتذكر المساعد صياغتك على هذا الجهاز.</p>
                <div className="flex flex-wrap gap-2">
                  {activeResult.data.suggestions.map((suggestion: UstadSuggestion) => (
                    <button
                      key={suggestion.intentId}
                      type="button"
                      disabled={isProcessing}
                      onClick={() => void handleSuggestion(suggestion, activeResult.data.utterance)}
                      className="text-xs px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-100 font-bold transition-colors disabled:opacity-50"
                    >
                      {suggestion.command}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* الملخص الصباحي */}
            {activeResult.type === 'briefing' && activeResult.data && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <div className="text-2xl font-black text-emerald-400">{activeResult.data.attended} / {activeResult.data.total}</div>
                    <div className="text-xs text-emerald-200 mt-1 font-bold">حضروا</div>
                  </div>
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <div className="text-2xl font-black text-red-400">{activeResult.data.absent}</div>
                    <div className="text-xs text-red-200 mt-1 font-bold">غائبون</div>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <div className="text-2xl font-black text-amber-400">{activeResult.data.late}</div>
                    <div className="text-xs text-amber-200 mt-1 font-bold">متأخرون</div>
                  </div>
                  <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20">
                    <div className="text-2xl font-black text-sky-400">{activeResult.data.rate}%</div>
                    <div className="text-xs text-sky-200 mt-1 font-bold">نسبة الحضور</div>
                  </div>
                </div>
                {activeResult.data.repeatedCount > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-bold text-amber-300">غياب متكرر بين غائبي اليوم: {activeResult.data.repeatedCount}</div>
                    {activeResult.data.repeatedAbsentees.map((student: any) => (
                      <div key={student.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/5 text-xs">
                        <span className="font-bold text-white">{student.name}</span>
                        <span className="text-slate-400">
                          {student.classLabel} · {student.streak > 0
                            ? `غائب ${student.streak + 1} أيام متتالية`
                            : `${student.recentAbsences + 1} غيابات خلال أسبوعين`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 1. إحصائيات الغياب والحضور */}
            {(activeResult.type === 'stats_absence' || activeResult.type === 'stats_attendance') && activeResult.data && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="text-2xl font-black text-red-400">{activeResult.data.absent}</div>
                  <div className="text-xs text-red-200 mt-1 font-bold">الغياب اليوم</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-2xl font-black text-emerald-400">{activeResult.data.present}</div>
                  <div className="text-xs text-emerald-200 mt-1 font-bold">الحضور</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="text-2xl font-black text-amber-400">{activeResult.data.late}</div>
                  <div className="text-xs text-amber-200 mt-1 font-bold">المتأخرين</div>
                </div>
                <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20">
                  <div className="text-2xl font-black text-sky-400">{activeResult.data.rate}%</div>
                  <div className="text-xs text-sky-200 mt-1 font-bold">نسبة الحضور</div>
                </div>
              </div>
            )}

            {/* 2. كشف غياب فصل وشعبة محددة */}
            {activeResult.type === 'class_absence' && activeResult.data && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>إجمالي طلاب الفصل: {activeResult.data.totalInClass}</span>
                  <span className="font-bold text-red-400">عدد الغائبين: {activeResult.data.absentCount}</span>
                </div>

                {activeResult.data.absentStudents?.length === 0 ? (
                  <div className="p-4 rounded-xl bg-emerald-500/10 text-emerald-300 text-sm text-center font-bold">
                    ما شاء الله! نسبة الحضور 100% ولا يوجد غياب اليوم.
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {activeResult.data.absentStudents.map((st: any) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/5 text-xs"
                      >
                        <span className="font-bold text-white">{st.name}</span>
                        <span className="text-slate-400">{st.class_name} - {st.section}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. تقرير الأسبوع من السجلات الفعلية */}
            {activeResult.type === 'weekly_report' && activeResult.data && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>
                    متوسط حضور الأسبوع:{' '}
                    <strong className="text-emerald-400 text-sm">
                      {activeResult.data.avgPresence === null ? 'لا توجد سجلات' : `${activeResult.data.avgPresence}%`}
                    </strong>
                  </span>
                  <span>الطلاب الفعالين: {activeResult.data.totalStudents}</span>
                </div>
                <div
                  className="grid gap-2 pt-1"
                  style={{ gridTemplateColumns: `repeat(${activeResult.data.days.length}, minmax(0, 1fr))` }}
                >
                  {activeResult.data.days.map((d: any) => (
                    <div key={d.date} className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/5 border border-white/10 text-center">
                      <span className="text-[11px] text-slate-400 font-bold">{d.day}</span>
                      <div className="w-full bg-slate-700 h-14 rounded-lg flex items-end p-1">
                        {d.hasData && (
                          <div
                            className="w-full bg-gradient-to-t from-emerald-500 to-sky-400 rounded-md transition-all duration-500"
                            style={{ height: `${d.presence}%` }}
                          />
                        )}
                      </div>
                      <span className="text-[11px] font-bold text-white">{d.hasData ? `${d.presence}%` : '—'}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">الأيام التي لا تحمل سجلات (عطلة أو لم تُحضَّر بعد) لا تدخل في المتوسط.</p>
              </div>
            )}

            {/* 4. معاينة تنبيهات أولياء الأمور قبل الإرسال */}
            {activeResult.type === 'alerts_preview' && activeResult.data && pendingAction && (
              <div className="space-y-3 border-t border-white/10 pt-3">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300">
                  <div className="font-bold text-white mb-1">نص الرسالة (مثال لأول طالب):</div>
                  <p className="text-slate-300">{activeResult.data.messagePreview}</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">
                    المستلمون: <strong className="text-white">{activeResult.data.recipientsCount} ولي أمر</strong>
                    {activeResult.data.withoutPhone > 0 && (
                      <span className="text-slate-500"> · {activeResult.data.withoutPhone} غائب بلا رقم واتساب صالح</span>
                    )}
                  </span>
                  <span className="text-amber-400 font-bold">يتطلب تأكيدك الصريح قبل الإرسال</span>
                </div>

                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {activeResult.data.recipients.map((rec: any) => (
                    <div key={rec.studentId} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/5 text-xs">
                      <span className="text-white font-bold">{rec.studentName}</span>
                      <span className="text-slate-400 font-mono text-[11px]" dir="ltr">{rec.phone}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleConfirmAction(pendingAction)}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isProcessing ? 'جاري الإضافة إلى طابور واتساب...' : 'تأكيد وإرسال التنبيهات عبر واتساب'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveResult(null)}
                    disabled={isProcessing}
                    className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}

            {/* 5. التمييز في حال تشابه الأسماء (Disambiguation) */}
            {activeResult.type === 'disambiguation' && activeResult.data && (
              <div className="space-y-3">
                <p className="text-xs text-slate-300 font-bold">
                  اختر الطالب المقصود:
                  {activeResult.data.total > activeResult.data.students.length && (
                    <span className="block font-medium text-slate-500 mt-1">
                      أعرض أقرب {activeResult.data.students.length} من {activeResult.data.total}. اذكر الاسم كاملاً أو الصف لتضييق البحث.
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeResult.data.students.map((st: any) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        if (activeResult.followUp) void handleStudentChoice(activeResult.followUp, st.id, activeResult.data.utterance);
                      }}
                      disabled={isProcessing}
                      className="p-3 rounded-xl bg-white/5 hover:bg-primary-500/20 border border-white/10 hover:border-primary-500/40 text-right transition-all flex flex-col gap-1 group"
                    >
                      <span className="font-bold text-white group-hover:text-primary-300 text-sm">{st.name}</span>
                      <span className="text-xs text-slate-400">{st.class_name} - {st.section}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 6. بطاقة الطالب الفردية */}
            {activeResult.type === 'student_card' && activeResult.data && (
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">الصف والشعبة:</span>
                  <span className="font-bold text-white">{activeResult.data.student.class_name} - {activeResult.data.student.section}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">حالة الحضور اليوم:</span>
                  <span className={`font-bold px-2 py-0.5 rounded-md ${
                    activeResult.data.status === 'present'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : activeResult.data.status === 'late'
                      ? 'bg-amber-500/20 text-amber-300'
                      : activeResult.data.status === 'pending'
                      ? 'bg-slate-500/20 text-slate-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}>
                    {activeResult.data.statusArabic}
                  </span>
                </div>
                {activeResult.data.student.guardianPhone && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">هاتف ولي الأمر:</span>
                    <span className="font-mono text-white font-bold" dir="ltr">{activeResult.data.student.guardianPhone}</span>
                  </div>
                )}
              </div>
            )}

            {/* 7. بطاقة التأكيد قبل التنفيذ */}
            {activeResult.type === 'confirmation' && activeResult.data && pendingAction && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-3">
                <p className="text-sm font-bold text-amber-200">
                  هل تريد بالتأكيد {activeResult.data.prompt}؟
                  {activeResult.data.className && (
                    <span className="block text-xs font-medium text-slate-400 mt-1">{activeResult.data.className}</span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleConfirmAction(pendingAction)}
                    disabled={isProcessing}
                    className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    {isProcessing ? 'جاري التنفيذ...' : 'تأكيد التنفيذ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveResult(null)}
                    disabled={isProcessing}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 font-bold text-xs transition-colors disabled:opacity-50"
                  >
                    تراجع
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* حزمة الأوامر السريعة الشاملة للاختبار والتجربة السريعة */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-slate-400 flex items-center justify-between">
            <span>أمثلة أوامر شاملة يمكنك نطقها أو النقر عليها:</span>
            <span className="text-[10px] text-primary-400">اضغط للتجربة الفورية</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { label: 'ملخص اليوم', cmd: 'ملخص اليوم' },
              { label: 'افتح مركز التكاملات', cmd: 'افتح مركز التكاملات' },
              { label: 'كم طالب غائب اليوم؟', cmd: 'كم طالب غائب اليوم؟' },
              { label: 'اعرض غياب ثالث باء', cmd: 'اعرض غياب ثالث باء' },
              { label: 'جهّز تقرير الأسبوع', cmd: 'جهّز تقرير الأسبوع' },
              { label: 'أرسل تنبيه لأولياء أمور الغائبين', cmd: 'أرسل تنبيه لأولياء أمور الغائبين' },
              { label: 'من في الانتظار اليوم؟', cmd: 'من في الانتظار اليوم؟' },
              { label: 'كم نسبة الحضور اليوم؟', cmd: 'كم نسبة الحضور اليوم؟' },
              { label: 'افتح كشك الحضور', cmd: 'افتح كشك الحضور' },
              { label: 'افتح التقارير', cmd: 'افتح التقارير' },
              { label: 'تبديل للوضع الداكن', cmd: 'الوضع الداكن' }
            ].map((item) => (
              <button
                key={item.cmd}
                type="button"
                onClick={() => void handleProcessCommand(item.cmd)}
                className="text-xs px-3 py-1.5 rounded-xl bg-white/5 hover:bg-sky-500/20 border border-white/10 hover:border-sky-500/30 text-slate-300 hover:text-white transition-all font-medium active:scale-95"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* شريط الإدخال والتحكم الصوتي السفلي */}
        <div className="border-t border-white/10 pt-4 flex flex-col sm:flex-row items-center gap-3">
          {/* حقل الكتابة للأوامر النصية البديلة */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleProcessCommand(commandInput);
            }}
            className="flex-1 w-full flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="اكتب أمرك أو سؤالك هنا (مثل: كم الغياب؟، افتح مركز التكاملات...)"
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-sky-400/50 transition-colors"
            />
            <button
              type="submit"
              disabled={!commandInput.trim() || isProcessing}
              className="p-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 disabled:opacity-40 text-white transition-colors"
              title="إرسال الأمر"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          {recognitionSupported && (
            <div className="flex items-center gap-2">
              {/* الزر المركزي للميكروفون */}
              <button
                type="button"
                onClick={toggleListening}
                className={`p-3 rounded-2xl border transition-all duration-300 flex items-center justify-center ${
                  isActivelyListening
                    ? 'bg-gradient-to-r from-sky-500 to-emerald-500 text-white border-sky-400 shadow-[0_0_20px_rgba(14,165,233,0.5)] animate-ustad-aura'
                    : 'bg-white/10 text-slate-200 hover:bg-white/20 border-white/10'
                }`}
                title={isActivelyListening ? 'إيقاف الاستماع' : 'تفعيل الميكروفون والتحدث'}
              >
                {isActivelyListening ? <Mic className="w-5 h-5 animate-pulse" /> : <MicOff className="w-5 h-5" />}
              </button>

              {/* خيار تفعيل النداء الصوتي («يا أستاذ حاضر») */}
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 transition-colors text-xs select-none">
                <input
                  type="checkbox"
                  checked={wakeWordEnabled || showWakeWordConsent}
                  onChange={(e) => handleWakeWordCheckbox(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-500 accent-sky-500 cursor-pointer"
                />
                <span className="text-slate-300">النداء الصوتي («يا أستاذ حاضر»)</span>
              </label>
            </div>
          )}
        </div>

        {/* موافقة صريحة قبل تشغيل الميكروفون في الخلفية */}
        {showWakeWordConsent && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-100 space-y-3" role="alertdialog" aria-labelledby="ustad-wake-consent-title">
            <p id="ustad-wake-consent-title" className="font-bold text-amber-200">قبل تفعيل النداء الصوتي</p>
            <ul className="space-y-1.5 text-slate-300 list-disc pr-4">
              <li>سيبقى الميكروفون مفتوحاً في كل شاشات المنصة على هذا الجهاز بانتظار «يا أستاذ حاضر».</li>
              <li>يعالج المتصفح الصوت عبر خدمة التعرّف الخاصة به، وقد تكون خدمة سحابية خارجية (مثل Google في متصفح Chrome).</li>
              <li>لا تفعّله على جهاز مشترك أو في مكان تُناقش فيه بيانات الطلاب بصوت مسموع.</li>
            </ul>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={confirmWakeWord}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold transition-colors"
              >
                فهمت، فعّل النداء الصوتي
              </button>
              <button
                type="button"
                onClick={() => setShowWakeWordConsent(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 font-bold transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* إرشادات سريعة في الأسفل */}
        <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>اختصار لوحة المفاتيح: <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-mono">Alt + H</kbd></span>
          <span>لإسكات المساعد فوراً: قل <strong className="text-slate-400">«اسكت»</strong></span>
          {learnedCount > 0 && (
            <button type="button" onClick={handleForgetLearned} className="underline decoration-dotted hover:text-slate-300">
              مسح ما تعلّمه المساعد ({learnedCount})
            </button>
          )}
          {!briefingAuto && (
            <button type="button" onClick={enableBriefingAuto} className="underline decoration-dotted hover:text-slate-300">
              إظهار الملخص الصباحي تلقائياً
            </button>
          )}
          <span>الإغلاق: <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-mono">Esc</kbd></span>
        </div>
      </div>
    </div>
  );
};

export default UstadHaderModal;
