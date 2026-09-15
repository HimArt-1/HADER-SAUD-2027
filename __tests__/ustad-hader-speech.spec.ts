import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chimes = vi.hoisted(() => ({ playWakeChime: vi.fn(), playStopChime: vi.fn(), playSuccessChime: vi.fn() }));
vi.mock('../services/ustadHader/audioEffects', () => chimes);

import { UstadSpeechService, containsWakeWord, stripWakeWord } from '../services/ustadHader/speechService';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart?: () => void;
  onresult?: (event: unknown) => void;
  onerror?: (event: { error: string }) => void;
  onend?: () => void;
  start = vi.fn(() => {
    this.onstart?.();
  });
  stop = vi.fn(() => {
    this.onend?.();
  });
  abort = vi.fn(() => {
    this.onerror?.({ error: 'aborted' });
    this.onend?.();
  });

  constructor() {
    FakeRecognition.instances.push(this);
  }

  hear(transcript: string, isFinal: boolean) {
    const result = Object.assign([{ transcript }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }

  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
}

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  voice: unknown = null;
  onstart?: () => void;
  onend?: () => void;
  onerror?: () => void;

  constructor(text: string) {
    this.text = text;
  }
}

const synth = {
  current: null as FakeUtterance | null,
  speak: vi.fn((utterance: FakeUtterance) => {
    synth.current = utterance;
    utterance.onstart?.();
  }),
  cancel: vi.fn(() => {
    const utterance = synth.current;
    synth.current = null;
    utterance?.onerror?.();
  }),
  getVoices: () => [],
  finish() {
    const utterance = synth.current;
    synth.current = null;
    utterance?.onend?.();
  }
};

const recordCommands = (service: UstadSpeechService) => {
  const commands: string[] = [];
  service.subscribe({ onCommand: text => commands.push(text) });
  return commands;
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  FakeRecognition.instances = [];
  synth.current = null;
  const globals = { SpeechRecognition: FakeRecognition, SpeechSynthesisUtterance: FakeUtterance, speechSynthesis: synth };
  Object.entries(globals).forEach(([name, value]) => vi.stubGlobal(name, value));
  Object.assign(window, globals);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UstadSpeechService', () => {
  it('listens for the wake word by default and remembers being switched off', () => {
    expect(new UstadSpeechService().getWakeWordPreference()).toBe(true);
    localStorage.setItem('hader:ustad_wake_word_enabled', 'false');
    expect(new UstadSpeechService().getWakeWordPreference()).toBe(false);
  });

  it('chimes once for a wake-word call, not again when the card opens', () => {
    const service = new UstadSpeechService();
    service.startWakeWordStandby();
    FakeRecognition.instances[0].hear('يا أستاذ حاضر', true);
    expect(chimes.playWakeChime).toHaveBeenCalledTimes(1);

    service.startActiveListening();
    expect(chimes.playWakeChime).toHaveBeenCalledTimes(1);

    service.stopListening();
    service.startActiveListening();
    expect(chimes.playWakeChime).toHaveBeenCalledTimes(2);
  });

  it('delivers each final command exactly once', () => {
    const service = new UstadSpeechService();
    const commands = recordCommands(service);
    const transcripts: Array<[string, boolean]> = [];
    service.subscribe({ onTranscript: (text, isFinal) => transcripts.push([text, isFinal]) });

    expect(service.startActiveListening()).toBe(true);
    const recognition = FakeRecognition.instances[0];
    recognition.hear('كم الغياب', false);
    recognition.hear('كم الغياب اليوم', true);

    expect(commands).toEqual(['كم الغياب اليوم']);
    expect(transcripts).toEqual([['كم الغياب', false], ['كم الغياب اليوم', true]]);
  });

  it('keeps every subscriber informed instead of replacing earlier ones', () => {
    const service = new UstadSpeechService();
    const layoutStates: boolean[] = [];
    const modalStates: boolean[] = [];
    service.subscribe({ onListeningStateChange: listening => layoutStates.push(listening) });
    const unsubscribeModal = service.subscribe({ onListeningStateChange: listening => modalStates.push(listening) });

    service.startActiveListening();
    unsubscribeModal();
    service.stopListening();

    expect(layoutStates).toEqual([true, false]);
    expect(modalStates).toEqual([true]);
  });

  it('wakes on «يا أستاذ حاضر» and runs a command spoken in the same breath', () => {
    localStorage.setItem('hader:ustad_wake_word_enabled', 'true');
    const service = new UstadSpeechService();
    const commands = recordCommands(service);
    const wakes = vi.fn();
    service.subscribe({ onWakeWordDetected: wakes });

    service.startWakeWordStandby();
    const recognition = FakeRecognition.instances[0];
    recognition.hear('يا أستاذ', false);
    expect(wakes).not.toHaveBeenCalled();

    recognition.hear('يا أستاذ حاضر', false);
    expect(wakes).toHaveBeenCalledTimes(1);
    expect(commands).toEqual([]);

    recognition.hear('يا أستاذ حاضر كم الغياب', true);
    expect(commands).toEqual(['كم الغياب']);
    expect(service.getListeningMode()).toBe('active_command');
  });

  it('does not treat the wake word alone as a command', () => {
    localStorage.setItem('hader:ustad_wake_word_enabled', 'true');
    const service = new UstadSpeechService();
    const commands = recordCommands(service);

    service.startWakeWordStandby();
    FakeRecognition.instances[0].hear('يا أستاذ حاضر', true);

    expect(service.getListeningMode()).toBe('active_command');
    expect(commands).toEqual([]);
  });

  it('is not woken by everyday sentences about teachers', () => {
    expect(containsWakeWord('الأستاذ حاضر اليوم')).toBe(false);
    expect(stripWakeWord('يا أستاذ حاضر، افتح التقارير')).toBe('افتح التقارير');
    expect(stripWakeWord('افتح التقارير')).toBe('افتح التقارير');
  });

  it('ignores its own voice and only obeys «اسكت» while speaking', () => {
    const service = new UstadSpeechService();
    const commands = recordCommands(service);
    service.startActiveListening();
    const recognition = FakeRecognition.instances[0];

    service.speak('عدد الطلاب الغائبين اليوم هو خمسة');
    expect(service.getIsSpeaking()).toBe(true);
    recognition.hear('عدد الطلاب الغائبين اليوم', true);
    expect(commands).toEqual([]);

    recognition.hear('اسكت', true);
    expect(service.getIsSpeaking()).toBe(false);
    expect(recognition.abort).toHaveBeenCalledTimes(1);

    // بقية الصدى تصل بعد الإيقاف مباشرة
    recognition.hear('هو خمسة', true);
    expect(commands).toEqual([]);

    vi.advanceTimersByTime(800);
    expect(recognition.start).toHaveBeenCalledTimes(2);
    recognition.hear('افتح التقارير', true);
    expect(commands).toEqual(['افتح التقارير']);
  });

  it('discards what it heard while talking once a reply finishes', () => {
    const service = new UstadSpeechService();
    const commands = recordCommands(service);
    service.startActiveListening();
    const recognition = FakeRecognition.instances[0];

    service.speak('تم فتح التقارير');
    synth.finish();

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    recognition.hear('تم فتح التقارير', true);
    expect(commands).toEqual([]);
  });

  it('stops retrying when microphone access is denied', () => {
    const service = new UstadSpeechService();
    const errors: Array<[string, boolean]> = [];
    service.subscribe({ onError: (message, fatal) => errors.push([message, fatal]) });

    service.startActiveListening();
    const recognition = FakeRecognition.instances[0];
    recognition.fail('not-allowed');
    vi.advanceTimersByTime(2000);

    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([[expect.stringContaining('الميكروفون'), true]]);
    expect(service.getIsListening()).toBe(false);
  });
});
