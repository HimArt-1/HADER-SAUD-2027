import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminStaffOperationsTab from '../components/admin/AdminStaffOperationsTab';
import type { CoveragePlan } from '../modules/staffOperations';
import type { StaffOperationsController } from '../services/staffOperations';

const plan: CoveragePlan = {
  id: 'plan-1',
  date: '2026-09-02',
  inputRevision: 'revision-1',
  inputVersion: 0,
  generatedAt: '2026-09-02T06:30:00.000Z',
  assignments: [{
    id: 'assignment-1',
    lessonSlotId: 'slot-1',
    absentTeacherId: 'teacher-1',
    substituteTeacherId: 'teacher-2',
    period: 2,
    subject: 'رياضيات',
    className: 'الأول',
    section: 'أ',
    status: 'proposed',
    reasons: ['تكليفات الأسبوع: 0', 'مطابقة التخصص']
  }],
  unfilledCount: 0
};

const createController = (): StaffOperationsController => ({
  dashboard: vi.fn(async date => ({
    version: 0,
    date,
    teachers: [
      { id: 'teacher-1', name: 'محمد الغائب', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
      { id: 'teacher-2', name: 'أحمد البديل', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true }
    ],
    timetable: [{ id: 'slot-1', teacherId: 'teacher-1', day: 3, period: 2, subject: 'رياضيات', className: 'الأول', section: 'أ' }],
    attendance: [{ id: 'attendance-1', teacherId: 'teacher-1', date, status: 'absent', recordedAt: `${date}T06:00:00.000Z` }],
    coveragePlans: [],
    absentTeacherIds: ['teacher-1'],
    approvedPlan: null
  })),
  saveTeacher: vi.fn(),
  replaceTimetable: vi.fn(async ({ slots }) => slots.map((slot, index) => ({ ...slot, id: `slot-${index}` }))),
  recordAttendance: vi.fn(),
  generateCoverage: vi.fn(async () => plan),
  approveCoverage: vi.fn(async value => ({
    ...value,
    approvedAt: '2026-09-02T06:35:00.000Z',
    approvedBy: 'admin-1',
    assignments: value.assignments.map(assignment => ({ ...assignment, status: 'approved' as const }))
  })),
  auditEvents: vi.fn(async () => []),
  previewTimetableFile: vi.fn(async () => ({
    slots: [{ teacherId: 'teacher-1', day: 3, period: 2, subject: 'رياضيات', className: 'الأول', section: 'أ' }],
    errors: []
  }))
});

afterEach(cleanup);

describe('admin staff operations tab', () => {
  it('keeps imported timetable rows in review until explicit approval', async () => {
    const controller = createController();
    render(
      <AdminStaffOperationsTab
        controller={controller}
        initialDate="2026-09-02"
        showToast={vi.fn()}
      />
    );

    await screen.findByText('محمد الغائب');
    const file = new File(['placeholder'], 'timetable.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    fireEvent.change(screen.getByLabelText('رفع ملف جدول المعلمين'), { target: { files: [file] } });

    await screen.findByText('جاهز للمراجعة: 1 حصة');
    expect(controller.replaceTimetable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'اعتماد الجدول الأسبوعي' }));
    await waitFor(() => expect(controller.replaceTimetable).toHaveBeenCalledTimes(1));
  });

  it('shows the proposed substitute and requires a separate approval action', async () => {
    const controller = createController();
    render(
      <AdminStaffOperationsTab
        controller={controller}
        initialDate="2026-09-02"
        showToast={vi.fn()}
      />
    );

    await screen.findByText('محمد الغائب');
    fireEvent.click(screen.getByRole('button', { name: 'توليد جدول الانتظار' }));
    await screen.findByText('أحمد البديل');
    expect(controller.approveCoverage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'اعتماد جدول الانتظار' }));
    await waitFor(() => expect(controller.approveCoverage).toHaveBeenCalledWith(plan));
  });

  it('shows approved assignment details after reopening the page', async () => {
    const controller = createController();
    const approvedPlan: CoveragePlan = {
      ...plan,
      approvedAt: '2026-09-02T06:35:00.000Z',
      approvedBy: 'admin-1',
      assignments: plan.assignments.map(assignment => ({ ...assignment, status: 'approved' as const }))
    };
    vi.mocked(controller.dashboard).mockImplementation(async date => ({
      version: 1,
      date,
      teachers: [
        { id: 'teacher-1', name: 'محمد الغائب', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
        { id: 'teacher-2', name: 'أحمد البديل', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true }
      ],
      timetable: [{ id: 'slot-1', teacherId: 'teacher-1', day: 3, period: 2, subject: 'رياضيات', className: 'الأول', section: 'أ' }],
      attendance: [{ id: 'attendance-1', teacherId: 'teacher-1', date, status: 'absent', recordedAt: `${date}T06:00:00.000Z` }],
      coveragePlans: [approvedPlan],
      absentTeacherIds: ['teacher-1'],
      approvedPlan
    }));

    render(<AdminStaffOperationsTab controller={controller} initialDate="2026-09-02" showToast={vi.fn()} />);

    expect(await screen.findByText('جدول الانتظار معتمد لهذا اليوم (1 تغطية).')).toBeTruthy();
    expect(screen.getByText('الحصة 2 · الأول/أ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'اعتماد جدول الانتظار' })).toBeNull();
  });

  it('edits an existing teacher through the same validated save operation', async () => {
    const controller = createController();
    render(<AdminStaffOperationsTab controller={controller} initialDate="2026-09-02" showToast={vi.fn()} />);

    await screen.findByText('محمد الغائب');
    fireEvent.click(screen.getByRole('button', { name: 'تعديل أحمد البديل' }));
    fireEvent.change(screen.getByPlaceholderText('التخصص'), { target: { value: 'فيزياء' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));

    await waitFor(() => expect(controller.saveTeacher).toHaveBeenCalledWith({
      id: 'teacher-2',
      name: 'أحمد البديل',
      specialty: 'فيزياء',
      maxWeeklyWaits: 3,
      isActive: true
    }));
  });

  it('does not keep showing a locally approved plan after teacher inputs invalidate it', async () => {
    const controller = createController();
    const approvedPlan: CoveragePlan = {
      ...plan,
      approvedAt: '2026-09-02T06:35:00.000Z',
      approvedBy: 'admin-1',
      assignments: plan.assignments.map(assignment => ({ ...assignment, status: 'approved' as const }))
    };
    let dashboardCall = 0;
    vi.mocked(controller.dashboard).mockImplementation(async date => {
      dashboardCall += 1;
      const currentApproved = dashboardCall === 2 ? approvedPlan : null;
      return {
        version: dashboardCall,
        date,
        teachers: [
          { id: 'teacher-1', name: 'محمد الغائب', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
          { id: 'teacher-2', name: 'أحمد البديل', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true }
        ],
        timetable: [{ id: 'slot-1', teacherId: 'teacher-1', day: 3, period: 2, subject: 'رياضيات', className: 'الأول', section: 'أ' }],
        attendance: [{ id: 'attendance-1', teacherId: 'teacher-1', date, status: 'absent', recordedAt: `${date}T06:00:00.000Z` }],
        coveragePlans: currentApproved ? [currentApproved] : [],
        absentTeacherIds: ['teacher-1'],
        approvedPlan: currentApproved
      };
    });
    vi.mocked(controller.approveCoverage).mockResolvedValue(approvedPlan);
    render(<AdminStaffOperationsTab controller={controller} initialDate="2026-09-02" showToast={vi.fn()} />);

    await screen.findByText('محمد الغائب');
    fireEvent.click(screen.getByRole('button', { name: 'توليد جدول الانتظار' }));
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد جدول الانتظار' }));
    expect(await screen.findByText('جدول الانتظار معتمد لهذا اليوم (1 تغطية).')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'تعديل أحمد البديل' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() => expect(dashboardCall).toBe(3));
    expect(screen.queryByText('جدول الانتظار معتمد لهذا اليوم (1 تغطية).')).toBeNull();
  });
});
