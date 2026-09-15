// =============================================================================
// نظام حاضر (Hader) - البطاقة الزجاجية العائمة لـ «أستاذ حاضر»
// =============================================================================
// بطاقة غير معترضة أسفل الشاشة: تظهر بالنداء أو بالاختصار، تستمع وتجيب وتختفي،
// والصفحة خلفها تبقى كما هي.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Send, SlidersHorizontal, VolumeX, X } from 'lucide-react';
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
import { UstadOrb, UstadOrbState } from './UstadOrb';
import { UstadResultView } from './UstadResultView';

interface UstadHaderPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  // يمر تغيير المظهر عبر الشريط العلوي ليُحفظ في إعدادات المدرسة ويتحدث زر الوضع
  onThemeChange?: (mode: 'dark' | 'light') => void;
  // أمر يُنفَّذ فور الفتح، مثل «ملخص اليوم» من البطاقة الصباحية
  initialCommand?: string | null;
  onInitialCommandHandled?: () => void;
  // يتغير عند كل نداء صوتي، فتؤدي البطاقة حركة «الاستجابة»
  wakeSignal?: number;
}

const UNSUPPORTED_SPEECH_NOTICE = 'هذا المتصفح لا يدعم التعرّف على الكلام. يمكنك كتابة أمرك.';
const CLOSE_ANIMATION_MS = 180;
const AWAKEN_MS = 1400;

const QUICK_COMMANDS = [
  'ملخص اليوم',
  'كم طالب غائب اليوم؟',
  'اعرض غياب ثالث باء',
  'جهّز تقرير الأسبوع',
  'أرسل تنبيه لأولياء أمور الغائبين',
  'من في الانتظار اليوم؟',
  'افتح المراقبة اليومية'
];

const readBriefingAuto = () => {
  try {
    return localStorage.getItem(USTAD_BRIEFING_AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
};

const SettingSwitch: React.FC<{
  id: string;
  label: string;
  hint: string;
  // شارة قصيرة بجوار العنوان، مثل «قيد التطوير»
  badge?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, label, hint, badge, checked, disabled, onChange }) => (
  <div className="ustad-row">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span id={id} className="font-bold">{label}</span>
        {badge && <span className="ustad-badge ustad-badge--dev">{badge}</span>}
      </div>
      <div className="ustad-muted text-[11px]">{hint}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={id}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ustad-switch"
    />
  </div>
);

export const UstadHaderPanel: React.FC<UstadHaderPanelProps> = ({
  isOpen,
  onClose,
  currentUser,
  onThemeChange,
  initialCommand,
  onInitialCommandHandled,
  wakeSignal = 0
}) => {
  const navigate = useNavigate();

  // حالات التعرف والصوت
  const [isListening, setIsListening] = useState(() => ustadSpeech.getIsListening());
  const [listeningMode, setListeningMode] = useState<UstadListeningMode>(() => ustadSpeech.getListeningMode());
  const [isSpeaking, setIsSpeaking] = useState(() => ustadSpeech.getIsSpeaking());
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => ustadSpeech.getWakeWordPreference());
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(() => ustadSpeech.getVoiceReplyPreference());
  const [speechNotice, setSpeechNotice] = useState('');

  // المحادثة والنتائج
  const [liveTranscript, setLiveTranscript] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [activeResult, setActiveResult] = useState<UstadActionPayload | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // مظهر البطاقة
  const [showSettings, setShowSettings] = useState(false);
  const [closing, setClosing] = useState(false);
  const [awake, setAwake] = useState(false);
  const [learnedCount, setLearnedCount] = useState(() => learnedPhraseCount());
  const [briefingAuto, setBriefingAuto] = useState(readBriefingAuto);

  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processCommandRef = useRef<(text: string) => void>(() => undefined);
  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  wakeWordEnabledRef.current = wakeWordEnabled;
  const wasOpenRef = useRef(false);
  const closingRef = useRef(false);
  // سياق المحادثة الجارية، ليُفهم «وفي رابع أ؟» و«سجله حاضر»
  const conversationRef = useRef<UstadConversationContext | null>(null);
  const recognitionSupported = ustadSpeech.isRecognitionSupported();
  const synthesisSupported = ustadSpeech.isSynthesisSupported();

  // إغلاق مع حركة انسحاب قصيرة؛ يُبقي الرد الصوتي حين يكون الرد نفسه هو الوداع أو تأكيد التنقل
  const dismissPanel = useCallback((keepSpeech = false) => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (!keepSpeech) ustadSpeech.stopSpeaking(false);
    setClosing(true);
    setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  const goTo = useCallback((path: string) => {
    navigate(path);
    dismissPanel(true);
  }, [navigate, dismissPanel]);

  const presentResult = useCallback((result: UstadActionPayload) => {
    if (result.type === 'dismiss') {
      if (result.spokenText) ustadSpeech.speak(result.spokenText);
      dismissPanel(Boolean(result.spokenText));
      return;
    }
    if (result.type === 'silence') {
      ustadSpeech.stopSpeaking(true);
      return;
    }

    setActiveResult(result);
    if (result.context) conversationRef.current = result.context;

    if (result.type === 'theme_changed' && (result.data?.mode === 'dark' || result.data?.mode === 'light')) {
      if (onThemeChange) {
        onThemeChange(result.data.mode);
      } else {
        applyColorMode(result.data.mode, true);
      }
    }

    if (result.spokenText) ustadSpeech.speak(result.spokenText);
    if (result.type !== 'error' && result.type !== 'info') playSuccessChime();
  }, [onThemeChange, dismissPanel]);

  // تنفيذ الأمر الصوتي أو المكتوب
  const handleProcessCommand = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsProcessing(true);
    setCommandInput('');
    setShowSettings(false);

    try {
      presentResult(await ustadIntentEngine.executeCommand(trimmed, currentUser, goTo, conversationRef.current));
    } catch {
      presentResult({ type: 'error', title: 'حدث خطأ غير متوقع', spokenText: 'عفواً، تعذر تنفيذ الطلب حالياً.' });
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser, goTo, presentResult]);
  processCommandRef.current = (text) => {
    void handleProcessCommand(text);
  };

  const runAction = async (action: () => Promise<UstadActionPayload>, failure: UstadActionPayload) => {
    setIsProcessing(true);
    try {
      presentResult(await action());
    } catch {
      presentResult(failure);
    } finally {
      setIsProcessing(false);
    }
  };

  // تنفيذ إجراء بعد التأكيد الصريح (حضور، نداء خروج، تنبيهات غياب)
  const handleConfirmAction = (action: UstadPendingAction) => runAction(
    () => ustadIntentEngine.executeConfirmedAction(action, currentUser),
    { type: 'error', title: 'تعذر تنفيذ الإجراء', spokenText: 'عفواً، تعذر تنفيذ الإجراء حالياً.' }
  );

  // اختيار طالب من قائمة الأسماء المتشابهة يُكمل الطلب الأصلي نفسه
  const handleStudentChoice = (followUp: UstadStudentFollowUp, studentId: string, utterance?: string) => runAction(
    () => ustadIntentEngine.executeStudentFollowUp(followUp, studentId, currentUser, utterance),
    { type: 'error', title: 'تعذر متابعة الطلب', spokenText: 'عفواً، تعذر متابعة الطلب حالياً.' }
  );

  // اختيار اقتراح ينفّذ الأمر ويعلّم المساعد صياغة المستخدم على هذا الجهاز
  const handleSuggestion = async (suggestion: UstadSuggestion, utterance: string) => {
    await runAction(
      () => ustadIntentEngine.executeSuggestion(suggestion, utterance, currentUser, goTo),
      { type: 'error', title: 'تعذر تنفيذ الاقتراح', spokenText: 'عفواً، تعذر تنفيذ الأمر حالياً.' }
    );
    setLearnedCount(learnedPhraseCount());
  };

  // الاشتراك في خدمة الصوت دون إلغاء اشتراك الشريط العلوي
  useEffect(() => ustadSpeech.subscribe({
    onTranscript: (transcript) => setLiveTranscript(transcript),
    onCommand: (commandText) => processCommandRef.current(commandText),
    onSpeakingChange: (speaking) => setIsSpeaking(speaking),
    onVoiceReplyChange: (enabled) => setVoiceReplyEnabled(enabled),
    onListeningStateChange: (listening, mode) => {
      setIsListening(listening);
      setListeningMode(mode);
    },
    onError: (message, fatal) => {
      setIsProcessing(false);
      if (fatal) setSpeechNotice(message);
    }
  }), []);

  // عند الفتح، ابدأ الاستماع للأمر مباشرة
  useEffect(() => {
    if (!isOpen) return;
    if (recognitionSupported) {
      setSpeechNotice('');
      ustadSpeech.startActiveListening();
    } else {
      setSpeechNotice(UNSUPPORTED_SPEECH_NOTICE);
    }
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(focusTimer);
  }, [isOpen, recognitionSupported]);

  // فتح البطاقة من الملخص الصباحي ينفذ الأمر المطلوب مباشرة
  useEffect(() => {
    if (!isOpen || !initialCommand) return;
    processCommandRef.current(initialCommand);
    onInitialCommandHandled?.();
  }, [isOpen, initialCommand, onInitialCommandHandled]);

  // النداء الصوتي: حركة الاستجابة ثم صفحة نظيفة للأمر القادم
  useEffect(() => {
    if (!isOpen || !wakeSignal) return;
    setAwake(true);
    setActiveResult(null);
    setLiveTranscript('');
    const timer = setTimeout(() => setAwake(false), AWAKEN_MS);
    return () => clearTimeout(timer);
  }, [isOpen, wakeSignal]);

  // عند الإغلاق: عُد لوضع النداء أو أغلق الميكروفون، وابدأ المرة القادمة بصفحة نظيفة
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    closingRef.current = false;

    if (wakeWordEnabledRef.current) {
      ustadSpeech.startWakeWordStandby();
    } else {
      ustadSpeech.stopListening();
    }
    conversationRef.current = null;
    setClosing(false);
    setAwake(false);
    setShowSettings(false);
    setLiveTranscript('');
    setActiveResult(null);
  }, [isOpen]);

  // Esc يغلق، والنقر خارج البطاقة يغلقها كذلك (عدا زر الفتح نفسه)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissPanel();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || panelRef.current?.contains(target) || target.closest('[data-ustad-ignore-outside]')) return;
      dismissPanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, dismissPanel]);

  const toggleListening = () => {
    if (isListening && listeningMode === 'active_command') {
      ustadSpeech.stopListening();
      if (wakeWordEnabled) ustadSpeech.startWakeWordStandby();
      return;
    }
    setSpeechNotice('');
    if (!ustadSpeech.startActiveListening()) setSpeechNotice(UNSUPPORTED_SPEECH_NOTICE);
  };

  const handleWakeWordChange = (enabled: boolean) => {
    setWakeWordEnabled(enabled);
    ustadSpeech.setWakeWordPreference(enabled);
  };

  const handleVoiceReplyChange = (enabled: boolean) => {
    setVoiceReplyEnabled(enabled);
    ustadSpeech.setVoiceReplyPreference(enabled);
  };

  const handleBriefingAutoChange = (enabled: boolean) => {
    try {
      localStorage.setItem(USTAD_BRIEFING_AUTO_KEY, enabled ? 'on' : 'off');
    } catch {
      // Preference applies to this session only.
    }
    setBriefingAuto(enabled);
  };

  const handleForgetLearned = () => {
    forgetLearnedPhrases();
    setLearnedCount(0);
  };

  if (!isOpen) return null;

  const activeListening = isListening && listeningMode === 'active_command';
  const orbState: UstadOrbState = isProcessing ? 'thinking' : isSpeaking ? 'speaking' : activeListening ? 'listening' : 'idle';
  const wakeReady = wakeWordEnabled && recognitionSupported && !speechNotice;
  const statusText = speechNotice
    ? speechNotice
    : isProcessing
    ? 'لحظة، أنفّذ طلبك…'
    : isSpeaking
    ? 'أتحدث… قل «اسكت» لإيقافي'
    : activeListening
    ? 'أستمع إليك…'
    : wakeReady
    ? 'ناديني بـ «يا أستاذ حاضر» في أي وقت'
    : 'اكتب أمرك أو اضغط الميكروفون';

  return (
    <section
      ref={panelRef}
      dir="rtl"
      role="dialog"
      aria-labelledby="ustad-title"
      className="ustad-panel"
      data-state={orbState}
      data-closing={closing || undefined}
    >
      {awake && <span className="ustad-awaken" aria-hidden="true" />}

      {/* الرأس: الكرة الضوئية، الاسم، الحالة، والتحكم */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <UstadOrb state={orbState} awake={awake} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 id="ustad-title" className="text-base font-black tracking-wide">أستاذ حاضر</h2>
            {wakeReady && <span className="ustad-badge">النداء مفعّل</span>}
          </div>
          <p className={`text-xs ${speechNotice ? 'ustad-notice ustad-clamp-2' : 'ustad-muted truncate'}`} aria-live="polite">{statusText}</p>
        </div>
        {isSpeaking && (
          <button type="button" onClick={() => ustadSpeech.stopSpeaking(true)} className="ustad-btn ustad-btn--danger !py-1.5 !px-2.5 animate-pulse" title="إيقاف الرد الصوتي">
            <VolumeX className="w-4 h-4" />
            <span>اسكت</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowSettings(open => !open)}
          aria-label="الإعدادات"
          aria-expanded={showSettings}
          className="ustad-icon-btn"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => dismissPanel()} aria-label="إغلاق" className="ustad-icon-btn">
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* الجسد: ما قيل، والنتيجة، والاقتراحات */}
      <div className="ustad-scroll flex-1 min-h-0 px-4 pb-3 flex flex-col gap-3">
        {(liveTranscript || activeListening || awake) && (
          <div className="flex items-center gap-2 min-h-[1.75rem]">
            {activeListening && (
              <span className="ustad-wave" aria-hidden="true">
                <span className="animate-soundwave-1" />
                <span className="animate-soundwave-2" />
                <span className="animate-soundwave-3" />
                <span className="animate-soundwave-4" />
                <span className="animate-soundwave-5" />
              </span>
            )}
            {liveTranscript ? (
              <p className="ustad-transcript">{liveTranscript}</p>
            ) : (
              <p className="text-sm ustad-muted">{awake ? 'نعم؟ تفضّل…' : 'تفضّل، أستمع إليك…'}</p>
            )}
          </div>
        )}

        {activeResult && (
          <UstadResultView
            result={activeResult}
            isProcessing={isProcessing}
            onNavigate={goTo}
            onCommand={(text) => void handleProcessCommand(text)}
            onConfirm={(action) => void handleConfirmAction(action)}
            onChooseStudent={(followUp, studentId, utterance) => void handleStudentChoice(followUp, studentId, utterance)}
            onSuggestion={(suggestion, utterance) => void handleSuggestion(suggestion, utterance)}
            onCancel={() => setActiveResult(null)}
          />
        )}

        {!activeResult && !isProcessing && !showSettings && (
          <div className="flex flex-wrap gap-2">
            {QUICK_COMMANDS.map(command => (
              <button key={command} type="button" onClick={() => void handleProcessCommand(command)} className="ustad-chip">
                {command}
              </button>
            ))}
          </div>
        )}

        {showSettings && (
          <div className="ustad-drawer space-y-2">
            <SettingSwitch
              id="ustad-setting-wake"
              label="النداء الصوتي «يا أستاذ حاضر»"
              hint="الاستجابة فور سماع النداء"
              checked={wakeWordEnabled}
              disabled={!recognitionSupported}
              onChange={handleWakeWordChange}
            />
            <SettingSwitch
              id="ustad-setting-voice-reply"
              label="الرد الصوتي"
              badge="قيد التطوير"
              hint="نطق الردود بصوت المساعد. مغلق افتراضياً حتى يكتمل"
              checked={voiceReplyEnabled}
              disabled={!synthesisSupported}
              onChange={handleVoiceReplyChange}
            />
            <SettingSwitch
              id="ustad-setting-briefing"
              label="الملخص الصباحي تلقائياً"
              hint="بطاقة اليوم بعد انتهاء مهلة الحضور"
              checked={briefingAuto}
              onChange={handleBriefingAutoChange}
            />
            <div className="ustad-row">
              <span>ما تعلّمه المساعد من صياغاتك: <strong>{learnedCount}</strong></span>
              <button type="button" onClick={handleForgetLearned} disabled={learnedCount === 0} className="ustad-btn !py-1 !px-2.5 !text-[11px]">مسح</button>
            </div>
            <p className="ustad-muted text-[11px] leading-relaxed">
              <kbd className="ustad-kbd">Alt + H</kbd> فتح وإغلاق · <kbd className="ustad-kbd">Esc</kbd> إغلاق · {voiceReplyEnabled ? 'قل «اسكت» لإيقاف الرد، و«أغلق» لإخفاء البطاقة.' : 'قل «أغلق» لإخفاء البطاقة.'}
            </p>
          </div>
        )}
      </div>

      {/* الإدخال: ميكروفون، كتابة، إرسال */}
      <footer className="ustad-footer flex items-center gap-2 px-4 pb-4 pt-3">
        {recognitionSupported && (
          <button
            type="button"
            onClick={toggleListening}
            data-active={activeListening || undefined}
            aria-pressed={activeListening}
            aria-label={activeListening ? 'إيقاف الميكروفون' : 'تشغيل الميكروفون'}
            title={activeListening ? 'إيقاف الاستماع' : 'تفعيل الميكروفون والتحدث'}
            className="ustad-mic"
          >
            {activeListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleProcessCommand(commandInput);
          }}
          className="flex-1 min-w-0 flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            placeholder="اكتب أو تحدّث… مثل: كم الغياب اليوم؟"
            className="ustad-input"
          />
          <button type="submit" disabled={!commandInput.trim() || isProcessing} className="ustad-icon-btn ustad-icon-btn--send" title="إرسال الأمر">
            <Send className="w-4 h-4 -scale-x-100" />
          </button>
        </form>
      </footer>
    </section>
  );
};

export default UstadHaderPanel;
