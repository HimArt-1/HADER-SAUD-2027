import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminReportsTab, { AdminReportsTabProps } from '../components/admin/AdminReportsTab';

afterEach(cleanup);

const createProps = (overrides: Partial<AdminReportsTabProps> = {}): AdminReportsTabProps => ({
  reportFilter: {
    date_from: '2026-08-23',
    date_to: '2026-08-23',
    class_name: '',
    section: '',
    status: 'all',
    search_query: ''
  },
  setReportFilter: vi.fn(),
  reportFiltersCollapsed: false,
  setReportFiltersCollapsed: vi.fn(),
  reportData: null,
  setReportData: vi.fn(),
  classes: [],
  students: [],
  kiosk_settings: { school_name: 'مدرسة الاختبار' },
  loading: false,
  setLoading: vi.fn(),
  defaultReportDate: '2026-08-23',
  workDays: [0, 1, 2, 3, 4],
  holidays: [],
  onGoToStudents: vi.fn(),
  ...overrides
});

describe('admin reports tab', () => {
  it('guides a school without students and disables report generation', () => {
    const onGoToStudents = vi.fn();
    render(<AdminReportsTab {...createProps({ onGoToStudents })} />);

    expect(screen.getByText('أضف الطلاب قبل إنشاء تقرير الحضور')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'عرض التقرير' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'فتح إدارة الطلاب' }));
    expect(onGoToStudents).toHaveBeenCalledTimes(1);
  });

  it('clears generated results as soon as a filter changes', () => {
    const setReportData = vi.fn();
    render(<AdminReportsTab {...createProps({
      students: [{ id: 's1', name: 'أحمد', class_name: 'أول ثانوي', section: 'أ', is_active: true }],
      setReportData,
      reportData: {
        summary: {
          totalRecords: 1,
          rosterCount: 1,
          calendarDays: 1,
          workingDays: 1,
          expectedRecords: 1,
          recordedRecords: 1,
          present: 1,
          late: 0,
          absent: 0,
          unrecorded: 0,
          holidayRecords: 0,
          attendanceRate: 100
        },
        details: [{
          student_id: 's1',
          studentName: 'أحمد',
          className: 'أول ثانوي',
          section: 'أ',
          date: '2026-08-23',
          time: '2026-08-23T06:45:00',
          status: 'present'
        }]
      }
    })} />);

    fireEvent.change(screen.getByPlaceholderText('اكتب اسم الطالب أو رقم المعرف...'), {
      target: { value: 'أحمد' }
    });

    expect(setReportData).toHaveBeenCalledWith(null);
  });
});
