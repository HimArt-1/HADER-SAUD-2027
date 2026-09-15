import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Role, User } from '../types';

const engine = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  executeConfirmedAction: vi.fn(),
  executeStudentFollowUp: vi.fn(),
  executeSuggestion: vi.fn()
}));
vi.mock('../services/ustadHader/intentEngine', () => ({ ustadIntentEngine: engine }));

import UstadHaderPanel from '../components/ustadHader/UstadHaderPanel';
import { ustadSpeech, USTAD_WAKE_WORD_STORAGE_KEY } from '../services/ustadHader/speechService';

class FakeRecognition {
  onstart?: () => void;
  onend?: () => void;
  start() {
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

const user: User = { id: 'u-admin', username: 'admin', name: 'مدير النظام', role: Role.SITE_ADMIN };
const onClose = vi.fn();
const onThemeChange = vi.fn();

const renderPanel = (props: Partial<React.ComponentProps<typeof UstadHaderPanel>> = {}) => render(
  <MemoryRouter>
    <UstadHaderPanel isOpen onClose={onClose} currentUser={user} onThemeChange={onThemeChange} {...props} />
  </MemoryRouter>
);

const typeCommand = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText(/اكتب/), { target: { value: text } });
  fireEvent.click(screen.getByTitle('إرسال الأمر'));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  ustadSpeech.stopListening();
  vi.unstubAllGlobals();
  delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('UstadHaderPanel', () => {
  it('offers typing when the browser cannot recognise speech', () => {
    renderPanel();
    expect(screen.getByText(/لا يدعم التعرّف على الكلام/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /الميكروفون/ })).toBeNull();
  });

  it('changes attendance only after the confirmation button is pressed', async () => {
    const pendingAction = { type: 'mark_attendance', studentId: 's2', newStatus: 'present' };
    engine.executeCommand.mockResolvedValue({
      type: 'confirmation',
      title: 'تأكيد تسجيل حاضر',
      spokenText: '',
      data: { prompt: 'تسجيل الطالب خالد حاضر اليوم', className: 'الثالث - ب' },
      pendingAction
    });
    engine.executeConfirmedAction.mockResolvedValue({
      type: 'success',
      title: 'تم تسجيل الحضور',
      spokenText: 'تم تسجيل حضور الطالب خالد.'
    });

    renderPanel();
    typeCommand('سجل حضور الطالب خالد');

    expect(await screen.findByText(/هل تريد بالتأكيد تسجيل الطالب خالد حاضر اليوم/)).toBeTruthy();
    expect(engine.executeCommand).toHaveBeenCalledTimes(1);
    expect(engine.executeConfirmedAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'تأكيد التنفيذ' }));

    expect(await screen.findByText('تم تسجيل حضور الطالب خالد.')).toBeTruthy();
    expect(engine.executeConfirmedAction).toHaveBeenCalledWith(pendingAction, user);
  });

  it('shows a failed WhatsApp send as a failure', async () => {
    const pendingAction = { type: 'send_absence_alerts', studentIds: ['s2'] };
    engine.executeCommand.mockResolvedValue({
      type: 'alerts_preview',
      title: 'تأكيد إرسال تنبيهات الغياب',
      spokenText: '',
      data: {
        recipientsCount: 1,
        withoutPhone: 0,
        recipients: [{ studentId: 's2', studentName: 'خالد سعد الشهري', className: 'الثالث - ب', phone: '966557654321' }],
        messagePreview: 'غياب خالد سعد الشهري',
        date: '2026-09-15'
      },
      pendingAction
    });
    engine.executeConfirmedAction.mockResolvedValue({
      type: 'error',
      title: 'تعذر إرسال التنبيهات',
      spokenText: 'تعذر إرسال التنبيهات، ولم تُضف أي رسالة إلى الطابور.'
    });

    renderPanel();
    typeCommand('أرسل تنبيه لأولياء أمور الغائبين');
    fireEvent.click(await screen.findByRole('button', { name: 'تأكيد وإرسال التنبيهات عبر واتساب' }));

    expect(await screen.findByText('تعذر إرسال التنبيهات، ولم تُضف أي رسالة إلى الطابور.')).toBeTruthy();
    expect(engine.executeConfirmedAction).toHaveBeenCalledWith(pendingAction, user);
    expect(screen.queryByText(/بنجاح/)).toBeNull();
  });

  it('continues the original request with the student chosen from similar names', async () => {
    const followUp = { kind: 'call_dismissal' };
    engine.executeCommand.mockResolvedValue({
      type: 'disambiguation',
      title: 'تحديد الطالب المطلوب',
      spokenText: '',
      data: {
        students: [
          { id: 's2', name: 'خالد سعد الشهري', class_name: 'الثالث', section: 'ب' },
          { id: 's5', name: 'خالد فهد الغامدي', class_name: 'الرابع', section: 'أ' }
        ],
        total: 2,
        utterance: 'نادي خالد'
      },
      followUp
    });
    engine.executeStudentFollowUp.mockResolvedValue({
      type: 'confirmation',
      title: 'تأكيد نداء خروج',
      spokenText: '',
      data: { prompt: 'إرسال نداء خروج للطالب خالد فهد الغامدي' },
      pendingAction: { type: 'call_dismissal', studentId: 's5' }
    });

    renderPanel();
    typeCommand('نادي خالد');
    fireEvent.click(await screen.findByRole('button', { name: /خالد فهد الغامدي/ }));

    expect(await screen.findByText(/هل تريد بالتأكيد إرسال نداء خروج للطالب خالد فهد الغامدي/)).toBeTruthy();
    expect(engine.executeStudentFollowUp).toHaveBeenCalledWith(followUp, 's5', user, 'نادي خالد');
  });

  it('routes voice theme changes through the layout so the setting is saved', async () => {
    engine.executeCommand.mockResolvedValue({ type: 'theme_changed', title: 'تم تفعيل الوضع الداكن', spokenText: '', data: { mode: 'dark' } });
    renderPanel();
    typeCommand('الوضع الداكن');
    expect(await screen.findByText('تم تفعيل الوضع الداكن')).toBeTruthy();
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('runs a chosen suggestion so the assistant can learn the phrasing', async () => {
    const suggestion = { intentId: 'briefing.today', command: 'ملخص اليوم' };
    engine.executeCommand.mockResolvedValue({
      type: 'suggestions',
      title: 'هل تقصد أحد هذه الأوامر؟',
      spokenText: '',
      data: { suggestions: [suggestion], utterance: 'عطني الزبدة' }
    });
    engine.executeSuggestion.mockResolvedValue({ type: 'info', title: 'الملخص لم يجهز بعد', spokenText: 'سيجهز ملخص اليوم بعد انتهاء مهلة الحضور.' });

    renderPanel();
    typeCommand('عطني الزبدة');
    const hint = await screen.findByText('بعد اختيارك سيتذكر المساعد صياغتك على هذا الجهاز.');
    fireEvent.click(within(hint.parentElement!).getByRole('button', { name: 'ملخص اليوم' }));

    expect(await screen.findByText('سيجهز ملخص اليوم بعد انتهاء مهلة الحضور.')).toBeTruthy();
    expect(engine.executeSuggestion).toHaveBeenCalledWith(suggestion, 'عطني الزبدة', user, expect.any(Function));
  });

  it('passes the conversation context to the next command', async () => {
    const context = { intentId: 'class.absence', classRef: null, at: 1 };
    engine.executeCommand
      .mockResolvedValueOnce({ type: 'info', title: 'كشف غياب الصف ثالث', spokenText: '', context })
      .mockResolvedValueOnce({ type: 'info', title: 'كشف غياب الصف رابع', spokenText: '' });

    renderPanel();
    typeCommand('اعرض غياب ثالث');
    expect(await screen.findByText('كشف غياب الصف ثالث')).toBeTruthy();
    typeCommand('وفي رابع؟');
    expect(await screen.findByText('كشف غياب الصف رابع')).toBeTruthy();

    expect(engine.executeCommand.mock.calls[0][3]).toBeNull();
    expect(engine.executeCommand.mock.calls[1][3]).toEqual(context);
  });

  it('runs the command it was opened for', async () => {
    engine.executeCommand.mockResolvedValue({ type: 'info', title: 'الملخص لم يجهز بعد', spokenText: '' });
    const onInitialCommandHandled = vi.fn();
    renderPanel({ initialCommand: 'ملخص اليوم', onInitialCommandHandled });

    expect(await screen.findByText('الملخص لم يجهز بعد')).toBeTruthy();
    expect(engine.executeCommand).toHaveBeenCalledWith('ملخص اليوم', user, expect.any(Function), null);
    expect(onInitialCommandHandled).toHaveBeenCalled();
  });

  it('closes itself when told to', async () => {
    engine.executeCommand.mockResolvedValue({ type: 'dismiss', title: 'إلى اللقاء', spokenText: '' });
    renderPanel();
    typeCommand('أغلق');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape and on a click outside the card', async () => {
    renderPanel();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    cleanup();
    onClose.mockClear();
    renderPanel();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('listens for the wake word by default and lets the user switch it off', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    Object.assign(window, { SpeechRecognition: FakeRecognition });

    renderPanel();
    expect(screen.getByText('النداء مفعّل')).toBeTruthy();
    expect(screen.queryByText(/قبل تفعيل النداء الصوتي/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'الإعدادات' }));
    const toggle = screen.getByRole('switch', { name: /النداء الصوتي/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(USTAD_WAKE_WORD_STORAGE_KEY)).toBe('false');
  });
});
