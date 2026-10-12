import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Student } from '../types';
import { FakeGuardRecognition } from './helpers/fakeGuardRecognition';

const mocks = vi.hoisted(() => ({ getStudents: vi.fn(), execute: vi.fn(), getSession: vi.fn(), logout: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../services/db', () => ({ db: { getStudents: mocks.getStudents } }));
vi.mock('../services/dismissals', () => ({ dismissals: { execute: mocks.execute } }));
vi.mock('../services/auth', () => ({ auth: { getSession: mocks.getSession, logout: mocks.logout } }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock('../types/errors', () => ({ logError: vi.fn() }));
vi.mock('../components/guard/GuardScanner', () => ({
  default: ({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="الماسح"><button onClick={() => onScan('١٢٣٤')}>مسح طالب</button><button onClick={() => onScan('٩٩٩')}>مسح غير معروف</button><button onClick={onClose}>إغلاق الماسح</button></div>
  )
}));
import GuardDispatcher from '../pages/GuardDispatcher';

const student: Student = { id: '1234', name: 'أحمد محمد', class_name: 'الأول', section: 'أ', is_active: true };
const renderStation = () => render(
  <MemoryRouter initialEntries={['/guard-station']}><Routes><Route path="/guard-station" element={<GuardDispatcher />} /><Route path="/login" element={<p>تسجيل الدخول</p>} /></Routes></MemoryRouter>
);
const readyStation = async () => { renderStation(); await screen.findByLabelText('أدخل رقم الطالب'); };
const enterCode = (value: string) => fireEvent.change(screen.getByLabelText('أدخل رقم الطالب'), { target: { value } });

beforeEach(() => {
  vi.resetAllMocks();
  FakeGuardRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeGuardRecognition);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
  mocks.getSession.mockReturnValue({ id: 'guard-1', name: 'حارس البوابة', role: 'call_station' });
  mocks.getStudents.mockResolvedValue([student, { ...student, id: '١٢٣٤', name: 'نسخة مكررة' }, { ...student, id: '999', name: 'غير نشط', is_active: false }]);
  mocks.execute.mockResolvedValue({ outcome: 'requested' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('classic call-station phone', () => {
  it('sends the keypad code through the existing dismissal command and shows the last call', async () => {
    await readyStation();
    for (const digit of '1234') fireEvent.click(screen.getByRole('button', { name: digit, exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'إرسال نداء', exact: true }));
    await screen.findByText('تم تسجيل الطلب');
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({ type: 'request-call', student, requester: { id: 'guard-1', name: 'حارس البوابة' } });
    expect(screen.getByText('آخر نداء')).toBeTruthy();
    expect((screen.getByLabelText('أدخل رقم الطالب') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(student.name)).toBeTruthy();
  });

  it('normalizes Arabic digits, supports delete/clear, and submits with the form', async () => {
    await readyStation();
    enterCode('١٢٣٤٥');
    fireEvent.click(screen.getByRole('button', { name: 'حذف آخر رقم' }));
    expect((screen.getByLabelText('أدخل رقم الطالب') as HTMLInputElement).value).toBe('1234');
    fireEvent.click(screen.getByRole('button', { name: 'مسح الرقم', exact: true }));
    expect((screen.getByLabelText('أدخل رقم الطالب') as HTMLInputElement).value).toBe('');
    enterCode('١٢٣٤');
    fireEvent.submit(screen.getByLabelText('أدخل رقم الطالب').closest('form')!);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
  });

  it('rejects unknown and inactive students without sending a request', async () => {
    await readyStation();
    enterCode('999');
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد النداء' }));
    expect(screen.getByRole('alert').textContent).toContain('غير موجود');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(screen.getByText('1 طالب')).toBeTruthy();
  });

  it('prevents duplicate submissions while a request is in flight', async () => {
    let finish!: (value: { outcome: string }) => void;
    mocks.execute.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await readyStation();
    enterCode('1234');
    const form = screen.getByLabelText('أدخل رقم الطالب').closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'تأكيد النداء' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ outcome: 'requested' }));
  });

  it('keeps a failed request available for retry and reports an already-active call accurately', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ outcome: 'already-requested' });
    await readyStation();
    enterCode('1234');
    fireEvent.click(screen.getByRole('button', { name: 'إرسال نداء', exact: true }));
    await screen.findByText('فشل إرسال النداء. حاول مرة أخرى.');
    expect((screen.getByLabelText('أدخل رقم الطالب') as HTMLInputElement).value).toBe('1234');
    fireEvent.click(screen.getByRole('button', { name: 'إرسال نداء', exact: true }));
    await screen.findByText('يوجد نداء نشط مسبقًا: أحمد محمد');
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it('selects a student from the LCD class/section directory and returns to the dial screen', async () => {
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'الطلاب', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'الأول', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'أ', exact: true }));
    expect(screen.queryByText('نسخة مكررة')).toBeNull();
    expect(screen.queryByText('غير نشط')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /أحمد محمد/ }));
    await screen.findByLabelText('أدخل رقم الطالب');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('retains the scanner flow and rejects an invalid scan', async () => {
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'مسح الباركود', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'مسح غير معروف' }));
    expect(screen.getByRole('alert').textContent).toContain('غير موجود');
    expect(mocks.execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'مسح الباركود', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'مسح طالب' }));
    await screen.findByText('تم تسجيل الطلب');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a recoverable data-load error and re-enables the phone after retry', async () => {
    mocks.getStudents.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([student]);
    renderStation();
    await screen.findByText('تعذر تحميل الدليل');
    expect((screen.getByRole('button', { name: '1', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await screen.findByLabelText('أدخل رقم الطالب');
    expect((screen.getByRole('button', { name: '1', exact: true }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps logout in the administration menu without giving station accounts an admin link', async () => {
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'الإدارة', exact: true }));
    expect(screen.getByText('حارس البوابة')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'العودة للرئيسية' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('preserves a draft when opening menus but only enables sending when the code is visible', async () => {
    await readyStation();
    enterCode('1234');
    fireEvent.click(screen.getByRole('button', { name: 'الإدارة', exact: true }));
    expect((screen.getByRole('button', { name: 'إرسال نداء', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'تأكيد النداء' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'رجوع', exact: true }));
    expect((screen.getByLabelText('أدخل رقم الطالب') as HTMLInputElement).value).toBe('1234');
    expect((screen.getByRole('button', { name: 'إرسال نداء', exact: true }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated user before loading student data', async () => {
    mocks.getSession.mockReturnValue(null);
    renderStation();
    await screen.findByText('تسجيل الدخول');
    expect(mocks.getStudents).not.toHaveBeenCalled();
  });

  it('hears a student name but never sends a voice call before explicit confirmation', async () => {
    await readyStation();
    expect(FakeGuardRecognition.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل اسم الطالب' }));
    const recognition = FakeGuardRecognition.instances[0];
    act(() => recognition.hear('أحمد', false));
    expect(screen.getByText('«أحمد»')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'تأكيد وإرسال' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => recognition.hear('احمد محمد'));
    expect(screen.getByRole('group', { name: 'الأسماء المطابقة للصوت' }).textContent).toContain('أحمد محمد');
    expect(screen.getByText('بانتظار تأكيدك — لم يُرسل النداء بعد.')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد وإرسال' }));
    await screen.findByText('تم تسجيل الطلب');
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({ type: 'request-call', student, requester: { id: 'guard-1', name: 'حارس البوابة' } });
  });

  it('requires selection among identical names and still requires confirmation afterwards', async () => {
    const second = { ...student, id: '5678', class_name: 'الثاني', section: 'ب' };
    mocks.getStudents.mockResolvedValue([student, second]);
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل اسم الطالب' }));
    act(() => FakeGuardRecognition.instances[0].hear('أحمد محمد'));
    expect((screen.getByRole('button', { name: 'تأكيد وإرسال' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'تأكيد النداء' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /أحمد محمد الثاني.*5678/ }));
    expect(mocks.execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد وإرسال' }));
    await screen.findByText('تم تسجيل الطلب');
    expect(mocks.execute.mock.calls[0][0].student.id).toBe('5678');
  });

  it('does not offer unknown or inactive spoken names for confirmation', async () => {
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل اسم الطالب' }));
    act(() => FakeGuardRecognition.instances[0].hear('غير نشط'));
    expect(screen.getByText(/لم أجد اسمًا مطابقًا/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'تأكيد وإرسال' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('cancels the microphone when returning to the keypad and ignores late recognition', async () => {
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل اسم الطالب' }));
    const recognition = FakeGuardRecognition.instances[0];
    const lateResult = recognition.onresult;
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء', exact: true }));
    act(() => lateResult?.(FakeGuardRecognition.result('أحمد محمد')));
    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('أدخل رقم الطالب')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'الأسماء المطابقة للصوت' })).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('clears a previous voice selection when recording again', async () => {
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل اسم الطالب' }));
    act(() => FakeGuardRecognition.instances[0].hear('أحمد محمد'));
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل اسم الطالب' }));
    expect(screen.queryByRole('group', { name: 'الأسماء المطابقة للصوت' })).toBeNull();
    expect((screen.getByRole('button', { name: 'تأكيد وإرسال' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'الطلاب', exact: true }));
    expect(FakeGuardRecognition.instances[1].abort).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('shows microphone permission errors and leaves the existing student list usable', async () => {
    await readyStation();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل اسم الطالب' }));
    act(() => FakeGuardRecognition.instances[0].onerror?.({ error: 'not-allowed' }));
    expect(screen.getByRole('alert').textContent).toContain('إذن الميكروفون');
    expect((screen.getByRole('button', { name: 'تأكيد وإرسال' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'الطلاب', exact: true }));
    expect(screen.getByText('اختر الصف')).toBeTruthy();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
