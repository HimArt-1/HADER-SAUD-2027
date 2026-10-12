import { useCallback, useEffect, useRef, useState } from 'react';

// Web Speech is not included in the project's DOM typings in every browser.
interface RecognitionResult extends ArrayLike<{ transcript: string }> { isFinal: boolean }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;
type SpeechWindow = Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };

export type GuardVoiceState = {
  phase: 'idle' | 'starting' | 'listening' | 'processing' | 'review' | 'error';
  transcript: string;
  error: string;
};
const initialState: GuardVoiceState = { phase: 'idle', transcript: '', error: '' };
const noSpeech = 'لم أسمع اسمًا واضحًا. أعد التسجيل وقل اسم الطالب كاملًا.';
const recognitionErrors: Record<string, string> = {
  'not-allowed': 'لم يُسمح باستخدام المايك. فعّل إذن الميكروفون من إعدادات المتصفح ثم أعد المحاولة.',
  'service-not-allowed': 'خدمة التعرف على الصوت غير متاحة في هذا المتصفح. استخدم الأرقام أو قائمة الطلاب.',
  'audio-capture': 'لم أجد ميكروفونًا متاحًا. تحقق من توصيله ثم أعد المحاولة.',
  network: 'تعذر الاتصال بخدمة التعرف على الصوت. تحقق من الإنترنت ثم أعد المحاولة.',
  'language-not-supported': 'التعرف على الصوت بالعربية غير متاح هنا. استخدم الأرقام أو قائمة الطلاب.',
  'no-speech': noSpeech,
  aborted: 'توقف التسجيل. اضغط المايك للمحاولة مرة أخرى.'
};

export function useGuardVoiceInput() {
  const [state, setState] = useState<GuardVoiceState>(initialState);
  const recognitionRef = useRef<Recognition | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);
  const Constructor = typeof window === 'undefined' ? undefined :
    (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;

  const release = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    stopRequestedRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    // Invalidate callbacks before aborting so late results cannot select a student.
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
    try { recognition.abort(); } catch { /* Already ended. */ }
  }, []);

  const cancel = useCallback(() => { release(); setState(initialState); }, [release]);
  const fail = useCallback((message: string) => {
    release();
    setState(previous => ({ ...previous, phase: 'error', error: message }));
  }, [release]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    stopRequestedRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setState(previous => ({ ...previous, phase: 'processing' }));
    // stop() may deliver a final result asynchronously; never match interim text.
    timerRef.current = window.setTimeout(() => fail(noSpeech), 4000);
    try { recognition.stop(); } catch { fail(noSpeech); }
  }, [fail]);

  const start = useCallback(() => {
    release();
    setState(initialState);
    if (!Constructor) {
      fail('هذا المتصفح لا يدعم التعرف على الصوت. استخدم الأرقام أو قائمة الطلاب.');
      return;
    }
    if (window.isSecureContext === false) {
      fail('افتح المحطة عبر اتصال HTTPS لاستخدام المايك. يمكنك استخدام الأرقام أو قائمة الطلاب.');
      return;
    }
    try {
      const recognition = new Constructor();
      recognitionRef.current = recognition;
      recognition.lang = 'ar-SA';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (recognitionRef.current !== recognition || stopRequestedRef.current) return;
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        setState(previous => ({ ...previous, phase: 'listening' }));
        timerRef.current = window.setTimeout(stop, 15000);
      };
      recognition.onresult = event => {
        if (recognitionRef.current !== recognition) return;
        const results = Array.from(event.results);
        const finalText = results.filter(result => result.isFinal).map(result => result[0]?.transcript || '').join(' ').trim();
        if (finalText) {
          release();
          setState({ phase: 'review', transcript: finalText, error: '' });
        } else {
          const transcript = results.map(result => result[0]?.transcript || '').join(' ').trim();
          setState(previous => ({ ...previous, transcript }));
        }
      };
      recognition.onerror = event => {
        if (recognitionRef.current === recognition) fail(recognitionErrors[event.error] || 'تعذر استقبال الصوت. أعد المحاولة أو استخدم قائمة الطلاب.');
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) fail(noSpeech);
      };
      setState({ phase: 'starting', transcript: '', error: '' });
      timerRef.current = window.setTimeout(() => fail('تعذر بدء التسجيل. تحقق من إذن المايك ثم أعد المحاولة.'), 20000);
      // Called directly from the microphone click, preserving user activation.
      recognition.start();
    } catch (error) {
      fail((error as { name?: string })?.name === 'NotAllowedError'
        ? recognitionErrors['not-allowed'] : 'تعذر بدء التسجيل. تحقق من المايك ثم أعد المحاولة.');
    }
  }, [Constructor, fail, release, stop]);

  useEffect(() => {
    const handleVisibility = () => { if (document.hidden && recognitionRef.current) cancel(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { document.removeEventListener('visibilitychange', handleVisibility); release(); };
  }, [cancel, release]);

  return { ...state, supported: Boolean(Constructor), start, stop, cancel,
    recording: state.phase === 'starting' || state.phase === 'listening',
    busy: state.phase === 'starting' || state.phase === 'listening' || state.phase === 'processing' };
}
