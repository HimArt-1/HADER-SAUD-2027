import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuickSendModal from '../components/whatsapp/QuickSendModal';
import BadgeStudio from '../components/whatsapp/BadgeStudio';
import type { Student } from '../types';

const { enqueue, upload, toBlob } = vi.hoisted(() => ({ enqueue: vi.fn(), upload: vi.fn(), toBlob: vi.fn() }));
vi.mock('../services/whatsappGateway', () => ({ whatsappGateway: { enqueue, upload } }));
vi.mock('html-to-image', () => ({ toBlob }));
const student = { id: 'student-1', name: 'طالب تجريبي', parent_phone: '٠٥٠١٢٣٤٥٦٧' } as Student;

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    enqueue.mockResolvedValue({});
    upload.mockResolvedValue('/badge.png');
    toBlob.mockResolvedValue(new Blob(['badge'], { type: 'image/png' }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const show = (props: Partial<React.ComponentProps<typeof QuickSendModal>> = {}) => render(
    <QuickSendModal isOpen onClose={vi.fn()} student={student} defaultTemplateId="praise" {...props} />
);

describe('Quick WhatsApp sending', () => {
    it('opens the selected, edited text with the normalized guardian phone without queueing', () => {
        const popup = { opener: {} };
        const open = vi.spyOn(window, 'open').mockReturnValue(popup as Window);
        const onManualOpened = vi.fn();
        const onQueued = vi.fn();
        show({ onManualOpened, onQueued });
        fireEvent.change(screen.getByLabelText('نص الرسالة'), { target: { value: 'تقدير & شكر\nلولي الأمر' } });
        fireEvent.click(screen.getByRole('button', { name: 'إرسال يدوي لواتساب' }));
        expect(open).toHaveBeenCalledWith(`https://wa.me/966501234567?text=${encodeURIComponent('تقدير & شكر\nلولي الأمر')}`, '_blank');
        expect(popup.opener).toBeNull();
        expect(onManualOpened).toHaveBeenCalledWith(expect.objectContaining({ kind: 'message', phone: '966501234567' }));
        expect(screen.getByRole('status').textContent).toContain('لا يؤكد التسليم');
        expect(enqueue).not.toHaveBeenCalled();
        expect(onQueued).not.toHaveBeenCalled();
    });

    it('reports popup blocking without recording a manual handoff', () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        const onManualOpened = vi.fn();
        show({ onManualOpened });
        fireEvent.click(screen.getByRole('button', { name: 'إرسال يدوي لواتساب' }));
        expect(screen.getByRole('alert').textContent).toContain('اسمح بالنوافذ المنبثقة');
        expect(onManualOpened).not.toHaveBeenCalled();
    });

    it('disables sending for blank text or an invalid phone but still allows badge download', () => {
        const view = show({ defaultTemplateId: 'custom' });
        expect((screen.getByRole('button', { name: 'إرسال يدوي لواتساب' }) as HTMLButtonElement).disabled).toBe(true);
        view.rerender(<QuickSendModal isOpen onClose={vi.fn()} student={{ ...student, parent_phone: '123' }} defaultTemplateId="praise" />);
        expect((screen.getByRole('button', { name: 'إرسال يدوي لواتساب' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'وسام', exact: true }));
        expect((screen.getByRole('button', { name: 'إرسال الوسام يدويًا' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'تحميل صورة الوسام' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('preserves queue sending and exposes manual sending after gateway failure', async () => {
        enqueue.mockRejectedValueOnce(new Error('الخادم غير متصل'));
        const open = vi.spyOn(window, 'open').mockReturnValue({ opener: null } as Window);
        const onQueued = vi.fn();
        show({ onQueued });
        fireEvent.click(screen.getByRole('button', { name: 'إضافة للطابور' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('الخادم غير متصل'));
        fireEvent.click(screen.getByRole('button', { name: 'إرسال يدوي لواتساب' }));
        expect(open).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'إضافة للطابور' }));
        await waitFor(() => expect(onQueued).toHaveBeenCalledOnce());
        expect(screen.getByRole('status').textContent).toContain('تابع حالة التسليم');
    });

    it('downloads a customized badge then opens the guardian chat without uploading it', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue({ opener: null } as Window);
        const onManualOpened = vi.fn();
        show({ onManualOpened });
        fireEvent.click(screen.getByRole('button', { name: 'وسام', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'درع البطل' }));
        fireEvent.change(screen.getByLabelText('عنوان الوسام'), { target: { value: 'بطل الانضباط' } });
        fireEvent.change(screen.getByLabelText('رسالة التقدير'), { target: { value: 'شكرًا لمثابرتك' } });
        fireEvent.click(screen.getByRole('button', { name: 'إرسال الوسام يدويًا' }));
        const chat = await screen.findByRole('button', { name: 'فتح محادثة ولي الأمر' });
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
        fireEvent.click(chat);
        const url = new URL(open.mock.calls[0][0] as string);
        expect(url.pathname).toBe('/966501234567');
        expect(url.searchParams.get('text')).toContain('بطل الانضباط');
        expect(url.searchParams.get('text')).toContain('شكرًا لمثابرتك');
        expect(onManualOpened).toHaveBeenCalledWith(expect.objectContaining({ kind: 'badge' }));
        expect(upload).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        // Editing requires regenerating the attachment before opening another chat.
        fireEvent.change(screen.getByLabelText('عنوان الوسام'), { target: { value: 'عنوان جديد' } });
        expect(screen.queryByRole('button', { name: 'فتح محادثة ولي الأمر' })).toBeNull();
    });

    it('queues the badge attachment and displays its success in badge mode', async () => {
        show();
        fireEvent.click(screen.getByRole('button', { name: 'وسام', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'إضافة الوسام للطابور' }));
        await waitFor(() => expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({ phone: '966501234567', attachment: '/badge.png', status_label: 'وسام' })]));
        expect(screen.getByRole('status').textContent).toContain('أضيفت الرسالة');
    });

    it('shows generation errors and allows retry without uploading a missing image', async () => {
        toBlob.mockResolvedValueOnce(null);
        show();
        fireEvent.click(screen.getByRole('button', { name: 'وسام', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'إرسال الوسام يدويًا' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('تعذر إنشاء صورة الوسام'));
        expect(screen.queryByRole('button', { name: 'فتح محادثة ولي الأمر' })).toBeNull();
        expect(upload).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'إرسال الوسام يدويًا' }));
        expect(await screen.findByRole('button', { name: 'فتح محادثة ولي الأمر' })).toBeTruthy();
    });
    it('uses feminine wording in message templates and the manual WhatsApp text', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue({ opener: null } as Window);
        show();
        fireEvent.change(screen.getByLabelText('صيغة المخاطبة'), { target: { value: 'female' } });
        expect((screen.getByLabelText('نص الرسالة') as HTMLTextAreaElement).value).toContain('الطالبة');
        expect((screen.getByLabelText('نص الرسالة') as HTMLTextAreaElement).value).toContain('تميزها والتزامها');
        fireEvent.click(screen.getByRole('button', { name: 'تنبيه تأخر' }));
        fireEvent.click(screen.getByRole('button', { name: 'إرسال يدوي لواتساب' }));
        expect(new URL(open.mock.calls[0][0] as string).searchParams.get('text')).toContain('قد تأخرت');
    });

    it('keeps custom message text when changing gender and resets for the next recipient', () => {
        const view = show();
        fireEvent.change(screen.getByLabelText('نص الرسالة'), { target: { value: 'نص مخصص لا يتغير' } });
        fireEvent.change(screen.getByLabelText('صيغة المخاطبة'), { target: { value: 'female' } });
        expect((screen.getByLabelText('نص الرسالة') as HTMLTextAreaElement).value).toBe('نص مخصص لا يتغير');
        view.rerender(<QuickSendModal isOpen onClose={vi.fn()} student={{ ...student, id: 'next', name: 'طالب آخر' }} defaultTemplateId="praise" />);
        expect((screen.getByLabelText('صيغة المخاطبة') as HTMLSelectElement).value).toBe('male');
        expect((screen.getByLabelText('نص الرسالة') as HTMLTextAreaElement).value).toContain('الطالب طالب آخر');
    });

    it('updates the badge preview, default titles, and manual caption for a girl', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue({ opener: null } as Window);
        show();
        fireEvent.click(screen.getByRole('button', { name: 'وسام', exact: true }));
        fireEvent.change(screen.getByLabelText('صيغة المخاطبة'), { target: { value: 'female' } });
        expect(screen.getByText('نفتخر بالطالبة')).toBeTruthy();
        expect((screen.getByLabelText('عنوان الوسام') as HTMLInputElement).value).toBe('ملكة الأسبوع');
        expect((screen.getByLabelText('رسالة التقدير') as HTMLTextAreaElement).value).toContain('واصلي التألق');
        fireEvent.click(screen.getByRole('button', { name: 'درع البطلة' }));
        expect((screen.getByLabelText('عنوان الوسام') as HTMLInputElement).value).toBe('بطلة الحضور');
        fireEvent.click(screen.getByRole('button', { name: 'إرسال الوسام يدويًا' }));
        fireEvent.click(await screen.findByRole('button', { name: 'فتح محادثة ولي الأمر' }));
        const text = new URL(open.mock.calls[0][0] as string).searchParams.get('text');
        expect(text).toContain('ولي أمر الطالبة');
        expect(text).toContain('منح ابنتكم');
        expect(text).toContain('بطلة الحضور');
        fireEvent.change(screen.getByLabelText('صيغة المخاطبة'), { target: { value: 'male' } });
        expect(screen.queryByRole('button', { name: 'فتح محادثة ولي الأمر' })).toBeNull();
        expect((screen.getByLabelText('عنوان الوسام') as HTMLInputElement).value).toBe('بطل الحضور');
    });

    it('supports gender selection in the standalone studio and preserves a custom title and reason', async () => {
        const onSend = vi.fn().mockResolvedValue(undefined);
        render(<BadgeStudio studentName="طالبة تجريبية" onSend={onSend} />);
        fireEvent.change(screen.getByLabelText('عنوان الوسام'), { target: { value: 'وسام الاجتهاد' } });
        fireEvent.change(screen.getByLabelText('رسالة التقدير'), { target: { value: 'كل التقدير لمثابرتك' } });
        fireEvent.change(screen.getByLabelText('صيغة المخاطبة'), { target: { value: 'female' } });
        expect((screen.getByLabelText('عنوان الوسام') as HTMLInputElement).value).toBe('وسام الاجتهاد');
        expect((screen.getByLabelText('رسالة التقدير') as HTMLTextAreaElement).value).toBe('كل التقدير لمثابرتك');
        fireEvent.click(screen.getByRole('button', { name: 'إضافة الوسام للطابور' }));
        await waitFor(() => expect(onSend).toHaveBeenCalledWith(expect.any(File), expect.stringContaining('منح ابنتكم')));
    });

});
