import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Role, User } from '../types';

const engine = vi.hoisted(() => ({ executeCommand: vi.fn(), executeConfirmedAction: vi.fn(), executeStudentFollowUp: vi.fn() }));
vi.mock('../services/ustadHader/intentEngine', () => ({ ustadIntentEngine: engine }));

import UstadHaderModal from '../components/ustadHader/UstadHaderModal';
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

const renderModal = () => render(
  <MemoryRouter>
    <UstadHaderModal isOpen onClose={onClose} currentUser={user} onThemeChange={onThemeChange} />
  </MemoryRouter>
);

const typeCommand = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText(/اكتب أمرك/), { target: { value: text } });
  fireEvent.click(screen.getByTitle('إرسال الأمر'));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  ustadSpeech.stopListening();
  ustadSpeech.setWakeWordPreference(false);
  vi.unstubAllGlobals();
  delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('UstadHaderModal', () => {
  it('offers typing when the browser cannot recognise speech', () => {
    renderModal();
    expect(screen.getByText(/لا يدعم التعرّف على الكلام/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
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

    renderModal();
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

    renderModal();
    typeCommand('أرسل تنبيه لأولياء أمور الغائبين');
    fireEvent.click(await screen.findByRole('button', { name: 'تأكيد وإرسال التنبيهات عبر واتساب' }));

    expect(await screen.findByText('تعذر إرسال التنبيهات، ولم تُضف أي رسالة إلى الطابور.')).toBeTruthy();
    expect(engine.executeConfirmedAction).toHaveBeenCalledWith(pendingAction, user);
    expect(screen.queryByText(/بنجاح/)).toBeNull();
  });

  it('asks for consent before keeping the microphone on in the background', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    Object.assign(window, { SpeechRecognition: FakeRecognition });

    renderModal();
    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByText('قبل تفعيل النداء الصوتي')).toBeTruthy();
    expect(localStorage.getItem(USTAD_WAKE_WORD_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'فهمت، فعّل النداء الصوتي' }));
    expect(localStorage.getItem(USTAD_WAKE_WORD_STORAGE_KEY)).toBe('true');
    expect(screen.queryByText('قبل تفعيل النداء الصوتي')).toBeNull();
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

    renderModal();
    typeCommand('نادي خالد');
    fireEvent.click(await screen.findByRole('button', { name: /خالد فهد الغامدي/ }));

    expect(await screen.findByText(/هل تريد بالتأكيد إرسال نداء خروج للطالب خالد فهد الغامدي/)).toBeTruthy();
    expect(engine.executeStudentFollowUp).toHaveBeenCalledWith(followUp, 's5', user, 'نادي خالد');
  });

  it('routes voice theme changes through the layout so the setting is saved', async () => {
    engine.executeCommand.mockResolvedValue({ type: 'theme_changed', title: 'تم تفعيل الوضع الداكن', spokenText: '', data: { mode: 'dark' } });
    renderModal();
    typeCommand('الوضع الداكن');
    expect(await screen.findByText('تم تفعيل الوضع الداكن')).toBeTruthy();
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });
});
