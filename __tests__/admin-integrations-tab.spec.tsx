import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminIntegrationsTab from '../components/admin/AdminIntegrationsTab';
import type { IntegrationCenterController } from '../services/integrationCenter';

const createController = (
  available = true
): IntegrationCenterController => ({
  isNoorDesktopAvailable: () => available,
  openNoorSession: vi.fn(async () => ({ opened: true })),
  inspectNoorRoster: vi.fn(async () => ({
    id: 'review-1',
    platform: 'noor',
    operation: 'pull-roster',
    effect: 'read',
    remoteRevision: 'noor-roster:abc',
    changes: [
      {
        id: 'new-1',
        entityType: 'student',
        entityLabel: 'طالب جديد',
        action: 'create',
        after: { external_id: '1001', name: 'طالب جديد', class_name: 'الأول', section: 'أ' }
      },
      {
        id: 'missing-1',
        entityType: 'student',
        entityLabel: 'طالب مفقود',
        action: 'delete',
        blocked: true,
        warnings: ['لا يُحذف تلقائياً']
      },
      {
        id: 'update-1',
        entityType: 'student',
        entityLabel: 'اسم محدث',
        action: 'update',
        before: { external_id: '1003', name: 'اسم قديم', class_name: 'الثاني', section: 'أ' },
        after: { external_id: '1003', name: 'اسم محدث', class_name: 'الثالث', section: 'ب' }
      }
    ],
    warnings: [],
    createdAt: '2026-09-02T10:00:00.000Z',
    expiresAt: '2026-09-02T10:15:00.000Z'
  })),
  commitNoorRoster: vi.fn(async () => ({
    reference: 'hader://roster-import/review-1',
    appliedChangeIds: ['new-1'],
    completedAt: '2026-09-02T10:01:00.000Z'
  })),
  auditEvents: () => []
});

afterEach(cleanup);

describe('admin integrations tab', () => {
  it('explains that live Noor sessions require the desktop app', () => {
    render(
      <AdminIntegrationsTab
        controller={createController(false)}
        showToast={vi.fn()}
      />
    );

    expect(screen.getByText(/يتطلب تطبيق حاضر لسطح المكتب/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /فتح جلسة نور/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires explicit selection and never allows a blocked missing student to be imported', async () => {
    const controller = createController();
    const showToast = vi.fn();
    render(<AdminIntegrationsTab controller={controller} showToast={showToast} />);

    fireEvent.click(screen.getByRole('button', { name: /فتح جلسة نور/ }));
    await waitFor(() => expect(controller.openNoorSession).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /فحص كشف الطلاب الحالي/ }));
    await screen.findByRole('checkbox', { name: 'اختيار طالب جديد' });
    expect(screen.getByText('طالب مفقود')).toBeTruthy();
    expect(screen.getByText('الاسم: اسم قديم ← اسم محدث')).toBeTruthy();
    expect(screen.getByText('الصف: الثاني ← الثالث')).toBeTruthy();
    expect((screen.getByRole('button', { name: /اعتماد 0 تغييرات/ }) as HTMLButtonElement).disabled).toBe(true);

    const selectable = screen.getByRole('checkbox', { name: 'اختيار طالب جديد' });
    const blocked = screen.getByRole('checkbox', { name: 'اختيار طالب مفقود' });
    expect((blocked as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(selectable);
    fireEvent.click(screen.getByRole('button', { name: /اعتماد 1 تغييرات/ }));

    await waitFor(() => expect(controller.commitNoorRoster).toHaveBeenCalledWith({
      reviewId: 'review-1',
      approvedChangeIds: ['new-1'],
      approval: {}
    }));
    expect(showToast).toHaveBeenCalledWith('تم استيراد 1 طالب/تحديث بنجاح', 'success');
  });

  it('discards an old review as soon as a new inspection starts, even when it fails', async () => {
    const controller = createController();
    const inspect = vi.mocked(controller.inspectNoorRoster);
    const showToast = vi.fn();
    render(<AdminIntegrationsTab controller={controller} showToast={showToast} />);

    fireEvent.click(screen.getByRole('button', { name: /فحص كشف الطلاب الحالي/ }));
    await screen.findByRole('checkbox', { name: 'اختيار طالب جديد' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'اختيار طالب جديد' }));

    inspect.mockRejectedValueOnce(new Error('layout is not recognized'));
    fireEvent.click(screen.getByRole('button', { name: /فحص كشف الطلاب الحالي/ }));

    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'اختيار طالب جديد' })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: /اعتماد 1 تغييرات/ })).toBeNull();
  });
});
