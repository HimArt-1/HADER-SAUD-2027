// =============================================================================
// نظام حاضر (Hader) - المؤثرات الصوتية التوليدية لـ «أستاذ حاضر»
// =============================================================================
// توليد نغمات تفاعلية فورية باستخدام Web Audio API دون أي ملفات صوتية خارجية

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtxClass();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * نغمة استجابة وترحيب صاعدة ثلاثية عذبة (C5 -> E5 -> G5)
 * تُعزف عند نداء «يا أستاذ حاضر» أو بدء الاستماع
 */
export function playWakeChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, time: 0.00, dur: 0.16 }, // C5
      { freq: 659.25, time: 0.08, dur: 0.18 }, // E5
      { freq: 783.99, time: 0.17, dur: 0.28 }, // G5
    ];

    notes.forEach(({ freq, time, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + time);

      // Subtle harmonic warmth
      gain.gain.setValueAtTime(0, now + time);
      gain.gain.linearRampToValueAtTime(0.18, now + time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + dur + 0.01);
    });
  } catch {
    // Graceful fallback if Web Audio is blocked by browser policy
  }
}

/**
 * نغمة تأكيد وإنجاز ناعمة عند إتمام الطلب بنجاح
 */
export function playSuccessChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 659.25, time: 0.00, dur: 0.12 }, // E5
      { freq: 880.00, time: 0.09, dur: 0.25 }, // A5
    ];

    notes.forEach(({ freq, time, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + time);

      gain.gain.setValueAtTime(0, now + time);
      gain.gain.linearRampToValueAtTime(0.14, now + time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + dur + 0.01);
    });
  } catch {
    // Ignore audio error
  }
}

/**
 * نغمة خافتة قصيرة عند إسكات الرد الصوتي أو التوقف
 */
export function playStopChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.12);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  } catch {
    // Ignore audio error
  }
}
