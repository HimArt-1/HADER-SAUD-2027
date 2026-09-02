import { useCallback, useRef, useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════════
// 🔔 Sound Effects Hook
// أصوات تنبيه للأحداث المختلفة باستخدام Web Audio API
// ═══════════════════════════════════════════════════════════════

export type SoundType = 'success' | 'error' | 'warning' | 'notification' | 'send' | 'receive' | 'click';

export interface UseSoundEffectsOptions {
  /** تفعيل الأصوات (الافتراضي: true) */
  enabled?: boolean;
  /** مستوى الصوت (0-1) */
  volume?: number;
}

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  decay?: number;
  harmonics?: { frequency: number; amplitude: number }[];
}

const SOUND_CONFIGS: Record<SoundType, SoundConfig> = {
  success: {
    frequency: 880, // A5
    duration: 0.15,
    type: 'sine',
    harmonics: [
      { frequency: 1108.73, amplitude: 0.5 }, // C#6
      { frequency: 1318.51, amplitude: 0.3 }, // E6
    ],
  },
  error: {
    frequency: 220, // A3
    duration: 0.3,
    type: 'sawtooth',
    decay: 0.2,
  },
  warning: {
    frequency: 440, // A4
    duration: 0.2,
    type: 'triangle',
    harmonics: [
      { frequency: 554.37, amplitude: 0.4 }, // C#5
    ],
  },
  notification: {
    frequency: 587.33, // D5
    duration: 0.1,
    type: 'sine',
    harmonics: [
      { frequency: 880, amplitude: 0.3 }, // A5
    ],
  },
  send: {
    frequency: 523.25, // C5
    duration: 0.08,
    type: 'sine',
    harmonics: [
      { frequency: 659.25, amplitude: 0.4 }, // E5
      { frequency: 783.99, amplitude: 0.2 }, // G5
    ],
  },
  receive: {
    frequency: 659.25, // E5
    duration: 0.1,
    type: 'sine',
    harmonics: [
      { frequency: 783.99, amplitude: 0.3 }, // G5
    ],
  },
  click: {
    frequency: 1000,
    duration: 0.03,
    type: 'sine',
  },
};

const SOUND_MUTED_KEY = 'whatsapp_sound_muted';

export function useSoundEffects(options: UseSoundEffectsOptions = {}) {
  const { enabled = true, volume = 0.3 } = options;
  
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // تحميل حالة الكتم من localStorage أو استخدام القيمة الافتراضية
  const [isMuted, setIsMuted] = useState(() => {
    try {
      const saved = localStorage.getItem(SOUND_MUTED_KEY);
      if (saved !== null) {
        return saved === 'true';
      }
    } catch {
      // تجاهل أخطاء localStorage
    }
    return !enabled;
  });
  
  const [currentVolume, setCurrentVolume] = useState(volume);
  
  // حفظ حالة الكتم في localStorage عند التغيير
  useEffect(() => {
    try {
      localStorage.setItem(SOUND_MUTED_KEY, String(isMuted));
    } catch {
      // تجاهل أخطاء localStorage
    }
  }, [isMuted]);

  // إنشاء AudioContext عند الحاجة
  const getAudioContext = useCallback(() => {
    // التحقق إذا كان السياق مغلقاً أو غير موجود
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.warn('فشل إنشاء AudioContext:', e);
        return null;
      }
    }
    
    // استئناف السياق إذا كان معلقاً
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {
        // تجاهل أخطاء الاستئناف
      });
    }
    
    return audioContextRef.current;
  }, []);

  // تشغيل صوت
  const playSound = useCallback((type: SoundType) => {
    if (isMuted) return;
    
    try {
      const audioContext = getAudioContext();
      
      // التحقق من أن السياق صالح ومفتوح
      if (!audioContext || audioContext.state === 'closed') {
        return;
      }
      
      const config = SOUND_CONFIGS[type];
      const now = audioContext.currentTime;
      
      // إنشاء GainNode للتحكم في الصوت
      const masterGain = audioContext.createGain();
      masterGain.connect(audioContext.destination);
      masterGain.gain.setValueAtTime(currentVolume, now);
      
      // إنشاء الموجة الأساسية
      const oscillator = audioContext.createOscillator();
      oscillator.type = config.type;
      oscillator.frequency.setValueAtTime(config.frequency, now);
      
      // إنشاء envelope للصوت
      const gainNode = audioContext.createGain();
      gainNode.connect(masterGain);
      
      // Attack & Decay
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(1, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        now + config.duration * (config.decay || 1)
      );
      
      oscillator.connect(gainNode);
      oscillator.start(now);
      oscillator.stop(now + config.duration);
      
      // إضافة التوافقيات (Harmonics) لصوت أغنى
      if (config.harmonics) {
        config.harmonics.forEach((harmonic) => {
          const harmonicOsc = audioContext.createOscillator();
          harmonicOsc.type = config.type;
          harmonicOsc.frequency.setValueAtTime(harmonic.frequency, now);
          
          const harmonicGain = audioContext.createGain();
          harmonicGain.connect(masterGain);
          harmonicGain.gain.setValueAtTime(0, now);
          harmonicGain.gain.linearRampToValueAtTime(harmonic.amplitude, now + 0.01);
          harmonicGain.gain.exponentialRampToValueAtTime(0.01, now + config.duration);
          
          harmonicOsc.connect(harmonicGain);
          harmonicOsc.start(now);
          harmonicOsc.stop(now + config.duration);
        });
      }
      
    } catch (error) {
      console.warn('فشل تشغيل الصوت:', error);
    }
  }, [isMuted, currentVolume, getAudioContext]);

  // أصوات محددة مسبقاً
  const playSuccess = useCallback(() => playSound('success'), [playSound]);
  const playError = useCallback(() => playSound('error'), [playSound]);
  const playWarning = useCallback(() => playSound('warning'), [playSound]);
  const playNotification = useCallback(() => playSound('notification'), [playSound]);
  const playSend = useCallback(() => playSound('send'), [playSound]);
  const playReceive = useCallback(() => playSound('receive'), [playSound]);
  const playClick = useCallback(() => playSound('click'), [playSound]);

  // تنظيف عند الإلغاء
  useEffect(() => {
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {
          // تجاهل أخطاء الإغلاق
        });
      }
    };
  }, []);

  // تحديث حالة الصوت
  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  const setVolume = useCallback((vol: number) => {
    setCurrentVolume(Math.max(0, Math.min(1, vol)));
  }, []);

  return {
    playSound,
    playSuccess,
    playError,
    playWarning,
    playNotification,
    playSend,
    playReceive,
    playClick,
    isMuted,
    toggleMute,
    volume: currentVolume,
    setVolume,
    setMuted: setIsMuted,
  };
}

// ═══════════════════════════════════════════════════════════════
// 🎯 Context للأصوات على مستوى التطبيق
// ═══════════════════════════════════════════════════════════════

import React, { createContext, useContext, ReactNode } from 'react';

type SoundEffectsContextType = ReturnType<typeof useSoundEffects>;

const SoundEffectsContext = createContext<SoundEffectsContextType | null>(null);

export const SoundEffectsProvider: React.FC<{
  children: ReactNode;
  options?: UseSoundEffectsOptions;
}> = ({ children, options }) => {
  const soundEffects = useSoundEffects(options);
  
  return (
    <SoundEffectsContext.Provider value={soundEffects}>
      {children}
    </SoundEffectsContext.Provider>
  );
};

export const useSoundEffectsContext = () => {
  const context = useContext(SoundEffectsContext);
  if (!context) {
    throw new Error('useSoundEffectsContext must be used within SoundEffectsProvider');
  }
  return context;
};

// ═══════════════════════════════════════════════════════════════
// 🔊 مكون زر التحكم في الصوت
// ═══════════════════════════════════════════════════════════════

export default useSoundEffects;
