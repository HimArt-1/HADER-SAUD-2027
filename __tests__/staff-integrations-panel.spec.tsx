import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StaffIntegrationsPanel from '../components/admin/StaffIntegrationsPanel';
import type { StaffIntegrationsController } from '../services/staffIntegrations';

const controller = (): StaffIntegrationsController => ({
  inspectRows: vi.fn(),
  history: vi.fn(async () => ({ snapshot: { version: 0, teachers: [], timetable: [], attendance: [], preparations: [], coveragePlans: [] }, imports: [] })),
  inspectFile: vi.fn(async platform => ({
    id: 'review', platform, operation: 'pull-staff-report', effect: 'read', remoteRevision: 'hash', warnings: [], createdAt: '2026-09-06T06:00:00Z', expiresAt: '2026-09-06T06:15:00Z',
    changes: [
      { id: '1', action: 'update', entityType: 'staff-attendance', entityLabel: 'أحمد', before: { status: 'present', date: '2026-09-06' }, after: { status: 'absent', date: '2026-09-06' } },
      { id: '2', action: 'unchanged', entityType: 'staff-attendance', entityLabel: 'خالد', after: { status: 'present', date: '2026-09-06' } }
    ]
  })),
  commit: vi.fn(async request => ({ reference: 'receipt', appliedChangeIds: request.approvedChangeIds, completedAt: '2026-09-06T06:00:00Z' }))
});
afterEach(cleanup);
const upload = () => fireEvent.change(screen.getByLabelText('رفع تقرير حضوري'), { target: { files: [new File(['report'], 'report.csv')] } });

describe('staff integration review UI', () => {
  it('shows before and after values, requires explicit selection, and refreshes after commit', async () => {
    const api = controller();
    render(<StaffIntegrationsPanel controller={api} showToast={vi.fn()} />);
    upload();
    await screen.findByText('مراجعة تقرير حضوري · 2 سجل');
    expect(screen.getByText('قبل التحديث: حاضر')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'اعتماد 0 سجلات في حاضر' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('اختيار خالد 2026-09-06') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('اختيار أحمد 2026-09-06'));
    fireEvent.click(screen.getByRole('button', { name: 'اعتماد 1 سجلات في حاضر' }));
    await waitFor(() => expect(api.commit).toHaveBeenCalledWith({ reviewId: 'review', approvedChangeIds: ['1'], approval: {} }));
    await waitFor(() => expect(screen.queryByText('مراجعة تقرير حضوري · 2 سجل')).toBeNull());
    expect(api.history).toHaveBeenCalledTimes(2);
  });
  it('clears old review when switching platforms and disables actions while inspecting', async () => {
    const api = controller();
    render(<StaffIntegrationsPanel controller={api} showToast={vi.fn()} />);
    upload();
    expect((screen.getByRole('button', { name: 'مدرستي' }) as HTMLButtonElement).disabled).toBe(true);
    await screen.findByText('مراجعة تقرير حضوري · 2 سجل');
    fireEvent.click(screen.getByRole('button', { name: 'مدرستي' }));
    expect(screen.queryByText('مراجعة تقرير حضوري · 2 سجل')).toBeNull();
    expect(screen.getByLabelText('رفع تقرير مدرستي')).toBeTruthy();
  });
  it('invalidates a stale preview and surfaces a conflict error', async () => {
    const api = controller();
    const toast = vi.fn();
    vi.mocked(api.commit).mockRejectedValue(new Error('تغيرت البيانات؛ أعد فحص التقرير'));
    render(<StaffIntegrationsPanel controller={api} showToast={toast} />);
    upload();
    fireEvent.click(await screen.findByLabelText('اختيار أحمد 2026-09-06'));
    fireEvent.click(screen.getByRole('button', { name: 'اعتماد 1 سجلات في حاضر' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('تغيرت البيانات؛ أعد فحص التقرير', 'error'));
    await waitFor(() => expect(screen.queryByText('مراجعة تقرير حضوري · 2 سجل')).toBeNull());
  });
});
