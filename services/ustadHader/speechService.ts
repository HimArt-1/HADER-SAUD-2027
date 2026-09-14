// =============================================================================
// نظام حاضر (Hader) - خدمة التعرف والنطق الصوتي لـ «أستاذ حاضر»
// =============================================================================
// توفير التعرف على الكلام باللغة العربية (STT)، النطق الصوتي (TTS)، كشف كلمة النداء، والإسكات الفوري

import { playWakeChime, playStopChime } from './audioEffects';

export const USTAD_WAKE_WORD_STORAGE_KEY = 'hader:ustad_wake_word_enabled';

export type UstadListeningMode = 'idle' | 'wake_word_standby' | 'active_command';

// مدة تجاهل نتائج التعرف بعد انتهاء الرد الصوتي، حتى لا يُنفَّذ صدى صوت المساعد كأمر جديد
const ECHO_SUPPRESSION_MS = 700;
const RESTART_DELAY_MS = 400;

// أخطاء لا تزول بإعادة التشغيل؛ الاستمرار بعدها يُدخل الخدمة في حلقة إعادة لا تنتهي
const FATAL_RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': 'لم يُسمح باستخدام الميكروفون. فعّل الإذن من إعدادات المتصفح، أو اكتب أمرك.',
  'service-not-allowed': 'خدمة التعرّف على الكلام غير متاحة هنا. يمكنك كتابة أمرك.',
  'audio-capture': 'لم يُعثر على ميكروفون متصل بالجهاز. يمكنك كتابة أمرك.',
  network: 'تعذر الاتصال بخدمة التعرّف على الكلام. يمكنك كتابة أمرك.',
  'language-not-supported': 'التعرّف على الكلام العربي غير مدعوم في هذا المتصفح. يمكنك كتابة أمرك.'
};

// تطبيع النصوص العربية لمطابقة الكلمات بدقة
export function normalizeArabicSpeech(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(/[ً-ٰٟ]/g, '') // إزالة التشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^ء-ي0-9a-zA-Z\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// «يا أستاذ حاضر» ككلمة مستقلة، فلا تُوقظ المساعدَ جملةٌ مدرسية مثل «الأستاذ حاضر اليوم»
const WAKE_WORD_PATTERN = /(?:^|\s)(?:يا\s*)?استاذ\s*حاضر(?=\s|$)/;

// فحص هل يحتوي النص على نداء «يا أستاذ حاضر»
export function containsWakeWord(text: string): boolean {
  return WAKE_WORD_PATTERN.test(normalizeArabicSpeech(text));
}

// إزالة كلمة النداء من الأمر: «يا أستاذ حاضر، افتح التقارير» ← «افتح التقارير»
export function stripWakeWord(text: string): string {
  const norm = normalizeArabicSpeech(text);
  if (!WAKE_WORD_PATTERN.test(norm)) return text.trim();
  return norm.replace(WAKE_WORD_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

// فحص هل يحتوي النص على أمر إسكات الرد «اسكت»
export function containsSilenceCommand(text: string): boolean {
  const norm = normalizeArabicSpeech(text);
  const silenceWords = ['اسكت', 'توقف', 'اصمت', 'صامت', 'بس', 'خلاص', 'الغاء الرد'];
  return silenceWords.some(w => norm === w || norm.startsWith(w + ' ') || norm.endsWith(' ' + w));
}

type UstadSpeechEvents = {
  onTranscript: [transcript: string, isFinal: boolean];
  onCommand: [commandText: string];
  onWakeWordDetected: [];
  onSpeakingChange: [isSpeaking: boolean];
  onListeningStateChange: [isListening: boolean, mode: UstadListeningMode];
  onError: [message: string, fatal: boolean];
};

export type UstadSpeechListener = {
  [K in keyof UstadSpeechEvents]?: (...args: UstadSpeechEvents[K]) => void;
};

export class UstadSpeechService {
  private recognition: any = null;
  private isListening = false;
  private listeningMode: UstadListeningMode = 'idle';
  private lastListeningState = '';
  private wakeWordEnabled = false;
  private isSpeaking = false;
  private listeners = new Set<UstadSpeechListener>();
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldKeepListening = false;
  private suppressResultsUntil = 0;

  constructor() {
    this.wakeWordEnabled = this.loadWakeWordPreference();
  }

  public isRecognitionSupported(): boolean {
    return typeof window !== 'undefined' && Boolean(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    );
  }

  public loadWakeWordPreference(): boolean {
    try {
      return localStorage.getItem(USTAD_WAKE_WORD_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  public setWakeWordPreference(enabled: boolean): void {
    this.wakeWordEnabled = enabled;
    try {
      localStorage.setItem(USTAD_WAKE_WORD_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore storage error
    }

    // إذا تم تفعيل النداء الصوتي، ابدأ الاستماع في وضع الاستعداد
    if (enabled && this.listeningMode === 'idle') {
      this.startWakeWordStandby();
    } else if (!enabled && this.listeningMode === 'wake_word_standby') {
      this.stopListening();
    }
  }

  public getWakeWordPreference(): boolean {
    return this.wakeWordEnabled;
  }

  /**
   * الاشتراك في أحداث الخدمة. يتلقى كل مشترك الأحداث دون أن يُلغي مشتركاً آخر.
   */
  public subscribe(listener: UstadSpeechListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit<K extends keyof UstadSpeechEvents>(event: K, ...args: UstadSpeechEvents[K]): void {
    this.listeners.forEach(listener => {
      const handler = listener[event] as ((...values: UstadSpeechEvents[K]) => void) | undefined;
      handler?.(...args);
    });
  }

  private notifyListeningState(): void {
    const state = `${this.isListening}:${this.listeningMode}`;
    if (state === this.lastListeningState) return;
    this.lastListeningState = state;
    this.emit('onListeningStateChange', this.isListening, this.listeningMode);
  }

  private initRecognition(): boolean {
    if (this.recognition) return true;
    if (!this.isRecognitionSupported()) return false;

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    try {
      const rec = new SpeechRecognitionClass();
      rec.lang = 'ar-SA';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.isListening = true;
        this.notifyListeningState();
      };
      rec.onresult = (event: any) => this.handleResult(event);
      rec.onerror = (event: any) => this.handleError(event?.error);
      rec.onend = () => this.handleEnd();

      this.recognition = rec;
      return true;
    } catch (e) {
      console.error('[UstadSpeechService] Init failed:', e);
      return false;
    }
  }

  private handleResult(event: any): void {
    let interimText = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const res = event.results[i];
      if (res.isFinal) {
        finalText += res[0].transcript;
      } else {
        interimText += res[0].transcript;
      }
    }
    interimText = interimText.trim();
    finalText = finalText.trim();

    // 1. قد يلتقط الميكروفون صوت المساعد نفسه؛ أثناء الرد لا يُقبل إلا أمر الإسكات
    if (this.isSpeaking) {
      if (containsSilenceCommand(interimText) || containsSilenceCommand(finalText)) {
        this.stopSpeaking(true);
      }
      return;
    }
    if (Date.now() < this.suppressResultsUntil) return;

    // 2. وضع الاستعداد لكلمة النداء («يا أستاذ حاضر»)
    if (this.listeningMode === 'wake_word_standby') {
      if (!containsWakeWord(finalText || interimText)) return;
      playWakeChime();
      this.listeningMode = 'active_command';
      this.emit('onWakeWordDetected');
      this.notifyListeningState();
      // «يا أستاذ حاضر، كم الغياب؟» في نفَس واحد يحمل أمره معه
      if (finalText) this.dispatchFinal(finalText);
      return;
    }

    // 3. وضع استماع الأمر المباشر
    if (this.listeningMode !== 'active_command') return;
    if (interimText) {
      this.emit('onTranscript', interimText, false);
    }
    if (finalText) {
      this.dispatchFinal(finalText);
    }
  }

  private dispatchFinal(text: string): void {
    const command = stripWakeWord(text);
    if (!command) return;
    this.emit('onTranscript', command, true);
    this.emit('onCommand', command);
  }

  private handleError(code: string | undefined): void {
    // الصمت والإيقاف المقصود ليسا أخطاء
    if (code === 'no-speech' || code === 'aborted') return;

    const fatalMessage = code ? FATAL_RECOGNITION_ERRORS[code] : undefined;
    if (fatalMessage) {
      this.stopListening();
      this.emit('onError', fatalMessage, true);
      return;
    }
    this.emit('onError', 'حدث خطأ مؤقت في استقبال الصوت.', false);
  }

  private handleEnd(): void {
    this.isListening = false;
    if (!this.shouldKeepListening) {
      this.listeningMode = 'idle';
      this.notifyListeningState();
      return;
    }

    // إعادة التشغيل تلقائياً دون إظهار انقطاع في الواجهة
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.shouldKeepListening && this.recognition && !this.isListening) {
        this.beginRecognition();
      }
    }, RESTART_DELAY_MS);
  }

  private beginRecognition(): boolean {
    try {
      this.recognition.start();
      return true;
    } catch (error) {
      // InvalidStateError: الجلسة تعمل أو قيد البدء بالفعل
      return (error as { name?: string })?.name === 'InvalidStateError';
    }
  }

  /**
   * بدء الاستماع لأمر مباشر (بضغط الزر أو الاختصار)
   */
  public startActiveListening(): boolean {
    if (!this.initRecognition()) return false;
    this.stopSpeaking(false);
    this.shouldKeepListening = true;
    this.listeningMode = 'active_command';

    if (this.isListening) {
      // إذا كان يعمل بالفعل في وضع النداء، غيّر الحالة فقط
      this.notifyListeningState();
    } else if (!this.beginRecognition()) {
      return false;
    }
    playWakeChime();
    return true;
  }

  /**
   * بدء الاستماع لكلمة النداء في الخلفية (عند تفعيل الخيار)
   */
  public startWakeWordStandby(): boolean {
    if (!this.wakeWordEnabled) return false;
    if (!this.initRecognition()) return false;

    this.shouldKeepListening = true;
    this.listeningMode = 'wake_word_standby';

    if (this.isListening) {
      this.notifyListeningState();
      return true;
    }
    return this.beginRecognition();
  }

  /**
   * إيقاف الاستماع
   */
  public stopListening(): void {
    this.shouldKeepListening = false;
    this.listeningMode = 'idle';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const wasListening = this.isListening;
    this.isListening = false;
    this.notifyListeningState();
    if (this.recognition && wasListening) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop error
      }
    }
  }

  /**
   * نطق الرد الصوتي مع سرعة مريحة ونبرة وقورة
   */
  public speak(text: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    this.stopSpeaking(false);

    const cleanText = text.replace(/[*#_`]/g, '').trim();
    if (!cleanText) return;

    try {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'ar-SA';
      utterance.rate = 0.96;
      utterance.pitch = 1.0;

      // اختيار صوت عربي مناسب إن وجد
      const voices = window.speechSynthesis.getVoices();
      const arabicVoice = voices.find(v =>
        v.lang.startsWith('ar') ||
        v.name.includes('Arabic') ||
        v.name.includes('Maged') ||
        v.name.includes('Tarik') ||
        v.name.includes('Laila') ||
        v.name.includes('Zeina')
      );
      if (arabicVoice) {
        utterance.voice = arabicVoice;
      }

      utterance.onstart = () => this.setSpeaking(true);
      const finish = () => {
        // رد أُلغي واستُبدل بآخر لا يغيّر الحالة
        if (this.activeUtterance !== utterance) return;
        this.activeUtterance = null;
        this.setSpeaking(false);
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      this.activeUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch {
      this.activeUtterance = null;
      this.setSpeaking(false);
    }
  }

  private setSpeaking(speaking: boolean): void {
    const wasSpeaking = this.isSpeaking;
    this.isSpeaking = speaking;
    if (wasSpeaking === speaking) return;
    if (!speaking) this.discardEcho();
    this.emit('onSpeakingChange', speaking);
  }

  // ما التُقط أثناء الرد هو صوت المساعد نفسه: أسقطه وابدأ جلسة استماع نظيفة
  private discardEcho(): void {
    this.suppressResultsUntil = Date.now() + ECHO_SUPPRESSION_MS;
    if (!this.recognition || !this.isListening) return;
    try {
      this.recognition.abort();
    } catch {
      // Recognition already stopped
    }
  }

  /**
   * إيقاف الرد الصوتي فوراً («اسكت»)
   */
  public stopSpeaking(playChime = true): void {
    this.activeUtterance = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.setSpeaking(false);
    if (playChime) {
      playStopChime();
    }
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  public getListeningMode(): UstadListeningMode {
    return this.listeningMode;
  }
}

export const ustadSpeech = new UstadSpeechService();
