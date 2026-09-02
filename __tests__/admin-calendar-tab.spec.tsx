import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminCalendarTab from '../components/admin/AdminCalendarTab';

afterEach(cleanup);

describe('admin academic calendar tab', () => {
    it('adds only the exact non-contiguous days selected by the administrator', async () => {
        const onSaveHolidays = vi.fn(async () => true);
        const showToast = vi.fn();
        render(
            <AdminCalendarTab
                holidays={[]}
                workDays={[0, 1, 2, 3, 4]}
                saving={false}
                onSaveHolidays={onSaveHolidays}
                showToast={showToast}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: '2026-08-23' }));
        fireEvent.click(screen.getByRole('button', { name: '2026-08-25' }));
        fireEvent.click(screen.getByRole('button', { name: /إضافة كعطلة/ }));

        expect(screen.getByText(/سيتم تسجيل الأيام المحددة فقط/)).toBeTruthy();
        fireEvent.change(screen.getByPlaceholderText('مثال: إجازة نصف العام الدراسي'), {
            target: { value: 'عطلة اختبار' }
        });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ العطلة' }));

        await waitFor(() => expect(onSaveHolidays).toHaveBeenCalledTimes(1));
        expect(onSaveHolidays.mock.calls[0][0]).toEqual([
            { date: '2026-08-23', label: 'عطلة اختبار', type: 'exceptional' },
            { date: '2026-08-25', label: 'عطلة اختبار', type: 'exceptional' }
        ]);
        expect(showToast).toHaveBeenCalledWith('تمت إضافة 2 يوم عطلة بنجاح', 'success');
    });

    it('requires confirmation and reports success only after holiday deletion persists', async () => {
        const onSaveHolidays = vi.fn(async () => true);
        const showToast = vi.fn();
        render(
            <AdminCalendarTab
                holidays={[{ date: '2026-08-23', label: 'عطلة اختبار', type: 'exceptional' }]}
                workDays={[0, 1, 2, 3, 4]}
                saving={false}
                onSaveHolidays={onSaveHolidays}
                showToast={showToast}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: '2026-08-23: عطلة اختبار' }));
        fireEvent.click(screen.getByRole('button', { name: /حذف العطل/ }));
        expect(screen.getByText('تأكيد حذف العطل')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));

        await waitFor(() => expect(onSaveHolidays).toHaveBeenCalledWith([]));
        expect(showToast).toHaveBeenCalledWith('تم حذف 1 عطلة', 'success');
    });
});
