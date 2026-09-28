import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AcademicTrackingSettings from '../components/admin/AcademicTrackingSettings';

afterEach(cleanup);

describe('academic tracking date settings', () => {
    it('previews the later start and saves both dates as one change', async () => {
        const onSave = vi.fn(async () => true);
        render(<AcademicTrackingSettings dates={{}} saving={false} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText('بداية السنة الدراسية'), { target: { value: '2026-08-23' } });
        fireEvent.change(screen.getByLabelText('بداية تشغيل حاضر'), { target: { value: '2026-09-01' } });
        expect(screen.getByRole('status').textContent).toContain('2026-09-01');
        expect(onSave).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'حفظ تواريخ الاحتساب' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledWith({ academic_year_start_date: '2026-08-23', tracking_start_date: '2026-09-01' }));
    });

    it('requires both dates and retains the draft after a failed save', async () => {
        const onSave = vi.fn(async () => false);
        render(<AcademicTrackingSettings dates={{}} saving={false} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText('بداية السنة الدراسية'), { target: { value: '2026-08-23' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ تواريخ الاحتساب' }));
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toContain('حدد تاريخًا صالحًا');
        fireEvent.change(screen.getByLabelText('بداية تشغيل حاضر'), { target: { value: '2025-09-01' } });
        expect(screen.getByRole('status').textContent).toContain('2026-08-23');
        fireEvent.click(screen.getByRole('button', { name: 'حفظ تواريخ الاحتساب' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('تعذر حفظ'));
        expect((screen.getByLabelText('بداية تشغيل حاضر') as HTMLInputElement).value).toBe('2025-09-01');
    });

    it('keeps edits during unrelated rerenders and restores saved dates on cancel', () => {
        const dates = { academic_year_start_date: '2026-08-23', tracking_start_date: '2026-08-25' };
        const onSave = vi.fn(async () => true);
        const { rerender } = render(<AcademicTrackingSettings dates={dates} saving={false} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText('بداية تشغيل حاضر'), { target: { value: '2026-09-01' } });
        rerender(<AcademicTrackingSettings dates={{ ...dates }} saving={false} onSave={onSave} />);
        expect((screen.getByLabelText('بداية تشغيل حاضر') as HTMLInputElement).value).toBe('2026-09-01');
        fireEvent.click(screen.getByRole('button', { name: 'تراجع عن التعديل' }));
        expect((screen.getByLabelText('بداية تشغيل حاضر') as HTMLInputElement).value).toBe('2026-08-25');
        expect((screen.getByRole('button', { name: 'حفظ تواريخ الاحتساب' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
