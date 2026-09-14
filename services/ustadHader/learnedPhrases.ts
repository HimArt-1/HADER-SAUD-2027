// =============================================================================
// نظام حاضر (Hader) - العبارات التي تعلّمها «أستاذ حاضر» من اختيارات المستخدم
// =============================================================================
// حين لا يفهم المساعد جملة ويختار المستخدم أحد الاقتراحات، تُحفظ الجملة على هذا الجهاز فقط
// لتُفهم مباشرة في المرة القادمة. لا يُرسل شيء خارج المنصة.

import { normalizeArabicSpeech } from './arabicLexicon';
import type { UstadIntentId } from './intentClassifier';

export const USTAD_LEARNED_PHRASES_KEY = 'hader:ustad_learned_phrases';
const MAX_PHRASES = 200;

interface LearnedPhrase {
  intentId: UstadIntentId;
  uses: number;
  lastUsed: number;
}

function readPhrases(): Record<string, LearnedPhrase> {
  try {
    const parsed = JSON.parse(localStorage.getItem(USTAD_LEARNED_PHRASES_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePhrases(phrases: Record<string, LearnedPhrase>): void {
  try {
    localStorage.setItem(USTAD_LEARNED_PHRASES_KEY, JSON.stringify(phrases));
  } catch {
    // Learning is a convenience; the assistant still works without it.
  }
}

export function recallPhrase(utterance: string): UstadIntentId | null {
  const key = normalizeArabicSpeech(utterance);
  return key ? readPhrases()[key]?.intentId ?? null : null;
}

export function learnPhrase(utterance: string, intentId: UstadIntentId): void {
  const key = normalizeArabicSpeech(utterance);
  if (!key) return;

  const phrases = readPhrases();
  phrases[key] = { intentId, uses: (phrases[key]?.uses ?? 0) + 1, lastUsed: Date.now() };

  // الأقدم استخداماً يُنسى أولاً
  const kept = Object.entries(phrases)
    .sort(([, a], [, b]) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_PHRASES);
  writePhrases(Object.fromEntries(kept));
}

export function learnedPhraseCount(): number {
  return Object.keys(readPhrases()).length;
}

export function forgetLearnedPhrases(): void {
  try {
    localStorage.removeItem(USTAD_LEARNED_PHRASES_KEY);
  } catch {
    // Nothing stored to forget.
  }
}
