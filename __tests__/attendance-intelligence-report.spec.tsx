import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AttendanceIntelligenceReport from '../components/reports/AttendanceIntelligenceReport';
import type { Student } from '../types';

const student: Student = {
  id: 'student-without-records',
  name: 'ناصر عبدالله',
  class_name: 'الثاني متوسط',
  section: 'ب'
};

describe('attendance intelligence report', () => {
  it('shows an unrecorded weekly scorecard when attendance data is empty', () => {
    render(
      <AttendanceIntelligenceReport
        students={[student]}
        attendanceRecords={[]}
        period={{ startDate: '2026-03-29', endDate: '2026-05-23' }}
        weekStartDate="2026-05-17"
      />
    );

    expect(screen.getByText('البطاقة الأسبوعية')).toBeTruthy();
    expect(screen.getByText('غير مكتمل · 0')).toBeTruthy();
    expect(screen.getAllByText('غير مسجل')).toHaveLength(5);
    expect(screen.queryByText('100%')).toBeNull();
  });
});
