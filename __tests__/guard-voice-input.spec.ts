import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuardVoiceInput } from '../hooks/useGuardVoiceInput';
import { FakeGuardRecognition } from './helpers/fakeGuardRecognition';

beforeEach(() => {
  vi.useFakeTimers();
  FakeGuardRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeGuardRecognition);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('station voice input lifecycle', () => {
  it('opens the microphone only on demand and accepts only finalized Arabic speech', () => {
    const { result } = renderHook(useGuardVoiceInput);
    expect(FakeGuardRecognition.instances).toHaveLength(0);
    act(() => result.current.start());
    const recognition = FakeGuardRecognition.instances[0];
    expect(recognition.lang).toBe('ar-SA');
    expect(recognition.continuous).toBe(false);
    act(() => recognition.hear('أحمد', false));
    expect(result.current.phase).toBe('listening');
    expect(result.current.transcript).toBe('أحمد');
    act(() => recognition.hear('أحمد محمد'));
    expect(result.current.phase).toBe('review');
    expect(result.current.transcript).toBe('أحمد محمد');
    expect(recognition.abort).toHaveBeenCalledTimes(1);
  });
  it('waits for the final result after a manual stop', () => {
    const { result } = renderHook(useGuardVoiceInput);
    act(() => result.current.start());
    const recognition = FakeGuardRecognition.instances[0];
    act(() => result.current.stop());
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('processing');
    act(() => recognition.hear('أحمد محمد'));
    expect(result.current.phase).toBe('review');
  });
  it('stops long recordings and releases a service that never responds', () => {
    const { result } = renderHook(useGuardVoiceInput);
    act(() => result.current.start());
    const recognition = FakeGuardRecognition.instances[0];
    act(() => vi.advanceTimersByTime(15000));
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toContain('لم أسمع');
    expect(recognition.abort).toHaveBeenCalledTimes(1);
  });
  it('does not resume listening when a delayed start event arrives after stopping', () => {
    const { result } = renderHook(useGuardVoiceInput);
    act(() => result.current.start());
    const recognition = FakeGuardRecognition.instances[0];
    act(() => result.current.stop());
    act(() => recognition.onstart?.());
    expect(result.current.phase).toBe('processing');
    act(() => vi.advanceTimersByTime(4000));
    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('error');
  });
  it.each(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'no-speech', 'language-not-supported'])('handles %s without retrying or leaving the microphone open', error => {
    const { result } = renderHook(useGuardVoiceInput);
    act(() => result.current.start());
    const recognition = FakeGuardRecognition.instances[0];
    act(() => recognition.onerror?.({ error }));
    expect(result.current.phase).toBe('error');
    expect(result.current.error).not.toBe('');
    expect(recognition.abort).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30000));
    expect(FakeGuardRecognition.instances).toHaveLength(1);
  });
  it('invalidates late results after cancellation and cleans up on unmount', () => {
    const { result, unmount } = renderHook(useGuardVoiceInput);
    act(() => result.current.start());
    const first = FakeGuardRecognition.instances[0];
    const lateResult = first.onresult;
    act(() => result.current.cancel());
    act(() => lateResult?.(FakeGuardRecognition.result('أحمد محمد')));
    expect(result.current.phase).toBe('idle');
    act(() => result.current.start());
    unmount();
    expect(FakeGuardRecognition.instances[1].abort).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('provides a fallback when recognition is unsupported and supports WebKit when available', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    const { result, rerender } = renderHook(useGuardVoiceInput);
    act(() => result.current.start());
    expect(result.current.error).toContain('لا يدعم');
    vi.stubGlobal('webkitSpeechRecognition', FakeGuardRecognition);
    rerender();
    act(() => result.current.start());
    expect(result.current.phase).toBe('listening');
  });
  it('releases the microphone when the page becomes hidden', () => {
    const { result } = renderHook(useGuardVoiceInput);
    act(() => result.current.start());
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(FakeGuardRecognition.instances[0].abort).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
    hidden.mockRestore();
  });
});
