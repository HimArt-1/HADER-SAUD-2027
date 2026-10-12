import { vi } from 'vitest';

type ResultEvent = { results: Array<Array<{ transcript: string }> & { isFinal: boolean }> };
export class FakeGuardRecognition {
  static instances: FakeGuardRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onresult: ((event: ResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn(() => this.onend?.());
  constructor() { FakeGuardRecognition.instances.push(this); }
  hear(transcript: string, isFinal = true) {
    this.onresult?.(FakeGuardRecognition.result(transcript, isFinal));
  }
  static result(transcript: string, isFinal = true): ResultEvent {
    return { results: [Object.assign([{ transcript }], { isFinal })] };
  }
}
